import type { InjectionAlert, InjectionSource } from './schema';

interface InjectionPattern {
  rule_id: string;
  severity: 'warning' | 'high' | 'critical';
  source_override?: InjectionSource;
  description_tr: string;
  regex: RegExp;
}

const INJECTION_PATTERNS: InjectionPattern[] = [
  {
    rule_id: 'INJ_TR_IGNORE_INSTRUCTIONS',
    severity: 'critical',
    description_tr:
      'Metin içinde önceki talimatları sıfırlamaya çalışan Türkçe komut tespit edildi.',
    regex:
      /(?:önceki|yukarıdaki|tüm|bütün)\s+(?:talimatları|kuralları|yönergeleri|komutları)\s+(?:unut|yoksay|görmezden\s+gel|iptal\s+et)/i,
  },
  {
    rule_id: 'INJ_TR_FORCE_NO_RISK',
    severity: 'critical',
    description_tr:
      'Modeli sahte biçimde "risk yok / güvenli" raporlamaya zorlayan Türkçe talimat tespit edildi.',
    regex:
      /(?:risk\s+yok\s+de|risk\s+bulunmadı\s+raporla|hiçbir\s+risk\s+bulunmadığını\s+söyle|risk\s+skorunu\s+0\s+yap|güvenli\s+olarak\s+raporla)/i,
  },
  {
    rule_id: 'INJ_EN_IGNORE_INSTRUCTIONS',
    severity: 'critical',
    description_tr:
      'Metin içinde sistem talimatlarını geçersiz kılmaya çalışan İngilizce prompt injection kalıbı tespit edildi.',
    regex:
      /(?:ignore|disregard|forget|override)\s+(?:all\s+|any\s+)?(?:previous|prior|above|system)\s+(?:instructions|prompts|rules|directives)/i,
  },
  {
    rule_id: 'INJ_EN_FORCE_SAFE_OUTPUT',
    severity: 'high',
    description_tr:
      'Modeli boş bulgu veya sıfır risk döndürmeye yönlendiren İngilizce komut tespit edildi.',
    regex:
      /(?:report\s+no\s+risks|return\s+empty\s+findings|output\s+zero\s+risk|do\s+not\s+flag\s+any\s+clauses|mark\s+this\s+document\s+as\s+completely\s+safe)/i,
  },
  {
    rule_id: 'INJ_SYSTEM_ROLE_HIJACK',
    severity: 'high',
    description_tr:
      'Sahte sistem rolü veya geliştirici talimatı başlığı ("[SYSTEM]", "SYSTEM PROMPT:") tespit edildi.',
    regex:
      /(?:\[SYSTEM\s*INSTRUCTION\]|\[SYSTEM\]|SYSTEM\s*PROMPT\s*:|YENİ\s*SİSTEM\s*TALİMATI\s*:|DEVELOPER\s*OVERRIDE\s*:)/i,
  },
  {
    rule_id: 'INJ_FAKE_JSON_OUTPUT',
    severity: 'critical',
    source_override: 'json_spoof',
    description_tr:
      'Sayfa metni içine analiz şemasını taklit eden sahte JSON çıktısı enjekte edilmiş.',
    regex:
      /\{\s*"findings"\s*:\s*\[[\s\S]*?\]\s*,\s*"document_type"\s*:\s*"(?:terms_of_service|privacy_policy|subscription_terms|mixed|unknown)"/i,
  },
];

/**
 * Verilen düz metin içinde prompt injection kalıplarını tarar.
 */
export function detectTextInjections(
  text: string,
  defaultSource: InjectionSource = 'visible_text'
): InjectionAlert[] {
  const alerts: InjectionAlert[] = [];
  if (!text || !text.trim()) return alerts;

  for (const pattern of INJECTION_PATTERNS) {
    const match = pattern.regex.exec(text);
    if (match) {
      alerts.push({
        rule_id: pattern.rule_id,
        severity: pattern.severity,
        source: pattern.source_override ?? defaultSource,
        description_tr: pattern.description_tr,
        matched_snippet: match[0].slice(0, 140),
      });
    }
  }

  return alerts;
}

/**
 * Bir CSS inline style dizgesinin elementi gizleyip gizlemediğini veya
 * beyaz üstüne beyaz (görünmez kontrast) metin olup olmadığını kontrol eder.
 */
export function isSuspiciousHiddenStyle(
  styleAttr: string
): { hidden: boolean; reason_tr?: string } {
  const s = styleAttr.toLowerCase().replace(/\s+/g, '');

  if (s.includes('display:none')) {
    return {
      hidden: true,
      reason_tr: 'Gizli DOM katmanı (display:none) içinde metin tespit edildi.',
    };
  }
  if (s.includes('visibility:hidden')) {
    return {
      hidden: true,
      reason_tr:
        'Gizli DOM katmanı (visibility:hidden) içinde metin tespit edildi.',
    };
  }
  if (/opacity:0(?:[;"]|$|\.0+(?:[;"]|$))/.test(s)) {
    return {
      hidden: true,
      reason_tr: 'Görünmez opaklıkta (opacity:0) metin tespit edildi.',
    };
  }
  if (/font-size:0(?:px|pt|em|rem|%)?(?:[;"]|$)/.test(s)) {
    return {
      hidden: true,
      reason_tr: 'Sıfır punto (font-size:0) ile gizlenmiş metin tespit edildi.',
    };
  }

  // White-on-white or near-white text detection
  const hasWhiteText =
    /color:(?:#fff(?:fff)?|white|rgb\(25[0-5],25[0-5],25[0-5]\))/.test(s);
  const hasWhiteBg =
    /background(?:-color)?:(?:#fff(?:fff)?|white|rgb\(25[0-5],25[0-5],25[0-5]\))/.test(
      s
    );
  if (hasWhiteText && (hasWhiteBg || !s.includes('background'))) {
    return {
      hidden: true,
      reason_tr:
        'Beyaz zemin üzerine beyaz metin (görünmez kontrast) ile gizlenmiş içerik tespit edildi.',
    };
  }

  // Off-screen positioning
  if (/left:-\d{4,}px|top:-\d{4,}px|text-indent:-\d{4,}px/.test(s)) {
    return {
      hidden: true,
      reason_tr: 'Ekran dışına taşınmış gizli DOM metni tespit edildi.',
    };
  }

  return { hidden: false };
}

export interface HtmlSecurityScanResult {
  sanitized_visible_text: string;
  alerts: InjectionAlert[];
}

/**
 * Ham HTML dizgesini tarayarak:
 * 1. HTML yorumlarını (<!-- ... -->) yakalar, içlerinde enjeksiyon varsa uyarı üretir ve metinden temizler.
 * 2. aria-label / data-* niteliklerindeki gizli talimatları yakalar ve metne karışmasını önler.
 * 3. display:none, beyaz üstüne beyaz metin, opacity:0 gibi gizli DOM bloklarını yakalar, uyarı üretir ve temizler.
 * 4. Kalan görünür metni çıkarır ve görünür metin içindeki enjeksiyon / sahte JSON kalıplarını raporlar.
 */
export function scanHtmlAndExtractSafeText(html: string): HtmlSecurityScanResult {
  const alerts: InjectionAlert[] = [];
  const seenKeys = new Set<string>();

  const pushAlert = (alert: InjectionAlert) => {
    const key = `${alert.rule_id}:${alert.source}:${alert.matched_snippet}`;
    if (!seenKeys.has(key)) {
      seenKeys.add(key);
      alerts.push(alert);
    }
  };

  let workingHtml = html;

  // 1. Check HTML comments: <!-- ... -->
  const commentRegex = /<!--([\s\S]*?)-->/g;
  let commentMatch: RegExpExecArray | null;
  while ((commentMatch = commentRegex.exec(workingHtml)) !== null) {
    const commentBody = commentMatch[1].trim();
    if (!commentBody) continue;
    const commentAlerts = detectTextInjections(commentBody, 'html_comment');
    if (commentAlerts.length > 0) {
      for (const a of commentAlerts) {
        pushAlert({
          ...a,
          source: 'html_comment',
          description_tr: `HTML yorumu içinde prompt injection girişimi: ${a.description_tr}`,
        });
      }
    }
  }
  // Remove all HTML comments
  workingHtml = workingHtml.replace(commentRegex, '');

  // Remove script, style, noscript, svg, head tags completely
  workingHtml = workingHtml
    .replace(/<(script|style|noscript|svg|head)\b[^>]*>[\s\S]*?<\/\1>/gi, '')
    .replace(/<!--[\s\S]*?-->/g, '');

  // 2. Check aria-label / aria-description / title attributes for prompt injection
  const attrRegex =
    /\b(aria-label|aria-description|data-prompt|data-instruction|title)\s*=\s*(?:"([^"]*)"|'([^']*)')/gi;
  let attrMatch: RegExpExecArray | null;
  while ((attrMatch = attrRegex.exec(workingHtml)) !== null) {
    const attrName = attrMatch[1];
    const attrValue = (attrMatch[2] ?? attrMatch[3] ?? '').trim();
    if (!attrValue) continue;
    const attrAlerts = detectTextInjections(attrValue, 'aria_attribute');
    if (attrAlerts.length > 0) {
      for (const a of attrAlerts) {
        pushAlert({
          ...a,
          source: 'aria_attribute',
          description_tr: `${attrName} niteliği içinde gizli talimat enjeksiyonu: ${a.description_tr}`,
        });
      }
    }
  }

  // 3. Detect & strip hidden elements: match tags that explicitly carry style= or hidden attributes
  const elementRegex =
    /<([a-zA-Z0-9]+)\b([^>]*?\b(?:style\s*=|hidden\b)[^>]*?)>([\s\S]*?)<\/\1>/gi;

  const stripHiddenElements = (inputHtml: string): string => {
    return inputHtml.replace(
      elementRegex,
      (_fullMatch, tag: string, attrs: string, innerHtml: string) => {
        const styleMatch = /\bstyle\s*=\s*(?:"([^"]*)"|'([^']*)')/i.exec(attrs);
        const hasHiddenAttr = /\bhidden\b/i.test(attrs);
        const styleCheck = styleMatch
          ? isSuspiciousHiddenStyle(styleMatch[1] ?? styleMatch[2] ?? '')
          : { hidden: false };

        if (hasHiddenAttr || styleCheck.hidden) {
          const plainInner = innerHtml
            .replace(/<[^>]+>/g, ' ')
            .replace(/\s+/g, ' ')
            .trim();
          if (plainInner.length > 0) {
            const innerAlerts = detectTextInjections(plainInner, 'hidden_dom');
            if (innerAlerts.length > 0) {
              for (const a of innerAlerts) {
                pushAlert({
                  ...a,
                  source: 'hidden_dom',
                  description_tr: `${styleCheck.reason_tr ?? 'Gizli HTML elementi içinde metin tespit edildi.'} (${a.description_tr})`,
                });
              }
            } else if (plainInner.length > 15) {
              pushAlert({
                rule_id: 'INJ_HIDDEN_DOM_TEXT',
                severity: 'high',
                source: 'hidden_dom',
                description_tr:
                  styleCheck.reason_tr ??
                  'Gizli HTML elementi (hidden) içinde kullanıcıdan saklanan metin tespit edildi ve analiz metninden çıkarıldı.',
                matched_snippet: plainInner.slice(0, 140),
              });
            }
          }
          return ''; // Strip hidden element from visible text pipeline!
        }

        // Parent element is visible; recursively inspect its children
        const cleanedInner = stripHiddenElements(innerHtml);
        return `<${tag}${attrs}>${cleanedInner}</${tag}>`;
      }
    );
  };

  workingHtml = stripHiddenElements(workingHtml);

  // Convert block tags to paragraph breaks so segmenter preserves clause boundaries
  const blockTagRegex =
    /<\/?(?:p|div|section|article|li|h[1-6]|tr|blockquote|header|footer|main|details|summary|br)\b[^>]*>/gi;
  const textWithBreaks = workingHtml
    .replace(blockTagRegex, '\n\n')
    .replace(/<[^>]+>/g, ' ')
    .replace(/&nbsp;/gi, ' ')
    .replace(/&amp;/gi, '&')
    .replace(/&lt;/gi, '<')
    .replace(/&gt;/gi, '>')
    .replace(/&quot;/gi, '"')
    .replace(/&#39;/gi, "'");

  const sanitized_visible_text = textWithBreaks
    .replace(/[ \t]+/g, ' ')
    .replace(/\n\s*\n+/g, '\n\n')
    .trim();

  // 4. Scan remaining visible text for in-band prompt injections and JSON spoofing
  const visibleAlerts = detectTextInjections(
    sanitized_visible_text,
    'visible_text'
  );
  for (const a of visibleAlerts) {
    pushAlert(a);
  }

  return {
    sanitized_visible_text,
    alerts,
  };
}
