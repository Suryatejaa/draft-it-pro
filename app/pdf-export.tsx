'use client';
import {
  Document,
  Page,
  Text,
  View,
  StyleSheet,
  pdf,
} from '@react-pdf/renderer';
import type { Project } from '@/lib/project';
const styles = StyleSheet.create({
  page: {
    paddingTop: 54,
    paddingBottom: 54,
    paddingLeft: 108,
    paddingRight: 72,
    fontFamily: 'Courier',
    fontSize: 12,
    lineHeight: 1,
  },
  number: { position: 'absolute', top: 30, right: 72, fontSize: 12 },
  title: {
    fontFamily: 'Courier-Bold',
    fontSize: 22,
    textAlign: 'center',
    marginTop: 200,
  },
  credit: { textAlign: 'center', marginTop: 28, fontSize: 12 },
  line: { height: 12 },
  heading: { fontFamily: 'Courier-Bold' },
  character: { marginLeft: 144 },
  dialogue: { marginLeft: 72 },
  parenthetical: { marginLeft: 108 },
  transition: { textAlign: 'right' },
});
type Line = { text: string; type: string };
export function paginate(p: Project): Line[][] {
  const pages: Line[][] = [[]];
  let speaker = '';
  function add(line: Line) {
    if (pages.at(-1)!.length >= 54) pages.push([]);
    pages.at(-1)!.push(line);
  }
  function wrap(text: string, width: number) {
    return text.split('\n').flatMap((para) => {
      const words = para.split(/\s+/),
        lines: string[] = [];
      let line = '';
      for (let word of words) {
        while (word.length > width) {
          if (line) {
            lines.push(line);
            line = '';
          }
          lines.push(word.slice(0, width));
          word = word.slice(width);
        }
        if ((line + ' ' + word).trim().length > width) {
          lines.push(line);
          line = word;
        } else line = (line + ' ' + word).trim();
      }
      lines.push(line);
      return lines;
    });
  }
  p.scenes.forEach((s, index) =>
    s.blocks.forEach((b) => {
      const type = b.type;
      const width =
        type === 'dialogue'
          ? 35
          : type === 'parenthetical'
            ? 28
            : type === 'character'
              ? 25
              : 60;
      const lines = wrap(
        type === 'scene_heading' ? `${index + 1}  ${b.content}` : b.content,
        width,
      );
      if (type === 'character') {
        speaker = b.content;
        if (54 - pages.at(-1)!.length < 5) pages.push([]);
      }
      if (type === 'scene_heading' && 54 - pages.at(-1)!.length < 4)
        pages.push([]);
      add({ text: ' ', type: 'action' });
      lines.forEach((text, i) => {
        if (
          type === 'dialogue' &&
          pages.at(-1)!.length >= 52 &&
          i < lines.length
        ) {
          add({ text: '(MORE)', type: 'parenthetical' });
          pages.push([]);
          add({ text: speaker + " (CONT'D)", type: 'character' });
        }
        add({ text, type });
      });
    }),
  );
  return pages.filter((page) => page.length);
}
export async function screenplayPDF(p: Project) {
  const pages = paginate(p);
  const doc = (
    <Document title={p.title} author="Draft-it PRO">
      <Page size="LETTER" style={styles.page}>
        <Text style={styles.title}>{p.title}</Text>
        <Text style={styles.credit}>{p.draft}</Text>
      </Page>
      {pages.map((lines, i) => (
        <Page key={i} size="LETTER" style={styles.page}>
          <Text style={styles.number}>{i + 1}.</Text>
          {lines.map((line, j) => (
            <View
              key={j}
              style={[
                styles.line,
                ...(line.type === 'scene_heading'
                  ? [styles.heading]
                  : line.type === 'character'
                    ? [styles.character]
                    : line.type === 'dialogue'
                      ? [styles.dialogue]
                      : line.type === 'parenthetical'
                        ? [styles.parenthetical]
                        : line.type === 'transition'
                          ? [styles.transition]
                          : []),
              ]}
            >
              <Text>{line.text}</Text>
            </View>
          ))}
        </Page>
      ))}
    </Document>
  );
  return pdf(doc).toBlob();
}
