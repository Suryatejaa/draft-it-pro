'use client';

import { useEffect, useState } from 'react';
import type { User } from 'firebase/auth';

import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
  DialogDescription,
} from '@/components/ui/dialog';
import { Button } from '@/components/ui/button';
import { Check, Sparkles, Lock, ShieldCheck, Zap } from 'lucide-react';
import type { CustomerPlanPricing, PlanId } from '@/lib/entitlements/types';

function formatPrice(paise: number) {
  return `₹${(paise / 100).toLocaleString('en-IN', { maximumFractionDigits: 2 })}`;
}

interface UpgradeModalProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  targetFeatureName?: string;
  user: User | null;
  onEntitlementsRefresh?: () => void;
}

export function UpgradeModal({
  open,
  onOpenChange,
  targetFeatureName,
  user,
  onEntitlementsRefresh,
}: UpgradeModalProps) {
  const [plans, setPlans] = useState<CustomerPlanPricing[]>([]);
  const [pending, setPending] = useState<PlanId[]>([]);
  const [loading, setLoading] = useState(false);
  const [requesting, setRequesting] = useState<PlanId | null>(null);
  const [message, setMessage] = useState('');

  useEffect(() => {
    if (!open) return;
    let cancelled = false;
    setLoading(true);
    setMessage('');
    Promise.all([
      fetch('/api/pricing').then((response) => response.json()),
      user
        ? user.getIdToken().then((token) =>
            fetch('/api/plan-requests', {
              headers: { Authorization: `Bearer ${token}` },
            }).then((response) => response.json()),
          )
        : Promise.resolve({ requests: [] }),
    ])
      .then(([pricing, requests]) => {
        if (cancelled) return;
        setPlans(pricing.plans || []);
        setPending(
          (requests.requests || []).map(
            (request: { requestedPlanId: PlanId }) => request.requestedPlanId,
          ),
        );
      })
      .catch(() => {
        if (!cancelled) setMessage('Could not load current plan pricing.');
      })
      .finally(() => {
        if (!cancelled) setLoading(false);
      });
    return () => {
      cancelled = true;
    };
  }, [open, user]);

  async function requestPlan(planId: PlanId) {
    if (!user) {
      setMessage('Sign in before requesting a paid plan.');
      return;
    }
    setRequesting(planId);
    setMessage('');
    try {
      const token = await user.getIdToken();
      const response = await fetch('/api/plan-requests', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          Authorization: `Bearer ${token}`,
        },
        body: JSON.stringify({ requestedPlanId: planId }),
      });
      const data = await response.json();
      if (!response.ok)
        throw new Error(data.error || 'Could not request plan.');
      setPending((current) =>
        current.includes(planId) ? current : [...current, planId],
      );
      setMessage('Request pending. An administrator will review it.');
      onEntitlementsRefresh?.();
    } catch (error) {
      setMessage(
        error instanceof Error ? error.message : 'Could not request plan.',
      );
    } finally {
      setRequesting(null);
    }
  }

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent
        style={{
          maxWidth: 960,
          background: 'linear-gradient(180deg, #111418 0%, #0c0e11 100%)',
          border: '1px solid rgba(255, 255, 255, 0.1)',
          color: '#f3f4f6',
        }}
      >
        <DialogHeader className="space-y-2 pb-2 text-center">
          <div className="mx-auto mb-1 flex h-10 w-10 items-center justify-center rounded-full border border-primary/20 bg-primary/10 text-primary">
            <Lock className="h-5 w-5" />
          </div>
          <DialogTitle className="text-xl font-bold tracking-tight text-white">
            {targetFeatureName
              ? `Unlock ${targetFeatureName}`
              : 'Upgrade to Draft-it PRO'}
          </DialogTitle>
          <DialogDescription className="mx-auto max-w-md text-sm text-muted-foreground">
            {targetFeatureName
              ? `${targetFeatureName} is available on the paid plans below.`
              : 'Unlock advanced visual planning, production tools, shoot management, and hosted Co-Drafter AI credits.'}
          </DialogDescription>
        </DialogHeader>

        {loading ? (
          <div className="py-10 text-center text-sm text-muted-foreground">
            Loading current pricing…
          </div>
        ) : (
          <div className="my-3 grid grid-cols-1 gap-4 md:grid-cols-2 lg:grid-cols-2">
            {plans.map((plan, index) => {
              const isFeatured = index === plans.length - 1 && plans.length > 1;
              const isPending = pending.includes(plan.id);
              return (
                <div
                  key={plan.id}
                  className="relative flex flex-col justify-between rounded-xl p-5"
                  style={{
                    background: isFeatured
                      ? 'linear-gradient(180deg, rgba(234, 88, 12, 0.08) 0%, rgba(20, 20, 25, 0.6) 100%)'
                      : 'rgba(255, 255, 255, 0.03)',
                    border: isFeatured
                      ? '1px solid rgba(234, 88, 12, 0.3)'
                      : '1px solid rgba(255, 255, 255, 0.08)',
                  }}
                >
                  <div>
                    <div className="mb-3 flex items-center justify-between">
                      <span
                        className={`text-xs font-semibold uppercase tracking-wider ${isFeatured ? 'text-orange-400' : 'text-muted-foreground'}`}
                      >
                        {plan.name}
                      </span>
                      <span className="rounded-full bg-white/10 px-2 py-0.5 text-[10px] font-semibold text-white">
                        {isFeatured ? (
                          <>
                            <Zap className="mr-1 inline h-3 w-3" /> Best Value
                          </>
                        ) : (
                          'Pro Filmmaking'
                        )}
                      </span>
                    </div>
                    <div className="mb-4 flex items-baseline gap-2">
                      <span className="text-3xl font-extrabold text-white">
                        {formatPrice(plan.effectivePricePaise)}
                      </span>
                      <span className="text-xs text-muted-foreground">
                        /month
                      </span>
                      {plan.hasDiscount && (
                        <span className="text-xs text-muted-foreground line-through">
                          {formatPrice(plan.basePricePaise)}
                        </span>
                      )}
                    </div>
                    {plan.discount && (
                      <div className="mb-3 text-[10px] font-semibold text-emerald-400">
                        {plan.discount.type === 'percentage'
                          ? `${plan.discount.value}% OFF`
                          : `${formatPrice(plan.discount.value)} OFF`}{' '}
                        · {plan.discount.name}
                      </div>
                    )}
                    <div className="space-y-2.5 text-xs text-muted-foreground">
                      {plan.features.map((feature) => (
                        <div key={feature} className="flex items-center gap-2">
                          <Check className="h-4 w-4 shrink-0 text-emerald-400" />
                          <span className="capitalize">
                            {feature.replaceAll('_', ' ')}
                          </span>
                        </div>
                      ))}
                      {isFeatured && (
                        <div className="flex items-center gap-2">
                          <ShieldCheck className="h-4 w-4 shrink-0 text-emerald-400" />
                          <span>Priority screenplay co-writing</span>
                        </div>
                      )}
                    </div>
                  </div>
                  <div className="mt-6">
                    <Button
                      className={`w-full ${isFeatured ? 'bg-orange-600 text-white hover:bg-orange-500' : 'border border-white/10 bg-white/10 text-white hover:bg-white/20'}`}
                      disabled={isPending || requesting === plan.id || !user}
                      onClick={() => requestPlan(plan.id)}
                    >
                      {isPending
                        ? 'Request pending'
                        : requesting === plan.id
                          ? 'Requesting…'
                          : user
                            ? `Request ${plan.name}`
                            : 'Sign in to request'}
                    </Button>
                  </div>
                </div>
              );
            })}
          </div>
        )}
        {message && (
          <p className="text-center text-xs text-primary">{message}</p>
        )}
        <div className="border-t border-white/5 pt-2 text-center text-[11px] text-muted-foreground">
          Billing cycle rolls forward monthly. Prices include applicable taxes.
          Plan requests are reviewed by an administrator.
        </div>
      </DialogContent>
    </Dialog>
  );
}
