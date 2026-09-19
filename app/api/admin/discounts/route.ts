import { NextResponse } from 'next/server';
import { requireAdminUser } from '@/lib/entitlements/server-auth';
import { getEntitlementStore } from '@/lib/entitlements/store';
import { validateDiscount } from '@/lib/entitlements/plans';

export async function GET(request: Request) {
  const routeStartedAt = performance.now();
  try {
    await requireAdminUser(request);
    const store = getEntitlementStore();
    const discounts = await store.getDiscounts();
    console.info('[admin-timing] discounts route', {
      totalMs: Math.round(performance.now() - routeStartedAt),
    });
    return NextResponse.json(discounts);
  } catch (error: any) {
    return NextResponse.json(
      { error: error.message || 'Failed to fetch discounts' },
      { status: 500 },
    );
  }
}

export async function POST(request: Request) {
  try {
    const admin = await requireAdminUser(request);
    const body = await request.json();
    const { action, discountId, discount, enabled } = body as {
      action: 'create' | 'update' | 'toggle' | 'delete';
      discountId?: string;
      discount?: any;
      enabled?: boolean;
    };

    const store = getEntitlementStore();
    const adminUserId = admin.uid;
    const adminEmail = admin.email || 'admin@draftit.pro';

    if (action === 'delete') {
      if (!discountId)
        return NextResponse.json(
          { error: 'Missing discountId' },
          { status: 400 },
        );
      await store.deleteDiscount(discountId, adminUserId, adminEmail);
      return NextResponse.json({ ok: true });
    }

    if (action === 'create') {
      const planConfigs = await store.getPlanConfigs();
      const validation = validateDiscount(discount, planConfigs);
      if (!validation.valid) {
        return NextResponse.json({ error: validation.error }, { status: 400 });
      }

      const created = await store.createDiscount(
        discount,
        adminUserId,
        adminEmail,
      );
      return NextResponse.json({ ok: true, discount: created });
    }

    if (action === 'update') {
      if (!discountId) {
        return NextResponse.json(
          { error: 'Missing discountId' },
          { status: 400 },
        );
      }
      const planConfigs = await store.getPlanConfigs();
      const validation = validateDiscount(discount, planConfigs);
      if (!validation.valid) {
        return NextResponse.json({ error: validation.error }, { status: 400 });
      }

      const updated = await store.updateDiscount(
        discountId,
        discount,
        adminUserId,
        adminEmail,
      );
      return NextResponse.json({ ok: true, discount: updated });
    }

    if (action === 'toggle') {
      if (!discountId || typeof enabled !== 'boolean') {
        return NextResponse.json(
          { error: 'Missing discountId or enabled' },
          { status: 400 },
        );
      }
      const updated = await store.toggleDiscount(
        discountId,
        enabled,
        adminUserId,
        adminEmail,
      );
      return NextResponse.json({ ok: true, discount: updated });
    }

    return NextResponse.json(
      { error: `Unknown action: ${action}` },
      { status: 400 },
    );
  } catch (error: any) {
    const status = error.statusCode || 500;
    return NextResponse.json(
      { error: error.message || 'Unauthorized or server error' },
      { status },
    );
  }
}
