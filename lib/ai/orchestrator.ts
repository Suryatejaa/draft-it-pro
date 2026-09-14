import { traceSerializedToolScenes } from './scene-payload.ts';
import type { LLMMessage, LLMResponse, LLMStreamChunk, ProviderSettings } from './types.ts';
import { loadAISettings } from './credentials.ts';
import { ModelRouter } from './router.ts';
import { buildAgentContext, type BuildContextOptions } from './context-builder.ts';
import { CO_WRITER_SYSTEM_INSTRUCTION } from './system-instructions.ts';
import { READ_ONLY_TOOLS, initialReadOnlyQueries, retrieveToolResult } from './tools.ts';

export interface OrchestrateOptions extends BuildContextOptions {
  history?: LLMMessage[];
  userQuery: string;
  settings?: ProviderSettings;
  selectedModel?: string;
  abortSignal?: AbortSignal;
  onRequestStart?: () => void;
}

export const MAX_TOOL_ROUNDS = 4;

/** Development diagnostics contain IDs/counts and routing metadata only, never credentials or raw content. */
function debug(event: string, metadata: unknown) {
  if (process.env.NODE_ENV === 'development') console.debug('[Co-Drafter]', event, metadata);
}

export class AgentOrchestrator {
  private router: ModelRouter;
  constructor(settings?: ProviderSettings) { this.router = new ModelRouter(settings || loadAISettings()); }

  async run(options: OrchestrateOptions): Promise<LLMResponse> { return this.respond(options); }
  async stream(options: OrchestrateOptions, onChunk: (chunk: LLMStreamChunk) => void): Promise<LLMResponse> {
    return this.respond(options, onChunk);
  }

  private async respond(options: OrchestrateOptions, onChunk?: (chunk: LLMStreamChunk) => void): Promise<LLMResponse> {
    const { rootProject, activeWorkspace, history = [], userQuery, selectedModel, abortSignal } = options;
    const checkCancelled = () => { if (abortSignal?.aborted) throw Object.assign(new Error('Request cancelled'), { name: 'AbortError', failureType: 'cancelled' }); };
    checkCancelled();
    const context = buildAgentContext(options);
    debug('context', context.retrieval);
    const systemInstruction = `${CO_WRITER_SYSTEM_INSTRUCTION}\n\n${context.systemPromptAddendum}\n\n${context.formattedContext}`;
    const messages: LLMMessage[] = [...history, { role: 'user', content: userQuery }];
    let initialCharacterLinkCount: number | undefined;
    const read = (name: string, args: Record<string, unknown>) => {
      checkCancelled();
      const result = retrieveToolResult(name, args, rootProject, activeWorkspace);
      if (process.env.NODE_ENV === 'development') {
        const data = 'data' in result ? result.data : undefined;
        const entities = (Array.isArray(data) ? data : [data]).flatMap(item => item && typeof item === 'object' ? [item.id, item.sceneId, ...(item.sceneIds || [])].filter(id => typeof id === 'string') : []);
        if (name === 'getCharacter' && Array.isArray((data as { sceneIds?: unknown })?.sceneIds)) initialCharacterLinkCount = (data as { sceneIds: unknown[] }).sceneIds.length;
        const coverage = 'episodeCoverage' in result ? result.episodeCoverage : undefined;
        if (coverage && ['getScenes', 'getCharacter'].includes(name)) debug('episode_retrieval', {
          ...coverage,
          canonicalSceneCount: coverage.episodeSceneCount,
          linkedCharacterMatchCount: name === 'getScenes' ? initialCharacterLinkCount ?? coverage.matchedSceneCount : coverage.matchedSceneCount,
          serializedSceneCount: name === 'getScenes' && Array.isArray(data) ? data.length : undefined,
          completeEpisodeCoverage: result.complete,
          activeActId: options.activeActId ?? (rootProject.episodes?.find(ep => ep.id === activeWorkspace?.id) || activeWorkspace || rootProject).scenes.find(scene => scene.id === options.currentSceneId)?.act ?? null,
        });
        debug('tool', { name: READ_ONLY_TOOLS.some(t => t.name === name) ? name : 'unknown', entityIds: entities, returnedCount: 'returnedCount' in result ? result.returnedCount : undefined, complete: result.complete });
      }
      const serialized = JSON.stringify(result);
      traceSerializedToolScenes('serializedToolScenes.length', serialized);
      return serialized;
    };
    // Explicit global questions retrieve scoped summaries even if the model would otherwise answer from local context.
    const initialCalls = initialReadOnlyQueries(userQuery, rootProject, activeWorkspace).map((call, i) => ({ ...call, id: `retrieval-${i}` }));
    if (initialCalls.length) {
      messages.push({ role: 'assistant', content: '', toolCalls: initialCalls });
      for (const call of initialCalls) messages.push({ role: 'tool', toolCallId: call.id, content: read(call.name, call.arguments) });
    }
    options.onRequestStart?.();
    let fallback: LLMResponse['fallback'];
    for (let round = 0; round <= MAX_TOOL_ROUNDS; round++) {
      checkCancelled();
      if (process.env.NODE_ENV === 'development') for (const message of messages) if (message.role === 'tool') traceSerializedToolScenes('orchestrator.toolResultSentToProvider', message.content);
      const request = { systemInstruction, messages, tools: READ_ONLY_TOOLS, abortSignal };
      let response: LLMResponse;
      try {
        response = onChunk ? await this.router.stream(request, onChunk, selectedModel) : await this.router.execute(request, selectedModel);
      } catch (error) {
        const failure = error as { failureType?: string; attempted?: Array<{ providerId: string; model: string; failureType: string }> };
        debug('request_failed', { failure: failure.failureType, fallbackPath: failure.attempted?.map(a => ({ provider: a.providerId, model: a.model, failure: a.failureType })) });
        throw error;
      }
      checkCancelled();
      fallback = response.fallback || fallback;
      debug('provider', { provider: response.providerId, model: response.model, fallbackPath: response.fallback?.attemptedProviders?.map(a => ({ provider: a.providerId, model: a.model, failure: a.failureType })) });
      if (!response.toolCalls?.length) return { ...response, fallback };
      if (round === MAX_TOOL_ROUNDS) throw new Error('Read-only retrieval limit reached. Please narrow the question; no complete answer was established.');
      if (response.toolCalls.length > 16 || new Set(response.toolCalls.map(c => c.id)).size !== response.toolCalls.length) throw new Error('Invalid or excessive tool requests. Please narrow the question.');
      messages.push({ role: 'assistant', content: response.content, toolCalls: response.toolCalls });
      for (const call of response.toolCalls) messages.push({ role: 'tool', toolCallId: call.id, content: read(call.name, call.arguments) });
      onChunk?.({ type: 'reset' });
    }
    throw new Error('Read-only retrieval limit reached.');
  }
}
