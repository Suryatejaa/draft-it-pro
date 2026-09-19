import { NextResponse } from 'next/server';
import { getAuthenticatedUser } from '@/lib/entitlements/server-auth';
import { AiCreditManager } from '@/lib/entitlements/credit-manager';
import { executeHostedChat } from '@/lib/ai/hosted-service';

export async function POST(request: Request) {
  try {
    const user = await getAuthenticatedUser(request);
    if (!user) {
      return NextResponse.json(
        { error: 'Authentication required to use hosted Co-Drafter AI.' },
        { status: 401 }
      );
    }
    const body = await request.json();
    const result = await executeHostedChat(body, user, new AiCreditManager());
    return NextResponse.json(result.body, {
      status: result.status,
      headers: result.creditReconciled
        ? { 'X-Hosted-Credit-Reconciled': 'true' }
        : undefined,
    });
  } catch (error: any) {
    const status = error.statusCode || 500;
    return NextResponse.json(
      { error: status >= 500 ? 'Hosted AI execution failed. Please try again shortly.' : error.message || 'Hosted AI execution failed.' },
      { status }
    );
  }
}
