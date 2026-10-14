import {
  scanHtmlAndExtractSafeText,
  normalizeQuoteOnly,
  type ValidatedFinding,
} from '../../core/index';
import { runNarrowDomPreparation } from './page-agent-helper';

const HIGHLIGHT_CLASS = 'tos-risk-highlight';
const ACTIVE_HIGHLIGHT_CLASS = 'tos-risk-highlight-active';
const STYLE_ID = 'tos-risk-analyzer-styles';

function ensureHighlightStyles(): void {
  if (document.getElementById(STYLE_ID)) return;
  const style = document.createElement('style');
  style.id = STYLE_ID;
  style.textContent = `
    mark.${HIGHLIGHT_CLASS} {
      background-color: #fef08a !important;
      color: #713f12 !important;
      padding: 2px 4px !important;
      border-radius: 4px !important;
      border-bottom: 2px solid #eab308 !important;
      cursor: pointer !important;
      transition: all 0.25s ease !important;
      font-weight: 500 !important;
    }
    mark.${HIGHLIGHT_CLASS}[data-severity="critical"],
    mark.${HIGHLIGHT_CLASS}[data-severity="high"] {
      background-color: #fecaca !important;
      color: #7f1d1d !important;
      border-bottom-color: #ef4444 !important;
    }
    mark.${HIGHLIGHT_CLASS}.${ACTIVE_HIGHLIGHT_CLASS} {
      outline: 3px solid #dc2626 !important;
      box-shadow: 0 0 0 6px rgba(220, 38, 38, 0.25) !important;
    }
  `;
  document.head.appendChild(style);
}

export function clearHighlights(): void {
  const marks = Array.from(document.querySelectorAll(`mark.${HIGHLIGHT_CLASS}`));
  for (const mark of marks) {
    const parent = mark.parentNode;
    if (!parent) continue;
    while (mark.firstChild) {
      parent.insertBefore(mark.firstChild, mark);
    }
    parent.removeChild(mark);
    parent.normalize();
  }
}

/**
 * Doğrulanmış bulguların alıntılarını (quote) ve karakter offsetlerini kullanarak
 * orijinal sayfa DOM'unda vurgular (<mark class="tos-risk-highlight">).
 */
export function highlightFindingsInDom(findings: ValidatedFinding[]): number {
  ensureHighlightStyles();
  clearHighlights();

  let highlightedCount = 0;

  for (let idx = 0; idx < findings.length; idx++) {
    const finding = findings[idx];
    const targetNorm = normalizeQuoteOnly(finding.quote);
    if (!targetNorm) continue;

    const walker = document.createTreeWalker(
      document.body,
      NodeFilter.SHOW_TEXT,
      {
        acceptNode(node) {
          const parent = node.parentElement;
          if (!parent) return NodeFilter.FILTER_REJECT;
          const tag = parent.tagName.toLowerCase();
          if (
            tag === 'script' ||
            tag === 'style' ||
            tag === 'noscript' ||
            parent.classList.contains(HIGHLIGHT_CLASS)
          ) {
            return NodeFilter.FILTER_REJECT;
          }
          const style = window.getComputedStyle(parent);
          if (style.display === 'none' || style.visibility === 'hidden') {
            return NodeFilter.FILTER_REJECT;
          }
          return NodeFilter.FILTER_ACCEPT;
        },
      }
    );

    let currentNode: Node | null;
    let matched = false;

    while ((currentNode = walker.nextNode()) !== null) {
      const textNode = currentNode as Text;
      const nodeVal = textNode.nodeValue || '';
      const rawIdx = nodeVal.indexOf(finding.quote);

      let matchStart = -1;
      let matchEnd = -1;

      if (rawIdx !== -1) {
        matchStart = rawIdx;
        matchEnd = rawIdx + finding.quote.length;
      } else {
        // Check normalized whitespace match within text node
        const escapedWords = targetNorm
          .split(' ')
          .filter(Boolean)
          .map((w) => w.replace(/[.*+?^${}()|[\]\\]/g, '\\$&'));
        if (escapedWords.length > 0) {
          const flexRegex = new RegExp(escapedWords.join('\\s+'));
          const m = flexRegex.exec(nodeVal);
          if (m) {
            matchStart = m.index;
            matchEnd = m.index + m[0].length;
          }
        }
      }

      if (matchStart !== -1 && matchEnd > matchStart) {
        const range = document.createRange();
        range.setStart(textNode, matchStart);
        range.setEnd(textNode, matchEnd);

        const mark = document.createElement('mark');
        mark.className = HIGHLIGHT_CLASS;
        mark.setAttribute('data-finding-idx', String(idx));
        mark.setAttribute('data-clause-id', finding.clause_id);
        mark.setAttribute('data-severity', finding.severity);
        mark.setAttribute('data-offset-start', String(finding.match_start_offset));
        mark.setAttribute('data-offset-end', String(finding.match_end_offset));
        mark.title = `[${finding.clause_id}] ${finding.explanation_tr}`;

        range.surroundContents(mark);
        highlightedCount++;
        matched = true;
        break;
      }
    }

    if (!matched) {
      // Fallback: highlight paragraph containing the quote if split across inline tags
      const blocks = Array.from(document.querySelectorAll('p, li, div.clause-block'));
      for (const block of blocks) {
        if (normalizeQuoteOnly(block.textContent || '').includes(targetNorm)) {
          const mark = document.createElement('mark');
          mark.className = HIGHLIGHT_CLASS;
          mark.setAttribute('data-finding-idx', String(idx));
          mark.setAttribute('data-clause-id', finding.clause_id);
          mark.setAttribute('data-severity', finding.severity);
          mark.setAttribute('data-offset-start', String(finding.match_start_offset));
          mark.setAttribute('data-offset-end', String(finding.match_end_offset));
          while (block.firstChild) {
            mark.appendChild(block.firstChild);
          }
          block.appendChild(mark);
          highlightedCount++;
          break;
        }
      }
    }
  }

  return highlightedCount;
}

export function scrollToFindingInDom(findingIdx: number, clauseId?: string): boolean {
  const allMarks = Array.from(document.querySelectorAll(`mark.${HIGHLIGHT_CLASS}`));
  for (const m of allMarks) {
    m.classList.remove(ACTIVE_HIGHLIGHT_CLASS);
  }

  let target = document.querySelector(
    `mark.${HIGHLIGHT_CLASS}[data-finding-idx="${findingIdx}"]`
  );
  if (!target && clauseId) {
    target = document.querySelector(
      `mark.${HIGHLIGHT_CLASS}[data-clause-id="${clauseId}"]`
    );
  }

  if (target instanceof HTMLElement) {
    target.classList.add(ACTIVE_HIGHLIGHT_CLASS);
    target.scrollIntoView({ behavior: 'smooth', block: 'center' });
    return true;
  }
  return false;
}

export async function extractCurrentPagePayload(expandFirst = true) {
  let prep = {
    expandedCount: 0,
    discoveredTosLinks: [] as Array<{ text: string; href: string }>,
    simplifiedDomPreview: '',
    usedLlmAgent: false,
  };

  if (expandFirst) {
    prep = await runNarrowDomPreparation();
  }

  const rawHtml = document.body ? document.body.innerHTML : '';
  const scan = scanHtmlAndExtractSafeText(rawHtml);

  return {
    url: window.location.href,
    title: document.title || 'Adsız Sayfa',
    rawText: scan.sanitized_visible_text,
    alerts: scan.alerts,
    expandedCount: prep.expandedCount,
    discoveredTosLinks: prep.discoveredTosLinks,
    simplifiedDomPreview: prep.simplifiedDomPreview,
  };
}

// Chrome runtime message listener
if (typeof chrome !== 'undefined' && chrome.runtime && chrome.runtime.onMessage) {
  chrome.runtime.onMessage.addListener((message, _sender, sendResponse) => {
    if (message?.type === 'EXTRACT_PAGE') {
      extractCurrentPagePayload(message.expandFirst ?? true)
        .then((payload) => sendResponse({ ok: true, payload }))
        .catch((err) => sendResponse({ ok: false, error: String(err) }));
      return true;
    }

    if (message?.type === 'HIGHLIGHT_FINDINGS') {
      const count = highlightFindingsInDom(message.findings || []);
      sendResponse({ ok: true, highlightedCount: count });
      return false;
    }

    if (message?.type === 'SCROLL_TO_FINDING') {
      const scrolled = scrollToFindingInDom(
        message.findingIdx,
        message.clauseId
      );
      sendResponse({ ok: scrolled });
      return false;
    }

    if (message?.type === 'RUN_PAGE_AGENT_PREP') {
      runNarrowDomPreparation(message.options)
        .then((res) => sendResponse({ ok: true, result: res }))
        .catch((err) => sendResponse({ ok: false, error: String(err) }));
      return true;
    }

    return false;
  });
}

// Expose window helper for local Cypress E2E deterministic verification
declare global {
  interface Window {
    __TOS_ANALYZER_CONTENT__?: {
      extractCurrentPagePayload: typeof extractCurrentPagePayload;
      highlightFindingsInDom: typeof highlightFindingsInDom;
      scrollToFindingInDom: typeof scrollToFindingInDom;
      runNarrowDomPreparation: typeof runNarrowDomPreparation;
    };
  }
}

if (typeof window !== 'undefined') {
  window.__TOS_ANALYZER_CONTENT__ = {
    extractCurrentPagePayload,
    highlightFindingsInDom,
    scrollToFindingInDom,
    runNarrowDomPreparation,
  };
}
