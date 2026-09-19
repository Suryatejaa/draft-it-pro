import { test, describe, beforeEach, afterEach } from 'node:test';
import assert from 'node:assert/strict';

import { AiCreditManager } from '../lib/entitlements/credit-manager.ts';
import { InMemoryEntitlementStore } from '../lib/entitlements/store.ts';
import { resolveEntitlements } from '../lib/entitlements/resolver.ts';
import { executeHostedChat } from '../lib/ai/hosted-service.ts';

const originalPlatformKey = process.env.SARVAM_PLATFORM_API_KEY;

async function grant(store, userId, planId) {
  return store.grantPlan(userId, planId, `${userId}@test.local`, 'admin', 'admin@draftit.pro');
}

async function recordUsage(store, userId, requestId = `usage-${userId}`) {
  const manager = new AiCreditManager(store);
  const reservation = await manager.reserveCredit({ userId, requestId, model: 'sarvam-105b', maxTokens: 512 });
  await manager.commitCreditUsage({
    userId,
    requestId,
    model: 'sarvam-105b',
    provider: 'sarvam',
    promptTokens: 1000,
    completionTokens: 500,
    reservedPaise: reservation.reservedPaise,
  });
}

describe('AI credit plan-transition synchronization', () => {
  let store;

  beforeEach(() => {
    store = new InMemoryEntitlementStore();
    process.env.ADMIN_EMAILS = 'admin@draftit.pro';
    process.env.SARVAM_PLATFORM_API_KEY = 'platform-secret';
  });

  afterEach(() => {
    if (originalPlatformKey === undefined) delete process.env.SARVAM_PLATFORM_API_KEY;
    else process.env.SARVAM_PLATFORM_API_KEY = originalPlatformKey;
  });

  test('default Free -> admin grants Plus -> first hosted request succeeds', async () => {
    await grant(store, 'new-user', 'free');
    const freePeriod = await store.getCreditPeriod('new-user');
    assert.equal(freePeriod.budgetPaise, 0);

    await grant(store, 'new-user', 'plus');
    const plusPeriod = await store.getCreditPeriod('new-user');
    assert.equal(plusPeriod.budgetPaise, 5000);
    assert.equal(plusPeriod.consumedPaise, 0);
    assert.equal(plusPeriod.reservedPaise, 0);

    const result = await executeHostedChat(
      { requestId: 'first-plus-request', messages: [{ role: 'user', content: 'Hello' }] },
      { uid: 'new-user' },
      new AiCreditManager(store),
      async () => Response.json({ choices: [{ message: { content: 'ok' } }], usage: { prompt_tokens: 1, completion_tokens: 1 } }),
    );
    assert.equal(result.status, 200);
  });

  test('Free -> Plus repairs the active period to the effective 5000 paise allowance', async () => {
    await grant(store, 'free-to-plus', 'free');
    const before = await store.getCreditPeriod('free-to-plus');
    before.consumedPaise = 700;
    before.reservedPaise = 100;
    await store.saveCreditPeriod(before);

    await store.updateSubscription('free-to-plus', { planId: 'plus' }, 'admin', 'admin@draftit.pro');
    const after = await store.getCreditPeriod('free-to-plus');
    assert.equal(after.budgetPaise, 5000);
    assert.equal(after.consumedPaise, 700);
    assert.equal(after.reservedPaise, 100);
  });

  test('Plus -> AI Plus preserves consumed usage and expands allowance', async () => {
    await grant(store, 'plus-to-ai-plus', 'plus');
    await recordUsage(store, 'plus-to-ai-plus');
    const before = await store.getCreditPeriod('plus-to-ai-plus');

    await store.updateSubscription('plus-to-ai-plus', { planId: 'ai_plus' }, 'admin', 'admin@draftit.pro');
    const after = await store.getCreditPeriod('plus-to-ai-plus');
    assert.equal(after.budgetPaise, 20000);
    assert.equal(after.consumedPaise, before.consumedPaise);
  });

  test('AI Plus -> Plus preserves consumed usage and clamps remaining allowance', async () => {
    await grant(store, 'ai-plus-to-plus', 'ai_plus');
    const period = await store.getCreditPeriod('ai-plus-to-plus');
    period.consumedPaise = 6000;
    await store.saveCreditPeriod(period);

    await store.updateSubscription('ai-plus-to-plus', { planId: 'plus' }, 'admin', 'admin@draftit.pro');
    const after = await store.getCreditPeriod('ai-plus-to-plus');
    const entitlements = resolveEntitlements({
      user: { uid: 'ai-plus-to-plus', email: 'ai-plus-to-plus@test.local' },
      subscription: await store.getSubscription('ai-plus-to-plus'),
      planConfigs: await store.getPlanConfigs(),
      creditPeriod: after,
    });

    assert.equal(after.budgetPaise, 5000);
    assert.equal(after.consumedPaise, 6000);
    assert.equal(entitlements.aiCreditStatus.remainingPercent, 0);
  });

  test('paid -> Free blocks hosted AI without deleting usage history', async () => {
    await grant(store, 'paid-to-free', 'plus');
    await recordUsage(store, 'paid-to-free');
    const historyBefore = await store.getAiUsageHistory('paid-to-free');
    await store.updateSubscription('paid-to-free', { planId: 'free' }, 'admin', 'admin@draftit.pro');

    await assert.rejects(
      () => new AiCreditManager(store).reserveCredit({ userId: 'paid-to-free', requestId: 'blocked-free', model: 'sarvam-105b' }),
      /Hosted Sarvam AI credits require a Plus or AI Plus subscription/,
    );
    assert.equal((await store.getAiUsageHistory('paid-to-free')).length, historyBefore.length);
  });

  test('entitlement percentage and reservation availability use the same effective budget', async () => {
    await grant(store, 'invariant-user', 'free');
    await grant(store, 'invariant-user', 'plus');
    const subscription = await store.getSubscription('invariant-user');
    const period = await store.getCreditPeriod('invariant-user');
    const entitlements = resolveEntitlements({
      user: { uid: 'invariant-user', email: 'invariant-user@test.local' },
      subscription,
      planConfigs: await store.getPlanConfigs(),
      creditPeriod: period,
    });
    const reservation = await new AiCreditManager(store).reserveCredit({
      userId: 'invariant-user',
      requestId: 'invariant-request',
      model: 'sarvam-105b',
      maxTokens: 512,
    });

    assert.equal(period.budgetPaise, 5000);
    assert.equal(entitlements.aiCreditStatus.remainingPercent, 100);
    assert.ok(reservation.reservedPaise < period.budgetPaise);
  });
});
