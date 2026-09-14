import { createElement as h, type ReactNode } from 'react';

/** A small text-only Markdown subset. All source text is escaped by React; raw HTML/URLs are never interpreted. */
function inline(text: string, depth = 0): ReactNode {
  if (depth > 8) return text;
  const pattern = /(`[^`\n]+`|\*\*[^*]+\*\*|__[^_]+__|\*[^*\n]+\*|_[^_\n]+_)/g;
  const result: ReactNode[] = [];
  let cursor = 0;
  for (const match of text.matchAll(pattern)) {
    const index = match.index!;
    result.push(text.slice(cursor, index));
    const token = match[0];
    const code = token.startsWith('`');
    const bold = token.startsWith('**') || token.startsWith('__');
    const trim = bold ? 2 : 1;
    result.push(h(code ? 'code' : bold ? 'strong' : 'em', { key: index, ...(code ? { className: 'rounded bg-muted px-1 font-mono text-[0.9em]' } : {}) }, code ? token.slice(1, -1) : inline(token.slice(trim, -trim), depth + 1)));
    cursor = index + token.length;
  }
  result.push(text.slice(cursor));
  return result;
}

export function SafeMarkdown({ content }: { content: string }) {
  const lines = content.replace(/\r\n/g, '\n').split('\n');
  const nodes: ReactNode[] = [];
  const special = (line: string) => /^(#{1,6}\s|\s*[-*+]\s|\s*\d+[.)]\s|>\s?|```)/.test(line);
  for (let i = 0; i < lines.length;) {
    const line = lines[i];
    if (!line.trim()) { i++; continue; }
    const key = i;
    if (line.startsWith('```')) {
      const code: string[] = []; i++;
      while (i < lines.length && !lines[i].startsWith('```')) code.push(lines[i++]);
      if (i < lines.length) i++;
      nodes.push(h('pre', { key, className: 'my-2 whitespace-pre-wrap break-words rounded bg-muted p-2 text-xs' }, h('code', {}, code.join('\n'))));
      continue;
    }
    const heading = line.match(/^(#{1,6})\s+(.+)$/);
    if (heading) { nodes.push(h('h3', { key, className: 'mt-3 mb-1 text-[15px] font-semibold leading-snug' }, inline(heading[2]))); i++; continue; }
    const list = line.match(/^\s*(?:([-*+])|(\d+)[.)])\s+(.+)$/);
    if (list) {
      const ordered = !!list[2];
      const items: ReactNode[] = [];
      while (i < lines.length) {
        const item = lines[i].match(/^\s*(?:([-*+])|(\d+)[.)])\s+(.+)$/);
        if (!item || !!item[2] !== ordered) break;
        items.push(h('li', { key: i++ }, inline(item[3])));
      }
      nodes.push(h(ordered ? 'ol' : 'ul', { key, className: `my-2 pl-5 space-y-1 ${ordered ? 'list-decimal' : 'list-disc'}`, ...(ordered ? { start: Number(list[2]) } : {}) }, items));
      continue;
    }
    if (/^>\s?/.test(line)) {
      const quote: string[] = [];
      while (i < lines.length && /^>\s?/.test(lines[i])) quote.push(lines[i++].replace(/^>\s?/, ''));
      nodes.push(h('blockquote', { key, className: 'my-2 border-l-2 border-primary/40 pl-3 text-muted-foreground' }, inline(quote.join('\n'))));
      continue;
    }
    const paragraph = [line]; i++;
    while (i < lines.length && lines[i].trim() && !special(lines[i])) paragraph.push(lines[i++]);
    nodes.push(h('p', { key, className: 'my-2 whitespace-pre-wrap' }, inline(paragraph.join('\n'))));
  }
  return h('div', { className: 'min-w-0 break-words font-sans text-[14px] leading-relaxed [&>:first-child]:mt-0 [&>:last-child]:mb-0' }, nodes);
}
