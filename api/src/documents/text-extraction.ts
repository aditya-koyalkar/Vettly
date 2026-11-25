import { BadRequestException } from '@nestjs/common';
import mammoth from 'mammoth';
import { extractText as extractPdfText } from 'unpdf';

export const SUPPORTED_MIME_TYPES = [
  'application/pdf',
  'application/vnd.openxmlformats-officedocument.wordprocessingml.document',
  'text/plain',
  'text/markdown',
] as const;

/** Collapses PDF/DOCX layout noise while keeping paragraph breaks for chunking. */
export function normalizeText(text: string): string {
  return text
    .replace(/\r\n?/g, '\n')
    .replace(/[\t ]+/g, ' ')
    .replace(/[ ]{2,}/g, ' ')
    .replace(/\n{3,}/g, '\n\n')
    .trim();
}

export async function extractText(buffer: Buffer, mimeType: string, fileName: string): Promise<string> {
  const lowerName = fileName.toLowerCase();
  let text: string;

  if (mimeType === 'application/pdf' || lowerName.endsWith('.pdf')) {
    const { text: pdfText } = await extractPdfText(new Uint8Array(buffer), { mergePages: true });
    text = pdfText;
  } else if (mimeType.includes('wordprocessingml') || lowerName.endsWith('.docx')) {
    const { value } = await mammoth.extractRawText({ buffer });
    text = value;
  } else if (mimeType.startsWith('text/') || /\.(txt|md)$/.test(lowerName)) {
    text = buffer.toString('utf8');
  } else {
    throw new BadRequestException('Unsupported file type. Upload a PDF, DOCX, TXT or Markdown file.');
  }

  const normalized = normalizeText(text);
  if (normalized.length < 50) {
    throw new BadRequestException(
      'Could not extract readable text from this file. If it is a scanned PDF, paste the text instead.',
    );
  }
  return normalized;
}
