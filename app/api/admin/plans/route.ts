import { NextResponse } from 'next/server';
import { requireAdminUser } from '@/lib/entitlements/server-auth';
import { getEntitlementStore } from '@/lib/entitlements/store';
import type { PlanConfig, PlanId } from '@/lib/entitlements/types';
import { validatePlanConfig } from '@/lib/entitlements/plans';

export async function GET(request: Request) {
  const routeStartedAt = performance.now();
  try {
    await requireAdminUser(request);
    const store = getEntitlementStore();
    const plans = await store.getPlanConfigs();
    console.info('[admin-timing] plans route', {
      totalMs: Math.round(performance.now() - routeStartedAt),
    });
    return NextResponse.json(plans);
  } catch (error: any) {
    return NextResponse.json(
      { error: error.message || 'Failed to fetch plans' },
      { status: 500 },
    );
  }
}

export async function POST(request: Request) {
  try {
    const admin = await requireAdminUser(request);
    const body = await request.json();
    const {
      action = 'update',
      planId,
      updates,
      plan,
    } = body as {
      action?: 'create' | 'update' | 'archive' | 'delete';
      planId: PlanId;
      plan?: PlanConfig;
      updates: {
        displayName?: string;
        monthlyPricePaise?: number;
        aiMonthlyBudgetPaise?: number;
        features?: any[];
        active?: boolean;
      };
    };

    if (!planId || !updates) {
      return NextResponse.json(
        { error: 'Missing planId or updates.' },
        { status: 400 },
      );
    }

    if (
      updates.monthlyPricePaise !== undefined &&
      (typeof updates.monthlyPricePaise !== 'number' ||
        updates.monthlyPricePaise < 0)
    ) {
      return NextResponse.json(
        { error: 'Price must be a non-negative integer in paise.' },
        { status: 400 },
      );
    }

    if (
      updates.aiMonthlyBudgetPaise !== undefined &&
      (typeof updates.aiMonthlyBudgetPaise !== 'number' ||
        updates.aiMonthlyBudgetPaise < 0)
    ) {
      return NextResponse.json(
        { error: 'AI budget must be a non-negative integer in paise.' },
        { status: 400 },
      );
    }

    const store = getEntitlementStore();
    if (action === 'create') {
      if (!plan || plan.id !== planId)
        return NextResponse.json(
          { error: 'A complete plan config is required.' },
          { status: 400 },
        );
      const validation = validatePlanConfig(plan, await store.getPlanConfigs());
      if (!validation.valid)
        return NextResponse.json({ error: validation.error }, { status: 400 });
      return NextResponse.json(
        {
          ok: true,
          plan: await store.createPlanConfig(
            plan,
            admin.uid,
            admin.email || 'admin@draftit.pro',
          ),
        },
        { status: 201 },
      );
    }
    if (!planId)
      return NextResponse.json({ error: 'Missing planId.' }, { status: 400 });
    if (action === 'delete') {
      await store.deletePlanConfig(
        planId,
        admin.uid,
        admin.email || 'admin@draftit.pro',
      );
      return NextResponse.json({ ok: true });
    }
    const updatedPlan = await store.updatePlanConfig(
      planId,
      { ...updates, active: action === 'archive' ? false : updates.active },
      admin.uid,
      admin.email || 'admin@draftit.pro',
    );

    return NextResponse.json({ ok: true, plan: updatedPlan });
  } catch (error: any) {
    const status = error.statusCode || 500;
    return NextResponse.json(
      { error: error.message || 'Unauthorized or server error' },
      { status },
    );
  }
}
