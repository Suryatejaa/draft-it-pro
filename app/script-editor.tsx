'use client';
import { useEffect, useRef, useState } from 'react';
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
import { Button } from '@/components/ui/button';
import {
  DropdownMenu,
  DropdownMenuTrigger,
  DropdownMenuContent,
  DropdownMenuItem,
} from '@/components/ui/dropdown-menu';
import { ChevronDown, Undo2, Redo2, Trash2 } from 'lucide-react';

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
}) {
  const callback = useRef(onChange);
  callback.current = onChange;
  const { isMobile } = useDeviceMode();
  const [active, setActive] = useState('action');
  const [slash, setSlash] = useState(false);
  const [zoom, setZoom] = useState<number>(1);

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
    onSelectionUpdate: ({ editor }) =>
      setActive(editor.getAttributes('paragraph').kind),
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
    </div>
  );
}
