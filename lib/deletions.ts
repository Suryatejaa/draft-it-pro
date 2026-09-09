import type { Project } from './project';
export type DeleteKind =
  | 'scene'
  | 'episode'
  | 'panel'
  | 'image'
  | 'character'
  | 'location'
  | 'act'
  | 'story';
export function deleteElement(p: Project, kind: DeleteKind, id = ''): Project {
  if (kind === 'episode')
    return { ...p, episodes: (p.episodes ?? []).filter((e) => e.id !== id) };
  if (kind === 'story')
    return {
      ...p,
      logline: '',
      premise: '',
      theme: '',
      synopsis: '',
      treatment: '',
      notes: '',
      references: '',
    };
  if (kind === 'scene' || kind === 'act') {
    if (kind === 'act' && p.acts.length <= 1)
      throw Error('Keep at least one story column.');
    const ids = new Set(
      p.scenes
        .filter((s) => (kind === 'scene' ? s.id === id : s.act === id))
        .map((s) => s.id),
    );
    return {
      ...p,
      scenes: p.scenes.filter((s) => !ids.has(s.id)),
      panels: p.panels.filter((s) => !ids.has(s.sceneId)),
      acts: kind === 'act' ? p.acts.filter((a) => a !== id) : p.acts,
    };
  }
  if (kind === 'panel')
    return { ...p, panels: p.panels.filter((s) => s.id !== id) };
  if (kind === 'image')
    return {
      ...p,
      panels: p.panels.map((s) =>
        s.id === id ? { ...s, image: undefined } : s,
      ),
    };
  if (kind === 'character') {
    const entity = p.characters.find((c) => c.id === id);
    return {
      ...p,
      characters: p.characters.filter((c) => c.id !== id),
      excludedCharacterNames: Array.from(
        new Set([
          ...(p.excludedCharacterNames ?? []),
          ...(entity ? [entity.name.toUpperCase()] : []),
        ]),
      ),
      scenes: p.scenes.map((s) => ({
        ...s,
        characterIds: s.characterIds.filter((c) => c !== id),
      })),
    };
  }
  const entity = p.locations.find((c) => c.id === id);
  return {
    ...p,
    locations: p.locations.filter((c) => c.id !== id),
    excludedLocationNames: Array.from(
      new Set([
        ...(p.excludedLocationNames ?? []),
        ...(entity ? [entity.name.toUpperCase()] : []),
      ]),
    ),
    scenes: p.scenes.map((s) =>
      s.locationId === id ? { ...s, locationId: '' } : s,
    ),
  };
}
