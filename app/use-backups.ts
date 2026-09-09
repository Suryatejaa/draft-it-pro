'use client';
import { useEffect, useRef, useState } from 'react';
import { backupDelay, readBackups, writeBackup } from '@/lib/backups';
import type { Project } from '@/lib/project';
export function useBackups(
  projects: Project[],
  loaded: boolean,
  scope = 'guest',
) {
  const current = useRef(projects);
  current.current = projects;
  const times = useRef<Record<string, number>>({});
  const retry = useRef<Record<string, number>>({});
  const busy = useRef(false);
  const [lastBackups, setLast] = useState<Record<string, number>>({});
  const [errors, setErrors] = useState<Record<string, string>>({});
  const settings = projects
    .map(
      (p) =>
        p.id +
        ':' +
        p.backupSettings?.enabled +
        ':' +
        p.backupSettings?.intervalMinutes,
    )
    .join('|');
  useEffect(() => {
    times.current = {};
    retry.current = {};
    setLast({});
    setErrors({});
  }, [scope]);
  useEffect(() => {
    if (!loaded) return;
    let active = true;
    async function tick() {
      if (busy.current) return;
      busy.current = true;
      try {
        for (const p of current.current) {
          if (!active) return;
          try {
            if (times.current[p.id] === undefined) {
              const backups = await readBackups(p.id, scope);
              if (!active) return;
              times.current[p.id] = backups[0]?.savedAt ?? 0;
              setLast({ ...times.current });
            }
            const latest = current.current.find((x) => x.id === p.id);
            if (!latest?.backupSettings?.enabled) continue;
            const now = Date.now();
            if ((retry.current[p.id] ?? 0) > now) continue;
            if (
              backupDelay(latest.backupSettings, times.current[p.id], now) === 0
            ) {
              const savedAt = await writeBackup(latest, Date.now(), scope);
              if (active) {
                times.current[p.id] = savedAt;
                setLast({ ...times.current });
                setErrors((e) => ({ ...e, [p.id]: '' }));
              }
            }
          } catch {
            retry.current[p.id] = Date.now() + 60000;
            if (active)
              setErrors((e) => ({
                ...e,
                [p.id]:
                  'Backup could not be saved. Download a project backup to keep a separate copy.',
              }));
          }
        }
      } finally {
        busy.current = false;
      }
    }
    void tick();
    const timer = setInterval(() => void tick(), 1000);
    const resume = () => void tick();
    document.addEventListener('visibilitychange', resume);
    return () => {
      active = false;
      clearInterval(timer);
      document.removeEventListener('visibilitychange', resume);
    };
  }, [loaded, settings, scope]);
  return { lastBackups, backupErrors: errors };
}
