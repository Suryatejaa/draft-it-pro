import { test, describe, beforeEach } from 'node:test';
import assert from 'node:assert/strict';

import { getFirebaseAdminDb } from '../lib/firebase-admin.ts';
import { FirestoreEntitlementStore } from '../lib/entitlements/firestore-store.ts';
import { DEFAULT_PLAN_CONFIGS } from '../lib/entitlements/plans.ts';

const db = getFirebaseAdminDb();
const suffix = `persistence-${Date.now()}`;
const admin = { uid: 'admin-persistence', email: 'admin@draftit.pro' };

async function grant(store, userId, planId) {
  return store.grantPlan(userId, planId, `${userId}@test.local`, admin.uid, admin.email);
}

describe('Firestore entitlement persistence', () => {
  beforeEach(() => {
    process.env.ADMIN_EMAILS = admin.email;
  });

  test('subscription and synchronized period survive store recreation', async () => {
    const userId = `${suffix}-plus`;
    const first = new FirestoreEntitlementStore(db);
    const subscription = await grant(first, userId, 'plus');
    const period = await first.getCreditPeriod(userId);
    period.consumedPaise = 125;
    period.reservedPaise = 40;
    await first.saveCreditPeriod(period);

    const recreated = new FirestoreEntitlementStore(db);
    assert.equal((await recreated.getSubscription(userId)).planId, 'plus');
    const persistedPeriod = await recreated.getCreditPeriod(userId);
    assert.equal(persistedPeriod.budgetPaise, 5000);
    assert.equal(persistedPeriod.consumedPaise, 125);
    assert.equal(persistedPeriod.reservedPaise, 40);
    assert.equal(persistedPeriod.periodEnd, subscription.currentPeriodEnd);
  });

  test('plan changes, suspension, extension, usage, plans, and discounts survive recreation', async () => {
    const userId = `${suffix}-transitions`;
    const first = new FirestoreEntitlementStore(db);
    await grant(first, userId, 'plus');
    const period = await first.getCreditPeriod(userId);
    period.consumedPaise = 750;
    await first.saveCreditPeriod(period);
    await first.appendAiUsage({
      id: `${suffix}-usage`, userId, requestId: `${suffix}-request`, provider: 'sarvam', model: 'sarvam-105b',
      promptTokens: 100, completionTokens: 50, totalTokens: 150, inputCostPaise: 1, outputCostPaise: 2,
      totalCostPaise: 3, billingPeriodKey: period.id, createdAt: new Date().toISOString(),
    });
    await first.updateSubscription(userId, { planId: 'ai_plus' }, admin.uid, admin.email);
    const aiPlus = await first.getCreditPeriod(userId);
    const beforeExtension = (await first.getSubscription(userId)).currentPeriodEnd;
    await first.extendSubscription(userId, 7, admin.uid, admin.email);
    await first.suspendUser(userId, admin.uid, admin.email);
    await first.updatePlanConfig('plus', { monthlyPricePaise: 81234 }, admin.uid, admin.email);
    await first.createDiscount({ name: `${suffix} discount`, type: 'percentage', value: 10, applicablePlanIds: ['plus'], startsAt: new Date().toISOString(), endsAt: new Date(Date.now() + 86400000).toISOString(), enabled: true }, admin.uid, admin.email);

    const recreated = new FirestoreEntitlementStore(db);
    const subscription = await recreated.getSubscription(userId);
    const persistedPeriod = await recreated.getCreditPeriod(userId);
    const history = await recreated.getAiUsageHistory(userId);
    const plans = await recreated.getPlanConfigs();
    const discounts = await recreated.getDiscounts();

    assert.equal(subscription.planId, 'ai_plus');
    assert.equal(subscription.status, 'suspended');
    assert.notEqual(subscription.currentPeriodEnd, beforeExtension);
    assert.equal(persistedPeriod.budgetPaise, 20000);
    assert.equal(persistedPeriod.consumedPaise, 750);
    assert.equal(history.length, 1);
    assert.equal(plans.plus.monthlyPricePaise, 81234);
    assert.ok(discounts.some((discount) => discount.name === `${suffix} discount`));
    assert.equal(aiPlus.consumedPaise, 750);
  });

  test('missing subscription is distinguishable from a Firestore read failure', async () => {
    const recreated = new FirestoreEntitlementStore(db);
    assert.equal(await recreated.getSubscription(`${suffix}-never-subscribed`), null);

    const failingDb = {
      collection() {
        return { doc() { return { get: async () => { throw new Error('Firestore unavailable'); } }; } };
      },
    };
    const failingStore = new FirestoreEntitlementStore(failingDb);
    await assert.rejects(() => failingStore.getSubscription(`${suffix}-read-failure`), /Firestore unavailable/);
  });
});
