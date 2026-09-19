import { test, describe, beforeEach, afterEach } from 'node:test';
import assert from 'node:assert/strict';

import { InMemoryEntitlementStore, setEntitlementStore } from '../lib/entitlements/store.ts';
import { AgentOrchestrator } from '../lib/ai/orchestrator.ts';
import { AiCreditManager } from '../lib/entitlements/credit-manager.ts';
import { executeHostedChat } from '../lib/ai/hosted-service.ts';
import { resolveEntitlements } from '../lib/entitlements/resolver.ts';
import { normalizeSarvamChatResponse } from '../lib/ai/providers/chat-transport.ts';
import { createScreenplayAlternatives, inspectAlternativeResponse } from '../lib/ai/screenplay-proposal.ts';

const originalFetch = globalThis.fetch;
const originalPlatformKey = process.env.SARVAM_PLATFORM_API_KEY;

async function grant(store, userId, planId, email = `${userId}@test.local`) {
  await store.grantPlan(userId, planId, email, 'admin', 'admin@draftit.pro');
}

describe('Hosted Co-Drafter routing', () => {
  let store;

  beforeEach(() => {
    store = new InMemoryEntitlementStore();
    setEntitlementStore(store);
    process.env.ADMIN_EMAILS = 'admin@draftit.pro';
    delete process.env.SARVAM_PLATFORM_API_KEY;
  });

  afterEach(() => {
    globalThis.fetch = originalFetch;
    if (originalPlatformKey === undefined) delete process.env.SARVAM_PLATFORM_API_KEY;
    else process.env.SARVAM_PLATFORM_API_KEY = originalPlatformKey;
  });

  test('Plus user does not need client provider settings and hosted request uses platform credential', async () => {
    await grant(store, 'user-plus', 'plus', 'plus@test.local');
    process.env.SARVAM_PLATFORM_API_KEY = 'platform-secret';
    let providerRequest;
    globalThis.fetch = async (_url, init) => {
      providerRequest = init;
      return Response.json({
        choices: [{ message: { content: 'hosted response' }, finish_reason: 'stop' }],
        usage: { prompt_tokens: 2, completion_tokens: 3 },
      });
    };

    const result = await executeHostedChat({ requestId: 'hosted-plus', model: 'client-overridden-model', apiKey: 'attacker-key', messages: [{ role: 'user', content: 'Hi' }] }, { uid: 'user-plus' }, new AiCreditManager(store));
    const data = result.body;

    assert.equal(result.status, 200);
    assert.equal(data.choices[0].message.content, 'hosted response');
    assert.match(providerRequest.headers.Authorization, /^Bearer platform-secret$/);
    assert.equal(providerRequest.headers.Authorization.includes('attacker-key'), false);
    const payload = JSON.parse(providerRequest.body);
    assert.equal(payload.model, 'sarvam-105b');
    assert.equal(JSON.stringify(data).includes('platform-secret'), false);
  });

  test('AI Plus user follows the same hosted path without provider settings', async () => {
    await grant(store, 'user-ai-plus', 'ai_plus', 'ai-plus@test.local');
    process.env.SARVAM_PLATFORM_API_KEY = 'platform-secret';
    globalThis.fetch = async () => Response.json({
      choices: [{ message: { content: 'ai plus response' }, finish_reason: 'stop' }],
      usage: { prompt_tokens: 1, completion_tokens: 1 },
    });

    const result = await executeHostedChat({ requestId: 'hosted-ai-plus' }, { uid: 'user-ai-plus' }, new AiCreditManager(store));
    assert.equal(result.status, 200);
    assert.equal(result.body.choices[0].message.content, 'ai plus response');
  });

  test('Free user is rejected before the platform key is used', async () => {
    await grant(store, 'user-free', 'free', 'free@test.local');
    process.env.SARVAM_PLATFORM_API_KEY = 'platform-secret';
    let called = false;
    globalThis.fetch = async () => { called = true; return Response.json({}); };

    const result = await executeHostedChat({ requestId: 'hosted-free' }, { uid: 'user-free' }, new AiCreditManager(store));
    const data = result.body;

    assert.equal(result.status, 403);
    assert.match(data.error, /upgrade your plan/i);
    assert.equal(called, false);
  });

  test('missing platform key fails safely without consuming or retaining credits', async () => {
    await grant(store, 'user-missing-key', 'plus', 'missing-key@test.local');
    const before = await store.getCreditPeriod('user-missing-key');
    const consumedBefore = before.consumedPaise;
    const reservedBefore = before.reservedPaise;

    const result = await executeHostedChat({ requestId: 'missing-platform-key' }, { uid: 'user-missing-key' }, new AiCreditManager(store));
    const data = result.body;
    const after = await store.getCreditPeriod('user-missing-key');

    assert.equal(result.status, 503);
    assert.equal(data.error, 'Co-Drafter is temporarily unavailable. Please try again shortly.');
    assert.equal(after.consumedPaise, consumedBefore);
    assert.equal(after.reservedPaise, reservedBefore);
  });

  test('upstream failure releases the reservation and returns a sanitized error', async () => {
    await grant(store, 'user-upstream', 'plus', 'upstream@test.local');
    process.env.SARVAM_PLATFORM_API_KEY = 'platform-secret';
    globalThis.fetch = async () => new Response('secret upstream body', { status: 500 });

    const result = await executeHostedChat({ requestId: 'upstream-failure' }, { uid: 'user-upstream' }, new AiCreditManager(store));
    const data = result.body;
    const period = await store.getCreditPeriod('user-upstream');

    assert.equal(result.status, 502);
    assert.equal(data.error, 'Hosted AI upstream service failed. Please try again shortly.');
    assert.equal(period.reservedPaise, 0);
    assert.equal(period.consumedPaise, 0);
    assert.equal(JSON.stringify(data).includes('secret upstream body'), false);
  });

  test('hosted orchestrator works with no client provider credential', async () => {
    let refreshes = 0;
    globalThis.fetch = async (_url, init) => {
      assert.equal(init.headers.Authorization, 'Bearer firebase-token');
      return new Response(JSON.stringify({
        choices: [{ message: { content: 'ok' }, finish_reason: 'stop' }],
        usage: { prompt_tokens: 1, completion_tokens: 1 },
      }), { status: 200, headers: { 'Content-Type': 'application/json', 'X-Hosted-Credit-Reconciled': 'true' } });
    };

    const response = await new AgentOrchestrator(undefined, 'firebase-token').run({
      rootProject: { scenes: [] },
      userQuery: 'Hello',
      activeView: 'Screenplay',
      onHostedRequestSettled: () => { refreshes += 1; },
    });

    assert.equal(response.providerId, 'sarvam');
    assert.equal(response.content, 'ok');
    assert.equal(refreshes, 1);
  });

  test('hosted orchestrator refreshes entitlements after a reconciled upstream failure', async () => {
    let refreshes = 0;
    globalThis.fetch = async () => new Response(
      JSON.stringify({ error: 'Hosted AI upstream service failed. Please try again shortly.' }),
      { status: 502, headers: { 'Content-Type': 'application/json', 'X-Hosted-Credit-Reconciled': 'true' } },
    );

    await assert.rejects(() => new AgentOrchestrator(undefined, 'firebase-token').run({
      rootProject: { scenes: [] },
      userQuery: 'Hello',
      activeView: 'Screenplay',
      onHostedRequestSettled: () => { refreshes += 1; },
    }), /Hosted AI upstream service failed/);
    assert.equal(refreshes, 1);
  });

  test('platform credential is absent from normal entitlement responses and admin BYOK stays separate', () => {
    process.env.SARVAM_PLATFORM_API_KEY = 'platform-secret';
    const normal = resolveEntitlements({ user: { uid: 'normal', email: 'normal@test.local' } });
    const admin = resolveEntitlements({ user: { uid: 'admin', email: 'admin@draftit.pro' } });

    assert.equal(JSON.stringify(normal).includes('platform-secret'), false);
    assert.equal(normal.canAccessByok, false);
    assert.equal(admin.canAccessByok, true);
  });

  test('hosted response normalization preserves three valid Alternatives', () => {
    const rawResponse = {
      id: 'chatcmpl-test',
      choices: [{
        index: 0,
        message: {
          role: 'assistant',
          content: JSON.stringify({ alternatives: [
            { operations: [{ operation: 'replace', sourceBlockId: 'action-1', type: 'action', text: 'She rises and walks toward the washroom.' }] },
            { operations: [{ operation: 'replace', sourceBlockId: 'action-1', type: 'action', text: 'She gets up, heading quietly toward the washroom.' }] },
            { operations: [{ operation: 'replace', sourceBlockId: 'action-1', type: 'action', text: 'She stands and moves toward the washroom.' }] },
          ] }),
        },
        finish_reason: 'stop',
      }],
      usage: { prompt_tokens: 10, completion_tokens: 40, total_tokens: 50 },
    };
    const normalized = normalizeSarvamChatResponse(rawResponse);
    const inspected = inspectAlternativeResponse(normalized.content);
    const alternatives = createScreenplayAlternatives(
      { sceneId: 'scene-1', selectedBlockIds: ['action-1'], selectedText: 'She walks.', blockTypes: ['action'], sourceRevision: 'rev-1' },
      [{ id: 'action-1', type: 'action', content: 'She walks.' }],
      inspected.parsed,
    );

    assert.equal(normalized.content.length > 0, true);
    assert.equal(normalized.toolCalls.length, 0);
    assert.equal(inspected.parsed.alternatives.length, 3);
    assert.equal(alternatives.candidates.length, 3);
    assert.deepEqual(alternatives.candidates.map((candidate) => candidate.operations[0].type), ['action', 'action', 'action']);
  });
});
