import {
  type Clause,
  type DroppedFinding,
  type LLMOutput,
  LLMOutputSchema,
  type ValidatedFinding,
  type ValidationResult,
} from './schema';

interface NormalizedTextMap {
  normalized: string;
  normToRawStart: number[];
  normToRawEnd: number[];
}

function normalizeCharQuote(ch: string): string {
  if (/[\u201C\u201D\u201E\u201F\u00AB\u00BB"]/.test(ch)) {
    return '"';
  }
  if (/[\u2018\u2019\u201A\u201B']/.test(ch)) {
    return "'";
  }
  return ch;
}

/**
 * Normalizes ONLY whitespace and quotation marks while recording exact character offset
 * mappings back to the original raw string.
 */
export function normalizeTextWithOffsets(raw: string): NormalizedTextMap {
  let normalized = '';
  const normToRawStart: number[] = [];
  const normToRawEnd: number[] = [];

  let inWhitespace = false;

  for (let i = 0; i < raw.length; i++) {
    const ch = raw[i];
    if (/\s/.test(ch)) {
      if (normalized.length === 0) {
        // Skip leading whitespace
        continue;
      }
      if (!inWhitespace) {
        normalized += ' ';
        normToRawStart.push(i);
        normToRawEnd.push(i + 1);
        inWhitespace = true;
      } else {
        normToRawEnd[normToRawEnd.length - 1] = i + 1;
      }
    } else {
      inWhitespace = false;
      const normCh = normalizeCharQuote(ch);
      normalized += normCh;
      normToRawStart.push(i);
      normToRawEnd.push(i + 1);
    }
  }

  // Trim trailing space if any
  if (normalized.endsWith(' ')) {
    normalized = normalized.slice(0, -1);
    normToRawStart.pop();
    normToRawEnd.pop();
  }

  return { normalized, normToRawStart, normToRawEnd };
}

/**
 * Normalizes a quote string (only whitespace and quote characters).
 */
export function normalizeQuoteOnly(quote: string): string {
  return normalizeTextWithOffsets(quote).normalized;
}

/**
 * Deterministically validates raw LLM output (string or unknown object) against:
 * 1. Strict Zod schema (LLMOutputSchema)
 * 2. Clause existence check (clause_id must exist in segmented clauses)
 * 3. Verbatim quote check inside the specified clause (only whitespace & quote normalization allowed)
 * 4. Character offset calculation for UI highlighting
 */
export function validateLLMOutput(
  rawInput: unknown,
  clauses: Clause[]
): ValidationResult {
  let parsedJson: unknown = rawInput;

  if (typeof rawInput === 'string') {
    const trimmed = rawInput.trim();
    try {
      parsedJson = JSON.parse(trimmed);
    } catch (err) {
      return {
        schema_valid: false,
        schema_error: `Geçersiz JSON formatı: ${(err as Error).message}`,
        document_type: 'unknown',
        overall_notes: '',
        valid_findings: [],
        dropped_findings: [],
        dropped_count: 0,
        total_raw_findings: 0,
      };
    }
  }

  const parseResult = LLMOutputSchema.safeParse(parsedJson);
  if (!parseResult.success) {
    const issueMessages = parseResult.error.issues
      .map((iss) => `${iss.path.join('.') || 'root'}: ${iss.message}`)
      .join('; ');
    return {
      schema_valid: false,
      schema_error: `Şema doğrulama hatası: ${issueMessages}`,
      document_type: 'unknown',
      overall_notes: '',
      valid_findings: [],
      dropped_findings: [],
      dropped_count: 0,
      total_raw_findings: 0,
    };
  }

  const data: LLMOutput = parseResult.data;
  const clauseMap = new Map<string, Clause>();
  for (const c of clauses) {
    clauseMap.set(c.clause_id, c);
  }

  const valid_findings: ValidatedFinding[] = [];
  const dropped_findings: DroppedFinding[] = [];

  for (const finding of data.findings) {
    const normalizedQuote = normalizeQuoteOnly(finding.quote);
    if (!normalizedQuote || normalizedQuote.length === 0) {
      dropped_findings.push({
        raw_finding: finding,
        reason: 'EMPTY_QUOTE',
        reason_tr: `Madde ${finding.clause_id} için alıntı (quote) alanı boş.`,
      });
      continue;
    }

    const clause = clauseMap.get(finding.clause_id);
    if (!clause) {
      dropped_findings.push({
        raw_finding: finding,
        reason: 'CLAUSE_NOT_FOUND',
        reason_tr: `Belirtilen madde kimliği (${finding.clause_id}) belgede mevcut değil.`,
      });
      continue;
    }

    const clauseNormMap = normalizeTextWithOffsets(clause.text);
    const matchIdx = clauseNormMap.normalized.indexOf(normalizedQuote);

    if (matchIdx === -1) {
      dropped_findings.push({
        raw_finding: finding,
        reason: 'QUOTE_NOT_FOUND_IN_CLAUSE',
        reason_tr: `Alıntı, ${finding.clause_id} maddesinde birebir bulunamadı ("${finding.quote.slice(0, 60)}${finding.quote.length > 60 ? '...' : ''}").`,
      });
      continue;
    }

    const localStart = clauseNormMap.normToRawStart[matchIdx];
    const localEnd =
      clauseNormMap.normToRawEnd[matchIdx + normalizedQuote.length - 1];

    valid_findings.push({
      ...finding,
      match_start_offset: clause.start_offset + localStart,
      match_end_offset: clause.start_offset + localEnd,
      clause_start_offset: clause.start_offset,
      clause_end_offset: clause.end_offset,
    });
  }

  return {
    schema_valid: true,
    document_type: data.document_type,
    overall_notes: data.overall_notes,
    valid_findings,
    dropped_findings,
    dropped_count: dropped_findings.length,
    total_raw_findings: data.findings.length,
  };
}
