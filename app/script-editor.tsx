'use client';
import { useEffect, useRef, useState } from 'react';
import { createPortal } from 'react-dom';
import { useEditor, EditorContent } from '@tiptap/react';
import StarterKit from '@tiptap/starter-kit';
import { Extension } from '@tiptap/core';
import {
  elementTypes,
  uid,
  type Scene,
  type Block,
  type ElementType,
} from '@/lib/project';
import { computeSceneContentHash } from '@/lib/prompt-compiler';
import type { ScreenplayProposal, ScreenplaySelection } from '@/lib/ai/screenplay-proposal';
import { Button } from '@/components/ui/button';
import {
  DropdownMenu,
  DropdownMenuTrigger,
  DropdownMenuContent,
  DropdownMenuItem,
} from '@/components/ui/dropdown-menu';
import { ChevronDown, Undo2, Redo2, Trash2, Sparkles } from 'lucide-react';

const nextType: Record<string, ElementType> = {
  scene_heading: 'action',
  action: 'action',
  character: 'dialogue',
  dialogue: 'action',
  parenthetical: 'dialogue',
  transition: 'scene_heading',
  shot: 'action',
  general: 'action',
};

const tabType: Record<string, ElementType> = {
  scene_heading: 'action',
  action: 'character',
  character: 'action',
  dialogue: 'parenthetical',
  parenthetical: 'dialogue',
  transition: 'scene_heading',
  shot: 'action',
  general: 'character',
};

const prevTabType: Record<string, ElementType> = {
  scene_heading: 'transition',
  action: 'character',
  character: 'parenthetical',
  dialogue: 'character',
  parenthetical: 'dialogue',
  transition: 'dialogue',
  shot: 'action',
  general: 'action',
};

export const slashShortcuts: { code: string; type: ElementType; label: string }[] = [
  { code: '/sc', type: 'scene_heading', label: 'Scene Heading' },
  { code: '/ac', type: 'action', label: 'Action' },
  { code: '/ch', type: 'character', label: 'Character' },
  { code: '/di', type: 'dialogue', label: 'Dialogue' },
  { code: '/pa', type: 'parenthetical', label: 'Parenthetical' },
  { code: '/tr', type: 'transition', label: 'Transition' },
  { code: '/sh', type: 'shot', label: 'Shot' },
];

export function normalizeScreenplayBlocks(blocks: Block[]): Block[] {
  const result: Block[] = [];
  for (const b of blocks) {
    const raw = b.content ?? '';
    if (raw.includes('\n')) {
      const lines = raw
        .split(/\r?\n/)
        .map((l) => l.trim())
        .filter((l) => l.length > 0);
      if (lines.length === 0) {
        result.push({ ...b, content: '' });
      } else if (b.type === 'transition') {
        result.push({
          id: b.id,
          type: 'transition',
          content: lines[0],
        });
        for (let i = 1; i < lines.length; i++) {
          result.push({
            id: uid(),
            type: 'action',
            content: lines[i],
          });
        }
      } else if (b.type === 'character') {
        result.push({
          id: b.id,
          type: 'character',
          content: lines[0].toUpperCase(),
        });
        if (lines.length > 1) {
          result.push({
            id: uid(),
            type: 'dialogue',
            content: lines.slice(1).join(' '),
          });
        }
      } else {
        for (let i = 0; i < lines.length; i++) {
          result.push({
            id: i === 0 ? b.id : uid(),
            type: b.type === 'scene_heading' && i > 0 ? 'action' : b.type,
            content: lines[i],
          });
        }
      }
    } else {
      let content = raw;
      if (b.type === 'character' || b.type === 'transition') {
        content = raw.trim();
      } else if (b.type === 'dialogue' || b.type === 'parenthetical') {
        content = raw.trimStart();
      }
      result.push({
        ...b,
        content,
      });
    }
  }
  return result;
}

const ScriptFormat = Extension.create({
  name: 'scriptFormat',
  addGlobalAttributes() {
    return [
      {
        types: ['paragraph'],
        attributes: {
          kind: {
            default: 'action',
            parseHTML: (e) => e.getAttribute('data-kind'),
            renderHTML: (a) => ({ 'data-kind': a.kind }),
          },
          blockId: { default: null },
        },
      },
    ];
  },
  addKeyboardShortcuts() {
    return {
      Tab: () => {
        const kind = this.editor.getAttributes('paragraph').kind;
        return this.editor.commands.updateAttributes('paragraph', {
          kind: tabType[kind] ?? 'action',
        });
      },
      'Shift-Tab': () => {
        const kind = this.editor.getAttributes('paragraph').kind;
        return this.editor.commands.updateAttributes('paragraph', {
          kind: prevTabType[kind] ?? 'action',
        });
      },
      Space: () => {
        const { state } = this.editor;
        const { selection } = state;
        const parent = selection.$from.parent;
        const text = parent.textContent.trim();
        const match = slashShortcuts.find((s) => text === s.code);
        if (match) {
          return this.editor
            .chain()
            .deleteRange({ from: selection.$from.start(), to: selection.$from.end() })
            .updateAttributes('paragraph', { kind: match.type })
            .run();
        }
        return false;
      },
      Enter: () => {
        const { state } = this.editor;
        const { selection } = state;
        const parent = selection.$from.parent;
        const text = parent.textContent.trim();
        const match = slashShortcuts.find((s) => text === s.code);
        if (match) {
          return this.editor
            .chain()
            .deleteRange({ from: selection.$from.start(), to: selection.$from.end() })
            .updateAttributes('paragraph', { kind: match.type })
            .run();
        }
        const kind = this.editor.getAttributes('paragraph').kind ?? 'action';
        if (kind === 'character' && !text) {
          return this.editor.commands.updateAttributes('paragraph', { kind: 'action' });
        }
        return this.editor
          .chain()
          .splitBlock()
          .updateAttributes('paragraph', {
            kind: nextType[kind] ?? 'action',
            blockId: uid(),
          })
          .run();
      },
    };
  },
});

import { useDeviceMode } from '@/hooks/use-device-mode';
import { MobileScriptEditor } from '@/components/mobile/mobile-script-editor';

export default function ScriptEditor({
  scene,
  onChange,
  locations,
  allScenes = [],
  acts = [],
  onSelectScene,
  onAddScene,
  onOpenSceneDetails,
  isTypingFocus,
  onTypingFocusChange,
  onSelectionChange,
  onAskCoDrafter,
  onCoDrafterAction,
  clearSelectionNonce,
  onRegisterProposalActions,
}: {
  scene: Scene;
  onChange: (blocks: Block[]) => void;
  locations: string[];
  allScenes?: Scene[];
  acts?: string[];
  onSelectScene?: (sceneId: string) => void;
  onAddScene?: () => void;
  onOpenSceneDetails?: () => void;
  isTypingFocus?: boolean;
  onTypingFocusChange?: (isTyping: boolean) => void;
  onSelectionChange?: (selection: ScreenplaySelection | null) => void;
  onAskCoDrafter?: () => void;
  onCoDrafterAction?: (action: 'tighten' | 'alternatives' | 'custom') => void;
  clearSelectionNonce?: number;
  onRegisterProposalActions?: (actions: { apply: (proposal: ScreenplayProposal) => boolean; insertBelow: (proposal: ScreenplayProposal) => boolean }) => void;
}) {
  const callback = useRef(onChange);
  callback.current = onChange;
  const { isMobile } = useDeviceMode();
  const [active, setActive] = useState('action');
  const [slash, setSlash] = useState(false);
  const [zoom, setZoom] = useState<number>(1);
  const [selection, setSelection] = useState<ScreenplaySelection | null>(null);
  const [selectionPosition, setSelectionPosition] = useState<{ left: number; top: number } | null>(null);

  const initialBlocks = normalizeScreenplayBlocks(scene.blocks);

  const editor = useEditor({
    extensions: [
      StarterKit.configure({
        heading: false,
        bulletList: false,
        orderedList: false,
        blockquote: false,
        codeBlock: false,
        horizontalRule: false,
      }),
      ScriptFormat,
    ],
    immediatelyRender: false,
    content: {
      type: 'doc',
      content: initialBlocks.map((b) => ({
        type: 'paragraph',
        attrs: { kind: b.type, blockId: b.id },
        content: b.content ? [{ type: 'text', text: b.content }] : [],
      })),
    },
    editorProps: {
      attributes: {
        class: 'screenplay-document',
        'aria-label': 'Screenplay scene editor',
      },
    },
    onSelectionUpdate: ({ editor }) => {
      setActive(editor.getAttributes('paragraph').kind);
      const { from, to, empty } = editor.state.selection;
      if (empty) {
        setSelection(null);
        setSelectionPosition(null);
        onSelectionChange?.(null);
        if (process.env.NODE_ENV === 'development') console.debug('[CoDrafter Selection]', { from, to, empty, selectedTextLength: 0, blockCount: 0, blockTypes: [], sceneId: scene.id });
        return;
      }
      const selected: Array<{ id: string; type: ElementType }> = [];
      editor.state.doc.nodesBetween(from, to, (node, position) => {
        if (node.type.name !== 'paragraph' || position + node.nodeSize < from || position > to) return;
        const id = node.attrs.blockId;
        const type = node.attrs.kind as ElementType;
        if (typeof id === 'string' && !selected.some((block) => block.id === id)) selected.push({ id, type });
      });
      const nextSelection: ScreenplaySelection = {
        sceneId: scene.id,
        selectedBlockIds: selected.map((block) => block.id),
        selectedText: editor.state.doc.textBetween(from, to, '\n').trim(),
        blockTypes: selected.map((block) => block.type),
        sourceRevision: computeSceneContentHash(scene),
      };
      setSelection(nextSelection);
      const coordinates = editor.view.coordsAtPos(to);
      setSelectionPosition({
        left: Math.max(8, Math.min(coordinates.left, window.innerWidth - 170)),
        top: Math.max(8, Math.min(coordinates.bottom + 8, window.innerHeight - 42)),
      });
      onSelectionChange?.(nextSelection);
      if (process.env.NODE_ENV === 'development') {
        const metadata = { from, to, empty, selectedTextLength: nextSelection.selectedText.length, blockCount: selected.length, blockTypes: nextSelection.blockTypes, sceneId: scene.id };
        console.debug('[CoDrafter Selection]', metadata);
        queueMicrotask(() => {
          const current = editor.state.selection;
          console.debug('[CoDrafter Selection final]', { ...metadata, from: current.from, to: current.to, empty: current.empty, selectedTextLength: editor.state.doc.textBetween(current.from, current.to, '\n').trim().length });
        });
      }
    },
    onUpdate: ({ editor }) => {
      const blocks: Block[] = (editor.getJSON().content ?? []).map((n) => {
        let content = (n.content ?? [])
          .map((t) => ('text' in t ? (t.text ?? '') : ''))
          .join('');
        const kind = (n.attrs?.kind ?? 'action') as ElementType;
        if (kind === 'character' || kind === 'transition') {
          content = content.trim();
        }
        return {
          id: n.attrs?.blockId ?? uid(),
          type: kind,
          content,
        };
      });
      callback.current(blocks);
      setActive(editor.getAttributes('paragraph').kind);
      const parent = editor.state.selection.$from.parent.textContent;
      setSlash(parent.startsWith('/'));
    },
  });

  useEffect(() => {
    if (!editor || clearSelectionNonce === undefined) return;
    const { from } = editor.state.selection;
    editor.commands.setTextSelection(from);
  }, [clearSelectionNonce, editor]);

  useEffect(() => {
    if (!editor) return;
    const normalized = normalizeScreenplayBlocks(scene.blocks);
    const live = (editor.getJSON().content ?? []).map((n) => ({
      type: n.attrs?.kind ?? 'action',
      content: (n.content ?? [])
        .map((t) => ('text' in t ? (t.text ?? '') : ''))
        .join(''),
    }));
    if (
      JSON.stringify(live) !==
      JSON.stringify(
        normalized.map(({ type, content }) => ({ type, content })),
      )
    ) {
      editor.commands.setContent(
        {
          type: 'doc',
          content: normalized.map((b) => ({
            type: 'paragraph',
            attrs: { kind: b.type, blockId: b.id },
            content: b.content ? [{ type: 'text', text: b.content }] : [],
          })),
        },
        { emitUpdate: false },
      );
    }
  }, [editor, scene.blocks]);

  useEffect(() => {
    if (!editor || !onRegisterProposalActions) return;
    const toContent = (blocks: Block[]) => blocks.map((block) => ({
      type: 'paragraph',
      attrs: { kind: block.type, blockId: block.id },
      content: block.content ? [{ type: 'text', text: block.content }] : [],
    }));
    onRegisterProposalActions({
      apply: (proposal) => {
        if (!proposal.operations.length) return false;
        if (proposal.intent === 'alternatives' && (
          proposal.operations.length !== proposal.sourceBlockIds.length
          || proposal.operations.some((operation, index) => operation.sourceBlockId !== proposal.sourceBlockIds[index])
        )) return false;
        const sourceMap = new Map<string, { pos: number; node: any }>();
        editor.state.doc.descendants((node, pos) => {
          if (node.type.name === 'paragraph' && typeof node.attrs.blockId === 'string') {
            sourceMap.set(node.attrs.blockId, { pos, node });
          }
        });
        const replacements = proposal.operations
          .map((operation) => {
            const match = sourceMap.get(operation.sourceBlockId);
            if (!match) return null;
            return { operation, match };
          })
          .filter((entry): entry is { operation: typeof proposal.operations[number]; match: { pos: number; node: any } } => !!entry)
          .sort((a, b) => b.match.pos - a.match.pos);
        if (replacements.length !== proposal.operations.length) return false;
        if (!replacements.every(({ operation, match }) => match.node.attrs.kind === operation.type)) return false;

        const tr = editor.state.tr;
        for (const { operation, match } of replacements) {
          const replacement = editor.schema.nodeFromJSON({
            type: 'paragraph',
            attrs: { kind: operation.type, blockId: operation.sourceBlockId },
            content: operation.text ? [{ type: 'text', text: operation.text }] : [],
          });
          tr.replaceWith(match.pos, match.pos + match.node.nodeSize, replacement);
        }
        if (!tr.docChanged) return false;
        editor.view.dispatch(tr);
        return true;
      },
      insertBelow: (proposal) => {
        if (!proposal.suggested.length) return false;
        const sourceMap = new Map<string, { pos: number; node: any }>();
        editor.state.doc.descendants((node, pos) => {
          if (node.type.name === 'paragraph' && typeof node.attrs.blockId === 'string') {
            sourceMap.set(node.attrs.blockId, { pos, node });
          }
        });
        const matches = proposal.sourceBlockIds
          .map((id) => sourceMap.get(id))
          .filter((entry): entry is { pos: number; node: any } => !!entry);
        if (!matches.length) return false;
        const insertionPos = matches.reduce((max, entry) => Math.max(max, entry.pos + entry.node.nodeSize), 0);
        const tr = editor.state.tr;
        const nodes = proposal.suggested.map((block) => editor.schema.nodeFromJSON({
          type: 'paragraph',
          attrs: { kind: block.type, blockId: block.id },
          content: block.content ? [{ type: 'text', text: block.content }] : [],
        }));
        tr.insert(insertionPos, nodes);
        if (!tr.docChanged) return false;
        editor.view.dispatch(tr);
        return true;
      },
    });
  }, [editor, onRegisterProposalActions]);

  function format(type: ElementType) {
    if (!editor) return;
    const { $from } = editor.state.selection;
    const text = $from.parent.textContent;
    if (text.startsWith('/')) {
      editor
        .chain()
        .focus()
        .deleteRange({ from: $from.start(), to: $from.end() })
        .updateAttributes('paragraph', { kind: type })
        .run();
      setSlash(false);
    } else {
      editor
        .chain()
        .focus()
        .updateAttributes('paragraph', { kind: type })
        .run();
    }
    setActive(type);
  }

  if (isMobile) {
    return (
      <MobileScriptEditor
        editor={editor}
        scene={scene}
        allScenes={allScenes.length > 0 ? allScenes : [scene]}
        acts={acts.length > 0 ? acts : [scene.act]}
        activeType={active}
        onFormat={format}
        onSelectScene={onSelectScene ?? (() => {})}
        onAddScene={onAddScene}
        onOpenSceneDetails={onOpenSceneDetails}
        locations={locations}
        isTypingFocus={isTypingFocus}
        onTypingFocusChange={onTypingFocusChange}
        hasScreenplaySelection={!!selection}
        onAskCoDrafter={onAskCoDrafter}
                onCoDrafterAction={onCoDrafterAction}
      />
    );
  }

  return (
    <div className="editor-wrap">
      <div className="editor-toolbar">
        <div className="element-tabs" role="tablist" aria-label="Screenplay element types">
          {elementTypes.map((t) => {
            const isSelected = active === t;
            return (
              <button
                key={t}
                type="button"
                role="tab"
                aria-selected={isSelected}
                className={`element-tab ${isSelected ? 'active' : ''}`}
                onClick={() => format(t)}
              >
                {t.replace('_', ' ')}
              </button>
            );
          })}
        </div>
        <div className="toolbar-divider" />
        <Button
          variant="ghost"
          size="icon"
          aria-label="Delete selected paragraph"
          title="Delete paragraph (Undo to restore)"
          disabled={!editor || active === 'scene_heading'}
          onClick={() => {
            if (!editor) return;
            const { $from } = editor.state.selection;
            if (
              $from.parent.type.name !== 'paragraph' ||
              $from.parent.attrs.kind === 'scene_heading'
            )
              return;
            editor
              .chain()
              .focus()
              .deleteRange({ from: $from.before(), to: $from.after() })
              .run();
          }}
        >
          <Trash2 size={15} />
        </Button>
        <span>Courier Prime · 12 pt</span>
        <Button
          aria-label="Undo"
          variant="ghost"
          size="icon"
          onClick={() => editor?.chain().focus().undo().run()}
        >
          <Undo2 />
        </Button>
        <Button
          aria-label="Redo"
          variant="ghost"
          size="icon"
          onClick={() => editor?.chain().focus().redo().run()}
        >
          <Redo2 />
        </Button>
        <DropdownMenu>
          <DropdownMenuTrigger render={<Button variant="outline" size="sm" />}>
            {Math.round(zoom * 100)}% <ChevronDown size={12} />
          </DropdownMenuTrigger>
          <DropdownMenuContent>
            <DropdownMenuItem onClick={() => setZoom(1)}>
              100% (Paper)
            </DropdownMenuItem>
            <DropdownMenuItem onClick={() => setZoom(0.85)}>
              85% (Tablet)
            </DropdownMenuItem>
            <DropdownMenuItem onClick={() => setZoom(0.75)}>
              75% (Compact)
            </DropdownMenuItem>
          </DropdownMenuContent>
        </DropdownMenu>
        <span className="keyboard-tip">
          Tab to change element · / for commands
        </span>
      </div>
      {slash && (
        <div className="slash-menu">
          {slashShortcuts.map((s) => (
            <button key={s.type} onClick={() => format(s.type)}>
              <span>{s.label}</span>
              <span className="shortcut-tag">{s.code}</span>
            </button>
          ))}
        </div>
      )}
      {active === 'scene_heading' && locations.length > 0 && (
        <div className="heading-suggestions">
          <span>Locations</span>
          {locations.map((l) => (
            <button
              key={l}
              onClick={() => {
                if (!editor) return;
                const { $from } = editor.state.selection;
                editor
                  .chain()
                  .focus()
                  .insertContentAt(
                    { from: $from.start(), to: $from.end() },
                    'INT. ' + l + ' - NIGHT',
                  )
                  .run();
              }}
            >
              {l}
            </button>
          ))}
        </div>
      )}
      <div className="editor-viewport">
        <div className="scene-indicator-banner">
          <div className="scene-indicator-badge">SCENE {scene.heading}</div>
          <div className="text-xs text-muted-foreground font-mono">{scene.act}</div>
        </div>
        <div className="screenplay-page-container">
          <div
            className="screenplay-page"
            style={{
              transform: zoom !== 1 ? `scale(${zoom})` : undefined,
              transformOrigin: 'top center',
            }}
          >
            <div className="paper-number">SCENE {scene.heading}</div>
            <EditorContent editor={editor} />
          </div>
        </div>
      </div>
      <div className="editor-foot">
        <span>Scene-linked writing</span>
        <span>Enter continues your screenplay · Tab cycles element</span>
      </div>
      {selection && selection.selectedText.length > 0 && selectionPosition && onAskCoDrafter && typeof document !== 'undefined' && createPortal(
        <button
          type="button"
          onMouseDown={(event) => event.preventDefault()}
          onClick={onAskCoDrafter}
          className="fixed z-[300] inline-flex items-center text-black gap-1.5 rounded-md border border-primary/30 bg-background px-2.5 py-1.5 text-xs font-medium shadow-md hover:bg-primary/100 hover:text-black focus:outline-none focus:ring-2 focus:ring-primary focus:ring-offset-2 disabled:pointer-events-none disabled:opacity-50"
          style={{ left: selectionPosition.left, top: selectionPosition.top }}
        >
          <Sparkles size={13} /> Ask Co-Drafter
        </button>,
        document.body,
      )}
    </div>
  );
}
