import React, { useState, useEffect, useRef, useMemo, useCallback } from 'react';
import { onAuthStateChanged, signInWithPopup, signOut } from 'firebase/auth';
import {
  AppTab,
  ChatMessage,
  Language,
  RecognitionResult,
  LocationCoords,
  GuideOutputMode,
  GuideSettings,
  ThemePreset,
  UserProfile,
  OnboardingState,
  SavedLocationPreference,
  TravelJournalEntry,
  GpsLocationStatus,
  RelatedDiscoveryItem,
  DeepConversationContext,
  DeepConversationMessage,
  ExplanationLevel,
} from './types';
import { SUPPORTED_LANGUAGES, getLanguageByCode } from './data/languages';
import { Navigation } from './components/Navigation';
import {
  FullScreenTopBar,
  SCREEN_PRIMARY_BACK_SELECTOR,
} from './components/FullScreenTopBar';
import { HomeScreen } from './components/HomeScreen';
import { CameraScreen } from './components/CameraScreen';
import { DiscoverScreen } from './components/DiscoverScreen';
import { ExplanationView, ExplanationTabId } from './components/ExplanationView';
import { DeepConversationScreen } from './components/DeepConversationScreen';
import { AIChatScreen, AiGuideJournalSavePayload } from './components/AIChatScreen';
import { MapView } from './components/MapView';
import { HistoryScreen } from './components/HistoryScreen';
import { GuideSettingsScreen } from './components/GuideSettingsScreen';
import { NearbyAttractionsScreen } from './components/NearbyAttractionsScreen';
import { CityExplorerScreen } from './components/CityExplorerScreen';
import { CityGuideModal } from './components/CityGuideModal';
import { LanguageSelectionModal } from './components/LanguageSelectionModal';
import { AppIntroductionPage } from './components/AppIntroductionPage';
import { AppTourOverlay } from './components/AppTourOverlay';
import { LoginOnboardingScreen, LoginCompletionPayload } from './components/LoginOnboardingScreen';
import { DeviceExactLocation, GeolocationLookupError, getDeviceExactLocation } from './utils/geolocation';
import { AlertTriangle, X } from 'lucide-react';
import { speechManager } from './utils/speech';
import { normalizeAudioSpeed } from './utils/audioSpeed';
import { auth, googleProvider } from './firebase';
import {
  STORAGE_KEYS,
  DEFAULT_GUIDE_SETTINGS,
  loadLocalUserProfile,
  saveLocalUserProfile,
  loadLocalOnboardingState,
  saveLocalOnboardingState,
  loadLocalLocationPref,
  saveLocalLocationPref,
  loadLocalLanguageCode,
  saveLocalLanguageCode,
  loadUserFromFirestore,
  saveUserToFirestore,
  getPresetForTravelerType,
} from './utils/userPersistence';
import {
  clearAllUserJournalEntries,
  clearGuestJournal,
  createUserJournalEntry,
  deleteUserJournalEntry,
  generateSafeJournalId,
  getTodayDateStr,
  journalEntryToRecognitionResult,
  loadGuestJournal,
  loadUserJournalEntries,
  migrateGuestEntriesToUserCloud,
  recognitionResultToJournalPayload,
  saveGuestJournal,
  saveUidJournalCache,
  sortJournalEntriesNewestFirst,
  updateUserJournalEntry,
} from './utils/journalPersistence';
import { compressImageToJournalDataUrl } from './utils/photoStorage';
import {
  ScreenRoute,
  ReplayScreenMode,
  backLayerRegistry,
  createInitialScreenStack,
  getRouteKey,
  getRouteTab,
  popScreenRoute,
  pushScreenRoute,
  replaceTopScreenRoute,
  useBackLayer,
} from './utils/navigationHistory';

const VALID_TABS: ReadonlyArray<AppTab> = [
  'home',
  'camera',
  'discover',
  'chat',
  'map',
  'history',
  'settings',
  'nearby',
  'city',
];

function parseTabFromHash(): AppTab {
  if (typeof window === 'undefined') return 'home';
  const raw = window.location.hash.replace(/^#\/?/, '').split('?')[0].trim();
  if (VALID_TABS.includes(raw as AppTab)) {
    return raw as AppTab;
  }
  return 'home';
}

export default function App() {
  const [screenStack, setScreenStack] = useState<ScreenRoute[]>(() =>
    createInitialScreenStack(parseTabFromHash())
  );
  const screenStackRef = useRef<ScreenRoute[]>(screenStack);
  screenStackRef.current = screenStack;

  const currentRoute = screenStack[screenStack.length - 1];
  const activeTab: AppTab = useMemo(() => {
    for (let i = screenStack.length - 1; i >= 0; i--) {
      if (screenStack[i].kind !== 'replay') {
        return getRouteTab(screenStack[i]);
      }
    }
    return 'home';
  }, [screenStack]);

  const replayMode: ReplayScreenMode | 'none' =
    currentRoute.kind === 'replay' ? currentRoute.mode : 'none';
  const currentExplanation: RecognitionResult | null =
    currentRoute.kind === 'explanation' ? currentRoute.landmark : null;
  const currentDeepConversation =
    currentRoute.kind === 'deep_conversation' ? currentRoute : null;
  const hasDetailOverlay = Boolean(currentExplanation || currentDeepConversation);

  const explanationEntries = useMemo(
    () =>
      screenStack
        .map((route, index) => ({ route, index }))
        .filter(
          (entry): entry is { route: Extract<ScreenRoute, { kind: 'explanation' }>; index: number } =>
            entry.route.kind === 'explanation'
        ),
    [screenStack]
  );

  const [visitedTabs, setVisitedTabs] = useState<Set<AppTab>>(() => new Set([activeTab]));
  useEffect(() => {
    setVisitedTabs((prev) => {
      if (prev.has(activeTab)) return prev;
      const next = new Set(prev);
      next.add(activeTab);
      return next;
    });
  }, [activeTab]);

  const [activeOverlayCount, setActiveOverlayCount] = useState<number>(() =>
    backLayerRegistry.getActiveIds(0).length
  );
  const [tourHighlightTab, setTourHighlightTab] = useState<AppTab | null>(null);
  useEffect(() => {
    return backLayerRegistry.subscribe(() => {
      setActiveOverlayCount(backLayerRegistry.getActiveIds(0).length);
    });
  }, []);

  const [selectedLanguage, setSelectedLanguage] = useState<Language>(() =>
    getLanguageByCode(loadLocalLanguageCode())
  );
  const [isLanguageModalOpen, setIsLanguageModalOpen] = useState(false);

  const [currentTheme, setCurrentTheme] = useState<ThemePreset>(() => {
    try {
      const saved = localStorage.getItem(STORAGE_KEYS.THEME) as ThemePreset;
      if (saved && ['celestial', 'sunset', 'emerald', 'daylight'].includes(saved)) {
        return saved;
      }
    } catch {
      // ignore storage errors
    }
    return 'celestial';
  });

  const [guideSettings, setGuideSettings] = useState<GuideSettings>(() => {
    try {
      const saved = localStorage.getItem(STORAGE_KEYS.SETTINGS);
      if (saved) {
        const parsed = JSON.parse(saved);
        return {
          ...DEFAULT_GUIDE_SETTINGS,
          ...parsed,
          speechRate: normalizeAudioSpeed(parsed?.speechRate),
        };
      }
    } catch {
      // ignore
    }
    return { ...DEFAULT_GUIDE_SETTINGS };
  });

  useEffect(() => {
    speechManager.setRate(normalizeAudioSpeed(guideSettings.speechRate));
  }, [guideSettings.speechRate]);

  const [outputMode, setOutputMode] = useState<GuideOutputMode>(() => guideSettings.outputMode || 'both');

  // Account, Profile, Onboarding & Location Preference State
  const [userProfile, setUserProfile] = useState<UserProfile | null>(() => loadLocalUserProfile());
  const [onboardingState, setOnboardingState] = useState<OnboardingState>(() => loadLocalOnboardingState());
  const [locationPref, setLocationPref] = useState<SavedLocationPreference>(() => loadLocalLocationPref());
  const [statusToast, setStatusToast] = useState<string | null>(null);
  const [gmpQuotaExceeded, setGmpQuotaExceeded] = useState<boolean>(false);
  const [gmpQuotaBannerDismissed, setGmpQuotaBannerDismissed] = useState<boolean>(false);
  const isInteractiveSignInRef = useRef(false);

  // City Explorer & Two-Tier City Guide Modal States
  const [isManualLocationMode, setIsManualLocationMode] = useState<boolean>(
    () => locationPref.locationMode === 'manual'
  );
  const [isCityGuideModalOpen, setIsCityGuideModalOpen] = useState<boolean>(false);
  const [activeCityGuideTarget, setActiveCityGuideTarget] = useState<string>(
    locationPref.manualCityName || ''
  );
  const [activeStateGuideTarget, setActiveStateGuideTarget] = useState<string>(
    locationPref.manualStateName || ''
  );
  const [activeCountryGuideTarget, setActiveCountryGuideTarget] = useState<string>(
    locationPref.manualCountryName || ''
  );

  const [lastScannedLandmark, setLastScannedLandmark] = useState<RecognitionResult | null>(null);
  const [chatQuestion, setChatQuestion] = useState<string | undefined>(undefined);
  const [chatLandmarkContext, setChatLandmarkContext] = useState<RecognitionResult | null>(null);
  const [chatMessages, setChatMessages] = useState<ChatMessage[]>([]);
  const appRootRef = useRef<HTMLDivElement | null>(null);
  const mainRef = useRef<HTMLElement | null>(null);
  const activeTabRef = useRef<AppTab>(activeTab);
  activeTabRef.current = activeTab;
  const locationModeRef = useRef<'gps' | 'manual'>(locationPref.locationMode === 'manual' ? 'manual' : 'gps');
  const gpsRequestSeqRef = useRef<number>(0);

  // User-Scoped Persistent Travel Journal State
  const [journalEntries, setJournalEntries] = useState<TravelJournalEntry[]>([]);
  const [isLoadingJournal, setIsLoadingJournal] = useState<boolean>(false);
  const [journalFromCache, setJournalFromCache] = useState<boolean>(false);
  const [journalError, setJournalError] = useState<string | null>(null);
  const activeJournalUidRef = useRef<string | null>(null);
  const scanCreatePromiseMapRef = useRef<Map<string, Promise<TravelJournalEntry | null>>>(new Map());
  const savingKeysRef = useRef<Set<string>>(new Set());

  // Deep Conversation threads & preserved ExplanationView tab/depth state
  const [deepConversationThreads, setDeepConversationThreads] = useState<
    Record<string, DeepConversationMessage[]>
  >({});
  const [explanationUiStateById, setExplanationUiStateById] = useState<
    Record<string, { activeTab: ExplanationTabId; explanationLevel: ExplanationLevel }>
  >({});

  const visitedHistory = useMemo(
    () => journalEntries.map(journalEntryToRecognitionResult),
    [journalEntries]
  );

  const buildManualDeviceLocation = useCallback((pref: SavedLocationPreference): DeviceExactLocation | null => {
    if (!pref.manualCityName) return null;
    const hasValidCoords =
      typeof pref.manualLatitude === 'number' &&
      typeof pref.manualLongitude === 'number' &&
      Number.isFinite(pref.manualLatitude) &&
      Number.isFinite(pref.manualLongitude);
    const isVerified =
      typeof pref.manualLocationVerified === 'boolean'
        ? pref.manualLocationVerified && hasValidCoords
        : hasValidCoords;
    return {
      latitude: hasValidCoords ? pref.manualLatitude! : null,
      longitude: hasValidCoords ? pref.manualLongitude! : null,
      locationName: [
        pref.manualCityName,
        pref.manualStateName,
        pref.manualCountryName || '',
      ]
        .filter((p, idx, arr) => Boolean(p) && arr.indexOf(p) === idx)
        .join(', '),
      city: pref.manualCityName,
      state: pref.manualStateName || '',
      stateCode: pref.manualStateCode || '',
      country: pref.manualCountryName || '',
      countryCode: pref.manualCountryCode || '',
      placeId: pref.manualPlaceId,
      isVerified,
      isLiveGps: false,
      status: 'manual',
      sourceProvider: isVerified ? 'manual' : 'manual_custom',
    };
  }, []);

  const buildManualLocationCoords = useCallback((pref: SavedLocationPreference): LocationCoords | null => {
    if (
      pref.manualCityName &&
      typeof pref.manualLatitude === 'number' &&
      typeof pref.manualLongitude === 'number' &&
      Number.isFinite(pref.manualLatitude) &&
      Number.isFinite(pref.manualLongitude)
    ) {
      return {
        latitude: pref.manualLatitude,
        longitude: pref.manualLongitude,
        city: pref.manualCityName,
        country: pref.manualCountryName || '',
      };
    }
    return null;
  }, []);

  // Exact Device Location (Restores saved manual destination if manual mode was saved; never fabricates Nagpur on GPS failure)
  const [gpsStatus, setGpsStatus] = useState<GpsLocationStatus>(() =>
    locationPref.locationMode === 'manual' ? 'manual' : 'idle'
  );
  const [gpsError, setGpsError] = useState<string | null>(null);

  const [deviceExactLocation, setDeviceExactLocation] = useState<DeviceExactLocation | null>(() =>
    locationPref.locationMode === 'manual' ? buildManualDeviceLocation(locationPref) : null
  );

  const [locationCoords, setLocationCoords] = useState<LocationCoords | null>(() =>
    locationPref.locationMode === 'manual' ? buildManualLocationCoords(locationPref) : null
  );

  const showToast = (msg: string) => {
    setStatusToast(msg);
  };

  useEffect(() => {
    if (!statusToast) return;
    const t = setTimeout(() => setStatusToast(null), 3400);
    return () => clearTimeout(t);
  }, [statusToast]);

  // Listen for Google Maps Platform quota-exceeded events (Tier 1 & Tier 2)
  useEffect(() => {
    const handleQuotaExceeded = () => {
      setGmpQuotaExceeded(true);
    };
    window.addEventListener('gmp-quota-exceeded', handleQuotaExceeded);
    return () => {
      window.removeEventListener('gmp-quota-exceeded', handleQuotaExceeded);
    };
  }, []);

  // Helper to persist state changes into localStorage & Firestore if signed in
  const syncCloudIfAuthenticated = (overrides: {
    profile?: UserProfile | null;
    settings?: GuideSettings;
    locPref?: SavedLocationPreference;
    theme?: ThemePreset;
    onboarding?: OnboardingState;
  }) => {
    const targetProfile = overrides.profile !== undefined ? overrides.profile : userProfile;
    const targetSettings = overrides.settings || guideSettings;
    const targetLocPref = overrides.locPref || locationPref;
    const targetTheme = overrides.theme || currentTheme;
    const targetOnboarding = overrides.onboarding || onboardingState;

    const uid = auth.currentUser?.uid;
    if (uid && targetProfile && targetProfile.authMethod === 'google' && targetOnboarding.hasCompletedLoginSetup) {
      saveUserToFirestore({
        uid,
        profile: targetProfile,
        guideSettings: targetSettings,
        locationPref: targetLocPref,
        theme: targetTheme,
        onboardingState: targetOnboarding,
      }).catch((err) => {
        console.warn('Background Firestore sync failed:', err);
      });
    }
  };

  const handleSelectTheme = (theme: ThemePreset) => {
    setCurrentTheme(theme);
    try {
      localStorage.setItem(STORAGE_KEYS.THEME, theme);
    } catch {
      // ignore
    }
    syncCloudIfAuthenticated({ theme });
  };

  const handleSelectLanguage = (lang: Language) => {
    setSelectedLanguage(lang);
    saveLocalLanguageCode(lang.code);
    if (userProfile) {
      const updatedProfile: UserProfile = {
        ...userProfile,
        preferredLanguage: lang.code,
        updatedAt: new Date().toISOString(),
      };
      setUserProfile(updatedProfile);
      saveLocalUserProfile(updatedProfile);
      syncCloudIfAuthenticated({ profile: updatedProfile });
    }
  };

  // Keep outputMode in sync with guideSettings
  const handleToggleOutputMode = (mode: GuideOutputMode) => {
    setOutputMode(mode);
    setGuideSettings((prev) => {
      const updated = { ...prev, outputMode: mode };
      try {
        localStorage.setItem(STORAGE_KEYS.SETTINGS, JSON.stringify(updated));
      } catch {
        // ignore
      }
      syncCloudIfAuthenticated({ settings: updated });
      return updated;
    });
  };

  const handleUpdateSettings = (newSettings: GuideSettings) => {
    const normalizedSettings: GuideSettings = {
      ...newSettings,
      speechRate: normalizeAudioSpeed(newSettings.speechRate),
    };
    speechManager.setRate(normalizedSettings.speechRate);
    setGuideSettings(normalizedSettings);
    setOutputMode(normalizedSettings.outputMode);
    try {
      localStorage.setItem(STORAGE_KEYS.SETTINGS, JSON.stringify(normalizedSettings));
    } catch {
      // ignore
    }
    syncCloudIfAuthenticated({ settings: normalizedSettings });
  };

  const handleUpdateSpeechRate = (rate: number) => {
    const normalized = normalizeAudioSpeed(rate);
    speechManager.setRate(normalized);
    setGuideSettings((prev) => {
      const updated: GuideSettings = { ...prev, speechRate: normalized };
      try {
        localStorage.setItem(STORAGE_KEYS.SETTINGS, JSON.stringify(updated));
      } catch {
        // ignore
      }
      syncCloudIfAuthenticated({ settings: updated });
      return updated;
    });
  };

  // Fetch device's exact location cleanly when GPS mode is active (preserves saved manual fields when toggling)
  const refreshDeviceLocation = useCallback(async () => {
    locationModeRef.current = 'gps';
    const seq = ++gpsRequestSeqRef.current;
    setIsManualLocationMode(false);
    setGpsStatus('locating');
    setGpsError(null);
    // Clear any stale manual destination when entering GPS mode so manual places never masquerade as GPS
    setDeviceExactLocation((prev) => (prev && !prev.isLiveGps ? null : prev));
    setLocationCoords((prev) => {
      if (isManualLocationMode) return null;
      return prev;
    });
    setLocationPref((prev) => {
      const next: SavedLocationPreference = { ...prev, locationMode: 'gps' };
      saveLocalLocationPref(next);
      return next;
    });

    try {
      const exactLoc = await getDeviceExactLocation();
      if (locationModeRef.current !== 'gps' || gpsRequestSeqRef.current !== seq) {
        return;
      }
      setDeviceExactLocation(exactLoc);
      if (typeof exactLoc.latitude === 'number' && typeof exactLoc.longitude === 'number') {
        setLocationCoords({
          latitude: exactLoc.latitude,
          longitude: exactLoc.longitude,
          city: exactLoc.city,
          country: exactLoc.country,
        });
      } else {
        setLocationCoords(null);
      }
      setGpsStatus(exactLoc.status || 'live');
      setGpsError(exactLoc.errorMessage || null);
      setIsManualLocationMode(false);
    } catch (e: any) {
      if (locationModeRef.current !== 'gps' || gpsRequestSeqRef.current !== seq) {
        return;
      }
      setDeviceExactLocation(null);
      setLocationCoords(null);
      if (e instanceof GeolocationLookupError) {
        setGpsStatus(e.status);
        setGpsError(e.message);
      } else {
        setGpsStatus('unavailable');
        setGpsError(e?.message || 'Unable to acquire device GPS location.');
      }
      console.warn('GPS location could not be acquired:', e);
    }
  }, [isManualLocationMode]);

  useEffect(() => {
    if (locationPref.locationMode !== 'manual') {
      refreshDeviceLocation();
    }
  }, []);

  const navigateToTab = useCallback(
    (tab: AppTab, options?: { replace?: boolean }) => {
      speechManager.stop();
      setScreenStack((prev) => {
        const nextRoute: ScreenRoute = { kind: 'tab', tab };
        const updated = options?.replace
          ? replaceTopScreenRoute(prev, nextRoute)
          : pushScreenRoute(prev, nextRoute);
        screenStackRef.current = updated;
        return updated;
      });
    },
    []
  );

  const openExplanationRoute = useCallback(
    (landmark: RecognitionResult, originTab: AppTab) => {
      speechManager.stop();
      setScreenStack((prev) => {
        const updated = pushScreenRoute(prev, {
          kind: 'explanation',
          originTab,
          landmark,
        });
        screenStackRef.current = updated;
        return updated;
      });
    },
    []
  );

  const openDeepConversationRoute = useCallback(
    (context: DeepConversationContext, explicitOriginTab?: AppTab) => {
      speechManager.stop();
      setScreenStack((prev) => {
        const top = prev[prev.length - 1];
        const originTab: AppTab =
          explicitOriginTab ||
          (top?.kind === 'explanation' ? top.originTab : activeTabRef.current);
        const updated = pushScreenRoute(prev, {
          kind: 'deep_conversation',
          originTab,
          context,
        });
        screenStackRef.current = updated;
        return updated;
      });
    },
    []
  );

  const handleExplanationUiStateChange = useCallback(
    (landmarkId: string, uiState: { activeTab: ExplanationTabId; explanationLevel: ExplanationLevel }) => {
      setExplanationUiStateById((prev) => {
        const existing = prev[landmarkId];
        if (
          existing &&
          existing.activeTab === uiState.activeTab &&
          existing.explanationLevel === uiState.explanationLevel
        ) {
          return prev;
        }
        return { ...prev, [landmarkId]: uiState };
      });
    },
    []
  );

  const openReplayRoute = useCallback((mode: ReplayScreenMode) => {
    speechManager.stop();
    setScreenStack((prev) => {
      const updated = pushScreenRoute(prev, { kind: 'replay', mode });
      screenStackRef.current = updated;
      return updated;
    });
  }, []);

  const replaceReplayRoute = useCallback((mode: ReplayScreenMode | 'none') => {
    speechManager.stop();
    if (mode === 'none') {
      setScreenStack((prev) => {
        const filtered = prev.filter((r) => r.kind !== 'replay');
        const updated = filtered.length > 0 ? filtered : createInitialScreenStack('home');
        screenStackRef.current = updated;
        return updated;
      });
      return;
    }
    setScreenStack((prev) => {
      const updated = replaceTopScreenRoute(prev, { kind: 'replay', mode });
      screenStackRef.current = updated;
      return updated;
    });
  }, []);

  const goBackScreen = useCallback(() => {
    speechManager.stop();
    const { nextStack, poppedRoute, didPop } = popScreenRoute(screenStackRef.current);
    if (!didPop) return false;
    screenStackRef.current = nextStack;
    setScreenStack(nextStack);
    if (poppedRoute?.kind === 'tab' && poppedRoute.tab === 'chat') {
      setChatQuestion(undefined);
      setChatLandmarkContext(null);
    }
    return true;
  }, []);

  useEffect(() => {
    const vv = window.visualViewport;

    const apply = () => {
      document.documentElement.style.setProperty(
        '--app-vh',
        `${Math.round(vv?.height ?? window.innerHeight)}px`
      );
    };

    apply();

    vv?.addEventListener('resize', apply);
    window.addEventListener('resize', apply);
    window.addEventListener('orientationchange', apply);

    return () => {
      vv?.removeEventListener('resize', apply);
      window.removeEventListener('resize', apply);
      window.removeEventListener('orientationchange', apply);
      document.documentElement.style.removeProperty('--app-vh');
    };
  }, []);

  const canGoBack = screenStack.length > 1 || activeOverlayCount > 0;
  const currentRouteKey = useMemo(() => getRouteKey(currentRoute), [currentRoute]);
  const isHandlingPopStateRef = useRef(false);
  const popStateResetTimerRef = useRef<number | null>(null);

  // Synchronize browser/Android/PWA history guard & hash with app navigation + overlay stack
  useEffect(() => {
    if (appRootRef.current && appRootRef.current.scrollTop !== 0) {
      appRootRef.current.scrollTop = 0;
    }
    if (mainRef.current && mainRef.current.scrollTop !== 0) {
      mainRef.current.scrollTop = 0;
    }
    if (isHandlingPopStateRef.current) return;

    const targetHash = `#${activeTab}`;
    try {
      if (canGoBack) {
        if (!window.history.state?.charaivaGuard) {
          window.history.pushState(
            { charaivaManaged: true, charaivaGuard: true, tab: activeTab, routeKey: currentRouteKey },
            '',
            targetHash
          );
        } else if (
          window.location.hash !== targetHash ||
          window.history.state?.routeKey !== currentRouteKey
        ) {
          window.history.replaceState(
            { charaivaManaged: true, charaivaGuard: true, tab: activeTab, routeKey: currentRouteKey },
            '',
            targetHash
          );
        }
      } else {
        window.history.replaceState(
          { charaivaManaged: true, charaivaRoot: true, tab: activeTab, routeKey: currentRouteKey },
          '',
          targetHash
        );
      }
    } catch {
      // ignore history errors
    }
  }, [activeTab, canGoBack, currentRouteKey]);

  useEffect(() => {
    const handlePopState = () => {
      isHandlingPopStateRef.current = true;
      if (popStateResetTimerRef.current !== null) {
        window.clearTimeout(popStateResetTimerRef.current);
      }
      popStateResetTimerRef.current = window.setTimeout(() => {
        isHandlingPopStateRef.current = false;
        popStateResetTimerRef.current = null;
      }, 60);

      speechManager.stop();

      // 1. Close topmost open modal, popup, lightbox, drawer, or nested sub-state first
      const dismissedOverlay = backLayerRegistry.dismissTop(0);
      if (dismissedOverlay) {
        const stillHasBack =
          screenStackRef.current.length > 1 || backLayerRegistry.hasActive(0);
        if (stillHasBack && !window.history.state?.charaivaGuard) {
          try {
            const topRoute = screenStackRef.current[screenStackRef.current.length - 1];
            const topTab = getRouteTab(topRoute);
            window.history.pushState(
              { charaivaManaged: true, charaivaGuard: true, tab: topTab, routeKey: getRouteKey(topRoute) },
              '',
              `#${topTab}`
            );
          } catch {
            // ignore
          }
        }
        return;
      }

      // 2. Otherwise step back to the previous screen in the navigation stack
      const { nextStack, poppedRoute, didPop } = popScreenRoute(screenStackRef.current);
      if (didPop) {
        screenStackRef.current = nextStack;
        setScreenStack(nextStack);
        if (poppedRoute?.kind === 'tab' && poppedRoute.tab === 'chat') {
          setChatQuestion(undefined);
          setChatLandmarkContext(null);
        }
        const topRoute = nextStack[nextStack.length - 1];
        const topTab = getRouteTab(topRoute);
        const topRouteKey = getRouteKey(topRoute);
        const stillHasBack = nextStack.length > 1 || backLayerRegistry.hasActive(0);
        try {
          if (stillHasBack) {
            window.history.pushState(
              { charaivaManaged: true, charaivaGuard: true, tab: topTab, routeKey: topRouteKey },
              '',
              `#${topTab}`
            );
          } else {
            window.history.replaceState(
              { charaivaManaged: true, charaivaRoot: true, tab: topTab, routeKey: topRouteKey },
              '',
              `#${topTab}`
            );
          }
        } catch {
          // ignore
        }
      }
    };

    const handleHashChange = () => {
      // Ignore synthetic/browser-back hash transitions already managed by screenStack
      if (isHandlingPopStateRef.current || window.history.state?.charaivaManaged) {
        return;
      }
      const parsed = parseTabFromHash();
      const currentTop = screenStackRef.current[screenStackRef.current.length - 1];
      if (currentTop && currentTop.kind === 'tab' && currentTop.tab === parsed) {
        return;
      }
      navigateToTab(parsed);
    };

    const handleKeyDown = (e: KeyboardEvent) => {
      if (e.key === 'Escape') {
        // Close topmost open popup/modal/lightbox/dropdown (priority >= 40) on Escape
        if (backLayerRegistry.dismissTop(40)) {
          e.preventDefault();
          e.stopPropagation();
        }
      }
    };

    window.addEventListener('popstate', handlePopState);
    window.addEventListener('hashchange', handleHashChange);
    window.addEventListener('keydown', handleKeyDown, true);
    return () => {
      window.removeEventListener('popstate', handlePopState);
      window.removeEventListener('hashchange', handleHashChange);
      window.removeEventListener('keydown', handleKeyDown, true);
      if (popStateResetTimerRef.current !== null) {
        window.clearTimeout(popStateResetTimerRef.current);
        popStateResetTimerRef.current = null;
      }
    };
  }, [navigateToTab]);

  const loadJournalForSession = useCallback(
    async (uid?: string | null, options?: { migrateGuest?: boolean }) => {
      if (uid && auth.currentUser?.uid === uid) {
        if (activeJournalUidRef.current !== uid) {
          setJournalEntries([]);
        }
        activeJournalUidRef.current = uid;
        setIsLoadingJournal(true);
        setJournalError(null);
        try {
          let res = await loadUserJournalEntries(uid);
          if (activeJournalUidRef.current !== uid) return;

          if (options?.migrateGuest && loadGuestJournal().length > 0) {
            const migration = await migrateGuestEntriesToUserCloud(uid, res.entries);
            if (migration.migratedCount > 0) {
              res = await loadUserJournalEntries(uid);
              if (activeJournalUidRef.current !== uid) return;
              setUserProfile((prev) => {
                if (!prev) return prev;
                const syncedCount = Math.max(prev.visitedCount || 0, res.entries.length);
                if (syncedCount === prev.visitedCount) return prev;
                const updated: UserProfile = {
                  ...prev,
                  visitedCount: syncedCount,
                  updatedAt: new Date().toISOString(),
                };
                saveLocalUserProfile(updated);
                return updated;
              });
              showToast(`Migrated ${migration.migratedCount} guest journal entr${migration.migratedCount === 1 ? 'y' : 'ies'} to your cloud account.`);
            }
          }

          setJournalEntries(res.entries);
          setJournalFromCache(res.fromCache);
          setJournalError(res.error || null);
        } catch (err: any) {
          if (activeJournalUidRef.current === uid) {
            setJournalError(err?.message || 'Unable to load your Travel Journal right now.');
          }
        } finally {
          if (activeJournalUidRef.current === uid) {
            setIsLoadingJournal(false);
          }
        }
      } else {
        activeJournalUidRef.current = null;
        const guestEntries = loadGuestJournal();
        setJournalEntries(guestEntries);
        setJournalFromCache(false);
        setJournalError(null);
        setIsLoadingJournal(false);
      }
    },
    []
  );

  // Rehydrate returning Firebase Auth users & their Travel Journal automatically on startup
  useEffect(() => {
    const localProf = loadLocalUserProfile();
    if (!localProf?.uid) {
      loadJournalForSession(null);
    }

    const unsubscribe = onAuthStateChanged(auth, async (firebaseUser) => {
      if (isInteractiveSignInRef.current) return;

      if (!firebaseUser) {
        // Ensure stale cloud journal entries are never shown when signed out
        const currentLocal = loadLocalUserProfile();
        if (currentLocal?.authMethod === 'google') {
          setUserProfile(null);
          saveLocalUserProfile(null);
        }
        loadJournalForSession(null);
        return;
      }

      try {
        const [cloud] = await Promise.all([
          loadUserFromFirestore(firebaseUser.uid),
          loadJournalForSession(firebaseUser.uid),
        ]);

        if (cloud.profile && cloud.onboardingState?.hasCompletedLoginSetup && cloud.guideSettings) {
          const restoredLang = getLanguageByCode(cloud.profile.preferredLanguage);
          const nextOnboarding: OnboardingState = {
            hasSeenIntro: true,
            hasCompletedTour: true,
            hasCompletedLoginSetup: true,
            skippedDirectly: false,
          };

          setUserProfile(cloud.profile);
          setGuideSettings(cloud.guideSettings);
          setOutputMode(cloud.guideSettings.outputMode || 'both');
          setSelectedLanguage(restoredLang);
          setOnboardingState(nextOnboarding);

          saveLocalUserProfile(cloud.profile);
          saveLocalLanguageCode(restoredLang.code);
          saveLocalOnboardingState(nextOnboarding);
          try {
            localStorage.setItem(STORAGE_KEYS.SETTINGS, JSON.stringify(cloud.guideSettings));
          } catch {
            // ignore
          }

          if (cloud.theme) {
            setCurrentTheme(cloud.theme);
            try {
              localStorage.setItem(STORAGE_KEYS.THEME, cloud.theme);
            } catch {
              // ignore
            }
          }

          if (cloud.locationPref) {
            setLocationPref(cloud.locationPref);
            saveLocalLocationPref(cloud.locationPref);
            if (cloud.locationPref.locationMode === 'manual') {
              locationModeRef.current = 'manual';
              gpsRequestSeqRef.current += 1;
              setIsManualLocationMode(true);
              setGpsStatus('manual');
              setGpsError(null);
              setDeviceExactLocation(buildManualDeviceLocation(cloud.locationPref));
              setLocationCoords(buildManualLocationCoords(cloud.locationPref));
              if (cloud.locationPref.manualCityName) {
                setActiveCityGuideTarget(cloud.locationPref.manualCityName);
                setActiveStateGuideTarget(cloud.locationPref.manualStateName || '');
                setActiveCountryGuideTarget(cloud.locationPref.manualCountryName || '');
              }
            }
          }
        }
      } catch (err) {
        console.warn('Cloud session hydration error:', err);
      }
    });

    return () => unsubscribe();
  }, [loadJournalForSession]);

  // Open City Guide Modal for any given city
  const handleOpenCityGuide = (cityName: string, stateName?: string, countryName: string = '') => {
    const resolvedCity = cityName || deviceExactLocation?.city || locationCoords?.city || '';
    if (!resolvedCity) {
      navigateToTab('city');
      return;
    }
    setActiveCityGuideTarget(resolvedCity);
    setActiveStateGuideTarget(stateName || deviceExactLocation?.state || '');
    setActiveCountryGuideTarget(countryName || deviceExactLocation?.country || '');
    setIsCityGuideModalOpen(true);
  };

  // Manually select a city/town/village and update the whole app context + persist
  const handleSelectCityManually = (cityData: {
    cityName: string;
    state?: string;
    stateCode?: string;
    country: string;
    countryCode?: string;
    latitude: number | null;
    longitude: number | null;
    locationName: string;
    placeId?: string;
    isVerified?: boolean;
  }) => {
    locationModeRef.current = 'manual';
    gpsRequestSeqRef.current += 1;
    setIsManualLocationMode(true);
    setGpsStatus('manual');
    setGpsError(null);
    setActiveCityGuideTarget(cityData.cityName);
    setActiveStateGuideTarget(cityData.state || '');
    setActiveCountryGuideTarget(cityData.country || '');

    const hasValidCoords =
      typeof cityData.latitude === 'number' &&
      typeof cityData.longitude === 'number' &&
      Number.isFinite(cityData.latitude) &&
      Number.isFinite(cityData.longitude);
    const isVerified = Boolean(cityData.isVerified ?? hasValidCoords) && hasValidCoords;

    setDeviceExactLocation({
      latitude: hasValidCoords ? cityData.latitude : null,
      longitude: hasValidCoords ? cityData.longitude : null,
      locationName: cityData.locationName,
      city: cityData.cityName,
      state: cityData.state || '',
      stateCode: cityData.stateCode || '',
      country: cityData.country || '',
      countryCode: cityData.countryCode || '',
      placeId: cityData.placeId,
      isVerified,
      isLiveGps: false,
      status: 'manual',
      sourceProvider: isVerified ? 'manual' : 'manual_custom',
    });

    setLocationCoords(
      hasValidCoords
        ? {
            latitude: cityData.latitude!,
            longitude: cityData.longitude!,
            city: cityData.cityName,
            country: cityData.country,
          }
        : null
    );

    const nextLocPref: SavedLocationPreference = {
      locationMode: 'manual',
      manualCityName: cityData.cityName,
      manualStateName: cityData.state || undefined,
      manualStateCode: cityData.stateCode || undefined,
      manualCountryName: cityData.country,
      manualCountryCode: cityData.countryCode || undefined,
      manualPlaceId: cityData.placeId || undefined,
      manualLocationVerified: isVerified,
      manualLatitude: hasValidCoords ? cityData.latitude : null,
      manualLongitude: hasValidCoords ? cityData.longitude : null,
    };
    setLocationPref(nextLocPref);
    saveLocalLocationPref(nextLocPref);
    syncCloudIfAuthenticated({ locPref: nextLocPref });
  };

  const handleSetLocationMode = (mode: 'gps' | 'manual') => {
    if (mode === 'gps') {
      const nextLocPref: SavedLocationPreference = {
        ...locationPref,
        locationMode: 'gps',
      };
      setLocationPref(nextLocPref);
      saveLocalLocationPref(nextLocPref);
      refreshDeviceLocation().then(() => {
        syncCloudIfAuthenticated({ locPref: nextLocPref });
      });
    } else {
      locationModeRef.current = 'manual';
      gpsRequestSeqRef.current += 1;
      setIsManualLocationMode(true);
      setGpsStatus('manual');
      setGpsError(null);
      const nextLocPref: SavedLocationPreference = {
        ...locationPref,
        locationMode: 'manual',
      };
      // Restore previously saved manual destination (without pulling stale GPS coords into manual mode)
      if (nextLocPref.manualCityName) {
        setDeviceExactLocation(buildManualDeviceLocation(nextLocPref));
        setLocationCoords(buildManualLocationCoords(nextLocPref));
        setActiveCityGuideTarget(nextLocPref.manualCityName);
        setActiveStateGuideTarget(nextLocPref.manualStateName || '');
        setActiveCountryGuideTarget(nextLocPref.manualCountryName || '');
      } else {
        setDeviceExactLocation(null);
        setLocationCoords(null);
      }
      setLocationPref(nextLocPref);
      saveLocalLocationPref(nextLocPref);
      syncCloudIfAuthenticated({ locPref: nextLocPref });
    }
  };

  const persistEntriesSnapshot = useCallback((nextEntries: TravelJournalEntry[], uid: string | null) => {
    const sorted = sortJournalEntriesNewestFirst(nextEntries);
    if (uid) {
      saveUidJournalCache(uid, sorted);
    } else {
      saveGuestJournal(sorted);
    }
    return sorted;
  }, []);

  const syncVisitedCount = useCallback(
    (delta: number) => {
      setUserProfile((prev) => {
        if (!prev) return prev;
        const nextCount = Math.max(0, (prev.visitedCount || 0) + delta);
        const updatedProfile: UserProfile = {
          ...prev,
          visitedCount: nextCount,
          updatedAt: new Date().toISOString(),
        };
        saveLocalUserProfile(updatedProfile);
        if (auth.currentUser?.uid && updatedProfile.authMethod === 'google') {
          saveUserToFirestore({
            uid: auth.currentUser.uid,
            profile: updatedProfile,
            guideSettings,
            locationPref,
            theme: currentTheme,
            onboardingState,
          }).catch(() => {});
        }
        return updatedProfile;
      });
    },
    [currentTheme, guideSettings, locationPref, onboardingState]
  );

  const createJournalRecord = useCallback(
    async (
      payload: Omit<TravelJournalEntry, 'journalId' | 'userId' | 'createdAt' | 'updatedAt'>,
      explicitJournalId?: string
    ): Promise<TravelJournalEntry> => {
      const verifiedUid = auth.currentUser?.uid || null;
      if (verifiedUid) {
        const created = await createUserJournalEntry(verifiedUid, {
          ...payload,
          journalId: explicitJournalId,
        });
        if (activeJournalUidRef.current !== verifiedUid) {
          return created;
        }
        setJournalEntries((prev) => {
          const withoutDup = prev.filter((e) => e.journalId !== created.journalId);
          return persistEntriesSnapshot([created, ...withoutDup], verifiedUid);
        });
        syncVisitedCount(1);
        return created;
      }

      // Guest local temporary storage
      const nowIso = new Date().toISOString();
      const journalId = explicitJournalId || generateSafeJournalId(payload.placeName);
      const guestEntry: TravelJournalEntry = {
        ...payload,
        journalId,
        userId: 'guest',
        createdAt: nowIso,
        updatedAt: nowIso,
      };
      setJournalEntries((prev) => {
        const withoutDup = prev.filter((e) => e.journalId !== guestEntry.journalId);
        return persistEntriesSnapshot([guestEntry, ...withoutDup], null);
      });
      syncVisitedCount(1);
      return guestEntry;
    },
    [persistEntriesSnapshot, syncVisitedCount]
  );

  const updateJournalRecord = useCallback(
    async (journalId: string, updates: Partial<TravelJournalEntry>) => {
      const existing = journalEntries.find((e) => e.journalId === journalId);
      if (!existing) throw new Error('Journal entry not found.');

      const verifiedUid = auth.currentUser?.uid || null;
      if (existing.userId !== 'guest') {
        if (!verifiedUid || existing.userId !== verifiedUid) {
          throw new Error('Unauthorized: this journal entry belongs to another account.');
        }
        const updated = await updateUserJournalEntry(verifiedUid, journalId, updates, existing);
        if (activeJournalUidRef.current !== verifiedUid) return;
        setJournalEntries((prev) =>
          persistEntriesSnapshot(
            prev.map((e) => (e.journalId === journalId ? updated : e)),
            verifiedUid
          )
        );
        return;
      }

      if (verifiedUid) {
        throw new Error('Guest journal entries cannot be edited under an authenticated session.');
      }

      const updatedGuest: TravelJournalEntry = {
        ...existing,
        ...updates,
        journalId,
        userId: 'guest',
        updatedAt: new Date().toISOString(),
      };
      setJournalEntries((prev) =>
        persistEntriesSnapshot(
          prev.map((e) => (e.journalId === journalId ? updatedGuest : e)),
          null
        )
      );
    },
    [journalEntries, persistEntriesSnapshot]
  );

  const deleteJournalRecord = useCallback(
    async (journalId: string) => {
      const existing = journalEntries.find((e) => e.journalId === journalId);
      const verifiedUid = auth.currentUser?.uid || null;
      if (existing) {
        if (existing.userId !== 'guest') {
          if (!verifiedUid || existing.userId !== verifiedUid) {
            throw new Error('Unauthorized: this journal entry belongs to another account.');
          }
        } else if (verifiedUid) {
          throw new Error('Guest journal entries cannot be deleted under an authenticated session.');
        }
      }

      if (verifiedUid) {
        await deleteUserJournalEntry(verifiedUid, journalId);
        setJournalEntries((prev) =>
          persistEntriesSnapshot(
            prev.filter((e) => e.journalId !== journalId),
            verifiedUid
          )
        );
        syncVisitedCount(-1);
        return;
      }

      if (existing && existing.userId !== 'guest') {
        throw new Error('Sign in with the owning account to delete this journal entry.');
      }

      setJournalEntries((prev) =>
        persistEntriesSnapshot(
          prev.filter((e) => e.journalId !== journalId),
          null
        )
      );
      syncVisitedCount(-1);
    },
    [journalEntries, persistEntriesSnapshot, syncVisitedCount]
  );

  const prepareJournalPhotoDataUrl = useCallback(async (rawUrl?: string): Promise<string | undefined> => {
    if (!rawUrl || !rawUrl.startsWith('data:image/')) return undefined;
    try {
      const compressed = await compressImageToJournalDataUrl(rawUrl, 560, 82000);
      return compressed || undefined;
    } catch {
      return undefined;
    }
  }, []);

  // Deduplicates progressive scan callbacks (Batch 2 -> Batch 3 -> onComplete) per scan ID
  const handleScanComplete = useCallback(
    (result: RecognitionResult) => {
      setLastScannedLandmark(result);

      if (!result.title || result.title.trim().length === 0) return;
      const scanKey = result.id || `scan_${result.title}`;
      const existingPromise = scanCreatePromiseMapRef.current.get(scanKey);

      if (!existingPromise) {
        const createPromise = (async () => {
          const compressedPhoto = await prepareJournalPhotoDataUrl(
            result.photoDataUrl || (result.imageUrl?.startsWith('data:image/') ? result.imageUrl : undefined)
          );
          const payload = recognitionResultToJournalPayload(
            { ...result, photoDataUrl: compressedPhoto || result.photoDataUrl },
            { visitedConfirmed: true }
          );
          return createJournalRecord(payload);
        })().catch((err) => {
          console.warn('Journal auto-log skipped or failed:', err);
          scanCreatePromiseMapRef.current.delete(scanKey);
          return null;
        });
        scanCreatePromiseMapRef.current.set(scanKey, createPromise);
      } else {
        existingPromise.then(async (createdEntry) => {
          if (!createdEntry) return;
          const compressedPhoto = await prepareJournalPhotoDataUrl(
            result.photoDataUrl || (result.imageUrl?.startsWith('data:image/') ? result.imageUrl : undefined)
          );
          const payload = recognitionResultToJournalPayload(
            { ...result, photoDataUrl: compressedPhoto || createdEntry.photoDataUrl },
            { visitedConfirmed: createdEntry.visitedConfirmed }
          );
          const verifiedUid = auth.currentUser?.uid || null;
          if (verifiedUid && createdEntry.userId === verifiedUid) {
            updateUserJournalEntry(verifiedUid, createdEntry.journalId, payload, createdEntry)
              .then((updated) => {
                if (activeJournalUidRef.current !== verifiedUid) return;
                setJournalEntries((prev) =>
                  persistEntriesSnapshot(
                    prev.map((e) => (e.journalId === createdEntry.journalId ? updated : e)),
                    verifiedUid
                  )
                );
              })
              .catch(() => {});
          } else if (!verifiedUid && createdEntry.userId === 'guest') {
            setJournalEntries((prev) =>
              persistEntriesSnapshot(
                prev.map((e) =>
                  e.journalId === createdEntry.journalId
                    ? { ...e, ...payload, updatedAt: new Date().toISOString() }
                    : e
                ),
                null
              )
            );
          }
        });
      }
    },
    [createJournalRecord, persistEntriesSnapshot, prepareJournalPhotoDataUrl]
  );

  const handleSaveLandmarkToJournal = async (landmark: RecognitionResult) => {
    const lockKey = `landmark:${landmark.id || landmark.title}`;
    if (savingKeysRef.current.has(lockKey)) return;

    const alreadySaved = journalEntries.some(
      (entry) =>
        entry.journalId === landmark.id ||
        (landmark.placeId && entry.placeId && entry.placeId === landmark.placeId) ||
        entry.placeName.toLowerCase() === landmark.title.toLowerCase()
    );
    if (alreadySaved) return;

    savingKeysRef.current.add(lockKey);
    try {
      const compressedPhoto = await prepareJournalPhotoDataUrl(
        landmark.photoDataUrl || (landmark.imageUrl?.startsWith('data:image/') ? landmark.imageUrl : undefined)
      );
      const payload = recognitionResultToJournalPayload(
        { ...landmark, photoDataUrl: compressedPhoto || landmark.photoDataUrl },
        { visitedConfirmed: true }
      );
      await createJournalRecord(payload);
      showToast(`Saved "${landmark.title}" to your Travel Journal.`);
    } finally {
      savingKeysRef.current.delete(lockKey);
    }
  };

  const handleSaveFromAiGuide = async (data: AiGuideJournalSavePayload) => {
    const lockKey = `aiguide:${data.placeName.toLowerCase()}:${data.visitDate}`;
    if (savingKeysRef.current.has(lockKey)) return;
    savingKeysRef.current.add(lockKey);
    try {
      const compressedPhoto = await prepareJournalPhotoDataUrl(
        data.photoDataUrl ||
          data.landmark?.photoDataUrl ||
          (data.landmark?.imageUrl?.startsWith('data:image/') ? data.landmark.imageUrl : undefined)
      );
      const base = data.landmark
        ? recognitionResultToJournalPayload(
            { ...data.landmark, photoDataUrl: compressedPhoto || data.landmark.photoDataUrl },
            {
              notes: data.notes,
              visitDate: data.visitDate,
              city: data.city,
              country: data.country,
              visitedConfirmed: true,
            }
          )
        : recognitionResultToJournalPayload(
            {
              id: generateSafeJournalId(data.placeName),
              title: data.placeName,
              category: 'monument',
              confidence: 1,
              locationName: [data.city, data.country].filter(Boolean).join(', '),
              city: data.city,
              country: data.country,
              summary: data.guideSummary || `Explored ${data.placeName} with Charaiva AI Guide.`,
              narration: data.guideSummary || `Explored ${data.placeName} with Charaiva AI Guide.`,
              keyFacts: [],
              tags: [],
              language: selectedLanguage.name,
              photoDataUrl: compressedPhoto,
              timestamp: new Date().toISOString(),
            },
            {
              notes: data.notes,
              visitDate: data.visitDate,
              city: data.city,
              country: data.country,
              visitedConfirmed: true,
            }
          );

      await createJournalRecord({
        ...base,
        placeName: data.placeName,
        notes: data.notes,
        guideSummary: data.guideSummary || base.guideSummary,
        photoDataUrl: compressedPhoto || base.photoDataUrl,
        visitDate: data.visitDate,
      });
      showToast(`Saved "${data.placeName}" to your Travel Journal.`);
    } finally {
      savingKeysRef.current.delete(lockKey);
    }
  };

  const handleClearMemory = async () => {
    const verifiedUid = auth.currentUser?.uid || null;
    if (verifiedUid) {
      const ids = journalEntries
        .filter((e) => e.userId === verifiedUid)
        .map((e) => e.journalId);
      await clearAllUserJournalEntries(verifiedUid, ids);
      saveUidJournalCache(verifiedUid, []);
    } else {
      clearGuestJournal();
    }
    scanCreatePromiseMapRef.current.clear();
    setJournalEntries([]);
    setUserProfile((prev) => {
      if (!prev) return prev;
      const resetProfile: UserProfile = {
        ...prev,
        visitedCount: 0,
        updatedAt: new Date().toISOString(),
      };
      saveLocalUserProfile(resetProfile);
      syncCloudIfAuthenticated({ profile: resetProfile });
      return resetProfile;
    });
    showToast('Travel Journal cleared.');
  };

  const navigateToHome = useCallback(() => {
    speechManager.stop();
    setChatQuestion(undefined);
    setChatLandmarkContext(null);
    navigateToTab('home', { replace: true });
  }, [navigateToTab]);

  const handleOpenChatWithQuestion = useCallback(
    (q: string) => {
      const topRoute = screenStackRef.current[screenStackRef.current.length - 1];
      const activeExpl =
        topRoute?.kind === 'explanation'
          ? topRoute.landmark
          : topRoute?.kind === 'tab' && topRoute.tab === 'camera'
          ? lastScannedLandmark
          : null;
      setChatLandmarkContext(activeExpl);
      setChatQuestion(q);
      navigateToTab('chat');
    },
    [lastScannedLandmark, navigateToTab]
  );

  const handleOpenRelatedDiscovery = useCallback(
    async (item: RelatedDiscoveryItem) => {
      const topRoute = screenStackRef.current[screenStackRef.current.length - 1];
      const originTab: AppTab = topRoute?.kind === 'explanation' ? topRoute.originTab : activeTabRef.current;
      try {
        const res = await fetch('/api/discover/explain', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({
            candidate: {
              id: item.id,
              title: item.title,
              category: item.category,
              locationOrOrigin: item.locationOrOrigin || '',
              wikipediaTitle: item.wikipediaTitle,
              wikipediaUrl: item.wikipediaUrl,
              imageUrl: item.imageUrl,
              imageAttribution: item.imageAttribution,
              isVisitableSite: item.isVisitableSite,
            },
            level: 'standard',
            language: selectedLanguage.name,
            guideSettings,
          }),
        });
        const data = await res.json();
        if (res.ok && data.success && data.landmark) {
          openExplanationRoute(data.landmark as RecognitionResult, originTab);
          return;
        }
      } catch (err) {
        console.warn('Failed to open related discovery via API:', err);
      }

      // Fallback minimal entry if API is offline so user still navigates cleanly
      openExplanationRoute(
        {
          id: item.id,
          title: item.title,
          category: item.mappedCategory || 'monument',
          categoryLabel: item.category,
          confidence: 0.8,
          locationName: item.locationOrOrigin || 'Heritage Discovery',
          summary: item.relationReason,
          narration: item.relationReason,
          keyFacts: [item.relationReason],
          tags: [item.category],
          language: selectedLanguage.name,
          imageUrl: item.imageUrl,
          imageAttribution: item.imageAttribution,
        },
        originTab
      );
    },
    [guideSettings, openExplanationRoute, selectedLanguage.name]
  );

  // Onboarding Orchestration Callbacks
  const updateOnboardingState = useCallback((next: OnboardingState) => {
    setOnboardingState(next);
    saveLocalOnboardingState(next);
  }, []);

  const handleIntroStartTour = () => {
    if (replayMode === 'intro') {
      openReplayRoute('tour');
      return;
    }
    updateOnboardingState({ ...onboardingState, hasSeenIntro: true });
    replaceReplayRoute('none');
  };

  const handleSkipIntroOnly = () => {
    if (replayMode === 'intro') {
      goBackScreen();
      return;
    }
    updateOnboardingState({ ...onboardingState, hasSeenIntro: true });
    replaceReplayRoute('none');
  };

  const handleIntroSkipToLogin = () => {
    updateOnboardingState({
      ...onboardingState,
      hasSeenIntro: true,
      hasCompletedTour: true,
    });
    replaceReplayRoute('none');
  };

  const handleSkipAllToExplore = () => {
    const alreadyEnteredApp =
      onboardingState.hasCompletedLoginSetup || onboardingState.skippedDirectly;

    if ((replayMode === 'intro' || replayMode === 'tour') && alreadyEnteredApp) {
      replaceReplayRoute('none');
      return;
    }

    if (replayMode === 'login' && onboardingState.hasCompletedLoginSetup) {
      goBackScreen();
      return;
    }

    if (!userProfile) {
      const guestProfile: UserProfile = {
        authMethod: 'guest',
        name: 'Guest Explorer',
        email: 'guest@charaiva.app',
        preferredLanguage: selectedLanguage.code,
        travelerType: 'casual_tourist',
        visitedCount: 0,
        createdAt: new Date().toISOString(),
        updatedAt: new Date().toISOString(),
        badges: [],
      };
      setUserProfile(guestProfile);
      saveLocalUserProfile(guestProfile);
    }
    updateOnboardingState({
      hasSeenIntro: true,
      hasCompletedTour: true,
      hasCompletedLoginSetup: onboardingState.hasCompletedLoginSetup,
      skippedDirectly: !onboardingState.hasCompletedLoginSetup,
    });
    replaceReplayRoute('none');
    navigateToTab('home', { replace: true });
  };

  const handleCompleteTour = () => {
    if (replayMode === 'tour') {
      goBackScreen();
      return;
    }
    updateOnboardingState({
      ...onboardingState,
      hasSeenIntro: true,
      hasCompletedTour: true,
    });
    replaceReplayRoute('none');
  };

  const handleCompleteLogin = async (payload: LoginCompletionPayload) => {
    const nextOnboarding: OnboardingState = {
      hasSeenIntro: true,
      hasCompletedTour: true,
      hasCompletedLoginSetup: true,
      skippedDirectly: false,
    };

    setUserProfile(payload.profile);
    setGuideSettings(payload.guideSettings);
    setOutputMode(payload.guideSettings.outputMode || 'both');
    setSelectedLanguage(payload.language);
    setLocationPref(payload.locationPref);
    setCurrentTheme(payload.theme);
    setOnboardingState(nextOnboarding);
    replaceReplayRoute('none');
    navigateToTab('home', { replace: true });

    // Sync to localStorage
    saveLocalUserProfile(payload.profile);
    saveLocalLanguageCode(payload.language.code);
    saveLocalLocationPref(payload.locationPref);
    saveLocalOnboardingState(nextOnboarding);
    try {
      localStorage.setItem(STORAGE_KEYS.SETTINGS, JSON.stringify(payload.guideSettings));
      localStorage.setItem(STORAGE_KEYS.THEME, payload.theme);
    } catch {
      // ignore
    }

    // Apply location mode cleanly
    if (payload.locationPref.locationMode === 'manual') {
      locationModeRef.current = 'manual';
      gpsRequestSeqRef.current += 1;
      setIsManualLocationMode(true);
      setGpsStatus('manual');
      setGpsError(null);
      setDeviceExactLocation(buildManualDeviceLocation(payload.locationPref));
      setLocationCoords(buildManualLocationCoords(payload.locationPref));
      if (payload.locationPref.manualCityName) {
        setActiveCityGuideTarget(payload.locationPref.manualCityName);
        setActiveStateGuideTarget(payload.locationPref.manualStateName || '');
        setActiveCountryGuideTarget(payload.locationPref.manualCountryName || '');
      }
    } else {
      setIsManualLocationMode(false);
      refreshDeviceLocation();
    }

    scanCreatePromiseMapRef.current.clear();
    savingKeysRef.current.clear();

    // Write profile to Firestore if authenticated via Google, and restore that user's Travel Journal
    if (payload.profile.uid && auth.currentUser?.uid === payload.profile.uid) {
      if (!payload.isExistingCloudRestore) {
        await saveUserToFirestore({
          uid: payload.profile.uid,
          profile: payload.profile,
          guideSettings: payload.guideSettings,
          locationPref: payload.locationPref,
          theme: payload.theme,
          onboardingState: nextOnboarding,
        });
      }
      await loadJournalForSession(payload.profile.uid, { migrateGuest: true });
    } else {
      await loadJournalForSession(null);
    }

    showToast(
      payload.isExistingCloudRestore
        ? `Welcome back, ${payload.profile.name}! Settings & Travel Journal restored.`
        : `Preferences synced to Settings for ${payload.profile.name}.`
    );
  };

  // Profile updates directly from Settings screen
  const handleUpdateProfileInSettings = (updatedProfile: UserProfile, applyPresetTopics = false) => {
    const nextOnboarding: OnboardingState = {
      hasSeenIntro: true,
      hasCompletedTour: true,
      hasCompletedLoginSetup: true,
      skippedDirectly: false,
    };

    let nextSettings = guideSettings;
    if (applyPresetTopics) {
      const preset = getPresetForTravelerType(updatedProfile.travelerType);
      nextSettings = {
        ...guideSettings,
        persona: preset.recommendedPersona,
        topics: { ...preset.topics },
      };
      setGuideSettings(nextSettings);
      try {
        localStorage.setItem(STORAGE_KEYS.SETTINGS, JSON.stringify(nextSettings));
      } catch {
        // ignore
      }
    }

    setUserProfile(updatedProfile);
    saveLocalUserProfile(updatedProfile);
    updateOnboardingState(nextOnboarding);
    syncCloudIfAuthenticated({
      profile: updatedProfile,
      settings: nextSettings,
      onboarding: nextOnboarding,
    });
    showToast('Profile details saved and synced to Settings.');
  };

  // Google Cloud linking or Sign-In triggered from Settings -> Profile
  const handleSignInWithGoogleFromSettings = async (): Promise<{ restored?: boolean; error?: string }> => {
    isInteractiveSignInRef.current = true;
    try {
      const res = await signInWithPopup(auth, googleProvider);
      const user = res.user;
      if (!user) return { error: 'Could not complete Google Sign-In.' };

      const cloud = await loadUserFromFirestore(user.uid);
      if (cloud.profile && cloud.onboardingState?.hasCompletedLoginSetup && cloud.guideSettings) {
        const restoredLang = getLanguageByCode(cloud.profile.preferredLanguage);
        await handleCompleteLogin({
          profile: cloud.profile,
          guideSettings: cloud.guideSettings,
          language: restoredLang,
          locationPref: cloud.locationPref || { locationMode: 'gps' },
          theme: cloud.theme || currentTheme,
          isExistingCloudRestore: true,
        });
        return { restored: true };
      }

      const upgradedProfile: UserProfile = {
        uid: user.uid,
        authMethod: 'google',
        name:
          userProfile?.name && userProfile.name !== 'Guest Explorer'
            ? userProfile.name
            : user.displayName || 'Explorer',
        email:
          userProfile?.email && userProfile.email !== 'guest@charaiva.app'
            ? userProfile.email
            : user.email || '',
        preferredLanguage: selectedLanguage.code,
        travelerType: userProfile?.travelerType || 'casual_tourist',
        visitedCount: userProfile?.visitedCount ?? visitedHistory.length,
        createdAt: userProfile?.createdAt || new Date().toISOString(),
        updatedAt: new Date().toISOString(),
        badges: userProfile?.badges || [],
      };
      const completedOnboarding: OnboardingState = {
        hasSeenIntro: true,
        hasCompletedTour: true,
        hasCompletedLoginSetup: true,
        skippedDirectly: false,
      };
      setUserProfile(upgradedProfile);
      saveLocalUserProfile(upgradedProfile);
      updateOnboardingState(completedOnboarding);

      await saveUserToFirestore({
        uid: user.uid,
        profile: upgradedProfile,
        guideSettings,
        locationPref,
        theme: currentTheme,
        onboardingState: completedOnboarding,
      });

      scanCreatePromiseMapRef.current.clear();
      await loadJournalForSession(user.uid, { migrateGuest: true });

      showToast('Connected with Google Cloud — Settings & Journal synced.');
      return { restored: false };
    } catch (err: any) {
      const code = err?.code || '';
      if (code === 'auth/popup-closed-by-user' || code === 'auth/cancelled-popup-request') {
        return { error: 'Google sign-in popup was closed before completing.' };
      }
      return { error: 'Google Sign-In could not connect right now.' };
    } finally {
      isInteractiveSignInRef.current = false;
    }
  };

  const handleLogoutAndResetOnboarding = async () => {
    speechManager.stop();
    try {
      await signOut(auth);
    } catch {
      // ignore if already signed out
    }
    activeJournalUidRef.current = null;
    scanCreatePromiseMapRef.current.clear();
    savingKeysRef.current.clear();
    setJournalEntries([]);
    setJournalFromCache(false);
    setJournalError(null);
    setUserProfile(null);
    saveLocalUserProfile(null);
    setLastScannedLandmark(null);
    setChatQuestion(undefined);
    setChatLandmarkContext(null);
    setChatMessages([]);
    setHasEnteredWorkspace(false);
    navigateToTab('home', { replace: true });
    updateOnboardingState({
      hasSeenIntro: true,
      hasCompletedTour: true,
      hasCompletedLoginSetup: false,
      skippedDirectly: false,
    });
    showToast('Signed out. Ready for a new explorer profile.');
  };

  // Determine which view fills the viewport below the two persistent header/nav panels
  const showIntroScreen = replayMode === 'intro' || !onboardingState.hasSeenIntro;
  const showTourScreen = !showIntroScreen && (replayMode === 'tour' || !onboardingState.hasCompletedTour);
  const showLoginScreen =
    !showIntroScreen &&
    !showTourScreen &&
    (replayMode === 'login' || (!onboardingState.hasCompletedLoginSetup && !onboardingState.skippedDirectly));
  const isSubScreenActive = showIntroScreen || showTourScreen || showLoginScreen;

  const [hasEnteredWorkspace, setHasEnteredWorkspace] = useState<boolean>(
    () =>
      !isSubScreenActive ||
      Boolean(
        onboardingState.hasCompletedLoginSetup ||
          onboardingState.skippedDirectly ||
          (onboardingState.hasSeenIntro && onboardingState.hasCompletedTour)
      )
  );
  useEffect(() => {
    if (!isSubScreenActive && !hasEnteredWorkspace) {
      setHasEnteredWorkspace(true);
    }
  }, [isSubScreenActive, hasEnteredWorkspace]);

  // Register initial onboarding Back transitions so Android/Browser Back steps Tour -> Intro & Login -> Tour
  useBackLayer(
    'initial-onboarding-tour',
    showTourScreen && replayMode === 'none',
    () => updateOnboardingState({ ...onboardingState, hasSeenIntro: false }),
    10
  );
  useBackLayer(
    'initial-onboarding-login',
    showLoginScreen && replayMode === 'none',
    () => updateOnboardingState({ ...onboardingState, hasCompletedTour: false }),
    10
  );

  const isFullScreenView =
    !isSubScreenActive &&
    (hasDetailOverlay || activeTab !== 'home');

  const handleFullScreenBack = () => {
    if (backLayerRegistry.dismissTop(0)) return;

    const shell =
      mainRef.current?.dataset.fullscreenShell === 'true'
        ? mainRef.current
        : document.querySelector<HTMLElement>(
            '#charaiva-app-root main[data-fullscreen-shell="true"]'
          );

    if (shell) {
      let activeButtonSelector: string | null = null;
      if (currentDeepConversation) {
        activeButtonSelector = '#deep-conversation-screen #btn-deep-conversation-back';
      } else if (currentExplanation) {
        activeButtonSelector = '#explanation-view #btn-explanation-back';
      } else {
        const tabBackSelectorMap: Partial<Record<AppTab, string>> = {
          camera: '#photo-guide-screen #btn-camera-back-home',
          discover: '#discover-screen #btn-discover-back',
          chat: '#ai-chat-screen #btn-chat-back-home',
          map: '#map-view-screen #btn-map-back-home',
          history: '#history-screen #btn-history-back-home',
          city: '#city-explorer-screen #btn-city-back-home',
          settings: '#settings-screen #btn-settings-back-home',
          nearby: '#nearby-attractions-screen #btn-nearby-back-home',
        };
        activeButtonSelector = tabBackSelectorMap[activeTab] || null;
      }

      if (activeButtonSelector) {
        const candidates = Array.from(
          shell.querySelectorAll(activeButtonSelector)
        )
          .filter(
            (node): node is HTMLButtonElement =>
              node instanceof HTMLButtonElement
          )
          .filter((button) => {
            const hiddenAncestor = button.closest(
              '[hidden], [aria-hidden="true"], [inert], .hidden'
            );
            return (
              !button.disabled &&
              !hiddenAncestor &&
              button.matches(SCREEN_PRIMARY_BACK_SELECTOR)
            );
          });

        const target = candidates[candidates.length - 1];
        if (target) {
          target.click();
          return;
        }
      }
    }

    goBackScreen();
  };

  const handlePanelNavigate = (tab: AppTab) => {
    if (isSubScreenActive) {
      replaceReplayRoute('none');
      if (!userProfile) {
        const guestProfile: UserProfile = {
          authMethod: 'guest',
          name: 'Guest Explorer',
          email: 'guest@charaiva.app',
          preferredLanguage: selectedLanguage.code,
          travelerType: 'casual_tourist',
          visitedCount: 0,
          createdAt: new Date().toISOString(),
          updatedAt: new Date().toISOString(),
          badges: [],
        };
        setUserProfile(guestProfile);
        saveLocalUserProfile(guestProfile);
      }
      updateOnboardingState({
        hasSeenIntro: true,
        hasCompletedTour: true,
        hasCompletedLoginSetup: onboardingState.hasCompletedLoginSetup,
        skippedDirectly: !onboardingState.hasCompletedLoginSetup,
      });
    }
    if (tab === 'home') {
      navigateToHome();
    } else {
      navigateToTab(tab);
    }
  };

  return (
    <div
      ref={appRootRef}
      id="charaiva-app-root"
      data-theme={currentTheme}
      className="relative h-[100dvh] max-h-[100dvh] w-full overflow-hidden overflow-clip font-sans flex flex-col selection:bg-[var(--theme-accent-primary)] selection:text-[var(--theme-accent-primary-text)] transition-colors duration-300"
    >
      {/* Dynamic Ambient Background Glows */}
      <div
        className="theme-ambient-glow -top-24 -left-24 w-96 h-96"
        style={{ backgroundColor: 'var(--theme-ambient-glow-1)' }}
      />
      <div
        className="theme-ambient-glow top-1/3 -right-32 w-96 h-96"
        style={{ backgroundColor: 'var(--theme-ambient-glow-2)' }}
      />
      <div
        className="theme-ambient-glow -bottom-32 left-1/4 w-96 h-96"
        style={{ backgroundColor: 'var(--theme-ambient-glow-1)' }}
      />

      {/* Sticky Top Quota Banner (Google Maps Platform Case A) */}
      {gmpQuotaExceeded && !gmpQuotaBannerDismissed && (
        <div
          id="gmp-quota-banner"
          role="alert"
          className="sticky top-0 z-50 shrink-0 w-full bg-amber-950/95 border-b border-amber-500/60 text-amber-100 px-3 py-2 text-xs flex items-center justify-between gap-3 backdrop-blur-md shadow-lg"
        >
          <div className="flex items-center gap-2 min-w-0">
            <AlertTriangle className="w-4 h-4 text-amber-400 shrink-0" />
            <p className="leading-snug">
              Google Maps Platform quota reached. If you are the app owner, visit{' '}
              <a
                href="https://developers.google.com/maps/ai/ai-studio?utm_campaign=gmp_mcp_codeassist_v1_aistudio#quota_exceeded_errors"
                target="_blank"
                rel="noopener noreferrer"
                className="underline font-bold text-amber-300 hover:text-white"
              >
                maps developer site
              </a>{' '}
              for instructions to update your account.
            </p>
          </div>
          <button
            type="button"
            onClick={() => setGmpQuotaBannerDismissed(true)}
            className="p-1 rounded-lg hover:bg-amber-800/60 text-amber-200 cursor-pointer shrink-0"
            aria-label="Dismiss quota notification"
          >
            <X className="w-4 h-4" />
          </button>
        </div>
      )}

      {/* Persistent Panel 1 (Brand & User) + Panel 2 (Explore, Photo Guide, Attractions, AI Guide, Map, Journal, Settings) */}
      <Navigation
        activeTab={activeTab}
        setActiveTab={handlePanelNavigate}
        selectedLanguage={selectedLanguage}
        onOpenLanguageModal={() => setIsLanguageModalOpen(true)}
        visitedMemoryCount={visitedHistory.length}
        outputMode={outputMode}
        onToggleOutputMode={handleToggleOutputMode}
        deviceExactLocation={deviceExactLocation}
        onOpenCityGuide={(city) => handleOpenCityGuide(city)}
        currentTheme={currentTheme}
        onSelectTheme={handleSelectTheme}
        userProfile={userProfile}
        isSubScreenActive={isSubScreenActive}
        tourHighlightTab={showTourScreen ? tourHighlightTab : null}
      />

      {showIntroScreen ? (
        <AppIntroductionPage
          selectedLanguage={selectedLanguage}
          guideSettings={guideSettings}
          onUpdateSpeechRate={handleUpdateSpeechRate}
          userProfile={userProfile}
          isReplayMode={replayMode === 'intro'}
          onBack={replayMode === 'intro' ? goBackScreen : undefined}
          onOpenLanguageModal={() => setIsLanguageModalOpen(true)}
          onStartTour={handleIntroStartTour}
          onSkipIntroOnly={handleSkipIntroOnly}
          onSkipToLogin={handleIntroSkipToLogin}
          onSkipAllToApp={handleSkipAllToExplore}
        />
      ) : showTourScreen ? (
        <AppTourOverlay
          selectedLanguage={selectedLanguage}
          guideSettings={guideSettings}
          onUpdateSpeechRate={handleUpdateSpeechRate}
          userProfile={userProfile}
          isReplayMode={replayMode === 'tour'}
          onActiveStepChange={(tab) => setTourHighlightTab(tab)}
          onBack={
            replayMode === 'tour'
              ? goBackScreen
              : () => updateOnboardingState({ ...onboardingState, hasSeenIntro: false })
          }
          onCompleteTour={handleCompleteTour}
          onSkipTourToExploreNow={handleSkipAllToExplore}
          onBackToIntro={() => {
            if (replayMode === 'tour') {
              replaceReplayRoute('intro');
            } else {
              updateOnboardingState({ ...onboardingState, hasSeenIntro: false });
            }
          }}
        />
      ) : showLoginScreen ? (
        <LoginOnboardingScreen
          initialProfile={userProfile}
          initialSettings={guideSettings}
          selectedLanguage={selectedLanguage}
          onSelectLanguage={handleSelectLanguage}
          onOpenLanguageModal={() => setIsLanguageModalOpen(true)}
          currentTheme={currentTheme}
          onSelectTheme={handleSelectTheme}
          initialLocationPref={locationPref}
          isReplayMode={replayMode === 'login'}
          onBack={
            replayMode === 'login'
              ? goBackScreen
              : () => updateOnboardingState({ ...onboardingState, hasCompletedTour: false })
          }
          onCompleteLogin={handleCompleteLogin}
          onSkipAsGuest={handleSkipAllToExplore}
          onGooglePopupStarted={(active) => {
            isInteractiveSignInRef.current = active;
          }}
          onReviewIntro={() => openReplayRoute('intro')}
          onReviewTour={() => openReplayRoute('tour')}
        />
      ) : null}

      {(hasEnteredWorkspace || !isSubScreenActive) && (
        <main
          ref={mainRef}
          data-fullscreen-shell={
            isFullScreenView ? 'true' : undefined
          }
          style={
            isFullScreenView
              ? {
                  height: 'var(--app-vh, 100dvh)',
                  background: 'var(--theme-bg-gradient)',
                }
              : undefined
          }
          className={
            isSubScreenActive
              ? 'hidden'
              : isFullScreenView
              ? 'fixed top-0 left-0 z-40 w-full flex flex-col overflow-hidden min-h-0 px-1.5'
              : 'relative z-10 flex-1 overflow-hidden overflow-clip min-h-0 flex flex-col w-full max-w-5xl mx-auto px-2'
          }
        >
          {isFullScreenView && (
            <FullScreenTopBar
              selectedLanguage={selectedLanguage}
              onBack={handleFullScreenBack}
              onHome={() => handlePanelNavigate('home')}
            />
          )}
          {/* Dedicated Deep Conversation View (Part 7 — context-locked specialist conversation; Back preserves ExplanationView) */}
          {currentDeepConversation && (
            <DeepConversationScreen
              key={`${currentDeepConversation.context.landmark.id}::${currentDeepConversation.context.selectedExploreTopic?.id || 'general'}`}
              context={currentDeepConversation.context}
              selectedLanguage={selectedLanguage}
              guideSettings={guideSettings}
              onUpdateSpeechRate={handleUpdateSpeechRate}
              outputMode={outputMode}
              messages={
                deepConversationThreads[
                  `${currentDeepConversation.context.landmark.id}::${currentDeepConversation.context.selectedExploreTopic?.id || 'general'}`
                ] || []
              }
              onUpdateMessages={(nextMessages) => {
                const threadKey = `${currentDeepConversation.context.landmark.id}::${currentDeepConversation.context.selectedExploreTopic?.id || 'general'}`;
                setDeepConversationThreads((prev) => ({
                  ...prev,
                  [threadKey]: nextMessages,
                }));
              }}
              onBack={goBackScreen}
            />
          )}

          {/* Keep-alive Place Explanation Views in screenStack (preserve Detail by Detail, Explore More, enrichments & scroll) */}
          {explanationEntries.map((entry) => {
            const isTopExplanation = entry.index === screenStack.length - 1;
            const explLandmark = entry.route.landmark;
            return (
              <div
                key={`expl-${entry.index}-${entry.route.originTab}-${explLandmark.id}`}
                className={
                  !isSubScreenActive && isTopExplanation
                    ? 'h-full flex flex-col min-h-0 flex-1'
                    : 'hidden'
                }
              >
                <ExplanationView
                  isActive={!isSubScreenActive && isTopExplanation}
                  landmark={explLandmark}
                  selectedLanguage={selectedLanguage}
                  onBack={goBackScreen}
                  onOpenChatWithQuestion={handleOpenChatWithQuestion}
                  onOpenLanguageModal={() => setIsLanguageModalOpen(true)}
                  outputMode={outputMode}
                  onToggleOutputMode={handleToggleOutputMode}
                  guideSettings={guideSettings}
                  onUpdateSpeechRate={handleUpdateSpeechRate}
                  onOpenRelatedDiscovery={handleOpenRelatedDiscovery}
                  onOpenDeepConversation={(ctx) => openDeepConversationRoute(ctx)}
                  preservedUiState={explanationUiStateById[explLandmark.id]}
                  onUiStateChange={handleExplanationUiStateChange}
                  onSaveToHistory={handleSaveLandmarkToJournal}
                  isSavedInHistory={visitedHistory.some(
                    (h) =>
                      h.journalId === explLandmark.id ||
                      h.id === explLandmark.id ||
                      (h.placeId && explLandmark.placeId && h.placeId === explLandmark.placeId) ||
                      h.title.toLowerCase() === explLandmark.title.toLowerCase()
                  )}
                />
              </div>
            );
          })}

          {/* Keep-alive Tab Views (preserve scroll, loaded places, search queries, filters & Leaflet zoom) */}
          {visitedTabs.has('home') && (
            <div
              className={
                !hasDetailOverlay && activeTab === 'home'
                  ? 'h-full flex flex-col min-h-0 flex-1'
                  : 'hidden'
              }
            >
              <HomeScreen
                isActive={!isSubScreenActive && !hasDetailOverlay && activeTab === 'home'}
                setActiveTab={(tab) => navigateToTab(tab)}
                selectedLanguage={selectedLanguage}
                onSelectSampleLandmark={(landmark) => openExplanationRoute(landmark, 'home')}
                locationCoords={locationCoords}
                deviceExactLocation={deviceExactLocation}
                gpsStatus={gpsStatus}
                gpsError={gpsError}
                isManualLocationMode={isManualLocationMode}
                visitedHistory={visitedHistory}
                onClearMemory={handleClearMemory}
                onRefreshLocation={refreshDeviceLocation}
                onOpenCityGuide={(city) => handleOpenCityGuide(city)}
                userProfile={userProfile}
                onReplayIntro={() => openReplayRoute('intro')}
                onReplayTour={() => openReplayRoute('tour')}
                onOpenLoginSetup={() => openReplayRoute('login')}
              />
            </div>
          )}

          {visitedTabs.has('camera') && (
            <div
              className={
                !hasDetailOverlay && activeTab === 'camera'
                  ? 'h-full flex flex-col min-h-0 flex-1'
                  : 'hidden'
              }
            >
              <CameraScreen
                isActive={!isSubScreenActive && !hasDetailOverlay && activeTab === 'camera'}
                onScanComplete={handleScanComplete}
                locationCoords={locationCoords}
                selectedLanguage={selectedLanguage}
                visitedHistory={visitedHistory}
                onBackToHome={goBackScreen}
                outputMode={outputMode}
                onToggleOutputMode={handleToggleOutputMode}
                guideSettings={guideSettings}
                onUpdateSpeechRate={handleUpdateSpeechRate}
                onOpenChatWithQuestion={handleOpenChatWithQuestion}
                onOpenUnifiedExplanation={(landmark) => openExplanationRoute(landmark, 'camera')}
              />
            </div>
          )}

          {visitedTabs.has('discover') && (
            <div
              className={
                !hasDetailOverlay && activeTab === 'discover'
                  ? 'h-full flex flex-col min-h-0 flex-1'
                  : 'hidden'
              }
            >
              <DiscoverScreen
                isActive={!isSubScreenActive && !hasDetailOverlay && activeTab === 'discover'}
                selectedLanguage={selectedLanguage}
                guideSettings={guideSettings}
                locationCoords={locationCoords}
                onSelectResultToView={(landmark) => openExplanationRoute(landmark, 'discover')}
                onBackToHome={goBackScreen}
              />
            </div>
          )}

          {visitedTabs.has('chat') && (
            <div
              className={
                !hasDetailOverlay && activeTab === 'chat'
                  ? 'h-full flex flex-col min-h-0 flex-1'
                  : 'hidden'
              }
            >
              <AIChatScreen
                isActive={!isSubScreenActive && !hasDetailOverlay && activeTab === 'chat'}
                initialQuestion={chatQuestion}
                onInitialQuestionConsumed={() => setChatQuestion(undefined)}
                landmarkContext={chatLandmarkContext || currentExplanation}
                selectedLanguage={selectedLanguage}
                visitedHistory={visitedHistory}
                guideSettings={guideSettings}
                onUpdateSpeechRate={handleUpdateSpeechRate}
                onBackToHome={goBackScreen}
                onSaveToJournal={handleSaveFromAiGuide}
                defaultCity={deviceExactLocation?.city || locationCoords?.city || ''}
                defaultCountry={deviceExactLocation?.country || locationCoords?.country || 'India'}
                isLandmarkSaved={Boolean(
                  (chatLandmarkContext || currentExplanation) &&
                    visitedHistory.some(
                      (h) =>
                        h.title.toLowerCase() ===
                        (chatLandmarkContext || currentExplanation)!.title.toLowerCase()
                    )
                )}
                persistedMessages={chatMessages}
                onMessagesChange={setChatMessages}
                ownerId={
                  userProfile?.authMethod === 'google' &&
                  userProfile.uid &&
                  auth.currentUser?.uid === userProfile.uid
                    ? userProfile.uid
                    : 'guest'
                }
              />
            </div>
          )}

          {visitedTabs.has('map') && (
            <div
              className={
                !hasDetailOverlay && activeTab === 'map'
                  ? 'h-full flex flex-col min-h-0 flex-1'
                  : 'hidden'
              }
            >
              <MapView
                isActive={!isSubScreenActive && !hasDetailOverlay && activeTab === 'map'}
                selectedLanguage={selectedLanguage}
                locationCoords={locationCoords}
                deviceExactLocation={deviceExactLocation}
                gpsStatus={gpsStatus}
                gpsError={gpsError}
                onRefreshDeviceLocation={refreshDeviceLocation}
                onOpenCitySelector={() => navigateToTab('city')}
                isManualLocationMode={isManualLocationMode}
                onBackToHome={goBackScreen}
                onSelectLandmarkToScan={(landmark) => openExplanationRoute(landmark, 'map')}
              />
            </div>
          )}

          {visitedTabs.has('history') && (
            <div
              className={
                !hasDetailOverlay && activeTab === 'history'
                  ? 'h-full flex flex-col min-h-0 flex-1'
                  : 'hidden'
              }
            >
              <HistoryScreen
                isActive={!isSubScreenActive && !hasDetailOverlay && activeTab === 'history'}
                visitedHistory={visitedHistory}
                selectedLanguage={selectedLanguage}
                guideSettings={guideSettings}
                onUpdateSpeechRate={handleUpdateSpeechRate}
                onBackToHome={goBackScreen}
                onSelectLandmarkToView={(landmark) => openExplanationRoute(landmark, 'history')}
                onClearHistory={handleClearMemory}
                isAuthenticatedCloud={Boolean(auth.currentUser?.uid && userProfile?.authMethod === 'google')}
                accountOwnerName={userProfile?.name}
                isLoadingJournal={isLoadingJournal}
                journalFromCache={journalFromCache}
                journalError={journalError}
                onRetryLoadJournal={() => loadJournalForSession(auth.currentUser?.uid || null)}
                onAddJournalEntry={async (entry) => {
                  await createJournalRecord(entry);
                }}
                onUpdateJournalEntry={updateJournalRecord}
                onDeleteJournalEntry={deleteJournalRecord}
                defaultCity={deviceExactLocation?.city || locationCoords?.city || ''}
                defaultCountry={deviceExactLocation?.country || locationCoords?.country || 'India'}
              />
            </div>
          )}

          {visitedTabs.has('city') && (
            <div
              className={
                !hasDetailOverlay && activeTab === 'city'
                  ? 'h-full flex flex-col min-h-0 flex-1'
                  : 'hidden'
              }
            >
              <CityExplorerScreen
                isActive={!isSubScreenActive && !hasDetailOverlay && activeTab === 'city'}
                currentCity={deviceExactLocation?.city || locationCoords?.city || ''}
                currentCountry={deviceExactLocation?.country || locationCoords?.country || ''}
                currentLocationName={
                  deviceExactLocation?.locationName || locationCoords?.city || 'Select a destination or enable GPS'
                }
                isManualLocationMode={isManualLocationMode}
                onSetLocationMode={handleSetLocationMode}
                onSelectCity={handleSelectCityManually}
                selectedLanguage={selectedLanguage}
                onOpenCityGuideModal={(city, state, country) => handleOpenCityGuide(city, state, country)}
                onProceedToNearby={() => navigateToTab('nearby')}
                onProceedToMap={() => navigateToTab('map')}
                onProceedToCamera={() => navigateToTab('camera')}
                onBackToHome={goBackScreen}
                deviceExactLocation={deviceExactLocation}
                gpsStatus={gpsStatus}
                gpsError={gpsError}
                onRefreshGpsLocation={refreshDeviceLocation}
              />
            </div>
          )}

          {visitedTabs.has('settings') && (
            <div
              className={
                !hasDetailOverlay && activeTab === 'settings'
                  ? 'h-full flex flex-col min-h-0 flex-1'
                  : 'hidden'
              }
            >
              <GuideSettingsScreen
                isActive={!isSubScreenActive && !hasDetailOverlay && activeTab === 'settings'}
                settings={guideSettings}
                onUpdateSettings={handleUpdateSettings}
                selectedLanguage={selectedLanguage}
                onSelectLanguage={handleSelectLanguage}
                outputMode={outputMode}
                onToggleOutputMode={handleToggleOutputMode}
                isManualLocationMode={isManualLocationMode}
                locationPref={locationPref}
                onSetLocationMode={handleSetLocationMode}
                onSelectCityManually={handleSelectCityManually}
                deviceExactLocation={deviceExactLocation}
                locationCoords={locationCoords}
                gpsStatus={gpsStatus}
                gpsError={gpsError}
                onRefreshGpsLocation={refreshDeviceLocation}
                currentTheme={currentTheme}
                onSelectTheme={handleSelectTheme}
                userProfile={userProfile}
                onUpdateProfile={handleUpdateProfileInSettings}
                isCloudSynced={userProfile?.authMethod === 'google'}
                onSignInWithGoogle={handleSignInWithGoogleFromSettings}
                onSwitchAccountLogin={() => openReplayRoute('login')}
                onLogoutAndResetOnboarding={handleLogoutAndResetOnboarding}
                onReplayIntro={() => openReplayRoute('intro')}
                onReplayTour={() => openReplayRoute('tour')}
                onBackToHome={goBackScreen}
                visitedCount={visitedHistory.length}
              />
            </div>
          )}

          {visitedTabs.has('nearby') && (
            <div
              className={
                !hasDetailOverlay && activeTab === 'nearby'
                  ? 'h-full flex flex-col min-h-0 flex-1'
                  : 'hidden'
              }
            >
              <NearbyAttractionsScreen
                isActive={!isSubScreenActive && !hasDetailOverlay && activeTab === 'nearby'}
                locationCoords={locationCoords}
                deviceExactLocation={deviceExactLocation}
                gpsStatus={gpsStatus}
                gpsError={gpsError}
                isManualLocationMode={isManualLocationMode}
                onRefreshDeviceLocation={refreshDeviceLocation}
                onOpenCitySelector={() => navigateToTab('city')}
                selectedLanguage={selectedLanguage}
                onSelectAttractionForGuide={(attraction) => {
                  handleOpenChatWithQuestion(
                    `Give me a detailed tour guide speech on ${attraction.title} in ${attraction.city}. Why is it significant?`
                  );
                }}
                onOpenChatWithQuestion={handleOpenChatWithQuestion}
                onNavigateToPhotoGuide={() => navigateToTab('camera')}
                onOpenCityGuide={(city) => handleOpenCityGuide(city)}
                onBackToHome={goBackScreen}
                guideSettings={guideSettings}
                onUpdateSpeechRate={handleUpdateSpeechRate}
                outputMode={outputMode}
              />
            </div>
          )}
        </main>
      )}

      {/* Two-Tier City Guide Modal (Brief Overview + In-Depth Guide) */}
      <CityGuideModal
        isOpen={isCityGuideModalOpen}
        onClose={() => setIsCityGuideModalOpen(false)}
        cityName={activeCityGuideTarget}
        stateName={activeStateGuideTarget}
        countryName={activeCountryGuideTarget}
        selectedLanguage={selectedLanguage}
        guideSettings={guideSettings}
        onUpdateSpeechRate={handleUpdateSpeechRate}
        onProceedToNearby={() => {
          replaceReplayRoute('none');
          navigateToTab('nearby');
        }}
      />

      {/* Subtle Sync / Onboarding Confirmation Banner */}
      {statusToast && (
        <div
          role="status"
          style={{
            backgroundColor: 'var(--theme-header-bg)',
            borderColor: 'var(--theme-accent-secondary)',
            color: 'var(--theme-text-title)',
          }}
          className="fixed bottom-16 sm:bottom-6 left-1/2 -translate-x-1/2 z-50 px-4 py-2 rounded-xl border shadow-2xl text-xs font-semibold backdrop-blur-xl pointer-events-none"
        >
          {statusToast}
        </div>
      )}

      {/* Language Selection Modal (accessible from Intro, Login, and Main App) */}
      <LanguageSelectionModal
        isOpen={isLanguageModalOpen}
        onClose={() => setIsLanguageModalOpen(false)}
        selectedLanguage={selectedLanguage}
        onSelectLanguage={handleSelectLanguage}
        speechRate={guideSettings.speechRate}
      />
    </div>
  );
}
