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

  private diagnostic(event: string, request: LLMRequest, data: Record<string, unknown>) {
    if (process.env.NODE_ENV !== 'development' || request.diagnostics?.intent !== 'alternatives') return;
    const requestId = request.diagnostics?.requestId ?? 'ALT-unknown';
    const prefix = `[CoDrafter:Alternatives][${requestId}][SERVER]`;
    console.debug(prefix, event, data);
    void fetch('/api/dev/alternatives-diagnostics', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ prefix, event, data }),
    }).catch(() => {});
  }

  constructor(apiKey: string, baseUrl = 'https://api.sarvam.ai/v1') {
    this.apiKey = apiKey;
    this.baseUrl = baseUrl.replace(/\/+$/, '');
  }

  listModels(): ModelInfo[] {
    return [
      { id: 'sarvam-105b', displayName: 'Sarvam 105B', contextWindow: 32768, maxOutputTokens: 4096 },
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
      temperature: request.diagnostics?.intent === 'alternatives' ? (request.temperature ?? 0.2) : (request.temperature ?? 0.7),
      max_tokens: request.maxTokens ?? 2048,
    };

    if (request.reasoningEffort !== undefined) {
      payload.reasoning_effort = request.reasoningEffort;
    } else if (request.diagnostics?.intent === 'alternatives') {
      payload.reasoning_effort = null;
    }

    this.diagnostic('REQUEST_RECEIVED', request, {
      requestId: request.diagnostics?.requestId,
      provider: this.id,
      model,
      intent: request.diagnostics?.intent,
      providerMessageCount: formattedMessages.length,
      uiConversationMessageCount: request.diagnostics?.uiConversationMessageCount ?? null,
      maxTokens: request.maxTokens ?? payload.max_tokens,
      temperature: payload.temperature,
      reasoningEffort: request.reasoningEffort ?? (request.diagnostics?.intent === 'alternatives' ? null : undefined),
      reasoningMode: request.reasoningEffort === null || request.diagnostics?.intent === 'alternatives' ? 'disabled' : undefined,
      stream: false,
      requestBodyChars: JSON.stringify(payload).length,
      sourceCount: request.diagnostics?.sourceBlocks?.length ?? null,
      sourceBlocks: request.diagnostics?.sourceBlocks,
    });

    if (process.env.NODE_ENV === 'development') for (const message of payload.messages) if (message.role === 'tool') traceSerializedToolScenes('sarvam.providerToolResultSceneCount', message.content);
    let res: Response;
    try {
      res = await fetch(`${this.baseUrl}/chat/completions`, { method: 'POST', headers, body: JSON.stringify(payload), signal: request.abortSignal });
    } catch (error) {
      this.diagnostic('EXCEPTION', request, { name: error instanceof Error ? error.name : 'Error', message: error instanceof Error ? error.message : String(error), stack: error instanceof Error ? error.stack : undefined });
      throw error;
    }

    if (!res.ok) {
      const errText = await res.text().catch(() => '');
      this.diagnostic('PROVIDER_RESPONSE', request, { requestId: request.diagnostics?.requestId, httpStatus: res.status, ok: false, elapsedMs: Date.now() - startTime, finishReason: 'error', contentLength: 0, reasoningContentLength: 0, usage: undefined });
      const err = new Error(`Sarvam API returned HTTP ${res.status}: ${errText}`);
      (err as any).status = res.status;
      throw err;
    }

    let data: any;
    try {
      data = await res.json();
    } catch (error) {
      this.diagnostic('EXCEPTION', request, { name: error instanceof Error ? error.name : 'Error', message: error instanceof Error ? error.message : String(error), stack: error instanceof Error ? error.stack : undefined });
      throw error;
    }
    const durationMs = Date.now() - startTime;
    const choice = data.choices?.[0];
    const content = choice?.message?.content || '';
    const reasoningContent = choice?.message?.reasoning_content || '';
    this.diagnostic('PROVIDER_RESPONSE', request, {
      requestId: request.diagnostics?.requestId,
      httpStatus: res.status,
      ok: res.ok,
      elapsedMs: durationMs,
      finishReason: choice?.finish_reason || 'stop',
      contentLength: content.length,
      reasoningContentLength: reasoningContent.length,
      promptTokens: data.usage?.prompt_tokens,
      completionTokens: data.usage?.completion_tokens,
      totalTokens: data.usage?.total_tokens,
      reasoningEffort: request.reasoningEffort ?? (request.diagnostics?.intent === 'alternatives' ? null : undefined),
      reasoningMode: request.reasoningEffort === null || request.diagnostics?.intent === 'alternatives' ? 'disabled' : undefined,
      outputClassification: !content.trim() ? (choice?.finish_reason === 'length' ? 'SARVAM_OUTPUT_TRUNCATED' : 'SARVAM_EMPTY_FINAL_CONTENT') : null,
    });
    this.diagnostic('RAW_CONTENT_START', request, { content: content.slice(0, 20000) });
    this.diagnostic('RAW_CONTENT_END', request, {});
    if (reasoningContent) {
      this.diagnostic('RAW_REASONING_START', request, { content: reasoningContent.slice(0, 20000) });
      this.diagnostic('RAW_REASONING_END', request, {});
    }

    return {
      content,
      toolCalls: parseToolCalls(choice?.message?.tool_calls),
      providerId: this.id,
      model,
      finishReason: choice?.finish_reason || 'stop',
      reasoningContent,
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
      temperature: request.diagnostics?.intent === 'alternatives' ? (request.temperature ?? 0.2) : (request.temperature ?? 0.7),
      max_tokens: request.maxTokens ?? 2048,
      stream: true,
    };

    if (request.reasoningEffort !== undefined) {
      payload.reasoning_effort = request.reasoningEffort;
    } else if (request.diagnostics?.intent === 'alternatives') {
      payload.reasoning_effort = null;
    }

    this.diagnostic(request.diagnostics?.retryAttempt ? 'REPAIR_REQUEST' : 'REQUEST_RECEIVED', request, {
      requestId: request.diagnostics?.requestId,
      provider: this.id,
      model,
      intent: request.diagnostics?.intent,
      providerMessageCount: formattedMessages.length,
      uiConversationMessageCount: request.diagnostics?.uiConversationMessageCount ?? null,
      maxTokens: request.maxTokens ?? payload.max_tokens,
      temperature: payload.temperature,
      reasoningEffort: request.reasoningEffort ?? (request.diagnostics?.intent === 'alternatives' ? null : undefined),
      reasoningMode: request.reasoningEffort === null || request.diagnostics?.intent === 'alternatives' ? 'disabled' : undefined,
      stream: true,
      requestBodyChars: JSON.stringify(payload).length,
      sourceCount: request.diagnostics?.sourceBlocks?.length ?? null,
      sourceBlocks: request.diagnostics?.sourceBlocks,
    });

    if (process.env.NODE_ENV === 'development') for (const message of payload.messages) if (message.role === 'tool') traceSerializedToolScenes('sarvam.providerToolResultSceneCount', message.content);
    let res: Response;
    try {
      res = await fetch(`${this.baseUrl}/chat/completions`, { method: 'POST', headers, body: JSON.stringify(payload), signal: request.abortSignal });
    } catch (error) {
      this.diagnostic('EXCEPTION', request, { name: error instanceof Error ? error.name : 'Error', message: error instanceof Error ? error.message : String(error), stack: error instanceof Error ? error.stack : undefined });
      throw error;
    }

    if (!res.ok) {
      const errText = await res.text().catch(() => '');
      this.diagnostic('PROVIDER_RESPONSE', request, { requestId: request.diagnostics?.requestId, httpStatus: res.status, ok: false, elapsedMs: Date.now() - startTime, finishReason: 'error', contentLength: 0, reasoningContentLength: 0, usage: undefined });
      const err = new Error(`Sarvam API returned HTTP ${res.status}: ${errText}`);
      (err as any).status = res.status;
      throw err;
    }

    let result: Awaited<ReturnType<typeof readChatStream>>;
    try {
      result = await readChatStream(res, onChunk);
    } catch (error) {
      this.diagnostic('EXCEPTION', request, { name: error instanceof Error ? error.name : 'Error', message: error instanceof Error ? error.message : String(error), stack: error instanceof Error ? error.stack : undefined });
      throw error;
    }
    this.diagnostic('PROVIDER_RESPONSE', request, {
      requestId: request.diagnostics?.requestId,
      httpStatus: res.status,
      ok: res.ok,
      elapsedMs: Date.now() - startTime,
      finishReason: result.finishReason,
      contentLength: result.content.length,
      reasoningContentLength: result.reasoningContent?.length ?? 0,
      promptTokens: result.usage?.inputTokens,
      completionTokens: result.usage?.outputTokens,
      totalTokens: result.usage?.totalTokens,
      reasoningEffort: request.reasoningEffort ?? (request.diagnostics?.intent === 'alternatives' ? null : undefined),
      reasoningMode: request.reasoningEffort === null || request.diagnostics?.intent === 'alternatives' ? 'disabled' : undefined,
      outputClassification: !result.content.trim() ? (result.finishReason === 'length' ? 'SARVAM_OUTPUT_TRUNCATED' : 'SARVAM_EMPTY_FINAL_CONTENT') : null,
    });
    this.diagnostic('RAW_CONTENT_START', request, { content: result.content.slice(0, 20000) });
    this.diagnostic('RAW_CONTENT_END', request, {});
    if (result.reasoningContent) {
      this.diagnostic('RAW_REASONING_START', request, { content: result.reasoningContent.slice(0, 20000) });
      this.diagnostic('RAW_REASONING_END', request, {});
    }
    return {
      ...result,
      providerId: this.id,
      model,
      usage: { ...result.usage, durationMs: Date.now() - startTime },
    };
  }
}
