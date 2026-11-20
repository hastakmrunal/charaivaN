import React, { useState, useEffect, useMemo } from 'react';
import {
  Camera,
  MapPin,
  Volume2,
  Square,
  Play,
  Compass,
  MessageSquare,
  Map,
  History,
  Sliders,
  Search,
  ArrowRight,
  ChevronDown,
  ChevronUp,
  Languages,
  Sparkles,
  CheckCircle2,
} from 'lucide-react';
import { AppTab, GuideSettings, Language, UserProfile } from '../types';
import { MeenakshiLogo } from './MeenakshiLogo';
import { speechManager } from '../utils/speech';
import { AudioSpeedControl } from './AudioSpeedControl';
import { normalizeAudioSpeed } from '../utils/audioSpeed';
import { BackButton } from './BackButton';
import { usePreservedScroll } from '../utils/navigationHistory';
import {
  APP_PRIMARY_FEATURES,
  FEATURE_DISTINCTION_NOTES,
  SUPPORTED_LANGUAGE_COUNT,
} from '../data/appFeatures';
import { useLocalizedTexts } from '../data/localizedStrings';
import introHeroImg from '../assets/images/intro_heritage_hero_1794280981908.jpg';
import tourPillarsImg from '../assets/images/tour_vision_pillars_1794280982922.jpg';

interface AppIntroductionPageProps {
  selectedLanguage: Language;
  guideSettings: GuideSettings;
  onUpdateSpeechRate?: (rate: number) => void;
  userProfile?: UserProfile | null;
  isReplayMode?: boolean;
  onBack?: () => void;
  onOpenLanguageModal: () => void;
  onStartTour: () => void;
  onSkipIntroOnly?: () => void;
  onSkipToLogin: () => void;
  onSkipAllToApp: () => void;
}

const WELCOME_SPEECH_AUDIO_SCRIPT =
  `Welcome to Charaiva — your personal, intelligent, multilingual cultural and travel guide in your pocket. ` +
  `Most guides hand you static, dry text only in one language. Charaiva transforms how you experience the world. ` +
  `In Explore Home, view your active GPS or chosen city overview and open two-tier City Guides. ` +
  `In Photo Guide, snap or upload a monument, temple carving, dish, or inscription sign — even unfamiliar scripts via OCR — ` +
  `and Charaiva streams stories, Detail by Detail insights, and Deep Dive trivia in three fast batches without freezing your screen. ` +
  `Use Discover to search worldwide by name, partial clue, nickname, spelling variation, or voice — viewing related matches first before opening a complete multi-level guide with five Explore More subtopics. ` +
  `Tap Attractions to sweep real physical places around your live GPS or chosen city with category filters and 500-meter to 10-kilometer radius control. ` +
  `Talk freely with AI Guide in ${SUPPORTED_LANGUAGE_COUNT} languages with session memory, browse nearby pins on the Interactive Map, review and edit journeys in your Tour Journal, ` +
  `and tune Speech + Text, Speech Only, silent Text Only, voice speed, topics, and privacy in Settings. ` +
  `Let us take a quick screen-by-screen tour, or skip anytime to start exploring in real time.`;

const SPEECH_CHAPTERS = [
  {
    id: 'ch1',
    heading: '1. Greeting & Vision — A Living Cultural Companion',
    body:
      'Imagine standing before a thousand-year-old temple gopuram, a historic fort courtyard, a museum sculpture, a local dish, or a weathered stone inscription in a script you cannot read — and having a warm, eloquent historian and multilingual storyteller beside you. Charaiva transforms your device into that personal AI cultural and visual guide.',
  },
  {
    id: 'ch2',
    heading: '2. Photo Guide, OCR & Three-Batch Streaming',
    body:
      'Instead of forcing travelers to stare at frozen spinners over spotty mobile data, Photo Guide uses progressive streaming: title and heritage context appear immediately, narration and speech playback follow right behind, and Detail by Detail breakdowns load smoothly. Built-in OCR reads carvings, museum plaques, and street signage in your language.',
  },
  {
    id: 'ch3',
    heading: '3. Discover Worldwide vs. Attractions Radar vs. Explore More',
    body:
      `Charaiva keeps discovery clearly organized across eight primary tabs. Use Discover (Tab 3) to search globally by name, partial clue, nickname, or voice—seeing related candidate matches first before opening a full multi-level guide. Use Attractions (Tab 4) when you want a real-time physical radar around your GPS or selected city across 500m to 10km with 8 categories. Inside any open explanation, tap any of the five dynamic Explore More cards to investigate a specific angle deeply without repeating basics.`,
  },
  {
    id: 'ch4',
    heading: '4. AI Guide, Map, Tour Journal & Settings Control',
    body:
      `Ask anything aloud or in text using AI Guide across ${SUPPORTED_LANGUAGE_COUNT} languages with anti-repetition session memory, inspect heritage pins on Map, log, edit, and replay journeys inside Tour Journal, and configure language, output mode (Speech + Text, Speech Only, or Text Only), Male or Female voice speed and pitch, photo storage (YES or NO), 10 topic lenses, and 4 eye-soothing themes inside Settings.`,
  },
];

const WORKFLOW_STEPS = [
  {
    step: '01',
    title: 'Lock GPS or Pick Any City',
    detail:
      'Explore from your live physical coordinates or switch cleanly to any destination city worldwide in Settings or Explore City.',
    icon: MapPin,
  },
  {
    step: '02',
    title: 'Snap a Photo, Discover Worldwide, or Scan Nearby',
    detail:
      'Use Photo Guide for camera/uploads, Discover for two-step worldwide search by name or clue, or Attractions for places near your location.',
    icon: Search,
  },
  {
    step: '03',
    title: `Listen & Read in ${SUPPORTED_LANGUAGE_COUNT} Languages`,
    detail:
      'Switch Quick, Standard, Deep, or Expert depth with Detail by Detail breakdowns, 5 Explore More subtopics, OCR translation, and voice playback.',
    icon: Volume2,
  },
  {
    step: '04',
    title: 'Converse Deeper & Build Tour Journal',
    detail:
      'Launch Deep Conversation or AI Guide Chat while every discovery, personal note, and saved photo stays organized in your Tour Journal.',
    icon: History,
  },
];

const FEATURE_ICON_MAP: Partial<Record<AppTab, React.ComponentType<{ className?: string }>>> = {
  home: Compass,
  camera: Camera,
  discover: Search,
  nearby: MapPin,
  chat: MessageSquare,
  map: Map,
  history: History,
  settings: Sliders,
};

const INTRO_CHROME_DEFAULTS = {
  headerTitle: 'App Introduction & Workflow',
  headerSubtitle: 'Overview of features & real-time guide',
  chooseLangTitle: 'Choose narration language',
  backToExplore: 'Back to Explore',
  skipIntro: 'Skip Intro',
  eyebrow: 'Explore Smarter · Listen Deeper · Travel Free',
  heroHeading: 'Your Personal AI Historian, Vision Scanner & Live Guide',
  heroBody:
    `Charaiva turns your camera, global search curiosity, and live location into guided storytelling across ${SUPPORTED_LANGUAGE_COUNT} languages. Snap sights in Photo Guide, search anything worldwide in Discover, browse real nearby Attractions, and save lasting notes in Tour Journal.`,
  speechModuleTitle: "Listen to Charaiva's Welcome Speech",
  speechPlayingHint: 'Playing narrated app feature highlights aloud...',
  speechIdleHint: 'Hear a spoken overview of Charaiva’s unique features',
  silentModeNote: 'Text Only mode is active in Settings — press Play Speech if you want to sample audio.',
  stopSpeech: 'Stop Speech',
  playSpeech: 'Play Speech',
  voiceActive: 'Voice Active:',
  hideTranscript: 'Hide Full Feature Speech',
  readTranscript: 'Read Complete Charaiva Feature Speech',
  startTourCta: 'Start Screen-by-Screen Tour',
  skipToLoginCta: 'Skip to Sign In & Setup',
  returnToWorkspace: 'Return to Workspace',
  skipAllCta: 'Skip All & Explore Now',
  heroCardEyebrow: 'Real-Time Multimodal Vision & Search',
  heroCardSub: 'Photo Guide · Discover Search · Nearby Attractions · 8 Navigation Tabs',
  fastSpeedLabel: 'Zero-Freeze Speed:',
  fastSpeedDesc:
    'Progressive streaming delivers initial sight title and facts before rich commentary finishes.',
  storageChoiceLabel: 'Phone Storage Choice:',
  storageChoiceDesc:
    'Save clicked photos to your internal app folder (YES) or run zero-footprint in memory (NO).',
  workflowHeading: 'How Charaiva Works — 4-Step Workflow',
  workflowSubheading:
    'Designed for effortless standing tours in crowded monuments or remote trip discovery from home.',
  optionsHeading: 'What Every Option & Screen Does',
  optionsSubheading:
    'A brief guide to all eight primary navigation tabs—plus how Discover, Attractions, and Explore More work together.',
  distinctionHeading: 'How Discover, Attractions & Explore More Differ',
  readyTourHeading: 'Ready for the Interactive Screen Tour?',
  readyTourDesc:
    'Preview each of the 8 screens step by step so you know where every control lives—or skip directly to Sign In or real-time exploring whenever you wish.',
  beginTourBtn: 'Begin Interactive Tour',
  welcomeSpeech: WELCOME_SPEECH_AUDIO_SCRIPT,
  distDiscoverLabel: FEATURE_DISTINCTION_NOTES[0].discoverLabel,
  distDiscoverText: FEATURE_DISTINCTION_NOTES[0].discoverText,
  distAttractionsLabel: FEATURE_DISTINCTION_NOTES[0].attractionsLabel,
  distAttractionsText: FEATURE_DISTINCTION_NOTES[0].attractionsText,
  distExploreLabel: FEATURE_DISTINCTION_NOTES[0].exploreMoreLabel,
  distExploreText: FEATURE_DISTINCTION_NOTES[0].exploreMoreText,
  ch1_heading: SPEECH_CHAPTERS[0].heading,
  ch1_body: SPEECH_CHAPTERS[0].body,
  ch2_heading: SPEECH_CHAPTERS[1].heading,
  ch2_body: SPEECH_CHAPTERS[1].body,
  ch3_heading: SPEECH_CHAPTERS[2].heading,
  ch3_body: SPEECH_CHAPTERS[2].body,
  ch4_heading: SPEECH_CHAPTERS[3].heading,
  ch4_body: SPEECH_CHAPTERS[3].body,
  wf1_title: WORKFLOW_STEPS[0].title,
  wf1_detail: WORKFLOW_STEPS[0].detail,
  wf2_title: WORKFLOW_STEPS[1].title,
  wf2_detail: WORKFLOW_STEPS[1].detail,
  wf3_title: WORKFLOW_STEPS[2].title,
  wf3_detail: WORKFLOW_STEPS[2].detail,
  wf4_title: WORKFLOW_STEPS[3].title,
  wf4_detail: WORKFLOW_STEPS[3].detail,
};

export const AppIntroductionPage: React.FC<AppIntroductionPageProps> = ({
  selectedLanguage,
  guideSettings,
  onUpdateSpeechRate,
  isReplayMode = false,
  onBack,
  onOpenLanguageModal,
  onStartTour,
  onSkipIntroOnly,
  onSkipToLogin,
  onSkipAllToApp,
}) => {
  const [isSpeakingWelcome, setIsSpeakingWelcome] = useState(false);
  const [speechRate, setSpeechRate] = useState<number>(() => normalizeAudioSpeed(guideSettings.speechRate));
  const [showFullTranscript, setShowFullTranscript] = useState(false);
  const [heroImgFailed, setHeroImgFailed] = useState(false);
  const [pillarsImgFailed, setPillarsImgFailed] = useState(false);
  const pageScrollRef = usePreservedScroll<HTMLDivElement>('replay:intro', true);

  const featureDefaults = useMemo(() => {
    const map: Record<string, string> = {};
    APP_PRIMARY_FEATURES.forEach((f) => {
      map[`feat_${f.id}_title`] = f.introTitle;
      map[`feat_${f.id}_summary`] = f.summary;
    });
    return { ...INTRO_CHROME_DEFAULTS, ...map } as Record<string, string>;
  }, []);

  const { t } = useLocalizedTexts(
    featureDefaults,
    selectedLanguage,
    'App Introduction page, 8 navigation options, welcome speech, and workflow guide'
  );

  // Sync speechRate with Settings updates
  useEffect(() => {
    if (typeof guideSettings.speechRate === 'number' && guideSettings.speechRate > 0) {
      setSpeechRate(normalizeAudioSpeed(guideSettings.speechRate));
    }
  }, [guideSettings.speechRate]);

  // Stop any playing speech on language change or unmount so audio always matches current language
  useEffect(() => {
    speechManager.stop();
    setIsSpeakingWelcome(false);
  }, [selectedLanguage.code]);

  useEffect(() => {
    return () => {
      speechManager.stop();
    };
  }, []);

  const localizedChapters = [
    { heading: t.ch1_heading, body: t.ch1_body },
    { heading: t.ch2_heading, body: t.ch2_body },
    { heading: t.ch3_heading, body: t.ch3_body },
    { heading: t.ch4_heading, body: t.ch4_body },
  ];

  const localizedWorkflow = [
    { step: '01', title: t.wf1_title, detail: t.wf1_detail, icon: WORKFLOW_STEPS[0].icon },
    { step: '02', title: t.wf2_title, detail: t.wf2_detail, icon: WORKFLOW_STEPS[1].icon },
    { step: '03', title: t.wf3_title, detail: t.wf3_detail, icon: WORKFLOW_STEPS[2].icon },
    { step: '04', title: t.wf4_title, detail: t.wf4_detail, icon: WORKFLOW_STEPS[3].icon },
  ];

  const localizedOptionsGuide = APP_PRIMARY_FEATURES.map((feat) => ({
    id: feat.id,
    stepNumber: feat.stepNumber,
    name: t[`feat_${feat.id}_title`] || feat.introTitle,
    summary: t[`feat_${feat.id}_summary`] || feat.summary,
    icon: FEATURE_ICON_MAP[feat.id] || Compass,
  }));

  const speakWelcomeWithRate = (rateToUse: number) => {
    const scriptToSpeak = t.welcomeSpeech || WELCOME_SPEECH_AUDIO_SCRIPT;
    setIsSpeakingWelcome(true);
    speechManager.speak({
      text: scriptToSpeak,
      language: selectedLanguage.name,
      languageCode: selectedLanguage.speechCode,
      gender: guideSettings.voiceGender || 'female',
      pitch: guideSettings.voicePitch || (guideSettings.voiceGender === 'male' ? 0.95 : 1.08),
      rate: rateToUse,
      onStart: () => setIsSpeakingWelcome(true),
      onEnd: () => setIsSpeakingWelcome(false),
      onError: () => setIsSpeakingWelcome(false),
    });
  };

  const handleToggleSpeech = () => {
    if (isSpeakingWelcome) {
      speechManager.stop();
      setIsSpeakingWelcome(false);
      return;
    }
    speakWelcomeWithRate(speechRate);
  };

  const handleSpeedChange = (nextRate: number) => {
    const normalized = normalizeAudioSpeed(nextRate);
    setSpeechRate(normalized);
    speechManager.setRate(normalized);
    onUpdateSpeechRate?.(normalized);
  };

  const handleActionWithStop = (callback: () => void) => {
    speechManager.stop();
    setIsSpeakingWelcome(false);
    callback();
  };

  return (
    <div
      ref={pageScrollRef}
      id="app-introduction-page"
      dir={selectedLanguage.direction === 'rtl' ? 'rtl' : 'ltr'}
      className="relative z-10 flex-1 min-h-0 overflow-y-auto overflow-x-hidden select-none"
    >
      {/* Compact Sub-View Context & Skip Action Strip */}
      <div
        style={{
          backgroundColor: 'var(--theme-card-bg)',
          borderColor: 'var(--theme-card-border)',
        }}
        className="sticky top-0 z-20 border-b backdrop-blur-xl px-4 py-2"
      >
        <div className="max-w-5xl mx-auto flex items-center justify-between gap-3">
          <div className="min-w-0 flex items-center gap-2.5">
            {onBack && (
              <BackButton
                id="btn-intro-back"
                compact
                onClick={() => handleActionWithStop(onBack)}
                selectedLanguage={selectedLanguage}
              />
            )}
            <div className="flex items-center gap-2 text-xs min-w-0">
              <span className="font-serif font-bold text-[var(--theme-text-title)] truncate">
                {t.headerTitle}
              </span>
              <span className="text-[var(--theme-text-muted)] hidden sm:inline">·</span>
              <span className="text-[11px] text-[var(--theme-text-muted)] hidden sm:inline truncate">
                {t.headerSubtitle}
              </span>
            </div>
          </div>

          <div className="flex items-center gap-2 shrink-0">
            <button
              type="button"
              onClick={onOpenLanguageModal}
              style={{
                backgroundColor: 'var(--theme-card-bg-subtle)',
                borderColor: 'var(--theme-card-border)',
                color: 'var(--theme-text-body)',
              }}
              className="min-h-[38px] px-3 rounded-xl border text-xs font-semibold flex items-center gap-1.5 cursor-pointer hover:border-[var(--theme-card-border-glow)] transition-colors whitespace-nowrap shrink-0"
              title={t.chooseLangTitle}
            >
              <span>{selectedLanguage.flag}</span>
              <span className="hidden xs:inline">{selectedLanguage.nativeName}</span>
              <Languages className="w-3.5 h-3.5 text-[var(--theme-accent-secondary)]" />
            </button>

            <button
              id="btn-skip-intro-top"
              type="button"
              onClick={() =>
                handleActionWithStop(isReplayMode ? onSkipAllToApp : onSkipIntroOnly || onSkipToLogin)
              }
              style={{
                backgroundColor: 'var(--theme-card-bg-subtle)',
                borderColor: 'var(--theme-card-border)',
                color: 'var(--theme-text-title)',
              }}
              className="min-h-[38px] px-3.5 rounded-xl border text-xs font-bold flex items-center gap-1.5 cursor-pointer hover:border-[var(--theme-accent-primary)] transition-all active:scale-95 whitespace-nowrap shrink-0"
            >
              <span>{isReplayMode ? t.backToExplore : t.skipIntro}</span>
              <ArrowRight className="w-3.5 h-3.5 text-[var(--theme-accent-primary)]" />
            </button>
          </div>
        </div>
      </div>

      {/* Main Content Body */}
      <div className="max-w-5xl mx-auto px-4 sm:px-6 py-6 sm:py-8 space-y-8 pb-12">
        {/* Hero Split Grid */}
        <section className="grid grid-cols-1 lg:grid-cols-12 gap-6 items-center">
          {/* Left Editorial Pitch & Welcome Speech Player */}
          <div className="lg:col-span-7 space-y-5">
            <div className="space-y-2.5">
              <p className="text-xs font-semibold uppercase tracking-[0.14em] text-[var(--theme-accent-secondary)]">
                {t.eyebrow}
              </p>
              <h1 className="font-serif font-bold text-2xl sm:text-4xl text-[var(--theme-text-title)] leading-tight [text-wrap:balance]">
                {t.heroHeading}
              </h1>
              <p className="text-[15px] leading-relaxed text-[var(--theme-text-body)]">
                {t.heroBody}
              </p>
            </div>

            {/* Playable Welcome Speech Module */}
            <div
              style={{
                backgroundColor: 'var(--theme-card-bg)',
                borderColor: isSpeakingWelcome ? 'var(--theme-accent-primary)' : 'var(--theme-card-border)',
              }}
              className="p-4 rounded-2xl border shadow-lg space-y-3 backdrop-blur-xl transition-colors"
            >
              <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-3">
                <div className="flex items-start gap-3">
                  <div
                    style={{
                      background: isSpeakingWelcome
                        ? 'var(--theme-accent-primary-gradient)'
                        : 'var(--theme-card-bg-subtle)',
                      color: isSpeakingWelcome
                        ? 'var(--theme-accent-primary-text)'
                        : 'var(--theme-accent-primary)',
                      borderColor: 'var(--theme-card-border)',
                    }}
                    className="w-10 h-10 rounded-xl border flex items-center justify-center shrink-0"
                  >
                    <Volume2 className="w-5 h-5" />
                  </div>
                  <div>
                    <h2 className="font-serif font-bold text-sm text-[var(--theme-text-title)]">
                      {t.speechModuleTitle}
                    </h2>
                    <p className="text-xs text-[var(--theme-text-muted)]">
                      {isSpeakingWelcome
                        ? t.speechPlayingHint
                        : `${t.speechIdleHint} · ${selectedLanguage.nativeName}`}
                    </p>
                  </div>
                </div>

                <div className="flex items-center gap-2 shrink-0">
                  <AudioSpeedControl
                    id="btn-intro-audio-speed"
                    speed={speechRate}
                    onChangeSpeed={handleSpeedChange}
                    isRtl={selectedLanguage.direction === 'rtl'}
                    tone="subtle"
                  />

                  <button
                    id="btn-play-welcome-speech"
                    type="button"
                    onClick={handleToggleSpeech}
                    style={
                      isSpeakingWelcome
                        ? { backgroundColor: '#e11d48', color: '#ffffff' }
                        : undefined
                    }
                    className={`min-h-[44px] px-4 rounded-xl text-xs font-bold flex items-center gap-2 cursor-pointer transition-all whitespace-nowrap shrink-0 ${
                      isSpeakingWelcome ? 'shadow-md' : 'theme-btn-primary'
                    }`}
                  >
                    {isSpeakingWelcome ? (
                      <>
                        <Square className="w-3.5 h-3.5 fill-current" />
                        <span>{t.stopSpeech}</span>
                      </>
                    ) : (
                      <>
                        <Play className="w-3.5 h-3.5 fill-current" />
                        <span>{t.playSpeech}</span>
                      </>
                    )}
                  </button>
                </div>
              </div>

              {guideSettings.outputMode === 'text' && !isSpeakingWelcome && (
                <p className="text-[11px] text-[var(--theme-text-muted)] italic">
                  {t.silentModeNote}
                </p>
              )}

              {/* Active Audio Level Bars */}
              {isSpeakingWelcome && (
                <div className="flex items-center gap-1.5 pt-1">
                  <span className="text-[11px] font-semibold text-[var(--theme-accent-secondary)] mr-1">
                    {t.voiceActive}
                  </span>
                  {[0, 1, 2, 3, 4, 5].map((bar) => (
                    <span
                      key={bar}
                      style={{ backgroundColor: 'var(--theme-accent-primary)' }}
                      className="w-1 h-3 rounded-full animate-pulse"
                    />
                  ))}
                </div>
              )}

              {/* Toggle Full Speech Transcript */}
              <div
                className="pt-2 border-t flex items-center justify-between"
                style={{ borderColor: 'var(--theme-card-border)' }}
              >
                <button
                  type="button"
                  onClick={() => setShowFullTranscript((prev) => !prev)}
                  className="text-xs font-semibold text-[var(--theme-accent-secondary)] hover:underline flex items-center gap-1 cursor-pointer min-h-[36px]"
                >
                  <span>
                    {showFullTranscript ? t.hideTranscript : t.readTranscript}
                  </span>
                  {showFullTranscript ? (
                    <ChevronUp className="w-3.5 h-3.5" />
                  ) : (
                    <ChevronDown className="w-3.5 h-3.5" />
                  )}
                </button>
              </div>

              {showFullTranscript && (
                <div
                  style={{
                    backgroundColor: 'var(--theme-card-bg-subtle)',
                    borderColor: 'var(--theme-card-border)',
                  }}
                  className="p-3.5 rounded-xl border space-y-3 text-xs leading-relaxed text-[var(--theme-text-body)] max-h-60 overflow-y-auto"
                >
                  {localizedChapters.map((chapter) => (
                    <div key={chapter.heading} className="space-y-1">
                      <h3 className="font-serif font-bold text-[var(--theme-accent-primary)] text-xs">
                        {chapter.heading}
                      </h3>
                      <p>{chapter.body}</p>
                    </div>
                  ))}
                </div>
              )}
            </div>

            {/* Primary Call-To-Action Row */}
            <div className="flex flex-wrap items-center gap-3 pt-1">
              <button
                id="btn-intro-start-tour"
                type="button"
                onClick={() => handleActionWithStop(onStartTour)}
                className="min-h-[48px] px-5 py-3 rounded-xl theme-btn-primary text-sm font-bold flex items-center gap-2 cursor-pointer whitespace-nowrap shrink-0"
              >
                <Sparkles className="w-4 h-4" />
                <span>{t.startTourCta}</span>
                <ArrowRight className="w-4 h-4" />
              </button>

              {!isReplayMode && (
                <button
                  id="btn-intro-skip-to-login"
                  type="button"
                  onClick={() => handleActionWithStop(onSkipToLogin)}
                  className="min-h-[48px] px-4 py-3 rounded-xl theme-btn-secondary text-xs sm:text-sm font-semibold cursor-pointer whitespace-nowrap shrink-0"
                >
                  {t.skipToLoginCta}
                </button>
              )}

              <button
                id="btn-intro-skip-all"
                type="button"
                onClick={() => handleActionWithStop(onSkipAllToApp)}
                className="min-h-[44px] px-3 py-2 text-xs font-semibold text-[var(--theme-text-muted)] hover:text-[var(--theme-text-title)] underline underline-offset-4 cursor-pointer whitespace-nowrap shrink-0"
              >
                {isReplayMode ? t.returnToWorkspace : t.skipAllCta}
              </button>
            </div>
          </div>

          {/* Right Atmospheric Heritage Showcase Frame */}
          <div className="lg:col-span-5">
            <div
              style={{
                backgroundColor: 'var(--theme-card-bg)',
                borderColor: 'var(--theme-card-border)',
              }}
              className="rounded-2xl border overflow-hidden shadow-2xl"
            >
              <div className="relative aspect-[16/10] w-full overflow-hidden">
                {!heroImgFailed ? (
                  <img
                    src={introHeroImg}
                    alt="Golden carved sandstone heritage temple courtyard at dusk"
                    referrerPolicy="no-referrer"
                    onError={() => setHeroImgFailed(true)}
                    className="w-full h-full object-cover"
                  />
                ) : (
                  <div
                    style={{ background: 'var(--theme-bg-gradient)' }}
                    className="w-full h-full flex flex-col items-center justify-center p-6 text-center"
                  >
                    <MeenakshiLogo className="w-16 h-16 mb-2" />
                    <span className="font-serif font-bold text-sm text-[var(--theme-accent-primary)]">
                      Charaiva Cultural Lens
                    </span>
                  </div>
                )}
                <div className="absolute inset-0 bg-gradient-to-t from-black/75 via-black/15 to-transparent pointer-events-none" />
                <div className="absolute bottom-3 left-3 right-3 text-white space-y-0.5">
                  <p className="text-[11px] font-semibold uppercase tracking-wider text-[var(--theme-accent-primary)]">
                    {t.heroCardEyebrow}
                  </p>
                  <p className="text-xs font-medium text-white/90">
                    {t.heroCardSub}
                  </p>
                </div>
              </div>

              <div className="p-4 space-y-2.5 text-xs">
                <div className="flex items-start gap-2.5">
                  <CheckCircle2 className="w-4 h-4 text-[var(--theme-accent-secondary)] shrink-0 mt-0.5" />
                  <p className="text-[var(--theme-text-body)]">
                    <strong className="text-[var(--theme-text-title)]">{t.fastSpeedLabel}</strong>{' '}
                    {t.fastSpeedDesc}
                  </p>
                </div>
                <div className="flex items-start gap-2.5">
                  <CheckCircle2 className="w-4 h-4 text-[var(--theme-accent-secondary)] shrink-0 mt-0.5" />
                  <p className="text-[var(--theme-text-body)]">
                    <strong className="text-[var(--theme-text-title)]">{t.storageChoiceLabel}</strong>{' '}
                    {t.storageChoiceDesc}
                  </p>
                </div>
              </div>
            </div>
          </div>
        </section>

        {/* How Charaiva Works: 4-Step Workflow */}
        <section className="space-y-4">
          <div className="flex flex-col sm:flex-row sm:items-end justify-between gap-2">
            <div>
              <h2 className="font-serif font-bold text-xl text-[var(--theme-text-title)]">
                {t.workflowHeading}
              </h2>
              <p className="text-xs text-[var(--theme-text-muted)]">
                {t.workflowSubheading}
              </p>
            </div>
          </div>

          <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-3">
            {localizedWorkflow.map((item) => {
              const Icon = item.icon;
              return (
                <div
                  key={item.step}
                  style={{
                    backgroundColor: 'var(--theme-card-bg)',
                    borderColor: 'var(--theme-card-border)',
                  }}
                  className="p-4 rounded-2xl border space-y-2.5 shadow-md"
                >
                  <div className="flex items-center justify-between">
                    <span className="font-serif font-bold text-sm text-[var(--theme-accent-primary)]">
                      {item.step}
                    </span>
                    <Icon className="w-4 h-4 text-[var(--theme-accent-secondary)]" />
                  </div>
                  <h3 className="font-serif font-bold text-sm text-[var(--theme-text-title)]">
                    {item.title}
                  </h3>
                  <p className="text-xs leading-relaxed text-[var(--theme-text-muted)]">
                    {item.detail}
                  </p>
                </div>
              );
            })}
          </div>
        </section>

        {/* Brief Guide to All 8 Screens & Options */}
        <section className="grid grid-cols-1 lg:grid-cols-12 gap-5 items-start">
          <div className="lg:col-span-8 space-y-4">
            <div>
              <h2 className="font-serif font-bold text-xl text-[var(--theme-text-title)]">
                {t.optionsHeading}
              </h2>
              <p className="text-xs text-[var(--theme-text-muted)]">
                {t.optionsSubheading}
              </p>
            </div>

            <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
              {localizedOptionsGuide.map((opt) => {
                const Icon = opt.icon;
                return (
                  <div
                    key={opt.id}
                    id={`intro-option-${opt.id}`}
                    style={{
                      backgroundColor: 'var(--theme-card-bg)',
                      borderColor: 'var(--theme-card-border)',
                    }}
                    className="p-3.5 rounded-2xl border flex items-start gap-3 shadow-sm"
                  >
                    <div
                      style={{
                        backgroundColor: 'var(--theme-card-bg-subtle)',
                        borderColor: 'var(--theme-card-border)',
                        color: 'var(--theme-accent-primary)',
                      }}
                      className="w-9 h-9 rounded-xl border flex items-center justify-center shrink-0 mt-0.5"
                    >
                      <Icon className="w-4 h-4" />
                    </div>
                    <div className="min-w-0 space-y-1">
                      <h3 className="text-xs font-bold text-[var(--theme-text-title)]">
                        {opt.stepNumber}. {opt.name}
                      </h3>
                      <p className="text-[11.5px] leading-relaxed text-[var(--theme-text-muted)]">
                        {opt.summary}
                      </p>
                    </div>
                  </div>
                );
              })}
            </div>

            {/* Clear Distinction: Discover vs Attractions vs Explore More */}
            <div
              style={{
                backgroundColor: 'var(--theme-card-bg)',
                borderColor: 'var(--theme-card-border)',
              }}
              className="p-4 rounded-2xl border space-y-2.5 shadow-sm"
            >
              <h3 className="text-xs font-serif font-bold text-[var(--theme-accent-primary)]">
                {t.distinctionHeading}
              </h3>
              <div className="grid grid-cols-1 sm:grid-cols-3 gap-2.5 text-[11.5px] leading-relaxed">
                <div
                  style={{
                    backgroundColor: 'var(--theme-card-bg-subtle)',
                    borderColor: 'var(--theme-card-border)',
                  }}
                  className="p-2.5 rounded-xl border space-y-1"
                >
                  <p className="font-bold text-[var(--theme-text-title)]">{t.distDiscoverLabel}</p>
                  <p className="text-[var(--theme-text-muted)]">{t.distDiscoverText}</p>
                </div>
                <div
                  style={{
                    backgroundColor: 'var(--theme-card-bg-subtle)',
                    borderColor: 'var(--theme-card-border)',
                  }}
                  className="p-2.5 rounded-xl border space-y-1"
                >
                  <p className="font-bold text-[var(--theme-text-title)]">{t.distAttractionsLabel}</p>
                  <p className="text-[var(--theme-text-muted)]">{t.distAttractionsText}</p>
                </div>
                <div
                  style={{
                    backgroundColor: 'var(--theme-card-bg-subtle)',
                    borderColor: 'var(--theme-card-border)',
                  }}
                  className="p-2.5 rounded-xl border space-y-1"
                >
                  <p className="font-bold text-[var(--theme-text-title)]">{t.distExploreLabel}</p>
                  <p className="text-[var(--theme-text-muted)]">{t.distExploreText}</p>
                </div>
              </div>
            </div>
          </div>

          {/* Right Highlight Image Panel */}
          <div className="lg:col-span-4 space-y-3">
            <div
              style={{
                backgroundColor: 'var(--theme-card-bg)',
                borderColor: 'var(--theme-card-border)',
              }}
              className="rounded-2xl border overflow-hidden shadow-lg"
            >
              <div className="aspect-[4/3] w-full overflow-hidden">
                {!pillarsImgFailed ? (
                  <img
                    src={tourPillarsImg}
                    alt="Carved temple stone colonnade pillars lit by warm afternoon sunlight"
                    referrerPolicy="no-referrer"
                    onError={() => setPillarsImgFailed(true)}
                    className="w-full h-full object-cover"
                  />
                ) : (
                  <div
                    style={{ background: 'var(--theme-bg-gradient)' }}
                    className="w-full h-full flex items-center justify-center p-6"
                  >
                    <Camera className="w-10 h-10 text-[var(--theme-accent-primary)]" />
                  </div>
                )}
              </div>
              <div className="p-4 space-y-2">
                <h3 className="font-serif font-bold text-sm text-[var(--theme-text-title)]">
                  {t.readyTourHeading}
                </h3>
                <p className="text-xs leading-relaxed text-[var(--theme-text-muted)]">
                  {t.readyTourDesc}
                </p>
                <button
                  type="button"
                  onClick={() => handleActionWithStop(onStartTour)}
                  className="w-full min-h-[44px] px-4 rounded-xl theme-btn-primary text-xs font-bold flex items-center justify-center gap-2 cursor-pointer mt-2 whitespace-nowrap"
                >
                  <span>{t.beginTourBtn}</span>
                  <ArrowRight className="w-4 h-4" />
                </button>
              </div>
            </div>
          </div>
        </section>
      </div>
    </div>
  );
};
