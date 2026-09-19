import { NextResponse } from 'next/server';
import { getAuthenticatedUser } from '@/lib/entitlements/server-auth';
import { getEntitlementStore } from '@/lib/entitlements/store';
import { resolveEntitlements } from '@/lib/entitlements/resolver';

export async function GET(request: Request) {
  try {
    const user = await getAuthenticatedUser(request);
    const store = getEntitlementStore();

    let subscription = null;
    let creditPeriod = null;

    if (user) {
      subscription = await store.getSubscription(user.uid);
      creditPeriod = await store.getCreditPeriod(user.uid);
    }

    const planConfigs = await store.getPlanConfigs();
    const entitlements = resolveEntitlements({
      user: user ? { uid: user.uid, email: user.email } : null,
      subscription,
      planConfigs,
      creditPeriod,
    });

    return NextResponse.json(entitlements);
  } catch (error) {
    console.error('[Entitlements API]', error);
    return NextResponse.json({ error: 'Failed to resolve entitlements.' }, { status: 500 });
  }
}
