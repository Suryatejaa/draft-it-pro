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

export class OpenAICompatibleProvider implements LLMProvider {
  id: LLMProviderId = 'openai-compatible';
  displayName: string;

  private apiKey: string;
  private baseUrl: string;

  constructor(name = 'OpenAI Compatible', apiKey = '', baseUrl = 'https://api.openai.com/v1') {
    this.displayName = name;
    this.apiKey = apiKey;
    this.baseUrl = baseUrl.replace(/\/+$/, '');
  }

  listModels(): ModelInfo[] {
    return [
      { id: 'gpt-4o-mini', displayName: 'GPT-4o Mini', contextWindow: 128000, maxOutputTokens: 16384 },
      { id: 'gpt-4o', displayName: 'GPT-4o', contextWindow: 128000, maxOutputTokens: 16384 },
      { id: 'claude-3-5-sonnet', displayName: 'Claude 3.5 Sonnet', contextWindow: 200000, maxOutputTokens: 8192 },
      { id: 'deepseek-chat', displayName: 'DeepSeek Chat', contextWindow: 64000, maxOutputTokens: 4096 },
    ];
  }

  async validateCredentials(apiKey?: string, model = 'gpt-4o-mini', baseUrl?: string): Promise<boolean> {
    const keyToUse = apiKey !== undefined ? apiKey : this.apiKey;
    const urlToUse = (baseUrl || this.baseUrl).replace(/\/+$/, '');
    if (!keyToUse || keyToUse.trim().length === 0) return false;

    try {
      const res = await fetch(`${urlToUse}/chat/completions`, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'Authorization': `Bearer ${keyToUse}`,
        },
        body: JSON.stringify({
          model,
          messages: [{ role: 'user', content: 'Ping' }],
          max_tokens: 5,
        }),
      });
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
    };
    if (this.apiKey) {
      headers['Authorization'] = `Bearer ${this.apiKey}`;
    }

    const payload: Record<string, any> = {
      model: model || 'gpt-4o-mini',
      messages: wireMessages(formattedMessages),
      ...wireTools(request),
      temperature: request.temperature ?? 0.7,
      max_tokens: request.maxTokens ?? 2048,
    };

    const res = await fetch(`${this.baseUrl}/chat/completions`, {
      method: 'POST',
      headers,
      body: JSON.stringify(payload),
      signal: request.abortSignal,
    });

    if (!res.ok) {
      const errText = await res.text().catch(() => '');
      const err = new Error(`OpenAI-compatible API returned HTTP ${res.status}: ${errText}`);
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
    };
    if (this.apiKey) {
      headers['Authorization'] = `Bearer ${this.apiKey}`;
    }

    const payload: Record<string, any> = {
      model: model || 'gpt-4o-mini',
      messages: wireMessages(formattedMessages),
      ...wireTools(request),
      temperature: request.temperature ?? 0.7,
      max_tokens: request.maxTokens ?? 2048,
      stream: true,
    };

    const res = await fetch(`${this.baseUrl}/chat/completions`, {
      method: 'POST',
      headers,
      body: JSON.stringify(payload),
      signal: request.abortSignal,
    });

    if (!res.ok) {
      const errText = await res.text().catch(() => '');
      const err = new Error(`OpenAI-compatible API returned HTTP ${res.status}: ${errText}`);
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
