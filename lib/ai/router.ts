import type { LLMProvider } from './providers/provider-interface.ts';
import { SarvamProvider } from './providers/sarvam-provider.ts';
import { OpenAICompatibleProvider } from './providers/openai-compatible-provider.ts';
import type {
  LLMProviderId,
  ProviderSettings,
  LLMRequest,
  LLMResponse,
  LLMStreamChunk,
  LLMFailureType,
  FallbackMetadata,
} from './types';

export function classifyError(error: any): LLMFailureType {
  if (!error) return 'unknown';

  if (error.name === 'AbortError' || error.message?.includes('aborted') || error.message?.includes('cancelled')) {
    return 'cancelled';
  }

  const status = error.status || error.statusCode || error.response?.status;
  const msg = String(error.message || error).toLowerCase();

  if (status === 401 || status === 403 || msg.includes('unauthorized') || msg.includes('invalid api key') || msg.includes('authentication')) {
    return 'authentication';
  }

  if (msg.includes('safety') || msg.includes('content filter') || msg.includes('moderation') || msg.includes('policy violation')) {
    return 'safety';
  }

  if (status === 400 && !msg.includes('context') && !msg.includes('token limit')) return 'invalid_request';

  if (status === 429 || msg.includes('rate limit') || msg.includes('too many requests') || msg.includes('quota exceeded')) {
    return 'rate_limit';
  }

  if (status === 503 || msg.includes('capacity') || msg.includes('overloaded') || msg.includes('server busy')) {
    return 'capacity';
  }

  if (msg.includes('model not found') || msg.includes('model unavailable') || msg.includes('unknown model')) {
    return 'model_unavailable';
  }

  if (msg.includes('context length') || msg.includes('maximum context') || msg.includes('too long') || msg.includes('token limit')) {
    return 'context_limit';
  }



  if (status === 400 || status === 404 || msg.includes('invalid_request') || msg.includes('bad request') || msg.includes('malformed')) {
    return 'invalid_request';
  }

  if (msg.includes('timeout') || msg.includes('etimedout') || msg.includes('econnaborted')) {
    return 'timeout';
  }

  if (status >= 500 && status <= 599) {
    return 'server_error';
  }

  return 'unknown';
}

export function isRecoverableFailure(type: LLMFailureType): boolean {
  switch (type) {
    case 'timeout':
    case 'rate_limit':
    case 'capacity':
    case 'server_error':
    case 'model_unavailable':
      return true;
    case 'context_limit':
    case 'authentication':
    case 'invalid_request':
    case 'safety':
    case 'cancelled':
    default:
      return false;
  }
}

export interface RouteTarget {
  providerId: LLMProviderId;
  model: string;
}

export class ModelRouter {
  private settings: ProviderSettings;
  private providers: Map<LLMProviderId, LLMProvider>;

  constructor(settings: ProviderSettings) {
    this.settings = settings;
    this.providers = new Map();

    if (settings.sarvam?.apiKey) {
      this.providers.set('sarvam', new SarvamProvider(settings.sarvam.apiKey));
    }

    if (settings.openaiCompatible?.apiKey || settings.openaiCompatible?.baseUrl) {
      this.providers.set(
        'openai-compatible',
        new OpenAICompatibleProvider(
          settings.openaiCompatible.name,
          settings.openaiCompatible.apiKey,
          settings.openaiCompatible.baseUrl
        )
      );
    }
  }

  private buildRouteTargets(explicitModel?: string): RouteTarget[] {
    const targets: RouteTarget[] = [];

    // If explicit model requested (and not 'auto')
    if (explicitModel && explicitModel !== 'auto') {
      if (explicitModel.startsWith('sarvam-')) {
        targets.push({ providerId: 'sarvam', model: explicitModel });
      } else {
        targets.push({
          providerId: 'openai-compatible',
          model: explicitModel,
        });
      }
    }

    // Add primary target
    const primary = this.settings.routing.primaryProviderId || 'sarvam';
    const primaryModel = this.settings.routing.primaryModel || 'sarvam-105b';
    if (!targets.some((t) => t.providerId === primary && t.model === primaryModel)) {
      targets.push({ providerId: primary, model: primaryModel });
    }

    // Add fallbacks
    for (const fb of this.settings.routing.fallbacks || []) {
      if (!targets.some((t) => t.providerId === fb.providerId && t.model === fb.model)) {
        targets.push({ providerId: fb.providerId, model: fb.model });
      }
    }

    return targets;
  }

  async execute(
    request: LLMRequest,
    selectedModel?: string
  ): Promise<LLMResponse> {
    if (request.abortSignal?.aborted) throw Object.assign(new Error('Request cancelled'), { name: 'AbortError', failureType: 'cancelled' });
    const targets = this.buildRouteTargets(selectedModel);
    const attempted: Array<{
      providerId: LLMProviderId;
      model: string;
      failureType: LLMFailureType;
      error: string;
    }> = [];

    const requestedTarget = targets[0] || { providerId: 'sarvam', model: 'sarvam-105b' };

    for (let i = 0; i < targets.length; i++) {
      const target = targets[i];
      const provider = this.providers.get(target.providerId);

      // Skip unconfigured providers
      if (!provider) {
        attempted.push({
          providerId: target.providerId,
          model: target.model,
          failureType: 'authentication',
          error: `Provider ${target.providerId} is not configured with credentials`,
        });
        throw Object.assign(new Error(`Provider ${target.providerId} is not configured. Check AI Provider settings.`), { failureType: 'authentication' });
      }

      try {
        const response = await provider.generate(request, target.model);

        if (i > 0 || response.providerId !== requestedTarget.providerId || response.model !== requestedTarget.model) {
          const fallbackReason = attempted.length > 0
            ? attempted.map((a) => `${a.providerId} (${a.model}) failed: ${a.failureType}`).join('; ')
            : 'Routed to available configured provider';

          const fallbackMeta: FallbackMetadata = {
            requestedProviderId: requestedTarget.providerId,
            requestedModel: requestedTarget.model,
            usedProviderId: response.providerId,
            usedModel: response.model,
            fallbackReason,
            attemptedProviders: attempted,
          };
          response.fallback = fallbackMeta;
        }

        return response;
      } catch (err: any) {
        const failureType = classifyError(err);
        const errorMsg = err instanceof Error ? err.message : String(err);

        attempted.push({
          providerId: target.providerId,
          model: target.model,
          failureType,
          error: errorMsg,
        });

        if (!isRecoverableFailure(failureType)) {
          // Unrecoverable error (e.g. Auth failure, safety, cancellation) — rethrow
          (err as any).failureType = failureType;
          throw err;
        }

        // If this was the last target, throw the error
        if (i === targets.length - 1) {
          const finalErr = new Error(`All LLM providers failed. Last error (${failureType}): ${errorMsg}`);
          (finalErr as any).failureType = failureType;
          (finalErr as any).attempted = attempted;
          throw finalErr;
        }
      }
    }

    throw new Error('No working LLM provider available. Please check AI Provider settings.');
  }

  async stream(
    request: LLMRequest,
    onChunk: (chunk: LLMStreamChunk) => void,
    selectedModel?: string
  ): Promise<LLMResponse> {
    if (request.abortSignal?.aborted) throw Object.assign(new Error('Request cancelled'), { name: 'AbortError', failureType: 'cancelled' });
    const targets = this.buildRouteTargets(selectedModel);
    const attempted: Array<{
      providerId: LLMProviderId;
      model: string;
      failureType: LLMFailureType;
      error: string;
    }> = [];

    const requestedTarget = targets[0] || { providerId: 'sarvam', model: 'sarvam-105b' };

    for (let i = 0; i < targets.length; i++) {
      const target = targets[i];
      const provider = this.providers.get(target.providerId);

      if (!provider) {
        attempted.push({
          providerId: target.providerId,
          model: target.model,
          failureType: 'authentication',
          error: `Provider ${target.providerId} is not configured`,
        });
        throw Object.assign(new Error(`Provider ${target.providerId} is not configured. Check AI Provider settings.`), { failureType: 'authentication' });
      }

      try {
        const streamFn = provider.stream ? provider.stream.bind(provider) : provider.generate.bind(provider);
        const response = await streamFn(request, target.model, onChunk);

        if (i > 0 || response.providerId !== requestedTarget.providerId || response.model !== requestedTarget.model) {
          const fallbackReason = attempted.length > 0
            ? attempted.map((a) => `${a.providerId} (${a.model}) failed: ${a.failureType}`).join('; ')
            : 'Routed to available configured provider';

          const fallbackMeta: FallbackMetadata = {
            requestedProviderId: requestedTarget.providerId,
            requestedModel: requestedTarget.model,
            usedProviderId: response.providerId,
            usedModel: response.model,
            fallbackReason,
            attemptedProviders: attempted,
          };
          response.fallback = fallbackMeta;
        }

        return response;
      } catch (err: any) {
        const failureType = classifyError(err);
        const errorMsg = err instanceof Error ? err.message : String(err);

        attempted.push({
          providerId: target.providerId,
          model: target.model,
          failureType,
          error: errorMsg,
        });

        if (!isRecoverableFailure(failureType)) {
          (err as any).failureType = failureType;
          throw err;
        }

        if (i < targets.length - 1) onChunk({ type: 'reset' });
        if (i === targets.length - 1) {
          const finalErr = new Error(`All LLM providers failed. Last error (${failureType}): ${errorMsg}`);
          (finalErr as any).failureType = failureType;
          (finalErr as any).attempted = attempted;
          throw finalErr;
        }
      }
    }

    throw new Error('No working LLM provider available. Please check AI Provider settings.');
  }
}
