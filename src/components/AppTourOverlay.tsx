import React, { useState, useEffect, useLayoutEffect, useMemo, useRef } from 'react';
import {
  Compass,
  Camera,
  MapPin,
  MessageSquare,
  Map,
  History,
  Sliders,
  ArrowRight,
  ArrowLeft,
  ArrowUp,
  Sparkles,
  Volume2,
  HardDrive,
  Languages,
  Navigation,
  Search,
  CheckCircle2,
  X,
} from 'lucide-react';
import { AppTab, GuideSettings, Language, UserProfile } from '../types';
import { speechManager } from '../utils/speech';
import { AudioSpeedControl } from './AudioSpeedControl';
import { BackButton } from './BackButton';
import { usePreservedScroll } from '../utils/navigationHistory';
import { APP_PRIMARY_FEATURES, SUPPORTED_LANGUAGE_COUNT } from '../data/appFeatures';
import { useLocalizedTexts } from '../data/localizedStrings';
import introHeroImg from '../assets/images/intro_heritage_hero_1794280981908.jpg';
import tourPillarsImg from '../assets/images/tour_vision_pillars_1794280982922.jpg';
import tourCityImg from '../assets/images/tour_city_skyline_1794280982464.jpg';

interface AppTourOverlayProps {
  selectedLanguage: Language;
  guideSettings: GuideSettings;
  onUpdateSpeechRate?: (rate: number) => void;
  userProfile?: UserProfile | null;
  isReplayMode?: boolean;
  onActiveStepChange?: (tab: AppTab | null) => void;
  onBack?: () => void;
  onCompleteTour: () => void;
  onSkipTourToExploreNow: () => void;
  onBackToIntro?: () => void;
}

interface TourStepConfig {
  id: AppTab;
  number: string;
  tabLabel: string;
  title: string;
  headline: string;
  description: string;
  whatItDoes: Array<{ label: string; detail: string }>;
  image?: string;
  imageAlt?: string;
  icon: React.ComponentType<{ className?: string }>;
  spokenHint: string;
}

const TOUR_ICON_BY_TAB: Partial<Record<AppTab, React.ComponentType<{ className?: string }>>> = {
  home: Compass,
  camera: Camera,
  discover: Search,
  nearby: MapPin,
  chat: MessageSquare,
  map: Map,
  history: History,
  settings: Sliders,
};

const TOUR_IMAGE_BY_TAB: Partial<Record<AppTab, { image: string; imageAlt: string }>> = {
  home: {
    image: tourCityImg,
    imageAlt: 'Historic Indian stone waterfront ghats and skyline bathed in twilight lantern light',
  },
  camera: {
    image: tourPillarsImg,
    imageAlt: 'Illuminated carved stone temple corridor pillars',
  },
  history: {
    image: introHeroImg,
    imageAlt: 'Sunlit temple colonnade preserved as a travel memory',
  },
};

const TOUR_CHROME_DEFAULTS = {
  headerTitle: 'Interactive Screen Tour',
  screenWord: 'Screen',
  ofWord: 'of',
  headerSubtitle: 'Learn what every screen does — or tap any option below to explore live',
  introButton: 'Intro',
  closeTour: 'Close Tour',
  skipTourNow: 'Skip Tour & Explore Now',
  stopHint: 'Stop Hint',
  hearHint: 'Hear Screen Hint',
  whatYouCanDo: 'What you can do on this screen',
  realTimeReady: 'Real-Time Exploration Ready',
  previousBtn: 'Previous',
  skipExploreLink: 'Skip Tour & Explore in Real Time',
  finishReturnBtn: 'Finish Tour & Return',
  continueSetupBtn: 'Continue to Sign In & Preferences',
  nextPrefix: 'Next',
  readyInRealTime: 'Ready in Real Time',
  bottomBarDest: 'Navigation Destination',
  pointingToNavTab: 'Live Control Above',
  insideMoreMenuHint: 'Tap More above to open',
};

export const AppTourOverlay: React.FC<AppTourOverlayProps> = ({
  selectedLanguage,
  guideSettings,
  onUpdateSpeechRate,
  isReplayMode = false,
  onActiveStepChange,
  onBack,
  onCompleteTour,
  onSkipTourToExploreNow,
  onBackToIntro,
}) => {
  const [stepIndex, setStepIndex] = useState(0);
  const [isSpeakingHint, setIsSpeakingHint] = useState(false);
  const [failedImages, setFailedImages] = useState<Record<string, boolean>>({});
  const tourScrollRef = usePreservedScroll<HTMLDivElement>('replay:tour', true);
  const pointerStripRef = useRef<HTMLDivElement | null>(null);
  const pillsRowRef = useRef<HTMLDivElement | null>(null);
  const [pointerMetrics, setPointerMetrics] = useState<{
    arrowX: number;
    viaMoreMenu: boolean;
    visible: boolean;
  }>({ arrowX: 40, viaMoreMenu: false, visible: false });

  const tourTranslationDefaults = useMemo(() => {
    const map: Record<string, string> = { ...TOUR_CHROME_DEFAULTS };
    APP_PRIMARY_FEATURES.forEach((feat) => {
      map[`${feat.id}_tab`] = feat.navLabel;
      map[`${feat.id}_title`] = feat.tourTitle;
      map[`${feat.id}_headline`] = feat.tourHeadline;
      map[`${feat.id}_desc`] = feat.tourDescription;
      map[`${feat.id}_hint`] = feat.spokenHint;
      feat.whatItDoes.forEach((item, idx) => {
        map[`${feat.id}_w${idx}_label`] = item.label;
        map[`${feat.id}_w${idx}_detail`] = item.detail;
      });
    });
    return map;
  }, []);

  const { t } = useLocalizedTexts(
    tourTranslationDefaults,
    selectedLanguage,
    'Interactive 8-screen app tour steps, controls, and spoken hints'
  );

  const localizedSteps: TourStepConfig[] = useMemo(
    () =>
      APP_PRIMARY_FEATURES.map((feat) => {
        const media = TOUR_IMAGE_BY_TAB[feat.id];
        return {
          id: feat.id,
          number: feat.stepNumber,
          tabLabel: t[`${feat.id}_tab`] || feat.navLabel,
          title: t[`${feat.id}_title`] || feat.tourTitle,
          headline: t[`${feat.id}_headline`] || feat.tourHeadline,
          description: t[`${feat.id}_desc`] || feat.tourDescription,
          whatItDoes: feat.whatItDoes.map((item, idx) => ({
            label: t[`${feat.id}_w${idx}_label`] || item.label,
            detail: t[`${feat.id}_w${idx}_detail`] || item.detail,
          })),
          image: media?.image,
          imageAlt: media?.imageAlt,
          icon: TOUR_ICON_BY_TAB[feat.id] || Compass,
          spokenHint: t[`${feat.id}_hint`] || feat.spokenHint,
        };
      }),
    [t]
  );

  const currentStep = localizedSteps[stepIndex] || localizedSteps[0];
  const isLastStep = stepIndex === localizedSteps.length - 1;
  const StepIcon = currentStep.icon;

  useEffect(() => {
    onActiveStepChange?.(currentStep.id);
  }, [currentStep.id]);

  useEffect(() => {
    return () => {
      onActiveStepChange?.(null);
      speechManager.stop();
    };
  }, []);

  // Measure the real Navigation control above so the Tour pointer arrow aligns accurately on both Desktop and Mobile
  useLayoutEffect(() => {
    const updatePointer = () => {
      const stripEl = pointerStripRef.current;
      if (!stripEl) return;
      const stripRect = stripEl.getBoundingClientRect();
      if (stripRect.width <= 0) return;

      const desktopTarget = document.getElementById(`nav-tab-${currentStep.id}`);
      const mobilePrimaryTarget = document.getElementById(`nav-tab-mobile-${currentStep.id}`);
      const mobileMoreTarget = document.getElementById('nav-tab-mobile-more');

      const isVisibleRect = (el: HTMLElement | null) => {
        if (!el) return null;
        const r = el.getBoundingClientRect();
        return r.width > 0 && r.height > 0 ? r : null;
      };

      const deskRect = isVisibleRect(desktopTarget);
      const mobPrimaryRect = isVisibleRect(mobilePrimaryTarget);
      const mobMoreRect = isVisibleRect(mobileMoreTarget);

      let targetRect: DOMRect | null = deskRect || mobPrimaryRect;
      let viaMoreMenu = false;
      if (!targetRect && mobMoreRect) {
        targetRect = mobMoreRect;
        viaMoreMenu = true;
      }

      if (!targetRect) {
        setPointerMetrics((prev) => (prev.visible ? { ...prev, visible: false } : prev));
        return;
      }

      const rawCenterX = targetRect.left + targetRect.width / 2 - stripRect.left;
      const clampedX = Math.max(16, Math.min(stripRect.width - 16, rawCenterX));
      setPointerMetrics({
        arrowX: clampedX,
        viaMoreMenu,
        visible: true,
      });
    };

    updatePointer();
    const rafId = window.requestAnimationFrame(updatePointer);
    window.addEventListener('resize', updatePointer);
    return () => {
      window.cancelAnimationFrame(rafId);
      window.removeEventListener('resize', updatePointer);
    };
  }, [currentStep.id]);

  // Keep active step pill centered horizontally within the pills strip without scrolling ancestor frames
  useEffect(() => {
    const row = pillsRowRef.current;
    const activePill = document.getElementById(`tour-step-pill-${currentStep.id}`);
    if (!row || !activePill) return;
    const rowRect = row.getBoundingClientRect();
    const pillRect = activePill.getBoundingClientRect();
    if (pillRect.left < rowRect.left || pillRect.right > rowRect.right) {
      const targetLeft = activePill.offsetLeft - Math.max(0, (row.clientWidth - activePill.offsetWidth) / 2);
      row.scrollTo({ left: Math.max(0, targetLeft), behavior: 'smooth' });
    }
  }, [currentStep.id]);

  // Stop speech cleanly when step or language changes
  useEffect(() => {
    speechManager.stop();
    setIsSpeakingHint(false);
  }, [stepIndex, selectedLanguage.code]);

  const handleToggleHintSpeech = () => {
    if (isSpeakingHint) {
      speechManager.stop();
      setIsSpeakingHint(false);
      return;
    }

    setIsSpeakingHint(true);
    speechManager.speak({
      text: currentStep.spokenHint,
      language: selectedLanguage.name,
      languageCode: selectedLanguage.speechCode,
      gender: guideSettings.voiceGender || 'female',
      pitch: guideSettings.voicePitch || (guideSettings.voiceGender === 'male' ? 0.95 : 1.08),
      rate: guideSettings.speechRate || 1.0,
      onStart: () => setIsSpeakingHint(true),
      onEnd: () => setIsSpeakingHint(false),
      onError: () => setIsSpeakingHint(false),
    });
  };

  const handleSkipNow = () => {
    speechManager.stop();
    onSkipTourToExploreNow();
  };

  const handleNext = () => {
    speechManager.stop();
    if (isLastStep) {
      onCompleteTour();
    } else {
      setStepIndex((i) => Math.min(localizedSteps.length - 1, i + 1));
    }
  };

  const handlePrev = () => {
    speechManager.stop();
    if (stepIndex > 0) {
      setStepIndex((i) => i - 1);
    }
  };

  const renderScreenSchematic = (step: TourStepConfig) => {
    if (step.image && !failedImages[step.id]) {
      return (
        <div className="relative aspect-[4/3] w-full overflow-hidden">
          <img
            src={step.image}
            alt={step.imageAlt || step.title}
            referrerPolicy="no-referrer"
            onError={() => setFailedImages((prev) => ({ ...prev, [step.id]: true }))}
            className="w-full h-full object-cover"
          />
          <div className="absolute inset-0 bg-gradient-to-t from-black/80 via-black/20 to-transparent pointer-events-none" />
          <div className="absolute bottom-3 left-3 right-3 text-white flex items-end justify-between gap-2">
            <div>
              <p className="text-[10.5px] font-bold uppercase tracking-wider text-[var(--theme-accent-primary)]">
                {t.screenWord} {step.number} · {step.tabLabel}
              </p>
              <p className="text-xs font-medium text-white/95">{step.title}</p>
            </div>
          </div>
        </div>
      );
    }

    // Authentic interactive schematic preview matching real controls inside that Charaiva screen
    return (
      <div
        style={{ background: 'var(--theme-card-bg-subtle)' }}
        className="aspect-[4/3] w-full p-4 sm:p-5 flex flex-col justify-between relative overflow-hidden"
      >
        <div className="flex items-center justify-between gap-2">
          <div className="flex items-center gap-2">
            <div
              style={{
                background: 'var(--theme-accent-primary-gradient)',
                color: 'var(--theme-accent-primary-text)',
              }}
              className="w-8 h-8 rounded-xl flex items-center justify-center shrink-0"
            >
              <StepIcon className="w-4 h-4" />
            </div>
            <div>
              <p className="text-[11px] font-bold uppercase tracking-wider text-[var(--theme-accent-primary)]">
                {t.screenWord} {step.number}
              </p>
              <p className="text-xs font-serif font-bold text-[var(--theme-text-title)]">
                {step.tabLabel}
              </p>
            </div>
          </div>
          <span className="text-[11px] font-semibold text-[var(--theme-text-muted)]">
            {selectedLanguage.flag} {selectedLanguage.nativeName}
          </span>
        </div>

        {/* Step 03 Discover Schematic */}
        {step.id === 'discover' && (
          <div className="space-y-2.5 my-auto">
            <div
              style={{
                backgroundColor: 'var(--theme-card-bg)',
                borderColor: 'var(--theme-card-border)',
              }}
              className="px-3 py-2 rounded-xl border flex items-center justify-between gap-2 text-xs"
            >
              <span className="flex items-center gap-2 text-[var(--theme-text-title)] font-medium truncate">
                <Search className="w-3.5 h-3.5 text-[var(--theme-accent-primary)] shrink-0" />
                <span className="truncate">“bronze dancing Shiva” · Clue or Voice</span>
              </span>
              <span className="px-2 py-0.5 rounded-md theme-badge-teal text-[10px] font-bold shrink-0">
                Step 1
              </span>
            </div>
            <div className="grid grid-cols-1 gap-1.5 text-[11px]">
              <div
                style={{
                  backgroundColor: 'var(--theme-card-bg)',
                  borderColor: 'var(--theme-accent-primary)',
                }}
                className="p-2.5 rounded-xl border flex items-center justify-between gap-2"
              >
                <div className="min-w-0">
                  <span className="font-bold text-[var(--theme-text-title)] block truncate">
                    Nataraja (Chola Bronze Sculpture)
                  </span>
                  <span className="text-[10.5px] text-[var(--theme-text-muted)] block truncate">
                    Step 1 Match → Select to open Step 2 full guide &amp; 5 Explore More topics
                  </span>
                </div>
                <ArrowRight className="w-3.5 h-3.5 text-[var(--theme-accent-primary)] shrink-0" />
              </div>
            </div>
          </div>
        )}

        {/* Specific Real Control Showcase per Screen */}
        {step.id === 'nearby' && (
          <div className="space-y-2.5 my-auto">
            <div className="flex flex-wrap gap-1.5 text-[11px] font-semibold">
              {['All Sights', 'Temples', 'Heritage', 'Museums', 'Food & Chai'].map((cat, idx) => (
                <span
                  key={cat}
                  style={
                    idx === 1
                      ? {
                          background: 'var(--theme-accent-primary-gradient)',
                          color: 'var(--theme-accent-primary-text)',
                        }
                      : {
                          backgroundColor: 'var(--theme-card-bg)',
                          borderColor: 'var(--theme-card-border)',
                          color: 'var(--theme-text-body)',
                        }
                  }
                  className="px-2.5 py-1 rounded-lg border"
                >
                  {cat}
                </span>
              ))}
            </div>
            <div
              style={{
                backgroundColor: 'var(--theme-card-bg)',
                borderColor: 'var(--theme-card-border)',
              }}
              className="p-3 rounded-xl border space-y-1"
            >
              <div className="flex items-center justify-between text-xs font-bold text-[var(--theme-text-title)]">
                <span>Meenakshi Amman Temple</span>
                <span className="text-[var(--theme-accent-secondary)]">420m · ★ 4.9</span>
              </div>
              <p className="text-[11px] text-[var(--theme-text-muted)]">
                14 towering polychrome gopurams and acoustic granite pillars near active GPS or picked city.
              </p>
            </div>
          </div>
        )}

        {step.id === 'chat' && (
          <div className="space-y-2 my-auto text-xs">
            <div
              style={{
                backgroundColor: 'var(--theme-card-bg)',
                borderColor: 'var(--theme-card-border)',
              }}
              className="p-2.5 rounded-xl border ml-8 text-[var(--theme-text-title)]"
            >
              “Why do the granite pillars near the mandapam produce musical notes?”
            </div>
            <div
              style={{
                backgroundColor: 'var(--theme-card-bg)',
                borderColor: 'var(--theme-accent-secondary)',
              }}
              className="p-2.5 rounded-xl border mr-4 space-y-1"
            >
              <p className="text-[10.5px] font-bold text-[var(--theme-accent-secondary)]">
                AI Guide · Session Memory Aware
              </p>
              <p className="text-[11px] text-[var(--theme-text-body)]">
                Each slender shaft beside the hall you toured earlier is carved to a calibrated resonant thickness from a single granite block.
              </p>
            </div>
          </div>
        )}

        {step.id === 'map' && (
          <div
            style={{
              backgroundColor: 'var(--theme-card-bg)',
              borderColor: 'var(--theme-card-border)',
            }}
            className="rounded-xl border p-3.5 my-auto space-y-2.5"
          >
            <div className="flex items-center justify-between text-xs">
              <span className="font-bold text-[var(--theme-text-title)] flex items-center gap-1.5">
                <Navigation className="w-3.5 h-3.5 text-[var(--theme-accent-secondary)]" />
                <span>Interactive Destination Viewport</span>
              </span>
              <span className="text-[11px] text-[var(--theme-accent-primary)]">3km Radius</span>
            </div>
            <div className="grid grid-cols-3 gap-2 text-center text-[11px]">
              <div
                style={{ backgroundColor: 'var(--theme-card-bg-subtle)', borderColor: 'var(--theme-card-border)' }}
                className="p-2 rounded-lg border"
              >
                <MapPin className="w-3.5 h-3.5 mx-auto text-[var(--theme-accent-primary)] mb-1" />
                <span className="font-semibold text-[var(--theme-text-title)] block truncate">Heritage Pin</span>
              </div>
              <div
                style={{ backgroundColor: 'var(--theme-card-bg-subtle)', borderColor: 'var(--theme-card-border)' }}
                className="p-2 rounded-lg border"
              >
                <Search className="w-3.5 h-3.5 mx-auto text-[var(--theme-accent-secondary)] mb-1" />
                <span className="font-semibold text-[var(--theme-text-title)] block truncate">City Re-Center</span>
              </div>
              <div
                style={{ backgroundColor: 'var(--theme-card-bg-subtle)', borderColor: 'var(--theme-card-border)' }}
                className="p-2 rounded-lg border"
              >
                <Volume2 className="w-3.5 h-3.5 mx-auto text-[var(--theme-accent-primary)] mb-1" />
                <span className="font-semibold text-[var(--theme-text-title)] block truncate">Tap Tour</span>
              </div>
            </div>
          </div>
        )}

        {step.id === 'settings' && (
          <div className="grid grid-cols-2 gap-2 my-auto text-xs">
            {[
              { icon: Compass, label: 'GPS / Manual City' },
              { icon: Languages, label: `${SUPPORTED_LANGUAGE_COUNT} Languages` },
              { icon: Volume2, label: 'Speech · Text · Both' },
              { icon: HardDrive, label: 'Phone Memory YES/NO' },
            ].map((item) => {
              const IconComp = item.icon;
              return (
                <div
                  key={item.label}
                  style={{
                    backgroundColor: 'var(--theme-card-bg)',
                    borderColor: 'var(--theme-card-border)',
                  }}
                  className="p-2.5 rounded-xl border flex items-center gap-2"
                >
                  <IconComp className="w-4 h-4 text-[var(--theme-accent-primary)] shrink-0" />
                  <span className="font-semibold text-[11px] text-[var(--theme-text-title)] truncate">
                    {item.label}
                  </span>
                </div>
              );
            })}
          </div>
        )}

        {(step.id === 'home' || step.id === 'camera' || step.id === 'history') && (
          <div className="p-3 rounded-xl border border-[var(--theme-card-border)] bg-[var(--theme-card-bg)] my-auto text-xs text-[var(--theme-text-body)]">
            {step.description}
          </div>
        )}

        <div className="flex items-center justify-between text-[11px] text-[var(--theme-text-muted)] pt-2 border-t border-[var(--theme-card-border)]">
          <span>{t.bottomBarDest} #{step.number}</span>
          <span className="font-semibold text-[var(--theme-accent-secondary)]">{t.readyInRealTime}</span>
        </div>
      </div>
    );
  };

  return (
    <div
      ref={tourScrollRef}
      id="app-tour-overlay"
      dir={selectedLanguage.direction === 'rtl' ? 'rtl' : 'ltr'}
      className="relative z-10 flex-1 min-h-0 overflow-y-auto overflow-x-hidden flex flex-col select-none"
    >
      {/* Compact Tour Step & Skip Bar */}
      <div
        style={{
          backgroundColor: 'var(--theme-card-bg)',
          borderColor: 'var(--theme-card-border)',
        }}
        className="sticky top-0 z-20 border-b backdrop-blur-xl px-4 py-2 shrink-0"
      >
        <div className="max-w-5xl mx-auto flex items-center justify-between gap-3">
          <div className="min-w-0 flex items-center gap-2.5">
            {(onBack || onBackToIntro) && (
              <BackButton
                id="btn-tour-back"
                compact
                onClick={() => {
                  speechManager.stop();
                  setIsSpeakingHint(false);
                  if (onBack) {
                    onBack();
                  } else if (onBackToIntro) {
                    onBackToIntro();
                  }
                }}
                selectedLanguage={selectedLanguage}
              />
            )}
            <div className="min-w-0">
              <div className="flex items-center gap-2 text-xs">
                <span className="font-serif font-bold text-[var(--theme-text-title)] truncate">
                  {t.headerTitle}
                </span>
                <span className="text-[var(--theme-text-muted)]">·</span>
                <span className="font-semibold text-[var(--theme-accent-primary)] whitespace-nowrap">
                  {t.screenWord} {stepIndex + 1} {t.ofWord} {localizedSteps.length}
                </span>
              </div>
              <p className="text-[11px] text-[var(--theme-text-muted)] truncate hidden sm:block">
                {t.headerSubtitle}
              </p>
            </div>
          </div>

          <div className="flex items-center gap-2 shrink-0">
            {isReplayMode && onBackToIntro && (
              <button
                type="button"
                onClick={() => {
                  speechManager.stop();
                  onBackToIntro();
                }}
                style={{
                  backgroundColor: 'var(--theme-card-bg-subtle)',
                  borderColor: 'var(--theme-card-border)',
                  color: 'var(--theme-text-body)',
                }}
                className="min-h-[38px] px-3 rounded-xl border text-xs font-semibold hidden sm:flex items-center gap-1 cursor-pointer hover:border-[var(--theme-card-border-glow)] whitespace-nowrap shrink-0"
              >
                <ArrowLeft className="w-3.5 h-3.5" />
                <span>{t.introButton}</span>
              </button>
            )}

            <button
              id="btn-skip-tour-now"
              type="button"
              onClick={handleSkipNow}
              style={{
                backgroundColor: 'var(--theme-card-bg-subtle)',
                borderColor: 'var(--theme-card-border)',
                color: 'var(--theme-text-title)',
              }}
              className="min-h-[38px] px-3.5 rounded-xl border text-xs font-bold flex items-center gap-1.5 cursor-pointer hover:border-[var(--theme-accent-primary)] active:scale-95 transition-all whitespace-nowrap shrink-0"
            >
              <X className="w-3.5 h-3.5 text-[var(--theme-accent-primary)]" />
              <span>{isReplayMode ? t.closeTour : t.skipTourNow}</span>
            </button>
          </div>
        </div>
      </div>

      {/* Main Centered Tour Card Container */}
      <div className="flex-1 w-full max-w-5xl mx-auto px-4 sm:px-6 py-4 sm:py-6 flex flex-col justify-between gap-4 sm:gap-5">
        {/* Live Navigation Pointer Anchor aligned under real DOM target (Desktop tab or Mobile tab / More menu) */}
        <div
          ref={pointerStripRef}
          id="tour-live-pointer-callout"
          style={{
            backgroundColor: 'var(--theme-card-bg-subtle)',
            borderColor: 'var(--theme-card-border-glow)',
          }}
          className="relative rounded-xl border px-3 py-2 flex items-center justify-between gap-2 text-xs shadow-sm"
        >
          {pointerMetrics.visible && (
            <div
              aria-hidden="true"
              style={{ left: `${pointerMetrics.arrowX}px` }}
              className="absolute -top-3 -translate-x-1/2 w-6 h-6 rounded-full theme-btn-primary border border-white/30 flex items-center justify-center shadow-md pointer-events-none"
            >
              <ArrowUp className="w-3.5 h-3.5 animate-bounce" />
            </div>
          )}
          <div className="flex items-center gap-2 min-w-0">
            <span className="px-2 py-0.5 rounded-md theme-badge-gold text-[10px] font-bold uppercase tracking-wider shrink-0">
              {currentStep.number} · {currentStep.tabLabel}
            </span>
            <span className="text-[11px] font-medium text-[var(--theme-text-body)] truncate">
              {pointerMetrics.viaMoreMenu
                ? `${t.insideMoreMenuHint}: ${currentStep.tabLabel}`
                : `${t.pointingToNavTab}: ${currentStep.tabLabel}`}
            </span>
          </div>
          <span className="text-[10.5px] font-semibold text-[var(--theme-accent-secondary)] shrink-0 hidden xs:inline">
            {currentStep.id === 'discover' ? 'Global Search' : t.readyInRealTime}
          </span>
        </div>

        {/* Step Navigation Pills / Screen Switcher Bar (All 8 Screens in Nav Order) */}
        <div ref={pillsRowRef} className="flex items-center gap-1.5 overflow-x-auto pb-1">
          {localizedSteps.map((s, idx) => {
            const Icon = s.icon;
            const isActive = idx === stepIndex;
            const isVisited = idx < stepIndex;
            return (
              <button
                key={s.id}
                id={`tour-step-pill-${s.id}`}
                type="button"
                onClick={() => setStepIndex(idx)}
                style={
                  isActive
                    ? {
                        background: 'var(--theme-accent-primary-gradient)',
                        color: 'var(--theme-accent-primary-text)',
                        borderColor: 'var(--theme-accent-primary)',
                      }
                    : {
                        backgroundColor: 'var(--theme-card-bg)',
                        borderColor: isVisited
                          ? 'var(--theme-accent-secondary)'
                          : 'var(--theme-card-border)',
                        color: isVisited
                          ? 'var(--theme-text-title)'
                          : 'var(--theme-text-muted)',
                      }
                }
                className="min-h-[44px] px-3 rounded-xl border text-xs font-bold flex items-center gap-1.5 cursor-pointer transition-all whitespace-nowrap shrink-0"
              >
                <Icon className="w-3.5 h-3.5 shrink-0" />
                <span>
                  {s.number}. {s.tabLabel}
                </span>
              </button>
            );
          })}
        </div>

        {/* Active Step Split Grid */}
        <div
          style={{
            backgroundColor: 'var(--theme-card-bg)',
            borderColor: 'var(--theme-card-border)',
          }}
          className="rounded-2xl border shadow-2xl overflow-hidden grid grid-cols-1 lg:grid-cols-12"
        >
          {/* Left Column: Detailed Screen Functionality Explanation */}
          <div className="lg:col-span-7 p-5 sm:p-7 flex flex-col justify-between space-y-5">
            <div className="space-y-3">
              <div className="flex items-center justify-between gap-2 flex-wrap">
                <p className="text-xs font-bold uppercase tracking-widest text-[var(--theme-accent-secondary)]">
                  {t.screenWord} {currentStep.number} · {currentStep.tabLabel}
                </p>

                <div className="flex items-center gap-1.5 shrink-0">
                  <button
                    id="btn-tour-hear-hint"
                    type="button"
                    onClick={handleToggleHintSpeech}
                    style={{
                      backgroundColor: 'var(--theme-card-bg-subtle)',
                      borderColor: isSpeakingHint
                        ? 'var(--theme-accent-primary)'
                        : 'var(--theme-card-border)',
                      color: 'var(--theme-text-title)',
                    }}
                    className="min-h-[36px] px-3 rounded-lg border text-xs font-semibold flex items-center gap-1.5 cursor-pointer whitespace-nowrap shrink-0"
                  >
                    <Volume2 className="w-3.5 h-3.5 text-[var(--theme-accent-primary)]" />
                    <span>{isSpeakingHint ? t.stopHint : t.hearHint}</span>
                  </button>

                  <AudioSpeedControl
                    id="btn-tour-audio-speed"
                    compact
                    speed={guideSettings.speechRate}
                    onChangeSpeed={(nextRate) => {
                      speechManager.setRate(nextRate);
                      onUpdateSpeechRate?.(nextRate);
                    }}
                    isRtl={selectedLanguage.direction === 'rtl'}
                    tone="subtle"
                  />
                </div>
              </div>

              <h1 className="font-serif font-bold text-xl sm:text-2xl text-[var(--theme-text-title)] leading-snug [text-wrap:balance]">
                {currentStep.title}
              </h1>
              <p className="text-sm font-semibold text-[var(--theme-accent-primary)]">
                {currentStep.headline}
              </p>
              <p className="text-sm leading-relaxed text-[var(--theme-text-body)]">
                {currentStep.description}
              </p>
            </div>

            {/* Key Capabilities Breakdown */}
            <div className="space-y-2.5 pt-1">
              <p className="text-xs font-bold uppercase tracking-wider text-[var(--theme-text-muted)]">
                {t.whatYouCanDo}
              </p>
              <div className="space-y-2">
                {currentStep.whatItDoes.map((item) => (
                  <div
                    key={item.label}
                    style={{
                      backgroundColor: 'var(--theme-card-bg-subtle)',
                      borderColor: 'var(--theme-card-border)',
                    }}
                    className="p-3 rounded-xl border flex items-start gap-2.5"
                  >
                    <CheckCircle2 className="w-4 h-4 text-[var(--theme-accent-secondary)] shrink-0 mt-0.5" />
                    <div className="min-w-0 text-xs">
                      <span className="font-bold text-[var(--theme-text-title)] block">
                        {item.label}
                      </span>
                      <span className="text-[var(--theme-text-muted)] leading-relaxed">
                        {item.detail}
                      </span>
                    </div>
                  </div>
                ))}
              </div>
            </div>
          </div>

          {/* Right Column: Visual Screen Preview / Artwork */}
          <div
            className="lg:col-span-5 border-t lg:border-t-0 lg:border-l flex flex-col justify-between"
            style={{ borderColor: 'var(--theme-card-border)' }}
          >
            {renderScreenSchematic(currentStep)}

            <div
              className="p-4 border-t text-xs space-y-1.5"
              style={{
                backgroundColor: 'var(--theme-card-bg-subtle)',
                borderColor: 'var(--theme-card-border)',
              }}
            >
              <p className="font-semibold text-[var(--theme-text-title)] flex items-center gap-1.5">
                <Sparkles className="w-3.5 h-3.5 text-[var(--theme-accent-primary)] shrink-0" />
                <span>{t.realTimeReady}</span>
              </p>
              <p className="text-[11px] text-[var(--theme-text-muted)] leading-relaxed">
                {currentStep.tabLabel} · {selectedLanguage.nativeName} ·{' '}
                {guideSettings.outputMode === 'text'
                  ? 'Text Only'
                  : guideSettings.outputMode === 'speech'
                  ? 'Speech Only'
                  : 'Speech + Text'}
              </p>
            </div>
          </div>
        </div>

        {/* Bottom Tour Controls */}
        <footer className="flex flex-wrap items-center justify-between gap-3 pb-4">
          <div className="flex items-center gap-2">
            <button
              type="button"
              onClick={handlePrev}
              disabled={stepIndex === 0}
              className={`min-h-[46px] px-4 rounded-xl theme-btn-secondary text-xs font-bold flex items-center gap-1.5 whitespace-nowrap shrink-0 ${
                stepIndex === 0 ? 'opacity-40 cursor-not-allowed' : 'cursor-pointer'
              }`}
            >
              <ArrowLeft className="w-4 h-4" />
              <span>{t.previousBtn}</span>
            </button>

            <button
              type="button"
              onClick={handleSkipNow}
              className="min-h-[46px] px-3 text-xs font-semibold text-[var(--theme-text-muted)] hover:text-[var(--theme-text-title)] underline underline-offset-4 cursor-pointer whitespace-nowrap shrink-0"
            >
              {t.skipExploreLink}
            </button>
          </div>

          <button
            id="btn-tour-next"
            type="button"
            onClick={handleNext}
            className="min-h-[46px] px-5 py-2.5 rounded-xl theme-btn-primary text-xs sm:text-sm font-bold flex items-center gap-2 cursor-pointer whitespace-nowrap shrink-0"
          >
            <span>
              {isLastStep
                ? isReplayMode
                  ? t.finishReturnBtn
                  : t.continueSetupBtn
                : `${t.nextPrefix}: ${localizedSteps[stepIndex + 1].tabLabel}`}
            </span>
            <ArrowRight className="w-4 h-4" />
          </button>
        </footer>
      </div>
    </div>
  );
};
