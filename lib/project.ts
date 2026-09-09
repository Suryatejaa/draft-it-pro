export const uid = () => crypto.randomUUID();
export const elementTypes = [
  'scene_heading',
  'action',
  'character',
  'parenthetical',
  'dialogue',
  'transition',
  'shot',
  'general',
] as const;
export type ElementType = (typeof elementTypes)[number];
export type Block = { id: string; type: ElementType; content: string };
export type ShotSize =
  | 'extreme_wide'
  | 'wide'
  | 'medium_wide'
  | 'medium'
  | 'medium_close'
  | 'close_up'
  | 'extreme_close_up'
  | 'insert'
  | 'over_shoulder'
  | 'two_shot';

export type CameraAngle =
  | 'eye_level'
  | 'high'
  | 'low'
  | 'top_down'
  | 'dutch';

export type CameraMovement =
  | 'static'
  | 'pan'
  | 'tilt'
  | 'push_in'
  | 'pull_out'
  | 'tracking'
  | 'handheld';

export type ShotPurpose =
  | 'establish'
  | 'dialogue'
  | 'reaction'
  | 'action'
  | 'insert'
  | 'transition';

export interface StoryboardShotIntent {
  id: string;
  sceneId: string;
  panelNumber: string;
  subjectIds?: string[];
  shotSize: ShotSize;
  angle: CameraAngle;
  movement: CameraMovement;
  purpose: ShotPurpose;
  description: string;
  locationId?: string;
  characterIds: string[];
  propIds?: string[];
  duration?: number;
  lens?: string;
}

export type Person = {
  generated?: boolean;
  id: string;
  name: string;
  role: string;
  description: string;
  visualDescription?: string;
  goals: string;
  fear: string;
  backstory: string;
  arc: string;
  notes: string;
};
export type Place = {
  generated?: boolean;
  id: string;
  name: string;
  description: string;
  visualDescription?: string;
  notes: string;
};
export type Panel = {
  id: string;
  sceneId: string;
  size: string;
  angle: string;
  lens: string;
  movement: string;
  duration: number;
  description: string;
  image?: string;
  status: string;
  shotIntent?: StoryboardShotIntent;
  generatedPrompt?: string;
  customPrompt?: string;
  promptVersion?: number;
  sourceContentHash?: string;
};
export type Scene = {
  colour?: string;
  emotion?: string;
  id: string;
  act: string;
  heading: string;
  summary: string;
  purpose: string;
  storyDay: number;
  duration: number;
  status: string;
  notes: string;
  locationId: string;
  characterIds: string[];
  blocks: Block[];
};
export type Project = {
  excludedCharacterNames?: string[];
  excludedLocationNames?: string[];
  backupSettings?: { enabled: boolean; intervalMinutes: number };
  kind?: 'single' | 'series';
  episodes?: Project[];
  seasonNumber?: number;
  episodeNumber?: number;
  id: string;
  title: string;
  format: string;
  genre: string;
  logline: string;
  premise: string;
  theme: string;
  synopsis: string;
  treatment: string;
  notes: string;
  references: string;
  targetRuntime: number;
  draft: string;
  updatedAt: string;
  scenes: Scene[];
  characters: Person[];
  locations: Place[];
  panels: Panel[];
  acts: string[];
  aspectRatio?: '16:9' | '9:16' | '4:3' | '2.39:1' | '1.85:1';
  storyboardStyle?: 'pencil' | 'marker' | 'ink' | 'grayscale' | 'line_art';
};
export function blankProject(title: string, format: string): Project {
  if (format === 'Series') return createSeries(title);
  return {
    kind: 'single',
    id: uid(),
    title,
    format,
    genre: '',
    logline: '',
    premise: '',
    theme: '',
    synopsis: '',
    treatment: '',
    notes: '',
    references: '',
    targetRuntime: 60,
    draft: 'Draft 1',
    updatedAt: new Date().toISOString(),
    scenes: [],
    characters: [],
    locations: [],
    panels: [],
    acts: ['Act I', 'Act II', 'Act III'],
  };
}
export function newScene(act = 'Act I'): Scene {
  return {
    id: uid(),
    act,
    heading: 'INT. NEW LOCATION - DAY',
    summary: '',
    purpose: '',
    storyDay: 1,
    duration: 5,
    status: 'outline',
    notes: '',
    locationId: '',
    characterIds: [],
    blocks: [
      { id: uid(), type: 'scene_heading', content: 'INT. NEW LOCATION - DAY' },
      { id: uid(), type: 'action', content: '' },
    ],
  };
}
export function locationName(heading: string) {
  return heading
    .replace(/^(INT\.?\s*\/\s*EXT\.?|INT\.?|EXT\.?)\s*/i, '')
    .split(/\s[-–—]\s/)[0]
    .trim()
    .toUpperCase();
}
export function reconcile(project: Project): Project {
  const locations = [...project.locations],
    characters = [...project.characters];
  const scenes = project.scenes.map((scene) => {
    const heading =
      scene.blocks.find((b) => b.type === 'scene_heading')?.content ??
      scene.heading;
    const name = locationName(heading);
    let location = locations.find((l) => l.name.toUpperCase() === name);
    if (!location && name && !project.excludedLocationNames?.includes(name)) {
      location = {
        generated: true,
        id: uid(),
        name,
        description: '',
        notes: '',
      };
      locations.push(location);
    }
    const characterIds = Array.from(
      new Set(
        scene.blocks
          .filter((b) => b.type === 'character' && b.content.trim())
          .map((b) => {
            const name = b.content
              .replace(/\s*\([^)]*\)/g, '')
              .trim()
              .toUpperCase();
            let person = characters.find((p) => p.name.toUpperCase() === name);
            if (!person && project.excludedCharacterNames?.includes(name))
              return undefined;
            if (!person) {
              person = {
                generated: true,
                id: uid(),
                name,
                role: '',
                description: '',
                goals: '',
                fear: '',
                backstory: '',
                arc: '',
                notes: '',
              };
              characters.push(person);
            }
            return person.id;
          })
          .filter((id): id is string => id !== undefined),
      ),
    );
    return { ...scene, heading, locationId: location?.id ?? '', characterIds };
  });
  return {
    ...project,
    scenes,
    locations: locations.filter(
      (l) =>
        !l.generated ||
        l.description ||
        l.notes ||
        scenes.some((s) => s.locationId === l.id),
    ),
    characters: characters.filter(
      (c) =>
        !c.generated ||
        c.role ||
        c.description ||
        c.goals ||
        c.fear ||
        c.backstory ||
        c.arc ||
        c.notes ||
        scenes.some((s) => s.characterIds.includes(c.id)),
    ),
  };
}
export function moveScene(
  project: Project,
  id: string,
  act: string,
  beforeId?: string,
): Project {
  const found = project.scenes.find((s) => s.id === id);
  if (!found || !project.acts.includes(act)) return project;
  const rest = project.scenes.filter((s) => s.id !== id);
  let at = beforeId ? rest.findIndex((s) => s.id === beforeId) : -1;
  if (at < 0) {
    const actIndex = project.acts.indexOf(act);
    at = rest.findIndex((s) => project.acts.indexOf(s.act) > actIndex);
    if (at < 0) at = rest.length;
  }
  rest.splice(at, 0, { ...found, act });
  return { ...project, scenes: rest };
}
export function seeds(): Project[] {
  const p = blankProject('UNSENT', 'Animated Short');
  p.genre = 'Drama / Romance';
  p.draft = 'Draft 3';
  p.logline =
    'A lonely man repeatedly deletes messages intended for someone he misses, unaware that every unsent thought finds its way to her.';
  p.theme = 'The things we leave unsaid still find a way to be felt.';
  p.premise = 'What if every deleted message became a paper bird?';
  p.synopsis =
    'Alone on a rainy night, a boy types and deletes messages. Each unsent thought becomes a paper bird. A growing flock crosses the sleeping city, arriving at Isha’s window just as she reaches for her phone.';
  const summaries = [
    'Rain against the window. A boy sits alone, the glow of his phone filling the silence.',
    'He opens Isha’s conversation. The last message is weeks old.',
    '“I miss you.” He deletes it. A paper bird quietly unfolds behind him.',
    '“Can we talk?” His thumb hovers, then erases every word.',
    'Another message disappears. A second bird rises into the room.',
    'He types what he really means. The room fills with unsent thoughts.',
    'The window opens. A flock of paper birds spills into the night.',
    'The birds weave between the buildings, carrying everything he could not say.',
    'Across the city, a light is still on. The birds gather at Isha’s window.',
    'Isha unfolds a bird. Her expression softens as she reaches for her phone.',
    'His phone lights up. “I thought you’d call.” For once, he doesn’t delete.',
  ];
  p.scenes = summaries.map((summary, i) => {
    const s = newScene(i < 3 ? 'Act I' : i < 8 ? 'Act II' : 'Act III');
    s.heading =
      i === 6 || i === 7
        ? 'EXT. CITY - NIGHT'
        : i === 8 || i === 9
          ? "INT. ISHA'S BEDROOM - NIGHT"
          : "INT. BOY'S BEDROOM - NIGHT";
    s.summary = summary;
    s.duration = [6, 4, 5, 5, 6, 7, 5, 5, 5, 7, 5][i];
    s.status = i < 3 ? 'revised' : i === 10 ? 'outline' : 'draft';
    s.purpose = i < 3 ? 'Setup' : i < 8 ? 'Escalation' : 'Resolution';
    s.blocks = [
      { id: uid(), type: 'scene_heading', content: s.heading },
      { id: uid(), type: 'action', content: summary },
      {
        id: uid(),
        type: 'character',
        content: i === 8 || i === 9 ? 'ISHA' : 'BOY',
      },
      {
        id: uid(),
        type: 'dialogue',
        content:
          i === 10 ? "I thought you'd call." : i === 3 ? 'Can we talk?' : '…',
      },
    ];
    return s;
  });
  p.panels = [
    {
      id: uid(),
      sceneId: p.scenes[0].id,
      size: 'Wide',
      angle: 'Eye-level',
      lens: '24mm',
      movement: 'Static',
      duration: 4,
      description: 'Boy framed against the rain-streaked window.',
      status: 'Planned',
    },
    {
      id: uid(),
      sceneId: p.scenes[0].id,
      size: 'CU',
      angle: 'Eye-level',
      lens: '50mm',
      movement: 'Slow push-in',
      duration: 2,
      description: 'Phone light catches his face.',
      status: 'Planned',
    },
    {
      id: uid(),
      sceneId: p.scenes[1].id,
      size: 'ECU',
      angle: 'High angle',
      lens: '85mm',
      movement: 'Static',
      duration: 3,
      description: 'The empty conversation, waiting for words.',
      status: 'Ready',
    },
  ];
  const ready = reconcile(p);
  ready.characters[0].description =
    'Quiet, thoughtful, and caught between wanting to reach out and fearing the answer.';
  ready.characters[0].role = 'Lead';
  ready.characters[1].role = 'Lead';
  return [ready];
}
export function screenplayText(p: Project) {
  return (
    p.title +
    '\n\n' +
    p.scenes
      .map((s) =>
        s.blocks
          .map((b) =>
            b.type === 'character' ? '\n' + b.content.toUpperCase() : b.content,
          )
          .join('\n\n'),
      )
      .join('\n\n')
  );
}
export async function openStore() {
  return new Promise<IDBDatabase>((resolve, reject) => {
    const r = indexedDB.open('draft-it-pro', 1);
    r.onupgradeneeded = () => r.result.createObjectStore('workspace');
    r.onsuccess = () => resolve(r.result);
    r.onerror = () => reject(r.error);
  });
}
export async function loadProjects() {
  const db = await openStore();
  return new Promise<Project[] | undefined>((resolve, reject) => {
    const tx = db.transaction('workspace');
    const r = tx.objectStore('workspace').get('projects');
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
export async function saveProjects(projects: Project[]) {
  const db = await openStore();
  return new Promise<void>((resolve, reject) => {
    const tx = db.transaction('workspace', 'readwrite');
    tx.objectStore('workspace').put(projects, 'projects');
    tx.oncomplete = () => {
      db.close();
      resolve();
    };
    tx.onerror = () => {
      db.close();
      reject(tx.error);
    };
  });
}

export function fountainText(p: Project) {
  return (
    'Title: ' +
    p.title +
    '\nDraft date: ' +
    p.draft +
    '\n\n' +
    p.scenes
      .map((s) =>
        s.blocks
          .map((b, i, blocks) => {
            if (b.type === 'scene_heading') return '\n.' + b.content + '\n\n';
            if (b.type === 'character')
              return '\n@' + b.content.toUpperCase() + '\n';
            if (b.type === 'parenthetical')
              return (
                (b.content.startsWith('(')
                  ? b.content
                  : '(' + b.content + ')') + '\n'
              );
            if (b.type === 'dialogue')
              return (
                b.content +
                '\n' +
                (blocks[i + 1]?.type === 'parenthetical' ? '' : '\n')
              );
            if (b.type === 'transition') return '\n> ' + b.content + '\n\n';
            return b.content + '\n\n';
          })
          .join(''),
      )
      .join('\n')
  );
}

export function createEpisode(
  title: string,
  seasonNumber: number,
  episodeNumber: number,
): Project {
  return {
    ...blankProject(title, 'Episode'),
    seasonNumber,
    episodeNumber,
    targetRuntime: 1800,
  };
}
export function createSeries(title: string, count = 1): Project {
  if (!Number.isInteger(count) || count < 1 || count > 50)
    throw new Error('Choose 1–50 episodes.');
  return {
    ...blankProject(title, 'Web Series'),
    kind: 'series',
    episodes: Array.from({ length: count }, (_, i) =>
      createEpisode(i === 0 ? 'Pilot' : 'Episode ' + (i + 1), 1, i + 1),
    ),
  };
}
export function normalizeProject(project: Project): Project {
  if (project.kind === 'series' && Array.isArray(project.episodes))
    return project;
  if (
    project.kind === 'series' ||
    project.format === 'Series' ||
    project.format === 'Web Series'
  ) {
    const episode = {
      ...project,
      id: uid(),
      kind: 'single' as const,
      format: 'Episode',
      title: 'Episode 1',
      seasonNumber: 1,
      episodeNumber: 1,
      episodes: undefined,
    };
    return {
      ...project,
      kind: 'series',
      format: 'Web Series',
      scenes: [],
      panels: [],
      characters: [],
      locations: [],
      episodes: [episode],
    };
  }
  return { ...project, kind: 'single' };
}
export function updateWorkspace(
  root: Project,
  workspaceId: string,
  fn: (p: Project) => Project,
): Project {
  const updatedAt = new Date().toISOString();
  if (root.id === workspaceId) return { ...fn(root), updatedAt };
  if (!root.episodes?.some((e) => e.id === workspaceId)) return root;
  return {
    ...root,
    updatedAt,
    episodes: root.episodes.map((e) =>
      e.id === workspaceId ? { ...fn(e), updatedAt } : e,
    ),
  };
}
export function episodeLabel(p: Project) {
  return (
    'S' +
    String(p.seasonNumber ?? 1).padStart(2, '0') +
    ' E' +
    String(p.episodeNumber ?? 1).padStart(2, '0')
  );
}
