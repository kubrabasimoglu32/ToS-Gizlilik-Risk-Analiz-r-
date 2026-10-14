import type {
  Clause,
  DocumentType,
  Finding,
  LLMOutput,
  RiskCategory,
  RiskSeverity,
} from '../../core/index';
import type { PromptPackage } from '../../core/prompts';

export type LLMProvider = 'gemini' | 'openai' | 'anthropic';

export interface StoredLLMSettings {
  provider: LLMProvider;
  apiKey: string;
  model: string;
  mockMode: boolean;
}

export const DEFAULT_LLM_SETTINGS: StoredLLMSettings = {
  provider: 'gemini',
  apiKey: '',
  model: 'gemini-2.5-flash',
  mockMode: false,
};

/**
 * Kullanıcının chrome.storage.local'a kaydettiği ayarları okur.
 * API anahtarı asla loglanmaz veya koda gömülmez.
 */
export async function getStoredLLMSettings(): Promise<StoredLLMSettings> {
  if (typeof chrome !== 'undefined' && chrome.storage?.local) {
    const data = await chrome.storage.local.get([
      'provider',
      'apiKey',
      'model',
      'mockMode',
    ]);
    return {
      provider: (data.provider as LLMProvider) || DEFAULT_LLM_SETTINGS.provider,
      apiKey: typeof data.apiKey === 'string' ? data.apiKey : '',
      model:
        typeof data.model === 'string' && data.model.trim()
          ? data.model.trim()
          : DEFAULT_LLM_SETTINGS.model,
      mockMode: Boolean(data.mockMode),
    };
  }
  return DEFAULT_LLM_SETTINGS;
}

interface HeuristicRule {
  category: RiskCategory;
  severity: RiskSeverity;
  explanation_tr: string;
  confidence: number;
  patterns: RegExp[];
}

const DETERMINISTIC_CLAUSE_MATCHERS: HeuristicRule[] = [
  {
    category: 'otomatik_yenileme_iptal',
    severity: 'high',
    explanation_tr:
      'Abonelik otomatik yenileniyor ve iptal etmek için noter dilekçesi gibi zor şartlar isteniyor.',
    confidence: 0.95,
    patterns: [
      /[^.!?]*(?:otomatik\s+olarak\s+yenilenir|otomatik\s+yenilenir|automatically\s+renew|auto-renew|noter\s+aracılığıyla|noter\s+onaylı)[^.!?]*[.!?]?/i,
    ],
  },
  {
    category: 'tek_tarafli_degisiklik',
    severity: 'high',
    explanation_tr:
      'Şirket, sözleşme şartlarını veya ücretleri size önceden haber vermeden tek başına değiştirebilir.',
    confidence: 0.94,
    patterns: [
      /[^.!?]*(?:tek\s+taraflı\s+olarak\s+değiştirme|bildirimde\s+bulunmaksızın\s+[^.!?]*değiştir|unilaterally\s+modify|unilateral\s+right\s+to\s+modify|sole\s+discretion\s+to\s+modify)[^.!?]*[.!?]?/i,
    ],
  },
  {
    category: 'veri_paylasimi_satisi',
    severity: 'critical',
    explanation_tr:
      'Kişisel verileriniz ve kullanım geçmişiniz reklam şirketlerine veya veri simsarlarına satılabilir.',
    confidence: 0.96,
    patterns: [
      /[^.!?]*(?:veri\s+simsarları|üçüncü\s+taraf[^.!?]*satıl|ticari\s+amaçlarla\s+paylaşıl|data\s+brokers|sell\s+your\s+personal\s+data|share\s+with\s+third-party\s+advertisers)[^.!?]*[.!?]?/i,
    ],
  },
  {
    category: 'zorunlu_tahkim_dava_feragati',
    severity: 'critical',
    explanation_tr:
      'Sorun yaşadığınızda mahkemeye veya tüketici hakem heyetine gitme hakkınızdan vazgeçmiş sayılırsınız.',
    confidence: 0.97,
    patterns: [
      /[^.!?]*(?:tahkim|toplu\s+dava\s+açma\s+hakkından|feragat\s+eder|binding\s+arbitration|waive\s+your\s+right\s+to\s+a\s+trial|class\s+action\s+waiver)[^.!?]*[.!?]?/i,
    ],
  },
  {
    category: 'ucret_iade',
    severity: 'high',
    explanation_tr:
      'Hizmeti hiç kullanmasanız veya arıza yaşansa bile ödediğiniz ücret geri verilmez.',
    confidence: 0.92,
    patterns: [
      /[^.!?]*(?:hiçbir\s+koşulda\s+iade\s+edilmez|ücret\s+iadesi\s+yapılmaz|non-refundable|do\s+not\s+provide\s+refunds|no\s+refunds)[^.!?]*[.!?]?/i,
    ],
  },
  {
    category: 'hesap_kapatma',
    severity: 'medium',
    explanation_tr:
      'Şirket hiçbir sebep göstermeden ve haber vermeden hesabınızı anında kapatabilir.',
    confidence: 0.89,
    patterns: [
      /[^.!?]*(?:gerekçe\s+göstermeksizin\s+kullanıcı\s+hesabını|hesabını\s+bildirim\s+yapmadan\s+kapat|terminate\s+[^.!?]*without\s+(?:cause|prior\s+notice)|suspend\s+or\s+terminate\s+your\s+access\s+to\s+the\s+Services\s+without\s+prior\s+notice)[^.!?]*[.!?]?/i,
    ],
  },
  {
    category: 'icerik_lisansi',
    severity: 'high',
    explanation_tr:
      'Yüklediğiniz içerikleri şirketin süresiz ve ücretsiz olarak ticari amaçla kullanmasına izin verirsiniz.',
    confidence: 0.91,
    patterns: [
      /[^.!?]*(?:süresiz,\s+bedelsiz,\s+geri\s+alınamaz|tam\s+ticari\s+kullanım\s+hakkı|irrevocable,\s+perpetual,\s+worldwide,\s+royalty-free|royalty-free,\s+fully\s+paid,\s+irrevocable,\s+worldwide\s+license)[^.!?]*[.!?]?/i,
    ],
  },
  {
    category: 'sorumluluk_siniri',
    severity: 'medium',
    explanation_tr:
      'Veri sızıntısı veya hizmet kesintisinden doğacak zararlardan şirket sorumlu tutulamaz.',
    confidence: 0.9,
    patterns: [
      /[^.!?]*(?:hiçbir\s+zarardan\s+sorumlu\s+tutulamaz|sorumluluk\s+kabul\s+etmez|shall\s+not\s+be\s+liable\s+for\s+any\s+indirect|be\s+liable\s+for\s+any\s+indirect,\s+special,\s+incidental|be\s+liable\s+to\s+you\s+for\s+any\s+lost\s+profits)[^.!?]*[.!?]?/i,
    ],
  },
];

/**
 * Tekrarlanabilir Cypress E2E demosu ve çevrimdışı testler için kayıtlı (mock) yanıt üretici.
 * Yalnızca gerçek maddelerdeki birebir cümleleri seçer ve doğrulayıcının (validator.ts)
 * sahte alıntıları eleme yeteneğini göstermek için 1 adet parafraz (doğrulayıcı tarafından atılacak) bulgu ekler.
 */
export function buildRecordedMockLLMOutput(clauses: Clause[]): LLMOutput {
  const fullText = clauses.map((c) => c.text).join('\n');
  const lower = fullText.toLocaleLowerCase('tr-TR');

  const isTosLike =
    lower.includes('kullanım koşulları') ||
    lower.includes('hizmet şartları') ||
    lower.includes('gizlilik') ||
    lower.includes('abonelik') ||
    lower.includes('terms of service') ||
    lower.includes('terms of use') ||
    lower.includes('privacy policy');

  if (!isTosLike || clauses.length === 0 || fullText.length < 220) {
    return {
      document_type: 'unknown',
      overall_notes:
        'Sayfa metni çok kısa veya bir sözleşme metnine benzemiyor.',
      findings: [],
    };
  }

  const findings: Finding[] = [];

  for (const clause of clauses) {
    for (const rule of DETERMINISTIC_CLAUSE_MATCHERS) {
      for (const regex of rule.patterns) {
        const match = regex.exec(clause.text);
        if (match && match[0].trim().length >= 20) {
          findings.push({
            clause_id: clause.clause_id,
            category: rule.category,
            severity: rule.severity,
            quote: match[0].trim(),
            explanation_tr: rule.explanation_tr,
            confidence: rule.confidence,
          });
          break;
        }
      }
    }
  }

  // En fazla 9 gerçek bulgu tut ki 1 adet elenecek test bulgusuyla toplam 10 sınırını aşmasın
  const cappedFindings = findings.slice(0, 9);

  if (cappedFindings.length >= 3) {
    cappedFindings.push({
      clause_id: clauses[0].clause_id,
      category: 'diger',
      severity: 'low',
      quote:
        'Bu cümle orijinal metinde birebir yer almayan özetlenmiş bir model halüsinasyonudur.',
      explanation_tr:
        'Doğrulayıcı tarafından birebir alıntı kontrolünde elenecek örnek iddia.',
      confidence: 0.85,
    });
  }

  let document_type: DocumentType = 'terms_of_service';
  if (lower.includes('gizlilik') && lower.includes('abonelik')) {
    document_type = 'mixed';
  } else if (lower.includes('gizlilik') || lower.includes('privacy')) {
    document_type = 'privacy_policy';
  } else if (lower.includes('abonelik') || lower.includes('subscription')) {
    document_type = 'subscription_terms';
  }

  return {
    document_type,
    overall_notes:
      'Sözleşmede otomatik yenileme, veri satışı ve dava hakkından feragat gibi önemli riskler bulundu. İptal ve iade koşulları kullanıcı aleyhine kısıtlanmış.',
    findings: cappedFindings,
  };
}

/**
 * Kullanıcının seçtiği sağlayıcıya (Gemini / OpenAI / Anthropic) gerçek HTTPS çağrısı yapar.
 * API anahtarı yalnızca ilgili sağlayıcının resmi uç noktasına gönderilir, asla loglanmaz.
 */
export async function callLiveLLMProvider(
  settings: StoredLLMSettings,
  prompts: PromptPackage,
  attempt: 1 | 2,
  previousSchemaError?: string
): Promise<string> {
  const apiKey = settings.apiKey.trim();
  if (!apiKey) {
    throw new Error(
      'API anahtarı bulunamadı. Lütfen uzantı Ayarlar (Options) sayfasından kendi LLM API anahtarınızı girin veya Demo (Mock) modunu etkinleştirin.'
    );
  }

  const retryCorrectionNote =
    attempt === 2 && previousSchemaError
      ? `\n\nDİKKAT: Önceki yanıtın şema doğrulamasından geçemedi (${previousSchemaError}). Lütfen YALNIZCA istenen JSON şemasına tam uyan geçerli bir JSON nesnesi döndür.`
      : '';

  const finalUserPrompt = prompts.userPrompt + retryCorrectionNote;

  if (settings.provider === 'gemini') {
    const model = settings.model || 'gemini-2.5-flash';
    const endpoint = `https://generativelanguage.googleapis.com/v1beta/models/${encodeURIComponent(model)}:generateContent?key=${encodeURIComponent(apiKey)}`;

    const response = await fetch(endpoint, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        systemInstruction: {
          parts: [{ text: prompts.systemPrompt }],
        },
        contents: [
          {
            role: 'user',
            parts: [{ text: finalUserPrompt }],
          },
        ],
        generationConfig: {
          temperature: 0.1,
          responseMimeType: 'application/json',
        },
      }),
    });

    if (!response.ok) {
      throw new Error(`Gemini API hatası (HTTP ${response.status})`);
    }
    const json = await response.json();
    const text = json?.candidates?.[0]?.content?.parts?.[0]?.text;
    if (!text) {
      throw new Error('Gemini API boş yanıt döndürdü.');
    }
    return text;
  }

  if (settings.provider === 'openai') {
    const model = settings.model || 'gpt-4o-mini';
    const response = await fetch('https://api.openai.com/v1/chat/completions', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        Authorization: `Bearer ${apiKey}`,
      },
      body: JSON.stringify({
        model,
        temperature: 0.1,
        response_format: { type: 'json_object' },
        messages: [
          { role: 'system', content: prompts.systemPrompt },
          { role: 'user', content: finalUserPrompt },
        ],
      }),
    });

    if (!response.ok) {
      throw new Error(`OpenAI API hatası (HTTP ${response.status})`);
    }
    const json = await response.json();
    const text = json?.choices?.[0]?.message?.content;
    if (!text) {
      throw new Error('OpenAI API boş yanıt döndürdü.');
    }
    return text;
  }

  if (settings.provider === 'anthropic') {
    const model = settings.model || 'claude-3-5-haiku-latest';
    const response = await fetch('https://api.anthropic.com/v1/messages', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'x-api-key': apiKey,
        'anthropic-version': '2023-06-01',
        'anthropic-dangerous-direct-browser-access': 'true',
      },
      body: JSON.stringify({
        model,
        max_tokens: 4096,
        temperature: 0.1,
        system: prompts.systemPrompt,
        messages: [{ role: 'user', content: finalUserPrompt }],
      }),
    });

    if (!response.ok) {
      throw new Error(`Anthropic API hatası (HTTP ${response.status})`);
    }
    const json = await response.json();
    const text = json?.content?.[0]?.text;
    if (!text) {
      throw new Error('Anthropic API boş yanıt döndürdü.');
    }
    return text;
  }

  throw new Error(`Desteklenmeyen LLM sağlayıcısı: ${settings.provider}`);
}
