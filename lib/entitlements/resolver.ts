import type {
  PlanId,
  FeatureId,
  PlanConfig,
  UserSubscriptionRecord,
  AiCreditPeriod,
  UserEntitlements,
  UserAiCreditStatus,
} from './types.ts';
import { DEFAULT_PLAN_CONFIGS, FREE_FEATURES } from './plans.ts';
import { isUserAdmin } from './admin.ts';

export interface ResolveOptions {
  user?: {
    uid: string;
    email?: string | null;
  } | null;
  subscription?: UserSubscriptionRecord | null;
  planConfigs?: Record<PlanId, PlanConfig>;
  creditPeriod?: AiCreditPeriod | null;
  now?: Date;
}

export function resolveEntitlements({
  user,
  subscription,
  planConfigs = DEFAULT_PLAN_CONFIGS,
  creditPeriod,
}: ResolveOptions): UserEntitlements {
  // 1. Guest / unauthenticated state
  if (!user || !user.uid) {
    return {
      userId: null,
      email: null,
      isGuest: true,
      isAuthenticated: false,
      isAdmin: false,
      planId: 'free',
      planDisplayName: planConfigs.free?.displayName || 'Free',
      status: 'active',
      features: [...FREE_FEATURES],
      canAccessByok: false,
      canAccessAdmin: false,
      aiCreditStatus: {
        hasHostedAi: false,
        remainingPercent: 0,
        nextResetDate: null,
      },
    };
  }

  // 2. Authenticated user
  const email = user.email ? user.email.trim().toLowerCase() : null;
  const isAdminUser = isUserAdmin(email);

  // Determine subscription (defaults to Free if not found)
  const effectivePlanId: PlanId = subscription?.planId || 'free';
  const planConfig = planConfigs[effectivePlanId] || DEFAULT_PLAN_CONFIGS[effectivePlanId] || DEFAULT_PLAN_CONFIGS.free;
  const status = subscription?.status || 'active';

  // If user is suspended, they retain their planId assignment but protected features are blocked
  let features: FeatureId[] = [];
  if (status === 'active') {
    features = [...(planConfig.features || FREE_FEATURES)];
  } else {
    // Suspended users cannot access protected features
    features = [];
  }

  // Calculate safe AI credit percentage (NO rupee values exposed to normal user)
  let aiCreditStatus: UserAiCreditStatus;
  const monthlyBudget = planConfig.aiMonthlyBudgetPaise || 0;

  if (monthlyBudget <= 0 || status !== 'active') {
    aiCreditStatus = {
      hasHostedAi: false,
      remainingPercent: 0,
      nextResetDate: null,
    };
  } else {
    const consumed = creditPeriod?.consumedPaise || 0;
    const reserved = creditPeriod?.reservedPaise || 0;
    const totalUsed = consumed + reserved;
    const rawPercent = ((monthlyBudget - totalUsed) / monthlyBudget) * 100;
    const clampedPercent = Math.max(0, Math.min(100, Math.round(rawPercent)));

    aiCreditStatus = {
      hasHostedAi: true,
      remainingPercent: clampedPercent,
      nextResetDate: subscription?.currentPeriodEnd || creditPeriod?.periodEnd || null,
    };
  }

  return {
    userId: user.uid,
    email,
    isGuest: false,
    isAuthenticated: true,
    isAdmin: isAdminUser,
    planId: effectivePlanId,
    planDisplayName: planConfig.displayName,
    status,
    features,
    // BYOK and Admin Dashboard are strictly for verified admins
    canAccessByok: isAdminUser,
    canAccessAdmin: isAdminUser,
    aiCreditStatus,
  };
}

/**
 * Helpers for checking feature access and admin status.
 */
export function canAccessFeature(
  entitlements: UserEntitlements,
  featureId: FeatureId
): boolean {
  if (entitlements.status === 'suspended') return false;
  if (featureId === 'byok') return entitlements.canAccessByok;
  if (featureId === 'admin') return entitlements.canAccessAdmin;
  return entitlements.features.includes(featureId);
}

export function requireFeature(
  entitlements: UserEntitlements,
  featureId: FeatureId
): void {
  if (!canAccessFeature(entitlements, featureId)) {
    const err = new Error(
      `Access denied. Feature '${featureId}' requires an upgraded active subscription.`
    );
    (err as unknown as { statusCode: number }).statusCode = 403;
    throw err;
  }
}

export function isAdmin(entitlements: UserEntitlements): boolean {
  return entitlements.isAdmin;
}

export function getAiCreditStatus(entitlements: UserEntitlements): UserAiCreditStatus {
  return entitlements.aiCreditStatus;
}

/**
 * Map view names to feature categories for Draft-it PRO sidebar gating.
 */
export const VIEW_TO_FEATURE_MAP: Record<string, FeatureId> = {
  // Workspace & Development (Free & Guest)
  'Series overview': 'workspace',
  'Overview': 'development',
  'Episode overview': 'development',
  'Story': 'development',
  'Episode story': 'development',
  'Scene cards': 'development',
  'Characters': 'development',

  // Writing (Free & Guest)
  'Screenplay': 'writing',

  // Visual Planning (Plus / AI Plus)
  'Shot Designer': 'visual_planning',
  'Storyboard': 'visual_planning',
  'Shot list': 'visual_planning',

  // Production (Plus / AI Plus)
  'Breakdown': 'production',
  'Locations': 'production',
  'Cast & Crew': 'production',
  'Assets': 'production',
  'Schedule': 'production',

  // Shoot (Plus / AI Plus)
  'Stripboard': 'shoot',
  'Call Sheets': 'shoot',
  'Continuity': 'shoot',

  // Project (Plus / AI Plus)
  'Documents': 'project_tools',
  'Export': 'project_tools',
};

export function isViewLocked(viewName: string, entitlements: UserEntitlements): boolean {
  const requiredFeature = VIEW_TO_FEATURE_MAP[viewName];
  if (!requiredFeature) return false;
  return !canAccessFeature(entitlements, requiredFeature);
}
