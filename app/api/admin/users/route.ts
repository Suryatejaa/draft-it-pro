import { NextResponse } from 'next/server';
import { requireAdminUser } from '@/lib/entitlements/server-auth';
import { getEntitlementStore } from '@/lib/entitlements/store';
import { listFirebaseUsers } from '@/lib/firebase-admin';
import type { PlanId } from '@/lib/entitlements/types';

export async function GET(request: Request) {
  try {
    // 1. Verify admin authorization
    await requireAdminUser(request);

    const store = getEntitlementStore();

    // 2. Enumerate Firebase Auth users (authoritative source).
    //    Falls back to [] if Admin SDK credentials are not configured.
    const authUsers = await listFirebaseUsers();

    // 3. LEFT JOIN: auth users + subscriptions + credit periods + usage aggregates.
    //    When authUsers.length === 0, the store falls back to subscription-only enumeration.
    const userDetails = await store.getAdminUserAiUsageDetails(authUsers.length > 0 ? authUsers : undefined);
    const auditLogs = await store.getAuditLogs();

    return NextResponse.json({
      users: userDetails,
      auditLogs,
    });
  } catch (error: any) {
    const status = error.statusCode || 500;
    return NextResponse.json(
      { error: error.message || 'Unauthorized or server error' },
      { status }
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
      return NextResponse.json({ error: 'Missing required parameters.' }, { status: 400 });
    }

    const store = getEntitlementStore();
    const adminUserId = admin.uid;
    const adminEmail = admin.email || 'unknown_admin';

    if (action === 'grant_plan') {
      if (!planId || !['free', 'plus', 'ai_plus'].includes(planId)) {
        return NextResponse.json({ error: 'Invalid planId.' }, { status: 400 });
      }
      const updated = await store.grantPlan(targetUserId, planId, targetEmail, adminUserId, adminEmail);
      return NextResponse.json({ ok: true, subscription: updated });
    }

    if (action === 'suspend') {
      const updated = await store.suspendUser(targetUserId, adminUserId, adminEmail);
      return NextResponse.json({ ok: true, subscription: updated });
    }

    if (action === 'reactivate') {
      const updated = await store.reactivateUser(targetUserId, adminUserId, adminEmail);
      return NextResponse.json({ ok: true, subscription: updated });
    }

    return NextResponse.json({ error: `Unknown action: ${action}` }, { status: 400 });
  } catch (error: any) {
    const status = error.statusCode || 500;
    return NextResponse.json(
      { error: error.message || 'Failed to execute user mutation' },
      { status }
    );
  }
}
