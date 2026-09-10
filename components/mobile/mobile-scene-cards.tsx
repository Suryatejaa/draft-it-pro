'use client';

import { useState } from 'react';
import {
  ChevronDown,
  ChevronRight,
  Plus,
  Clock,
  Trash2,
  Palette,
  ArrowUp,
  ArrowDown,
  GripVertical,
  FileText,
  Users,
} from 'lucide-react';
import { Button } from '@/components/ui/button';
import type { Project, Scene } from '@/lib/project';

interface MobileSceneCardsProps {
  project: Project;
  onOpenScene: (sceneId: string) => void;
  onWriteScene?: (sceneId: string) => void;
  onAddScene: (act: string) => void;
  onAddAct?: () => void;
  onShiftScene: (sceneId: string, direction: -1 | 1) => void;
  onDeleteScene: (sceneId: string, heading: string) => void;
  onDeleteAct?: (act: string) => void;
}

export function MobileSceneCards({
  project,
  onOpenScene,
  onWriteScene,
  onAddScene,
  onAddAct,
  onShiftScene,
  onDeleteScene,
  onDeleteAct,
}: MobileSceneCardsProps) {
  // Acts collapsed state (by default all open)
  const [collapsedActs, setCollapsedActs] = useState<Record<string, boolean>>({});

  const toggleAct = (act: string) => {
    setCollapsedActs((prev) => ({
      ...prev,
      [act]: !prev[act],
    }));
  };

  const pad = (n: number) => String(n).padStart(2, '0');
  const formatTime = (secs: number) => {
    const m = Math.floor(secs / 60);
    const s = secs % 60;
    return `${m}m ${pad(s)}s`;
  };

  return (
    <div className="mobile-cards-stack">
      <div className="mobile-cards-top-actions">
        <div className="text-xs text-muted-foreground font-medium">
          {project.scenes.length} total scenes · {project.acts.length} acts
        </div>
        {onAddAct && (
          <Button
            variant="outline"
            size="sm"
            className="h-8 text-xs gap-1"
            onClick={onAddAct}
          >
            <Plus size={13} /> Add Act
          </Button>
        )}
      </div>

      <div className="space-y-4">
        {project.acts.map((act, actIndex) => {
          const actScenes = project.scenes.filter((s) => s.act === act);
          const actDuration = actScenes.reduce((acc, s) => acc + (s.duration || 0), 0);
          const isCollapsed = !!collapsedActs[act];

          return (
            <div key={act} className="mobile-act-section">
              {/* Collapsible Act Header */}
              <div
                className="mobile-act-header"
                onClick={() => toggleAct(act)}
                role="button"
                tabIndex={0}
                aria-expanded={!isCollapsed}
              >
                <div className="flex items-center gap-2 min-w-0">
                  <span className="text-muted-foreground">
                    {isCollapsed ? <ChevronRight size={16} /> : <ChevronDown size={16} />}
                  </span>
                  <span className={`act-dot d${actIndex % 5}`} />
                  <h2 className="text-sm font-bold uppercase tracking-wider truncate">
                    {act}
                  </h2>
                  <span className="mobile-act-badge">
                    {actScenes.length} {actScenes.length === 1 ? 'scene' : 'scenes'}
                  </span>
                </div>

                <div className="flex items-center gap-2 text-xs text-muted-foreground" onClick={(e) => e.stopPropagation()}>
                  <span className="font-mono text-[11px]">{formatTime(actDuration)}</span>
                  <button
                    type="button"
                    className="mobile-add-scene-mini"
                    onClick={() => onAddScene(act)}
                    aria-label={`Add scene to ${act}`}
                  >
                    <Plus size={14} />
                  </button>
                </div>
              </div>

              {/* Collapsible Scenes Stack */}
              {!isCollapsed && (
                <div className="mobile-act-content">
                  {actScenes.length === 0 ? (
                    <div className="mobile-empty-act">
                      <p className="text-xs text-muted-foreground mb-2">No scenes in this act.</p>
                      <Button
                        variant="outline"
                        size="sm"
                        className="text-xs"
                        onClick={() => onAddScene(act)}
                      >
                        <Plus size={12} className="mr-1" /> Add first scene
                      </Button>
                    </div>
                  ) : (
                    actScenes.map((scene) => {
                      const sceneIndex = project.scenes.findIndex((s) => s.id === scene.id);
                      const sceneNumber = sceneIndex + 1;
                      const characterNames = scene.characterIds
                        .map((id) => project.characters.find((c) => c.id === id)?.name)
                        .filter(Boolean)
                        .join(' · ');

                      return (
                        <article
                          key={scene.id}
                          className="mobile-scene-card"
                          style={
                            scene.colour
                              ? {
                                  borderLeftColor: scene.colour,
                                  backgroundImage: `linear-gradient(to right, ${scene.colour}12, transparent)`,
                                }
                              : undefined
                          }
                        >
                          <div
                            className="mobile-card-main"
                            onClick={() => onOpenScene(scene.id)}
                            role="button"
                            tabIndex={0}
                          >
                            <div className="mobile-card-header">
                              <div className="flex items-center gap-1.5 min-w-0">
                                <span className="mobile-card-number">
                                  {pad(sceneNumber)}
                                </span>
                                <h3 className="mobile-card-heading truncate">
                                  {scene.heading || 'UNTITLED SCENE'}
                                </h3>
                              </div>
                              <span className={`status ${scene.status || 'outline'}`}>
                                {scene.status || 'outline'}
                              </span>
                            </div>

                            {scene.summary ? (
                              <p className="mobile-card-summary">
                                {scene.summary}
                              </p>
                            ) : (
                              <p className="mobile-card-summary empty">
                                Add a summary to shape this scene…
                              </p>
                            )}

                            {scene.emotion && (
                              <div className="mobile-card-emotion">
                                <span
                                  className="emotion-dot"
                                  style={{ background: scene.colour || '#a6afb9' }}
                                />
                                <span>{scene.emotion}</span>
                              </div>
                            )}

                            <div className="mobile-card-footer">
                              <span className="truncate flex-1">
                                {characterNames || 'No dialogue cues'}
                              </span>
                              <span className="shrink-0 flex items-center gap-1 font-mono text-[11px]">
                                <Clock size={11} /> {scene.duration}s
                              </span>
                            </div>
                          </div>

                          {/* Quick Mobile Tool Row */}
                          <div className="mobile-card-actions">
                            <div className="flex items-center gap-1">
                              {onWriteScene && (
                                <button
                                  type="button"
                                  className="mobile-card-action-btn write"
                                  onClick={() => onWriteScene(scene.id)}
                                  title="Write screenplay"
                                >
                                  <FileText size={13} />
                                  <span>Write</span>
                                </button>
                              )}
                              <button
                                type="button"
                                className="mobile-card-action-btn"
                                onClick={() => onOpenScene(scene.id)}
                                title="Scene details"
                              >
                                Edit
                              </button>
                            </div>

                            <div className="flex items-center gap-1">
                              <button
                                type="button"
                                className="mobile-card-icon-btn"
                                disabled={sceneIndex === 0}
                                onClick={() => onShiftScene(scene.id, -1)}
                                aria-label="Move scene up"
                              >
                                <ArrowUp size={13} />
                              </button>
                              <button
                                type="button"
                                className="mobile-card-icon-btn"
                                disabled={sceneIndex === project.scenes.length - 1}
                                onClick={() => onShiftScene(scene.id, 1)}
                                aria-label="Move scene down"
                              >
                                <ArrowDown size={13} />
                              </button>
                              <button
                                type="button"
                                className="mobile-card-icon-btn text-destructive"
                                onClick={() => onDeleteScene(scene.id, scene.heading)}
                                aria-label={`Delete scene ${sceneNumber}`}
                              >
                                <Trash2 size={13} />
                              </button>
                            </div>
                          </div>
                        </article>
                      );
                    })
                  )}

                  <button
                    type="button"
                    className="mobile-add-card-btn"
                    onClick={() => onAddScene(act)}
                  >
                    <Plus size={14} /> Add scene to {act}
                  </button>
                </div>
              )}
            </div>
          );
        })}
      </div>
    </div>
  );
}
