'use client';
import { useEffect, useRef, useState, type ReactNode } from 'react';
import {
  Clapperboard,
  LayoutDashboard,
  BookOpen,
  Columns3,
  FileText,
  Images,
  ListVideo,
  Users,
  MapPin,
  Download,
  ChevronRight,
  Plus,
  ArrowUpRight,
  Check,
  ArrowUp,
  ArrowDown,
  ImagePlus,
  GripVertical,
  Clock,
  X,
  Save,
  Palette,
  Trash2,
  Sparkles,
  Copy,
  RefreshCw,
} from 'lucide-react';
import { planSceneStoryboard } from '@/lib/storyboard-planner';
import {
  buildStoryboardPrompt,
  computeSceneContentHash,
  shotSizeLabel,
  cameraAngleLabel,
  cameraMovementLabel,
} from '@/lib/prompt-compiler';
import {
  SidebarProvider,
  Sidebar,
  SidebarHeader,
  SidebarContent,
  SidebarFooter,
  SidebarMenu,
  SidebarMenuItem,
  SidebarMenuButton,
  SidebarTrigger,
} from '@/components/ui/sidebar';
import {
  Dialog,
  DialogContent,
  DialogTitle,
  DialogDescription,
} from '@/components/ui/dialog';
import {
  Sheet,
  SheetContent,
  SheetHeader,
  SheetTitle,
  SheetDescription,
} from '@/components/ui/sheet';
import {
  DropdownMenu,
  DropdownMenuTrigger,
  DropdownMenuContent,
  DropdownMenuItem,
} from '@/components/ui/dropdown-menu';
import {
  Table,
  TableHeader,
  TableBody,
  TableHead,
  TableRow,
  TableCell,
} from '@/components/ui/table';
import { RadioGroup, RadioGroupItem } from '@/components/ui/radio-group';
import { Progress } from '@/components/ui/progress';
import { Button } from '@/components/ui/button';
import { Empty as EmptyPrimitive } from '@/components/ui/empty';
import { Input } from '@/components/ui/input';
import { Textarea } from '@/components/ui/textarea';
import {
  blankProject,
  createSeries,
  createEpisode,
  updateWorkspace,
  episodeLabel,
  newScene,
  reconcile,
  moveScene,
  screenplayText,
  fountainText,
  uid,
  type Project,
  type Scene,
  type Panel,
  type Person,
} from '@/lib/project';
import ScriptEditor from './script-editor';
import { deleteElement, type DeleteKind } from '@/lib/deletions';
import {
  AlertDialog,
  AlertDialogContent,
  AlertDialogTitle,
  AlertDialogDescription,
  AlertDialogFooter,
} from '@/components/ui/alert-dialog';
import { useWorkspace } from './use-workspace';
import { Switch } from '@/components/ui/switch';
import { useBackups } from './use-backups';
import { readBackups, backupIntervals } from '@/lib/backups';
import ImportWorkspace from './import-workspace';
import { importTabs, type ImportTab } from '@/lib/imports';
import { useDeviceMode } from '@/hooks/use-device-mode';
import { MobileProjectHeader } from '@/components/mobile/mobile-project-header';
import { MobileBottomNav } from '@/components/mobile/mobile-bottom-nav';
import { MobileSceneCards } from '@/components/mobile/mobile-scene-cards';
import { MobileStoryboard } from '@/components/mobile/mobile-storyboard';
import { MobileEntities } from '@/components/mobile/mobile-entities';
import { MobileShotList } from '@/components/mobile/mobile-shot-list';
const nav = [
  ['Overview', LayoutDashboard],
  ['Story', BookOpen],
  ['Scene cards', Columns3],
  ['Screenplay', FileText],
  ['Storyboard', Images],
  ['Shot list', ListVideo],
  ['Characters', Users],
  ['Locations', MapPin],
  ['Export', Download],
] as const;
const descriptions: Record<string, string> = {
  'Series overview':
    'Shape the series. Develop each episode in its own workspace.',
  Overview: 'Your story, from the first thought to the final frame.',
  Story: 'Give your story a foundation.',
  'Scene cards': 'Every scene has a purpose. Find your story’s rhythm.',
  Screenplay: 'Make room for the words that matter.',
  Storyboard: 'See the story, one frame at a time.',
  'Shot list': 'Every frame. Every camera choice. One connected plan.',
  Characters: 'The people who give your story life.',
  Locations: 'The places your story calls home.',
  Export: 'Take your work into the next stage.',
};
const emotionColours = [
  { name: 'None', colour: '' },
  { name: 'Joy', colour: '#d8ad35' },
  { name: 'Hope', colour: '#78a75e' },
  { name: 'Tension', colour: '#ce665c' },
  { name: 'Sadness', colour: '#6689bd' },
  { name: 'Love', colour: '#c77f9f' },
  { name: 'Mystery', colour: '#9480bc' },
];
const pad = (n: number) => String(n).padStart(2, '0');
const time = (n: number) => pad(Math.floor(n / 60)) + ':' + pad(n % 60);
function Field({
  label,
  value,
  onChange,
  multiline = false,
  type = 'text',
}: {
  label: string;
  value: string | number;
  onChange: (value: string) => void;
  multiline?: boolean;
  type?: string;
}) {
  return (
    <label className="field">
      <span>{label}</span>
      {multiline ? (
        <Textarea
          value={value}
          onChange={(e) => onChange(e.target.value)}
          rows={3}
        />
      ) : (
        <Input
          value={value}
          type={type}
          min={type === 'number' ? 0 : undefined}
          onChange={(e) => onChange(e.target.value)}
        />
      )}
    </label>
  );
}
function Choice({
  label,
  value,
  options,
  onChange,
}: {
  label?: string;
  value: string;
  options: string[];
  onChange: (v: string) => void;
}) {
  return (
    <div className="field">
      {label && <span>{label}</span>}
      <DropdownMenu>
        <DropdownMenuTrigger
          render={<Button variant="outline" className="choice" />}
        >
          {value || 'Choose'} <ChevronRight size={13} />
        </DropdownMenuTrigger>
        <DropdownMenuContent>
          {options.map((o) => (
            <DropdownMenuItem key={o} onClick={() => onChange(o)}>
              {o}
            </DropdownMenuItem>
          ))}
        </DropdownMenuContent>
      </DropdownMenu>
    </div>
  );
}
function download(blob: Blob, name: string) {
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url;
  a.download = name;
  a.click();
  setTimeout(() => URL.revokeObjectURL(url), 1000);
}
export default function Home() {
  const {
    projects,
    setProjects,
    deleteProject,
    loaded,
    user,
    scope,
    saved,
    cloudStatus,
    error: syncError,
    authBusy,
    configured,
    signIn,
    signOut,
    retry: retrySync,
  } = useWorkspace();
  const { isMobile } = useDeviceMode();
  const [projectId, setProjectId] = useState(''),
    [view, setView] = useState('Scene cards'),
    [dashboard, setDashboard] = useState(false),
    [notice, setNotice] = useState(''),
    [create, setCreate] = useState(false),
    [title, setTitle] = useState(''),
    [format, setFormat] = useState('Short Film'),
    [projectKind, setProjectKind] = useState('single'),
    [episodeCount, setEpisodeCount] = useState('1'),
    [episodeId, setEpisodeId] = useState(''),
    [episodeDialog, setEpisodeDialog] = useState(false),
    [episodeTitle, setEpisodeTitle] = useState(''),
    [season, setSeason] = useState('1'),
    [sceneId, setSceneId] = useState(''),
    [inspect, setInspect] = useState(false),
    [drag, setDrag] = useState(''),
    [entityId, setEntityId] = useState(''),
    [newEntity, setNewEntity] = useState(false),
    [panelEdit, setPanelEdit] = useState<Panel | null>(null),
    [promptModalPanel, setPromptModalPanel] = useState<Panel | null>(null),
    [autoPlanScene, setAutoPlanScene] = useState<Scene | null>(null),
    [replacePanels, setReplacePanels] = useState(false),
    [copiedPrompt, setCopiedPrompt] = useState(false),
    [editingCustomPrompt, setEditingCustomPrompt] = useState(false),
    [customPromptDraft, setCustomPromptDraft] = useState(''),
    [exporting, setExporting] = useState(false),
    [actName, setActName] = useState(''),
    [addAct, setAddAct] = useState(false),
    [deletion, setDeletion] = useState<{
      kind: DeleteKind;
      id: string;
      name: string;
      rootId: string;
      workspaceId: string;
    } | null>(null);
  const [scriptTypingFocus, setScriptTypingFocus] = useState(false);
  const rootProject = projects.find((p) => p.id === projectId) ?? projects[0];
  const isSeries = rootProject?.kind === 'series';
  const activeEpisode =
    rootProject?.episodes?.find((e) => e.id === episodeId) ??
    rootProject?.episodes?.[0];
  const project =
    isSeries && view !== 'Series overview'
      ? (activeEpisode ?? rootProject)
      : rootProject;
  const scene =
    project?.scenes.find((s) => s.id === sceneId) ?? project?.scenes[0];
  const { lastBackups, backupErrors } = useBackups(projects, loaded, scope);
  useEffect(() => {
    setDeletion(null);
    setProjectId('');
    setEpisodeId('');
    setSceneId('');
    setEntityId('');
    setInspect(false);
    setPanelEdit(null);
    setCreate(false);
    setEpisodeDialog(false);
    setNewEntity(false);
    setAddAct(false);
    setView('Overview');
    setDashboard(true);
  }, [scope]);
  const current = useRef(projects);
  current.current = projects;
  useEffect(() => {
    if (!notice) return;
    const t = setTimeout(() => setNotice(''), 5500);
    return () => clearTimeout(t);
  }, [notice]);
  function update(fn: (p: Project) => Project) {
    setProjects((all) =>
      all.map((p) =>
        p.id === rootProject.id ? updateWorkspace(p, project.id, fn) : p,
      ),
    );
  }
  function patchScene(id: string, patch: Partial<Scene>) {
    update((p) =>
      reconcile({
        ...p,
        scenes: p.scenes.map((s) => (s.id === id ? { ...s, ...patch } : s)),
      }),
    );
  }
  function addScene(act = project.acts[0]) {
    const s = newScene(act);
    update((p) =>
      reconcile(moveScene({ ...p, scenes: [...p.scenes, s] }, s.id, act)),
    );
    setSceneId(s.id);
    setInspect(true);
  }
  function openScene(id: string) {
    setSceneId(id);
    setInspect(true);
  }
  function reorder(id: string, act: string, before?: string) {
    update((p) => moveScene(p, id, act, before));
  }
  function shiftScene(id: string, delta: number) {
    const index = project.scenes.findIndex((s) => s.id === id),
      target = project.scenes[index + delta];
    if (!target) return;
    update((p) => {
      const scenes = [...p.scenes];
      [scenes[index], scenes[index + delta]] = [
        { ...scenes[index + delta], act: scenes[index].act },
        { ...scenes[index], act: scenes[index + delta].act },
      ];
      return { ...p, scenes };
    });
  }
  function makeProject() {
    if (!title.trim()) return;
    if (
      projectKind === 'series' &&
      (!Number.isInteger(Number(episodeCount)) ||
        Number(episodeCount) < 1 ||
        Number(episodeCount) > 50)
    )
      return;
    const p =
      projectKind === 'series'
        ? createSeries(title.trim(), Number(episodeCount))
        : blankProject(title.trim(), format);
    setProjects((all) => [p, ...all]);
    setProjectId(p.id);
    setDashboard(false);
    setView(p.kind === 'series' ? 'Series overview' : 'Story');
    setEpisodeId(p.episodes?.[0]?.id ?? '');
    setCreate(false);
    setTitle('');
    setSceneId('');
  }
  function selectEpisode(id: string) {
    setEpisodeId(id);
    setSceneId('');
    setEntityId('');
    setInspect(false);
    setPanelEdit(null);
    setDrag('');
    setDashboard(false);
    if (view === 'Series overview') setView('Overview');
  }
  function addEpisode() {
    const n = Number(season);
    if (!episodeTitle.trim() || !Number.isInteger(n) || n < 1 || n > 100)
      return;
    const number =
      Math.max(
        0,
        ...(rootProject.episodes ?? [])
          .filter((e) => e.seasonNumber === n)
          .map((e) => e.episodeNumber ?? 0),
      ) + 1;
    const ep = createEpisode(episodeTitle.trim(), n, number);
    setProjects((all) =>
      all.map((p) =>
        p.id === rootProject.id
          ? {
              ...p,
              updatedAt: new Date().toISOString(),
              episodes: [...(p.episodes ?? []), ep],
            }
          : p,
      ),
    );
    selectEpisode(ep.id);
    setView('Story');
    setEpisodeDialog(false);
    setEpisodeTitle('');
  }
  function setBackupSettings(
    patch: Partial<{ enabled: boolean; intervalMinutes: number }>,
  ) {
    setProjects((all) =>
      all.map((p) =>
        p.id === rootProject.id
          ? {
              ...p,
              backupSettings: {
                enabled: false,
                intervalMinutes: 15,
                ...p.backupSettings,
                ...patch,
              },
            }
          : p,
      ),
    );
  }
  async function downloadLatestBackup() {
    try {
      const records = await readBackups(rootProject.id, scope);
      if (!records.length) {
        setNotice('No automatic backup yet.');
        return;
      }
      const latest = records[0];
      download(
        new Blob([JSON.stringify(latest.project, null, 2)], {
          type: 'application/json',
        }),
        rootProject.title +
          '-backup-' +
          new Date(latest.savedAt).toISOString().replaceAll(':', '-') +
          '.json',
      );
    } catch {
      setNotice('Could not read the local backup. Please try again.');
    }
  }
  function askDelete(kind: DeleteKind, id: string, name: string) {
    setDeletion({
      kind,
      id,
      name,
      rootId: rootProject.id,
      workspaceId: kind === 'episode' ? rootProject.id : project.id,
    });
  }
  function confirmDelete() {
    if (!deletion) return;
    setProjects((all) =>
      all.map((p) =>
        p.id === deletion.rootId
          ? updateWorkspace(p, deletion.workspaceId, (w) =>
              deleteElement(w, deletion.kind, deletion.id),
            )
          : p,
      ),
    );
    setDeletion(null);
    setInspect(false);
    setEntityId('');
    setPanelEdit(null);
    setSceneId('');
    if (deletion.kind === 'episode') {
      setEpisodeId('');
      setView('Series overview');
    }
    setNotice(
      deletion.kind === 'story'
        ? 'Story content cleared.'
        : 'Deleted. Linked workspaces updated.',
    );
  }
  function addPanel() {
    if (!scene) return;
    setPanelEdit({
      id: uid(),
      sceneId: scene.id,
      size: 'Wide',
      angle: 'Eye-level',
      lens: '35mm',
      movement: 'Static',
      duration: 3,
      description: '',
      status: 'Planned',
    });
  }
  async function upload(file?: File) {
    if (!file) return;
    if (!file.type.startsWith('image/')) {
      setNotice('Choose an image file.');
      return;
    }
    if (file.size > 8 * 1024 * 1024) {
      setNotice('Choose an image under 8 MB for this local demo.');
      return;
    }
    const reader = new FileReader();
    reader.onload = () =>
      setPanelEdit((p) => (p ? { ...p, image: String(reader.result) } : p));
    reader.readAsDataURL(file);
  }

  const uploadImageForPanel = (file: File, panelId: string) => {
    if (!file || !file.type.startsWith('image/')) {
      setNotice('Choose an image file.');
      return;
    }
    if (file.size > 8 * 1024 * 1024) {
      setNotice('Choose an image under 8 MB for this local demo.');
      return;
    }
    const reader = new FileReader();
    reader.onload = () => {
      const dataUrl = String(reader.result);
      update((p) => ({
        ...p,
        panels: p.panels.map((panel) =>
          panel.id === panelId ? { ...panel, image: dataUrl } : panel,
        ),
      }));
      setNotice('Storyboard frame updated.');
    };
    reader.readAsDataURL(file);
  };

  const removeImageForPanel = (panelId: string) => {
    update((p) => ({
      ...p,
      panels: p.panels.map((panel) =>
        panel.id === panelId ? { ...panel, image: undefined } : panel,
      ),
    }));
    setNotice('Image removed from storyboard panel.');
  };

  const updatePanel = (panel: Panel) => {
    update((p) => ({
      ...p,
      panels: p.panels.map((x) => (x.id === panel.id ? panel : x)),
    }));
    setNotice('Panel updated.');
  };

  async function exportFile(kind: string) {
    const exportTitle = isSeries
      ? rootProject.title +
        ' - ' +
        episodeLabel(project) +
        ' - ' +
        project.title
      : project.title;
    const exportProject = { ...project, title: exportTitle };
    setExporting(true);
    try {
      if (kind === 'PDF') {
        const { screenplayPDF } = await import('./pdf-export');
        download(await screenplayPDF(exportProject), exportTitle + '.pdf');
      } else if (kind === 'Backup') {
        download(
          new Blob([JSON.stringify(rootProject, null, 2)], {
            type: 'application/json',
          }),
          rootProject.title + '.json',
        );
      } else if (kind === 'Shot list') {
        const rows = [
          ['Shot', 'Scene', 'Size', 'Movement', 'Lens', 'Duration', 'Status'],
          ...project.scenes.flatMap((s, i) =>
            project.panels
              .filter((p) => p.sceneId === s.id)
              .map((p, j) => [
                pad(i + 1) + String.fromCharCode(65 + j),
                s.heading,
                p.size,
                p.movement,
                p.lens,
                String(p.duration),
                p.status,
              ]),
          ),
        ];
        download(
          new Blob(
            [
              rows
                .map((r) =>
                  r.map((v) => '"' + v.replaceAll('"', '""') + '"').join(','),
                )
                .join('\n'),
            ],
            { type: 'text/csv' },
          ),
          exportTitle + '-shots.csv',
        );
      } else
        download(
          new Blob(
            [
              kind === 'Fountain'
                ? fountainText(exportProject)
                : screenplayText(exportProject),
            ],
            { type: 'text/plain' },
          ),
          exportTitle + (kind === 'Fountain' ? '.fountain' : '.txt'),
        );
      setNotice('Export downloaded.');
    } catch {
      setNotice('Export failed. Please try again.');
    } finally {
      setExporting(false);
    }
  }
  useEffect(() => {
    const ctx = (
      document as unknown as {
        modelContext?: {
          registerTool: (tool: unknown, opts: unknown) => Promise<void>;
        };
      }
    ).modelContext;
    if (!ctx) return;
    const abort = new AbortController();
    Promise.resolve(
      ctx.registerTool(
        {
          name: 'read_screenplay_projects',
          description: 'Read local project titles and ordered scenes.',
          inputSchema: {
            type: 'object',
            properties: {},
            additionalProperties: false,
          },
          annotations: { readOnlyHint: true, untrustedContentHint: true },
          execute: () =>
            current.current.map((p) => ({
              id: p.id,
              title: p.title,
              scenes: p.scenes.map((s, i) => ({
                id: s.id,
                number: i + 1,
                heading: s.heading,
                act: s.act,
              })),
            })),
        },
        { signal: abort.signal },
      ),
    ).catch(() => {});
    return () => abort.abort();
  }, []);
  if (!loaded)
    return (
      <div className="loading">
        <Clapperboard />
        <h1>Draft-it PRO</h1>
        <p>{syncError || 'Opening your workspace…'}</p>
      </div>
    );
  if (!project)
    return (
      <div className="loading">
        <Clapperboard />
        <h1>Your workspace</h1>
        <p>{cloudStatus}</p>
        {syncError && <p role="alert">{syncError}</p>}
        <button
          className="primary"
          onClick={() =>
            setProjects([blankProject('Untitled project', 'Short Film')])
          }
        >
          Create your first project
        </button>
        {user && (
          <Button variant="outline" onClick={signOut}>
            Sign out
          </Button>
        )}
      </div>
    );
  const total = project.scenes.reduce((n, s) => n + s.duration, 0);
  const person = project.characters.find((c) => c.id === entityId);
  const place = project.locations.find((l) => l.id === entityId);
  const pageTitle = dashboard
    ? 'Your projects'
    : isSeries && view === 'Overview'
      ? 'Episode overview'
      : isSeries && view === 'Story'
        ? 'Episode story'
        : view;
  return (
    <>
      {isMobile ? (
        <div className={`mobile-app-shell${scriptTypingFocus ? ' typing-distraction-free' : ''}`}>
          {dashboard ? (
            <div className="mobile-dashboard p-4">
              <header className="flex items-center justify-between pb-3 border-b border-border/50 mb-4">
                <div className="flex items-center gap-2">
                  <Clapperboard size={22} className="text-primary" />
                  <h1 className="text-base font-bold">Draft-it PRO</h1>
                </div>
                <Button size="sm" onClick={() => setCreate(true)} className="h-8 gap-1 text-xs">
                  <Plus size={14} /> New Project
                </Button>
              </header>

              <div className="space-y-3">
                <div className="flex items-center justify-between text-xs text-muted-foreground font-bold uppercase tracking-wider">
                  <span>Your Projects ({projects.length})</span>
                </div>
                {projects.map((p) => (
                  <div
                    key={p.id}
                    className="mobile-project-card p-3.5 rounded-xl border border-border bg-card cursor-pointer shadow-xs"
                    onClick={() => {
                      setProjectId(p.id);
                      setSceneId('');
                      setView(p.kind === 'series' ? 'Series overview' : 'Scene cards');
                      setEpisodeId(p.episodes?.[0]?.id ?? '');
                      setDashboard(false);
                    }}
                  >
                    <div className="flex items-start justify-between">
                      <div className="min-w-0 flex-1">
                        <b className="text-sm font-bold block truncate">{p.title}</b>
                        <small className="text-xs text-muted-foreground block mt-0.5">
                          {p.kind === 'series'
                            ? `Web Series · ${p.episodes?.length ?? 0} eps`
                            : `${p.format} · ${p.scenes.length} scenes`}
                          {' · '}
                          {p.draft}
                        </small>
                      </div>
                      <ChevronRight size={18} className="text-muted-foreground shrink-0 mt-1" />
                    </div>
                  </div>
                ))}
              </div>
            </div>
          ) : (
            <>
              {!scriptTypingFocus && (
              <MobileProjectHeader
                project={project}
                rootProject={rootProject}
                isSeries={isSeries}
                currentView={view}
                saved={saved}
                cloudStatus={cloudStatus}
                user={user}
                onBackToProjects={() => setDashboard(true)}
                onSelectView={setView}
                onOpenEpisodeDialog={() => setEpisodeDialog(true)}
                onDeleteProject={() => {
                  if (window.confirm(`Delete project "${project.title}"?`)) {
                    deleteProject(project.id);
                    setDashboard(true);
                  }
                }}
                onRetrySync={retrySync}
              />
              )}

              <div className="mobile-workspace-body">
                {view === 'Scene cards' && (
                  <MobileSceneCards
                    project={project}
                    onOpenScene={(id) => openScene(id)}
                    onWriteScene={(id) => {
                      setSceneId(id);
                      setView('Screenplay');
                    }}
                    onAddScene={(act) => addScene(act)}
                    onAddAct={() => setAddAct(true)}
                    onShiftScene={(id, dir) => shiftScene(id, dir)}
                    onDeleteScene={(id, heading) => askDelete('scene', id, heading)}
                    onDeleteAct={(act) => askDelete('act', act, act)}
                  />
                )}

                {view === 'Screenplay' &&
                  (scene ? (
                    <ScriptEditor
                      key={scene.id}
                      scene={scene}
                      allScenes={project.scenes}
                      acts={project.acts}
                      locations={project.locations.map((l) => l.name)}
                      onChange={(blocks) => patchScene(scene.id, { blocks })}
                      onSelectScene={(id) => setSceneId(id)}
                      onAddScene={() => addScene(scene.act)}
                      onOpenSceneDetails={() => setInspect(true)}
                      isTypingFocus={scriptTypingFocus}
                      onTypingFocusChange={setScriptTypingFocus}
                    />
                  ) : (
                    <div className="p-8 text-center">
                      <FileText size={32} className="mx-auto text-muted-foreground mb-2" />
                      <b className="text-sm block">No scenes to write yet</b>
                      <p className="text-xs text-muted-foreground mt-1 mb-4">
                        Create your first scene to start writing the script.
                      </p>
                      <Button onClick={() => addScene()} size="sm">
                        <Plus size={14} className="mr-1" /> Add Scene
                      </Button>
                    </div>
                  ))}

                {view === 'Storyboard' && (
                  <MobileStoryboard
                    project={project}
                    scene={scene}
                    onSelectScene={(id) => setSceneId(id)}
                    onAddScene={() => addScene()}
                    onAddPanel={addPanel}
                    onEditPanel={(p) => setPanelEdit({ ...p })}
                    onUploadImage={uploadImageForPanel}
                    onRemoveImage={removeImageForPanel}
                    onUpdatePanel={updatePanel}
                    onAutoPlanScene={(s) => {
                      const count = project.panels.filter((p) => p.sceneId === s.id).length;
                      setReplacePanels(count > 0);
                      setAutoPlanScene(s);
                    }}
                  />
                )}

                {view === 'Story' && (
                  <div className="p-4 space-y-3">
                    <div className="flex items-center justify-between pb-2 border-b border-border/50">
                      <span className="text-xs font-bold uppercase tracking-wider text-muted-foreground">
                        STORY FOUNDATION
                      </span>
                      <button
                        className="text-xs text-destructive flex items-center gap-1 cursor-pointer"
                        onClick={() => askDelete('story', '', project.title)}
                      >
                        <Trash2 size={12} /> Clear
                      </button>
                    </div>
                    <Field
                      label="Story Title"
                      value={project.title}
                      onChange={(title) => update((p) => ({ ...p, title }))}
                    />
                    <Field
                      label="Logline"
                      value={project.logline}
                      onChange={(logline) => update((p) => ({ ...p, logline }))}
                      multiline
                    />
                    <div className="grid grid-cols-2 gap-2">
                      <Field
                        label="Genre"
                        value={project.genre}
                        onChange={(genre) => update((p) => ({ ...p, genre }))}
                      />
                      <Field
                        label="Runtime (sec)"
                        type="number"
                        value={project.targetRuntime}
                        onChange={(v) => update((p) => ({ ...p, targetRuntime: Number(v) }))}
                      />
                    </div>
                    <Field
                      label="Premise"
                      value={project.premise}
                      onChange={(premise) => update((p) => ({ ...p, premise }))}
                      multiline
                    />
                    <Field
                      label="Theme"
                      value={project.theme}
                      onChange={(theme) => update((p) => ({ ...p, theme }))}
                      multiline
                    />
                    <Field
                      label="Synopsis"
                      value={project.synopsis}
                      onChange={(synopsis) => update((p) => ({ ...p, synopsis }))}
                      multiline
                    />
                    <Field
                      label="Writer's Notes"
                      value={project.notes}
                      onChange={(notes) => update((p) => ({ ...p, notes }))}
                      multiline
                    />
                  </div>
                )}

                {view === 'Characters' && (
                  <MobileEntities
                    type="Characters"
                    project={project}
                    onUpdateProject={update}
                    onSelectScene={(id) => {
                      setSceneId(id);
                      setView('Screenplay');
                    }}
                    onDeleteEntity={(kind, id, name) => askDelete(kind, id, name)}
                  />
                )}

                {view === 'Locations' && (
                  <MobileEntities
                    type="Locations"
                    project={project}
                    onUpdateProject={update}
                    onSelectScene={(id) => {
                      setSceneId(id);
                      setView('Screenplay');
                    }}
                    onDeleteEntity={(kind, id, name) => askDelete(kind, id, name)}
                  />
                )}

                {view === 'Shot list' && (
                  <MobileShotList
                    project={project}
                    onEditPanel={(p) => setPanelEdit({ ...p })}
                    onExportCsv={() => exportFile('Shot list')}
                    onSelectScene={(id) => {
                      setSceneId(id);
                      setView('Storyboard');
                    }}
                  />
                )}

                {view === 'Export' && (
                  <div className="p-4 space-y-3">
                    <div className="pb-2 border-b border-border/50">
                      <h2 className="text-base font-bold">Export & Backups</h2>
                      <p className="text-xs text-muted-foreground">
                        Download your script or full project package
                      </p>
                    </div>
                    <div className="space-y-2.5">
                      {[
                        { name: 'Screenplay PDF', kind: 'PDF', icon: FileText, desc: 'US Letter · Courier 12' },
                        { name: 'Fountain Script', kind: 'Fountain', icon: FileText, desc: 'Plain-text screenplay standard' },
                        { name: 'Shot List CSV', kind: 'Shot list', icon: ListVideo, desc: 'Spreadsheet of storyboard shots' },
                        { name: 'Project Backup', kind: 'Backup', icon: Save, desc: 'Full JSON backup with scenes & images' },
                      ].map(({ name, kind, icon: Icon, desc }) => (
                        <div
                          key={kind}
                          className="p-3 rounded-xl border border-border bg-card flex items-center justify-between"
                        >
                          <div className="flex items-center gap-3">
                            <Icon size={20} className="text-muted-foreground" />
                            <div>
                              <b className="text-xs font-bold block">{name}</b>
                              <small className="text-[11px] text-muted-foreground">{desc}</small>
                            </div>
                          </div>
                          <Button
                            size="sm"
                            variant="outline"
                            className="h-8 text-xs gap-1"
                            disabled={exporting}
                            onClick={() => exportFile(kind)}
                          >
                            <Download size={12} />
                            {exporting ? '...' : 'Download'}
                          </Button>
                        </div>
                      ))}
                    </div>
                  </div>
                )}

                {view === 'Overview' && (
                  <div className="p-4 space-y-4">
                    <div className="p-3 rounded-xl border border-border bg-card">
                      <span className="text-[10px] font-bold uppercase tracking-wider text-muted-foreground">
                        {project.format} · {project.genre || 'Genre not set'}
                      </span>
                      <h2 className="text-base font-bold mt-1">{project.title}</h2>
                      <p className="text-xs text-muted-foreground mt-1">
                        {project.logline || 'No logline added yet.'}
                      </p>
                    </div>

                    <div className="grid grid-cols-2 gap-2.5">
                      <div className="p-3 rounded-xl border border-border bg-card text-center">
                        <b className="text-lg font-bold font-mono block">{project.scenes.length}</b>
                        <span className="text-xs text-muted-foreground">Scenes</span>
                      </div>
                      <div className="p-3 rounded-xl border border-border bg-card text-center">
                        <b className="text-lg font-bold font-mono block">{time(total)}</b>
                        <span className="text-xs text-muted-foreground">Est. Runtime</span>
                      </div>
                      <div className="p-3 rounded-xl border border-border bg-card text-center">
                        <b className="text-lg font-bold font-mono block">{project.characters.length}</b>
                        <span className="text-xs text-muted-foreground">Characters</span>
                      </div>
                      <div className="p-3 rounded-xl border border-border bg-card text-center">
                        <b className="text-lg font-bold font-mono block">{project.panels.length}</b>
                        <span className="text-xs text-muted-foreground">Storyboards</span>
                      </div>
                    </div>
                  </div>
                )}

                {view === 'Series overview' && isSeries && (
                  <div className="p-4 space-y-3">
                    <h2 className="text-base font-bold">Episodes in Series</h2>
                    <div className="space-y-2">
                      {rootProject.episodes?.map((e) => (
                        <div
                          key={e.id}
                          className="p-3 rounded-xl border border-border bg-card flex items-center justify-between cursor-pointer"
                          onClick={() => selectEpisode(e.id)}
                        >
                          <div>
                            <span className="text-xs font-mono font-bold text-muted-foreground block">
                              {episodeLabel(e)}
                            </span>
                            <b className="text-sm font-bold block">{e.title}</b>
                            <small className="text-xs text-muted-foreground">
                              {e.scenes.length} scenes · {time(e.scenes.reduce((n, s) => n + s.duration, 0))}
                            </small>
                          </div>
                          <ChevronRight size={18} className="text-muted-foreground" />
                        </div>
                      ))}
                    </div>
                    <Button
                      className="w-full mt-2"
                      size="sm"
                      onClick={() => setEpisodeDialog(true)}
                    >
                      <Plus size={14} className="mr-1" /> Add Episode
                    </Button>
                  </div>
                )}
              </div>

              {!scriptTypingFocus && (
              <MobileBottomNav
                currentView={view}
                onSelectView={setView}
                project={project}
                cloudStatus={cloudStatus}
                saved={saved}
                user={user}
                onOpenDashboard={() => setDashboard(true)}
              />
              )}
            </>
          )}
        </div>
      ) : (
        <SidebarProvider
          style={{ '--sidebar-width': '300px' } as React.CSSProperties}
        >
      <Sidebar>
        <SidebarHeader>
          <button className="brand" onClick={() => setDashboard(true)}>
            <Clapperboard /> draft-it <b>PRO</b>
          </button>
          <button className="project-picker" onClick={() => setDashboard(true)}>
            <span className="project-icon">{rootProject.title[0]}</span>
            <span>
              {rootProject.title}
              <small>{isSeries ? 'Web series' : rootProject.format}</small>
            </span>
            <ChevronRight size={16} />
          </button>
          {isSeries && (
            <div className="episode-picker">
              <span>EPISODE WORKSPACE</span>
              <DropdownMenu>
                <DropdownMenuTrigger render={<Button variant="outline" />}>
                  {activeEpisode
                    ? episodeLabel(activeEpisode) + ' · ' + activeEpisode.title
                    : 'Select episode'}
                  <ChevronRight size={14} />
                </DropdownMenuTrigger>
                <DropdownMenuContent>
                  {rootProject.episodes?.map((e) => (
                    <DropdownMenuItem
                      key={e.id}
                      onClick={() => selectEpisode(e.id)}
                    >
                      {episodeLabel(e)} · {e.title}
                    </DropdownMenuItem>
                  ))}
                </DropdownMenuContent>
              </DropdownMenu>
            </div>
          )}
        </SidebarHeader>
        <SidebarContent>
          <p className="nav-label">PROJECT WORKSPACE</p>
          <SidebarMenu>
            {isSeries && (
              <SidebarMenuItem>
                <SidebarMenuButton
                  isActive={!dashboard && view === 'Series overview'}
                  onClick={() => {
                    setView('Series overview');
                    setDashboard(false);
                  }}
                >
                  <Clapperboard />
                  <span>Series overview</span>
                </SidebarMenuButton>
              </SidebarMenuItem>
            )}
            {(isSeries && !activeEpisode ? [] : nav).map(([n, I]) => (
              <SidebarMenuItem key={n}>
                <SidebarMenuButton
                  isActive={!dashboard && view === n}
                  onClick={() => {
                    setView(n);
                    setDashboard(false);
                    setEntityId('');
                  }}
                >
                  <I />
                  <span>
                    {isSeries && n === 'Overview'
                      ? 'Episode overview'
                      : isSeries && n === 'Story'
                        ? 'Episode story'
                        : n}
                  </span>
                  {n === 'Scene cards' && (
                    <span className="nav-count">
                      {(isSeries ? activeEpisode : project)?.scenes.length}
                    </span>
                  )}
                </SidebarMenuButton>
              </SidebarMenuItem>
            ))}
          </SidebarMenu>
        </SidebarContent>
        <SidebarFooter>
          <div className="local-label">
            <span />
            {user ? 'Firebase connected' : 'Local workspace'}
          </div>
          <div className="account-panel">
            {user ? (
              <>
                <div className="profile ">
                  <span className="w-10 h-10 rounded-full bg-slate-200 text-white  flex items-center justify-center">
                    {(user.displayName || user.email || 'U')
                      .slice(0, 2)
                      .toUpperCase()}
                  </span>
                  <div>
                    {user.displayName || 'Your account'}
                    <small>{user.email}</small>
                  </div>
                </div>
                <button onClick={signOut} disabled={authBusy}>
                  Sign out
                </button>
              </>
            ) : (
              <>
                <button
                  className="google-login"
                  onClick={signIn}
                  disabled={authBusy || !configured}
                >
                  {authBusy ? 'Signing in…' : 'Sign in with Google'}
                </button>
                <small>
                  {configured
                    ? 'Sign in to sync this local workspace.'
                    : 'Add Firebase config to .env to enable sign-in.'}
                </small>
              </>
            )}
          </div>
        </SidebarFooter>
      </Sidebar>
      <main className="main">
        <header>
          <div>
            <SidebarTrigger />
            <button onClick={() => setDashboard(true)}>Projects</button>
            <ChevronRight size={14} />
            <b>
              {dashboard
                ? 'All projects'
                : isSeries && view !== 'Series overview'
                  ? rootProject.title +
                    ' / ' +
                    episodeLabel(project) +
                    ' · ' +
                    project.title
                  : project.title}
            </b>
          </div>
          <div>
            <span className="saved">
              <Check size={14} />
              {saved}
              {user ? ' · ' + cloudStatus : ''}
            </span>
            <span className="draft">{project.draft}</span>
            <button
              aria-label="Open exports"
              onClick={() => {
                setDashboard(false);
                setView('Export');
              }}
            >
              <Download size={16} />
            </button>
          </div>
        </header>
        {syncError && (
          <div className="sync-error" role="status">
            <span>{syncError}</span>
            {user && <button onClick={retrySync}>Retry sync</button>}
          </div>
        )}
        <section className="workspace">
          <div className="eyebrow">
            {dashboard
              ? 'YOUR FILMMAKING WORKSPACE'
              : project.title +
                ' / ' +
                (view === 'Scene cards'
                  ? 'STORY DEVELOPMENT'
                  : view.toUpperCase())}
          </div>
          <div className="title-row">
            <div>
              <h1>{pageTitle}</h1>
              <p>
                {dashboard
                  ? 'A new idea is always the beginning of something.'
                  : descriptions[view]}
              </p>
            </div>
            <div className="title-actions">
              {!dashboard &&
                view !== 'Export' &&
                importTabs.includes(view as ImportTab) && (
                  <ImportWorkspace
                    key={project.id + view}
                    tab={view as ImportTab}
                    project={project}
                    scope={
                      isSeries
                        ? rootProject.title +
                          ' / ' +
                          episodeLabel(project) +
                          ' · ' +
                          project.title
                        : project.title
                    }
                    onImport={(plan) => {
                      if (plan.newProject) {
                        setProjects((all) => [plan.project, ...all]);
                        setProjectId(plan.project.id);
                        setEpisodeId(plan.project.episodes?.[0]?.id ?? '');
                        setView(
                          plan.project.kind === 'series'
                            ? 'Series overview'
                            : 'Overview',
                        );
                      } else {
                        update(() => plan.project);
                      }
                      setSceneId('');
                      setInspect(false);
                      setEntityId('');
                      setPanelEdit(null);
                      setNotice(
                        plan.newProject
                          ? 'Imported as a new project.'
                          : 'Import complete. Connected workspaces updated.',
                      );
                    }}
                  />
                )}
              {dashboard ? (
                <button className="primary" onClick={() => setCreate(true)}>
                  <Plus size={16} />
                  New project
                </button>
              ) : view === 'Series overview' ? (
                <button
                  className="primary"
                  onClick={() => setEpisodeDialog(true)}
                >
                  <Plus size={16} />
                  Add episode
                </button>
              ) : view === 'Scene cards' ? (
                <>
                  <Button variant="outline" onClick={() => setAddAct(true)}>
                    Add column
                  </Button>
                  <button className="primary" onClick={() => addScene()}>
                    <Plus size={16} />
                    Add scene
                  </button>
                </>
              ) : view === 'Screenplay' ? (
                <button
                  className="primary"
                  onClick={() => exportFile('PDF')}
                  disabled={exporting}
                >
                  <Download size={16} />
                  {exporting ? 'Preparing…' : 'Export PDF'}
                </button>
              ) : view === 'Storyboard' ? (
                <button
                  className="primary"
                  disabled={!scene}
                  onClick={addPanel}
                >
                  <Plus size={16} />
                  Add panel
                </button>
              ) : view === 'Characters' || view === 'Locations' ? (
                <button
                  className="primary"
                  onClick={() => {
                    setTitle('');
                    setNewEntity(true);
                  }}
                >
                  <Plus size={16} />
                  Add {view === 'Characters' ? 'character' : 'location'}
                </button>
              ) : (
                <button
                  className="primary"
                  onClick={() => setView('Screenplay')}
                >
                  Open screenplay <ArrowUpRight size={16} />
                </button>
              )}
            </div>
          </div>
          {dashboard ? (
            <div className="projects-grid">
              {projects.map((p, i) => (
                <div
                  className="project-card"
                  key={p.id}
                  onClick={() => {
                    setProjectId(p.id);
                    setSceneId('');
                    setView(
                      p.kind === 'series' ? 'Series overview' : 'Scene cards',
                    );
                    setEpisodeId(p.episodes?.[0]?.id ?? '');
                    setDashboard(false);
                  }}
                  role="button"
                  tabIndex={0}
                  onKeyDown={(e) => {
                    if (e.key === 'Enter' || e.key === ' ') {
                      setProjectId(p.id);
                      setSceneId('');
                      setView(
                        p.kind === 'series' ? 'Series overview' : 'Scene cards',
                      );
                      setEpisodeId(p.episodes?.[0]?.id ?? '');
                      setDashboard(false);
                    }
                  }}
                >
                  <div className={'project-cover cover' + (i % 3)}>
                    <span>{p.format}</span>
                    <h2>{p.title}</h2>
                    <Clapperboard size={30} />
                  </div>
                  <div className="project-info">
                    <div className="project-info-header">
                      <h3>
                        {p.title}
                        <ArrowUpRight size={17} />
                      </h3>
                      {projects.length > 1 && (
                        <button
                          type="button"
                          className="delete-project-btn"
                          title="Delete project"
                          aria-label={`Delete ${p.title}`}
                          onClick={(e) => {
                            e.stopPropagation();
                            if (
                              window.confirm(
                                `Are you sure you want to delete "${p.title}"?`,
                              )
                            ) {
                              deleteProject(p.id);
                            }
                          }}
                        >
                          <Trash2 size={15} />
                        </button>
                      )}
                    </div>
                    <p>
                      {p.kind === 'series'
                        ? 'Web series · ' +
                          (p.episodes?.length ?? 0) +
                          ' episodes'
                        : p.format + ' · ' + p.scenes.length + ' scenes'}{' '}
                      · {p.draft}
                    </p>
                    <small>
                      Edited {new Date(p.updatedAt).toLocaleDateString()}
                    </small>
                  </div>
                </div>
              ))}
            </div>
          ) : (
            <>
              {view !== 'Series overview' && (
                <div className="stats">
                  <span>
                    <b>{project.scenes.length}</b> scenes
                  </span>
                  <span>
                    <b>{time(total)}</b> est. runtime
                  </span>
                  <span>
                    <b>{project.characters.length}</b> characters
                  </span>
                  <span className="sync">
                    <span /> Connected to screenplay
                  </span>
                </div>
              )}
              {view === 'Scene cards' && (
                <>
                  <div
                    className="board"
                    style={{
                      gridTemplateColumns: `repeat(${project.acts.length},minmax(250px,1fr))`,
                    }}
                  >
                    {project.acts.map((act, i) => (
                      <section
                        className="act"
                        key={act}
                        onDragOver={(e) => e.preventDefault()}
                        onDrop={(e) => {
                          e.preventDefault();
                          if (drag) reorder(drag, act);
                          setDrag('');
                        }}
                      >
                        <div className="act-title">
                          <span className={'dot d' + i} />
                          <h2>{act}</h2>
                          <span>
                            {project.scenes.filter((s) => s.act === act).length}
                          </span>
                          <button
                            aria-label={'Add scene to ' + act}
                            onClick={() => addScene(act)}
                          >
                            <Plus size={16} />
                          </button>
                        </div>
                        <button
                          className="delete-column"
                          disabled={project.acts.length <= 1}
                          title={
                            project.acts.length <= 1
                              ? 'Keep at least one column'
                              : 'Delete column and its scenes'
                          }
                          onClick={() => askDelete('act', act, act)}
                        >
                          <Trash2 size={13} />
                          Delete column
                        </button>
                        <p className="act-sub">
                          {[
                            'The things we don’t say',
                            'A thousand unsent thoughts',
                            'Some words find their way',
                          ][i] ?? 'A new chapter in your story'}
                        </p>
                        {project.scenes
                          .filter((s) => s.act === act)
                          .map((s) => {
                            const number =
                              project.scenes.findIndex((a) => a.id === s.id) +
                              1;
                            return (
                              <article
                                className={
                                  'scene-card emotion-card ' +
                                  (drag === s.id ? 'dragging' : '')
                                }
                                style={
                                  s.colour
                                    ? {
                                        borderTopColor: s.colour,
                                        backgroundImage:
                                          'linear-gradient(' +
                                          s.colour +
                                          '14, ' +
                                          s.colour +
                                          '04)',
                                      }
                                    : undefined
                                }
                                key={s.id}
                                draggable
                                onDragStart={(e) => {
                                  setDrag(s.id);
                                  e.dataTransfer.setData('text/plain', s.id);
                                }}
                                onDragEnd={() => setDrag('')}
                                onDragOver={(e) => e.preventDefault()}
                                onDrop={(e) => {
                                  e.preventDefault();
                                  e.stopPropagation();
                                  if (drag && drag !== s.id)
                                    reorder(drag, act, s.id);
                                  setDrag('');
                                }}
                              >
                                <button
                                  className="card-open"
                                  onClick={() => openScene(s.id)}
                                >
                                  <div className="card-meta">
                                    <span>SCENE {pad(number)}</span>
                                    <span className={'status ' + s.status}>
                                      {s.status}
                                    </span>
                                  </div>
                                  {s.emotion && (
                                    <span className="emotion-label">
                                      <span
                                        style={{
                                          background: s.colour || '#a6afb9',
                                        }}
                                      />
                                      {s.emotion}
                                    </span>
                                  )}
                                  <h3>{s.heading}</h3>
                                  <p>
                                    {s.summary ||
                                      'Add a summary to shape this scene.'}
                                  </p>
                                </button>
                                <div className="card-bottom">
                                  <span>
                                    {s.characterIds
                                      .map(
                                        (id) =>
                                          project.characters.find(
                                            (c) => c.id === id,
                                          )?.name,
                                      )
                                      .join(' · ') || 'No dialogue yet'}
                                  </span>
                                  <span>
                                    <Clock size={12} /> {s.duration} sec
                                  </span>
                                </div>
                                <div className="card-tools">
                                  <GripVertical size={13} />
                                  <button
                                    className="delete-element"
                                    aria-label={'Delete scene ' + number}
                                    title="Delete scene"
                                    onClick={() =>
                                      askDelete('scene', s.id, s.heading)
                                    }
                                  >
                                    <Trash2 size={15} />
                                  </button>
                                  <button
                                    aria-label={
                                      'Set emotion colour for scene ' + number
                                    }
                                    title="Emotion colour"
                                    onClick={() => openScene(s.id)}
                                  >
                                    <Palette size={15} />
                                  </button>
                                  <button
                                    aria-label={'Move scene ' + number + ' up'}
                                    disabled={number === 1}
                                    onClick={() => shiftScene(s.id, -1)}
                                  >
                                    <ArrowUp size={13} />
                                  </button>
                                  <button
                                    aria-label={
                                      'Move scene ' + number + ' down'
                                    }
                                    disabled={number === project.scenes.length}
                                    onClick={() => shiftScene(s.id, 1)}
                                  >
                                    <ArrowDown size={13} />
                                  </button>
                                </div>
                              </article>
                            );
                          })}
                        <button
                          className="add-card"
                          onClick={() => addScene(act)}
                        >
                          <Plus size={14} /> Add scene
                        </button>
                      </section>
                    ))}
                  </div>
                  <p className="board-hint">
                    Drag to reorder your story. Screenplay scene numbers update
                    automatically.
                  </p>
                </>
              )}
              {view === 'Series overview' && isSeries && (
                <div className="series-workspace">
                  <section className="form-panel">
                    <div className="section-kicker">SERIES BIBLE</div>
                    <Field
                      label="Series title"
                      value={rootProject.title}
                      onChange={(title) => update((p) => ({ ...p, title }))}
                    />
                    <Field
                      label="Series logline"
                      value={rootProject.logline}
                      onChange={(logline) => update((p) => ({ ...p, logline }))}
                      multiline
                    />
                    <div className="two-fields">
                      <Field
                        label="Genre"
                        value={rootProject.genre}
                        onChange={(genre) => update((p) => ({ ...p, genre }))}
                      />
                      <Field
                        label="Theme"
                        value={rootProject.theme}
                        onChange={(theme) => update((p) => ({ ...p, theme }))}
                      />
                    </div>
                    <Field
                      label="Series arc"
                      value={rootProject.synopsis}
                      onChange={(synopsis) =>
                        update((p) => ({ ...p, synopsis }))
                      }
                      multiline
                    />
                  </section>
                  <section className="series-episodes">
                    <div className="scene-section-title">
                      <div>
                        <h2>Seasons & episodes</h2>
                        <p>
                          {rootProject.episodes?.length} episodes ·{' '}
                          {rootProject.episodes?.reduce(
                            (n, e) => n + e.scenes.length,
                            0,
                          )}{' '}
                          scenes across the series
                        </p>
                      </div>
                      <button
                        className="primary"
                        onClick={() => setEpisodeDialog(true)}
                      >
                        <Plus size={16} />
                        Add episode
                      </button>
                    </div>
                    {Array.from(
                      new Set(
                        rootProject.episodes?.map((e) => e.seasonNumber ?? 1),
                      ),
                    )
                      .sort((a, b) => a - b)
                      .map((seasonNumber) => (
                        <div key={seasonNumber} className="season-group">
                          <h3>Season {pad(seasonNumber)}</h3>
                          {rootProject.episodes
                            ?.filter((e) => e.seasonNumber === seasonNumber)
                            .sort(
                              (a, b) =>
                                (a.episodeNumber ?? 0) - (b.episodeNumber ?? 0),
                            )
                            .map((e) => (
                              <div key={e.id} className="episode-with-delete">
                                <button
                                  className="episode-row"
                                  onClick={() => selectEpisode(e.id)}
                                >
                                  <span className="episode-code">
                                    {episodeLabel(e)}
                                  </span>
                                  <span>
                                    <b>{e.title}</b>
                                    <small>
                                      {e.scenes.length} scenes ·{' '}
                                      {time(
                                        e.scenes.reduce(
                                          (n, s) => n + s.duration,
                                          0,
                                        ),
                                      )}{' '}
                                      · {e.draft}
                                    </small>
                                  </span>
                                  <ArrowUpRight size={18} />
                                </button>
                                <button
                                  className="delete-element episode-delete"
                                  aria-label={
                                    'Delete ' + episodeLabel(e) + ' ' + e.title
                                  }
                                  onClick={() =>
                                    askDelete(
                                      'episode',
                                      e.id,
                                      episodeLabel(e) + ' · ' + e.title,
                                    )
                                  }
                                >
                                  <Trash2 size={17} />
                                </button>
                              </div>
                            ))}
                        </div>
                      ))}
                  </section>
                </div>
              )}
              {view === 'Overview' && (
                <div className="project-overview">
                  <section className="overview-summary">
                    <div>
                      <span className="section-kicker">
                        {project.format} · {project.genre || 'Genre not set'}
                      </span>
                      <h2>{project.title}</h2>
                      <p>
                        {project.logline ||
                          'Your story starts with an idea. Add a logline in Story to give the project a direction.'}
                      </p>
                      <button
                        className="overview-link"
                        onClick={() => setView('Story')}
                      >
                        Develop the story <ArrowUpRight size={16} />
                      </button>
                    </div>
                    <div className="overview-draft">
                      <Field
                        label="Current draft"
                        value={project.draft}
                        onChange={(draft) => update((p) => ({ ...p, draft }))}
                      />
                      <p>
                        Target runtime <b>{time(project.targetRuntime)}</b>
                      </p>
                      <p>
                        Locations <b>{project.locations.length}</b>
                      </p>
                    </div>
                  </section>
                  <div className="overview-progress-grid">
                    <section className="overview-progress-card">
                      <FileText size={22} />
                      <h2>Screenplay status</h2>
                      <strong>
                        {
                          project.scenes.filter(
                            (s) =>
                              s.status === 'revised' || s.status === 'locked',
                          ).length
                        }
                        <span>
                          {' '}
                          / {project.scenes.length} scenes revised or locked
                        </span>
                      </strong>
                      <Progress
                        aria-label="Scenes revised or locked"
                        value={
                          project.scenes.length
                            ? (project.scenes.filter(
                                (s) =>
                                  s.status === 'revised' ||
                                  s.status === 'locked',
                              ).length /
                                project.scenes.length) *
                              100
                            : 0
                        }
                      />
                      <div className="overview-statuses">
                        {['outline', 'draft', 'revised', 'locked'].map(
                          (status) => (
                            <span key={status}>
                              <b>
                                {
                                  project.scenes.filter(
                                    (s) => s.status === status,
                                  ).length
                                }
                              </b>{' '}
                              {status}
                            </span>
                          ),
                        )}
                      </div>
                      <button
                        className="overview-link"
                        onClick={() => setView('Scene cards')}
                      >
                        Review scenes <ArrowUpRight size={15} />
                      </button>
                    </section>
                    <section className="overview-progress-card">
                      <Images size={22} />
                      <h2>Visual planning</h2>
                      <strong>
                        {
                          project.scenes.filter((s) =>
                            project.panels.some((p) => p.sceneId === s.id),
                          ).length
                        }
                        <span>
                          {' '}
                          / {project.scenes.length} scenes with panels
                        </span>
                      </strong>
                      <Progress
                        aria-label="Scenes with storyboard panels"
                        value={
                          project.scenes.length
                            ? (project.scenes.filter((s) =>
                                project.panels.some((p) => p.sceneId === s.id),
                              ).length /
                                project.scenes.length) *
                              100
                            : 0
                        }
                      />
                      <p>
                        {project.panels.length} panels ·{' '}
                        {
                          project.panels.filter(
                            (p) =>
                              p.status === 'Ready' || p.status === 'Complete',
                          ).length
                        }{' '}
                        shots ready or complete
                      </p>
                      <button
                        className="overview-link"
                        onClick={() => setView('Storyboard')}
                      >
                        Plan the frames <ArrowUpRight size={15} />
                      </button>
                    </section>
                  </div>
                  <section className="overview-workspaces">
                    <h2>Continue your project</h2>
                    <div>
                      {[
                        {
                          name: 'Story',
                          icon: BookOpen,
                          text: 'Develop your premise, theme, and treatment.',
                        },
                        {
                          name: 'Screenplay',
                          icon: FileText,
                          text: 'Pick up the script where your story needs you.',
                        },
                        {
                          name: 'Shot list',
                          icon: ListVideo,
                          text: 'Review camera choices and shot readiness.',
                        },
                        {
                          name: 'Export',
                          icon: Download,
                          text: 'Download your screenplay or a project backup.',
                        },
                      ].map(({ name, icon: Icon, text }) => (
                        <button key={name} onClick={() => setView(name)}>
                          <Icon size={20} />
                          <span>
                            <b>{name}</b>
                            <small>{text}</small>
                          </span>
                          <ChevronRight size={16} />
                        </button>
                      ))}
                    </div>
                  </section>
                </div>
              )}
              {view === 'Story' && (
                <div className="story-writing">
                  <section className="form-panel">
                    <div className="section-title-row">
                      <div className="section-kicker">STORY FOUNDATION</div>
                      <button
                        className="delete-element"
                        onClick={() => askDelete('story', '', project.title)}
                      >
                        <Trash2 size={14} />
                        Clear story content
                      </button>
                    </div>
                    <Field
                      label="Title"
                      value={project.title}
                      onChange={(title) => update((p) => ({ ...p, title }))}
                    />
                    <Field
                      label="Logline"
                      value={project.logline}
                      onChange={(logline) => update((p) => ({ ...p, logline }))}
                      multiline
                    />
                    <div className="two-fields">
                      <Field
                        label="Genre"
                        value={project.genre}
                        onChange={(genre) => update((p) => ({ ...p, genre }))}
                      />
                      <Field
                        label="Target runtime (seconds)"
                        type="number"
                        value={project.targetRuntime}
                        onChange={(v) =>
                          update((p) => ({ ...p, targetRuntime: Number(v) }))
                        }
                      />
                    </div>
                    {(
                      [
                        'premise',
                        'theme',
                        'synopsis',
                        'treatment',
                        'notes',
                        'references',
                      ] as const
                    ).map((key) => (
                      <Field
                        key={key}
                        label={key === 'notes' ? 'Writer’s notes' : key}
                        value={project[key]}
                        onChange={(v) => update((p) => ({ ...p, [key]: v }))}
                        multiline
                      />
                    ))}
                  </section>
                </div>
              )}
              {view === 'Screenplay' &&
                (scene ? (
                  <div className="script-layout">
                    <aside className="script-nav">
                      <div className="section-kicker">
                        SCENES{' '}
                        <button
                          aria-label="Add scene"
                          onClick={() => addScene()}
                        >
                          <Plus size={14} />
                        </button>
                      </div>
                      {project.acts.map((act) => (
                        <div key={act}>
                          <h3>{act}</h3>
                          {project.scenes
                            .filter((s) => s.act === act)
                            .map((s) => (
                              <button
                                className={scene.id === s.id ? 'selected' : ''}
                                key={s.id}
                                onClick={() => setSceneId(s.id)}
                              >
                                <span>
                                  {pad(project.scenes.indexOf(s) + 1)}
                                </span>
                                {s.heading
                                  .replace(/^(INT.|EXT.) /, '')
                                  .replace(' - NIGHT', '')}
                              </button>
                            ))}
                        </div>
                      ))}
                      <button
                        className="metadata-button"
                        onClick={() => setInspect(true)}
                      >
                        Scene details <ChevronRight size={14} />
                      </button>
                    </aside>
                    <ScriptEditor
                      key={scene.id}
                      scene={scene}
                      locations={project.locations.map((l) => l.name)}
                      onChange={(blocks) => patchScene(scene.id, { blocks })}
                    />
                  </div>
                ) : (
                  <Empty
                    icon={<FileText />}
                    title="The first page is yours."
                    text="Add a scene to begin writing."
                    action={() => addScene()}
                    label="Add first scene"
                  />
                ))}
              {view === 'Storyboard' && (
                <>
                  <div className="scene-switcher">
                    {project.scenes.map((s, i) => (
                      <button
                        className={scene?.id === s.id ? 'selected' : ''}
                        key={s.id}
                        onClick={() => setSceneId(s.id)}
                      >
                        Scene {pad(i + 1)}
                      </button>
                    ))}
                  </div>
                  {scene ? (
                    <>
                      <div className="scene-section-title">
                        <h2>{scene.heading}</h2>
                        <div className="scene-title-actions">
                          <span>
                            {
                              project.panels.filter((p) => p.sceneId === scene.id)
                                .length
                            }{' '}
                            panels
                          </span>
                          <Button
                            variant="outline"
                            size="sm"
                            className="auto-plan-btn"
                            onClick={() => {
                              const existingCount = project.panels.filter((p) => p.sceneId === scene.id).length;
                              setReplacePanels(existingCount > 0);
                              setAutoPlanScene(scene);
                            }}
                          >
                            <Sparkles size={14} /> Auto plan scene
                          </Button>
                        </div>
                      </div>
                      <div className="panels-grid">
                        {project.panels
                          .filter((p) => p.sceneId === scene.id)
                          .map((p, i) => {
                            const sceneHash = computeSceneContentHash(scene);
                            const isOutdated = !!(p.sourceContentHash && p.sourceContentHash !== sceneHash);
                            const shotLabel = pad(project.scenes.indexOf(scene) + 1) + String.fromCharCode(65 + (i % 26));
                            return (
                              <div className="panel-card-container" key={p.id}>
                                <div
                                  className="panel-card"
                                  onClick={() => setPanelEdit({ ...p })}
                                  role="button"
                                  tabIndex={0}
                                >
                                  <div className="frame">
                                    {p.image ? (
                                      <img
                                        alt={p.description || 'Storyboard frame'}
                                        src={p.image}
                                      />
                                    ) : (
                                      <div>
                                        <ImagePlus size={30} />
                                        <span>Add a storyboard image</span>
                                      </div>
                                    )}
                                    <b>{shotLabel}</b>
                                    {isOutdated && (
                                      <span className="outdated-scene-badge" title="Screenplay scene has changed since this panel was planned">
                                        ⚠ Scene changed
                                      </span>
                                    )}
                                  </div>
                                  <div className="panel-body">
                                    <h3>
                                      {p.size}
                                      <span>{p.duration}s</span>
                                    </h3>
                                    <p>{p.description || 'Describe this frame.'}</p>
                                    <small>
                                      {p.lens} · {p.movement}
                                    </small>
                                  </div>
                                </div>
                                <div className="panel-card-footer">
                                  <Button
                                    variant="outline"
                                    size="sm"
                                    className="panel-prompt-btn"
                                    onClick={(e) => {
                                      e.stopPropagation();
                                      setPromptModalPanel({ ...p });
                                      setEditingCustomPrompt(false);
                                      setCustomPromptDraft(p.customPrompt ?? p.generatedPrompt ?? '');
                                    }}
                                  >
                                    <FileText size={12} /> Prompt
                                  </Button>
                                  <Button
                                    variant="ghost"
                                    size="sm"
                                    className="panel-edit-btn"
                                    onClick={(e) => {
                                      e.stopPropagation();
                                      setPanelEdit({ ...p });
                                    }}
                                  >
                                    Edit
                                  </Button>
                                </div>
                              </div>
                            );
                          })}
                        <button className="new-panel" onClick={addPanel}>
                          <Plus size={26} />
                          Add a panel
                          <span>Upload a frame or plan the shot</span>
                        </button>
                      </div>
                    </>
                  ) : (
                    <Empty
                      icon={<Images />}
                      title="Start with a scene."
                      text="Storyboard panels connect to your screenplay scenes."
                      label="Add scene"
                      action={() => addScene()}
                    />
                  )}
                </>
              )}
              {view === 'Shot list' && (
                <div className="table-panel">
                  <div className="table-caption">
                    <span>
                      {project.panels.length} shots · Linked to storyboard
                      panels
                    </span>
                    <Button
                      variant="outline"
                      onClick={() => exportFile('Shot list')}
                    >
                      <Download size={14} />
                      Export CSV
                    </Button>
                  </div>
                  <Table>
                    <TableHeader>
                      <TableRow>
                        {[
                          'Shot',
                          'Scene',
                          'Size',
                          'Movement',
                          'Lens',
                          'Duration',
                          'Status',
                        ].map((x) => (
                          <TableHead key={x}>{x}</TableHead>
                        ))}
                      </TableRow>
                    </TableHeader>
                    <TableBody>
                      {project.scenes.flatMap((s, i) =>
                        project.panels
                          .filter((p) => p.sceneId === s.id)
                          .map((p, j) => (
                            <TableRow key={p.id}>
                              <TableCell>
                                <button
                                  className="shot-link"
                                  onClick={() => setPanelEdit({ ...p })}
                                >
                                  {pad(i + 1) + String.fromCharCode(65 + j)}
                                </button>
                              </TableCell>
                              <TableCell>{s.heading}</TableCell>
                              <TableCell>{p.size}</TableCell>
                              <TableCell>{p.movement}</TableCell>
                              <TableCell>{p.lens}</TableCell>
                              <TableCell>{p.duration}s</TableCell>
                              <TableCell>
                                <span className="status revised">
                                  {p.status}
                                </span>
                              </TableCell>
                            </TableRow>
                          )),
                      )}
                    </TableBody>
                  </Table>
                  {!project.panels.length && (
                    <Empty
                      icon={<ListVideo />}
                      title="Plan your first shot."
                      text="Add storyboard panels to build your shot list."
                      label="Open storyboard"
                      action={() => setView('Storyboard')}
                    />
                  )}
                </div>
              )}
              {(view === 'Characters' || view === 'Locations') && (
                <div className="entities-grid">
                  {(view === 'Characters'
                    ? project.characters
                    : project.locations
                  ).map((e, i) => (
                    <button
                      className="entity-card"
                      key={e.id}
                      onClick={() => setEntityId(e.id)}
                    >
                      <div className={'entity-avatar av' + i}>
                        {view === 'Characters' ? (
                          e.name.slice(0, 1)
                        ) : (
                          <MapPin />
                        )}
                      </div>
                      <span className="section-kicker">
                        {view === 'Characters'
                          ? (e as Person).role || 'CHARACTER'
                          : 'LOCATION'}
                      </span>
                      <h2>{e.name}</h2>
                      <p>
                        {e.description ||
                          'Add a description, details, and production notes.'}
                      </p>
                      <div className="entity-scenes">
                        {
                          project.scenes.filter((s) =>
                            view === 'Characters'
                              ? s.characterIds.includes(e.id)
                              : s.locationId === e.id,
                          ).length
                        }{' '}
                        scene appearances <ArrowUpRight size={15} />
                      </div>
                    </button>
                  ))}
                  {!(
                    view === 'Characters'
                      ? project.characters
                      : project.locations
                  ).length && (
                    <Empty
                      icon={view === 'Characters' ? <Users /> : <MapPin />}
                      title={
                        'Build your ' +
                        (view === 'Characters' ? 'cast.' : 'world.')
                      }
                      text="Add an entry here, or let screenplay elements create it automatically."
                      label="Add entry"
                      action={() => {
                        setTitle('');
                        setNewEntity(true);
                      }}
                    />
                  )}
                </div>
              )}
              {view === 'Export' && (
                <>
                  <section className="auto-backup-panel">
                    <div className="auto-backup-heading">
                      <div>
                        <h2>Automatic backups</h2>
                        <p>
                          {isSeries
                            ? 'Back up the entire series, including all episodes and images.'
                            : 'Keep snapshots of your project, including scenes and images.'}
                        </p>
                      </div>
                      <Switch
                        aria-label="Enable automatic backups"
                        checked={rootProject.backupSettings?.enabled ?? false}
                        onCheckedChange={(enabled) =>
                          setBackupSettings({ enabled })
                        }
                      />
                    </div>
                    <div className="auto-backup-settings">
                      <Choice
                        label="Backup interval"
                        value={
                          'Every ' +
                          (rootProject.backupSettings?.intervalMinutes ?? 15) +
                          ' minutes'
                        }
                        options={backupIntervals.map(
                          (n) => 'Every ' + n + ' minutes',
                        )}
                        onChange={(label) =>
                          setBackupSettings({
                            intervalMinutes: Number(label.split(' ')[1]),
                          })
                        }
                      />
                      <div className="backup-last">
                        <span>Last automatic backup</span>
                        <b>
                          {lastBackups[rootProject.id]
                            ? new Date(
                                lastBackups[rootProject.id],
                              ).toLocaleString()
                            : 'No backup yet'}
                        </b>
                      </div>
                      <Button
                        variant="outline"
                        disabled={!lastBackups[rootProject.id]}
                        onClick={downloadLatestBackup}
                      >
                        <Download size={15} />
                        Download latest backup
                      </Button>
                    </div>
                    <p className="backup-explanation">
                      {rootProject.backupSettings?.enabled ? 'On' : 'Off'} ·
                      Keeps the latest 5 snapshots in this browser. Backups run
                      while the app is open; a sleeping browser catches up when
                      it resumes. Browser data clearing also removes these
                      backups.
                    </p>
                    {backupErrors[rootProject.id] && (
                      <p className="import-error" role="alert">
                        {backupErrors[rootProject.id]}
                      </p>
                    )}
                  </section>
                  <div className="exports-grid">
                    {[
                      {
                        name: 'Screenplay PDF',
                        kind: 'PDF',
                        desc: 'US Letter · Courier 12 · Numbered scenes and dialogue continuation markers.',
                        icon: FileText,
                      },
                      {
                        name: 'Fountain screenplay',
                        kind: 'Fountain',
                        desc: 'A portable plain-text screenplay for other writing tools.',
                        icon: FileText,
                      },
                      {
                        name: 'Plain text',
                        kind: 'Text',
                        desc: 'Your complete screenplay, in scene order.',
                        icon: FileText,
                      },
                      {
                        name: 'Shot list',
                        kind: 'Shot list',
                        desc: 'A CSV spreadsheet of your linked storyboard shots.',
                        icon: ListVideo,
                      },
                      {
                        name: 'Project backup',
                        kind: 'Backup',
                        desc: isSeries
                          ? 'The complete series, including every episode and its images, in one JSON file.'
                          : 'All scenes, characters, locations, and uploaded images in one JSON file.',
                        icon: Save,
                      },
                    ].map(({ name, kind, desc, icon: I }) => (
                      <section className="export-card" key={kind}>
                        <I size={25} />
                        <h2>{name}</h2>
                        <p>{desc}</p>
                        <button
                          disabled={exporting}
                          onClick={() => exportFile(kind)}
                        >
                          {exporting ? 'Preparing…' : 'Download'}
                          <Download size={15} />
                        </button>
                      </section>
                    ))}
                  </div>
                  <p className="export-note">
                    Local saves work offline. Sign in with Google to sync
                    projects and images to Firebase. Download a project backup
                    to keep a separate copy. PDF pagination is a demo
                    implementation; review the output before production use.
                  </p>
                </>
              )}
            </>
          )}
        </section>
      </main>
    </SidebarProvider>
  )}
  <Dialog open={create} onOpenChange={setCreate}>
        <DialogContent>
          <DialogTitle>Start a new story</DialogTitle>
          <DialogDescription>
            A project keeps all your filmmaking work together.
          </DialogDescription>
          <RadioGroup
            aria-label="Project type"
            value={projectKind}
            onValueChange={(v) => setProjectKind(String(v))}
            className="project-kind-options"
          >
            <label>
              <RadioGroupItem value="single" />
              <span>
                <b>Single film</b>
                <small>One screenplay and production workspace.</small>
              </span>
            </label>
            <label>
              <RadioGroupItem value="series" />
              <span>
                <b>Web series</b>
                <small>
                  Seasons and episodes, each with its own screenplay.
                </small>
              </span>
            </label>
          </RadioGroup>
          <Field
            label={projectKind === 'series' ? 'Series title' : 'Project title'}
            value={title}
            onChange={setTitle}
          />
          {projectKind === 'single' ? (
            <Choice
              label="Format"
              value={format}
              options={[
                'Feature Film',
                'Short Film',
                'Animated Short',
                'Advertisement',
                'Music Video',
                'YouTube / Reel',
                'Custom',
              ]}
              onChange={setFormat}
            />
          ) : (
            <>
              <Field
                label="Episodes in season 1 (1–50)"
                type="number"
                value={episodeCount}
                onChange={setEpisodeCount}
              />
              <p className="creation-note">
                You can add more episodes and seasons later. Each episode has
                separate scenes, storyboards, and shots.
              </p>
            </>
          )}
          <button
            className="primary"
            disabled={
              !title.trim() ||
              (projectKind === 'series' &&
                (!Number.isInteger(Number(episodeCount)) ||
                  Number(episodeCount) < 1 ||
                  Number(episodeCount) > 50))
            }
            onClick={makeProject}
          >
            Create project <ArrowUpRight size={16} />
          </button>
        </DialogContent>
      </Dialog>
      <Dialog open={episodeDialog} onOpenChange={setEpisodeDialog}>
        <DialogContent>
          <DialogTitle>Add an episode</DialogTitle>
          <DialogDescription>
            A separate story, script, and visual plan within {rootProject.title}
            .
          </DialogDescription>
          <Field
            label="Episode title"
            value={episodeTitle}
            onChange={setEpisodeTitle}
          />
          <Field
            label="Season number (1–100)"
            type="number"
            value={season}
            onChange={setSeason}
          />
          <button
            className="primary"
            disabled={
              !episodeTitle.trim() ||
              !Number.isInteger(Number(season)) ||
              Number(season) < 1 ||
              Number(season) > 100
            }
            onClick={addEpisode}
          >
            Create episode <Plus size={16} />
          </button>
        </DialogContent>
      </Dialog>
      <Dialog open={addAct} onOpenChange={setAddAct}>
        <DialogContent>
          <DialogTitle>Add a story column</DialogTitle>
          <DialogDescription>
            Create an act, sequence, or custom story stage.
          </DialogDescription>
          <Field label="Column name" value={actName} onChange={setActName} />
          <button
            className="primary"
            disabled={!actName.trim() || project.acts.includes(actName.trim())}
            onClick={() => {
              update((p) => ({ ...p, acts: [...p.acts, actName.trim()] }));
              setAddAct(false);
              setActName('');
            }}
          >
            Add column
          </button>
        </DialogContent>
      </Dialog>
      <Sheet open={inspect && !!scene} onOpenChange={setInspect}>
        <SheetContent className="inspector">
          <SheetHeader>
            <SheetTitle>
              Scene {scene ? pad(project.scenes.indexOf(scene) + 1) : ''}
            </SheetTitle>
            <SheetDescription>
              Changes stay connected across your project.
            </SheetDescription>
          </SheetHeader>
          {scene && (
            <div className="inspector-body">
              <Field
                label="Scene heading"
                value={scene.heading}
                onChange={(heading) =>
                  patchScene(scene.id, {
                    heading,
                    blocks: scene.blocks.some((b) => b.type === 'scene_heading')
                      ? scene.blocks.map((b) =>
                          b.type === 'scene_heading'
                            ? { ...b, content: heading }
                            : b,
                        )
                      : [
                          {
                            id: uid(),
                            type: 'scene_heading',
                            content: heading,
                          },
                          ...scene.blocks,
                        ],
                  })
                }
              />
              <Button
                variant="outline"
                className="delete-element"
                onClick={() => askDelete('scene', scene.id, scene.heading)}
              >
                <Trash2 size={15} />
                Delete scene
              </Button>
              <Field
                label="Summary"
                value={scene.summary}
                onChange={(summary) => patchScene(scene.id, { summary })}
                multiline
              />
              <div className="emotion-picker">
                <span className="emotion-picker-title">
                  Scene emotion colour
                </span>
                <RadioGroup
                  aria-label="Scene emotion colour"
                  value={
                    emotionColours.some(
                      (c) => c.colour === (scene.colour ?? ''),
                    )
                      ? (scene.colour ?? '')
                      : 'custom'
                  }
                  onValueChange={(value) => {
                    const preset = emotionColours.find(
                      (c) => c.colour === value,
                    );
                    if (preset)
                      patchScene(scene.id, {
                        colour: preset.colour,
                        ...(preset.colour ? { emotion: preset.name } : {}),
                      });
                  }}
                  className="emotion-swatches"
                >
                  {emotionColours.map((c) => (
                    <label key={c.name}>
                      <RadioGroupItem
                        value={c.colour}
                        aria-label={c.name}
                        style={{ backgroundColor: c.colour || '#f0f2f4' }}
                      />
                      <span>{c.name}</span>
                    </label>
                  ))}
                </RadioGroup>
                <label className="custom-emotion">
                  Custom colour
                  <input
                    type="color"
                    aria-label="Custom scene emotion colour"
                    value={scene.colour || '#6689bd'}
                    onChange={(e) =>
                      patchScene(scene.id, { colour: e.target.value })
                    }
                  />
                </label>
                <Field
                  label="Emotion label (optional)"
                  value={scene.emotion ?? ''}
                  onChange={(emotion) =>
                    patchScene(scene.id, { emotion: emotion.slice(0, 100) })
                  }
                />
              </div>
              <div className="two-fields">
                <Choice
                  label="Act"
                  value={scene.act}
                  options={project.acts}
                  onChange={(act) => reorder(scene.id, act)}
                />
                <Choice
                  label="Status"
                  value={scene.status}
                  options={['outline', 'draft', 'revised', 'locked']}
                  onChange={(status) => patchScene(scene.id, { status })}
                />
              </div>
              <div className="two-fields">
                <Field
                  label="Duration (seconds)"
                  type="number"
                  value={scene.duration}
                  onChange={(v) =>
                    patchScene(scene.id, { duration: Math.max(0, Number(v)) })
                  }
                />
                <Field
                  label="Story day"
                  type="number"
                  value={scene.storyDay}
                  onChange={(v) =>
                    patchScene(scene.id, { storyDay: Math.max(1, Number(v)) })
                  }
                />
              </div>
              <Field
                label="Purpose"
                value={scene.purpose}
                onChange={(purpose) => patchScene(scene.id, { purpose })}
              />
              <Field
                label="Notes"
                value={scene.notes}
                onChange={(notes) => patchScene(scene.id, { notes })}
                multiline
              />
              <div className="linked-details">
                <p>CHARACTERS</p>
                <b>
                  {scene.characterIds
                    .map(
                      (id) => project.characters.find((c) => c.id === id)?.name,
                    )
                    .join(', ') || 'No character cues in this scene'}
                </b>
                <p>LOCATION</p>
                <b>
                  {
                    project.locations.find((l) => l.id === scene.locationId)
                      ?.name
                  }
                </b>
                <p>STORYBOARD</p>
                <b>
                  {project.panels.filter((p) => p.sceneId === scene.id).length}{' '}
                  panels / shots
                </b>
              </div>
              <button
                className="primary"
                onClick={() => {
                  setView('Screenplay');
                  setInspect(false);
                }}
              >
                Write this scene <ArrowUpRight size={16} />
              </button>
              <Button
                variant="outline"
                onClick={() => {
                  setView('Storyboard');
                  setInspect(false);
                }}
              >
                Open storyboard
              </Button>
            </div>
          )}
        </SheetContent>
      </Sheet>
      <Dialog open={newEntity} onOpenChange={setNewEntity}>
        <DialogContent>
          <DialogTitle>
            Add {view === 'Characters' ? 'character' : 'location'}
          </DialogTitle>
          <DialogDescription>
            Connect this entry to scenes by using its name in the screenplay.
          </DialogDescription>
          <Field label="Name" value={title} onChange={setTitle} />
          <button
            className="primary"
            disabled={!title.trim()}
            onClick={() => {
              const name = title.trim().toUpperCase();
              const list =
                view === 'Characters' ? project.characters : project.locations;
              if (list.some((e) => e.name === name)) {
                setNotice('That entry already exists.');
                return;
              }
              const id = uid();
              update((p) =>
                view === 'Characters'
                  ? {
                      ...p,
                      characters: [
                        ...p.characters,
                        {
                          id,
                          name,
                          role: '',
                          description: '',
                          goals: '',
                          fear: '',
                          backstory: '',
                          arc: '',
                          notes: '',
                        },
                      ],
                    }
                  : {
                      ...p,
                      locations: [
                        ...p.locations,
                        { id, name, description: '', notes: '' },
                      ],
                    },
              );
              setNewEntity(false);
              setEntityId(id);
            }}
          >
            Add entry
          </button>
        </DialogContent>
      </Dialog>
      <Sheet
        open={!!entityId}
        onOpenChange={(open) => {
          if (!open) setEntityId('');
        }}
      >
        <SheetContent className="inspector">
          <SheetHeader>
            <SheetTitle>{person?.name ?? place?.name}</SheetTitle>
            <SheetDescription>
              {person ? 'Character bible' : 'Location details'}
            </SheetDescription>
          </SheetHeader>
          <div className="inspector-body">
            {person && (
              <>
                <Field
                  label="Role"
                  value={person.role}
                  onChange={(v) =>
                    update((p) => ({
                      ...p,
                      characters: p.characters.map((c) =>
                        c.id === person.id ? { ...c, role: v } : c,
                      ),
                    }))
                  }
                />
                <Field
                  label="Description"
                  value={person.description}
                  onChange={(v) =>
                    update((p) => ({
                      ...p,
                      characters: p.characters.map((c) =>
                        c.id === person.id ? { ...c, description: v } : c,
                      ),
                    }))
                  }
                  multiline
                />
                <Field
                  label="Storyboard visual profile (appearance for prompts)"
                  value={person.visualDescription ?? ''}
                  onChange={(v) =>
                    update((p) => ({
                      ...p,
                      characters: p.characters.map((c) =>
                        c.id === person.id ? { ...c, visualDescription: v } : c,
                      ),
                    }))
                  }
                  multiline
                />
                {(
                  [
                    'goals',
                    'fear',
                    'backstory',
                    'arc',
                    'notes',
                  ] as const
                ).map((k) => (
                  <Field
                    key={k}
                    label={k}
                    value={person[k]}
                    onChange={(v) =>
                      update((p) => ({
                        ...p,
                        characters: p.characters.map((c) =>
                          c.id === person.id ? { ...c, [k]: v } : c,
                        ),
                      }))
                    }
                    multiline
                  />
                ))}
              </>
            )}
            {place && (
              <>
                <Field
                  label="Description"
                  value={place.description}
                  onChange={(v) =>
                    update((p) => ({
                      ...p,
                      locations: p.locations.map((l) =>
                        l.id === place.id ? { ...l, description: v } : l,
                      ),
                    }))
                  }
                  multiline
                />
                <Field
                  label="Storyboard visual profile (appearance for prompts)"
                  value={place.visualDescription ?? ''}
                  onChange={(v) =>
                    update((p) => ({
                      ...p,
                      locations: p.locations.map((l) =>
                        l.id === place.id ? { ...l, visualDescription: v } : l,
                      ),
                    }))
                  }
                  multiline
                />
                <Field
                  label="Notes"
                  value={place.notes}
                  onChange={(v) =>
                    update((p) => ({
                      ...p,
                      locations: p.locations.map((l) =>
                        l.id === place.id ? { ...l, notes: v } : l,
                      ),
                    }))
                  }
                  multiline
                />
              </>
            )}
            <Button
              variant="outline"
              className="delete-element"
              onClick={() =>
                askDelete(
                  person ? 'character' : 'location',
                  entityId,
                  person?.name ?? place?.name ?? 'entry',
                )
              }
            >
              <Trash2 size={15} />
              Delete {person ? 'character' : 'location'}
            </Button>
            <h3>Scene appearances</h3>
            {project.scenes
              .filter((s) =>
                person
                  ? s.characterIds.includes(entityId)
                  : s.locationId === entityId,
              )
              .map((s) => (
                <button
                  className="appearance"
                  key={s.id}
                  onClick={() => {
                    setEntityId('');
                    setSceneId(s.id);
                    setView('Screenplay');
                  }}
                >
                  Scene {pad(project.scenes.indexOf(s) + 1)}{' '}
                  <ChevronRight size={14} />
                </button>
              ))}
          </div>
        </SheetContent>
      </Sheet>
      <Dialog
        open={!!panelEdit}
        onOpenChange={(open) => {
          if (!open) setPanelEdit(null);
        }}
      >
        <DialogContent className="panel-dialog">
          <DialogTitle>Storyboard panel</DialogTitle>
          <DialogDescription>
            Saving this panel updates its shot list entry.
          </DialogDescription>
          {panelEdit && (
            <>
              <label
                className="upload-frame"
                onDragOver={(e) => e.preventDefault()}
                onDrop={(e) => {
                  e.preventDefault();
                  upload(e.dataTransfer.files[0]);
                }}
                onPaste={(e) => {
                  const f = Array.from(e.clipboardData.files).find((f) =>
                    f.type.startsWith('image/'),
                  );
                  if (f) upload(f);
                }}
                tabIndex={0}
              >
                {panelEdit.image ? (
                  <img src={panelEdit.image} alt="Storyboard preview" />
                ) : (
                  <>
                    <ImagePlus />
                    <span>Upload, drop, or paste an image</span>
                    <small>Up to 8 MB · saved on this device</small>
                  </>
                )}
                <input
                  type="file"
                  accept="image/*"
                  onChange={(e) => upload(e.target.files?.[0])}
                />
              </label>
              <div className="two-fields">
                <Choice
                  label="Shot size"
                  value={panelEdit.size}
                  options={[
                    'Wide',
                    'Medium',
                    'CU',
                    'ECU',
                    'Insert',
                    'Over the shoulder',
                  ]}
                  onChange={(size) => setPanelEdit({ ...panelEdit, size })}
                />
                <Choice
                  label="Status"
                  value={panelEdit.status}
                  options={['Planned', 'Ready', 'Complete']}
                  onChange={(status) => setPanelEdit({ ...panelEdit, status })}
                />
                <Field
                  label="Lens"
                  value={panelEdit.lens}
                  onChange={(lens) => setPanelEdit({ ...panelEdit, lens })}
                />
                <Field
                  label="Duration (seconds)"
                  type="number"
                  value={panelEdit.duration}
                  onChange={(v) =>
                    setPanelEdit({
                      ...panelEdit,
                      duration: Math.max(0, Number(v)),
                    })
                  }
                />
                <Field
                  label="Movement"
                  value={panelEdit.movement}
                  onChange={(movement) =>
                    setPanelEdit({ ...panelEdit, movement })
                  }
                />
                <Field
                  label="Angle"
                  value={panelEdit.angle}
                  onChange={(angle) => setPanelEdit({ ...panelEdit, angle })}
                />
              </div>
              <Field
                label="Description"
                value={panelEdit.description}
                onChange={(description) =>
                  setPanelEdit({ ...panelEdit, description })
                }
                multiline
              />
              <button
                className="primary"
                onClick={() => {
                  update((p) => ({
                    ...p,
                    panels: p.panels.some((x) => x.id === panelEdit.id)
                      ? p.panels.map((x) =>
                          x.id === panelEdit.id ? panelEdit : x,
                        )
                      : [...p.panels, panelEdit],
                  }));
                  setPanelEdit(null);
                  setNotice('Storyboard and shot list updated.');
                }}
              >
                Save panel <Check size={16} />
              </button>
              {project.panels.some((p) => p.id === panelEdit.id) && (
                <Button
                  variant="outline"
                  className="delete-element"
                  onClick={() =>
                    askDelete(
                      'panel',
                      panelEdit.id,
                      'this storyboard panel / shot',
                    )
                  }
                >
                  <Trash2 size={15} />
                  Delete panel / shot
                </Button>
              )}
              {panelEdit.image && (
                <Button
                  variant="outline"
                  onClick={() =>
                    setPanelEdit({ ...panelEdit, image: undefined })
                  }
                >
                  Remove image (save to apply)
                </Button>
              )}
            </>
          )}
        </DialogContent>
      </Dialog>
      {/* Storyboard Prompt Modal */}
      <Dialog
        open={!!promptModalPanel}
        onOpenChange={(open) => {
          if (!open) {
            setPromptModalPanel(null);
            setEditingCustomPrompt(false);
          }
        }}
      >
        <DialogContent className="prompt-dialog">
          <DialogTitle>Storyboard Prompt</DialogTitle>
          <DialogDescription>
            Deterministic production prompt compiled directly from your screenplay.
          </DialogDescription>
          {promptModalPanel && (() => {
            const currentScene = project.scenes.find((s) => s.id === promptModalPanel.sceneId) ?? scene;
            const currentHash = currentScene ? computeSceneContentHash(currentScene) : '';
            const isChanged = !!(promptModalPanel.sourceContentHash && promptModalPanel.sourceContentHash !== currentHash);

            const effectivePrompt = promptModalPanel.customPrompt ?? promptModalPanel.generatedPrompt ?? (
              currentScene
                ? buildStoryboardPrompt(
                    currentScene,
                    promptModalPanel.shotIntent ?? {
                      id: promptModalPanel.id,
                      sceneId: currentScene.id,
                      panelNumber: '01A',
                      shotSize: 'wide',
                      angle: 'eye_level',
                      movement: 'static',
                      purpose: 'establish',
                      description: promptModalPanel.description,
                      characterIds: currentScene.characterIds,
                      lens: promptModalPanel.lens,
                    },
                    project.characters,
                    project.locations.find((l) => l.id === currentScene.locationId),
                    project.aspectRatio || '16:9',
                    project.storyboardStyle || 'pencil',
                  )
                : ''
            );

            return (
              <div className="prompt-modal-content">
                <div className="prompt-meta-header">
                  <div className="prompt-scene-tag">{currentScene?.heading}</div>
                  <div className="prompt-shot-tags">
                    <span>{promptModalPanel.size}</span>
                    <span>{promptModalPanel.angle || 'Eye-level'}</span>
                    <span>{promptModalPanel.lens || '35mm'}</span>
                    <span>{promptModalPanel.movement || 'Static'}</span>
                  </div>
                </div>

                {isChanged && (
                  <div className="prompt-outdated-alert">
                    <span>⚠ Screenplay has changed since this prompt was planned</span>
                    <Button
                      variant="outline"
                      size="sm"
                      onClick={() => {
                        if (!currentScene) return;
                        const regenerated = buildStoryboardPrompt(
                          currentScene,
                          promptModalPanel.shotIntent ?? {
                            id: promptModalPanel.id,
                            sceneId: currentScene.id,
                            panelNumber: '01A',
                            shotSize: 'wide',
                            angle: 'eye_level',
                            movement: 'static',
                            purpose: 'establish',
                            description: promptModalPanel.description,
                            characterIds: currentScene.characterIds,
                            lens: promptModalPanel.lens,
                          },
                          project.characters,
                          project.locations.find((l) => l.id === currentScene.locationId),
                          project.aspectRatio || '16:9',
                          project.storyboardStyle || 'pencil',
                        );
                        const updatedPanel: Panel = {
                          ...promptModalPanel,
                          generatedPrompt: regenerated,
                          customPrompt: undefined,
                          sourceContentHash: currentHash,
                        };
                        update((p) => ({
                          ...p,
                          panels: p.panels.map((x) => x.id === updatedPanel.id ? updatedPanel : x),
                        }));
                        setPromptModalPanel(updatedPanel);
                        setEditingCustomPrompt(false);
                        setNotice('Prompt regenerated with latest scene changes.');
                      }}
                    >
                      <RefreshCw size={12} /> Refresh prompt
                    </Button>
                  </div>
                )}

                <div className="prompt-box">
                  {editingCustomPrompt ? (
                    <Textarea
                      className="prompt-textarea"
                      rows={12}
                      value={customPromptDraft}
                      onChange={(e) => setCustomPromptDraft(e.target.value)}
                    />
                  ) : (
                    <pre className="prompt-text-display">{effectivePrompt}</pre>
                  )}
                </div>

                <div className="prompt-modal-actions">
                  <Button
                    className="copy-prompt-btn"
                    onClick={() => {
                      navigator.clipboard.writeText(editingCustomPrompt ? customPromptDraft : effectivePrompt);
                      setCopiedPrompt(true);
                      setTimeout(() => setCopiedPrompt(false), 2000);
                    }}
                  >
                    {copiedPrompt ? <Check size={15} /> : <Copy size={15} />}
                    {copiedPrompt ? 'Copied to clipboard!' : 'Copy prompt'}
                  </Button>

                  {editingCustomPrompt ? (
                    <>
                      <Button
                        variant="default"
                        onClick={() => {
                          const updatedPanel: Panel = {
                            ...promptModalPanel,
                            customPrompt: customPromptDraft.trim(),
                          };
                          update((p) => ({
                            ...p,
                            panels: p.panels.map((x) => x.id === updatedPanel.id ? updatedPanel : x),
                          }));
                          setPromptModalPanel(updatedPanel);
                          setEditingCustomPrompt(false);
                          setNotice('Custom prompt saved.');
                        }}
                      >
                        Save custom prompt
                      </Button>
                      <Button
                        variant="ghost"
                        onClick={() => setEditingCustomPrompt(false)}
                      >
                        Cancel
                      </Button>
                    </>
                  ) : (
                    <>
                      <Button
                        variant="outline"
                        onClick={() => {
                          if (!currentScene) return;
                          const regenerated = buildStoryboardPrompt(
                            currentScene,
                            promptModalPanel.shotIntent ?? {
                              id: promptModalPanel.id,
                              sceneId: currentScene.id,
                              panelNumber: '01A',
                              shotSize: 'wide',
                              angle: 'eye_level',
                              movement: 'static',
                              purpose: 'establish',
                              description: promptModalPanel.description,
                              characterIds: currentScene.characterIds,
                              lens: promptModalPanel.lens,
                            },
                            project.characters,
                            project.locations.find((l) => l.id === currentScene.locationId),
                            project.aspectRatio || '16:9',
                            project.storyboardStyle || 'pencil',
                          );
                          const updatedPanel: Panel = {
                            ...promptModalPanel,
                            generatedPrompt: regenerated,
                            customPrompt: undefined,
                            sourceContentHash: currentHash,
                          };
                          update((p) => ({
                            ...p,
                            panels: p.panels.map((x) => x.id === updatedPanel.id ? updatedPanel : x),
                          }));
                          setPromptModalPanel(updatedPanel);
                          setNotice('Regenerated prompt from scene structure.');
                        }}
                      >
                        <RefreshCw size={13} /> Regenerate from scene
                      </Button>

                      <Button
                        variant="ghost"
                        onClick={() => {
                          setCustomPromptDraft(effectivePrompt);
                          setEditingCustomPrompt(true);
                        }}
                      >
                        Edit prompt
                      </Button>

                      {promptModalPanel.customPrompt && (
                        <Button
                          variant="ghost"
                          className="text-xs text-muted-foreground"
                          onClick={() => {
                            const updatedPanel: Panel = {
                              ...promptModalPanel,
                              customPrompt: undefined,
                            };
                            update((p) => ({
                              ...p,
                              panels: p.panels.map((x) => x.id === updatedPanel.id ? updatedPanel : x),
                            }));
                            setPromptModalPanel(updatedPanel);
                            setNotice('Reset to generated prompt.');
                          }}
                        >
                          Reset to generated
                        </Button>
                      )}
                    </>
                  )}
                </div>
              </div>
            );
          })()}
        </DialogContent>
      </Dialog>

      {/* Auto Storyboard Plan Modal */}
      <Dialog
        open={!!autoPlanScene}
        onOpenChange={(open) => {
          if (!open) setAutoPlanScene(null);
        }}
      >
        <DialogContent className="auto-plan-dialog">
          <DialogTitle>Auto Storyboard Plan</DialogTitle>
          <DialogDescription>
            Converts screenplay scenes into editable shot suggestions and production-ready visual prompts.
          </DialogDescription>
          {autoPlanScene && (() => {
            const plan = planSceneStoryboard(
              autoPlanScene,
              project.scenes.indexOf(autoPlanScene),
              project.characters,
              project.locations,
            );
            const scenePanelsCount = project.panels.filter((p) => p.sceneId === autoPlanScene.id).length;

            return (
              <div className="auto-plan-content">
                <div className="auto-plan-scene-heading">{autoPlanScene.heading}</div>
                <div className="auto-plan-badges">
                  <span className="pill-badge">{plan.detectedBeatsCount} visual beats</span>
                  <span className="pill-badge">{plan.speakingCharacters.length} speaking characters</span>
                  <span className="pill-badge">{plan.locationName}</span>
                  {plan.propsFound.length > 0 && (
                    <span className="pill-badge">{plan.propsFound.length} prop(s): {plan.propsFound.join(', ')}</span>
                  )}
                </div>

                <div className="auto-plan-shots-list">
                  <h4>Suggested Panels</h4>
                  <div className="shots-scroll">
                    {plan.suggestedPanels.map((shot) => (
                      <div className="suggested-shot-row" key={shot.id}>
                        <div className="shot-row-badge">
                          <Check size={14} className="text-green-600" />
                          <b>{shot.panelNumber}</b>
                        </div>
                        <div className="shot-row-details">
                          <div className="shot-row-type">
                            <span className="font-semibold text-slate-800">{shotSizeLabel(shot.shotSize)}</span>
                            <span className="text-slate-400">·</span>
                            <span className="text-slate-600">{shot.lens || '35mm'}</span>
                            <span className="text-slate-400">·</span>
                            <span className="text-slate-600">{cameraMovementLabel(shot.movement)}</span>
                          </div>
                          <p className="shot-row-desc">{shot.description}</p>
                        </div>
                      </div>
                    ))}
                  </div>
                </div>

                {scenePanelsCount > 0 && (
                  <label className="replace-panels-toggle">
                    <input
                      type="checkbox"
                      checked={replacePanels}
                      onChange={(e) => setReplacePanels(e.target.checked)}
                    />
                    <span>Replace existing {scenePanelsCount} panel(s) in this scene</span>
                  </label>
                )}

                <div className="auto-plan-actions">
                  <Button
                    className="create-panels-btn"
                    onClick={() => {
                      const sceneHash = computeSceneContentHash(autoPlanScene);
                      const generatedPanels: Panel[] = plan.suggestedPanels.map((shot) => {
                        const prompt = buildStoryboardPrompt(
                          autoPlanScene,
                          shot,
                          project.characters,
                          project.locations.find((l) => l.id === autoPlanScene.locationId),
                          project.aspectRatio || '16:9',
                          project.storyboardStyle || 'pencil',
                        );
                        return {
                          id: uid(),
                          sceneId: autoPlanScene.id,
                          size: shotSizeLabel(shot.shotSize),
                          angle: cameraAngleLabel(shot.angle),
                          lens: shot.lens || '35mm',
                          movement: cameraMovementLabel(shot.movement),
                          duration: shot.duration || 3,
                          description: shot.description,
                          status: 'Planned',
                          shotIntent: shot,
                          generatedPrompt: prompt,
                          promptVersion: 1,
                          sourceContentHash: sceneHash,
                        };
                      });

                      update((p) => {
                        const remaining = replacePanels
                          ? p.panels.filter((x) => x.sceneId !== autoPlanScene.id)
                          : p.panels;
                        return {
                          ...p,
                          panels: [...remaining, ...generatedPanels],
                        };
                      });

                      setAutoPlanScene(null);
                      setNotice(`Created ${generatedPanels.length} storyboard panels with deterministic prompts.`);
                    }}
                  >
                    <Sparkles size={15} /> Create {plan.suggestedPanels.length} panels
                  </Button>
                  <Button variant="ghost" onClick={() => setAutoPlanScene(null)}>
                    Cancel
                  </Button>
                </div>
              </div>
            );
          })()}
        </DialogContent>
      </Dialog>
      <AlertDialog
        open={!!deletion}
        onOpenChange={(open) => {
          if (!open) setDeletion(null);
        }}
      >
        <AlertDialogContent>
          <AlertDialogTitle>
            {deletion?.kind === 'story'
              ? 'Clear story content?'
              : 'Delete ' + (deletion?.name ?? 'item') + '?'}
          </AlertDialogTitle>
          <AlertDialogDescription>
            {deletion?.kind === 'episode'
              ? 'This removes the episode and all its scenes, script, storyboard panels, shots, characters, and locations. Other episodes are kept.'
              : deletion?.kind === 'scene' || deletion?.kind === 'act'
                ? 'This removes the selected scene(s), their screenplay text, and all linked storyboard panels and shots.'
                : deletion?.kind === 'character' ||
                    deletion?.kind === 'location'
                  ? 'This removes the bible entry and its scene links. Screenplay text is kept. The entry will not be automatically recreated; you can add it again manually.'
                  : deletion?.kind === 'story'
                    ? 'This clears the logline, premise, theme, synopsis, treatment, notes, and references. The title, format, runtime, scenes, and other workspaces are kept.'
                    : 'This removes the panel from both the storyboard and shot list, including its image.'}{' '}
            Changes save locally and sync to Firebase when signed in.
          </AlertDialogDescription>
          <AlertDialogFooter>
            <Button variant="outline" onClick={() => setDeletion(null)}>
              Cancel
            </Button>
            <Button variant="destructive" onClick={confirmDelete}>
              {deletion?.kind === 'story' ? 'Clear content' : 'Delete'}
            </Button>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
      {notice && (
        <div role="status" className="notice">
          {notice}
          <button aria-label="Dismiss" onClick={() => setNotice('')}>
            <X size={15} />
          </button>
        </div>
      )}
    </>
  );
}
function Empty({
  icon,
  title,
  text,
  label,
  action,
}: {
  icon: ReactNode;
  title: string;
  text: string;
  label: string;
  action: () => void;
}) {
  return (
    <EmptyPrimitive className="empty-state">
      {icon}
      <h2>{title}</h2>
      <p>{text}</p>
      <button className="primary" onClick={action}>
        <Plus size={15} />
        {label}
      </button>
    </EmptyPrimitive>
  );
}
