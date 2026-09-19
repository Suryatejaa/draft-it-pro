import { NextResponse } from 'next/server';
import { requireAdminUser } from '@/lib/entitlements/server-auth';
import { getEntitlementStore } from '@/lib/entitlements/store';
import { listFirebaseUsers } from '@/lib/firebase-admin';
import type { PlanId } from '@/lib/entitlements/types';

export async function GET(request: Request) {
  const routeStartedAt = performance.now();
  try {
    // 1. Verify admin authorization
    const authorizationStartedAt = performance.now();
    await requireAdminUser(request);
    const authorizationMs = performance.now() - authorizationStartedAt;

    const store = getEntitlementStore();

    // 2. Enumerate Firebase Auth users (authoritative source).
    //    Falls back to [] if Admin SDK credentials are not configured.
    const authStartedAt = performance.now();
    const authUsers = await listFirebaseUsers();
    const authMs = performance.now() - authStartedAt;

    // 3. LEFT JOIN: auth users + subscriptions + credit periods + usage aggregates.
    //    When authUsers.length === 0, the store falls back to subscription-only enumeration.
    const usersStartedAt = performance.now();
    const userAggregationPromise = (async () => {
      const startedAt = performance.now();
      const result = await store.getAdminUserAiUsageDetails(
        authUsers.length > 0 ? authUsers : undefined,
      );
      console.info('[admin-timing] users route user aggregation', {
        totalMs: Math.round(performance.now() - startedAt),
      });
      return result;
    })();
    const auditPromise = (async () => {
      const startedAt = performance.now();
      const result = await store.getAuditLogs();
      console.info('[admin-timing] users route audit logs', {
        totalMs: Math.round(performance.now() - startedAt),
      });
      return result;
    })();
    const [userDetails, auditLogs] = await Promise.all([
      userAggregationPromise,
      auditPromise,
    ]);
    const usersMs = performance.now() - usersStartedAt;
    console.info('[admin-timing] users route', {
      authorizationMs: Math.round(authorizationMs),
      firebaseListUsersMs: Math.round(authMs),
      firestoreUserAggregationMs: Math.round(usersMs),
      firestoreUserAndAuditMs: Math.round(usersMs),
      totalMs: Math.round(performance.now() - routeStartedAt),
      authUserCount: authUsers.length,
      resultUserCount: userDetails.length,
    });

    return NextResponse.json({
      users: userDetails,
      auditLogs,
    });
  } catch (error: any) {
    const status = error.statusCode || 500;
    return NextResponse.json(
      { error: error.message || 'Unauthorized or server error' },
      { status },
    );
  }
}

export async function POST(request: Request) {
  try {
    // 1. Verify admin authorization
    const admin = await requireAdminUser(request);
    const body = await request.json();
    const { action, targetUserId, planId, targetEmail } = body as {
      action: 'grant_plan' | 'suspend' | 'reactivate';
      targetUserId: string;
      planId?: PlanId;
      targetEmail?: string;
    };

    if (!targetUserId || !action) {
      return NextResponse.json(
        { error: 'Missing required parameters.' },
        { status: 400 },
      );
    }

    const store = getEntitlementStore();
    const adminUserId = admin.uid;
    const adminEmail = admin.email || 'unknown_admin';

    if (action === 'grant_plan') {
      const plans = await store.getPlanConfigs();
      if (!planId || !plans[planId]) {
        return NextResponse.json({ error: 'Invalid planId.' }, { status: 400 });
      }
      const updated = await store.grantPlan(
        targetUserId,
        planId,
        targetEmail,
        adminUserId,
        adminEmail,
      );
      return NextResponse.json({ ok: true, subscription: updated });
    }

    if (action === 'suspend') {
      const updated = await store.suspendUser(
        targetUserId,
        adminUserId,
        adminEmail,
      );
      return NextResponse.json({ ok: true, subscription: updated });
    }

    if (action === 'reactivate') {
      const updated = await store.reactivateUser(
        targetUserId,
        adminUserId,
        adminEmail,
      );
      return NextResponse.json({ ok: true, subscription: updated });
    }

    return NextResponse.json(
      { error: `Unknown action: ${action}` },
      { status: 400 },
    );
  } catch (error: any) {
    const status = error.statusCode || 500;
    return NextResponse.json(
      { error: error.message || 'Failed to execute user mutation' },
      { status },
    );
  }
}
