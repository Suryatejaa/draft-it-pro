import type {
  CustomerPlanPricing,
  PlanConfig,
  PlanId,
  DiscountConfig,
  FeatureId,
} from './types.ts';

export const ALL_PRODUCT_FEATURES: FeatureId[] = [
  'workspace',
  'development',
  'writing',
  'visual_planning',
  'production',
  'shoot',
  'project_tools',
  'co_drafter',
];

export const FREE_FEATURES: FeatureId[] = [
  'workspace',
  'development',
  'writing',
];

export const FREE_PLAN_ID = 'free';

export const PLAN_FEATURE_IDS: FeatureId[] = [
  'workspace',
  'development',
  'writing',
  'visual_planning',
  'production',
  'shoot',
  'project_tools',
  'co_drafter',
];

export function isFreePlanId(planId: string): boolean {
  return planId === FREE_PLAN_ID;
}

export const DEFAULT_PLAN_CONFIGS: Record<PlanId, PlanConfig> = {
  free: {
    id: 'free',
    displayName: 'Free',
    monthlyPricePaise: 0,
    aiMonthlyBudgetPaise: 0,
    features: [...FREE_FEATURES],
    active: true,
  },
  plus: {
    id: 'plus',
    displayName: 'Plus',
    monthlyPricePaise: 79900, // ₹799.00
    aiMonthlyBudgetPaise: 5000, // ₹50.00
    features: [...ALL_PRODUCT_FEATURES],
    active: true,
  },
  ai_plus: {
    id: 'ai_plus',
    displayName: 'AI Plus',
    monthlyPricePaise: 149900, // ₹1,499.00
    aiMonthlyBudgetPaise: 20000, // ₹200.00
    features: [...ALL_PRODUCT_FEATURES],
    active: true,
  },
};

export function validateDiscount(
  discount: Partial<DiscountConfig>,
  planConfigs: Record<PlanId, PlanConfig> = DEFAULT_PLAN_CONFIGS,
): { valid: boolean; error?: string } {
  if (!discount.name || !discount.name.trim()) {
    return { valid: false, error: 'Discount name is required.' };
  }

  if (discount.type !== 'percentage' && discount.type !== 'fixed') {
    return {
      valid: false,
      error: 'Discount type must be percentage or fixed.',
    };
  }

  if (
    typeof discount.value !== 'number' ||
    isNaN(discount.value) ||
    discount.value <= 0
  ) {
    return { valid: false, error: 'Discount value must be a positive number.' };
  }

  if (discount.type === 'percentage') {
    if (discount.value > 100) {
      return { valid: false, error: 'Percentage discount cannot exceed 100%.' };
    }
  }

  if (
    !Array.isArray(discount.applicablePlanIds) ||
    discount.applicablePlanIds.length === 0
  ) {
    return { valid: false, error: 'Discount must apply to at least one plan.' };
  }

  const validPlanIds = Object.keys(planConfigs);
  for (const pid of discount.applicablePlanIds) {
    if (!validPlanIds.includes(pid)) {
      return { valid: false, error: `Invalid applicable plan ID: ${pid}` };
    }
  }

  if (discount.startsAt && discount.endsAt) {
    const start = new Date(discount.startsAt).getTime();
    const end = new Date(discount.endsAt).getTime();
    if (isNaN(start) || isNaN(end)) {
      return { valid: false, error: 'Invalid start or end date format.' };
    }
    if (start > end) {
      return {
        valid: false,
        error: 'Discount start date must be before end date.',
      };
    }
  }

  // Validate that fixed discount cannot produce negative effective price
  if (discount.type === 'fixed') {
    for (const pid of discount.applicablePlanIds) {
      const plan = planConfigs[pid];
      if (plan && plan.monthlyPricePaise - discount.value < 0) {
        return {
          valid: false,
          error: `Fixed discount of ₹${discount.value / 100} exceeds base price of ${plan.displayName} (₹${plan.monthlyPricePaise / 100}).`,
        };
      }
    }
  }

  return { valid: true };
}

export function calculateEffectivePricePaise(
  basePricePaise: number,
  discounts: DiscountConfig[] = [],
  planId: PlanId,
  now: Date = new Date(),
): { effectivePricePaise: number; appliedDiscount: DiscountConfig | null } {
  if (basePricePaise <= 0 || discounts.length === 0) {
    return { effectivePricePaise: basePricePaise, appliedDiscount: null };
  }

  const currentTime = now.getTime();
  const applicable = discounts.filter((d) => {
    if (!d.enabled) return false;
    if (!d.applicablePlanIds.includes(planId)) return false;
    if (d.startsAt && new Date(d.startsAt).getTime() > currentTime)
      return false;
    if (d.endsAt && new Date(d.endsAt).getTime() < currentTime) return false;
    return true;
  });

  if (applicable.length === 0) {
    return { effectivePricePaise: basePricePaise, appliedDiscount: null };
  }

  // Pick the most beneficial discount for the customer
  let bestPrice = basePricePaise;
  let bestDiscount: DiscountConfig | null = null;

  for (const d of applicable) {
    let candidatePrice = basePricePaise;
    if (d.type === 'percentage') {
      const reduction = Math.round((basePricePaise * d.value) / 100);
      candidatePrice = Math.max(0, basePricePaise - reduction);
    } else if (d.type === 'fixed') {
      candidatePrice = Math.max(0, basePricePaise - d.value);
    }

    if (candidatePrice < bestPrice) {
      bestPrice = candidatePrice;
      bestDiscount = d;
    }
  }

  return {
    effectivePricePaise: Math.max(0, bestPrice),
    appliedDiscount: bestDiscount,
  };
}

export function buildCustomerPlanPricing(
  planConfigs: Record<PlanId, PlanConfig>,
  discounts: DiscountConfig[],
  now: Date = new Date(),
): CustomerPlanPricing[] {
  return Object.values(planConfigs)
    .filter((plan) => plan.active && !isFreePlanId(plan.id))
    .sort(
      (a, b) =>
        (a.displayOrder ?? 0) - (b.displayOrder ?? 0) ||
        a.displayName.localeCompare(b.displayName),
    )
    .map((plan) => {
      const planId = plan.id;
      const { effectivePricePaise, appliedDiscount } =
        calculateEffectivePricePaise(
          plan.monthlyPricePaise,
          discounts,
          planId,
          now,
        );
      return {
        id: planId,
        name: plan.displayName,
        basePricePaise: plan.monthlyPricePaise,
        effectivePricePaise,
        hasDiscount: Boolean(appliedDiscount),
        ...(appliedDiscount
          ? {
              discount: {
                id: appliedDiscount.id,
                name: appliedDiscount.name,
                type: appliedDiscount.type,
                value: appliedDiscount.value,
                startsAt: appliedDiscount.startsAt,
                endsAt: appliedDiscount.endsAt,
              },
            }
          : {}),
        features: [...plan.features],
      };
    });
}

export function validatePlanConfig(
  plan: Partial<PlanConfig>,
  existingPlans: Record<PlanId, PlanConfig> = DEFAULT_PLAN_CONFIGS,
): { valid: boolean; error?: string } {
  if (!plan.id || !/^[a-z0-9]+(?:[-_][a-z0-9]+)*$/.test(plan.id)) {
    return { valid: false, error: 'Plan ID must be a lowercase slug.' };
  }
  if (!plan.displayName?.trim())
    return { valid: false, error: 'Plan display name is required.' };
  if (
    !Number.isInteger(plan.monthlyPricePaise) ||
    (plan.monthlyPricePaise ?? -1) < 0
  ) {
    return {
      valid: false,
      error: 'Monthly price must be a non-negative integer in paise.',
    };
  }
  if (
    !Number.isInteger(plan.aiMonthlyBudgetPaise) ||
    (plan.aiMonthlyBudgetPaise ?? -1) < 0
  ) {
    return {
      valid: false,
      error: 'Hosted AI allowance must be a non-negative integer in paise.',
    };
  }
  if (
    !Array.isArray(plan.features) ||
    plan.features.some((feature) => !PLAN_FEATURE_IDS.includes(feature))
  ) {
    return { valid: false, error: 'Plan contains an invalid feature.' };
  }
  if (plan.id === FREE_PLAN_ID && plan.monthlyPricePaise !== 0) {
    return {
      valid: false,
      error: 'The Free plan must have a zero base price.',
    };
  }
  if (existingPlans[plan.id] && plan.id !== existingPlans[plan.id].id) {
    return { valid: false, error: 'Plan ID is immutable.' };
  }
  return { valid: true };
}
