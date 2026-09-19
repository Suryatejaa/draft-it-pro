'use client';

import { useState, useEffect, useCallback } from 'react';
import {
  Users,
  CreditCard,
  History,
  Shield,
  AlertTriangle,
  CheckCircle2,
  XCircle,
  Plus,
  RefreshCw,
  Eye,
  Percent,
  Tag,
  Sliders,
  Sparkles,
} from 'lucide-react';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
  DialogDescription,
  DialogFooter,
} from '@/components/ui/dialog';
import type {
  PlanId,
  PlanConfig,
  DiscountConfig,
  AdminUserAiUsageDetail,
  AdminAuditEvent,
  PlanRequest,
} from '@/lib/entitlements/types';
import {
  calculateEffectivePricePaise,
  PLAN_FEATURE_IDS,
} from '@/lib/entitlements/plans';
import { firebaseClient, googleSignIn } from '@/lib/firebase';
import { onAuthStateChanged, type User } from 'firebase/auth';

function toDateInputValue(isoDate: string): string {
  return isoDate ? isoDate.slice(0, 10) : '';
}

export default function AdminDashboardPage() {
  const [authUser, setAuthUser] = useState<User | null>(null);
  const [authChecking, setAuthChecking] = useState(true);
  const [activeTab, setActiveTab] = useState<
    'users' | 'plans' | 'requests' | 'audit'
  >('users');
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  // Users data
  const [users, setUsers] = useState<AdminUserAiUsageDetail[]>([]);
  const [auditLogs, setAuditLogs] = useState<AdminAuditEvent[]>([]);
  const [planRequests, setPlanRequests] = useState<PlanRequest[]>([]);

  // Plans & Discounts data
  const [plans, setPlans] = useState<Record<PlanId, PlanConfig> | null>(null);
  const [discounts, setDiscounts] = useState<DiscountConfig[]>([]);

  // Plan Grant Confirmation Modal State
  const [grantModalOpen, setGrantModalOpen] = useState(false);
  const [grantTargetUser, setGrantTargetUser] =
    useState<AdminUserAiUsageDetail | null>(null);
  const [selectedPlanToGrant, setSelectedPlanToGrant] =
    useState<PlanId>('free');
  const [grantSubmitting, setGrantSubmitting] = useState(false);

  // Usage Inspection Drawer/Modal State
  const [inspectionUser, setInspectionUser] =
    useState<AdminUserAiUsageDetail | null>(null);

  // Edit Plan Modal State
  const [editingPlan, setEditingPlan] = useState<PlanConfig | null>(null);
  const [creatingPlan, setCreatingPlan] = useState(false);
  const [editPriceRupees, setEditPriceRupees] = useState('');
  const [editBudgetRupees, setEditBudgetRupees] = useState('');

  // Discount Modal State
  const [discountModalOpen, setDiscountModalOpen] = useState(false);
  const [editingDiscount, setEditingDiscount] = useState<DiscountConfig | null>(
    null,
  );
  const [discountName, setDiscountName] = useState('');
  const [discountType, setDiscountType] = useState<'percentage' | 'fixed'>(
    'percentage',
  );
  const [discountValue, setDiscountValue] = useState('');
  const [discountPlans, setDiscountPlans] = useState<PlanId[]>([]);
  const [discountStartsAt, setDiscountStartsAt] = useState('');
  const [discountEndsAt, setDiscountEndsAt] = useState('');
  const [discountError, setDiscountError] = useState<string | null>(null);

  // Subscribe to Firebase Auth state on mount
  useEffect(() => {
    const authMountStartedAt = performance.now();
    let auth;
    try {
      auth = firebaseClient().auth;
    } catch (e: any) {
      setAuthChecking(false);
      setError(e.message || 'Firebase initialization failed.');
      return;
    }

    const unsubscribe = onAuthStateChanged(auth, (user) => {
      console.info('[admin-timing] frontend onAuthStateChanged', {
        elapsedMs: Math.round(performance.now() - authMountStartedAt),
        authenticated: Boolean(user),
      });
      setAuthUser(user);
      setAuthChecking(false);
    });

    return () => unsubscribe();
  }, []);

  /** Fetch wrapper that automatically attaches the current authenticated user's Bearer token. */
  const adminFetch = useCallback(
    async (url: string, options: RequestInit = {}) => {
      let token: string | null = null;
      if (authUser) {
        try {
          token = await authUser.getIdToken();
        } catch {
          token = null;
        }
      }
      return fetch(url, {
        ...options,
        headers: {
          'Content-Type': 'application/json',
          ...((options.headers as Record<string, string>) || {}),
          ...(token ? { Authorization: `Bearer ${token}` } : {}),
        },
      });
    },
    [authUser],
  );

  // Fetch data
  const loadData = useCallback(
    async (userToUse?: User | null) => {
      const user = userToUse !== undefined ? userToUse : authUser;
      if (!user) {
        setLoading(false);
        return;
      }

      setLoading(true);
      setError(null);
      const loadStartedAt = performance.now();
      try {
        const tokenStartedAt = performance.now();
        const token = await user.getIdToken();
        console.info(
          '[admin-timing] frontend getIdToken',
          Math.round(performance.now() - tokenStartedAt),
          'ms',
        );
        const headers = {
          'Content-Type': 'application/json',
          Authorization: `Bearer ${token}`,
        };

        const requestsStartedAt = performance.now();
        const [usersRes, plansRes, discountsRes, requestsRes] =
          await Promise.all([
            fetch('/api/admin/users', { headers }),
            fetch('/api/admin/plans', { headers }),
            fetch('/api/admin/discounts', { headers }),
            fetch('/api/admin/plan-requests', { headers }),
          ]);
        console.info(
          '[admin-timing] frontend parallel API requests',
          Math.round(performance.now() - requestsStartedAt),
          'ms',
        );
        if (!usersRes.ok) {
          if (usersRes.status === 401 || usersRes.status === 403) {
            throw new Error(
              `Access denied for ${user.email || 'this account'}. You must be an authorized administrator to view this page.`,
            );
          }
          throw new Error(`Failed to load admin data (${usersRes.status})`);
        }
        const usersData = await usersRes.json();
        setUsers(usersData.users || []);
        setAuditLogs(usersData.auditLogs || []);

        if (plansRes.ok) {
          setPlans(await plansRes.json());
        }

        if (discountsRes.ok) {
          setDiscounts(await discountsRes.json());
        }
        if (requestsRes.ok) {
          setPlanRequests((await requestsRes.json()).requests || []);
        }
        console.info(
          '[admin-timing] frontend total loadData',
          Math.round(performance.now() - loadStartedAt),
          'ms',
        );
      } catch (err: any) {
        setError(err.message || 'An error occurred loading admin dashboard.');
      } finally {
        setLoading(false);
      }
    },
    [authUser],
  );

  useEffect(() => {
    if (!authChecking && authUser) {
      loadData(authUser);
    } else if (!authChecking && !authUser) {
      setLoading(false);
    }
  }, [authChecking, authUser, loadData]);

  const processPlanRequest = async (
    requestId: string,
    action: 'approve' | 'reject',
  ) => {
    try {
      const res = await adminFetch('/api/admin/plan-requests', {
        method: 'POST',
        body: JSON.stringify({ requestId, action }),
      });
      if (!res.ok) {
        const data = await res.json();
        throw new Error(data.error || 'Could not process plan request.');
      }
      setPlanRequests((current) =>
        current.filter((request) => request.id !== requestId),
      );
    } catch (err: any) {
      alert(err.message);
    }
  };

  // Handle plan grant
  const executePlanGrant = async () => {
    if (!grantTargetUser) return;
    setGrantSubmitting(true);
    try {
      const res = await adminFetch('/api/admin/users', {
        method: 'POST',
        body: JSON.stringify({
          action: 'grant_plan',
          targetUserId: grantTargetUser.userId,
          targetEmail: grantTargetUser.email,
          planId: selectedPlanToGrant,
        }),
      });

      if (!res.ok) {
        const data = await res.json();
        throw new Error(data.error || 'Failed to grant plan');
      }

      setGrantModalOpen(false);
      setGrantTargetUser(null);
      await loadData();
    } catch (err: any) {
      alert(err.message);
    } finally {
      setGrantSubmitting(false);
    }
  };

  // Handle suspend / reactivate
  const toggleUserSuspension = async (user: AdminUserAiUsageDetail) => {
    const action = user.status === 'active' ? 'suspend' : 'reactivate';
    const confirmMessage =
      action === 'suspend'
        ? `Are you sure you want to suspend access for ${user.email || user.userId}?`
        : `Reactivate access for ${user.email || user.userId}?`;

    if (!confirm(confirmMessage)) return;

    try {
      const res = await adminFetch('/api/admin/users', {
        method: 'POST',
        body: JSON.stringify({
          action,
          targetUserId: user.userId,
        }),
      });

      if (!res.ok) {
        const data = await res.json();
        throw new Error(data.error || `Failed to ${action} user`);
      }

      await loadData();
    } catch (err: any) {
      alert(err.message);
    }
  };

  // Handle plan updates
  const savePlanEdit = async () => {
    if (!editingPlan) return;
    const pricePaise = Math.round(parseFloat(editPriceRupees || '0') * 100);
    const budgetPaise = Math.round(parseFloat(editBudgetRupees || '0') * 100);

    try {
      const res = await adminFetch('/api/admin/plans', {
        method: 'POST',
        body: JSON.stringify({
          action: creatingPlan ? 'create' : 'update',
          planId: editingPlan.id,
          ...(creatingPlan
            ? {
                plan: {
                  ...editingPlan,
                  monthlyPricePaise: pricePaise,
                  aiMonthlyBudgetPaise: budgetPaise,
                },
              }
            : {
                updates: {
                  displayName: editingPlan.displayName,
                  monthlyPricePaise: pricePaise,
                  aiMonthlyBudgetPaise: budgetPaise,
                  active: editingPlan.active,
                  displayOrder: editingPlan.displayOrder,
                  features: editingPlan.features,
                },
              }),
        }),
      });

      if (!res.ok) {
        const data = await res.json();
        throw new Error(data.error || 'Failed to update plan');
      }

      setEditingPlan(null);
      setCreatingPlan(false);
      await loadData();
    } catch (err: any) {
      alert(err.message);
    }
  };

  const mutatePlan = async (
    planId: string,
    action: 'archive' | 'delete' | 'update',
    active?: boolean,
  ) => {
    if (
      action === 'delete' &&
      !window.confirm('Delete this unused plan permanently?')
    )
      return;
    try {
      const res = await adminFetch('/api/admin/plans', {
        method: 'POST',
        body: JSON.stringify({
          action,
          planId,
          ...(action === 'update' ? { updates: { active } } : {}),
        }),
      });
      if (!res.ok)
        throw new Error((await res.json()).error || 'Could not update plan.');
      await loadData();
    } catch (error: any) {
      alert(error.message);
    }
  };

  // Handle create discount
  const saveDiscount = async () => {
    setDiscountError(null);
    const valNum = parseFloat(discountValue);
    if (isNaN(valNum) || valNum <= 0) {
      setDiscountError('Please enter a valid positive discount amount.');
      return;
    }

    const value =
      discountType === 'percentage' ? valNum : Math.round(valNum * 100);

    try {
      const res = await adminFetch('/api/admin/discounts', {
        method: 'POST',
        body: JSON.stringify({
          action: editingDiscount ? 'update' : 'create',
          ...(editingDiscount ? { discountId: editingDiscount.id } : {}),
          discount: {
            name: discountName,
            type: discountType,
            value,
            applicablePlanIds: discountPlans,
            startsAt: discountStartsAt || new Date().toISOString(),
            endsAt:
              discountEndsAt ||
              new Date(Date.now() + 30 * 86400000).toISOString(),
            enabled: editingDiscount?.enabled ?? true,
          },
        }),
      });

      if (!res.ok) {
        const data = await res.json();
        throw new Error(data.error || 'Failed to create discount');
      }

      setDiscountModalOpen(false);
      setEditingDiscount(null);
      setDiscountName('');
      setDiscountValue('');
      await loadData();
    } catch (err: any) {
      setDiscountError(err.message);
    }
  };

  const openNewDiscount = () => {
    setDiscountError(null);
    setEditingDiscount(null);
    setDiscountName('');
    setDiscountType('percentage');
    setDiscountValue('');
    setDiscountPlans(
      Object.values(plans || {})
        .filter((plan) => plan.id !== 'free' && plan.active)
        .map((plan) => plan.id),
    );
    setDiscountStartsAt('');
    setDiscountEndsAt('');
    setDiscountModalOpen(true);
  };

  const deleteDiscount = async (id: string) => {
    if (!window.confirm('Delete this discount permanently?')) return;
    try {
      const res = await adminFetch('/api/admin/discounts', {
        method: 'POST',
        body: JSON.stringify({ action: 'delete', discountId: id }),
      });
      if (!res.ok)
        throw new Error(
          (await res.json()).error || 'Could not delete discount.',
        );
      await loadData();
    } catch (error: any) {
      alert(error.message);
    }
  };

  const toggleDiscountStatus = async (id: string, currentEnabled: boolean) => {
    try {
      const res = await adminFetch('/api/admin/discounts', {
        method: 'POST',
        body: JSON.stringify({
          action: 'toggle',
          discountId: id,
          enabled: !currentEnabled,
        }),
      });

      if (!res.ok) {
        const data = await res.json();
        throw new Error(data.error || 'Failed to toggle discount');
      }

      await loadData();
    } catch (err: any) {
      alert(err.message);
    }
  };

  if (authChecking) {
    return (
      <div className="flex flex-col items-center justify-center min-h-[50vh] text-center">
        <RefreshCw className="w-8 h-8 text-orange-400 animate-spin mb-3" />
        <p className="text-sm text-slate-300 font-medium">
          Verifying administrator session…
        </p>
      </div>
    );
  }

  if (!authUser) {
    return (
      <div className="bg-[#0e1116] border border-white/10 rounded-xl p-8 text-center max-w-md mx-auto mt-12 shadow-2xl">
        <Shield className="w-12 h-12 text-orange-400 mx-auto mb-3" />
        <h2 className="text-lg font-bold text-white mb-2">
          Administrator Sign-In Required
        </h2>
        <p className="text-xs text-muted-foreground mb-6 leading-relaxed">
          You must be signed in with an authorized Google administrator account
          to access the Admin Control Dashboard.
        </p>
        <div className="flex flex-col gap-2.5">
          <Button
            onClick={() => googleSignIn()}
            className="w-full bg-orange-500 hover:bg-orange-600 text-white font-medium text-xs cursor-pointer"
          >
            Sign in with Google
          </Button>
          <a
            href="/"
            className="text-xs text-muted-foreground hover:text-white py-1.5 transition-colors"
          >
            ← Return to Workspace
          </a>
        </div>
      </div>
    );
  }

  if (error) {
    return (
      <div className="bg-red-500/10 border border-red-500/20 rounded-xl p-8 text-center max-w-lg mx-auto mt-12 shadow-2xl">
        <AlertTriangle className="w-10 h-10 text-red-400 mx-auto mb-3" />
        <h2 className="text-lg font-bold text-white mb-1">Access Restricted</h2>
        <p className="text-sm text-red-200 mb-3">{error}</p>
        <p className="text-xs text-muted-foreground/80 mb-6 leading-relaxed">
          Signed in as{' '}
          <code className="bg-white/10 text-white px-1.5 py-0.5 rounded font-mono">
            {authUser.email}
          </code>
          .<br />
          Ensure your email is present in the server&apos;s{' '}
          <code className="bg-white/10 px-1 py-0.5 rounded font-mono text-white">
            ADMIN_EMAILS
          </code>{' '}
          environment variable and the server has been restarted.
        </p>
        <div className="flex items-center justify-center gap-3">
          <Button
            size="sm"
            variant="outline"
            onClick={() => loadData(authUser)}
            className="text-xs border-white/10 hover:bg-white/5 cursor-pointer"
          >
            <RefreshCw className="w-3.5 h-3.5 mr-1.5" /> Try Again
          </Button>
          <a
            href="/"
            className="text-xs text-muted-foreground hover:text-white px-3 py-1.5 rounded-md transition-colors"
          >
            Return to Workspace
          </a>
        </div>
      </div>
    );
  }

  if (loading && !users.length) {
    return (
      <div className="flex flex-col items-center justify-center min-h-[50vh] text-center">
        <RefreshCw className="w-8 h-8 text-orange-400 animate-spin mb-3" />
        <p className="text-sm text-slate-300 font-medium">
          Loading administrator controls…
        </p>
      </div>
    );
  }

  return (
    <div className="space-y-6">
      {/* Top Header / Tabs */}
      <div className="flex flex-col md:flex-row md:items-center justify-between gap-4 border-b border-white/10 pb-4">
        <div>
          <div className="flex items-center gap-2">
            <h1 className="text-2xl font-bold tracking-tight text-white flex items-center gap-2.5">
              Admin Control Dashboard
            </h1>
            <span className="text-[10px] font-medium uppercase tracking-wider bg-orange-500/20 text-orange-300 border border-orange-500/30 px-1.5 py-0.2 rounded flex items-center gap-1">
              <Shield className="w-2.5 h-2.5" /> {authUser.email}
            </span>
          </div>
          <p className="text-xs text-muted-foreground mt-0.5">
            Manage user subscriptions, AI credit limits, persistent plans, and
            promotional discounts.
          </p>
        </div>

        <div className="flex items-center gap-2 bg-white/5 p-1 rounded-lg border border-white/10">
          <button
            onClick={() => setActiveTab('users')}
            className={`flex items-center gap-2 px-3 py-1.5 rounded-md text-xs font-medium transition-colors ${
              activeTab === 'users'
                ? 'bg-primary text-black shadow-sm'
                : 'text-muted-foreground hover:text-white'
            }`}
          >
            <Users className="w-3.5 h-3.5" />
            User Controls ({users.length})
          </button>
          <button
            onClick={() => setActiveTab('plans')}
            className={`flex items-center gap-2 px-3 py-1.5 rounded-md text-xs font-medium transition-colors ${
              activeTab === 'plans'
                ? 'bg-primary text-black shadow-sm'
                : 'text-muted-foreground hover:text-white'
            }`}
          >
            <CreditCard className="w-3.5 h-3.5" />
            Plans & Pricing
          </button>
          <button
            onClick={() => setActiveTab('audit')}
            className={`flex items-center gap-2 px-3 py-1.5 rounded-md text-xs font-medium transition-colors ${
              activeTab === 'audit'
                ? 'bg-primary text-black shadow-sm'
                : 'text-muted-foreground hover:text-white'
            }`}
          >
            <History className="w-3.5 h-3.5" />
            Audit Log ({auditLogs.length})
          </button>
          <button
            onClick={() => setActiveTab('requests')}
            className={`flex items-center gap-2 px-3 py-1.5 rounded-md text-xs font-medium transition-colors ${
              activeTab === 'requests'
                ? 'bg-primary text-black shadow-sm'
                : 'text-muted-foreground hover:text-white'
            }`}
          >
            <Sparkles className="w-3.5 h-3.5" />
            Plan Requests ({planRequests.length})
          </button>
          <Button
            size="sm"
            variant="ghost"
            className="h-7 w-7 p-0"
            onClick={() => loadData(authUser)}
          >
            <RefreshCw
              className={`w-3.5 h-3.5 ${loading ? 'animate-spin' : ''}`}
            />
          </Button>
        </div>
      </div>

      {activeTab === 'requests' && (
        <div className="space-y-3">
          <div>
            <h2 className="text-base font-semibold text-white">
              Pending Plan Requests
            </h2>
            <p className="text-xs text-muted-foreground">
              Review paid-plan requests from authenticated users.
            </p>
          </div>
          <div className="divide-y divide-white/5 rounded-xl border border-white/10 bg-[#0e1116]/80">
            {planRequests.length === 0 ? (
              <div className="p-8 text-center text-sm text-muted-foreground">
                No pending plan requests.
              </div>
            ) : (
              planRequests.map((request) => (
                <div
                  key={request.id}
                  className="flex items-center justify-between gap-4 p-4"
                >
                  <div className="min-w-0">
                    <div className="truncate text-sm font-medium text-white">
                      {request.displayName || request.email || request.uid}
                    </div>
                    <div className="text-xs text-muted-foreground">
                      {plans?.[request.currentPlanId || 'free']?.displayName ||
                        request.currentPlanId ||
                        'Free'}{' '}
                      →{' '}
                      {plans?.[request.requestedPlanId]?.displayName ||
                        request.requestedPlanId}{' '}
                      · Requested {new Date(request.createdAt).toLocaleString()}
                    </div>
                  </div>
                  <div className="flex shrink-0 gap-2">
                    <Button
                      size="sm"
                      variant="outline"
                      className="text-xs"
                      onClick={() => processPlanRequest(request.id, 'reject')}
                    >
                      Reject
                    </Button>
                    <Button
                      size="sm"
                      className="text-xs"
                      onClick={() => processPlanRequest(request.id, 'approve')}
                    >
                      Approve
                    </Button>
                  </div>
                </div>
              ))
            )}
          </div>
        </div>
      )}

      {/* ========================================================================= */}
      {/* TAB 1: USER CONTROLS */}
      {/* ========================================================================= */}
      {activeTab === 'users' && (
        <div className="space-y-4">
          <div className="border border-white/10 rounded-xl overflow-hidden bg-[#0e1116]/80 backdrop-blur">
            <div className="overflow-x-auto">
              <table className="w-full text-left text-xs border-collapse">
                <thead>
                  <tr className="border-b border-white/10 bg-white/[0.02] text-muted-foreground font-medium">
                    <th className="p-3.5">User</th>
                    <th className="p-3.5">Status</th>
                    <th className="p-3.5">Plan</th>
                    <th className="p-3.5">AI Credits Used</th>
                    <th className="p-3.5">AI Credits Remaining</th>
                    <th className="p-3.5">Next Reset</th>
                    <th className="p-3.5">Last Sign-in</th>
                    <th className="p-3.5 text-right">Actions</th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-white/5 text-slate-300">
                  {users.length === 0 ? (
                    <tr>
                      <td
                        colSpan={8}
                        className="p-8 text-center text-muted-foreground"
                      >
                        No Firebase Auth users found.{' '}
                        {loading
                          ? 'Loading…'
                          : 'Users will appear here once they sign up.'}
                      </td>
                    </tr>
                  ) : (
                    users.map((u) => {
                      const budget = u.budgetPaise;
                      const consumed = u.consumedPaise;
                      const remaining = Math.max(0, budget - consumed);
                      const percentRemaining =
                        budget > 0 ? Math.round((remaining / budget) * 100) : 0;

                      // Avatar initials fallback
                      const nameSource = u.displayName || u.email || u.userId;
                      const initials = nameSource
                        .split(/[\s@._-]+/)
                        .filter(Boolean)
                        .slice(0, 2)
                        .map((s: string) => s[0].toUpperCase())
                        .join('');

                      const isFirebaseDisabled = u.disabled === true;
                      const isSubscriptionSuspended = u.status === 'suspended';

                      return (
                        <tr
                          key={u.userId}
                          className="hover:bg-white/[0.02] transition-colors"
                        >
                          {/* User cell */}
                          <td className="p-3.5">
                            <div className="flex items-center gap-2.5">
                              {u.photoURL ? (
                                <img
                                  src={u.photoURL}
                                  alt={nameSource}
                                  className="w-7 h-7 rounded-full object-cover flex-shrink-0 border border-white/10"
                                  referrerPolicy="no-referrer"
                                />
                              ) : (
                                <div className="w-7 h-7 rounded-full bg-primary/20 border border-primary/30 text-primary text-[10px] font-bold flex items-center justify-center flex-shrink-0">
                                  {initials || '?'}
                                </div>
                              )}
                              <div className="min-w-0">
                                <div className="flex items-center gap-1.5 flex-wrap">
                                  <span className="font-medium text-white truncate max-w-[150px]">
                                    {u.displayName || u.email || u.userId}
                                  </span>
                                  {u.isAdmin && (
                                    <span className="inline-flex items-center gap-0.5 text-[9px] font-bold uppercase tracking-wider bg-orange-500/20 text-orange-300 border border-orange-500/30 px-1.5 py-0.5 rounded">
                                      <Shield className="w-2.5 h-2.5" /> Admin
                                    </span>
                                  )}
                                </div>
                                {u.displayName && (
                                  <div className="text-[10px] text-muted-foreground truncate max-w-[180px]">
                                    {u.email}
                                  </div>
                                )}
                                <div className="text-[10px] text-muted-foreground/50 font-mono truncate max-w-[180px]">
                                  {u.userId}
                                </div>
                              </div>
                            </div>
                          </td>

                          {/* Status cell */}
                          <td className="p-3.5">
                            <div className="flex flex-col gap-1">
                              {isFirebaseDisabled ? (
                                <span className="inline-flex items-center gap-1 text-[11px] font-medium text-slate-400 bg-slate-500/10 border border-slate-500/20 px-2 py-0.5 rounded-full">
                                  <XCircle className="w-3 h-3" /> Disabled
                                </span>
                              ) : isSubscriptionSuspended ? (
                                <span className="inline-flex items-center gap-1 text-[11px] font-medium text-red-400 bg-red-500/10 border border-red-500/20 px-2 py-0.5 rounded-full">
                                  <XCircle className="w-3 h-3" /> Suspended
                                </span>
                              ) : (
                                <span className="inline-flex items-center gap-1 text-[11px] font-medium text-emerald-400 bg-emerald-500/10 border border-emerald-500/20 px-2 py-0.5 rounded-full">
                                  <CheckCircle2 className="w-3 h-3" /> Active
                                </span>
                              )}
                              {u.creationTime && (
                                <span className="text-[10px] text-muted-foreground/60">
                                  Joined{' '}
                                  {new Date(
                                    u.creationTime,
                                  ).toLocaleDateString()}
                                </span>
                              )}
                            </div>
                          </td>

                          {/* Plan cell */}
                          <td className="p-3.5">
                            <span
                              className={`text-[11px] font-semibold uppercase tracking-wider px-2 py-0.5 rounded border ${
                                u.planId !== 'free'
                                  ? 'bg-primary/20 text-primary border-primary/30'
                                  : 'bg-white/5 text-muted-foreground border-white/10'
                              }`}
                            >
                              {plans?.[u.planId]?.displayName ||
                                u.planId.replace('_', ' ')}
                            </span>
                          </td>

                          <td className="p-3.5 font-mono text-slate-200">
                            ₹{(consumed / 100).toFixed(2)}
                          </td>

                          <td className="p-3.5">
                            {budget > 0 ? (
                              <div>
                                <div className="flex items-center justify-between text-[11px] mb-1">
                                  <span className="font-mono text-slate-200">
                                    ₹{(remaining / 100).toFixed(2)}
                                  </span>
                                  <span className="text-muted-foreground">
                                    {percentRemaining}%
                                  </span>
                                </div>
                                <div className="w-24 h-1.5 bg-white/10 rounded-full overflow-hidden">
                                  <div
                                    className="h-full bg-emerald-500 rounded-full"
                                    style={{ width: `${percentRemaining}%` }}
                                  />
                                </div>
                              </div>
                            ) : (
                              <span className="text-muted-foreground text-[11px]">
                                —
                              </span>
                            )}
                          </td>

                          <td className="p-3.5 text-muted-foreground text-[11px]">
                            {u.currentPeriodEnd
                              ? new Date(
                                  u.currentPeriodEnd,
                                ).toLocaleDateString()
                              : '—'}
                          </td>

                          <td className="p-3.5 text-muted-foreground text-[11px]">
                            {u.lastSignInTime
                              ? new Date(u.lastSignInTime).toLocaleDateString()
                              : '—'}
                          </td>

                          <td className="p-3.5 text-right space-x-1.5">
                            <Button
                              size="sm"
                              variant="ghost"
                              className="h-7 px-2 text-[11px]"
                              onClick={() => setInspectionUser(u)}
                            >
                              <Eye className="w-3 h-3 mr-1" /> Inspect
                            </Button>
                            <Button
                              size="sm"
                              variant="outline"
                              className="h-7 px-2 text-[11px] border-white/10 hover:bg-white/10"
                              onClick={() => {
                                setGrantTargetUser(u);
                                setSelectedPlanToGrant(
                                  u.planId === 'free'
                                    ? Object.values(plans || {}).find(
                                        (plan) =>
                                          plan.id !== 'free' && plan.active,
                                      )?.id || 'free'
                                    : u.planId,
                                );
                                setGrantModalOpen(true);
                              }}
                            >
                              Change Plan
                            </Button>
                            {!isFirebaseDisabled && (
                              <Button
                                size="sm"
                                variant="ghost"
                                className={`h-7 px-2 text-[11px] ${
                                  isSubscriptionSuspended
                                    ? 'text-emerald-400 hover:text-emerald-300 hover:bg-emerald-500/10'
                                    : 'text-red-400 hover:text-red-300 hover:bg-red-500/10'
                                }`}
                                onClick={() => toggleUserSuspension(u)}
                              >
                                {isSubscriptionSuspended
                                  ? 'Reactivate'
                                  : 'Suspend'}
                              </Button>
                            )}
                          </td>
                        </tr>
                      );
                    })
                  )}
                </tbody>
              </table>
            </div>
          </div>
        </div>
      )}

      {/* ========================================================================= */}
      {/* TAB 2: PLANS & PRICING */}
      {/* ========================================================================= */}
      {activeTab === 'plans' && plans && (
        <div className="space-y-8">
          {/* Plan Configuration Cards */}
          <div>
            <div className="flex items-center justify-between mb-4">
              <div>
                <h2 className="text-base font-semibold text-white">
                  Configured Plans
                </h2>
                <p className="text-xs text-muted-foreground">
                  Persistent plan configurations stored in integer paise.
                  Changes do not affect active customer billing periods.
                </p>
              </div>
              <Button
                size="sm"
                className="text-xs"
                onClick={() => {
                  setCreatingPlan(true);
                  setEditingPlan({
                    id: 'new-plan',
                    displayName: 'New Plan',
                    monthlyPricePaise: 0,
                    aiMonthlyBudgetPaise: 0,
                    features: [],
                    active: true,
                    displayOrder: Object.keys(plans).length,
                  });
                  setEditPriceRupees('0');
                  setEditBudgetRupees('0');
                }}
              >
                <Plus className="mr-1 h-3.5 w-3.5" /> Add Plan
              </Button>
            </div>

            <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-4">
              {Object.values(plans)
                .sort(
                  (a, b) =>
                    (a.displayOrder ?? 0) - (b.displayOrder ?? 0) ||
                    a.displayName.localeCompare(b.displayName),
                )
                .map((plan) => {
                  const pid = plan.id;
                  if (!plan) return null;
                  const { effectivePricePaise, appliedDiscount } =
                    calculateEffectivePricePaise(
                      plan.monthlyPricePaise,
                      discounts,
                      pid,
                    );

                  return (
                    <div
                      key={pid}
                      className="border border-white/10 rounded-xl p-5 bg-[#0e1116]/80 flex flex-col justify-between"
                    >
                      <div>
                        <div className="flex items-center justify-between mb-2">
                          <span className="text-xs font-semibold uppercase tracking-wider text-muted-foreground">
                            {plan.displayName}
                          </span>
                          <span
                            className={`text-[10px] px-2 py-0.5 rounded-full border ${
                              plan.active
                                ? 'bg-emerald-500/10 text-emerald-400 border-emerald-500/20'
                                : 'bg-red-500/10 text-red-400 border-red-500/20'
                            }`}
                          >
                            {plan.active ? 'Active' : 'Inactive'}
                          </span>
                        </div>

                        <div className="mb-4">
                          <div className="flex items-baseline gap-2">
                            <span className="text-2xl font-bold text-white">
                              ₹{effectivePricePaise / 100}
                            </span>
                            {appliedDiscount && (
                              <span className="text-xs line-through text-muted-foreground">
                                ₹{plan.monthlyPricePaise / 100}
                              </span>
                            )}
                            <span className="text-xs text-muted-foreground">
                              /mo
                            </span>
                          </div>
                          {appliedDiscount && (
                            <div className="text-[10px] text-emerald-400 mt-0.5">
                              Promo: {appliedDiscount.name} (
                              {appliedDiscount.type === 'percentage'
                                ? `${appliedDiscount.value}% off`
                                : `₹${appliedDiscount.value / 100} off`}
                              )
                            </div>
                          )}
                        </div>

                        <div className="space-y-2 text-xs text-muted-foreground border-t border-white/5 pt-3">
                          <div className="flex items-center justify-between">
                            <span>Hosted AI budget:</span>
                            <span className="font-semibold text-white">
                              ₹{plan.aiMonthlyBudgetPaise / 100} / mo
                            </span>
                          </div>
                          <div className="flex items-center justify-between">
                            <span>Base price:</span>
                            <span className="font-mono text-slate-300">
                              {plan.monthlyPricePaise} paise
                            </span>
                          </div>
                          <div className="pt-2">
                            <span className="text-[11px] block font-medium text-slate-300 mb-1">
                              Features enabled ({plan.features.length}):
                            </span>
                            <div className="flex flex-wrap gap-1">
                              {plan.features.map((f) => (
                                <span
                                  key={f}
                                  className="text-[10px] bg-white/5 border border-white/10 px-1.5 py-0.5 rounded text-muted-foreground"
                                >
                                  {f}
                                </span>
                              ))}
                            </div>
                          </div>
                        </div>
                      </div>

                      <div className="mt-5 pt-3 border-t border-white/5">
                        <Button
                          size="sm"
                          variant="outline"
                          className="w-full text-xs border-white/10 hover:bg-white/10"
                          onClick={() => {
                            setCreatingPlan(false);
                            setEditingPlan(plan);
                            setEditPriceRupees(
                              String(plan.monthlyPricePaise / 100),
                            );
                            setEditBudgetRupees(
                              String(plan.aiMonthlyBudgetPaise / 100),
                            );
                          }}
                        >
                          <Sliders className="w-3 h-3 mr-1.5" /> Edit Plan
                          Config
                        </Button>
                        {pid !== 'free' && (
                          <div className="mt-2 flex gap-2">
                            <Button
                              size="sm"
                              variant="ghost"
                              className="h-7 flex-1 text-[11px]"
                              onClick={() =>
                                mutatePlan(
                                  pid,
                                  plan.active ? 'archive' : 'update',
                                  true,
                                )
                              }
                            >
                              {plan.active ? 'Archive' : 'Activate'}
                            </Button>
                            <Button
                              size="sm"
                              variant="ghost"
                              className="h-7 text-[11px] text-destructive"
                              onClick={() => mutatePlan(pid, 'delete')}
                            >
                              Delete
                            </Button>
                          </div>
                        )}
                      </div>
                    </div>
                  );
                })}
            </div>
          </div>

          {/* Discounts Management */}
          <div className="border border-white/10 rounded-xl p-5 bg-[#0e1116]/80 space-y-4">
            <div className="flex items-center justify-between">
              <div>
                <h3 className="text-sm font-semibold text-white flex items-center gap-2">
                  <Tag className="w-4 h-4 text-primary" />
                  Promotional Discounts
                </h3>
                <p className="text-xs text-muted-foreground">
                  Apply percentage or fixed reductions non-destructively without
                  overwriting base prices.
                </p>
              </div>
              <Button
                size="sm"
                className="text-xs bg-primary hover:bg-primary/90"
                onClick={openNewDiscount}
              >
                <Plus className="w-3.5 h-3.5 mr-1" /> Add Discount
              </Button>
            </div>

            <div className="overflow-x-auto">
              <table className="w-full text-left text-xs border-collapse">
                <thead>
                  <tr className="border-b border-white/10 bg-white/[0.02] text-muted-foreground">
                    <th className="p-3">Discount Name</th>
                    <th className="p-3">Type & Value</th>
                    <th className="p-3">Applicable Plans</th>
                    <th className="p-3">Schedule</th>
                    <th className="p-3">Status</th>
                    <th className="p-3 text-right">Actions</th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-white/5 text-slate-300">
                  {discounts.length === 0 ? (
                    <tr>
                      <td
                        colSpan={6}
                        className="p-6 text-center text-muted-foreground"
                      >
                        No promotional discounts configured. Click "Add
                        Discount" to create one.
                      </td>
                    </tr>
                  ) : (
                    discounts.map((d) => (
                      <tr key={d.id} className="hover:bg-white/[0.02]">
                        <td className="p-3 font-medium text-white">{d.name}</td>
                        <td className="p-3">
                          {d.type === 'percentage' ? (
                            <span className="font-semibold text-orange-300">
                              {d.value}% off
                            </span>
                          ) : (
                            <span className="font-semibold text-emerald-300">
                              ₹{d.value / 100} off
                            </span>
                          )}
                        </td>
                        <td className="p-3">
                          <div className="flex gap-1">
                            {d.applicablePlanIds.map((p) => (
                              <span
                                key={p}
                                className="text-[10px] bg-white/5 border border-white/10 px-1 py-0.5 rounded text-muted-foreground"
                              >
                                {p}
                              </span>
                            ))}
                          </div>
                        </td>
                        <td className="p-3 text-[11px] text-muted-foreground">
                          {new Date(d.startsAt).toLocaleDateString()} —{' '}
                          {new Date(d.endsAt).toLocaleDateString()}
                        </td>
                        <td className="p-3">
                          <span
                            className={`text-[10px] px-2 py-0.5 rounded-full border ${
                              d.enabled
                                ? 'bg-emerald-500/10 text-emerald-400 border-emerald-500/20'
                                : 'bg-white/5 text-muted-foreground border-white/10'
                            }`}
                          >
                            {d.enabled ? 'Enabled' : 'Disabled'}
                          </span>
                        </td>
                        <td className="p-3 text-right">
                          <div className="flex justify-end gap-1">
                            <Button
                              size="sm"
                              variant="ghost"
                              className="h-6 px-2 text-[11px]"
                              onClick={() => {
                                setEditingDiscount(d);
                                setDiscountName(d.name);
                                setDiscountType(d.type);
                                setDiscountValue(
                                  d.type === 'percentage'
                                    ? String(d.value)
                                    : String(d.value / 100),
                                );
                                setDiscountPlans(d.applicablePlanIds);
                                setDiscountStartsAt(
                                  toDateInputValue(d.startsAt),
                                );
                                setDiscountEndsAt(toDateInputValue(d.endsAt));
                                setDiscountModalOpen(true);
                              }}
                            >
                              Edit
                            </Button>
                            <Button
                              size="sm"
                              variant="ghost"
                              className="h-6 px-2 text-[11px]"
                              onClick={() =>
                                toggleDiscountStatus(d.id, d.enabled)
                              }
                            >
                              {d.enabled ? 'Disable' : 'Enable'}
                            </Button>
                            <Button
                              size="sm"
                              variant="ghost"
                              className="h-6 px-2 text-[11px] text-destructive"
                              onClick={() => deleteDiscount(d.id)}
                            >
                              Delete
                            </Button>
                          </div>
                        </td>
                      </tr>
                    ))
                  )}
                </tbody>
              </table>
            </div>
          </div>
        </div>
      )}

      {/* ========================================================================= */}
      {/* TAB 3: AUDIT LOG */}
      {/* ========================================================================= */}
      {activeTab === 'audit' && (
        <div className="border border-white/10 rounded-xl overflow-hidden bg-[#0e1116]/80">
          <div className="p-4 border-b border-white/10 flex items-center justify-between">
            <h2 className="text-sm font-semibold text-white flex items-center gap-2">
              <History className="w-4 h-4 text-primary" />
              Administrative Audit Trail
            </h2>
            <span className="text-xs text-muted-foreground">
              Every administrative change is securely logged with actor identity
              and timestamp.
            </span>
          </div>

          <div className="divide-y divide-white/5 max-h-[600px] overflow-y-auto">
            {auditLogs.length === 0 ? (
              <div className="p-8 text-center text-muted-foreground text-xs">
                No administrative mutations recorded yet.
              </div>
            ) : (
              auditLogs.map((log) => (
                <div key={log.id} className="p-4 text-xs hover:bg-white/[0.01]">
                  <div className="flex items-center justify-between mb-1.5">
                    <span className="font-semibold text-white uppercase tracking-wider text-[11px] bg-white/5 px-1.5 py-0.5 rounded border border-white/10">
                      {log.action}
                    </span>
                    <span className="text-muted-foreground text-[11px]">
                      {new Date(log.timestamp).toLocaleString()}
                    </span>
                  </div>
                  <div className="text-muted-foreground">
                    Actor:{' '}
                    <span className="text-slate-200">
                      {log.actorAdminEmail}
                    </span>{' '}
                    · Target:{' '}
                    <span className="text-slate-200">{log.targetUserId}</span>
                  </div>
                  <div className="mt-1.5 bg-black/40 rounded p-2 text-[11px] font-mono text-slate-300 overflow-x-auto">
                    Previous: {JSON.stringify(log.previousValue)} → New:{' '}
                    {JSON.stringify(log.newValue)}
                  </div>
                </div>
              ))
            )}
          </div>
        </div>
      )}

      {/* ========================================================================= */}
      {/* MODAL 1: EXPLICIT CONFIRMATION FOR PLAN GRANTS */}
      {/* ========================================================================= */}
      <Dialog open={grantModalOpen} onOpenChange={setGrantModalOpen}>
        <DialogContent
          style={{
            maxWidth: 520,
            background: '#0e1116',
            border: '1px solid rgba(255, 255, 255, 0.1)',
            color: '#fff',
          }}
        >
          <DialogHeader>
            <DialogTitle className="text-base font-bold text-white">
              Grant{' '}
              {plans?.[selectedPlanToGrant]?.displayName || selectedPlanToGrant}{' '}
              to {grantTargetUser?.email || grantTargetUser?.userId}?
            </DialogTitle>
            <DialogDescription className="text-xs text-muted-foreground">
              This action immediately updates the user's subscription
              entitlement and provisioned AI allowance.
            </DialogDescription>
          </DialogHeader>

          <div className="space-y-4 my-3 text-xs">
            <div className="space-y-2">
              <label className="text-muted-foreground font-medium">
                Select Plan Tier:
              </label>
              <div className="grid grid-cols-2 gap-2 sm:grid-cols-3">
                {Object.values(plans || {})
                  .filter((plan) => plan.active)
                  .sort(
                    (a, b) =>
                      (a.displayOrder ?? 0) - (b.displayOrder ?? 0) ||
                      a.displayName.localeCompare(b.displayName),
                  )
                  .map((plan) => {
                    const pid = plan.id;
                    return (
                      <button
                        key={pid}
                        type="button"
                        onClick={() => setSelectedPlanToGrant(pid)}
                        className={`p-2.5 rounded-lg border text-left transition-all ${
                          selectedPlanToGrant === pid
                            ? 'border-primary bg-primary/10 text-white'
                            : 'border-white/10 bg-white/5 text-muted-foreground hover:text-white'
                        }`}
                      >
                        <div className="font-semibold capitalize">
                          {plan.displayName}
                        </div>
                        <div className="text-[10px] text-muted-foreground mt-0.5">
                          ₹{plan.aiMonthlyBudgetPaise / 100}/mo AI
                        </div>
                      </button>
                    );
                  })}
              </div>
            </div>

            <div className="bg-white/5 border border-white/10 rounded-lg p-3 space-y-1.5">
              <div className="flex justify-between">
                <span className="text-muted-foreground">Plan:</span>
                <span className="font-semibold text-white capitalize">
                  {selectedPlanToGrant.replace('_', ' ')}
                </span>
              </div>
              <div className="flex justify-between">
                <span className="text-muted-foreground">AI allowance:</span>
                <span className="font-semibold text-emerald-400">
                  ₹
                  {(plans?.[selectedPlanToGrant]?.aiMonthlyBudgetPaise || 0) /
                    100}
                  /month
                </span>
              </div>
              <div className="flex justify-between">
                <span className="text-muted-foreground">Effective:</span>
                <span className="text-white">immediately</span>
              </div>
            </div>
          </div>

          <DialogFooter className="gap-2">
            <Button
              type="button"
              variant="outline"
              size="sm"
              className="text-black hover:bg-white/5 hover:text-white"
              onClick={() => setGrantModalOpen(false)}
              disabled={grantSubmitting}
            >
              Cancel
            </Button>
            <Button
              type="button"
              size="sm"
              className="bg-primary hover:bg-primary/90 text-black"
              onClick={executePlanGrant}
              disabled={grantSubmitting}
            >
              {grantSubmitting ? 'Granting…' : 'Confirm Grant'}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      {/* ========================================================================= */}
      {/* MODAL 2: USER ACTUAL AI USAGE INSPECTION DRAWER */}
      {/* ========================================================================= */}
      <Dialog
        open={!!inspectionUser}
        onOpenChange={(open) => !open && setInspectionUser(null)}
      >
        <DialogContent
          style={{
            maxWidth: 580,
            background: '#0e1116',
            border: '1px solid rgba(255, 255, 255, 0.1)',
            color: '#fff',
          }}
        >
          <DialogHeader>
            <DialogTitle className="text-base font-bold text-white flex items-center gap-2">
              <Sparkles className="w-4 h-4 text-primary" />
              Actual Sarvam AI Usage ·{' '}
              {inspectionUser?.email || inspectionUser?.userId}
            </DialogTitle>
            <DialogDescription className="text-xs text-muted-foreground">
              Server-recorded provider usage and monetary accounting for the
              active billing cycle.
            </DialogDescription>
          </DialogHeader>

          {inspectionUser && (
            <div className="space-y-4 my-2 text-xs">
              <div className="grid grid-cols-2 gap-3 bg-white/5 p-3 rounded-lg border border-white/10">
                <div>
                  <div className="text-muted-foreground">Active Plan</div>
                  <div className="text-sm font-semibold text-white uppercase">
                    {inspectionUser.planId.replace('_', ' ')}
                  </div>
                </div>
                <div>
                  <div className="text-muted-foreground">
                    Subscription Status
                  </div>
                  <div className="text-sm font-semibold text-emerald-400 capitalize">
                    {inspectionUser.status}
                  </div>
                </div>
                <div>
                  <div className="text-muted-foreground">
                    Billing Period Start
                  </div>
                  <div className="text-slate-200">
                    {new Date(
                      inspectionUser.currentPeriodStart,
                    ).toLocaleDateString()}
                  </div>
                </div>
                <div>
                  <div className="text-muted-foreground">Next Reset Date</div>
                  <div className="text-slate-200">
                    {new Date(
                      inspectionUser.currentPeriodEnd,
                    ).toLocaleDateString()}
                  </div>
                </div>
              </div>

              <div className="border border-white/10 rounded-lg p-3 space-y-2">
                <div className="font-semibold text-white">Token Breakdown</div>
                <div className="grid grid-cols-3 gap-2 text-center">
                  <div className="bg-black/30 p-2 rounded">
                    <div className="text-muted-foreground text-[10px]">
                      Prompt Tokens
                    </div>
                    <div className="font-mono text-sm text-white font-bold">
                      {inspectionUser.promptTokens.toLocaleString()}
                    </div>
                  </div>
                  <div className="bg-black/30 p-2 rounded">
                    <div className="text-muted-foreground text-[10px]">
                      Completion Tokens
                    </div>
                    <div className="font-mono text-sm text-white font-bold">
                      {inspectionUser.completionTokens.toLocaleString()}
                    </div>
                  </div>
                  <div className="bg-black/30 p-2 rounded">
                    <div className="text-muted-foreground text-[10px]">
                      Total Tokens
                    </div>
                    <div className="font-mono text-sm text-primary font-bold">
                      {inspectionUser.totalTokens.toLocaleString()}
                    </div>
                  </div>
                </div>
              </div>

              <div className="border border-white/10 rounded-lg p-3 space-y-2">
                <div className="font-semibold text-white">
                  Monetary Accounting (INR)
                </div>
                <div className="space-y-1 text-slate-300">
                  <div className="flex justify-between">
                    <span className="text-muted-foreground">
                      Monthly Provisioned Budget:
                    </span>
                    <span className="font-mono font-medium">
                      ₹{(inspectionUser.budgetPaise / 100).toFixed(2)}
                    </span>
                  </div>
                  <div className="flex justify-between">
                    <span className="text-muted-foreground">
                      Consumed (Actual Cost):
                    </span>
                    <span className="font-mono font-medium text-orange-300">
                      ₹{(inspectionUser.consumedPaise / 100).toFixed(2)}
                    </span>
                  </div>
                  <div className="flex justify-between border-t border-white/5 pt-1">
                    <span className="text-muted-foreground">
                      Budget Remaining:
                    </span>
                    <span className="font-mono font-bold text-emerald-400">
                      ₹{(inspectionUser.remainingPaise / 100).toFixed(2)}
                    </span>
                  </div>
                  <div className="flex justify-between text-muted-foreground text-[11px] pt-1">
                    <span>Total AI Requests:</span>
                    <span>{inspectionUser.requestCount}</span>
                  </div>
                  <div className="flex justify-between text-muted-foreground text-[11px]">
                    <span>Last Request Recorded:</span>
                    <span>
                      {inspectionUser.lastAiRequestAt
                        ? new Date(
                            inspectionUser.lastAiRequestAt,
                          ).toLocaleString()
                        : 'None'}
                    </span>
                  </div>
                </div>
              </div>
            </div>
          )}

          <DialogFooter>
            <Button
              size="sm"
              className="bg-muted text-black hover:bg-muted/90"
              onClick={() => setInspectionUser(null)}
            >
              Close
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      {/* ========================================================================= */}
      {/* MODAL 3: EDIT PLAN CONFIG */}
      {/* ========================================================================= */}
      <Dialog
        open={!!editingPlan}
        onOpenChange={(open) => !open && setEditingPlan(null)}
      >
        <DialogContent
          style={{
            maxWidth: 480,
            background: '#0e1116',
            border: '1px solid rgba(255, 255, 255, 0.1)',
            color: '#fff',
          }}
        >
          <DialogHeader>
            <DialogTitle className="text-base font-bold text-white">
              {creatingPlan
                ? 'Add Plan'
                : `Edit Plan · ${editingPlan?.displayName}`}
            </DialogTitle>
            <DialogDescription className="text-xs text-muted-foreground">
              Update monthly pricing and provisioned AI budget. Stored as
              integer paise.
            </DialogDescription>
          </DialogHeader>

          {editingPlan && (
            <div className="space-y-3 my-2 text-xs">
              <label className="block space-y-1">
                <span className="text-muted-foreground">
                  Stable Plan ID / Slug
                </span>
                <Input
                  value={editingPlan.id}
                  disabled={!creatingPlan}
                  onChange={(e) =>
                    setEditingPlan({ ...editingPlan, id: e.target.value })
                  }
                />
              </label>
              <label className="block space-y-1">
                <span className="text-muted-foreground">Display Name</span>
                <Input
                  value={editingPlan.displayName}
                  onChange={(e) =>
                    setEditingPlan({
                      ...editingPlan,
                      displayName: e.target.value,
                    })
                  }
                />
              </label>
              <label className="flex items-center gap-2">
                <input
                  type="checkbox"
                  checked={editingPlan.active}
                  onChange={(e) =>
                    setEditingPlan({ ...editingPlan, active: e.target.checked })
                  }
                />{' '}
                Active for new requests
              </label>
              <label className="block space-y-1">
                <span className="text-muted-foreground">Display Order</span>
                <Input
                  type="number"
                  value={editingPlan.displayOrder ?? 0}
                  onChange={(e) =>
                    setEditingPlan({
                      ...editingPlan,
                      displayOrder: Number(e.target.value),
                    })
                  }
                />
              </label>
              <div>
                <span className="text-muted-foreground">Enabled Features</span>
                <div className="mt-1 grid grid-cols-2 gap-1">
                  {PLAN_FEATURE_IDS.map((feature) => (
                    <label key={feature} className="flex items-center gap-1">
                      <input
                        type="checkbox"
                        checked={editingPlan.features.includes(feature)}
                        onChange={(e) =>
                          setEditingPlan({
                            ...editingPlan,
                            features: e.target.checked
                              ? [...editingPlan.features, feature]
                              : editingPlan.features.filter(
                                  (item) => item !== feature,
                                ),
                          })
                        }
                      />
                      {feature}
                    </label>
                  ))}
                </div>
              </div>

              <label className="block space-y-1">
                <span className="text-muted-foreground">
                  Monthly Base Price (₹)
                </span>
                <Input
                  type="number"
                  min="0"
                  step="1"
                  value={editPriceRupees}
                  onChange={(e) => setEditPriceRupees(e.target.value)}
                />
              </label>

              <label className="block space-y-1">
                <span className="text-muted-foreground">
                  Monthly AI Budget (₹)
                </span>
                <Input
                  type="number"
                  min="0"
                  step="1"
                  value={editBudgetRupees}
                  onChange={(e) => setEditBudgetRupees(e.target.value)}
                />
              </label>
            </div>
          )}

          <DialogFooter className="gap-2">
            <Button
              size="sm"
              className="bg-muted text-muted-foreground hover:bg-muted/90"
              onClick={() => setEditingPlan(null)}
            >
              Cancel
            </Button>
            <Button
              size="sm"
              className="bg-primary hover:bg-primary/90 text-black"
              onClick={savePlanEdit}
            >
              Save Changes
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      {/* ========================================================================= */}
      {/* MODAL 4: ADD PROMOTIONAL DISCOUNT */}
      {/* ========================================================================= */}
      <Dialog open={discountModalOpen} onOpenChange={setDiscountModalOpen}>
        <DialogContent
          style={{
            maxWidth: 480,
            background: '#0e1116',
            border: '1px solid rgba(255, 255, 255, 0.1)',
            color: '#fff',
          }}
        >
          <DialogHeader>
            <DialogTitle className="text-base font-bold text-white">
              {editingDiscount
                ? 'Edit Promotional Discount'
                : 'Create Promotional Discount'}
            </DialogTitle>
            <DialogDescription className="text-xs text-muted-foreground">
              Define explicit percentage or fixed discounts without
              destructively modifying base plans.
            </DialogDescription>
          </DialogHeader>

          <div className="space-y-3 my-2 text-xs">
            {discountError && (
              <div className="p-2.5 rounded bg-red-500/10 border border-red-500/20 text-red-400 text-[11px]">
                {discountError}
              </div>
            )}

            <label className="block space-y-1">
              <span className="text-muted-foreground">Discount Name</span>
              <Input
                placeholder="e.g. Festival Launch 20% Off"
                value={discountName}
                onChange={(e) => setDiscountName(e.target.value)}
              />
            </label>

            <div className="grid grid-cols-2 gap-3">
              <label className="block space-y-1">
                <span className="text-muted-foreground">Discount Type</span>
                <select
                  value={discountType}
                  onChange={(e) => setDiscountType(e.target.value as any)}
                  className="w-full bg-[#161a22] border border-white/10 rounded-md p-2 text-xs text-white"
                >
                  <option value="percentage">Percentage (%)</option>
                  <option value="fixed">Fixed Amount (₹)</option>
                </select>
              </label>

              <label className="block space-y-1">
                <span className="text-muted-foreground">
                  {discountType === 'percentage'
                    ? 'Percentage (0-100)'
                    : 'Amount in Rupees (₹)'}
                </span>
                <Input
                  type="number"
                  min="1"
                  max={discountType === 'percentage' ? '100' : undefined}
                  placeholder={discountType === 'percentage' ? '20' : '200'}
                  value={discountValue}
                  onChange={(e) => setDiscountValue(e.target.value)}
                />
              </label>
            </div>

            <div className="space-y-1">
              <span className="text-muted-foreground block">
                Applicable Plans
              </span>
              <div className="flex gap-2">
                {Object.values(plans || {})
                  .filter((plan) => plan.id !== 'free')
                  .map((plan) => {
                    const pid = plan.id;
                    return (
                      <label
                        key={pid}
                        className="flex items-center gap-1.5 text-xs text-slate-200"
                      >
                        <input
                          type="checkbox"
                          checked={discountPlans.includes(pid)}
                          onChange={(e) => {
                            if (e.target.checked) {
                              setDiscountPlans([...discountPlans, pid]);
                            } else {
                              setDiscountPlans(
                                discountPlans.filter((p) => p !== pid),
                              );
                            }
                          }}
                        />
                        <span className="capitalize">
                          {pid.replace('_', ' ')}
                        </span>
                      </label>
                    );
                  })}
              </div>
            </div>

            <div className="grid grid-cols-2 gap-3">
              <label className="block space-y-1">
                <span className="text-muted-foreground">Start Date</span>
                <Input
                  type="date"
                  value={discountStartsAt}
                  onChange={(e) => setDiscountStartsAt(e.target.value)}
                />
              </label>

              <label className="block space-y-1">
                <span className="text-muted-foreground">End Date</span>
                <Input
                  type="date"
                  value={discountEndsAt}
                  onChange={(e) => setDiscountEndsAt(e.target.value)}
                />
              </label>
            </div>
          </div>

          <DialogFooter className="gap-2">
            <Button
              size="sm"
              variant="outline"
              onClick={() => setDiscountModalOpen(false)}
            >
              Cancel
            </Button>
            <Button
              size="sm"
              className="bg-primary hover:bg-primary/90 text-white"
              onClick={saveDiscount}
            >
              {editingDiscount ? 'Save Discount' : 'Create Discount'}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  );
}
