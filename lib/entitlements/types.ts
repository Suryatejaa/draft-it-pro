export type PlanId = 'free' | 'plus' | 'ai_plus';

export type FeatureId =
  | 'workspace'
  | 'development'
  | 'writing'
  | 'visual_planning'
  | 'production'
  | 'shoot'
  | 'project_tools'
  | 'co_drafter'
  | 'byok'
  | 'admin';

export type SubscriptionStatus = 'active' | 'suspended';
export type SubscriptionSource = 'free' | 'admin_grant' | 'billing';

export interface PlanConfig {
  id: PlanId;
  displayName: string;
  monthlyPricePaise: number;
  aiMonthlyBudgetPaise: number;
  features: FeatureId[];
  active: boolean;
  createdAt?: string;
  updatedAt?: string;
}

export interface UserSubscriptionRecord {
  userId: string;
  email?: string;
  planId: PlanId;
  status: SubscriptionStatus;
  subscriptionSource: SubscriptionSource;
  currentPeriodStart: string; // ISO string
  currentPeriodEnd: string;   // ISO string
  createdAt: string;
  updatedAt: string;
  // Reserved for future payment provider integration
  provider?: string;
  providerCustomerId?: string;
  providerSubscriptionId?: string;
}

export type DiscountType = 'percentage' | 'fixed';

export interface DiscountConfig {
  id: string;
  name: string;
  type: DiscountType;
  value: number; // percentage (0-100) or fixed amount in paise
  applicablePlanIds: PlanId[];
  startsAt: string; // ISO string
  endsAt: string;   // ISO string
  enabled: boolean;
  createdAt: string;
  updatedAt: string;
}

export interface AiUsageRecord {
  id: string;
  userId: string;
  requestId: string;
  provider: string;
  model: string;
  intent?: string;
  promptTokens: number;
  completionTokens: number;
  totalTokens: number;
  inputCostPaise: number;
  outputCostPaise: number;
  totalCostPaise: number;
  billingPeriodKey: string;
  createdAt: string;
}

export interface AiCreditPeriod {
  id: string; // `${userId}_${periodKey}`
  userId: string;
  /** Plan whose allowance was last synchronized into this active period. */
  planId?: PlanId;
  periodStart: string; // ISO string
  periodEnd: string;   // ISO string
  budgetPaise: number;
  consumedPaise: number;
  reservedPaise: number;
  updatedAt: string;
}

export interface EnumerableAuthUser {
  uid: string;
  email: string | null;
  displayName: string | null;
  photoURL: string | null;
  disabled: boolean;
  creationTime?: string | null;
  lastSignInTime?: string | null;
}

export interface AdminAuditEvent {
  id: string;
  actorAdminUserId: string;
  actorAdminEmail: string;
  targetUserId: string;
  action:
    | 'suspend'
    | 'reactivate'
    | 'grant_plan'
    | 'update_plan'
    | 'update_subscription'
    | 'extend_subscription'
    | 'reset_ai_credits'
    | 'create_discount'
    | 'update_discount'
    | 'toggle_discount';
  previousValue: unknown;
  newValue: unknown;
  timestamp: string;
}

export interface UserAiCreditStatus {
  hasHostedAi: boolean;
  remainingPercent: number; // 0 to 100 clamped
  nextResetDate: string | null; // ISO string or human string
  // NOTE: budgetPaise and consumedPaise are strictly omitted from normal user responses!
}

export interface AdminUserAiUsageDetail {
  userId: string;
  email?: string;
  displayName?: string | null;
  photoURL?: string | null;
  disabled?: boolean;
  creationTime?: string | null;
  lastSignInTime?: string | null;
  isAdmin?: boolean;
  planId: PlanId;
  status: SubscriptionStatus;
  subscriptionSource?: 'free' | 'admin_grant' | 'billing';
  currentPeriodStart: string;
  currentPeriodEnd: string;
  promptTokens: number;
  completionTokens: number;
  totalTokens: number;
  budgetPaise: number;
  consumedPaise: number;
  remainingPaise: number;
  estimatedInrCost: number; // in Rupees (paise / 100)
  lastAiRequestAt: string | null;
  requestCount: number;
}

export interface UserEntitlements {
  userId: string | null;
  email: string | null;
  isGuest: boolean;
  isAuthenticated: boolean;
  isAdmin: boolean;
  planId: PlanId;
  planDisplayName: string;
  status: SubscriptionStatus;
  features: FeatureId[];
  canAccessByok: boolean;
  canAccessAdmin: boolean;
  aiCreditStatus: UserAiCreditStatus;
}
