import type { Project, Scene, ShotSize } from './project';

export const SCHEMA_VERSION = 2;
export type ProjectRole = 'owner' | 'editor' | 'commenter' | 'viewer';
export type FileReference = {
  id: string;
  name: string;
  path: string;
  mimeType: string;
  size: number;
};
export type Entity = {
  id: string;
  projectId: string;
  createdAt: string;
  updatedAt: string;
};
export type SourceLink = {
  sourceRevision: string;
  sourceUpdatedAt: string;
  lastReviewedAt?: string;
  sourceSnapshot?: string;
};
export type Availability = {
  date: string;
  status: 'available' | 'unavailable' | 'tentative';
  notes?: string;
};
export type VisualProfile = {
  ageAppearance: string;
  build: string;
  face: string;
  hair: string;
  defaultWardrobe: string;
  distinctiveFeatures: string;
  storyboardDescription: string;
};
export type CharacterProduction = Partial<Entity> & {
  normalizedName?: string;
  episodeIds?: string[];
  storyFunction?: string;
  characterAge?: string;
  personality?: string;
  fears?: string;
  relationships?: string;
  visualProfile?: Partial<VisualProfile>;
  defaultLookId?: string;
  sceneIds?: string[];
  storyDayAppearances?: number[];
  castMemberId?: string;
  productionNotes?: string;
  referenceImages?: FileReference[];
  createdFromScreenplay?: boolean;
  castingStatus?: 'uncast' | 'auditioning' | 'shortlisted' | 'cast';
  auditionStatus?: string;
  castingNotes?: string;
};
export type StoryLocationProduction = Partial<Entity> & {
  normalizedName?: string;
  interiorExterior?: string;
  storyRequirements?: string;
  sceneIds?: string[];
  storyDayUsage?: number[];
  shootingLocationId?: string;
  productionNotes?: string;
  referenceImages?: FileReference[];
  createdFromScreenplay?: boolean;
};
export type CastMember = Entity & {
  name: string;
  photoUrl?: string;
  phone: string;
  email: string;
  agency?: string;
  agentName?: string;
  agentPhone?: string;
  notes: string;
  rate?: number;
  rateUnit?: string;
  availability: Availability[];
  contractStatus: 'unknown' | 'pending' | 'signed' | 'completed';
  documents: FileReference[];
  emergencyContact?: string;
  assignedCharacterIds: string[];
};
export type ShootingLocation = Entity & {
  name: string;
  address: string;
  lat?: number;
  lng?: number;
  placeId?: string;
  contactName: string;
  contactPhone: string;
  contactEmail?: string;
  fee?: number;
  feeNotes?: string;
  availability: Availability[];
  permissionStatus:
    | 'unknown'
    | 'required'
    | 'requested'
    | 'approved'
    | 'rejected';
  parkingNotes?: string;
  powerNotes?: string;
  soundNotes?: string;
  equipmentAccessNotes?: string;
  restroomNotes?: string;
  greenRoomNotes?: string;
  restrictionNotes?: string;
  entranceNotes?: string;
  interiorNotes?: string;
  windowsNotes?: string;
  photos: FileReference[];
  videos: FileReference[];
  floorPlanFiles: FileReference[];
  recceNotes: string;
};
export const breakdownCategories = [
  'cast',
  'extras',
  'locations',
  'props',
  'wardrobe',
  'hair_makeup',
  'vehicles',
  'animals',
  'stunts',
  'practical_fx',
  'vfx',
  'sound',
  'music_playback',
  'special_equipment',
  'art_department',
  'set_dressing',
  'graphics',
  'production_notes',
  'safety_notes',
] as const;
export type BreakdownItem = Entity &
  SourceLink & {
    episodeId: string;
    sceneId: string;
    category: (typeof breakdownCategories)[number];
    name: string;
    description: string;
    quantity?: number;
    linkedAssetId?: string;
    linkedCharacterId?: string;
    linkedLocationId?: string;
    status: string;
    notes: string;
    source: 'manual' | 'screenplay' | 'later_agent';
    confirmed: boolean;
  };
export const assetTypes = [
  'prop',
  'wardrobe',
  'hair_makeup_reference',
  'set_piece',
  'set_dressing',
  'vehicle',
  'graphic',
  'equipment',
  'reference_image',
  'storyboard_reference',
  'document',
  'audio',
  'other',
] as const;
export type Asset = Entity & {
  type: (typeof assetTypes)[number];
  name: string;
  description: string;
  photos: FileReference[];
  files: FileReference[];
  linkedSceneIds: string[];
  linkedCharacterIds: string[];
  linkedLocationIds: string[];
  continuityNotes: string;
  ownership: 'owned' | 'rented' | 'borrowed' | 'unknown';
  status: string;
  estimatedCost: number;
  actualCost?: number;
  notes: string;
};
export type CharacterLook = Entity & {
  characterId: string;
  name: string;
  storyDay: number;
  description: string;
  wardrobeNotes: string;
  hairNotes: string;
  makeupNotes: string;
  referenceImages: FileReference[];
  linkedSceneIds: string[];
  continuityNotes: string;
};
export const shotSizes: ShotSize[] = [
  'extreme_wide',
  'wide',
  'medium_wide',
  'medium',
  'medium_close',
  'close_up',
  'extreme_close_up',
  'insert',
  'two_shot',
  'over_shoulder',
];
export type Shot = Entity &
  SourceLink & {
    sceneId: string;
    shotCode: string;
    title: string;
    description: string;
    purpose: string;
    subjectIds: string[];
    coveredScriptBlockIds: string[];
    shotSize: ShotSize;
    angle: string;
    composition: string;
    lens: string;
    focalLength?: number;
    cameraHeight?: number;
    movement: string;
    fps?: number;
    duration: number;
    lightingNotes: string;
    soundNotes: string;
    equipmentNotes: string;
    storyboardPanelId?: string;
    status: string;
    order: number;
  };
export type ShootDay = Entity &
  SourceLink & {
    date: string;
    number: number;
    shootingLocationIds: string[];
    scheduledSceneIds: string[];
    generalCallTime: string;
    estimatedWrapTime: string;
    notes: string;
    status: string;
  };
export type CallSheet = Entity &
  SourceLink & {
    shootDayId: string;
    productionContact: string;
    notes: string;
    castCallTimes: Record<string, string>;
  };
export type ContinuityRecord = Entity &
  SourceLink & {
    sceneId: string;
    characterId?: string;
    assetId?: string;
    storyDay: number;
    shootDayId?: string;
    characterLookId?: string;
    wardrobe: string;
    hair: string;
    makeup: string;
    propsState: string;
    objectState: string;
    injuriesDirtWetness: string;
    foodDrinkState: string;
    screenDirectionNotes: string;
    photos: FileReference[];
    previousSceneId?: string;
    nextSceneId?: string;
    notes: string;
  };
export const departments = [
  'Direction',
  'Camera',
  'Lighting',
  'Grip',
  'Art',
  'Costume',
  'Makeup',
  'Sound',
  'Production',
  'VFX',
  'Stunts',
  'Post',
  'Other',
] as const;
export type CrewMember = Entity & {
  name: string;
  department: (typeof departments)[number];
  role: string;
  phone: string;
  email: string;
  availability: Availability[];
  notes: string;
};
export const budgetCategories = [
  'Cast',
  'Crew',
  'Camera',
  'Lighting',
  'Grip',
  'Locations',
  'Art',
  'Props',
  'Costume',
  'Makeup',
  'Transport',
  'Food',
  'Equipment',
  'VFX',
  'Post',
  'Miscellaneous',
] as const;
export type BudgetLine = Entity & {
  name: string;
  category: (typeof budgetCategories)[number];
  estimated: number;
  actual: number;
  assetId?: string;
  castMemberId?: string;
  shootingLocationId?: string;
  shootDayId?: string;
};
export type ProductionDocument = Entity & {
  name: string;
  type: string;
  files: FileReference[];
  notes: string;
  sceneId?: string;
  castMemberId?: string;
  shootingLocationId?: string;
  shootDayId?: string;
};
export type ProductionData = {
  castMembers: CastMember[];
  shootingLocations: ShootingLocation[];
  breakdownItems: BreakdownItem[];
  assets: Asset[];
  shots: Shot[];
  characterLooks: CharacterLook[];
  shootDays: ShootDay[];
  callSheets: CallSheet[];
  continuityRecords: ContinuityRecord[];
  crewMembers: CrewMember[];
  documents: ProductionDocument[];
  budget: BudgetLine[];
};
export const productionKeys = [
  'castMembers',
  'shootingLocations',
  'breakdownItems',
  'assets',
  'shots',
  'characterLooks',
  'shootDays',
  'callSheets',
  'continuityRecords',
  'crewMembers',
  'documents',
  'budget',
] as const;
export function productionData(p: Project): ProductionData {
  return Object.fromEntries(
    productionKeys.map((k) => [k, p[k] ?? []]),
  ) as ProductionData;
}
export function entity(projectId: string): Entity {
  const now = new Date().toISOString();
  return { id: crypto.randomUUID(), projectId, createdAt: now, updatedAt: now };
}
// Stable content fingerprint. Scene order is deliberately excluded.
export function fingerprint(text: string): string {
  let a = 2166136261,
    b = 5381;
  for (let i = 0; i < text.length; i++) {
    a = Math.imul(a ^ text.charCodeAt(i), 16777619);
    b = Math.imul(b, 33) ^ text.charCodeAt(i);
  }
  return `${text.length.toString(16)}-${(a >>> 0).toString(16)}-${(b >>> 0).toString(16)}`;
}
export function shotRevision(shot: Shot): string {
  const design = Object.fromEntries(
    Object.entries(shot).filter(
      ([key]) =>
        ![
          'sourceRevision',
          'sourceSnapshot',
          'sourceUpdatedAt',
          'lastReviewedAt',
          'updatedAt',
          'createdAt',
          'projectId',
        ].includes(key),
    ),
  );
  return fingerprint(JSON.stringify(design));
}
export function sceneRevision(scene?: Scene): string {
  return scene
    ? JSON.stringify({
        id: scene.id,
        blocks: scene.blocks,
        storyDay: scene.storyDay,
        locationId: scene.locationId,
        characterIds: scene.characterIds,
        duration: scene.duration,
      })
    : 'missing';
}
export function sourceLink(p: Project, ids: string[]): SourceLink {
  const snapshot = JSON.stringify(
    ids.map((id) => ({
      id,
      scene: JSON.parse(
        sceneRevision(p.scenes.find((s) => s.id === id)) === 'missing'
          ? 'null'
          : sceneRevision(p.scenes.find((s) => s.id === id)),
      ),
    })),
  );
  return {
    sourceRevision: fingerprint(snapshot),
    sourceSnapshot: snapshot,
    sourceUpdatedAt: p.updatedAt,
  };
}
export function needsReview(
  p: Project,
  record: SourceLink,
  sceneIds: string[],
): boolean {
  return record.sourceRevision !== sourceLink(p, sceneIds).sourceRevision;
}
export function reviewSource<T extends SourceLink>(
  p: Project,
  record: T,
  ids: string[],
): T {
  return {
    ...record,
    ...sourceLink(p, ids),
    lastReviewedAt: new Date().toISOString(),
  };
}
export function createShot(p: Project, sceneId: string): Shot {
  const shots = p.shots ?? [];
  const sceneNumber = p.scenes.findIndex((s) => s.id === sceneId) + 1;
  let index = shots.filter((s) => s.sceneId === sceneId).length;
  let shotCode: string;
  do {
    let n = index++;
    let suffix = '';
    do {
      suffix = String.fromCharCode(65 + (n % 26)) + suffix;
      n = Math.floor(n / 26) - 1;
    } while (n >= 0);
    shotCode = `${sceneNumber}${suffix}`;
  } while (shots.some((s) => s.shotCode === shotCode));
  return {
    ...entity(p.id),
    ...sourceLink(p, [sceneId]),
    sceneId,
    shotCode,
    title: '',
    description: '',
    purpose: '',
    subjectIds: [],
    coveredScriptBlockIds: [],
    shotSize: 'wide',
    angle: 'eye_level',
    composition: '',
    lens: '',
    movement: 'static',
    duration: 0,
    lightingNotes: '',
    soundNotes: '',
    equipmentNotes: '',
    status: 'planned',
    order: Math.max(-1, ...shots.map((s) => s.order)) + 1,
  };
}
export function coverage(p: Project, sceneId: string) {
  return (p.scenes.find((s) => s.id === sceneId)?.blocks ?? [])
    .filter((b) => ['action', 'dialogue'].includes(b.type))
    .map((block) => ({
      block,
      shots: (p.shots ?? []).filter(
        (s) =>
          s.sceneId === sceneId && s.coveredScriptBlockIds.includes(block.id),
      ),
    }));
}
export function assignScene(
  p: Project,
  sceneId: string,
  dayId: string,
): Project {
  if (
    !p.scenes.some((s) => s.id === sceneId) ||
    (dayId && !p.shootDays?.some((d) => d.id === dayId))
  )
    return p;
  return {
    ...p,
    shootDays: (p.shootDays ?? []).map((d) => {
      const scheduledSceneIds = d.scheduledSceneIds.filter(
        (id) => id !== sceneId,
      );
      if (d.id === dayId) scheduledSceneIds.push(sceneId);
      return { ...d, scheduledSceneIds }; // Existing review baseline remains until explicitly reviewed.
    }),
  };
}
export function callSheetData(p: Project, day: ShootDay) {
  const scenes = day.scheduledSceneIds
    .map((id) => p.scenes.find((s) => s.id === id))
    .filter((s): s is Scene => !!s);
  const characters = p.characters.filter((c) =>
    scenes.some((s) => s.characterIds.includes(c.id)),
  );
  const cast = (p.castMembers ?? []).filter((c) =>
    characters.some((ch) => ch.castMemberId === c.id),
  );
  const locationIds = new Set([
    ...day.shootingLocationIds,
    ...p.locations
      .filter((l) => scenes.some((s) => s.locationId === l.id))
      .map((l) => l.shootingLocationId),
  ]);
  return {
    scenes,
    characters,
    cast,
    locations: (p.shootingLocations ?? []).filter((l) => locationIds.has(l.id)),
    requirements: (p.breakdownItems ?? []).filter((i) =>
      scenes.some(s=>s.id===i.sceneId),
    ),
  };
}
export function callSheetRevision(p: Project, day: ShootDay): string {
  return fingerprint(callSheetSnapshot(p, day));
}
export function callSheetSnapshot(p: Project, day: ShootDay): string {
  const plan = Object.fromEntries(
    Object.entries(day).filter(
      ([key]) =>
        ![
          'sourceRevision',
          'sourceSnapshot',
          'sourceUpdatedAt',
          'lastReviewedAt',
        ].includes(key),
    ),
  );
  const data = callSheetData(p, day);
  return JSON.stringify({
    title: p.title,
    day: plan,
    ...data,
    assets: (p.assets ?? []).filter((a) =>
      data.requirements.some((i) => i.linkedAssetId === a.id),
    ),
  });
}
export function formatSourceSnapshot(snapshot?: string): string {
  if (!snapshot) return 'No saved source available.';
  try {
    const value = JSON.parse(snapshot);
    const scenes = Array.isArray(value)
      ? value.map((v) => v.scene)
      : value.scenes;
    if (!Array.isArray(scenes)) return 'Saved source unavailable.';
    const header = Array.isArray(value)
      ? ''
      : `${value.title} · ${value.day.date} · Shoot day ${value.day.number}\nCall ${value.day.generalCallTime} · Wrap ${value.day.estimatedWrapTime}\n${(value.locations ?? []).map((l: ShootingLocation) => `${l.name}: ${l.address}`).join('\n')}\n${(value.cast ?? []).map((c: CastMember) => c.name).join(', ')}\n\n`;
    return (
      header +
      scenes
        .map((scene) =>
          scene
            ? `Story day ${scene.storyDay}\n${scene.blocks.map((b: { content: string }) => b.content).join('\n')}`
            : 'Scene removed',
        )
        .join('\n\n')
    );
  } catch {
    return 'This source predates readable review history. Review the current screenplay before acknowledging.';
  }
}
export function extractBreakdown(p: Project, scene: Scene): Project {
  const items = [...(p.breakdownItems ?? [])];
  for (const [category, id, name] of [
    ...scene.characterIds.map(
      (id) =>
        [
          'cast',
          id,
          p.characters.find((c) => c.id === id)?.name ?? '',
        ] as const,
    ),
    ...(scene.locationId
      ? [
          [
            'locations',
            scene.locationId,
            p.locations.find((l) => l.id === scene.locationId)?.name ?? '',
          ] as const,
        ]
      : []),
  ]) {
    if (
      items.some(
        (i) =>
          i.sceneId === scene.id &&
          (i.linkedCharacterId === id || i.linkedLocationId === id),
      )
    )
      continue;
    items.push({
      ...entity(p.id),
      ...sourceLink(p, [scene.id]),
      episodeId: p.id,
      sceneId: scene.id,
      category,
      name,
      description: '',
      status: 'needed',
      notes: '',
      source: 'screenplay',
      confirmed: false,
      ...(category === 'cast'
        ? { linkedCharacterId: id }
        : { linkedLocationId: id }),
    });
  }
  return { ...p, breakdownItems: items };
}
// Additive migration: legacy names are canonical to keep existing writing and backup integrations intact.
export function migrateProjectSnapshot(snapshot: Project): Project {
  if ((snapshot.schemaVersion ?? 1) > SCHEMA_VERSION)
    throw Error(
      'This project uses a newer Draft-it schema. Update the app before opening it.',
    );
  validateProductionSnapshot(snapshot);
  const p: Project = {
    ...snapshot,
    schemaVersion: SCHEMA_VERSION,
    ...productionData(snapshot),
  };
  if (p.episodes) p.episodes = p.episodes.map(migrateProjectSnapshot);
  // Stable IDs make retrying migration safe. Existing panel edits and images are preserved.
  p.panels = p.panels.map((panel) => {
    if (panel.shotId) return panel;
    const id = `legacy-shot-${panel.id}`;
    if (!p.shots!.some((s) => s.id === id)) {
      p.shots = [
        ...p.shots!,
        {
          ...createShot(p, panel.sceneId),
          id,
          description: panel.description,
          lens: panel.lens,
          movement: panel.movement,
          angle: panel.angle,
          duration: panel.duration,
          shotSize:
            panel.shotIntent?.shotSize ??
            (
              {
                cu: 'close_up',
                ecu: 'extreme_close_up',
                wide: 'wide',
                medium: 'medium',
                ms: 'medium',
                ws: 'wide',
                mcu: 'medium_close',
                insert: 'insert',
              } as Record<string, ShotSize>
            )[panel.size.toLowerCase()] ??
            'wide',
          subjectIds: panel.shotIntent?.characterIds ?? [],
          storyboardPanelId: panel.id,
        },
      ];
    }
    const shot = p.shots!.find((s) => s.id === id)!;
    return {
      ...panel,
      shotId: id,
      shotRevision: shotRevision(shot),
      ...sourceLink(p, [panel.sceneId]),
    };
  });
  return p;
}

/** Validate snapshot boundaries before migrations or import. Missing source references are allowed: deleted scenes need review. */
export function validateProductionSnapshot(p: Project) {
  if (
    p.schemaVersion !== undefined &&
    (!Number.isInteger(p.schemaVersion) ||
      p.schemaVersion < 1 ||
      p.schemaVersion > SCHEMA_VERSION)
  )
    throw Error('Unsupported project schema version.');
  for (const key of productionKeys) {
    const records = p[key];
    if (records === undefined) continue;
    if (!Array.isArray(records))
      throw Error(`Invalid project ${key}: expected records.`);
    const ids = new Set<string>();
    for (const record of records) {
      if (
        !record ||
        typeof record !== 'object' ||
        typeof record.id !== 'string' ||
        !record.id ||
        ids.has(record.id) ||
        record.projectId !== p.id
      )
        throw Error(`Invalid or out-of-scope ${key} record.`);
      ids.add(record.id);
      const arrayFields: Record<string, string[]> = {
        castMembers: ['availability', 'documents', 'assignedCharacterIds'],
        shootingLocations: [
          'availability',
          'photos',
          'videos',
          'floorPlanFiles',
        ],
        assets: [
          'photos',
          'files',
          'linkedSceneIds',
          'linkedCharacterIds',
          'linkedLocationIds',
        ],
        shots: ['subjectIds', 'coveredScriptBlockIds'],
        characterLooks: ['referenceImages', 'linkedSceneIds'],
        shootDays: ['shootingLocationIds', 'scheduledSceneIds'],
        continuityRecords: ['photos'],
        crewMembers: ['availability'],
        documents: ['files'],
      };
      const r = record as unknown as Record<string, unknown>;
      for (const field of arrayFields[key] ?? [])
        if (!Array.isArray(r[field])) throw Error(`Invalid ${key}.${field}.`);
      for (const field of [
        'sceneId',
        'sourceRevision',
        'sourceUpdatedAt',
      ].filter(() =>
        ['breakdownItems', 'shots', 'continuityRecords'].includes(key),
      ))
        if (typeof r[field] !== 'string')
          throw Error(`Invalid ${key}.${field}.`);
      for (const field of ['createdAt', 'updatedAt'])
        if (typeof r[field] !== 'string')
          throw Error(`Invalid ${key}.${field}.`);
      for (const field of [
        'duration',
        'order',
        'storyDay',
        'estimated',
        'actual',
        'estimatedCost',
        'actualCost',
        'number',
        'lat',
        'lng',
        'rate',
        'fee',
        'quantity',
      ])
        if (
          r[field] !== undefined &&
          (typeof r[field] !== 'number' || !Number.isFinite(r[field]))
        )
          throw Error(`Invalid ${key}.${field}.`);
      for (const field of [
        'name',
        'description',
        'notes',
        'phone',
        'email',
        'address',
        'shotCode',
        'lens',
        'movement',
        'status',
        'date',
        'wardrobe',
        'hair',
        'makeup',
        'propsState',
      ])
        if (r[field] !== undefined && typeof r[field] !== 'string')
          throw Error(`Invalid ${key}.${field}.`);
      for (const field of [
        'photos',
        'files',
        'documents',
        'referenceImages',
        'videos',
        'floorPlanFiles',
      ]) {
        if (!Array.isArray(r[field])) continue;
        for (const file of r[field])
          if (
            !file ||
            typeof file.id !== 'string' ||
            typeof file.path !== 'string' ||
            !/^users\/[^/]+\/projects\/[^/]+\/files\/[^/]+$/.test(file.path) ||
            typeof file.name !== 'string' ||
            typeof file.mimeType !== 'string' ||
            !Number.isFinite(file.size)
          )
            throw Error('Invalid production file reference.');
      }
      for (const field of [
        'sceneIds',
        'linkedSceneIds',
        'linkedCharacterIds',
        'linkedLocationIds',
        'subjectIds',
        'coveredScriptBlockIds',
        'scheduledSceneIds',
        'shootingLocationIds',
        'assignedCharacterIds',
      ])
        if (
          Array.isArray(r[field]) &&
          (r[field] as unknown[]).some((id) => typeof id !== 'string')
        )
          throw Error(`Invalid ${key}.${field} reference.`);
      if (
        key === 'callSheets' &&
        (!r.castCallTimes ||
          typeof r.castCallTimes !== 'object' ||
          Array.isArray(r.castCallTimes) ||
          Object.values(r.castCallTimes).some((v) => typeof v !== 'string'))
      )
        throw Error('Invalid cast call times.');
      if (
        Array.isArray(r.availability) &&
        r.availability.some(
          (a) =>
            !a ||
            typeof a.date !== 'string' ||
            !['available', 'unavailable', 'tentative'].includes(a.status),
        )
      )
        throw Error('Invalid availability.');
    }
  }
}

export type FileCopy = {
  sourcePath: string;
  targetPath: string;
  mimeType: string;
};
function visitFiles(value: unknown, fn: (file: FileReference) => void) {
  if (!value || typeof value !== 'object') return;
  if ('path' in value && 'mimeType' in value && 'size' in value) {
    fn(value as FileReference);
    return;
  }
  for (const child of Object.values(value)) visitFiles(child, fn);
}
/** Immutable copy: internal entity IDs are document-scoped and remain stable. */
export function copyProjectSnapshot(p: Project): Project {
  const copy = structuredClone(p);
  const scopes = new Map<string, string>();
  const allocate = (part: Project) => {
    scopes.set(part.id, crypto.randomUUID());
    for (const e of part.episodes ?? []) allocate(e);
  };
  allocate(copy);
  const rootId = scopes.get(p.id)!;
  const rebaseValue = (value: unknown): unknown => {
    if (typeof value === 'string') {
      if (scopes.has(value)) return scopes.get(value)!;
      if (/^users\/[^/]+\/projects\/[^/]+\/files\/[^/]+$/.test(value))
        return value.replace(/(\/projects\/)[^/]+/, `$1${rootId}`);
      return value;
    }
    if (Array.isArray(value)) return value.map(rebaseValue);
    if (!value || typeof value !== 'object') return value;
    return Object.fromEntries(
      Object.entries(value).map(([key, v]) => [
        key,
        key === 'sourceSnapshot' && typeof v === 'string'
          ? rebaseSnapshot(v)
          : rebaseValue(v),
      ]),
    );
  };
  const rebaseSnapshot = (text: string): string => {
    try {
      return JSON.stringify(rebaseValue(JSON.parse(text)));
    } catch {
      return text;
    }
  };
  const rebased = rebaseValue(copy) as Project;
  // A saved call-sheet plan contains production scope IDs. Update its fingerprint only
  // when it was current, so an already-stale plan cannot accidentally become reviewed.
  const preserveReviews = (original: Project, next: Project) => {
    next.callSheets = (next.callSheets ?? []).map((sheet) => {
      const old = original.callSheets?.find((c) => c.id === sheet.id),
        oldDay = original.shootDays?.find((d) => d.id === old?.shootDayId),
        day = next.shootDays?.find((d) => d.id === sheet.shootDayId);
      return old &&
        oldDay &&
        day &&
        old.sourceRevision === callSheetRevision(original, oldDay)
        ? {
            ...sheet,
            sourceRevision: callSheetRevision(next, day),
            sourceSnapshot: callSheetSnapshot(next, day),
          }
        : sheet;
    });
    (original.episodes ?? []).forEach((e, i) =>
      preserveReviews(e, next.episodes![i]),
    );
  };
  preserveReviews(p, rebased);
  return rebased;
}
/** File transfer intent lives outside the saved copy. Never leave source-project paths in a copied snapshot. */
export function projectFileCopies(source: Project, copy: Project): FileCopy[] {
  const original: FileReference[] = [];
  const cloned: FileReference[] = [];
  visitFiles(source, (f) => original.push(f));
  visitFiles(copy, (f) => cloned.push(f));
  return [
    ...new Map(
      original.map((f, i) => [
        cloned[i].path,
        {
          sourcePath: f.path,
          targetPath: cloned[i].path,
          mimeType: f.mimeType,
        },
      ]),
    ).values(),
  ].filter((f) => f.sourcePath !== f.targetPath);
}

/** Reference-safe entity removal for production records. */
export function deleteProductionEntity(
  p: Project,
  key: keyof ProductionData,
  id: string,
): Project {
  if (key === 'castMembers') {
    return {
      ...p,
      castMembers: (p.castMembers ?? []).filter((c) => c.id !== id),
      characters: (p.characters ?? []).map((ch) =>
        ch.castMemberId === id
          ? { ...ch, castMemberId: '', castingStatus: 'uncast' }
          : ch,
      ),
      budget: (p.budget ?? []).map((b) =>
        b.castMemberId === id ? { ...b, castMemberId: '' } : b,
      ),
      documents: (p.documents ?? []).map((d) =>
        d.castMemberId === id ? { ...d, castMemberId: '' } : d,
      ),
    };
  }
  if (key === 'shootingLocations') {
    return {
      ...p,
      shootingLocations: (p.shootingLocations ?? []).filter((l) => l.id !== id),
      locations: (p.locations ?? []).map((l) =>
        l.shootingLocationId === id ? { ...l, shootingLocationId: '' } : l,
      ),
      shootDays: (p.shootDays ?? []).map((d) => ({
        ...d,
        shootingLocationIds: (d.shootingLocationIds ?? []).filter(
          (x) => x !== id,
        ),
      })),
      budget: (p.budget ?? []).map((b) =>
        b.shootingLocationId === id ? { ...b, shootingLocationId: '' } : b,
      ),
      documents: (p.documents ?? []).map((d) =>
        d.shootingLocationId === id ? { ...d, shootingLocationId: '' } : d,
      ),
    };
  }
  if (key === 'assets') {
    return {
      ...p,
      assets: (p.assets ?? []).filter((a) => a.id !== id),
      breakdownItems: (p.breakdownItems ?? []).map((i) =>
        i.linkedAssetId === id ? { ...i, linkedAssetId: '' } : i,
      ),
      budget: (p.budget ?? []).map((b) =>
        b.assetId === id ? { ...b, assetId: '' } : b,
      ),
    };
  }
  if (key === 'shootDays') {
    return {
      ...p,
      shootDays: (p.shootDays ?? []).filter((d) => d.id !== id),
      callSheets: (p.callSheets ?? []).filter((c) => c.shootDayId !== id),
      documents: (p.documents ?? []).map((doc) =>
        doc.shootDayId === id ? { ...doc, shootDayId: '' } : doc,
      ),
      budget: (p.budget ?? []).map((b) =>
        b.shootDayId === id ? { ...b, shootDayId: '' } : b,
      ),
    };
  }
  if (key === 'characterLooks') {
    return {
      ...p,
      characterLooks: (p.characterLooks ?? []).filter((l) => l.id !== id),
      continuityRecords: (p.continuityRecords ?? []).map((c) =>
        c.characterLookId === id ? { ...c, characterLookId: '' } : c,
      ),
    };
  }
  if (key === 'continuityRecords') {
    return {
      ...p,
      continuityRecords: (p.continuityRecords ?? []).filter((c) => c.id !== id),
    };
  }
  if (key === 'crewMembers') {
    return {
      ...p,
      crewMembers: (p.crewMembers ?? []).filter((c) => c.id !== id),
    };
  }
  if (key === 'documents') {
    return {
      ...p,
      documents: (p.documents ?? []).filter((d) => d.id !== id),
    };
  }
  if (key === 'budget') {
    return {
      ...p,
      budget: (p.budget ?? []).filter((b) => b.id !== id),
    };
  }
  if (key === 'shots') {
    return {
      ...p,
      shots: (p.shots ?? []).filter((s) => s.id !== id),
      panels: (p.panels ?? []).map((panel) =>
        panel.shotId === id ? { ...panel, shotId: undefined } : panel,
      ),
    };
  }
  if (key === 'breakdownItems') {
    return {
      ...p,
      breakdownItems: (p.breakdownItems ?? []).filter((i) => i.id !== id),
    };
  }
  return p;
}
