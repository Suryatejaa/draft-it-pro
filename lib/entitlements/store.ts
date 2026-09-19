import type {
  PlanConfig,
  PlanId,
  DiscountConfig,
  PlanRequest,
  UserSubscriptionRecord,
  AiUsageRecord,
  AiCreditPeriod,
  AdminAuditEvent,
  AdminUserAiUsageDetail,
  EnumerableAuthUser,
  SubscriptionStatus,
} from './types.ts';
import {
  DEFAULT_PLAN_CONFIGS,
  FREE_PLAN_ID,
  validatePlanConfig,
} from './plans.ts';
import { isUserAdmin } from './admin.ts';
import { FirestoreEntitlementStore } from './firestore-store.ts';

export interface IEntitlementStore {
  // Plan Configurations
  getPlanConfigs(): Promise<Record<PlanId, PlanConfig>>;
  getPlanConfig(planId: PlanId): Promise<PlanConfig>;
  createPlanConfig(
    plan: PlanConfig,
    adminUserId: string,
    adminEmail: string,
  ): Promise<PlanConfig>;
  updatePlanConfig(
    planId: PlanId,
    updates: Partial<PlanConfig>,
    adminUserId: string,
    adminEmail: string,
  ): Promise<PlanConfig>;
  deletePlanConfig(
    planId: PlanId,
    adminUserId: string,
    adminEmail: string,
  ): Promise<void>;

  // Subscriptions
  getSubscription(userId: string): Promise<UserSubscriptionRecord | null>;
  saveSubscription(subscription: UserSubscriptionRecord): Promise<void>;
  grantPlan(
    userId: string,
    planId: PlanId,
    email: string | undefined,
    adminUserId: string,
    adminEmail: string,
  ): Promise<UserSubscriptionRecord>;
  updateSubscription(
    userId: string,
    updates: {
      planId?: PlanId;
      status?: SubscriptionStatus;
      currentPeriodStart?: string;
      currentPeriodEnd?: string;
    },
    adminUserId: string,
    adminEmail: string,
  ): Promise<UserSubscriptionRecord>;
  extendSubscription(
    targetUserId: string,
    days: number,
    adminUserId: string,
    adminEmail: string,
  ): Promise<UserSubscriptionRecord>;
  resetAiCredits(
    targetUserId: string,
    adminUserId: string,
    adminEmail: string,
  ): Promise<AiCreditPeriod>;
  suspendUser(
    userId: string,
    adminUserId: string,
    adminEmail: string,
  ): Promise<UserSubscriptionRecord>;
  reactivateUser(
    userId: string,
    adminUserId: string,
    adminEmail: string,
  ): Promise<UserSubscriptionRecord>;
  listAllSubscriptions(): Promise<UserSubscriptionRecord[]>;

  // Discounts
  getDiscounts(): Promise<DiscountConfig[]>;
  createDiscount(
    discount: Omit<DiscountConfig, 'id' | 'createdAt' | 'updatedAt'>,
    adminUserId: string,
    adminEmail: string,
  ): Promise<DiscountConfig>;
  deleteDiscount(
    id: string,
    adminUserId: string,
    adminEmail: string,
  ): Promise<void>;
  updateDiscount(
    id: string,
    updates: Partial<DiscountConfig>,
    adminUserId: string,
    adminEmail: string,
  ): Promise<DiscountConfig>;
  toggleDiscount(
    id: string,
    enabled: boolean,
    adminUserId: string,
    adminEmail: string,
  ): Promise<DiscountConfig>;

  // Paid plan requests
  createPlanRequest(
    request: Omit<PlanRequest, 'id' | 'status' | 'createdAt'>,
  ): Promise<PlanRequest>;
  getPendingPlanRequest(
    uid: string,
    requestedPlanId: Exclude<PlanId, 'free'>,
  ): Promise<PlanRequest | null>;
  listPendingPlanRequestsForUser(uid: string): Promise<PlanRequest[]>;
  listPendingPlanRequests(): Promise<PlanRequest[]>;
  processPlanRequest(
    id: string,
    status: 'approved' | 'rejected',
    adminUserId: string,
    adminEmail: string,
  ): Promise<PlanRequest>;

  // AI Credit Periods
  getCreditPeriod(userId: string, now?: Date): Promise<AiCreditPeriod>;
  saveCreditPeriod(period: AiCreditPeriod): Promise<void>;
  reserveCreditAtomically?(
    userId: string,
    requestedPaise: number,
  ): Promise<AiCreditPeriod>;

  // AI Usage Ledger (Append-Only)
  appendAiUsage(record: AiUsageRecord): Promise<void>;
  hasRequestId(requestId: string): Promise<boolean>;
  getAiUsageHistory(userId?: string): Promise<AiUsageRecord[]>;
  getAdminUserAiUsageDetails(
    authUsers?: EnumerableAuthUser[],
  ): Promise<AdminUserAiUsageDetail[]>;

  // User Registry (Registered Firebase Auth users)
  registerUser(user: EnumerableAuthUser): Promise<void>;
  listRegisteredUsers(): Promise<EnumerableAuthUser[]>;

  // Audit Log
  appendAuditLog(
    event: Omit<AdminAuditEvent, 'id' | 'timestamp'>,
  ): Promise<AdminAuditEvent>;
  getAuditLogs(): Promise<AdminAuditEvent[]>;

  // Testing / Reset
  clear(): void;
}

function addOneMonth(isoDateStr: string): string {
  const d = new Date(isoDateStr);
  d.setMonth(d.getMonth() + 1);
  return d.toISOString();
}

function creditPeriodKey(userId: string, periodStart: string): string {
  return `${userId}_${periodStart.slice(0, 10)}`;
}

/**
 * Memory-backed Entitlement Store with atomic updates,
 * matching Firestore collection semantics for unit/regression tests and local environments.
 */
export class InMemoryEntitlementStore implements IEntitlementStore {
  private plans: Record<PlanId, PlanConfig> = { ...DEFAULT_PLAN_CONFIGS };
  private subscriptions: Map<string, UserSubscriptionRecord> = new Map();
  private discounts: Map<string, DiscountConfig> = new Map();
  private planRequests: Map<string, PlanRequest> = new Map();
  private creditPeriods: Map<string, AiCreditPeriod> = new Map();
  private usageLedger: Map<string, AiUsageRecord> = new Map();
  private auditLog: AdminAuditEvent[] = [];
  private processedRequestIds: Set<string> = new Set();
  private registeredUsers: Map<string, EnumerableAuthUser> = new Map();

  clear(): void {
    this.plans = { ...DEFAULT_PLAN_CONFIGS };
    this.subscriptions.clear();
    this.discounts.clear();
    this.planRequests.clear();
    this.creditPeriods.clear();
    this.usageLedger.clear();
    this.auditLog = [];
    this.processedRequestIds.clear();
    this.registeredUsers.clear();
  }

  async getPlanConfigs(): Promise<Record<PlanId, PlanConfig>> {
    return { ...this.plans };
  }

  async getPlanConfig(planId: PlanId): Promise<PlanConfig> {
    return (
      this.plans[planId] ||
      DEFAULT_PLAN_CONFIGS[planId] ||
      DEFAULT_PLAN_CONFIGS.free
    );
  }

  async createPlanConfig(
    plan: PlanConfig,
    adminUserId: string,
    adminEmail: string,
  ): Promise<PlanConfig> {
    if (this.plans[plan.id])
      throw new Error('A plan with this ID already exists.');
    const validation = validatePlanConfig(plan, this.plans);
    if (!validation.valid) throw new Error(validation.error);
    const created = {
      ...plan,
      createdAt: plan.createdAt || new Date().toISOString(),
      updatedAt: new Date().toISOString(),
    };
    this.plans[plan.id] = created;
    await this.appendAuditLog({
      actorAdminUserId: adminUserId,
      actorAdminEmail: adminEmail,
      targetUserId: `plan_${plan.id}`,
      action: 'create_plan',
      previousValue: null,
      newValue: created,
    });
    return created;
  }

  async updatePlanConfig(
    planId: PlanId,
    updates: Partial<PlanConfig>,
    adminUserId: string,
    adminEmail: string,
  ): Promise<PlanConfig> {
    if (planId === FREE_PLAN_ID && updates.active === false) {
      throw new Error('The Free plan must remain active.');
    }
    const existing = this.plans[planId];
    if (!existing) throw new Error('Plan not found.');
    const updated: PlanConfig = {
      ...existing,
      ...updates,
      id: planId,
      updatedAt: new Date().toISOString(),
    };
    const validation = validatePlanConfig(updated, this.plans);
    if (!validation.valid) throw new Error(validation.error);
    this.plans[planId] = updated;

    await this.appendAuditLog({
      actorAdminUserId: adminUserId,
      actorAdminEmail: adminEmail,
      targetUserId: `plan_${planId}`,
      action: 'update_plan',
      previousValue: existing,
      newValue: updated,
    });

    return updated;
  }

  async deletePlanConfig(
    planId: PlanId,
    adminUserId: string,
    adminEmail: string,
  ): Promise<void> {
    if (planId === FREE_PLAN_ID)
      throw new Error('The Free plan cannot be deleted.');
    if (!this.plans[planId]) throw new Error('Plan not found.');
    const referenced =
      [...this.subscriptions.values()].some((item) => item.planId === planId) ||
      [...this.creditPeriods.values()].some((item) => item.planId === planId) ||
      [...this.planRequests.values()].some(
        (item) =>
          item.requestedPlanId === planId || item.currentPlanId === planId,
      ) ||
      [...this.discounts.values()].some((item) =>
        item.applicablePlanIds.includes(planId),
      ) ||
      this.auditLog.some(
        (event) =>
          event.targetUserId !== `plan_${planId}` &&
          JSON.stringify(event).includes(`"${planId}"`),
      );
    if (referenced) throw new Error('Referenced plans can only be archived.');
    const previous = this.plans[planId];
    delete this.plans[planId];
    await this.appendAuditLog({
      actorAdminUserId: adminUserId,
      actorAdminEmail: adminEmail,
      targetUserId: `plan_${planId}`,
      action: 'delete_plan',
      previousValue: previous,
      newValue: null,
    });
  }

  async getSubscription(
    userId: string,
  ): Promise<UserSubscriptionRecord | null> {
    return this.subscriptions.get(userId) || null;
  }

  async saveSubscription(subscription: UserSubscriptionRecord): Promise<void> {
    this.subscriptions.set(subscription.userId, { ...subscription });
  }

  async grantPlan(
    userId: string,
    planId: PlanId,
    email?: string,
    adminUserId = 'system',
    adminEmail = 'system@draftit.pro',
  ): Promise<UserSubscriptionRecord> {
    const existing = await this.getSubscription(userId);
    const now = new Date();
    const periodStart = existing?.currentPeriodStart || now.toISOString();
    const periodEnd = existing?.currentPeriodEnd || addOneMonth(periodStart);

    const updated: UserSubscriptionRecord = {
      userId,
      email: email || existing?.email,
      planId,
      status: existing?.status || 'active',
      subscriptionSource: planId === 'free' ? 'free' : 'admin_grant',
      currentPeriodStart: periodStart,
      currentPeriodEnd: periodEnd,
      createdAt: existing?.createdAt || now.toISOString(),
      updatedAt: now.toISOString(),
    };

    this.subscriptions.set(userId, updated);

    // Sync the active period allowance without resetting usage or reservations.
    const planConfig = await this.getPlanConfig(planId);
    const period = await this.getCreditPeriod(userId);
    period.planId = planId;
    period.periodStart = periodStart;
    period.periodEnd = periodEnd;
    period.budgetPaise = planConfig.aiMonthlyBudgetPaise;
    await this.saveCreditPeriod(period);

    await this.appendAuditLog({
      actorAdminUserId: adminUserId,
      actorAdminEmail: adminEmail,
      targetUserId: userId,
      action: 'grant_plan',
      previousValue: existing
        ? { planId: existing.planId, status: existing.status }
        : null,
      newValue: {
        planId,
        status: updated.status,
        allowancePaise: planConfig.aiMonthlyBudgetPaise,
      },
    });

    return updated;
  }

  async suspendUser(
    userId: string,
    adminUserId: string,
    adminEmail: string,
  ): Promise<UserSubscriptionRecord> {
    let sub = await this.getSubscription(userId);
    const now = new Date();
    if (!sub) {
      // Default to Free if not registered
      sub = {
        userId,
        planId: 'free',
        status: 'active',
        subscriptionSource: 'free',
        currentPeriodStart: now.toISOString(),
        currentPeriodEnd: addOneMonth(now.toISOString()),
        createdAt: now.toISOString(),
        updatedAt: now.toISOString(),
      };
    }

    const previousStatus = sub.status;
    const updated: UserSubscriptionRecord = {
      ...sub,
      status: 'suspended',
      updatedAt: now.toISOString(),
    };
    this.subscriptions.set(userId, updated);

    await this.appendAuditLog({
      actorAdminUserId: adminUserId,
      actorAdminEmail: adminEmail,
      targetUserId: userId,
      action: 'suspend',
      previousValue: previousStatus,
      newValue: 'suspended',
    });

    return updated;
  }

  async reactivateUser(
    userId: string,
    adminUserId: string,
    adminEmail: string,
  ): Promise<UserSubscriptionRecord> {
    const sub = await this.getSubscription(userId);
    const now = new Date();
    if (!sub) {
      throw new Error(`User subscription not found for ${userId}`);
    }

    const previousStatus = sub.status;
    const updated: UserSubscriptionRecord = {
      ...sub,
      status: 'active',
      updatedAt: now.toISOString(),
    };
    this.subscriptions.set(userId, updated);

    await this.appendAuditLog({
      actorAdminUserId: adminUserId,
      actorAdminEmail: adminEmail,
      targetUserId: userId,
      action: 'reactivate',
      previousValue: previousStatus,
      newValue: 'active',
    });

    return updated;
  }

  async updateSubscription(
    userId: string,
    updates: {
      planId?: PlanId;
      status?: SubscriptionStatus;
      currentPeriodStart?: string;
      currentPeriodEnd?: string;
    },
    adminUserId: string,
    adminEmail: string,
  ): Promise<UserSubscriptionRecord> {
    const existing = await this.getSubscription(userId);
    const now = new Date();
    const periodStart =
      updates.currentPeriodStart ||
      existing?.currentPeriodStart ||
      now.toISOString();
    const periodEnd =
      updates.currentPeriodEnd ||
      existing?.currentPeriodEnd ||
      addOneMonth(periodStart);

    if (isNaN(new Date(periodStart).getTime())) {
      throw new Error('Invalid currentPeriodStart date.');
    }
    if (isNaN(new Date(periodEnd).getTime())) {
      throw new Error('Invalid currentPeriodEnd date.');
    }
    if (new Date(periodEnd).getTime() <= new Date(periodStart).getTime()) {
      throw new Error('Subscription end date must be after start date.');
    }

    const previousPlanId = existing?.planId || 'free';
    const newPlanId = updates.planId || previousPlanId;
    const newStatus = updates.status || existing?.status || 'active';

    const updated: UserSubscriptionRecord = {
      userId,
      email: existing?.email,
      planId: newPlanId,
      status: newStatus,
      subscriptionSource: existing?.subscriptionSource || 'admin_grant',
      currentPeriodStart: periodStart,
      currentPeriodEnd: periodEnd,
      createdAt: existing?.createdAt || now.toISOString(),
      updatedAt: now.toISOString(),
    };
    this.subscriptions.set(userId, updated);

    // Rule 10: Plan change + AI allowance reconciliation
    if (newPlanId !== previousPlanId) {
      const planConfig = await this.getPlanConfig(newPlanId);
      const period = await this.getCreditPeriod(userId);
      period.planId = newPlanId;
      period.budgetPaise = planConfig.aiMonthlyBudgetPaise;
      await this.saveCreditPeriod(period);
      period.periodEnd = periodEnd;
      await this.saveCreditPeriod(period);
    } else if (updates.currentPeriodEnd) {
      const period = await this.getCreditPeriod(userId);
      period.periodEnd = periodEnd;
      await this.saveCreditPeriod(period);
    }

    await this.appendAuditLog({
      actorAdminUserId: adminUserId,
      actorAdminEmail: adminEmail,
      targetUserId: userId,
      action: 'update_subscription',
      previousValue: existing
        ? {
            planId: existing.planId,
            status: existing.status,
            currentPeriodStart: existing.currentPeriodStart,
            currentPeriodEnd: existing.currentPeriodEnd,
          }
        : {
            planId: 'free',
            status: 'active',
            currentPeriodStart: periodStart,
            currentPeriodEnd: periodEnd,
          },
      newValue: {
        planId: updated.planId,
        status: updated.status,
        currentPeriodStart: updated.currentPeriodStart,
        currentPeriodEnd: updated.currentPeriodEnd,
      },
    });

    return updated;
  }

  async extendSubscription(
    targetUserId: string,
    days: number,
    adminUserId: string,
    adminEmail: string,
  ): Promise<UserSubscriptionRecord> {
    if (
      !days ||
      typeof days !== 'number' ||
      days <= 0 ||
      !Number.isFinite(days)
    ) {
      throw new Error('Extension days must be a positive integer.');
    }
    const existing = await this.getSubscription(targetUserId);
    const now = new Date();
    const sub: UserSubscriptionRecord = existing || {
      userId: targetUserId,
      planId: 'free',
      status: 'active',
      subscriptionSource: 'free',
      currentPeriodStart: now.toISOString(),
      currentPeriodEnd: addOneMonth(now.toISOString()),
      createdAt: now.toISOString(),
      updatedAt: now.toISOString(),
    };

    const oldPeriodEnd = sub.currentPeriodEnd;
    const oldEndDate = new Date(oldPeriodEnd);
    // If currentPeriodEnd is already expired and admin chooses "extend 30 days",
    // prefer extending from max(now, currentPeriodEnd).
    const baseTime =
      oldEndDate.getTime() > now.getTime()
        ? oldEndDate.getTime()
        : now.getTime();
    const newEndDate = new Date(
      baseTime + Math.round(days) * 24 * 60 * 60 * 1000,
    );
    const newPeriodEnd = newEndDate.toISOString();

    const updated: UserSubscriptionRecord = {
      ...sub,
      currentPeriodEnd: newPeriodEnd,
      updatedAt: now.toISOString(),
    };
    this.subscriptions.set(targetUserId, updated);

    // Keep credit period end date synchronized with subscription end date without altering usage
    const creditPeriod = await this.getCreditPeriod(targetUserId);
    creditPeriod.periodEnd = newPeriodEnd;
    await this.saveCreditPeriod(creditPeriod);

    await this.appendAuditLog({
      actorAdminUserId: adminUserId,
      actorAdminEmail: adminEmail,
      targetUserId,
      action: 'extend_subscription',
      previousValue: { currentPeriodEnd: oldPeriodEnd },
      newValue: { currentPeriodEnd: newPeriodEnd, days },
    });

    return updated;
  }

  async resetAiCredits(
    targetUserId: string,
    adminUserId: string,
    adminEmail: string,
  ): Promise<AiCreditPeriod> {
    const sub = await this.getSubscription(targetUserId);
    const planId = sub?.planId || 'free';
    const planConfig = await this.getPlanConfig(planId);
    const oldPeriod = await this.getCreditPeriod(targetUserId);

    const now = new Date();
    const newPeriodId = creditPeriodKey(targetUserId, now.toISOString());
    const newPeriod: AiCreditPeriod = {
      id: newPeriodId,
      userId: targetUserId,
      planId,
      periodStart: now.toISOString(),
      periodEnd: sub?.currentPeriodEnd || addOneMonth(now.toISOString()),
      budgetPaise: planConfig.aiMonthlyBudgetPaise,
      consumedPaise: 0,
      reservedPaise: 0,
      updatedAt: now.toISOString(),
    };
    this.creditPeriods.set(newPeriodId, newPeriod);

    await this.appendAuditLog({
      actorAdminUserId: adminUserId,
      actorAdminEmail: adminEmail,
      targetUserId,
      action: 'reset_ai_credits',
      previousValue: {
        id: oldPeriod.id,
        budgetPaise: oldPeriod.budgetPaise,
        consumedPaise: oldPeriod.consumedPaise,
      },
      newValue: {
        id: newPeriod.id,
        budgetPaise: newPeriod.budgetPaise,
        consumedPaise: 0,
      },
    });

    return newPeriod;
  }

  async listAllSubscriptions(): Promise<UserSubscriptionRecord[]> {
    return Array.from(this.subscriptions.values());
  }

  async getDiscounts(): Promise<DiscountConfig[]> {
    return Array.from(this.discounts.values()).sort((a, b) =>
      (b.createdAt || '').localeCompare(a.createdAt || ''),
    );
  }

  async createDiscount(
    discount: Omit<DiscountConfig, 'id' | 'createdAt' | 'updatedAt'>,
    adminUserId: string,
    adminEmail: string,
  ): Promise<DiscountConfig> {
    const id = `disc_${Date.now()}_${Math.random().toString(36).slice(2, 7)}`;
    const latestCreatedAt = Math.max(
      0,
      ...Array.from(this.discounts.values()).map((item) =>
        new Date(item.createdAt || 0).getTime(),
      ),
    );
    const now = new Date(
      Math.max(Date.now(), latestCreatedAt + 1),
    ).toISOString();
    const created: DiscountConfig = {
      ...discount,
      id,
      createdAt: now,
      updatedAt: now,
    };
    this.discounts.set(id, created);

    await this.appendAuditLog({
      actorAdminUserId: adminUserId,
      actorAdminEmail: adminEmail,
      targetUserId: `discount_${id}`,
      action: 'create_discount',
      previousValue: null,
      newValue: created,
    });

    return created;
  }

  async updateDiscount(
    id: string,
    updates: Partial<DiscountConfig>,
    adminUserId: string,
    adminEmail: string,
  ): Promise<DiscountConfig> {
    const existing = this.discounts.get(id);
    if (!existing) throw new Error(`Discount ${id} not found.`);

    const updated: DiscountConfig = {
      ...existing,
      ...updates,
      id,
      updatedAt: new Date().toISOString(),
    };
    this.discounts.set(id, updated);

    await this.appendAuditLog({
      actorAdminUserId: adminUserId,
      actorAdminEmail: adminEmail,
      targetUserId: `discount_${id}`,
      action: 'update_discount',
      previousValue: existing,
      newValue: updated,
    });

    return updated;
  }

  async toggleDiscount(
    id: string,
    enabled: boolean,
    adminUserId: string,
    adminEmail: string,
  ): Promise<DiscountConfig> {
    const existing = this.discounts.get(id);
    if (!existing) throw new Error(`Discount ${id} not found.`);

    const updated: DiscountConfig = {
      ...existing,
      enabled,
      updatedAt: new Date().toISOString(),
    };
    this.discounts.set(id, updated);

    await this.appendAuditLog({
      actorAdminUserId: adminUserId,
      actorAdminEmail: adminEmail,
      targetUserId: `discount_${id}`,
      action: 'toggle_discount',
      previousValue: existing.enabled,
      newValue: enabled,
    });

    return updated;
  }

  async deleteDiscount(
    id: string,
    adminUserId: string,
    adminEmail: string,
  ): Promise<void> {
    const existing = this.discounts.get(id);
    if (!existing) throw new Error(`Discount ${id} not found.`);
    if (
      this.auditLog.some(
        (event) =>
          event.targetUserId !== `discount_${id}` &&
          JSON.stringify(event).includes(`"${id}"`),
      )
    ) {
      throw new Error(
        'Discount is referenced by audit history and can only be disabled.',
      );
    }
    this.discounts.delete(id);
    await this.appendAuditLog({
      actorAdminUserId: adminUserId,
      actorAdminEmail: adminEmail,
      targetUserId: `discount_${id}`,
      action: 'delete_discount',
      previousValue: existing,
      newValue: null,
    });
  }

  async createPlanRequest(
    request: Omit<PlanRequest, 'id' | 'status' | 'createdAt'>,
  ): Promise<PlanRequest> {
    const duplicate = await this.getPendingPlanRequest(
      request.uid,
      request.requestedPlanId,
    );
    if (duplicate) return duplicate;
    const created: PlanRequest = {
      ...request,
      id: `plan_request_${Date.now()}_${Math.random().toString(36).slice(2, 8)}`,
      status: 'pending',
      createdAt: new Date().toISOString(),
    };
    this.planRequests.set(created.id, created);
    return created;
  }

  async getPendingPlanRequest(
    uid: string,
    requestedPlanId: Exclude<PlanId, 'free'>,
  ): Promise<PlanRequest | null> {
    return (
      Array.from(this.planRequests.values()).find(
        (request) =>
          request.uid === uid &&
          request.requestedPlanId === requestedPlanId &&
          request.status === 'pending',
      ) || null
    );
  }

  async listPendingPlanRequestsForUser(uid: string): Promise<PlanRequest[]> {
    return Array.from(this.planRequests.values()).filter(
      (request) => request.uid === uid && request.status === 'pending',
    );
  }

  async listPendingPlanRequests(): Promise<PlanRequest[]> {
    return Array.from(this.planRequests.values())
      .filter((request) => request.status === 'pending')
      .sort((a, b) => b.createdAt.localeCompare(a.createdAt));
  }

  async processPlanRequest(
    id: string,
    status: 'approved' | 'rejected',
    adminUserId: string,
    adminEmail: string,
  ): Promise<PlanRequest> {
    const request = this.planRequests.get(id);
    if (!request) throw new Error('Plan request not found.');
    if (request.status !== 'pending')
      throw new Error('Plan request has already been processed.');
    if (status === 'approved') {
      const plan = await this.getPlanConfig(request.requestedPlanId);
      if (
        plan.id !== request.requestedPlanId ||
        !plan.active ||
        plan.id === 'free' ||
        plan.monthlyPricePaise <= 0
      ) {
        throw new Error('The requested plan is no longer available.');
      }
      await this.updateSubscription(
        request.uid,
        { planId: request.requestedPlanId },
        adminUserId,
        adminEmail,
      );
    }
    const processed = {
      ...request,
      status,
      processedAt: new Date().toISOString(),
      processedBy: adminUserId,
    } as PlanRequest;
    this.planRequests.set(id, processed);
    await this.appendAuditLog({
      actorAdminUserId: adminUserId,
      actorAdminEmail: adminEmail,
      targetUserId: request.uid,
      action:
        status === 'approved' ? 'approve_plan_request' : 'reject_plan_request',
      previousValue: request,
      newValue: processed,
    });
    return processed;
  }

  async getCreditPeriod(
    userId: string,
    now: Date = new Date(),
  ): Promise<AiCreditPeriod> {
    const sub = await this.getSubscription(userId);
    const planConfig = await this.getPlanConfig(sub?.planId || 'free');

    let periodStart = sub?.currentPeriodStart;
    let periodEnd = sub?.currentPeriodEnd;

    // Check if subscription or period needs establishing
    if (!periodStart || !periodEnd) {
      periodStart = now.toISOString();
      periodEnd = addOneMonth(periodStart);
      if (sub) {
        sub.currentPeriodStart = periodStart;
        sub.currentPeriodEnd = periodEnd;
        this.subscriptions.set(userId, sub);
      }
    }

    // Check if period has expired -> roll period forward
    while (now.getTime() >= new Date(periodEnd).getTime()) {
      periodStart = periodEnd;
      periodEnd = addOneMonth(periodStart);
      if (sub) {
        sub.currentPeriodStart = periodStart;
        sub.currentPeriodEnd = periodEnd;
        sub.updatedAt = now.toISOString();
        this.subscriptions.set(userId, sub);
      }
    }

    const periodKey = creditPeriodKey(userId, periodStart);
    let period = this.creditPeriods.get(periodKey);

    if (!period) {
      period = {
        id: periodKey,
        userId,
        planId: sub?.planId || 'free',
        periodStart,
        periodEnd,
        budgetPaise: planConfig.aiMonthlyBudgetPaise,
        consumedPaise: 0,
        reservedPaise: 0,
        updatedAt: now.toISOString(),
      };
      this.creditPeriods.set(periodKey, period);
    } else if (period.planId && period.planId !== (sub?.planId || 'free')) {
      // Plan transitions update the allowance without resetting usage.
      period = {
        ...period,
        planId: sub?.planId || 'free',
        budgetPaise: planConfig.aiMonthlyBudgetPaise,
        periodStart,
        periodEnd,
        updatedAt: now.toISOString(),
      };
      this.creditPeriods.set(periodKey, period);
    } else if (
      !period.planId &&
      period.budgetPaise === 0 &&
      planConfig.aiMonthlyBudgetPaise > 0
    ) {
      // Repair legacy Free periods created before planId was persisted.
      period = {
        ...period,
        planId: sub?.planId || 'free',
        budgetPaise: planConfig.aiMonthlyBudgetPaise,
        periodStart,
        periodEnd,
        updatedAt: now.toISOString(),
      };
      this.creditPeriods.set(periodKey, period);
    }

    return period;
  }

  async saveCreditPeriod(period: AiCreditPeriod): Promise<void> {
    this.creditPeriods.set(period.id, {
      ...period,
      updatedAt: new Date().toISOString(),
    });
  }

  async appendAiUsage(record: AiUsageRecord): Promise<void> {
    if (this.processedRequestIds.has(record.requestId)) {
      // Idempotent guard
      return;
    }
    this.processedRequestIds.add(record.requestId);
    this.usageLedger.set(record.id, { ...record });
  }

  async hasRequestId(requestId: string): Promise<boolean> {
    return this.processedRequestIds.has(requestId);
  }

  async getAiUsageHistory(userId?: string): Promise<AiUsageRecord[]> {
    const all = Array.from(this.usageLedger.values());
    if (userId) {
      return all.filter((r) => r.userId === userId);
    }
    return all;
  }

  async getAdminUserAiUsageDetails(
    authUsers?: EnumerableAuthUser[],
  ): Promise<AdminUserAiUsageDetail[]> {
    const details: AdminUserAiUsageDetail[] = [];
    const now = new Date();

    // Build a subscription index for O(1) lookup
    const subMap = new Map<
      string,
      import('./types.ts').UserSubscriptionRecord
    >();
    for (const sub of await this.listAllSubscriptions()) {
      subMap.set(sub.userId, sub);
    }

    // -----------------------------------------------------------------------
    // PRIMARY path: enumerate Firebase Auth users (authoritative left table)
    // -----------------------------------------------------------------------
    if (authUsers && authUsers.length > 0) {
      for (const authUser of authUsers) {
        const sub = subMap.get(authUser.uid);
        const periodStart = sub?.currentPeriodStart || now.toISOString();
        const periodEnd = sub?.currentPeriodEnd || addOneMonth(periodStart);
        const planId = sub?.planId || 'free';
        const planConfig = await this.getPlanConfig(planId);

        const period = await this.getCreditPeriod(authUser.uid, now);

        const usageRecords = (
          await this.getAiUsageHistory(authUser.uid)
        ).filter(
          (r) =>
            new Date(r.createdAt) >= new Date(period.periodStart) &&
            new Date(r.createdAt) <= new Date(period.periodEnd),
        );

        const promptTokens = usageRecords.reduce(
          (acc, r) => acc + r.promptTokens,
          0,
        );
        const completionTokens = usageRecords.reduce(
          (acc, r) => acc + r.completionTokens,
          0,
        );
        const totalTokens = promptTokens + completionTokens;
        const consumedPaise = period.consumedPaise;
        const remainingPaise = Math.max(0, period.budgetPaise - consumedPaise);

        const lastAiRecord = [...usageRecords].sort(
          (a, b) =>
            new Date(b.createdAt).getTime() - new Date(a.createdAt).getTime(),
        )[0];

        details.push({
          userId: authUser.uid,
          email: authUser.email ?? sub?.email,
          displayName: authUser.displayName ?? undefined,
          photoURL: authUser.photoURL ?? undefined,
          disabled: authUser.disabled,
          creationTime: authUser.creationTime ?? undefined,
          lastSignInTime: authUser.lastSignInTime ?? undefined,
          isAdmin: isUserAdmin(authUser.email),
          planId,
          status: sub?.status || 'active',
          subscriptionSource: sub?.subscriptionSource,
          currentPeriodStart: periodStart,
          currentPeriodEnd: periodEnd,
          promptTokens,
          completionTokens,
          totalTokens,
          budgetPaise: period.budgetPaise,
          consumedPaise,
          remainingPaise,
          estimatedInrCost: consumedPaise / 100,
          lastAiRequestAt: lastAiRecord?.createdAt || null,
          requestCount: usageRecords.length,
        });

        // Suppress unused variable warning
        void planConfig;
      }

      return details;
    }

    // -----------------------------------------------------------------------
    // FALLBACK path: no auth users provided — enumerate from subscriptions.
    // (Used in unit tests and environments without Firebase Admin credentials.)
    // -----------------------------------------------------------------------
    for (const sub of subMap.values()) {
      const period = await this.getCreditPeriod(sub.userId, now);
      const usageRecords = (await this.getAiUsageHistory(sub.userId)).filter(
        (r) =>
          new Date(r.createdAt) >= new Date(period.periodStart) &&
          new Date(r.createdAt) <= new Date(period.periodEnd),
      );

      const promptTokens = usageRecords.reduce(
        (acc, r) => acc + r.promptTokens,
        0,
      );
      const completionTokens = usageRecords.reduce(
        (acc, r) => acc + r.completionTokens,
        0,
      );
      const totalTokens = promptTokens + completionTokens;
      const consumedPaise = period.consumedPaise;
      const remainingPaise = Math.max(0, period.budgetPaise - consumedPaise);

      const lastAiRecord = [...usageRecords].sort(
        (a, b) =>
          new Date(b.createdAt).getTime() - new Date(a.createdAt).getTime(),
      )[0];

      details.push({
        userId: sub.userId,
        email: sub.email,
        isAdmin: isUserAdmin(sub.email),
        planId: sub.planId,
        status: sub.status,
        subscriptionSource: sub.subscriptionSource,
        currentPeriodStart: period.periodStart,
        currentPeriodEnd: period.periodEnd,
        promptTokens,
        completionTokens,
        totalTokens,
        budgetPaise: period.budgetPaise,
        consumedPaise,
        remainingPaise,
        estimatedInrCost: consumedPaise / 100,
        lastAiRequestAt: lastAiRecord?.createdAt || null,
        requestCount: usageRecords.length,
      });
    }

    return details;
  }

  async registerUser(user: EnumerableAuthUser): Promise<void> {
    this.registeredUsers.set(user.uid, { ...user });
  }

  async listRegisteredUsers(): Promise<EnumerableAuthUser[]> {
    return Array.from(this.registeredUsers.values());
  }

  async appendAuditLog(
    event: Omit<AdminAuditEvent, 'id' | 'timestamp'>,
  ): Promise<AdminAuditEvent> {
    const fullEvent: AdminAuditEvent = {
      ...event,
      id: `audit_${Date.now()}_${Math.random().toString(36).slice(2, 8)}`,
      timestamp: new Date().toISOString(),
    };
    this.auditLog.unshift(fullEvent);
    return fullEvent;
  }

  async getAuditLogs(): Promise<AdminAuditEvent[]> {
    return [...this.auditLog];
  }
}

/** Explicit test-only constructor. Production must use FirestoreEntitlementStore. */
export function createInMemoryEntitlementStore(): IEntitlementStore {
  return new InMemoryEntitlementStore();
}

// Runtime store is durable Firestore state. This reference is only a process-local
// client handle; it is never the source of entitlement truth.
let entitlementStoreInstance: IEntitlementStore | null = null;

export function getEntitlementStore(): IEntitlementStore {
  if (!entitlementStoreInstance) {
    // Runtime entitlement access is server-only and durable by default.
    // Tests must construct InMemoryEntitlementStore explicitly.
    entitlementStoreInstance = new FirestoreEntitlementStore();
  }
  return entitlementStoreInstance;
}

export function setEntitlementStore(store: IEntitlementStore): void {
  entitlementStoreInstance = store;
}
