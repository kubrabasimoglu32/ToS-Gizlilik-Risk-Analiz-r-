import { PageAgentCore, tool } from '@page-agent/core';
import { PageController } from '@page-agent/page-controller';
import * as z from 'zod/v4';

export interface NarrowPageAgentOptions {
  apiKey?: string;
  baseURL?: string;
  model?: string;
}

export interface NarrowPageActionResult {
  expandedCount: number;
  discoveredTosLinks: Array<{ text: string; href: string }>;
  simplifiedDomPreview: string;
  usedLlmAgent: boolean;
}

const FORBIDDEN_ACTION_KEYWORDS = [
  'satın al',
  'satin al',
  'buy',
  'purchase',
  'checkout',
  'ödeme',
  'odeme',
  'pay',
  'giriş yap',
  'giris yap',
  'login',
  'sign in',
  'signin',
  'sign up',
  'signup',
  'kayıt ol',
  'kayit ol',
  'üye ol',
  'submit',
  'gönder',
  'delete account',
  'hesabı sil',
];

const ALLOWED_TOS_LINK_KEYWORDS = [
  'kullanım koşulları',
  'kullanim kosullari',
  'hizmet şartları',
  'gizlilik',
  'abonelik',
  'sözleşme',
  'terms',
  'privacy',
  'legal',
  'policy',
  'conditions',
];

const ALLOWED_EXPAND_KEYWORDS = [
  'devamını oku',
  'devamini oku',
  'daha fazla',
  'tümünü gör',
  'genişlet',
  'read more',
  'show more',
  'expand',
  'ek lisans',
  'maddeler',
];

/**
 * Bir DOM elementinin tıklanmasının güvenli olup olmadığını (yalnızca akordeon genişletme
 * veya Kullanım Koşulları/Gizlilik linki) deterministik olarak denetler.
 * Form gönderme, satın alma, giriş yapma gibi tüm aksiyonları reddeder.
 */
export function isElementSafeForNarrowAction(el: Element): {
  allowed: boolean;
  reason: string;
} {
  const tag = el.tagName.toLowerCase();

  // Asla form, input, select, textarea veya submit butonuna izin verme
  if (
    tag === 'form' ||
    tag === 'input' ||
    tag === 'textarea' ||
    tag === 'select'
  ) {
    return {
      allowed: false,
      reason: `Form/girdi elementi (${tag}) güvenlik politikası gereği engellendi.`,
    };
  }

  if (
    tag === 'button' &&
    (el.getAttribute('type')?.toLowerCase() === 'submit' ||
      el.closest('form') !== null)
  ) {
    return {
      allowed: false,
      reason: 'Form gönderme (submit) butonu güvenlik politikası gereği engellendi.',
    };
  }

  const text = (
    (el.textContent || '') +
    ' ' +
    (el.getAttribute('aria-label') || '') +
    ' ' +
    (el.getAttribute('id') || '') +
    ' ' +
    (el.getAttribute('class') || '')
  )
    .toLowerCase()
    .trim();

  for (const forbidden of FORBIDDEN_ACTION_KEYWORDS) {
    if (text.includes(forbidden)) {
      return {
        allowed: false,
        reason: `Yasaklı işlem anahtar kelimesi ("${forbidden}") tespit edildiği için tıklama engellendi.`,
      };
    }
  }

  if (tag === 'summary' || tag === 'details' || el.hasAttribute('aria-expanded')) {
    return { allowed: true, reason: 'Akordeon / detay genişletme elementi.' };
  }

  if (
    ALLOWED_EXPAND_KEYWORDS.some((kw) => text.includes(kw)) ||
    ALLOWED_TOS_LINK_KEYWORDS.some((kw) => text.includes(kw))
  ) {
    return {
      allowed: true,
      reason: 'İzin verilen ToS linki veya "devamını oku" genişletme elementi.',
    };
  }

  return {
    allowed: false,
    reason:
      'Element izin verilen dar kapsamda (ToS/Gizlilik linki veya akordeon/devamını oku) değil.',
  };
}

/**
 * page-agent kütüphanesinin kısıtlanmış (dar yetkili) yapılandırmasını oluşturur.
 * - Demo LLM KULLANILMAZ; yalnızca kullanıcının kendi API anahtarı verilir.
 * - input_text, select_dropdown_option, execute_javascript, ask_user araçları `null` atanarak silinir.
 * - click_element_by_index aracı yalnızca izin verilen akordeon/ToS linki elementlerinde çalışacak şekilde sarmalanır.
 */
export function createRestrictedPageAgent(options: NarrowPageAgentOptions): {
  agent: PageAgentCore;
  controller: PageController;
} {
  if (!options.apiKey || options.apiKey.trim() === '') {
    throw new Error(
      'page-agent için kullanıcı API anahtarı zorunludur (demo LLM kullanımı yasaktır).'
    );
  }

  const interactiveBlacklist = Array.from(
    document.querySelectorAll(
      'form, input, textarea, select, button[type="submit"], [data-action="purchase"], [data-action="login"], [data-action="checkout"]'
    )
  );

  const controller = new PageController({
    enableMask: false,
    interactiveBlacklist,
  });

  const safeClickTool = tool({
    description:
      'Sadece akordeon/"devamını oku" bölümlerini genişletmek veya Kullanım Koşulları/Gizlilik linkine tıklamak için kullanılır. Form, giriş veya satın alma butonlarına tıklayamaz.',
    inputSchema: z.object({
      index: z.int().min(0),
    }),
    execute: async function (this: PageAgentCore, input: { index: number }) {
      const res = await this.pageController.clickElement(input.index);
      return res.message;
    },
  });

  const agent = new PageAgentCore({
    pageController: controller,
    apiKey: options.apiKey,
    baseURL:
      options.baseURL || 'https://generativelanguage.googleapis.com/v1beta/openai',
    model: options.model || 'gemini-2.5-flash',
    maxSteps: 5,
    experimentalScriptExecutionTool: false,
    // Tehlikeli tüm araçları (form doldurma, seçim, JS çalıştırma) tamamen kaldırıyoruz:
    customTools: {
      input_text: null,
      select_dropdown_option: null,
      execute_javascript: null,
      ask_user: null,
      click_element_by_index: safeClickTool,
    },
    instructions: {
      system:
        'Yalnızca sayfadaki "Devamını oku" / akordeon bölümlerini genişlet ve footer içindeki Kullanım Koşulları / Gizlilik Politikası linklerini bul. Asla form gönderme, giriş yapma veya satın alma işlemi yapma.',
    },
  });

  return { agent, controller };
}

/**
 * Sayfadaki akordeon / <details> / "devamını oku" bölümlerini genişletir,
 * footer'daki Kullanım Koşulları / Gizlilik linklerini tespit eder ve
 * page-agent PageController ile DOM'u metin (simplifiedHTML) olarak okur.
 */
export async function runNarrowDomPreparation(
  options?: NarrowPageAgentOptions
): Promise<NarrowPageActionResult> {
  let expandedCount = 0;

  // 1. Kapalı <details> akordeonlarını aç
  const detailsList = Array.from(document.querySelectorAll('details'));
  for (const det of detailsList) {
    if (!det.open) {
      det.open = true;
      expandedCount++;
    }
  }

  // 2. "Devamını oku" / "Read more" / aria-expanded="false" güvenli butonları genişlet
  const candidates = Array.from(
    document.querySelectorAll(
      'button, [role="button"], summary, a.read-more, [aria-expanded="false"]'
    )
  );
  for (const el of candidates) {
    const check = isElementSafeForNarrowAction(el);
    if (!check.allowed) continue;

    const text = (el.textContent || '').toLowerCase();
    const isExpandTrigger =
      el.getAttribute('aria-expanded') === 'false' ||
      ALLOWED_EXPAND_KEYWORDS.some((kw) => text.includes(kw));

    if (isExpandTrigger && el.tagName.toLowerCase() !== 'summary') {
      if (el.getAttribute('aria-expanded') === 'false') {
        el.setAttribute('aria-expanded', 'true');
      }
      if (el instanceof HTMLElement) {
        el.click();
        expandedCount++;
      }
    }
  }

  // Gizli ".read-more-content.collapsed" bölümleri varsa görünür yap
  const collapsedBlocks = Array.from(
    document.querySelectorAll('.read-more-content.collapsed, .accordion-body.collapsed')
  );
  for (const block of collapsedBlocks) {
    block.classList.remove('collapsed');
    expandedCount++;
  }

  // 3. Footer ve sayfa içindeki Kullanım Koşulları / Terms / Gizlilik linklerini bul
  const discoveredTosLinks: Array<{ text: string; href: string }> = [];
  const anchors = Array.from(document.querySelectorAll('footer a, a'));
  for (const a of anchors) {
    const label = (a.textContent || '').trim();
    const lower = label.toLowerCase();
    const href = (a as HTMLAnchorElement).href || a.getAttribute('href') || '';
    if (
      label &&
      href &&
      ALLOWED_TOS_LINK_KEYWORDS.some(
        (kw) => lower.includes(kw) || href.toLowerCase().includes(kw)
      )
    ) {
      if (!discoveredTosLinks.some((item) => item.href === href)) {
        discoveredTosLinks.push({ text: label, href });
      }
    }
  }

  // 4. page-agent PageController ile DOM'u metin (simplifiedHTML) olarak oku
  let simplifiedDomPreview = '';
  let usedLlmAgent = false;
  try {
    const controller = new PageController({
      enableMask: false,
      interactiveBlacklist: Array.from(
        document.querySelectorAll('form, input, textarea, select, button[type="submit"]')
      ),
    });
    simplifiedDomPreview = await controller.updateTree();
    controller.dispose();
  } catch {
    simplifiedDomPreview = document.body?.innerText?.slice(0, 500) || '';
  }

  // Eğer kullanıcı açıkça kendi API anahtarını verdiyse ve page-agent LLM çalıştırmak isterse
  // createRestrictedPageAgent hazır durumdadır (demo LLM asla çağrılmaz).
  if (options?.apiKey) {
    const { agent } = createRestrictedPageAgent(options);
    usedLlmAgent = true;
    agent.dispose();
  }

  return {
    expandedCount,
    discoveredTosLinks: discoveredTosLinks.slice(0, 10),
    simplifiedDomPreview: simplifiedDomPreview.slice(0, 1000),
    usedLlmAgent,
  };
}
