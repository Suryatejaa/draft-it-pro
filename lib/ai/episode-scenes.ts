import { traceScenePayload } from './scene-payload.ts';
import type { Project, Scene } from '../project.ts';

/** Resolve from the root snapshot, never a UI-filtered workspace or active act. */
export function getEpisodeSceneScope(root: Project, workspace?: Project) {
  const id = workspace?.id || root.id;
  const canonical = id === root.id ? root : root.episodes?.find(episode => episode.id === id);
  const project = canonical || workspace || root;
  const scenes = canonical ? getAllScenesForEpisode(root, id) : project.scenes || [];
  // Optional count from a partial input is evidence of missing data, not a schema mutation.
  const declared = (project as Project & { sceneCount?: unknown }).sceneCount;
  const episodeSceneCount = typeof declared === 'number' && Number.isInteger(declared) && declared >= 0
    ? Math.max(declared, scenes.length) : scenes.length;
  traceScenePayload('canonicalEpisode', scenes.map(scene => scene.id), { episodeId: id, canonicalSceneCount: episodeSceneCount, canonicalScenesLength: scenes.length });
  const complete = !!canonical && new Set(scenes.map(scene => scene.id)).size === episodeSceneCount;
  return { project, scenes, episodeId: id === root.id ? undefined : id, episodeSceneCount, complete };
}

export function getAllScenesForEpisode(root: Project, episodeId = root.id): readonly Scene[] {
  const project = episodeId === root.id ? root : root.episodes?.find(episode => episode.id === episodeId);
  const scenes = project?.scenes || [];
  traceScenePayload('getEpisodeScenes.resultCount', scenes.map(scene => scene.id), { episodeId, getEpisodeScenesCount: scenes.length });
  return scenes;
}

export function sceneRetrievalCoverage(scope: ReturnType<typeof getEpisodeSceneScope>, scanned: readonly Scene[], matched: readonly Scene[], returned: readonly Scene[]) {
  const scannedIds = new Set(scanned.map(scene => scene.id));
  const matchedIds = new Set(matched.map(scene => scene.id));
  const returnedIds = new Set(returned.map(scene => scene.id));
  const scannedAll = scope.complete && scannedIds.size === scope.episodeSceneCount && scope.scenes.every(scene => scannedIds.has(scene.id));
  return {
    episodeSceneCount: scope.episodeSceneCount,
    retrievedSceneCount: scannedIds.size,
    scannedSceneCount: scannedIds.size,
    matchedSceneCount: matchedIds.size,
    returnedSceneCount: returnedIds.size,
    actsScanned: [...new Set(scanned.map(scene => scene.act))],
    complete: scannedAll && matchedIds.size === returnedIds.size && [...matchedIds].every(id => returnedIds.has(id)),
  };
}
