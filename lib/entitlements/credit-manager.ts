import type { IEntitlementStore } from './store.ts';
import { getEntitlementStore } from './store.ts';
import { calculateModelCostPaise, estimateReservationCostPaise } from './pricing.ts';
import type { AiUsageRecord, PlanId } from './types.ts';

export interface ReserveCreditOptions {
  userId: string;
  requestId: string;
  model: string;
  maxTokens?: number;
}

export interface ReserveCreditResult {
  requestId: string;
  reservedPaise: number;
  periodId: string;
  planId: PlanId;
  budgetPaise: number;
  consumedPaise: number;
}

export interface CommitUsageOptions {
  userId: string;
  requestId: string;
  model: string;
  provider?: string;
  intent?: string;
  promptTokens: number;
  completionTokens: number;
  reservedPaise: number;
}

export interface CommitUsageResult {
  idempotent: boolean;
  totalCostPaise: number;
  inputCostPaise: number;
  outputCostPaise: number;
  promptTokens: number;
  completionTokens: number;
  totalTokens: number;
}

export class AiCreditManager {
  private store: IEntitlementStore;

  constructor(store: IEntitlementStore = getEntitlementStore()) {
    this.store = store;
  }

  /**
   * Pre-dispatch credit reservation with concurrency guard.
   * Atomically verifies active plan, Co-Drafter entitlement, and credit availability.
   */
  async reserveCredit({
    userId,
    requestId,
    model,
    maxTokens = 2048,
  }: ReserveCreditOptions): Promise<ReserveCreditResult> {
    if (!userId) {
      throw new Error('User authentication required for hosted AI inference.');
    }

    // 1. Resolve subscription
    const sub = await this.store.getSubscription(userId);
    const planId: PlanId = sub?.planId || 'free';

    // 2. Check suspension
    if (sub?.status === 'suspended') {
      const err = new Error('Your account is currently suspended. Hosted AI is disabled.');
      (err as unknown as { statusCode: number }).statusCode = 403;
      throw err;
    }

    // 3. Resolve plan config
    const planConfig = await this.store.getPlanConfig(planId);

    // 4. Verify Co-Drafter entitlement & budget
    if (!planConfig.features.includes('co_drafter') || planConfig.aiMonthlyBudgetPaise <= 0) {
      const err = new Error(
        'Hosted Sarvam AI credits require a Plus or AI Plus subscription. Please upgrade your plan.'
      );
      (err as unknown as { statusCode: number }).statusCode = 403;
      throw err;
    }

    // 5. Check if request was already processed
    if (await this.store.hasRequestId(requestId)) {
      throw new Error(`Request ${requestId} has already been processed.`);
    }

    // 6. Check credit period and available allowance
    let period = await this.store.getCreditPeriod(userId);
    const estimatedCost = estimateReservationCostPaise(model, maxTokens);
    let availablePaise = period.budgetPaise - (period.consumedPaise + period.reservedPaise);
    const atomicReservation = this.store.reserveCreditAtomically;
    if (atomicReservation) {
      try {
        period = await atomicReservation.call(this.store, userId, estimatedCost);
        availablePaise = period.budgetPaise - (period.consumedPaise + period.reservedPaise);
      } catch (error) {
        if ((error as { statusCode?: number }).statusCode === 429) {
          availablePaise = 0;
        } else {
          throw error;
        }
      }
    }
    if (process.env.NODE_ENV === 'development') {
      console.debug('[Hosted AI credit reservation]', {
        uid: userId,
        planId,
        subscriptionStatus: sub?.status || 'active',
        currentPeriodStart: sub?.currentPeriodStart || null,
        currentPeriodEnd: sub?.currentPeriodEnd || null,
        resolvedPlanBudgetPaise: planConfig.aiMonthlyBudgetPaise,
        creditPeriodBudgetPaise: period.budgetPaise,
        consumedPaise: period.consumedPaise,
        reservedPaise: period.reservedPaise,
        availablePaise,
        requestedReservationPaise: estimatedCost,
        reservationDecision: availablePaise >= estimatedCost ? 'allow' : 'credit_exhausted',
      });
    }

    if (availablePaise <= 0 || availablePaise < estimatedCost) {
      const err = new Error(
        'Your monthly AI credit allowance is exhausted. Next credits will refresh on your reset date.'
      );
      (err as unknown as { statusCode: number }).statusCode = 429;
      throw err;
    }

    // 7. Atomically hold the reservation
    // 7. Hold the reservation. Firestore uses a transaction; explicit test
    // stores retain their existing deterministic in-memory behavior.
    if (!atomicReservation) {
      period.reservedPaise += estimatedCost;
      await this.store.saveCreditPeriod(period);
    }

    return {
      requestId,
      reservedPaise: estimatedCost,
      periodId: period.id,
      planId,
      budgetPaise: period.budgetPaise,
      consumedPaise: period.consumedPaise,
    };
  }

  /**
   * Post-dispatch usage commit.
   * Calculates exact cost from server-recorded tokens, releases reservation,
   * and appends to the immutable usage ledger.
   */
  async commitCreditUsage({
    userId,
    requestId,
    model,
    provider = 'sarvam',
    intent = 'general',
    promptTokens,
    completionTokens,
    reservedPaise,
  }: CommitUsageOptions): Promise<CommitUsageResult> {
    // Idempotency check: if already processed, return immediately without re-charging
    if (await this.store.hasRequestId(requestId)) {
      const history = await this.store.getAiUsageHistory(userId);
      const existing = history.find((r) => r.requestId === requestId);
      if (existing) {
        return {
          idempotent: true,
          totalCostPaise: existing.totalCostPaise,
          inputCostPaise: existing.inputCostPaise,
          outputCostPaise: existing.outputCostPaise,
          promptTokens: existing.promptTokens,
          completionTokens: existing.completionTokens,
          totalTokens: existing.totalTokens,
        };
      }
    }

    const { inputCostPaise, outputCostPaise, totalCostPaise } = calculateModelCostPaise(
      model,
      promptTokens,
      completionTokens
    );

    const period = await this.store.getCreditPeriod(userId);

    // Release reservation and commit consumed paise
    period.reservedPaise = Math.max(0, period.reservedPaise - reservedPaise);
    period.consumedPaise += totalCostPaise;
    await this.store.saveCreditPeriod(period);

    // Append to immutable ledger
    const usageRecord: AiUsageRecord = {
      id: `usage_${Date.now()}_${Math.random().toString(36).slice(2, 8)}`,
      userId,
      requestId,
      provider,
      model,
      intent,
      promptTokens,
      completionTokens,
      totalTokens: promptTokens + completionTokens,
      inputCostPaise,
      outputCostPaise,
      totalCostPaise,
      billingPeriodKey: period.id,
      createdAt: new Date().toISOString(),
    };

    await this.store.appendAiUsage(usageRecord);

    return {
      idempotent: false,
      totalCostPaise,
      inputCostPaise,
      outputCostPaise,
      promptTokens,
      completionTokens,
      totalTokens: promptTokens + completionTokens,
    };
  }

  /**
   * Release reservation when a provider call fails or is aborted.
   */
  async releaseReservation(userId: string, reservedPaise: number): Promise<void> {
    if (reservedPaise <= 0) return;
    try {
      const period = await this.store.getCreditPeriod(userId);
      period.reservedPaise = Math.max(0, period.reservedPaise - reservedPaise);
      await this.store.saveCreditPeriod(period);
    } catch {
      // Ignore release errors on cancelled sessions
    }
  }
}
