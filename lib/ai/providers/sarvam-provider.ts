import { traceSerializedToolScenes } from '../scene-payload.ts';
import { wireMessages, wireTools, parseToolCalls, readChatStream } from './chat-transport.ts';
import type { LLMProvider } from './provider-interface';
import type {
  LLMProviderId,
  ModelInfo,
  LLMRequest,
  LLMResponse,
  LLMStreamChunk,
  LLMMessage,
} from '../types';

export class SarvamProvider implements LLMProvider {
  id: LLMProviderId = 'sarvam';
  displayName = 'Sarvam AI';

  private apiKey: string;
  private baseUrl: string;

  constructor(apiKey: string, baseUrl = 'https://api.sarvam.ai/v1') {
    this.apiKey = apiKey;
    this.baseUrl = baseUrl.replace(/\/+$/, '');
  }

  listModels(): ModelInfo[] {
    return [
      { id: 'sarvam-105b', displayName: 'Sarvam 105B', contextWindow: 32768, maxOutputTokens: 4096 },
      { id: 'sarvam-30b', displayName: 'Sarvam 30B', contextWindow: 16384, maxOutputTokens: 4096 },
      { id: 'sarvam-2b', displayName: 'Sarvam 2B', contextWindow: 8192, maxOutputTokens: 2048 },
    ];
  }

  async validateCredentials(apiKey?: string, model = 'sarvam-105b'): Promise<boolean> {
    const keyToUse = apiKey || this.apiKey;
    if (!keyToUse || keyToUse.trim().length === 0) return false;

    try {
      const res = await fetch(`${this.baseUrl}/chat/completions`, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'Authorization': `Bearer ${keyToUse}`,
          'api-subscription-key': keyToUse,
        },
        body: JSON.stringify({
          model,
          messages: [{ role: 'user', content: 'Ping' }],
          max_tokens: 5,
        }),
      });
      // 200 OK or 400 with valid auth response
      return res.status !== 401 && res.status !== 403;
    } catch {
      return false;
    }
  }

  private formatMessages(request: LLMRequest): LLMMessage[] {
    const messages: LLMMessage[] = [];
    if (request.systemInstruction) {
      messages.push({ role: 'system', content: request.systemInstruction });
    }
    messages.push(...request.messages);
    return messages;
  }

  async generate(request: LLMRequest, model: string): Promise<LLMResponse> {
    const startTime = Date.now();
    const formattedMessages = this.formatMessages(request);

    const headers: Record<string, string> = {
      'Content-Type': 'application/json',
      'Authorization': `Bearer ${this.apiKey}`,
      'api-subscription-key': this.apiKey,
    };

    const payload: Record<string, any> = {
      model: model || 'sarvam-105b',
      messages: wireMessages(formattedMessages),
      ...wireTools(request),
      temperature: request.temperature ?? 0.7,
      max_tokens: request.maxTokens ?? 2048,
    };

    if (process.env.NODE_ENV === 'development') for (const message of payload.messages) if (message.role === 'tool') traceSerializedToolScenes('sarvam.providerToolResultSceneCount', message.content);
    const res = await fetch(`${this.baseUrl}/chat/completions`, {
      method: 'POST',
      headers,
      body: JSON.stringify(payload),
      signal: request.abortSignal,
    });

    if (!res.ok) {
      const errText = await res.text().catch(() => '');
      const err = new Error(`Sarvam API returned HTTP ${res.status}: ${errText}`);
      (err as any).status = res.status;
      throw err;
    }

    const data = await res.json();
    const durationMs = Date.now() - startTime;
    const choice = data.choices?.[0];
    const content = choice?.message?.content || '';

    return {
      content,
      toolCalls: parseToolCalls(choice?.message?.tool_calls),
      providerId: this.id,
      model,
      finishReason: choice?.finish_reason || 'stop',
      usage: {
        inputTokens: data.usage?.prompt_tokens,
        outputTokens: data.usage?.completion_tokens,
        durationMs,
      },
    };
  }

  async stream(
    request: LLMRequest,
    model: string,
    onChunk: (chunk: LLMStreamChunk) => void
  ): Promise<LLMResponse> {
    const startTime = Date.now();
    const formattedMessages = this.formatMessages(request);

    const headers: Record<string, string> = {
      'Content-Type': 'application/json',
      'Authorization': `Bearer ${this.apiKey}`,
      'api-subscription-key': this.apiKey,
    };

    const payload: Record<string, any> = {
      model: model || 'sarvam-105b',
      messages: wireMessages(formattedMessages),
      ...wireTools(request),
      temperature: request.temperature ?? 0.7,
      max_tokens: request.maxTokens ?? 2048,
      stream: true,
    };

    if (process.env.NODE_ENV === 'development') for (const message of payload.messages) if (message.role === 'tool') traceSerializedToolScenes('sarvam.providerToolResultSceneCount', message.content);
    const res = await fetch(`${this.baseUrl}/chat/completions`, {
      method: 'POST',
      headers,
      body: JSON.stringify(payload),
      signal: request.abortSignal,
    });

    if (!res.ok) {
      const errText = await res.text().catch(() => '');
      const err = new Error(`Sarvam API returned HTTP ${res.status}: ${errText}`);
      (err as any).status = res.status;
      throw err;
    }

    const result = await readChatStream(res, onChunk);
    return {
      ...result,
      providerId: this.id,
      model,
      usage: { ...result.usage, durationMs: Date.now() - startTime },
    };
  }
}
