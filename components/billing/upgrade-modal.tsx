'use client';

import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
  DialogDescription,
} from '@/components/ui/dialog';
import { Button } from '@/components/ui/button';
import { Check, Sparkles, Lock, ShieldCheck, Zap } from 'lucide-react';

interface UpgradeModalProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  targetFeatureName?: string;
}

export function UpgradeModal({
  open,
  onOpenChange,
  targetFeatureName,
}: UpgradeModalProps) {
  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent
        style={{
          maxWidth: 720,
          background: 'linear-gradient(180deg, #111418 0%, #0c0e11 100%)',
          border: '1px solid rgba(255, 255, 255, 0.1)',
          color: '#f3f4f6',
        }}
      >
        <DialogHeader className="text-center space-y-2 pb-2">
          <div className="mx-auto w-10 h-10 rounded-full bg-primary/10 border border-primary/20 flex items-center justify-center text-primary mb-1">
            <Lock className="w-5 h-5" />
          </div>
          <DialogTitle className="text-xl font-bold tracking-tight text-white">
            {targetFeatureName ? `Unlock ${targetFeatureName}` : 'Upgrade to Draft-it PRO'}
          </DialogTitle>
          <DialogDescription className="text-sm text-muted-foreground max-w-md mx-auto">
            {targetFeatureName
              ? `${targetFeatureName} is a premium feature available on Plus and AI Plus plans.`
              : 'Unlock advanced visual planning, production tools, shoot management, and hosted Co-Drafter AI credits.'}
          </DialogDescription>
        </DialogHeader>

        <div className="grid grid-cols-1 md:grid-cols-2 gap-4 my-3">
          {/* PLUS PLAN */}
          <div
            className="rounded-xl p-5 relative flex flex-col justify-between"
            style={{
              background: 'rgba(255, 255, 255, 0.03)',
              border: '1px solid rgba(255, 255, 255, 0.08)',
            }}
          >
            <div>
              <div className="flex items-center justify-between mb-3">
                <span className="text-xs font-semibold uppercase tracking-wider text-muted-foreground">
                  Plus
                </span>
                <span className="px-2 py-0.5 text-[10px] font-semibold bg-white/10 rounded-full text-white">
                  Pro Filmmaking
                </span>
              </div>
              <div className="flex items-baseline gap-1 mb-4">
                <span className="text-3xl font-extrabold text-white">₹799</span>
                <span className="text-xs text-muted-foreground">/month</span>
              </div>

              <div className="space-y-2.5 text-xs text-muted-foreground">
                <div className="flex items-center gap-2">
                  <Check className="w-4 h-4 text-emerald-400 shrink-0" />
                  <span>All Draft-it PRO production tools</span>
                </div>
                <div className="flex items-center gap-2">
                  <Check className="w-4 h-4 text-emerald-400 shrink-0" />
                  <span>Stripboards & Shooting Schedules</span>
                </div>
                <div className="flex items-center gap-2">
                  <Check className="w-4 h-4 text-emerald-400 shrink-0" />
                  <span>Call Sheets & Continuity</span>
                </div>
                <div className="flex items-center gap-2">
                  <Check className="w-4 h-4 text-emerald-400 shrink-0" />
                  <span>Storyboards & Shot Designer</span>
                </div>
                <div className="flex items-center gap-2">
                  <Sparkles className="w-4 h-4 text-amber-400 shrink-0" />
                  <span className="text-white font-medium">
                    More hosted Sarvam AI usage limits
                  </span>
                </div>
              </div>
            </div>

            <div className="mt-6">
              <Button
                className="w-full bg-white/10 hover:bg-white/20 text-white border border-white/10"
                onClick={() => {
                  alert(
                    'Plan upgrade requested. An administrator can grant this tier or billing will be integrated.'
                  );
                  onOpenChange(false);
                }}
              >
                Choose Plus
              </Button>
            </div>
          </div>

          {/* AI PLUS PLAN */}
          <div
            className="rounded-xl p-5 relative flex flex-col justify-between"
            style={{
              background:
                'linear-gradient(180deg, rgba(234, 88, 12, 0.08) 0%, rgba(20, 20, 25, 0.6) 100%)',
              border: '1px solid rgba(234, 88, 12, 0.3)',
            }}
          >
            <div>
              <div className="flex items-center justify-between mb-3">
                <span className="text-xs font-semibold uppercase tracking-wider text-orange-400">
                  AI Plus
                </span>
                <span className="px-2 py-0.5 text-[10px] font-semibold bg-orange-500/20 text-orange-300 border border-orange-500/30 rounded-full flex items-center gap-1">
                  <Zap className="w-3 h-3" /> Best Value
                </span>
              </div>
              <div className="flex items-baseline gap-1 mb-4">
                <span className="text-3xl font-extrabold text-white">₹1,499</span>
                <span className="text-xs text-muted-foreground">/month</span>
              </div>

              <div className="space-y-2.5 text-xs text-muted-foreground">
                <div className="flex items-center gap-2">
                  <Check className="w-4 h-4 text-emerald-400 shrink-0" />
                  <span>Everything in Plus plan</span>
                </div>
                <div className="flex items-center gap-2">
                  <Check className="w-4 h-4 text-emerald-400 shrink-0" />
                  <span>Full production & shoot management</span>
                </div>
                <div className="flex items-center gap-2">
                  <Sparkles className="w-4 h-4 text-orange-400 shrink-0" />
                  <span className="text-foreground font-semibold text-orange-200">
                    Expanded hosted Sarvam AI usage limits
                  </span>
                </div>
                <div className="flex items-center gap-2">
                  <ShieldCheck className="w-4 h-4 text-emerald-400 shrink-0" />
                  <span>Priority screenplay co-writing</span>
                </div>
              </div>
            </div>

            <div className="mt-6">
              <Button
                className="w-full bg-orange-600 hover:bg-orange-500 text-white font-medium shadow-md shadow-orange-600/20"
                onClick={() => {
                  alert(
                    'Plan upgrade requested. An administrator can grant this tier or billing will be integrated.'
                  );
                  onOpenChange(false);
                }}
              >
                Choose AI Plus
              </Button>
            </div>
          </div>
        </div>

        <div className="text-center pt-2 text-[11px] text-muted-foreground border-t border-white/5">
          Billing cycle rolls forward monthly. Prices include applicable taxes. Contact your team
          admin for immediate workspace plan assignment.
        </div>
      </DialogContent>
    </Dialog>
  );
}
