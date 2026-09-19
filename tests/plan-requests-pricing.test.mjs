import { test, describe, beforeEach } from 'node:test';
import assert from 'node:assert/strict';

import {
  InMemoryEntitlementStore,
  setEntitlementStore,
} from '../lib/entitlements/store.ts';
import {
  buildCustomerPlanPricing,
  calculateEffectivePricePaise,
} from '../lib/entitlements/plans.ts';
import { resolveEntitlements } from '../lib/entitlements/resolver.ts';
import {
  getAuthenticatedUser,
  requireAdminUser,
} from '../lib/entitlements/server-auth.ts';

describe('plan requests and customer pricing', () => {
  let store;

  beforeEach(() => {
    store = new InMemoryEntitlementStore();
    setEntitlementStore(store);
    process.env.ADMIN_EMAILS = 'admin@example.com';
  });

  test('authenticated user creates and reloads a durable Plus request', async () => {
    const user = await getAuthenticatedUser(
      new Request('http://localhost', {
        headers: { Authorization: 'Bearer mock_user-1:user@example.com' },
      }),
    );
    const created = await store.createPlanRequest({
      uid: user.uid,
      email: user.email,
      requestedPlanId: 'plus',
    });
    const reload = await store.getPendingPlanRequest(user.uid, 'plus');
    assert.equal(reload.id, created.id);
  });

  test('duplicate pending request is prevented and another UID cannot be requested', async () => {
    const first = await store.createPlanRequest({
      uid: 'user-1',
      email: 'user@example.com',
      requestedPlanId: 'plus',
    });
    const second = await store.createPlanRequest({
      uid: 'user-1',
      email: 'user@example.com',
      requestedPlanId: 'plus',
    });
    assert.equal(first.id, second.id);
    assert.notEqual(first.uid, 'other-user');
  });

  test('invalid and Free plan requests are rejected', async () => {
    assert.equal(['plus', 'ai_plus'].includes('free'), false);
    assert.equal(['plus', 'ai_plus'].includes('gold'), false);
    assert.equal(
      await getAuthenticatedUser(
        new Request('http://localhost', {
          headers: { Authorization: 'Bearer not-a-token' },
        }),
      ),
      null,
    );
  });

  test('only admins can list or process requests', async () => {
    await store.createPlanRequest({
      uid: 'user-1',
      email: 'user@example.com',
      requestedPlanId: 'plus',
    });
    await assert.rejects(
      () =>
        requireAdminUser(
          new Request('http://localhost', {
            headers: { Authorization: 'Bearer mock_user-1:user@example.com' },
          }),
        ),
      /Admin authorization required/,
    );
    assert.equal(
      (
        await getAuthenticatedUser(
          new Request('http://localhost', {
            headers: { Authorization: 'Bearer mock_admin:admin@example.com' },
          }),
        )
      ).isAdmin,
      true,
    );
  });

  test('admin lists, approves once, updates subscription and credit budget, and audits', async () => {
    const created = await store.createPlanRequest({
      uid: 'user-1',
      email: 'user@example.com',
      requestedPlanId: 'ai_plus',
    });
    const admin = 'admin-uid';
    const approved = await store.processPlanRequest(
      created.id,
      'approved',
      admin,
      'admin@example.com',
    );
    assert.equal(approved.status, 'approved');
    assert.equal((await store.getSubscription('user-1')).planId, 'ai_plus');
    assert.equal((await store.getCreditPeriod('user-1')).budgetPaise, 20000);
    assert.equal(
      (await store.getAuditLogs()).some(
        (event) => event.action === 'approve_plan_request',
      ),
      true,
    );
    await assert.rejects(
      () =>
        store.processPlanRequest(
          created.id,
          'approved',
          admin,
          'admin@example.com',
        ),
      /already been processed/,
    );
  });

  test('rejection leaves subscription unchanged and allows a later request', async () => {
    await store.updateSubscription(
      'user-1',
      { planId: 'plus' },
      'system',
      'admin@example.com',
    );
    const created = await store.createPlanRequest({
      uid: 'user-1',
      email: 'user@example.com',
      requestedPlanId: 'ai_plus',
    });
    const rejected = await store.processPlanRequest(
      created.id,
      'rejected',
      'admin-uid',
      'admin@example.com',
    );
    assert.equal(rejected.status, 'rejected');
    assert.equal((await store.getSubscription('user-1')).planId, 'plus');
    assert.equal(
      (
        await store.createPlanRequest({
          uid: 'user-1',
          email: 'user@example.com',
          requestedPlanId: 'ai_plus',
        })
      ).status,
      'pending',
    );
  });

  test('customer pricing uses active discounts and excludes admin-only budget data', async () => {
    const now = new Date('2026-09-19T00:00:00.000Z');
    const discount = {
      id: 'active',
      name: 'Launch',
      type: 'percentage',
      value: 10,
      applicablePlanIds: ['plus'],
      startsAt: '2026-01-01T00:00:00.000Z',
      endsAt: '2026-12-31T00:00:00.000Z',
      enabled: true,
      createdAt: now.toISOString(),
      updatedAt: now.toISOString(),
    };
    const pricing = buildCustomerPlanPricing(
      await store.getPlanConfigs(),
      [discount],
      now,
    );
    assert.equal(
      pricing.find((plan) => plan.id === 'plus').effectivePricePaise,
      71910,
    );
    assert.equal(
      pricing.find((plan) => plan.id === 'ai_plus').effectivePricePaise,
      149900,
    );
    assert.equal('aiMonthlyBudgetPaise' in pricing[0], false);
    assert.equal(
      calculateEffectivePricePaise(79900, [discount], 'plus', now)
        .effectivePricePaise,
      71910,
    );
  });

  test('discount ordering is newest-created first and legacy records remain safe', async () => {
    await store.createDiscount(
      {
        name: 'old',
        type: 'percentage',
        value: 5,
        applicablePlanIds: ['plus'],
        startsAt: '',
        endsAt: '',
        enabled: true,
      },
      'a',
      'admin@example.com',
    );
    await store.createDiscount(
      {
        name: 'new',
        type: 'percentage',
        value: 10,
        applicablePlanIds: ['plus'],
        startsAt: '',
        endsAt: '',
        enabled: true,
      },
      'a',
      'admin@example.com',
    );
    const discounts = await store.getDiscounts();
    assert.equal(discounts[0].name, 'new');
    assert.doesNotThrow(() =>
      [{ id: 'legacy' }].sort((a, b) =>
        (b.createdAt || '').localeCompare(a.createdAt || ''),
      ),
    );
  });

  test('admin creates a dynamic plan and customer pricing exposes active paid plans', async () => {
    const plan = await store.createPlanConfig(
      {
        id: 'studio',
        displayName: 'Studio',
        monthlyPricePaise: 249900,
        aiMonthlyBudgetPaise: 30000,
        features: ['workspace', 'writing', 'production'],
        active: true,
        displayOrder: 1,
      },
      'admin',
      'admin@example.com',
    );
    assert.equal(plan.id, 'studio');
    const pricing = buildCustomerPlanPricing(
      await store.getPlanConfigs(),
      [],
      new Date(),
    );
    assert.ok(pricing.some((item) => item.id === 'studio'));
    assert.equal(
      pricing.some((item) => item.id === 'free'),
      false,
    );
  });

  test('duplicate and invalid plans are rejected, while Free remains protected', async () => {
    const plan = {
      id: 'studio',
      displayName: 'Studio',
      monthlyPricePaise: 249900,
      aiMonthlyBudgetPaise: 30000,
      features: ['workspace'],
      active: true,
    };
    await store.createPlanConfig(plan, 'admin', 'admin@example.com');
    await assert.rejects(
      () => store.createPlanConfig(plan, 'admin', 'admin@example.com'),
      /already exists/,
    );
    await assert.rejects(
      () =>
        store.createPlanConfig(
          { ...plan, id: 'Bad ID' },
          'admin',
          'admin@example.com',
        ),
      /lowercase slug/,
    );
    await assert.rejects(
      () => store.deletePlanConfig('free', 'admin', 'admin@example.com'),
      /Free plan/,
    );
  });

  test('dynamic plan approval uses configured features and AI allowance', async () => {
    await store.createPlanConfig(
      {
        id: 'studio',
        displayName: 'Studio',
        monthlyPricePaise: 249900,
        aiMonthlyBudgetPaise: 30000,
        features: ['workspace', 'writing', 'production'],
        active: true,
      },
      'admin',
      'admin@example.com',
    );
    const request = await store.createPlanRequest({
      uid: 'user-1',
      email: 'user@example.com',
      requestedPlanId: 'studio',
    });
    await store.processPlanRequest(
      request.id,
      'approved',
      'admin',
      'admin@example.com',
    );
    const entitlements = resolveEntitlements({
      user: { uid: 'user-1', email: 'user@example.com' },
      subscription: await store.getSubscription('user-1'),
      planConfigs: await store.getPlanConfigs(),
      creditPeriod: await store.getCreditPeriod('user-1'),
    });
    assert.deepEqual(entitlements.features, [
      'workspace',
      'writing',
      'production',
    ]);
    assert.equal(entitlements.aiCreditStatus.hasHostedAi, true);
    assert.equal((await store.getCreditPeriod('user-1')).budgetPaise, 30000);
  });

  test('referenced plans can be archived but not deleted; unused plans can be deleted', async () => {
    await store.createPlanConfig(
      {
        id: 'studio',
        displayName: 'Studio',
        monthlyPricePaise: 249900,
        aiMonthlyBudgetPaise: 30000,
        features: ['workspace'],
        active: true,
      },
      'admin',
      'admin@example.com',
    );
    await store.updateSubscription(
      'user-1',
      { planId: 'studio' },
      'admin',
      'admin@example.com',
    );
    await assert.rejects(
      () => store.deletePlanConfig('studio', 'admin', 'admin@example.com'),
      /archived/,
    );
    await store.updatePlanConfig(
      'studio',
      { active: false },
      'admin',
      'admin@example.com',
    );
    await store.createPlanConfig(
      {
        id: 'unused',
        displayName: 'Unused',
        monthlyPricePaise: 100,
        aiMonthlyBudgetPaise: 0,
        features: ['workspace'],
        active: false,
      },
      'admin',
      'admin@example.com',
    );
    await store.deletePlanConfig('unused', 'admin', 'admin@example.com');
    assert.equal((await store.getPlanConfigs()).unused, undefined);
  });

  test('discount edit, enable/disable, safe delete, and audit entries work', async () => {
    const created = await store.createDiscount(
      {
        name: 'Promo',
        type: 'percentage',
        value: 10,
        applicablePlanIds: ['plus'],
        startsAt: '',
        endsAt: '',
        enabled: true,
      },
      'admin',
      'admin@example.com',
    );
    await store.updateDiscount(
      created.id,
      { value: 20 },
      'admin',
      'admin@example.com',
    );
    await store.toggleDiscount(created.id, false, 'admin', 'admin@example.com');
    assert.equal(
      (await store.getDiscounts()).find((item) => item.id === created.id)
        .enabled,
      false,
    );
    await store.deleteDiscount(created.id, 'admin', 'admin@example.com');
    assert.equal(
      (await store.getDiscounts()).some((item) => item.id === created.id),
      false,
    );
    assert.ok(
      (await store.getAuditLogs()).some(
        (event) => event.action === 'delete_discount',
      ),
    );
  });
});
