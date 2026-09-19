import { NextResponse } from 'next/server';
import { requireAdminUser } from '@/lib/entitlements/server-auth';
import { getEntitlementStore } from '@/lib/entitlements/store';
import type { PlanId } from '@/lib/entitlements/types';

export async function GET() {
  try {
    const store = getEntitlementStore();
    const plans = await store.getPlanConfigs();
    return NextResponse.json(plans);
  } catch (error: any) {
    return NextResponse.json({ error: error.message || 'Failed to fetch plans' }, { status: 500 });
  }
}

export async function POST(request: Request) {
  try {
    const admin = await requireAdminUser(request);
    const body = await request.json();
    const { planId, updates } = body as {
      planId: PlanId;
      updates: {
        displayName?: string;
        monthlyPricePaise?: number;
        aiMonthlyBudgetPaise?: number;
        features?: any[];
        active?: boolean;
      };
    };

    if (!planId || !updates) {
      return NextResponse.json({ error: 'Missing planId or updates.' }, { status: 400 });
    }

    if (updates.monthlyPricePaise !== undefined && (typeof updates.monthlyPricePaise !== 'number' || updates.monthlyPricePaise < 0)) {
      return NextResponse.json({ error: 'Price must be a non-negative integer in paise.' }, { status: 400 });
    }

    if (updates.aiMonthlyBudgetPaise !== undefined && (typeof updates.aiMonthlyBudgetPaise !== 'number' || updates.aiMonthlyBudgetPaise < 0)) {
      return NextResponse.json({ error: 'AI budget must be a non-negative integer in paise.' }, { status: 400 });
    }

    const store = getEntitlementStore();
    const updatedPlan = await store.updatePlanConfig(
      planId,
      updates,
      admin.uid,
      admin.email || 'admin@draftit.pro'
    );

    return NextResponse.json({ ok: true, plan: updatedPlan });
  } catch (error: any) {
    const status = error.statusCode || 500;
    return NextResponse.json({ error: error.message || 'Unauthorized or server error' }, { status });
  }
}
