import { NextResponse } from 'next/server';
import { getEntitlementStore } from '@/lib/entitlements/store';
import { requireAdminUser } from '@/lib/entitlements/server-auth';

export async function GET(request: Request) {
  try {
    await requireAdminUser(request);
    const requests = await getEntitlementStore().listPendingPlanRequests();
    return NextResponse.json({ requests });
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
    const admin = await requireAdminUser(request);
    const body = (await request.json()) as {
      requestId?: string;
      action?: 'approve' | 'reject';
    };
    if (
      !body.requestId ||
      (body.action !== 'approve' && body.action !== 'reject')
    ) {
      return NextResponse.json(
        { error: 'requestId and a valid action are required.' },
        { status: 400 },
      );
    }
    const processed = await getEntitlementStore().processPlanRequest(
      body.requestId,
      body.action === 'approve' ? 'approved' : 'rejected',
      admin.uid,
      admin.email || 'unknown_admin',
    );
    return NextResponse.json({ request: processed });
  } catch (error: any) {
    const status = error.statusCode || 500;
    return NextResponse.json(
      { error: error.message || 'Could not process plan request.' },
      { status },
    );
  }
}
