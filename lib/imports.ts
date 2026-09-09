import {
  blankProject,
  createSeries,
  reconcile,
  uid,
  elementTypes,
  type Project,
  type Scene,
  type Person,
  type Place,
  type Panel,
  type StoryboardShotIntent,
  type ShotSize,
  type CameraAngle,
  type CameraMovement,
  type ShotPurpose,
} from './project';
export const importTabs = [
  'Story',
  'Scene cards',
  'Screenplay',
  'Storyboard',
  'Shot list',
  'Characters',
  'Locations',
  'Export',
] as const;
export type ImportTab = (typeof importTabs)[number];
const kinds: Record<ImportTab, string> = {
  Story: 'story',
  'Scene cards': 'scene_cards',
  Screenplay: 'screenplay',
  Storyboard: 'storyboard',
  'Shot list': 'shot_list',
  Characters: 'characters',
  Locations: 'locations',
  Export: 'project',
};
const storyKeys = [
  'title',
  'genre',
  'logline',
  'premise',
  'theme',
  'synopsis',
  'treatment',
  'notes',
  'references',
  'draft',
] as const;
const personKeys = [
  'role',
  'description',
  'visualDescription',
  'goals',
  'fear',
  'backstory',
  'arc',
  'notes',
] as const;
type Obj = Record<string, unknown>;
function obj(x: unknown, path: string): Obj {
  if (!x || typeof x !== 'object' || Array.isArray(x))
    throw Error(path + ' must be an object.');
  return x as Obj;
}
function str(x: unknown, path: string, max = 100000): string {
  if (typeof x !== 'string' || x.length > max)
    throw Error(path + ' must be text (up to ' + max + ' characters).');
  return x;
}
function name(x: unknown, path: string) {
  const s = str(x, path, 300).trim();
  if (!s) throw Error(path + ' cannot be empty.');
  return s;
}
function num(x: unknown, path: string, d = 0) {
  if (x === undefined) return d;
  if (typeof x !== 'number' || !Number.isFinite(x) || x < 0 || x > 1000000)
    throw Error(path + ' must be a non-negative number.');
  return x;
}
function arr(x: unknown, path: string, max = 1000): unknown[] {
  if (!Array.isArray(x) || x.length > max)
    throw Error(path + ' must be an array with at most ' + max + ' entries.');
  return x;
}
function choice(
  x: unknown,
  path: string,
  allowed: readonly string[],
  fallback: string,
) {
  if (x === undefined) return fallback;
  if (typeof x !== 'string' || !allowed.includes(x))
    throw Error(path + ' must be one of: ' + allowed.join(', '));
  return x;
}
function fields<T extends string>(
  o: Obj,
  keys: readonly T[],
  path: string,
): Partial<Record<T, string>> {
  const out: Partial<Record<T, string>> = {};
  for (const k of keys)
    if (o[k] !== undefined) out[k] = str(o[k], path + '.' + k);
  return out;
}
const exampleScene = {
  ref: 'scene-1',
  heading: "INT. BOY'S BEDROOM - NIGHT",
  act: 'Act I',
  summary: 'A boy hesitates over a message.',
  colour: '#6689bd',
  emotion: 'Longing',
  duration: 6,
  storyDay: 1,
  status: 'draft',
  purpose: 'Introduce the conflict',
  notes: '',
  blocks: [
    {
      type: 'action',
      content: 'Rain runs down the window. A phone lights his face.',
    },
    { type: 'character', content: 'BOY' },
    { type: 'parenthetical', content: '(quietly)' },
    { type: 'dialogue', content: 'Can we talk?' },
    { type: 'transition', content: 'CUT TO:' },
  ],
};
export function importTemplate(tab: ImportTab, p: Project) {
  const common = {
    schema: 'draft-it-import',
    version: 1,
    type: kinds[tab],
    instructions:
      'For the AI: return one valid JSON object with this exact schema, version and type. Replace example content with the requested writing. Keep field names and value types. No Markdown fences or commentary. Durations are seconds. Do not invent IDs. Save as .json and import in the matching tab. This instructions field may be removed.',
  };
  const story = {
    title: p.title,
    genre: 'Drama',
    logline: 'Write a one-sentence logline.',
    premise: 'Write the premise.',
    theme: 'Write the theme.',
    synopsis: 'Write the synopsis.',
    treatment: 'Write the treatment.',
    notes: '',
    references: '',
    targetRuntime: 60,
  };
  const characters = [
    {
      name: 'BOY',
      role: 'Lead',
      description: 'Reserved and thoughtful.',
      visualDescription: 'Teenage Indian boy, messy hair, worn hoodie, soft features lit by phone glow.',
      goals: 'Reconnect.',
      fear: 'Rejection.',
      backstory: '',
      arc: 'Learns to speak honestly.',
      notes: '',
    },
  ];
  const locations = [
    {
      name: "BOY'S BEDROOM",
      description: 'A small room with a rain-streaked window.',
      visualDescription: 'Cramped teenage bedroom, single bed, desk cluttered with books, blue-tinted rain light through window.',
      notes: '',
    },
  ];
  const panel = {
    sceneId: p.scenes[0]?.id ?? 'COPY_AN_EXISTING_SCENE_ID',
    size: 'CU',
    angle: 'Eye-level',
    lens: '50mm',
    movement: 'Slow push-in',
    duration: 3,
    description: 'The boy hesitates before deleting the message.',
    status: 'Planned',
    generatedPrompt: '',
    customPrompt: '',
    sourceContentHash: '',
    shotIntent: {
      panelNumber: '01A',
      shotSize: 'close_up',
      angle: 'eye_level',
      movement: 'push_in',
      purpose: 'reaction',
      description: 'The boy hesitates before deleting the message.',
      characterIds: [],
      lens: '50mm',
    },
  };
  const guide =
    ' Put each scene in scenes in screenplay order with a unique ref. heading starts INT., EXT. or INT./EXT. The app creates scene-heading blocks: do not repeat headings in blocks. Block types: action, character, parenthetical, dialogue, transition, shot, general. Character cues contain names. Do not put the screenplay in one string. Scenes append to existing scenes.';
  switch (tab) {
    case 'Story':
      return { ...common, story };
    case 'Screenplay':
      return {
        ...common,
        instructions: common.instructions + guide,
        scenes: [exampleScene],
      };
    case 'Scene cards':
      return {
        ...common,
        instructions: common.instructions + guide,
        scenes: [{ ...exampleScene, blocks: [] }],
      };
    case 'Characters':
      return {
        ...common,
        instructions:
          common.instructions + ' Matching names update only provided fields.',
        characters,
      };
    case 'Locations':
      return {
        ...common,
        instructions:
          common.instructions + ' Matching names update only provided fields.',
        locations,
      };
    case 'Storyboard':
    case 'Shot list':
      return {
        ...common,
        instructions:
          common.instructions +
          ' Use sceneId from sceneReference below. Panels append to both storyboard and shot list. Import a screenplay first if there are no scenes. Upload images in the app after import.' +
          ' shotIntent is optional structured shot metadata; generatedPrompt is the compiled image-generation prompt; customPrompt overrides generatedPrompt; sourceContentHash tracks scene changes.' +
          ' shotSize values: extreme_wide, wide, medium_wide, medium, medium_close, close_up, extreme_close_up, insert, over_shoulder, two_shot.' +
          ' angle values: eye_level, high, low, top_down, dutch. movement values: static, pan, tilt, push_in, pull_out, tracking, handheld.' +
          ' purpose values: establish, dialogue, reaction, action, insert, transition.',
        sceneReference: p.scenes.map((s, i) => ({
          sceneId: s.id,
          number: i + 1,
          heading: s.heading,
        })),
        panels: [panel],
      };
    case 'Export':
      return {
        ...common,
        instructions:
          common.instructions +
          guide +
          ' Creates a NEW project. For a series use kind series and episodes containing project objects with seasonNumber and episodeNumber. In project packages panels use sceneRef matching a scene ref, instead of sceneId.',
        project: {
          title: 'My film',
          kind: 'single',
          format: 'Short Film',
          story: { ...story, title: 'My film' },
          scenes: [exampleScene],
          characters,
          locations,
          panels: [{ ...panel, sceneId: undefined, sceneRef: 'scene-1' }],
        },
      };
  }
}
function storyPatch(x: unknown) {
  const o = obj(x, 'story');
  const patch: Partial<Project> = fields(o, storyKeys, 'story');
  if (o.title !== undefined) patch.title = name(o.title, 'story.title');
  if (o.targetRuntime !== undefined)
    patch.targetRuntime = num(o.targetRuntime, 'story.targetRuntime');
  return patch;
}
function scenesFrom(x: unknown): Scene[] {
  const refs = new Set<string>();
  return arr(x, 'scenes').map((v, i) => {
    const path = 'scenes[' + i + ']',
      o = obj(v, path),
      ref = name(o.ref, path + '.ref');
    if (refs.has(ref)) throw Error('Duplicate scene ref: ' + ref);
    refs.add(ref);
    if (
      o.colour !== undefined &&
      (typeof o.colour !== 'string' ||
        (o.colour !== '' && !/^#[0-9a-f]{6}$/i.test(o.colour)))
    )
      throw Error(
        path +
          '.colour must be a six-digit hex colour, such as #6689bd, or an empty string.',
      );
    const heading = name(o.heading, path + '.heading');
    if (!/^(INT\.|EXT\.|INT\.\/EXT\.)\s+/i.test(heading))
      throw Error(path + '.heading must begin INT., EXT. or INT./EXT.');
    const blocks = arr(o.blocks ?? [], path + '.blocks', 5000).flatMap((v, j) => {
      const b = obj(v, path + '.blocks[' + j + ']');
      const type = choice(
        b.type,
        path + '.blocks[' + j + '].type',
        elementTypes.filter((t) => t !== 'scene_heading'),
        'action',
      ) as Scene['blocks'][number]['type'];
      const raw = str(b.content, path + '.blocks[' + j + '].content');
      if (type === 'transition' && raw.includes('\n')) {
        const lines = raw.split(/\r?\n/).map((l) => l.trim()).filter(Boolean);
        if (!lines.length) return [{ id: uid(), type: 'transition' as const, content: '' }];
        return [
          { id: uid(), type: 'transition' as const, content: lines[0] },
          ...lines.slice(1).map((line) => ({ id: uid(), type: 'action' as const, content: line })),
        ];
      }
      if (type === 'character' && raw.includes('\n')) {
        const lines = raw.split(/\r?\n/).map((l) => l.trim()).filter(Boolean);
        if (!lines.length) return [{ id: uid(), type: 'character' as const, content: '' }];
        return [
          { id: uid(), type: 'character' as const, content: lines[0].toUpperCase() },
          ...lines.slice(1).map((line) => ({ id: uid(), type: 'dialogue' as const, content: line })),
        ];
      }
      let content = raw;
      if (type === 'character' || type === 'transition') {
        content = raw.trim();
      } else if (type === 'dialogue' || type === 'parenthetical') {
        content = raw.trimStart();
      }
      return [{
        id: uid(),
        type,
        content,
      }];
    });
    return {
      id: uid(),
      heading,
      act: o.act === undefined ? 'Act I' : name(o.act, path + '.act'),
      summary: o.summary === undefined ? '' : str(o.summary, path + '.summary'),
      colour: o.colour as string | undefined,
      emotion:
        o.emotion === undefined ? '' : str(o.emotion, path + '.emotion', 100),
      duration: num(o.duration, path + '.duration', 5),
      storyDay: num(o.storyDay, path + '.storyDay', 1),
      status: choice(
        o.status,
        path + '.status',
        ['outline', 'draft', 'revised', 'locked'],
        'draft',
      ),
      purpose: o.purpose === undefined ? '' : str(o.purpose, path + '.purpose'),
      notes: o.notes === undefined ? '' : str(o.notes, path + '.notes'),
      locationId: '',
      characterIds: [],
      blocks: [
        { id: uid(), type: 'scene_heading', content: heading },
        ...blocks,
      ],
    };
  });
}
function entities(
  p: Project,
  x: unknown,
  kind: 'characters' | 'locations',
): Project {
  const seen = new Set<string>();
  let result = p;
  for (const [i, v] of arr(x, kind).entries()) {
    const o = obj(v, kind + '[' + i + ']'),
      n = name(o.name, kind + '[' + i + '].name').toUpperCase();
    if (seen.has(n)) throw Error('Duplicate ' + kind + ' name: ' + n);
    seen.add(n);
    if (kind === 'characters') {
      const existing = result.characters.find(
        (c) => c.name.toUpperCase() === n,
      );
      const person: Person = {
        id: uid(),
        name: n,
        role: '',
        description: '',
        goals: '',
        fear: '',
        backstory: '',
        arc: '',
        notes: '',
        ...existing,
        ...fields(o, personKeys, kind + '[' + i + ']'),
        generated: false,
      };
      result = {
        ...result,
        characters: existing
          ? result.characters.map((c) => (c.id === existing.id ? person : c))
          : [...result.characters, person],
      };
    } else {
      const existing = result.locations.find((c) => c.name.toUpperCase() === n);
      const place: Place = {
        id: uid(),
        name: n,
        description: '',
        notes: '',
        ...existing,
        ...fields(o, ['description', 'visualDescription', 'notes'], kind + '[' + i + ']'),
        generated: false,
      };
      result = {
        ...result,
        locations: existing
          ? result.locations.map((c) => (c.id === existing.id ? place : c))
          : [...result.locations, place],
      };
    }
  }
  return result;
}
const shotSizes: readonly ShotSize[] = [
  'extreme_wide', 'wide', 'medium_wide', 'medium', 'medium_close',
  'close_up', 'extreme_close_up', 'insert', 'over_shoulder', 'two_shot',
] as const;
const cameraAngles: readonly CameraAngle[] = [
  'eye_level', 'high', 'low', 'top_down', 'dutch',
] as const;
const cameraMovements: readonly CameraMovement[] = [
  'static', 'pan', 'tilt', 'push_in', 'pull_out', 'tracking', 'handheld',
] as const;
const shotPurposes: readonly ShotPurpose[] = [
  'establish', 'dialogue', 'reaction', 'action', 'insert', 'transition',
] as const;

function parseShotIntent(
  o: Obj,
  path: string,
  sceneId: string,
): StoryboardShotIntent | undefined {
  if (o.shotIntent === undefined) return undefined;
  const si = obj(o.shotIntent, path + '.shotIntent');
  return {
    id: uid(),
    sceneId,
    panelNumber: si.panelNumber === undefined ? '' : str(si.panelNumber, path + '.shotIntent.panelNumber', 20),
    shotSize: choice(si.shotSize, path + '.shotIntent.shotSize', shotSizes, 'medium') as ShotSize,
    angle: choice(si.angle, path + '.shotIntent.angle', cameraAngles, 'eye_level') as CameraAngle,
    movement: choice(si.movement, path + '.shotIntent.movement', cameraMovements, 'static') as CameraMovement,
    purpose: choice(si.purpose, path + '.shotIntent.purpose', shotPurposes, 'action') as ShotPurpose,
    description: si.description === undefined ? '' : str(si.description, path + '.shotIntent.description'),
    characterIds: si.characterIds === undefined
      ? []
      : arr(si.characterIds, path + '.shotIntent.characterIds', 50).map(
          (v, j) => str(v, path + '.shotIntent.characterIds[' + j + ']', 200),
        ),
    locationId: si.locationId === undefined ? undefined : str(si.locationId, path + '.shotIntent.locationId', 200),
    propIds: si.propIds === undefined
      ? undefined
      : arr(si.propIds, path + '.shotIntent.propIds', 50).map(
          (v, j) => str(v, path + '.shotIntent.propIds[' + j + ']', 200),
        ),
    duration: si.duration === undefined ? undefined : num(si.duration, path + '.shotIntent.duration'),
    lens: si.lens === undefined ? undefined : str(si.lens, path + '.shotIntent.lens', 50),
  };
}

function panelsFrom(
  p: Project,
  x: unknown,
  refs?: Map<string, string>,
): Panel[] {
  return arr(x, 'panels', 3000).map((v, i) => {
    const path = 'panels[' + i + ']',
      o = obj(v, path);
    const sceneId = refs
      ? refs.get(name(o.sceneRef, path + '.sceneRef'))
      : name(o.sceneId, path + '.sceneId');
    if (!sceneId || !p.scenes.some((s) => s.id === sceneId))
      throw Error(
        path +
          ' references a scene outside this workspace. Download a fresh template.',
      );
    const image =
      o.image === undefined
        ? undefined
        : str(o.image, path + '.image', 12000000);
    if (
      image &&
      !/^data:image\/[a-z0-9.+-]+;base64,[A-Za-z0-9+/=]+$/i.test(image)
    )
      throw Error(path + '.image must be an embedded image, not a remote URL.');
    return {
      id: uid(),
      sceneId,
      size: o.size === undefined ? 'Wide' : name(o.size, path + '.size'),
      angle:
        o.angle === undefined ? 'Eye-level' : name(o.angle, path + '.angle'),
      lens: o.lens === undefined ? '35mm' : name(o.lens, path + '.lens'),
      movement:
        o.movement === undefined
          ? 'Static'
          : name(o.movement, path + '.movement'),
      duration: num(o.duration, path + '.duration', 3),
      description:
        o.description === undefined
          ? ''
          : str(o.description, path + '.description'),
      status: choice(
        o.status,
        path + '.status',
        ['Planned', 'Ready', 'Complete'],
        'Planned',
      ),
      image,
      shotIntent: parseShotIntent(o, path, sceneId),
      generatedPrompt:
        o.generatedPrompt === undefined
          ? undefined
          : str(o.generatedPrompt, path + '.generatedPrompt'),
      customPrompt:
        o.customPrompt === undefined
          ? undefined
          : str(o.customPrompt, path + '.customPrompt'),
      sourceContentHash:
        o.sourceContentHash === undefined
          ? undefined
          : str(o.sourceContentHash, path + '.sourceContentHash'),
    };
  });
}
function packageProject(value: unknown, depth = 0): Project {
  const o = obj(value, 'project');
  if (depth > 1) throw Error('Episodes cannot contain nested series.');
  const kind = choice(o.kind, 'project.kind', ['single', 'series'], 'single');
  if (kind === 'series') {
    if (depth) throw Error('Episodes cannot be series.');
    let p = createSeries(name(o.title, 'project.title'));
    if (o.story) p = { ...p, ...storyPatch(o.story) };
    const eps = arr(o.episodes, 'project.episodes', 500);

    const codes = new Set<string>();
    p.episodes = eps.map((v) => {
      const e = obj(v, 'episode');
      const ep = packageProject(e, depth + 1);
      const seasonNumber = num(e.seasonNumber, 'seasonNumber', 1),
        episodeNumber = num(e.episodeNumber, 'episodeNumber', 1);
      if (
        !Number.isInteger(seasonNumber) ||
        !Number.isInteger(episodeNumber) ||
        seasonNumber < 1 ||
        episodeNumber < 1
      )
        throw Error('Season and episode numbers must be positive integers.');
      const code = seasonNumber + ':' + episodeNumber;
      if (codes.has(code)) throw Error('Duplicate season/episode: ' + code);
      codes.add(code);
      return { ...ep, format: 'Episode', seasonNumber, episodeNumber };
    });
    return p;
  }
  let p = blankProject(
    name(o.title, 'project.title'),
    o.format === undefined ? 'Short Film' : name(o.format, 'project.format'),
  );
  if (p.kind === 'series')
    throw Error('Use kind series and episodes for series.');
  if (o.story) p = { ...p, ...storyPatch(o.story) };
  if (o.excludedCharacterNames)
    p.excludedCharacterNames = arr(
      o.excludedCharacterNames,
      'excludedCharacterNames',
    ).map((v) => name(v, 'character name'));
  if (o.excludedLocationNames)
    p.excludedLocationNames = arr(
      o.excludedLocationNames,
      'excludedLocationNames',
    ).map((v) => name(v, 'location name'));
  if (o.characters) p = entities(p, o.characters, 'characters');
  if (o.locations) p = entities(p, o.locations, 'locations');
  const source = arr(o.scenes ?? [], 'scenes');
  p.scenes = scenesFrom(source);
  p.acts = Array.from(
    new Set([
      ...(o.acts === undefined
        ? []
        : arr(o.acts, 'acts').map((v) => name(v, 'act'))),
      ...p.scenes.map((s) => s.act),
    ]),
  );
  if (!p.acts.length) p.acts = ['Act I', 'Act II', 'Act III'];
  p = reconcile(p);
  const refs = new Map(
    source.map((s, i) => [
      name(obj(s, 'scene').ref, 'scene.ref'),
      p.scenes[i].id,
    ]),
  );
  p.panels = panelsFrom(p, o.panels ?? [], refs);
  return p;
}
function backupPackage(value: unknown, depth = 0): Obj {
  const o = obj(value, 'backup');
  if (depth > 1) throw Error('Invalid nested backup.');
  if (o.kind === 'series')
    return {
      title: o.title,
      kind: 'series',
      story: o,
      episodes: arr(o.episodes, 'episodes', 500).map((e) =>
        backupPackage(e, depth + 1),
      ),
    };
  const scenes = arr(o.scenes, 'backup.scenes');
  const ids = new Set<string>();
  for (const s of scenes) {
    const id = name(obj(s, 'scene').id, 'scene.id');
    if (ids.has(id)) throw Error('Duplicate scene ID.');
    ids.add(id);
  }
  return {
    title: o.title,
    kind: 'single',
    format: o.format,
    acts: o.acts,
    excludedCharacterNames: o.excludedCharacterNames,
    excludedLocationNames: o.excludedLocationNames,
    seasonNumber: o.seasonNumber,
    episodeNumber: o.episodeNumber,
    story: o,
    characters: o.characters,
    locations: o.locations,
    scenes: scenes.map((v) => {
      const s = obj(v, 'scene');
      return {
        ...s,
        ref: s.id,
        blocks: arr(s.blocks, 'blocks', 5000).filter(
          (v) => obj(v, 'block').type !== 'scene_heading',
        ),
      };
    }),
    panels: arr(o.panels, 'backup.panels', 3000).map((v) => {
      const p = obj(v, 'panel');
      return {
        ...p,
        sceneRef: p.sceneId,
        shotIntent: p.shotIntent,
        generatedPrompt: p.generatedPrompt,
        customPrompt: p.customPrompt,
        sourceContentHash: p.sourceContentHash,
      };
    }),
  };
}
export type ImportPlan = {
  project: Project;
  newProject: boolean;
  summary: string;
  items: string[];
};
export function prepareImport(
  text: string,
  tab: ImportTab,
  p: Project,
): ImportPlan {
  let raw: unknown;
  try {
    raw = JSON.parse(text.replace(/^\uFEFF/, ''));
  } catch {
    throw Error(
      'Invalid JSON. Ask the AI to return only the JSON object, without Markdown fences or extra text.',
    );
  }
  const o = obj(raw, 'File');
  if (tab === 'Export' && o.schema === undefined) {
    const restored = packageProject(backupPackage(o));
    return {
      project: restored,
      newProject: true,
      summary: 'Restore as a new project. Existing projects will not change.',
      items: [restored.title, ...(restored.episodes ?? []).map((e) => e.title)],
    };
  }
  if (o.schema !== 'draft-it-import' || o.version !== 1)
    throw Error(
      'Use a Draft-it template with schema draft-it-import and version 1.',
    );
  if (o.type !== kinds[tab])
    throw Error(
      'This file is for ' +
        String(o.type) +
        ', not ' +
        tab +
        '. Open the matching tab.',
    );
  let next = p;
  let summary = '';
  let items: string[] = [];
  switch (tab) {
    case 'Story': {
      const patch = storyPatch(o.story);
      if (!Object.keys(patch).length) throw Error('No story fields to import.');
      next = { ...p, ...patch };
      summary =
        'Update only the listed story fields. Other fields stay as they are.';
      items = Object.entries(patch).map(([k, v]) => k + ': ' + String(v));
      break;
    }
    case 'Scene cards':
    case 'Screenplay': {
      const scenes = scenesFrom(o.scenes);
      if (!scenes.length) throw Error('Add at least one scene.');
      next = reconcile({
        ...p,
        scenes: [...p.scenes, ...scenes],
        acts: Array.from(new Set([...p.acts, ...scenes.map((s) => s.act)])),
      });
      summary =
        'Append ' +
        scenes.length +
        ' scenes after your existing ' +
        p.scenes.length +
        '. Existing scenes and linked shots are preserved.';
      items = scenes.map((s) => s.heading + ' — ' + s.summary);
      break;
    }
    case 'Characters':
    case 'Locations': {
      const key = tab === 'Characters' ? 'characters' : 'locations';
      if (!arr(o[key], key).length) throw Error('Add at least one entry.');
      next = entities(p, o[key], key);
      summary =
        'Add new names; update only provided fields for matching names.';
      items = arr(o[key], key).map((v) =>
        Object.entries(obj(v, key))
          .map(([k, v]) => k + ': ' + String(v))
          .join('\n'),
      );
      break;
    }
    case 'Storyboard':
    case 'Shot list': {
      const panels = panelsFrom(p, o.panels);
      if (!panels.length) throw Error('Add at least one panel.');
      next = { ...p, panels: [...p.panels, ...panels] };
      summary =
        'Append ' + panels.length + ' panels to both storyboard and shot list.';
      items = panels.map(
        (s) =>
          (p.scenes.find((x) => x.id === s.sceneId)?.heading ?? '') +
          ' · ' +
          s.size +
          ' · ' +
          s.duration +
          's — ' +
          s.description,
      );
      break;
    }
    case 'Export': {
      next = packageProject(o.project);
      summary =
        'Create a new ' +
        (next.kind === 'series' ? 'series' : 'project') +
        '. Existing projects will not change.';
      items = [next.title, ...(next.episodes ?? []).map((e) => e.title)];
      break;
    }
  }
  return { project: next, newProject: tab === 'Export', summary, items };
}
