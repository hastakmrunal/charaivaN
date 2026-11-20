import React, { useState, useRef, useEffect, useMemo, useCallback } from 'react';
import {
  AiChatConversation,
  AiChatTopicContext,
  ChatMessage,
  GuideSettings,
  Language,
  RecognitionResult,
} from '../types';
import { speechManager } from '../utils/speech';
import { AudioSpeedControl } from './AudioSpeedControl';
import { WordByWordText } from './WordByWordText';
import {
  Send,
  Mic,
  MicOff,
  Sparkles,
  Bot,
  User,
  Bookmark,
  BookmarkCheck,
  X,
  Check,
  Camera,
  History,
  Plus,
  RotateCcw,
  AlertCircle,
} from 'lucide-react';
import { getTodayDateStr } from '../utils/journalPersistence';
import { compressImageToJournalDataUrl } from '../utils/photoStorage';
import { BackButton } from './BackButton';
import { useBackLayer, usePreservedScroll } from '../utils/navigationHistory';
import { getLocalizedChatGreeting } from '../data/localizedStrings';
import { getAiChatStrings } from '../data/aiChatStrings';
import { AIChatHistorySidebar } from './AIChatHistorySidebar';
import {
  deleteConversationForOwner,
  generateConversationTitleFromMessage,
  generateSafeChatId,
  getStoredActiveConversationId,
  hasRealUserMessages,
  landmarkToTopicContext,
  loadConversationsForOwner,
  renameConversationForOwner,
  saveConversationForOwner,
  setStoredActiveConversationId,
  sortConversationsNewestFirst,
} from '../utils/aiChatPersistence';

export interface AiGuideJournalSavePayload {
  placeName: string;
  city?: string;
  country?: string;
  visitDate: string;
  notes: string;
  guideSummary: string;
  photoDataUrl?: string;
  landmark?: RecognitionResult | null;
}

interface AIChatScreenProps {
  isActive?: boolean;
  initialQuestion?: string;
  onInitialQuestionConsumed?: () => void;
  landmarkContext?: RecognitionResult | null;
  selectedLanguage: Language;
  visitedHistory: RecognitionResult[];
  onBackToHome: () => void;
  guideSettings?: GuideSettings;
  onUpdateSpeechRate?: (rate: number) => void;
  onSaveToJournal?: (payload: AiGuideJournalSavePayload) => Promise<void>;
  defaultCity?: string;
  defaultCountry?: string;
  isLandmarkSaved?: boolean;
  persistedMessages?: ChatMessage[];
  onMessagesChange?: React.Dispatch<React.SetStateAction<ChatMessage[]>>;
  ownerId?: string;
}

function createWelcomeMessage(
  language: Language,
  conversationId: string,
  topicTitle?: string
): ChatMessage {
  const nowIso = new Date().toISOString();
  return {
    id: `welcome-msg-${conversationId}`,
    conversationId,
    sender: 'guide',
    text: getLocalizedChatGreeting(language, topicTitle),
    timestamp: new Date().toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' }),
    createdAt: nowIso,
    status: 'done',
  };
}

function createFreshDraftConversation(params: {
  ownerId: string;
  language: Language;
  landmark?: RecognitionResult | null;
}): AiChatConversation {
  const id = generateSafeChatId('chat');
  const nowIso = new Date().toISOString();
  const topicCtx = landmarkToTopicContext(params.landmark);
  const title = topicCtx?.placeName || 'New Chat';
  return {
    id,
    title,
    createdAt: nowIso,
    updatedAt: nowIso,
    messages: [createWelcomeMessage(params.language, id, topicCtx?.placeName)],
    rollingSummary: '',
    activeTopicContext: topicCtx,
    landmarkContext: params.landmark || null,
    languageCode: params.language.code,
    ownerId: params.ownerId,
    hasUserMessages: false,
  };
}

export const AIChatScreen: React.FC<AIChatScreenProps> = ({
  isActive = true,
  initialQuestion,
  onInitialQuestionConsumed,
  landmarkContext,
  selectedLanguage,
  visitedHistory,
  onBackToHome,
  guideSettings,
  onUpdateSpeechRate,
  onSaveToJournal,
  defaultCity,
  defaultCountry,
  isLandmarkSaved = false,
  onMessagesChange,
  ownerId = 'guest',
}) => {
  const strings = useMemo(() => getAiChatStrings(selectedLanguage), [selectedLanguage]);
  const isRtl = selectedLanguage.direction === 'rtl';

  const [conversations, setConversations] = useState<AiChatConversation[]>([]);
  const [draftConversation, setDraftConversation] = useState<AiChatConversation>(() =>
    createFreshDraftConversation({
      ownerId,
      language: selectedLanguage,
      landmark: landmarkContext,
    })
  );
  const [activeConversationId, setActiveConversationId] = useState<string>(draftConversation.id);
  const [isHistoryOpen, setIsHistoryOpen] = useState(false);

  const [inputMessage, setInputMessage] = useState('');
  const [pendingConvIds, setPendingConvIds] = useState<Set<string>>(() => new Set());
  const [streamingMsgIdByConv, setStreamingMsgIdByConv] = useState<Record<string, string | null>>({});
  const [isListening, setIsListening] = useState(false);
  const [voiceNotice, setVoiceNotice] = useState<string | null>(null);

  // Inline Save to Journal modal/card state
  const [isSaveCardOpen, setIsSaveCardOpen] = useState(false);
  const [savePlaceName, setSavePlaceName] = useState(landmarkContext?.title || '');
  const [saveCity, setSaveCity] = useState(landmarkContext?.city || defaultCity || '');
  const [saveCountry, setSaveCountry] = useState(landmarkContext?.country || defaultCountry || 'India');
  const [saveVisitDate, setSaveVisitDate] = useState(getTodayDateStr());
  const [saveNotes, setSaveNotes] = useState('');
  const [saveSummary, setSaveSummary] = useState(landmarkContext?.summary || '');
  const [savePhotoDataUrl, setSavePhotoDataUrl] = useState<string>(landmarkContext?.photoDataUrl || '');
  const [isSavingJournal, setIsSavingJournal] = useState(false);
  const [journalSaveError, setJournalSaveError] = useState<string | null>(null);
  const [journalSavedSuccess, setJournalSavedSuccess] = useState(false);

  const savePhotoInputRef = useRef<HTMLInputElement | null>(null);
  const historyBtnRef = useRef<HTMLButtonElement | null>(null);
  const composerInputRef = useRef<HTMLInputElement | null>(null);

  const inFlightControllersRef = useRef<Map<string, AbortController>>(new Map());
  const recognitionRef = useRef<any>(null);
  const isMountedRef = useRef(true);
  const isActiveRef = useRef(isActive);
  isActiveRef.current = isActive;
  const ownerIdRef = useRef(ownerId);
  ownerIdRef.current = ownerId;
  const activeConvIdRef = useRef(activeConversationId);
  activeConvIdRef.current = activeConversationId;
  const conversationsRef = useRef<AiChatConversation[]>(conversations);
  conversationsRef.current = conversations;
  const draftConvRef = useRef<AiChatConversation>(draftConversation);
  draftConvRef.current = draftConversation;
  const ownerLoadSeqRef = useRef(0);
  const initialQuestionHandledRef = useRef<string | null>(null);

  const activeConversation = useMemo(() => {
    const found = conversations.find((c) => c.id === activeConversationId);
    if (found) return found;
    if (draftConversation.id === activeConversationId) return draftConversation;
    return draftConversation;
  }, [conversations, draftConversation, activeConversationId]);

  const activeMessages = activeConversation.messages;
  const activeTopicContext: AiChatTopicContext | null =
    activeConversation.activeTopicContext || null;
  const activeLandmark: RecognitionResult | null =
    activeConversation.landmarkContext ||
    (activeTopicContext ? landmarkContext || null : null);

  const isTypingInActive =
    pendingConvIds.has(activeConversation.id) &&
    !streamingMsgIdByConv[activeConversation.id];
  const isSendingInActive = pendingConvIds.has(activeConversation.id);
  const activeStreamingMsgId = streamingMsgIdByConv[activeConversation.id] || null;

  const messagesContainerRef = usePreservedScroll<HTMLDivElement>(
    `tab:chat:${activeConversation.id}`,
    isActive
  );

  // Sync legacy persistedMessages prop cleanly when active conversation messages change
  useEffect(() => {
    if (onMessagesChange) {
      onMessagesChange(activeMessages);
    }
  }, [activeMessages, onMessagesChange]);

  // Keep welcome message localized on fresh un-messaged draft chat when language changes
  useEffect(() => {
    setDraftConversation((prev) => {
      if (hasRealUserMessages(prev)) return prev;
      const updatedWelcome = createWelcomeMessage(
        selectedLanguage,
        prev.id,
        prev.activeTopicContext?.placeName
      );
      if (prev.messages.length === 1 && prev.messages[0]?.text === updatedWelcome.text) {
        return prev;
      }
      return {
        ...prev,
        languageCode: selectedLanguage.code,
        messages: [updatedWelcome],
      };
    });
  }, [selectedLanguage.code, selectedLanguage.nativeName, selectedLanguage.name]);

  // Abort & cleanup helper for owner switch or unmount
  const abortAllInFlightRequests = useCallback(() => {
    inFlightControllersRef.current.forEach((ctrl) => {
      try {
        ctrl.abort();
      } catch {
        // ignore
      }
    });
    inFlightControllersRef.current.clear();
    setPendingConvIds(new Set());
    setStreamingMsgIdByConv({});
  }, []);

  const stopVoiceRecognition = useCallback(() => {
    if (recognitionRef.current) {
      try {
        recognitionRef.current.stop();
      } catch {
        // ignore
      }
      recognitionRef.current = null;
    }
    setIsListening(false);
    speechManager.stop();
  }, []);

  useEffect(() => {
    isMountedRef.current = true;
    return () => {
      isMountedRef.current = false;
      abortAllInFlightRequests();
      stopVoiceRecognition();
    };
  }, [abortAllInFlightRequests, stopVoiceRecognition]);

  useEffect(() => {
    if (!isActive) {
      stopVoiceRecognition();
    }
  }, [isActive, stopVoiceRecognition]);

  // Load owner-scoped conversations cleanly on startup and whenever signed-in user / guest changes
  useEffect(() => {
    const seq = ++ownerLoadSeqRef.current;
    abortAllInFlightRequests();
    setIsHistoryOpen(false);
    setConversations([]);

    const freshDraft = createFreshDraftConversation({
      ownerId,
      language: selectedLanguage,
      landmark: landmarkContext,
    });
    setDraftConversation(freshDraft);
    setActiveConversationId(freshDraft.id);

    loadConversationsForOwner(ownerId)
      .then((loaded) => {
        if (!isMountedRef.current || ownerLoadSeqRef.current !== seq) return;
        setConversations((prev) => {
          const merged = new Map<string, AiChatConversation>();
          for (const c of loaded) merged.set(c.id, c);
          for (const c of prev) {
            if (!hasRealUserMessages(c)) continue;
            const existing = merged.get(c.id);
            if (
              !existing ||
              c.messages.length >= existing.messages.length ||
              Date.parse(c.updatedAt || '') >= Date.parse(existing.updatedAt || '')
            ) {
              merged.set(c.id, c);
            }
          }
          return sortConversationsNewestFirst(Array.from(merged.values()));
        });

        // If user came with an explicit landmark/question from another screen, keep the fresh contextual chat active
        if (initialQuestion || inFlightControllersRef.current.size > 0) return;

        const storedActiveId = getStoredActiveConversationId(ownerId);
        if (storedActiveId && loaded.some((c) => c.id === storedActiveId)) {
          setActiveConversationId(storedActiveId);
        } else if (loaded.length > 0 && !landmarkContext) {
          setActiveConversationId(loaded[0].id);
        }
      })
      .catch((err) => {
        console.warn('Unable to load AI chat history:', err);
      });
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [ownerId]);

  // Persist active conversation selection pointer per owner when selecting an existing saved chat
  useEffect(() => {
    if (conversations.some((c) => c.id === activeConversationId)) {
      setStoredActiveConversationId(ownerId, activeConversationId);
    }
  }, [ownerId, activeConversationId, conversations]);

  useBackLayer(
    'ai-chat-history-drawer',
    isActive && isHistoryOpen,
    () => setIsHistoryOpen(false),
    65
  );

  useBackLayer(
    'ai-chat-save-card',
    isActive && isSaveCardOpen,
    () => setIsSaveCardOpen(false),
    45
  );

  const handleBackClick = () => {
    if (isHistoryOpen) {
      setIsHistoryOpen(false);
      return;
    }
    if (isSaveCardOpen) {
      setIsSaveCardOpen(false);
      return;
    }
    stopVoiceRecognition();
    setIsSaveCardOpen(false);
    setVoiceNotice(null);
    onBackToHome();
  };

  const handleStartNewChat = useCallback(
    (explicitLandmark?: RecognitionResult | null) => {
      const fresh = createFreshDraftConversation({
        ownerId: ownerIdRef.current,
        language: selectedLanguage,
        landmark: explicitLandmark || null,
      });
      setDraftConversation(fresh);
      setActiveConversationId(fresh.id);
      setStoredActiveConversationId(ownerIdRef.current, null);
      setInputMessage('');
      setVoiceNotice(null);
      setIsSaveCardOpen(false);
      setJournalSavedSuccess(false);
      window.setTimeout(() => {
        composerInputRef.current?.focus();
      }, 40);
      return fresh;
    },
    [selectedLanguage]
  );

  const updateConversationById = useCallback(
    (
      convId: string,
      updater: (conv: AiChatConversation) => AiChatConversation,
      options?: { persist?: boolean }
    ) => {
      const owner = ownerIdRef.current;
      let updatedSnapshot: AiChatConversation | null = null;

      setConversations((prev) => {
        const existsIdx = prev.findIndex((c) => c.id === convId);
        if (existsIdx >= 0) {
          const nextConv = updater(prev[existsIdx]);
          updatedSnapshot = nextConv;
          const nextList = sortConversationsNewestFirst(
            prev.map((c) => (c.id === convId ? nextConv : c))
          );
          if (options?.persist) {
            void saveConversationForOwner(owner, nextConv, nextList);
          }
          return nextList;
        }
        // Promote draft conversation if this convId belongs to draft and now has user message
        const currentDraft = draftConvRef.current;
        if (currentDraft.id === convId) {
          const promoted = updater(currentDraft);
          updatedSnapshot = promoted;
          if (hasRealUserMessages(promoted)) {
            const nextList = sortConversationsNewestFirst([promoted, ...prev]);
            if (options?.persist) {
              void saveConversationForOwner(owner, promoted, nextList);
            }
            return nextList;
          }
        }
        return prev;
      });

      if (!updatedSnapshot && draftConvRef.current.id === convId) {
        setDraftConversation((prev) => {
          if (prev.id !== convId) return prev;
          return updater(prev);
        });
      }
    },
    []
  );

  const sendMessageToConversation = useCallback(
    async (params: {
      targetConv: AiChatConversation;
      text: string;
      retryErrorMsgId?: string;
    }) => {
      const cleanText = params.text.trim();
      if (!cleanText) return;

      const convId = params.targetConv.id;
      if (inFlightControllersRef.current.has(convId)) {
        return; // duplicate submit guard for this conversation
      }

      const currentOwner = ownerIdRef.current;
      const isRetry = Boolean(params.retryErrorMsgId);
      const now = new Date();
      const nowIso = now.toISOString();
      const displayTime = now.toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' });
      const guideMsgId = `msg-guide-${Date.now()}_${Math.random().toString(36).slice(2, 6)}`;

      const priorHistory = params.targetConv.messages
        .filter((m) => m.id !== params.retryErrorMsgId && m.status !== 'error')
        .map((m) => ({
          sender: m.sender,
          text: m.text,
          status: m.status,
        }));

      const firstUserTurn = !hasRealUserMessages(params.targetConv);
      const autoTitle =
        firstUserTurn &&
        (!params.targetConv.title ||
          params.targetConv.title === 'New Chat' ||
          params.targetConv.title === params.targetConv.activeTopicContext?.placeName)
          ? generateConversationTitleFromMessage(
              cleanText,
              params.targetConv.activeTopicContext?.placeName
            )
          : params.targetConv.title;

      const userMsg: ChatMessage = {
        id: `msg-user-${Date.now()}_${Math.random().toString(36).slice(2, 5)}`,
        conversationId: convId,
        sender: 'user',
        text: cleanText,
        timestamp: displayTime,
        createdAt: nowIso,
        status: 'done',
      };

      const initialUpdatedConv: AiChatConversation = {
        ...params.targetConv,
        title: autoTitle,
        updatedAt: nowIso,
        hasUserMessages: true,
        languageCode: selectedLanguage.code,
        messages: isRetry
          ? params.targetConv.messages.filter((m) => m.id !== params.retryErrorMsgId)
          : [...params.targetConv.messages, userMsg],
      };

      // Persist immediately so user message survives mid-flight reload
      setConversations((prev) => {
        const filtered = prev.filter((c) => c.id !== convId);
        const nextList = sortConversationsNewestFirst([initialUpdatedConv, ...filtered]);
        void saveConversationForOwner(currentOwner, initialUpdatedConv, nextList);
        return nextList;
      });
      if (draftConvRef.current.id === convId) {
        const freshReplacement = createFreshDraftConversation({
          ownerId: currentOwner,
          language: selectedLanguage,
          landmark: null,
        });
        setDraftConversation(freshReplacement);
      }
      setActiveConversationId(convId);
      setStoredActiveConversationId(currentOwner, convId);
      if (!isRetry && activeConvIdRef.current === convId) {
        setInputMessage('');
      }

      const controller = new AbortController();
      inFlightControllersRef.current.set(convId, controller);
      setPendingConvIds((prev) => {
        const next = new Set(prev);
        next.add(convId);
        return next;
      });

      const requestPayload = {
        conversationId: convId,
        message: cleanText,
        historyMessages: priorHistory,
        rollingSummary: params.targetConv.rollingSummary || '',
        activeTopicContext: params.targetConv.activeTopicContext || undefined,
        landmarkContext: params.targetConv.landmarkContext
          ? {
              id: params.targetConv.landmarkContext.id,
              title: params.targetConv.landmarkContext.title,
              locationName: params.targetConv.landmarkContext.locationName,
              summary: params.targetConv.landmarkContext.summary,
            }
          : undefined,
        language: selectedLanguage.name,
        history: visitedHistory.map((h) => h.title),
        topics: guideSettings?.topics,
        persona: guideSettings?.persona || 'warm_female',
        voiceGender: guideSettings?.voiceGender || 'female',
      };

      let accumulatedReply = '';
      let updatedRollingSummaryFromServer = params.targetConv.rollingSummary || '';
      let streamBubbleInserted = false;
      let streamHadErrorEvent: string | null = null;

      try {
        const streamRes = await fetch('/api/chat-stream', {
          method: 'POST',
          headers: {
            'Content-Type': 'application/json',
            Accept: 'text/event-stream',
          },
          body: JSON.stringify(requestPayload),
          signal: controller.signal,
        });

        if (!streamRes.ok || !streamRes.body) {
          throw new Error(`Stream unavailable (${streamRes.status})`);
        }

        const reader = streamRes.body.getReader();
        const decoder = new TextDecoder('utf-8');
        let buffer = '';

        const handleEventBlock = (block: string) => {
          if (!isMountedRef.current || controller.signal.aborted) return;
          const lines = block
            .split(/\r?\n/)
            .filter((l) => l.startsWith('data:'))
            .map((l) => l.replace(/^data:\s*/, ''));
          if (lines.length === 0) return;

          try {
            const parsed = JSON.parse(lines.join('\n'));
            if (parsed.type === 'error') {
              streamHadErrorEvent = parsed.data?.message || 'Chat stream error';
              return;
            }
            if (parsed.type === 'delta' && parsed.data?.text) {
              accumulatedReply += parsed.data.text;
              const snapshot = accumulatedReply;
              if (!streamBubbleInserted) {
                streamBubbleInserted = true;
                setStreamingMsgIdByConv((prev) => ({ ...prev, [convId]: guideMsgId }));
                updateConversationById(convId, (conv) => ({
                  ...conv,
                  updatedAt: new Date().toISOString(),
                  messages: [
                    ...conv.messages,
                    {
                      id: guideMsgId,
                      conversationId: convId,
                      sender: 'guide',
                      text: snapshot,
                      timestamp: displayTime,
                      createdAt: new Date().toISOString(),
                      status: 'sending',
                    },
                  ],
                }));
              } else {
                updateConversationById(convId, (conv) => ({
                  ...conv,
                  messages: conv.messages.map((m) =>
                    m.id === guideMsgId ? { ...m, text: snapshot } : m
                  ),
                }));
              }
            } else if (parsed.type === 'done' && parsed.data?.reply) {
              accumulatedReply = parsed.data.reply;
              if (typeof parsed.data.updatedRollingSummary === 'string') {
                updatedRollingSummaryFromServer = parsed.data.updatedRollingSummary;
              }
            }
          } catch {
            // ignore malformed SSE fragment
          }
        };

        while (true) {
          const { done, value } = await reader.read();
          if (!isMountedRef.current || controller.signal.aborted) return;
          if (done) {
            if (buffer.trim()) handleEventBlock(buffer);
            break;
          }
          buffer += decoder.decode(value, { stream: true });
          const blocks = buffer.split(/\r?\n\r?\n/);
          buffer = blocks.pop() || '';
          for (const blk of blocks) {
            handleEventBlock(blk);
          }
        }

        if (!isMountedRef.current || controller.signal.aborted) return;

        if (streamHadErrorEvent || !accumulatedReply.trim()) {
          throw new Error(streamHadErrorEvent || 'Empty AI response');
        }

        const finalReply = accumulatedReply.trim();
        const doneTime = new Date().toISOString();

        updateConversationById(
          convId,
          (conv) => {
            const hasGuideBubble = conv.messages.some((m) => m.id === guideMsgId);
            const updatedMessages: ChatMessage[] = hasGuideBubble
              ? conv.messages.map((m) =>
                  m.id === guideMsgId ? { ...m, text: finalReply, status: 'done' as const } : m
                )
              : [
                  ...conv.messages,
                  {
                    id: guideMsgId,
                    conversationId: convId,
                    sender: 'guide',
                    text: finalReply,
                    timestamp: displayTime,
                    createdAt: doneTime,
                    status: 'done',
                  },
                ];
            return {
              ...conv,
              updatedAt: doneTime,
              rollingSummary: updatedRollingSummaryFromServer || conv.rollingSummary,
              messages: updatedMessages,
            };
          },
          { persist: true }
        );

        if (
          guideSettings?.outputMode !== 'text' &&
          isMountedRef.current &&
          isActiveRef.current &&
          activeConvIdRef.current === convId &&
          !controller.signal.aborted
        ) {
          speechManager.speak({
            text: finalReply,
            language: selectedLanguage.name,
            languageCode: selectedLanguage.speechCode,
            gender: guideSettings?.voiceGender || 'female',
            pitch: guideSettings?.voicePitch,
            rate: guideSettings?.speechRate || 1.0,
          });
        }
      } catch (streamErr: any) {
        if (streamErr?.name === 'AbortError' || controller.signal.aborted || !isMountedRef.current) {
          return;
        }
        console.warn('Chat SSE fallback to standard endpoint:', streamErr);
        try {
          const response = await fetch('/api/chat', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify(requestPayload),
            signal: controller.signal,
          });
          if (!isMountedRef.current || controller.signal.aborted) return;
          const data = await response.json().catch(() => ({}));
          if (!response.ok || !data?.reply) {
            throw new Error(data?.error || `Chat request failed (${response.status})`);
          }

          const replyText = String(data.reply).trim();
          const summaryNext =
            typeof data.updatedRollingSummary === 'string'
              ? data.updatedRollingSummary
              : updatedRollingSummaryFromServer;
          const doneTime = new Date().toISOString();

          updateConversationById(
            convId,
            (conv) => {
              const hasGuideBubble = conv.messages.some((m) => m.id === guideMsgId);
              const updatedMessages: ChatMessage[] = hasGuideBubble
                ? conv.messages.map((m) =>
                    m.id === guideMsgId ? { ...m, text: replyText, status: 'done' as const } : m
                  )
                : [
                    ...conv.messages,
                    {
                      id: guideMsgId,
                      conversationId: convId,
                      sender: 'guide',
                      text: replyText,
                      timestamp: displayTime,
                      createdAt: doneTime,
                      status: 'done',
                    },
                  ];
              return {
                ...conv,
                updatedAt: doneTime,
                rollingSummary: summaryNext || conv.rollingSummary,
                messages: updatedMessages,
              };
            },
            { persist: true }
          );

          if (
            guideSettings?.outputMode !== 'text' &&
            isMountedRef.current &&
            isActiveRef.current &&
            activeConvIdRef.current === convId &&
            !controller.signal.aborted
          ) {
            speechManager.speak({
              text: replyText,
              language: selectedLanguage.name,
              languageCode: selectedLanguage.speechCode,
              gender: guideSettings?.voiceGender || 'female',
              pitch: guideSettings?.voicePitch,
              rate: guideSettings?.speechRate || 1.0,
            });
          }
        } catch (err: any) {
          if (err?.name === 'AbortError' || controller.signal.aborted || !isMountedRef.current) {
            return;
          }
          console.error('Chat error:', err);
          const errNotice = strings.errorPreservedNotice;
          const failTime = new Date().toISOString();
          updateConversationById(
            convId,
            (conv) => {
              const hasGuideBubble = conv.messages.some((m) => m.id === guideMsgId);
              const errMsg: ChatMessage = {
                id: guideMsgId,
                conversationId: convId,
                sender: 'guide',
                text: errNotice,
                timestamp: displayTime,
                createdAt: failTime,
                status: 'error',
                errorMessage: err?.message || 'Request failed',
                retryForUserText: cleanText,
              };
              return {
                ...conv,
                updatedAt: failTime,
                messages: hasGuideBubble
                  ? conv.messages.map((m) => (m.id === guideMsgId ? errMsg : m))
                  : [...conv.messages, errMsg],
              };
            },
            { persist: true }
          );
        }
      } finally {
        if (inFlightControllersRef.current.get(convId) === controller) {
          inFlightControllersRef.current.delete(convId);
        }
        if (isMountedRef.current) {
          setPendingConvIds((prev) => {
            if (!prev.has(convId)) return prev;
            const next = new Set(prev);
            next.delete(convId);
            return next;
          });
          setStreamingMsgIdByConv((prev) => {
            if (!prev[convId]) return prev;
            const copy = { ...prev };
            delete copy[convId];
            return copy;
          });
        }
      }
    },
    [guideSettings, selectedLanguage, strings.errorPreservedNotice, updateConversationById, visitedHistory]
  );

  // Launch a fresh contextual chat whenever another screen opens AI Guide with a specific question
  useEffect(() => {
    if (!initialQuestion || !initialQuestion.trim()) {
      initialQuestionHandledRef.current = null;
      return;
    }
    const key = `${landmarkContext?.id || 'none'}::${initialQuestion}`;
    if (initialQuestionHandledRef.current === key) return;
    initialQuestionHandledRef.current = key;

    const contextualChat = createFreshDraftConversation({
      ownerId: ownerIdRef.current,
      language: selectedLanguage,
      landmark: landmarkContext,
    });
    setDraftConversation(contextualChat);
    setActiveConversationId(contextualChat.id);
    onInitialQuestionConsumed?.();
    void sendMessageToConversation({
      targetConv: contextualChat,
      text: initialQuestion,
    });
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [initialQuestion, landmarkContext?.id]);

  // Smooth auto-scroll when new messages arrive inside active conversation
  const lastActiveMsgText = activeMessages[activeMessages.length - 1]?.text || '';
  useEffect(() => {
    const container = messagesContainerRef.current;
    if (!container || !isActive) return;
    container.scrollTo({
      top: container.scrollHeight,
      behavior: 'smooth',
    });
  }, [activeMessages.length, lastActiveMsgText, isTypingInActive, isActive, messagesContainerRef]);

  const handleSendMessage = (textToSend?: string) => {
    const text = (textToSend ?? inputMessage).trim();
    if (!text) return;
    const currentConv =
      conversationsRef.current.find((c) => c.id === activeConvIdRef.current) ||
      draftConvRef.current;
    if (pendingConvIds.has(currentConv.id)) return;
    void sendMessageToConversation({
      targetConv: currentConv,
      text,
    });
  };

  const handleRetryErrorMessage = (errorMsg: ChatMessage) => {
    if (!errorMsg.retryForUserText) return;
    const currentConv =
      conversationsRef.current.find((c) => c.id === activeConvIdRef.current) ||
      draftConvRef.current;
    if (pendingConvIds.has(currentConv.id)) return;
    void sendMessageToConversation({
      targetConv: currentConv,
      text: errorMsg.retryForUserText,
      retryErrorMsgId: errorMsg.id,
    });
  };

  const handleSelectConversation = (conversationId: string) => {
    setActiveConversationId(conversationId);
    setStoredActiveConversationId(ownerIdRef.current, conversationId);
    setIsSaveCardOpen(false);
    setVoiceNotice(null);
  };

  const handleRenameConversation = async (conversationId: string, newTitle: string) => {
    const trimmed = newTitle.trim();
    if (!trimmed) return;
    const nowIso = new Date().toISOString();
    const updatedList = sortConversationsNewestFirst(
      conversationsRef.current.map((c) =>
        c.id === conversationId ? { ...c, title: trimmed, updatedAt: nowIso } : c
      )
    );
    setConversations(updatedList);
    await renameConversationForOwner(ownerIdRef.current, conversationId, trimmed, updatedList);
  };

  const handleDeleteConversation = async (conversationId: string) => {
    // Abort any in-flight request belonging strictly to the deleted conversation
    const ctrl = inFlightControllersRef.current.get(conversationId);
    if (ctrl) {
      try {
        ctrl.abort();
      } catch {
        // ignore
      }
      inFlightControllersRef.current.delete(conversationId);
      setPendingConvIds((prev) => {
        if (!prev.has(conversationId)) return prev;
        const next = new Set(prev);
        next.delete(conversationId);
        return next;
      });
    }

    const remaining = conversationsRef.current.filter((c) => c.id !== conversationId);
    setConversations(remaining);

    if (activeConvIdRef.current === conversationId) {
      if (remaining.length > 0) {
        setActiveConversationId(remaining[0].id);
        setStoredActiveConversationId(ownerIdRef.current, remaining[0].id);
      } else {
        handleStartNewChat(null);
      }
    }

    await deleteConversationForOwner(ownerIdRef.current, conversationId, remaining);
  };

  const handleOpenSaveJournalCard = () => {
    const latestGuideReply = [...activeMessages]
      .reverse()
      .find((m) => m.sender === 'guide' && !m.id.startsWith('welcome-msg') && m.status !== 'error')
      ?.text;
    const topicTitle =
      activeTopicContext?.placeName ||
      activeLandmark?.title ||
      (activeConversation.title !== 'New Chat' ? activeConversation.title : '');
    setSavePlaceName((prev) => prev || topicTitle);
    setSaveCity((prev) => prev || activeLandmark?.city || defaultCity || '');
    setSaveCountry((prev) => prev || activeLandmark?.country || defaultCountry || 'India');
    setSaveVisitDate((prev) => prev || getTodayDateStr());
    setSaveSummary(
      (prev) =>
        prev ||
        activeTopicContext?.summary ||
        activeLandmark?.summary ||
        (latestGuideReply ? latestGuideReply.slice(0, 600) : '')
    );
    if (!savePhotoDataUrl && activeLandmark?.photoDataUrl) {
      setSavePhotoDataUrl(activeLandmark.photoDataUrl);
    } else if (!savePhotoDataUrl && activeLandmark?.imageUrl?.startsWith('data:image/')) {
      compressImageToJournalDataUrl(activeLandmark.imageUrl, 560, 82000)
        .then((compressed) => {
          if (compressed && isMountedRef.current) setSavePhotoDataUrl(compressed);
        })
        .catch(() => {});
    }
    setJournalSaveError(null);
    setIsSaveCardOpen(true);
  };

  const handleConfirmSaveToJournal = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!onSaveToJournal || isSavingJournal) return;
    const cleanPlace = savePlaceName.trim();
    if (!cleanPlace) {
      setJournalSaveError('Please enter the destination or place name you visited.');
      return;
    }

    setIsSavingJournal(true);
    setJournalSaveError(null);
    try {
      await onSaveToJournal({
        placeName: cleanPlace,
        city: saveCity.trim(),
        country: saveCountry.trim(),
        visitDate: saveVisitDate || getTodayDateStr(),
        notes: saveNotes.trim(),
        guideSummary: saveSummary.trim(),
        photoDataUrl: savePhotoDataUrl || undefined,
        landmark: activeLandmark,
      });
      if (!isMountedRef.current) return;
      setJournalSavedSuccess(true);
      setIsSaveCardOpen(false);
      setSaveNotes('');
      setSavePhotoDataUrl('');
    } catch (err: any) {
      if (!isMountedRef.current) return;
      setJournalSaveError(err?.message || 'Unable to save journal entry. Please try again.');
    } finally {
      if (isMountedRef.current) {
        setIsSavingJournal(false);
      }
    }
  };

  const handleToggleVoiceInput = () => {
    const SpeechRecognition =
      (window as any).SpeechRecognition || (window as any).webkitSpeechRecognition;

    if (!SpeechRecognition) {
      setVoiceNotice(
        'Voice dictation is not supported in this browser. Please type your question below.'
      );
      setTimeout(() => {
        if (isMountedRef.current) setVoiceNotice(null);
      }, 4000);
      return;
    }

    if (isListening) {
      if (recognitionRef.current) {
        try {
          recognitionRef.current.stop();
        } catch {
          // ignore
        }
        recognitionRef.current = null;
      }
      setIsListening(false);
      return;
    }

    try {
      const recognition = new SpeechRecognition();
      recognitionRef.current = recognition;
      recognition.lang = selectedLanguage.speechCode;
      recognition.continuous = false;
      recognition.interimResults = false;

      recognition.onstart = () => {
        if (isMountedRef.current) setIsListening(true);
      };
      recognition.onend = () => {
        recognitionRef.current = null;
        if (isMountedRef.current) setIsListening(false);
      };
      recognition.onerror = () => {
        recognitionRef.current = null;
        if (isMountedRef.current) setIsListening(false);
      };

      recognition.onresult = (event: any) => {
        if (!isMountedRef.current) return;
        const transcript = event.results[0][0].transcript;
        if (transcript) {
          setInputMessage(transcript);
          handleSendMessage(transcript);
        }
      };

      recognition.start();
    } catch (e) {
      console.error('Speech recognition error:', e);
      recognitionRef.current = null;
      setIsListening(false);
    }
  };

  const showSuggestedQuestions = !hasRealUserMessages(activeConversation);
  const suggestedQuestionsList = useMemo(() => {
    const landmarkQs = activeLandmark?.suggestedQuestions?.filter(
      (q) => typeof q === 'string' && q.trim().length > 0
    );
    if (landmarkQs && landmarkQs.length > 0) {
      return landmarkQs.slice(0, 3);
    }
    return [strings.defaultStarterQ1, strings.defaultStarterQ2, strings.defaultStarterQ3];
  }, [activeLandmark?.suggestedQuestions, strings]);

  const activeTitleDisplay =
    activeConversation.title === 'New Chat' ? strings.newChat : activeConversation.title;

  return (
    <div
      id="ai-chat-screen"
      dir={isRtl ? 'rtl' : 'ltr'}
      className="h-full flex flex-col overflow-hidden overflow-clip py-1 space-y-2 select-none"
    >
      {/* Clean Top Header inside AI Guide: History Icon, Active Chat Title, + New Chat, Save to Journal */}
      <div
        style={{
          backgroundColor: 'var(--theme-card-bg)',
          borderColor: 'var(--theme-card-border)',
        }}
        className="shrink-0 flex items-center justify-between gap-2 p-2 border rounded-2xl backdrop-blur-xl shadow-lg"
      >
        <div className="flex items-center gap-1.5 min-w-0 flex-1">
          <BackButton
            id="btn-chat-back-home"
            onClick={handleBackClick}
            selectedLanguage={selectedLanguage}
          />
          <button
            id="btn-chat-history"
            ref={historyBtnRef}
            type="button"
            onClick={() => setIsHistoryOpen(true)}
            aria-label={strings.history}
            aria-expanded={isHistoryOpen}
            aria-controls="ai-chat-history-drawer"
            title={strings.history}
            style={{
              backgroundColor: 'var(--theme-card-bg-subtle)',
              borderColor: 'var(--theme-card-border)',
              color: 'var(--theme-text-title)',
            }}
            className="min-w-[44px] min-h-[44px] rounded-xl border flex items-center justify-center shrink-0 cursor-pointer transition-all hover:border-[var(--theme-card-border-glow)] active:scale-95 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[var(--theme-accent-secondary)]"
          >
            <History className="w-4 h-4 text-[var(--theme-accent-primary)]" />
          </button>

          <div className="min-w-0 flex-1 px-1">
            <h3
              id="ai-chat-active-title"
              className="text-xs sm:text-sm font-serif font-bold text-[var(--theme-text-title)] flex items-center gap-1.5 truncate"
              title={activeTitleDisplay}
            >
              <Bot className="w-4 h-4 text-[var(--theme-accent-primary)] shrink-0" />
              <span className="truncate">{activeTitleDisplay}</span>
            </h3>
            {activeTopicContext?.placeName && (
              <p className="text-[10px] text-[var(--theme-accent-secondary)] truncate font-medium">
                {strings.activeTopic}: <strong>{activeTopicContext.placeName}</strong>
              </p>
            )}
          </div>
        </div>

        <div className="flex items-center gap-1.5 shrink-0">
          <button
            id="btn-chat-new-chat"
            type="button"
            onClick={() => handleStartNewChat(null)}
            title={strings.newChat}
            style={{
              backgroundColor: 'var(--theme-card-bg-subtle)',
              borderColor: 'var(--theme-card-border)',
              color: 'var(--theme-text-title)',
            }}
            className="min-h-[40px] px-2.5 py-1.5 rounded-xl border text-[11px] font-bold inline-flex items-center gap-1 cursor-pointer transition-all hover:border-[var(--theme-card-border-glow)] active:scale-95 whitespace-nowrap shrink-0 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[var(--theme-accent-secondary)]"
          >
            <Plus className="w-3.5 h-3.5 text-[var(--theme-accent-primary)] shrink-0" />
            <span>{strings.newChat}</span>
          </button>

          {onSaveToJournal && (
            <button
              id="btn-chat-save-journal"
              type="button"
              onClick={handleOpenSaveJournalCard}
              style={
                journalSavedSuccess || isLandmarkSaved
                  ? {
                      backgroundColor: 'var(--theme-card-bg-subtle)',
                      borderColor: 'var(--theme-card-border-glow)',
                      color: 'var(--theme-accent-secondary)',
                    }
                  : undefined
              }
              className={`min-h-[40px] px-2.5 py-1.5 rounded-xl text-[11px] font-bold flex items-center gap-1.5 cursor-pointer transition-all active:scale-95 shrink-0 border whitespace-nowrap ${
                journalSavedSuccess || isLandmarkSaved ? 'border' : 'theme-btn-primary'
              }`}
              title={strings.saveToJournal}
              aria-label={strings.saveToJournal}
            >
              {journalSavedSuccess || isLandmarkSaved ? (
                <>
                  <BookmarkCheck className="w-3.5 h-3.5 text-[var(--theme-accent-secondary)] shrink-0" />
                  <span className="hidden sm:inline">{strings.saved}</span>
                </>
              ) : (
                <>
                  <Bookmark className="w-3.5 h-3.5 shrink-0" />
                  <span className="hidden sm:inline">{strings.saveToJournal}</span>
                </>
              )}
            </button>
          )}
        </div>
      </div>

      {/* Inline User-Confirmed Save to Journal Form */}
      {isSaveCardOpen && (
        <form
          onSubmit={handleConfirmSaveToJournal}
          style={{
            backgroundColor: 'var(--theme-card-bg)',
            borderColor: 'var(--theme-card-border-glow)',
          }}
          className="shrink-0 p-3 rounded-2xl border backdrop-blur-xl shadow-xl space-y-2 text-xs"
        >
          <div className="flex items-center justify-between gap-2">
            <span className="font-serif font-bold text-[var(--theme-text-title)] flex items-center gap-1.5">
              <Bookmark className="w-3.5 h-3.5 text-[var(--theme-accent-primary)]" />
              <span>Save Destination to Travel Journal</span>
            </span>
            <button
              type="button"
              onClick={() => setIsSaveCardOpen(false)}
              className="p-1 rounded-lg text-[var(--theme-text-muted)] hover:text-[var(--theme-text-title)] cursor-pointer"
              aria-label={strings.close}
            >
              <X className="w-3.5 h-3.5" />
            </button>
          </div>

          <div className="grid grid-cols-1 sm:grid-cols-3 gap-2">
            <input
              type="text"
              required
              value={savePlaceName}
              onChange={(e) => setSavePlaceName(e.target.value)}
              placeholder="Place Name *"
              style={{
                backgroundColor: 'var(--theme-input-bg)',
                borderColor: 'var(--theme-input-border)',
                color: 'var(--theme-text-title)',
              }}
              className="px-2.5 py-1.5 rounded-xl border text-xs focus:outline-none focus:border-[var(--theme-card-border-glow)]"
            />
            <input
              type="text"
              value={saveCity}
              onChange={(e) => setSaveCity(e.target.value)}
              placeholder="City"
              style={{
                backgroundColor: 'var(--theme-input-bg)',
                borderColor: 'var(--theme-input-border)',
                color: 'var(--theme-text-title)',
              }}
              className="px-2.5 py-1.5 rounded-xl border text-xs focus:outline-none focus:border-[var(--theme-card-border-glow)]"
            />
            <input
              type="date"
              value={saveVisitDate}
              onChange={(e) => setSaveVisitDate(e.target.value)}
              style={{
                backgroundColor: 'var(--theme-input-bg)',
                borderColor: 'var(--theme-input-border)',
                color: 'var(--theme-text-title)',
              }}
              className="px-2.5 py-1.5 rounded-xl border text-xs focus:outline-none focus:border-[var(--theme-card-border-glow)]"
            />
          </div>

          <input
            type="text"
            value={saveNotes}
            onChange={(e) => setSaveNotes(e.target.value)}
            placeholder="Your personal notes from this visit (optional)"
            style={{
              backgroundColor: 'var(--theme-input-bg)',
              borderColor: 'var(--theme-input-border)',
              color: 'var(--theme-text-title)',
            }}
            className="w-full px-2.5 py-1.5 rounded-xl border text-xs focus:outline-none focus:border-[var(--theme-card-border-glow)]"
          />

          <div className="flex items-center gap-2">
            <input
              ref={savePhotoInputRef}
              type="file"
              accept="image/*"
              onChange={async (e) => {
                const file = e.target.files?.[0];
                e.target.value = '';
                if (!file) return;
                const compressed = await compressImageToJournalDataUrl(file, 560, 82000);
                if (compressed && isMountedRef.current) setSavePhotoDataUrl(compressed);
              }}
              className="sr-only"
            />
            {savePhotoDataUrl && (
              <img
                src={savePhotoDataUrl}
                alt={savePlaceName || 'Visit preview'}
                className="w-9 h-9 rounded-lg object-cover border border-[var(--theme-card-border)] shrink-0"
              />
            )}
            <button
              type="button"
              onClick={() => savePhotoInputRef.current?.click()}
              style={{
                backgroundColor: 'var(--theme-input-bg)',
                borderColor: 'var(--theme-input-border)',
                color: 'var(--theme-text-title)',
              }}
              className="px-2.5 py-1 rounded-lg border text-[11px] font-semibold flex items-center gap-1 cursor-pointer"
            >
              <Camera className="w-3.5 h-3.5 text-[var(--theme-accent-primary)]" />
              <span>{savePhotoDataUrl ? 'Change Photo' : 'Attach Photo'}</span>
            </button>
            {savePhotoDataUrl && (
              <button
                type="button"
                onClick={() => setSavePhotoDataUrl('')}
                className="text-[11px] text-rose-400 hover:underline cursor-pointer"
              >
                Remove
              </button>
            )}
          </div>

          {journalSaveError && (
            <p className="text-[11px] text-rose-400 font-medium">{journalSaveError}</p>
          )}

          <div className="flex items-center justify-end gap-2">
            <button
              type="button"
              onClick={() => setIsSaveCardOpen(false)}
              style={{
                backgroundColor: 'var(--theme-card-bg-subtle)',
                borderColor: 'var(--theme-card-border)',
                color: 'var(--theme-text-muted)',
              }}
              className="px-3 py-1.5 rounded-xl border text-[11px] font-semibold cursor-pointer"
            >
              {strings.cancel}
            </button>
            <button
              type="submit"
              disabled={isSavingJournal}
              className="px-3 py-1.5 rounded-xl theme-btn-primary text-[11px] font-bold flex items-center gap-1 cursor-pointer disabled:opacity-60"
            >
              <Check className="w-3.5 h-3.5" />
              <span>{isSavingJournal ? 'Saving...' : 'Confirm & Save'}</span>
            </button>
          </div>
        </form>
      )}

      {/* Active Conversation Messages Area */}
      <div
        id="ai-chat-messages-scroll"
        ref={messagesContainerRef}
        className="flex-1 min-h-0 overflow-y-auto space-y-2.5 px-1 py-1 select-text"
      >
        {activeMessages.map((msg) => {
          const isUser = msg.sender === 'user';
          const isError = msg.status === 'error';
          return (
            <div
              key={msg.id}
              data-message-sender={msg.sender}
              className={`flex items-start gap-2 ${isUser ? 'flex-row-reverse' : 'flex-row'}`}
            >
              <div
                style={
                  isUser
                    ? {
                        background: 'var(--theme-accent-primary-gradient)',
                        color: 'var(--theme-accent-primary-text)',
                      }
                    : isError
                    ? {
                        backgroundColor: 'rgba(225, 29, 72, 0.16)',
                        borderColor: 'rgba(244, 63, 94, 0.45)',
                        color: '#fb7185',
                      }
                    : {
                        backgroundColor: 'var(--theme-card-bg)',
                        borderColor: 'var(--theme-card-border)',
                        color: 'var(--theme-accent-primary)',
                      }
                }
                className={`w-7 h-7 rounded-full flex items-center justify-center shrink-0 shadow-md ${
                  !isUser ? 'border' : ''
                }`}
              >
                {isUser ? (
                  <User className="w-3.5 h-3.5" />
                ) : isError ? (
                  <AlertCircle className="w-3.5 h-3.5" />
                ) : (
                  <Bot className="w-3.5 h-3.5" />
                )}
              </div>

              <div
                style={
                  isUser
                    ? {
                        background: 'var(--theme-accent-primary-gradient)',
                        color: 'var(--theme-accent-primary-text)',
                      }
                    : isError
                    ? {
                        backgroundColor: 'var(--theme-card-bg)',
                        borderColor: 'rgba(244, 63, 94, 0.45)',
                        color: 'var(--theme-text-title)',
                      }
                    : {
                        backgroundColor: 'var(--theme-card-bg)',
                        borderColor: 'var(--theme-card-border)',
                        color: 'var(--theme-text-title)',
                      }
                }
                className={`max-w-[82%] p-3 rounded-2xl text-xs leading-relaxed ${
                  isUser
                    ? 'font-medium rounded-tr-sm shadow-md'
                    : 'border rounded-tl-sm shadow-sm backdrop-blur-md'
                }`}
              >
                <p className="whitespace-pre-line font-sans">
                  {isUser || isError ? (
                    msg.text
                  ) : (
                    <WordByWordText
                      text={msg.text}
                      isStreaming={msg.id === activeStreamingMsgId}
                    />
                  )}
                </p>

                {isError && msg.retryForUserText && (
                  <button
                    type="button"
                    onClick={() => handleRetryErrorMessage(msg)}
                    disabled={isSendingInActive}
                    className="mt-2 min-h-[36px] px-3 py-1 rounded-xl theme-btn-primary text-[11px] font-bold inline-flex items-center gap-1.5 cursor-pointer disabled:opacity-50"
                  >
                    <RotateCcw className="w-3.5 h-3.5" />
                    <span>{strings.retry}</span>
                  </button>
                )}

                <span
                  style={{
                    color: isUser ? 'var(--theme-accent-primary-text)' : 'var(--theme-text-muted)',
                    opacity: isUser ? 0.8 : 1,
                  }}
                  className="text-[9px] block mt-1"
                >
                  {msg.timestamp}
                </span>
              </div>
            </div>
          );
        })}

        {/* Suggested Questions on fresh chat */}
        {showSuggestedQuestions && suggestedQuestionsList.length > 0 && (
          <div id="ai-chat-suggested-questions" className="pt-1 space-y-1.5">
            <p className="text-[10px] font-bold uppercase tracking-wider text-[var(--theme-text-muted)] px-1">
              {strings.suggestedQuestions}
            </p>
            <div className="flex flex-wrap gap-1.5">
              {suggestedQuestionsList.map((q, idx) => (
                <button
                  key={`${idx}-${q.slice(0, 24)}`}
                  type="button"
                  onClick={() => handleSendMessage(q)}
                  disabled={isSendingInActive}
                  style={{
                    backgroundColor: 'var(--theme-card-bg)',
                    borderColor: 'var(--theme-card-border)',
                    color: 'var(--theme-text-body)',
                  }}
                  className="text-start min-h-[40px] px-3 py-2 rounded-xl border text-[11px] leading-snug hover:border-[var(--theme-card-border-glow)] hover:text-[var(--theme-text-title)] transition-colors cursor-pointer disabled:opacity-50"
                >
                  {q}
                </button>
              ))}
            </div>
          </div>
        )}

        {isTypingInActive && (
          <div className="flex items-center gap-2">
            <div
              style={{
                backgroundColor: 'var(--theme-card-bg)',
                borderColor: 'var(--theme-card-border)',
                color: 'var(--theme-accent-primary)',
              }}
              className="w-7 h-7 rounded-full border flex items-center justify-center shrink-0"
            >
              <Bot className="w-3.5 h-3.5" />
            </div>
            <div
              style={{
                backgroundColor: 'var(--theme-card-bg)',
                borderColor: 'var(--theme-card-border)',
                color: 'var(--theme-accent-secondary)',
              }}
              className="p-2.5 rounded-2xl border text-xs flex items-center gap-1.5 backdrop-blur-md shadow-sm"
            >
              <Sparkles className="w-3.5 h-3.5 animate-spin text-[var(--theme-accent-primary)]" />
              <span>{strings.composing}</span>
            </div>
          </div>
        )}

        <div className="h-1" />
      </div>

      {/* Inline Voice Support Notice */}
      {voiceNotice && (
        <div
          style={{
            backgroundColor: 'var(--theme-card-bg)',
            borderColor: 'var(--theme-accent-primary)',
            color: 'var(--theme-text-body)',
          }}
          className="shrink-0 px-3 py-1.5 rounded-xl border text-[11px] font-medium flex items-center justify-between gap-2"
        >
          <span>{voiceNotice}</span>
          <button
            type="button"
            onClick={() => setVoiceNotice(null)}
            className="text-[var(--theme-accent-primary)] hover:underline font-bold cursor-pointer"
          >
            Dismiss
          </button>
        </div>
      )}

      {/* Existing Message Composer */}
      <div
        style={{
          backgroundColor: 'var(--theme-card-bg)',
          borderColor: 'var(--theme-card-border)',
        }}
        className="shrink-0 flex items-center gap-1.5 p-1.5 rounded-2xl border backdrop-blur-xl shadow-lg"
      >
        <button
          id="btn-chat-voice"
          type="button"
          onClick={handleToggleVoiceInput}
          style={
            !isListening
              ? {
                  backgroundColor: 'var(--theme-card-bg-subtle)',
                  borderColor: 'var(--theme-card-border)',
                  color: 'var(--theme-accent-primary)',
                }
              : undefined
          }
          className={`min-w-[40px] min-h-[40px] p-2 rounded-xl transition-all cursor-pointer border flex items-center justify-center shrink-0 ${
            isListening
              ? 'bg-rose-500 text-white animate-pulse border-rose-400'
              : 'hover:border-[var(--theme-card-border-glow)]'
          }`}
          title="Speak in your language"
          aria-label="Voice input"
        >
          {isListening ? <MicOff className="w-4 h-4" /> : <Mic className="w-4 h-4" />}
        </button>

        <AudioSpeedControl
          id="btn-chat-audio-speed"
          compact
          placement="top"
          speed={guideSettings?.speechRate}
          onChangeSpeed={(nextRate) => {
            speechManager.setRate(nextRate);
            onUpdateSpeechRate?.(nextRate);
          }}
          isRtl={isRtl}
          tone="subtle"
          className="min-h-[40px]"
        />

        <input
          id="input-chat-message"
          ref={composerInputRef}
          type="text"
          value={inputMessage}
          onChange={(e) => setInputMessage(e.target.value)}
          onKeyDown={(e) => {
            if (e.key === 'Enter' && !e.shiftKey) {
              e.preventDefault();
              handleSendMessage();
            }
          }}
          placeholder={strings.askPlaceholder}
          style={{
            backgroundColor: 'var(--theme-input-bg)',
            borderColor: 'var(--theme-input-border)',
            color: 'var(--theme-text-title)',
          }}
          className="flex-1 min-w-0 min-h-[40px] px-3 py-2 rounded-xl border placeholder:text-[var(--theme-text-muted)] text-xs focus:outline-none focus:border-[var(--theme-card-border-glow)] transition-colors"
        />

        <button
          id="btn-chat-send"
          type="button"
          onClick={() => handleSendMessage()}
          disabled={!inputMessage.trim() || isSendingInActive}
          aria-label="Send message"
          className="min-w-[40px] min-h-[40px] p-2 rounded-xl theme-btn-primary font-bold disabled:opacity-50 transition-all cursor-pointer shadow-sm flex items-center justify-center shrink-0"
        >
          <Send className="w-4 h-4" />
        </button>
      </div>

      {/* Collapsible Chat History Side Panel */}
      <AIChatHistorySidebar
        isOpen={isHistoryOpen}
        onClose={() => setIsHistoryOpen(false)}
        conversations={conversations}
        activeConversationId={activeConversation.id}
        onSelectConversation={handleSelectConversation}
        onNewChat={() => handleStartNewChat(null)}
        onRenameConversation={handleRenameConversation}
        onDeleteConversation={handleDeleteConversation}
        selectedLanguage={selectedLanguage}
        strings={strings}
        returnFocusRef={historyBtnRef}
      />
    </div>
  );
};
