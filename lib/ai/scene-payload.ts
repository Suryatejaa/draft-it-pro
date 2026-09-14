import { parseSceneHeading } from '../project.ts';
import type { Project, Scene } from '../project.ts';

/** Bound text per scene, never the number of scenes in a global payload. */
export function compactScene(scene: Scene, sceneNumber: number, project: Project) {
  const storedSummary = scene.summary?.trim();
  const excerpt = (scene.blocks || [])
    .filter(block => block.type === 'action' || block.type === 'dialogue')
    .slice(0, 4)
    .map(block => `[${block.type}] ${block.content.replace(/\s+/g, ' ').trim().slice(0, 160)}`)
    .join(' ')
    .slice(0, 600);
  const location = (project.locations || []).find(candidate => candidate.id === scene.locationId);
  const charactersPresent = (project.characters || [])
    .filter(character => (scene.characterIds || []).includes(character.id))
    .map(character => ({ id: character.id, name: character.name }));
  const headingDetails = parseSceneHeading(scene.heading);
  return {
    id: scene.id,
    sceneId: scene.id,
    sceneNumber,
    heading: scene.heading,
    act: scene.act,
    storyLocationId: scene.locationId || undefined,
    storyLocationName: location?.name,
    timeOfDay: headingDetails?.timeOfDay || undefined,
    characterIds: scene.characterIds || [],
    characterNames: charactersPresent.map(character => character.name),
    charactersPresent,
    characterCount: (scene.characterIds || []).length,
    summary: storedSummary ? storedSummary.slice(0, 600) : undefined,
    screenplayExcerpt: storedSummary || !excerpt ? undefined : `Screenplay excerpt: ${excerpt}`,
    summarySource: storedSummary ? 'stored_summary' : excerpt ? 'screenplay_excerpt' : 'unavailable',
    summaryTruncated: !!storedSummary && storedSummary.length > 600,
    purpose: scene.purpose?.slice(0, 240),
  };
}

/** Only IDs and counts cross the development logging boundary. Never log message content. */
export function traceScenePayload(boundary: string, sceneIds: readonly string[], counts: Record<string, string | number | boolean | undefined> = {}) {
  if (process.env.NODE_ENV === 'development') console.debug('[Co-Drafter scene payload]', boundary, { ...counts, resultCount: sceneIds.length, sceneIds });
}

export function traceSerializedToolScenes(boundary: string, content: string) {
  if (process.env.NODE_ENV !== 'development') return;
  try {
    const result = JSON.parse(content);
    if (!['scene_summaries_only', 'single_scene_screenplay'].includes(result.detail)) return;
    const scenes = Array.isArray(result.data) ? result.data : [result.data];
    const ids = scenes.flatMap((scene: { id?: unknown }) => typeof scene?.id === 'string' ? [scene.id] : []);
    const coverage = result.episodeCoverage as { episodeSceneCount?: unknown; matchedSceneCount?: unknown } | undefined;
    traceScenePayload(boundary, ids, {
      canonicalSceneCount: typeof coverage?.episodeSceneCount === 'number' ? coverage.episodeSceneCount : undefined,
      linkedCharacterMatchCount: typeof coverage?.matchedSceneCount === 'number' ? coverage.matchedSceneCount : undefined,
      serializedSceneCount: ids.length,
      completeEpisodeCoverage: result.complete,
    });
  } catch { /* Diagnostics must not affect requests. */ }
}
