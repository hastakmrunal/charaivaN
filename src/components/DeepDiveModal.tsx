import React, { useState, useEffect, useRef } from 'react';
import { createPortal } from 'react-dom';
import { Language, GuideSettings, GuideOutputMode } from '../types';
import { speechManager } from '../utils/speech';
import { AudioSpeedControl } from './AudioSpeedControl';
import { WordByWordText } from './WordByWordText';
import { BackButton } from './BackButton';
import { useBackLayer } from '../utils/navigationHistory';
import { getLocalizedCloseLabel, useLocalizedTexts } from '../data/localizedStrings';
import {
  Sparkles,
  Volume2,
  Pause,
  X,
  CheckCircle2,
  HelpCircle,
  Clock,
  Compass,
  MessageSquare,
  Flame,
  Key,
  Layers,
  RefreshCw
} from 'lucide-react';

interface DeepDiveData {
  title: string;
  deepDiveNarration: string;
  secretFacts: string[];
  architecturalSecrets: string[];
  historicalTimeline: Array<{ era: string; event: string }>;
  unsolvedMysteries: string[];
  visitorProTips: string[];
}

interface DeepDiveModalProps {
  title: string;
  category?: string;
  locationName?: string;
  currentNarration?: string;
  selectedLanguage: Language;
  guideSettings?: GuideSettings;
  onUpdateSpeechRate?: (rate: number) => void;
  outputMode?: GuideOutputMode;
  onClose: () => void;
  onOpenChatWithQuestion: (question: string) => void;
}

type DeepDiveErrorCode =
  | 'errorHtmlResponse'
  | 'errorInvalidJson'
  | 'errorEmptyResponse'
  | 'errorNotFound'
  | 'errorRateLimit'
  | 'errorAuth'
  | 'errorTimeout'
  | 'errorNetwork'
  | 'errorServerUnavailable';

const DEEP_DIVE_UI_DEFAULTS = {
  badge: 'Deep In-Depth Exploration',
  listen: 'Listen',
  playing: 'Playing',
  tabNarration: 'Deep Story',
  tabSecrets: 'Hidden Secrets',
  tabArchitecture: 'Architecture',
  tabMysteries: 'Mysteries',
  tabTips: 'Insider Tips',
  loadingCopy: 'Uncovering legends, secrets, and historical records about',
  timelineHeading: 'Historical Timeline Milestones',
  secretsHeading: 'Lesser-Known Secrets & Folklore:',
  archHeading: 'Architectural & Craft Secrets to Spot:',
  mysteriesHeading: 'Unsolved Mysteries & Debates:',
  tipsHeading: 'Insider Visitor Pro Tips:',
  askAiCta: 'Ask AI Guide a Question About This',
  retryBtn: 'Retry',
  errorHtmlResponse: 'Deep Exploration service returned an unexpected page instead of data. Please try again.',
  errorInvalidJson: 'Received an unreadable response from Deep Exploration. Please try again.',
  errorEmptyResponse: 'Deep Exploration returned an empty response. Please try again.',
  errorNotFound: 'Deep Exploration service endpoint could not be reached. Please try again.',
  errorRateLimit: 'Deep Exploration is busy right now. Please wait a moment and try again.',
  errorAuth: 'Authorization is required to access Deep Exploration.',
  errorTimeout: 'Deep Exploration took too long to respond. Please try again.',
  errorNetwork: 'Network connection interrupted. Please check your connection and try again.',
  errorServerUnavailable: 'Deep Exploration is temporarily unavailable. Please try again.',
};

function sanitizeServerErrorMessage(msg: unknown): string | null {
  if (typeof msg !== 'string') return null;
  const trimmed = msg.trim();
  if (!trimmed || trimmed.length > 220) return null;
  // Never surface raw HTML, stack traces, or internal parser syntax to users
  if (
    trimmed.startsWith('<') ||
    trimmed.toLowerCase().includes('<!doctype') ||
    trimmed.includes('Unexpected token') ||
    trimmed.includes('SyntaxError') ||
    trimmed.includes('at ')
  ) {
    return null;
  }
  return trimmed;
}

function mapStatusToErrorCode(status: number): DeepDiveErrorCode {
  if (status === 404) return 'errorNotFound';
  if (status === 401 || status === 403) return 'errorAuth';
  if (status === 429) return 'errorRateLimit';
  if (status === 408 || status === 504) return 'errorTimeout';
  return 'errorServerUnavailable';
}

export const DeepDiveModal: React.FC<DeepDiveModalProps> = ({
  title,
  category,
  locationName,
  currentNarration,
  selectedLanguage,
  guideSettings,
  onClose,
  onOpenChatWithQuestion,
  onUpdateSpeechRate,
}) => {
  const { t } = useLocalizedTexts(DEEP_DIVE_UI_DEFAULTS, selectedLanguage, 'Deep Dive modal tabs and headings');
  const [loading, setLoading] = useState(true);
  const [errorState, setErrorState] = useState<{ code: DeepDiveErrorCode; customMessage?: string } | null>(null);
  const [data, setData] = useState<DeepDiveData | null>(null);
  const [isPlaying, setIsPlaying] = useState(false);
  const [activeTab, setActiveTab] = useState<'narration' | 'secrets' | 'architecture' | 'mysteries' | 'tips'>('narration');
  const [retryCount, setRetryCount] = useState(0);
  const requestSeqRef = useRef(0);

  const handleClose = () => {
    speechManager.stop();
    setIsPlaying(false);
    onClose();
  };

  useBackLayer('modal-deep-dive', true, handleClose, 65);

  useEffect(() => {
    let isMounted = true;
    const requestId = ++requestSeqRef.current;
    const controller = new AbortController();
    let timedOut = false;
    const timeoutId = window.setTimeout(() => {
      timedOut = true;
      controller.abort();
    }, 28000);

    // Clear stale content from any previous subject/language immediately before fetching
    speechManager.stop();
    setIsPlaying(false);
    setActiveTab('narration');
    setData(null);
    setLoading(true);
    setErrorState(null);

    async function fetchDeepDive() {
      try {
        const res = await fetch('/api/deep-dive-topic', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json', Accept: 'application/json' },
          body: JSON.stringify({
            title,
            category,
            locationName,
            currentNarration,
            language: selectedLanguage.name,
          }),
          signal: controller.signal,
        });

        const contentType = (res.headers.get('content-type') || '').toLowerCase();
        const rawText = await res.text();
        if (!isMounted || requestId !== requestSeqRef.current) return;

        const trimmed = rawText.trim();
        const looksLikeHtml =
          trimmed.startsWith('<') ||
          trimmed.toLowerCase().startsWith('<!doctype') ||
          (contentType.includes('text/html') && !contentType.includes('application/json'));

        if (looksLikeHtml) {
          setErrorState({ code: res.status === 404 ? 'errorNotFound' : 'errorHtmlResponse' });
          return;
        }

        if (!trimmed) {
          setErrorState({
            code: res.ok ? 'errorEmptyResponse' : mapStatusToErrorCode(res.status),
          });
          return;
        }

        const hasJsonHeader = contentType.includes('application/json') || contentType.includes('+json');
        const looksLikeJson = trimmed.startsWith('{') || trimmed.startsWith('[');
        if (!hasJsonHeader && !looksLikeJson) {
          setErrorState({
            code: res.ok ? 'errorInvalidJson' : mapStatusToErrorCode(res.status),
          });
          return;
        }

        let json: any;
        try {
          json = JSON.parse(trimmed);
        } catch {
          setErrorState({
            code: res.ok ? 'errorInvalidJson' : mapStatusToErrorCode(res.status),
          });
          return;
        }

        if (!json || typeof json !== 'object' || Array.isArray(json)) {
          setErrorState({ code: 'errorInvalidJson' });
          return;
        }

        if (!res.ok || json.success !== true) {
          const safeMsg = sanitizeServerErrorMessage(json.error);
          setErrorState({
            code: mapStatusToErrorCode(res.status),
            customMessage: selectedLanguage.code === 'en' && safeMsg ? safeMsg : undefined,
          });
          return;
        }

        const narration = typeof json.deepDiveNarration === 'string' ? json.deepDiveNarration.trim() : '';
        if (!narration) {
          setErrorState({ code: 'errorEmptyResponse' });
          return;
        }

        setData({
          title: typeof json.title === 'string' && json.title.trim() ? json.title.trim() : title,
          deepDiveNarration: narration,
          secretFacts: Array.isArray(json.secretFacts) ? json.secretFacts.filter((x: unknown) => typeof x === 'string') : [],
          architecturalSecrets: Array.isArray(json.architecturalSecrets)
            ? json.architecturalSecrets.filter((x: unknown) => typeof x === 'string')
            : [],
          historicalTimeline: Array.isArray(json.historicalTimeline)
            ? json.historicalTimeline.filter(
                (item: any) => item && typeof item.era === 'string' && typeof item.event === 'string'
              )
            : [],
          unsolvedMysteries: Array.isArray(json.unsolvedMysteries)
            ? json.unsolvedMysteries.filter((x: unknown) => typeof x === 'string')
            : [],
          visitorProTips: Array.isArray(json.visitorProTips)
            ? json.visitorProTips.filter((x: unknown) => typeof x === 'string')
            : [],
        });
      } catch (err: any) {
        if (!isMounted || requestId !== requestSeqRef.current) return;
        if (err?.name === 'AbortError') {
          if (timedOut) {
            setErrorState({ code: 'errorTimeout' });
          }
          return;
        }
        setErrorState({ code: 'errorNetwork' });
      } finally {
        window.clearTimeout(timeoutId);
        if (isMounted && requestId === requestSeqRef.current) {
          setLoading(false);
        }
      }
    }

    fetchDeepDive();

    return () => {
      isMounted = false;
      window.clearTimeout(timeoutId);
      controller.abort();
      speechManager.stop();
    };
  }, [title, category, locationName, currentNarration, selectedLanguage.name, selectedLanguage.code, retryCount]);

  const errorMessage = errorState ? errorState.customMessage || t[errorState.code] : null;

  // Handle Speech Narration
  const handleToggleSpeech = () => {
    if (isPlaying) {
      speechManager.stop();
      setIsPlaying(false);
    } else if (data?.deepDiveNarration) {
      speechManager.speak({
        text: data.deepDiveNarration,
        language: selectedLanguage.name,
        languageCode: selectedLanguage.speechCode,
        rate: guideSettings?.speechRate || 1.0,
        pitch: guideSettings?.voicePitch,
        gender: guideSettings?.voiceGender || 'female',
        onStart: () => setIsPlaying(true),
        onEnd: () => setIsPlaying(false),
        onError: () => setIsPlaying(false),
      });
    }
  };

  const modalContent = (
    <div
      id="deep-dive-modal-overlay"
      className="fixed inset-0 z-50 bg-black/80 backdrop-blur-md flex items-center justify-center p-3 sm:p-5 animate-fade-in"
      onClick={(e) => {
        if (e.target === e.currentTarget) handleClose();
      }}
    >
      <div
        id="deep-dive-modal-content"
        dir={selectedLanguage.direction === 'rtl' ? 'rtl' : 'ltr'}
        style={{
          backgroundColor: 'var(--theme-card-bg)',
          borderColor: 'var(--theme-card-border-glow)',
          color: 'var(--theme-text-title)',
        }}
        className="w-full max-w-2xl max-h-[90vh] rounded-3xl border shadow-2xl flex flex-col overflow-hidden"
        onClick={(e) => e.stopPropagation()}
      >
        {/* Modal Header */}
        <div
          style={{
            backgroundColor: 'var(--theme-card-bg-subtle)',
            borderColor: 'var(--theme-card-border)',
          }}
          className="shrink-0 p-4 border-b flex items-center justify-between gap-3"
        >
          <div className="min-w-0 flex-1 flex items-start gap-2.5">
            <BackButton
              compact
              id="btn-deep-dive-back"
              onClick={handleClose}
              selectedLanguage={selectedLanguage}
              className="mt-0.5"
            />
            <div className="min-w-0 flex-1">
            <div className="flex items-center gap-2 flex-wrap">
              <span className="px-2 py-0.5 rounded-full theme-badge-gold font-bold text-[10px] uppercase tracking-wider flex items-center gap-1">
                <Sparkles className="w-3 h-3" />
                {t.badge}
              </span>
              <span className="text-[10px] text-[var(--theme-accent-secondary)] font-medium">
                {selectedLanguage.nativeName}
              </span>
            </div>
            <h3 className="text-base sm:text-lg font-serif font-bold text-[var(--theme-text-title)] truncate mt-0.5">
              {title}
            </h3>
            {locationName && (
              <p className="text-xs text-[var(--theme-text-muted)] truncate">{locationName}</p>
            )}
            </div>
          </div>

          <div className="flex items-center gap-1.5 shrink-0">
            {data && (
              <>
                <button
                  onClick={handleToggleSpeech}
                  style={
                    isPlaying
                      ? undefined
                      : {
                          backgroundColor: 'var(--theme-card-bg)',
                          borderColor: 'var(--theme-card-border)',
                          color: 'var(--theme-accent-primary)',
                        }
                  }
                  className={`p-2 rounded-xl border transition-all cursor-pointer flex items-center gap-1.5 text-xs font-bold ${
                    isPlaying
                      ? 'theme-btn-primary animate-pulse border-transparent'
                      : 'hover:border-[var(--theme-card-border-glow)]'
                  }`}
                  title={isPlaying ? 'Pause Audio' : 'Listen to Deep Dive Audio'}
                >
                  {isPlaying ? <Pause className="w-4 h-4" /> : <Volume2 className="w-4 h-4" />}
                  <span className="hidden sm:inline">{isPlaying ? t.playing : t.listen}</span>
                </button>

                <AudioSpeedControl
                  id="btn-deep-dive-audio-speed"
                  compact
                  speed={guideSettings?.speechRate}
                  onChangeSpeed={(nextRate) => {
                    speechManager.setRate(nextRate);
                    onUpdateSpeechRate?.(nextRate);
                  }}
                  isRtl={selectedLanguage.direction === 'rtl'}
                />
              </>
            )}

            <button
              onClick={handleClose}
              style={{
                backgroundColor: 'var(--theme-card-bg)',
                borderColor: 'var(--theme-card-border)',
                color: 'var(--theme-text-muted)',
              }}
              className="p-2 rounded-xl border hover:text-[var(--theme-text-title)] cursor-pointer"
            >
              <X className="w-5 h-5" />
            </button>
          </div>
        </div>

        {/* Navigation Tabs */}
        {data && (
          <div
            style={{
              backgroundColor: 'var(--theme-card-bg-subtle)',
              borderColor: 'var(--theme-card-border)',
            }}
            className="shrink-0 flex items-center gap-1 px-3 pt-2 border-b overflow-x-auto scrollbar-none"
          >
            {[
              { id: 'narration' as const, label: t.tabNarration, icon: Volume2 },
              { id: 'secrets' as const, label: `${t.tabSecrets} (${data.secretFacts?.length || 0})`, icon: Key },
              { id: 'architecture' as const, label: t.tabArchitecture, icon: Layers },
              { id: 'mysteries' as const, label: t.tabMysteries, icon: HelpCircle },
              { id: 'tips' as const, label: t.tabTips, icon: Compass },
            ].map((tab) => {
              const Icon = tab.icon;
              const active = activeTab === tab.id;
              return (
                <button
                  key={tab.id}
                  onClick={() => setActiveTab(tab.id)}
                  className={`pb-2 px-3 text-xs font-bold border-b-2 whitespace-nowrap cursor-pointer transition-all flex items-center gap-1.5 ${
                    active
                      ? 'border-[var(--theme-accent-primary)] text-[var(--theme-text-title)]'
                      : 'border-transparent text-[var(--theme-text-muted)] hover:text-[var(--theme-text-title)]'
                  }`}
                >
                  <Icon className="w-3.5 h-3.5" />
                  <span>{tab.label}</span>
                </button>
              );
            })}
          </div>
        )}

        {/* Content Body */}
        <div className="flex-1 min-h-0 overflow-y-auto p-4 space-y-4">
          {loading && (
            <div className="py-12 flex flex-col items-center justify-center text-center space-y-3">
              <div className="w-10 h-10 border-3 border-[var(--theme-accent-primary)] border-t-transparent rounded-full animate-spin" />
              <p className="text-sm text-[var(--theme-text-muted)] font-medium animate-pulse">
                {t.loadingCopy} {title}...
              </p>
            </div>
          )}

          {errorMessage && !loading && (
            <div
              style={{
                backgroundColor: 'var(--theme-card-bg-subtle)',
                borderColor: 'var(--theme-accent-primary)',
                color: 'var(--theme-text-title)',
              }}
              className="p-4 rounded-2xl border text-center space-y-2"
            >
              <p className="text-xs font-medium">{errorMessage}</p>
              <div className="flex items-center justify-center gap-2 pt-1">
                <button
                  type="button"
                  onClick={() => setRetryCount((c) => c + 1)}
                  className="px-3 py-1.5 rounded-xl theme-btn-primary text-xs font-bold cursor-pointer inline-flex items-center gap-1.5"
                >
                  <RefreshCw className="w-3.5 h-3.5" />
                  <span>{t.retryBtn}</span>
                </button>
                <button
                  type="button"
                  onClick={handleClose}
                  className="px-3 py-1.5 rounded-xl theme-btn-secondary text-xs font-bold cursor-pointer"
                >
                  {getLocalizedCloseLabel(selectedLanguage)}
                </button>
              </div>
            </div>
          )}

          {data && !loading && (
            <>
              {activeTab === 'narration' && (
                <div className="space-y-3">
                  <div
                    style={{
                      backgroundColor: 'var(--theme-card-bg-subtle)',
                      borderColor: 'var(--theme-card-border)',
                    }}
                    className="p-4 rounded-2xl border leading-relaxed text-xs sm:text-sm text-[var(--theme-text-body)] font-sans shadow-sm whitespace-pre-line"
                  >
                    <WordByWordText text={data.deepDiveNarration} />
                  </div>

                  {data.historicalTimeline && data.historicalTimeline.length > 0 && (
                    <div
                      style={{
                        backgroundColor: 'var(--theme-card-bg-subtle)',
                        borderColor: 'var(--theme-card-border)',
                      }}
                      className="p-3.5 rounded-2xl border space-y-2"
                    >
                      <h4 className="text-xs font-bold text-[var(--theme-accent-primary)] flex items-center gap-1.5 uppercase tracking-wider">
                        <Clock className="w-3.5 h-3.5" />
                        {t.timelineHeading}
                      </h4>
                      <div className="space-y-1.5">
                        {data.historicalTimeline.map((item, idx) => (
                          <div
                            key={idx}
                            className="flex items-start gap-2 text-xs text-[var(--theme-text-body)] py-0.5"
                          >
                            <span
                              style={{ backgroundColor: 'var(--theme-accent-secondary)' }}
                              className="w-2 h-2 rounded-full mt-1.5 shrink-0"
                            />
                            <span className="font-bold text-[var(--theme-accent-primary)] shrink-0">{item.era}:</span>
                            <span>{item.event}</span>
                          </div>
                        ))}
                      </div>
                    </div>
                  )}
                </div>
              )}

              {activeTab === 'secrets' && (
                <div className="space-y-2.5">
                  <h4 className="text-xs font-bold text-[var(--theme-accent-primary)] uppercase tracking-wider flex items-center gap-1.5">
                    <Key className="w-3.5 h-3.5" />
                    {t.secretsHeading}
                  </h4>
                  <div className="grid grid-cols-1 sm:grid-cols-2 gap-2.5">
                    {data.secretFacts.map((fact, idx) => (
                      <div
                        key={idx}
                        style={{
                          backgroundColor: 'var(--theme-card-bg-subtle)',
                          borderColor: 'var(--theme-card-border)',
                        }}
                        className="p-3 rounded-2xl border text-xs text-[var(--theme-text-body)] shadow-sm flex items-start gap-2"
                      >
                        <Flame className="w-4 h-4 text-[var(--theme-accent-primary)] shrink-0 mt-0.5" />
                        <span className="leading-relaxed">{fact}</span>
                      </div>
                    ))}
                  </div>
                </div>
              )}

              {activeTab === 'architecture' && (
                <div className="space-y-2.5">
                  <h4 className="text-xs font-bold text-[var(--theme-accent-primary)] uppercase tracking-wider flex items-center gap-1.5">
                    <Layers className="w-3.5 h-3.5" />
                    {t.archHeading}
                  </h4>
                  <div className="space-y-2">
                    {data.architecturalSecrets.map((arch, idx) => (
                      <div
                        key={idx}
                        style={{
                          backgroundColor: 'var(--theme-card-bg-subtle)',
                          borderColor: 'var(--theme-card-border)',
                        }}
                        className="p-3 rounded-2xl border text-xs text-[var(--theme-text-body)] flex items-start gap-2.5"
                      >
                        <CheckCircle2 className="w-4 h-4 text-[var(--theme-accent-secondary)] shrink-0 mt-0.5" />
                        <span className="leading-relaxed">{arch}</span>
                      </div>
                    ))}
                  </div>
                </div>
              )}

              {activeTab === 'mysteries' && (
                <div className="space-y-2.5">
                  <h4 className="text-xs font-bold text-[var(--theme-accent-primary)] uppercase tracking-wider flex items-center gap-1.5">
                    <HelpCircle className="w-3.5 h-3.5" />
                    {t.mysteriesHeading}
                  </h4>
                  <div className="space-y-2">
                    {data.unsolvedMysteries.map((mystery, idx) => (
                      <div
                        key={idx}
                        style={{
                          backgroundColor: 'var(--theme-card-bg-subtle)',
                          borderColor: 'var(--theme-card-border)',
                        }}
                        className="p-3.5 rounded-2xl border text-xs text-[var(--theme-text-body)] space-y-1"
                      >
                        <p className="leading-relaxed">{mystery}</p>
                      </div>
                    ))}
                  </div>
                </div>
              )}

              {activeTab === 'tips' && (
                <div className="space-y-2.5">
                  <h4 className="text-xs font-bold text-[var(--theme-accent-primary)] uppercase tracking-wider flex items-center gap-1.5">
                    <Compass className="w-3.5 h-3.5" />
                    {t.tipsHeading}
                  </h4>
                  <div className="space-y-2">
                    {data.visitorProTips.map((tip, idx) => (
                      <div
                        key={idx}
                        style={{
                          backgroundColor: 'var(--theme-card-bg-subtle)',
                          borderColor: 'var(--theme-card-border)',
                        }}
                        className="p-3 rounded-2xl border text-xs text-[var(--theme-text-body)] flex items-start gap-2.5"
                      >
                        <CheckCircle2 className="w-4 h-4 text-[var(--theme-accent-primary)] shrink-0 mt-0.5" />
                        <span className="leading-relaxed">{tip}</span>
                      </div>
                    ))}
                  </div>
                </div>
              )}
            </>
          )}
        </div>

        {/* Modal Footer: Ask AI Question */}
        <div
          style={{
            backgroundColor: 'var(--theme-card-bg-subtle)',
            borderColor: 'var(--theme-card-border)',
          }}
          className="shrink-0 p-3 border-t flex items-center justify-between gap-2"
        >
          <button
            onClick={() => {
              speechManager.stop();
              onOpenChatWithQuestion(`Tell me more fascinating secrets and questions about ${title}`);
              onClose();
            }}
            className="flex-1 py-2.5 px-3 rounded-xl theme-btn-primary text-xs font-bold cursor-pointer transition-all flex items-center justify-center gap-1.5 shadow-md active:scale-[0.99]"
          >
            <MessageSquare className="w-3.5 h-3.5" />
            <span>{t.askAiCta}</span>
          </button>
        </div>
      </div>
    </div>
  );

  const portalTarget =
    typeof document !== 'undefined'
      ? document.getElementById('charaiva-app-root') || document.body
      : null;

  return portalTarget ? createPortal(modalContent, portalTarget) : modalContent;
};
