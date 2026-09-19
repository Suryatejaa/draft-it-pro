import { NextResponse } from 'next/server';
import { getAuthenticatedUser } from '@/lib/entitlements/server-auth';
import { AiCreditManager } from '@/lib/entitlements/credit-manager';

export async function POST(request: Request) {
  const creditManager = new AiCreditManager();

  try {
    const user = await getAuthenticatedUser(request);
    if (!user) {
      return NextResponse.json(
        { error: 'Authentication required for hosted AI credits.' },
        { status: 401 }
      );
    }

    const body = await request.json();
    const {
      requestId = `req_${Date.now()}_${Math.random().toString(36).slice(2, 8)}`,
      model = 'sarvam-105b',
      maxTokens = 2048,
    } = body;

    const reservation = await creditManager.reserveCredit({
      userId: user.uid,
      requestId,
      model,
      maxTokens,
    });

    return NextResponse.json({
      authorized: true,
      reservation,
    });
  } catch (error: any) {
    const status = error.statusCode || 500;
    return NextResponse.json(
      { error: error.message || 'Credit authorization failed.' },
      { status }
    );
  }
}
