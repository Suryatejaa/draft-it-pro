import type { LLMMessage, LLMRequest, LLMResponse, LLMStreamChunk, ToolCall } from '../types.ts';

export const wireMessages = (messages: LLMMessage[]) => messages.map(m => ({
  role: m.role, content: m.content,
  ...(m.toolCallId ? { tool_call_id: m.toolCallId } : {}),
  ...(m.toolCalls?.length ? { tool_calls: m.toolCalls.map(call => ({ id: call.id, type: 'function', function: { name: call.name, arguments: JSON.stringify(call.arguments) } })) } : {}),
}));
export const wireTools = (request: LLMRequest) => request.tools?.length
  ? { tools: request.tools.map(tool => ({ type: 'function', function: tool })) } : {};

export function parseToolCalls(calls: any[] = []): ToolCall[] {
  return calls.map(call => {
    let args: unknown;
    try { args = JSON.parse(call.function?.arguments || '{}'); } catch { throw new Error('Model returned malformed tool arguments. Please retry.'); }
    if (!call.id || !call.function?.name || !args || typeof args !== 'object' || Array.isArray(args)) throw new Error('Model returned an invalid tool request. Please retry.');
    return { id: call.id, name: call.function.name, arguments: args as Record<string, unknown> };
  });
}

/** Decode complete SSE events, including fragmented JSON/tool arguments and a final unterminated event. */
export async function readChatStream(res: Response, onChunk: (chunk: LLMStreamChunk) => void): Promise<Pick<LLMResponse, 'content' | 'toolCalls' | 'finishReason' | 'usage'>> {
  const reader = res.body?.getReader();
  if (!reader) throw new Error('Provider returned no response stream.');
  const decoder = new TextDecoder();
  let buffer = '', content = '', doneEvent = false;
  let finishReason: LLMResponse['finishReason'];
  let usage: LLMResponse['usage'];
  const calls = new Map<number, { id: string; function: { name: string; arguments: string } }>();
  function event(raw: string) {
    const data = raw.split('\n').filter(line => line.startsWith('data:')).map(line => line.slice(5).trimStart()).join('\n').trim();
    if (!data) return;
    if (data === '[DONE]') { doneEvent = true; return; }
    const parsed = JSON.parse(data);
    if (parsed.error) throw new Error('Provider reported a streaming error. Please retry.');
    const choice = parsed.choices?.[0];
    if (choice?.finish_reason) finishReason = choice.finish_reason;
    if (parsed.usage) usage = { inputTokens: parsed.usage.prompt_tokens, outputTokens: parsed.usage.completion_tokens };
    if (choice?.delta?.content) { content += choice.delta.content; onChunk({ type: 'content', content: choice.delta.content }); }
    for (const delta of choice?.delta?.tool_calls || []) {
      if (!Number.isInteger(delta.index) || delta.index < 0 || delta.index >= 16) throw new Error('Too many or invalid tool calls in one response.');
      const call = calls.get(delta.index) || { id: '', function: { name: '', arguments: '' } };
      call.id += delta.id || '';
      call.function.name += delta.function?.name || '';
      call.function.arguments += delta.function?.arguments || '';
      calls.set(delta.index, call);
    }
  }
  try {
    while (!doneEvent) {
      const { done, value } = await reader.read();
      buffer += done ? decoder.decode() : decoder.decode(value, { stream: true });
      buffer = buffer.replace(/\r\n/g, '\n');
      let boundary;
      while ((boundary = buffer.indexOf('\n\n')) !== -1) {
        event(buffer.slice(0, boundary)); buffer = buffer.slice(boundary + 2);
        if (doneEvent) break;
      }
      if (done) { if (buffer.trim() && !doneEvent) event(buffer); break; }
    }
    if (!doneEvent && !finishReason) throw new Error('Provider response ended unexpectedly. Please retry.');
    return { content, toolCalls: parseToolCalls([...calls.entries()].sort(([a], [b]) => a - b).map(([, call]) => call)), finishReason: finishReason || 'stop', usage };
  } finally { await reader.cancel().catch(() => {}); reader.releaseLock(); }
}
