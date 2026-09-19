import { NextResponse } from 'next/server';
import { getAuthenticatedUser } from '@/lib/entitlements/server-auth';
import { getEntitlementStore } from '@/lib/entitlements/store';
import type { PlanId } from '@/lib/entitlements/types';

export async function GET(request: Request) {
  const user = await getAuthenticatedUser(request);
  if (!user)
    return NextResponse.json(
      { error: 'Authentication required.' },
      { status: 401 },
    );

  const store = getEntitlementStore();
  return NextResponse.json({
    requests: await store.listPendingPlanRequestsForUser(user.uid),
  });
}

export async function POST(request: Request) {
  const user = await getAuthenticatedUser(request);
  if (!user)
    return NextResponse.json(
      { error: 'Authentication required.' },
      { status: 401 },
    );

  try {
    const body = (await request.json()) as {
      requestedPlanId?: PlanId;
      uid?: string;
    };
    if (body.uid && body.uid !== user.uid) {
      return NextResponse.json(
        { error: 'A plan request can only be created for your account.' },
        { status: 403 },
      );
    }
    const store = getEntitlementStore();
    const plans = await store.getPlanConfigs();
    if (
      typeof body.requestedPlanId !== 'string' ||
      body.requestedPlanId === 'free' ||
      !plans[body.requestedPlanId]?.active ||
      plans[body.requestedPlanId].monthlyPricePaise <= 0
    ) {
      return NextResponse.json(
        { error: 'Only active paid plans can be requested.' },
        { status: 400 },
      );
    }

    const subscription = await store.getSubscription(user.uid);
    const created = await store.createPlanRequest({
      uid: user.uid,
      email: user.email,
      displayName: user.displayName,
      requestedPlanId: body.requestedPlanId,
      currentPlanId: subscription?.planId || 'free',
    });
    return NextResponse.json({ request: created }, { status: 201 });
  } catch (error: any) {
    return NextResponse.json(
      { error: error.message || 'Could not create plan request.' },
      { status: 500 },
    );
  }
}
