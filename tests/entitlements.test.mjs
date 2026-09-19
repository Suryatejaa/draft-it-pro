import { test, describe, beforeEach } from 'node:test';
import assert from 'node:assert/strict';

import {
  DEFAULT_PLAN_CONFIGS,
  validateDiscount,
  calculateEffectivePricePaise,
} from '../lib/entitlements/plans.ts';
import {
  getAdminEmails,
  isUserAdmin,
  assertAdmin,
} from '../lib/entitlements/admin.ts';
import {
  calculateModelCostPaise,
  estimateReservationCostPaise,
} from '../lib/entitlements/pricing.ts';
import {
  resolveEntitlements,
  canAccessFeature,
  requireFeature,
  isAdmin,
  getAiCreditStatus,
  isViewLocked,
  VIEW_TO_FEATURE_MAP,
} from '../lib/entitlements/resolver.ts';
import {
  InMemoryEntitlementStore,
} from '../lib/entitlements/store.ts';
import {
  AiCreditManager,
} from '../lib/entitlements/credit-manager.ts';

describe('Draft-it PRO Entitlement System & Admin Dashboard Tests', () => {
  let store;
  let creditManager;

  beforeEach(() => {
    store = new InMemoryEntitlementStore();
    creditManager = new AiCreditManager(store);
    process.env.ADMIN_EMAILS = 'admin@example.com, superuser@draftit.pro ';
  });

  // =========================================================================
  // 1. AUTHORIZATION TESTS
  // =========================================================================
  describe('Authorization', () => {
    test('guest receives Free feature entitlement', () => {
      const guestEntitlements = resolveEntitlements({ user: null });
      assert.equal(guestEntitlements.isGuest, true);
      assert.equal(guestEntitlements.isAuthenticated, false);
      assert.equal(guestEntitlements.planId, 'free');
      assert.equal(guestEntitlements.canAccessByok, false);
      assert.equal(guestEntitlements.canAccessAdmin, false);
      assert.deepEqual(guestEntitlements.features, ['workspace', 'development', 'writing']);
    });

    test('authenticated user without subscription defaults to Free', () => {
      const userEntitlements = resolveEntitlements({
        user: { uid: 'user-1', email: 'writer@example.com' },
        subscription: null,
      });
      assert.equal(userEntitlements.isGuest, false);
      assert.equal(userEntitlements.isAuthenticated, true);
      assert.equal(userEntitlements.planId, 'free');
      assert.equal(userEntitlements.canAccessByok, false);
      assert.equal(userEntitlements.canAccessAdmin, false);
    });

    test('Free accessible sections allowed', () => {
      const freeEntitlements = resolveEntitlements({
        user: { uid: 'user-1', email: 'writer@example.com' },
        subscription: {
          userId: 'user-1',
          planId: 'free',
          status: 'active',
          subscriptionSource: 'free',
          currentPeriodStart: new Date().toISOString(),
          currentPeriodEnd: new Date(Date.now() + 30 * 86400000).toISOString(),
          createdAt: new Date().toISOString(),
          updatedAt: new Date().toISOString(),
        },
      });

      assert.equal(canAccessFeature(freeEntitlements, 'workspace'), true);
      assert.equal(canAccessFeature(freeEntitlements, 'development'), true);
      assert.equal(canAccessFeature(freeEntitlements, 'writing'), true);

      assert.equal(isViewLocked('Series overview', freeEntitlements), false);
      assert.equal(isViewLocked('Episode overview', freeEntitlements), false);
      assert.equal(isViewLocked('Episode story', freeEntitlements), false);
      assert.equal(isViewLocked('Scene cards', freeEntitlements), false);
      assert.equal(isViewLocked('Characters', freeEntitlements), false);
      assert.equal(isViewLocked('Screenplay', freeEntitlements), false);
    });

    test('Free premium sections denied', () => {
      const freeEntitlements = resolveEntitlements({
        user: { uid: 'user-1', email: 'writer@example.com' },
      });

      assert.equal(canAccessFeature(freeEntitlements, 'visual_planning'), false);
      assert.equal(canAccessFeature(freeEntitlements, 'production'), false);
      assert.equal(canAccessFeature(freeEntitlements, 'shoot'), false);
      assert.equal(canAccessFeature(freeEntitlements, 'project_tools'), false);
      assert.equal(canAccessFeature(freeEntitlements, 'co_drafter'), false);

      // Views
      assert.equal(isViewLocked('Stripboard', freeEntitlements), true);
      assert.equal(isViewLocked('Schedule', freeEntitlements), true);
      assert.equal(isViewLocked('Locations', freeEntitlements), true);
      assert.equal(isViewLocked('Cast & Crew', freeEntitlements), true);
      assert.equal(isViewLocked('Call Sheets', freeEntitlements), true);
      assert.equal(isViewLocked('Storyboard', freeEntitlements), true);
      assert.equal(isViewLocked('Shot Designer', freeEntitlements), true);
      assert.equal(isViewLocked('Export', freeEntitlements), true);

      assert.throws(() => requireFeature(freeEntitlements, 'shoot'), /Access denied/);
    });

    test('Plus all normal sections allowed', () => {
      const plusEntitlements = resolveEntitlements({
        user: { uid: 'user-plus', email: 'plus@example.com' },
        subscription: {
          userId: 'user-plus',
          planId: 'plus',
          status: 'active',
          subscriptionSource: 'admin_grant',
          currentPeriodStart: new Date().toISOString(),
          currentPeriodEnd: new Date(Date.now() + 30 * 86400000).toISOString(),
          createdAt: new Date().toISOString(),
          updatedAt: new Date().toISOString(),
        },
      });

      assert.equal(canAccessFeature(plusEntitlements, 'workspace'), true);
      assert.equal(canAccessFeature(plusEntitlements, 'development'), true);
      assert.equal(canAccessFeature(plusEntitlements, 'writing'), true);
      assert.equal(canAccessFeature(plusEntitlements, 'visual_planning'), true);
      assert.equal(canAccessFeature(plusEntitlements, 'production'), true);
      assert.equal(canAccessFeature(plusEntitlements, 'shoot'), true);
      assert.equal(canAccessFeature(plusEntitlements, 'project_tools'), true);
      assert.equal(canAccessFeature(plusEntitlements, 'co_drafter'), true);

      assert.equal(isViewLocked('Stripboard', plusEntitlements), false);
      assert.equal(isViewLocked('Schedule', plusEntitlements), false);
      assert.equal(isViewLocked('Call Sheets', plusEntitlements), false);
      assert.equal(isViewLocked('Storyboard', plusEntitlements), false);
    });

    test('AI Plus all normal sections allowed', () => {
      const aiPlusEntitlements = resolveEntitlements({
        user: { uid: 'user-ai-plus', email: 'aiplus@example.com' },
        subscription: {
          userId: 'user-ai-plus',
          planId: 'ai_plus',
          status: 'active',
          subscriptionSource: 'admin_grant',
          currentPeriodStart: new Date().toISOString(),
          currentPeriodEnd: new Date(Date.now() + 30 * 86400000).toISOString(),
          createdAt: new Date().toISOString(),
          updatedAt: new Date().toISOString(),
        },
      });

      assert.equal(canAccessFeature(aiPlusEntitlements, 'shoot'), true);
      assert.equal(canAccessFeature(aiPlusEntitlements, 'co_drafter'), true);
      assert.equal(isViewLocked('Stripboard', aiPlusEntitlements), false);
      assert.equal(isViewLocked('Call Sheets', aiPlusEntitlements), false);
    });

    test('suspended Plus denied protected functionality while retaining plan assignment', () => {
      const suspendedPlus = resolveEntitlements({
        user: { uid: 'user-suspended', email: 'suspended@example.com' },
        subscription: {
          userId: 'user-suspended',
          planId: 'plus',
          status: 'suspended',
          subscriptionSource: 'admin_grant',
          currentPeriodStart: new Date().toISOString(),
          currentPeriodEnd: new Date(Date.now() + 30 * 86400000).toISOString(),
          createdAt: new Date().toISOString(),
          updatedAt: new Date().toISOString(),
        },
      });

      // Retains planId 'plus'
      assert.equal(suspendedPlus.planId, 'plus');
      assert.equal(suspendedPlus.status, 'suspended');

      // Features blocked
      assert.equal(canAccessFeature(suspendedPlus, 'workspace'), false);
      assert.equal(canAccessFeature(suspendedPlus, 'shoot'), false);
      assert.equal(canAccessFeature(suspendedPlus, 'co_drafter'), false);
      assert.equal(isViewLocked('Stripboard', suspendedPlus), true);
      assert.equal(isViewLocked('Screenplay', suspendedPlus), true);
    });

    test('admin email parsing is normalized (trimmed, lowercased, exact match)', () => {
      process.env.ADMIN_EMAILS = '  "Admin@Example.COM" , \'Second.Admin@DRAFTIT.PRO\'  ';
      const emails = getAdminEmails();
      assert.deepEqual(emails, ['admin@example.com', 'second.admin@draftit.pro']);

      assert.equal(isUserAdmin('admin@example.com'), true);
      assert.equal(isUserAdmin(' ADMIN@EXAMPLE.COM '), true);
      assert.equal(isUserAdmin('"ADMIN@EXAMPLE.COM"'), true);
      assert.equal(isUserAdmin('second.admin@draftit.pro'), true);
      assert.equal(isUserAdmin('attacker@example.com'), false);
      assert.equal(isUserAdmin('admin@example.com.evil.co'), false);
      assert.equal(isUserAdmin(null), false);
      assert.equal(isUserAdmin(undefined), false);
    });

    test('non-admin cannot access admin APIs/routes; admin can access', () => {
      assert.equal(isUserAdmin('normal@example.com'), false);
      assert.throws(() => assertAdmin('normal@example.com'), /Admin authorization required/);

      assert.doesNotThrow(() => assertAdmin('admin@example.com'));
    });

    test('non-admin cannot access BYOK; admin can access BYOK', () => {
      const normalUser = resolveEntitlements({
        user: { uid: 'u1', email: 'normal@example.com' },
        subscription: {
          userId: 'u1',
          planId: 'ai_plus',
          status: 'active',
          subscriptionSource: 'admin_grant',
          currentPeriodStart: new Date().toISOString(),
          currentPeriodEnd: new Date(Date.now() + 30 * 86400000).toISOString(),
          createdAt: new Date().toISOString(),
          updatedAt: new Date().toISOString(),
        },
      });
      assert.equal(normalUser.canAccessByok, false);
      assert.equal(canAccessFeature(normalUser, 'byok'), false);

      const adminUser = resolveEntitlements({
        user: { uid: 'admin-1', email: 'admin@example.com' },
        subscription: {
          userId: 'admin-1',
          planId: 'free',
          status: 'active',
          subscriptionSource: 'free',
          currentPeriodStart: new Date().toISOString(),
          currentPeriodEnd: new Date(Date.now() + 30 * 86400000).toISOString(),
          createdAt: new Date().toISOString(),
          updatedAt: new Date().toISOString(),
        },
      });
      assert.equal(adminUser.isAdmin, true);
      assert.equal(adminUser.canAccessByok, true);
      assert.equal(canAccessFeature(adminUser, 'byok'), true);
      assert.equal(canAccessFeature(adminUser, 'admin'), true);
    });
  });

  // =========================================================================
  // 2. USER MANAGEMENT TESTS
  // =========================================================================
  describe('User Management', () => {
    test('grant Free, Plus, AI Plus with audit event logging', async () => {
      // 1. Grant Free
      const freeSub = await store.grantPlan('target-u1', 'free', 'target@test.com', 'admin-1', 'admin@example.com');
      assert.equal(freeSub.planId, 'free');
      assert.equal(freeSub.status, 'active');

      let logs = await store.getAuditLogs();
      assert.equal(logs.length, 1);
      assert.equal(logs[0].action, 'grant_plan');
      assert.equal(logs[0].actorAdminUserId, 'admin-1');
      assert.equal(logs[0].targetUserId, 'target-u1');

      // 2. Grant Plus
      const plusSub = await store.grantPlan('target-u1', 'plus', 'target@test.com', 'admin-1', 'admin@example.com');
      assert.equal(plusSub.planId, 'plus');

      // 3. Grant AI Plus
      const aiPlusSub = await store.grantPlan('target-u1', 'ai_plus', 'target@test.com', 'admin-1', 'admin@example.com');
      assert.equal(aiPlusSub.planId, 'ai_plus');

      logs = await store.getAuditLogs();
      assert.equal(logs.length, 3);
    });

    test('suspend and reactivate user with audit logging', async () => {
      await store.grantPlan('u-sus', 'plus', 'sus@test.com', 'admin-1', 'admin@example.com');

      // Suspend
      const suspended = await store.suspendUser('u-sus', 'admin-1', 'admin@example.com');
      assert.equal(suspended.status, 'suspended');

      let logs = await store.getAuditLogs();
      assert.equal(logs[0].action, 'suspend');
      assert.equal(logs[0].newValue, 'suspended');

      // Reactivate
      const reactivated = await store.reactivateUser('u-sus', 'admin-1', 'admin@example.com');
      assert.equal(reactivated.status, 'active');

      logs = await store.getAuditLogs();
      assert.equal(logs[0].action, 'reactivate');
      assert.equal(logs[0].newValue, 'active');
    });
  });

  // =========================================================================
  // 3. AI CREDITS TESTS
  // =========================================================================
  describe('AI Credits Enforcement & Accounting', () => {
    test('Free hosted Co-Drafter denied', async () => {
      await store.grantPlan('u-free', 'free', 'free@test.com', 'admin-1', 'admin@example.com');
      await assert.rejects(
        () => creditManager.reserveCredit({ userId: 'u-free', requestId: 'req-1', model: 'sarvam-105b' }),
        /Hosted Sarvam AI credits require a Plus or AI Plus subscription/
      );
    });

    test('Plus receives 5000 paise monthly allowance; AI Plus receives 20000 paise monthly allowance', async () => {
      await store.grantPlan('u-plus', 'plus', 'plus@test.com', 'admin-1', 'admin@example.com');
      const periodPlus = await store.getCreditPeriod('u-plus');
      assert.equal(periodPlus.budgetPaise, 5000);

      await store.grantPlan('u-aiplus', 'ai_plus', 'aiplus@test.com', 'admin-1', 'admin@example.com');
      const periodAiPlus = await store.getCreditPeriod('u-aiplus');
      assert.equal(periodAiPlus.budgetPaise, 20000);
    });

    test('usage calculated from provider-returned tokens using centralized pricing', () => {
      // 1000 prompt tokens, 500 completion tokens on sarvam-105b
      // Input rate: 10 paise/1k -> 10 paise
      // Output rate: 25 paise/1k -> 13 paise (Math.ceil(500 * 25 / 1000) = 13)
      // Total = 23 paise
      const cost = calculateModelCostPaise('sarvam-105b', 1000, 500);
      assert.equal(cost.inputCostPaise, 10);
      assert.equal(cost.outputCostPaise, 13);
      assert.equal(cost.totalCostPaise, 23);
    });

    test('usage ledger idempotent by requestId', async () => {
      await store.grantPlan('u-idem', 'plus', 'idem@test.com', 'admin-1', 'admin@example.com');
      const res = await creditManager.reserveCredit({ userId: 'u-idem', requestId: 'req-idem-1', model: 'sarvam-105b' });

      // First commit
      const commit1 = await creditManager.commitCreditUsage({
        userId: 'u-idem',
        requestId: 'req-idem-1',
        model: 'sarvam-105b',
        promptTokens: 100,
        completionTokens: 100,
        reservedPaise: res.reservedPaise,
      });
      assert.equal(commit1.idempotent, false);

      const periodAfterFirst = await store.getCreditPeriod('u-idem');
      const consumedFirst = periodAfterFirst.consumedPaise;

      // Duplicate commit with same requestId
      const commit2 = await creditManager.commitCreditUsage({
        userId: 'u-idem',
        requestId: 'req-idem-1',
        model: 'sarvam-105b',
        promptTokens: 100,
        completionTokens: 100,
        reservedPaise: res.reservedPaise,
      });
      assert.equal(commit2.idempotent, true);

      const periodAfterSecond = await store.getCreditPeriod('u-idem');
      assert.equal(periodAfterSecond.consumedPaise, consumedFirst, 'Consumed budget must NOT double-charge');

      const history = await store.getAiUsageHistory('u-idem');
      assert.equal(history.length, 1, 'Only one ledger entry created for duplicate requestId');
    });

    test('remaining percentage calculated correctly and clamped 0-100', () => {
      // 5000 budget, 1000 consumed -> 80%
      const status1 = resolveEntitlements({
        user: { uid: 'u1', email: 'u1@test.com' },
        subscription: { planId: 'plus', status: 'active', userId: 'u1' },
        creditPeriod: { budgetPaise: 5000, consumedPaise: 1000, reservedPaise: 0 },
      }).aiCreditStatus;
      assert.equal(status1.remainingPercent, 80);

      // Overconsumed (e.g. 6000 consumed) -> clamped to 0
      const statusClamped = resolveEntitlements({
        user: { uid: 'u1', email: 'u1@test.com' },
        subscription: { planId: 'plus', status: 'active', userId: 'u1' },
        creditPeriod: { budgetPaise: 5000, consumedPaise: 6000, reservedPaise: 0 },
      }).aiCreditStatus;
      assert.equal(statusClamped.remainingPercent, 0);
    });

    test('normal user response does not expose monetary remaining value; admin view exposes cost', async () => {
      await store.grantPlan('u-privacy', 'plus', 'privacy@test.com', 'admin-1', 'admin@example.com');
      const period = await store.getCreditPeriod('u-privacy');

      const normalEntitlements = resolveEntitlements({
        user: { uid: 'u-privacy', email: 'privacy@test.com' },
        subscription: { planId: 'plus', status: 'active', userId: 'u-privacy' },
        creditPeriod: period,
      });

      // Normal user: NO rupee or paise values exposed!
      assert.equal('budgetPaise' in normalEntitlements.aiCreditStatus, false);
      assert.equal('consumedPaise' in normalEntitlements.aiCreditStatus, false);
      assert.equal(typeof normalEntitlements.aiCreditStatus.remainingPercent, 'number');

      // Admin usage view: CAN expose monetary values and tokens
      const adminDetails = await store.getAdminUserAiUsageDetails();
      const userDetail = adminDetails.find((d) => d.userId === 'u-privacy');
      assert.ok(userDetail);
      assert.equal(typeof userDetail.budgetPaise, 'number');
      assert.equal(typeof userDetail.consumedPaise, 'number');
      assert.equal(typeof userDetail.estimatedInrCost, 'number');
    });

    test('exhausted budget blocks new request', async () => {
      await store.grantPlan('u-exhaust', 'plus', 'exhaust@test.com', 'admin-1', 'admin@example.com');
      const period = await store.getCreditPeriod('u-exhaust');
      period.consumedPaise = period.budgetPaise; // 100% consumed
      await store.saveCreditPeriod(period);

      await assert.rejects(
        () => creditManager.reserveCredit({ userId: 'u-exhaust', requestId: 'req-ex', model: 'sarvam-105b' }),
        /allowance is exhausted/
      );
    });

    test('new period restores allowance without deleting historical usage', async () => {
      await store.grantPlan('u-period', 'plus', 'period@test.com', 'admin-1', 'admin@example.com');
      const res = await creditManager.reserveCredit({ userId: 'u-period', requestId: 'req-hist-1', model: 'sarvam-105b' });
      await creditManager.commitCreditUsage({
        userId: 'u-period',
        requestId: 'req-hist-1',
        model: 'sarvam-105b',
        promptTokens: 500,
        completionTokens: 500,
        reservedPaise: res.reservedPaise,
      });

      const period1 = await store.getCreditPeriod('u-period');
      assert.ok(period1.consumedPaise > 0);

      // Fast-forward time past current period end (e.g. +35 days)
      const futureDate = new Date(new Date(period1.periodEnd).getTime() + 86400000 * 2);
      const period2 = await store.getCreditPeriod('u-period', futureDate);

      // Period has rolled forward
      assert.notEqual(period2.id, period1.id);
      assert.equal(period2.consumedPaise, 0, 'New period starts with fresh 0 consumed allowance');

      // Historical usage records are fully retained
      const history = await store.getAiUsageHistory('u-period');
      assert.equal(history.length, 1);
      assert.equal(history[0].requestId, 'req-hist-1');
    });

    test('concurrent requests cannot trivially overspend allowance (reservation strategy)', async () => {
      await store.grantPlan('u-race', 'plus', 'race@test.com', 'admin-1', 'admin@example.com');
      const period = await store.getCreditPeriod('u-race');
      // Set allowance to exactly 100 paise
      period.budgetPaise = 100;
      await store.saveCreditPeriod(period);

      // Each reservation takes ~68 paise
      const res1 = await creditManager.reserveCredit({ userId: 'u-race', requestId: 'race-1', model: 'sarvam-105b' });
      assert.ok(res1.reservedPaise > 0);

      // Second concurrent request should be rejected because available (100 - 68 = 32) < 68
      await assert.rejects(
        () => creditManager.reserveCredit({ userId: 'u-race', requestId: 'race-2', model: 'sarvam-105b' }),
        /allowance is exhausted/
      );

      // Release first reservation
      await creditManager.releaseReservation('u-race', res1.reservedPaise);

      // Now request can proceed
      const res2 = await creditManager.reserveCredit({ userId: 'u-race', requestId: 'race-3', model: 'sarvam-105b' });
      assert.ok(res2.reservedPaise > 0);
    });
  });

  // =========================================================================
  // 4. PLANS & PRICING TESTS
  // =========================================================================
  describe('Plans & Pricing Configuration & Discounts', () => {
    test('seeded Free = ₹0, Plus = ₹799, AI Plus = ₹1,499', () => {
      assert.equal(DEFAULT_PLAN_CONFIGS.free.monthlyPricePaise, 0);
      assert.equal(DEFAULT_PLAN_CONFIGS.plus.monthlyPricePaise, 79900);
      assert.equal(DEFAULT_PLAN_CONFIGS.ai_plus.monthlyPricePaise, 149900);
    });

    test('admin can edit future plan configuration and audit event is created', async () => {
      const updated = await store.updatePlanConfig(
        'plus',
        { monthlyPricePaise: 89900, displayName: 'Plus Premium' },
        'admin-1',
        'admin@example.com'
      );
      assert.equal(updated.monthlyPricePaise, 89900);
      assert.equal(updated.displayName, 'Plus Premium');

      const logs = await store.getAuditLogs();
      assert.equal(logs[0].action, 'update_plan');
      assert.equal(logs[0].targetUserId, 'plan_plus');
    });

    test('percentage discount validation (0-100)', () => {
      assert.equal(validateDiscount({ name: 'Valid %', type: 'percentage', value: 20, applicablePlanIds: ['plus'] }).valid, true);
      assert.equal(validateDiscount({ name: 'Invalid %', type: 'percentage', value: 120, applicablePlanIds: ['plus'] }).valid, false);
      assert.equal(validateDiscount({ name: 'Negative %', type: 'percentage', value: -10, applicablePlanIds: ['plus'] }).valid, false);
    });

    test('fixed discount validation (cannot produce negative effective price)', () => {
      // Base Plus is 79900 paise (₹799)
      assert.equal(
        validateDiscount({ name: 'Safe Fixed', type: 'fixed', value: 20000, applicablePlanIds: ['plus'] }).valid,
        true
      );

      // Exceeds base price: 90000 paise (₹900) > ₹799
      const result = validateDiscount({ name: 'Too Big Fixed', type: 'fixed', value: 90000, applicablePlanIds: ['plus'] });
      assert.equal(result.valid, false);
      assert.match(result.error, /exceeds base price/);
    });

    test('expired discount ignored; disabled discount ignored; effective price cannot become negative', () => {
      const now = new Date('2026-06-15T00:00:00.000Z');

      // 1. Expired discount
      const expiredDiscount = {
        id: 'd1',
        name: 'Past Promo',
        type: 'percentage',
        value: 50,
        applicablePlanIds: ['plus'],
        startsAt: '2026-05-01T00:00:00.000Z',
        endsAt: '2026-06-01T00:00:00.000Z',
        enabled: true,
      };
      const resExpired = calculateEffectivePricePaise(79900, [expiredDiscount], 'plus', now);
      assert.equal(resExpired.effectivePricePaise, 79900);
      assert.equal(resExpired.appliedDiscount, null);

      // 2. Disabled discount
      const disabledDiscount = {
        ...expiredDiscount,
        endsAt: '2026-07-01T00:00:00.000Z',
        enabled: false,
      };
      const resDisabled = calculateEffectivePricePaise(79900, [disabledDiscount], 'plus', now);
      assert.equal(resDisabled.effectivePricePaise, 79900);

      // 3. Active valid discount (20% off 79900 paise = 63920 paise)
      const activeDiscount = {
        ...disabledDiscount,
        value: 20,
        enabled: true,
      };
      const resActive = calculateEffectivePricePaise(79900, [activeDiscount], 'plus', now);
      assert.equal(resActive.effectivePricePaise, 63920);
      assert.equal(resActive.appliedDiscount.id, 'd1');
    });
  });

  // =========================================================================
  // 5. UI & GATING REGRESSION TESTS
  // =========================================================================
  describe('UI & Gating', () => {
    test('Free sidebar shows premium items as locked', () => {
      const freeEntitlements = resolveEntitlements({ user: null });
      assert.equal(isViewLocked('Stripboard', freeEntitlements), true);
      assert.equal(isViewLocked('Schedule', freeEntitlements), true);
      assert.equal(isViewLocked('Call Sheets', freeEntitlements), true);
      assert.equal(isViewLocked('Locations', freeEntitlements), true);
      assert.equal(isViewLocked('Storyboard', freeEntitlements), true);

      // Development & writing are unlocked
      assert.equal(isViewLocked('Scene cards', freeEntitlements), false);
      assert.equal(isViewLocked('Screenplay', freeEntitlements), false);
      assert.equal(isViewLocked('Series overview', freeEntitlements), false);
    });

    test('Plus unlocks all normal views', () => {
      const plusEntitlements = resolveEntitlements({
        user: { uid: 'p1', email: 'p1@test.com' },
        subscription: { planId: 'plus', status: 'active', userId: 'p1' },
      });

      assert.equal(isViewLocked('Stripboard', plusEntitlements), false);
      assert.equal(isViewLocked('Schedule', plusEntitlements), false);
      assert.equal(isViewLocked('Call Sheets', plusEntitlements), false);
      assert.equal(isViewLocked('Locations', plusEntitlements), false);
      assert.equal(isViewLocked('Storyboard', plusEntitlements), false);
      assert.equal(isViewLocked('Export', plusEntitlements), false);
    });

    test('single source of entitlement truth drives feature access', () => {
      // Every view mapped in VIEW_TO_FEATURE_MAP
      for (const [view, feature] of Object.entries(VIEW_TO_FEATURE_MAP)) {
        assert.ok(feature, `View ${view} must map to a valid feature ID`);
      }
    });

    test('user credit display shows 100% when 0 consumed and clamps properly', () => {
      const fullCredits = resolveEntitlements({
        user: { uid: 'u-full', email: 'full@test.com' },
        subscription: { planId: 'plus', status: 'active', userId: 'u-full' },
        creditPeriod: { budgetPaise: 5000, consumedPaise: 0, reservedPaise: 0 },
      }).aiCreditStatus;
      assert.equal(fullCredits.remainingPercent, 100);

      const halfCredits = resolveEntitlements({
        user: { uid: 'u-half', email: 'half@test.com' },
        subscription: { planId: 'plus', status: 'active', userId: 'u-half' },
        creditPeriod: { budgetPaise: 5000, consumedPaise: 2500, reservedPaise: 0 },
      }).aiCreditStatus;
      assert.equal(halfCredits.remainingPercent, 50);

      const emptyCredits = resolveEntitlements({
        user: { uid: 'u-empty', email: 'empty@test.com' },
        subscription: { planId: 'plus', status: 'active', userId: 'u-empty' },
        creditPeriod: { budgetPaise: 5000, consumedPaise: 5000, reservedPaise: 0 },
      }).aiCreditStatus;
      assert.equal(emptyCredits.remainingPercent, 0);
    });
  });

  // =========================================================================
  // 6. SERVER AUTHENTICATION & EDGE CASES
  // =========================================================================
  describe('Server Authentication & Edge Cases', () => {
    test('non-admin attempting admin assertion throws 403', () => {
      assert.throws(() => assertAdmin('stranger@test.com'), (err) => {
        return err.statusCode === 403;
      });
    });

    test('admin email assertion passes for normalized admin email', () => {
      assert.doesNotThrow(() => assertAdmin(' superuser@draftit.pro '));
    });

    test('best discount is chosen when multiple apply to the same plan', () => {
      const now = new Date('2026-07-01T00:00:00.000Z');
      const discount1 = {
        id: 'd10',
        name: '10% Off',
        type: 'percentage',
        value: 10,
        applicablePlanIds: ['plus'],
        startsAt: '2026-06-01T00:00:00.000Z',
        endsAt: '2026-08-01T00:00:00.000Z',
        enabled: true,
      };
      const discount2 = {
        id: 'd25',
        name: '25% Off',
        type: 'percentage',
        value: 25,
        applicablePlanIds: ['plus'],
        startsAt: '2026-06-01T00:00:00.000Z',
        endsAt: '2026-08-01T00:00:00.000Z',
        enabled: true,
      };
      const result = calculateEffectivePricePaise(79900, [discount1, discount2], 'plus', now);
      // 25% off 79900 = 59925
      assert.equal(result.effectivePricePaise, 59925);
      assert.equal(result.appliedDiscount.id, 'd25');
    });

    test('future start date discount is ignored before start time', () => {
      const now = new Date('2026-06-01T00:00:00.000Z');
      const futureDiscount = {
        id: 'dfuture',
        name: 'Future Launch',
        type: 'percentage',
        value: 30,
        applicablePlanIds: ['plus'],
        startsAt: '2026-07-01T00:00:00.000Z',
        endsAt: '2026-08-01T00:00:00.000Z',
        enabled: true,
      };
      const result = calculateEffectivePricePaise(79900, [futureDiscount], 'plus', now);
      assert.equal(result.effectivePricePaise, 79900);
      assert.equal(result.appliedDiscount, null);
    });

    test('exact 100% discount reduces price to 0 but not negative', () => {
      const now = new Date('2026-06-01T00:00:00.000Z');
      const fullDiscount = {
        id: 'dfree',
        name: '100% Free Promo',
        type: 'percentage',
        value: 100,
        applicablePlanIds: ['plus'],
        startsAt: '2026-05-01T00:00:00.000Z',
        endsAt: '2026-07-01T00:00:00.000Z',
        enabled: true,
      };
      const result = calculateEffectivePricePaise(79900, [fullDiscount], 'plus', now);
      assert.equal(result.effectivePricePaise, 0);
    });

    test('admin user usage detail computes correct token aggregates across multiple requests', async () => {
      await store.grantPlan('u-agg', 'plus', 'agg@test.com', 'admin-1', 'admin@example.com');
      const res1 = await creditManager.reserveCredit({ userId: 'u-agg', requestId: 'req-agg-1', model: 'sarvam-105b' });
      await creditManager.commitCreditUsage({
        userId: 'u-agg',
        requestId: 'req-agg-1',
        model: 'sarvam-105b',
        promptTokens: 400,
        completionTokens: 200,
        reservedPaise: res1.reservedPaise,
      });

      const res2 = await creditManager.reserveCredit({ userId: 'u-agg', requestId: 'req-agg-2', model: 'sarvam-105b' });
      await creditManager.commitCreditUsage({
        userId: 'u-agg',
        requestId: 'req-agg-2',
        model: 'sarvam-105b',
        promptTokens: 600,
        completionTokens: 300,
        reservedPaise: res2.reservedPaise,
      });

      const details = await store.getAdminUserAiUsageDetails();
      const uDetail = details.find((d) => d.userId === 'u-agg');
      assert.ok(uDetail);
      assert.equal(uDetail.promptTokens, 1000);
      assert.equal(uDetail.completionTokens, 500);
      assert.equal(uDetail.totalTokens, 1500);
      assert.equal(uDetail.requestCount, 2);
    });
  });
});
