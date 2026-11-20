export type AppTab = 'home' | 'camera' | 'discover' | 'chat' | 'map' | 'history' | 'settings' | 'nearby' | 'city';

export type GuideOutputMode = 'speech' | 'text' | 'both';

export type GuidePersona = 'warm_female' | 'scholarly' | 'adventurous' | 'concise';

export interface SpeechTopicPreferences {
  historical: boolean;
  geographical: boolean;
  political: boolean;
  architectural: boolean;
  culturalMythology: boolean;
  culinary: boolean;
  economic: boolean;
  ecological: boolean;
  photography: boolean;
  mysteries: boolean;
}

export interface GuideSettings {
  topics: SpeechTopicPreferences;
  persona: GuidePersona;
  voiceGender: 'female' | 'male';
  voicePitch: number;
  speechRate: number;
  outputMode: GuideOutputMode;
  savePhotosToDeviceMemory?: boolean;
}

export interface LocationCoords {
  latitude: number;
  longitude: number;
  altitude?: number | null;
  accuracy?: number;
  address?: string;
  city?: string;
  country?: string;
}

export interface Language {
  code: string;
  name: string;
  nativeName: string;
  speechCode: string;
  flag: string;
  direction?: 'ltr' | 'rtl';
}

export interface LandmarkCategory {
  id: string;
  label: string;
  icon: string;
  color: string;
}

export interface SupplementaryImage {
  id: string;
  url: string;
  title: string;
  caption: string;
  type: 'historical' | 'interior' | 'aerial' | 'night' | 'detail' | 'art' | 'context';
  attribution?: string;
  sourceUrl?: string;
  isExampleImage?: boolean;
}

export type BatchStreamingStage = 'batch1_structural' | 'batch2_core_text' | 'batch3_deferred_media' | 'complete';

export interface BatchStreamingStatus {
  batch1Ready: boolean;
  batch2Ready: boolean;
  batch3Ready: boolean;
  stage: BatchStreamingStage;
  timestamp: number;
}

export type PlaceProvider = 'google_places' | 'openstreetmap' | 'curated_verified';

export type GpsLocationStatus =
  | 'idle'
  | 'locating'
  | 'live'
  | 'manual'
  | 'permission_denied'
  | 'timeout'
  | 'unavailable'
  | 'unsupported'
  | 'geocode_failed';

export interface PlaceAuthorAttribution {
  displayName: string;
  uri?: string;
  photoUri?: string;
}

export interface PlacePhotoReference {
  name: string;
  url: string;
  widthPx?: number;
  heightPx?: number;
  authorAttributions?: PlaceAuthorAttribution[];
}

export interface PlaceOpeningHours {
  openNow?: boolean;
  weekdayDescriptions?: string[];
  nextOpenTime?: string;
  nextCloseTime?: string;
}

export interface PlaceAccessibilitySummary {
  wheelchairAccessibleEntrance?: boolean;
  wheelchairAccessibleParking?: boolean;
  wheelchairAccessibleRestroom?: boolean;
  wheelchairAccessibleSeating?: boolean;
}

export interface PlaceRouteSummary {
  available: boolean;
  travelMode: 'DRIVE' | 'WALK' | 'TWO_WHEELER' | 'TRANSIT';
  distanceMeters?: number;
  distanceKm?: number;
  durationSeconds?: number;
  durationText?: string;
  localizedDistanceText?: string;
  localizedDurationText?: string;
  unavailableReason?: string;
}

export interface CharaivaPlace {
  id: string;
  provider: PlaceProvider;
  source?: string;
  sourceVerified: boolean;
  googlePlaceId?: string;
  placeId?: string;
  osmId?: string;
  name: string;
  category: string;
  primaryType?: string;
  primaryTypeDisplayName?: string;
  types?: string[];
  addressOrLocality: string;
  formattedAddress?: string;
  shortFormattedAddress?: string;
  latitude: number | null;
  longitude: number | null;
  estimatedDistanceKm: number | null;
  straightLineLabel?: string;
  walkOrDriveTime?: string;
  oneLineImportance: string;
  description: string;
  bestTimeToVisit?: string;
  keyHighlights: string[];
  rating?: number | null;
  reviewCount?: number | null;
  businessStatus?: string;
  regularOpeningHours?: PlaceOpeningHours;
  currentOpeningHours?: PlaceOpeningHours;
  websiteUri?: string;
  nationalPhoneNumber?: string;
  internationalPhoneNumber?: string;
  accessibilityOptions?: PlaceAccessibilitySummary;
  googleMapsUri?: string;
  imageUrl: string;
  photoName?: string;
  hasRealPhoto: boolean;
  photoUnavailable: boolean;
  authorAttributions: PlaceAuthorAttribution[];
  photos: PlacePhotoReference[];
}

export type CertaintyStatus =
  | 'established_fact'
  | 'traditional_interpretation'
  | 'possible_identification'
  | 'unknown';

export type ExplanationLevel = 'quick' | 'standard' | 'deep' | 'expert';

export interface ExploreMoreSuggestion {
  id: string;
  title: string;
  subtitle: string;
  angle: string;
  promptSeed: string;
}

export interface DeepConversationMessage {
  id: string;
  sender: 'user' | 'guide';
  text: string;
  timestamp: string;
  followUpSuggestions?: string[];
}

export interface DeepConversationContext {
  landmark: RecognitionResult;
  activeTab: string;
  activeLevel: ExplanationLevel;
  activeDetailsType?: string;
  selectedExploreTopic?: ExploreMoreSuggestion | null;
  verifiedOrigin?: string;
  initialPrompt?: string;
}

export interface DiscoverAutocompleteSuggestion {
  id: string;
  title: string;
  nativeTitle?: string;
  category: string;
  subtitle?: string;
  locationOrOrigin: string;
  wikipediaTitle?: string;
  placeId?: string;
  coords?: {
    latitude: number;
    longitude: number;
  };
  isVisitableSite?: boolean;
  candidate?: DiscoverCandidate;
}

export interface DiscoverCandidate {
  id: string;
  title: string;
  nativeTitle?: string;
  alternativeNames?: string[];
  category: string;
  mappedCategory?: RecognitionResult['category'];
  shortDescription: string;
  locationOrOrigin: string;
  historicalPeriod?: string;
  imageUrl?: string;
  imageAttribution?: string;
  imageSourceUrl?: string;
  isExampleImage?: boolean;
  sourceType: 'wikipedia' | 'verified_index' | 'google_places' | 'ai_suggested';
  certaintyLabel: string;
  certaintyStatus: CertaintyStatus;
  wikipediaTitle?: string;
  wikipediaUrl?: string;
  placeId?: string;
  coords?: {
    latitude: number;
    longitude: number;
  };
  isVisitableSite?: boolean;
  matchReason?: string;
}

export interface GroundedFactItem {
  text: string;
  certainty: CertaintyStatus;
  note?: string;
}

export interface InscriptionAnalysis {
  detected: boolean;
  script?: string;
  confirmedReading?: string;
  approximateTransliteration?: string;
  translation?: string;
  uncertaintyNote?: string;
  certainty: CertaintyStatus;
}

export interface DetailComponent {
  id: string;
  name: string;
  category: 'sculpture' | 'architecture' | 'iconography' | 'inscription' | 'material' | 'context';
  visualCue: string;
  meaningAndSymbolism: string;
  craftTechnique?: string;
  certainty: CertaintyStatus;
}

export interface DiscoverSourceCitation {
  title: string;
  url?: string;
  provider: string;
}

export interface RelatedDiscoveryItem {
  id: string;
  title: string;
  category: string;
  mappedCategory?: RecognitionResult['category'];
  relationReason: string;
  locationOrOrigin?: string;
  imageUrl?: string;
  imageAttribution?: string;
  wikipediaTitle?: string;
  wikipediaUrl?: string;
  isVisitableSite?: boolean;
}

export interface StructuredExplanationData {
  basicIdentification: string;
  history?: string;
  architectureAndConstruction?: string;
  sculptureAndFineDetails?: string;
  inscription?: InscriptionAnalysis;
  meaningAndSignificance?: string;
  interestingFacts: GroundedFactItem[];
  visitorInfo?: {
    visitable: boolean;
    locationNote?: string;
    bestTime?: string;
    hoursNote?: string;
    etiquetteOrTips?: string[];
    mapsQuery?: string;
  };
  detailComponents: DetailComponent[];
  relatedDiscoveries: RelatedDiscoveryItem[];
  exploreMoreTopics?: ExploreMoreSuggestion[];
  conservationAndChanges?: string;
  comparativeContext?: string;
  folkloreVsHistory?: string;
  misconceptions?: string[];
  sources: DiscoverSourceCitation[];
  certaintySummary: CertaintyStatus;
  certaintyNote?: string;
  levelNarration?: Partial<Record<ExplanationLevel, string>>;
  activeLevel?: ExplanationLevel;
  imageMeta?: {
    url?: string;
    attribution?: string;
    sourceUrl?: string;
    isExampleImage?: boolean;
  };
}

export interface RecognitionResult {
  id: string;
  title: string;
  nativeTitle?: string;
  category: 'monument' | 'temple' | 'fort' | 'museum' | 'landscape' | 'food' | 'plant' | 'object' | 'building' | 'animal';
  categoryLabel?: string;
  confidence: number;
  locationName: string;
  historicalPeriod?: string;
  ocrDetectedText?: string;
  summary: string;
  narration: string;
  keyFacts: string[];
  architecturalHighlights?: string[];
  suggestedQuestions?: string[];
  culturalSignificance?: string;
  audioDurationSeconds?: number;
  timestamp?: string;
  imageUrl?: string;
  photoDataUrl?: string;
  localPhotoId?: string;
  imageAttribution?: string;
  imageSourceUrl?: string;
  isExampleImage?: boolean;
  supplementaryImages?: SupplementaryImage[];
  coords?: LocationCoords;
  locationConfidence?: 'confirmed_local' | 'confirmed_nonlocal' | 'object_or_no_location' | 'uncertain';
  locationEvidence?: string;
  tags: string[];
  language?: string;
  batchStatus?: BatchStreamingStatus;
  isStreaming?: boolean;
  audioBase64?: string;
  journalId?: string;
  placeId?: string;
  googlePlaceId?: string;
  provider?: PlaceProvider;
  googleMapsUri?: string;
  city?: string;
  country?: string;
  visitDate?: string;
  notes?: string;
  visitedConfirmed?: boolean;
  createdAt?: string;
  updatedAt?: string;
  discoverCandidate?: DiscoverCandidate;
  structuredData?: StructuredExplanationData;
  candidateAlternatives?: DiscoverCandidate[];
}

export interface TravelJournalEntry {
  journalId: string;
  userId: string;
  placeId: string;
  placeName: string;
  city: string;
  country: string;
  locationName: string;
  category: RecognitionResult['category'];
  visitDate: string;
  notes: string;
  guideSummary: string;
  narration?: string;
  keyFacts?: string[];
  tags?: string[];
  language?: string;
  imageUrl?: string;
  photoDataUrl?: string;
  localPhotoId?: string;
  visitedConfirmed: boolean;
  createdAt?: string;
  updatedAt?: string;
}

export interface NearbyLandmark {
  id: string;
  title: string;
  category: string;
  distanceMeters: number;
  teaser: string;
  imageUrl: string;
  lat: number;
  lng: number;
  rating?: number | null;
}

export interface ChatMessage {
  id: string;
  sender: 'user' | 'guide';
  text: string;
  timestamp: string;
  createdAt?: string;
  audioUrl?: string;
  landmarkContextId?: string;
  conversationId?: string;
  status?: 'sending' | 'done' | 'error';
  errorMessage?: string;
  retryForUserText?: string;
}

export interface AiChatTopicContext {
  placeName: string;
  locationName?: string;
  summary?: string;
  historicalContext?: string;
  architecturalDetails?: string;
  culturalSignificance?: string;
  landmarkId?: string;
}

export interface AiChatConversation {
  id: string;
  title: string;
  createdAt: string;
  updatedAt: string;
  messages: ChatMessage[];
  rollingSummary?: string;
  activeTopicContext?: AiChatTopicContext | null;
  landmarkContext?: RecognitionResult | null;
  languageCode?: string;
  ownerId: string;
  hasUserMessages?: boolean;
}

export interface HistoryItem {
  id: string;
  landmark: RecognitionResult;
  timestamp: string;
  notes?: string;
  favorite?: boolean;
}

export type TravelerType = 'heritage_enthusiast' | 'foodie' | 'nature_explorer' | 'casual_tourist' | 'photographer';

export interface UserProfile {
  uid?: string;
  authMethod?: 'google' | 'local' | 'guest';
  name: string;
  email: string;
  preferredLanguage: string;
  travelerType: TravelerType;
  visitedCount: number;
  createdAt?: string;
  updatedAt?: string;
  badges: Array<{
    id: string;
    title: string;
    description: string;
    icon: string;
    unlockedAt: string;
  }>;
}

export interface OnboardingState {
  hasSeenIntro: boolean;
  hasCompletedTour: boolean;
  hasCompletedLoginSetup: boolean;
  skippedDirectly?: boolean;
}

export interface SavedLocationPreference {
  locationMode: 'gps' | 'manual';
  manualCityName?: string;
  manualStateName?: string;
  manualStateCode?: string;
  manualCountryName?: string;
  manualCountryCode?: string;
  manualPlaceId?: string;
  manualLocationVerified?: boolean;
  manualLatitude?: number | null;
  manualLongitude?: number | null;
}

export interface LocationCountryOption {
  code: string;
  name: string;
  localizedName: string;
  flag: string;
  hasStates?: boolean;
  aliases?: string[];
}

export interface LocationStateOption {
  code: string;
  name: string;
  countryCode: string;
}

export interface LocationCityOption {
  id: string;
  name: string;
  state?: string;
  stateCode?: string;
  country: string;
  countryCode: string;
  subtitle?: string;
  latitude: number | null;
  longitude: number | null;
  placeId?: string;
  source?: string;
  verified: boolean;
  isCustomEntry?: boolean;
}

export type ThemePreset = 'celestial' | 'sunset' | 'emerald' | 'daylight';

export interface ThemeOption {
  id: ThemePreset;
  name: string;
  subtitle: string;
  primaryColor: string;
  secondaryColor: string;
  bgPreview: string;
  iconName: string;
}

export const THEME_PRESETS: ThemeOption[] = [
  {
    id: 'celestial',
    name: 'Celestial Twilight',
    subtitle: 'Midnight Slate · Muted Gold · Serene Teal',
    primaryColor: '#C99A4E',
    secondaryColor: '#2A9D8F',
    bgPreview: 'from-[#111b2e] via-[#0b1220] to-[#060912]',
    iconName: 'Sparkles',
  },
  {
    id: 'sunset',
    name: 'Dusk Terracotta',
    subtitle: 'Deep Plum Slate · Muted Rose · Sandstone',
    primaryColor: '#B86566',
    secondaryColor: '#C98B5B',
    bgPreview: 'from-[#241421] via-[#150c15] to-[#0b060b]',
    iconName: 'Sunset',
  },
  {
    id: 'emerald',
    name: 'Botanical Pine',
    subtitle: 'Deep Forest Slate · Calm Jade · Muted Brass',
    primaryColor: '#2C8C6F',
    secondaryColor: '#B59A4B',
    bgPreview: 'from-[#10251f] via-[#091713] to-[#050d0b]',
    iconName: 'Leaf',
  },
  {
    id: 'daylight',
    name: 'Warm Stone Daylight',
    subtitle: 'Soft Linen · Heritage Bronze · Slate Teal',
    primaryColor: '#8C5A2B',
    secondaryColor: '#1F7A74',
    bgPreview: 'from-[#f7f6f2] via-[#efeeea] to-[#e5e4df]',
    iconName: 'Sun',
  },
];
