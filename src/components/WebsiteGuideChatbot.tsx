import React, { useState, useRef, useEffect, useCallback } from 'react';
import {
  MessageSquare,
  X,
  Send,
  RotateCcw,
  ArrowUpRight,
  Compass,
  AlertCircle,
  Loader2,
} from 'lucide-react';
import { Language } from '../types';

export type NavActionId =
  | 'step1'
  | 'step2'
  | 'step3'
  | 'step4'
  | 'step5'
  | 'guide'
  | 'about'
  | 'socinet'
  | 'payment'
  | 'language'
  | 'sample';

interface ChatMessage {
  id: string;
  role: 'user' | 'model';
  text: string;
  isStreaming?: boolean;
}

interface WebsiteGuideChatbotProps {
  lang: Language;
  activeTab: 'flow' | 'guide' | 'about';
  currentStep: number;
  isStep1Ready: boolean;
  missingStep1Items: string[];
  isPaid: boolean;
  onNavigateAction: (action: NavActionId) => void;
}

const VALID_NAV_ACTIONS = new Set<NavActionId>([
  'step1',
  'step2',
  'step3',
  'step4',
  'step5',
  'guide',
  'about',
  'socinet',
  'payment',
  'language',
  'sample',
]);

const NAV_TAG_REGEX = /\[\[NAV:([a-z0-9]+)\]\]/gi;

function parseMessageAndActions(rawText: string): { cleanText: string; actions: NavActionId[] } {
  const actions: NavActionId[] = [];
  const seen = new Set<NavActionId>();
  const cleanText = rawText
    .replace(NAV_TAG_REGEX, (_match, rawId: string) => {
      const normalized = rawId.toLowerCase() as NavActionId;
      if (VALID_NAV_ACTIONS.has(normalized) && !seen.has(normalized)) {
        seen.add(normalized);
        actions.push(normalized);
      }
      return '';
    })
    .replace(/\n{3,}/g, '\n\n')
    .trim();

  return { cleanText, actions };
}

function getUiCopy(lang: Language) {
  if (lang === 'km') {
    return {
      launcherLabel: 'ជំនួយការណែនាំ',
      title: 'ជំនួយការណែនាំវេបសាយ',
      subtitleGuide: 'កំពុងមើលមគ្គុទ្ទេសក៍ TOPIK → KIIP',
      subtitleStep: (step: number, missing: number) =>
        missing > 0 ? `ជំហានទី ${step} / 5 · ខ្វះ ${missing} ចំណុច` : `ជំហានទី ${step} / 5 · ឯកសារគ្រប់លក្ខខណ្ឌ`,
      welcome:
        'សួស្តី! ខ្ញុំជាជំនួយការណែនាំការប្រើប្រាស់វេបសាយ KIIP & TOPIK។ សួរខ្ញុំបានគ្រប់យ៉ាងអំពីការបង្ហោះឯកសារ ការផ្ទៀងផ្ទាត់ OCR ការបំពេញទម្រង់ ការដោះសោ PDF ឬការផ្ញើអ៊ីមែលទៅការិយាល័យអន្តោប្រវេសន៍។',
      placeholder: 'សួរពីរបៀបប្រើវេបសាយ...',
      sendLabel: 'ផ្ញើ',
      resetLabel: 'ចាប់ផ្តើមការសន្ទនាថ្មី',
      closeLabel: 'បិទជំនួយការ',
      thinking: 'កំពុងរៀបចំចម្លើយ...',
      retry: 'ព្យាយាមម្តងទៀត',
      prompts: [
        'តើត្រូវចាប់ផ្តើមដាក់ពាក្យដោយរបៀបណា?',
        'តើជំហានទី ១ ខ្វះឯកសារអ្វីខ្លះទៀត?',
        'ពិន្ទុ TOPIK របស់ខ្ញុំចូលដល់ KIIP កម្រិតណា?',
        'របៀបដោះសោ PDF និងប្រើ Redeem Code?',
      ],
      navLabels: {
        step1: 'ទៅជំហានទី ១ (បង្ហោះឯកសារ)',
        step2: 'ទៅជំហានទី ២ (ផ្ទៀងផ្ទាត់ OCR)',
        step3: 'ទៅជំហានទី ៣ (ពិនិត្យទម្រង់)',
        step4: 'ទៅជំហានទី ៤ (មើល PDF)',
        step5: 'ទៅជំហានទី ៥ (ផ្ញើអ៊ីមែល)',
        guide: 'បើកមគ្គុទ្ទេសក៍ TOPIK → KIIP',
        about: 'មើលទំព័រ About Me & ទំនាក់ទំនង',
        socinet: 'មើលសេចក្តីណែនាំ Socinet',
        payment: 'បើកផ្ទាំងដោះសោ / Redeem Code',
        language: 'ប្តូរភាសា (៥០+ ភាសា)',
        sample: 'សាកល្បងជាមួយឯកសារគំរូ',
      } as Record<NavActionId, string>,
    };
  }

  if (lang === 'ko') {
    return {
      launcherLabel: '이용 도우미',
      title: '웹사이트 이용 도우미',
      subtitleGuide: 'TOPIK → KIIP 안내 보는 중',
      subtitleStep: (step: number, missing: number) =>
        missing > 0 ? `${step}/5단계 · 필수 항목 ${missing}개 남음` : `${step}/5단계 · 서류 준비 완료`,
      welcome:
        '안녕하세요! KIIP·TOPIK 성적 연계 신청 포털 이용 도우미입니다. 서류 업로드, OCR 확인·수정, 신청서 작성, PDF 병합·잠금해제, 관할 출입국 이메일 제출까지 무엇이든 물어보세요.',
      placeholder: '웹사이트 이용 방법을 물어보세요...',
      sendLabel: '전송',
      resetLabel: '대화 초기화',
      closeLabel: '도우미 닫기',
      thinking: '답변 작성 중...',
      retry: '다시 시도',
      prompts: [
        '신청 절차를 처음부터 알려주세요',
        '1단계에서 아직 부족한 항목이 무엇인가요?',
        'TOPIK 급수별 KIIP 배정 단계가 궁금해요',
        'PDF 워터마크 해제 및 코드 사용 방법은?',
      ],
      navLabels: {
        step1: '1단계로 이동 (서류 업로드)',
        step2: '2단계로 이동 (OCR 확인/수정)',
        step3: '3단계로 이동 (신청서 확인)',
        step4: '4단계로 이동 (PDF 미리보기)',
        step5: '5단계로 이동 (이메일 제출)',
        guide: 'TOPIK → KIIP 가이드 열기',
        about: 'About Me / 연락처 보기',
        socinet: '사회통합정보망 안내 보기',
        payment: '잠금해제 / 코드 입력 열기',
        language: '언어 변경 (50+ 언어)',
        sample: '샘플 서류로 체험하기',
      } as Record<NavActionId, string>,
    };
  }

  return {
    launcherLabel: 'Site Guide',
    title: 'Website Guide Assistant',
    subtitleGuide: 'Viewing TOPIK → KIIP Guide',
    subtitleStep: (step: number, missing: number) =>
      missing > 0 ? `Step ${step} of 5 · ${missing} items left` : `Step ${step} of 5 · Ready`,
    welcome:
      'Hello! I can help you navigate this KIIP & TOPIK application portal — from uploading your documents and verifying OCR text to filling out the official form, unlocking your merged PDF, and emailing your immigration center.',
    placeholder: 'Ask how to use any step or feature...',
    sendLabel: 'Send',
    resetLabel: 'Reset conversation',
    closeLabel: 'Close assistant',
    thinking: 'Preparing answer...',
    retry: 'Retry',
    prompts: [
      'How do I complete my application step by step?',
      'What am I still missing in Step 1?',
      'How does my TOPIK level convert to KIIP?',
      'How do I unlock the PDF or use a Redeem Code?',
    ],
    navLabels: {
      step1: 'Go to Step 1 (Upload)',
      step2: 'Go to Step 2 (Verify OCR)',
      step3: 'Go to Step 3 (Form)',
      step4: 'Go to Step 4 (PDF Preview)',
      step5: 'Go to Step 5 (Send Email)',
      guide: 'Open TOPIK → KIIP Guide',
      about: 'Open About Me & Contact',
      socinet: 'View Socinet Notice',
      payment: 'Open Unlock / Redeem Code',
      language: 'Switch Language (50+)',
      sample: 'Load Sample Documents',
    } as Record<NavActionId, string>,
  };
}

/**
 * Safe inline formatter supporting **bold** segments without raw HTML injection.
 */
function renderInlineText(line: string, keyPrefix: string): React.ReactNode[] {
  const parts = line.split(/(\*\*[^*]+\*\*)/g);
  return parts.map((part, idx) => {
    if (part.startsWith('**') && part.endsWith('**') && part.length > 4) {
      return (
        <strong key={`${keyPrefix}-b-${idx}`} className="font-semibold text-slate-900">
          {part.slice(2, -2)}
        </strong>
      );
    }
    return <React.Fragment key={`${keyPrefix}-t-${idx}`}>{part}</React.Fragment>;
  });
}

function renderFormattedAssistantText(text: string): React.ReactNode {
  const lines = text.split('\n');
  const blocks: React.ReactNode[] = [];
  let listItems: string[] = [];

  const flushList = (key: string) => {
    if (listItems.length === 0) return;
    blocks.push(
      <ul key={key} className="my-1.5 space-y-1 pl-4 list-disc marker:text-slate-400">
        {listItems.map((item, idx) => (
          <li key={`${key}-li-${idx}`} className="leading-relaxed">
            {renderInlineText(item, `${key}-li-${idx}`)}
          </li>
        ))}
      </ul>
    );
    listItems = [];
  };

  lines.forEach((rawLine, idx) => {
    const line = rawLine.trim();
    if (!line) {
      flushList(`list-${idx}`);
      return;
    }
    const bulletMatch = line.match(/^[-•*]\s+(.*)$/);
    if (bulletMatch) {
      listItems.push(bulletMatch[1]);
      return;
    }
    flushList(`list-${idx}`);
    blocks.push(
      <p key={`p-${idx}`} className={blocks.length > 0 ? 'mt-1.5 leading-relaxed' : 'leading-relaxed'}>
        {renderInlineText(line, `p-${idx}`)}
      </p>
    );
  });

  flushList('list-end');
  return blocks;
}

export const WebsiteGuideChatbot: React.FC<WebsiteGuideChatbotProps> = ({
  lang,
  activeTab,
  currentStep,
  isStep1Ready,
  missingStep1Items,
  isPaid,
  onNavigateAction,
}) => {
  const copy = getUiCopy(lang);
  const [isOpen, setIsOpen] = useState(false);
  const [messages, setMessages] = useState<ChatMessage[]>([]);
  const [input, setInput] = useState('');
  const [isSending, setIsSending] = useState(false);
  const [errorMsg, setErrorMsg] = useState<string | null>(null);
  const [lastFailedPrompt, setLastFailedPrompt] = useState<string | null>(null);

  const threadEndRef = useRef<HTMLDivElement | null>(null);
  const inputRef = useRef<HTMLTextAreaElement | null>(null);
  const abortControllerRef = useRef<AbortController | null>(null);

  useEffect(() => {
    if (isOpen) {
      threadEndRef.current?.scrollIntoView({ behavior: 'smooth' });
    }
  }, [messages, isOpen, errorMsg]);

  useEffect(() => {
    if (isOpen) {
      const timer = setTimeout(() => inputRef.current?.focus(), 120);
      return () => clearTimeout(timer);
    }
  }, [isOpen]);

  useEffect(() => {
    return () => {
      abortControllerRef.current?.abort();
    };
  }, []);

  const handleReset = useCallback(() => {
    abortControllerRef.current?.abort();
    setMessages([]);
    setErrorMsg(null);
    setLastFailedPrompt(null);
    setIsSending(false);
    setInput('');
  }, []);

  const sendMessage = useCallback(
    async (rawPrompt: string) => {
      const trimmed = rawPrompt.trim();
      if (!trimmed || isSending) return;

      setErrorMsg(null);
      setLastFailedPrompt(null);
      setInput('');

      const userMsg: ChatMessage = {
        id: `u-${Date.now()}`,
        role: 'user',
        text: trimmed,
      };
      const assistantId = `m-${Date.now() + 1}`;
      const placeholderAssistant: ChatMessage = {
        id: assistantId,
        role: 'model',
        text: '',
        isStreaming: true,
      };

      const historyPayload = [
        ...messages.filter((m) => m.text.trim().length > 0).map((m) => ({
          role: m.role,
          text: m.text,
        })),
        { role: 'user' as const, text: trimmed },
      ];

      setMessages((prev) => [...prev, userMsg, placeholderAssistant]);
      setIsSending(true);

      const controller = new AbortController();
      abortControllerRef.current = controller;

      try {
        const resp = await fetch('/api/chat-guide', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({
            messages: historyPayload,
            context: {
              lang,
              activeTab,
              currentStep,
              isStep1Ready,
              missingItems: missingStep1Items,
              isPaid,
            },
          }),
          signal: controller.signal,
        });

        if (!resp.ok) {
          const errJson = await resp.json().catch(() => ({}));
          throw new Error(errJson?.error || `Request failed (HTTP ${resp.status})`);
        }

        const reader = resp.body?.getReader();
        if (!reader) {
          throw new Error('Streaming response body unavailable.');
        }

        const decoder = new TextDecoder();
        let buffer = '';
        let accumulated = '';

        while (true) {
          const { value, done } = await reader.read();
          if (done) break;
          buffer += decoder.decode(value, { stream: true });

          const events = buffer.split('\n\n');
          buffer = events.pop() || '';

          for (const evt of events) {
            const line = evt
              .split('\n')
              .find((l) => l.startsWith('data: '));
            if (!line) continue;
            const jsonStr = line.slice(6).trim();
            if (!jsonStr) continue;

            let parsed: { delta?: string; done?: boolean; error?: string };
            try {
              parsed = JSON.parse(jsonStr);
            } catch {
              continue;
            }

            if (parsed.error) {
              throw new Error(parsed.error);
            }

            if (typeof parsed.delta === 'string' && parsed.delta.length > 0) {
              accumulated += parsed.delta;
              const currentText = accumulated;
              setMessages((prev) =>
                prev.map((m) =>
                  m.id === assistantId ? { ...m, text: currentText, isStreaming: true } : m
                )
              );
            }
          }
        }

        setMessages((prev) =>
          prev.map((m) =>
            m.id === assistantId ? { ...m, text: accumulated, isStreaming: false } : m
          )
        );

        if (!accumulated.trim()) {
          throw new Error('Empty response received from assistant.');
        }
      } catch (err: any) {
        if (err?.name === 'AbortError') return;
        setMessages((prev) =>
          prev.filter((m) => m.id !== assistantId || m.text.trim().length > 0).map((m) =>
            m.id === assistantId ? { ...m, isStreaming: false } : m
          )
        );
        setErrorMsg(err?.message || 'Unable to reach the assistant. Please try again.');
        setLastFailedPrompt(trimmed);
      } finally {
        setIsSending(false);
        abortControllerRef.current = null;
      }
    },
    [activeTab, currentStep, isPaid, isSending, isStep1Ready, lang, messages, missingStep1Items]
  );

  const handleFormSubmit = (e: React.FormEvent) => {
    e.preventDefault();
    sendMessage(input);
  };

  const handleKeyDown = (e: React.KeyboardEvent<HTMLTextAreaElement>) => {
    if (e.key === 'Enter' && !e.shiftKey) {
      e.preventDefault();
      sendMessage(input);
    }
  };

  const statusLine =
    activeTab === 'about'
      ? lang === 'km'
        ? 'កំពុងមើលទំព័រ About Me'
        : lang === 'ko'
        ? 'About Me / 연락처 보는 중'
        : 'Viewing About Me'
      : activeTab === 'guide'
      ? copy.subtitleGuide
      : copy.subtitleStep(currentStep, missingStep1Items.length);

  return (
    <div className="fixed bottom-4 right-4 z-[9990] no-print flex flex-col items-end">
      {isOpen && (
        <section
          role="dialog"
          aria-label={copy.title}
          className="mb-3 w-[min(410px,calc(100vw-24px))] h-[min(600px,calc(100dvh-104px))] bg-white border border-slate-200 rounded-2xl shadow-2xl flex flex-col overflow-hidden"
        >
          {/* Header */}
          <header className="px-4 py-3.5 bg-slate-900 text-white flex items-center justify-between gap-3 shrink-0">
            <div className="flex items-center gap-2.5 min-w-0">
              <div className="w-8 h-8 rounded-lg bg-indigo-600 flex items-center justify-center shrink-0">
                <Compass className="w-4 h-4 text-white" />
              </div>
              <div className="min-w-0">
                <h2 className="text-sm font-semibold tracking-tight truncate">{copy.title}</h2>
                <p className="text-[11px] text-slate-300 truncate tabular-nums">{statusLine}</p>
              </div>
            </div>

            <div className="flex items-center gap-1 shrink-0">
              <button
                type="button"
                onClick={handleReset}
                title={copy.resetLabel}
                aria-label={copy.resetLabel}
                className="w-8 h-8 rounded-lg text-slate-300 hover:text-white hover:bg-white/10 transition-colors flex items-center justify-center cursor-pointer focus-visible:outline-2 focus-visible:outline-indigo-400"
              >
                <RotateCcw className="w-4 h-4" />
              </button>
              <button
                type="button"
                onClick={() => setIsOpen(false)}
                title={copy.closeLabel}
                aria-label={copy.closeLabel}
                className="w-8 h-8 rounded-lg text-slate-300 hover:text-white hover:bg-white/10 transition-colors flex items-center justify-center cursor-pointer focus-visible:outline-2 focus-visible:outline-indigo-400"
              >
                <X className="w-4 h-4" />
              </button>
            </div>
          </header>

          {/* Scrollable Message Thread */}
          <div className="flex-1 overflow-y-auto px-4 py-4 space-y-4 bg-white">
            {/* Greeting Message */}
            <div className="flex flex-col items-start gap-2">
              <div className="max-w-[90%] rounded-xl bg-slate-50 border border-slate-200/80 px-3.5 py-2.5 text-[13px] text-slate-700 leading-relaxed">
                {copy.welcome}
              </div>

              {messages.length === 0 && (
                <div className="w-full pt-1 space-y-1.5">
                  {copy.prompts.map((promptText, idx) => (
                    <button
                      key={idx}
                      type="button"
                      disabled={isSending}
                      onClick={() => sendMessage(promptText)}
                      className="w-full text-left px-3 py-2 rounded-lg border border-slate-200 bg-white hover:bg-slate-50 hover:border-indigo-300 text-xs font-medium text-slate-700 transition-colors flex items-center justify-between gap-2 cursor-pointer disabled:opacity-50"
                    >
                      <span className="line-clamp-1">{promptText}</span>
                      <ArrowUpRight className="w-3.5 h-3.5 text-slate-400 shrink-0" />
                    </button>
                  ))}
                </div>
              )}
            </div>

            {/* Conversation History */}
            {messages.map((msg) => {
              if (msg.role === 'user') {
                return (
                  <div key={msg.id} className="flex justify-end">
                    <div className="max-w-[85%] rounded-xl bg-slate-900 text-white px-3.5 py-2.5 text-[13px] leading-relaxed whitespace-pre-wrap break-words">
                      {msg.text}
                    </div>
                  </div>
                );
              }

              const { cleanText, actions } = parseMessageAndActions(msg.text);

              return (
                <div key={msg.id} className="flex flex-col items-start gap-2">
                  <div className="max-w-[92%] rounded-xl bg-slate-50 border border-slate-200/80 px-3.5 py-2.5 text-[13px] text-slate-800 break-words">
                    {cleanText ? (
                      renderFormattedAssistantText(cleanText)
                    ) : (
                      <span className="inline-flex items-center gap-2 text-slate-500 text-xs">
                        <Loader2 className="w-3.5 h-3.5 animate-spin text-indigo-600" />
                        <span>{copy.thinking}</span>
                      </span>
                    )}
                  </div>

                  {!msg.isStreaming && actions.length > 0 && (
                    <div className="flex flex-wrap gap-1.5 max-w-[92%]">
                      {actions.map((actionId) => (
                        <button
                          key={`${msg.id}-${actionId}`}
                          type="button"
                          onClick={() => onNavigateAction(actionId)}
                          className="px-3 py-1.5 rounded-lg bg-indigo-600 hover:bg-indigo-700 text-white text-xs font-medium transition-colors inline-flex items-center gap-1.5 cursor-pointer whitespace-nowrap shrink-0"
                        >
                          <span>{copy.navLabels[actionId]}</span>
                          <ArrowUpRight className="w-3.5 h-3.5 shrink-0" />
                        </button>
                      ))}
                    </div>
                  )}
                </div>
              );
            })}

            {/* Error State */}
            {errorMsg && (
              <div className="rounded-xl border border-rose-200 bg-rose-50 px-3.5 py-2.5 text-xs text-rose-800 flex items-start justify-between gap-2">
                <div className="flex items-start gap-2 min-w-0">
                  <AlertCircle className="w-4 h-4 text-rose-600 shrink-0 mt-0.5" />
                  <span className="leading-relaxed">{errorMsg}</span>
                </div>
                {lastFailedPrompt && (
                  <button
                    type="button"
                    onClick={() => sendMessage(lastFailedPrompt)}
                    className="px-2.5 py-1 rounded-md bg-rose-600 hover:bg-rose-700 text-white font-medium text-[11px] whitespace-nowrap shrink-0 cursor-pointer"
                  >
                    {copy.retry}
                  </button>
                )}
              </div>
            )}

            <div ref={threadEndRef} />
          </div>

          {/* Input Composer */}
          <form
            onSubmit={handleFormSubmit}
            className="p-3 border-t border-slate-200 bg-slate-50/70 flex items-end gap-2 shrink-0"
          >
            <textarea
              ref={inputRef}
              rows={1}
              value={input}
              onChange={(e) => setInput(e.target.value)}
              onKeyDown={handleKeyDown}
              placeholder={copy.placeholder}
              disabled={isSending}
              maxLength={2000}
              className="flex-1 resize-none rounded-xl border border-slate-300 bg-white px-3 py-2.5 text-[13px] text-slate-900 placeholder:text-slate-400 focus:outline-hidden focus:ring-2 focus:ring-indigo-500 focus:border-indigo-500 max-h-28 disabled:opacity-60"
            />
            <button
              type="submit"
              disabled={isSending || !input.trim()}
              aria-label={copy.sendLabel}
              className="h-10 px-3.5 rounded-xl bg-indigo-600 hover:bg-indigo-700 disabled:bg-slate-300 text-white font-semibold text-xs transition-colors inline-flex items-center justify-center gap-1.5 cursor-pointer disabled:cursor-not-allowed shrink-0"
            >
              {isSending ? (
                <Loader2 className="w-4 h-4 animate-spin" />
              ) : (
                <Send className="w-4 h-4" />
              )}
              <span className="sr-only sm:not-sr-only whitespace-nowrap">{copy.sendLabel}</span>
            </button>
          </form>
        </section>
      )}

      {/* Floating Toggle Launcher */}
      <button
        type="button"
        onClick={() => setIsOpen((prev) => !prev)}
        aria-expanded={isOpen}
        aria-label={isOpen ? copy.closeLabel : copy.title}
        className="h-11 px-4 rounded-xl bg-slate-900 hover:bg-slate-800 text-white shadow-lg border border-slate-700/60 transition-transform active:scale-95 flex items-center gap-2 cursor-pointer whitespace-nowrap shrink-0 focus-visible:outline-2 focus-visible:outline-indigo-500 focus-visible:outline-offset-2"
      >
        {isOpen ? (
          <X className="w-4 h-4 text-slate-200 shrink-0" />
        ) : (
          <MessageSquare className="w-4 h-4 text-indigo-300 shrink-0" />
        )}
        <span className="text-xs font-semibold tracking-tight">{copy.launcherLabel}</span>
      </button>
    </div>
  );
};
