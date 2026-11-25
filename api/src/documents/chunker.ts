export interface Chunk {
  index: number;
  section: string | null;
  content: string;
}

export interface ChunkOptions {
  /** Target upper bound per chunk, in characters (~4 chars per token). */
  maxChars?: number;
  /** Characters of trailing context repeated at the start of the next chunk. */
  overlapChars?: number;
}

const HEADING_PATTERNS = [
  /^#{1,6}\s+\S/, // markdown heading
  /^[A-Z][A-Z &/,-]{2,40}:?$/, // EXPERIENCE, SKILLS & TOOLS
  /^[A-Z][A-Za-z &/-]{2,40}:$/, // Responsibilities:
];

function isHeading(line: string): boolean {
  const trimmed = line.trim();
  return trimmed.length > 0 && trimmed.length <= 48 && HEADING_PATTERNS.some((p) => p.test(trimmed));
}

/**
 * Section-aware chunker for resumes and job descriptions.
 *
 * Both document types are organised under short headings ("Experience",
 * "Requirements"), so chunks never straddle a section and each carries its
 * heading. That heading is prefixed into the chunk text, which helps both the
 * embedding and the lexical leg of retrieval match on section intent.
 */
export function chunkDocument(text: string, { maxChars = 1200, overlapChars = 150 }: ChunkOptions = {}): Chunk[] {
  const sections: { title: string | null; paragraphs: string[] }[] = [{ title: null, paragraphs: [] }];

  for (const block of text.split(/\n{2,}/)) {
    const lines = block.split('\n');
    if (isHeading(lines[0])) {
      sections.push({ title: lines[0].replace(/^#+\s*/, '').replace(/:$/, '').trim(), paragraphs: [] });
      const rest = lines.slice(1).join('\n').trim();
      if (rest) sections[sections.length - 1].paragraphs.push(rest);
    } else if (block.trim()) {
      sections[sections.length - 1].paragraphs.push(block.trim());
    }
  }

  const chunks: Chunk[] = [];
  const push = (section: string | null, body: string) => {
    const content = section ? `${section}\n${body}` : body;
    chunks.push({ index: chunks.length, section, content });
  };

  for (const { title, paragraphs } of sections) {
    let buffer = '';
    for (const paragraph of paragraphs.flatMap((p) => splitOversized(p, maxChars))) {
      if (buffer && buffer.length + paragraph.length + 2 > maxChars) {
        push(title, buffer);
        buffer = tail(buffer, overlapChars);
      }
      buffer = buffer ? `${buffer}\n\n${paragraph}` : paragraph;
    }
    if (buffer.trim()) push(title, buffer);
  }
  return chunks;
}

/** Splits a paragraph longer than maxChars on sentence or line boundaries. */
function splitOversized(paragraph: string, maxChars: number): string[] {
  if (paragraph.length <= maxChars) return [paragraph];
  const units = paragraph.split(/(?<=[.!?])\s+|\n/);
  const parts: string[] = [];
  let current = '';
  for (const unit of units) {
    if (current && current.length + unit.length + 1 > maxChars) {
      parts.push(current);
      current = '';
    }
    // A single unit longer than maxChars is hard-split.
    for (let i = 0; i < unit.length; i += maxChars) {
      const piece = unit.slice(i, i + maxChars);
      current = current ? `${current} ${piece}` : piece;
      if (current.length >= maxChars) {
        parts.push(current);
        current = '';
      }
    }
  }
  if (current) parts.push(current);
  return parts;
}

/** Trailing overlap, cut at a word boundary. */
function tail(text: string, chars: number): string {
  if (chars <= 0 || text.length <= chars) return '';
  const slice = text.slice(-chars);
  const firstSpace = slice.indexOf(' ');
  return firstSpace === -1 ? slice : slice.slice(firstSpace + 1);
}
