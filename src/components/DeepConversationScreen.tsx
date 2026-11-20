import React, { useState, useEffect, useRef, useCallback } from 'react';
import {
  DeepConversationContext,
  DeepConversationMessage,
  GuideOutputMode,
  GuideSettings,
  Language,
} from '../types';
import { BackButton } from './BackButton';
import { PlaceCardImage } from './PlaceCardImage';
import { WordByWordText } from './WordByWordText';
import { speechManager } from '../utils/speech';
import { AudioSpeedControl } from './AudioSpeedControl';
import { useLocalizedTexts } from '../data/localizedStrings';
import {
  Sparkles,
  Send,
  Mic,
  MicOff,
  MapPin,
  Volume2,
  Square,
  Compass,
  BookOpen,
  Loader2,
  AlertCircle,
} from 'lucide-react';

interface DeepConversationScreenProps {
  context: DeepConversationContext;
  selectedLanguage: Language;
  guideSettings?: GuideSettings;
  onUpdateSpeechRate?: (rate: number) => void;
  outputMode: GuideOutputMode;
  messages: DeepConversationMessage[];
  onUpdateMessages: (messages: DeepConversationMessage[]) => void;
  onBack: () => void;
}

const DEEP_CONV_UI_DEFAULTS = {
  screenBadge: 'Deep Conversation',
  backToExplanation: 'Back to Guide',
  focusLabel: 'Locked Focus',
  depthLabel: 'Depth',
  topicLabel: 'Explore Topic',
  verifiedLocLabel: 'Verified Origin',
  placeholder: 'Ask a focused historical, architectural, cultural, or analytical question...',
  sendLabel: 'Send',
  listenBtn: 'Listen',
  stopAudioBtn: 'Stop',
  thinkingText: 'Researching verified historical & architectural sources...',
  suggestedNextLabel: 'Continue Exploring:',
  voiceUnsupported: 'Voice input is unavailable in this browser. Please type your question.',
  voiceDenied: 'Microphone permission denied. Please type your question.',
};

const LEVEL_NAMES: Record<string, string> = {
  quick: 'Overview',
  standard: 'Detailed',
  deep: 'In-Depth',
  expert: 'Expert Detail',
};

export const DeepConversationScreen: React.FC<DeepConversationScreenProps> = ({
  context,
  selectedLanguage,
  guideSettings,
  onUpdateSpeechRate,
  outputMode,
  messages,
  onUpdateMessages,
  onBack,
}) => {
  const { t } = useLocalizedTexts(
    DEEP_CONV_UI_DEFAULTS,
    selectedLanguage,
    'Open Deep Conversation specialist guide view labels'
  );

  const [input, setInput] = useState('');
  const [isLoading, setIsLoading] = useState(false);
  const [errorMsg, setErrorMsg] = useState<string | null>(null);
  const [speakingMsgId, setSpeakingMsgId] = useState<string | null>(null);
  const [isListeningVoice, setIsListeningVoice] = useState(false);
  const [voiceNotice, setVoiceNotice] = useState<string | null>(null);

  const messagesScrollRef = useRef<HTMLDivElement | null>(null);
  const listEndRef = useRef<HTMLDivElement | null>(null);
  const recognitionRef = useRef<any>(null);
  const initializedKeyRef = useRef<string>('');
  const latestMessagesRef = useRef<DeepConversationMessage[]>(messages);
  latestMessagesRef.current = messages;

  const contextKey = `${context.landmark.id}::${context.selectedExploreTopic?.id || 'general'}::${context.activeTab}::${context.activeLevel}`;

  // Scroll ONLY the internal conversation thread container — never scroll ancestor header/nav shells
  useEffect(() => {
    const container = messagesScrollRef.current;
    if (!container) return;
    container.scrollTo({
      top: container.scrollHeight,
      behavior: 'smooth',
    });
  }, [messages.length, isLoading]);

  useEffect(() => {
    return () => {
      speechManager.stop();
      if (recognitionRef.current) {
        try {
          recognitionRef.current.stop();
        } catch {
          // ignore
        }
      }
    };
  }, []);

  const speakText = useCallback(
    (msgId: string, text: string) => {
      if (!text) return;
      if (speakingMsgId === msgId) {
        speechManager.stop();
        setSpeakingMsgId(null);
        return;
      }
      speechManager.stop();
      speechManager.speak({
        text,
        language: selectedLanguage.name,
        languageCode: selectedLanguage.speechCode,
        rate: guideSettings?.speechRate || 1.0,
        pitch: guideSettings?.voicePitch,
        gender: guideSettings?.voiceGender || 'female',
        onStart: () => setSpeakingMsgId(msgId),
        onEnd: () => setSpeakingMsgId(null),
        onError: () => setSpeakingMsgId(null),
      });
    },
    [guideSettings?.speechRate, guideSettings?.voiceGender, guideSettings?.voicePitch, selectedLanguage.name, selectedLanguage.speechCode, speakingMsgId]
  );

  const fetchConversationTurn = useCallback(
    async (priorMsgs: DeepConversationMessage[], userQuestion?: string) => {
      setIsLoading(true);
      setErrorMsg(null);
      try {
        const res = await fetch('/api/discover/deep-conversation', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({
            context,
            messages: priorMsgs.map((m) => ({
              sender: m.sender === 'guide' ? 'assistant' : 'user',
              text: m.text,
            })),
            userMessage: userQuestion,
            language: selectedLanguage.name,
            guideSettings,
          }),
        });
        const data = await res.json();
        if (!res.ok || !data.success || !data.reply) {
          throw new Error(data.error || 'Could not generate response.');
        }

        const guideMsg: DeepConversationMessage = {
          id: `dc-guide-${Date.now()}`,
          sender: 'guide',
          text: data.reply,
          timestamp: new Date().toISOString(),
          followUpSuggestions: Array.isArray(data.followUpSuggestions) ? data.followUpSuggestions : [],
        };

        const updated = [...priorMsgs, guideMsg];
        onUpdateMessages(updated);

        if (outputMode === 'speech' || outputMode === 'both') {
          speakText(guideMsg.id, guideMsg.text);
        }
      } catch (err: any) {
        setErrorMsg(err?.message || 'Unable to continue Deep Conversation right now.');
      } finally {
        setIsLoading(false);
      }
    },
    [context, guideSettings, onUpdateMessages, outputMode, selectedLanguage.name, speakText]
  );

  // Initialize opening turn automatically if thread is empty
  useEffect(() => {
    if (messages.length > 0) return;
    if (initializedKeyRef.current === contextKey) return;
    initializedKeyRef.current = contextKey;

    if (context.initialPrompt) {
      const openingUserMsg: DeepConversationMessage = {
        id: `dc-user-${Date.now()}`,
        sender: 'user',
        text: context.initialPrompt,
        timestamp: new Date().toISOString(),
      };
      const seeded = [openingUserMsg];
      onUpdateMessages(seeded);
      fetchConversationTurn(seeded, context.initialPrompt);
    } else {
      fetchConversationTurn([], undefined);
    }
  }, [contextKey, context.initialPrompt, fetchConversationTurn, messages.length, onUpdateMessages]);

  const handleSendMessage = async (customQuestion?: string) => {
    const text = (customQuestion ?? input).trim();
    if (!text || isLoading) return;

    speechManager.stop();
    setSpeakingMsgId(null);
    setVoiceNotice(null);

    const userMsg: DeepConversationMessage = {
      id: `dc-user-${Date.now()}`,
      sender: 'user',
      text,
      timestamp: new Date().toISOString(),
    };

    const nextMessages = [...latestMessagesRef.current, userMsg];
    onUpdateMessages(nextMessages);
    if (!customQuestion) {
      setInput('');
    }
    await fetchConversationTurn(nextMessages, text);
  };

  const handleToggleVoice = () => {
    setVoiceNotice(null);
    if (isListeningVoice && recognitionRef.current) {
      try {
        recognitionRef.current.stop();
      } catch {
        // ignore
      }
      setIsListeningVoice(false);
      return;
    }

    const SpeechRec =
      (window as any).SpeechRecognition || (window as any).webkitSpeechRecognition;
    if (!SpeechRec) {
      setVoiceNotice(t.voiceUnsupported);
      return;
    }

    try {
      const rec = new SpeechRec();
      rec.lang = selectedLanguage.speechCode || 'en-US';
      rec.interimResults = false;
      rec.maxAlternatives = 1;

      rec.onresult = (event: any) => {
        const transcript = event?.results?.[0]?.[0]?.transcript?.trim();
        if (transcript) {
          setInput((prev) => (prev ? `${prev} ${transcript}` : transcript));
        }
      };
      rec.onerror = () => {
        setVoiceNotice(t.voiceDenied);
        setIsListeningVoice(false);
      };
      rec.onend = () => {
        setIsListeningVoice(false);
      };

      recognitionRef.current = rec;
      setIsListeningVoice(true);
      rec.start();
    } catch {
      setIsListeningVoice(false);
      setVoiceNotice(t.voiceUnsupported);
    }
  };

  const verifiedOrigin = context.verifiedOrigin || context.landmark.locationName;

  return (
    <div
      id="deep-conversation-screen"
      dir={selectedLanguage.direction === 'rtl' ? 'rtl' : 'ltr'}
      className="h-full flex flex-col overflow-hidden overflow-clip py-1.5 space-y-2 select-none"
    >
      {/* Top Bar with Prominent Back Button */}
      <div
        style={{
          backgroundColor: 'var(--theme-card-bg)',
          borderColor: 'var(--theme-card-border)',
        }}
        className="shrink-0 flex items-center justify-between gap-2 p-2.5 rounded-2xl border shadow-md backdrop-blur-md"
      >
        <div className="flex items-center gap-2 min-w-0">
          <BackButton
            id="btn-deep-conversation-back"
            labelOverride={t.backToExplanation}
            onClick={() => {
              speechManager.stop();
              setSpeakingMsgId(null);
              onBack();
            }}
            selectedLanguage={selectedLanguage}
          />
          <div className="min-w-0 hidden sm:block">
            <span className="text-[10px] font-bold uppercase tracking-wider text-[var(--theme-accent-primary)] flex items-center gap-1">
              <Sparkles className="w-3 h-3" />
              <span>{t.screenBadge}</span>
            </span>
          </div>
        </div>

        <span className="px-2.5 py-1 rounded-full text-[10.5px] font-bold theme-badge-teal shrink-0">
          {selectedLanguage.nativeName}
        </span>
      </div>

      {/* Context Lock Summary Strip */}
      <div
        style={{
          backgroundColor: 'var(--theme-card-bg-subtle)',
          borderColor: 'var(--theme-card-border-glow)',
        }}
        className="shrink-0 p-2.5 sm:p-3 rounded-2xl border shadow-sm space-y-2"
      >
        <div className="flex items-center gap-2.5">
          <PlaceCardImage
            placeName={context.landmark.discoverCandidate?.wikipediaTitle || context.landmark.title}
            displayTitle={context.landmark.title}
            placeId={context.landmark.googlePlaceId || context.landmark.placeId}
            initialImageUrl={context.landmark.imageUrl}
            category={context.landmark.category}
            locality={verifiedOrigin}
            cityName={context.landmark.city}
            size="sm"
          />
          <div className="min-w-0 flex-1">
            <h3 className="text-sm sm:text-base font-serif font-bold text-[var(--theme-text-title)] truncate">
              {context.landmark.title}
            </h3>
            {verifiedOrigin && (
              <div className="flex items-center gap-1 text-[11px] text-[var(--theme-accent-secondary)] font-medium truncate">
                <MapPin className="w-3 h-3 shrink-0" />
                <span className="truncate">{verifiedOrigin}</span>
              </div>
            )}
          </div>
        </div>

        <div className="flex flex-wrap items-center gap-1.5 text-[10px] font-bold">
          {context.activeDetailsType && (
            <span className="px-2 py-0.5 rounded-lg theme-badge-gold inline-flex items-center gap-1">
              <BookOpen className="w-3 h-3" />
              <span>{context.activeDetailsType}</span>
            </span>
          )}
          <span
            style={{
              backgroundColor: 'var(--theme-card-bg)',
              borderColor: 'var(--theme-card-border)',
              color: 'var(--theme-text-muted)',
            }}
            className="px-2 py-0.5 rounded-lg border inline-flex items-center gap-1"
          >
            <Compass className="w-3 h-3 text-[var(--theme-accent-primary)]" />
            <span>
              {t.depthLabel}: {LEVEL_NAMES[context.activeLevel] || context.activeLevel}
            </span>
          </span>
          {context.selectedExploreTopic && (
            <span className="px-2 py-0.5 rounded-lg theme-badge-teal inline-flex items-center gap-1 max-w-full">
              <Sparkles className="w-3 h-3 shrink-0" />
              <span className="truncate">
                {t.topicLabel}: {context.selectedExploreTopic.title}
              </span>
            </span>
          )}
        </div>
      </div>

      {/* Scrollable Conversation Thread */}
      <div
        ref={messagesScrollRef}
        style={{
          backgroundColor: 'var(--theme-card-bg)',
          borderColor: 'var(--theme-card-border)',
        }}
        className="flex-1 min-h-0 overflow-y-auto p-3 sm:p-4 rounded-2xl border backdrop-blur-md space-y-3"
      >
        {messages.map((msg) => {
          const isUser = msg.sender === 'user';
          const isSpeakingThis = speakingMsgId === msg.id;
          return (
            <div key={msg.id} className={`flex flex-col ${isUser ? 'items-end' : 'items-start'} space-y-2`}>
              <div
                style={
                  isUser
                    ? {
                        background: 'var(--theme-accent-primary-gradient)',
                        color: 'var(--theme-accent-primary-text)',
                      }
                    : {
                        backgroundColor: 'var(--theme-card-bg-subtle)',
                        borderColor: 'var(--theme-card-border)',
                        color: 'var(--theme-text-body)',
                      }
                }
                className={`max-w-[92%] sm:max-w-[82%] p-3 sm:p-3.5 rounded-2xl text-xs sm:text-sm leading-relaxed shadow-sm ${
                  isUser ? 'rounded-tr-sm font-medium' : 'rounded-tl-sm border space-y-2'
                }`}
              >
                {isUser ? (
                  <p className="whitespace-pre-line">{msg.text}</p>
                ) : (
                  <>
                    <div className="flex items-center justify-between gap-2 pb-1 border-b border-[var(--theme-card-border)]">
                      <span className="text-[10px] font-bold uppercase tracking-wider text-[var(--theme-accent-primary)] flex items-center gap-1">
                        <Sparkles className="w-3 h-3" />
                        <span>Charaiva</span>
                      </span>
                      <div className="flex items-center gap-1.5 shrink-0">
                        <button
                          type="button"
                          onClick={() => speakText(msg.id, msg.text)}
                          style={{
                            backgroundColor: 'var(--theme-card-bg)',
                            borderColor: 'var(--theme-card-border)',
                            color: isSpeakingThis ? '#f43f5e' : 'var(--theme-accent-secondary)',
                          }}
                          className="min-h-[32px] px-2 py-0.5 rounded-lg border text-[10px] font-bold flex items-center gap-1 cursor-pointer"
                        >
                          {isSpeakingThis ? (
                            <>
                              <Square className="w-2.5 h-2.5 fill-current" />
                              <span>{t.stopAudioBtn}</span>
                            </>
                          ) : (
                            <>
                              <Volume2 className="w-3 h-3" />
                              <span>{t.listenBtn}</span>
                            </>
                          )}
                        </button>

                        <AudioSpeedControl
                          compact
                          speed={guideSettings?.speechRate}
                          onChangeSpeed={(nextRate) => {
                            speechManager.setRate(nextRate);
                            onUpdateSpeechRate?.(nextRate);
                          }}
                          isRtl={selectedLanguage.direction === 'rtl'}
                        />
                      </div>
                    </div>
                    <p className="whitespace-pre-line">
                      <WordByWordText text={msg.text} />
                    </p>
                  </>
                )}
              </div>

              {!isUser && msg.followUpSuggestions && msg.followUpSuggestions.length > 0 && (
                <div className="max-w-[92%] sm:max-w-[85%] space-y-1.5 pl-1">
                  <span className="text-[10px] font-bold uppercase tracking-wider text-[var(--theme-text-muted)] block">
                    {t.suggestedNextLabel}
                  </span>
                  <div className="flex flex-wrap gap-1.5">
                    {msg.followUpSuggestions.map((sugg, idx) => (
                      <button
                        key={idx}
                        type="button"
                        disabled={isLoading}
                        onClick={() => handleSendMessage(sugg)}
                        style={{
                          backgroundColor: 'var(--theme-card-bg-subtle)',
                          borderColor: 'var(--theme-card-border)',
                          color: 'var(--theme-text-title)',
                        }}
                        className="px-2.5 py-1.5 rounded-xl border text-[11px] font-medium hover:border-[var(--theme-card-border-glow)] cursor-pointer text-left transition-colors disabled:opacity-50"
                      >
                        {sugg}
                      </button>
                    ))}
                  </div>
                </div>
              )}
            </div>
          );
        })}

        {isLoading && (
          <div
            style={{
              backgroundColor: 'var(--theme-card-bg-subtle)',
              borderColor: 'var(--theme-card-border)',
            }}
            className="p-3 rounded-2xl border max-w-[80%] flex items-center gap-2 text-xs text-[var(--theme-accent-secondary)] font-medium"
          >
            <Loader2 className="w-4 h-4 animate-spin shrink-0 text-[var(--theme-accent-primary)]" />
            <span>{t.thinkingText}</span>
          </div>
        )}

        {errorMsg && (
          <div className="p-2.5 rounded-xl bg-rose-950/70 border border-rose-500/40 text-rose-200 text-xs flex items-center gap-2">
            <AlertCircle className="w-4 h-4 shrink-0 text-rose-400" />
            <span>{errorMsg}</span>
          </div>
        )}

        <div ref={listEndRef} />
      </div>

      {/* Input Bar */}
      <div
        style={{
          backgroundColor: 'var(--theme-card-bg)',
          borderColor: 'var(--theme-card-border)',
        }}
        className="shrink-0 p-2.5 rounded-2xl border shadow-md backdrop-blur-md space-y-1.5"
      >
        {voiceNotice && (
          <p className="text-[11px] text-[var(--theme-accent-primary)] font-medium px-1">
            {voiceNotice}
          </p>
        )}
        <form
          onSubmit={(e) => {
            e.preventDefault();
            handleSendMessage();
          }}
          className="flex items-center gap-2"
        >
          <input
            id="input-deep-conversation"
            type="text"
            value={input}
            onChange={(e) => setInput(e.target.value)}
            placeholder={t.placeholder}
            className="theme-input flex-1 min-w-0 px-3.5 py-2.5 text-xs sm:text-sm min-h-[44px]"
          />
          <button
            type="button"
            onClick={handleToggleVoice}
            style={
              isListeningVoice
                ? { backgroundColor: '#e11d48', color: '#ffffff', borderColor: '#fda4af' }
                : {
                    backgroundColor: 'var(--theme-card-bg-subtle)',
                    borderColor: 'var(--theme-card-border)',
                    color: 'var(--theme-accent-secondary)',
                  }
            }
            className="min-w-[44px] min-h-[44px] px-2.5 rounded-xl border flex items-center justify-center cursor-pointer shrink-0"
            title="Voice input"
          >
            {isListeningVoice ? <MicOff className="w-4 h-4" /> : <Mic className="w-4 h-4" />}
          </button>
          <button
            id="btn-deep-conversation-send"
            type="submit"
            disabled={isLoading || !input.trim()}
            className="min-h-[44px] px-4 rounded-xl theme-btn-primary text-xs sm:text-sm font-bold flex items-center gap-1.5 cursor-pointer shrink-0 disabled:opacity-50"
          >
            <Send className="w-4 h-4" />
            <span className="hidden sm:inline">{t.sendLabel}</span>
          </button>
        </form>
      </div>
    </div>
  );
};
