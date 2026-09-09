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
import { ChevronDown, Undo2, Redo2 } from 'lucide-react';
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
  character: 'dialogue',
  dialogue: 'parenthetical',
  parenthetical: 'dialogue',
  transition: 'scene_heading',
  shot: 'action',
  general: 'action',
};
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
      Enter: () => {
        const kind = this.editor.getAttributes('paragraph').kind;
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
export default function ScriptEditor({
  scene,
  onChange,
  locations,
}: {
  scene: Scene;
  onChange: (blocks: Block[]) => void;
  locations: string[];
}) {
  const callback = useRef(onChange);
  callback.current = onChange;
  const [active, setActive] = useState('action');
  const [slash, setSlash] = useState(false);
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
      content: scene.blocks.map((b) => ({
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
      const blocks: Block[] = (editor.getJSON().content ?? []).map((n) => ({
        id: n.attrs?.blockId ?? uid(),
        type: n.attrs?.kind ?? 'action',
        content: (n.content ?? [])
          .map((t) => ('text' in t ? (t.text ?? '') : ''))
          .join(''),
      }));
      callback.current(blocks);
      setActive(editor.getAttributes('paragraph').kind);
      const parent = editor.state.selection.$from.parent.textContent;
      setSlash(parent.startsWith('/'));
    },
  });
  useEffect(() => {
    if (!editor) return;
    const live = (editor.getJSON().content ?? []).map((n) => ({
      type: n.attrs?.kind ?? 'action',
      content: (n.content ?? [])
        .map((t) => ('text' in t ? (t.text ?? '') : ''))
        .join(''),
    }));
    if (
      JSON.stringify(live) !==
      JSON.stringify(
        scene.blocks.map(({ type, content }) => ({ type, content })),
      )
    )
      editor.commands.setContent(
        {
          type: 'doc',
          content: scene.blocks.map((b) => ({
            type: 'paragraph',
            attrs: { kind: b.type, blockId: b.id },
            content: b.content ? [{ type: 'text', text: b.content }] : [],
          })),
        },
        { emitUpdate: false },
      );
  }, [editor, scene.blocks]);
  function format(type: ElementType) {
    if (!editor) return;
    if (slash) {
      const { $from } = editor.state.selection;
      editor
        .chain()
        .focus()
        .deleteRange({ from: $from.start(), to: $from.end() })
        .updateAttributes('paragraph', { kind: type })
        .run();
      setSlash(false);
    } else
      editor
        .chain()
        .focus()
        .updateAttributes('paragraph', { kind: type })
        .run();
    setActive(type);
  }
  return (
    <div className="editor-wrap">
      <div className="editor-toolbar">
        <DropdownMenu>
          <DropdownMenuTrigger render={<Button variant="outline" />}>
            {active.replace('_', ' ')} <ChevronDown size={14} />
          </DropdownMenuTrigger>
          <DropdownMenuContent>
            {elementTypes.map((t) => (
              <DropdownMenuItem key={t} onClick={() => format(t)}>
                {t.replace('_', ' ')}
              </DropdownMenuItem>
            ))}
          </DropdownMenuContent>
        </DropdownMenu>
        <span>Courier · 12 pt</span>
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
        <span className="keyboard-tip">
          Tab to change element · / for commands
        </span>
      </div>
      {slash && (
        <div className="slash-menu">
          {elementTypes.map((t) => (
            <button key={t} onClick={() => format(t)}>
              {t.replace('_', ' ')}
            </button>
          ))}
        </div>
      )}
      {active === 'scene_heading' && (
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
      <div className="paper">
        <div className="paper-number">SCENE {scene.heading}</div>
        <EditorContent editor={editor} />
      </div>
      <div className="editor-foot">
        Scene-linked writing <span>Enter continues your screenplay</span>
      </div>
    </div>
  );
}
