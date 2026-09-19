import { test } from 'node:test';
import { strict as assert } from 'node:assert';
import { AgentOrchestrator } from '../lib/ai/orchestrator.ts';

test('Alternatives uses an isolated provider request without history or tools', async () => {
  const originalFetch = globalThis.fetch;
  let payload;
  globalThis.fetch = async (_input, init) => {
    payload = JSON.parse(init.body);
    const body = 'data: {"choices":[{"delta":{"content":"{\\"alternatives\\":[]}"},"finish_reason":"stop"}]}\n\ndata: [DONE]\n\n';
    return new Response(body, { status: 200, headers: { 'Content-Type': 'text/event-stream' } });
  };

  try {
    const orchestrator = new AgentOrchestrator({
      sarvam: { apiKey: 'test-key', model: 'sarvam-105b' },
      openaiCompatible: { name: 'Test', baseUrl: 'https://example.test/v1', apiKey: '', model: 'test' },
      activeProviderId: 'sarvam',
      routing: { primaryProviderId: 'sarvam', primaryModel: 'sarvam-105b', fallbacks: [] },
    });
    await orchestrator.stream({
      rootProject: { id: 'project-1', title: 'Test', scenes: [], acts: [] },
      activeView: 'Screenplay',
      currentSceneId: 'scene-1',
      selectedBlockIds: ['action-1'],
      selectedText: 'Original.',
      selectionBlockTypes: ['action'],
      sourceRevision: 'revision-a',
      history: [{ role: 'user', content: 'Earlier unrelated request.' }],
      userQuery: 'Return Alternatives JSON.',
      selectedModel: 'auto',
      maxTokens: 4096,
      diagnostics: { requestId: 'ALT-test', intent: 'alternatives', sourceBlocks: [{ id: 'action-1', type: 'action', text: 'Original.' }] },
    }, () => {});
    assert.equal(payload.messages.length, 2);
    assert.equal(payload.messages[0].role, 'system');
    assert.equal(payload.messages[1].content, 'Return Alternatives JSON.');
    assert.equal(payload.tools, undefined);
    assert.equal(payload.max_tokens, 4096);
    assert.equal(payload.messages.some((message) => message.content.includes('Earlier unrelated request.')), false);
  } finally {
    globalThis.fetch = originalFetch;
  }
});

test('multi-block structured requests are rejected before provider dispatch', async () => {
  const originalFetch = globalThis.fetch;
  let providerCalls = 0;
  globalThis.fetch = async () => { providerCalls += 1; throw new Error('provider should not be called'); };
  try {
    const orchestrator = new AgentOrchestrator({
      sarvam: { apiKey: 'test-key', model: 'sarvam-105b' },
      openaiCompatible: { name: 'Test', baseUrl: 'https://example.test/v1', apiKey: '', model: 'test' },
      activeProviderId: 'sarvam',
      routing: { primaryProviderId: 'sarvam', primaryModel: 'sarvam-105b', fallbacks: [] },
    });
    await assert.rejects(() => orchestrator.run({
      rootProject: { id: 'project-1', title: 'Test', scenes: [], acts: [] },
      activeView: 'Screenplay',
      currentSceneId: 'scene-1',
      userQuery: 'Return proposal JSON.',
      diagnostics: { requestId: 'multi-source', intent: 'alternatives', sourceBlocks: [
        { id: 'action-1', type: 'action', text: 'A.' },
        { id: 'dialogue-1', type: 'dialogue', text: 'B.' },
      ] },
    }), /exactly one editable/);
    assert.equal(providerCalls, 0);
  } finally {
    globalThis.fetch = originalFetch;
  }
});