import { z } from 'zod';

export const LEGAL_DISCLAIMER_TR =
  'Bu uygulama hukuki tavsiye vermez. Yalnızca bilgilendirme amaçlıdır.' as const;

export const RISK_CATEGORIES = [
  'otomatik_yenileme_iptal',
  'tek_tarafli_degisiklik',
  'veri_paylasimi_satisi',
  'zorunlu_tahkim_dava_feragati',
  'sorumluluk_siniri',
  'icerik_lisansi',
  'hesap_kapatma',
  'ucret_iade',
  'diger',
] as const;

export type RiskCategory = (typeof RISK_CATEGORIES)[number];

export const RiskCategorySchema = z.enum(RISK_CATEGORIES);

export const CATEGORY_LABELS_TR: Record<RiskCategory, string> = {
  otomatik_yenileme_iptal: 'Otomatik Yenileme ve İptal Zorluğu',
  tek_tarafli_degisiklik: 'Tek Taraflı Değişiklik Hakkı',
  veri_paylasimi_satisi: 'Veri Paylaşımı ve Üçüncü Taraflara Satış',
  zorunlu_tahkim_dava_feragati: 'Zorunlu Tahkim ve Dava Açma Feragati',
  sorumluluk_siniri: 'Geniş Sorumluluk Sınırlandırması',
  icerik_lisansi: 'Geniş İçerik / Telif Lisansı Devri',
  hesap_kapatma: 'Keyfi Hesap Askıya Alma / Kapatma',
  ucret_iade: 'Ücret Değişikliği ve İade Kısıtlaması',
  diger: 'Diğer Riskli Koşul',
};

export const RISK_SEVERITIES = ['low', 'medium', 'high', 'critical'] as const;

export type RiskSeverity = (typeof RISK_SEVERITIES)[number];

export const RiskSeveritySchema = z.enum(RISK_SEVERITIES);

export const SEVERITY_LABELS_TR: Record<RiskSeverity, string> = {
  low: 'Düşük',
  medium: 'Orta',
  high: 'Yüksek',
  critical: 'Kritik',
};

export const DOCUMENT_TYPES = [
  'terms_of_service',
  'privacy_policy',
  'subscription_terms',
  'mixed',
  'unknown',
] as const;

export type DocumentType = (typeof DOCUMENT_TYPES)[number];

export const DocumentTypeSchema = z.enum(DOCUMENT_TYPES);

export const MAX_EXPLANATION_CHARS = 180;
export const MAX_EXPLANATION_WORDS = 20;
export const MAX_FINDINGS_COUNT = 10;

export const FindingSchema = z
  .object({
    clause_id: z.string().min(1, 'clause_id boş olamaz'),
    category: RiskCategorySchema,
    severity: RiskSeveritySchema,
    quote: z.string().min(1, 'quote boş olamaz'),
    explanation_tr: z
      .string()
      .min(1, 'explanation_tr boş olamaz')
      .max(
        MAX_EXPLANATION_CHARS,
        `explanation_tr en fazla ${MAX_EXPLANATION_CHARS} karakter olabilir`
      )
      .refine(
        (val) => val.trim().split(/\s+/).filter(Boolean).length <= MAX_EXPLANATION_WORDS,
        {
          message: `explanation_tr tek cümle ve en fazla ${MAX_EXPLANATION_WORDS} kelime olmalıdır`,
        }
      ),
    confidence: z.number().min(0).max(1),
  })
  .strict();

export type Finding = z.infer<typeof FindingSchema>;

export const LLMOutputSchema = z
  .object({
    findings: z
      .array(FindingSchema)
      .max(MAX_FINDINGS_COUNT, `En fazla ${MAX_FINDINGS_COUNT} bulgu döndürülebilir`),
    document_type: DocumentTypeSchema,
    overall_notes: z.string(),
  })
  .strict();

export type LLMOutput = z.infer<typeof LLMOutputSchema>;

export interface Clause {
  clause_id: string;
  text: string;
  start_offset: number;
  end_offset: number;
}

export interface SegmentedDocument {
  raw_text: string;
  cleaned_text: string;
  clauses: Clause[];
  char_count: number;
  word_count: number;
  looks_like_tos: boolean;
  is_too_short: boolean;
  tos_keyword_hits: number;
}

export interface ValidatedFinding extends Finding {
  match_start_offset: number;
  match_end_offset: number;
  clause_start_offset: number;
  clause_end_offset: number;
}

export type DropReason =
  | 'SCHEMA_INVALID'
  | 'CLAUSE_NOT_FOUND'
  | 'EMPTY_QUOTE'
  | 'QUOTE_NOT_FOUND_IN_CLAUSE';

export interface DroppedFinding {
  raw_finding: unknown;
  reason: DropReason;
  reason_tr: string;
}

export interface ValidationResult {
  schema_valid: boolean;
  schema_error?: string;
  document_type: DocumentType;
  overall_notes: string;
  valid_findings: ValidatedFinding[];
  dropped_findings: DroppedFinding[];
  dropped_count: number;
  total_raw_findings: number;
}

export type RiskLevel = 'dusuk' | 'orta' | 'yuksek' | 'kritik' | 'belirsiz';

export interface ScoreResult {
  risk_score: number;
  risk_level: RiskLevel;
  is_uncertain: boolean;
  uncertainty_reasons_tr: string[];
  category_scores: Partial<Record<RiskCategory, number>>;
  average_confidence: number;
}

export type InjectionSource =
  | 'visible_text'
  | 'hidden_dom'
  | 'html_comment'
  | 'aria_attribute'
  | 'json_spoof';

export interface InjectionAlert {
  rule_id: string;
  severity: 'warning' | 'high' | 'critical';
  source: InjectionSource;
  description_tr: string;
  matched_snippet: string;
}

export interface RiskReport {
  url: string;
  title: string;
  analyzed_at: string;
  disclaimer_tr: typeof LEGAL_DISCLAIMER_TR;
  document_type: DocumentType;
  overall_notes: string;
  score: ScoreResult;
  findings: ValidatedFinding[];
  dropped_findings: DroppedFinding[];
  dropped_count: number;
  injection_alerts: InjectionAlert[];
  clauses: Clause[];
  retry_count: number;
}
