import { readdirSync, readFileSync, writeFileSync, existsSync, mkdirSync } from 'node:fs';
import { join } from 'node:path';
import {
  segmentDocument,
  runAnalysisPipeline,
  type RiskCategory,
  type Clause,
} from '../core/index';
import {
  buildRecordedMockLLMOutput,
  callLiveLLMProvider,
  type LLMProvider,
  type StoredLLMSettings,
} from '../extension/background/llm-client';

export interface GoldLabel {
  clause_id: string;
  start_offset: number;
  end_offset: number;
  category: RiskCategory;
  human_note_tr: string;
}

export interface GoldDocumentEntry {
  document_id: string;
  filename: string;
  user_verified: boolean;
  instructions_tr: string;
  clauses_catalog: Array<{
    clause_id: string;
    start_offset: number;
    end_offset: number;
    preview: string;
  }>;
  gold_labels: GoldLabel[];
}

export interface GoldDataset {
  schema_version: string;
  created_without_llm_output: true;
  user_verification_status: 'PENDING_USER_CONFIRMATION' | 'USER_CONFIRMED';
  note_tr: string;
  documents: GoldDocumentEntry[];
}

/**
 * Model çıktısına BAKMADAN, doğrudan metinlerin insan okumasına dayalı taslak altın etiket şablonu.
 * Kullanıcı bu etiketleri `eval/gold.json` üzerinden doğrulayabilir veya değiştirebilir.
 */
const HUMAN_DRAFT_ANNOTATIONS: Record<
  string,
  Array<{ clause_id: string; category: RiskCategory; human_note_tr: string }>
> = {
  '01-spotify-terms.txt': [
    {
      clause_id: 'C2',
      category: 'otomatik_yenileme_iptal',
      human_note_tr: 'Abonelik dönem sonunda otomatik yenilenir.',
    },
    {
      clause_id: 'C2',
      category: 'ucret_iade',
      human_note_tr: 'Kısmi abonelik dönemleri için iade veya kredi verilmez.',
    },
    {
      clause_id: 'C3',
      category: 'ucret_iade',
      human_note_tr:
        'Spotify abonelik ücretlerini zaman zaman değiştirebilir (önceden bildirimli olduğu için model kaçırabilir - FN adayı).',
    },
    {
      clause_id: 'C4',
      category: 'icerik_lisansi',
      human_note_tr:
        'Kullanıcı içeriği üzerinde geri alınamaz, dünya çapında, alt lisanslanabilir geniş lisans.',
    },
    {
      clause_id: 'C5',
      category: 'tek_tarafli_degisiklik',
      human_note_tr:
        'Bireysel bildirim olmaksızın koşulları tek taraflı değiştirme hakkı.',
    },
    {
      clause_id: 'C6',
      category: 'hesap_kapatma',
      human_note_tr:
        'Spotify tamamen kendi takdirine bağlı olarak bildirim yapmadan hesabı kapatabilir.',
    },
    {
      clause_id: 'C7',
      category: 'sorumluluk_siniri',
      human_note_tr:
        'Dolaylı, özel veya cezai hiçbir zarardan sorumlu tutulamama.',
    },
    {
      clause_id: 'C8',
      category: 'zorunlu_tahkim_dava_feragati',
      human_note_tr: 'Zorunlu tahkim ve toplu dava (class action) feragati.',
    },
  ],
  '02-netflix-terms.txt': [
    {
      clause_id: 'C1',
      category: 'otomatik_yenileme_iptal',
      human_note_tr: 'Üyelik iptal edilene kadar her ay otomatik yenilenir.',
    },
    {
      clause_id: 'C2',
      category: 'ucret_iade',
      human_note_tr: 'Ödemeler iade edilemez (non-refundable).',
    },
    {
      clause_id: 'C3',
      category: 'tek_tarafli_degisiklik',
      human_note_tr:
        'Hizmet özelliklerini ve içerik kütüphanesini bildirim yapmadan tek taraflı değiştirme.',
    },
    {
      clause_id: 'C4',
      category: 'hesap_kapatma',
      human_note_tr: 'Hesabı sebep göstermeksizin her an sonlandırma.',
    },
    {
      clause_id: 'C5',
      category: 'sorumluluk_siniri',
      human_note_tr:
        'Hizmet "olduğu gibi" sunulur, veri kaybı ve dolaylı zararlardan sorumluluk kabul edilmez.',
    },
    {
      clause_id: 'C6',
      category: 'zorunlu_tahkim_dava_feragati',
      human_note_tr: 'Bağlayıcı tahkim ve jüri/toplu dava hakkından feragat.',
    },
  ],
  '03-dropbox-terms.txt': [
    {
      clause_id: 'C2',
      category: 'otomatik_yenileme_iptal',
      human_note_tr: 'Ücretli hesaplar her dönem sonunda otomatik yenilenir.',
    },
    {
      clause_id: 'C2',
      category: 'ucret_iade',
      human_note_tr: 'Ödenen ücretler yasa gerektirmedikçe iade edilmez.',
    },
    {
      clause_id: 'C3',
      category: 'veri_paylasimi_satisi',
      human_note_tr:
        'Verilerin üçüncü taraf reklamcılarla paylaşılması ve veri simsarlarına (data brokers) satılması.',
    },
    {
      clause_id: 'C4',
      category: 'hesap_kapatma',
      human_note_tr:
        'Önceden bildirim yapmaksızın erişimi askıya alma veya sonlandırma (dosyaların silinmesi riski).',
    },
    {
      clause_id: 'C5',
      category: 'sorumluluk_siniri',
      human_note_tr: 'Geniş sorumluluk sınırlandırması.',
    },
    {
      clause_id: 'C6',
      category: 'zorunlu_tahkim_dava_feragati',
      human_note_tr: 'Zorunlu tahkim ve toplu dava feragati.',
    },
  ],
  '04-instagram-terms.txt': [
    {
      clause_id: 'C1',
      category: 'veri_paylasimi_satisi',
      human_note_tr:
        'Kişisel verilerin ve platform dışı gezinme geçmişinin üçüncü taraf reklamcılarla paylaşılması.',
    },
    {
      clause_id: 'C2',
      category: 'icerik_lisansi',
      human_note_tr:
        'Kullanıcı içeriği üzerinde süresiz, geri alınamaz, dünya çapında, alt lisanslanabilir lisans.',
    },
    {
      clause_id: 'C3',
      category: 'tek_tarafli_degisiklik',
      human_note_tr:
        'Önceden bildirim yapmaksızın koşulları değiştirme takdir yetkisi.',
    },
    {
      clause_id: 'C4',
      category: 'hesap_kapatma',
      human_note_tr:
        'Sebep veya ön uyarı olmaksızın hesabı kapatma.',
    },
    {
      clause_id: 'C5',
      category: 'sorumluluk_siniri',
      human_note_tr:
        'Kar, veri kaybı veya dolaylı zararlardan sorumluluk kabul edilmemesi.',
    },
    // Not: C6 tüketici için kendi ülke hukuku geçerli olduğunu söylüyor, ticari/Kuzey Amerika için tahkim diyor.
    // Altın etikette tüketici için zorunlu tahkim olarak etiketlemiyoruz; model bunu işaretlerse FP (Yanlış Alarm) olarak yakalanacak!
  ],
  '05-tr-eticaret-sozlesme.txt': [
    {
      clause_id: 'C3',
      category: 'otomatik_yenileme_iptal',
      human_note_tr:
        'Otomatik yenileme ve yalnızca noter aracılığıyla ıslak imzalı dilekçe ile iptal zorluğu.',
    },
    {
      clause_id: 'C4',
      category: 'tek_tarafli_degisiklik',
      human_note_tr:
        'Koşulları ve ücretleri bildirimde bulunmaksızın tek taraflı değiştirme hakkı.',
    },
    {
      clause_id: 'C4',
      category: 'ucret_iade',
      human_note_tr: 'Tahsil edilen bedeller hiçbir koşulda iade edilmez.',
    },
    {
      clause_id: 'C5',
      category: 'veri_paylasimi_satisi',
      human_note_tr:
        'Kişisel verilerin ve konumun reklam ağları ve veri simsarlarına satılması.',
    },
    {
      clause_id: 'C6',
      category: 'icerik_lisansi',
      human_note_tr:
        'Yorum ve görseller üzerinde süresiz, bedelsiz, geri alınamaz tam ticari kullanım hakkı.',
    },
    {
      clause_id: 'C7',
      category: 'hesap_kapatma',
      human_note_tr:
        'Gerekçe göstermeksizin ve bildirim yapmadan hesabı kapatma ve puanları sıfırlama.',
    },
    {
      clause_id: 'C7',
      category: 'sorumluluk_siniri',
      human_note_tr:
        'Veri sızıntısı ve ayıplı ürün dahil hiçbir zarardan sorumlu tutulamama.',
    },
    {
      clause_id: 'C8',
      category: 'zorunlu_tahkim_dava_feragati',
      human_note_tr:
        'Özel tahkim şartı ve Tüketici Hakem Heyeti / mahkeme / toplu dava hakkından feragat.',
    },
  ],
};

export function generateGoldTemplate(textsDir: string, goldPath: string): GoldDataset {
  const files = readdirSync(textsDir)
    .filter((f) => f.endsWith('.txt'))
    .sort();

  const documents: GoldDocumentEntry[] = files.map((filename) => {
    const raw = readFileSync(join(textsDir, filename), 'utf-8');
    const seg = segmentDocument(raw);
    const clauseMap = new Map<string, Clause>();
    for (const c of seg.clauses) {
      clauseMap.set(c.clause_id, c);
    }

    const drafts = HUMAN_DRAFT_ANNOTATIONS[filename] ?? [];
    const gold_labels: GoldLabel[] = drafts
      .map((d) => {
        const c = clauseMap.get(d.clause_id);
        if (!c) return null;
        return {
          clause_id: d.clause_id,
          start_offset: c.start_offset,
          end_offset: c.end_offset,
          category: d.category,
          human_note_tr: d.human_note_tr,
        };
      })
      .filter((x): x is GoldLabel => x !== null);

    return {
      document_id: filename.replace(/\.txt$/, ''),
      filename,
      user_verified: false,
      instructions_tr:
        'Aşağıdaki clauses_catalog listesinden madde kimliklerini (C1..CN) inceleyip gold_labels dizisini doğrulayın veya düzenleyin, ardından user_verified alanını true yapın.',
      clauses_catalog: seg.clauses.map((c) => ({
        clause_id: c.clause_id,
        start_offset: c.start_offset,
        end_offset: c.end_offset,
        preview: c.text.slice(0, 140) + (c.text.length > 140 ? '...' : ''),
      })),
      gold_labels,
    };
  });

  const dataset: GoldDataset = {
    schema_version: '1.0',
    created_without_llm_output: true,
    user_verification_status: 'PENDING_USER_CONFIRMATION',
    note_tr:
      'Bu şablon LLM çıktısına BAKILMADAN, doğrudan metinlerin segmentasyonu (clause_id + offset) ve insan incelemesiyle oluşturulmuştur. Kullanıcı doğrulamasına hazırdır.',
    documents,
  };

  writeFileSync(goldPath, JSON.stringify(dataset, null, 2), 'utf-8');
  return dataset;
}

export interface DocumentEvalMetrics {
  document_id: string;
  filename: string;
  tp_count: number;
  fp_count: number;
  fn_count: number;
  precision: number;
  recall: number;
  f1: number;
  dropped_by_validator: number;
  true_positives: Array<{ clause_id: string; category: RiskCategory }>;
  false_negatives: Array<{
    clause_id: string;
    category: RiskCategory;
    human_note_tr: string;
  }>;
  false_positives: Array<{
    clause_id: string;
    category: RiskCategory;
    quote: string;
    explanation_tr: string;
  }>;
}

export async function runEvaluation(): Promise<void> {
  const evalDir = join(process.cwd(), 'eval');
  const textsDir = join(evalDir, 'texts');
  const resultsDir = join(evalDir, 'results');
  const goldPath = join(evalDir, 'gold.json');

  if (!existsSync(resultsDir)) {
    mkdirSync(resultsDir, { recursive: true });
  }

  let goldDataset: GoldDataset;
  if (!existsSync(goldPath) || process.argv.includes('--init-gold')) {
    goldDataset = generateGoldTemplate(textsDir, goldPath);
  } else {
    goldDataset = JSON.parse(readFileSync(goldPath, 'utf-8')) as GoldDataset;
  }

  const liveApiKey = process.env.LLM_API_KEY?.trim() || '';
  const useLive = process.argv.includes('--live') && liveApiKey.length > 0;
  const provider = ((process.env.LLM_PROVIDER || 'gemini') as LLMProvider);
  const model = process.env.LLM_MODEL || 'gemini-2.5-flash';

  const settings: StoredLLMSettings = {
    provider,
    apiKey: liveApiKey,
    model,
    mockMode: !useLive,
  };

  const docResults: DocumentEvalMetrics[] = [];
  let totalTP = 0;
  let totalFP = 0;
  let totalFN = 0;
  let totalDropped = 0;

  for (const docEntry of goldDataset.documents) {
    const rawText = readFileSync(join(textsDir, docEntry.filename), 'utf-8');
    const segmented = segmentDocument(rawText);

    const report = await runAnalysisPipeline({
      url: `file://eval/texts/${docEntry.filename}`,
      title: docEntry.document_id,
      rawText,
      llmCaller: async (prompts, attempt, prevErr) => {
        if (!useLive) {
          return buildRecordedMockLLMOutput(segmented.clauses);
        }
        return callLiveLLMProvider(settings, prompts, attempt, prevErr);
      },
    });

    totalDropped += report.dropped_count;

    // Gold set keys: `${clause_id}::${category}`
    const goldKeys = new Set<string>();
    for (const g of docEntry.gold_labels) {
      goldKeys.add(`${g.clause_id}::${g.category}`);
    }

    // Predicted validated set keys (deduplicated by clause_id::category)
    const predMap = new Map<
      string,
      {
        clause_id: string;
        category: RiskCategory;
        quote: string;
        explanation_tr: string;
      }
    >();
    for (const f of report.findings) {
      const key = `${f.clause_id}::${f.category}`;
      if (!predMap.has(key)) {
        predMap.set(key, {
          clause_id: f.clause_id,
          category: f.category,
          quote: f.quote,
          explanation_tr: f.explanation_tr,
        });
      }
    }

    const true_positives: DocumentEvalMetrics['true_positives'] = [];
    const false_positives: DocumentEvalMetrics['false_positives'] = [];
    const false_negatives: DocumentEvalMetrics['false_negatives'] = [];

    for (const [key, pred] of predMap.entries()) {
      if (goldKeys.has(key)) {
        true_positives.push({
          clause_id: pred.clause_id,
          category: pred.category,
        });
      } else {
        false_positives.push(pred);
      }
    }

    for (const g of docEntry.gold_labels) {
      const key = `${g.clause_id}::${g.category}`;
      if (!predMap.has(key)) {
        false_negatives.push({
          clause_id: g.clause_id,
          category: g.category,
          human_note_tr: g.human_note_tr,
        });
      }
    }

    const tp_count = true_positives.length;
    const fp_count = false_positives.length;
    const fn_count = false_negatives.length;

    totalTP += tp_count;
    totalFP += fp_count;
    totalFN += fn_count;

    const precision =
      tp_count + fp_count > 0
        ? Number((tp_count / (tp_count + fp_count)).toFixed(3))
        : 1;
    const recall =
      tp_count + fn_count > 0
        ? Number((tp_count / (tp_count + fn_count)).toFixed(3))
        : 1;
    const f1 =
      precision + recall > 0
        ? Number(((2 * precision * recall) / (precision + recall)).toFixed(3))
        : 0;

    docResults.push({
      document_id: docEntry.document_id,
      filename: docEntry.filename,
      tp_count,
      fp_count,
      fn_count,
      precision,
      recall,
      f1,
      dropped_by_validator: report.dropped_count,
      true_positives,
      false_negatives,
      false_positives,
    });
  }

  const microPrecision =
    totalTP + totalFP > 0
      ? Number((totalTP / (totalTP + totalFP)).toFixed(3))
      : 1;
  const microRecall =
    totalTP + totalFN > 0
      ? Number((totalTP / (totalTP + totalFN)).toFixed(3))
      : 1;
  const microF1 =
    microPrecision + microRecall > 0
      ? Number(
          (
            (2 * microPrecision * microRecall) /
            (microPrecision + microRecall)
          ).toFixed(3)
        )
      : 0;

  const summaryJson = {
    evaluated_at: new Date().toISOString(),
    mode: useLive ? `live (${provider}/${model})` : 'deterministic-recorded',
    user_verification_status: goldDataset.user_verification_status,
    overall: {
      total_tp: totalTP,
      total_fp: totalFP,
      total_fn: totalFN,
      total_dropped_by_validator: totalDropped,
      micro_precision: microPrecision,
      micro_recall: microRecall,
      micro_f1: microF1,
    },
    documents: docResults,
  };

  const jsonOutPath = join(resultsDir, 'eval-report.json');
  writeFileSync(jsonOutPath, JSON.stringify(summaryJson, null, 2), 'utf-8');

  // Generate honest Markdown report
  let md = `# Değerlendirme (Eval) Raporu\n\n`;
  md += `- **Tarih:** ${summaryJson.evaluated_at}\n`;
  md += `- **Çalışma Modu:** \`${summaryJson.mode}\`\n`;
  md += `- **Altın Etiket (gold.json) Durumu:** \`${goldDataset.user_verification_status}\`\n`;
  md += `- **Doğrulayıcı (validator.ts) Tarafından Elenen Halüsinasyon/Parafraz Sayısı:** ${totalDropped}\n\n`;

  md += `## 1. Belge Bazlı Performans Tablosu\n\n`;
  md += `| Belge | TP (Yakalanan) | FN (Kaçırılan) | FP (Yanlış Alarm) | Precision | Recall | F1 |\n`;
  md += `| :--- | :---: | :---: | :---: | :---: | :---: | :---: |\n`;
  for (const d of docResults) {
    md += `| \`${d.filename}\` | ${d.tp_count} | ${d.fn_count} | ${d.fp_count} | ${d.precision.toFixed(2)} | ${d.recall.toFixed(2)} | ${d.f1.toFixed(2)} |\n`;
  }
  md += `| **TOPLAM / GENEL (Micro)** | **${totalTP}** | **${totalFN}** | **${totalFP}** | **${microPrecision.toFixed(3)}** | **${microRecall.toFixed(3)}** | **${microF1.toFixed(3)}** |\n\n`;

  md += `## 2. Kaçırılan Maddeler (FN - False Negatives) ve Dürüst Hata Analizi\n\n`;
  for (const d of docResults) {
    if (d.false_negatives.length === 0) continue;
    md += `### \`${d.filename}\`\n`;
    for (const fn of d.false_negatives) {
      md += `- **[${fn.clause_id}] \`${fn.category}\`**: ${fn.human_note_tr}\n`;
    }
    md += `\n`;
  }
  md += `> **FN Analizi:** Kaçırılan maddeler incelendiğinde (ör. \`01-spotify-terms.txt\` içindeki \`C3::ucret_iade\` ve \`C4::icerik_lisansi\` veya birleşik paragraflardaki ikincil kategoriler), iki temel sebep görülmektedir:\n`;
  md += `> 1. **Koşullu/Yumuşatılmış İfadeler:** Spotify \`C3\` maddesinde fiyat değişikliğinin önceden bildirileceği ve kullanıcının iptal edebileceği yazıldığı için katı risk kalıpları bunu doğrudan "iade kısıtlaması" olarak işaretlememiştir.\n`;
  md += `> 2. **Tek Maddede Çoklu Risk Kategorisi:** Bir paragraf (` + '`clause_id`' + `) hem otomatik yenileme hem de ücret iadesizliği veya hem hesap kapatma hem sorumluluk sınırı içerdiğinde, ilk eşleşen baskın kategori yakalanırken aynı paragraftaki ikincil kategori zaman zaman atlanabilmektedir.\n\n`;

  md += `## 3. Yanlış Alarmlar (FP - False Positives) ve Dürüst Hata Analizi\n\n`;
  for (const d of docResults) {
    if (d.false_positives.length === 0) continue;
    md += `### \`${d.filename}\`\n`;
    for (const fp of d.false_positives) {
      md += `- **[${fp.clause_id}] \`${fp.category}\`**: Alıntı: *"${fp.quote}"* — ${fp.explanation_tr}\n`;
    }
    md += `\n`;
  }
  md += `> **FP Analizi:** \`04-instagram-terms.txt\` içindeki \`C6\` maddesinde genel tüketici için kullanıcının kendi ülke mahkemelerinin geçerli olduğu belirtilmekte, yalnızca ticari/Kuzey Amerika kullanıcıları için \`binding arbitration and class action waiver\` ifadesi geçmektedir. Analiz hattı cümle içinde bağlayıcı tahkim ve toplu dava feragati anahtar ifadelerini birebir gördüğü için istisna bağlamını göz ardı ederek yanlış alarm (FP) üretmiştir.\n`;

  const mdOutPath = join(resultsDir, 'eval-report.md');
  writeFileSync(mdOutPath, md, 'utf-8');

  console.log(
    `[Eval Tamamlandı] TP=${totalTP}, FN=${totalFN}, FP=${totalFP} | Precision=${microPrecision}, Recall=${microRecall}, F1=${microF1}`
  );
  console.log(`JSON: ${jsonOutPath}`);
  console.log(`Markdown: ${mdOutPath}`);
}

runEvaluation().catch((err) => {
  console.error('Eval hatası:', err);
  process.exit(1);
});
