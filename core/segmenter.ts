import type { Clause, SegmentedDocument } from './schema';

export const MIN_TOS_CHARS = 250;
export const MIN_TOS_WORDS = 35;
export const MIN_TOS_KEYWORD_HITS = 2;

const TOS_KEYWORDS = [
  // Turkish keywords
  'kullanım koşulları',
  'hizmet şartları',
  'gizlilik politikası',
  'abonelik',
  'otomatik yenileme',
  'iptal',
  'iade',
  'sorumluluk',
  'kişisel veri',
  'üçüncü taraf',
  'tahkim',
  'uyuşmazlık',
  'mahkeme',
  'lisans',
  'fikri mülkiyet',
  'hesap',
  'fesih',
  'sözleşme',
  'kullanıcı',
  'hizmet',
  'ücret',
  'değişiklik',
  // English keywords
  'terms of service',
  'terms of use',
  'privacy policy',
  'subscription',
  'automatic renewal',
  'auto-renew',
  'cancel',
  'refund',
  'liability',
  'personal data',
  'third party',
  'third-party',
  'arbitration',
  'class action',
  'dispute',
  'license',
  'intellectual property',
  'account',
  'termination',
  'agreement',
  'warranty',
  'indemnify',
  'governing law',
];

/**
 * Normalizes line endings and removes zero-width/invisible control characters
 * while keeping standard text layout intact.
 */
export function cleanDocumentText(rawText: string): string {
  return rawText
    .replace(/\r\n/g, '\n')
    .replace(/\r/g, '\n')
    .replace(/[\u200B-\u200D\uFEFF]/g, '')
    .replace(/[ \t]+\n/g, '\n')
    .replace(/\n{3,}/g, '\n\n')
    .trim();
}

/**
 * Counts how many distinct ToS/Privacy keywords appear in the text.
 */
export function countTosKeywords(text: string): number {
  const lower = text.toLocaleLowerCase('tr-TR');
  let hits = 0;
  for (const kw of TOS_KEYWORDS) {
    if (lower.includes(kw.toLocaleLowerCase('tr-TR'))) {
      hits++;
    }
  }
  return hits;
}

/**
 * Splits cleaned text into clauses with exact character offsets (`start_offset`, `end_offset`)
 * such that `cleaned_text.slice(clause.start_offset, clause.end_offset) === clause.text`.
 */
export function segmentDocument(rawText: string): SegmentedDocument {
  const cleaned_text = cleanDocumentText(rawText);
  const char_count = cleaned_text.length;
  const words = cleaned_text.split(/\s+/).filter(Boolean);
  const word_count = words.length;
  const tos_keyword_hits = countTosKeywords(cleaned_text);
  const is_too_short = char_count < MIN_TOS_CHARS || word_count < MIN_TOS_WORDS;
  const looks_like_tos = !is_too_short && tos_keyword_hits >= MIN_TOS_KEYWORD_HITS;

  if (char_count === 0) {
    return {
      raw_text: rawText,
      cleaned_text,
      clauses: [],
      char_count: 0,
      word_count: 0,
      looks_like_tos: false,
      is_too_short: true,
      tos_keyword_hits: 0,
    };
  }

  // Find raw paragraph spans by splitting on blank lines (\n\n+) or numbered headings
  const rawSpans: Array<{ start: number; end: number }> = [];
  const separatorRegex = /\n\s*\n+/g;
  let lastIndex = 0;
  let match: RegExpExecArray | null;

  while ((match = separatorRegex.exec(cleaned_text)) !== null) {
    if (match.index > lastIndex) {
      rawSpans.push({ start: lastIndex, end: match.index });
    }
    lastIndex = match.index + match[0].length;
  }
  if (lastIndex < cleaned_text.length) {
    rawSpans.push({ start: lastIndex, end: cleaned_text.length });
  }

  // Trim whitespace from each span while adjusting start/end offsets accurately
  const trimmedSpans: Array<{ start: number; end: number }> = [];
  for (const span of rawSpans) {
    let s = span.start;
    let e = span.end;
    while (s < e && /\s/.test(cleaned_text[s])) s++;
    while (e > s && /\s/.test(cleaned_text[e - 1])) e--;
    if (e > s) {
      trimmedSpans.push({ start: s, end: e });
    }
  }

  // Merge short standalone headings (< 65 chars, no sentence-ending period) with the next span
  const mergedSpans: Array<{ start: number; end: number }> = [];
  let i = 0;
  while (i < trimmedSpans.length) {
    const current = trimmedSpans[i];
    const len = current.end - current.start;
    const slice = cleaned_text.slice(current.start, current.end);
    const isShortHeading =
      len < 65 &&
      !slice.endsWith('.') &&
      !slice.endsWith('!') &&
      i + 1 < trimmedSpans.length;

    if (isShortHeading) {
      const next = trimmedSpans[i + 1];
      mergedSpans.push({ start: current.start, end: next.end });
      i += 2;
    } else {
      mergedSpans.push(current);
      i += 1;
    }
  }

  const clauses: Clause[] = mergedSpans.map((span, idx) => ({
    clause_id: `C${idx + 1}`,
    text: cleaned_text.slice(span.start, span.end),
    start_offset: span.start,
    end_offset: span.end,
  }));

  return {
    raw_text: rawText,
    cleaned_text,
    clauses,
    char_count,
    word_count,
    looks_like_tos,
    is_too_short,
    tos_keyword_hits,
  };
}
