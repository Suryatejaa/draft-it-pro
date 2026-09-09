import { openStore, type Project } from './project';
export const backupIntervals = [5, 15, 30, 60] as const;
export type BackupSettings = { enabled: boolean; intervalMinutes: number };
export type BackupRecord = { savedAt: number; project: Project };
export function backupDelay(
  settings: BackupSettings,
  last: number,
  now: number,
) {
  return !settings.enabled
    ? null
    : Math.max(0, last + settings.intervalMinutes * 60000 - now);
}
export function retainBackups(
  previous: BackupRecord[],
  project: Project,
  now: number,
): BackupRecord[] {
  return [
    { savedAt: now, project: structuredClone(project) },
    ...previous,
  ].slice(0, 5);
}
export async function readBackups(
  id: string,
  scope = 'guest',
): Promise<BackupRecord[]> {
  const db = await openStore();
  return new Promise((resolve, reject) => {
    const tx = db.transaction('workspace');
    const r = tx.objectStore('workspace').get('backups:' + scope + ':' + id);
    r.onsuccess = () => {
      if (scope === 'guest' && !r.result) {
        const legacy = tx.objectStore('workspace').get('backups:' + id);
        legacy.onsuccess = () => {
          db.close();
          resolve(legacy.result ?? []);
        };
        legacy.onerror = () => {
          db.close();
          reject(legacy.error);
        };
      } else {
        db.close();
        resolve(r.result ?? []);
      }
    };
    r.onerror = () => {
      db.close();
      reject(r.error);
    };
  });
}
export async function writeBackup(
  project: Project,
  now = Date.now(),
  scope = 'guest',
): Promise<number> {
  const db = await openStore();
  return new Promise((resolve, reject) => {
    const tx = db.transaction('workspace', 'readwrite');
    const store = tx.objectStore('workspace');
    const key = 'backups:' + scope + ':' + project.id;
    const r = store.get(key);
    r.onsuccess = () => {
      if (scope === 'guest' && !r.result) {
        const legacy = store.get('backups:' + project.id);
        legacy.onsuccess = () =>
          store.put(retainBackups(legacy.result ?? [], project, now), key);
      } else store.put(retainBackups(r.result ?? [], project, now), key);
    };
    tx.oncomplete = () => {
      db.close();
      resolve(now);
    };
    tx.onabort = tx.onerror = () => {
      db.close();
      reject(tx.error ?? new Error('Backup could not be saved.'));
    };
  });
}
