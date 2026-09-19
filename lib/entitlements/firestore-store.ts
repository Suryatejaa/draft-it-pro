import { getFirebaseAdminDb } from '../firebase-admin.ts';
import type { Firestore } from 'firebase-admin/firestore';
import {
  DEFAULT_PLAN_CONFIGS,
  FREE_PLAN_ID,
  validatePlanConfig,
} from './plans.ts';
import { isUserAdmin } from './admin.ts';
import type {
  AdminAuditEvent,
  AdminUserAiUsageDetail,
  AiCreditPeriod,
  AiUsageRecord,
  DiscountConfig,
  EnumerableAuthUser,
  PlanConfig,
  PlanId,
  PlanRequest,
  SubscriptionStatus,
  UserSubscriptionRecord,
} from './types.ts';
import type { IEntitlementStore } from './store.ts';

const COLLECTIONS = {
  subscriptions: 'subscriptions',
  planConfigs: 'planConfigs',
  aiCreditPeriods: 'aiCreditPeriods',
  aiUsage: 'aiUsage',
  discounts: 'discounts',
  planRequests: 'planRequests',
  adminAuditLog: 'adminAuditLog',
} as const;

function addOneMonth(isoDateStr: string): string {
  const date = new Date(isoDateStr);
  date.setMonth(date.getMonth() + 1);
  return date.toISOString();
}

function periodId(userId: string, periodStart: string): string {
  return `${userId}_${periodStart.slice(0, 10)}`;
}

function withId<T extends object>(id: string, value: T): T & { id: string } {
  return { id, ...value };
}

function statusError(
  message: string,
  statusCode: number,
): Error & { statusCode: number } {
  return Object.assign(new Error(message), { statusCode });
}

export class FirestoreEntitlementStore implements IEntitlementStore {
  private readonly db: Firestore;

  constructor(db: Firestore = getFirebaseAdminDb()) {
    this.db = db;
  }

  clear(): void {
    throw new Error(
      'FirestoreEntitlementStore cannot be cleared. Use explicit test data cleanup.',
    );
  }

  async getPlanConfigs(): Promise<Record<PlanId, PlanConfig>> {
    const snapshot = await this.db.collection(COLLECTIONS.planConfigs).get();
    const plans = Object.fromEntries(
      snapshot.docs.map((doc) => [doc.id, doc.data() as PlanConfig]),
    ) as Record<PlanId, PlanConfig>;
    for (const planId of Object.keys(DEFAULT_PLAN_CONFIGS)) {
      if (!plans[planId]) plans[planId] = await this.getPlanConfig(planId);
    }
    return plans;
  }

  async getPlanConfig(planId: PlanId): Promise<PlanConfig> {
    const ref = this.db.collection(COLLECTIONS.planConfigs).doc(planId);
    const snapshot = await ref.get();
    if (snapshot.exists) return snapshot.data() as PlanConfig;
    const defaultPlan = DEFAULT_PLAN_CONFIGS[planId];
    if (!defaultPlan) return DEFAULT_PLAN_CONFIGS.free;
    const seeded = { ...defaultPlan, id: planId };
    await ref.create(seeded);
    return seeded;
  }

  async createPlanConfig(
    plan: PlanConfig,
    adminUserId: string,
    adminEmail: string,
  ): Promise<PlanConfig> {
    const existing = await this.db
      .collection(COLLECTIONS.planConfigs)
      .doc(plan.id)
      .get();
    if (existing.exists) throw new Error('A plan with this ID already exists.');
    const plans = await this.getPlanConfigs();
    const validation = validatePlanConfig(plan, plans);
    if (!validation.valid) throw new Error(validation.error);
    const now = new Date().toISOString();
    const created = {
      ...plan,
      createdAt: plan.createdAt || now,
      updatedAt: now,
    };
    const batch = this.db.batch();
    batch.create(
      this.db.collection(COLLECTIONS.planConfigs).doc(plan.id),
      created,
    );
    const audit = this.newAudit({
      actorAdminUserId: adminUserId,
      actorAdminEmail: adminEmail,
      targetUserId: `plan_${plan.id}`,
      action: 'create_plan',
      previousValue: null,
      newValue: created,
    });
    batch.set(
      this.db.collection(COLLECTIONS.adminAuditLog).doc(audit.id),
      audit,
    );
    await batch.commit();
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
    const existingSnapshot = await this.db
      .collection(COLLECTIONS.planConfigs)
      .doc(planId)
      .get();
    if (!existingSnapshot.exists) throw new Error('Plan not found.');
    const existing = existingSnapshot.data() as PlanConfig;
    const updated = {
      ...existing,
      ...updates,
      id: planId,
      updatedAt: new Date().toISOString(),
    };
    const validation = validatePlanConfig(updated, await this.getPlanConfigs());
    if (!validation.valid) throw new Error(validation.error);
    const batch = this.db.batch();
    batch.set(this.db.collection(COLLECTIONS.planConfigs).doc(planId), updated);
    const audit = this.newAudit({
      actorAdminUserId: adminUserId,
      actorAdminEmail: adminEmail,
      targetUserId: `plan_${planId}`,
      action: 'update_plan',
      previousValue: existing,
      newValue: updated,
    });
    batch.set(
      this.db.collection(COLLECTIONS.adminAuditLog).doc(audit.id),
      audit,
    );
    await batch.commit();
    return updated;
  }

  async deletePlanConfig(
    planId: PlanId,
    adminUserId: string,
    adminEmail: string,
  ): Promise<void> {
    if (planId === FREE_PLAN_ID)
      throw new Error('The Free plan cannot be deleted.');
    const planRef = this.db.collection(COLLECTIONS.planConfigs).doc(planId);
    const planSnapshot = await planRef.get();
    if (!planSnapshot.exists) throw new Error('Plan not found.');
    const [
      subscriptions,
      periods,
      requestedPlans,
      currentPlans,
      discounts,
      audits,
    ] = await Promise.all([
      this.db
        .collection(COLLECTIONS.subscriptions)
        .where('planId', '==', planId)
        .limit(1)
        .get(),
      this.db
        .collection(COLLECTIONS.aiCreditPeriods)
        .where('planId', '==', planId)
        .limit(1)
        .get(),
      this.db
        .collection(COLLECTIONS.planRequests)
        .where('requestedPlanId', '==', planId)
        .limit(1)
        .get(),
      this.db
        .collection(COLLECTIONS.planRequests)
        .where('currentPlanId', '==', planId)
        .limit(1)
        .get(),
      this.db.collection(COLLECTIONS.discounts).get(),
      this.db.collection(COLLECTIONS.adminAuditLog).get(),
    ]);
    const discountReference = discounts.docs.some((doc) =>
      (doc.data() as DiscountConfig).applicablePlanIds?.includes(planId),
    );
    const auditReference = audits.docs.some((doc) => {
      const event = doc.data() as { targetUserId?: string };
      return (
        event.targetUserId !== `plan_${planId}` &&
        JSON.stringify(event).includes(`"${planId}"`)
      );
    });
    if (
      !subscriptions.empty ||
      !periods.empty ||
      !requestedPlans.empty ||
      !currentPlans.empty ||
      discountReference ||
      auditReference
    ) {
      throw new Error('Referenced plans can only be archived.');
    }
    const audit = this.newAudit({
      actorAdminUserId: adminUserId,
      actorAdminEmail: adminEmail,
      targetUserId: `plan_${planId}`,
      action: 'delete_plan',
      previousValue: planSnapshot.data(),
      newValue: null,
    });
    const batch = this.db.batch();
    batch.delete(planRef);
    batch.set(
      this.db.collection(COLLECTIONS.adminAuditLog).doc(audit.id),
      audit,
    );
    await batch.commit();
  }

  async getSubscription(
    userId: string,
  ): Promise<UserSubscriptionRecord | null> {
    const snapshot = await this.db
      .collection(COLLECTIONS.subscriptions)
      .doc(userId)
      .get();
    return snapshot.exists ? (snapshot.data() as UserSubscriptionRecord) : null;
  }

  async saveSubscription(subscription: UserSubscriptionRecord): Promise<void> {
    await this.db
      .collection(COLLECTIONS.subscriptions)
      .doc(subscription.userId)
      .set(subscription);
  }

  async grantPlan(
    userId: string,
    planId: PlanId,
    email: string | undefined,
    adminUserId: string,
    adminEmail: string,
  ): Promise<UserSubscriptionRecord> {
    const planConfig = await this.getPlanConfig(planId);
    const subscriptionRef = this.db
      .collection(COLLECTIONS.subscriptions)
      .doc(userId);
    const now = new Date().toISOString();
    const result = await this.db.runTransaction(async (transaction) => {
      const existingSnapshot = await transaction.get(subscriptionRef);
      const existing = existingSnapshot.exists
        ? (existingSnapshot.data() as UserSubscriptionRecord)
        : null;
      const periodStart = existing?.currentPeriodStart || now;
      const periodEnd = existing?.currentPeriodEnd || addOneMonth(periodStart);
      const updated: UserSubscriptionRecord = {
        userId,
        email: email || existing?.email,
        planId,
        status: existing?.status || 'active',
        subscriptionSource: planId === 'free' ? 'free' : 'admin_grant',
        currentPeriodStart: periodStart,
        currentPeriodEnd: periodEnd,
        createdAt: existing?.createdAt || now,
        updatedAt: now,
      };
      const creditRef = this.db
        .collection(COLLECTIONS.aiCreditPeriods)
        .doc(periodId(userId, periodStart));
      const creditSnapshot = await transaction.get(creditRef);
      const oldPeriod = creditSnapshot.exists
        ? (creditSnapshot.data() as AiCreditPeriod)
        : null;
      const period: AiCreditPeriod = {
        id: creditRef.id,
        userId,
        planId,
        periodStart,
        periodEnd,
        budgetPaise: planConfig.aiMonthlyBudgetPaise,
        consumedPaise: oldPeriod?.consumedPaise || 0,
        reservedPaise: oldPeriod?.reservedPaise || 0,
        updatedAt: now,
      };
      transaction.set(subscriptionRef, updated);
      transaction.set(creditRef, period);
      const audit = this.newAudit({
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
      transaction.set(
        this.db.collection(COLLECTIONS.adminAuditLog).doc(audit.id),
        audit,
      );
      return updated;
    });
    return result;
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
    const subscriptionRef = this.db
      .collection(COLLECTIONS.subscriptions)
      .doc(userId);
    const now = new Date().toISOString();
    return this.db.runTransaction(async (transaction) => {
      const existingSnapshot = await transaction.get(subscriptionRef);
      const existing = existingSnapshot.exists
        ? (existingSnapshot.data() as UserSubscriptionRecord)
        : null;
      const periodStart =
        updates.currentPeriodStart || existing?.currentPeriodStart || now;
      const periodEnd =
        updates.currentPeriodEnd ||
        existing?.currentPeriodEnd ||
        addOneMonth(periodStart);
      if (
        Number.isNaN(new Date(periodStart).getTime()) ||
        Number.isNaN(new Date(periodEnd).getTime()) ||
        new Date(periodEnd) <= new Date(periodStart)
      ) {
        throw new Error('Invalid subscription period.');
      }
      const previousPlanId = existing?.planId || 'free';
      const newPlanId = updates.planId || previousPlanId;
      const updated: UserSubscriptionRecord = {
        userId,
        email: existing?.email,
        planId: newPlanId,
        status: updates.status || existing?.status || 'active',
        subscriptionSource: existing?.subscriptionSource || 'admin_grant',
        currentPeriodStart: periodStart,
        currentPeriodEnd: periodEnd,
        createdAt: existing?.createdAt || now,
        updatedAt: now,
      };
      const planConfig = await this.getPlanConfig(newPlanId);
      const creditRef = this.db
        .collection(COLLECTIONS.aiCreditPeriods)
        .doc(periodId(userId, periodStart));
      const creditSnapshot = await transaction.get(creditRef);
      const oldPeriod = creditSnapshot.exists
        ? (creditSnapshot.data() as AiCreditPeriod)
        : null;
      const period: AiCreditPeriod = {
        id: creditRef.id,
        userId,
        planId: newPlanId,
        periodStart,
        periodEnd,
        budgetPaise: planConfig.aiMonthlyBudgetPaise,
        consumedPaise: oldPeriod?.consumedPaise || 0,
        reservedPaise: oldPeriod?.reservedPaise || 0,
        updatedAt: now,
      };
      transaction.set(subscriptionRef, updated);
      transaction.set(creditRef, period);
      const audit = this.newAudit({
        actorAdminUserId: adminUserId,
        actorAdminEmail: adminEmail,
        targetUserId: userId,
        action: 'update_subscription',
        previousValue: existing,
        newValue: updated,
      });
      transaction.set(
        this.db.collection(COLLECTIONS.adminAuditLog).doc(audit.id),
        audit,
      );
      return updated;
    });
  }

  async suspendUser(
    userId: string,
    adminUserId: string,
    adminEmail: string,
  ): Promise<UserSubscriptionRecord> {
    return this.updateSubscription(
      userId,
      { status: 'suspended' },
      adminUserId,
      adminEmail,
    );
  }

  async reactivateUser(
    userId: string,
    adminUserId: string,
    adminEmail: string,
  ): Promise<UserSubscriptionRecord> {
    return this.updateSubscription(
      userId,
      { status: 'active' },
      adminUserId,
      adminEmail,
    );
  }

  async extendSubscription(
    targetUserId: string,
    days: number,
    adminUserId: string,
    adminEmail: string,
  ): Promise<UserSubscriptionRecord> {
    if (!Number.isFinite(days) || days <= 0)
      throw new Error('Extension days must be a positive integer.');
    const existing = await this.getSubscription(targetUserId);
    const base = Math.max(
      Date.now(),
      new Date(existing?.currentPeriodEnd || Date.now()).getTime(),
    );
    const currentPeriodEnd = new Date(
      base + Math.round(days) * 86400000,
    ).toISOString();
    return this.updateSubscription(
      targetUserId,
      { currentPeriodEnd },
      adminUserId,
      adminEmail,
    );
  }

  async resetAiCredits(
    targetUserId: string,
    adminUserId: string,
    adminEmail: string,
  ): Promise<AiCreditPeriod> {
    const subscription = await this.getSubscription(targetUserId);
    const planId = subscription?.planId || 'free';
    const plan = await this.getPlanConfig(planId);
    const now = new Date().toISOString();
    const period: AiCreditPeriod = {
      id: periodId(targetUserId, now),
      userId: targetUserId,
      planId,
      periodStart: now,
      periodEnd: subscription?.currentPeriodEnd || addOneMonth(now),
      budgetPaise: plan.aiMonthlyBudgetPaise,
      consumedPaise: 0,
      reservedPaise: 0,
      updatedAt: now,
    };
    const batch = this.db.batch();
    batch.set(
      this.db.collection(COLLECTIONS.aiCreditPeriods).doc(period.id),
      period,
    );
    const audit = this.newAudit({
      actorAdminUserId: adminUserId,
      actorAdminEmail: adminEmail,
      targetUserId,
      action: 'reset_ai_credits',
      previousValue: null,
      newValue: period,
    });
    batch.set(
      this.db.collection(COLLECTIONS.adminAuditLog).doc(audit.id),
      audit,
    );
    await batch.commit();
    return period;
  }

  async listAllSubscriptions(): Promise<UserSubscriptionRecord[]> {
    const snapshot = await this.db.collection(COLLECTIONS.subscriptions).get();
    return snapshot.docs.map((doc) => doc.data() as UserSubscriptionRecord);
  }

  async getDiscounts(): Promise<DiscountConfig[]> {
    const snapshot = await this.db.collection(COLLECTIONS.discounts).get();
    return snapshot.docs
      .map((doc) => doc.data() as DiscountConfig)
      .sort((a, b) => (b.createdAt || '').localeCompare(a.createdAt || ''));
  }

  async createDiscount(
    discount: Omit<DiscountConfig, 'id' | 'createdAt' | 'updatedAt'>,
    adminUserId: string,
    adminEmail: string,
  ): Promise<DiscountConfig> {
    const id = `discount_${Date.now()}_${Math.random().toString(36).slice(2, 8)}`;
    const existingDiscounts = await this.getDiscounts();
    const latestCreatedAt = Math.max(
      0,
      ...existingDiscounts.map((item) =>
        new Date(item.createdAt || 0).getTime(),
      ),
    );
    const now = new Date(
      Math.max(Date.now(), latestCreatedAt + 1),
    ).toISOString();
    const created = {
      ...discount,
      id,
      createdAt: now,
      updatedAt: now,
    } as DiscountConfig;
    const batch = this.db.batch();
    batch.set(this.db.collection(COLLECTIONS.discounts).doc(id), created);
    const audit = this.newAudit({
      actorAdminUserId: adminUserId,
      actorAdminEmail: adminEmail,
      targetUserId: `discount_${id}`,
      action: 'create_discount',
      previousValue: null,
      newValue: created,
    });
    batch.set(
      this.db.collection(COLLECTIONS.adminAuditLog).doc(audit.id),
      audit,
    );
    await batch.commit();
    return created;
  }

  async updateDiscount(
    id: string,
    updates: Partial<DiscountConfig>,
    adminUserId: string,
    adminEmail: string,
  ): Promise<DiscountConfig> {
    const ref = this.db.collection(COLLECTIONS.discounts).doc(id);
    const snapshot = await ref.get();
    if (!snapshot.exists) throw new Error(`Discount ${id} not found.`);
    const updated = {
      ...(snapshot.data() as DiscountConfig),
      ...updates,
      id,
      updatedAt: new Date().toISOString(),
    };
    const batch = this.db.batch();
    batch.set(ref, updated);
    const audit = this.newAudit({
      actorAdminUserId: adminUserId,
      actorAdminEmail: adminEmail,
      targetUserId: `discount_${id}`,
      action: 'update_discount',
      previousValue: snapshot.data(),
      newValue: updated,
    });
    batch.set(
      this.db.collection(COLLECTIONS.adminAuditLog).doc(audit.id),
      audit,
    );
    await batch.commit();
    return updated;
  }

  async toggleDiscount(
    id: string,
    enabled: boolean,
    adminUserId: string,
    adminEmail: string,
  ): Promise<DiscountConfig> {
    return this.updateDiscount(id, { enabled }, adminUserId, adminEmail);
  }

  async deleteDiscount(
    id: string,
    adminUserId: string,
    adminEmail: string,
  ): Promise<void> {
    const ref = this.db.collection(COLLECTIONS.discounts).doc(id);
    const snapshot = await ref.get();
    if (!snapshot.exists) throw new Error(`Discount ${id} not found.`);
    const audits = await this.db.collection(COLLECTIONS.adminAuditLog).get();
    if (
      audits.docs.some((doc) => {
        const event = doc.data() as { targetUserId?: string };
        return (
          event.targetUserId !== `discount_${id}` &&
          JSON.stringify(event).includes(`"${id}"`)
        );
      })
    ) {
      throw new Error(
        'Discount is referenced by audit history and can only be disabled.',
      );
    }
    const audit = this.newAudit({
      actorAdminUserId: adminUserId,
      actorAdminEmail: adminEmail,
      targetUserId: `discount_${id}`,
      action: 'delete_discount',
      previousValue: snapshot.data(),
      newValue: null,
    });
    const batch = this.db.batch();
    batch.delete(ref);
    batch.set(
      this.db.collection(COLLECTIONS.adminAuditLog).doc(audit.id),
      audit,
    );
    await batch.commit();
  }

  async createPlanRequest(
    request: Omit<PlanRequest, 'id' | 'status' | 'createdAt'>,
  ): Promise<PlanRequest> {
    const ref = this.db.collection(COLLECTIONS.planRequests).doc();
    const created: PlanRequest = {
      ...request,
      id: ref.id,
      status: 'pending',
      createdAt: new Date().toISOString(),
    };
    const pendingQuery = this.db
      .collection(COLLECTIONS.planRequests)
      .where('uid', '==', request.uid)
      .limit(100);
    return this.db.runTransaction(async (transaction) => {
      const snapshot = await transaction.get(pendingQuery);
      const duplicate = snapshot.docs
        .map((doc) => doc.data() as PlanRequest)
        .find(
          (item) =>
            item.requestedPlanId === request.requestedPlanId &&
            item.status === 'pending',
        );
      if (duplicate) return duplicate;
      transaction.create(ref, created);
      return created;
    });
  }

  async getPendingPlanRequest(
    uid: string,
    requestedPlanId: Exclude<PlanId, 'free'>,
  ): Promise<PlanRequest | null> {
    const snapshot = await this.db
      .collection(COLLECTIONS.planRequests)
      .where('uid', '==', uid)
      .limit(100)
      .get();
    return (
      snapshot.docs
        .map((doc) => doc.data() as PlanRequest)
        .find(
          (item) =>
            item.requestedPlanId === requestedPlanId &&
            item.status === 'pending',
        ) || null
    );
  }

  async listPendingPlanRequestsForUser(uid: string): Promise<PlanRequest[]> {
    const snapshot = await this.db
      .collection(COLLECTIONS.planRequests)
      .where('uid', '==', uid)
      .where('status', '==', 'pending')
      .get();
    return snapshot.docs.map((doc) => doc.data() as PlanRequest);
  }

  async listPendingPlanRequests(): Promise<PlanRequest[]> {
    const snapshot = await this.db
      .collection(COLLECTIONS.planRequests)
      .where('status', '==', 'pending')
      .get();
    return snapshot.docs
      .map((doc) => doc.data() as PlanRequest)
      .sort((a, b) => b.createdAt.localeCompare(a.createdAt));
  }

  async processPlanRequest(
    id: string,
    status: 'approved' | 'rejected',
    adminUserId: string,
    adminEmail: string,
  ): Promise<PlanRequest> {
    const ref = this.db.collection(COLLECTIONS.planRequests).doc(id);
    const snapshot = await ref.get();
    if (!snapshot.exists) throw new Error('Plan request not found.');
    const request = snapshot.data() as PlanRequest;
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
    const processed: PlanRequest = {
      ...request,
      status,
      processedAt: new Date().toISOString(),
      processedBy: adminUserId,
    };
    await ref.update({ ...processed });
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
    now = new Date(),
  ): Promise<AiCreditPeriod> {
    const subscription = await this.getSubscription(userId);
    const planId = subscription?.planId || 'free';
    const plan = await this.getPlanConfig(planId);
    let periodStart = subscription?.currentPeriodStart || now.toISOString();
    let periodEnd = subscription?.currentPeriodEnd || addOneMonth(periodStart);
    while (now.getTime() >= new Date(periodEnd).getTime()) {
      periodStart = periodEnd;
      periodEnd = addOneMonth(periodStart);
    }
    const ref = this.db
      .collection(COLLECTIONS.aiCreditPeriods)
      .doc(periodId(userId, periodStart));
    const snapshot = await ref.get();
    if (!snapshot.exists) {
      const period: AiCreditPeriod = {
        id: ref.id,
        userId,
        planId,
        periodStart,
        periodEnd,
        budgetPaise: plan.aiMonthlyBudgetPaise,
        consumedPaise: 0,
        reservedPaise: 0,
        updatedAt: now.toISOString(),
      };
      await ref.create(period);
      return period;
    }
    const period = snapshot.data() as AiCreditPeriod;
    if (
      period.planId !== planId ||
      (!period.planId &&
        period.budgetPaise === 0 &&
        plan.aiMonthlyBudgetPaise > 0)
    ) {
      const repaired = {
        ...period,
        planId,
        budgetPaise: plan.aiMonthlyBudgetPaise,
        periodStart,
        periodEnd,
        updatedAt: now.toISOString(),
      };
      await ref.set(repaired);
      return repaired;
    }
    return period;
  }

  async saveCreditPeriod(period: AiCreditPeriod): Promise<void> {
    await this.db
      .collection(COLLECTIONS.aiCreditPeriods)
      .doc(period.id)
      .set({ ...period, updatedAt: new Date().toISOString() });
  }

  async reserveCreditAtomically(
    userId: string,
    requestedPaise: number,
  ): Promise<AiCreditPeriod> {
    const subscription = await this.getSubscription(userId);
    const planId = subscription?.planId || 'free';
    const plan = await this.getPlanConfig(planId);
    const periodStart =
      subscription?.currentPeriodStart || new Date().toISOString();
    const periodEnd =
      subscription?.currentPeriodEnd || addOneMonth(periodStart);
    const ref = this.db
      .collection(COLLECTIONS.aiCreditPeriods)
      .doc(periodId(userId, periodStart));
    return this.db.runTransaction(async (transaction) => {
      const snapshot = await transaction.get(ref);
      const existing = snapshot.exists
        ? (snapshot.data() as AiCreditPeriod)
        : {
            id: ref.id,
            userId,
            planId,
            periodStart,
            periodEnd,
            budgetPaise: plan.aiMonthlyBudgetPaise,
            consumedPaise: 0,
            reservedPaise: 0,
            updatedAt: new Date().toISOString(),
          };
      const effectiveBudgetPaise = plan.aiMonthlyBudgetPaise;
      const available =
        effectiveBudgetPaise - existing.consumedPaise - existing.reservedPaise;
      if (available < requestedPaise) {
        throw statusError(
          'Your monthly AI credit allowance is exhausted. Next credits will refresh on your reset date.',
          429,
        );
      }
      const updated = {
        ...existing,
        planId,
        budgetPaise: effectiveBudgetPaise,
        reservedPaise: existing.reservedPaise + requestedPaise,
        updatedAt: new Date().toISOString(),
      };
      transaction.set(ref, updated);
      return updated;
    });
  }

  async appendAiUsage(record: AiUsageRecord): Promise<void> {
    await this.db.collection(COLLECTIONS.aiUsage).doc(record.id).create(record);
  }

  async hasRequestId(requestId: string): Promise<boolean> {
    const snapshot = await this.db
      .collection(COLLECTIONS.aiUsage)
      .where('requestId', '==', requestId)
      .limit(1)
      .get();
    return !snapshot.empty;
  }

  async getAiUsageHistory(userId?: string): Promise<AiUsageRecord[]> {
    const query = userId
      ? this.db.collection(COLLECTIONS.aiUsage).where('userId', '==', userId)
      : this.db.collection(COLLECTIONS.aiUsage);
    const snapshot = await query.get();
    return snapshot.docs.map((doc) => doc.data() as AiUsageRecord);
  }

  async getAdminUserAiUsageDetails(
    authUsers: EnumerableAuthUser[] = [],
  ): Promise<AdminUserAiUsageDetail[]> {
    const aggregationStartedAt = performance.now();
    const timedRead = <T>(label: string, read: () => Promise<T>) =>
      (async () => {
        const startedAt = performance.now();
        const result = await read();
        console.info(`[admin-timing] firestore ${label}`, {
          totalMs: Math.round(performance.now() - startedAt),
        });
        return result;
      })();
    const [subscriptions, planConfigs, usageHistory] = await Promise.all([
      timedRead('subscriptions', () => this.listAllSubscriptions()),
      timedRead('plan configs', () => this.getPlanConfigs()),
      timedRead('usage history', () => this.getAiUsageHistory()),
    ]);
    const subMap = new Map(
      subscriptions.map((subscription) => [subscription.userId, subscription]),
    );
    const users: EnumerableAuthUser[] =
      authUsers.length > 0
        ? authUsers
        : subscriptions.map((subscription) => ({
            uid: subscription.userId,
            email: subscription.email || null,
            displayName: null,
            photoURL: null,
            disabled: false,
          }));
    const now = new Date();
    const periodInputs = users.map((authUser) => {
      const subscription = subMap.get(authUser.uid);
      const planId = subscription?.planId || 'free';
      let periodStart = subscription?.currentPeriodStart || now.toISOString();
      let periodEnd =
        subscription?.currentPeriodEnd || addOneMonth(periodStart);
      while (now.getTime() >= new Date(periodEnd).getTime()) {
        periodStart = periodEnd;
        periodEnd = addOneMonth(periodStart);
      }
      return {
        authUser,
        subscription,
        planId,
        periodStart,
        periodEnd,
        plan: planConfigs[planId] || DEFAULT_PLAN_CONFIGS[planId],
      };
    });

    const periodReadStartedAt = performance.now();
    const periodRefs = periodInputs.map(({ authUser, periodStart }) =>
      this.db
        .collection(COLLECTIONS.aiCreditPeriods)
        .doc(periodId(authUser.uid, periodStart)),
    );
    const periodSnapshots =
      periodRefs.length > 0 ? await this.db.getAll(...periodRefs) : [];
    const periodReadMs = performance.now() - periodReadStartedAt;

    const periods = periodInputs.map((input, index) => {
      const snapshot = periodSnapshots[index];
      const existing = snapshot.exists
        ? (snapshot.data() as AiCreditPeriod)
        : null;
      const period: AiCreditPeriod = existing || {
        id: periodRefs[index].id,
        userId: input.authUser.uid,
        planId: input.planId,
        periodStart: input.periodStart,
        periodEnd: input.periodEnd,
        budgetPaise: input.plan.aiMonthlyBudgetPaise,
        consumedPaise: 0,
        reservedPaise: 0,
        updatedAt: now.toISOString(),
      };
      const needsRepair = Boolean(
        existing &&
        (existing.planId !== input.planId ||
          (!existing.planId &&
            existing.budgetPaise === 0 &&
            input.plan.aiMonthlyBudgetPaise > 0)),
      );
      if (needsRepair) {
        return {
          ...period,
          planId: input.planId,
          budgetPaise: input.plan.aiMonthlyBudgetPaise,
          periodStart: input.periodStart,
          periodEnd: input.periodEnd,
          updatedAt: now.toISOString(),
        };
      }
      return period;
    });

    const periodWrites = periods.filter(
      (period, index) =>
        !periodSnapshots[index].exists ||
        periodSnapshots[index].data()?.planId !== period.planId ||
        periodSnapshots[index].data()?.periodStart !== period.periodStart ||
        periodSnapshots[index].data()?.periodEnd !== period.periodEnd,
    );
    const repairStartedAt = performance.now();
    for (let offset = 0; offset < periodWrites.length; offset += 450) {
      const batch = this.db.batch();
      for (const period of periodWrites.slice(offset, offset + 450)) {
        batch.set(
          this.db.collection(COLLECTIONS.aiCreditPeriods).doc(period.id),
          period,
        );
      }
      await batch.commit();
    }
    const repairMs = performance.now() - repairStartedAt;

    const usageByUser = new Map<string, AiUsageRecord[]>();
    for (const record of usageHistory) {
      const records = usageByUser.get(record.userId) || [];
      records.push(record);
      usageByUser.set(record.userId, records);
    }
    const details: AdminUserAiUsageDetail[] = [];
    for (let index = 0; index < users.length; index += 1) {
      const { authUser, subscription, planId } = periodInputs[index];
      const period = periods[index];
      const usage = (usageByUser.get(authUser.uid) || []).filter(
        (record) =>
          new Date(record.createdAt) >= new Date(period.periodStart) &&
          new Date(record.createdAt) <= new Date(period.periodEnd),
      );
      const promptTokens = usage.reduce(
        (total, record) => total + record.promptTokens,
        0,
      );
      const completionTokens = usage.reduce(
        (total, record) => total + record.completionTokens,
        0,
      );
      const last = [...usage].sort((a, b) =>
        b.createdAt.localeCompare(a.createdAt),
      )[0];
      details.push({
        userId: authUser.uid,
        email: authUser.email || subscription?.email,
        displayName: authUser.displayName || undefined,
        photoURL: authUser.photoURL || undefined,
        disabled: authUser.disabled,
        creationTime: authUser.creationTime || undefined,
        lastSignInTime: authUser.lastSignInTime || undefined,
        isAdmin: isUserAdmin(authUser.email),
        planId: subscription?.planId || 'free',
        status: subscription?.status || 'active',
        subscriptionSource: subscription?.subscriptionSource,
        currentPeriodStart: period.periodStart,
        currentPeriodEnd: period.periodEnd,
        promptTokens,
        completionTokens,
        totalTokens: promptTokens + completionTokens,
        budgetPaise: period.budgetPaise,
        consumedPaise: period.consumedPaise,
        remainingPaise: Math.max(0, period.budgetPaise - period.consumedPaise),
        estimatedInrCost: period.consumedPaise / 100,
        lastAiRequestAt: last?.createdAt || null,
        requestCount: usage.length,
      });
    }
    console.info('[admin-timing] firestore user aggregation', {
      creditPeriodReadMs: Math.round(periodReadMs),
      creditPeriodRepairMs: Math.round(repairMs),
      totalMs: Math.round(performance.now() - aggregationStartedAt),
      userCount: users.length,
      subscriptionCount: subscriptions.length,
      usageRecordCount: usageHistory.length,
      creditPeriodReadCount: periodRefs.length,
    });
    return details;
  }

  async registerUser(_user: EnumerableAuthUser): Promise<void> {
    // Firebase Auth is authoritative; no local registry is persisted.
  }

  async listRegisteredUsers(): Promise<EnumerableAuthUser[]> {
    throw new Error(
      'Firebase Auth enumeration belongs to listFirebaseUsers().',
    );
  }

  async appendAuditLog(
    event: Omit<AdminAuditEvent, 'id' | 'timestamp'>,
  ): Promise<AdminAuditEvent> {
    const audit = this.newAudit(event);
    await this.db
      .collection(COLLECTIONS.adminAuditLog)
      .doc(audit.id)
      .create(audit);
    return audit;
  }

  async getAuditLogs(): Promise<AdminAuditEvent[]> {
    const snapshot = await this.db
      .collection(COLLECTIONS.adminAuditLog)
      .orderBy('timestamp', 'desc')
      .get();
    return snapshot.docs.map((doc) => doc.data() as AdminAuditEvent);
  }

  private newAudit(
    event: Omit<AdminAuditEvent, 'id' | 'timestamp'>,
  ): AdminAuditEvent {
    return {
      ...event,
      id: `audit_${Date.now()}_${Math.random().toString(36).slice(2, 8)}`,
      timestamp: new Date().toISOString(),
    };
  }
}
