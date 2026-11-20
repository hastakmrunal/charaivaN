import React, { useState, useEffect, useTransition, useRef } from 'react';
import {
  CertaintyStatus,
  DeepConversationContext,
  RecognitionResult,
  Language,
  GuideOutputMode,
  SupplementaryImage,
  ExplanationLevel,
  ExploreMoreSuggestion,
  RelatedDiscoveryItem,
  DetailComponent,
  InscriptionAnalysis,
  GuideSettings,
} from '../types';
import { speechManager } from '../utils/speech';
import { AudioSpeedControl } from './AudioSpeedControl';
import { normalizeAudioSpeed } from '../utils/audioSpeed';
import { DeepDiveModal } from './DeepDiveModal';
import { PlaceCardImage } from './PlaceCardImage';
import { WordByWordText } from './WordByWordText';
import { DetailByDetailPanel, CertaintyBadge } from './DetailByDetailPanel';
import { getMapsNavigationUrl } from '../utils/geolocation';
import { useLocalizedTexts } from '../data/localizedStrings';
import {
  Play,
  Pause,
  Sparkles,
  MessageSquare,
  Bookmark,
  BookmarkCheck,
  CheckCircle2,
  Layers,
  HelpCircle,
  Maximize2,
  X,
  Image as ImageIcon,
  BookOpen,
  ExternalLink,
  Eye,
  MapPin,
  Clock,
  ShieldAlert,
  Loader2,
  ArrowRight,
  Compass,
  RefreshCw,
} from 'lucide-react';
import { BackButton } from './BackButton';
import { useBackLayer, usePreservedScroll } from '../utils/navigationHistory';

export type ExplanationTabId =
  | 'overview'
  | 'detail'
  | 'craft'
  | 'facts'
  | 'contextImages'
  | 'questions'
  | 'ocr';

interface ExploreTopicExpansionState {
  topic: ExploreMoreSuggestion;
  title: string;
  deepExplanation: string;
  keyHighlights: string[];
  certaintyStatus: CertaintyStatus;
  followUpQuestions: string[];
  sourcesNote?: string;
}

interface ExplanationViewProps {
  isActive?: boolean;
  landmark: RecognitionResult;
  selectedLanguage: Language;
  onBack: () => void;
  onOpenChatWithQuestion: (question: string) => void;
  onSaveToHistory: (landmark: RecognitionResult) => Promise<void> | void;
  isSavedInHistory: boolean;
  onOpenLanguageModal?: () => void;
  outputMode: GuideOutputMode;
  onToggleOutputMode: (mode: GuideOutputMode) => void;
  guideSettings?: GuideSettings;
  onUpdateSpeechRate?: (rate: number) => void;
  onOpenRelatedDiscovery?: (item: RelatedDiscoveryItem) => Promise<void> | void;
  onOpenDeepConversation?: (context: DeepConversationContext) => void;
  preservedUiState?: {
    activeTab?: ExplanationTabId;
    explanationLevel?: ExplanationLevel;
  };
  onUiStateChange?: (
    landmarkId: string,
    state: { activeTab: ExplanationTabId; explanationLevel: ExplanationLevel }
  ) => void;
}

const EXPLANATION_UI_DEFAULTS = {
  savedJournal: 'Saved to Journal',
  saveJournal: 'Save to Journal',
  saving: 'Saving...',
  mapsBtn: 'Maps',
  pauseVoice: 'Pause Voice Guide',
  speakIn: 'Speak in',
  translatingNotice: 'Translating guide script into',
  levelQuick: 'Overview',
  levelStandard: 'Detailed',
  levelDeep: 'In-Depth',
  levelExpert: 'Expert Detail',
  loadingLevel: 'Updating explanation depth...',
  tabOverview: 'Overview & Story',
  tabDetail: 'Detail by Detail',
  tabCraft: 'Architecture & Craft',
  tabFacts: 'Facts & Sources',
  tabViews: 'Contextual Views',
  tabAskAi: 'Ask AI',
  tabSign: 'Inscription',
  audioNarrationTitle: 'Audio Narration',
  basicIdHeading: 'Basic Identification',
  historyHeading: 'Historical Background',
  meaningHeading: 'Meaning & Significance',
  conservationHeading: 'Changes & Conservation Over Time',
  comparativeHeading: 'Comparative & Architectural Context',
  folkloreHeading: 'Folklore vs. Documented History',
  misconceptionsHeading: 'Common Misconceptions Clarified',
  architectureHeading: 'Architecture & Construction',
  sculptureHeading: 'Sculpture & Fine Details',
  visitorHeading: 'Visitor Information',
  bestTimeLabel: 'Best Time',
  hoursLabel: 'Hours',
  tipsLabel: 'Etiquette & Tips',
  factsHeading: 'Grounded Facts & Traditions',
  sourcesHeading: 'Sources & Attribution',
  exploreMoreHeading: 'Explore More',
  exploreMoreSubtitle: 'Choose a tailored angle to examine deeper aspects without repeating the overview',
  loadingTopicDetail: 'Generating specialized deep insight...',
  openDeepConvBtn: 'Open Deep Conversation',
  relatedHeading: 'Related Discoveries',
  relatedSubtitle: 'Tap any connected subject to open its full guide (Back returns here)',
  deepDiveCta: 'Open Full Deep-Dive Dossier Modal',
  askAiHeader: 'Tap to ask AI Guide in',
  detectedInscription: 'Detected Inscription / Text',
  rarePerspectives: 'Contextual Perspectives & Archive',
  tapToExpand: 'tap to expand',
  exampleImageBadge: 'Reference / Similar Example',
  certEstablished: 'Established Fact',
  certTraditional: 'Traditional Interpretation',
  certPossible: 'Possible Identification',
  certUnknown: 'Unknown / Unverified',
  imageSourceLabel: 'Image Attribution',
  retryBtn: 'Retry',
  dismissBtn: 'Dismiss',
};

export const ExplanationView: React.FC<ExplanationViewProps> = ({
  isActive = true,
  landmark,
  selectedLanguage,
  onBack,
  onOpenChatWithQuestion,
  onSaveToHistory,
  isSavedInHistory,
  outputMode,
  guideSettings,
  onUpdateSpeechRate,
  onOpenRelatedDiscovery,
  onOpenDeepConversation,
  preservedUiState,
  onUiStateChange,
}) => {
  const { t } = useLocalizedTexts(
    EXPLANATION_UI_DEFAULTS,
    selectedLanguage,
    'Unified explanation screen tabs and section labels'
  );

  const [, startTransition] = useTransition();
  const [activeLandmark, setActiveLandmark] = useState<RecognitionResult>(landmark);
  const [explanationLevel, setExplanationLevel] = useState<ExplanationLevel>(
    preservedUiState?.explanationLevel || landmark.structuredData?.activeLevel || 'standard'
  );
  const [isLoadingLevel, setIsLoadingLevel] = useState(false);
  const [isTranslating, setIsTranslating] = useState(false);
  const [isPlaying, setIsPlaying] = useState(false);
  const [speechRate, setSpeechRate] = useState(() => normalizeAudioSpeed(guideSettings?.speechRate));
  const [activeTab, setActiveTab] = useState<ExplanationTabId>(
    preservedUiState?.activeTab || 'overview'
  );
  const [selectedLightboxImage, setSelectedLightboxImage] = useState<SupplementaryImage | null>(null);
  const [isDeepDiveOpen, setIsDeepDiveOpen] = useState(false);
  const [isSavingJournal, setIsSavingJournal] = useState(false);
  const [saveJournalError, setSaveJournalError] = useState<string | null>(null);
  const [openingRelatedId, setOpeningRelatedId] = useState<string | null>(null);

  // Part 6: Explore More dynamic expansion state
  const [expandedExploreTopic, setExpandedExploreTopic] = useState<ExploreTopicExpansionState | null>(null);
  const [loadingExploreTopicId, setLoadingExploreTopicId] = useState<string | null>(null);
  const [exploreError, setExploreError] = useState<string | null>(null);
  const exploreTopicCacheRef = useRef<Map<string, ExploreTopicExpansionState>>(new Map());
  const exploreAbortRef = useRef<AbortController | null>(null);
  const exploreReqSeqRef = useRef<number>(0);
  const lastFailedExploreTopicRef = useRef<ExploreMoreSuggestion | null>(null);
  const explorePanelRef = useRef<HTMLDivElement | null>(null);
  const exploreErrorRef = useRef<HTMLDivElement | null>(null);
  const shouldScrollExploreRef = useRef<boolean>(false);

  const hydratedStructuredKeyRef = useRef<string>('');
  const explainSyncSeqRef = useRef<number>(0);
  const lastAutoPlayedKeyRef = useRef<string>('');

  // Keep speechRate synced when changed in Settings or other screens
  useEffect(() => {
    if (typeof guideSettings?.speechRate === 'number' && guideSettings.speechRate > 0) {
      setSpeechRate(normalizeAudioSpeed(guideSettings.speechRate));
    }
  }, [guideSettings?.speechRate]);

  // Abort any in-flight Explore More request on unmount
  useEffect(() => {
    return () => {
      exploreAbortRef.current?.abort();
    };
  }, []);

  useBackLayer(
    `explanation-lightbox:${landmark.id}`,
    isActive && Boolean(selectedLightboxImage),
    () => setSelectedLightboxImage(null),
    75
  );
  useBackLayer(
    `explanation-deepdive:${landmark.id}`,
    isActive && isDeepDiveOpen,
    () => setIsDeepDiveOpen(false),
    65
  );
  const bodyScrollRef = usePreservedScroll<HTMLDivElement>(
    `explanation:${landmark.id}:${activeTab}`,
    isActive
  );

  // Sync activeLandmark when landmark prop changes (restoring preserved tab & depth if returning from Deep Conversation)
  useEffect(() => {
    exploreAbortRef.current?.abort();
    exploreAbortRef.current = null;
    exploreReqSeqRef.current += 1;
    lastFailedExploreTopicRef.current = null;
    shouldScrollExploreRef.current = false;
    startTransition(() => {
      setActiveLandmark(landmark);
      setExplanationLevel(
        preservedUiState?.explanationLevel || landmark.structuredData?.activeLevel || 'standard'
      );
      setActiveTab(preservedUiState?.activeTab || 'overview');
      setLoadingExploreTopicId(null);
      setExpandedExploreTopic(null);
      setExploreError(null);
    });
  }, [landmark.id]);

  // Report UI state changes back to App so returning from Deep Conversation preserves tab & depth
  useEffect(() => {
    onUiStateChange?.(landmark.id, { activeTab, explanationLevel });
  }, [landmark.id, activeTab, explanationLevel, onUiStateChange]);

  // Scroll newly opened Explore More detail or error inside bodyScrollRef ONLY — never scroll ancestor shells
  useEffect(() => {
    if (!isActive || !shouldScrollExploreRef.current) return;
    shouldScrollExploreRef.current = false;
    const container = bodyScrollRef.current;
    const target = expandedExploreTopic ? explorePanelRef.current : exploreError ? exploreErrorRef.current : null;
    if (!container || !target) return;
    const rafId = window.requestAnimationFrame(() => {
      if (!container.isConnected || !target.isConnected) return;
      const cRect = container.getBoundingClientRect();
      const tRect = target.getBoundingClientRect();
      if (tRect.top < cRect.top) {
        container.scrollTo({ top: Math.max(0, container.scrollTop + (tRect.top - cRect.top) - 12), behavior: 'smooth' });
      } else if (tRect.bottom > cRect.bottom) {
        container.scrollTo({ top: container.scrollTop + (tRect.bottom - cRect.bottom) + 12, behavior: 'smooth' });
      }
    });
    return () => window.cancelAnimationFrame(rafId);
  }, [isActive, expandedExploreTopic, exploreError]);

  // Background-hydrate structuredData for landmarks opened from Map / History / Camera without structuredData
  useEffect(() => {
    if (!isActive) return;
    const hydrateKey = `${landmark.id}::${selectedLanguage.code}`;
    if (
      activeLandmark.structuredData?.detailComponents?.length &&
      activeLandmark.language === selectedLanguage.name
    ) {
      return;
    }
    if (hydratedStructuredKeyRef.current === hydrateKey) return;

    const mySeq = ++explainSyncSeqRef.current;
    let cancelled = false;
    async function hydrateStructured() {
      try {
        const res = await fetch('/api/discover/explain', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({
            candidate: activeLandmark.discoverCandidate || {
              id: activeLandmark.id,
              title: activeLandmark.title,
              category: activeLandmark.categoryLabel || activeLandmark.category,
              locationOrOrigin: activeLandmark.locationName || activeLandmark.city || '',
              placeId: activeLandmark.googlePlaceId || activeLandmark.placeId,
              coords: activeLandmark.coords
                ? {
                    latitude: activeLandmark.coords.latitude,
                    longitude: activeLandmark.coords.longitude,
                  }
                : undefined,
            },
            level: explanationLevel,
            language: selectedLanguage.name,
            guideSettings,
          }),
        });
        const data = await res.json();
        if (!cancelled && explainSyncSeqRef.current === mySeq && res.ok && data.success && data.structuredData) {
          hydratedStructuredKeyRef.current = hydrateKey;
          setActiveLandmark((prev) => ({
            ...prev,
            language: selectedLanguage.name,
            narration: data.landmark?.narration || prev.narration,
            summary: data.landmark?.summary || prev.summary,
            keyFacts: data.landmark?.keyFacts?.length ? data.landmark.keyFacts : prev.keyFacts,
            structuredData: data.structuredData,
            categoryLabel: data.landmark?.categoryLabel || prev.categoryLabel,
            imageAttribution: prev.imageAttribution || data.landmark?.imageAttribution,
            imageSourceUrl: prev.imageSourceUrl || data.landmark?.imageSourceUrl,
          }));
        }
      } catch {
        // non-blocking background enrichment
      }
    }
    hydrateStructured();
    return () => {
      cancelled = true;
    };
  }, [isActive, landmark.id, selectedLanguage.code, selectedLanguage.name]);

  // Translate base landmark text when selectedLanguage changes
  useEffect(() => {
    if (!isActive) return;
    let isMounted = true;
    const mySeq = explainSyncSeqRef.current;

    async function translateIfNeeded() {
      if (selectedLanguage.code === 'en' && activeLandmark.language === 'English') {
        return;
      }
      if (activeLandmark.language === selectedLanguage.name) {
        return;
      }

      setIsTranslating(true);
      speechManager.stop();
      setIsPlaying(false);

      try {
        const response = await fetch('/api/translate-landmark', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({
            landmark: activeLandmark,
            targetLanguage: selectedLanguage.name,
          }),
        });

        const data = await response.json();
        if (isMounted && data.success && data.landmark) {
          startTransition(() => {
            setActiveLandmark((prev) => {
              // Avoid clobbering richer structuredData if hydrateStructured already completed for this language
              if (prev.language === selectedLanguage.name && prev.structuredData && explainSyncSeqRef.current > mySeq) {
                return prev;
              }
              return { ...prev, ...data.landmark };
            });
          });
        }
      } catch (err) {
        console.error('Translation error:', err);
      } finally {
        if (isMounted) {
          setIsTranslating(false);
        }
      }
    }

    translateIfNeeded();

    return () => {
      isMounted = false;
    };
  }, [isActive, selectedLanguage.code, selectedLanguage.name, landmark.id]);

  // Auto-play audio narration when outputMode includes speech and screen is active
  useEffect(() => {
    if (!isActive) {
      speechManager.stop();
      setIsPlaying(false);
      return;
    }

    const playKey = `${activeLandmark.id}::${selectedLanguage.code}::${explanationLevel}::${(activeLandmark.narration || '').slice(0, 48)}`;
    if (!isTranslating && (outputMode === 'speech' || outputMode === 'both') && activeLandmark.narration) {
      if (lastAutoPlayedKeyRef.current !== playKey) {
        lastAutoPlayedKeyRef.current = playKey;
        handlePlaySpeech(activeLandmark.narration);
      }
    } else {
      speechManager.stop();
      setIsPlaying(false);
    }

    return () => {
      speechManager.stop();
      setIsPlaying(false);
    };
  }, [isActive, activeLandmark.id, activeLandmark.narration, selectedLanguage.code, explanationLevel, isTranslating, outputMode]);

  const handlePlaySpeech = (customText?: string) => {
    const textToSpeak = customText || activeLandmark.narration || activeLandmark.summary;
    if (!textToSpeak) return;
    speechManager.speak({
      text: textToSpeak,
      language: selectedLanguage.name,
      languageCode: selectedLanguage.speechCode,
      rate: speechRate || guideSettings?.speechRate || 1.0,
      pitch: guideSettings?.voicePitch,
      gender: guideSettings?.voiceGender || 'female',
      onStart: () => setIsPlaying(true),
      onEnd: () => setIsPlaying(false),
      onError: () => setIsPlaying(false),
    });
  };

  const handleTogglePlay = () => {
    if (isPlaying) {
      speechManager.stop();
      setIsPlaying(false);
    } else {
      handlePlaySpeech();
    }
  };

  const handleSpeedChange = (newRate: number) => {
    const normalized = normalizeAudioSpeed(newRate);
    setSpeechRate(normalized);
    speechManager.setRate(normalized);
    onUpdateSpeechRate?.(normalized);
  };

  const handleSwitchLevel = async (nextLevel: ExplanationLevel) => {
    if (nextLevel === explanationLevel && activeLandmark.structuredData?.levelNarration?.[nextLevel]) {
      return;
    }
    setExplanationLevel(nextLevel);
    speechManager.stop();
    setIsPlaying(false);

    const cachedNarration = activeLandmark.structuredData?.levelNarration?.[nextLevel];
    if (cachedNarration) {
      setActiveLandmark((prev) => ({
        ...prev,
        narration: cachedNarration,
        structuredData: prev.structuredData
          ? { ...prev.structuredData, activeLevel: nextLevel }
          : prev.structuredData,
      }));
      return;
    }

    setIsLoadingLevel(true);
    try {
      const res = await fetch('/api/discover/explain', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          candidate: activeLandmark.discoverCandidate || {
            id: activeLandmark.id,
            title: activeLandmark.title,
            category: activeLandmark.categoryLabel || activeLandmark.category,
            locationOrOrigin: activeLandmark.locationName || '',
            placeId: activeLandmark.googlePlaceId || activeLandmark.placeId,
          },
          level: nextLevel,
          language: selectedLanguage.name,
          guideSettings,
        }),
      });
      const data = await res.json();
      if (res.ok && data.success && data.structuredData) {
        setActiveLandmark((prev) => {
          const mergedLevels = {
            ...(prev.structuredData?.levelNarration || {}),
            ...(data.structuredData.levelNarration || {}),
            [nextLevel]: data.landmark?.narration || prev.narration,
          };
          return {
            ...prev,
            narration: data.landmark?.narration || prev.narration,
            summary: data.landmark?.summary || prev.summary,
            keyFacts: data.landmark?.keyFacts?.length ? data.landmark.keyFacts : prev.keyFacts,
            structuredData: {
              ...data.structuredData,
              levelNarration: mergedLevels,
              activeLevel: nextLevel,
            },
          };
        });
      }
    } catch (err) {
      console.warn('Level switch error:', err);
    } finally {
      setIsLoadingLevel(false);
    }
  };

  const fetchExploreTopicExpansion = async (
    topic: ExploreMoreSuggestion,
    options?: {
      level?: ExplanationLevel;
      scrollOnComplete?: boolean;
    }
  ) => {
    const targetLevel = options?.level || explanationLevel;
    const cacheKey = `${activeLandmark.id}::${topic.id}::${targetLevel}::${selectedLanguage.code}`;
    const cached = exploreTopicCacheRef.current.get(cacheKey);
    if (cached) {
      exploreAbortRef.current?.abort();
      exploreAbortRef.current = null;
      exploreReqSeqRef.current += 1;
      lastFailedExploreTopicRef.current = null;
      shouldScrollExploreRef.current = Boolean(options?.scrollOnComplete);
      setLoadingExploreTopicId(null);
      setExploreError(null);
      setExpandedExploreTopic(cached);
      return;
    }

    exploreAbortRef.current?.abort();
    const controller = new AbortController();
    exploreAbortRef.current = controller;
    const mySeq = ++exploreReqSeqRef.current;

    lastFailedExploreTopicRef.current = topic;
    setLoadingExploreTopicId(topic.id);
    setExploreError(null);
    try {
      const res = await fetch('/api/discover/explore-topic', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          landmarkTitle: activeLandmark.title,
          category: activeLandmark.categoryLabel || activeLandmark.category,
          locationOrOrigin: activeLandmark.locationName,
          topicId: topic.id,
          topicTitle: topic.title,
          topicAngle: topic.angle,
          promptSeed: topic.promptSeed,
          existingSummary: activeLandmark.summary,
          level: targetLevel,
          language: selectedLanguage.name,
          guideSettings,
        }),
        signal: controller.signal,
      });
      const data = await res.json().catch(() => ({}));
      if (exploreReqSeqRef.current !== mySeq) return;
      if (!res.ok || !data.success || !data.expansion || !String(data.expansion.deepExplanation || '').trim()) {
        throw new Error(data.error || 'Could not load topic details');
      }
      const nextState: ExploreTopicExpansionState = {
        topic,
        title: data.expansion.title || topic.title,
        deepExplanation: data.expansion.deepExplanation,
        keyHighlights: Array.isArray(data.expansion.keyHighlights) ? data.expansion.keyHighlights : [],
        certaintyStatus: data.expansion.certaintyStatus || 'established_fact',
        followUpQuestions: Array.isArray(data.expansion.followUpQuestions)
          ? data.expansion.followUpQuestions
          : [],
        sourcesNote: data.expansion.sourcesNote,
      };
      exploreTopicCacheRef.current.set(cacheKey, nextState);
      lastFailedExploreTopicRef.current = null;
      shouldScrollExploreRef.current = Boolean(options?.scrollOnComplete);
      setExpandedExploreTopic(nextState);
    } catch (err: any) {
      if (err?.name === 'AbortError' || exploreReqSeqRef.current !== mySeq) {
        return;
      }
      shouldScrollExploreRef.current = Boolean(options?.scrollOnComplete);
      setExploreError(err?.message || 'Could not expand this exploration topic right now.');
    } finally {
      if (exploreReqSeqRef.current === mySeq) {
        setLoadingExploreTopicId(null);
      }
    }
  };

  const handleExpandExploreTopic = async (topic: ExploreMoreSuggestion) => {
    if (expandedExploreTopic?.topic.id === topic.id && loadingExploreTopicId !== topic.id) {
      exploreAbortRef.current?.abort();
      exploreAbortRef.current = null;
      exploreReqSeqRef.current += 1;
      setLoadingExploreTopicId(null);
      setExpandedExploreTopic(null);
      setExploreError(null);
      return;
    }
    await fetchExploreTopicExpansion(topic, { scrollOnComplete: true });
  };

  // Automatically re-sync open Explore More card if language or explanation depth changes
  useEffect(() => {
    setExploreError(null);
    if (!expandedExploreTopic) return;
    const expectedCacheKey = `${activeLandmark.id}::${expandedExploreTopic.topic.id}::${explanationLevel}::${selectedLanguage.code}`;
    const existingCache = exploreTopicCacheRef.current.get(expectedCacheKey);
    if (existingCache) {
      setExpandedExploreTopic(existingCache);
      return;
    }
    fetchExploreTopicExpansion(expandedExploreTopic.topic, {
      level: explanationLevel,
      scrollOnComplete: false,
    });
    // Intentionally triggered when language/level switches while an expansion is open
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [selectedLanguage.code, explanationLevel]);

  const launchDeepConversation = (opts?: {
    selectedExploreTopic?: ExploreMoreSuggestion | null;
    initialPrompt?: string;
  }) => {
    speechManager.stop();
    setIsPlaying(false);
    const tabLabelMap: Record<ExplanationTabId, string> = {
      overview: t.tabOverview,
      detail: t.tabDetail,
      craft: t.tabCraft,
      facts: t.tabFacts,
      contextImages: t.tabViews,
      questions: t.tabAskAi,
      ocr: t.tabSign,
    };

    if (onOpenDeepConversation) {
      onOpenDeepConversation({
        landmark: activeLandmark,
        activeTab,
        activeLevel: explanationLevel,
        activeDetailsType: tabLabelMap[activeTab] || activeTab,
        selectedExploreTopic: opts?.selectedExploreTopic || null,
        verifiedOrigin: activeLandmark.locationName,
        initialPrompt: opts?.initialPrompt,
      });
      return;
    }

    onOpenChatWithQuestion(
      opts?.initialPrompt ||
        opts?.selectedExploreTopic?.title ||
        `Discuss ${activeLandmark.title} in depth`
    );
  };

  const handleOpenRelated = async (rel: RelatedDiscoveryItem) => {
    if (openingRelatedId) return;
    if (!onOpenRelatedDiscovery) {
      onOpenChatWithQuestion(`Explain ${rel.title} (${rel.relationReason}) in ${selectedLanguage.name}`);
      return;
    }

    setOpeningRelatedId(rel.id);
    speechManager.stop();
    setIsPlaying(false);
    try {
      await onOpenRelatedDiscovery(rel);
    } finally {
      setOpeningRelatedId(null);
    }
  };

  const structured = activeLandmark.structuredData;
  const hasCraftOrArchContent = Boolean(
    structured?.architectureAndConstruction ||
      structured?.sculptureAndFineDetails ||
      (activeLandmark.architecturalHighlights && activeLandmark.architecturalHighlights.length > 0)
  );
  const certaintyLabels = {
    established: t.certEstablished,
    traditional: t.certTraditional,
    possible: t.certPossible,
    unknown: t.certUnknown,
  };

  return (
    <div
      id="explanation-view"
      dir={selectedLanguage.direction === 'rtl' ? 'rtl' : 'ltr'}
      className="h-full flex flex-col overflow-hidden overflow-clip py-1.5 space-y-1.5 relative select-none"
    >
      {/* Top Header Controls */}
      <div className="shrink-0 flex items-center justify-between gap-2">
        <BackButton
          id="btn-explanation-back"
          onClick={() => {
            if (selectedLightboxImage) {
              setSelectedLightboxImage(null);
              return;
            }
            if (isDeepDiveOpen) {
              setIsDeepDiveOpen(false);
              return;
            }
            speechManager.stop();
            onBack();
          }}
          selectedLanguage={selectedLanguage}
        />

        <div className="flex items-center gap-2">
          {saveJournalError && (
            <span className="text-[10px] text-rose-400 font-medium truncate max-w-[160px]">
              {saveJournalError}
            </span>
          )}
          <button
            type="button"
            disabled={isSavingJournal || isSavedInHistory}
            onClick={async () => {
              if (isSavingJournal || isSavedInHistory) return;
              setIsSavingJournal(true);
              setSaveJournalError(null);
              try {
                await onSaveToHistory(activeLandmark);
              } catch (err: any) {
                setSaveJournalError(err?.message || 'Save failed');
              } finally {
                setIsSavingJournal(false);
              }
            }}
            style={{
              backgroundColor: isSavedInHistory ? 'var(--theme-card-bg-subtle)' : undefined,
              borderColor: isSavedInHistory ? 'var(--theme-card-border-glow)' : undefined,
              color: isSavedInHistory ? 'var(--theme-accent-secondary)' : undefined,
            }}
            className={`px-3 py-1.5 rounded-xl text-xs font-bold flex items-center gap-1 transition-all cursor-pointer border active:scale-95 disabled:cursor-default min-h-[38px] ${
              isSavedInHistory ? 'border' : 'theme-btn-primary'
            }`}
          >
            {isSavedInHistory ? (
              <>
                <BookmarkCheck className="w-3.5 h-3.5 text-[var(--theme-accent-secondary)]" />
                <span>{t.savedJournal}</span>
              </>
            ) : (
              <>
                <Bookmark className="w-3.5 h-3.5" />
                <span>{isSavingJournal ? t.saving : t.saveJournal}</span>
              </>
            )}
          </button>
        </div>
      </div>

      {/* Primary Sight Header Card */}
      <div
        style={{
          backgroundColor: 'var(--theme-card-bg)',
          borderColor: 'var(--theme-card-border)',
        }}
        className="shrink-0 rounded-2xl border p-2 flex items-center gap-3 shadow-md backdrop-blur-md"
      >
        <PlaceCardImage
          placeName={activeLandmark.discoverCandidate?.wikipediaTitle || activeLandmark.title}
          displayTitle={activeLandmark.title}
          placeId={activeLandmark.googlePlaceId || activeLandmark.placeId}
          initialImageUrl={activeLandmark.imageUrl}
          authorAttributions={
            activeLandmark.imageAttribution
              ? [{ displayName: activeLandmark.imageAttribution, uri: activeLandmark.imageSourceUrl }]
              : undefined
          }
          category={activeLandmark.category}
          locality={activeLandmark.locationName}
          cityName={activeLandmark.city}
          size="sm"
        />
        <div className="min-w-0 flex-1">
          <div className="flex items-center gap-1.5 flex-wrap">
            <span className="px-1.5 py-0.5 rounded-md text-[9px] font-bold uppercase tracking-wider theme-badge-gold">
              {activeLandmark.categoryLabel || activeLandmark.category}
            </span>
            {structured?.certaintySummary && (
              <CertaintyBadge certainty={structured.certaintySummary} labels={certaintyLabels} />
            )}
            {activeLandmark.isExampleImage && (
              <span className="px-1.5 py-0.5 rounded text-[9px] font-semibold border border-[var(--theme-card-border)] text-[var(--theme-text-muted)]">
                {t.exampleImageBadge}
              </span>
            )}
          </div>

          <h3 className="text-sm sm:text-base font-serif font-bold text-[var(--theme-text-title)] truncate mt-0.5">
            {activeLandmark.title}
            {activeLandmark.nativeTitle && activeLandmark.nativeTitle !== activeLandmark.title && (
              <span className="text-xs font-sans font-normal text-[var(--theme-text-muted)] ml-1.5">
                ({activeLandmark.nativeTitle})
              </span>
            )}
          </h3>

          <div className="flex items-center gap-2 text-[10px] text-[var(--theme-text-muted)] truncate">
            {activeLandmark.locationName && (
              <span className="text-[var(--theme-accent-secondary)] font-medium truncate">
                {activeLandmark.locationName}
              </span>
            )}
            {activeLandmark.historicalPeriod && (
              <span className="truncate">· {activeLandmark.historicalPeriod}</span>
            )}
          </div>
        </div>

        {(structured?.visitorInfo?.visitable !== false &&
          (activeLandmark.coords ||
            activeLandmark.googlePlaceId ||
            activeLandmark.placeId ||
            activeLandmark.googleMapsUri ||
            structured?.visitorInfo?.visitable)) && (
          <a
            href={getMapsNavigationUrl({
              placeName: activeLandmark.title,
              localityOrCity: activeLandmark.locationName || activeLandmark.city,
              latitude: activeLandmark.coords?.latitude,
              longitude: activeLandmark.coords?.longitude,
              placeId: activeLandmark.googlePlaceId || activeLandmark.placeId,
              googleMapsUri: activeLandmark.googleMapsUri,
              preferDirections: false,
            })}
            target="_blank"
            rel="noopener noreferrer"
            style={{
              backgroundColor: 'var(--theme-card-bg-subtle)',
              borderColor: 'var(--theme-card-border)',
              color: 'var(--theme-accent-primary)',
            }}
            className="shrink-0 px-2.5 py-1.5 rounded-xl border text-[11px] font-bold flex items-center gap-1 hover:border-[var(--theme-card-border-glow)] transition-all min-h-[36px]"
          >
            <span>{t.mapsBtn}</span>
            <ExternalLink className="w-3 h-3" />
          </a>
        )}
      </div>

      {/* Audio Player Bar */}
      <div
        style={{
          backgroundColor: 'var(--theme-card-bg-subtle)',
          borderColor: 'var(--theme-card-border)',
        }}
        className="shrink-0 p-2 rounded-xl border flex items-center justify-between gap-2 shadow-md backdrop-blur-md"
      >
        <button
          id="btn-toggle-narration"
          type="button"
          onClick={handleTogglePlay}
          disabled={isTranslating || isLoadingLevel}
          style={
            isPlaying
              ? { backgroundColor: '#e11d48', color: '#ffffff' }
              : undefined
          }
          className={`flex-1 py-1.5 px-3 rounded-xl font-bold text-xs flex items-center justify-center gap-2 shadow-sm transition-all cursor-pointer min-h-[38px] ${
            isPlaying ? '' : 'theme-btn-primary'
          }`}
        >
          {isPlaying ? (
            <>
              <Pause className="w-3.5 h-3.5 fill-current" />
              <span>{t.pauseVoice}</span>
            </>
          ) : (
            <>
              <Play className="w-3.5 h-3.5 fill-current" />
              <span>
                {t.speakIn} {selectedLanguage.nativeName}
              </span>
            </>
          )}
        </button>

        {/* Universal Playback Speed Control */}
        <AudioSpeedControl
          id="btn-explanation-audio-speed"
          speed={speechRate}
          onChangeSpeed={handleSpeedChange}
          isRtl={selectedLanguage.direction === 'rtl'}
        />
      </div>

      {/* Unified Section Tabs */}
      <div
        style={{ borderColor: 'var(--theme-card-border)' }}
        className="shrink-0 flex items-center gap-1.5 border-b pb-1.5 overflow-x-auto scrollbar-none"
      >
        <button
          type="button"
          onClick={() => setActiveTab('overview')}
          style={{
            background: activeTab === 'overview' ? 'var(--theme-accent-primary-gradient)' : 'var(--theme-card-bg-subtle)',
            color: activeTab === 'overview' ? 'var(--theme-accent-primary-text)' : 'var(--theme-text-muted)',
            borderColor: activeTab === 'overview' ? 'transparent' : 'var(--theme-card-border)',
          }}
          className="px-3 py-1.5 rounded-lg text-xs font-bold transition-all cursor-pointer whitespace-nowrap border hover:text-[var(--theme-text-title)] flex items-center gap-1"
        >
          <BookOpen className="w-3.5 h-3.5" />
          <span>{t.tabOverview}</span>
        </button>

        <button
          id="tab-btn-detail-by-detail"
          type="button"
          onClick={() => setActiveTab('detail')}
          style={{
            background: activeTab === 'detail' ? 'var(--theme-accent-primary-gradient)' : 'var(--theme-card-bg-subtle)',
            color: activeTab === 'detail' ? 'var(--theme-accent-primary-text)' : 'var(--theme-text-muted)',
            borderColor: activeTab === 'detail' ? 'transparent' : 'var(--theme-card-border)',
          }}
          className="px-3 py-1.5 rounded-lg text-xs font-bold transition-all cursor-pointer whitespace-nowrap border hover:text-[var(--theme-text-title)] flex items-center gap-1"
        >
          <Eye className="w-3.5 h-3.5" />
          <span>{t.tabDetail}</span>
        </button>

        {hasCraftOrArchContent && (
          <button
            type="button"
            onClick={() => setActiveTab('craft')}
            style={{
              background: activeTab === 'craft' ? 'var(--theme-accent-primary-gradient)' : 'var(--theme-card-bg-subtle)',
              color: activeTab === 'craft' ? 'var(--theme-accent-primary-text)' : 'var(--theme-text-muted)',
              borderColor: activeTab === 'craft' ? 'transparent' : 'var(--theme-card-border)',
            }}
            className="px-3 py-1.5 rounded-lg text-xs font-bold transition-all cursor-pointer whitespace-nowrap border hover:text-[var(--theme-text-title)] flex items-center gap-1"
          >
            <Layers className="w-3.5 h-3.5" />
            <span>{t.tabCraft}</span>
          </button>
        )}

        <button
          type="button"
          onClick={() => setActiveTab('facts')}
          style={{
            background: activeTab === 'facts' ? 'var(--theme-accent-primary-gradient)' : 'var(--theme-card-bg-subtle)',
            color: activeTab === 'facts' ? 'var(--theme-accent-primary-text)' : 'var(--theme-text-muted)',
            borderColor: activeTab === 'facts' ? 'transparent' : 'var(--theme-card-border)',
          }}
          className="px-3 py-1.5 rounded-lg text-xs font-bold transition-all cursor-pointer whitespace-nowrap border hover:text-[var(--theme-text-title)] flex items-center gap-1"
        >
          <Sparkles className="w-3.5 h-3.5" />
          <span>{t.tabFacts}</span>
        </button>

        {activeLandmark.supplementaryImages && activeLandmark.supplementaryImages.length > 0 && (
          <button
            type="button"
            onClick={() => setActiveTab('contextImages')}
            style={{
              background:
                activeTab === 'contextImages' ? 'var(--theme-accent-primary-gradient)' : 'var(--theme-card-bg-subtle)',
              color: activeTab === 'contextImages' ? 'var(--theme-accent-primary-text)' : 'var(--theme-text-muted)',
              borderColor: activeTab === 'contextImages' ? 'transparent' : 'var(--theme-card-border)',
            }}
            className="px-3 py-1.5 rounded-lg text-xs font-bold transition-all cursor-pointer whitespace-nowrap flex items-center gap-1 border hover:text-[var(--theme-text-title)]"
          >
            <ImageIcon className="w-3.5 h-3.5" />
            <span>
              {t.tabViews} ({activeLandmark.supplementaryImages.length})
            </span>
          </button>
        )}

        <button
          type="button"
          onClick={() => setActiveTab('questions')}
          style={{
            background: activeTab === 'questions' ? 'var(--theme-accent-primary-gradient)' : 'var(--theme-card-bg-subtle)',
            color: activeTab === 'questions' ? 'var(--theme-accent-primary-text)' : 'var(--theme-text-muted)',
            borderColor: activeTab === 'questions' ? 'transparent' : 'var(--theme-card-border)',
          }}
          className="px-3 py-1.5 rounded-lg text-xs font-bold transition-all cursor-pointer whitespace-nowrap border hover:text-[var(--theme-text-title)] flex items-center gap-1"
        >
          <HelpCircle className="w-3.5 h-3.5" />
          <span>{t.tabAskAi}</span>
        </button>

        {(activeLandmark.ocrDetectedText || structured?.inscription?.detected) && (
          <button
            type="button"
            onClick={() => setActiveTab('ocr')}
            style={{
              background: activeTab === 'ocr' ? 'var(--theme-accent-primary-gradient)' : 'var(--theme-card-bg-subtle)',
              color: activeTab === 'ocr' ? 'var(--theme-accent-primary-text)' : 'var(--theme-text-muted)',
              borderColor: activeTab === 'ocr' ? 'transparent' : 'var(--theme-card-border)',
            }}
            className="px-3 py-1.5 rounded-lg text-xs font-bold transition-all cursor-pointer whitespace-nowrap border hover:text-[var(--theme-text-title)]"
          >
            {t.tabSign}
          </button>
        )}
      </div>

      {/* Scrollable Unified Body */}
      <div
        ref={bodyScrollRef}
        style={{
          backgroundColor: 'var(--theme-card-bg)',
          borderColor: 'var(--theme-card-border)',
        }}
        className="flex-1 min-h-0 overflow-y-auto p-3 sm:p-4 border rounded-2xl backdrop-blur-md space-y-4"
      >
        {isTranslating ? (
          <div className="h-full flex items-center justify-center p-4 text-center text-xs text-[var(--theme-accent-secondary)] gap-2">
            <Loader2 className="w-4 h-4 text-[var(--theme-accent-primary)] animate-spin" />
            <span>
              {t.translatingNotice} {selectedLanguage.nativeName}...
            </span>
          </div>
        ) : activeTab === 'overview' ? (
          <div className="space-y-4">
            {/* 4-Level Explanation Switcher: Overview | Detailed | In-Depth | Expert Detail */}
            <div
              style={{
                backgroundColor: 'var(--theme-card-bg-subtle)',
                borderColor: 'var(--theme-card-border)',
              }}
              className="p-1.5 rounded-xl border grid grid-cols-2 sm:grid-cols-4 gap-1.5"
            >
              {(
                [
                  { id: 'quick' as const, label: t.levelQuick },
                  { id: 'standard' as const, label: t.levelStandard },
                  { id: 'deep' as const, label: t.levelDeep },
                  { id: 'expert' as const, label: t.levelExpert },
                ] as const
              ).map((lvl) => {
                const active = explanationLevel === lvl.id;
                return (
                  <button
                    key={lvl.id}
                    id={`btn-level-${lvl.id}`}
                    type="button"
                    disabled={isLoadingLevel}
                    onClick={() => handleSwitchLevel(lvl.id)}
                    style={
                      active
                        ? {
                            background: 'var(--theme-accent-primary-gradient)',
                            color: 'var(--theme-accent-primary-text)',
                          }
                        : {
                            color: 'var(--theme-text-muted)',
                          }
                    }
                    className="py-2 px-2 rounded-lg text-[11px] sm:text-xs font-bold transition-all cursor-pointer flex items-center justify-center gap-1 min-h-[36px]"
                  >
                    {isLoadingLevel && active && <Loader2 className="w-3 h-3 animate-spin" />}
                    <span>{lvl.label}</span>
                  </button>
                );
              })}
            </div>

            {isLoadingLevel && (
              <div className="flex items-center gap-2 text-xs text-[var(--theme-accent-secondary)] font-medium">
                <Loader2 className="w-3.5 h-3.5 animate-spin shrink-0" />
                <span>{t.loadingLevel}</span>
              </div>
            )}

            {/* Contextual Supplementary Carousel */}
            {activeLandmark.supplementaryImages && activeLandmark.supplementaryImages.length > 0 && (
              <div
                style={{
                  backgroundColor: 'var(--theme-card-bg-subtle)',
                  borderColor: 'var(--theme-card-border)',
                }}
                className="p-2.5 rounded-xl border space-y-1.5"
              >
                <div className="flex items-center justify-between text-[10px] text-[var(--theme-accent-secondary)] font-bold uppercase tracking-wider">
                  <span className="flex items-center gap-1">
                    <Layers className="w-3 h-3 text-[var(--theme-accent-primary)]" />
                    {t.rarePerspectives}
                  </span>
                  <span className="text-[9px] text-[var(--theme-text-muted)]">{t.tapToExpand}</span>
                </div>

                <div className="flex items-center gap-2 overflow-x-auto pb-1 scrollbar-none">
                  {activeLandmark.supplementaryImages.map((img) => (
                    <div
                      key={img.id}
                      onClick={() => setSelectedLightboxImage(img)}
                      style={{ borderColor: 'var(--theme-card-border)' }}
                      className="group relative shrink-0 w-28 h-18 rounded-xl overflow-hidden border cursor-pointer shadow-md hover:border-[var(--theme-card-border-glow)] transition-colors"
                    >
                      <img
                        src={img.url}
                        alt={img.title}
                        className="w-full h-full object-cover group-hover:scale-105 transition-transform"
                      />
                      <div className="absolute inset-0 bg-gradient-to-t from-black/80 via-transparent to-transparent flex flex-col justify-end p-1">
                        <span className="text-[8px] font-bold text-white truncate">{img.title}</span>
                        <span className="text-[7px] text-[var(--theme-accent-primary)] capitalize">{img.type}</span>
                      </div>
                      <div className="absolute top-1 right-1 opacity-0 group-hover:opacity-100 transition-opacity bg-black/60 p-0.5 rounded">
                        <Maximize2 className="w-2.5 h-2.5 text-white" />
                      </div>
                    </div>
                  ))}
                </div>
              </div>
            )}

            {/* Main Narration */}
            <div className="space-y-2 max-w-2xl">
              <h4 className="text-[11px] font-bold text-[var(--theme-accent-primary)] uppercase tracking-wider">
                {selectedLanguage.nativeName} · {t.audioNarrationTitle}
              </h4>
              <p className="text-xs sm:text-sm text-[var(--theme-text-body)] leading-relaxed whitespace-pre-line font-sans">
                <WordByWordText
                  text={activeLandmark.narration || activeLandmark.summary}
                  isStreaming={activeLandmark.isStreaming}
                />
              </p>
            </div>

            {/* Structured Identification, History, Meaning */}
            {structured?.basicIdentification && (
              <div
                style={{
                  backgroundColor: 'var(--theme-card-bg-subtle)',
                  borderColor: 'var(--theme-card-border)',
                }}
                className="p-3 rounded-2xl border space-y-1.5 max-w-2xl"
              >
                <h5 className="text-[11px] font-bold uppercase tracking-wider text-[var(--theme-accent-primary)]">
                  {t.basicIdHeading}
                </h5>
                <p className="text-xs sm:text-sm text-[var(--theme-text-body)] leading-relaxed">
                  {structured.basicIdentification}
                </p>
              </div>
            )}

            {structured?.history && (
              <div
                style={{
                  backgroundColor: 'var(--theme-card-bg-subtle)',
                  borderColor: 'var(--theme-card-border)',
                }}
                className="p-3 rounded-2xl border space-y-1.5 max-w-2xl"
              >
                <h5 className="text-[11px] font-bold uppercase tracking-wider text-[var(--theme-accent-primary)]">
                  {t.historyHeading}
                </h5>
                <p className="text-xs sm:text-sm text-[var(--theme-text-body)] leading-relaxed whitespace-pre-line">
                  {structured.history}
                </p>
              </div>
            )}

            {(structured?.meaningAndSignificance || activeLandmark.culturalSignificance) && (
              <div
                style={{
                  backgroundColor: 'var(--theme-card-bg-subtle)',
                  borderColor: 'var(--theme-card-border)',
                }}
                className="p-3 rounded-2xl border space-y-1.5 max-w-2xl"
              >
                <h5 className="text-[11px] font-bold uppercase tracking-wider text-[var(--theme-accent-secondary)]">
                  {t.meaningHeading}
                </h5>
                <p className="text-xs sm:text-sm text-[var(--theme-text-body)] leading-relaxed whitespace-pre-line">
                  {structured?.meaningAndSignificance || activeLandmark.culturalSignificance}
                </p>
              </div>
            )}

            {structured?.conservationAndChanges && (
              <div
                style={{
                  backgroundColor: 'var(--theme-card-bg-subtle)',
                  borderColor: 'var(--theme-card-border)',
                }}
                className="p-3 rounded-2xl border space-y-1.5 max-w-2xl"
              >
                <h5 className="text-[11px] font-bold uppercase tracking-wider text-[var(--theme-accent-primary)]">
                  {t.conservationHeading}
                </h5>
                <p className="text-xs sm:text-sm text-[var(--theme-text-body)] leading-relaxed whitespace-pre-line">
                  {structured.conservationAndChanges}
                </p>
              </div>
            )}

            {structured?.comparativeContext && (
              <div
                style={{
                  backgroundColor: 'var(--theme-card-bg-subtle)',
                  borderColor: 'var(--theme-card-border)',
                }}
                className="p-3 rounded-2xl border space-y-1.5 max-w-2xl"
              >
                <h5 className="text-[11px] font-bold uppercase tracking-wider text-[var(--theme-accent-secondary)]">
                  {t.comparativeHeading}
                </h5>
                <p className="text-xs sm:text-sm text-[var(--theme-text-body)] leading-relaxed whitespace-pre-line">
                  {structured.comparativeContext}
                </p>
              </div>
            )}

            {structured?.folkloreVsHistory && (
              <div
                style={{
                  backgroundColor: 'var(--theme-card-bg-subtle)',
                  borderColor: 'var(--theme-card-border)',
                }}
                className="p-3 rounded-2xl border space-y-1.5 max-w-2xl"
              >
                <h5 className="text-[11px] font-bold uppercase tracking-wider text-[var(--theme-accent-primary)]">
                  {t.folkloreHeading}
                </h5>
                <p className="text-xs sm:text-sm text-[var(--theme-text-body)] leading-relaxed whitespace-pre-line">
                  {structured.folkloreVsHistory}
                </p>
              </div>
            )}

            {structured?.misconceptions && structured.misconceptions.length > 0 && (
              <div
                style={{
                  backgroundColor: 'var(--theme-card-bg-subtle)',
                  borderColor: 'var(--theme-card-border)',
                }}
                className="p-3 rounded-2xl border space-y-2 max-w-2xl"
              >
                <h5 className="text-[11px] font-bold uppercase tracking-wider text-[var(--theme-accent-secondary)]">
                  {t.misconceptionsHeading}
                </h5>
                <ul className="space-y-1.5">
                  {structured.misconceptions.map((m, idx) => (
                    <li key={idx} className="text-xs sm:text-sm text-[var(--theme-text-body)] flex items-start gap-2 leading-relaxed">
                      <CheckCircle2 className="w-3.5 h-3.5 text-[var(--theme-accent-primary)] shrink-0 mt-1" />
                      <span>{m}</span>
                    </li>
                  ))}
                </ul>
              </div>
            )}

            {/* Conditional Visitor Info (ONLY when physically visitable) */}
            {structured?.visitorInfo?.visitable && (
              <div
                style={{
                  backgroundColor: 'var(--theme-card-bg-subtle)',
                  borderColor: 'var(--theme-card-border)',
                }}
                className="p-3.5 rounded-2xl border space-y-2 max-w-2xl"
              >
                <h5 className="text-[11px] font-bold uppercase tracking-wider text-[var(--theme-accent-primary)] flex items-center gap-1.5">
                  <MapPin className="w-3.5 h-3.5" />
                  <span>{t.visitorHeading}</span>
                </h5>
                {structured.visitorInfo.locationNote && (
                  <p className="text-xs text-[var(--theme-text-body)]">{structured.visitorInfo.locationNote}</p>
                )}
                {structured.visitorInfo.bestTime && (
                  <p className="text-xs text-[var(--theme-text-body)] flex items-start gap-1.5">
                    <Clock className="w-3.5 h-3.5 text-[var(--theme-accent-secondary)] shrink-0 mt-0.5" />
                    <span>
                      <strong>{t.bestTimeLabel}: </strong>
                      {structured.visitorInfo.bestTime}
                    </span>
                  </p>
                )}
                {structured.visitorInfo.hoursNote && (
                  <p className="text-xs text-[var(--theme-text-muted)]">
                    <strong>{t.hoursLabel}: </strong>
                    {structured.visitorInfo.hoursNote}
                  </p>
                )}
                {structured.visitorInfo.etiquetteOrTips && structured.visitorInfo.etiquetteOrTips.length > 0 && (
                  <div className="space-y-1 pt-1">
                    <span className="text-[10.5px] font-bold text-[var(--theme-accent-secondary)] uppercase">
                      {t.tipsLabel}
                    </span>
                    <ul className="space-y-1">
                      {structured.visitorInfo.etiquetteOrTips.map((tip, idx) => (
                        <li key={idx} className="text-xs text-[var(--theme-text-body)] flex items-start gap-1.5">
                          <CheckCircle2 className="w-3.5 h-3.5 text-[var(--theme-accent-secondary)] shrink-0 mt-0.5" />
                          <span>{tip}</span>
                        </li>
                      ))}
                    </ul>
                  </div>
                )}
              </div>
            )}

            {/* Quick CTA to Detail-by-Detail + Open Deep Conversation + Classic Deep Dive Modal */}
            <div className="flex flex-wrap gap-2 pt-1">
              <button
                type="button"
                onClick={() => setActiveTab('detail')}
                className="flex-1 min-w-[160px] py-2.5 px-4 rounded-xl theme-btn-primary text-xs font-bold flex items-center justify-center gap-2 cursor-pointer"
              >
                <Eye className="w-4 h-4" />
                <span>{t.tabDetail}</span>
              </button>
              <button
                id="btn-open-deep-conversation"
                type="button"
                onClick={() => launchDeepConversation()}
                className="flex-1 min-w-[180px] py-2.5 px-4 rounded-xl theme-btn-secondary text-xs font-bold flex items-center justify-center gap-1.5 cursor-pointer border border-[var(--theme-card-border-glow)]"
              >
                <MessageSquare className="w-3.5 h-3.5 text-[var(--theme-accent-secondary)]" />
                <span>{t.openDeepConvBtn}</span>
              </button>
              <button
                id="btn-explanation-deep-dive"
                type="button"
                onClick={() => {
                  speechManager.stop();
                  setIsPlaying(false);
                  setIsDeepDiveOpen(true);
                }}
                className="py-2.5 px-4 rounded-xl theme-btn-secondary text-xs font-bold flex items-center justify-center gap-1.5 cursor-pointer"
              >
                <Sparkles className="w-3.5 h-3.5 text-[var(--theme-accent-primary)]" />
                <span>{t.deepDiveCta}</span>
              </button>
            </div>

            {/* Part 6: Five Dynamic Explore More Suggestions (Separate from Details Type & Related Discoveries) */}
            {structured?.exploreMoreTopics && structured.exploreMoreTopics.length > 0 && (
              <div id="explore-more-section" className="space-y-2.5 pt-2">
                <div>
                  <h5 className="text-xs sm:text-sm font-serif font-bold text-[var(--theme-accent-primary)] flex items-center gap-1.5">
                    <Sparkles className="w-4 h-4" />
                    <span>{t.exploreMoreHeading}</span>
                  </h5>
                  <p className="text-[11px] text-[var(--theme-text-muted)]">{t.exploreMoreSubtitle}</p>
                </div>

                {exploreError && (
                  <div
                    id="explore-more-error"
                    ref={exploreErrorRef}
                    role="alert"
                    className="p-3 rounded-xl border border-rose-500/40 bg-rose-500/10 text-rose-200 text-xs flex flex-wrap items-center justify-between gap-2"
                  >
                    <span className="font-medium">{exploreError}</span>
                    <div className="flex items-center gap-1.5 shrink-0">
                      {lastFailedExploreTopicRef.current && (
                        <button
                          id="btn-explore-more-retry"
                          type="button"
                          onClick={() => {
                            if (lastFailedExploreTopicRef.current) {
                              fetchExploreTopicExpansion(lastFailedExploreTopicRef.current, {
                                scrollOnComplete: true,
                              });
                            }
                          }}
                          className="px-2.5 py-1 rounded-lg bg-rose-500/20 hover:bg-rose-500/30 border border-rose-400/40 text-xs font-bold flex items-center gap-1 cursor-pointer"
                        >
                          <RefreshCw className="w-3 h-3" />
                          <span>{t.retryBtn}</span>
                        </button>
                      )}
                      <button
                        type="button"
                        onClick={() => setExploreError(null)}
                        aria-label={t.dismissBtn}
                        className="p-1 rounded-lg hover:bg-white/10 text-rose-200 cursor-pointer"
                      >
                        <X className="w-3.5 h-3.5" />
                      </button>
                    </div>
                  </div>
                )}

                <div className="grid grid-cols-1 sm:grid-cols-2 gap-2">
                  {structured.exploreMoreTopics.slice(0, 5).map((topic) => {
                    const isSelected = expandedExploreTopic?.topic.id === topic.id;
                    const isLoading = loadingExploreTopicId === topic.id;
                    return (
                      <button
                        key={topic.id}
                        id={`btn-explore-more-${topic.id}`}
                        type="button"
                        aria-expanded={isSelected}
                        onClick={() => handleExpandExploreTopic(topic)}
                        style={{
                          backgroundColor: isSelected ? 'var(--theme-card-hover)' : 'var(--theme-card-bg-subtle)',
                          borderColor: isSelected || isLoading ? 'var(--theme-accent-primary)' : 'var(--theme-card-border)',
                        }}
                        className="p-3 rounded-2xl border hover:border-[var(--theme-card-border-glow)] text-left flex items-start justify-between gap-2.5 cursor-pointer transition-all"
                      >
                        <div className="min-w-0 flex-1 space-y-1">
                          {topic.angle && (
                            <span className="inline-block px-1.5 py-0.5 rounded text-[9px] font-bold uppercase tracking-wider theme-badge-teal">
                              {topic.angle}
                            </span>
                          )}
                          <div className="text-xs sm:text-sm font-serif font-bold text-[var(--theme-text-title)] leading-snug">
                            {topic.title}
                          </div>
                          <p className="text-[11px] text-[var(--theme-text-muted)] line-clamp-2 leading-snug">
                            {topic.subtitle}
                          </p>
                        </div>
                        {isLoading ? (
                          <Loader2 className="w-4 h-4 animate-spin text-[var(--theme-accent-primary)] shrink-0 mt-1" />
                        ) : (
                          <ArrowRight className="w-4 h-4 text-[var(--theme-accent-primary)] shrink-0 mt-1" />
                        )}
                      </button>
                    );
                  })}
                </div>

                {loadingExploreTopicId && (
                  <div className="flex items-center gap-2 text-xs text-[var(--theme-accent-secondary)] font-medium py-1">
                    <Loader2 className="w-3.5 h-3.5 animate-spin shrink-0" />
                    <span>{t.loadingTopicDetail}</span>
                  </div>
                )}

                {expandedExploreTopic && (
                  <div
                    id="explore-more-expanded-panel"
                    ref={explorePanelRef}
                    style={{
                      backgroundColor: 'var(--theme-card-bg-subtle)',
                      borderColor: 'var(--theme-card-border-glow)',
                    }}
                    className="p-3.5 sm:p-4 rounded-2xl border space-y-3 shadow-md max-w-2xl"
                  >
                    <div className="flex items-start justify-between gap-2">
                      <div className="space-y-1 min-w-0">
                        <div className="flex items-center gap-1.5 flex-wrap">
                          <CertaintyBadge
                            certainty={expandedExploreTopic.certaintyStatus}
                            labels={certaintyLabels}
                          />
                        </div>
                        <h6 className="text-sm font-serif font-bold text-[var(--theme-text-title)]">
                          {expandedExploreTopic.title}
                        </h6>
                      </div>
                      <button
                        type="button"
                        onClick={() => setExpandedExploreTopic(null)}
                        aria-label="Close topic detail"
                        className="p-1 rounded-lg text-[var(--theme-text-muted)] hover:text-[var(--theme-text-title)] cursor-pointer shrink-0"
                      >
                        <X className="w-4 h-4" />
                      </button>
                    </div>

                    <p className="text-xs sm:text-sm text-[var(--theme-text-body)] leading-relaxed whitespace-pre-line">
                      {expandedExploreTopic.deepExplanation}
                    </p>

                    {expandedExploreTopic.keyHighlights.length > 0 && (
                      <ul className="space-y-1.5 pt-0.5">
                        {expandedExploreTopic.keyHighlights.map((hl, idx) => (
                          <li
                            key={idx}
                            className="text-xs text-[var(--theme-text-body)] flex items-start gap-2 leading-relaxed"
                          >
                            <CheckCircle2 className="w-3.5 h-3.5 text-[var(--theme-accent-secondary)] shrink-0 mt-0.5" />
                            <span>{hl}</span>
                          </li>
                        ))}
                      </ul>
                    )}

                    {expandedExploreTopic.sourcesNote && (
                      <p className="text-[11px] text-[var(--theme-text-muted)] italic">
                        {expandedExploreTopic.sourcesNote}
                      </p>
                    )}

                    {expandedExploreTopic.followUpQuestions.length > 0 && (
                      <div className="space-y-1.5 pt-1">
                        <div className="flex flex-wrap gap-1.5">
                          {expandedExploreTopic.followUpQuestions.map((fq, idx) => (
                            <button
                              key={idx}
                              type="button"
                              onClick={() =>
                                launchDeepConversation({
                                  selectedExploreTopic: expandedExploreTopic.topic,
                                  initialPrompt: fq,
                                })
                              }
                              style={{
                                backgroundColor: 'var(--theme-card-bg)',
                                borderColor: 'var(--theme-card-border)',
                                color: 'var(--theme-text-title)',
                              }}
                              className="px-2.5 py-1.5 rounded-xl border text-[11px] font-medium hover:border-[var(--theme-card-border-glow)] cursor-pointer text-left"
                            >
                              {fq}
                            </button>
                          ))}
                        </div>
                      </div>
                    )}

                    <div className="pt-1 flex justify-end">
                      <button
                        id="btn-explore-open-deep-conv"
                        type="button"
                        onClick={() =>
                          launchDeepConversation({
                            selectedExploreTopic: expandedExploreTopic.topic,
                          })
                        }
                        className="px-4 py-2 rounded-xl theme-btn-primary text-xs font-bold flex items-center gap-1.5 cursor-pointer"
                      >
                        <MessageSquare className="w-3.5 h-3.5" />
                        <span>{t.openDeepConvBtn}</span>
                      </button>
                    </div>
                  </div>
                )}
              </div>
            )}

            {/* Related Discoveries */}
            {structured?.relatedDiscoveries && structured.relatedDiscoveries.length > 0 && (
              <div className="space-y-2.5 pt-2">
                <div>
                  <h5 className="text-xs sm:text-sm font-serif font-bold text-[var(--theme-accent-primary)] flex items-center gap-1.5">
                    <Compass className="w-4 h-4" />
                    <span>{t.relatedHeading}</span>
                  </h5>
                  <p className="text-[11px] text-[var(--theme-text-muted)]">{t.relatedSubtitle}</p>
                </div>

                <div className="grid grid-cols-1 sm:grid-cols-2 gap-2.5">
                  {structured.relatedDiscoveries.map((rel) => {
                    const isOpening = openingRelatedId === rel.id;
                    return (
                      <button
                        key={rel.id}
                        type="button"
                        disabled={Boolean(openingRelatedId)}
                        onClick={() => handleOpenRelated(rel)}
                        style={{
                          backgroundColor: 'var(--theme-card-bg-subtle)',
                          borderColor: isOpening ? 'var(--theme-accent-primary)' : 'var(--theme-card-border)',
                        }}
                        className="p-2.5 rounded-2xl border hover:border-[var(--theme-card-border-glow)] text-left flex items-center gap-2.5 cursor-pointer transition-all"
                      >
                        <PlaceCardImage
                          placeName={rel.wikipediaTitle || rel.title}
                          displayTitle={rel.title}
                          initialImageUrl={rel.imageUrl}
                          category={rel.category}
                          cityName={rel.locationOrOrigin}
                          size="sm"
                        />
                        <div className="min-w-0 flex-1 space-y-0.5">
                          <div className="flex items-center gap-1.5">
                            <span className="px-1.5 py-0.5 rounded text-[9px] font-bold uppercase theme-badge-gold">
                              {rel.category}
                            </span>
                            {rel.locationOrOrigin && (
                              <span className="text-[10px] text-[var(--theme-accent-secondary)] truncate">
                                {rel.locationOrOrigin}
                              </span>
                            )}
                          </div>
                          <div className="text-xs font-serif font-bold text-[var(--theme-text-title)] truncate">
                            {rel.title}
                          </div>
                          <p className="text-[11px] text-[var(--theme-text-muted)] line-clamp-2 leading-snug">
                            {rel.relationReason}
                          </p>
                        </div>
                        {isOpening ? (
                          <Loader2 className="w-4 h-4 animate-spin text-[var(--theme-accent-primary)] shrink-0" />
                        ) : (
                          <ArrowRight className="w-4 h-4 text-[var(--theme-accent-primary)] shrink-0" />
                        )}
                      </button>
                    );
                  })}
                </div>
              </div>
            )}
          </div>
        ) : activeTab === 'detail' ? (
          <DetailByDetailPanel
            subjectTitle={activeLandmark.title}
            category={activeLandmark.categoryLabel || activeLandmark.category}
            locationOrOrigin={activeLandmark.locationName}
            imageUrl={activeLandmark.imageUrl}
            imageSourceUrl={activeLandmark.imageSourceUrl}
            imageAttribution={activeLandmark.imageAttribution}
            isExampleImage={activeLandmark.isExampleImage}
            initialComponents={structured?.detailComponents || []}
            initialInscription={structured?.inscription}
            selectedLanguage={selectedLanguage}
            guideSettings={guideSettings}
            onUpdateSpeechRate={onUpdateSpeechRate}
            onComponentsUpdated={(updatedComponents: DetailComponent[], updatedInscription?: InscriptionAnalysis) => {
              setActiveLandmark((prev) => ({
                ...prev,
                structuredData: prev.structuredData
                  ? {
                      ...prev.structuredData,
                      detailComponents: updatedComponents,
                      inscription: updatedInscription || prev.structuredData.inscription,
                    }
                  : prev.structuredData,
              }));
            }}
          />
        ) : activeTab === 'craft' ? (
          <div className="space-y-3 max-w-2xl">
            {structured?.architectureAndConstruction && (
              <div
                style={{
                  backgroundColor: 'var(--theme-card-bg-subtle)',
                  borderColor: 'var(--theme-card-border)',
                }}
                className="p-3.5 rounded-2xl border space-y-1.5"
              >
                <h4 className="text-xs font-bold text-[var(--theme-accent-primary)] uppercase tracking-wider">
                  {t.architectureHeading}
                </h4>
                <p className="text-xs sm:text-sm text-[var(--theme-text-body)] leading-relaxed whitespace-pre-line">
                  {structured.architectureAndConstruction}
                </p>
              </div>
            )}

            {structured?.sculptureAndFineDetails && (
              <div
                style={{
                  backgroundColor: 'var(--theme-card-bg-subtle)',
                  borderColor: 'var(--theme-card-border)',
                }}
                className="p-3.5 rounded-2xl border space-y-1.5"
              >
                <h4 className="text-xs font-bold text-[var(--theme-accent-secondary)] uppercase tracking-wider">
                  {t.sculptureHeading}
                </h4>
                <p className="text-xs sm:text-sm text-[var(--theme-text-body)] leading-relaxed whitespace-pre-line">
                  {structured.sculptureAndFineDetails}
                </p>
              </div>
            )}

            {activeLandmark.architecturalHighlights && activeLandmark.architecturalHighlights.length > 0 && (
              <ul className="space-y-2 pt-1">
                {activeLandmark.architecturalHighlights.map((arch, idx) => (
                  <li
                    key={idx}
                    style={{
                      backgroundColor: 'var(--theme-card-bg-subtle)',
                      borderColor: 'var(--theme-card-border)',
                    }}
                    className="p-2.5 rounded-xl border flex items-start gap-2 text-xs text-[var(--theme-text-body)] leading-normal"
                  >
                    <Layers className="w-3.5 h-3.5 text-[var(--theme-accent-primary)] shrink-0 mt-0.5" />
                    <span>{arch}</span>
                  </li>
                ))}
              </ul>
            )}
          </div>
        ) : activeTab === 'facts' ? (
          <div className="space-y-4 max-w-2xl">
            <div className="space-y-2">
              <h4 className="text-xs font-bold text-[var(--theme-accent-primary)] uppercase tracking-wider">
                {t.factsHeading}
              </h4>
              {structured?.interestingFacts && structured.interestingFacts.length > 0 ? (
                <div className="space-y-2">
                  {structured.interestingFacts.map((item, idx) => (
                    <div
                      key={idx}
                      style={{
                        backgroundColor: 'var(--theme-card-bg-subtle)',
                        borderColor: 'var(--theme-card-border)',
                      }}
                      className="p-3 rounded-xl border space-y-1.5"
                    >
                      <CertaintyBadge certainty={item.certainty} labels={certaintyLabels} />
                      <p className="text-xs sm:text-sm text-[var(--theme-text-body)] leading-relaxed">
                        {item.text}
                      </p>
                      {item.note && (
                        <p className="text-[11px] text-[var(--theme-text-muted)]">{item.note}</p>
                      )}
                    </div>
                  ))}
                </div>
              ) : (
                <ul className="space-y-2">
                  {activeLandmark.keyFacts.map((fact, idx) => (
                    <li key={idx} className="flex items-start gap-2 text-xs text-[var(--theme-text-body)] leading-normal">
                      <CheckCircle2 className="w-3.5 h-3.5 text-[var(--theme-accent-secondary)] shrink-0 mt-0.5" />
                      <span>{fact}</span>
                    </li>
                  ))}
                </ul>
              )}
            </div>

            {(structured?.sources?.length || activeLandmark.imageAttribution) && (
              <div
                style={{
                  backgroundColor: 'var(--theme-card-bg-subtle)',
                  borderColor: 'var(--theme-card-border)',
                }}
                className="p-3 rounded-2xl border space-y-2"
              >
                <h4 className="text-[11px] font-bold text-[var(--theme-accent-primary)] uppercase tracking-wider">
                  {t.sourcesHeading}
                </h4>

                {activeLandmark.imageAttribution && (
                  <p className="text-xs text-[var(--theme-text-body)]">
                    <strong>{t.imageSourceLabel}: </strong>
                    {activeLandmark.imageSourceUrl ? (
                      <a
                        href={activeLandmark.imageSourceUrl}
                        target="_blank"
                        rel="noopener noreferrer"
                        className="text-[var(--theme-accent-secondary)] hover:underline"
                      >
                        {activeLandmark.imageAttribution}
                      </a>
                    ) : (
                      activeLandmark.imageAttribution
                    )}
                  </p>
                )}

                {structured?.sources && structured.sources.length > 0 && (
                  <div className="flex flex-wrap gap-1.5">
                    {structured.sources.map((src, idx) =>
                      src.url ? (
                        <a
                          key={idx}
                          href={src.url}
                          target="_blank"
                          rel="noopener noreferrer"
                          className="text-[11px] px-2.5 py-1 rounded-lg theme-btn-secondary inline-flex items-center gap-1"
                        >
                          <span className="truncate max-w-[220px]">{src.title}</span>
                          <ExternalLink className="w-3 h-3 shrink-0" />
                        </a>
                      ) : (
                        <span
                          key={idx}
                          className="text-[11px] px-2.5 py-1 rounded-lg theme-btn-secondary inline-flex items-center gap-1"
                        >
                          {src.title}
                        </span>
                      )
                    )}
                  </div>
                )}
              </div>
            )}
          </div>
        ) : activeTab === 'contextImages' && activeLandmark.supplementaryImages ? (
          <div className="space-y-3">
            <div className="flex items-center justify-between text-[11px] text-[var(--theme-accent-secondary)] font-bold">
              <span>{t.rarePerspectives}</span>
              <span className="text-[10px] text-[var(--theme-text-muted)] font-normal">{t.tapToExpand}</span>
            </div>

            <div className="grid grid-cols-1 sm:grid-cols-2 gap-2.5">
              {activeLandmark.supplementaryImages.map((img) => (
                <div
                  key={img.id}
                  onClick={() => setSelectedLightboxImage(img)}
                  style={{
                    backgroundColor: 'var(--theme-card-bg-subtle)',
                    borderColor: 'var(--theme-card-border)',
                  }}
                  className="rounded-xl overflow-hidden border p-2 cursor-pointer hover:border-[var(--theme-card-border-glow)] transition-all shadow-md group space-y-1.5"
                >
                  <div className="relative h-32 w-full rounded-lg overflow-hidden bg-black">
                    <img
                      src={img.url}
                      alt={img.title}
                      className="w-full h-full object-cover group-hover:scale-105 transition-transform"
                    />
                    <span className="absolute top-1.5 left-1.5 px-2 py-0.5 rounded theme-badge-teal text-[9px] font-bold uppercase">
                      {img.type}
                    </span>
                  </div>
                  <div>
                    <h5 className="text-xs font-bold text-[var(--theme-text-title)] group-hover:text-[var(--theme-accent-primary)]">
                      {img.title}
                    </h5>
                    <p className="text-[11px] text-[var(--theme-text-muted)] leading-normal mt-0.5">{img.caption}</p>
                    {img.attribution && (
                      <p className="text-[10px] text-[var(--theme-accent-secondary)] truncate mt-0.5">
                        {img.attribution}
                      </p>
                    )}
                  </div>
                </div>
              ))}
            </div>
          </div>
        ) : activeTab === 'questions' ? (
          <div className="space-y-2.5 max-w-2xl">
            <h4 className="text-[11px] font-bold text-[var(--theme-accent-primary)] uppercase tracking-wider flex items-center gap-1">
              <HelpCircle className="w-3.5 h-3.5 text-[var(--theme-accent-secondary)]" />
              <span>
                {t.askAiHeader} {selectedLanguage.nativeName}
              </span>
            </h4>
            <div className="space-y-2">
              {(activeLandmark.suggestedQuestions || []).map((q, idx) => (
                <button
                  key={idx}
                  type="button"
                  onClick={() => onOpenChatWithQuestion(q)}
                  style={{
                    backgroundColor: 'var(--theme-card-bg-subtle)',
                    borderColor: 'var(--theme-card-border)',
                    color: 'var(--theme-text-title)',
                  }}
                  className="w-full p-3 rounded-xl border text-left text-xs font-medium hover:border-[var(--theme-card-border-glow)] flex items-center justify-between transition-all cursor-pointer group"
                >
                  <span className="pr-2">&ldquo;{q}&rdquo;</span>
                  <MessageSquare className="w-3.5 h-3.5 text-[var(--theme-accent-primary)] shrink-0 group-hover:scale-110" />
                </button>
              ))}
            </div>
          </div>
        ) : activeTab === 'ocr' && (activeLandmark.ocrDetectedText || structured?.inscription?.detected) ? (
          <div className="space-y-2.5 max-w-2xl">
            <h4 className="text-[11px] font-bold text-[var(--theme-accent-primary)] uppercase tracking-wider flex items-center gap-1.5">
              <ShieldAlert className="w-3.5 h-3.5" />
              <span>{t.detectedInscription}</span>
            </h4>
            {activeLandmark.ocrDetectedText && (
              <div
                style={{
                  backgroundColor: 'var(--theme-card-bg-subtle)',
                  borderColor: 'var(--theme-card-border)',
                  color: 'var(--theme-text-title)',
                }}
                className="p-3 rounded-xl border text-xs font-mono"
              >
                &ldquo;{activeLandmark.ocrDetectedText}&rdquo;
              </div>
            )}
            {structured?.inscription && (
              <div
                style={{
                  backgroundColor: 'var(--theme-card-bg-subtle)',
                  borderColor: 'var(--theme-card-border)',
                }}
                className="p-3 rounded-xl border text-xs space-y-1.5"
              >
                {structured.inscription.script && (
                  <p>
                    <strong>Script: </strong>
                    {structured.inscription.script}
                  </p>
                )}
                {structured.inscription.confirmedReading && (
                  <p>
                    <strong>Confirmed Reading: </strong>
                    <span className="font-mono">{structured.inscription.confirmedReading}</span>
                  </p>
                )}
                {structured.inscription.approximateTransliteration && (
                  <p>
                    <strong>Transliteration: </strong>
                    <span className="italic">{structured.inscription.approximateTransliteration}</span>
                  </p>
                )}
                {structured.inscription.translation && (
                  <p>
                    <strong>Translation: </strong>
                    {structured.inscription.translation}
                  </p>
                )}
                {structured.inscription.uncertaintyNote && (
                  <p className="text-[11px] text-[var(--theme-text-muted)]">
                    <strong>Note: </strong>
                    {structured.inscription.uncertaintyNote}
                  </p>
                )}
              </div>
            )}
          </div>
        ) : null}
      </div>

      {/* Contextual Image Lightbox Modal */}
      {selectedLightboxImage && (
        <div
          className="fixed inset-0 z-50 bg-black/90 backdrop-blur-md flex items-center justify-center p-4"
          onClick={() => setSelectedLightboxImage(null)}
        >
          <div
            style={{
              backgroundColor: 'var(--theme-card-bg)',
              borderColor: 'var(--theme-card-border)',
            }}
            className="relative max-w-lg w-full rounded-2xl border overflow-hidden shadow-2xl space-y-2 p-3"
            onClick={(e) => e.stopPropagation()}
          >
            <div className="flex items-center justify-between gap-2">
              <div className="flex items-center gap-2 min-w-0">
                <BackButton
                  compact
                  onClick={() => setSelectedLightboxImage(null)}
                  selectedLanguage={selectedLanguage}
                />
                <div className="min-w-0">
                  <span className="text-[9px] uppercase font-bold theme-badge-gold px-2 py-0.5 rounded">
                    {selectedLightboxImage.type}
                  </span>
                  <h4 className="text-sm font-bold text-[var(--theme-text-title)] mt-1 truncate">
                    {selectedLightboxImage.title}
                  </h4>
                </div>
              </div>
              <button
                type="button"
                onClick={() => setSelectedLightboxImage(null)}
                style={{
                  backgroundColor: 'var(--theme-card-bg-subtle)',
                  color: 'var(--theme-text-muted)',
                }}
                className="p-1.5 rounded-lg hover:text-[var(--theme-text-title)] cursor-pointer shrink-0"
                aria-label="Close image viewer"
              >
                <X className="w-4 h-4" />
              </button>
            </div>

            <div className="w-full h-64 rounded-xl overflow-hidden bg-black">
              <img
                src={selectedLightboxImage.url}
                alt={selectedLightboxImage.title}
                className="w-full h-full object-contain"
              />
            </div>

            <div
              style={{
                backgroundColor: 'var(--theme-card-bg-subtle)',
                borderColor: 'var(--theme-card-border)',
                color: 'var(--theme-text-body)',
              }}
              className="text-xs leading-relaxed p-2.5 rounded-xl border space-y-1"
            >
              <p>{selectedLightboxImage.caption}</p>
              {selectedLightboxImage.attribution && (
                <p className="text-[10.5px] text-[var(--theme-accent-secondary)]">
                  {selectedLightboxImage.attribution}
                </p>
              )}
            </div>
          </div>
        </div>
      )}

      {/* Deep Dive In-Depth Dossier Modal */}
      {isDeepDiveOpen && (
        <DeepDiveModal
          title={activeLandmark.title}
          category={activeLandmark.category}
          locationName={activeLandmark.locationName}
          currentNarration={activeLandmark.narration}
          selectedLanguage={selectedLanguage}
          guideSettings={guideSettings}
          onUpdateSpeechRate={onUpdateSpeechRate}
          outputMode={outputMode}
          onClose={() => setIsDeepDiveOpen(false)}
          onOpenChatWithQuestion={(q) => {
            setIsDeepDiveOpen(false);
            onOpenChatWithQuestion(q);
          }}
        />
      )}
    </div>
  );
};
