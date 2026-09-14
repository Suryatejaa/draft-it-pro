'use client';
import { useState } from 'react';
import type { Project } from '@/lib/project';
import { parseSceneHeading } from '@/lib/project';
import { Button } from '@/components/ui/button';
import { CompactField, CollapsibleSection } from './workspace-ui';
/** Repair the semantic identity without replacing the original scene or downstream IDs. */
export function SceneQuarantine({
  project,
  onUpdate,
}: {
  project: Project;
  onUpdate: (fn: (p: Project) => Project) => void;
}) {
  const [headings, setHeadings] = useState<Record<string, string>>({});
  if (!project.sceneQuarantine?.length) return null;
  const count = project.sceneQuarantine.length;
  return (
    <CollapsibleSection
      title={`⚠ ${count} screenplay issue${count > 1 ? 's' : ''} · Review`}
    >
      <p>
        These records are excluded from active production planning. Their
        screenplay content and linked manual work are preserved.
      </p>
      {project.sceneQuarantine.map(({ scene, reason }) => (
        <div className="quarantine-record" key={scene.id}>
          <b>{scene.heading || 'Empty heading'}</b>
          <p>{reason}</p>
          <CollapsibleSection title="Preserved screenplay content">
            <pre>{scene.blocks.map((b) => b.content).join('\n')}</pre>
          </CollapsibleSection>
          <CompactField
            title="Correct scene heading"
            value={headings[scene.id] ?? ''}
            onChange={(v) => setHeadings({ ...headings, [scene.id]: v })}
          />
          <Button
            disabled={!parseSceneHeading(headings[scene.id] ?? '')}
            variant="outline"
            onClick={() =>
              onUpdate((p) => {
                const heading = headings[scene.id].trim();
                const found = p.sceneQuarantine?.find(
                  (q) => q.scene.id === scene.id,
                );
                if (!found || !parseSceneHeading(heading)) return p;
                const blocks = [...found.scene.blocks];
                const at = blocks.findIndex((b) => b.type === 'scene_heading');
                if (at >= 0) blocks[at] = { ...blocks[at], content: heading };
                else
                  blocks.unshift({
                    id: crypto.randomUUID(),
                    type: 'scene_heading',
                    content: heading,
                  });
                return {
                  ...p,
                  scenes: [...p.scenes, { ...found.scene, heading, blocks }],
                  sceneQuarantine: p.sceneQuarantine?.filter(
                    (q) => q.scene.id !== scene.id,
                  ),
                };
              })
            }
          >
            Restore scene with this heading
          </Button>
        </div>
      ))}
    </CollapsibleSection>
  );
}
