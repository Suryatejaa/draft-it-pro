import { ref, uploadBytes, getBlob } from 'firebase/storage';
import { firebaseClient } from './firebase';
import type { FileReference, FileCopy } from './production';
const permitted =
  /^(image\/(jpeg|png|webp|heic|heif)|video\/(mp4|quicktime|webm)|audio\/(mpeg|wav|mp4|ogg)|application\/pdf|text\/plain)$/;
export async function uploadProductionFile(
  userId: string,
  rootProjectId: string,
  file: File,
): Promise<FileReference> {
  if (!permitted.test(file.type))
    throw Error('Use a photo, MP4/MOV/WebM video, audio, PDF or text file.');
  if (file.size > 25 * 1024 * 1024)
    throw Error('Files must be 25 MB or smaller.');
  const id = crypto.randomUUID();
  const path = `users/${userId}/projects/${rootProjectId}/files/${id}`;
  await uploadBytes(ref(firebaseClient().storage, path), file, {
    contentType: file.type,
  });
  return { id, name: file.name, path, mimeType: file.type, size: file.size };
}
export async function openProductionFile(
  userId: string,
  rootProjectId: string,
  file: FileReference,
) {
  if (!file.path.startsWith(`users/${userId}/projects/${rootProjectId}/files/`))
    throw Error('This file belongs to a different project.');
  const blob = await getBlob(ref(firebaseClient().storage, file.path));
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url;
  a.download = file.name;
  a.click();
  setTimeout(() => URL.revokeObjectURL(url), 60000);
}

export async function copyProductionFiles(userId: string, copies: FileCopy[]) {
  for (const copy of copies) {
    for (const path of [copy.sourcePath, copy.targetPath])
      if (
        !path.startsWith(`users/${userId}/projects/`) ||
        !/^users\/[^/]+\/projects\/[^/]+\/files\/[^/]+$/.test(path)
      )
        throw Error(
          'Sign in to the original account to restore these attachments.',
        );
    const storage = firebaseClient().storage;
    const blob = await getBlob(ref(storage, copy.sourcePath), 25 * 1024 * 1024);
    await uploadBytes(ref(storage, copy.targetPath), blob, {
      contentType: copy.mimeType,
    });
  }
}
