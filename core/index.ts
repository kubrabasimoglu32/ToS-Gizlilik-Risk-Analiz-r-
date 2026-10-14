export * from './schema';
export * from './segmenter';
export * from './validator';
export * from './scorer';
export * from './prompts';
export * from './injection-detector';

import {
  LEGAL_DISCLAIMER_TR,
  type InjectionAlert,
  type RiskReport,
} from './schema';
import { segmentDocument } from './segmenter';
import { validateLLMOutput } from './validator';
import { calculateRiskScore } from './scorer';
import { buildAnalysisPrompts, type PromptPackage } from './prompts';
import { detectTextInjections } from './injection-detector';

export type LLMCallerFn = (
  prompts: PromptPackage,
  attempt: 1 | 2,
  previousSchemaError?: string
) => Promise<unknown>;

export interface PipelineInput {
  url: string;
  title: string;
  rawText: string;
  llmCaller: LLMCallerFn;
  preDetectedAlerts?: InjectionAlert[];
}

/**
 * Uçtan uca deterministik doğrulama ve skorlama hattı (Chrome'dan bağımsız, Node ve tarayıcıda çalışır).
 * Şemaya uymayan LLM çıktısını reddeder ve en fazla 1 kez yeniden dener (toplam max 2 deneme).
 */
export async function runAnalysisPipeline(
  input: PipelineInput
): Promise<RiskReport> {
  const segmented = segmentDocument(input.rawText);
  const textAlerts = detectTextInjections(
    segmented.cleaned_text,
    'visible_text'
  );

  // Merge alerts without duplicates
  const alertMap = new Map<string, InjectionAlert>();
  for (const a of [...(input.preDetectedAlerts ?? []), ...textAlerts]) {
    alertMap.set(`${a.rule_id}:${a.source}:${a.matched_snippet}`, a);
  }
  const injection_alerts = Array.from(alertMap.values());

  const prompts = buildAnalysisPrompts(segmented.clauses);

  let retry_count = 0;
  const firstRawOutput = await input.llmCaller(prompts, 1);
  let validation = validateLLMOutput(firstRawOutput, segmented.clauses);

  // Rule 2: Şemaya uymayan çıktıyı reddet; gerekirse en fazla 1 kez yeniden dene.
  if (!validation.schema_valid) {
    retry_count = 1;
    const secondRawOutput = await input.llmCaller(
      prompts,
      2,
      validation.schema_error
    );
    validation = validateLLMOutput(secondRawOutput, segmented.clauses);
  }

  const score = calculateRiskScore(validation, segmented, injection_alerts);

  return {
    url: input.url,
    title: input.title,
    analyzed_at: new Date().toISOString(),
    disclaimer_tr: LEGAL_DISCLAIMER_TR,
    document_type: validation.document_type,
    overall_notes: validation.overall_notes,
    score,
    findings: validation.valid_findings,
    dropped_findings: validation.dropped_findings,
    dropped_count: validation.dropped_count,
    injection_alerts,
    clauses: segmented.clauses,
    retry_count,
  };
}
