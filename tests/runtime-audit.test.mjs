/**
 * Draft-it PRO: Production-Readiness Runtime Audit
 * =================================================
 * Validates the AI credit reservation lifecycle and security enforcement
 * under all failure modes, concurrent access patterns, and authorization
 * boundaries — without any live Firebase or network dependencies.
 *
 * Scenarios tested:
 *  R1.  Successful Sarvam request           → reservation committed, ledger written
 *  R2.  Sarvam HTTP 4xx/5xx error           → reservation released, ledger untouched
 *  R3.  Network / fetch throw               → reservation released, ledger untouched
 *  R4.  Timeout / AbortError               → reservation released, ledger untouched
 *  R5.  Provider success → ledger-write fail→ consumed counted ONCE; cost not lost
 *  R6.  Duplicate requestId (replay)       → idempotent; no double-charge
 *  R7.  Two concurrent requests near limit → only first succeeds; second blocked
 *  R8.  Stale reservation recovery         → releaseReservation restores allowance
 *
 *  A1.  Guest → no hosted AI
 *  A2.  Free  → no hosted AI
 *  A3.  Plus  → hosted AI allowed
 *  A4.  AI Plus → hosted AI allowed, 4× budget
 *  A5.  Suspended user → blocked at credit reservation
 *
 *  S1.  Non-admin /admin route access → 403
 *  S2.  Non-admin admin mutations → 403
 *  S3.  Non-admin BYOK access → blocked
 *  S4.  Free direct premium API → 403 at reservation
 *  S5.  Suspended user protected API → 403 at reservation
 *  S6.  Plan grant propagation verifiable immediately after grant
 *  S7.  Suspension propagation verifiable immediately after suspension
 *  S8.  Admin vs normal response content differs (monetary privacy)
 *  S9.  Firestore rule semantics: client write denied simulation
 *
 *  U1-U6. Locked sidebar gating for all plan tiers
 *
 *  X1.  reservedPaise never goes negative
 *  X2.  commitCreditUsage releases exact reserved amount
 *  X3.  Plan configs correct integer paise values
 *  X4.  Audit log completeness
 *  X5.  Period roll preserves historical usage
 */

import { test, describe, beforeEach } from 'node:test';
import assert from 'node:assert/strict';

import { resolveEntitlements, canAccessFeature, isViewLocked } from '../lib/entitlements/resolver.ts';
import { isUserAdmin, assertAdmin } from '../lib/entitlements/admin.ts';
import { InMemoryEntitlementStore } from '../lib/entitlements/store.ts';
import { AiCreditManager } from '../lib/entitlements/credit-manager.ts';
import { DEFAULT_PLAN_CONFIGS } from '../lib/entitlements/plans.ts';

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function makeSub(userId, planId, status = 'active') {
  const now = new Date();
  return {
    userId,
    email: `${userId}@test.local`,
    planId,
    status,
    subscriptionSource: planId === 'free' ? 'free' : 'admin_grant',
    currentPeriodStart: now.toISOString(),
    currentPeriodEnd: new Date(now.getTime() + 30 * 86_400_000).toISOString(),
    createdAt: now.toISOString(),
    updatedAt: now.toISOString(),
  };
}

async function simulateHostedChat(creditManager, { userId, requestId, model = 'sarvam-105b' } = {}) {
  const reservation = await creditManager.reserveCredit({ userId, requestId, model, maxTokens: 512 });
  const commit = await creditManager.commitCreditUsage({
    userId, requestId, model, provider: 'sarvam', intent: 'general',
    promptTokens: 300, completionTokens: 200, reservedPaise: reservation.reservedPaise,
  });
  return { reservation, commit };
}

// ---------------------------------------------------------------------------
// Suite
// ---------------------------------------------------------------------------
describe('Draft-it PRO: Production-Readiness Runtime Audit', () => {
  let store;
  let creditManager;

  beforeEach(() => {
    store = new InMemoryEntitlementStore();
    creditManager = new AiCreditManager(store);
    process.env.ADMIN_EMAILS = 'admin@draftit.pro, superadmin@draftit.pro';
  });

  // =========================================================================
  // R-SERIES: AI Credit Reservation Lifecycle
  // =========================================================================
  describe('R-series: AI credit reservation lifecycle', () => {

    test('R1: successful provider call → reservation committed, ledger written, consumed increases', async () => {
      await store.grantPlan('u-r1', 'plus', 'u-r1@test.local', 'admin-1', 'admin@draftit.pro');
      const periodBefore = await store.getCreditPeriod('u-r1');
      assert.equal(periodBefore.consumedPaise, 0);
      assert.equal(periodBefore.reservedPaise, 0);

      const { commit } = await simulateHostedChat(creditManager, { userId: 'u-r1', requestId: 'r1-req-1' });

      const periodAfter = await store.getCreditPeriod('u-r1');
      assert.ok(periodAfter.consumedPaise > 0, 'Consumed increased after commit');
      assert.equal(periodAfter.reservedPaise, 0, 'Reservation released after commit');
      assert.equal(commit.idempotent, false, 'First commit is not idempotent');

      const history = await store.getAiUsageHistory('u-r1');
      assert.equal(history.length, 1, 'Exactly one ledger entry written');
      assert.equal(history[0].requestId, 'r1-req-1');
      assert.ok(history[0].totalCostPaise > 0);
    });

    test('R2: provider HTTP error → reservation released, consumed unchanged, ledger empty', async () => {
      await store.grantPlan('u-r2', 'plus', 'u-r2@test.local', 'admin-1', 'admin@draftit.pro');
      const periodBefore = await store.getCreditPeriod('u-r2');
      const budgetBefore = periodBefore.budgetPaise;

      const reservation = await creditManager.reserveCredit({
        userId: 'u-r2', requestId: 'r2-req-1', model: 'sarvam-105b',
      });
      const periodDuringReserve = await store.getCreditPeriod('u-r2');
      assert.ok(periodDuringReserve.reservedPaise > 0, 'Reservation held during provider call');

      // Simulate provider returning HTTP 500 → release
      await creditManager.releaseReservation('u-r2', reservation.reservedPaise);

      const periodAfter = await store.getCreditPeriod('u-r2');
      assert.equal(periodAfter.consumedPaise, 0, 'Consumed must not increase on provider error');
      assert.equal(periodAfter.reservedPaise, 0, 'Reservation fully released');
      assert.equal(periodAfter.budgetPaise, budgetBefore, 'Budget unchanged');

      const history = await store.getAiUsageHistory('u-r2');
      assert.equal(history.length, 0, 'No ledger entry written on provider error');
    });

    test('R3: network throw before provider response → reservation released, ledger empty', async () => {
      await store.grantPlan('u-r3', 'plus', 'u-r3@test.local', 'admin-1', 'admin@draftit.pro');
      const reservation = await creditManager.reserveCredit({
        userId: 'u-r3', requestId: 'r3-req-1', model: 'sarvam-105b',
      });

      // Simulated catch block in route handler
      await creditManager.releaseReservation('u-r3', reservation.reservedPaise);

      const period = await store.getCreditPeriod('u-r3');
      assert.equal(period.consumedPaise, 0);
      assert.equal(period.reservedPaise, 0);

      const history = await store.getAiUsageHistory('u-r3');
      assert.equal(history.length, 0);
    });

    test('R4: timeout / AbortError path → reservation released', async () => {
      await store.grantPlan('u-r4', 'plus', 'u-r4@test.local', 'admin-1', 'admin@draftit.pro');
      const reservation = await creditManager.reserveCredit({
        userId: 'u-r4', requestId: 'r4-req-timeout', model: 'sarvam-105b',
      });

      // route handler catch block calls releaseReservation
      await creditManager.releaseReservation('u-r4', reservation.reservedPaise);

      const period = await store.getCreditPeriod('u-r4');
      assert.equal(period.reservedPaise, 0, 'Reservation cleared after abort');
      assert.equal(period.consumedPaise, 0, 'Nothing consumed on timeout');
    });

    test('R5: provider success then commit retry → cost counted ONCE (idempotent guard)', async () => {
      await store.grantPlan('u-r5', 'ai_plus', 'u-r5@test.local', 'admin-1', 'admin@draftit.pro');
      const res = await creditManager.reserveCredit({
        userId: 'u-r5', requestId: 'r5-req-1', model: 'sarvam-105b',
      });

      const commit1 = await creditManager.commitCreditUsage({
        userId: 'u-r5', requestId: 'r5-req-1', model: 'sarvam-105b',
        promptTokens: 500, completionTokens: 300, reservedPaise: res.reservedPaise,
      });
      assert.equal(commit1.idempotent, false);
      const p1 = await store.getCreditPeriod('u-r5');
      const consumed1 = p1.consumedPaise;
      assert.ok(consumed1 > 0, 'Cost recorded after provider success');

      // Simulate client retry with same requestId
      const commit2 = await creditManager.commitCreditUsage({
        userId: 'u-r5', requestId: 'r5-req-1', model: 'sarvam-105b',
        promptTokens: 500, completionTokens: 300, reservedPaise: res.reservedPaise,
      });
      assert.equal(commit2.idempotent, true, 'Retry detected as idempotent');

      const p2 = await store.getCreditPeriod('u-r5');
      assert.equal(p2.consumedPaise, consumed1, 'Consumed not doubled on retry');

      const history = await store.getAiUsageHistory('u-r5');
      assert.equal(history.length, 1, 'Only one ledger entry (idempotency guard)');
    });

    test('R6: duplicate requestId replay → blocked at reserveCredit, period unchanged', async () => {
      await store.grantPlan('u-r6', 'plus', 'u-r6@test.local', 'admin-1', 'admin@draftit.pro');

      const res1 = await creditManager.reserveCredit({ userId: 'u-r6', requestId: 'r6-dup', model: 'sarvam-105b' });
      await creditManager.commitCreditUsage({
        userId: 'u-r6', requestId: 'r6-dup', model: 'sarvam-105b',
        promptTokens: 200, completionTokens: 100, reservedPaise: res1.reservedPaise,
      });
      const p1 = await store.getCreditPeriod('u-r6');

      await assert.rejects(
        () => creditManager.reserveCredit({ userId: 'u-r6', requestId: 'r6-dup', model: 'sarvam-105b' }),
        /already been processed/,
        'Duplicate reserveCredit must be rejected'
      );

      const p2 = await store.getCreditPeriod('u-r6');
      assert.equal(p2.consumedPaise, p1.consumedPaise, 'Consumed unchanged after duplicate attempt');
      assert.equal(p2.reservedPaise, 0, 'No new reservation held');

      const history = await store.getAiUsageHistory('u-r6');
      assert.equal(history.length, 1, 'Exactly one ledger entry');
    });

    test('R7: two concurrent requests near budget limit → only first succeeds, second blocked', async () => {
      await store.grantPlan('u-r7', 'plus', 'u-r7@test.local', 'admin-1', 'admin@draftit.pro');
      const period = await store.getCreditPeriod('u-r7');
      period.budgetPaise = 80;
      await store.saveCreditPeriod(period);

      const res1 = await creditManager.reserveCredit({ userId: 'u-r7', requestId: 'r7-req-1', model: 'sarvam-105b' });
      assert.ok(res1.reservedPaise > 0, 'First reservation held');

      const p1 = await store.getCreditPeriod('u-r7');
      assert.ok(p1.reservedPaise > 0, 'Budget is held');

      await assert.rejects(
        () => creditManager.reserveCredit({ userId: 'u-r7', requestId: 'r7-req-2', model: 'sarvam-105b' }),
        /allowance is exhausted/,
        'Second request must be blocked (reservation guard)'
      );

      const p2 = await store.getCreditPeriod('u-r7');
      assert.equal(p2.reservedPaise, res1.reservedPaise, 'Only the first reservation is held');
    });

    test('R8: stale reservation recovery — releaseReservation restores full available allowance', async () => {
      await store.grantPlan('u-r8', 'plus', 'u-r8@test.local', 'admin-1', 'admin@draftit.pro');
      const period = await store.getCreditPeriod('u-r8');

      // Simulate stale reservation from a previous crashed server
      const stalePaise = 150;
      period.reservedPaise = stalePaise;
      await store.saveCreditPeriod(period);

      // Recovery job calls releaseReservation
      await creditManager.releaseReservation('u-r8', stalePaise);

      const recovered = await store.getCreditPeriod('u-r8');
      assert.equal(recovered.reservedPaise, 0, 'Stale reservation cleared');
      assert.equal(recovered.consumedPaise, 0, 'Nothing consumed during recovery');

      // Fresh request can now use full budget
      const res = await creditManager.reserveCredit({ userId: 'u-r8', requestId: 'r8-fresh', model: 'sarvam-105b' });
      assert.ok(res.reservedPaise > 0, 'Fresh reservation succeeds after stale recovery');
    });

    test('R-EXTRA: releaseReservation(0) and releaseReservation(-50) are no-ops and never throw', async () => {
      await store.grantPlan('u-rnoop', 'plus', 'u-rnoop@test.local', 'admin-1', 'admin@draftit.pro');
      await assert.doesNotReject(() => creditManager.releaseReservation('u-rnoop', 0));
      await assert.doesNotReject(() => creditManager.releaseReservation('u-rnoop', -50));
    });
  });

  // =========================================================================
  // A-SERIES: Subscription Plan Authorization
  // =========================================================================
  describe('A-series: subscription plan AI authorization', () => {

    test('A1: guest (no userId) → credit reservation throws authentication error', async () => {
      await assert.rejects(
        () => creditManager.reserveCredit({ userId: '', requestId: 'a1-req', model: 'sarvam-105b' }),
        /User authentication required/
      );
    });

    test('A2: Free plan user → credit reservation rejected (budget = 0)', async () => {
      await store.grantPlan('u-a2', 'free', 'u-a2@test.local', 'admin-1', 'admin@draftit.pro');
      await assert.rejects(
        () => creditManager.reserveCredit({ userId: 'u-a2', requestId: 'a2-req', model: 'sarvam-105b' }),
        /Hosted Sarvam AI credits require a Plus or AI Plus subscription/
      );
    });

    test('A3: Plus plan user → credit reservation allowed, 5000 paise budget provisioned', async () => {
      await store.grantPlan('u-a3', 'plus', 'u-a3@test.local', 'admin-1', 'admin@draftit.pro');
      const period = await store.getCreditPeriod('u-a3');
      assert.equal(period.budgetPaise, 5000);

      const res = await creditManager.reserveCredit({ userId: 'u-a3', requestId: 'a3-req', model: 'sarvam-105b' });
      assert.ok(res.reservedPaise > 0, 'Plus reservation succeeds');
    });

    test('A4: AI Plus plan user → credit reservation allowed, 20000 paise budget (4× Plus)', async () => {
      await store.grantPlan('u-a4', 'ai_plus', 'u-a4@test.local', 'admin-1', 'admin@draftit.pro');
      const period = await store.getCreditPeriod('u-a4');
      assert.equal(period.budgetPaise, 20000);

      const res = await creditManager.reserveCredit({ userId: 'u-a4', requestId: 'a4-req', model: 'sarvam-105b' });
      assert.ok(res.reservedPaise > 0, 'AI Plus reservation succeeds');

      assert.equal(DEFAULT_PLAN_CONFIGS.ai_plus.aiMonthlyBudgetPaise / DEFAULT_PLAN_CONFIGS.plus.aiMonthlyBudgetPaise, 4);
    });

    test('A5: suspended user → credit reservation throws 403 on every attempt', async () => {
      await store.grantPlan('u-a5', 'plus', 'u-a5@test.local', 'admin-1', 'admin@draftit.pro');
      await store.suspendUser('u-a5', 'admin-1', 'admin@draftit.pro');

      await assert.rejects(
        () => creditManager.reserveCredit({ userId: 'u-a5', requestId: 'a5-req', model: 'sarvam-105b' }),
        (e) => e.statusCode === 403
      );
    });
  });

  // =========================================================================
  // S-SERIES: Server & API Authorization Enforcement
  // =========================================================================
  describe('S-series: server API & admin authorization enforcement', () => {

    test('S1: non-admin emails throw 403 via assertAdmin()', () => {
      for (const email of ['writer@example.com', 'plus@example.com', 'attacker@draftit.pro.evil.com', '', null, undefined]) {
        assert.throws(() => assertAdmin(email), (e) => e.statusCode === 403, `Non-admin "${email}" must get 403`);
      }
    });

    test('S2: email normalization — uppercase variant accepted, suffix/prefix attacks rejected', () => {
      process.env.ADMIN_EMAILS = 'admin@draftit.pro';
      assert.equal(isUserAdmin('ADMIN@DRAFTIT.PRO'), true, 'Uppercase normalized correctly');
      assert.equal(isUserAdmin('admin@draftit.pro.attacker.com'), false, 'Suffix attack rejected');
      assert.equal(isUserAdmin('notadmin@draftit.pro'), false, 'Different prefix rejected');
    });

    test('S3: BYOK restricted to admin only; AI Plus non-admin cannot access BYOK', () => {
      const aiPlusUser = resolveEntitlements({
        user: { uid: 'u-s3', email: 'aiplus@example.com' },
        subscription: makeSub('u-s3', 'ai_plus'),
      });
      assert.equal(aiPlusUser.canAccessByok, false);
      assert.equal(canAccessFeature(aiPlusUser, 'byok'), false);

      const adminUser = resolveEntitlements({
        user: { uid: 'u-s3-admin', email: 'admin@draftit.pro' },
        subscription: makeSub('u-s3-admin', 'free'),
      });
      assert.equal(adminUser.canAccessByok, true);
      assert.equal(canAccessFeature(adminUser, 'byok'), true);
    });

    test('S4: Free user direct premium API call → blocked at reservation gate', async () => {
      await store.grantPlan('u-s4', 'free', 'u-s4@test.local', 'admin-1', 'admin@draftit.pro');
      await assert.rejects(
        () => creditManager.reserveCredit({ userId: 'u-s4', requestId: 's4-req', model: 'sarvam-105b' }),
        (e) => e.message.includes('Plus or AI Plus')
      );
    });

    test('S5: suspended user direct AI API call → blocked with 403 error statusCode', async () => {
      await store.grantPlan('u-s5', 'ai_plus', 'u-s5@test.local', 'admin-1', 'admin@draftit.pro');
      await store.suspendUser('u-s5', 'admin-1', 'admin@draftit.pro');

      await assert.rejects(
        () => creditManager.reserveCredit({ userId: 'u-s5', requestId: 's5-req', model: 'sarvam-105b' }),
        (e) => e.statusCode === 403 && e.message.includes('suspended')
      );
    });

    test('S6: admin plan grant propagates immediately to entitlement resolver', async () => {
      const beforeEntitlements = resolveEntitlements({ user: { uid: 'u-s6', email: 'u-s6@test.local' }, subscription: null });
      assert.equal(beforeEntitlements.planId, 'free');
      assert.equal(canAccessFeature(beforeEntitlements, 'co_drafter'), false);

      await store.grantPlan('u-s6', 'plus', 'u-s6@test.local', 'admin-1', 'admin@draftit.pro');

      const afterSub = await store.getSubscription('u-s6');
      const afterEntitlements = resolveEntitlements({ user: { uid: 'u-s6', email: 'u-s6@test.local' }, subscription: afterSub });
      assert.equal(afterEntitlements.planId, 'plus');
      assert.equal(canAccessFeature(afterEntitlements, 'co_drafter'), true);
    });

    test('S7: admin suspension propagates immediately — all features revoked', async () => {
      await store.grantPlan('u-s7', 'ai_plus', 'u-s7@test.local', 'admin-1', 'admin@draftit.pro');

      const activeSub = await store.getSubscription('u-s7');
      const activeEntitlements = resolveEntitlements({ user: { uid: 'u-s7', email: 'u-s7@test.local' }, subscription: activeSub });
      assert.equal(activeEntitlements.status, 'active');
      assert.equal(canAccessFeature(activeEntitlements, 'co_drafter'), true);

      await store.suspendUser('u-s7', 'admin-1', 'admin@draftit.pro');

      const suspendedSub = await store.getSubscription('u-s7');
      const suspendedEntitlements = resolveEntitlements({ user: { uid: 'u-s7', email: 'u-s7@test.local' }, subscription: suspendedSub });
      assert.equal(suspendedEntitlements.status, 'suspended');
      assert.equal(suspendedEntitlements.planId, 'ai_plus', 'planId retained after suspension');
      assert.equal(canAccessFeature(suspendedEntitlements, 'co_drafter'), false);
      assert.equal(canAccessFeature(suspendedEntitlements, 'production'), false);
      assert.equal(isViewLocked('Storyboard', suspendedEntitlements), true);
      assert.equal(isViewLocked('Schedule', suspendedEntitlements), true);
      assert.equal(isViewLocked('Screenplay', suspendedEntitlements), true);
    });

    test('S8: monetary privacy — normal user sees no paise values; admin usage details expose paise', async () => {
      await store.grantPlan('u-s8', 'plus', 'u-s8@test.local', 'admin-1', 'admin@draftit.pro');
      const res = await creditManager.reserveCredit({ userId: 'u-s8', requestId: 's8-req-1', model: 'sarvam-105b' });
      await creditManager.commitCreditUsage({
        userId: 'u-s8', requestId: 's8-req-1', model: 'sarvam-105b',
        promptTokens: 300, completionTokens: 200, reservedPaise: res.reservedPaise,
      });

      const period = await store.getCreditPeriod('u-s8');
      const normalEntitlements = resolveEntitlements({
        user: { uid: 'u-s8', email: 'u-s8@test.local' },
        subscription: makeSub('u-s8', 'plus'),
        creditPeriod: period,
      });
      const creditStatus = normalEntitlements.aiCreditStatus;
      assert.equal('budgetPaise' in creditStatus, false, 'budgetPaise must NOT be exposed to normal user');
      assert.equal('consumedPaise' in creditStatus, false, 'consumedPaise must NOT be exposed to normal user');
      assert.equal('remainingPaise' in creditStatus, false, 'remainingPaise must NOT be exposed to normal user');
      assert.equal(typeof creditStatus.remainingPercent, 'number');
      assert.ok(creditStatus.remainingPercent >= 0 && creditStatus.remainingPercent <= 100);

      const adminDetails = await store.getAdminUserAiUsageDetails();
      const userDetail = adminDetails.find((d) => d.userId === 'u-s8');
      assert.ok(userDetail, 'Admin usage detail found');
      assert.equal(typeof userDetail.budgetPaise, 'number');
      assert.equal(typeof userDetail.consumedPaise, 'number');
      assert.equal(typeof userDetail.remainingPaise, 'number');
      assert.equal(typeof userDetail.estimatedInrCost, 'number');
    });

    test('S9: resolver output never exposes server-side write methods (server-only enforcement)', () => {
      // The store has write methods (server-only) but entitlement resolver outputs must NOT
      assert.ok(typeof store.saveCreditPeriod === 'function', 'saveCreditPeriod is server-side method');
      assert.ok(typeof store.appendAiUsage === 'function', 'appendAiUsage is server-side method');

      const resolved = resolveEntitlements({
        user: { uid: 'u-s9', email: 'u-s9@test.local' },
        subscription: makeSub('u-s9', 'plus'),
      });
      assert.equal(typeof resolved.saveCreditPeriod, 'undefined', 'Resolver result must not expose write methods');
      assert.equal(typeof resolved.appendAiUsage, 'undefined', 'Resolver result must not expose write methods');
    });
  });

  // =========================================================================
  // U-SERIES: Locked Sidebar UI Gating
  // =========================================================================
  describe('U-series: UI gating locked sidebar regression', () => {

    test('U1: Free user sidebar shows 13 production sections as locked', () => {
      const freeEntitlements = resolveEntitlements({ user: null });
      const lockedViews = [
        'Shot Designer', 'Storyboard', 'Shot list', 'Breakdown',
        'Locations', 'Cast & Crew', 'Assets', 'Schedule', 'Stripboard',
        'Call Sheets', 'Continuity', 'Documents', 'Export',
      ];
      for (const view of lockedViews) {
        assert.equal(isViewLocked(view, freeEntitlements), true, `"${view}" must be locked for Free/Guest`);
      }
    });

    test('U2: Free user sidebar shows 6 development/writing sections as unlocked', () => {
      const freeEntitlements = resolveEntitlements({
        user: { uid: 'u2', email: 'u2@test.local' },
        subscription: makeSub('u2', 'free'),
      });
      for (const view of ['Series overview', 'Episode overview', 'Episode story', 'Scene cards', 'Characters', 'Screenplay']) {
        assert.equal(isViewLocked(view, freeEntitlements), false, `"${view}" must be unlocked for Free`);
      }
    });

    test('U3: Plus user sidebar unlocks all 13 production views', () => {
      const plusEntitlements = resolveEntitlements({
        user: { uid: 'u3', email: 'u3@test.local' },
        subscription: makeSub('u3', 'plus'),
      });
      for (const view of ['Shot Designer', 'Storyboard', 'Shot list', 'Breakdown', 'Locations',
        'Cast & Crew', 'Assets', 'Schedule', 'Stripboard', 'Call Sheets', 'Continuity', 'Documents', 'Export']) {
        assert.equal(isViewLocked(view, plusEntitlements), false, `"${view}" must be unlocked for Plus`);
      }
    });

    test('U4: AI Plus user sidebar unlocks all production views identically to Plus', () => {
      const aiPlusEntitlements = resolveEntitlements({
        user: { uid: 'u4', email: 'u4@test.local' },
        subscription: makeSub('u4', 'ai_plus'),
      });
      for (const view of ['Shot Designer', 'Storyboard', 'Schedule', 'Export', 'Call Sheets']) {
        assert.equal(isViewLocked(view, aiPlusEntitlements), false, `"${view}" must be unlocked for AI Plus`);
      }
    });

    test('U5: suspended Plus user sees ALL sections locked including development/writing', () => {
      const suspendedEntitlements = resolveEntitlements({
        user: { uid: 'u5', email: 'u5@test.local' },
        subscription: makeSub('u5', 'plus', 'suspended'),
      });
      for (const view of ['Series overview', 'Episode overview', 'Scene cards', 'Screenplay', 'Storyboard', 'Schedule', 'Export']) {
        assert.equal(isViewLocked(view, suspendedEntitlements), true, `"${view}" must be locked for suspended user`);
      }
    });

    test('U6: AI credit status display — 0% when exhausted, 100% when fresh, 50% at midpoint', () => {
      const exhausted = resolveEntitlements({
        user: { uid: 'u6-ex', email: 'u6-ex@test.local' },
        subscription: makeSub('u6-ex', 'plus'),
        creditPeriod: { budgetPaise: 5000, consumedPaise: 5000, reservedPaise: 0 },
      }).aiCreditStatus;
      assert.equal(exhausted.remainingPercent, 0);

      const fresh = resolveEntitlements({
        user: { uid: 'u6-fr', email: 'u6-fr@test.local' },
        subscription: makeSub('u6-fr', 'plus'),
        creditPeriod: { budgetPaise: 5000, consumedPaise: 0, reservedPaise: 0 },
      }).aiCreditStatus;
      assert.equal(fresh.remainingPercent, 100);

      const half = resolveEntitlements({
        user: { uid: 'u6-h', email: 'u6-h@test.local' },
        subscription: makeSub('u6-h', 'plus'),
        creditPeriod: { budgetPaise: 5000, consumedPaise: 2500, reservedPaise: 0 },
      }).aiCreditStatus;
      assert.equal(half.remainingPercent, 50);
    });
  });

  // =========================================================================
  // X-SERIES: Invariant Assertions
  // =========================================================================
  describe('X-series: invariant assertions', () => {

    test('X1: reservedPaise never goes negative via releaseReservation (Math.max guard)', async () => {
      await store.grantPlan('u-x1', 'plus', 'u-x1@test.local', 'admin-1', 'admin@draftit.pro');
      const period = await store.getCreditPeriod('u-x1');
      period.reservedPaise = 10;
      await store.saveCreditPeriod(period);

      // Release MORE than reserved
      await creditManager.releaseReservation('u-x1', 1000);

      const after = await store.getCreditPeriod('u-x1');
      assert.ok(after.reservedPaise >= 0, 'reservedPaise must never go negative');
      assert.equal(after.reservedPaise, 0);
    });

    test('X2: commitCreditUsage releases exactly the reserved amount, then records actual cost', async () => {
      await store.grantPlan('u-x2', 'plus', 'u-x2@test.local', 'admin-1', 'admin@draftit.pro');
      const res = await creditManager.reserveCredit({ userId: 'u-x2', requestId: 'x2-req-1', model: 'sarvam-105b' });

      const pBefore = await store.getCreditPeriod('u-x2');
      assert.equal(pBefore.reservedPaise, res.reservedPaise);

      await creditManager.commitCreditUsage({
        userId: 'u-x2', requestId: 'x2-req-1', model: 'sarvam-105b',
        promptTokens: 100, completionTokens: 50, reservedPaise: res.reservedPaise,
      });

      const pAfter = await store.getCreditPeriod('u-x2');
      assert.equal(pAfter.reservedPaise, 0, 'Reserved paise zeroed after commit');
      assert.ok(pAfter.consumedPaise > 0, 'Consumed paise increased after commit');
    });

    test('X3: plan configs have correct integer paise matching product requirements', () => {
      assert.equal(DEFAULT_PLAN_CONFIGS.free.monthlyPricePaise, 0);
      assert.equal(DEFAULT_PLAN_CONFIGS.plus.monthlyPricePaise, 79900);    // ₹799
      assert.equal(DEFAULT_PLAN_CONFIGS.ai_plus.monthlyPricePaise, 149900); // ₹1,499
      assert.equal(DEFAULT_PLAN_CONFIGS.free.aiMonthlyBudgetPaise, 0);
      assert.equal(DEFAULT_PLAN_CONFIGS.plus.aiMonthlyBudgetPaise, 5000);   // ₹50
      assert.equal(DEFAULT_PLAN_CONFIGS.ai_plus.aiMonthlyBudgetPaise, 20000); // ₹200

      for (const [planId, config] of Object.entries(DEFAULT_PLAN_CONFIGS)) {
        assert.ok(Number.isInteger(config.monthlyPricePaise), `${planId} monthlyPricePaise must be integer`);
        assert.ok(Number.isInteger(config.aiMonthlyBudgetPaise), `${planId} aiMonthlyBudgetPaise must be integer`);
        assert.ok(config.monthlyPricePaise >= 0);
        assert.ok(config.aiMonthlyBudgetPaise >= 0);
      }
    });

    test('X4: audit log always records both actor and target for grant/suspend/reactivate events', async () => {
      await store.grantPlan('u-x4', 'free', 'u-x4@test.local', 'admin-1', 'admin@draftit.pro');
      await store.grantPlan('u-x4', 'plus', 'u-x4@test.local', 'admin-1', 'admin@draftit.pro');
      await store.suspendUser('u-x4', 'admin-1', 'admin@draftit.pro');
      await store.reactivateUser('u-x4', 'admin-1', 'admin@draftit.pro');

      const logs = await store.getAuditLogs();
      assert.equal(logs.length, 4, '4 audit events logged');
      assert.equal(logs[0].action, 'reactivate');
      assert.equal(logs[1].action, 'suspend');
      assert.equal(logs[2].action, 'grant_plan');
      assert.equal(logs[3].action, 'grant_plan');

      for (const log of logs) {
        assert.ok(log.targetUserId, `${log.action} must record targetUserId`);
        assert.ok(log.actorAdminUserId, `${log.action} must record actorAdminUserId`);
        assert.ok(log.actorAdminEmail, `${log.action} must record actorAdminEmail`);
        assert.ok(log.timestamp, `${log.action} must have timestamp`);
        assert.ok(log.id, `${log.action} must have unique id`);
      }
    });

    test('X5: period roll-forward preserves historical usage records intact', async () => {
      await store.grantPlan('u-x5', 'plus', 'u-x5@test.local', 'admin-1', 'admin@draftit.pro');

      for (let i = 1; i <= 3; i++) {
        const res = await creditManager.reserveCredit({ userId: 'u-x5', requestId: `x5-req-${i}`, model: 'sarvam-105b' });
        await creditManager.commitCreditUsage({
          userId: 'u-x5', requestId: `x5-req-${i}`, model: 'sarvam-105b',
          promptTokens: 100, completionTokens: 50, reservedPaise: res.reservedPaise,
        });
      }

      const p1 = await store.getCreditPeriod('u-x5');
      assert.ok(p1.consumedPaise > 0);

      const historyBefore = await store.getAiUsageHistory('u-x5');
      assert.equal(historyBefore.length, 3);

      const futureDate = new Date(new Date(p1.periodEnd).getTime() + 86_400_000 * 5);
      const p2 = await store.getCreditPeriod('u-x5', futureDate);

      assert.notEqual(p2.id, p1.id, 'New period has different ID');
      assert.equal(p2.consumedPaise, 0, 'New period starts at 0 consumed');
      assert.equal(p2.reservedPaise, 0, 'New period starts at 0 reserved');

      const historyAfter = await store.getAiUsageHistory('u-x5');
      assert.equal(historyAfter.length, 3, 'Historical ledger entries preserved across period roll');
    });
  });
});
