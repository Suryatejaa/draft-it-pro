'use client';

import { useState, useRef, useEffect } from 'react';
import {
  ChevronLeft,
  ChevronRight,
  Plus,
  ImagePlus,
  Sparkles,
  Camera,
  Upload,
  Clipboard,
  FileUp,
  Copy,
  Check,
  RefreshCw,
  Edit2,
  Trash2,
  Sliders,
} from 'lucide-react';
import {
  Sheet,
  SheetContent,
  SheetHeader,
  SheetTitle,
  SheetDescription,
} from '@/components/ui/sheet';
import { Button } from '@/components/ui/button';
import { Textarea } from '@/components/ui/textarea';
import {
  buildStoryboardPrompt,
  computeSceneContentHash,
} from '@/lib/prompt-compiler';
import type { Project, Scene, Panel } from '@/lib/project';

interface MobileStoryboardProps {
  project: Project;
  scene: Scene | null;
  onSelectScene: (sceneId: string) => void;
  onAddScene: () => void;
  onAddPanel: () => void;
  onEditPanel: (panel: Panel) => void;
  onUploadImage: (file: File, panelId: string) => void;
  onRemoveImage: (panelId: string) => void;
  onUpdatePanel: (panel: Panel) => void;
  onAutoPlanScene: (scene: Scene) => void;
}

export function MobileStoryboard({
  project,
  scene,
  onSelectScene,
  onAddScene,
  onAddPanel,
  onEditPanel,
  onUploadImage,
  onRemoveImage,
  onUpdatePanel,
  onAutoPlanScene,
}: MobileStoryboardProps) {
  const [activeSlideIndex, setActiveSlideIndex] = useState(0);
  const [uploadSheetPanel, setUploadSheetPanel] = useState<Panel | null>(null);
  const [promptSheetPanel, setPromptSheetPanel] = useState<Panel | null>(null);
  const [copiedPrompt, setCopiedPrompt] = useState(false);
  const [isEditingPrompt, setIsEditingPrompt] = useState(false);
  const [promptDraft, setPromptDraft] = useState('');

  const carouselRef = useRef<HTMLDivElement>(null);
  const fileInputRef = useRef<HTMLInputElement>(null);
  const cameraInputRef = useRef<HTMLInputElement>(null);

  const pad = (n: number) => String(n).padStart(2, '0');

  // Filter panels for active scene
  const scenePanels = scene
    ? project.panels.filter((p) => p.sceneId === scene.id)
    : [];

  const currentSceneIndex = scene
    ? project.scenes.findIndex((s) => s.id === scene.id)
    : -1;

  // Track scroll snap position for dot indicators
  const handleScroll = () => {
    if (!carouselRef.current) return;
    const { scrollLeft, clientWidth } = carouselRef.current;
    if (clientWidth > 0) {
      const index = Math.round(scrollLeft / clientWidth);
      setActiveSlideIndex(index);
    }
  };

  const scrollToSlide = (index: number) => {
    if (!carouselRef.current) return;
    const clientWidth = carouselRef.current.clientWidth;
    carouselRef.current.scrollTo({
      left: index * clientWidth,
      behavior: 'smooth',
    });
    setActiveSlideIndex(index);
  };

  // Reset slide index when scene changes
  useEffect(() => {
    setActiveSlideIndex(0);
    if (carouselRef.current) {
      carouselRef.current.scrollLeft = 0;
    }
  }, [scene?.id]);

  // Handle clipboard paste for image
  const handlePasteImage = async () => {
    if (!uploadSheetPanel) return;
    try {
      const items = await navigator.clipboard.read();
      for (const item of items) {
        const imageType = item.types.find((t) => t.startsWith('image/'));
        if (imageType) {
          const blob = await item.getType(imageType);
          const file = new File([blob], 'pasted-image.png', { type: imageType });
          onUploadImage(file, uploadSheetPanel.id);
          setUploadSheetPanel(null);
          return;
        }
      }
      alert('No image found in clipboard. Please copy an image first.');
    } catch (err) {
      console.error('Clipboard paste failed', err);
      alert('Clipboard access not permitted or supported. Please choose an image file.');
    }
  };

  if (!scene) {
    return (
      <div className="mobile-empty-board p-6 text-center">
        <h3 className="text-base font-semibold mb-1">Start with a scene</h3>
        <p className="text-xs text-muted-foreground mb-4">
          Storyboard panels link directly to your screenplay scenes.
        </p>
        <Button onClick={onAddScene} size="sm">
          <Plus size={14} className="mr-1" /> Add Scene
        </Button>
      </div>
    );
  }

  // Calculate prompt for active prompt panel
  const currentHash = computeSceneContentHash(scene);
  const activePrompt =
    promptSheetPanel?.customPrompt ??
    promptSheetPanel?.generatedPrompt ??
    (promptSheetPanel
      ? buildStoryboardPrompt(
          scene,
          promptSheetPanel.shotIntent ?? {
            id: promptSheetPanel.id,
            sceneId: scene.id,
            panelNumber: '01A',
            shotSize: 'wide',
            angle: 'eye_level',
            movement: 'static',
            purpose: 'action',
            description: promptSheetPanel.description || '',
            characterIds: scene.characterIds,
            duration: 3,
            lens: '35mm',
          },
          project.characters,
          project.locations.find((l) => l.id === scene.locationId),
        )
      : '');

  return (
    <div className="mobile-storyboard-wrap">
      {/* Scene Switcher Header */}
      <div className="mobile-storyboard-header">
        <div className="mobile-scene-selector-pills">
          {project.scenes.map((s, i) => {
            const isSelected = s.id === scene.id;
            const panelCount = project.panels.filter((p) => p.sceneId === s.id).length;
            return (
              <button
                key={s.id}
                type="button"
                className={`scene-pill ${isSelected ? 'selected' : ''}`}
                onClick={() => onSelectScene(s.id)}
              >
                <span>Sc {pad(i + 1)}</span>
                {panelCount > 0 && <small>{panelCount}</small>}
              </button>
            );
          })}
        </div>

        <div className="mobile-scene-banner">
          <div className="min-w-0 flex-1">
            <span className="text-[10px] font-mono uppercase text-muted-foreground tracking-wider">
              SCENE {pad(currentSceneIndex + 1)}
            </span>
            <h2 className="text-sm font-bold truncate">{scene.heading}</h2>
          </div>

          <Button
            variant="outline"
            size="sm"
            className="h-8 text-xs gap-1 shrink-0"
            onClick={() => onAutoPlanScene(scene)}
          >
            <Sparkles size={12} className="text-amber-500" />
            Auto Plan
          </Button>
        </div>
      </div>

      {/* Swipe-First Storyboard Carousel */}
      <div
        className="mobile-panels-carousel"
        ref={carouselRef}
        onScroll={handleScroll}
      >
        {scenePanels.map((p, i) => {
          const shotLabel =
            pad(currentSceneIndex + 1) + String.fromCharCode(65 + (i % 26));
          const isOutdated = !!(
            p.sourceContentHash && p.sourceContentHash !== currentHash
          );

          return (
            <div className="mobile-panel-slide" key={p.id}>
              <div className="mobile-panel-card">
                {/* 16:9 Aspect Ratio Frame */}
                <div
                  className="mobile-panel-frame"
                  onClick={() => setUploadSheetPanel(p)}
                  role="button"
                  tabIndex={0}
                  aria-label="Upload or change frame image"
                >
                  {p.image ? (
                    <img
                      src={p.image}
                      alt={p.description || `Shot ${shotLabel}`}
                      className="w-full h-full object-cover"
                    />
                  ) : (
                    <div className="frame-placeholder">
                      <ImagePlus size={28} className="text-muted-foreground mb-1" />
                      <span className="text-xs font-medium">Tap to add image</span>
                      <small className="text-[10px] text-muted-foreground">
                        Photo, Library or Paste
                      </small>
                    </div>
                  )}

                  {/* Shot Tag */}
                  <div className="panel-shot-tag">{shotLabel}</div>

                  {/* Outdated Scene Warning */}
                  {isOutdated && (
                    <div className="panel-outdated-tag">⚠ Script changed</div>
                  )}
                </div>

                {/* Panel Info */}
                <div className="mobile-panel-info">
                  <div className="flex items-center justify-between">
                    <div className="flex items-center gap-1.5">
                      <span className="font-bold text-sm">{p.size || 'Wide'}</span>
                      <span className="text-muted-foreground text-xs">·</span>
                      <span className="text-xs text-muted-foreground">
                        {p.lens || '35mm'} · {p.movement || 'Static'}
                      </span>
                    </div>
                    <span className="panel-duration-pill">{p.duration || 3}s</span>
                  </div>

                  <p className="mobile-panel-desc">
                    {p.description || 'No description for this frame yet.'}
                  </p>
                </div>

                {/* Actions: Prompt & Edit */}
                <div className="mobile-panel-actions">
                  <Button
                    variant="outline"
                    size="sm"
                    className="flex-1 gap-1.5 text-xs h-9"
                    onClick={() => {
                      setPromptSheetPanel(p);
                      setCopiedPrompt(false);
                      setIsEditingPrompt(false);
                      setPromptDraft(p.customPrompt ?? p.generatedPrompt ?? activePrompt);
                    }}
                  >
                    <Sparkles size={13} className="text-amber-500" />
                    Prompt
                  </Button>

                  <Button
                    variant="outline"
                    size="sm"
                    className="flex-1 gap-1.5 text-xs h-9"
                    onClick={() => onEditPanel(p)}
                  >
                    <Sliders size={13} />
                    Edit Shot
                  </Button>
                </div>
              </div>
            </div>
          );
        })}

        {/* Add Panel Slide */}
        <div className="mobile-panel-slide">
          <button
            type="button"
            className="mobile-add-panel-card"
            onClick={onAddPanel}
          >
            <div className="add-icon-circle">
              <Plus size={24} />
            </div>
            <b className="text-sm">Add Panel</b>
            <span className="text-xs text-muted-foreground">
              Frame {pad(currentSceneIndex + 1)}
              {String.fromCharCode(65 + (scenePanels.length % 26))}
            </span>
          </button>
        </div>
      </div>

      {/* Carousel Dots Indicator */}
      <div className="mobile-carousel-dots">
        {Array.from({ length: scenePanels.length + 1 }).map((_, idx) => (
          <button
            key={idx}
            type="button"
            className={`carousel-dot ${idx === activeSlideIndex ? 'active' : ''}`}
            onClick={() => scrollToSlide(idx)}
            aria-label={`Go to frame ${idx + 1}`}
          />
        ))}
      </div>

      {/* Image Upload Bottom Sheet */}
      <Sheet
        open={!!uploadSheetPanel}
        onOpenChange={(open) => !open && setUploadSheetPanel(null)}
      >
        <SheetContent side="bottom" className="mobile-upload-sheet">
          <SheetHeader className="pb-2">
            <SheetTitle className="text-base font-semibold">Storyboard Image</SheetTitle>
            <SheetDescription className="text-xs">
              Add a reference frame, sketch, or location photo.
            </SheetDescription>
          </SheetHeader>

          {/* Hidden inputs for camera and files */}
          <input
            type="file"
            accept="image/*"
            capture="environment"
            ref={cameraInputRef}
            className="hidden"
            onChange={(e) => {
              const file = e.target.files?.[0];
              if (file && uploadSheetPanel) {
                onUploadImage(file, uploadSheetPanel.id);
                setUploadSheetPanel(null);
              }
            }}
          />
          <input
            type="file"
            accept="image/*"
            ref={fileInputRef}
            className="hidden"
            onChange={(e) => {
              const file = e.target.files?.[0];
              if (file && uploadSheetPanel) {
                onUploadImage(file, uploadSheetPanel.id);
                setUploadSheetPanel(null);
              }
            }}
          />

          <div className="mobile-upload-options">
            <button
              type="button"
              className="upload-option-btn"
              onClick={() => cameraInputRef.current?.click()}
            >
              <div className="option-icon camera">
                <Camera size={20} />
              </div>
              <div className="text-left">
                <b>Take photo</b>
                <small>Use device camera</small>
              </div>
            </button>

            <button
              type="button"
              className="upload-option-btn"
              onClick={() => fileInputRef.current?.click()}
            >
              <div className="option-icon gallery">
                <Upload size={20} />
              </div>
              <div className="text-left">
                <b>Choose image</b>
                <small>Photo library</small>
              </div>
            </button>

            <button
              type="button"
              className="upload-option-btn"
              onClick={handlePasteImage}
            >
              <div className="option-icon paste">
                <Clipboard size={20} />
              </div>
              <div className="text-left">
                <b>Paste image</b>
                <small>From clipboard</small>
              </div>
            </button>

            <button
              type="button"
              className="upload-option-btn"
              onClick={() => fileInputRef.current?.click()}
            >
              <div className="option-icon files">
                <FileUp size={20} />
              </div>
              <div className="text-left">
                <b>Files</b>
                <small>PNG, JPEG, WebP</small>
              </div>
            </button>

            {uploadSheetPanel?.image && (
              <button
                type="button"
                className="upload-option-btn text-destructive"
                onClick={() => {
                  onRemoveImage(uploadSheetPanel.id);
                  setUploadSheetPanel(null);
                }}
              >
                <div className="option-icon remove">
                  <Trash2 size={20} />
                </div>
                <div className="text-left">
                  <b>Remove image</b>
                  <small>Clear frame from panel</small>
                </div>
              </button>
            )}
          </div>
        </SheetContent>
      </Sheet>

      {/* Auto Storyboard Prompt Bottom Sheet */}
      <Sheet
        open={!!promptSheetPanel}
        onOpenChange={(open) => !open && setPromptSheetPanel(null)}
      >
        <SheetContent side="bottom" className="mobile-prompt-sheet">
          <SheetHeader className="pb-2">
            <div className="flex items-center justify-between">
              <div>
                <SheetTitle className="text-sm font-semibold flex items-center gap-1.5">
                  <Sparkles size={14} className="text-amber-500" />
                  AUTO STORYBOARD PROMPT
                </SheetTitle>
                <SheetDescription className="text-xs">
                  Compiled from screenplay beat and camera plan
                </SheetDescription>
              </div>
              <button
                type="button"
                className="text-xs text-primary font-medium"
                onClick={() => setIsEditingPrompt(!isEditingPrompt)}
              >
                {isEditingPrompt ? 'View' : 'Edit'}
              </button>
            </div>
          </SheetHeader>

          <div className="prompt-display-wrap my-2">
            {isEditingPrompt ? (
              <Textarea
                rows={5}
                value={promptDraft}
                onChange={(e) => setPromptDraft(e.target.value)}
                className="font-mono text-xs leading-relaxed"
              />
            ) : (
              <div className="prompt-text-box">
                <p className="font-mono text-xs leading-relaxed text-foreground">
                  {promptDraft || activePrompt}
                </p>
              </div>
            )}
          </div>

          <div className="mobile-prompt-actions">
            {isEditingPrompt ? (
              <Button
                variant="default"
                size="sm"
                className="w-full text-xs h-9"
                onClick={() => {
                  if (promptSheetPanel) {
                    onUpdatePanel({
                      ...promptSheetPanel,
                      customPrompt: promptDraft,
                    });
                  }
                  setIsEditingPrompt(false);
                }}
              >
                <Check size={14} className="mr-1" />
                Save Custom Prompt
              </Button>
            ) : (
              <div className="flex items-center gap-2 w-full">
                <Button
                  variant={copiedPrompt ? 'secondary' : 'default'}
                  size="sm"
                  className="flex-1 text-xs h-9 gap-1.5"
                  onClick={async () => {
                    const text = promptDraft || activePrompt;
                    await navigator.clipboard.writeText(text);
                    setCopiedPrompt(true);
                    setTimeout(() => setCopiedPrompt(false), 2000);
                  }}
                >
                  {copiedPrompt ? (
                    <>
                      <Check size={14} className="text-green-600" />
                      Copied!
                    </>
                  ) : (
                    <>
                      <Copy size={14} />
                      Copy Prompt
                    </>
                  )}
                </Button>

                <Button
                  variant="outline"
                  size="sm"
                  className="text-xs h-9"
                  title="Re-generate prompt from current screenplay scene"
                  onClick={() => {
                    if (promptSheetPanel && scene) {
                      const fresh = buildStoryboardPrompt(
                        scene,
                        promptSheetPanel.shotIntent ?? {
                          id: promptSheetPanel.id,
                          sceneId: scene.id,
                          panelNumber: '01A',
                          shotSize: 'wide',
                          angle: 'eye_level',
                          movement: 'static',
                          purpose: 'action',
                          description: promptSheetPanel.description || '',
                          characterIds: scene.characterIds,
                          duration: 3,
                          lens: '35mm',
                        },
                        project.characters,
                        project.locations.find((l) => l.id === scene.locationId),
                      );
                      setPromptDraft(fresh);
                      onUpdatePanel({
                        ...promptSheetPanel,
                        generatedPrompt: fresh,
                        customPrompt: undefined,
                        sourceContentHash: currentHash,
                      });
                    }
                  }}
                >
                  <RefreshCw size={13} className="mr-1" />
                  Refresh
                </Button>
              </div>
            )}
          </div>
        </SheetContent>
      </Sheet>
    </div>
  );
}
