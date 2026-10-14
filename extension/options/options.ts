import {
  DEFAULT_LLM_SETTINGS,
  type LLMProvider,
  type StoredLLMSettings,
} from '../background/llm-client';

const DEFAULT_MODELS: Record<LLMProvider, string> = {
  gemini: 'gemini-2.5-flash',
  openai: 'gpt-4o-mini',
  anthropic: 'claude-3-5-haiku-latest',
};

async function loadOptions(): Promise<void> {
  const providerSelect = document.getElementById(
    'provider-select'
  ) as HTMLSelectElement | null;
  const modelInput = document.getElementById(
    'model-input'
  ) as HTMLInputElement | null;
  const apiKeyInput = document.getElementById(
    'api-key-input'
  ) as HTMLInputElement | null;
  const mockCheckbox = document.getElementById(
    'mock-mode-checkbox'
  ) as HTMLInputElement | null;

  if (!providerSelect || !modelInput || !apiKeyInput || !mockCheckbox) return;

  let settings: StoredLLMSettings = DEFAULT_LLM_SETTINGS;

  if (typeof chrome !== 'undefined' && chrome.storage?.local) {
    const stored = await chrome.storage.local.get([
      'provider',
      'apiKey',
      'model',
      'mockMode',
    ]);
    settings = {
      provider: (stored.provider as LLMProvider) || 'gemini',
      apiKey: typeof stored.apiKey === 'string' ? stored.apiKey : '',
      model:
        typeof stored.model === 'string' && stored.model
          ? stored.model
          : DEFAULT_MODELS[(stored.provider as LLMProvider) || 'gemini'],
      mockMode: Boolean(stored.mockMode),
    };
  } else {
    const raw = localStorage.getItem('tos_analyzer_settings');
    if (raw) {
      try {
        const parsed = JSON.parse(raw);
        settings = { ...DEFAULT_LLM_SETTINGS, ...parsed };
      } catch {
        // ignore
      }
    }
  }

  providerSelect.value = settings.provider;
  modelInput.value = settings.model;
  apiKeyInput.value = settings.apiKey;
  mockCheckbox.checked = settings.mockMode;

  providerSelect.addEventListener('change', () => {
    const p = providerSelect.value as LLMProvider;
    modelInput.value = DEFAULT_MODELS[p];
  });
}

async function saveOptions(e: Event): Promise<void> {
  e.preventDefault();
  const providerSelect = document.getElementById(
    'provider-select'
  ) as HTMLSelectElement;
  const modelInput = document.getElementById('model-input') as HTMLInputElement;
  const apiKeyInput = document.getElementById(
    'api-key-input'
  ) as HTMLInputElement;
  const mockCheckbox = document.getElementById(
    'mock-mode-checkbox'
  ) as HTMLInputElement;
  const statusEl = document.getElementById('status-msg') as HTMLElement;

  const nextSettings: StoredLLMSettings = {
    provider: providerSelect.value as LLMProvider,
    model:
      modelInput.value.trim() ||
      DEFAULT_MODELS[providerSelect.value as LLMProvider],
    apiKey: apiKeyInput.value.trim(),
    mockMode: mockCheckbox.checked,
  };

  if (typeof chrome !== 'undefined' && chrome.storage?.local) {
    await chrome.storage.local.set(nextSettings);
  } else {
    localStorage.setItem(
      'tos_analyzer_settings',
      JSON.stringify({ ...nextSettings, apiKey: '' })
    );
  }

  statusEl.textContent =
    'Ayarlar güvenli bir şekilde chrome.storage.local alanına kaydedildi.';
  setTimeout(() => {
    statusEl.textContent = '';
  }, 3500);
}

document.addEventListener('DOMContentLoaded', () => {
  loadOptions();
  const form = document.getElementById('options-form');
  form?.addEventListener('submit', saveOptions);
});
