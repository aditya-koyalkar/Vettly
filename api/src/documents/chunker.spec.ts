import { chunkDocument } from './chunker.js';

describe('chunkDocument', () => {
  it('keeps chunks inside their section and prefixes the heading', () => {
    const text = 'Jane Doe\nEngineer\n\nEXPERIENCE\nAcme Corp - built payments APIs.\n\nSKILLS\nTypeScript, Postgres';
    const chunks = chunkDocument(text);
    expect(chunks.map((c) => c.section)).toEqual([null, 'EXPERIENCE', 'SKILLS']);
    expect(chunks[1].content).toBe('EXPERIENCE\nAcme Corp - built payments APIs.');
  });

  it('splits long sections under the size limit', () => {
    const paragraph = 'Shipped a feature that moved a key metric. '.repeat(40);
    const chunks = chunkDocument(`Responsibilities:\n${paragraph}`, { maxChars: 300, overlapChars: 0 });
    expect(chunks.length).toBeGreaterThan(3);
    for (const chunk of chunks) expect(chunk.content.length).toBeLessThanOrEqual(300 + 'Responsibilities\n'.length + 1);
  });
});
