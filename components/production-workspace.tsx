'use client';
import { useState, type ReactNode } from 'react';
import {
  WorkspaceTabs,
  InspectorPanel,
  InspectorSection as Section,
  StatusBadge,
  EmptyState,
  CollapsibleSection,
  RecordWorkspace,
  CompactField as Field,
  EntityPicker as Multi,
} from '@/components/production/workspace-ui';
import { SceneQuarantine } from '@/components/production/scene-quarantine';
import Image from 'next/image';
import { Button } from '@/components/ui/button';
import {
  NativeSelect,
  NativeSelectOption,
} from '@/components/ui/native-select';
import type {
  Project,
  Person,
  Place,
  Panel,
  StoryboardShotIntent,
} from '@/lib/project';
import { parseSceneHeading } from '@/lib/project';
import {
  assetTypes,
  breakdownCategories,
  budgetCategories,
  departments,
  shotSizes,
  productionData,
  entity,
  sourceLink,
  needsReview,
  reviewSource,
  createShot,
  coverage,
  extractBreakdown,
  assignScene,
  callSheetData,
  callSheetRevision,
  callSheetSnapshot,
  shotRevision,
  formatSourceSnapshot,
  type SourceLink,
  type ProductionData,
  type FileReference,
  type Shot,
  type ShootDay,
  type CallSheet,
  type Availability,
  deleteProductionEntity,
} from '@/lib/production';
import { buildStoryboardPrompt } from '@/lib/prompt-compiler';
import { mapProvider, validCoordinates } from '@/lib/map-service';
import {
  uploadProductionFile,
  openProductionFile,
} from '@/lib/production-files';

export const workspaceGroups = [
  {
    name: 'Development',
    views: ['Overview', 'Story', 'Scene cards', 'Characters'],
  },
  { name: 'Writing', views: ['Screenplay'] },
  {
    name: 'Visual planning',
    views: ['Shot Designer', 'Storyboard', 'Shot list'],
  },
  {
    name: 'Production',
    views: ['Breakdown', 'Locations', 'Cast & Crew', 'Assets', 'Schedule'],
  },
  { name: 'Shoot', views: ['Stripboard', 'Call Sheets', 'Continuity'] },
  { name: 'Project', views: ['Documents', 'Export'] },
];
export const productionViews = [
  'Characters',
  'Locations',
  'Cast & Crew',
  'Breakdown',
  'Assets',
  'Shot Designer',
  'Storyboard',
  'Shot list',
  'Schedule',
  'Stripboard',
  'Call Sheets',
  'Continuity',
  'Documents',
];
const label = (s: string) =>
  s
    .replace(/_/g, ' ')
    .replace(/([a-z])([A-Z])/g, '$1 $2')
    .replace(/^./, (c) => c.toUpperCase());
type Option = { id: string; name: string };
function Select({
  title,
  value,
  options,
  onChange,
  empty = 'None',
}: {
  title: string;
  value?: string;
  options: readonly string[] | Option[];
  onChange: (v: string) => void;
  empty?: string;
}) {
  return (
    <label className="prod-field">
      <span>{title}</span>
      <NativeSelect
        value={value ?? ''}
        onChange={(e) => onChange(e.target.value)}
      >
        <NativeSelectOption value="">{empty}</NativeSelectOption>
        {options.map((o) =>
          typeof o === 'string' ? (
            <NativeSelectOption key={o} value={o}>
              {label(o)}
            </NativeSelectOption>
          ) : (
            <NativeSelectOption key={o.id} value={o.id}>
              {o.name}
            </NativeSelectOption>
          ),
        )}
      </NativeSelect>
    </label>
  );
}
function Fields<T extends object>({
  record,
  fields,
  onChange,
}: {
  record: T;
  fields: string[];
  onChange: (patch: Partial<T>) => void;
}) {
  return (
    <div className="prod-fields">
      {fields.map((key) => (
        <Field
          key={key}
          title={label(key)}
          value={String((record as Record<string, unknown>)[key] ?? '')}
          onChange={(v) => onChange({ [key]: v } as Partial<T>)}
          multiline={/notes|description|requirements|arc|relationships|goals|fears|state/i.test(
            key,
          )}
        />
      ))}
    </div>
  );
}
function Card({
  title,
  children,
  action,
}: {
  title: string;
  children: ReactNode;
  action?: ReactNode;
}) {
  return (
    <section className="prod-card">
      <div className="prod-card-heading">
        <h3>{title}</h3>
        {action}
      </div>
      {children}
    </section>
  );
}
function AvailabilityEditor({
  values,
  onChange,
}: {
  values: Availability[];
  onChange: (v: Availability[]) => void;
}) {
  return (
    <details>
      <summary>Availability · {values.length} dates</summary>
      {values.map((v, i) => (
        <div className="prod-fields" key={i}>
          <Field
            title="Date"
            type="date"
            value={v.date}
            onChange={(date) =>
              onChange(values.map((x, j) => (i === j ? { ...x, date } : x)))
            }
          />
          <Select
            title="Availability"
            value={v.status}
            options={['available', 'unavailable', 'tentative']}
            onChange={(status) =>
              onChange(
                values.map((x, j) =>
                  i === j
                    ? { ...x, status: status as Availability['status'] }
                    : x,
                ),
              )
            }
          />
          <Button
            variant="ghost"
            onClick={() => onChange(values.filter((_, j) => i !== j))}
          >
            Remove date
          </Button>
        </div>
      ))}
      <Button
        variant="outline"
        onClick={() => onChange([...values, { date: '', status: 'tentative' }])}
      >
        Add availability
      </Button>
    </details>
  );
}
function SourceReview({
  p,
  record,
  ids,
  onReview,
  refresh,
}: {
  p: Project;
  record: SourceLink;
  ids: string[];
  onReview: () => void;
  refresh?: () => void;
}) {
  const [open, setOpen] = useState(false);
  const stale = needsReview(p, record, ids);
  return (
    <div className={stale ? 'prod-review stale' : 'prod-review'}>
      {stale ? (
        <>
          <strong>Source changed · Review required</strong>
          <Button variant="ghost" onClick={() => setOpen(!open)}>
            Review changes
          </Button>
          {open && (
            <div className="prod-source-diff">
              <p>Saved source</p>
              <pre>{formatSourceSnapshot(record.sourceSnapshot)}</pre>
              <p>Current screenplay</p>
              <pre>
                {formatSourceSnapshot(sourceLink(p, ids).sourceSnapshot)}
              </pre>
              <Button onClick={onReview}>Keep manual version</Button>
              {refresh && (
                <Button variant="outline" onClick={refresh}>
                  Refresh generated metadata
                </Button>
              )}
            </div>
          )}
        </>
      ) : (
        <span>
          Linked to current screenplay
          {record.lastReviewedAt ? ' · Reviewed' : ''}
        </span>
      )}
    </div>
  );
}
function Files({
  values,
  onChange,
  userId,
  rootId,
  camera = false,
}: {
  values: FileReference[];
  onChange: (v: FileReference[]) => void;
  userId?: string;
  rootId: string;
  camera?: boolean;
}) {
  const [busy, setBusy] = useState(false),
    [error, setError] = useState('');
  return (
    <div className="prod-files">
      {values.map((f) => (
        <Button
          key={f.id}
          variant="outline"
          onClick={() =>
            userId &&
            void openProductionFile(userId, rootId, f).catch((e) =>
              setError(e.message),
            )
          }
        >
          {f.name}
        </Button>
      ))}
      <label className="prod-upload">
        {busy ? 'Uploading…' : camera ? 'Take or upload photo' : 'Upload file'}
        <input
          disabled={busy || !userId}
          type="file"
          accept={
            camera
              ? 'image/*'
              : 'image/*,video/mp4,video/quicktime,video/webm,audio/*,application/pdf,text/plain'
          }
          capture={camera ? 'environment' : undefined}
          onChange={async (e) => {
            const file = e.target.files?.[0];
            if (!file || !userId) return;
            setBusy(true);
            setError('');
            try {
              const f = await uploadProductionFile(userId, rootId, file);
              onChange([...values, f]);
            } catch (e) {
              setError((e as Error).message);
            } finally {
              setBusy(false);
            }
          }}
        />
      </label>
      {!userId && <p>Sign in to upload production files.</p>}
      {error && <p role="alert">{error}</p>}
    </div>
  );
}
export function ProductionWorkspace({
  project: p,
  view,
  onUpdate,
  userId,
  rootId,
  onScene,
}: {
  project: Project;
  view: string;
  onUpdate: (fn: (p: Project) => Project) => void;
  userId?: string;
  rootId: string;
  onScene: (id: string) => void;
}) {
  const data = productionData(p);
  const [sceneId, setSceneId] = useState(''),
    [selectedId, setSelectedId] = useState(''),
    [tab, setTab] = useState('Overview');
  const [dayId, setDayId] = useState(''),
    [dragScene, setDragScene] = useState('');
  const [filterLocation, setFilterLocation] = useState(''),
    [filterCast, setFilterCast] = useState(''),
    [filterStatus, setFilterStatus] = useState('');
  const [error, setError] = useState('');
  const scene = p.scenes.find((s) => s.id === sceneId) ?? p.scenes[0];
  const sceneOptions = p.scenes.map((s, i) => ({
    id: s.id,
    name: `${i + 1}. ${s.heading}`,
  }));
  function patch<K extends keyof ProductionData>(
    key: K,
    id: string,
    value: Partial<ProductionData[K][number]>,
  ) {
    onUpdate((p) => ({
      ...p,
      [key]: productionData(p)[key].map((r) =>
        r.id === id
          ? { ...r, ...value, updatedAt: new Date().toISOString() }
          : r,
      ),
    }));
  }
  function add<K extends keyof ProductionData>(
    key: K,
    value: ProductionData[K][number],
  ) {
    onUpdate((p) => ({ ...p, [key]: [...productionData(p)[key], value] }));
    setSelectedId(value.id);
  }
  function patchCharacter(id: string, value: Partial<Person>) {
    onUpdate((p) => ({
      ...p,
      characters: p.characters.map((c) =>
        c.id === id
          ? { ...c, ...value, updatedAt: new Date().toISOString() }
          : c,
      ),
    }));
  }
  function patchLocation(id: string, value: Partial<Place>) {
    onUpdate((p) => ({
      ...p,
      locations: p.locations.map((l) =>
        l.id === id
          ? { ...l, ...value, updatedAt: new Date().toISOString() }
          : l,
      ),
    }));
  }
  const files = (
    values: FileReference[],
    onChange: (v: FileReference[]) => void,
    camera = false,
  ) => (
    <Files
      values={values}
      onChange={onChange}
      userId={userId}
      rootId={rootId}
      camera={camera}
    />
  );
  const scenePicker = (
    <Select
      title="Screenplay scene"
      value={scene?.id}
      options={sceneOptions}
      onChange={setSceneId}
      empty="Select scene"
    />
  );
  const sceneLinks = (ids: string[]) => (
    <div className="prod-scene-links">
      {ids.map((id) => {
        const s = p.scenes.find((s) => s.id === id);
        return s ? (
          <Button key={id} variant="outline" onClick={() => onScene(id)}>
            {p.scenes.indexOf(s) + 1}. {s.heading} · Story day {s.storyDay}
          </Button>
        ) : (
          <p key={id}>Removed scene · Review required</p>
        );
      })}
      {!ids.length && <p>No linked scenes yet.</p>}
    </div>
  );
  function linkCast(characterId: string, castMemberId: string) {
    onUpdate((p) => ({
      ...p,
      characters: p.characters.map((c) =>
        c.id === characterId
          ? {
              ...c,
              castMemberId,
              castingStatus: castMemberId ? 'cast' : 'uncast',
            }
          : c,
      ),
      castMembers: productionData(p).castMembers.map((c) => ({
        ...c,
        assignedCharacterIds: [
          ...c.assignedCharacterIds.filter((id) => id !== characterId),
          ...(c.id === castMemberId ? [characterId] : []),
        ],
      })),
    }));
  }
  function makePanel(shot: Shot) {
    const s = p.scenes.find((s) => s.id === shot.sceneId);
    if (!s) return;
    const intent: StoryboardShotIntent = {
      id: shot.id,
      sceneId: s.id,
      panelNumber: shot.shotCode,
      shotSize: shot.shotSize,
      angle: shot.angle as StoryboardShotIntent['angle'],
      movement: shot.movement as StoryboardShotIntent['movement'],
      purpose: shot.purpose as StoryboardShotIntent['purpose'],
      description: shot.description,
      characterIds: shot.subjectIds,
      lens: shot.lens,
      duration: shot.duration,
    };
    const id = crypto.randomUUID();
    const linkedShot = { ...shot, storyboardPanelId: id };
    const panel: Panel = {
      id,
      shotId: shot.id,
      shotRevision: shotRevision(linkedShot),
      sceneId: s.id,
      size: shot.shotSize,
      angle: shot.angle,
      lens: shot.lens,
      movement: shot.movement,
      duration: shot.duration,
      description: shot.description,
      status: 'Planned',
      shotIntent: intent,
      generatedPrompt: buildStoryboardPrompt(
        s,
        intent,
        p.characters,
        p.locations.find((l) => l.id === s.locationId),
        p.aspectRatio,
        p.storyboardStyle,
      ),
      ...sourceLink(p, [s.id]),
    };
    onUpdate((p) => ({
      ...p,
      shots: (p.shots ?? []).map((s) => (s.id === shot.id ? linkedShot : s)),
      panels: [...p.panels, panel],
    }));
  }
  const panelPatch = (id: string, value: Partial<Panel>) =>
    onUpdate((p) => ({
      ...p,
      panels: p.panels.map((x) => (x.id === id ? { ...x, ...value } : x)),
    }));
  function refreshPanel(panel: Panel, shot: Shot) {
    const s = p.scenes.find((s) => s.id === shot.sceneId);
    if (!s) return;
    const intent: StoryboardShotIntent = {
      id: shot.id,
      sceneId: s.id,
      panelNumber: shot.shotCode,
      shotSize: shot.shotSize,
      angle: shot.angle as StoryboardShotIntent['angle'],
      movement: shot.movement as StoryboardShotIntent['movement'],
      purpose: shot.purpose as StoryboardShotIntent['purpose'],
      description: shot.description,
      characterIds: shot.subjectIds,
      lens: shot.lens,
      duration: shot.duration,
    };
    panelPatch(panel.id, {
      shotIntent: intent,
      shotRevision: shotRevision(shot),
      ...sourceLink(p, [s.id]),
      lastReviewedAt: new Date().toISOString(),
      generatedPrompt: buildStoryboardPrompt(
        s,
        intent,
        p.characters,
        p.locations.find((l) => l.id === s.locationId),
        p.aspectRatio,
        p.storyboardStyle,
      ),
    });
  }
  function moveStrip(day: ShootDay, id: string, offset: number) {
    const ids = [...day.scheduledSceneIds],
      index = ids.indexOf(id),
      next = index + offset;
    if (next < 0 || next >= ids.length) return;
    [ids[index], ids[next]] = [ids[next], ids[index]];
    patch('shootDays', day.id, { scheduledSceneIds: ids });
  }
  const [category, setCategory] = useState<string>('cast');
  const [showCoverage, setShowCoverage] = useState(false);
  const [pdfBusy, setPdfBusy] = useState(false);
  const inspect = (
    id: string,
    title: string,
    sections: string[],
    body: ReactNode,
    records: { id: string }[],
    actions?: ReactNode,
  ) => {
    const index = records.findIndex((r) => r.id === id);
    return (
      <InspectorPanel
        key={id}
        title={title}
        sections={sections}
        onClose={() => setSelectedId('')}
        onPrevious={
          index > 0 ? () => setSelectedId(records[index - 1].id) : undefined
        }
        onNext={
          index < records.length - 1
            ? () => setSelectedId(records[index + 1].id)
            : undefined
        }
        actions={actions}
      >
        {body}
      </InspectorPanel>
    );
  };
  const addDay = () =>
    add('shootDays', {
      ...entity(p.id),
      ...sourceLink(p, []),
      date: '',
      number: Math.max(0, ...data.shootDays.map((d) => d.number)) + 1,
      shootingLocationIds: [],
      scheduledSceneIds: [],
      generalCallTime: '07:00',
      estimatedWrapTime: '18:00',
      notes: '',
      status: 'draft',
    });
  const dayOptions = data.shootDays.map((d) => ({
    id: d.id,
    name: `Day ${d.number} · ${d.date || 'Undated'}`,
  }));
  let content: ReactNode = null;
  if (view === 'Characters') {
    const c = p.characters.find((c) => c.id === selectedId) ?? p.characters[0];
    content = (
      <>
        <div className="prod-toolbar">
          <Select
            title="Character"
            value={c?.id}
            options={p.characters}
            onChange={setSelectedId}
          />
          <Button
            onClick={() => {
              const value: Person = {
                ...entity(p.id),
                name: 'New character',
                role: 'minor',
                description: '',
                goals: '',
                fear: '',
                backstory: '',
                arc: '',
                notes: '',
                createdFromScreenplay: false,
              };
              onUpdate((p) => ({ ...p, characters: [...p.characters, value] }));
              setSelectedId(value.id);
            }}
          >
            Add character
          </Button>
        </div>
        {c ? (
          <>
            <div className="prod-tabs">
              {[
                'Overview',
                'Appearance',
                'Casting',
                'Continuity',
                'Scenes',
              ].map((t) => (
                <Button
                  key={t}
                  variant={tab === t ? 'default' : 'ghost'}
                  onClick={() => setTab(t)}
                >
                  {t}
                </Button>
              ))}
            </div>
            <Card title={c.name}>
              {tab === 'Overview' && (
                <>
                  <Fields
                    record={c}
                    fields={[
                      'name',
                      'characterAge',
                      'description',
                      'storyFunction',
                      'arc',
                      'personality',
                      'goals',
                      'fears',
                      'relationships',
                      'productionNotes',
                    ]}
                    onChange={(v) => patchCharacter(c.id, v)}
                  />
                  <Select
                    title="Role"
                    value={c.role.toLowerCase()}
                    options={[
                      'lead',
                      'supporting',
                      'recurring',
                      'minor',
                      'extra',
                    ]}
                    onChange={(role) => patchCharacter(c.id, { role })}
                  />
                </>
              )}
              {tab === 'Appearance' && (
                <>
                  <Fields
                    record={c.visualProfile ?? {}}
                    fields={[
                      'ageAppearance',
                      'build',
                      'face',
                      'hair',
                      'defaultWardrobe',
                      'distinctiveFeatures',
                      'storyboardDescription',
                    ]}
                    onChange={(v) =>
                      patchCharacter(c.id, {
                        visualProfile: { ...c.visualProfile, ...v },
                      })
                    }
                  />
                  <Select
                    title="Default look"
                    value={c.defaultLookId}
                    options={data.characterLooks.filter(
                      (l) => l.characterId === c.id,
                    )}
                    onChange={(defaultLookId) =>
                      patchCharacter(c.id, { defaultLookId })
                    }
                  />
                  {files(
                    c.referenceImages ?? [],
                    (referenceImages) =>
                      patchCharacter(c.id, { referenceImages }),
                    true,
                  )}
                </>
              )}
              {tab === 'Casting' && (
                <>
                  <Select
                    title="Casting status"
                    value={c.castingStatus ?? 'uncast'}
                    options={['uncast', 'auditioning', 'shortlisted', 'cast']}
                    onChange={(castingStatus) =>
                      patchCharacter(c.id, {
                        castingStatus: castingStatus as Person['castingStatus'],
                      })
                    }
                  />
                  <Select
                    title="Assigned actor"
                    value={c.castMemberId}
                    options={data.castMembers}
                    onChange={(id) => linkCast(c.id, id)}
                  />
                  <Fields
                    record={c}
                    fields={['auditionStatus', 'castingNotes']}
                    onChange={(v) => patchCharacter(c.id, v)}
                  />
                </>
              )}
              {tab === 'Scenes' && (
                <>
                  <p>
                    {
                      p.scenes.filter((s) => s.characterIds.includes(c.id))
                        .length
                    }{' '}
                    scenes ·{' '}
                    {
                      p.scenes
                        .flatMap((s) => s.blocks)
                        .filter(
                          (b) =>
                            b.type === 'character' &&
                            b.content
                              .toUpperCase()
                              .startsWith(c.name.toUpperCase()),
                        ).length
                    }{' '}
                    cues
                  </p>
                  {sceneLinks(
                    p.scenes
                      .filter((s) => s.characterIds.includes(c.id))
                      .map((s) => s.id),
                  )}
                </>
              )}
              {tab === 'Continuity' && (
                <>
                  <Button
                    onClick={() =>
                      add('characterLooks', {
                        ...entity(p.id),
                        characterId: c.id,
                        name: `Look ${data.characterLooks.filter((l) => l.characterId === c.id).length + 1}`,
                        storyDay: 1,
                        description: '',
                        wardrobeNotes: '',
                        hairNotes: '',
                        makeupNotes: '',
                        referenceImages: [],
                        linkedSceneIds: [],
                        continuityNotes: '',
                      })
                    }
                  >
                    Add look
                  </Button>
                  {data.characterLooks
                    .filter((l) => l.characterId === c.id)
                    .map((l) => (
                      <Card key={l.id} title={l.name}>
                        <Fields
                          record={l}
                          fields={[
                            'name',
                            'description',
                            'wardrobeNotes',
                            'hairNotes',
                            'makeupNotes',
                            'continuityNotes',
                          ]}
                          onChange={(v) => patch('characterLooks', l.id, v)}
                        />
                        <Field
                          title="Story day"
                          type="number"
                          value={l.storyDay}
                          onChange={(v) =>
                            patch('characterLooks', l.id, {
                              storyDay: Number(v),
                            })
                          }
                        />
                        <Multi
                          title="Scenes sharing this look"
                          values={l.linkedSceneIds}
                          options={sceneOptions.filter((s) =>
                            p.scenes
                              .find((x) => x.id === s.id)
                              ?.characterIds.includes(c.id),
                          )}
                          onChange={(linkedSceneIds) =>
                            patch('characterLooks', l.id, { linkedSceneIds })
                          }
                        />
                        {files(
                          l.referenceImages,
                          (referenceImages) =>
                            patch('characterLooks', l.id, { referenceImages }),
                          true,
                        )}
                        <Button
                          variant="ghost"
                          onClick={() => {
                            if (window.confirm(`Delete look "${l.name}"?`)) {
                              onUpdate((p) => deleteProductionEntity(p, 'characterLooks', l.id));
                            }
                          }}
                        >
                          Delete look
                        </Button>
                      </Card>
                    ))}
                </>
              )}
            </Card>
          </>
        ) : (
          <p>
            Character cues in the screenplay create characters automatically.
          </p>
        )}
      </>
    );
  }
  if (view === 'Cast & Crew') {
    const mode = ['Cast', 'Crew', 'Budget'].includes(tab) ? tab : 'Cast';
    let directory: ReactNode;
    if (mode === 'Cast') {
      const c = data.castMembers.find((c) => c.id === selectedId);
      const addCast = (
        <Button
          onClick={() =>
            add('castMembers', {
              ...entity(p.id),
              name: 'New actor',
              phone: '',
              email: '',
              notes: '',
              availability: [],
              contractStatus: 'unknown',
              documents: [],
              assignedCharacterIds: [],
            })
          }
        >
          + Cast member
        </Button>
      );
      directory = (
        <RecordWorkspace
          rows={data.castMembers.map((c) => {
            const roles = p.characters.filter((ch) => ch.castMemberId === c.id),
              sceneIds = p.scenes
                .filter((s) =>
                  roles.some((ch) => s.characterIds.includes(ch.id)),
                )
                .map((s) => s.id);
            return {
              id: c.id,
              title: c.name,
              subtitle:
                roles.map((c) => c.name).join(', ') || 'Role unassigned',
              meta: `${sceneIds.length} scenes · ${data.shootDays.filter((d) => d.scheduledSceneIds.some((id) => sceneIds.includes(id))).length} shoot days`,
              icon: c.name.slice(0, 1),
              badge: <StatusBadge>{label(c.contractStatus)}</StatusBadge>,
            };
          })}
          selectedId={selectedId}
          onSelect={setSelectedId}
          toolbar={addCast}
          empty={
            <EmptyState
              title="No cast members yet"
              description="Assign actors to screenplay characters and manage their availability here."
              action={addCast}
            />
          }
        >
          {c &&
            inspect(
              c.id,
              c.name,
              ['Profile', 'Representation', 'Production', 'Files'],
              <>
                <Section name="Profile">
                  <Fields
                    record={c}
                    fields={['name', 'photoUrl', 'phone', 'email']}
                    onChange={(v) => patch('castMembers', c.id, v)}
                  />
                  <CollapsibleSection title="Emergency contact & notes">
                    <Fields
                      record={c}
                      fields={['emergencyContact', 'notes']}
                      onChange={(v) => patch('castMembers', c.id, v)}
                    />
                  </CollapsibleSection>
                </Section>
                <Section name="Representation">
                  <Fields
                    record={c}
                    fields={['agency', 'agentName', 'agentPhone']}
                    onChange={(v) => patch('castMembers', c.id, v)}
                  />
                </Section>
                <Section name="Production">
                  <Multi
                    title="Assigned roles"
                    values={p.characters
                      .filter((ch) => ch.castMemberId === c.id)
                      .map((ch) => ch.id)}
                    options={p.characters}
                    onChange={(ids) =>
                      onUpdate((p) => ({
                        ...p,
                        characters: p.characters.map((ch) =>
                          ids.includes(ch.id)
                            ? {
                                ...ch,
                                castMemberId: c.id,
                                castingStatus: 'cast',
                              }
                            : ch.castMemberId === c.id
                              ? {
                                  ...ch,
                                  castMemberId: '',
                                  castingStatus: 'uncast',
                                }
                              : ch,
                        ),
                        castMembers: productionData(p).castMembers.map(
                          (actor) => ({
                            ...actor,
                            assignedCharacterIds:
                              actor.id === c.id
                                ? ids
                                : actor.assignedCharacterIds.filter(
                                    (id) => !ids.includes(id),
                                  ),
                          }),
                        ),
                      }))
                    }
                  />
                  <Select
                    title="Contract"
                    value={c.contractStatus}
                    options={['unknown', 'pending', 'signed', 'completed']}
                    onChange={(contractStatus) =>
                      patch('castMembers', c.id, {
                        contractStatus:
                          contractStatus as typeof c.contractStatus,
                      })
                    }
                  />
                  <AvailabilityEditor
                    values={c.availability}
                    onChange={(availability) =>
                      patch('castMembers', c.id, { availability })
                    }
                  />
                  <div className="prod-fields">
                    <Field
                      title="Rate"
                      type="number"
                      value={c.rate}
                      onChange={(v) =>
                        patch('castMembers', c.id, { rate: Number(v) })
                      }
                    />
                    <Field
                      title="Rate unit"
                      value={c.rateUnit}
                      onChange={(rateUnit) =>
                        patch('castMembers', c.id, { rateUnit })
                      }
                    />
                  </div>
                </Section>
                <Section name="Files">
                  {files(c.documents, (documents) =>
                    patch('castMembers', c.id, { documents }),
                  )}
                </Section>
              </>,
              data.castMembers,
              <Button
                key="delete-cast"
                variant="ghost"
                onClick={() => {
                  const roles = p.characters.filter((ch) => ch.castMemberId === c.id);
                  const msg = roles.length
                    ? `Delete cast member "${c.name}"?\n${roles.length} assigned character(s) (${roles.map((r) => r.name).join(', ')}) will become uncast.`
                    : `Delete cast member "${c.name}"?`;
                  if (window.confirm(msg)) {
                    onUpdate((p) => deleteProductionEntity(p, 'castMembers', c.id));
                    setSelectedId('');
                  }
                }}
              >
                Delete cast member
              </Button>,
            )}
        </RecordWorkspace>
      );
    } else if (mode === 'Crew') {
      const c = data.crewMembers.find((c) => c.id === selectedId);
      const addCrew = (
        <Button
          onClick={() =>
            add('crewMembers', {
              ...entity(p.id),
              name: 'New crew member',
              department: 'Production',
              role: '',
              phone: '',
              email: '',
              availability: [],
              notes: '',
            })
          }
        >
          + Crew member
        </Button>
      );
      directory = (
        <RecordWorkspace
          rows={data.crewMembers.map((c) => ({
            id: c.id,
            title: c.name,
            subtitle: `${c.department} · ${c.role || 'Role unset'}`,
            meta: c.phone || c.email,
            icon: c.name.slice(0, 1),
          }))}
          selectedId={selectedId}
          onSelect={setSelectedId}
          toolbar={addCrew}
          empty={
            <EmptyState
              title="No crew members yet"
              description="Build the production directory by department."
              action={addCrew}
            />
          }
        >
          {c &&
            inspect(
              c.id,
              c.name,
              ['Profile', 'Production'],
              <>
                <Section name="Profile">
                  <Fields
                    record={c}
                    fields={['name', 'phone', 'email']}
                    onChange={(v) => patch('crewMembers', c.id, v)}
                  />
                </Section>
                <Section name="Production">
                  <Select
                    title="Department"
                    value={c.department}
                    options={departments}
                    onChange={(department) =>
                      patch('crewMembers', c.id, {
                        department: department as typeof c.department,
                      })
                    }
                  />
                  <Fields
                    record={c}
                    fields={['role', 'notes']}
                    onChange={(v) => patch('crewMembers', c.id, v)}
                  />
                  <AvailabilityEditor
                    values={c.availability}
                    onChange={(availability) =>
                      patch('crewMembers', c.id, { availability })
                    }
                  />
                </Section>
              </>,
              data.crewMembers,
              <Button
                key="delete-crew"
                variant="ghost"
                onClick={() => {
                  if (window.confirm(`Delete crew member "${c.name}"?`)) {
                    onUpdate((p) => deleteProductionEntity(p, 'crewMembers', c.id));
                    setSelectedId('');
                  }
                }}
              >
                Delete crew member
              </Button>,
            )}
        </RecordWorkspace>
      );
    } else {
      const b = data.budget.find((b) => b.id === selectedId);
      const addCost = (
        <Button
          onClick={() =>
            add('budget', {
              ...entity(p.id),
              name: 'New cost',
              category: 'Miscellaneous',
              estimated: 0,
              actual: 0,
            })
          }
        >
          + Cost
        </Button>
      );
      directory = (
        <>
          <div className="production-summary">
            <span>
              Estimated{' '}
              {data.budget
                .reduce((n, b) => n + b.estimated, 0)
                .toLocaleString()}
            </span>
            <span>
              Actual{' '}
              {data.budget.reduce((n, b) => n + b.actual, 0).toLocaleString()}
            </span>
            <b>
              Difference{' '}
              {data.budget
                .reduce((n, b) => n + b.estimated - b.actual, 0)
                .toLocaleString()}
            </b>
          </div>
          <RecordWorkspace
            rows={data.budget.map((b) => ({
              id: b.id,
              title: b.name,
              subtitle: b.category,
              meta: `Estimated ${b.estimated} · Actual ${b.actual} · Difference ${b.estimated - b.actual}`,
            }))}
            selectedId={selectedId}
            onSelect={setSelectedId}
            toolbar={addCost}
            empty={<EmptyState title="No costs yet" action={addCost} />}
          >
            {b &&
              inspect(
                b.id,
                b.name,
                ['Cost', 'Links'],
                <>
                  <Section name="Cost">
                    <Field
                      title="Name"
                      value={b.name}
                      onChange={(name) => patch('budget', b.id, { name })}
                    />
                    <Select
                      title="Category"
                      value={b.category}
                      options={budgetCategories}
                      onChange={(category) =>
                        patch('budget', b.id, {
                          category: category as typeof b.category,
                        })
                      }
                    />
                    {(['estimated', 'actual'] as const).map((k) => (
                      <Field
                        key={k}
                        title={label(k)}
                        type="number"
                        value={b[k]}
                        onChange={(v) =>
                          patch('budget', b.id, { [k]: Number(v) })
                        }
                      />
                    ))}
                  </Section>
                  <Section name="Links">
                    <Select
                      title="Asset"
                      value={b.assetId}
                      options={data.assets}
                      onChange={(assetId) => patch('budget', b.id, { assetId })}
                    />
                    <Select
                      title="Cast"
                      value={b.castMemberId}
                      options={data.castMembers}
                      onChange={(castMemberId) =>
                        patch('budget', b.id, { castMemberId })
                      }
                    />
                    <Select
                      title="Shooting location"
                      value={b.shootingLocationId}
                      options={data.shootingLocations}
                      onChange={(shootingLocationId) =>
                        patch('budget', b.id, { shootingLocationId })
                      }
                    />
                    <Select
                      title="Shoot day"
                      value={b.shootDayId}
                      options={dayOptions}
                      onChange={(shootDayId) =>
                        patch('budget', b.id, { shootDayId })
                      }
                    />
                  </Section>
                </>,
                data.budget,
                <Button
                  key="delete-budget"
                  variant="ghost"
                  onClick={() => {
                    if (window.confirm(`Delete cost entry "${b.name}"?`)) {
                      onUpdate((p) => deleteProductionEntity(p, 'budget', b.id));
                      setSelectedId('');
                    }
                  }}
                >
                  Delete cost
                </Button>,
              )}
          </RecordWorkspace>
        </>
      );
    }
    content = (
      <>
        <WorkspaceTabs
          tabs={['Cast', 'Crew', 'Budget']}
          value={mode}
          onChange={(v) => {
            setTab(v);
            setSelectedId('');
          }}
        />
        {directory}
      </>
    );
  }
  if (view === 'Locations') {
    const physicalMode = tab === 'Physical locations';
    const story = p.locations.find((l) => l.id === selectedId),
      physical = data.shootingLocations.find((l) => l.id === selectedId);
    const addLocation = (
      <Button
        onClick={() => {
          add('shootingLocations', {
            ...entity(p.id),
            name: 'New shooting location',
            address: '',
            contactName: '',
            contactPhone: '',
            availability: [],
            permissionStatus: 'unknown',
            photos: [],
            videos: [],
            floorPlanFiles: [],
            recceNotes: '',
          });
          setTab('Physical locations');
        }}
      >
        + Shooting location
      </Button>
    );
    const linkedScenes = physical
      ? p.scenes.filter(
          (s) =>
            p.locations.find((l) => l.id === s.locationId)
              ?.shootingLocationId === physical.id,
        )
      : [];
    const days = physical
      ? data.shootDays.filter(
          (d) =>
            d.shootingLocationIds.includes(physical.id) ||
            d.scheduledSceneIds.some((id) =>
              linkedScenes.some((s) => s.id === id),
            ),
        )
      : [];
    content = (
      <>
        <WorkspaceTabs
          tabs={['Story locations', 'Physical locations']}
          value={physicalMode ? 'Physical locations' : 'Story locations'}
          onChange={(v) => {
            setTab(v);
            setSelectedId('');
          }}
        />
        <RecordWorkspace
          rows={
            physicalMode
              ? data.shootingLocations.map((l) => ({
                  id: l.id,
                  title: l.name,
                  subtitle: l.address || 'Address not set',
                  meta: `${p.locations.filter((story) => story.shootingLocationId === l.id).length} story locations`,
                  badge: <StatusBadge>{label(l.permissionStatus)}</StatusBadge>,
                }))
              : p.locations.map((l) => ({
                  id: l.id,
                  title: l.name,
                  subtitle: `${l.interiorExterior || ''} · ${p.scenes.filter((s) => s.locationId === l.id).length} scenes`,
                  meta:
                    data.shootingLocations.find(
                      (p) => p.id === l.shootingLocationId,
                    )?.name ?? 'Shooting location unassigned',
                }))
          }
          selectedId={selectedId}
          onSelect={setSelectedId}
          toolbar={physicalMode ? addLocation : undefined}
          empty={
            <EmptyState
              title={
                physicalMode
                  ? 'No shooting locations yet'
                  : 'No story locations yet'
              }
              description={
                physicalMode
                  ? 'Connect real filming places to story locations.'
                  : 'Valid screenplay scene headings create story locations.'
              }
              action={addLocation}
            />
          }
        >
          {!physicalMode &&
            story &&
            inspect(
              story.id,
              story.name,
              ['Overview', 'Shooting location', 'Scenes', 'Production'],
              <>
                <Section name="Overview">
                  <Fields
                    record={story}
                    fields={['name', 'description', 'storyRequirements']}
                    onChange={(v) => patchLocation(story.id, v)}
                  />
                  <Select
                    title="Interior / exterior"
                    value={story.interiorExterior}
                    options={['INT', 'EXT', 'INT/EXT']}
                    onChange={(interiorExterior) =>
                      patchLocation(story.id, { interiorExterior })
                    }
                  />
                </Section>
                <Section name="Shooting location">
                  <Select
                    title="Filmed at"
                    value={story.shootingLocationId}
                    options={data.shootingLocations}
                    onChange={(shootingLocationId) =>
                      patchLocation(story.id, { shootingLocationId })
                    }
                  />
                  {story.shootingLocationId && (
                    <Button
                      variant="outline"
                      onClick={() => {
                        setTab('Physical locations');
                        setSelectedId(story.shootingLocationId!);
                      }}
                    >
                      Open physical location
                    </Button>
                  )}
                  {addLocation}
                </Section>
                <Section name="Scenes">
                  {sceneLinks(
                    p.scenes
                      .filter((s) => s.locationId === story.id)
                      .map((s) => s.id),
                  )}
                </Section>
                <Section name="Production">
                  <Fields
                    record={story}
                    fields={['productionNotes']}
                    onChange={(v) => patchLocation(story.id, v)}
                  />
                  <p>
                    {
                      data.breakdownItems.filter(
                        (i) => i.linkedLocationId === story.id,
                      ).length
                    }{' '}
                    requirements ·{' '}
                    {
                      data.assets.filter((a) =>
                        a.linkedLocationIds.includes(story.id),
                      ).length
                    }{' '}
                    assets
                  </p>
                </Section>
              </>,
              p.locations,
            )}
          {physicalMode &&
            physical &&
            inspect(
              physical.id,
              physical.name,
              ['Overview', 'Recce', 'Media', 'Scenes', 'Production'],
              <>
                <Section name="Overview">
                  <Fields
                    record={physical}
                    fields={['name', 'address']}
                    onChange={(v) => patch('shootingLocations', physical.id, v)}
                  />
                  {validCoordinates(physical.lat, physical.lng) && (
                    <>
                      <iframe
                        title={`Map of ${physical.name}`}
                        className="prod-map"
                        src={mapProvider.previewUrl({
                          lat: physical.lat!,
                          lng: physical.lng!,
                          address: physical.address,
                        })}
                      />
                      <a
                        target="_blank"
                        rel="noreferrer"
                        href={mapProvider.directionsUrl({
                          lat: physical.lat!,
                          lng: physical.lng!,
                          address: physical.address,
                        })}
                      >
                        Open directions
                      </a>
                    </>
                  )}
                  <CollapsibleSection title="Map position">
                    <div className="prod-fields">
                      <Field
                        title="Latitude"
                        type="number"
                        value={physical.lat}
                        onChange={(v) =>
                          patch('shootingLocations', physical.id, {
                            lat: v === '' ? undefined : Number(v),
                          })
                        }
                      />
                      <Field
                        title="Longitude"
                        type="number"
                        value={physical.lng}
                        onChange={(v) =>
                          patch('shootingLocations', physical.id, {
                            lng: v === '' ? undefined : Number(v),
                          })
                        }
                      />
                    </div>
                    <div className="prod-toolbar">
                      <a
                        target="_blank"
                        rel="noreferrer"
                        href={mapProvider.searchUrl(physical.address)}
                      >
                        Search address
                      </a>
                      <Button
                        variant="outline"
                        onClick={() =>
                          navigator.geolocation.getCurrentPosition(
                            (pos) =>
                              patch('shootingLocations', physical.id, {
                                lat: pos.coords.latitude,
                                lng: pos.coords.longitude,
                              }),
                            (e) => setError(e.message),
                          )
                        }
                      >
                        Pin current position
                      </Button>
                    </div>
                  </CollapsibleSection>
                  <Select
                    title="Permission"
                    value={physical.permissionStatus}
                    options={[
                      'unknown',
                      'required',
                      'requested',
                      'approved',
                      'rejected',
                    ]}
                    onChange={(permissionStatus) =>
                      patch('shootingLocations', physical.id, {
                        permissionStatus:
                          permissionStatus as typeof physical.permissionStatus,
                      })
                    }
                  />
                  <Fields
                    record={physical}
                    fields={['contactName', 'contactPhone', 'contactEmail']}
                    onChange={(v) => patch('shootingLocations', physical.id, v)}
                  />
                  <CollapsibleSection title="Fee & availability">
                    <Field
                      title="Fee"
                      type="number"
                      value={physical.fee}
                      onChange={(v) =>
                        patch('shootingLocations', physical.id, {
                          fee: Number(v),
                        })
                      }
                    />
                    <Fields
                      record={physical}
                      fields={['feeNotes']}
                      onChange={(v) =>
                        patch('shootingLocations', physical.id, v)
                      }
                    />
                    <AvailabilityEditor
                      values={physical.availability}
                      onChange={(availability) =>
                        patch('shootingLocations', physical.id, {
                          availability,
                        })
                      }
                    />
                  </CollapsibleSection>
                </Section>
                <Section name="Recce">
                  {[
                    ['Access', 'entranceNotes', 'equipmentAccessNotes'],
                    ['Space', 'interiorNotes', 'windowsNotes'],
                    [
                      'Facilities',
                      'powerNotes',
                      'soundNotes',
                      'parkingNotes',
                      'restroomNotes',
                      'greenRoomNotes',
                    ],
                    ['Restrictions', 'restrictionNotes'],
                  ].map(([title, ...keys]) => (
                    <CollapsibleSection key={title} title={title}>
                      <Fields
                        record={physical}
                        fields={keys}
                        onChange={(v) =>
                          patch('shootingLocations', physical.id, v)
                        }
                      />
                    </CollapsibleSection>
                  ))}
                  <Fields
                    record={physical}
                    fields={['recceNotes']}
                    onChange={(v) => patch('shootingLocations', physical.id, v)}
                  />
                </Section>
                <Section name="Media">
                  <b>Photos</b>
                  {files(
                    physical.photos,
                    (photos) =>
                      patch('shootingLocations', physical.id, { photos }),
                    true,
                  )}
                  <b>Videos</b>
                  {files(physical.videos, (videos) =>
                    patch('shootingLocations', physical.id, { videos }),
                  )}
                  <b>Floor plans</b>
                  {files(physical.floorPlanFiles, (floorPlanFiles) =>
                    patch('shootingLocations', physical.id, { floorPlanFiles }),
                  )}
                </Section>
                <Section name="Scenes">
                  <p>
                    {p.locations
                      .filter((l) => l.shootingLocationId === physical.id)
                      .map((l) => l.name)
                      .join(' · ') || 'No story locations assigned'}
                  </p>
                  {sceneLinks(linkedScenes.map((s) => s.id))}
                </Section>
                <Section name="Production">
                  {days.map((d) => (
                    <p key={d.id}>
                      Day {d.number} · {d.date || 'Undated'} ·{' '}
                      {data.callSheets.some((c) => c.shootDayId === d.id)
                        ? 'Call sheet prepared'
                        : 'No call sheet'}
                    </p>
                  ))}
                  <p>
                    {data.breakdownItems
                      .filter((i) =>
                        linkedScenes.some((s) => s.id === i.sceneId),
                      )
                      .map((i) => i.name)
                      .join(' · ') || 'No linked requirements'}
                  </p>
                </Section>
              </>,
              data.shootingLocations,
              <Button
                key="delete-location"
                variant="ghost"
                onClick={() => {
                  const linkedStory = p.locations.filter((l) => l.shootingLocationId === physical.id);
                  const msg = linkedStory.length
                    ? `Delete shooting location "${physical.name}"?\n${linkedStory.length} linked story location(s) (${linkedStory.map((l) => l.name).join(', ')}) will become unassigned.\nScreenplay scenes will remain intact.`
                    : `Delete shooting location "${physical.name}"?`;
                  if (window.confirm(msg)) {
                    onUpdate((p) => deleteProductionEntity(p, 'shootingLocations', physical.id));
                    setSelectedId('');
                  }
                }}
              >
                Delete shooting location
              </Button>,
            )}
        </RecordWorkspace>
      </>
    );
  }
  if (view === 'Breakdown') {
    const sceneItems = data.breakdownItems.filter(
      (i) => i.sceneId === scene?.id,
    );
    const items = sceneItems.filter((i) => i.category === category),
      selected = items.find((i) => i.id === selectedId);
    const addItem = (
      <Button
        disabled={!scene}
        onClick={() =>
          scene &&
          add('breakdownItems', {
            ...entity(p.id),
            ...sourceLink(p, [scene.id]),
            episodeId: p.id,
            sceneId: scene.id,
            category: category as (typeof breakdownCategories)[number],
            name: 'New requirement',
            description: '',
            status: 'needed',
            notes: '',
            source: 'manual',
            confirmed: false,
          })
        }
      >
        + Add {label(category).toLowerCase()} requirement
      </Button>
    );
    content = (
      <>
        <div className="prod-toolbar">
          {scenePicker}
          <Button
            variant="outline"
            disabled={!scene}
            onClick={() => scene && onUpdate((p) => extractBreakdown(p, scene))}
          >
            Extract cast & location
          </Button>
        </div>
        {scene && (
          <div className="production-summary">
            <span>Story day {scene.storyDay}</span>
            <span>
              {p.locations.find((l) => l.id === scene.locationId)?.name ||
                'No story location'}
            </span>
            {['cast', 'props', 'wardrobe', 'vfx'].map((c) => (
              <span key={c}>
                {label(c)} {sceneItems.filter((i) => i.category === c).length}
              </span>
            ))}
            <b>{sceneItems.length} total requirements</b>
          </div>
        )}
        <nav className="department-grid" aria-label="Breakdown departments">
          {breakdownCategories.map((c) => (
            <button
              key={c}
              className={category === c ? 'active' : ''}
              aria-pressed={category === c}
              onClick={() => {
                setCategory(c);
                setSelectedId('');
              }}
            >
              {label(c)}
              <b>{sceneItems.filter((i) => i.category === c).length}</b>
            </button>
          ))}
        </nav>
        <RecordWorkspace
          rows={items.map((i) => ({
            id: i.id,
            title:
              data.assets.find((a) => a.id === i.linkedAssetId)?.name ?? i.name,
            subtitle: `${i.source === 'screenplay' ? 'Linked from screenplay' : 'Manual requirement'} · ${label(i.status)}`,
            meta: i.confirmed ? '✓ Confirmed' : '○ Not confirmed',
            badge: needsReview(p, i, [i.sceneId]) ? (
              <StatusBadge warning>Script changed</StatusBadge>
            ) : undefined,
          }))}
          selectedId={selectedId}
          onSelect={setSelectedId}
          toolbar={addItem}
          empty={
            <EmptyState
              title={`No ${label(category).toLowerCase()} requirements`}
              action={addItem}
            />
          }
        >
          {selected &&
            inspect(
              selected.id,
              selected.name,
              ['Details', 'Links', 'Notes'],
              <>
                <SourceReview
                  p={p}
                  record={selected}
                  ids={[selected.sceneId]}
                  onReview={() =>
                    patch(
                      'breakdownItems',
                      selected.id,
                      reviewSource(p, selected, [selected.sceneId]),
                    )
                  }
                  refresh={() =>
                    patch('breakdownItems', selected.id, {
                      ...reviewSource(p, selected, [selected.sceneId]),
                      name:
                        p.characters.find(
                          (c) => c.id === selected.linkedCharacterId,
                        )?.name ??
                        p.locations.find(
                          (l) => l.id === selected.linkedLocationId,
                        )?.name ??
                        selected.name,
                    })
                  }
                />
                <Section name="Details">
                  <Fields
                    record={selected}
                    fields={['name', 'description']}
                    onChange={(v) => patch('breakdownItems', selected.id, v)}
                  />
                  <div className="prod-fields">
                    <Field
                      title="Quantity"
                      value={selected.quantity}
                      type="number"
                      onChange={(v) =>
                        patch('breakdownItems', selected.id, {
                          quantity: Number(v),
                        })
                      }
                    />
                    <Select
                      title="Status"
                      value={selected.status}
                      options={[
                        'needed',
                        'sourcing',
                        'ready',
                        'on_set',
                        'complete',
                      ]}
                      onChange={(status) =>
                        patch('breakdownItems', selected.id, { status })
                      }
                    />
                  </div>
                  <label className="prod-check">
                    <input
                      type="checkbox"
                      checked={selected.confirmed}
                      onChange={(e) =>
                        patch('breakdownItems', selected.id, {
                          confirmed: e.target.checked,
                        })
                      }
                    />
                    Confirmed
                  </label>
                </Section>
                <Section name="Links">
                  <Select
                    title="Asset"
                    value={selected.linkedAssetId}
                    options={data.assets}
                    onChange={(linkedAssetId) =>
                      onUpdate((p) => ({
                        ...p,
                        breakdownItems: productionData(p).breakdownItems.map(
                          (i) =>
                            i.id === selected.id ? { ...i, linkedAssetId } : i,
                        ),
                        assets: productionData(p).assets.map((a) =>
                          a.id === linkedAssetId
                            ? {
                                ...a,
                                linkedSceneIds: [
                                  ...new Set([
                                    ...a.linkedSceneIds,
                                    selected.sceneId,
                                  ]),
                                ],
                              }
                            : a,
                        ),
                      }))
                    }
                  />
                  <Select
                    title="Character"
                    value={selected.linkedCharacterId}
                    options={p.characters}
                    onChange={(linkedCharacterId) =>
                      patch('breakdownItems', selected.id, {
                        linkedCharacterId,
                      })
                    }
                  />
                  <Select
                    title="Story location"
                    value={selected.linkedLocationId}
                    options={p.locations}
                    onChange={(linkedLocationId) =>
                      patch('breakdownItems', selected.id, { linkedLocationId })
                    }
                  />
                </Section>
                <Section name="Notes">
                  <Fields
                    record={selected}
                    fields={['notes']}
                    onChange={(v) => patch('breakdownItems', selected.id, v)}
                  />
                </Section>
              </>,
              items,
              <Button
                key="delete-breakdown"
                variant="ghost"
                onClick={() => {
                  if (window.confirm(`Delete requirement "${selected.name}"?`)) {
                    onUpdate((p) => deleteProductionEntity(p, 'breakdownItems', selected.id));
                    setSelectedId('');
                  }
                }}
              >
                Delete requirement
              </Button>,
            )}
        </RecordWorkspace>
      </>
    );
  }
  if (view === 'Assets') {
    const assets = data.assets.filter(
      (a) =>
        (!filterLocation || a.type === filterLocation) &&
        (!filterStatus || a.status === filterStatus),
    );
    const a = assets.find((a) => a.id === selectedId);
    const addAsset = (
      <Button
        onClick={() =>
          add('assets', {
            ...entity(p.id),
            type: 'prop',
            name: 'New asset',
            description: '',
            photos: [],
            files: [],
            linkedSceneIds: [],
            linkedCharacterIds: [],
            linkedLocationIds: [],
            continuityNotes: '',
            ownership: 'unknown',
            status: 'needed',
            estimatedCost: 0,
            notes: '',
          })
        }
      >
        + Asset
      </Button>
    );
    content = (
      <>
        <div className="prod-toolbar">
          <Select
            title="Type"
            value={filterLocation}
            options={assetTypes}
            onChange={setFilterLocation}
            empty="All types"
          />
          <Select
            title="Status"
            value={filterStatus}
            options={['needed', 'sourcing', 'ready', 'on_set', 'returned']}
            onChange={setFilterStatus}
            empty="All statuses"
          />
          {addAsset}
        </div>
        <RecordWorkspace
          rows={assets.map((a) => ({
            id: a.id,
            title: a.name,
            subtitle: `${label(a.type)} · ${label(a.ownership)}`,
            meta: `${a.linkedSceneIds.length} scenes`,
            badge: <StatusBadge>{label(a.status)}</StatusBadge>,
          }))}
          selectedId={selectedId}
          onSelect={setSelectedId}
          empty={
            <EmptyState
              title="No assets yet"
              description="Keep reusable props, wardrobe and equipment linked to the scenes that need them."
              action={addAsset}
            />
          }
        >
          {a &&
            inspect(
              a.id,
              a.name,
              ['Details', 'Links', 'Media', 'Cost', 'Continuity'],
              <>
                <Section name="Details">
                  <Fields
                    record={a}
                    fields={['name', 'description']}
                    onChange={(v) => patch('assets', a.id, v)}
                  />
                  <Select
                    title="Type"
                    value={a.type}
                    options={assetTypes}
                    onChange={(type) =>
                      patch('assets', a.id, { type: type as typeof a.type })
                    }
                  />
                  <Select
                    title="Status"
                    value={a.status}
                    options={[
                      'needed',
                      'sourcing',
                      'ready',
                      'on_set',
                      'returned',
                    ]}
                    onChange={(status) => patch('assets', a.id, { status })}
                  />
                  <Select
                    title="Ownership"
                    value={a.ownership}
                    options={['owned', 'rented', 'borrowed', 'unknown']}
                    onChange={(ownership) =>
                      patch('assets', a.id, {
                        ownership: ownership as typeof a.ownership,
                      })
                    }
                  />
                  <CollapsibleSection title="Notes">
                    <Fields
                      record={a}
                      fields={['notes']}
                      onChange={(v) => patch('assets', a.id, v)}
                    />
                  </CollapsibleSection>
                </Section>
                <Section name="Links">
                  <Multi
                    title="Scenes"
                    values={a.linkedSceneIds}
                    options={sceneOptions}
                    onChange={(linkedSceneIds) =>
                      patch('assets', a.id, { linkedSceneIds })
                    }
                  />
                  <Multi
                    title="Characters"
                    values={a.linkedCharacterIds}
                    options={p.characters}
                    onChange={(linkedCharacterIds) =>
                      patch('assets', a.id, { linkedCharacterIds })
                    }
                  />
                  <Multi
                    title="Story locations"
                    values={a.linkedLocationIds}
                    options={p.locations}
                    onChange={(linkedLocationIds) =>
                      patch('assets', a.id, { linkedLocationIds })
                    }
                  />
                </Section>
                <Section name="Media">
                  {files(
                    a.photos,
                    (photos) => patch('assets', a.id, { photos }),
                    true,
                  )}
                  {files(a.files, (files) => patch('assets', a.id, { files }))}
                </Section>
                <Section name="Cost">
                  {(['estimatedCost', 'actualCost'] as const).map((key) => (
                    <Field
                      key={key}
                      title={label(key)}
                      type="number"
                      value={a[key]}
                      onChange={(v) =>
                        patch('assets', a.id, { [key]: Number(v) })
                      }
                    />
                  ))}
                </Section>
                <Section name="Continuity">
                  <Fields
                    record={a}
                    fields={['continuityNotes']}
                    onChange={(v) => patch('assets', a.id, v)}
                  />
                </Section>
              </>,
              assets,
              <Button
                key="delete-asset"
                variant="ghost"
                onClick={() => {
                  const linkedItems = data.breakdownItems.filter((i) => i.linkedAssetId === a.id);
                  const msg = linkedItems.length
                    ? `Delete asset "${a.name}"?\n${linkedItems.length} linked breakdown item(s) will remain but asset link will be cleared.`
                    : `Delete asset "${a.name}"?`;
                  if (window.confirm(msg)) {
                    onUpdate((p) => deleteProductionEntity(p, 'assets', a.id));
                    setSelectedId('');
                  }
                }}
              >
                Delete asset
              </Button>,
            )}
        </RecordWorkspace>
      </>
    );
  }
  if (view === 'Shot Designer') {
    const shots = data.shots
      .filter((s) => s.sceneId === scene?.id)
      .sort((a, b) => a.order - b.order);
    const selected = shots.find((s) => s.id === selectedId);
    const addShot = (
      <Button
        disabled={!scene}
        onClick={() => scene && add('shots', createShot(p, scene.id))}
      >
        + Add shot
      </Button>
    );
    const move = (shot: Shot, offset: number) => {
      const index = shots.findIndex((s) => s.id === shot.id),
        other = shots[index + offset];
      if (!other) return;
      const ordered = [...shots];
      [ordered[index], ordered[index + offset]] = [
        ordered[index + offset],
        ordered[index],
      ];
      onUpdate((p) => ({
        ...p,
        shots: (p.shots ?? []).map((s) => {
          const at = ordered.findIndex((o) => o.id === s.id);
          return at < 0 ? s : { ...s, order: at };
        }),
      }));
    };
    content = (
      <>
        <div className="prod-toolbar">
          {scenePicker}
          {addShot}
          <Button
            variant="outline"
            onClick={() => setShowCoverage(!showCoverage)}
            aria-expanded={showCoverage}
          >
            Coverage
          </Button>
        </div>
        <RecordWorkspace
          rows={shots.map((s) => ({
            id: s.id,
            title: `${s.shotCode} — ${label(s.shotSize)} · ${label(s.movement)}`,
            subtitle: s.description || s.title || 'Describe this shot',
            meta: `${s.lens || 'Lens unset'} · ~${s.duration}s · ${
              p.characters
                .filter((c) => s.subjectIds.includes(c.id))
                .map((c) => c.name)
                .join(', ') || 'No subjects'
            }`,
            badge: (
              <StatusBadge warning={needsReview(p, s, [s.sceneId])}>
                {needsReview(p, s, [s.sceneId])
                  ? 'Script changed'
                  : p.panels.some((panel) => panel.shotId === s.id)
                    ? 'Storyboard ✓'
                    : 'No board'}
              </StatusBadge>
            ),
          }))}
          selectedId={selectedId}
          onSelect={setSelectedId}
          empty={
            <EmptyState
              title="No shots in this scene"
              description="Design camera coverage from the screenplay."
              action={addShot}
            />
          }
        >
          {selected &&
            inspect(
              selected.id,
              selected.shotCode,
              [
                'Basic',
                'Camera',
                'Composition',
                'Production',
                'Coverage',
                'Storyboard',
              ],
              <>
                <SourceReview
                  p={p}
                  record={selected}
                  ids={[selected.sceneId]}
                  onReview={() =>
                    patch(
                      'shots',
                      selected.id,
                      reviewSource(p, selected, [selected.sceneId]),
                    )
                  }
                />
                <Section name="Basic">
                  <Fields
                    record={selected}
                    fields={['shotCode', 'title', 'description', 'purpose']}
                    onChange={(v) => patch('shots', selected.id, v)}
                  />
                  <Select
                    title="Status"
                    value={selected.status}
                    options={['planned', 'ready', 'shot', 'omit']}
                    onChange={(status) =>
                      patch('shots', selected.id, { status })
                    }
                  />
                </Section>
                <Section name="Camera">
                  <Select
                    title="Shot size"
                    value={selected.shotSize}
                    options={shotSizes}
                    onChange={(shotSize) =>
                      patch('shots', selected.id, {
                        shotSize: shotSize as Shot['shotSize'],
                      })
                    }
                  />
                  <Select
                    title="Angle"
                    value={selected.angle}
                    options={['eye_level', 'high', 'low', 'top_down', 'dutch']}
                    onChange={(angle) => patch('shots', selected.id, { angle })}
                  />
                  <Field
                    title="Lens"
                    value={selected.lens}
                    onChange={(lens) => patch('shots', selected.id, { lens })}
                  />
                  <Select
                    title="Movement"
                    value={selected.movement}
                    options={[
                      'static',
                      'pan',
                      'tilt',
                      'push_in',
                      'pull_out',
                      'tracking',
                      'handheld',
                    ]}
                    onChange={(movement) =>
                      patch('shots', selected.id, { movement })
                    }
                  />
                  <div className="prod-fields">
                    {(['cameraHeight', 'fps', 'focalLength'] as const).map(
                      (key) => (
                        <Field
                          key={key}
                          title={label(key)}
                          value={selected[key]}
                          type="number"
                          onChange={(v) =>
                            patch('shots', selected.id, { [key]: Number(v) })
                          }
                        />
                      ),
                    )}
                  </div>
                </Section>
                <Section name="Composition">
                  <Multi
                    title="Subjects"
                    values={selected.subjectIds}
                    options={p.characters}
                    onChange={(subjectIds) =>
                      patch('shots', selected.id, { subjectIds })
                    }
                  />
                  <Fields
                    record={selected}
                    fields={['composition']}
                    onChange={(v) => patch('shots', selected.id, v)}
                  />
                </Section>
                <Section name="Production">
                  <Field
                    title="Duration (seconds)"
                    type="number"
                    value={selected.duration}
                    onChange={(v) =>
                      patch('shots', selected.id, { duration: Number(v) })
                    }
                  />
                  <Fields
                    record={selected}
                    fields={['lightingNotes', 'soundNotes', 'equipmentNotes']}
                    onChange={(v) => patch('shots', selected.id, v)}
                  />
                </Section>
                <Section name="Coverage">
                  <Multi
                    title="Screenplay blocks"
                    values={selected.coveredScriptBlockIds}
                    options={(scene?.blocks ?? [])
                      .filter((b) => ['action', 'dialogue'].includes(b.type))
                      .map((b) => ({
                        id: b.id,
                        name: `${label(b.type)} · ${b.content}`,
                      }))}
                    onChange={(coveredScriptBlockIds) =>
                      patch('shots', selected.id, { coveredScriptBlockIds })
                    }
                  />
                </Section>
                <Section name="Storyboard">
                  {(() => {
                    const panel = p.panels.find(
                      (panel) => panel.shotId === selected.id,
                    );
                    return panel ? (
                      <>
                        <StatusBadge
                          warning={
                            panel.shotRevision !== shotRevision(selected)
                          }
                        >
                          {panel.shotRevision !== shotRevision(selected)
                            ? 'Prompt needs review'
                            : 'Prompt current'}
                        </StatusBadge>
                        <p>
                          {panel.image ? 'Image attached' : 'No image yet'} ·{' '}
                          {panel.status}
                        </p>
                        {panel.image && (
                          <Image
                            unoptimized
                            width={800}
                            height={450}
                            src={panel.image}
                            alt={panel.description}
                            className="prod-panel-image"
                          />
                        )}
                        <p>{panel.description}</p>
                      </>
                    ) : (
                      <EmptyState
                        title="No storyboard panel"
                        action={
                          <Button onClick={() => makePanel(selected)}>
                            Add storyboard
                          </Button>
                        }
                      />
                    );
                  })()}
                </Section>
              </>,
              shots,
              <>
                <Button
                  variant="outline"
                  onClick={() => {
                    const next = {
                      ...selected,
                      ...entity(p.id),
                      shotCode: createShot(p, selected.sceneId).shotCode,
                      order: Math.max(0, ...data.shots.map((s) => s.order)) + 1,
                    };
                    delete next.storyboardPanelId;
                    add('shots', next);
                  }}
                >
                  Duplicate
                </Button>
                <Button
                  variant="ghost"
                  onClick={() =>
                    void navigator.clipboard
                      .writeText(`${selected.shotCode}
${selected.description}
${label(selected.shotSize)} · ${selected.lens} · ${selected.movement} · ${selected.duration}s`)
                      .catch(() => setError('Clipboard unavailable.'))
                  }
                >
                  Copy shot
                </Button>
                <Button
                  variant="ghost"
                  disabled={shots[0]?.id === selected.id}
                  onClick={() => move(selected, -1)}
                >
                  ↑
                </Button>
                <Button
                  variant="ghost"
                  disabled={shots.at(-1)?.id === selected.id}
                  onClick={() => move(selected, 1)}
                >
                  ↓
                </Button>
                <Button
                  variant="ghost"
                  onClick={() => {
                    const hasPanel = p.panels.some((panel) => panel.shotId === selected.id);
                    const msg = hasPanel
                      ? `Delete shot "${selected.shotCode}"?\nLinked storyboard panel will be unlinked and preserved for review.`
                      : `Delete shot "${selected.shotCode}"?`;
                    if (window.confirm(msg)) {
                      onUpdate((p) => deleteProductionEntity(p, 'shots', selected.id));
                      setSelectedId('');
                    }
                  }}
                >
                  Delete shot
                </Button>
              </>,
            )}
        </RecordWorkspace>
        {showCoverage && scene && (
          <Card title="Screenplay coverage">
            {coverage(p, scene.id).map(({ block, shots }) => (
              <div className="prod-coverage" key={block.id}>
                <p>{block.content || '(Empty block)'}</p>
                <div>
                  {shots.length ? (
                    shots.map((s) => (
                      <button
                        key={s.id}
                        className="prod-coverage-bar"
                        onClick={() => setSelectedId(s.id)}
                      >
                        {s.shotCode}
                      </button>
                    ))
                  ) : (
                    <span className="prod-uncovered">
                      Uncovered {block.type}
                    </span>
                  )}
                </div>
              </div>
            ))}
          </Card>
        )}
      </>
    );
  }
  if (view === 'Storyboard')
    content = (
      <>
        {scenePicker}
        {scene && (
          <>
            <div className="prod-toolbar">
              <Select
                title="Shot"
                value={selectedId}
                options={data.shots
                  .filter(
                    (s) =>
                      s.sceneId === scene.id &&
                      !p.panels.some((panel) => panel.shotId === s.id),
                  )
                  .map((s) => ({ id: s.id, name: s.shotCode }))}
                onChange={setSelectedId}
              />
              <Button
                onClick={() => {
                  const s = data.shots.find((s) => s.id === selectedId);
                  if (s && !p.panels.some((panel) => panel.shotId === s.id))
                    makePanel(s);
                }}
                disabled={
                  !data.shots.some(
                    (s) =>
                      s.id === selectedId &&
                      !p.panels.some((panel) => panel.shotId === s.id),
                  )
                }
              >
                Create panel for shot
              </Button>
            </div>
            <div className="prod-grid">
              {p.panels
                .filter((panel) => panel.sceneId === scene.id)
                .map((panel) => {
                  const shot = data.shots.find((s) => s.id === panel.shotId);
                  const stale =
                    !shot ||
                    panel.shotRevision !== shotRevision(shot) ||
                    !panel.sourceRevision ||
                    needsReview(p, panel as SourceLink, [panel.sceneId]);
                  return (
                    <Card
                      key={panel.id}
                      title={shot?.shotCode ?? 'Unlinked panel'}
                    >
                      {stale && (
                        <div className="prod-review stale">
                          <b>Source changed · Review required</b>
                          {shot && (
                            <>
                              <Button
                                variant="outline"
                                onClick={() => refreshPanel(panel, shot)}
                              >
                                Refresh generated prompt
                              </Button>
                              <Button
                                variant="ghost"
                                onClick={() =>
                                  panelPatch(panel.id, {
                                    shotRevision: shotRevision(shot),
                                    ...sourceLink(p, [panel.sceneId]),
                                    lastReviewedAt: new Date().toISOString(),
                                  })
                                }
                              >
                                Keep manual version
                              </Button>
                            </>
                          )}
                        </div>
                      )}
                      <p>
                        {shot
                          ? `${label(shot.shotSize)} · ${shot.lens || 'Lens unset'} · ${label(shot.movement)} · ${shot.duration}s`
                          : panel.description}
                      </p>
                      {panel.image && (
                        <Image
                          unoptimized
                          width={1600}
                          height={900}
                          className="prod-panel-image"
                          src={panel.image}
                          alt={
                            panel.description ||
                            shot?.shotCode ||
                            'Storyboard panel'
                          }
                        />
                      )}
                      <Field
                        title="Panel description"
                        value={panel.description}
                        multiline
                        onChange={(description) =>
                          panelPatch(panel.id, { description })
                        }
                      />
                      <Select
                        title="Storyboard status"
                        value={panel.status}
                        options={['Planned', 'Ready', 'Approved']}
                        onChange={(status) => panelPatch(panel.id, { status })}
                      />
                      <label className="prod-upload">
                        Upload frame
                        <input
                          type="file"
                          accept="image/jpeg,image/png,image/webp"
                          onChange={(e) => {
                            const f = e.target.files?.[0];
                            if (!f) return;
                            if (f.size > 12 * 1024 * 1024) {
                              setError(
                                'Storyboard images must be 12 MB or smaller.',
                              );
                              return;
                            }
                            const r = new FileReader();
                            r.onload = () =>
                              panelPatch(panel.id, { image: String(r.result) });
                            r.readAsDataURL(f);
                          }}
                        />
                      </label>
                      <details>
                        <summary>Storyboard prompt</summary>
                        <p className="prod-prompt">
                          {panel.generatedPrompt ||
                            'Refresh generated prompt to include the linked shot.'}
                        </p>
                        <Field
                          title="Custom prompt (preserved on refresh)"
                          value={panel.customPrompt}
                          multiline
                          onChange={(customPrompt) =>
                            panelPatch(panel.id, { customPrompt })
                          }
                        />
                      </details>
                    </Card>
                  );
                })}
            </div>
            {!data.shots.some((s) => s.sceneId === scene.id) && (
              <p>Design this scene’s shots in Shot Designer first.</p>
            )}
          </>
        )}
      </>
    );
  if (view === 'Shot list') {
    const shots = data.shots
      .filter(
        (s) =>
          (!sceneId || s.sceneId === sceneId) &&
          (!filterStatus || s.status === filterStatus) &&
          (!dayId ||
            data.shootDays
              .find((d) => d.id === dayId)
              ?.scheduledSceneIds.includes(s.sceneId)) &&
          (!filterLocation ||
            p.scenes.find((sc) => sc.id === s.sceneId)?.locationId ===
              filterLocation) &&
          (!filterCast ||
            p.scenes
              .find((sc) => sc.id === s.sceneId)
              ?.characterIds.some(
                (id) =>
                  p.characters.find((c) => c.id === id)?.castMemberId ===
                  filterCast,
              )),
      )
      .sort((a, b) => a.order - b.order);
    content = (
      <>
        <div className="prod-filters">
          <Select
            title="Scene"
            value={sceneId}
            options={sceneOptions}
            onChange={setSceneId}
            empty="All scenes"
          />
          <Select
            title="Story location"
            value={filterLocation}
            options={p.locations}
            onChange={setFilterLocation}
            empty="All locations"
          />
          <Select
            title="Cast"
            value={filterCast}
            options={data.castMembers}
            onChange={setFilterCast}
            empty="All cast"
          />
          <Select
            title="Shoot day"
            value={dayId}
            options={data.shootDays.map((d) => ({
              id: d.id,
              name: `Day ${d.number} · ${d.date}`,
            }))}
            onChange={setDayId}
            empty="All days"
          />
          <Select
            title="Status"
            value={filterStatus}
            options={['planned', 'ready', 'shot', 'omit']}
            onChange={setFilterStatus}
            empty="All statuses"
          />
        </div>
        <Button
          variant="outline"
          onClick={() => {
            const rows = [
              [
                'Shot',
                'Scene',
                'Description',
                'Size',
                'Lens',
                'Movement',
                'Duration',
                'Storyboard',
                'Production',
              ],
              ...shots.map((s) => [
                s.shotCode,
                p.scenes.findIndex((sc) => sc.id === s.sceneId) + 1,
                s.description,
                s.shotSize,
                s.lens,
                s.movement,
                s.duration,
                p.panels.find((panel) => panel.shotId === s.id)?.status ??
                  'No panel',
                s.status,
              ]),
            ];
            const csv = rows
              .map((row) =>
                row
                  .map(
                    (v) =>
                      '"' +
                      String(v)
                        .replace(/^[=+@-]/, "'$&")
                        .replace(/"/g, '""') +
                      '"',
                  )
                  .join(','),
              )
              .join('\n');
            const url = URL.createObjectURL(
              new Blob([csv], { type: 'text/csv' }),
            );
            const a = document.createElement('a');
            a.href = url;
            a.download = 'shot-list.csv';
            a.click();
            URL.revokeObjectURL(url);
          }}
        >
          Export shot list CSV
        </Button>
        <div className="prod-shot-table">
          <div className="prod-shot-row prod-shot-head">
            {[
              'Shot',
              'Scene',
              'Description',
              'Size / lens',
              'Movement / duration',
              'Storyboard',
              'Production',
            ].map((h) => (
              <b key={h}>{h}</b>
            ))}
          </div>
          {shots.map((s) => (
            <div className="prod-shot-row" key={s.id}>
              <b>{s.shotCode}</b>
              <span>
                Scene {p.scenes.findIndex((sc) => sc.id === s.sceneId) + 1}
              </span>
              <span>{s.description}</span>
              <span>
                {label(s.shotSize)} / {s.lens || '—'}
              </span>
              <span>
                {label(s.movement)} / {s.duration}s
              </span>
              <span>
                {p.panels.find((panel) => panel.shotId === s.id)?.status ??
                  'No panel'}
              </span>
              <span>
                {s.status}
                {needsReview(p, s, [s.sceneId]) ? ' · Source changed' : ''}
              </span>
            </div>
          ))}
        </div>
        {!shots.length && <p>No shots match. Add shots in Shot Designer.</p>}
      </>
    );
  }
  if (view === 'Schedule') {
    const unscheduled = p.scenes.filter(
      (s) => !data.shootDays.some((d) => d.scheduledSceneIds.includes(s.id)),
    );
    content = (
      <>
        <div className="prod-toolbar">
          <Button onClick={addDay}>+ Shoot day</Button>
          <span className="production-summary">
            {data.shootDays.length} days · {unscheduled.length} unscheduled
            scenes
          </span>
        </div>
        <div className="schedule-layout">
          <details className="schedule-unscheduled">
            <summary>Unscheduled scenes · {unscheduled.length}</summary>
            {unscheduled.map((s) => (
              <div
                key={s.id}
                className="schedule-scene"
                draggable
                onDragStart={() => setDragScene(s.id)}
              >
                <div>
                  <b>
                    {p.scenes.indexOf(s) + 1}. {s.heading}
                  </b>
                  <Select
                    title="Assign day"
                    value=""
                    options={dayOptions}
                    onChange={(id) => onUpdate((p) => assignScene(p, s.id, id))}
                  />
                </div>
              </div>
            ))}
          </details>
          <div className="schedule-days">
            {data.shootDays.map((d) => {
              const derived = callSheetData(p, d),
                unavailable = [...derived.cast, ...derived.locations].filter(
                  (c) =>
                    c.availability.some(
                      (a) => a.date === d.date && a.status === 'unavailable',
                    ),
                );
              return (
                <div
                  key={d.id}
                  onDragOver={(e) => e.preventDefault()}
                  onDrop={(e) => {
                    e.preventDefault();
                    if (dragScene)
                      onUpdate((p) => assignScene(p, dragScene, d.id));
                    setDragScene('');
                  }}
                >
                  <section className="prod-card calendar-day">
                    <div className="prod-card-heading">
                      <div>
                        <h3>Day {d.number}</h3>
                        <small style={{ color: 'var(--muted-foreground)', display: 'block', fontSize: '11px', marginTop: '2px' }}>
                          {derived.scenes.length} scene{derived.scenes.length !== 1 ? 's' : ''} · ~{derived.scenes.reduce((n, s) => n + (s.duration || 0), 0)}s runtime · {derived.cast.length} cast · {derived.locations.length} loc{derived.locations.length !== 1 ? 's' : ''}
                        </small>
                      </div>
                      <div style={{ display: 'flex', gap: '6px', alignItems: 'center' }}>
                        <StatusBadge>{label(d.status)}</StatusBadge>
                        <Button
                          variant="ghost"
                          onClick={() => {
                            const count = d.scheduledSceneIds.length;
                            const msg = count
                              ? `Delete Shoot Day ${d.number}?\n${count} scheduled scene(s) will return to Unscheduled.`
                              : `Delete Shoot Day ${d.number}?`;
                            if (window.confirm(msg)) {
                              onUpdate((p) => deleteProductionEntity(p, 'shootDays', d.id));
                            }
                          }}
                        >
                          Delete day
                        </Button>
                      </div>
                    </div>
                    <Field
                      title="Date"
                      type="date"
                      value={d.date}
                      onChange={(date) => patch('shootDays', d.id, { date })}
                    />
                    <SourceReview
                      p={p}
                      record={d}
                      ids={d.scheduledSceneIds}
                      onReview={() =>
                        patch(
                          'shootDays',
                          d.id,
                          reviewSource(p, d, d.scheduledSceneIds),
                        )
                      }
                    />
                    <div className="prod-fields">
                      <Field
                        title="General call"
                        type="time"
                        value={d.generalCallTime}
                        onChange={(generalCallTime) =>
                          patch('shootDays', d.id, { generalCallTime })
                        }
                      />
                      <Field
                        title="Estimated wrap"
                        type="time"
                        value={d.estimatedWrapTime}
                        onChange={(estimatedWrapTime) =>
                          patch('shootDays', d.id, { estimatedWrapTime })
                        }
                      />
                    </div>
                    <p>
                      {derived.locations.map((l) => l.name).join(' · ') ||
                        'Location unassigned'}
                    </p>
                    <div className="production-summary">
                      <b>{derived.scenes.length} scenes</b>
                      <span>
                        {derived.scenes.reduce((n, s) => n + s.duration, 0)} sec
                        screen runtime
                      </span>
                      <span>{derived.cast.length} cast</span>
                    </div>
                    {unavailable.length > 0 && (
                      <StatusBadge warning>
                        Unavailable: {unavailable.map((c) => c.name).join(', ')}
                      </StatusBadge>
                    )}
                    <div>
                      {d.scheduledSceneIds
                        .filter((id) => p.scenes.some((s) => s.id === id))
                        .map((id) => {
                          const scene = p.scenes.find((s) => s.id === id);
                          return (
                            <div
                              className="schedule-scene"
                              key={id}
                              draggable
                              onDragStart={() => setDragScene(id)}
                            >
                              <b>
                                {scene
                                  ? `${p.scenes.indexOf(scene) + 1}. ${scene.heading}`
                                  : 'Removed scene · Review'}
                              </b>
                              <Button
                                variant="ghost"
                                aria-label={`Unassign ${scene?.heading ?? 'scene'}`}
                                onClick={() =>
                                  onUpdate((p) => ({
                                    ...p,
                                    shootDays: productionData(p).shootDays.map(
                                      (day) =>
                                        day.id === d.id
                                          ? {
                                              ...day,
                                              scheduledSceneIds:
                                                day.scheduledSceneIds.filter(
                                                  (x) => x !== id,
                                                ),
                                            }
                                          : day,
                                    ),
                                  }))
                                }
                              >
                                ×
                              </Button>
                            </div>
                          );
                        })}
                      {!d.scheduledSceneIds.length && (
                        <p>
                          Drop scenes here, or assign them from Unscheduled.
                        </p>
                      )}
                    </div>
                    <CollapsibleSection title="Location, status & notes">
                      <Multi
                        title="Physical locations"
                        values={d.shootingLocationIds}
                        options={data.shootingLocations}
                        onChange={(shootingLocationIds) =>
                          patch('shootDays', d.id, { shootingLocationIds })
                        }
                      />
                      <Select
                        title="Status"
                        value={d.status}
                        options={['draft', 'confirmed', 'complete']}
                        onChange={(status) =>
                          patch('shootDays', d.id, { status })
                        }
                      />
                      <Fields
                        record={d}
                        fields={['notes']}
                        onChange={(v) => patch('shootDays', d.id, v)}
                      />
                    </CollapsibleSection>
                  </section>
                </div>
              );
            })}
            {!data.shootDays.length && (
              <EmptyState
                title="No shoot days yet"
                description="Plan dates, call times and daily workload."
                action={<Button onClick={addDay}>+ Shoot day</Button>}
              />
            )}
          </div>
        </div>
      </>
    );
  }
  if (view === 'Stripboard') {
    const groups = [
      ...data.shootDays.map((d) => ({
        day: d,
        ids: d.scheduledSceneIds.filter((id) =>
          p.scenes.some((s) => s.id === id),
        ),
      })),
      {
        day: undefined,
        ids: p.scenes
          .filter(
            (s) =>
              !data.shootDays.some((d) => d.scheduledSceneIds.includes(s.id)),
          )
          .map((s) => s.id),
      },
    ];
    content = (
      <>
        <div className="production-summary">
          <b>Production shooting order</b>
          <span>
            Drag strips within or between shoot days. Screenplay order stays
            unchanged.
          </span>
        </div>
        {groups.map(({ day, ids }) => (
          <section
            key={day?.id ?? 'unscheduled'}
            className="stripboard-group"
            onDragOver={(e) => e.preventDefault()}
            onDrop={(e) => {
              e.preventDefault();
              if (dragScene)
                onUpdate((p) => assignScene(p, dragScene, day?.id ?? ''));
              setDragScene('');
            }}
          >
            <header className="stripboard-day-title">
              <span>
                {day
                  ? `Shoot day ${day.number} · ${day.date || 'Undated'}`
                  : 'Unscheduled'}
              </span>
              <span>{ids.length} scenes</span>
            </header>
            {ids.map((id, index) => {
              const scene = p.scenes.find((s) => s.id === id);
              const heading = parseSceneHeading(scene?.heading ?? '');
              const cast = p.characters.filter((c) =>
                scene?.characterIds.includes(c.id),
              );
              const requirements = data.breakdownItems.filter(
                (i) =>
                  i.sceneId === id &&
                  !['cast', 'locations'].includes(i.category),
              );
              return (
                <div
                  key={id}
                  className={`production-strip${heading?.timeOfDay === 'NIGHT' ? ' night' : ''}`}
                  draggable
                  onDragStart={() => setDragScene(id)}
                  onDragOver={(e) => e.preventDefault()}
                  onDrop={(e) => {
                    e.preventDefault();
                    e.stopPropagation();
                    if (!day || !dragScene || dragScene === id) return;
                    onUpdate((p) => {
                      const assigned = assignScene(p, dragScene, day.id);
                      return {
                        ...assigned,
                        shootDays: productionData(assigned).shootDays.map(
                          (d) => {
                            if (d.id !== day.id) return d;
                            const order = d.scheduledSceneIds.filter(
                              (x) => x !== dragScene,
                            );
                            order.splice(order.indexOf(id), 0, dragScene);
                            return { ...d, scheduledSceneIds: order };
                          },
                        ),
                      };
                    });
                    setDragScene('');
                  }}
                >
                  <b>{scene ? p.scenes.indexOf(scene) + 1 : '—'}</b>
                  <span>{heading?.interiorExterior ?? 'Review'}</span>
                  <strong>{heading?.name ?? 'Removed scene'}</strong>
                  <span>{heading?.timeOfDay || '—'}</span>
                  <span>{scene?.duration ?? 0}s</span>
                  <span>{cast.map((c) => c.name).join(', ') || '—'}</span>
                  <Select
                    title="Shoot day"
                    value={day?.id ?? ''}
                    options={dayOptions}
                    empty="Unscheduled"
                    onChange={(dayId) =>
                      onUpdate((p) => assignScene(p, id, dayId))
                    }
                  />
                  <span className="strip-requirements">
                    {[
                      ...requirements.map(
                        (i) =>
                          data.assets.find((a) => a.id === i.linkedAssetId)
                            ?.name ?? i.name,
                      ),
                      ...data.characterLooks
                        .filter((l) => l.linkedSceneIds.includes(id))
                        .map((l) => l.name),
                    ].join(' · ') || 'No special requirements'}
                  </span>
                  <span className="strip-actions">
                    <Button
                      variant="ghost"
                      disabled={!day || index === 0}
                      aria-label="Move scene up"
                      onClick={() => day && moveStrip(day, id, -1)}
                    >
                      ↑
                    </Button>
                    <Button
                      variant="ghost"
                      disabled={!day || index === ids.length - 1}
                      aria-label="Move scene down"
                      onClick={() => day && moveStrip(day, id, 1)}
                    >
                      ↓
                    </Button>
                  </span>
                </div>
              );
            })}
            {!ids.length && <p>Drop scenes into this group.</p>}
          </section>
        ))}
      </>
    );
  }
  if (view === 'Call Sheets') {
    const day = data.shootDays.find((d) => d.id === dayId) ?? data.shootDays[0],
      sheet = data.callSheets.find((c) => c.shootDayId === day?.id);
    const currentTab = [
      'Details',
      'Cast',
      'Schedule',
      'Requirements',
      'Notes',
      'Preview',
    ].includes(tab)
      ? tab
      : 'Preview';
    const derived = day ? callSheetData(p, day) : undefined;
    content = (
      <>
        <div className="call-sheet-controls">
          <Select
            title="Shoot day"
            value={day?.id}
            options={dayOptions}
            onChange={setDayId}
          />
          {sheet && day && (
            <>
              <StatusBadge
                warning={sheet.sourceRevision !== callSheetRevision(p, day)}
              >
                {sheet.sourceRevision !== callSheetRevision(p, day)
                  ? 'Script / plan changed'
                  : 'Current plan'}
              </StatusBadge>
              <Button variant="outline" onClick={() => setTab('Preview')}>
                Preview
              </Button>
              <Button
                disabled={pdfBusy}
                onClick={async () => {
                  setPdfBusy(true);
                  setError('');
                  try {
                    const { exportCallSheet } = await import('@/app/call-sheet-pdf');
                    await exportCallSheet(p, day, sheet);
                  } catch (e) {
                    setError((e as Error).message);
                  } finally {
                    setPdfBusy(false);
                  }
                }}
              >
                {pdfBusy ? 'Preparing PDF…' : 'Export PDF'}
              </Button>
            </>
          )}
        </div>
        {!day ? (
          <EmptyState
            title="No shoot day selected"
            description="Create a shoot day in Schedule to prepare a call sheet."
          />
        ) : !sheet ? (
          <EmptyState
            title="No call sheet for this day"
            description="Start from the scheduled scenes, cast and department requirements."
            action={
              <Button
                onClick={() =>
                  add('callSheets', {
                    ...entity(p.id),
                    sourceRevision: callSheetRevision(p, day),
                    sourceSnapshot: callSheetSnapshot(p, day),
                    sourceUpdatedAt: p.updatedAt,
                    shootDayId: day.id,
                    productionContact: '',
                    notes: '',
                    castCallTimes: {},
                  })
                }
              >
                Create call sheet
              </Button>
            }
          />
        ) : (
          <>
            {sheet.sourceRevision !== callSheetRevision(p, day) && (
              <details className="compact-disclosure">
                <summary>⚠ Script / plan changed · Review</summary>
                <pre>{formatSourceSnapshot(sheet.sourceSnapshot)}</pre>
                <Button
                  variant="outline"
                  onClick={() =>
                    patch('callSheets', sheet.id, {
                      sourceRevision: callSheetRevision(p, day),
                      sourceSnapshot: callSheetSnapshot(p, day),
                      sourceUpdatedAt: p.updatedAt,
                      lastReviewedAt: new Date().toISOString(),
                    })
                  }
                >
                  Approve current plan, keep manual notes
                </Button>
              </details>
            )}
            <WorkspaceTabs
              tabs={[
                'Details',
                'Cast',
                'Schedule',
                'Requirements',
                'Notes',
                'Preview',
              ]}
              value={currentTab}
              onChange={setTab}
            />
            {currentTab === 'Preview' ? (
              <CallSheetPreview p={p} day={day} sheet={sheet} />
            ) : (
              <section className="call-sheet-section">
                {currentTab === 'Details' && (
                  <>
                    <div className="production-summary">
                      <span>{day.date || 'Date not set'}</span>
                      <span>Call {day.generalCallTime}</span>
                      <span>Wrap {day.estimatedWrapTime}</span>
                    </div>
                    <Fields
                      record={sheet}
                      fields={['productionContact']}
                      onChange={(v) => patch('callSheets', sheet.id, v)}
                    />
                    {derived?.locations.map((l) => (
                      <p key={l.id}>
                        <b>{l.name}</b> · {l.address} · {l.contactName}{' '}
                        {l.contactPhone}
                      </p>
                    ))}
                  </>
                )}
                {currentTab === 'Cast' &&
                  derived?.characters.map((c) => {
                    const actor = derived.cast.find(
                      (a) => a.id === c.castMemberId,
                    );
                    return (
                      <div key={c.id} className="record-row">
                        <span className="record-copy">
                          <strong>{actor?.name ?? 'Uncast'}</strong>
                          <span>{c.name}</span>
                        </span>
                        {actor ? (
                          <Field
                            title="Call time"
                            type="time"
                            value={
                              sheet.castCallTimes[actor.id] ??
                              day.generalCallTime
                            }
                            onChange={(time) =>
                              patch('callSheets', sheet.id, {
                                castCallTimes: {
                                  ...sheet.castCallTimes,
                                  [actor.id]: time,
                                },
                              })
                            }
                          />
                        ) : (
                          <StatusBadge warning>Unassigned</StatusBadge>
                        )}
                      </div>
                    );
                  })}
                {currentTab === 'Schedule' &&
                  derived?.scenes.map((s) => (
                    <p key={s.id}>
                      {p.scenes.indexOf(s) + 1}. {s.heading} · {s.duration}s
                    </p>
                  ))}
                {currentTab === 'Requirements' &&
                  breakdownCategories.map((category) => {
                    const items =
                      derived?.requirements.filter(
                        (i) => i.category === category,
                      ) ?? [];
                    return items.length ? (
                      <CollapsibleSection
                        key={category}
                        title={`${label(category)} · ${items.length}`}
                      >
                        {items.map((i) => (
                          <p key={i.id}>
                            {data.assets.find((a) => a.id === i.linkedAssetId)
                              ?.name ?? i.name}
                            {i.quantity ? ` × ${i.quantity}` : ''} · {i.notes}
                          </p>
                        ))}
                      </CollapsibleSection>
                    ) : null;
                  })}
                {currentTab === 'Notes' && (
                  <>
                    <p>{day.notes || 'No shoot-day notes.'}</p>
                    <Fields
                      record={sheet}
                      fields={['notes']}
                      onChange={(v) => patch('callSheets', sheet.id, v)}
                    />
                  </>
                )}
              </section>
            )}
          </>
        )}
      </>
    );
  }
  if (view === 'Continuity') {
    const records = data.continuityRecords.filter(
        (c) => c.sceneId === scene?.id,
      ),
      c = records.find((c) => c.id === selectedId);
    const addRecord = (
      <Button
        disabled={!scene}
        onClick={() =>
          scene &&
          add('continuityRecords', {
            ...entity(p.id),
            ...sourceLink(p, [scene.id]),
            sceneId: scene.id,
            storyDay: scene.storyDay,
            wardrobe: '',
            hair: '',
            makeup: '',
            propsState: '',
            objectState: '',
            injuriesDirtWetness: '',
            foodDrinkState: '',
            screenDirectionNotes: '',
            photos: [],
            notes: '',
          })
        }
      >
        + Continuity record
      </Button>
    );
    content = (
      <>
        <div className="prod-toolbar">
          {scenePicker}
          {scene && <StatusBadge>Story day {scene.storyDay}</StatusBadge>}
          {addRecord}
        </div>
        <RecordWorkspace
          rows={records.map((c) => {
            const charName = p.characters.find((ch) => ch.id === c.characterId)?.name ?? 'Unassigned character';
            const lookName = data.characterLooks.find((l) => l.id === c.characterLookId)?.name ?? 'General scene continuity';
            return {
              id: c.id,
              title: `${charName} — ${lookName}`,
              subtitle: `Story day ${c.storyDay ?? scene?.storyDay ?? 1} · Wardrobe ${c.wardrobe ? '✓' : '—'} · Hair ${c.hair ? '✓' : '—'} · Makeup ${c.makeup ? '✓' : '—'}`,
              meta: `${c.photos.length} photo${c.photos.length !== 1 ? 's' : ''} · Prev: ${c.previousSceneId ? `Sc ${p.scenes.findIndex((s) => s.id === c.previousSceneId) + 1}` : 'None'} · Next: ${c.nextSceneId ? `Sc ${p.scenes.findIndex((s) => s.id === c.nextSceneId) + 1}` : 'None'}`,
              badge: needsReview(p, c, [c.sceneId]) ? (
                <StatusBadge warning>Script changed</StatusBadge>
              ) : undefined,
            };
          })}
          selectedId={selectedId}
          onSelect={setSelectedId}
          empty={
            <EmptyState
              title="No continuity records for this scene"
              description="Capture the look and state that need to match between takes."
              action={addRecord}
            />
          }
        >
          {c &&
            inspect(
              c.id,
              p.characters.find((ch) => ch.id === c.characterId)?.name ??
                'Scene continuity',
              ['Photos', 'Look', 'Props', 'State', 'Links'],
              <>
                <SourceReview
                  p={p}
                  record={c}
                  ids={[c.sceneId]}
                  onReview={() =>
                    patch(
                      'continuityRecords',
                      c.id,
                      reviewSource(p, c, [c.sceneId]),
                    )
                  }
                />
                <Section name="Photos">
                  {files(
                    c.photos,
                    (photos) => patch('continuityRecords', c.id, { photos }),
                    true,
                  )}
                  <Select
                    title="Character"
                    value={c.characterId}
                    options={p.characters}
                    onChange={(characterId) =>
                      patch('continuityRecords', c.id, {
                        characterId,
                        characterLookId: '',
                      })
                    }
                  />
                  <Select
                    title="Look"
                    value={c.characterLookId}
                    options={data.characterLooks.filter(
                      (l) => l.characterId === c.characterId,
                    )}
                    onChange={(characterLookId) =>
                      patch('continuityRecords', c.id, { characterLookId })
                    }
                  />
                  <Fields
                    record={c}
                    fields={['notes']}
                    onChange={(v) => patch('continuityRecords', c.id, v)}
                  />
                </Section>
                <Section name="Look">
                  <Fields
                    record={c}
                    fields={['wardrobe', 'hair', 'makeup']}
                    onChange={(v) => patch('continuityRecords', c.id, v)}
                  />
                </Section>
                <Section name="Props">
                  <Select
                    title="Asset"
                    value={c.assetId}
                    options={data.assets}
                    onChange={(assetId) =>
                      patch('continuityRecords', c.id, { assetId })
                    }
                  />
                  <Fields
                    record={c}
                    fields={['propsState', 'objectState']}
                    onChange={(v) => patch('continuityRecords', c.id, v)}
                  />
                </Section>
                <Section name="State">
                  <Fields
                    record={c}
                    fields={[
                      'injuriesDirtWetness',
                      'foodDrinkState',
                      'screenDirectionNotes',
                    ]}
                    onChange={(v) => patch('continuityRecords', c.id, v)}
                  />
                </Section>
                <Section name="Links">
                  <Field
                    title="Story day"
                    type="number"
                    value={c.storyDay}
                    onChange={(v) =>
                      patch('continuityRecords', c.id, { storyDay: Number(v) })
                    }
                  />
                  <Select
                    title="Shoot day"
                    value={c.shootDayId}
                    options={dayOptions.filter((d) =>
                      data.shootDays
                        .find((x) => x.id === d.id)
                        ?.scheduledSceneIds.includes(c.sceneId),
                    )}
                    onChange={(shootDayId) =>
                      patch('continuityRecords', c.id, { shootDayId })
                    }
                  />
                  <Select
                    title="Previous scene"
                    value={c.previousSceneId}
                    options={sceneOptions.filter((s) => s.id !== c.sceneId)}
                    onChange={(previousSceneId) =>
                      patch('continuityRecords', c.id, { previousSceneId })
                    }
                  />
                  <Select
                    title="Next scene"
                    value={c.nextSceneId}
                    options={sceneOptions.filter((s) => s.id !== c.sceneId)}
                    onChange={(nextSceneId) =>
                      patch('continuityRecords', c.id, { nextSceneId })
                    }
                  />
                </Section>
              </>,
              records,
              <Button
                key="delete-continuity"
                variant="ghost"
                onClick={() => {
                  if (window.confirm('Delete this continuity record?')) {
                    onUpdate((p) => deleteProductionEntity(p, 'continuityRecords', c.id));
                    setSelectedId('');
                  }
                }}
              >
                Delete continuity record
              </Button>,
            )}
        </RecordWorkspace>
      </>
    );
  }
  if (view === 'Documents') {
    const d = data.documents.find((d) => d.id === selectedId);
    const addDocument = (
      <Button
        onClick={() =>
          add('documents', {
            ...entity(p.id),
            name: 'New document',
            type: 'production_notes',
            files: [],
            notes: '',
          })
        }
      >
        + Document
      </Button>
    );
    content = (
      <RecordWorkspace
        rows={data.documents.map((d) => ({
          id: d.id,
          title: d.name,
          subtitle: label(d.type),
          meta: `${d.files.length} files`,
        }))}
        selectedId={selectedId}
        onSelect={setSelectedId}
        toolbar={addDocument}
        empty={
          <EmptyState
            title="No production documents yet"
            action={addDocument}
          />
        }
      >
        {d &&
          inspect(
            d.id,
            d.name,
            ['Details', 'Files', 'Links'],
            <>
              <Section name="Details">
                <Fields
                  record={d}
                  fields={['name', 'notes']}
                  onChange={(v) => patch('documents', d.id, v)}
                />
                <Select
                  title="Type"
                  value={d.type}
                  options={[
                    'location_permission',
                    'release',
                    'contract',
                    'call_sheet',
                    'floor_plan',
                    'reference_pdf',
                    'audition',
                    'recce',
                    'production_notes',
                  ]}
                  onChange={(type) => patch('documents', d.id, { type })}
                />
              </Section>
              <Section name="Files">
                {files(d.files, (files) => patch('documents', d.id, { files }))}
              </Section>
              <Section name="Links">
                <Select
                  title="Scene"
                  value={d.sceneId}
                  options={sceneOptions}
                  onChange={(sceneId) => patch('documents', d.id, { sceneId })}
                />
                <Select
                  title="Cast"
                  value={d.castMemberId}
                  options={data.castMembers}
                  onChange={(castMemberId) =>
                    patch('documents', d.id, { castMemberId })
                  }
                />
                <Select
                  title="Shooting location"
                  value={d.shootingLocationId}
                  options={data.shootingLocations}
                  onChange={(shootingLocationId) =>
                    patch('documents', d.id, { shootingLocationId })
                  }
                />
                <Select
                  title="Shoot day"
                  value={d.shootDayId}
                  options={dayOptions}
                  onChange={(shootDayId) =>
                    patch('documents', d.id, { shootDayId })
                  }
                />
              </Section>
            </>,
            data.documents,
            <Button
              key="delete-document"
              variant="ghost"
              onClick={() => {
                if (window.confirm(`Delete document "${d.name}"?`)) {
                  onUpdate((p) => deleteProductionEntity(p, 'documents', d.id));
                  setSelectedId('');
                }
              }}
            >
              Delete document
            </Button>,
          )}
      </RecordWorkspace>
    );
  }

  return (
    <div className="production-workspace">
      <SceneQuarantine project={p} onUpdate={onUpdate} />

      {error && (
        <div role="alert" className="prod-review stale">
          {error}
          <Button variant="ghost" onClick={() => setError('')}>
            Dismiss
          </Button>
        </div>
      )}
      {content}
    </div>
  );
}
export function CallSheetPreview({
  p,
  day,
  sheet,
}: {
  p: Project;
  day: ShootDay;
  sheet: CallSheet;
}) {
  const data = callSheetData(p, day);
  return (
    <article className="prod-call-sheet">
      <header>
        <p>CALL SHEET</p>
        <h2>{p.title}</h2>
        <h3>
          {day.date || 'Date not set'} · SHOOT DAY {day.number}
        </h3>
        <p>
          GENERAL CALL {day.generalCallTime} · ESTIMATED WRAP{' '}
          {day.estimatedWrapTime}
        </p>
      </header>
      <section>
        <h3>Locations</h3>
        {data.locations.map((l) => (
          <div key={l.id}>
            <b>{l.name}</b>
            <p>{l.address}</p>
            <p>
              {l.contactName} · {l.contactPhone}
            </p>
            {validCoordinates(l.lat, l.lng) && (
              <a
                href={mapProvider.directionsUrl({
                  lat: l.lat!,
                  lng: l.lng!,
                  address: l.address,
                })}
                target="_blank"
                rel="noreferrer"
              >
                Map / directions
              </a>
            )}
          </div>
        ))}
      </section>
      <section>
        <h3>Scenes · Production order</h3>
        {data.scenes.map((s) => (
          <p key={s.id}>
            {p.scenes.indexOf(s) + 1}. {s.heading} · {s.duration}s
          </p>
        ))}
      </section>
      <section>
        <h3>Cast</h3>
        {data.characters.map((c) => {
          const actor = data.cast.find((a) => a.id === c.castMemberId);
          return (
            <p key={c.id}>
              <b>{actor?.name ?? 'UNCAST'}</b> · {c.name} · Call{' '}
              {actor
                ? (sheet.castCallTimes[actor.id] ?? day.generalCallTime)
                : 'TBC'}
            </p>
          );
        })}
      </section>
      <section>
        <h3>Departments / requirements</h3>
        {breakdownCategories
          .filter((c) => !['cast', 'locations'].includes(c))
          .map((category) => {
            const items = data.requirements.filter(
              (i) => i.category === category,
            );
            return items.length ? (
              <div key={category}>
                <b>{label(category)}</b>
                {items.map((i) => (
                  <p key={i.id}>
                    {p.assets?.find((a) => a.id === i.linkedAssetId)?.name ??
                      i.name}{' '}
                    {i.quantity ? `× ${i.quantity}` : ''} · {i.notes}
                  </p>
                ))}
              </div>
            ) : null;
          })}
      </section>
      <section>
        <h3>Production contact</h3>
        <p>{sheet.productionContact || 'Not set'}</p>
        <h3>Notes</h3>
        <p>{day.notes}</p>
        <p>{sheet.notes}</p>
      </section>
    </article>
  );
}
