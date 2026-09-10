'use client';

import { useState, useMemo, useEffect } from 'react';
import { EditorContent, type Editor } from '@tiptap/react';
import {
  ChevronDown,
  ChevronLeft,
  ChevronRight,
  Eye,
  Undo2,
  Redo2,
  Plus,
  Search,
  Check,
  Sparkles,
  Layers,
  Edit3,
  X,
} from 'lucide-react';
import {
  Sheet,
  SheetContent,
  SheetHeader,
  SheetTitle,
  SheetDescription,
} from '@/components/ui/sheet';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { elementTypes, type Scene, type ElementType } from '@/lib/project';

interface MobileScriptEditorProps {
  editor: Editor | null;
  scene: Scene;
  allScenes: Scene[];
  acts: string[];
  activeType: ElementType | string;
  onFormat: (type: ElementType) => void;
  onSelectScene: (sceneId: string) => void;
  onAddScene?: () => void;
  onOpenSceneDetails?: () => void;
  locations?: string[];
  isTypingFocus?: boolean;
  onTypingFocusChange?: (isTyping: boolean) => void;
}

export function MobileScriptEditor({
  editor,
  scene,
  allScenes,
  acts,
  activeType,
  onFormat,
  onSelectScene,
  onAddScene,
  onOpenSceneDetails,
  locations = [],
  isTypingFocus: propIsTypingFocus,
  onTypingFocusChange,
}: MobileScriptEditorProps) {
  const [sceneSelectorOpen, setSceneSelectorOpen] = useState(false);
  const [elementMenuOpen, setElementMenuOpen] = useState(false);
  const [pagePreviewOpen, setPagePreviewOpen] = useState(false);
  const [sceneSearch, setSceneSearch] = useState('');
  const [previewZoom, setPreviewZoom] = useState(0.42); // Fits 8.5in paper into typical 390px mobile screen
  const [internalTypingFocus, setInternalTypingFocus] = useState(false);

  const isTypingFocus =
    propIsTypingFocus !== undefined ? propIsTypingFocus : internalTypingFocus;

  const setTypingFocus = (val: boolean) => {
    setInternalTypingFocus(val);
    onTypingFocusChange?.(val);
  };

  // Compute scene index and navigation
  const currentIndex = allScenes.findIndex((s) => s.id === scene.id);
  const totalScenes = allScenes.length;
  const prevScene = currentIndex > 0 ? allScenes[currentIndex - 1] : null;
  const nextScene = currentIndex < totalScenes - 1 ? allScenes[currentIndex + 1] : null;

  const pad = (n: number) => String(n).padStart(2, '0');

  // Filter scenes for scene selector sheet
  const filteredScenes = useMemo(() => {
    if (!sceneSearch.trim()) return allScenes;
    const q = sceneSearch.toLowerCase();
    return allScenes.filter(
      (s) =>
        s.heading.toLowerCase().includes(q) ||
        (s.summary && s.summary.toLowerCase().includes(q)) ||
        s.act.toLowerCase().includes(q),
    );
  }, [allScenes, sceneSearch]);

  // Handle parenthetical insert / toggle
  const handleParenthetical = () => {
    if (!editor) return;
    const currentKind = editor.getAttributes('paragraph').kind;
    if (currentKind === 'parenthetical') {
      onFormat('dialogue');
    } else {
      onFormat('parenthetical');
    }
  };

  // Listen to editor focus / blur for distraction-free mode
  useEffect(() => {
    if (!editor) return;

    const handleFocus = () => setTypingFocus(true);
    const handleBlur = () => {
      // Delay slightly in case of tapping formatting buttons
      setTimeout(() => {
        if (
          !document.activeElement?.closest('.mobile-focus-editor-wrap') &&
          !document.activeElement?.closest('[data-slot="sheet-content"]')
        ) {
          setTypingFocus(false);
        }
      }, 180);
    };

    editor.on('focus', handleFocus);
    editor.on('blur', handleBlur);

    return () => {
      editor.off('focus', handleFocus);
      editor.off('blur', handleBlur);
    };
  }, [editor]);

  // Render contextual action buttons in the mobile formatting bar
  const renderContextButtons = () => {
    const isDialogue = activeType === 'dialogue';
    const isCharacter = activeType === 'character';

    if (isDialogue) {
      return (
        <>
          <button
            type="button"
            className="mobile-format-btn special"
            onClick={handleParenthetical}
            title="Parenthetical"
          >
            ( )
          </button>
          <button
            type="button"
            className="mobile-format-btn"
            onClick={() => onFormat('character')}
          >
            Character
          </button>
          <button
            type="button"
            className="mobile-format-btn icon-only"
            onClick={() => editor?.chain().focus().undo().run()}
            aria-label="Undo"
          >
            <Undo2 size={16} />
          </button>
        </>
      );
    }

    if (isCharacter) {
      return (
        <>
          <button
            type="button"
            className="mobile-format-btn"
            onClick={() => onFormat('dialogue')}
          >
            Dialogue
          </button>
          <button
            type="button"
            className="mobile-format-btn"
            onClick={handleParenthetical}
          >
            ( )
          </button>
          <button
            type="button"
            className="mobile-format-btn icon-only"
            onClick={() => editor?.chain().focus().undo().run()}
            aria-label="Undo"
          >
            <Undo2 size={16} />
          </button>
        </>
      );
    }

    // Default when in action, scene_heading, transition, shot:
    return (
      <>
        <button
          type="button"
          className="mobile-format-btn"
          onClick={() => onFormat('character')}
        >
          Character
        </button>
        <button
          type="button"
          className="mobile-format-btn"
          onClick={() => onFormat('dialogue')}
        >
          Dialogue
        </button>
        <button
          type="button"
          className="mobile-format-btn icon-only"
          onClick={() => setElementMenuOpen(true)}
          aria-label="All Elements"
        >
          <Plus size={16} />
        </button>
      </>
    );
  };

  return (
    <div className={`mobile-focus-editor-wrap ${isTypingFocus ? 'typing-focus' : ''}`}>
      {/* Top Scene Selector Bar */}
      <div className="mobile-scene-header">
        <button
          type="button"
          className="mobile-scene-selector-trigger"
          onClick={() => setSceneSelectorOpen(true)}
        >
          <div className="flex flex-col items-start min-w-0">
            <span className="scene-count-badge flex items-center gap-1">
              Scene {pad(currentIndex + 1)} of {pad(totalScenes)}
              <ChevronDown size={12} className="opacity-70" />
            </span>
            <span className="scene-heading-title truncate">
              {scene.heading || 'UNTITLED SCENE'}
            </span>
          </div>
        </button>

        <div className="flex items-center gap-1.5 shrink-0">
          <Button
            variant="outline"
            size="sm"
            className="mobile-preview-btn"
            onClick={() => setPagePreviewOpen(true)}
            title="Open industry 8.5x11 page preview"
          >
            <Eye size={13} className="mr-1" />
            Page
          </Button>

          {isTypingFocus && (
            <Button
              variant="default"
              size="sm"
              className="mobile-done-btn"
              onClick={() => {
                // Blur editor to exit typing focus mode
                (document.activeElement as HTMLElement)?.blur();
                setTypingFocus(false);
              }}
            >
              <Check size={14} className="mr-0.5" />
              Done
            </Button>
          )}
        </div>
      </div>

      {/* Focus Mode Writing Container (Phone-friendly Courier typography) */}
      <div className="mobile-focus-canvas">
        <div className="mobile-focus-editor">
          <EditorContent editor={editor} />
        </div>

        {/* Scene Navigation at bottom of text */}
        <div className="mobile-scene-bottom-nav">
          <button
            type="button"
            className="mobile-nav-scene-btn"
            disabled={!prevScene}
            onClick={() => prevScene && onSelectScene(prevScene.id)}
          >
            <ChevronLeft size={16} />
            <span>Prev Scene</span>
          </button>

          {onOpenSceneDetails && (
            <button
              type="button"
              className="mobile-scene-details-link"
              onClick={onOpenSceneDetails}
            >
              Scene Details
            </button>
          )}

          <button
            type="button"
            className="mobile-nav-scene-btn"
            disabled={!nextScene}
            onClick={() => nextScene && onSelectScene(nextScene.id)}
          >
            <span>Next Scene</span>
            <ChevronRight size={16} />
          </button>
        </div>
      </div>

      {/* Floating Write Button when not in typing mode */}
      {!isTypingFocus && (
        <button
          type="button"
          className="mobile-write-fab"
          onClick={() => {
            editor?.commands.focus();
            setTypingFocus(true);
          }}
          aria-label="Write screenplay"
        >
          <Edit3 size={15} />
          <span>Write / Format</span>
        </button>
      )}

      {/* Compact Formatting Bar Immediately Above Keyboard (Only when typing) */}
      {isTypingFocus && (
        <div className="mobile-keyboard-toolbar">
          {/* Active Element Dropdown Trigger */}
          <button
            type="button"
            className="mobile-format-main-btn"
            onClick={() => setElementMenuOpen(true)}
          >
            <span className="capitalize">{String(activeType).replace('_', ' ')}</span>
            <ChevronDown size={12} />
          </button>

          <div className="mobile-format-actions">
            {renderContextButtons()}
          </div>
        </div>
      )}

      {/* Element Type Bottom Sheet */}
      <Sheet open={elementMenuOpen} onOpenChange={setElementMenuOpen}>
        <SheetContent side="bottom" className="mobile-element-sheet">
          <SheetHeader className="pb-2">
            <SheetTitle className="text-base font-semibold">Screenplay Element</SheetTitle>
            <SheetDescription className="text-xs">
              Change block type or formatting
            </SheetDescription>
          </SheetHeader>

          <div className="mobile-element-grid">
            {elementTypes.map((t) => {
              const isSelected = activeType === t;
              return (
                <button
                  key={t}
                  type="button"
                  className={`mobile-element-choice ${isSelected ? 'selected' : ''}`}
                  onClick={() => {
                    onFormat(t);
                    setElementMenuOpen(false);
                  }}
                >
                  <span className="choice-label capitalize">
                    {t.replace('_', ' ')}
                  </span>
                  {isSelected && <Check size={16} className="text-primary" />}
                </button>
              );
            })}
          </div>

          <div className="flex items-center justify-between pt-2 border-t border-border/50 text-xs text-muted-foreground">
            <span>Tip: Enter continues script · Tab cycles</span>
            <button
              type="button"
              className="text-primary font-medium"
              onClick={() => setElementMenuOpen(false)}
            >
              Done
            </button>
          </div>
        </SheetContent>
      </Sheet>

      {/* Scene Navigation Bottom Sheet */}
      <Sheet open={sceneSelectorOpen} onOpenChange={setSceneSelectorOpen}>
        <SheetContent side="bottom" className="mobile-scenes-sheet">
          <SheetHeader className="pb-2">
            <div className="flex items-center justify-between">
              <div>
                <SheetTitle className="text-base font-semibold">Scenes</SheetTitle>
                <SheetDescription className="text-xs">
                  {allScenes.length} scenes in script
                </SheetDescription>
              </div>
              {onAddScene && (
                <Button
                  size="sm"
                  variant="outline"
                  onClick={() => {
                    setSceneSelectorOpen(false);
                    onAddScene();
                  }}
                  className="h-8 gap-1 text-xs"
                >
                  <Plus size={13} />
                  New Scene
                </Button>
              )}
            </div>
            <div className="relative mt-2">
              <Search className="absolute left-2.5 top-2.5 h-3.5 w-3.5 text-muted-foreground" />
              <Input
                placeholder="Search scene headings or summaries…"
                value={sceneSearch}
                onChange={(e) => setSceneSearch(e.target.value)}
                className="pl-8 h-8 text-xs bg-muted/50"
              />
            </div>
          </SheetHeader>

          <div className="mobile-scenes-list">
            {acts.map((act) => {
              const actScenes = filteredScenes.filter((s) => s.act === act);
              if (!actScenes.length) return null;

              return (
                <div key={act} className="act-group mb-3">
                  <div className="act-group-header">
                    <span>{act}</span>
                    <span className="text-[11px] text-muted-foreground">
                      {actScenes.length} scenes
                    </span>
                  </div>
                  <div className="space-y-1 mt-1">
                    {actScenes.map((s) => {
                      const num = allScenes.indexOf(s) + 1;
                      const isCurrent = s.id === scene.id;
                      return (
                        <button
                          key={s.id}
                          type="button"
                          className={`mobile-scene-item ${isCurrent ? 'selected' : ''}`}
                          onClick={() => {
                            onSelectScene(s.id);
                            setSceneSelectorOpen(false);
                          }}
                        >
                          <span className="scene-num">{pad(num)}</span>
                          <div className="scene-info min-w-0 text-left flex-1">
                            <b className="truncate block text-xs">{s.heading}</b>
                            {s.summary && (
                              <p className="line-clamp-1 text-[11px] text-muted-foreground">
                                {s.summary}
                              </p>
                            )}
                          </div>
                          {isCurrent && (
                            <Check size={14} className="text-primary ml-1 shrink-0" />
                          )}
                        </button>
                      );
                    })}
                  </div>
                </div>
              );
            })}
          </div>
        </SheetContent>
      </Sheet>

      {/* Page Preview Sheet (8.5x11 Industry Screenplay Preview) */}
      <Sheet open={pagePreviewOpen} onOpenChange={setPagePreviewOpen}>
        <SheetContent side="bottom" className="mobile-page-preview-sheet">
          <SheetHeader className="pb-1 border-b border-border/40">
            <div className="flex items-center justify-between">
              <div>
                <SheetTitle className="text-sm font-semibold flex items-center gap-1.5">
                  <Eye size={15} /> Page Preview (8.5 × 11)
                </SheetTitle>
                <SheetDescription className="text-[11px]">
                  Standard Hollywood geometry and pagination
                </SheetDescription>
              </div>
              <div className="flex items-center gap-2">
                <span className="text-[11px] text-muted-foreground">
                  {Math.round(previewZoom * 100)}%
                </span>
                <button
                  type="button"
                  className="text-xs text-primary font-medium px-2 py-1"
                  onClick={() => setPagePreviewOpen(false)}
                >
                  Close
                </button>
              </div>
            </div>
          </SheetHeader>

          <div className="mobile-preview-viewport">
            <div
              className="screenplay-page preview-paper"
              style={{
                transform: `scale(${previewZoom})`,
                transformOrigin: 'top center',
              }}
            >
              <div className="paper-number">SCENE {scene.heading}</div>
              <div
                className="screenplay-document"
                dangerouslySetInnerHTML={{
                  __html: editor?.getHTML() ?? '',
                }}
              />
            </div>
          </div>
        </SheetContent>
      </Sheet>
    </div>
  );
}
