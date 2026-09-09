import {
  collection,
  doc,
  getDoc,
  onSnapshot,
  runTransaction,
  serverTimestamp,
  type Unsubscribe,
} from 'firebase/firestore';
import { getBytes, ref, uploadBytes, uploadString } from 'firebase/storage';
import { firebaseClient } from './firebase';
import { type Project, uid } from './project';
export type Manifest = {
  revision: number;
  path: string;
  hash: string;
  title: string;
};
export type SyncBase = { revision: number; hash: string };
export type SyncBases = Record<string, SyncBase>;
export async function digest(text: string) {
  const bytes = await crypto.subtle.digest(
    'SHA-256',
    new TextEncoder().encode(text),
  );
  return Array.from(new Uint8Array(bytes), (b) =>
    b.toString(16).padStart(2, '0'),
  ).join('');
}
export function conflictCopy(project: Project): Project {
  return {
    ...structuredClone(project),
    id: uid(),
    title: project.title + ' (conflict copy)',
    updatedAt: new Date().toISOString(),
  };
}
export function mergeGuest(account: Project[], guest: Project[]) {
  const ids = new Set(account.map((p) => p.id));
  return [...account, ...guest.filter((p) => !ids.has(p.id))];
}
async function storageRequest<T>(
  operation: string,
  path: string,
  request: () => Promise<T>,
): Promise<T> {
  try {
    return await request();
  } catch (error) {
    const original = error as { code?: string };
    const wrapped = new Error('Storage ' + operation + ' failed');
    Object.assign(wrapped, {
      code: original.code,
      storageContext: {
        operation,
        path,
        bucket: firebaseClient().storage.app.options.storageBucket,
      },
    });
    throw wrapped;
  }
}
const uploadedImages = new Set<string>();
function projectTree(p: Project): Project[] {
  return [p, ...(p.episodes ?? []).flatMap(projectTree)];
}
export async function encodeCloudProject(
  p: Project,
  userId: string,
): Promise<Project> {
  const encoded = structuredClone(p);
  const { storage } = firebaseClient();
  for (const part of projectTree(encoded)) {
    for (const panel of part.panels) {
      if (!panel.image) continue;
      if (!panel.image.startsWith('data:image/'))
        throw Error(
          'A storyboard image is not stored locally. Re-upload it before syncing.',
        );
      const hash = await digest(panel.image);
      const path = `users/${userId}/projects/${p.id}/images/${hash}`;
      if (!uploadedImages.has(path)) {
        const image = panel.image;
        await storageRequest('image upload', path, () =>
          uploadString(ref(storage, path), image, 'data_url'),
        );
        uploadedImages.add(path);
      }
      panel.image = 'firebase-storage:' + path;
    }
  }
  return encoded;
}
function blobDataUrl(blob: Blob) {
  return new Promise<string>((resolve, reject) => {
    const reader = new FileReader();
    reader.onload = () => resolve(String(reader.result));
    reader.onerror = () => reject(reader.error);
    reader.readAsDataURL(blob);
  });
}
const imageCache = new Map<string, string>();
export function validateCloudProject(
  value: unknown,
  id: string,
): asserts value is Project {
  const p = value as Project;
  if (
    !p ||
    typeof p !== 'object' ||
    p.id !== id ||
    typeof p.title !== 'string' ||
    !Array.isArray(p.scenes) ||
    !Array.isArray(p.panels) ||
    !Array.isArray(p.characters) ||
    !Array.isArray(p.locations) ||
    !Array.isArray(p.acts)
  )
    throw Error('The cloud project is not a supported Draft-it document.');
  for (const key of [
    'format',
    'genre',
    'logline',
    'premise',
    'theme',
    'synopsis',
    'treatment',
    'notes',
    'references',
    'draft',
    'updatedAt',
  ] as const)
    if (typeof p[key] !== 'string')
      throw Error('The cloud project has invalid ' + key + '.');
  if (typeof p.targetRuntime !== 'number' || !Number.isFinite(p.targetRuntime))
    throw Error('Invalid cloud runtime.');
  if (
    p.scenes.some(
      (s) =>
        !s ||
        typeof s.id !== 'string' ||
        typeof s.heading !== 'string' ||
        typeof s.act !== 'string' ||
        typeof s.summary !== 'string' ||
        typeof s.duration !== 'number' ||
        !Array.isArray(s.characterIds) ||
        !Array.isArray(s.blocks) ||
        s.blocks.some(
          (b) =>
            !b ||
            typeof b.id !== 'string' ||
            typeof b.type !== 'string' ||
            typeof b.content !== 'string',
        ),
    )
  )
    throw Error('The cloud screenplay contains invalid scenes.');
  if (
    p.panels.some(
      (s) =>
        !s ||
        typeof s.id !== 'string' ||
        typeof s.sceneId !== 'string' ||
        (s.image !== undefined && typeof s.image !== 'string'),
    )
  )
    throw Error('The cloud storyboard is invalid.');
  if (
    p.characters.some(
      (c) => !c || typeof c.id !== 'string' || typeof c.name !== 'string',
    ) ||
    p.locations.some(
      (l) => !l || typeof l.id !== 'string' || typeof l.name !== 'string',
    )
  )
    throw Error('The cloud character/location data is invalid.');
  if (p.kind === 'series') {
    if (
      !Array.isArray(p.episodes) ||
      !p.episodes.length ||
      p.episodes.some((e) => e.kind === 'series')
    )
      throw Error('The cloud series has invalid episodes.');
    p.episodes.forEach((e) => validateCloudProject(e, e.id));
  }
}
export async function downloadCloudProject(
  userId: string,
  id: string,
  manifest: Manifest,
): Promise<Project> {
  const prefix = `users/${userId}/projects/${id}/`;
  if (!manifest.path.startsWith(prefix + 'snapshots/'))
    throw Error('Invalid cloud snapshot location.');
  const { storage } = firebaseClient();
  const bytes = await storageRequest('snapshot download', manifest.path, () =>
    getBytes(ref(storage, manifest.path), 50 * 1024 * 1024),
  );
  const p: unknown = JSON.parse(new TextDecoder().decode(bytes));
  validateCloudProject(p, id);
  for (const part of projectTree(p)) {
    for (const panel of part.panels) {
      if (!panel.image) continue;
      if (!panel.image.startsWith('firebase-storage:' + prefix + 'images/'))
        throw Error('Invalid cloud image location.');
      const path = panel.image.slice('firebase-storage:'.length);
      let data = imageCache.get(path);
      if (!data) {
        const bytes = await storageRequest('image download', path, () =>
          getBytes(ref(storage, path), 12 * 1024 * 1024),
        );
        const metadataMime = (await import('firebase/storage')).getMetadata;
        const info = await metadataMime(ref(storage, path));
        data = await blobDataUrl(
          new Blob([bytes], {
            type: info.contentType ?? 'application/octet-stream',
          }),
        );
        if (!data.startsWith('data:image/'))
          throw Error('Invalid cloud image type.');
        imageCache.set(path, data);
      }
      panel.image = data;
    }
  }
  if ((await digest(JSON.stringify(p))) !== manifest.hash)
    throw Error(
      'Cloud snapshot integrity check failed. Your local work has been kept.',
    );
  return p;
}
export async function uploadCloudProject(
  userId: string,
  p: Project,
  expectedRevision: number,
): Promise<SyncBase> {
  const { db, storage } = firebaseClient();
  const hash = await digest(JSON.stringify(p));
  const encoded = await encodeCloudProject(p, userId);
  const path = `users/${userId}/projects/${p.id}/snapshots/${uid()}.json`;
  const blob = new Blob([JSON.stringify(encoded)], {
    type: 'application/json',
  });
  if (blob.size > 50 * 1024 * 1024)
    throw Error('This project is too large for one cloud snapshot (50 MB).');
  await storageRequest('snapshot upload', path, () =>
    uploadBytes(ref(storage, path), blob, { contentType: 'application/json' }),
  );
  const reference = doc(db, 'users', userId, 'projects', p.id);
  await runTransaction(db, async (tx) => {
    const existing = await tx.get(reference);
    const revision = existing.exists() ? existing.data().revision : 0;
    if (revision !== expectedRevision) throw Error('sync-conflict');
    tx.set(reference, {
      revision: expectedRevision + 1,
      path,
      hash,
      title: p.title,
      updatedAt: serverTimestamp(),
    });
  });
  return { revision: expectedRevision + 1, hash };
}
export function watchCloudProjects(
  userId: string,
  onChange: (manifests: Record<string, Manifest>) => void,
  onError: (error: unknown) => void,
): Unsubscribe {
  const { db } = firebaseClient();
  return onSnapshot(
    collection(db, 'users', userId, 'projects'),
    { includeMetadataChanges: true },
    (snapshot) => {
      if (snapshot.metadata.fromCache) return;
      const manifests: Record<string, Manifest> = {};
      for (const d of snapshot.docs) {
        const m = d.data();
        if (
          !Number.isInteger(m.revision) ||
          m.revision < 1 ||
          typeof m.path !== 'string' ||
          typeof m.hash !== 'string'
        ) {
          onError(Error('An invalid cloud project was found. Sync paused.'));
          return;
        }
        manifests[d.id] = m as Manifest;
      }
      onChange(manifests);
    },
    onError,
  );
}
export async function cloudManifest(userId: string, id: string) {
  const snap = await getDoc(
    doc(firebaseClient().db, 'users', userId, 'projects', id),
  );
  return snap.exists() ? (snap.data() as Manifest) : undefined;
}
