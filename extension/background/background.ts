import {
  runAnalysisPipeline,
  segmentDocument,
  type InjectionAlert,
  type RiskReport,
} from '../../core/index';
import {
  buildRecordedMockLLMOutput,
  callLiveLLMProvider,
  getStoredLLMSettings,
} from './llm-client';

export interface AnalyzeRequestPayload {
  url: string;
  title: string;
  rawText: string;
  alerts?: InjectionAlert[];
  forceMock?: boolean;
}

export async function handleAnalyzePayload(
  payload: AnalyzeRequestPayload
): Promise<RiskReport> {
  const settings = await getStoredLLMSettings();
  const segmented = segmentDocument(payload.rawText);
  const useMock = Boolean(payload.forceMock || settings.mockMode || !settings.apiKey);

  return runAnalysisPipeline({
    url: payload.url,
    title: payload.title,
    rawText: payload.rawText,
    preDetectedAlerts: payload.alerts ?? [],
    llmCaller: async (prompts, attempt, previousSchemaError) => {
      if (useMock) {
        return buildRecordedMockLLMOutput(segmented.clauses);
      }
      return callLiveLLMProvider(
        settings,
        prompts,
        attempt,
        previousSchemaError
      );
    },
  });
}

if (typeof chrome !== 'undefined' && chrome.sidePanel?.setPanelBehavior) {
  chrome.sidePanel
    .setPanelBehavior({ openPanelOnActionClick: true })
    .catch(() => {
      // Ignore if not supported in current browser environment
    });
}

if (typeof chrome !== 'undefined' && chrome.runtime?.onMessage) {
  chrome.runtime.onMessage.addListener((message, _sender, sendResponse) => {
    if (message?.type === 'ANALYZE_TEXT_PAYLOAD') {
      handleAnalyzePayload(message.payload)
        .then((report) => sendResponse({ ok: true, report }))
        .catch((err) =>
          sendResponse({
            ok: false,
            error: err instanceof Error ? err.message : String(err),
          })
        );
      return true;
    }
    return false;
  });
}
