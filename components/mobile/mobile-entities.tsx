'use client';

import { useState } from 'react';
import {
  Users,
  MapPin,
  Plus,
  ChevronRight,
  ChevronLeft,
  Trash2,
  Check,
  FileText,
  Sparkles,
} from 'lucide-react';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Textarea } from '@/components/ui/textarea';
import {
  Sheet,
  SheetContent,
  SheetHeader,
  SheetTitle,
} from '@/components/ui/sheet';
import type { Project, Person, Place, Scene } from '@/lib/project';

interface MobileEntitiesProps {
  type: 'Characters' | 'Locations';
  project: Project;
  onUpdateProject: (updater: (p: Project) => Project) => void;
  onSelectScene?: (sceneId: string) => void;
  onDeleteEntity: (kind: 'character' | 'location', id: string, name: string) => void;
}

export function MobileEntities({
  type,
  project,
  onUpdateProject,
  onSelectScene,
  onDeleteEntity,
}: MobileEntitiesProps) {
  const [activeEntityId, setActiveEntityId] = useState<string | null>(null);
  const [createSheetOpen, setCreateSheetOpen] = useState(false);
  const [newName, setNewName] = useState('');

  const isCharacters = type === 'Characters';
  const list = isCharacters ? project.characters : project.locations;

  // Active selected entity
  const activePerson = isCharacters
    ? project.characters.find((c) => c.id === activeEntityId)
    : null;
  const activePlace = !isCharacters
    ? project.locations.find((l) => l.id === activeEntityId)
    : null;

  const handleCreate = () => {
    if (!newName.trim()) return;
    const name = newName.trim().toUpperCase();
    const id = 'ent_' + Math.random().toString(36).slice(2, 9);

    if (isCharacters) {
      onUpdateProject((p) => ({
        ...p,
        characters: [
          ...p.characters,
          {
            id,
            name,
            role: 'Supporting',
            description: '',
            visualDescription: '',
            goals: '',
            fear: '',
            backstory: '',
            arc: '',
            notes: '',
          },
        ],
      }));
    } else {
      onUpdateProject((p) => ({
        ...p,
        locations: [
          ...p.locations,
          {
            id,
            name,
            description: '',
            visualDescription: '',
            notes: '',
          },
        ],
      }));
    }

    setNewName('');
    setCreateSheetOpen(false);
    setActiveEntityId(id);
  };

  const pad = (n: number) => String(n).padStart(2, '0');

  return (
    <div className="mobile-entities-wrap">
      {/* Header with Title and Add Action */}
      <div className="mobile-entities-header">
        <div>
          <h2 className="text-base font-bold">
            {isCharacters ? 'Characters' : 'Locations'}
          </h2>
          <span className="text-xs text-muted-foreground">
            {list.length} {isCharacters ? 'cast members' : 'story locations'}
          </span>
        </div>

        <Button
          size="sm"
          className="h-8 gap-1 text-xs"
          onClick={() => {
            setNewName('');
            setCreateSheetOpen(true);
          }}
        >
          <Plus size={14} /> Add {isCharacters ? 'Character' : 'Location'}
        </Button>
      </div>

      {/* Vertical List */}
      <div className="mobile-entities-list">
        {list.length === 0 ? (
          <div className="mobile-empty-entities">
            <div className="empty-icon-wrap">
              {isCharacters ? <Users size={24} /> : <MapPin size={24} />}
            </div>
            <b className="text-sm">No {isCharacters ? 'characters' : 'locations'} yet</b>
            <p className="text-xs text-muted-foreground mt-1 mb-3">
              Add your story&apos;s {isCharacters ? 'characters' : 'locations'} or write them in the screenplay.
            </p>
            <Button size="sm" onClick={() => setCreateSheetOpen(true)}>
              <Plus size={13} className="mr-1" /> Add {isCharacters ? 'Character' : 'Location'}
            </Button>
          </div>
        ) : (
          list.map((item, idx) => {
            const appearances = project.scenes.filter((s) =>
              isCharacters
                ? s.characterIds.includes(item.id)
                : s.locationId === item.id,
            ).length;

            const role = isCharacters ? (item as Person).role : null;

            return (
              <button
                key={item.id}
                type="button"
                className="mobile-entity-item"
                onClick={() => setActiveEntityId(item.id)}
              >
                <div className={`mobile-entity-avatar av${idx % 4}`}>
                  {isCharacters ? item.name.slice(0, 1) : <MapPin size={16} />}
                </div>

                <div className="mobile-entity-content">
                  <div className="flex items-center gap-1.5">
                    <b className="text-sm font-bold truncate">{item.name}</b>
                    {role && (
                      <span className="entity-role-badge truncate">{role}</span>
                    )}
                  </div>
                  <small className="text-muted-foreground text-xs">
                    {appearances} {appearances === 1 ? 'scene' : 'scenes'}
                  </small>
                </div>

                <ChevronRight size={18} className="text-muted-foreground" />
              </button>
            );
          })
        )}
      </div>

      {/* Create Entity Sheet */}
      <Sheet open={createSheetOpen} onOpenChange={setCreateSheetOpen}>
        <SheetContent side="bottom" className="mobile-create-entity-sheet">
          <SheetHeader className="pb-2">
            <SheetTitle className="text-base font-semibold">
              Add {isCharacters ? 'Character' : 'Location'}
            </SheetTitle>
          </SheetHeader>
          <div className="space-y-3 py-2">
            <label className="block text-xs font-medium text-muted-foreground">
              {isCharacters ? 'Character Name (e.g. SIRISHA)' : 'Location Name (e.g. INTERVIEW ROOM)'}
            </label>
            <Input
              placeholder={isCharacters ? 'SIRISHA' : 'COFFEE SHOP'}
              value={newName}
              onChange={(e) => setNewName(e.target.value)}
              className="uppercase"
              autoFocus
            />
            <Button
              className="w-full mt-2"
              disabled={!newName.trim()}
              onClick={handleCreate}
            >
              Add {isCharacters ? 'Character' : 'Location'}
            </Button>
          </div>
        </SheetContent>
      </Sheet>

      {/* Full-Screen Detail Editor Form */}
      <Sheet
        open={!!activeEntityId}
        onOpenChange={(open) => !open && setActiveEntityId(null)}
      >
        <SheetContent
          side="bottom"
          showCloseButton={false}
          className="mobile-entity-fullscreen-sheet"
        >
          {/* Header Bar */}
          <div className="mobile-fullscreen-header">
            <button
              type="button"
              className="mobile-fullscreen-back"
              onClick={() => setActiveEntityId(null)}
            >
              <ChevronLeft size={20} />
              <span>{isCharacters ? 'Characters' : 'Locations'}</span>
            </button>
            <h3 className="font-bold text-sm truncate max-w-[160px]">
              {activePerson?.name ?? activePlace?.name}
            </h3>
            <button
              type="button"
              className="mobile-fullscreen-done"
              onClick={() => setActiveEntityId(null)}
            >
              Done
            </button>
          </div>

          {/* Form Content */}
          <div className="mobile-fullscreen-body">
            {activePerson && (
              <div className="space-y-4">
                <div>
                  <label className="text-xs font-medium text-muted-foreground">Character Name</label>
                  <Input
                    value={activePerson.name}
                    onChange={(e) => {
                      const val = e.target.value.toUpperCase();
                      onUpdateProject((p) => ({
                        ...p,
                        characters: p.characters.map((c) =>
                          c.id === activePerson.id ? { ...c, name: val } : c,
                        ),
                      }));
                    }}
                    className="font-bold uppercase mt-1"
                  />
                </div>

                <div>
                  <label className="text-xs font-medium text-muted-foreground">Role / Category</label>
                  <Input
                    placeholder="Lead, Supporting, Minor..."
                    value={activePerson.role}
                    onChange={(e) => {
                      const val = e.target.value;
                      onUpdateProject((p) => ({
                        ...p,
                        characters: p.characters.map((c) =>
                          c.id === activePerson.id ? { ...c, role: val } : c,
                        ),
                      }));
                    }}
                    className="mt-1"
                  />
                </div>

                <div>
                  <label className="text-xs font-medium text-muted-foreground">Description & Personality</label>
                  <Textarea
                    rows={3}
                    placeholder="Who are they? What defines their demeanor?"
                    value={activePerson.description}
                    onChange={(e) => {
                      const val = e.target.value;
                      onUpdateProject((p) => ({
                        ...p,
                        characters: p.characters.map((c) =>
                          c.id === activePerson.id ? { ...c, description: val } : c,
                        ),
                      }));
                    }}
                    className="mt-1 text-xs"
                  />
                </div>

                <div>
                  <label className="text-xs font-medium text-muted-foreground flex items-center gap-1">
                    <Sparkles size={12} className="text-amber-500" />
                    Storyboard Visual Profile (For Prompts)
                  </label>
                  <Textarea
                    rows={3}
                    placeholder="Physical appearance, clothes, age, hair for AI prompt generator..."
                    value={activePerson.visualDescription ?? ''}
                    onChange={(e) => {
                      const val = e.target.value;
                      onUpdateProject((p) => ({
                        ...p,
                        characters: p.characters.map((c) =>
                          c.id === activePerson.id ? { ...c, visualDescription: val } : c,
                        ),
                      }));
                    }}
                    className="mt-1 text-xs"
                  />
                </div>

                <div>
                  <label className="text-xs font-medium text-muted-foreground">Wants / Goals</label>
                  <Input
                    placeholder="What drives them in this story?"
                    value={activePerson.goals}
                    onChange={(e) => {
                      const val = e.target.value;
                      onUpdateProject((p) => ({
                        ...p,
                        characters: p.characters.map((c) =>
                          c.id === activePerson.id ? { ...c, goals: val } : c,
                        ),
                      }));
                    }}
                    className="mt-1 text-xs"
                  />
                </div>

                <div>
                  <label className="text-xs font-medium text-muted-foreground">Internal Fear / Flaw</label>
                  <Input
                    placeholder="What are they afraid of?"
                    value={activePerson.fear}
                    onChange={(e) => {
                      const val = e.target.value;
                      onUpdateProject((p) => ({
                        ...p,
                        characters: p.characters.map((c) =>
                          c.id === activePerson.id ? { ...c, fear: val } : c,
                        ),
                      }));
                    }}
                    className="mt-1 text-xs"
                  />
                </div>

                {/* Scene Appearances List */}
                <div className="pt-2">
                  <h4 className="text-xs font-bold uppercase tracking-wider text-muted-foreground mb-2">
                    Scene Appearances
                  </h4>
                  <div className="space-y-1">
                    {project.scenes
                      .filter((s) => s.characterIds.includes(activePerson.id))
                      .map((s) => (
                        <button
                          key={s.id}
                          type="button"
                          className="mobile-entity-scene-link"
                          onClick={() => {
                            setActiveEntityId(null);
                            onSelectScene?.(s.id);
                          }}
                        >
                          <div className="flex items-center gap-2">
                            <span className="font-mono text-xs text-muted-foreground">
                              Sc {pad(project.scenes.indexOf(s) + 1)}
                            </span>
                            <span className="text-xs font-medium truncate">
                              {s.heading}
                            </span>
                          </div>
                          <ChevronRight size={14} className="text-muted-foreground" />
                        </button>
                      ))}
                  </div>
                </div>

                {/* Delete button */}
                <div className="pt-4 border-t border-border/60">
                  <Button
                    variant="outline"
                    className="w-full text-destructive hover:bg-destructive/10 text-xs"
                    onClick={() => {
                      const name = activePerson.name;
                      const id = activePerson.id;
                      setActiveEntityId(null);
                      onDeleteEntity('character', id, name);
                    }}
                  >
                    <Trash2 size={14} className="mr-1.5" />
                    Delete Character
                  </Button>
                </div>
              </div>
            )}

            {activePlace && (
              <div className="space-y-4">
                <div>
                  <label className="text-xs font-medium text-muted-foreground">Location Name</label>
                  <Input
                    value={activePlace.name}
                    onChange={(e) => {
                      const val = e.target.value.toUpperCase();
                      onUpdateProject((p) => ({
                        ...p,
                        locations: p.locations.map((l) =>
                          l.id === activePlace.id ? { ...l, name: val } : l,
                        ),
                      }));
                    }}
                    className="font-bold uppercase mt-1"
                  />
                </div>

                <div>
                  <label className="text-xs font-medium text-muted-foreground">Setting Description</label>
                  <Textarea
                    rows={3}
                    placeholder="Atmosphere, lighting, furniture, key visual details..."
                    value={activePlace.description}
                    onChange={(e) => {
                      const val = e.target.value;
                      onUpdateProject((p) => ({
                        ...p,
                        locations: p.locations.map((l) =>
                          l.id === activePlace.id ? { ...l, description: val } : l,
                        ),
                      }));
                    }}
                    className="mt-1 text-xs"
                  />
                </div>

                <div>
                  <label className="text-xs font-medium text-muted-foreground flex items-center gap-1">
                    <Sparkles size={12} className="text-amber-500" />
                    Visual Profile (For Storyboard Prompts)
                  </label>
                  <Textarea
                    rows={3}
                    placeholder="Environment style, architectural cues for prompt compiler..."
                    value={activePlace.visualDescription ?? ''}
                    onChange={(e) => {
                      const val = e.target.value;
                      onUpdateProject((p) => ({
                        ...p,
                        locations: p.locations.map((l) =>
                          l.id === activePlace.id ? { ...l, visualDescription: val } : l,
                        ),
                      }));
                    }}
                    className="mt-1 text-xs"
                  />
                </div>

                {/* Scene Appearances List */}
                <div className="pt-2">
                  <h4 className="text-xs font-bold uppercase tracking-wider text-muted-foreground mb-2">
                    Scene Appearances
                  </h4>
                  <div className="space-y-1">
                    {project.scenes
                      .filter((s) => s.locationId === activePlace.id)
                      .map((s) => (
                        <button
                          key={s.id}
                          type="button"
                          className="mobile-entity-scene-link"
                          onClick={() => {
                            setActiveEntityId(null);
                            onSelectScene?.(s.id);
                          }}
                        >
                          <div className="flex items-center gap-2">
                            <span className="font-mono text-xs text-muted-foreground">
                              Sc {pad(project.scenes.indexOf(s) + 1)}
                            </span>
                            <span className="text-xs font-medium truncate">
                              {s.heading}
                            </span>
                          </div>
                          <ChevronRight size={14} className="text-muted-foreground" />
                        </button>
                      ))}
                  </div>
                </div>

                {/* Delete button */}
                <div className="pt-4 border-t border-border/60">
                  <Button
                    variant="outline"
                    className="w-full text-destructive hover:bg-destructive/10 text-xs"
                    onClick={() => {
                      const name = activePlace.name;
                      const id = activePlace.id;
                      setActiveEntityId(null);
                      onDeleteEntity('location', id, name);
                    }}
                  >
                    <Trash2 size={14} className="mr-1.5" />
                    Delete Location
                  </Button>
                </div>
              </div>
            )}
          </div>
        </SheetContent>
      </Sheet>
    </div>
  );
}
