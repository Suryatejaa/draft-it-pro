'use client';
import {
  useCallback,
  useEffect,
  useRef,
  useState,
  type Dispatch,
  type SetStateAction,
} from 'react';
import { onAuthStateChanged, type User } from 'firebase/auth';
import {
  firebaseClient,
  firebaseConfigured,
  firebaseError,
  googleSignIn,
  googleSignOut,
} from '@/lib/firebase';
import {
  cloudManifest,
  conflictCopy,
  digest,
  downloadCloudProject,
  mergeGuest,
  uploadCloudProject,
  watchCloudProjects,
  type Manifest,
  type SyncBases,
} from '@/lib/cloud-sync';
import {
  claimGuest,
  guestWorkspace,
  readWorkspace,
  saveWorkspace,
} from '@/lib/workspace-store';
import { normalizeProject, seeds, type Project } from '@/lib/project';
export function useWorkspace() {
  const [projects, rawSetProjects] = useState<Project[]>([]),
    [loaded, setLoaded] = useState(false),
    [user, setUser] = useState<User | null>(null),
    [scope, setScope] = useState('guest'),
    [saved, setSaved] = useState('Loading…'),
    [cloudStatus, setCloudStatus] = useState(
      firebaseConfigured ? 'Checking sign-in…' : 'Firebase not configured',
    ),
    [error, setError] = useState(''),
    [authBusy, setAuthBusy] = useState(false),
    [retryKey, setRetry] = useState(0);
  const local = useRef<Project[]>([]),
    bases = useRef<SyncBases>({}),
    activeScope = useRef('guest'),
    ready = useRef(false),
    generation = useRef(0),
    saveChain = useRef(Promise.resolve()),
    wake = useRef<() => void>(() => {});
  const persist = useCallback(() => {
    const currentScope = activeScope.current;
    const data = { projects: local.current, bases: { ...bases.current } };
    setSaved('Saving locally…');
    const job = saveChain.current
      .catch(() => {})
      .then(() => saveWorkspace(currentScope, data));
    saveChain.current = job;
    void job.then(
      () => {
        if (activeScope.current === currentScope) setSaved('Saved locally');
      },
      () => {
        if (activeScope.current === currentScope) {
          setSaved('Local save failed');
          setError(
            'Could not save to browser storage. Download a backup before closing.',
          );
        }
      },
    );
    return job;
  }, []);
  const setProjects: Dispatch<SetStateAction<Project[]>> = useCallback(
    (value) => {
      const next = typeof value === 'function' ? value(local.current) : value;
      local.current = next;
      rawSetProjects(next);
      if (ready.current) {
        void persist().catch(() => {});
        wake.current();
      }
    },
    [persist],
  );
  useEffect(() => {
    let alive = true;
    async function switchWorkspace(nextUser: User | null) {
      const token = ++generation.current;
      ready.current = false;
      setLoaded(false);
      setUser(nextUser);
      wake.current = () => {};
      try {
        await saveChain.current.catch(() => {});
        const nextScope = nextUser?.uid ?? 'guest';
        let data = nextUser
          ? await readWorkspace(nextScope)
          : await guestWorkspace();
        if (nextUser) {
          const guest = await claimGuest(nextUser.uid);
          data = (await readWorkspace(nextScope)) ?? data;
          data = {
            projects: mergeGuest(data?.projects ?? [], guest),
            bases: data?.bases ?? {},
          };
        } else if (!data?.projects.length)
          data = { projects: seeds(), bases: {} };
        if (!alive || generation.current !== token) return;
        const normalized = (data?.projects ?? []).map(normalizeProject);
        activeScope.current = nextScope;
        setScope(nextScope);
        bases.current = data?.bases ?? {};
        local.current = normalized;
        rawSetProjects(normalized);
        ready.current = true;
        setLoaded(true);
        setError('');
        setCloudStatus(
          nextUser
            ? 'Connecting to Firebase…'
            : firebaseConfigured
              ? 'Sign in to sync'
              : 'Firebase not configured',
        );
        await persist();
      } catch (e) {
        if (alive && generation.current === token) {
          setError(firebaseError(e));
          setCloudStatus('Local workspace could not be opened');
          setLoaded(false);
        }
      }
    }
    let unsubscribe: undefined | (() => void);
    if (firebaseConfigured) {
      try {
        unsubscribe = onAuthStateChanged(
          firebaseClient().auth,
          (u) => void switchWorkspace(u),
          (e) => {
            setError(firebaseError(e));
            void switchWorkspace(null);
          },
        );
      } catch (e) {
        setError(firebaseError(e));
        void switchWorkspace(null);
      }
    } else void switchWorkspace(null);
    return () => {
      alive = false;
      generation.current++;
      unsubscribe?.();
      ready.current = false;
    };
  }, [persist]);
  useEffect(() => {
    if (!loaded || !user) return;
    const userId = user.uid,
      token = generation.current;
    let stopped = false,
      serverReady = false,
      running = false,
      pending = false;
    let timer: ReturnType<typeof setTimeout> | undefined;
    let manifests: Record<string, Manifest> = {};
    const valid = () =>
      !stopped &&
      generation.current === token &&
      activeScope.current === userId;
    function schedule(delay = 1200) {
      if (!valid()) return;
      pending = true;
      if (running) return;
      clearTimeout(timer);
      timer = setTimeout(() => void sync(), delay);
    }
    async function sync() {
      if (!valid() || running) return;
      if (!navigator.onLine) {
        setCloudStatus('Offline · changes saved locally');
        return;
      }
      if (!serverReady) return;
      running = true;
      pending = false;
      setCloudStatus('Syncing…');
      try {
        for (const [id, manifest] of Object.entries(manifests)) {
          if (!valid()) return;
          const base = bases.current[id];
          if (base && manifest.revision <= base.revision) continue;
          const before = local.current.find((p) => p.id === id);
          const beforeText = before ? JSON.stringify(before) : '';
          const beforeHash = before ? await digest(beforeText) : '';
          const remote = await downloadCloudProject(userId, id, manifest);
          if (!valid()) return;
          const now = local.current.find((p) => p.id === id);
          if ((now ? JSON.stringify(now) : '') !== beforeText) {
            pending = true;
            continue;
          }
          const conflict =
            before &&
            beforeHash !== manifest.hash &&
            (!base || beforeHash !== base.hash);
          const copy = conflict ? conflictCopy(before) : undefined;
          bases.current = {
            ...bases.current,
            [id]: { revision: manifest.revision, hash: manifest.hash },
          };
          const next = before
            ? local.current.map((p) => (p.id === id ? remote : p))
            : [...local.current, remote];
          local.current = copy ? [...next, copy] : next;
          rawSetProjects(local.current);
          await persist();
          if (copy) {
            setError(
              'Both devices changed “' +
                before!.title +
                '”. Your local edits were preserved in a conflict copy.',
            );
            pending = true;
          }
        }
        for (const p of [...local.current]) {
          if (!valid()) return;
          const manifest = manifests[p.id],
            base = bases.current[p.id];
          if (manifest && (!base || manifest.revision > base.revision)) {
            pending = true;
            continue;
          }
          const hash = await digest(JSON.stringify(p));
          if (base?.hash === hash) continue;
          try {
            const confirmed = await uploadCloudProject(
              userId,
              p,
              base?.revision ?? 0,
            );
            if (!valid()) return;
            bases.current = { ...bases.current, [p.id]: confirmed };
            manifests[p.id] = {
              ...manifests[p.id],
              ...confirmed,
              title: p.title,
            };
            await persist();
            if (
              JSON.stringify(local.current.find((x) => x.id === p.id)) !==
              JSON.stringify(p)
            )
              pending = true;
          } catch (e) {
            if (e instanceof Error && e.message === 'sync-conflict') {
              const latest = await cloudManifest(userId, p.id);
              if (latest) manifests[p.id] = latest;
              pending = true;
              continue;
            }
            throw e;
          }
        }
        if (valid() && !pending)
          setError((previous) =>
            previous.startsWith('Both devices changed') ? previous : '',
          );
        if (valid())
          setCloudStatus(
            pending ? 'Changes waiting to sync' : 'Synced to Firebase',
          );
      } catch (e) {
        if (valid()) {
          setError(firebaseError(e));
          setCloudStatus(
            navigator.onLine
              ? 'Cloud sync paused · retrying'
              : 'Offline · changes saved locally',
          );
          clearTimeout(timer);
          timer = setTimeout(() => void sync(), 15000);
        }
      } finally {
        running = false;
        if (pending && valid()) schedule(1200);
      }
    }
    wake.current = () => schedule();
    const stopWatch = watchCloudProjects(
      userId,
      (next) => {
        if (!valid()) return;
        manifests = next;
        serverReady = true;
        schedule(0);
      },
      (e) => {
        if (valid()) {
          setError(firebaseError(e));
          setCloudStatus('Cloud connection failed · retry to reconnect');
        }
      },
    );
    const online = () => schedule(0);
    const offline = () => setCloudStatus('Offline · changes saved locally');
    window.addEventListener('online', online);
    window.addEventListener('offline', offline);
    return () => {
      stopped = true;
      clearTimeout(timer);
      stopWatch();
      wake.current = () => {};
      window.removeEventListener('online', online);
      window.removeEventListener('offline', offline);
    };
  }, [loaded, user, scope, persist, retryKey]);
  async function signIn() {
    setAuthBusy(true);
    setError('');
    try {
      void persist().catch(() => {});
      await googleSignIn();
    } catch (e) {
      setError(firebaseError(e));
    } finally {
      setAuthBusy(false);
    }
  }
  async function signOut() {
    setAuthBusy(true);
    try {
      await persist();
      await googleSignOut();
    } catch (e) {
      setError(firebaseError(e));
    } finally {
      setAuthBusy(false);
    }
  }
  return {
    projects,
    setProjects,
    loaded,
    user,
    scope,
    saved,
    cloudStatus,
    error,
    authBusy,
    configured: firebaseConfigured,
    signIn,
    signOut,
    retry: () => {
      setError('');
      setRetry((x) => x + 1);
    },
  };
}
