import { NextResponse } from 'next/server';
import { getEntitlementStore } from '@/lib/entitlements/store';
import { buildCustomerPlanPricing } from '@/lib/entitlements/plans';

export async function GET() {
  try {
    const store = getEntitlementStore();
    const [planConfigs, discounts] = await Promise.all([
      store.getPlanConfigs(),
      store.getDiscounts(),
    ]);
    return NextResponse.json({
      plans: buildCustomerPlanPricing(planConfigs, discounts),
    });
  } catch (error) {
    console.error('[Pricing API]', error);
    return NextResponse.json(
      { error: 'Could not load plan pricing.' },
      { status: 500 },
    );
  }
}
