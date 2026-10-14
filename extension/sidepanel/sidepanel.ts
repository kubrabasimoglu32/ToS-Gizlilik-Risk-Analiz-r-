import {
  CATEGORY_LABELS_TR,
  CATEGORY_SEVERITY_WEIGHTS,
  SEVERITY_LABELS_TR,
  scanHtmlAndExtractSafeText,
  normalizeQuoteOnly,
  type RiskReport,
  type RiskSeverity,
  type ValidatedFinding,
} from '../../core/index';
import { handleAnalyzePayload } from '../background/background';
import {
  highlightFindingsInDom,
  scrollToFindingInDom,
} from '../content/content';

const SEVERITY_RANK: Record<RiskSeverity, number> = {
  critical: 4,
  high: 3,
  medium: 2,
  low: 1,
};

function escapeHtml(str: string): string {
  return str
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#39;');
}

function limitToTwoSentences(text: string): string {
  const sentences = text
    .trim()
    .split(/(?<=[.!?])\s+/)
    .filter(Boolean);
  return sentences.slice(0, 2).join(' ');
}

function formatShortExplanation(text: string): string {
  const firstSentence = text.trim().split(/(?<=[.!?])\s+/)[0] || text.trim();
  const words = firstSentence.split(/\s+/).filter(Boolean);
  if (words.length <= 20) return firstSentence;
  return words.slice(0, 20).join(' ') + '...';
}

function getFixtureContainer(): HTMLElement | null {
  const el = document.getElementById('fixture-doc-content');
  if (el && el.innerHTML.trim().length > 0) {
    return el;
  }
  return null;
}

/**
 * Sol sütundaki fixture DOM'unda doğrulanmış alıntıları <mark> ile vurgular.
 */
function highlightInContainer(
  container: HTMLElement,
  report: RiskReport
): number {
  for (const old of Array.from(
    container.querySelectorAll('mark.tos-risk-highlight')
  )) {
    const parent = old.parentNode;
    if (!parent) continue;
    while (old.firstChild) parent.insertBefore(old.firstChild, old);
    parent.removeChild(old);
    parent.normalize();
  }

  let count = 0;
  for (let i = 0; i < report.findings.length; i++) {
    const f = report.findings[i];
    const targetNorm = normalizeQuoteOnly(f.quote);
    if (!targetNorm) continue;

    const walker = document.createTreeWalker(container, NodeFilter.SHOW_TEXT);
    let node: Node | null;
    while ((node = walker.nextNode()) !== null) {
      const textNode = node as Text;
      const val = textNode.nodeValue || '';
      const idx = val.indexOf(f.quote);
      if (idx !== -1) {
        const range = document.createRange();
        range.setStart(textNode, idx);
        range.setEnd(textNode, idx + f.quote.length);
        const mark = document.createElement('mark');
        mark.className = 'tos-risk-highlight';
        mark.setAttribute('data-finding-idx', String(i));
        mark.setAttribute('data-clause-id', f.clause_id);
        mark.setAttribute('data-severity', f.severity);
        mark.setAttribute('data-offset-start', String(f.match_start_offset));
        mark.setAttribute('data-offset-end', String(f.match_end_offset));
        range.surroundContents(mark);
        count++;
        break;
      }
    }
  }
  return count;
}

function scrollContainerToFinding(
  container: HTMLElement,
  idx: number
): boolean {
  for (const m of Array.from(
    container.querySelectorAll('mark.tos-risk-highlight')
  )) {
    m.classList.remove('tos-risk-highlight-active');
  }
  const target = container.querySelector(
    `mark.tos-risk-highlight[data-finding-idx="${idx}"]`
  );
  if (target) {
    target.classList.add('tos-risk-highlight-active');
    target.scrollIntoView({ behavior: 'smooth', block: 'center' });
    return true;
  }
  return false;
}

async function triggerScrollToFinding(
  idx: number,
  clauseId: string
): Promise<void> {
  const container = getFixtureContainer();
  if (container) {
    scrollContainerToFinding(container, idx);
  } else {
    scrollToFindingInDom(idx, clauseId);
  }

  if (typeof chrome !== 'undefined' && chrome.tabs?.query) {
    const tabs = await chrome.tabs.query({ active: true, currentWindow: true });
    const tabId = tabs[0]?.id;
    if (tabId) {
      chrome.tabs
        .sendMessage(tabId, {
          type: 'SCROLL_TO_FINDING',
          findingIdx: idx,
          clauseId,
        })
        .catch(() => {});
    }
  }
}

interface RankedFinding {
  finding: ValidatedFinding;
  originalIdx: number;
  weight: number;
  severityRank: number;
}

function renderFindingCardHtml(item: RankedFinding): string {
  const { finding: f, originalIdx } = item;
  const catLabel = CATEGORY_LABELS_TR[f.category] || f.category;
  const sevLabel = SEVERITY_LABELS_TR[f.severity] || f.severity;
  const shortExp = formatShortExplanation(f.explanation_tr);

  return `
    <div class="finding-card"
         data-testid="finding-item"
         data-finding-idx="${originalIdx}"
         data-clause-id="${escapeHtml(f.clause_id)}"
         data-severity="${escapeHtml(f.severity)}">
      <div class="finding-card-top">
        <span class="category-label">${escapeHtml(catLabel)}</span>
        <span class="sev-badge sev-${escapeHtml(f.severity)}">${escapeHtml(sevLabel)}</span>
      </div>
      <p class="finding-short-explanation" data-testid="finding-explanation">${escapeHtml(shortExp)}</p>
      <button type="button" class="btn-ghost" data-testid="toggle-quote-btn">Alıntıyı göster</button>
      <div class="quote-drawer" data-testid="quote-drawer" hidden>
        <p class="quote-text" data-testid="finding-quote">"${escapeHtml(f.quote)}"</p>
        <button type="button"
                class="btn-ghost"
                data-testid="show-in-page-btn"
                data-finding-idx="${originalIdx}"
                data-clause-id="${escapeHtml(f.clause_id)}">Sayfada göster</button>
      </div>
    </div>
  `;
}

export function renderRiskReport(report: RiskReport): void {
  const root = document.getElementById('report-root');
  const footerMeta = document.getElementById('footer-meta-container');
  if (!root) return;

  const { score, findings, dropped_count, injection_alerts } = report;

  let html = '';

  // 1 & 6. Üst Alan
  if (score.is_uncertain) {
    const singleReason =
      score.uncertainty_reasons_tr[0] ||
      'Sayfa metni analiz için yeterli veya güvenilir değil.';
    html += `
      <div class="uncertain-banner" id="uncertainty-alert-box" data-testid="uncertainty-alert-box">
        <strong data-testid="risk-level-label">Emin değilim</strong>
        <p class="uncertain-reason-line" data-testid="uncertainty-reason-line">${escapeHtml(singleReason)}</p>
      </div>
    `;
  } else {
    const badgeInfo =
      score.risk_score >= 45
        ? { label: 'Yüksek', cls: 'level-yuksek' }
        : score.risk_score >= 20
          ? { label: 'Orta', cls: 'level-orta' }
          : { label: 'Düşük', cls: 'level-dusuk' };

    const twoSentenceSummary = limitToTwoSentences(
      report.overall_notes || 'Sözleşme maddeleri analiz edildi.'
    );

    html += `
      <div class="score-hero-card" id="score-card" data-testid="score-card">
        <div class="score-top-row">
          <div class="score-big-number" id="risk-score-value" data-testid="risk-score-value" data-numeric-score="${score.risk_score}">${score.risk_score}<span class="out-of">/100</span></div>
          <span class="level-badge ${badgeInfo.cls}" id="risk-level-label" data-testid="risk-level-label">${badgeInfo.label}</span>
        </div>
        <p class="summary-text" data-testid="overall-summary">${escapeHtml(twoSentenceSummary)}</p>
      </div>
    `;
  }

  // 2. Bulguları severity ve ağırlığa göre sırala
  const ranked: RankedFinding[] = findings
    .map((finding, originalIdx) => ({
      finding,
      originalIdx,
      weight: CATEGORY_SEVERITY_WEIGHTS[finding.category][finding.severity],
      severityRank: SEVERITY_RANK[finding.severity],
    }))
    .sort((a, b) => {
      if (b.severityRank !== a.severityRank) {
        return b.severityRank - a.severityRank;
      }
      return b.weight - a.weight;
    });

  const topFive = ranked.slice(0, 5);
  const remaining = ranked.slice(5);

  if (topFive.length > 0) {
    html += `<div class="findings-stack" id="findings-list" data-testid="findings-list">`;
    html += topFive.map(renderFindingCardHtml).join('');
    html += `</div>`;
  }

  // 4. Kalan bulgular "Diğer N madde" başlığı altında varsayılan KAPALI katlanır liste
  if (remaining.length > 0) {
    html += `
      <details class="other-findings-collapse" data-testid="remaining-findings-details">
        <summary data-testid="remaining-findings-summary">Diğer ${remaining.length} madde</summary>
        <div class="findings-stack">
          ${remaining.map(renderFindingCardHtml).join('')}
        </div>
      </details>
    `;
  }

  root.innerHTML = html;

  // 5. En altta küçük, sönük yazıyla: atılan doğrulanamayan bulgu sayısı ve varsa prompt injection uyarısı
  if (footerMeta) {
    let footerHtml = `
      <div class="footer-meta-line" id="dropped-findings-box" data-testid="dropped-findings-box">
        Doğrulanamadığı için atılan bulgu: <span id="dropped-count-value" data-testid="dropped-count-value">${dropped_count}</span>
      </div>
    `;
    if (injection_alerts.length > 0) {
      const ruleNames = injection_alerts.map((a) => a.rule_id).join(', ');
      footerHtml += `
        <div class="footer-injection-line" id="injection-alert-box" data-testid="injection-alert-box">
          Prompt injection uyarısı (${injection_alerts.length}): ${escapeHtml(ruleNames)}
        </div>
      `;
    }
    footerMeta.innerHTML = footerHtml;
  }

  // 3. "Alıntıyı göster" ve "Sayfada göster" düğmesi etkileşimleri
  const cards = Array.from(root.querySelectorAll('.finding-card'));
  for (const card of cards) {
    const toggleBtn = card.querySelector(
      '[data-testid="toggle-quote-btn"]'
    ) as HTMLButtonElement | null;
    const drawer = card.querySelector(
      '[data-testid="quote-drawer"]'
    ) as HTMLElement | null;
    const showInPageBtn = card.querySelector(
      '[data-testid="show-in-page-btn"]'
    ) as HTMLButtonElement | null;

    if (toggleBtn && drawer) {
      toggleBtn.addEventListener('click', () => {
        const isHidden = drawer.hasAttribute('hidden');
        if (isHidden) {
          drawer.removeAttribute('hidden');
          toggleBtn.textContent = 'Alıntıyı gizle';
        } else {
          drawer.setAttribute('hidden', '');
          toggleBtn.textContent = 'Alıntıyı göster';
        }
      });
    }

    if (showInPageBtn) {
      showInPageBtn.addEventListener('click', () => {
        const idx = Number(
          showInPageBtn.getAttribute('data-finding-idx') || '0'
        );
        const clauseId = showInPageBtn.getAttribute('data-clause-id') || '';
        triggerScrollToFinding(idx, clauseId);
      });
    }
  }
}

async function runPageAnalysis(): Promise<void> {
  const root = document.getElementById('report-root');
  if (root) {
    root.innerHTML = `<div class="score-hero-card" id="loading-state"><p class="summary-text">Analiz ediliyor...</p></div>`;
  }

  const container = getFixtureContainer();
  if (container) {
    for (const det of Array.from(container.querySelectorAll('details'))) {
      det.open = true;
    }
    const scan = scanHtmlAndExtractSafeText(container.innerHTML);
    const report = await handleAnalyzePayload({
      url: window.location.href,
      title: document.title || 'Fixture Sayfası',
      rawText: scan.sanitized_visible_text,
      alerts: scan.alerts,
      forceMock: true,
    });
    highlightInContainer(container, report);
    renderRiskReport(report);
    return;
  }

  if (typeof chrome !== 'undefined' && chrome.tabs?.query) {
    const tabs = await chrome.tabs.query({ active: true, currentWindow: true });
    const activeTab = tabs[0];
    if (activeTab?.id) {
      const extractResp = await chrome.tabs
        .sendMessage(activeTab.id, { type: 'EXTRACT_PAGE', expandFirst: true })
        .catch(() => null);

      if (extractResp?.ok && extractResp.payload) {
        const bgResp = await chrome.runtime.sendMessage({
          type: 'ANALYZE_TEXT_PAYLOAD',
          payload: extractResp.payload,
        });
        if (bgResp?.ok && bgResp.report) {
          const report: RiskReport = bgResp.report;
          await chrome.tabs
            .sendMessage(activeTab.id, {
              type: 'HIGHLIGHT_FINDINGS',
              findings: report.findings,
            })
            .catch(() => {});
          renderRiskReport(report);
          return;
        } else if (bgResp?.error && root) {
          root.innerHTML = `<div class="uncertain-banner"><strong>Hata</strong><p class="uncertain-reason-line">${escapeHtml(bgResp.error)}</p></div>`;
          return;
        }
      }
    }
  }

  const scan = scanHtmlAndExtractSafeText(document.body.innerHTML);
  const report = await handleAnalyzePayload({
    url: window.location.href,
    title: document.title,
    rawText: scan.sanitized_visible_text,
    alerts: scan.alerts,
    forceMock: true,
  });
  highlightFindingsInDom(report.findings);
  renderRiskReport(report);
}

async function runPageAgentAction(): Promise<void> {
  const statusBox = document.getElementById('agent-prep-status');
  if (!statusBox) return;
  statusBox.style.display = 'block';

  const container = getFixtureContainer();
  if (container) {
    let expanded = 0;
    for (const det of Array.from(container.querySelectorAll('details'))) {
      if (!det.open) {
        det.open = true;
        expanded++;
      }
    }
    const links = Array.from(container.querySelectorAll('footer a, a'))
      .map((a) => (a.textContent || '').trim())
      .filter(Boolean);

    statusBox.textContent = `Akordeon açıldı (${expanded}) · Linkler: ${links.join(', ') || 'Yok'}`;
    return;
  }

  if (typeof chrome !== 'undefined' && chrome.tabs?.query) {
    const tabs = await chrome.tabs.query({ active: true, currentWindow: true });
    const tabId = tabs[0]?.id;
    if (tabId) {
      const resp = await chrome.tabs
        .sendMessage(tabId, { type: 'RUN_PAGE_AGENT_PREP' })
        .catch(() => null);
      if (resp?.ok && resp.result) {
        const r = resp.result;
        statusBox.textContent = `Akordeon açıldı (${r.expandedCount}) · Linkler: ${r.discoveredTosLinks.map((l: { text: string }) => l.text).join(', ') || 'Yok'}`;
      }
    }
  }
}

async function loadSplitFixtureHtml(fixturePath: string): Promise<void> {
  const previewPane = document.getElementById('fixture-preview-pane');
  const docContent = document.getElementById('fixture-doc-content');
  const urlBar = document.getElementById('fixture-url-bar');
  if (!previewPane || !docContent) return;

  previewPane.classList.add('active');
  if (urlBar) {
    urlBar.textContent = `https://ornek-site.com.tr${fixturePath}`;
  }

  const res = await fetch(fixturePath);
  const htmlText = await res.text();
  const parser = new DOMParser();
  const parsed = parser.parseFromString(htmlText, 'text/html');
  docContent.innerHTML = parsed.body.innerHTML;
}

declare global {
  interface Window {
    setSceneBanner?: (text: string, done?: boolean) => void;
  }
}

window.setSceneBanner = (text: string, done = false) => {
  const banner = document.getElementById('scene-banner');
  if (!banner) return;
  banner.textContent = text;
  banner.classList.add('active');
  if (done) {
    banner.classList.add('status-done');
  } else {
    banner.classList.remove('status-done');
  }
};

document.addEventListener('DOMContentLoaded', () => {
  const params = new URLSearchParams(window.location.search);
  const splitFixture = params.get('fixture');

  if (splitFixture) {
    loadSplitFixtureHtml(splitFixture);
  }

  document
    .getElementById('analyze-btn')
    ?.addEventListener('click', () => runPageAnalysis());

  document
    .getElementById('page-agent-btn')
    ?.addEventListener('click', () => runPageAgentAction());

  document.getElementById('open-options-btn')?.addEventListener('click', () => {
    if (typeof chrome !== 'undefined' && chrome.runtime?.openOptionsPage) {
      chrome.runtime.openOptionsPage();
    } else {
      window.open('/extension/options/options.html', '_blank');
    }
  });
});
