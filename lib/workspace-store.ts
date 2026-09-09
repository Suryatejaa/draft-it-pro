import { openStore, loadProjects, type Project } from './project';
import type { SyncBases } from './cloud-sync';
export type WorkspaceData = { projects: Project[]; bases: SyncBases };
export async function readWorkspace(
  scope: string,
): Promise<WorkspaceData | undefined> {
  const db = await openStore();
  return new Promise((resolve, reject) => {
    const tx = db.transaction('workspace');
    const r = tx.objectStore('workspace').get('workspace:' + scope);
    r.onsuccess = () => {
      db.close();
      resolve(r.result);
    };
    r.onerror = () => {
      db.close();
      reject(r.error);
    };
  });
}
export async function saveWorkspace(
  scope: string,
  data: WorkspaceData,
): Promise<void> {
  const db = await openStore();
  return new Promise((resolve, reject) => {
    const tx = db.transaction('workspace', 'readwrite');
    tx.objectStore('workspace').put(data, 'workspace:' + scope);
    tx.oncomplete = () => {
      db.close();
      resolve();
    };
    tx.onabort = tx.onerror = () => {
      db.close();
      reject(tx.error ?? Error('Local save failed.'));
    };
  });
}
// Claim the legacy guest workspace once, so a second Google account never receives it.
export async function claimGuest(userId: string): Promise<Project[]> {
  const db = await openStore();
  return new Promise((resolve, reject) => {
    const tx = db.transaction('workspace', 'readwrite');
    const store = tx.objectStore('workspace');
    let projects: Project[] = [];
    const claim = store.get('guest-claimed-by');
    claim.onsuccess = () => {
      if (claim.result) return;
      const commitClaim = () => {
        const account = store.get('workspace:' + userId);
        account.onsuccess = () => {
          const existing = account.result as WorkspaceData | undefined;
          const ids = new Set((existing?.projects ?? []).map((p) => p.id));
          store.put(
            {
              projects: [
                ...(existing?.projects ?? []),
                ...projects.filter((p) => !ids.has(p.id)),
              ],
              bases: existing?.bases ?? {},
            },
            'workspace:' + userId,
          );
          store.put(userId, 'guest-claimed-by');
        };
      };
      const guest = store.get('workspace:guest');
      guest.onsuccess = () => {
        if (guest.result) {
          projects = guest.result.projects ?? [];
          commitClaim();
        } else {
          const legacy = store.get('projects');
          legacy.onsuccess = () => {
            projects = legacy.result ?? [];
            commitClaim();
          };
        }
      };
    };
    tx.oncomplete = () => {
      db.close();
      resolve(projects);
    };
    tx.onabort = tx.onerror = () => {
      db.close();
      reject(tx.error ?? Error('Could not migrate local projects.'));
    };
  });
}
export async function guestWorkspace() {
  return (
    (await readWorkspace('guest')) ?? {
      projects: (await loadProjects()) ?? [],
      bases: {},
    }
  );
}
