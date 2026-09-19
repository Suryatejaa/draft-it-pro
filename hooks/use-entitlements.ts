'use client';

import { useState, useEffect, useCallback } from 'react';
import type { User } from 'firebase/auth';
import type { UserEntitlements, FeatureId } from '@/lib/entitlements/types';
import {
  resolveEntitlements,
  canAccessFeature as checkCanAccessFeature,
  isViewLocked as checkIsViewLocked,
} from '@/lib/entitlements/resolver';

const GUEST_ENTITLEMENTS = resolveEntitlements({ user: null });

export function useEntitlements(user: User | null) {
  const [entitlements, setEntitlements] = useState<UserEntitlements>(GUEST_ENTITLEMENTS);
  const [loading, setLoading] = useState(false);

  const fetchEntitlements = useCallback(async () => {
    if (!user) {
      setEntitlements(GUEST_ENTITLEMENTS);
      return;
    }

    setLoading(true);
    try {
      const token = await user.getIdToken();
      const res = await fetch('/api/entitlements', {
        headers: {
          Authorization: `Bearer ${token}`,
        },
      });

      if (res.ok) {
        const data = await res.json();
        setEntitlements(data);
      }
    } catch {
      // Preserve the last known entitlement state. Infrastructure failure must
      // never silently downgrade a paid user to Free in the client.
    } finally {
      setLoading(false);
    }
  }, [user]);

  useEffect(() => {
    fetchEntitlements();
  }, [fetchEntitlements]);

  const canAccessFeature = useCallback(
    (featureId: FeatureId) => checkCanAccessFeature(entitlements, featureId),
    [entitlements]
  );

  const isViewLocked = useCallback(
    (viewName: string) => checkIsViewLocked(viewName, entitlements),
    [entitlements]
  );

  return {
    entitlements,
    loading,
    refresh: fetchEntitlements,
    canAccessFeature,
    isViewLocked,
    isAdmin: entitlements.isAdmin,
    canAccessByok: entitlements.canAccessByok,
    aiCreditStatus: entitlements.aiCreditStatus,
  };
}
