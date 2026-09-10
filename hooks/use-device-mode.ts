'use client';

import { useState, useEffect } from 'react';

export type DeviceMode = 'mobile' | 'tablet' | 'desktop';

export function useDeviceMode(): {
  mode: DeviceMode;
  isMobile: boolean;
  isTablet: boolean;
  isDesktop: boolean;
  mounted: boolean;
} {
  const [mode, setMode] = useState<DeviceMode>('desktop');
  const [mounted, setMounted] = useState(false);

  useEffect(() => {
    setMounted(true);
    const updateMode = () => {
      const width = window.innerWidth;
      if (width < 768) {
        setMode('mobile');
      } else if (width < 1200) {
        setMode('tablet');
      } else {
        setMode('desktop');
      }
    };

    updateMode();
    window.addEventListener('resize', updateMode);
    return () => window.removeEventListener('resize', updateMode);
  }, []);

  return {
    mode,
    isMobile: mounted && mode === 'mobile',
    isTablet: mounted && mode === 'tablet',
    isDesktop: !mounted || mode === 'desktop',
    mounted,
  };
}
