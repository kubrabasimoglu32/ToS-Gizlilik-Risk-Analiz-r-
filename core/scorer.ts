import type {
  RiskCategory,
  RiskLevel,
  RiskSeverity,
  ScoreResult,
  SegmentedDocument,
  ValidationResult,
} from './schema';

/**
 * Tek kaynaklı (Single Source of Truth) Kategori × Önem Derecesi (Severity) ağırlık tablosu.
 * Risk skoru LLM'den ALINMAZ; yalnızca doğrulanmış bulgulardan bu tablo ile deterministik hesaplanır.
 */
export const CATEGORY_SEVERITY_WEIGHTS: Record<
  RiskCategory,
  Record<RiskSeverity, number>
> = {
  zorunlu_tahkim_dava_feragati: {
    low: 8,
    medium: 16,
    high: 26,
    critical: 35,
  },
  veri_paylasimi_satisi: {
    low: 7,
    medium: 15,
    high: 24,
    critical: 32,
  },
  otomatik_yenileme_iptal: {
    low: 6,
    medium: 14,
    high: 22,
    critical: 30,
  },
  ucret_iade: {
    low: 6,
    medium: 13,
    high: 20,
    critical: 28,
  },
  tek_tarafli_degisiklik: {
    low: 5,
    medium: 12,
    high: 18,
    critical: 25,
  },
  icerik_lisansi: {
    low: 5,
    medium: 11,
    high: 18,
    critical: 24,
  },
  hesap_kapatma: {
    low: 5,
    medium: 11,
    high: 17,
    critical: 23,
  },
  sorumluluk_siniri: {
    low: 4,
    medium: 10,
    high: 16,
    critical: 22,
  },
  diger: {
    low: 3,
    medium: 7,
    high: 12,
    critical: 16,
  },
};

export const REPEAT_CATEGORY_DECAY = 0.5;
export const CATEGORY_MAX_CAP = 45;
export const MIN_CONFIDENCE_THRESHOLD = 0.65;
export const MAX_ACCEPTABLE_DROP_RATIO = 0.5;
export const MAX_ACCEPTABLE_DROP_COUNT = 2;

/**
 * Doğrulanmış bulgulardan ve belge segmentasyon bilgisinden deterministik risk skoru (0-100)
 * ve belirsizlik ("Emin değilim") durumunu hesaplar.
 */
export function calculateRiskScore(
  validation: ValidationResult,
  document: Pick<
    SegmentedDocument,
    'looks_like_tos' | 'is_too_short' | 'char_count' | 'word_count'
  >,
  injectionAlerts: Array<{
    severity: 'warning' | 'high' | 'critical';
    source: string;
  }> = []
): ScoreResult {
  const uncertainty_reasons_tr: string[] = [];

  if (!validation.schema_valid) {
    uncertainty_reasons_tr.push(
      validation.schema_error ||
        'Model çıktısı yapılandırılmış JSON şemasına uymadı.'
    );
  }

  if (document.is_too_short) {
    uncertainty_reasons_tr.push(
      `Sayfa metni güvenilir analiz için çok kısa veya kesik (${document.char_count} karakter, ${document.word_count} kelime).`
    );
  }

  if (!document.looks_like_tos || validation.document_type === 'unknown') {
    uncertainty_reasons_tr.push(
      'Sayfa içeriği bir Kullanım Koşulları, Gizlilik Politikası veya Abonelik Şartları metnine benzemiyor.'
    );
  }

  if (validation.total_raw_findings > 0) {
    const dropRatio = validation.dropped_count / validation.total_raw_findings;
    if (
      validation.dropped_count >= MAX_ACCEPTABLE_DROP_COUNT ||
      dropRatio >= MAX_ACCEPTABLE_DROP_RATIO
    ) {
      uncertainty_reasons_tr.push(
        `Modelin ürettiği ${validation.total_raw_findings} bulgudan ${validation.dropped_count} tanesi orijinal metinde birebir doğrulanamadığı için reddedildi.`
      );
    }
  }

  // Çok katmanlı enjeksiyon savunması: Görünür metinde kritik enjeksiyon/sahte JSON varken model 0 bulgu döndürürse sahte "Düşük Risk" verilmesini engelle
  const hasInBandCriticalInjection = injectionAlerts.some(
    (a) =>
      (a.source === 'visible_text' || a.source === 'json_spoof') &&
      (a.severity === 'critical' || a.severity === 'high')
  );
  if (
    hasInBandCriticalInjection &&
    validation.valid_findings.length === 0 &&
    document.looks_like_tos
  ) {
    uncertainty_reasons_tr.push(
      'Sayfa metninde aktif bir Prompt Injection / Sahte JSON saldırısı tespit edildi ve model 0 bulgu döndürdü; sahte "Güvenli" sonucu engellendi.'
    );
  }

  const validFindings = validation.valid_findings;
  const average_confidence =
    validFindings.length > 0
      ? Number(
          (
            validFindings.reduce((acc, f) => acc + f.confidence, 0) /
            validFindings.length
          ).toFixed(2)
        )
      : 0;

  if (
    validFindings.length > 0 &&
    average_confidence < MIN_CONFIDENCE_THRESHOLD
  ) {
    uncertainty_reasons_tr.push(
      `Bulguların ortalama güven skoru (${average_confidence}) minimum güven eşiğinin (${MIN_CONFIDENCE_THRESHOLD}) altında.`
    );
  }

  // Group findings by category and compute category score
  const byCategory = new Map<RiskCategory, number[]>();
  for (const finding of validFindings) {
    const weight =
      CATEGORY_SEVERITY_WEIGHTS[finding.category][finding.severity];
    const list = byCategory.get(finding.category) ?? [];
    list.push(weight);
    byCategory.set(finding.category, list);
  }

  const category_scores: Partial<Record<RiskCategory, number>> = {};
  let totalRawScore = 0;

  for (const [category, weights] of byCategory.entries()) {
    // Sort weights descending: highest weight in category gets 100%, repeats get 50%
    weights.sort((a, b) => b - a);
    let catSum = 0;
    for (let i = 0; i < weights.length; i++) {
      catSum += i === 0 ? weights[i] : weights[i] * REPEAT_CATEGORY_DECAY;
    }
    const cappedCatScore = Math.min(CATEGORY_MAX_CAP, Math.round(catSum));
    category_scores[category] = cappedCatScore;
    totalRawScore += cappedCatScore;
  }

  const risk_score = Math.max(0, Math.min(100, Math.round(totalRawScore)));
  const is_uncertain = uncertainty_reasons_tr.length > 0;

  let risk_level: RiskLevel;
  if (is_uncertain) {
    risk_level = 'belirsiz';
  } else if (risk_score >= 70) {
    risk_level = 'kritik';
  } else if (risk_score >= 45) {
    risk_level = 'yuksek';
  } else if (risk_score >= 20) {
    risk_level = 'orta';
  } else {
    risk_level = 'dusuk';
  }

  return {
    risk_score,
    risk_level,
    is_uncertain,
    uncertainty_reasons_tr,
    category_scores,
    average_confidence,
  };
}
