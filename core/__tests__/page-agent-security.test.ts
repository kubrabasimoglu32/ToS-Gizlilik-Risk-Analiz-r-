// @vitest-environment jsdom
import { describe, it, expect, beforeEach } from 'vitest';
import {
  isElementSafeForNarrowAction,
  createRestrictedPageAgent,
} from '../../extension/content/page-agent-helper';

describe('page-agent security & narrow capability enforcement', () => {
  beforeEach(() => {
    document.body.innerHTML = `
      <main>
        <form id="login-form">
          <input id="email-input" type="email" />
          <button id="submit-btn" type="submit">Giriş Yap</button>
        </form>
        <button id="buy-btn" data-action="purchase">Hemen Satın Al (Checkout)</button>
        <details id="tos-accordion">
          <summary id="expand-summary">Devamını Oku: Ek Maddeler</summary>
          <p>Gizli madde içeriği</p>
        </details>
        <footer>
          <a id="tos-link" href="/terms">Kullanım Koşulları</a>
          <a id="privacy-link" href="/privacy">Gizlilik Politikası</a>
        </footer>
      </main>
    `;
  });

  it('rejects form inputs, submit buttons, login buttons, and purchase/checkout buttons', () => {
    const emailInput = document.getElementById('email-input')!;
    const submitBtn = document.getElementById('submit-btn')!;
    const buyBtn = document.getElementById('buy-btn')!;

    expect(isElementSafeForNarrowAction(emailInput).allowed).toBe(false);
    expect(isElementSafeForNarrowAction(submitBtn).allowed).toBe(false);
    expect(isElementSafeForNarrowAction(buyBtn).allowed).toBe(false);
  });

  it('allows only accordion/read-more triggers and ToS/Privacy links', () => {
    const expandSummary = document.getElementById('expand-summary')!;
    const tosLink = document.getElementById('tos-link')!;
    const privacyLink = document.getElementById('privacy-link')!;

    expect(isElementSafeForNarrowAction(expandSummary).allowed).toBe(true);
    expect(isElementSafeForNarrowAction(tosLink).allowed).toBe(true);
    expect(isElementSafeForNarrowAction(privacyLink).allowed).toBe(true);
  });

  it('refuses to initialize PageAgentCore without user API key (prevents demo LLM usage)', () => {
    expect(() => createRestrictedPageAgent({ apiKey: '' })).toThrow(
      /kullanıcı API anahtarı zorunludur/i
    );
  });

  it('deletes input_text, select_dropdown_option, execute_javascript, and ask_user tools from PageAgentCore', () => {
    const { agent } = createRestrictedPageAgent({
      apiKey: 'user-provided-test-key-not-logged',
      model: 'gemini-2.5-flash',
    });

    expect(agent.tools.has('input_text')).toBe(false);
    expect(agent.tools.has('select_dropdown_option')).toBe(false);
    expect(agent.tools.has('execute_javascript')).toBe(false);
    expect(agent.tools.has('ask_user')).toBe(false);

    // Only narrow navigation/read tools remain
    expect(agent.tools.has('click_element_by_index')).toBe(true);
    expect(agent.tools.has('scroll')).toBe(true);
    expect(agent.tools.has('done')).toBe(true);

    agent.dispose();
  });
});
