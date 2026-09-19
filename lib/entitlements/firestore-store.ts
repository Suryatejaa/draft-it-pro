import { getFirebaseAdminDb } from '../firebase-admin.ts';
import type { Firestore } from 'firebase-admin/firestore';
import {
  DEFAULT_PLAN_CONFIGS,
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

function statusError(message: string, statusCode: number): Error & { statusCode: number } {
  return Object.assign(new Error(message), { statusCode });
}

export class FirestoreEntitlementStore implements IEntitlementStore {
  private readonly db: Firestore;

  constructor(db: Firestore = getFirebaseAdminDb()) {
    this.db = db;
  }

  clear(): void {
    throw new Error('FirestoreEntitlementStore cannot be cleared. Use explicit test data cleanup.');
  }

  async getPlanConfigs(): Promise<Record<PlanId, PlanConfig>> {
    const entries = await Promise.all(
      (Object.keys(DEFAULT_PLAN_CONFIGS) as PlanId[]).map(async (planId) => [planId, await this.getPlanConfig(planId)] as const),
    );
    return Object.fromEntries(entries) as Record<PlanId, PlanConfig>;
  }

  async getPlanConfig(planId: PlanId): Promise<PlanConfig> {
    const ref = this.db.collection(COLLECTIONS.planConfigs).doc(planId);
    const snapshot = await ref.get();
    if (snapshot.exists) return snapshot.data() as PlanConfig;
    const seeded = { ...DEFAULT_PLAN_CONFIGS[planId], id: planId };
    await ref.create(seeded);
    return seeded;
  }

  async updatePlanConfig(planId: PlanId, updates: Partial<PlanConfig>, adminUserId: string, adminEmail: string): Promise<PlanConfig> {
    const existing = await this.getPlanConfig(planId);
    const updated = { ...existing, ...updates, id: planId, updatedAt: new Date().toISOString() };
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
    batch.set(this.db.collection(COLLECTIONS.adminAuditLog).doc(audit.id), audit);
    await batch.commit();
    return updated;
  }

  async getSubscription(userId: string): Promise<UserSubscriptionRecord | null> {
    const snapshot = await this.db.collection(COLLECTIONS.subscriptions).doc(userId).get();
    return snapshot.exists ? snapshot.data() as UserSubscriptionRecord : null;
  }

  async saveSubscription(subscription: UserSubscriptionRecord): Promise<void> {
    await this.db.collection(COLLECTIONS.subscriptions).doc(subscription.userId).set(subscription);
  }

  async grantPlan(userId: string, planId: PlanId, email: string | undefined, adminUserId: string, adminEmail: string): Promise<UserSubscriptionRecord> {
    const planConfig = await this.getPlanConfig(planId);
    const subscriptionRef = this.db.collection(COLLECTIONS.subscriptions).doc(userId);
    const now = new Date().toISOString();
    const result = await this.db.runTransaction(async (transaction) => {
      const existingSnapshot = await transaction.get(subscriptionRef);
      const existing = existingSnapshot.exists ? existingSnapshot.data() as UserSubscriptionRecord : null;
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
      const creditRef = this.db.collection(COLLECTIONS.aiCreditPeriods).doc(periodId(userId, periodStart));
      const creditSnapshot = await transaction.get(creditRef);
      const oldPeriod = creditSnapshot.exists ? creditSnapshot.data() as AiCreditPeriod : null;
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
        previousValue: existing ? { planId: existing.planId, status: existing.status } : null,
        newValue: { planId, status: updated.status, allowancePaise: planConfig.aiMonthlyBudgetPaise },
      });
      transaction.set(this.db.collection(COLLECTIONS.adminAuditLog).doc(audit.id), audit);
      return updated;
    });
    return result;
  }

  async updateSubscription(userId: string, updates: { planId?: PlanId; status?: SubscriptionStatus; currentPeriodStart?: string; currentPeriodEnd?: string }, adminUserId: string, adminEmail: string): Promise<UserSubscriptionRecord> {
    const subscriptionRef = this.db.collection(COLLECTIONS.subscriptions).doc(userId);
    const now = new Date().toISOString();
    return this.db.runTransaction(async (transaction) => {
      const existingSnapshot = await transaction.get(subscriptionRef);
      const existing = existingSnapshot.exists ? existingSnapshot.data() as UserSubscriptionRecord : null;
      const periodStart = updates.currentPeriodStart || existing?.currentPeriodStart || now;
      const periodEnd = updates.currentPeriodEnd || existing?.currentPeriodEnd || addOneMonth(periodStart);
      if (Number.isNaN(new Date(periodStart).getTime()) || Number.isNaN(new Date(periodEnd).getTime()) || new Date(periodEnd) <= new Date(periodStart)) {
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
      const creditRef = this.db.collection(COLLECTIONS.aiCreditPeriods).doc(periodId(userId, periodStart));
      const creditSnapshot = await transaction.get(creditRef);
      const oldPeriod = creditSnapshot.exists ? creditSnapshot.data() as AiCreditPeriod : null;
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
      transaction.set(this.db.collection(COLLECTIONS.adminAuditLog).doc(audit.id), audit);
      return updated;
    });
  }

  async suspendUser(userId: string, adminUserId: string, adminEmail: string): Promise<UserSubscriptionRecord> {
    return this.updateSubscription(userId, { status: 'suspended' }, adminUserId, adminEmail);
  }

  async reactivateUser(userId: string, adminUserId: string, adminEmail: string): Promise<UserSubscriptionRecord> {
    return this.updateSubscription(userId, { status: 'active' }, adminUserId, adminEmail);
  }

  async extendSubscription(targetUserId: string, days: number, adminUserId: string, adminEmail: string): Promise<UserSubscriptionRecord> {
    if (!Number.isFinite(days) || days <= 0) throw new Error('Extension days must be a positive integer.');
    const existing = await this.getSubscription(targetUserId);
    const base = Math.max(Date.now(), new Date(existing?.currentPeriodEnd || Date.now()).getTime());
    const currentPeriodEnd = new Date(base + Math.round(days) * 86400000).toISOString();
    return this.updateSubscription(targetUserId, { currentPeriodEnd }, adminUserId, adminEmail);
  }

  async resetAiCredits(targetUserId: string, adminUserId: string, adminEmail: string): Promise<AiCreditPeriod> {
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
    batch.set(this.db.collection(COLLECTIONS.aiCreditPeriods).doc(period.id), period);
    const audit = this.newAudit({ actorAdminUserId: adminUserId, actorAdminEmail: adminEmail, targetUserId, action: 'reset_ai_credits', previousValue: null, newValue: period });
    batch.set(this.db.collection(COLLECTIONS.adminAuditLog).doc(audit.id), audit);
    await batch.commit();
    return period;
  }

  async listAllSubscriptions(): Promise<UserSubscriptionRecord[]> {
    const snapshot = await this.db.collection(COLLECTIONS.subscriptions).get();
    return snapshot.docs.map((doc) => doc.data() as UserSubscriptionRecord);
  }

  async getDiscounts(): Promise<DiscountConfig[]> {
    const snapshot = await this.db.collection(COLLECTIONS.discounts).get();
    return snapshot.docs.map((doc) => doc.data() as DiscountConfig);
  }

  async createDiscount(discount: Omit<DiscountConfig, 'id' | 'createdAt' | 'updatedAt'>, adminUserId: string, adminEmail: string): Promise<DiscountConfig> {
    const id = `discount_${Date.now()}_${Math.random().toString(36).slice(2, 8)}`;
    const now = new Date().toISOString();
    const created = { ...discount, id, createdAt: now, updatedAt: now } as DiscountConfig;
    const batch = this.db.batch();
    batch.set(this.db.collection(COLLECTIONS.discounts).doc(id), created);
    const audit = this.newAudit({ actorAdminUserId: adminUserId, actorAdminEmail: adminEmail, targetUserId: `discount_${id}`, action: 'create_discount', previousValue: null, newValue: created });
    batch.set(this.db.collection(COLLECTIONS.adminAuditLog).doc(audit.id), audit);
    await batch.commit();
    return created;
  }

  async updateDiscount(id: string, updates: Partial<DiscountConfig>, adminUserId: string, adminEmail: string): Promise<DiscountConfig> {
    const ref = this.db.collection(COLLECTIONS.discounts).doc(id);
    const snapshot = await ref.get();
    if (!snapshot.exists) throw new Error(`Discount ${id} not found.`);
    const updated = { ...(snapshot.data() as DiscountConfig), ...updates, id, updatedAt: new Date().toISOString() };
    const batch = this.db.batch();
    batch.set(ref, updated);
    const audit = this.newAudit({ actorAdminUserId: adminUserId, actorAdminEmail: adminEmail, targetUserId: `discount_${id}`, action: 'update_discount', previousValue: snapshot.data(), newValue: updated });
    batch.set(this.db.collection(COLLECTIONS.adminAuditLog).doc(audit.id), audit);
    await batch.commit();
    return updated;
  }

  async toggleDiscount(id: string, enabled: boolean, adminUserId: string, adminEmail: string): Promise<DiscountConfig> {
    return this.updateDiscount(id, { enabled }, adminUserId, adminEmail);
  }

  async getCreditPeriod(userId: string, now = new Date()): Promise<AiCreditPeriod> {
    const subscription = await this.getSubscription(userId);
    const planId = subscription?.planId || 'free';
    const plan = await this.getPlanConfig(planId);
    let periodStart = subscription?.currentPeriodStart || now.toISOString();
    let periodEnd = subscription?.currentPeriodEnd || addOneMonth(periodStart);
    while (now.getTime() >= new Date(periodEnd).getTime()) {
      periodStart = periodEnd;
      periodEnd = addOneMonth(periodStart);
    }
    const ref = this.db.collection(COLLECTIONS.aiCreditPeriods).doc(periodId(userId, periodStart));
    const snapshot = await ref.get();
    if (!snapshot.exists) {
      const period: AiCreditPeriod = { id: ref.id, userId, planId, periodStart, periodEnd, budgetPaise: plan.aiMonthlyBudgetPaise, consumedPaise: 0, reservedPaise: 0, updatedAt: now.toISOString() };
      await ref.create(period);
      return period;
    }
    const period = snapshot.data() as AiCreditPeriod;
    if (period.planId !== planId || (!period.planId && period.budgetPaise === 0 && plan.aiMonthlyBudgetPaise > 0)) {
      const repaired = { ...period, planId, budgetPaise: plan.aiMonthlyBudgetPaise, periodStart, periodEnd, updatedAt: now.toISOString() };
      await ref.set(repaired);
      return repaired;
    }
    return period;
  }

  async saveCreditPeriod(period: AiCreditPeriod): Promise<void> {
    await this.db.collection(COLLECTIONS.aiCreditPeriods).doc(period.id).set({ ...period, updatedAt: new Date().toISOString() });
  }

  async reserveCreditAtomically(userId: string, requestedPaise: number): Promise<AiCreditPeriod> {
    const subscription = await this.getSubscription(userId);
    const planId = subscription?.planId || 'free';
    const plan = await this.getPlanConfig(planId);
    const periodStart = subscription?.currentPeriodStart || new Date().toISOString();
    const periodEnd = subscription?.currentPeriodEnd || addOneMonth(periodStart);
    const ref = this.db.collection(COLLECTIONS.aiCreditPeriods).doc(periodId(userId, periodStart));
    return this.db.runTransaction(async (transaction) => {
      const snapshot = await transaction.get(ref);
      const existing = snapshot.exists
        ? snapshot.data() as AiCreditPeriod
        : { id: ref.id, userId, planId, periodStart, periodEnd, budgetPaise: plan.aiMonthlyBudgetPaise, consumedPaise: 0, reservedPaise: 0, updatedAt: new Date().toISOString() };
      const effectiveBudgetPaise = plan.aiMonthlyBudgetPaise;
      const available = effectiveBudgetPaise - existing.consumedPaise - existing.reservedPaise;
      if (available < requestedPaise) {
        throw statusError('Your monthly AI credit allowance is exhausted. Next credits will refresh on your reset date.', 429);
      }
      const updated = { ...existing, planId, budgetPaise: effectiveBudgetPaise, reservedPaise: existing.reservedPaise + requestedPaise, updatedAt: new Date().toISOString() };
      transaction.set(ref, updated);
      return updated;
    });
  }

  async appendAiUsage(record: AiUsageRecord): Promise<void> {
    await this.db.collection(COLLECTIONS.aiUsage).doc(record.id).create(record);
  }

  async hasRequestId(requestId: string): Promise<boolean> {
    const snapshot = await this.db.collection(COLLECTIONS.aiUsage).where('requestId', '==', requestId).limit(1).get();
    return !snapshot.empty;
  }

  async getAiUsageHistory(userId?: string): Promise<AiUsageRecord[]> {
    const query = userId ? this.db.collection(COLLECTIONS.aiUsage).where('userId', '==', userId) : this.db.collection(COLLECTIONS.aiUsage);
    const snapshot = await query.get();
    return snapshot.docs.map((doc) => doc.data() as AiUsageRecord);
  }

  async getAdminUserAiUsageDetails(authUsers: EnumerableAuthUser[] = []): Promise<AdminUserAiUsageDetail[]> {
    const users: EnumerableAuthUser[] = authUsers.length > 0
      ? authUsers
      : (await this.listAllSubscriptions()).map((subscription) => ({
          uid: subscription.userId,
          email: subscription.email || null,
          displayName: null,
          photoURL: null,
          disabled: false,
        }));
    const details: AdminUserAiUsageDetail[] = [];
    for (const authUser of users) {
      const subscription = await this.getSubscription(authUser.uid);
      const period = await this.getCreditPeriod(authUser.uid);
      const usage = await this.getAiUsageHistory(authUser.uid);
      const promptTokens = usage.reduce((total, record) => total + record.promptTokens, 0);
      const completionTokens = usage.reduce((total, record) => total + record.completionTokens, 0);
      const last = [...usage].sort((a, b) => b.createdAt.localeCompare(a.createdAt))[0];
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
    return details;
  }

  async registerUser(_user: EnumerableAuthUser): Promise<void> {
    // Firebase Auth is authoritative; no local registry is persisted.
  }

  async listRegisteredUsers(): Promise<EnumerableAuthUser[]> {
    throw new Error('Firebase Auth enumeration belongs to listFirebaseUsers().');
  }

  async appendAuditLog(event: Omit<AdminAuditEvent, 'id' | 'timestamp'>): Promise<AdminAuditEvent> {
    const audit = this.newAudit(event);
    await this.db.collection(COLLECTIONS.adminAuditLog).doc(audit.id).create(audit);
    return audit;
  }

  async getAuditLogs(): Promise<AdminAuditEvent[]> {
    const snapshot = await this.db.collection(COLLECTIONS.adminAuditLog).orderBy('timestamp', 'desc').get();
    return snapshot.docs.map((doc) => doc.data() as AdminAuditEvent);
  }

  private newAudit(event: Omit<AdminAuditEvent, 'id' | 'timestamp'>): AdminAuditEvent {
    return { ...event, id: `audit_${Date.now()}_${Math.random().toString(36).slice(2, 8)}`, timestamp: new Date().toISOString() };
  }
}
