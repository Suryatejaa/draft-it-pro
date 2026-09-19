'use client';

import { useState } from 'react';
import type { User } from 'firebase/auth';
import { LogIn, LogOut, Shield, Sparkles } from 'lucide-react';
import {
  Sheet,
  SheetContent,
  SheetDescription,
  SheetHeader,
  SheetTitle,
} from '@/components/ui/sheet';
import type { UserEntitlements } from '@/lib/entitlements/types';

interface MobileAccountSheetProps {
  user: User | null;
  entitlements: UserEntitlements;
  authBusy: boolean;
  configured: boolean;
  onSignIn: () => void;
  onSignOut: () => void;
}

function initials(user: User | null) {
  const source = user?.displayName?.trim() || user?.email?.split('@')[0] || 'U';
  const words = source.split(/\s+/).filter(Boolean);
  return (
    words.length > 1 ? words[0][0] + words[1][0] : source.slice(0, 2)
  ).toUpperCase();
}

function displayName(user: User | null) {
  return (
    user?.displayName?.trim() || user?.email?.split('@')[0] || 'Your account'
  );
}

function resetDate(value: string | null) {
  if (!value) return null;
  const date = new Date(value);
  return Number.isNaN(date.getTime())
    ? value
    : date.toLocaleDateString('en-GB', {
        day: 'numeric',
        month: 'short',
        year: 'numeric',
      });
}

export function MobileAccountSheet({
  user,
  entitlements,
  authBusy,
  configured,
  onSignIn,
  onSignOut,
}: MobileAccountSheetProps) {
  const [open, setOpen] = useState(false);
  const creditStatus = entitlements.aiCreditStatus;
  const planLabel = entitlements.planDisplayName.toUpperCase();

  return (
    <>
      <button
        type="button"
        className="mobile-account-trigger"
        aria-label="Open account"
        onClick={() => setOpen(true)}
      >
        {user?.photoURL ? (
          <img src={user.photoURL} alt="" className="mobile-account-avatar" />
        ) : (
          <span className="mobile-account-avatar">{initials(user)}</span>
        )}
      </button>

      <Sheet open={open} onOpenChange={setOpen}>
        <SheetContent side="bottom" className="mobile-account-sheet">
          <SheetHeader className="px-5 pb-3 pt-5">
            <SheetTitle className="text-left text-xs font-bold uppercase tracking-[0.16em] text-muted-foreground">
              Account
            </SheetTitle>
            <SheetDescription className="sr-only">
              Account, subscription, and hosted AI credit details
            </SheetDescription>
          </SheetHeader>

          {user ? (
            <div className="space-y-5 px-5 pb-[calc(1.25rem+env(safe-area-inset-bottom))]">
              <div className="flex min-w-0 items-center gap-3">
                {user.photoURL ? (
                  <img
                    src={user.photoURL}
                    alt=""
                    className="mobile-account-avatar mobile-account-avatar-large"
                  />
                ) : (
                  <span className="mobile-account-avatar mobile-account-avatar-large">
                    {initials(user)}
                  </span>
                )}
                <div className="min-w-0 flex-1">
                  <div className="flex min-w-0 items-center gap-2">
                    <strong className="min-w-0 truncate text-sm">
                      {displayName(user)}
                    </strong>
                    <span className="shrink-0 rounded-full bg-primary/15 px-2 py-0.5 text-[10px] font-bold uppercase tracking-wide text-primary-foreground">
                      {planLabel}
                    </span>
                  </div>
                  <div className="truncate text-xs text-muted-foreground">
                    {user.email || 'No email available'}
                  </div>
                </div>
              </div>

              {entitlements.isAdmin && (
                <div className="flex items-center gap-2 text-xs font-semibold text-orange-600">
                  <Shield size={14} /> Admin access
                </div>
              )}

              <section
                className="space-y-2 rounded-xl border border-border bg-muted/30 p-3.5"
                aria-label="AI credits"
              >
                <div className="flex items-center justify-between gap-3 text-xs">
                  <span className="flex items-center gap-1.5 font-semibold">
                    <Sparkles size={14} className="text-primary" /> AI credits
                  </span>
                  {creditStatus.hasHostedAi && (
                    <strong>{creditStatus.remainingPercent}% remaining</strong>
                  )}
                </div>
                {creditStatus.hasHostedAi ? (
                  <>
                    <div
                      className="h-2 w-full overflow-hidden rounded-full bg-border"
                      role="progressbar"
                      aria-label="Hosted AI credits remaining"
                      aria-valuemin={0}
                      aria-valuemax={100}
                      aria-valuenow={creditStatus.remainingPercent}
                    >
                      <div
                        className="h-full rounded-full bg-primary transition-[width]"
                        style={{ width: `${creditStatus.remainingPercent}%` }}
                      />
                    </div>
                    {resetDate(creditStatus.nextResetDate) && (
                      <div className="text-[11px] text-muted-foreground">
                        Next reset: {resetDate(creditStatus.nextResetDate)}
                      </div>
                    )}
                  </>
                ) : (
                  <div className="text-xs text-muted-foreground">
                    Hosted AI unavailable on Free
                  </div>
                )}
              </section>

              <div className="border-t border-border pt-3">
                <div className="mb-2 text-xs font-semibold text-muted-foreground">
                  Account / Subscription
                </div>
                {entitlements.isAdmin && (
                  <a
                    href="/admin"
                    className="mb-2 flex items-center gap-2 rounded-lg px-2 py-2 text-sm hover:bg-muted"
                  >
                    <Shield size={15} /> Admin dashboard
                  </a>
                )}
                <button
                  type="button"
                  className="flex w-full items-center gap-2 rounded-lg px-2 py-2 text-left text-sm text-destructive hover:bg-destructive/10"
                  onClick={onSignOut}
                  disabled={authBusy}
                >
                  <LogOut size={15} /> {authBusy ? 'Signing out…' : 'Sign out'}
                </button>
              </div>
            </div>
          ) : (
            <div className="space-y-4 px-5 pb-[calc(1.25rem+env(safe-area-inset-bottom))]">
              <p className="text-sm text-muted-foreground">
                Sign in to sync projects and view your subscription and hosted
                AI credits.
              </p>
              <button
                type="button"
                className="flex w-full items-center justify-center gap-2 rounded-lg bg-primary px-4 py-2.5 text-sm font-semibold text-primary-foreground"
                onClick={onSignIn}
                disabled={authBusy || !configured}
              >
                <LogIn size={15} />{' '}
                {authBusy ? 'Signing in…' : 'Sign in with Google'}
              </button>
            </div>
          )}
        </SheetContent>
      </Sheet>
    </>
  );
}
