'use client';

import { useState } from 'react';
import {
  ListVideo,
  Download,
  Sliders,
  Filter,
  Clock,
  ChevronRight,
  Sparkles,
} from 'lucide-react';
import { Button } from '@/components/ui/button';
import type { Project, Panel } from '@/lib/project';

interface MobileShotListProps {
  project: Project;
  onEditPanel: (panel: Panel) => void;
  onExportCsv: () => void;
  onSelectScene?: (sceneId: string) => void;
}

export function MobileShotList({
  project,
  onEditPanel,
  onExportCsv,
  onSelectScene,
}: MobileShotListProps) {
  const [filter, setFilter] = useState<string>('all');

  const pad = (n: number) => String(n).padStart(2, '0');

  // Compute all shots with linked scenes
  const allShots = project.scenes.flatMap((scene, sceneIndex) =>
    project.panels
      .filter((p) => p.sceneId === scene.id)
      .map((panel, panelIndex) => {
        const shotCode =
          pad(sceneIndex + 1) + String.fromCharCode(65 + (panelIndex % 26));
        return {
          panel,
          scene,
          sceneIndex,
          shotCode,
        };
      }),
  );

  // Filter shots based on active chip
  const filteredShots = allShots.filter((item) => {
    if (filter === 'all') return true;
    if (filter === 'planned') return (item.panel.status || 'Planned').toLowerCase() === 'planned';
    if (filter === 'ready') return (item.panel.status || '').toLowerCase() === 'ready';
    if (filter === 'complete') return (item.panel.status || '').toLowerCase() === 'complete';
    if (filter.startsWith('scene-')) {
      const sceneId = filter.replace('scene-', '');
      return item.scene.id === sceneId;
    }
    return true;
  });

  return (
    <div className="mobile-shotlist-wrap">
      {/* Top Header */}
      <div className="mobile-shotlist-header">
        <div>
          <h2 className="text-base font-bold">Shot List</h2>
          <span className="text-xs text-muted-foreground">
            {allShots.length} shots across {project.scenes.length} scenes
          </span>
        </div>

        <Button
          variant="outline"
          size="sm"
          className="h-8 text-xs gap-1.5"
          onClick={onExportCsv}
        >
          <Download size={13} />
          CSV
        </Button>
      </div>

      {/* Filter Chips Bar */}
      <div className="mobile-filter-chips">
        <button
          type="button"
          className={`filter-chip ${filter === 'all' ? 'active' : ''}`}
          onClick={() => setFilter('all')}
        >
          All ({allShots.length})
        </button>

        <button
          type="button"
          className={`filter-chip ${filter === 'ready' ? 'active' : ''}`}
          onClick={() => setFilter('ready')}
        >
          Ready ({allShots.filter((s) => (s.panel.status || '').toLowerCase() === 'ready').length})
        </button>

        <button
          type="button"
          className={`filter-chip ${filter === 'planned' ? 'active' : ''}`}
          onClick={() => setFilter('planned')}
        >
          Planned ({allShots.filter((s) => (s.panel.status || 'Planned').toLowerCase() === 'planned').length})
        </button>

        <button
          type="button"
          className={`filter-chip ${filter === 'complete' ? 'active' : ''}`}
          onClick={() => setFilter('complete')}
        >
          Complete ({allShots.filter((s) => (s.panel.status || '').toLowerCase() === 'complete').length})
        </button>

        {project.scenes.map((s, idx) => (
          <button
            key={s.id}
            type="button"
            className={`filter-chip ${filter === `scene-${s.id}` ? 'active' : ''}`}
            onClick={() => setFilter(`scene-${s.id}`)}
          >
            Sc {pad(idx + 1)}
          </button>
        ))}
      </div>

      {/* Shots Cards List */}
      <div className="mobile-shots-container">
        {filteredShots.length === 0 ? (
          <div className="mobile-empty-shots">
            <ListVideo size={24} className="text-muted-foreground mb-1" />
            <b className="text-sm">No shots match filter</b>
            <p className="text-xs text-muted-foreground mt-1">
              Add panels in the Storyboard to generate your camera shot list.
            </p>
          </div>
        ) : (
          filteredShots.map(({ panel, scene, sceneIndex, shotCode }) => (
            <article key={panel.id} className="mobile-shot-card">
              <div className="flex items-start justify-between gap-2">
                <div className="flex items-center gap-2">
                  <span className="mobile-shot-badge">{shotCode}</span>
                  <div>
                    <b className="text-sm font-bold block">{panel.size || 'Wide'}</b>
                    <span className="text-xs text-muted-foreground">
                      {panel.lens || '35mm'} · {panel.movement || 'Static'}
                    </span>
                  </div>
                </div>

                <span className={`status ${(panel.status || 'planned').toLowerCase()}`}>
                  {panel.status || 'Planned'}
                </span>
              </div>

              {/* Linked Scene Info */}
              <div
                className="mobile-shot-scene-link"
                onClick={() => onSelectScene?.(scene.id)}
              >
                <span className="font-mono text-[11px] text-muted-foreground">
                  SCENE {pad(sceneIndex + 1)}
                </span>
                <p className="text-xs font-medium truncate">{scene.heading}</p>
              </div>

              {panel.description && (
                <p className="text-xs text-muted-foreground line-clamp-2 mt-1">
                  {panel.description}
                </p>
              )}

              <div className="mobile-shot-card-footer">
                <span className="text-[11px] font-mono text-muted-foreground flex items-center gap-1">
                  <Clock size={11} /> {panel.duration || 3}s
                </span>

                <Button
                  variant="outline"
                  size="sm"
                  className="h-7 text-xs gap-1"
                  onClick={() => onEditPanel(panel)}
                >
                  <Sliders size={12} />
                  Edit Shot
                </Button>
              </div>
            </article>
          ))
        )}
      </div>
    </div>
  );
}
