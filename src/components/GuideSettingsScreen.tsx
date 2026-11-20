import React, { useState, useEffect } from 'react';
import {
  Sliders,
  MapPin,
  Compass,
  Navigation as NavIcon,
  Globe,
  Languages,
  Volume2,
  VolumeX,
  Play,
  CheckCircle2,
  Sparkles,
  Layers,
  Square,
  FileText,
  Headphones,
  BookOpen,
  Zap,
  Landmark,
  Crown,
  DraftingCompass,
  Flame,
  Utensils,
  TrendingUp,
  TreePine,
  Camera,
  Key,
  RefreshCw,
  Search,
  Check,
  HardDrive,
  Database,
  Trash2,
  Image as ImageIcon,
  Folder,
  ShieldCheck,
  AlertCircle,
  User,
  Mail,
  LogOut,
  RotateCcw,
  Cloud,
  Palette,
  Edit3,
  LifeBuoy,
  ChevronRight
} from 'lucide-react';
import { BackButton } from './BackButton';
import { HelpSupportSection } from './HelpSupportSection';
import {
  LocationCascadingSelector,
  AppliedManualLocationPayload,
} from './LocationCascadingSelector';
import { useBackLayer, usePreservedScroll } from '../utils/navigationHistory';
import { useLocalizedTexts } from '../data/localizedStrings';
import {
  GuideSettings,
  SpeechTopicPreferences,
  GuidePersona,
  Language,
  GuideOutputMode,
  LocationCoords,
  ThemePreset,
  THEME_PRESETS,
  TravelerType,
  UserProfile,
  SavedLocationPreference,
  GpsLocationStatus,
} from '../types';
import { SUPPORTED_LANGUAGES } from '../data/languages';
import { findCountryByNameOrCode } from '../data/isoCountries';
import { speechManager } from '../utils/speech';
import { AudioSpeedSettingsControl } from './AudioSpeedControl';
import { DeviceExactLocation } from '../utils/geolocation';
import { TRAVELER_TYPE_PRESETS, getPresetForTravelerType } from '../utils/userPersistence';
import {
  getSavedPhotosFromAppStorage,
  deletePhotoFromAppStorage,
  clearAllSavedPhotosFromAppStorage,
  getAppStorageStats,
  SavedPhotoRecord
} from '../utils/photoStorage';

interface SettingsScreenProps {
  isActive?: boolean;
  settings: GuideSettings;
  onUpdateSettings: (newSettings: GuideSettings) => void;
  selectedLanguage: Language;
  onSelectLanguage: (lang: Language) => void;
  outputMode: GuideOutputMode;
  onToggleOutputMode: (mode: GuideOutputMode) => void;
  isManualLocationMode: boolean;
  locationPref?: SavedLocationPreference;
  onSetLocationMode: (mode: 'gps' | 'manual') => void;
  onSelectCityManually: (cityData: {
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
  }) => void;
  deviceExactLocation?: DeviceExactLocation | null;
  locationCoords: LocationCoords | null;
  gpsStatus?: GpsLocationStatus;
  gpsError?: string | null;
  onRefreshGpsLocation?: () => Promise<void>;
  currentTheme?: ThemePreset;
  onSelectTheme?: (theme: ThemePreset) => void;
  userProfile?: UserProfile | null;
  onUpdateProfile?: (profile: UserProfile, applyPresetTopics?: boolean) => void;
  isCloudSynced?: boolean;
  onSignInWithGoogle?: () => Promise<{ restored?: boolean; error?: string }>;
  onSwitchAccountLogin?: () => void;
  onLogoutAndResetOnboarding?: () => void;
  onReplayIntro?: () => void;
  onReplayTour?: () => void;
  onBackToHome?: () => void;
  visitedCount?: number;
}

interface TopicConfigItem {
  key: keyof SpeechTopicPreferences;
  title: string;
  category: string;
  icon: React.ReactNode;
  description: string;
  exampleSnippet: string;
}

const TOPIC_CONFIGS: TopicConfigItem[] = [
  {
    key: 'historical',
    title: 'Historical Background & Origins',
    category: 'History',
    icon: <Landmark className="w-4 h-4 text-amber-500" />,
    description: 'Founding dates, dynasties, patrons, architectural eras, and archaeological rediscovery.',
    exampleSnippet: '"Commissioned in the 17th century by Nayak rulers..."',
  },
  {
    key: 'geographical',
    title: 'Geographical Setting & Terrain',
    category: 'Geography',
    icon: <Globe className="w-4 h-4 text-blue-400" />,
    description: 'Orientation, sacred river basins, altitude, and strategic passes.',
    exampleSnippet: '"Perched along the southern bank of the Vaigai River..."',
  },
  {
    key: 'political',
    title: 'Political Significance & Empires',
    category: 'Politics',
    icon: <Crown className="w-4 h-4 text-purple-400" />,
    description: 'Imperial capitals, royal treaties, power struggles, and sovereign decrees.',
    exampleSnippet: '"Served as the seat of royal authority during the Pandyan dynasty..."',
  },
  {
    key: 'architectural',
    title: 'Architectural Engineering & Style',
    category: 'Engineering',
    icon: <DraftingCompass className="w-4 h-4 text-emerald-400" />,
    description: 'Dravidian Gopurams, interlocking stone masonry, acoustic pillars, and symmetry.',
    exampleSnippet: '"Features 14 towering gateway towers with thousands of painted stone figures..."',
  },
  {
    key: 'culturalMythology',
    title: 'Cultural, Sacred & Mythological Legends',
    category: 'Culture',
    icon: <Flame className="w-4 h-4 text-orange-400" />,
    description: 'Sacred symbolism, divine weddings, celestial festivals, and folklore.',
    exampleSnippet: '"Celebrates the divine celestial wedding of Goddess Meenakshi and Lord Sundareswarar..."',
  },
  {
    key: 'culinary',
    title: 'Local Gastronomy & Food Heritage',
    category: 'Gastronomy',
    icon: <Utensils className="w-4 h-4 text-rose-400" />,
    description: 'Authentic royal recipes, street food roots, signature sweets and drinks.',
    exampleSnippet: '"Famous for Jigarthanda, Kari Dosa, and aromatic filter coffee..."',
  },
  {
    key: 'economic',
    title: 'Trade Routes & Modern Day Impact',
    category: 'Economy',
    icon: <TrendingUp className="w-4 h-4 text-teal-400" />,
    description: 'Ancient spice trade routes, textile guilds, and modern cultural tourism.',
    exampleSnippet: '"Ancient maritime trade connected Madurai to Rome and Greece..."',
  },
  {
    key: 'ecological',
    title: 'Ecology, Sacred Flora & Fauna',
    category: 'Nature',
    icon: <TreePine className="w-4 h-4 text-green-400" />,
    description: 'Sacred temple trees (Sthala Vriksham), garden flora, and water tanks.',
    exampleSnippet: '"The sacred Golden Lotus Pond (Potramarai Kulam) provides natural microclimate cooling..."',
  },
  {
    key: 'photography',
    title: 'Photography & Hidden Vantage Spots',
    category: 'Visual',
    icon: <Camera className="w-4 h-4 text-indigo-400" />,
    description: 'Golden hour angles, corridor perspective lines, and uncrowded spots.',
    exampleSnippet: '"Visit the Thousand Pillar Hall at 8 AM for golden morning light filtering through sculptures..."',
  },
  {
    key: 'mysteries',
    title: 'Curiosities & Architectural Riddles',
    category: 'Mysteries',
    icon: <Key className="w-4 h-4 text-amber-300" />,
    description: 'Musical musical stone pillars, acoustic optical illusions, and hidden corridors.',
    exampleSnippet: '"Five musical stone pillars carve different acoustic musical notes when tapped..."',
  },
];

const PERSONAS: Array<{ id: GuidePersona; title: string; subtitle: string; icon: React.ReactNode }> = [
  {
    id: 'warm_female',
    title: 'Warm Storyteller (Default)',
    subtitle: 'Enthusiastic, welcoming, vivid pacing with local conversational charm.',
    icon: <Sparkles className="w-4 h-4 text-amber-400" />,
  },
  {
    id: 'scholarly',
    title: 'Scholarly Historian',
    subtitle: 'Chronological dates, architectural terminology, and archival depth.',
    icon: <BookOpen className="w-4 h-4 text-blue-400" />,
  },
  {
    id: 'adventurous',
    title: 'Adventurous Explorer',
    subtitle: 'Dramatic tension, folklore legends, and atmospheric excitement.',
    icon: <Compass className="w-4 h-4 text-emerald-400" />,
  },
  {
    id: 'concise',
    title: 'Concise Fast-Track',
    subtitle: 'Crisp bulleted highlights tailored for rapid walking tours.',
    icon: <Zap className="w-4 h-4 text-rose-400" />,
  },
];

const QUICK_POPULAR_DESTINATIONS = [
  { country: 'India', state: 'Tamil Nadu', city: 'Madurai', lat: 9.9195, lng: 78.1193, flag: '🇮🇳' },
  { country: 'India', state: 'Maharashtra', city: 'Nagpur', lat: 21.1458, lng: 79.0882, flag: '🇮🇳' },
  { country: 'India', state: 'Maharashtra', city: 'Mumbai', lat: 18.9220, lng: 72.8347, flag: '🇮🇳' },
  { country: 'India', state: 'Rajasthan', city: 'Jaipur', lat: 26.9124, lng: 75.7873, flag: '🇮🇳' },
  { country: 'India', state: 'Uttar Pradesh', city: 'Varanasi', lat: 25.3176, lng: 82.9739, flag: '🇮🇳' },
  { country: 'India', state: 'Uttar Pradesh', city: 'Agra', lat: 27.1767, lng: 78.0081, flag: '🇮🇳' },
  { country: 'India', state: 'Delhi NCR', city: 'New Delhi', lat: 28.6139, lng: 77.2090, flag: '🇮🇳' },
  { country: 'France', state: 'Île-de-France', city: 'Paris', lat: 48.8566, lng: 2.3522, flag: '🇫🇷' },
  { country: 'Japan', state: 'Kantō', city: 'Tokyo', lat: 35.6762, lng: 139.6503, flag: '🇯🇵' },
  { country: 'Japan', state: 'Kansai', city: 'Kyoto', lat: 35.0116, lng: 135.7681, flag: '🇯🇵' },
  { country: 'United Kingdom', state: 'England', city: 'London', lat: 51.5074, lng: -0.1278, flag: '🇬🇧' },
  { country: 'Italy', state: 'Lazio', city: 'Rome', lat: 41.9028, lng: 12.4964, flag: '🇮🇹' },
];

export const GuideSettingsScreen: React.FC<SettingsScreenProps> = ({
  isActive = true,
  settings,
  onUpdateSettings,
  selectedLanguage,
  onSelectLanguage,
  outputMode,
  onToggleOutputMode,
  isManualLocationMode,
  locationPref,
  onSetLocationMode,
  onSelectCityManually,
  deviceExactLocation,
  locationCoords,
  gpsStatus = 'idle',
  gpsError = null,
  onRefreshGpsLocation,
  currentTheme = 'celestial',
  onSelectTheme,
  userProfile,
  onUpdateProfile,
  isCloudSynced = false,
  onSignInWithGoogle,
  onSwitchAccountLogin,
  onLogoutAndResetOnboarding,
  onReplayIntro,
  onReplayTour,
  onBackToHome,
  visitedCount = 0,
}) => {
  // Sub-tab selection including synced Explorer Profile & Onboarding
  const [activeSection, setActiveSection] = useState<'profile' | 'location' | 'language' | 'output' | 'voice'>('profile');
  const [isRefreshingGps, setIsRefreshingGps] = useState(false);
  const [isPlayingTestVoice, setIsPlayingTestVoice] = useState(false);

  // Profile inline editing state
  const [isEditingProfile, setIsEditingProfile] = useState(false);
  const [editName, setEditName] = useState(userProfile?.name || '');
  const [editEmail, setEditEmail] = useState(userProfile?.email || '');
  const [editTravelerType, setEditTravelerType] = useState<TravelerType>(
    userProfile?.travelerType || 'casual_tourist'
  );
  const [applyTopicsPresetOnSave, setApplyTopicsPresetOnSave] = useState(false);
  const [profileFormError, setProfileFormError] = useState<string | null>(null);
  const [profileStatusMessage, setProfileStatusMessage] = useState<string | null>(null);
  const [isGoogleLinking, setIsGoogleLinking] = useState(false);
  const [isConfirmingLogout, setIsConfirmingLogout] = useState(false);

  useEffect(() => {
    setEditName(userProfile?.name || '');
    setEditEmail(userProfile?.email || '');
    setEditTravelerType(userProfile?.travelerType || 'casual_tourist');
  }, [userProfile?.name, userProfile?.email, userProfile?.travelerType]);

  // Phone Memory Storage Management
  const [savedPhotosList, setSavedPhotosList] = useState<SavedPhotoRecord[]>([]);
  const [storageStats, setStorageStats] = useState<{ count: number; totalSizeBytes: number; formattedSize: string }>({
    count: 0,
    totalSizeBytes: 0,
    formattedSize: '0 KB',
  });
  const [isConfirmingClear, setIsConfirmingClear] = useState(false);
  const [showHelpSupport, setShowHelpSupport] = useState(false);
  const { t: helpEntryT } = useLocalizedTexts(
    {
      helpSupportTitle: 'Help & Support',
      helpSupportSubtitle: 'Help us make Charaiva better.',
      helpSupportCta: 'Help & Feedback',
    },
    selectedLanguage,
    'Settings Help & Support entry card'
  );
  const contentScrollRef = usePreservedScroll<HTMLDivElement>(
    `settings:${showHelpSupport ? 'help' : activeSection}`,
    isActive
  );

  useEffect(() => {
    if (!isActive) {
      speechManager.stop();
      setIsPlayingTestVoice(false);
    }
  }, [isActive]);

  useBackLayer(
    'settings-help-support',
    isActive && showHelpSupport,
    () => setShowHelpSupport(false),
    45
  );
  useBackLayer(
    'settings-edit-profile',
    isActive && isEditingProfile,
    () => setIsEditingProfile(false),
    40
  );
  useBackLayer(
    'settings-confirm-logout',
    isActive && isConfirmingLogout,
    () => setIsConfirmingLogout(false),
    50
  );
  useBackLayer(
    'settings-confirm-clear',
    isActive && isConfirmingClear,
    () => setIsConfirmingClear(false),
    50
  );

  // Refresh saved photos data from IndexedDB
  const refreshStorageData = async () => {
    try {
      const [photos, stats] = await Promise.all([
        getSavedPhotosFromAppStorage(),
        getAppStorageStats(),
      ]);
      setSavedPhotosList(photos);
      setStorageStats(stats);
    } catch (e) {
      console.warn('Could not load storage stats:', e);
    }
  };

  useEffect(() => {
    refreshStorageData();
  }, [activeSection]);

  const { t: locUi } = useLocalizedTexts(
    {
      sectionTitle: 'Location Detection Mode',
      manualActiveBadge: 'Manual Mode Active',
      gpsActiveBadge: 'Automatic GPS Active',
      optionATitle: 'Automatic GPS Location',
      optionADesc: 'Detects real device GPS coordinates & discovers verified sights around you.',
      optionBTitle: 'Manual Place Selection',
      optionBDesc: 'Choose any country, state/region, city, town, or village worldwide.',
      activeDestLabel: 'Active Destination:',
      notSelectedGps: 'Not acquired yet — enable GPS or switch to Manual Place Selection',
      notSelectedManual: 'No destination chosen yet — search a place below',
      refreshGps: 'Refresh GPS',
      retryGps: 'Retry GPS',
      scanningGps: 'Locating GPS...',
      switchManualCta: 'Switch to Manual Place Selection',
      gpsModeTitle: 'Automatic GPS Location is Active',
      gpsModeDesc:
        'Charaiva uses your device GPS and reverse geocoding to identify your live location and nearby heritage spots.',
      gpsCoordsUnavailable: 'GPS coordinates not acquired yet.',
      manualSavedToast: 'Destination updated to',
      unverifiedCustomNote:
        'Saved custom place name without exact map coordinates. AI Guide, Discover, City Guide & Photo Guide work normally; Near Me & Map require verified coordinates.',
      popularHeading: 'Popular Destinations (1-Tap Explore)',
    },
    selectedLanguage,
    'Settings Location Preferences labels and GPS/manual status messages'
  );
  const [locationSavedFeedback, setLocationSavedFeedback] = useState<string | null>(null);

  const handleApplyWorldwideLocation = (payload: AppliedManualLocationPayload) => {
    onSelectCityManually(payload);
    setLocationSavedFeedback(`${locUi.manualSavedToast} ${payload.locationName}`);
  };

  // Handle GPS Refresh
  const handleRefreshGps = async () => {
    if (onRefreshGpsLocation) {
      setIsRefreshingGps(true);
      try {
        await onRefreshGpsLocation();
      } finally {
        setIsRefreshingGps(false);
      }
    }
  };

  // Toggle individual speech topic
  const handleToggleTopic = (topicKey: keyof SpeechTopicPreferences) => {
    const updatedTopics = {
      ...settings.topics,
      [topicKey]: !settings.topics[topicKey],
    };
    onUpdateSettings({
      ...settings,
      topics: updatedTopics,
    });
  };

  // Test voice sample
  const handleTestVoiceSample = () => {
    if (isPlayingTestVoice) {
      speechManager.stop();
      setIsPlayingTestVoice(false);
      return;
    }

    const isMale = settings.voiceGender === 'male';
    const sampleTexts: Record<string, string> = {
      en: "Hello traveler! I am your personal live guide. I'm ready to accompany you through every monument and historic sight with vivid stories.",
      hi: isMale
        ? "नमस्ते! मैं आपका पर्सनल टूर गाइड हूँ। मैं आपके साथ हर ऐतिहासिक स्मारक, मंदिर और अद्भुत स्थानों की रोचक कहानियाँ साझा करने के लिए तैयार हूँ।"
        : "नमस्ते! मैं आपकी पर्सनल टूर गाइड हूँ। मैं आपके साथ हर ऐतिहासिक स्मारक, मंदिर और अद्भुत स्थानों की रोचक कहानियाँ साझा करने के लिए तैयार हूँ।",
      ta: "வணக்கம்! நான் உங்கள் நேரடி பயண வழிகாட்டி. வரலாற்றுச் சிறப்புமிக்க இடங்களின் ஆழமான கதைகளை உங்களுக்கு விவரிக்கத் தயாராக உள்ளேன்.",
      te: "నమస్కారం! నేను మీ పర్యటన మార్గదర్శిని. చారిత్రక కట్టడాల విశేషాలను మీకు వివరించడానికి సిద్ధంగా ఉన్నాను.",
      kn: "ನಮಸ್ಕಾರ! ನಾನು ನಿಮ್ಮ ಪ್ರವಾಸ ಮಾರ್ಗದರ್ಶಿ. ಐತಿಹಾಸಿಕ ಸ್ಥಳಗಳ ವಿವರಗಳನ್ನು ನಿಮಗೆ ತಿಳಿಸಲು ಸಿದ್ಧನಾಗಿದ್ದೇನೆ.",
      bn: "নমস্কার! আমি আপনার ব্যক্তিগত ট্যুর গাইড। ঐতিহাসিক স্মৃতিসৌধ ও দর্শনীয় স্থানের গল্প আপনাদের সাথে ভাগ করে নিতে প্রস্তুত।",
      mr: isMale
        ? "नमस्कार! मी तुमचा वैयक्तिक टूर मार्गदर्शक आहे. ऐतिहासिक वास्तू आणि प्रेक्षणीय स्थळांची माहिती देण्यासाठी मी सज्ज आहे."
        : "नमस्कार! मी तुमची वैयक्तिक टूर मार्गदर्शक आहे. ऐतिहासिक वास्तू आणि प्रेक्षणीय स्थळांची माहिती देण्यासाठी मी सज्ज आहे.",
      gu: isMale
        ? "નમસ્તે! હું તમારો વ્યક્તિગત પ્રવાસ માર્ગદર્શક છું. ઐતિહાસિક સ્થળોની રોચક વાતો જણાવવા હું તૈયાર છું."
        : "નમસ્તે! હું તમારી વ્યક્તિગત પ્રવાસ માર્ગદર્શિકા છું. ઐતિહાસિક સ્થળોની રોચક વાતો જણાવવા હું તૈયાર છું.",
      ml: "നമസ്കാരം! ഞാൻ നിങ്ങളുടെ വ്യക്തിഗത ടൂർ ഗൈഡാണ്. ചരിത്രപ്രസിദ്ധമായ സ്ഥലങ്ങളുടെ വിശേഷങ്ങൾ പങ്കിടാൻ ഞാൻ തയ്യാറാണ്.",
      es: isMale
        ? "¡Hola viajero! Soy tu guía personal. Estoy listo para compartir contigo las historias más cautivadoras de cada lugar."
        : "¡Hola viajero! Soy tu guía personal. Estoy lista para compartir contigo las historias más cautivadoras de cada lugar.",
      fr: isMale
        ? "Bonjour voyageur ! Je suis votre guide personnel. Je suis prêt à vous révéler l'histoire fascinante de ce lieu."
        : "Bonjour voyageur ! Je suis votre guide personnelle. Je suis prête à vous révéler l'histoire fascinante de ce lieu.",
      de: isMale
        ? "Hallo Reisender! Ich bin Ihr persönlicher Reiseleiter. Ich freue mich darauf, Ihnen die reiche Geschichte zu erzählen."
        : "Hallo Reisender! Ich bin Ihre persönliche Reiseleiterin. Ich freue mich darauf, Ihnen die reiche Geschichte zu erzählen.",
      ja: "こんにちは！あなたの専属ツアーガイドです。歴史的な名所を丁寧にご案内いたします。",
    };

    const textToSpeak = sampleTexts[selectedLanguage.code] || sampleTexts['en'];

    setIsPlayingTestVoice(true);
    speechManager.speak({
      text: textToSpeak,
      language: selectedLanguage.name,
      languageCode: selectedLanguage.speechCode,
      gender: settings.voiceGender,
      pitch: settings.voicePitch,
      rate: settings.speechRate,
      onStart: () => setIsPlayingTestVoice(true),
      onEnd: () => setIsPlayingTestVoice(false),
      onError: () => setIsPlayingTestVoice(false),
    });
  };

  const selectedTopicCount = Object.values(settings.topics).filter(Boolean).length;

  return (
    <div
      id="settings-screen"
      dir={selectedLanguage.direction === 'rtl' ? 'rtl' : 'ltr'}
      className="flex flex-col h-full bg-transparent text-[var(--theme-text-title)] overflow-hidden overflow-clip select-none"
    >
      {/* Header with Clean Segmented Switcher */}
      <header
        style={{
          backgroundColor: 'var(--theme-card-bg-subtle)',
          borderColor: 'var(--theme-card-border)',
        }}
        className="px-3 py-2.5 border-b backdrop-blur-xl shrink-0"
      >
        <div className="flex items-center justify-between gap-2 mb-2">
          <div className="flex items-center gap-2">
            {onBackToHome && (
              <BackButton
                id="btn-settings-back-home"
                onClick={() => {
                  if (showHelpSupport) {
                    setShowHelpSupport(false);
                    return;
                  }
                  if (isEditingProfile) {
                    setIsEditingProfile(false);
                    return;
                  }
                  speechManager.stop();
                  setIsPlayingTestVoice(false);
                  onBackToHome();
                }}
                selectedLanguage={selectedLanguage}
              />
            )}
            <div
              style={{
                backgroundColor: 'var(--theme-card-bg)',
                borderColor: 'var(--theme-card-border)',
              }}
              className="w-8 h-8 rounded-xl border flex items-center justify-center text-[var(--theme-accent-primary)]"
            >
              <Sliders className="w-4 h-4 text-[var(--theme-accent-primary)]" />
            </div>
            <div>
              <h1 className="text-sm font-bold text-[var(--theme-text-title)] leading-tight">Settings & Preferences</h1>
              <p className="text-[10.5px] text-[var(--theme-text-muted)]">Location mode, language, voice output & storytelling</p>
            </div>
          </div>

          <div
            style={{
              backgroundColor: 'var(--theme-card-bg)',
              borderColor: 'var(--theme-card-border)',
              color: 'var(--theme-accent-secondary)',
            }}
            className="px-2.5 py-1 rounded-full border text-[10.5px] font-bold flex items-center gap-1.5 shadow-sm"
          >
            <span>{selectedLanguage.flag}</span>
            <span>{selectedLanguage.nativeName}</span>
            <span className="text-[var(--theme-accent-primary)]">·</span>
            <span className="capitalize">{outputMode}</span>
          </div>
        </div>

        {/* 5 Clean Settings Sub-tabs */}
        <div
          style={{
            backgroundColor: 'var(--theme-card-bg)',
            borderColor: 'var(--theme-card-border)',
          }}
          className="grid grid-cols-5 gap-1 p-1 rounded-xl border backdrop-blur-md"
        >
          <button
            id="tab-settings-profile"
            onClick={() => {
              setShowHelpSupport(false);
              setActiveSection('profile');
            }}
            style={
              !showHelpSupport && activeSection === 'profile'
                ? {
                    background: 'var(--theme-accent-primary-gradient)',
                    color: 'var(--theme-accent-primary-text)',
                  }
                : {
                    color: 'var(--theme-text-muted)',
                  }
            }
            className="py-1.5 px-1 rounded-lg text-center font-bold text-[11px] transition-all flex items-center justify-center gap-1 cursor-pointer min-h-[38px]"
          >
            <User className="w-3.5 h-3.5 shrink-0" />
            <span className="truncate">Profile</span>
          </button>

          <button
            id="tab-settings-location"
            onClick={() => {
              setShowHelpSupport(false);
              setActiveSection('location');
            }}
            style={
              !showHelpSupport && activeSection === 'location'
                ? {
                    background: 'var(--theme-accent-primary-gradient)',
                    color: 'var(--theme-accent-primary-text)',
                  }
                : {
                    color: 'var(--theme-text-muted)',
                  }
            }
            className="py-1.5 px-1 rounded-lg text-center font-bold text-[11px] transition-all flex items-center justify-center gap-1 cursor-pointer min-h-[38px]"
          >
            <MapPin className="w-3.5 h-3.5 shrink-0" />
            <span className="truncate">Location</span>
          </button>

          <button
            id="tab-settings-language"
            onClick={() => {
              setShowHelpSupport(false);
              setActiveSection('language');
            }}
            style={
              !showHelpSupport && activeSection === 'language'
                ? {
                    background: 'var(--theme-accent-primary-gradient)',
                    color: 'var(--theme-accent-primary-text)',
                  }
                : {
                    color: 'var(--theme-text-muted)',
                  }
            }
            className="py-1.5 px-1 rounded-lg text-center font-bold text-[11px] transition-all flex items-center justify-center gap-1 cursor-pointer min-h-[38px]"
          >
            <Languages className="w-3.5 h-3.5 shrink-0" />
            <span className="truncate">Language</span>
          </button>

          <button
            id="tab-settings-output"
            onClick={() => {
              setShowHelpSupport(false);
              setActiveSection('output');
            }}
            style={
              !showHelpSupport && activeSection === 'output'
                ? {
                    background: 'var(--theme-accent-primary-gradient)',
                    color: 'var(--theme-accent-primary-text)',
                  }
                : {
                    color: 'var(--theme-text-muted)',
                  }
            }
            className="py-1.5 px-1 rounded-lg text-center font-bold text-[11px] transition-all flex items-center justify-center gap-1 cursor-pointer min-h-[38px]"
          >
            <Volume2 className="w-3.5 h-3.5 shrink-0" />
            <span className="truncate">Output</span>
          </button>

          <button
            id="tab-settings-voice"
            onClick={() => {
              setShowHelpSupport(false);
              setActiveSection('voice');
            }}
            style={
              !showHelpSupport && activeSection === 'voice'
                ? {
                    background: 'var(--theme-accent-primary-gradient)',
                    color: 'var(--theme-accent-primary-text)',
                  }
                : {
                    color: 'var(--theme-text-muted)',
                  }
            }
            className="py-1.5 px-1 rounded-lg text-center font-bold text-[11px] transition-all flex items-center justify-center gap-1 cursor-pointer min-h-[38px]"
          >
            <Sparkles className="w-3.5 h-3.5 shrink-0" />
            <span className="truncate">Voice ({selectedTopicCount})</span>
          </button>
        </div>
      </header>

      {/* Main Settings Content Area */}
      <div ref={contentScrollRef} className="flex-1 min-h-0 overflow-y-auto p-3 space-y-3">
        {showHelpSupport ? (
          <HelpSupportSection
            selectedLanguage={selectedLanguage}
            userProfile={userProfile}
            onBack={() => setShowHelpSupport(false)}
          />
        ) : (
          <>
            {/* SECTION 0: EXPLORER PROFILE, THEME & ONBOARDING CONTROLS */}
            {activeSection === 'profile' && (
          <div className="space-y-3">
            {/* Explorer Identity & Sync Status Card */}
            <div
              style={{
                backgroundColor: 'var(--theme-card-bg)',
                borderColor: 'var(--theme-card-border)',
              }}
              className="p-4 rounded-2xl border shadow-lg space-y-3.5 backdrop-blur-md"
            >
              <div className="flex flex-wrap items-start justify-between gap-3">
                <div className="flex items-center gap-3 min-w-0">
                  <div
                    style={{
                      background: 'var(--theme-accent-primary-gradient)',
                      color: 'var(--theme-accent-primary-text)',
                    }}
                    className="w-11 h-11 rounded-2xl font-serif font-bold text-lg flex items-center justify-center shrink-0 shadow-md"
                  >
                    {(userProfile?.name || 'G').trim().charAt(0).toUpperCase()}
                  </div>
                  <div className="min-w-0">
                    <div className="flex items-center gap-2 flex-wrap">
                      <h2 className="text-sm font-serif font-bold text-[var(--theme-text-title)] truncate">
                        {userProfile?.name || 'Guest Explorer'}
                      </h2>
                      <span className="text-[10.5px] font-semibold text-[var(--theme-accent-secondary)]">
                        · {userProfile?.authMethod === 'google' || isCloudSynced ? 'Google Cloud Synced' : userProfile?.authMethod === 'local' ? 'Saved on Device' : 'Guest Session'}
                      </span>
                    </div>
                    <p className="text-xs text-[var(--theme-text-muted)] truncate">
                      {userProfile?.email && userProfile.email !== 'guest@charaiva.app'
                        ? userProfile.email
                        : 'No account email saved yet'}
                    </p>
                  </div>
                </div>

                <div className="flex items-center gap-2 shrink-0">
                  {onUpdateProfile && (
                    <button
                      id="btn-edit-profile"
                      type="button"
                      onClick={() => {
                        setIsEditingProfile((prev) => !prev);
                        setProfileFormError(null);
                        setProfileStatusMessage(null);
                      }}
                      style={{
                        backgroundColor: 'var(--theme-card-bg-subtle)',
                        borderColor: 'var(--theme-card-border)',
                        color: 'var(--theme-text-title)',
                      }}
                      className="min-h-[38px] px-3 rounded-xl border text-xs font-bold flex items-center gap-1.5 cursor-pointer hover:border-[var(--theme-card-border-glow)] whitespace-nowrap"
                    >
                      <Edit3 className="w-3.5 h-3.5 text-[var(--theme-accent-primary)]" />
                      <span>{isEditingProfile ? 'Cancel' : 'Edit Profile'}</span>
                    </button>
                  )}
                </div>
              </div>

              {profileStatusMessage && (
                <div className="p-2.5 rounded-xl border border-emerald-500/40 bg-emerald-500/10 text-emerald-300 text-xs flex items-center gap-2">
                  <CheckCircle2 className="w-4 h-4 shrink-0" />
                  <span>{profileStatusMessage}</span>
                </div>
              )}

              {isEditingProfile ? (
                <form
                  onSubmit={(e) => {
                    e.preventDefault();
                    const trimmedName = editName.trim();
                    const trimmedEmail = editEmail.trim();
                    const emailRegex = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;

                    if (!trimmedName || trimmedName.length < 2) {
                      setProfileFormError('Please enter an explorer name (at least 2 characters).');
                      return;
                    }
                    if (!trimmedEmail || !emailRegex.test(trimmedEmail)) {
                      setProfileFormError('Please enter a valid email address.');
                      return;
                    }
                    setProfileFormError(null);
                    onUpdateProfile?.(
                      {
                        uid: userProfile?.uid,
                        authMethod: userProfile?.authMethod === 'google' ? 'google' : 'local',
                        name: trimmedName,
                        email: trimmedEmail,
                        preferredLanguage: selectedLanguage.code,
                        travelerType: editTravelerType,
                        visitedCount: userProfile?.visitedCount ?? visitedCount,
                        createdAt: userProfile?.createdAt || new Date().toISOString(),
                        updatedAt: new Date().toISOString(),
                        badges: userProfile?.badges || [],
                      },
                      applyTopicsPresetOnSave
                    );
                    setIsEditingProfile(false);
                    setProfileStatusMessage('Explorer profile updated and synced to Settings.');
                  }}
                  className="space-y-3 pt-2 border-t border-[var(--theme-card-border)]"
                  noValidate
                >
                  {profileFormError && (
                    <div className="p-2.5 rounded-xl border border-rose-500/40 bg-rose-500/10 text-rose-200 text-xs flex items-center gap-2">
                      <AlertCircle className="w-4 h-4 text-rose-400 shrink-0" />
                      <span>{profileFormError}</span>
                    </div>
                  )}

                  <div className="grid grid-cols-1 sm:grid-cols-2 gap-2.5">
                    <div className="space-y-1">
                      <label className="text-[11px] font-bold text-[var(--theme-text-body)] flex items-center gap-1">
                        <User className="w-3 h-3 text-[var(--theme-accent-primary)]" />
                        <span>Name</span>
                      </label>
                      <input
                        type="text"
                        maxLength={80}
                        value={editName}
                        onChange={(e) => setEditName(e.target.value)}
                        className="theme-input w-full py-2 px-3 text-xs font-semibold"
                      />
                    </div>
                    <div className="space-y-1">
                      <label className="text-[11px] font-bold text-[var(--theme-text-body)] flex items-center gap-1">
                        <Mail className="w-3 h-3 text-[var(--theme-accent-primary)]" />
                        <span>Email</span>
                      </label>
                      <input
                        type="email"
                        maxLength={160}
                        value={editEmail}
                        onChange={(e) => setEditEmail(e.target.value)}
                        className="theme-input w-full py-2 px-3 text-xs font-semibold"
                      />
                    </div>
                  </div>

                  <div className="space-y-1">
                    <label className="text-[11px] font-bold text-[var(--theme-text-body)] block">
                      Traveler Style
                    </label>
                    <select
                      value={editTravelerType}
                      onChange={(e) => setEditTravelerType(e.target.value as TravelerType)}
                      style={{
                        backgroundColor: 'var(--theme-input-bg)',
                        borderColor: 'var(--theme-input-border)',
                        color: 'var(--theme-text-title)',
                      }}
                      className="w-full py-2 px-3 rounded-xl border text-xs font-semibold"
                    >
                      {TRAVELER_TYPE_PRESETS.map((preset) => (
                        <option
                          key={preset.id}
                          value={preset.id}
                          style={{
                            backgroundColor: 'var(--theme-card-bg)',
                            color: 'var(--theme-text-title)',
                          }}
                        >
                          {preset.label}
                        </option>
                      ))}
                    </select>
                  </div>

                  <label className="flex items-center gap-2 text-xs text-[var(--theme-text-body)] cursor-pointer">
                    <input
                      type="checkbox"
                      checked={applyTopicsPresetOnSave}
                      onChange={(e) => setApplyTopicsPresetOnSave(e.target.checked)}
                      style={{ accentColor: 'var(--theme-accent-primary)' }}
                    />
                    <span>Apply recommended storytelling topics &amp; persona for this Traveler Style</span>
                  </label>

                  <div className="flex justify-end">
                    <button
                      type="submit"
                      className="min-h-[40px] px-4 rounded-xl theme-btn-primary text-xs font-bold flex items-center gap-1.5 cursor-pointer"
                    >
                      <Check className="w-3.5 h-3.5" />
                      <span>Save Profile Changes</span>
                    </button>
                  </div>
                </form>
              ) : (
                <div
                  style={{
                    backgroundColor: 'var(--theme-card-bg-subtle)',
                    borderColor: 'var(--theme-card-border)',
                  }}
                  className="p-3 rounded-xl border grid grid-cols-2 sm:grid-cols-4 gap-3 text-xs"
                >
                  <div>
                    <span className="text-[10.5px] text-[var(--theme-text-muted)] block">Traveler Style</span>
                    <span className="font-bold text-[var(--theme-text-title)] truncate block">
                      {getPresetForTravelerType(userProfile?.travelerType || 'casual_tourist').label.split(' & ')[0]}
                    </span>
                  </div>
                  <div>
                    <span className="text-[10.5px] text-[var(--theme-text-muted)] block">Location Mode</span>
                    <span className="font-bold text-[var(--theme-accent-primary)] block truncate">
                      {isManualLocationMode
                        ? deviceExactLocation?.city || 'Manual City'
                        : 'Automatic GPS'}
                    </span>
                  </div>
                  <div>
                    <span className="text-[10.5px] text-[var(--theme-text-muted)] block">Photo Memory</span>
                    <span className="font-bold text-[var(--theme-accent-secondary)] block">
                      {settings.savePhotosToDeviceMemory ? 'YES · App Folder' : 'NO · In-Memory'}
                    </span>
                  </div>
                  <div>
                    <span className="text-[10.5px] text-[var(--theme-text-muted)] block">Sights Explored</span>
                    <span className="font-bold text-[var(--theme-text-title)] block">
                      {visitedCount} logged
                    </span>
                  </div>
                </div>
              )}

              {/* Guest / Local Cloud Sync Upgrade Actions */}
              {(!userProfile || userProfile.authMethod !== 'google') && (
                <div className="flex flex-wrap items-center gap-2 pt-1">
                  {onSignInWithGoogle && (
                    <button
                      type="button"
                      disabled={isGoogleLinking}
                      onClick={async () => {
                        setIsGoogleLinking(true);
                        setProfileFormError(null);
                        setProfileStatusMessage(null);
                        const res = await onSignInWithGoogle();
                        setIsGoogleLinking(false);
                        if (res?.error) {
                          setProfileFormError(res.error);
                        } else if (res?.restored) {
                          setProfileStatusMessage('Restored your saved preferences from Firebase Cloud!');
                        } else {
                          setProfileStatusMessage('Signed in with Google — Settings synced to cloud.');
                        }
                      }}
                      style={{
                        backgroundColor: 'var(--theme-card-bg-subtle)',
                        borderColor: 'var(--theme-accent-secondary)',
                        color: 'var(--theme-text-title)',
                      }}
                      className="min-h-[40px] px-3.5 rounded-xl border text-xs font-bold flex items-center gap-2 cursor-pointer hover:brightness-110"
                    >
                      <Cloud className="w-3.5 h-3.5 text-[var(--theme-accent-secondary)]" />
                      <span>{isGoogleLinking ? 'Connecting...' : 'Sign In / Sync with Google Cloud'}</span>
                    </button>
                  )}

                  {(!userProfile || userProfile.authMethod === 'guest') && onSwitchAccountLogin && (
                    <button
                      type="button"
                      onClick={onSwitchAccountLogin}
                      className="min-h-[40px] px-3.5 rounded-xl theme-btn-primary text-xs font-bold cursor-pointer"
                    >
                      Complete Explorer Sign-In
                    </button>
                  )}
                </div>
              )}
            </div>

            {/* Color Atmosphere Theme Picker inside Settings */}
            {onSelectTheme && (
              <div
                style={{
                  backgroundColor: 'var(--theme-card-bg)',
                  borderColor: 'var(--theme-card-border)',
                }}
                className="p-3.5 rounded-2xl border shadow-lg space-y-2.5 backdrop-blur-md"
              >
                <div className="flex items-center justify-between">
                  <span className="text-xs font-bold text-[var(--theme-accent-primary)] uppercase tracking-wider flex items-center gap-1.5">
                    <Palette className="w-3.5 h-3.5" />
                    <span>Color Atmosphere Theme</span>
                  </span>
                  <span className="text-[10.5px] text-[var(--theme-text-muted)] capitalize">
                    Active: {currentTheme}
                  </span>
                </div>

                <div className="grid grid-cols-1 sm:grid-cols-2 gap-2">
                  {THEME_PRESETS.map((preset) => {
                    const isSelected = currentTheme === preset.id;
                    return (
                      <button
                        key={preset.id}
                        type="button"
                        onClick={() => onSelectTheme(preset.id)}
                        style={{
                          backgroundColor: isSelected
                            ? 'var(--theme-card-hover)'
                            : 'var(--theme-card-bg-subtle)',
                          borderColor: isSelected
                            ? 'var(--theme-accent-secondary)'
                            : 'var(--theme-card-border)',
                        }}
                        className="p-2.5 rounded-xl border text-left flex items-center justify-between gap-2 cursor-pointer hover:border-[var(--theme-card-border-glow)] transition-all"
                      >
                        <div className="flex items-center gap-2.5 min-w-0">
                          <div
                            className="w-5 h-5 rounded-full border border-white/20 shrink-0"
                            style={{
                              background: `linear-gradient(135deg, ${preset.primaryColor}, ${preset.secondaryColor})`,
                            }}
                          />
                          <div className="min-w-0">
                            <span className="text-xs font-bold text-[var(--theme-text-title)] block truncate">
                              {preset.name}
                            </span>
                            <span className="text-[10px] text-[var(--theme-text-muted)] block truncate">
                              {preset.subtitle}
                            </span>
                          </div>
                        </div>
                        {isSelected && (
                          <Check className="w-4 h-4 text-[var(--theme-accent-secondary)] shrink-0" />
                        )}
                      </button>
                    );
                  })}
                </div>
              </div>
            )}

            {/* Replay Onboarding & Account Switching */}
            <div
              style={{
                backgroundColor: 'var(--theme-card-bg)',
                borderColor: 'var(--theme-card-border)',
              }}
              className="p-3.5 rounded-2xl border shadow-lg space-y-2.5 backdrop-blur-md"
            >
              <span className="text-xs font-bold text-[var(--theme-accent-primary)] uppercase tracking-wider flex items-center gap-1.5">
                <RotateCcw className="w-3.5 h-3.5" />
                <span>App Tour, Introduction &amp; Account</span>
              </span>

              <div className="grid grid-cols-1 sm:grid-cols-2 gap-2">
                {onReplayIntro && (
                  <button
                    id="btn-replay-intro"
                    type="button"
                    onClick={onReplayIntro}
                    style={{
                      backgroundColor: 'var(--theme-card-bg-subtle)',
                      borderColor: 'var(--theme-card-border)',
                      color: 'var(--theme-text-title)',
                    }}
                    className="min-h-[44px] px-3 py-2 rounded-xl border text-xs font-bold flex items-center justify-center gap-2 cursor-pointer hover:border-[var(--theme-card-border-glow)]"
                  >
                    <BookOpen className="w-4 h-4 text-[var(--theme-accent-primary)]" />
                    <span>View App Introduction &amp; Speech</span>
                  </button>
                )}

                {onReplayTour && (
                  <button
                    id="btn-replay-tour"
                    type="button"
                    onClick={onReplayTour}
                    style={{
                      backgroundColor: 'var(--theme-card-bg-subtle)',
                      borderColor: 'var(--theme-card-border)',
                      color: 'var(--theme-text-title)',
                    }}
                    className="min-h-[44px] px-3 py-2 rounded-xl border text-xs font-bold flex items-center justify-center gap-2 cursor-pointer hover:border-[var(--theme-card-border-glow)]"
                  >
                    <Compass className="w-4 h-4 text-[var(--theme-accent-secondary)]" />
                    <span>Replay Screen-by-Screen Tour</span>
                  </button>
                )}
              </div>

              {onLogoutAndResetOnboarding && (
                <div
                  className="pt-2.5 border-t flex flex-wrap items-center justify-between gap-2"
                  style={{ borderColor: 'var(--theme-card-border)' }}
                >
                  <p className="text-[11px] text-[var(--theme-text-muted)]">
                    Switch explorer account or re-run initial login setup questions.
                  </p>
                  {!isConfirmingLogout ? (
                    <button
                      id="btn-switch-user-logout"
                      type="button"
                      onClick={() => setIsConfirmingLogout(true)}
                      className="min-h-[38px] px-3 rounded-xl border border-rose-500/40 bg-rose-950/30 hover:bg-rose-950/60 text-rose-300 text-xs font-bold flex items-center gap-1.5 cursor-pointer"
                    >
                      <LogOut className="w-3.5 h-3.5" />
                      <span>Switch User / Log Out</span>
                    </button>
                  ) : (
                    <div className="flex items-center gap-2">
                      <button
                        id="btn-confirm-logout"
                        type="button"
                        onClick={() => {
                          setIsConfirmingLogout(false);
                          onLogoutAndResetOnboarding();
                        }}
                        className="min-h-[38px] px-3 rounded-xl bg-rose-600 hover:bg-rose-500 text-white text-xs font-bold cursor-pointer"
                      >
                        Confirm Log Out
                      </button>
                      <button
                        type="button"
                        onClick={() => setIsConfirmingLogout(false)}
                        className="min-h-[38px] px-3 rounded-xl theme-btn-secondary text-xs font-semibold cursor-pointer"
                      >
                        Cancel
                      </button>
                    </div>
                  )}
                </div>
              )}
            </div>
          </div>
        )}

        {/* SECTION 1: LOCATION MODE & DESTINATION SELECTOR */}
        {activeSection === 'location' && (
          <div className="space-y-3">
            {/* Mode Selector Card (Option A: Automatic GPS vs Option B: Manual Place Selection) */}
            <div
              style={{
                backgroundColor: 'var(--theme-card-bg)',
                borderColor: 'var(--theme-card-border)',
              }}
              className="p-3 rounded-2xl border shadow-lg space-y-2.5 backdrop-blur-md"
            >
              <div className="flex items-center justify-between gap-2 flex-wrap">
                <span className="text-xs font-bold text-[var(--theme-accent-primary)] uppercase tracking-wider flex items-center gap-1.5">
                  <Compass className="w-3.5 h-3.5 shrink-0" />
                  <span>{locUi.sectionTitle}</span>
                </span>
                <span className="text-[10px] px-2 py-0.5 rounded-full theme-badge-teal">
                  {isManualLocationMode ? locUi.manualActiveBadge : locUi.gpsActiveBadge}
                </span>
              </div>

              <div role="radiogroup" aria-label={locUi.sectionTitle} className="grid grid-cols-1 sm:grid-cols-2 gap-2">
                {/* OPTION A: Automatic GPS Location */}
                <button
                  id="btn-mode-auto-gps"
                  type="button"
                  role="radio"
                  aria-checked={!isManualLocationMode}
                  onClick={() => {
                    setLocationSavedFeedback(null);
                    onSetLocationMode('gps');
                  }}
                  style={{
                    backgroundColor: !isManualLocationMode ? 'var(--theme-card-bg-subtle)' : 'var(--theme-card-bg)',
                    borderColor: !isManualLocationMode ? 'var(--theme-accent-primary)' : 'var(--theme-card-border)',
                  }}
                  className={`p-3 rounded-xl border text-start transition-all cursor-pointer flex flex-col justify-between ${
                    !isManualLocationMode ? 'shadow-sm' : 'hover:border-[var(--theme-card-border-glow)]'
                  }`}
                >
                  <div className="flex items-center justify-between mb-1.5 gap-2">
                    <div className="flex items-center gap-1.5 font-bold text-xs text-[var(--theme-text-title)]">
                      <NavIcon className="w-4 h-4 text-[var(--theme-accent-primary)] shrink-0" />
                      <span>{locUi.optionATitle}</span>
                    </div>
                    {!isManualLocationMode && <CheckCircle2 className="w-4 h-4 text-[var(--theme-accent-primary)] shrink-0" />}
                  </div>
                  <p className="text-[10.5px] leading-relaxed text-[var(--theme-text-muted)]">
                    {locUi.optionADesc}
                  </p>
                </button>

                {/* OPTION B: Manual Place Selection */}
                <button
                  id="btn-mode-manual"
                  type="button"
                  role="radio"
                  aria-checked={isManualLocationMode}
                  onClick={() => {
                    setLocationSavedFeedback(null);
                    onSetLocationMode('manual');
                  }}
                  style={{
                    backgroundColor: isManualLocationMode ? 'var(--theme-card-bg-subtle)' : 'var(--theme-card-bg)',
                    borderColor: isManualLocationMode ? 'var(--theme-accent-primary)' : 'var(--theme-card-border)',
                  }}
                  className={`p-3 rounded-xl border text-start transition-all cursor-pointer flex flex-col justify-between ${
                    isManualLocationMode ? 'shadow-sm' : 'hover:border-[var(--theme-card-border-glow)]'
                  }`}
                >
                  <div className="flex items-center justify-between mb-1.5 gap-2">
                    <div className="flex items-center gap-1.5 font-bold text-xs text-[var(--theme-text-title)]">
                      <MapPin className="w-4 h-4 text-[var(--theme-accent-primary)] shrink-0" />
                      <span>{locUi.optionBTitle}</span>
                    </div>
                    {isManualLocationMode && <CheckCircle2 className="w-4 h-4 text-[var(--theme-accent-primary)] shrink-0" />}
                  </div>
                  <p className="text-[10.5px] leading-relaxed text-[var(--theme-text-muted)]">
                    {locUi.optionBDesc}
                  </p>
                </button>
              </div>

              {/* Current Active Location Summary */}
              <div
                style={{
                  backgroundColor: 'var(--theme-card-bg-subtle)',
                  borderColor: 'var(--theme-card-border)',
                }}
                className="mt-1 p-2.5 rounded-xl border flex items-center justify-between gap-2 text-xs flex-wrap sm:flex-nowrap"
              >
                <div className="flex items-center gap-2 min-w-0 truncate">
                  <span className="text-[var(--theme-accent-primary)] font-bold shrink-0">{locUi.activeDestLabel}</span>
                  <span id="settings-active-destination-text" className="font-semibold text-[var(--theme-text-title)] truncate">
                    {deviceExactLocation?.locationName ||
                      locationCoords?.city ||
                      (isManualLocationMode ? locUi.notSelectedManual : locUi.notSelectedGps)}
                  </span>
                </div>
                {!isManualLocationMode && (
                  <button
                    id="btn-settings-refresh-gps"
                    type="button"
                    onClick={handleRefreshGps}
                    disabled={isRefreshingGps || gpsStatus === 'locating'}
                    style={{
                      backgroundColor: 'var(--theme-card-bg)',
                      borderColor: 'var(--theme-card-border)',
                      color: 'var(--theme-accent-primary)',
                    }}
                    className="px-2.5 py-1.5 rounded-lg text-[10.5px] font-bold border flex items-center gap-1 shrink-0 active:scale-95 cursor-pointer shadow-sm hover:border-[var(--theme-card-border-glow)]"
                  >
                    <RefreshCw className={`w-3 h-3 ${isRefreshingGps || gpsStatus === 'locating' ? 'animate-spin' : ''}`} />
                    <span>{isRefreshingGps || gpsStatus === 'locating' ? locUi.scanningGps : locUi.refreshGps}</span>
                  </button>
                )}
              </div>

              {isManualLocationMode && locationSavedFeedback && (
                <div className="px-2.5 py-1.5 rounded-xl bg-emerald-500/10 border border-emerald-500/35 text-emerald-300 text-[11px] font-medium flex items-center gap-1.5">
                  <CheckCircle2 className="w-3.5 h-3.5 text-emerald-400 shrink-0" />
                  <span>{locationSavedFeedback}</span>
                </div>
              )}

              {isManualLocationMode &&
                deviceExactLocation?.city &&
                (deviceExactLocation.latitude === null || deviceExactLocation.longitude === null) && (
                  <div className="px-2.5 py-2 rounded-xl bg-amber-500/10 border border-amber-500/35 text-amber-200 text-[11px] leading-relaxed flex items-start gap-2">
                    <AlertCircle className="w-3.5 h-3.5 text-amber-400 shrink-0 mt-0.5" />
                    <span>{locUi.unverifiedCustomNote}</span>
                  </div>
                )}
            </div>

            {/* OPTION B DETAILS: Worldwide Searchable Country -> State -> City/Town/Village Selector */}
            {isManualLocationMode ? (
              <div
                style={{
                  backgroundColor: 'var(--theme-card-bg)',
                  borderColor: 'var(--theme-card-border)',
                }}
                className="p-3 rounded-2xl border shadow-lg space-y-3 backdrop-blur-md overflow-visible relative z-30"
              >
                <LocationCascadingSelector
                  selectedLanguage={selectedLanguage}
                  locationPref={locationPref}
                  deviceExactLocation={deviceExactLocation}
                  isManualLocationMode={isManualLocationMode}
                  onApplyLocation={handleApplyWorldwideLocation}
                />

                {/* Quick 1-Tap Popular Destinations */}
                <div
                  style={{ borderColor: 'var(--theme-card-border)' }}
                  className="pt-2 border-t"
                >
                  <span className="text-[10px] font-bold uppercase tracking-wider text-[var(--theme-accent-primary)] block mb-1.5">
                    {locUi.popularHeading}
                  </span>
                  <div className="flex flex-wrap gap-1.5">
                    {QUICK_POPULAR_DESTINATIONS.map((dest) => {
                      const isActiveDest =
                        (deviceExactLocation?.city || '').toLowerCase() === dest.city.toLowerCase();
                      const matchedCountry = findCountryByNameOrCode(dest.country, selectedLanguage.code);
                      return (
                        <button
                          key={dest.city}
                          type="button"
                          onClick={() => {
                            handleApplyWorldwideLocation({
                              cityName: dest.city,
                              state: dest.state,
                              stateCode: '',
                              country: matchedCountry?.localizedName || dest.country,
                              countryCode: matchedCountry?.code || '',
                              latitude: dest.lat,
                              longitude: dest.lng,
                              locationName: `${dest.city}, ${dest.state}, ${dest.country}`,
                              isVerified: true,
                            });
                          }}
                          style={
                            isActiveDest
                              ? {
                                  background: 'var(--theme-accent-primary-gradient)',
                                  color: 'var(--theme-accent-primary-text)',
                                  borderColor: 'var(--theme-accent-primary)',
                                }
                              : {
                                  backgroundColor: 'var(--theme-card-bg-subtle)',
                                  color: 'var(--theme-text-body)',
                                  borderColor: 'var(--theme-card-border)',
                                }
                          }
                          className="px-2.5 py-1 rounded-lg text-xs font-semibold transition-all border flex items-center gap-1 active:scale-95 cursor-pointer shadow-sm"
                        >
                          <span>{dest.flag}</span>
                          <span>{dest.city}</span>
                        </button>
                      );
                    })}
                  </div>
                </div>
              </div>
            ) : (
              /* OPTION A DETAILS: Honest GPS Status / Coordinates / Permission & Failure Recovery */
              <div
                style={{
                  backgroundColor: 'var(--theme-card-bg)',
                  borderColor: 'var(--theme-card-border)',
                }}
                className="p-3.5 rounded-2xl border text-xs space-y-2.5"
              >
                <div className="flex items-center gap-2 font-bold text-[var(--theme-accent-primary)]">
                  <NavIcon className="w-4 h-4 shrink-0" />
                  <span>{locUi.gpsModeTitle}</span>
                </div>
                <p className="text-[var(--theme-text-body)] leading-relaxed text-[11px]">
                  {locUi.gpsModeDesc}
                </p>

                {gpsError && (
                  <div
                    role="alert"
                    className="p-2.5 rounded-xl bg-rose-500/10 border border-rose-500/35 text-rose-200 text-[11px] space-y-2"
                  >
                    <div className="flex items-start gap-2">
                      <AlertCircle className="w-4 h-4 text-rose-400 shrink-0 mt-0.5" />
                      <span>{gpsError}</span>
                    </div>
                    <div className="flex items-center gap-2 flex-wrap">
                      <button
                        type="button"
                        onClick={handleRefreshGps}
                        disabled={isRefreshingGps || gpsStatus === 'locating'}
                        className="px-3 py-1.5 rounded-lg theme-btn-primary text-[11px] font-bold flex items-center gap-1.5 cursor-pointer"
                      >
                        <RefreshCw className={`w-3 h-3 ${isRefreshingGps ? 'animate-spin' : ''}`} />
                        <span>{locUi.retryGps}</span>
                      </button>
                      <button
                        id="btn-gps-error-switch-manual"
                        type="button"
                        onClick={() => onSetLocationMode('manual')}
                        style={{
                          backgroundColor: 'var(--theme-card-bg-subtle)',
                          borderColor: 'var(--theme-card-border)',
                          color: 'var(--theme-text-title)',
                        }}
                        className="px-3 py-1.5 rounded-lg border text-[11px] font-bold flex items-center gap-1.5 cursor-pointer hover:border-[var(--theme-card-border-glow)]"
                      >
                        <MapPin className="w-3 h-3 text-[var(--theme-accent-primary)]" />
                        <span>{locUi.switchManualCta}</span>
                      </button>
                    </div>
                  </div>
                )}

                <div className="pt-1 text-[10.5px] text-[var(--theme-accent-secondary)]">
                  {typeof locationCoords?.latitude === 'number' && typeof locationCoords?.longitude === 'number'
                    ? `Coordinates: ${locationCoords.latitude.toFixed(4)}°, ${locationCoords.longitude.toFixed(4)}° (${deviceExactLocation?.locationName || deviceExactLocation?.city || 'Current Area'})`
                    : gpsStatus === 'locating'
                    ? locUi.scanningGps
                    : locUi.gpsCoordsUnavailable}
                </div>
              </div>
            )}
          </div>
        )}

        {/* SECTION 2: LANGUAGE SELECTION */}
        {activeSection === 'language' && (
          <div className="space-y-3">
            <div
              style={{
                backgroundColor: 'var(--theme-card-bg)',
                borderColor: 'var(--theme-card-border)',
              }}
              className="p-3 rounded-2xl border shadow-lg backdrop-blur-md"
            >
              <div className="flex items-center justify-between mb-2">
                <div className="flex items-center gap-1.5 text-xs font-bold text-[var(--theme-accent-primary)] uppercase tracking-wider">
                  <Languages className="w-3.5 h-3.5" />
                  <span>Audio &amp; Narration Language ({SUPPORTED_LANGUAGES.length} Languages)</span>
                </div>
                <span className="text-[10px] text-[var(--theme-text-muted)]">Instant App-Wide Sync</span>
              </div>
              <p className="text-xs text-[var(--theme-text-body)] mb-3">
                All voice explanations, AI chat queries, historical stories, and OCR translations will be generated in your selected language.
              </p>

              {/* 13 Languages Interactive Grid */}
              <div className="grid grid-cols-2 sm:grid-cols-3 md:grid-cols-4 gap-2">
                {SUPPORTED_LANGUAGES.map((lang) => {
                  const isSelected = selectedLanguage.code === lang.code;
                  return (
                    <button
                      key={lang.code}
                      id={`btn-lang-${lang.code}`}
                      onClick={() => onSelectLanguage(lang)}
                      style={
                        isSelected
                          ? {
                              background: 'var(--theme-accent-primary-gradient)',
                              color: 'var(--theme-accent-primary-text)',
                              borderColor: 'var(--theme-accent-primary)',
                            }
                          : {
                              backgroundColor: 'var(--theme-card-bg-subtle)',
                              color: 'var(--theme-text-body)',
                              borderColor: 'var(--theme-card-border)',
                            }
                      }
                      className="p-2.5 rounded-xl border text-left transition-all cursor-pointer relative flex flex-col justify-between active:scale-95 shadow-sm hover:border-[var(--theme-card-border-glow)]"
                    >
                      <div className="flex items-center justify-between mb-1">
                        <span className="text-lg">{lang.flag}</span>
                        {isSelected && <CheckCircle2 className="w-4 h-4 stroke-[2.5]" />}
                      </div>
                      <div>
                        <div className="text-xs font-bold">
                          {lang.nativeName}
                        </div>
                        <div className="text-[10px] opacity-80">
                          {lang.name}
                        </div>
                      </div>
                    </button>
                  );
                })}
              </div>
            </div>
          </div>
        )}

        {/* SECTION 3: OUTPUT MODE (Speech / Text / Both) */}
        {activeSection === 'output' && (
          <div className="space-y-3">
            <div
              style={{
                backgroundColor: 'var(--theme-card-bg)',
                borderColor: 'var(--theme-card-border)',
              }}
              className="p-3 rounded-2xl border shadow-lg space-y-3 backdrop-blur-md"
            >
              <div className="flex items-center justify-between">
                <span className="text-xs font-bold text-[var(--theme-accent-primary)] uppercase tracking-wider flex items-center gap-1.5">
                  <Volume2 className="w-3.5 h-3.5" />
                  <span>Guide Output Mode</span>
                </span>
                <span className="text-[10px] px-2 py-0.5 rounded-full theme-badge-teal capitalize">
                  Current: {outputMode}
                </span>
              </div>

              {/* 3 Large Mode Cards */}
              <div className="grid grid-cols-1 sm:grid-cols-3 gap-2.5">
                {/* 1. Speech Only */}
                <div
                  id="mode-card-speech"
                  onClick={() => onToggleOutputMode('speech')}
                  style={{
                    backgroundColor: outputMode === 'speech' ? 'var(--theme-card-bg-subtle)' : 'var(--theme-card-bg)',
                    borderColor: outputMode === 'speech' ? 'var(--theme-accent-primary)' : 'var(--theme-card-border)',
                  }}
                  className="p-3.5 rounded-xl border transition-all cursor-pointer flex flex-col justify-between active:scale-95 shadow-sm"
                >
                  <div>
                    <div className="flex items-center justify-between mb-2">
                      <div
                        style={{
                          backgroundColor: 'var(--theme-card-bg)',
                          color: 'var(--theme-accent-primary)',
                        }}
                        className="p-2 rounded-lg"
                      >
                        <Headphones className="w-5 h-5" />
                      </div>
                      {outputMode === 'speech' && <CheckCircle2 className="w-4 h-4 text-[var(--theme-accent-primary)]" />}
                    </div>
                    <h4 className="text-xs font-bold text-[var(--theme-text-title)] mb-1">Speech Only (Voice)</h4>
                    <p className="text-[10.5px] leading-relaxed text-[var(--theme-text-muted)]">
                      Plays immersive live voice narration automatically upon scanning landmarks.
                    </p>
                  </div>
                </div>

                {/* 2. Text Only */}
                <div
                  id="mode-card-text"
                  onClick={() => onToggleOutputMode('text')}
                  style={{
                    backgroundColor: outputMode === 'text' ? 'var(--theme-card-bg-subtle)' : 'var(--theme-card-bg)',
                    borderColor: outputMode === 'text' ? 'var(--theme-accent-primary)' : 'var(--theme-card-border)',
                  }}
                  className="p-3.5 rounded-xl border transition-all cursor-pointer flex flex-col justify-between active:scale-95 shadow-sm"
                >
                  <div>
                    <div className="flex items-center justify-between mb-2">
                      <div
                        style={{
                          backgroundColor: 'var(--theme-card-bg)',
                          color: 'var(--theme-accent-primary)',
                        }}
                        className="p-2 rounded-lg"
                      >
                        <FileText className="w-5 h-5" />
                      </div>
                      {outputMode === 'text' && <CheckCircle2 className="w-4 h-4 text-[var(--theme-accent-primary)]" />}
                    </div>
                    <h4 className="text-xs font-bold text-[var(--theme-text-title)] mb-1">Text Only (Silent)</h4>
                    <p className="text-[10.5px] leading-relaxed text-[var(--theme-text-muted)]">
                      Disables audio playback for silent reading inside museums and temples.
                    </p>
                  </div>
                </div>

                {/* 3. Both (Speech + Text) */}
                <div
                  id="mode-card-both"
                  onClick={() => onToggleOutputMode('both')}
                  style={{
                    backgroundColor: outputMode === 'both' ? 'var(--theme-card-bg-subtle)' : 'var(--theme-card-bg)',
                    borderColor: outputMode === 'both' ? 'var(--theme-accent-primary)' : 'var(--theme-card-border)',
                  }}
                  className="p-3.5 rounded-xl border transition-all cursor-pointer flex flex-col justify-between active:scale-95 shadow-sm"
                >
                  <div>
                    <div className="flex items-center justify-between mb-2">
                      <div
                        style={{
                          backgroundColor: 'var(--theme-card-bg)',
                          color: 'var(--theme-accent-primary)',
                        }}
                        className="p-2 rounded-lg"
                      >
                        <Volume2 className="w-5 h-5" />
                      </div>
                      {outputMode === 'both' && <CheckCircle2 className="w-4 h-4 text-[var(--theme-accent-primary)]" />}
                    </div>
                    <h4 className="text-xs font-bold text-[var(--theme-text-title)] mb-1">Speech + Text (Both)</h4>
                    <p className="text-[10.5px] leading-relaxed text-[var(--theme-text-muted)]">
                      Best experience: Listen to spoken audio guide while reading synchronized transcripts.
                    </p>
                  </div>
                </div>
              </div>
            </div>

            {/* SECTION 3B: PHONE MEMORY & PHOTO STORAGE SETTING */}
            <div
              style={{
                backgroundColor: 'var(--theme-card-bg)',
                borderColor: 'var(--theme-card-border)',
              }}
              className="p-3.5 rounded-2xl border shadow-lg space-y-3.5 backdrop-blur-md"
            >
              <div className="flex items-center justify-between">
                <div className="flex items-center gap-2">
                  <div
                    style={{
                      backgroundColor: 'var(--theme-card-bg-subtle)',
                      color: 'var(--theme-accent-primary)',
                    }}
                    className="p-1.5 rounded-lg border border-[var(--theme-card-border)]"
                  >
                    <HardDrive className="w-4 h-4" />
                  </div>
                  <div>
                    <h3 className="text-xs font-bold text-[var(--theme-text-title)]">
                      Save Clicked Photo to Phone Memory
                    </h3>
                    <p className="text-[10px] text-[var(--theme-text-muted)]">
                      Save sight photos to internal storage in app&apos;s data folder
                    </p>
                  </div>
                </div>

                <span
                  className={`text-[10px] px-2.5 py-0.5 rounded-full font-bold border flex items-center gap-1 ${
                    settings.savePhotosToDeviceMemory
                      ? 'bg-emerald-500/20 text-emerald-300 border-emerald-500/40'
                      : 'bg-zinc-800 text-zinc-300 border-zinc-700'
                  }`}
                >
                  {settings.savePhotosToDeviceMemory ? (
                    <>
                      <CheckCircle2 className="w-3 h-3 text-emerald-400" />
                      <span>YES (Active)</span>
                    </>
                  ) : (
                    <>
                      <ShieldCheck className="w-3 h-3 text-amber-400" />
                      <span>NO (Off)</span>
                    </>
                  )}
                </span>
              </div>

              {/* 2 Big Choice Cards: YES vs NO */}
              <div className="grid grid-cols-1 sm:grid-cols-2 gap-2.5">
                {/* 1. YES - Save to phone internal memory */}
                <div
                  id="opt-save-photo-yes"
                  onClick={() => {
                    onUpdateSettings({
                      ...settings,
                      savePhotosToDeviceMemory: true,
                    });
                  }}
                  style={{
                    backgroundColor: settings.savePhotosToDeviceMemory
                      ? 'var(--theme-card-bg-subtle)'
                      : 'var(--theme-card-bg)',
                    borderColor: settings.savePhotosToDeviceMemory
                      ? 'var(--theme-accent-primary)'
                      : 'var(--theme-card-border)',
                  }}
                  className="p-3 rounded-xl border transition-all cursor-pointer flex flex-col justify-between active:scale-95 shadow-sm hover:border-[var(--theme-card-border-glow)]"
                >
                  <div>
                    <div className="flex items-center justify-between mb-1.5">
                      <span className="text-xs font-bold text-emerald-300 flex items-center gap-1.5">
                        <HardDrive className="w-3.5 h-3.5" />
                        <span>YES - Save to Phone Memory</span>
                      </span>
                      {settings.savePhotosToDeviceMemory && (
                        <CheckCircle2 className="w-4 h-4 text-emerald-400" />
                      )}
                    </div>
                    <p className="text-[10.5px] leading-relaxed text-[var(--theme-text-muted)]">
                      Saves captured &amp; uploaded sight photos directly to phone&apos;s internal memory inside the app&apos;s sandboxed data folder. Enables offline photo history.
                    </p>
                  </div>
                  <div className="mt-2 pt-2 border-t border-[var(--theme-card-border)] flex items-center justify-between text-[10px] text-emerald-400/90 font-medium">
                    <span>Target: Phone Internal Memory</span>
                    <span className="px-1.5 py-0.5 rounded bg-emerald-950/60 border border-emerald-700/50">App Data Folder</span>
                  </div>
                </div>

                {/* 2. NO - Do NOT save to phone memory (Default) */}
                <div
                  id="opt-save-photo-no"
                  onClick={() => {
                    onUpdateSettings({
                      ...settings,
                      savePhotosToDeviceMemory: false,
                    });
                  }}
                  style={{
                    backgroundColor: !settings.savePhotosToDeviceMemory
                      ? 'var(--theme-card-bg-subtle)'
                      : 'var(--theme-card-bg)',
                    borderColor: !settings.savePhotosToDeviceMemory
                      ? 'var(--theme-accent-primary)'
                      : 'var(--theme-card-border)',
                  }}
                  className="p-3 rounded-xl border transition-all cursor-pointer flex flex-col justify-between active:scale-95 shadow-sm hover:border-[var(--theme-card-border-glow)]"
                >
                  <div>
                    <div className="flex items-center justify-between mb-1.5">
                      <span className="text-xs font-bold text-[var(--theme-text-title)] flex items-center gap-1.5">
                        <ShieldCheck className="w-3.5 h-3.5 text-[var(--theme-accent-secondary)]" />
                        <span>NO - Do Not Save (Conserve Storage)</span>
                      </span>
                      {!settings.savePhotosToDeviceMemory && (
                        <CheckCircle2 className="w-4 h-4 text-[var(--theme-accent-primary)]" />
                      )}
                    </div>
                    <p className="text-[10.5px] leading-relaxed text-[var(--theme-text-muted)]">
                      Do not write photos to phone memory. Photos are processed purely in-memory during recognition and discarded after the tour to conserve phone space.
                    </p>
                  </div>
                  <div className="mt-2 pt-2 border-t border-[var(--theme-card-border)] flex items-center justify-between text-[10px] text-[var(--theme-accent-secondary)] font-medium">
                    <span>Zero Storage Footprint</span>
                    <span
                      style={{
                        backgroundColor: 'var(--theme-card-bg)',
                        borderColor: 'var(--theme-card-border)',
                      }}
                      className="px-1.5 py-0.5 rounded border"
                    >
                      In-Memory Stream
                    </span>
                  </div>
                </div>
              </div>

              {/* Storage Diagnostics & Data Management */}
              <div className="p-3 rounded-xl bg-black/20 border border-[var(--theme-card-border)] space-y-2.5">
                <div className="flex items-center justify-between flex-wrap gap-2 text-xs">
                  <div className="flex items-center gap-3">
                    <div>
                      <span className="text-[10px] text-[var(--theme-text-muted)] block">Stored Photos</span>
                      <span className="font-bold text-[var(--theme-text-title)]">{storageStats.count} photos</span>
                    </div>
                    <div className="h-6 w-px bg-[var(--theme-card-border)]" />
                    <div>
                      <span className="text-[10px] text-[var(--theme-text-muted)] block">Internal Space Used</span>
                      <span className="font-bold text-[var(--theme-text-title)]">{storageStats.formattedSize}</span>
                    </div>
                    <div className="h-6 w-px bg-[var(--theme-card-border)]" />
                    <div>
                      <span className="text-[10px] text-[var(--theme-text-muted)] block">Storage Location</span>
                      <span className="font-mono text-[10px] text-[var(--theme-accent-secondary)]">/app-data/photos</span>
                    </div>
                  </div>

                  {storageStats.count > 0 && (
                    <div>
                      {!isConfirmingClear ? (
                        <button
                          onClick={() => setIsConfirmingClear(true)}
                          className="px-2.5 py-1 rounded-lg bg-red-950/70 hover:bg-red-900 text-red-300 border border-red-800/60 text-[11px] font-bold transition-all flex items-center gap-1 cursor-pointer"
                        >
                          <Trash2 className="w-3 h-3" />
                          <span>Clear Saved Photos ({storageStats.count})</span>
                        </button>
                      ) : (
                        <div className="flex items-center gap-1.5">
                          <button
                            onClick={async () => {
                              await clearAllSavedPhotosFromAppStorage();
                              await refreshStorageData();
                              setIsConfirmingClear(false);
                            }}
                            className="px-2.5 py-1 rounded-lg bg-red-600 hover:bg-red-500 text-white text-[11px] font-bold transition-all cursor-pointer shadow-md animate-pulse"
                          >
                            Confirm Delete All
                          </button>
                          <button
                            onClick={() => setIsConfirmingClear(false)}
                            className="px-2 py-1 rounded-lg bg-zinc-800 hover:bg-zinc-700 text-zinc-300 text-[11px] font-bold transition-all cursor-pointer"
                          >
                            Cancel
                          </button>
                        </div>
                      )}
                    </div>
                  )}
                </div>

                {/* Stored Photos Gallery Preview if photos exist */}
                {savedPhotosList.length > 0 && (
                  <div className="pt-2 border-t border-[var(--theme-card-border)] space-y-1.5">
                    <span className="text-[10px] font-bold text-[var(--theme-accent-primary)] uppercase tracking-wider block">
                      Saved Photos in Internal App Data ({savedPhotosList.length})
                    </span>
                    <div className="grid grid-cols-2 sm:grid-cols-4 gap-2 max-h-40 overflow-y-auto pr-1">
                      {savedPhotosList.map((photo) => (
                        <div
                          key={photo.id}
                          className="group relative rounded-lg overflow-hidden border border-[var(--theme-card-border)] bg-black/40 flex flex-col"
                        >
                          <img
                            src={photo.dataUrl}
                            alt={photo.title}
                            className="w-full h-16 object-cover"
                          />
                          <div className="p-1.5 bg-black/70 flex items-center justify-between text-[9px] gap-1">
                            <span className="truncate text-zinc-200 font-medium">{photo.title}</span>
                            <button
                              onClick={async (e) => {
                                e.stopPropagation();
                                await deletePhotoFromAppStorage(photo.id);
                                await refreshStorageData();
                              }}
                              className="p-0.5 rounded text-red-400 hover:bg-red-950/80 cursor-pointer"
                              title="Delete from phone memory"
                            >
                              <Trash2 className="w-3 h-3" />
                            </button>
                          </div>
                        </div>
                      ))}
                    </div>
                  </div>
                )}
              </div>
            </div>
          </div>
        )}

        {/* SECTION 4: VOICE ENGINE, PERSONA & TOPICS */}
        {activeSection === 'voice' && (
          <div className="space-y-3">
            {/* Guide Tone & Persona */}
            <div
              style={{
                backgroundColor: 'var(--theme-card-bg)',
                borderColor: 'var(--theme-card-border)',
              }}
              className="p-3 rounded-2xl border shadow-lg space-y-2.5 backdrop-blur-md"
            >
              <div className="flex items-center justify-between">
                <span className="text-xs font-bold text-[var(--theme-accent-primary)] uppercase tracking-wider flex items-center gap-1.5">
                  <Sparkles className="w-3.5 h-3.5" />
                  <span>Storytelling Persona</span>
                </span>
                <span className="text-[10px] text-[var(--theme-text-muted)]">Applied to Live Narrations</span>
              </div>

              <div className="grid grid-cols-1 sm:grid-cols-2 gap-2">
                {PERSONAS.map((p) => {
                  const isSelected = settings.persona === p.id;
                  return (
                    <div
                      key={p.id}
                      onClick={() => onUpdateSettings({ ...settings, persona: p.id })}
                      style={{
                        backgroundColor: isSelected ? 'var(--theme-card-bg-subtle)' : 'var(--theme-card-bg)',
                        borderColor: isSelected ? 'var(--theme-accent-primary)' : 'var(--theme-card-border)',
                      }}
                      className="p-2.5 rounded-xl border transition-all cursor-pointer active:scale-95 shadow-sm hover:border-[var(--theme-card-border-glow)]"
                    >
                      <div className="flex items-center gap-2 mb-1">
                        {p.icon}
                        <h4 className="text-xs font-bold text-[var(--theme-text-title)]">{p.title}</h4>
                      </div>
                      <p className="text-[10.5px] text-[var(--theme-text-muted)]">{p.subtitle}</p>
                    </div>
                  );
                })}
              </div>
            </div>

            {/* Voice Gender & Sliders */}
            <div
              style={{
                backgroundColor: 'var(--theme-card-bg)',
                borderColor: 'var(--theme-card-border)',
              }}
              className="p-3 rounded-2xl border shadow-lg space-y-3 backdrop-blur-md"
            >
              <div className="flex items-center justify-between">
                <span className="text-xs font-bold text-[var(--theme-accent-primary)] uppercase tracking-wider flex items-center gap-1.5">
                  <Volume2 className="w-3.5 h-3.5" />
                  <span>Voice Synthesis & Tone Tuning</span>
                </span>
                <span className="text-[10px] px-2 py-0.5 rounded-full theme-badge-gold">
                  {settings.voiceGender === 'male' ? 'Male Voice Active' : 'Female Voice Active'}
                </span>
              </div>

              <div className="grid grid-cols-2 gap-2">
                <button
                  onClick={() => onUpdateSettings({ ...settings, voiceGender: 'female', voicePitch: 1.08 })}
                  style={
                    settings.voiceGender === 'female'
                      ? {
                          background: 'var(--theme-accent-primary-gradient)',
                          color: 'var(--theme-accent-primary-text)',
                          borderColor: 'var(--theme-accent-primary)',
                        }
                      : {
                          backgroundColor: 'var(--theme-card-bg-subtle)',
                          color: 'var(--theme-text-body)',
                          borderColor: 'var(--theme-card-border)',
                        }
                  }
                  className="py-2 px-3 rounded-xl border text-xs font-semibold transition-all flex items-center justify-center gap-1.5 cursor-pointer shadow-sm"
                >
                  <Sparkles className="w-3.5 h-3.5" />
                  <span>Female Voice</span>
                </button>
                <button
                  onClick={() => onUpdateSettings({ ...settings, voiceGender: 'male', voicePitch: 0.95 })}
                  style={
                    settings.voiceGender === 'male'
                      ? {
                          background: 'var(--theme-accent-primary-gradient)',
                          color: 'var(--theme-accent-primary-text)',
                          borderColor: 'var(--theme-accent-primary)',
                        }
                      : {
                          backgroundColor: 'var(--theme-card-bg-subtle)',
                          color: 'var(--theme-text-body)',
                          borderColor: 'var(--theme-card-border)',
                        }
                  }
                  className="py-2 px-3 rounded-xl border text-xs font-semibold transition-all flex items-center justify-center gap-1.5 cursor-pointer shadow-sm"
                >
                  <Volume2 className="w-3.5 h-3.5" />
                  <span>Male Voice</span>
                </button>
              </div>

              {/* Voice Pitch & Universal Audio Playback Speed */}
              <div className="space-y-3 pt-1">
                <div className="space-y-1">
                  <div className="flex justify-between text-xs">
                    <span className="text-[var(--theme-text-muted)]">Voice Pitch (Tone):</span>
                    <span className="font-bold text-[var(--theme-accent-primary)]">{settings.voicePitch.toFixed(2)}x</span>
                  </div>
                  <input
                    type="range"
                    min="0.85"
                    max="1.3"
                    step="0.02"
                    value={settings.voicePitch}
                    onChange={(e) => onUpdateSettings({ ...settings, voicePitch: parseFloat(e.target.value) })}
                    style={{ accentColor: 'var(--theme-accent-primary)' }}
                    className="w-full h-1.5 bg-black/40 rounded-lg appearance-none cursor-pointer"
                  />
                </div>

                <AudioSpeedSettingsControl
                  speed={settings.speechRate}
                  onChangeSpeed={(nextRate) => {
                    speechManager.setRate(nextRate);
                    onUpdateSettings({ ...settings, speechRate: nextRate });
                  }}
                />
              </div>

              {/* Live Voice Preview Button */}
              <button
                onClick={handleTestVoiceSample}
                style={
                  isPlayingTestVoice
                    ? {
                        backgroundColor: '#e11d48',
                        color: '#ffffff',
                      }
                    : undefined
                }
                className={`w-full py-2.5 px-4 rounded-xl font-bold text-xs transition-all flex items-center justify-center gap-2 cursor-pointer shadow-md ${
                  isPlayingTestVoice ? 'animate-pulse' : 'theme-btn-primary'
                }`}
              >
                {isPlayingTestVoice ? (
                  <>
                    <VolumeX className="w-4 h-4" />
                    <span>Stop Voice Test</span>
                  </>
                ) : (
                  <>
                    <Play className="w-4 h-4 fill-current" />
                    <span>Test Spoken Voice in {selectedLanguage.nativeName}</span>
                  </>
                )}
              </button>
            </div>

            {/* Narration Topics Dimension Grid */}
            <div
              style={{
                backgroundColor: 'var(--theme-card-bg)',
                borderColor: 'var(--theme-card-border)',
              }}
              className="p-3 rounded-2xl border shadow-lg space-y-2.5 backdrop-blur-md"
            >
              <div className="flex items-center justify-between">
                <span className="text-xs font-bold text-[var(--theme-accent-primary)] uppercase tracking-wider flex items-center gap-1.5">
                  <Layers className="w-3.5 h-3.5" />
                  <span>Narration Topics ({selectedTopicCount}/10 Enabled)</span>
                </span>
                <span className="text-[10px] text-[var(--theme-text-muted)]">Tick to include in audio tours</span>
              </div>

              <div className="grid grid-cols-1 sm:grid-cols-2 gap-2">
                {TOPIC_CONFIGS.map((topic) => {
                  const isSelected = !!settings.topics[topic.key];
                  return (
                    <div
                      key={topic.key}
                      onClick={() => handleToggleTopic(topic.key)}
                      style={{
                        backgroundColor: isSelected ? 'var(--theme-card-bg-subtle)' : 'var(--theme-card-bg)',
                        borderColor: isSelected ? 'var(--theme-accent-primary)' : 'var(--theme-card-border)',
                      }}
                      className={`p-2 rounded-xl border transition-all cursor-pointer flex items-start gap-2.5 active:scale-95 shadow-sm hover:border-[var(--theme-card-border-glow)] ${
                        !isSelected ? 'opacity-70' : ''
                      }`}
                    >
                      <div className="mt-0.5 shrink-0">
                        {isSelected ? (
                          <div
                            style={{
                              backgroundColor: 'var(--theme-accent-primary)',
                              color: 'var(--theme-accent-primary-text)',
                            }}
                            className="w-4 h-4 rounded flex items-center justify-center"
                          >
                            <CheckCircle2 className="w-3.5 h-3.5 stroke-[3]" />
                          </div>
                        ) : (
                          <div
                            style={{ borderColor: 'var(--theme-card-border)' }}
                            className="w-4 h-4 rounded border"
                          />
                        )}
                      </div>
                      <div className="flex-1 min-w-0">
                        <div className="flex items-center gap-1.5 mb-0.5">
                          {topic.icon}
                          <span className="text-xs font-bold text-[var(--theme-text-title)] truncate">{topic.title}</span>
                        </div>
                        <p className="text-[10px] text-[var(--theme-text-muted)] line-clamp-1">{topic.description}</p>
                      </div>
                    </div>
                  );
                })}
              </div>
            </div>
          </div>
        )}

            {/* Help & Support Entry near the bottom of Settings */}
            <div
              id="settings-help-support-card"
              style={{
                backgroundColor: 'var(--theme-card-bg)',
                borderColor: 'var(--theme-card-border)',
              }}
              className="p-4 rounded-2xl border shadow-lg backdrop-blur-md flex flex-col sm:flex-row sm:items-center justify-between gap-3"
            >
              <div className="flex items-start gap-3 min-w-0">
                <div
                  style={{
                    backgroundColor: 'var(--theme-card-bg-subtle)',
                    borderColor: 'var(--theme-card-border)',
                  }}
                  className="w-10 h-10 rounded-xl border flex items-center justify-center shrink-0 text-[var(--theme-accent-primary)]"
                >
                  <LifeBuoy className="w-5 h-5" />
                </div>
                <div className="min-w-0">
                  <h3 className="text-sm font-bold text-[var(--theme-text-title)] leading-snug">
                    {helpEntryT.helpSupportTitle}
                  </h3>
                  <p className="text-xs text-[var(--theme-text-muted)] mt-0.5">
                    {helpEntryT.helpSupportSubtitle} · charaiva10@gmail.com
                  </p>
                </div>
              </div>

              <button
                id="btn-open-help-support"
                type="button"
                onClick={() => {
                  setShowHelpSupport(true);
                  if (contentScrollRef.current) {
                    contentScrollRef.current.scrollTop = 0;
                  }
                }}
                className="min-h-[42px] px-4 rounded-xl theme-btn-primary text-xs font-bold flex items-center justify-center gap-2 cursor-pointer shrink-0"
              >
                <Mail className="w-3.5 h-3.5" />
                <span>{helpEntryT.helpSupportCta}</span>
                <ChevronRight
                  className={`w-3.5 h-3.5 ${selectedLanguage.direction === 'rtl' ? 'rotate-180' : ''}`}
                />
              </button>
            </div>
          </>
        )}
      </div>
    </div>
  );
};
