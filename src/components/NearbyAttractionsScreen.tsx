import React, { useState, useEffect, useMemo, useRef } from 'react';
import {
  GpsLocationStatus,
  GuideOutputMode,
  GuideSettings,
  Language,
  LocationCoords,
  PlaceRouteSummary,
} from '../types';
import { speechManager } from '../utils/speech';
import { AudioSpeedControl } from './AudioSpeedControl';
import {
  DeviceExactLocation,
  GeolocationLookupError,
  getDeviceExactLocation,
  getMapsNavigationUrl,
  openNativeMapsNavigation,
} from '../utils/geolocation';
import {
  formatRouteDuration,
  formatStraightLineDistance,
  notifyGmpQuotaExceededIfNeeded,
} from '../utils/placesEngine';
import { DeepDiveModal } from './DeepDiveModal';
import { PlaceCardImage } from './PlaceCardImage';
import { WordByWordText } from './WordByWordText';
import { VERIFIED_GROUND_TRUTH_POIS } from '../data/verifiedGroundTruthIndex';
import { translateTextBatch, useLocalizedTexts } from '../data/localizedStrings';
import { BackButton } from './BackButton';
import { useBackLayer, usePreservedScroll } from '../utils/navigationHistory';
import {
  Compass,
  MapPin,
  Sparkles,
  Volume2,
  Pause,
  Play,
  Navigation as NavIcon,
  Search,
  Landmark,
  ShieldCheck,
  Clock,
  Star,
  Globe,
  Info,
  CheckCircle2,
  ExternalLink,
  RefreshCw,
  X,
  BookOpen,
  Utensils,
  Building,
  Trees,
  Footprints,
  ShoppingBag,
  Gem,
  ArrowUpDown,
  Phone,
  Accessibility,
  MessageSquare,
  ChevronDown,
  ChevronUp,
} from 'lucide-react';

interface ExtendedSpotInfo {
  about: string;
  history: string;
  architecture: string;
  culture: string;
  folkloreNote: string;
  visitorInfo?: {
    address?: string;
    openingHours?: string[];
    openNow?: boolean;
    phone?: string;
    website?: string;
    accessibility?: string;
  };
  interestingFacts: string[];
  sourceAttribution?: string;
  wikipediaUrl?: string;
}

const NEARBY_UI_DEFAULTS = {
  exploreCity: 'Explore City',
  chooseCity: 'Choose City',
  refreshGps: 'Refresh GPS',
  locating: 'Locating...',
  retryGps: 'Retry GPS',
  chooseCityManually: 'Choose City Manually',
  distanceLabel: 'Distance:',
  catAll: 'All',
  catHistory: 'History',
  catCulture: 'Culture',
  catSpiritual: 'Spiritual',
  catFood: 'Food',
  catNature: 'Nature',
  catShopping: 'Shopping',
  catHiddenGems: 'Hidden Gems',
  sortNearest: 'Nearest',
  sortRelevant: 'Relevant',
  sortRating: 'Highly Rated',
  syncingRadar: 'Syncing live radar data side-by-side...',
  noPlacesFound: 'No places found in this filter range',
  whyVisit: 'Why visit:',
  guideNarration: 'Guide Narration',
  playingVoice: 'Playing voice...',
  listenNarration: 'Listen Narration',
  stopAudio: 'Stop Audio',
  navigate: 'Navigate',
  deepDive: 'Deep Dive',
  details: 'Details',
  moreLabel: 'More',
  lessLabel: 'Less',
  loadingDetails: 'Loading details...',
  sectionAbout: 'About',
  sectionHistory: 'History',
  sectionArchitecture: 'Architecture',
  sectionCulture: 'Culture & Traditions',
  sectionFolklore: 'Local Tradition / Folklore Note',
  sectionVisitorInfo: 'Visitor Info',
  sectionFacts: 'Interesting Facts',
  openInGoogleMaps: 'Open in Google Maps',
  viewOnGoogleMaps: 'View on Google Maps',
  askAiGuide: 'Ask AI Guide',
  sourceLabel: 'Source',
  searchPlaceholder: 'Search real places',
  locatingGpsTitle: 'Acquiring your GPS coordinates...',
  locationNeededTitle: 'Location Needed to Discover Real Nearby Places',
  locationNeededBody: 'Grant browser GPS access or pick a destination city manually to discover verified places and distances.',
  attractionsReady: 'attractions ready',
  searchingMatching: 'Searching real places matching',
  noPlacesHint: 'Try switching category or selecting a wider distance filter (5 km / 10 km / All) to explore attractions nearby.',
  openNow: 'Open now',
  closed: 'Closed',
  routeTravelTime: 'Route & Travel Time',
  calculatingRoute: 'Calculating route...',
  whyMustVisit: 'Why You Must Visit:',
  verifiedPlaceInfo: 'Verified Place Information',
  refreshingLiveInfo: 'Refreshing live info...',
  addressUnavailable: 'Address not available',
  openingHoursUnavailable: 'Opening hours: Not available',
  overviewHistory: 'Overview & History:',
  keyThingsToSpot: 'Key Things to Spot:',
  wheelchairEntrance: 'Wheelchair accessible entrance:',
  yesLabel: 'Yes',
  noLabel: 'No',
};

const MORE_LESS_INSTANT_SEEDS: Record<string, { more: string; less: string }> = {
  hi: { more: 'और जानें', less: 'कम दिखाएं' },
  mr: { more: 'अधिक माहिती', less: 'कमी दाखवा' },
  ur: { more: 'مزید تفصیلات', less: 'کم دکھائیں' },
};

export interface NearbyDiscoveredSpot {
  id: string;
  name: string;
  category: string;
  oneLineImportance: string;
  description: string;
  estimatedDistanceKm: number;
  straightLineLabel?: string;
  walkOrDriveTime: string;
  bestTimeToVisit?: string;
  addressOrLocality?: string;
  formattedAddress?: string;
  shortFormattedAddress?: string;
  keyHighlights: string[];
  imageUrl: string;
  rating?: number | null;
  reviewCount?: number | null;
  businessStatus?: string;
  regularOpeningHours?: {
    openNow?: boolean;
    weekdayDescriptions?: string[];
  };
  websiteUri?: string;
  nationalPhoneNumber?: string;
  accessibilityOptions?: {
    wheelchairAccessibleEntrance?: boolean;
    wheelchairAccessibleParking?: boolean;
    wheelchairAccessibleRestroom?: boolean;
    wheelchairAccessibleSeating?: boolean;
  };
  googleMapsUri?: string;
  latitude?: number;
  longitude?: number;
  source?: string;
  provider?: string;
  sourceVerified?: boolean;
  types?: string[];
  placeId?: string;
  googlePlaceId?: string;
  hasRealPhoto?: boolean;
  photoUnavailable?: boolean;
  authorAttributions?: Array<{
    displayName: string;
    uri?: string;
    photoUri?: string;
  }>;
  photos?: Array<{
    name: string;
    url: string;
    authorAttributions?: Array<{
      displayName: string;
      uri?: string;
      photoUri?: string;
    }>;
  }>;
}

interface NearbyAttractionsScreenProps {
  isActive?: boolean;
  locationCoords: LocationCoords | null;
  deviceExactLocation?: DeviceExactLocation | null;
  gpsStatus?: GpsLocationStatus;
  gpsError?: string | null;
  isManualLocationMode?: boolean;
  onRefreshDeviceLocation?: () => Promise<void>;
  onOpenCitySelector?: () => void;
  selectedLanguage: Language;
  onSelectAttractionForGuide: (attraction: any) => void;
  onOpenChatWithQuestion: (question: string) => void;
  onNavigateToPhotoGuide: () => void;
  onOpenCityGuide?: (cityName: string) => void;
  onBackToHome?: () => void;
  guideSettings?: GuideSettings;
  onUpdateSpeechRate?: (rate: number) => void;
  outputMode: GuideOutputMode;
}

function haversineDistanceKm(lat1: number, lon1: number, lat2: number, lon2: number): number {
  const R = 6371;
  const dLat = ((lat2 - lat1) * Math.PI) / 180;
  const dLon = ((lon2 - lon1) * Math.PI) / 180;
  const a =
    Math.sin(dLat / 2) * Math.sin(dLat / 2) +
    Math.cos((lat1 * Math.PI) / 180) *
      Math.cos((lat2 * Math.PI) / 180) *
      Math.sin(dLon / 2) *
      Math.sin(dLon / 2);
  const c = 2 * Math.atan2(Math.sqrt(a), Math.sqrt(1 - a));
  return R * c;
}

function buildInitialGroundTruthSpots(lat: number, lng: number, cityName: string): NearbyDiscoveredSpot[] {
  const cityLower = (cityName || '').toLowerCase();
  const sorted = [...VERIFIED_GROUND_TRUTH_POIS]
    .map((poi) => {
      const dist = haversineDistanceKm(lat, lng, poi.lat, poi.lng);
      const isCityMatch =
        cityLower.length > 0 &&
        (poi.city.toLowerCase().includes(cityLower) || cityLower.includes(poi.city.toLowerCase()));
      return { poi, dist, isCityMatch };
    })
    .filter(({ dist }) => dist <= 50)
    .sort((a, b) => {
      if (a.isCityMatch && !b.isCityMatch) return -1;
      if (!a.isCityMatch && b.isCityMatch) return 1;
      return a.dist - b.dist;
    })
    .slice(0, 16);

  return sorted.map(({ poi, dist }) => {
    const roundedDist = Math.round(dist * 10) / 10;
    const walkMin = Math.max(3, Math.round(dist * 12));
    const driveMin = Math.max(2, Math.round(dist * 2.5));
    const walkOrDriveTime = dist <= 1.5 ? `Est. ~${walkMin} min walk` : `Est. ~${driveMin} min drive`;

    const rawImg = poi.imageUrl || '';
    const proxiedImageUrl =
      rawImg && rawImg.startsWith('https://upload.wikimedia.org/')
        ? `/api/places/proxy-image?url=${encodeURIComponent(rawImg)}`
        : rawImg;

    return {
      id: `gt_${poi.name.toLowerCase().replace(/[^a-z0-9]/g, '_')}`,
      name: poi.name,
      category: poi.category,
      oneLineImportance: poi.oneLineSignificance,
      description: poi.oneLineSignificance,
      estimatedDistanceKm: roundedDist,
      straightLineLabel: formatStraightLineDistance(roundedDist),
      walkOrDriveTime,
      bestTimeToVisit: 'Morning or Evening',
      addressOrLocality: `${poi.locality}, ${poi.city}`,
      keyHighlights: poi.highlights,
      imageUrl: proxiedImageUrl,
      rating: poi.rating,
      reviewCount: poi.reviewCount,
      googleMapsUri: getMapsNavigationUrl({
        placeName: poi.name,
        localityOrCity: poi.city,
        latitude: poi.lat,
        longitude: poi.lng,
        preferDirections: false,
      }),
      latitude: poi.lat,
      longitude: poi.lng,
      source: 'verified_ground_truth_index',
      provider: 'curated_verified',
      sourceVerified: true,
      hasRealPhoto: Boolean(proxiedImageUrl),
      photoUnavailable: !proxiedImageUrl,
    };
  });
}

type ActiveCoordsState = {
  latitude: number;
  longitude: number;
  locationName: string;
  cityName: string;
  country: string;
};

export const NearbyAttractionsScreen: React.FC<NearbyAttractionsScreenProps> = ({
  isActive = true,
  locationCoords,
  deviceExactLocation,
  gpsStatus = 'idle',
  gpsError = null,
  isManualLocationMode = false,
  onRefreshDeviceLocation,
  onOpenCitySelector,
  selectedLanguage,
  onOpenChatWithQuestion,
  onOpenCityGuide,
  onBackToHome,
  guideSettings,
  onUpdateSpeechRate,
  outputMode,
}) => {
  const [currentCoords, setCurrentCoords] = useState<ActiveCoordsState | null>(() => {
    if (
      deviceExactLocation &&
      typeof deviceExactLocation.latitude === 'number' &&
      typeof deviceExactLocation.longitude === 'number' &&
      Number.isFinite(deviceExactLocation.latitude) &&
      Number.isFinite(deviceExactLocation.longitude)
    ) {
      return {
        latitude: deviceExactLocation.latitude,
        longitude: deviceExactLocation.longitude,
        locationName: deviceExactLocation.locationName,
        cityName: deviceExactLocation.city,
        country: deviceExactLocation.country || '',
      };
    }
    if (
      locationCoords &&
      typeof locationCoords.latitude === 'number' &&
      typeof locationCoords.longitude === 'number' &&
      Number.isFinite(locationCoords.latitude) &&
      Number.isFinite(locationCoords.longitude)
    ) {
      return {
        latitude: locationCoords.latitude,
        longitude: locationCoords.longitude,
        locationName: [locationCoords.city, locationCoords.country].filter(Boolean).join(', ') || 'Current GPS Area',
        cityName: locationCoords.city || '',
        country: locationCoords.country || '',
      };
    }
    return null;
  });

  const [isLocatingGps, setIsLocatingGps] = useState<boolean>(false);
  const [localGpsError, setLocalGpsError] = useState<string | null>(null);
  const [searchQuery, setSearchQuery] = useState('');
  const [selectedCategory, setSelectedCategory] = useState<string>('all');
  const [maxDistanceFilter, setMaxDistanceFilter] = useState<number>(0); // 0 = all, 0.5, 1, 2, 5, 10
  const [sortBy, setSortBy] = useState<'nearest' | 'relevant' | 'rating'>('nearest');

  // Real Spots fetched from Google Places + OSM + Curated Ground Truth (within 50 km)
  const [spots, setSpots] = useState<NearbyDiscoveredSpot[]>(() =>
    currentCoords
      ? buildInitialGroundTruthSpots(currentCoords.latitude, currentCoords.longitude, currentCoords.cityName)
      : []
  );
  const [textSearchSpots, setTextSearchSpots] = useState<NearbyDiscoveredSpot[]>([]);
  const [isSearchingText, setIsSearchingText] = useState<boolean>(false);
  const [areaOverview, setAreaOverview] = useState<string>('');
  const [isLoadingSpots, setIsLoadingSpots] = useState<boolean>(false);
  const [isSyncingLive, setIsSyncingLive] = useState<boolean>(Boolean(currentCoords));

  // Audio Playback state
  const [activePlayingId, setActivePlayingId] = useState<string | null>(null);

  // Modal states
  const [selectedDetailSpot, setSelectedDetailSpot] = useState<NearbyDiscoveredSpot | null>(null);
  const [spotDetailsExtra, setSpotDetailsExtra] = useState<Partial<NearbyDiscoveredSpot> | null>(null);
  const [isLoadingDetails, setIsLoadingDetails] = useState<boolean>(false);
  const [selectedTravelMode, setSelectedTravelMode] = useState<'DRIVE' | 'WALK' | 'TWO_WHEELER' | 'TRANSIT'>('DRIVE');
  const [routeSummary, setRouteSummary] = useState<PlaceRouteSummary | null>(null);
  const [isLoadingRoute, setIsLoadingRoute] = useState<boolean>(false);
  const [deepDiveSpot, setDeepDiveSpot] = useState<NearbyDiscoveredSpot | null>(null);

  // Multilingual UI & dynamic spot text synchronization
  const { t: ui } = useLocalizedTexts(NEARBY_UI_DEFAULTS, selectedLanguage, 'Nearby attractions discovery cards and filters');
  const moreButtonText = MORE_LESS_INSTANT_SEEDS[selectedLanguage.code]?.more || ui.moreLabel;
  const lessButtonText = MORE_LESS_INSTANT_SEEDS[selectedLanguage.code]?.less || ui.lessLabel;

  const [translatedSpotCopy, setTranslatedSpotCopy] = useState<Record<string, { oneLineImportance: string; description: string }>>({});
  const [translatedAreaOverview, setTranslatedAreaOverview] = useState<string>('');
  const activeLangCodeRef = useRef<string>(selectedLanguage.code);
  activeLangCodeRef.current = selectedLanguage.code;
  const translationReqIdRef = useRef<number>(0);

  // Expandable More / Less inline info state & short-lived client spots cache
  const spotsCacheRef = useRef<Map<string, { spots: NearbyDiscoveredSpot[]; areaOverview: string; expiresAt: number }>>(new Map());
  const [expandedSpotIds, setExpandedSpotIds] = useState<Record<string, boolean>>({});
  const [extendedSpotData, setExtendedSpotData] = useState<Record<string, ExtendedSpotInfo>>({});
  const [extendedSpotLoading, setExtendedSpotLoading] = useState<Record<string, boolean>>({});
  const listScrollRef = usePreservedScroll<HTMLDivElement>('tab:nearby', isActive);

  useEffect(() => {
    if (!isActive) {
      speechManager.stop();
      setActivePlayingId(null);
    }
  }, [isActive]);

  useBackLayer(
    'nearby-spot-detail',
    isActive && Boolean(selectedDetailSpot),
    () => setSelectedDetailSpot(null),
    60
  );
  useBackLayer(
    'nearby-deep-dive',
    isActive && Boolean(deepDiveSpot),
    () => setDeepDiveSpot(null),
    65
  );

  // Sync with deviceExactLocation / locationCoords props
  useEffect(() => {
    if (
      deviceExactLocation &&
      typeof deviceExactLocation.latitude === 'number' &&
      typeof deviceExactLocation.longitude === 'number' &&
      Number.isFinite(deviceExactLocation.latitude) &&
      Number.isFinite(deviceExactLocation.longitude)
    ) {
      setCurrentCoords({
        latitude: deviceExactLocation.latitude,
        longitude: deviceExactLocation.longitude,
        locationName: deviceExactLocation.locationName,
        cityName: deviceExactLocation.city,
        country: deviceExactLocation.country || '',
      });
      setLocalGpsError(null);
    } else if (
      locationCoords &&
      typeof locationCoords.latitude === 'number' &&
      typeof locationCoords.longitude === 'number' &&
      Number.isFinite(locationCoords.latitude) &&
      Number.isFinite(locationCoords.longitude)
    ) {
      setCurrentCoords({
        latitude: locationCoords.latitude,
        longitude: locationCoords.longitude,
        locationName: [locationCoords.city, locationCoords.country].filter(Boolean).join(', ') || 'Current GPS Area',
        cityName: locationCoords.city || '',
        country: locationCoords.country || '',
      });
    } else {
      setCurrentCoords(null);
    }
  }, [deviceExactLocation, locationCoords]);

  // Reset local preview list cleanly whenever active coordinates change
  useEffect(() => {
    if (!currentCoords) {
      setSpots([]);
      setAreaOverview('');
      setIsSyncingLive(false);
      return;
    }
    setSpots(buildInitialGroundTruthSpots(currentCoords.latitude, currentCoords.longitude, currentCoords.cityName));
    setAreaOverview('');
  }, [currentCoords?.latitude, currentCoords?.longitude, currentCoords?.cityName]);

  // Fetch Spots specifically near current GPS/selected coordinates using Google Places + OSM + Curated DB
  useEffect(() => {
    if (!currentCoords) {
      setIsSyncingLive(false);
      setIsLoadingSpots(false);
      return;
    }

    let isMounted = true;
    const controller = new AbortController();
    const radiusMeters = maxDistanceFilter > 0 ? Math.round(maxDistanceFilter * 1000) : 10000;
    const clientCacheKey = `${currentCoords.latitude.toFixed(3)}:${currentCoords.longitude.toFixed(3)}:${selectedCategory}:${radiusMeters}:${selectedLanguage.code}`;
    const cachedHit = spotsCacheRef.current.get(clientCacheKey);

    if (cachedHit && cachedHit.expiresAt > Date.now()) {
      setSpots(cachedHit.spots);
      setAreaOverview(cachedHit.areaOverview);
      setIsLoadingSpots(false);
      setIsSyncingLive(false);
      return;
    }

    async function fetchSpots() {
      setIsSyncingLive(true);
      try {
        const res = await fetch('/api/discover-nearby-spots', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({
            latitude: currentCoords!.latitude,
            longitude: currentCoords!.longitude,
            locationName: currentCoords!.locationName,
            city: currentCoords!.cityName,
            country: currentCoords!.country,
            language: selectedLanguage.name,
            category: selectedCategory,
            radiusMeters,
          }),
          signal: controller.signal,
        });

        notifyGmpQuotaExceededIfNeeded(res.status);
        const data = await res.json().catch(() => ({}));
        notifyGmpQuotaExceededIfNeeded(data);

        if (res.ok && isMounted && data.success) {
          const nextSpots = Array.isArray(data.spots) ? data.spots : spots;
          const nextOverview = data.areaOverview || '';
          if (Array.isArray(data.spots)) {
            setSpots(data.spots);
          }
          if (data.areaOverview) setAreaOverview(data.areaOverview);
          spotsCacheRef.current.set(clientCacheKey, {
            spots: nextSpots,
            areaOverview: nextOverview,
            expiresAt: Date.now() + 5 * 60 * 1000,
          });
        }
      } catch (err: any) {
        if (err?.name !== 'AbortError') {
          console.warn('Failed to load real spots:', err);
        }
      } finally {
        if (isMounted) {
          setIsLoadingSpots(false);
          setIsSyncingLive(false);
        }
      }
    }

    fetchSpots();

    return () => {
      isMounted = false;
      controller.abort();
      speechManager.stop();
      setActivePlayingId(null);
    };
  }, [
    currentCoords?.latitude,
    currentCoords?.longitude,
    currentCoords?.locationName,
    selectedLanguage.name,
    selectedLanguage.code,
    selectedCategory,
    maxDistanceFilter,
  ]);

  // Translate dynamic spot summaries & descriptions smoothly on language changes (race-guarded)
  useEffect(() => {
    const langCode = selectedLanguage.code;
    if (langCode === 'en' || (spots.length === 0 && !areaOverview)) {
      setTranslatedAreaOverview('');
      return;
    }

    const reqId = ++translationReqIdRef.current;
    let cancelled = false;
    const payload: Record<string, string> = {};
    if (areaOverview && areaOverview.trim()) {
      payload.areaOverview = areaOverview;
    }

    const targets = spots.slice(0, 18);
    targets.forEach((spot) => {
      const cacheKey = `${spot.id}::${langCode}`;
      if (!translatedSpotCopy[cacheKey]) {
        if (spot.oneLineImportance) payload[`imp::${spot.id}`] = spot.oneLineImportance;
        if (spot.description && spot.description !== spot.oneLineImportance) {
          payload[`desc::${spot.id}`] = spot.description;
        }
      }
    });

    if (Object.keys(payload).length === 0) return;

    translateTextBatch(payload, selectedLanguage, 'Nearby tourist attraction short summary and description').then(
      (translated) => {
        if (cancelled || translationReqIdRef.current !== reqId || activeLangCodeRef.current !== langCode) {
          return;
        }
        if (translated.areaOverview) {
          setTranslatedAreaOverview(translated.areaOverview);
        }
        setTranslatedSpotCopy((prev) => {
          const next = { ...prev };
          targets.forEach((spot) => {
            const imp = translated[`imp::${spot.id}`] || spot.oneLineImportance;
            const desc = translated[`desc::${spot.id}`] || imp || spot.description;
            next[`${spot.id}::${langCode}`] = { oneLineImportance: imp, description: desc };
          });
          return next;
        });
      }
    );

    return () => {
      cancelled = true;
    };
  }, [spots, areaOverview, selectedLanguage]);

  // Debounced Google Places Text Search when typing >= 3 characters in the search box
  useEffect(() => {
    const trimmed = searchQuery.trim();
    if (trimmed.length < 3 || !currentCoords) {
      setTextSearchSpots([]);
      setIsSearchingText(false);
      return;
    }

    const controller = new AbortController();
    let isMounted = true;
    const timer = setTimeout(async () => {
      setIsSearchingText(true);
      try {
        const res = await fetch('/api/places/search-text', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({
            textQuery: `${trimmed} ${currentCoords.cityName && currentCoords.cityName !== 'Current Area' && currentCoords.cityName !== 'Current GPS Area' ? currentCoords.cityName : ''}`.trim(),
            latitude: currentCoords.latitude,
            longitude: currentCoords.longitude,
            radiusMeters: maxDistanceFilter > 0 ? Math.round(maxDistanceFilter * 1000) : 15000,
            language: selectedLanguage.name,
          }),
          signal: controller.signal,
        });

        notifyGmpQuotaExceededIfNeeded(res.status);
        const data = await res.json().catch(() => ({}));
        notifyGmpQuotaExceededIfNeeded(data);

        if (isMounted && res.ok && data.success && Array.isArray(data.places)) {
          setTextSearchSpots(data.places);
        }
      } catch (err: any) {
        if (err?.name !== 'AbortError') {
          console.warn('Places text search failed:', err);
        }
      } finally {
        if (isMounted) setIsSearchingText(false);
      }
    }, 380);

    return () => {
      isMounted = false;
      clearTimeout(timer);
      controller.abort();
    };
  }, [searchQuery, currentCoords?.latitude, currentCoords?.longitude, currentCoords?.cityName, maxDistanceFilter, selectedLanguage.name]);

  // On-demand Google Places Details when opening Details modal
  useEffect(() => {
    if (!selectedDetailSpot) {
      setSpotDetailsExtra(null);
      setIsLoadingDetails(false);
      return;
    }

    const targetPlaceId = selectedDetailSpot.googlePlaceId || selectedDetailSpot.placeId;
    if (
      !targetPlaceId ||
      targetPlaceId.startsWith('osm-') ||
      targetPlaceId.startsWith('gt_') ||
      !/^[A-Za-z0-9_-]{8,}$/.test(targetPlaceId)
    ) {
      setSpotDetailsExtra(null);
      setIsLoadingDetails(false);
      return;
    }

    let isMounted = true;
    const controller = new AbortController();
    setIsLoadingDetails(true);
    setSpotDetailsExtra(null);

    fetch(
      `/api/places/details?placeId=${encodeURIComponent(targetPlaceId)}&language=${encodeURIComponent(
        selectedLanguage.name
      )}`,
      { signal: controller.signal }
    )
      .then(async (res) => {
        notifyGmpQuotaExceededIfNeeded(res.status);
        const data = await res.json().catch(() => ({}));
        notifyGmpQuotaExceededIfNeeded(data);
        if (isMounted && res.ok && data.success && data.details) {
          setSpotDetailsExtra(data.details);
        }
      })
      .catch((err) => {
        if (err?.name !== 'AbortError') {
          console.warn('Place details lookup failed:', err);
        }
      })
      .finally(() => {
        if (isMounted) setIsLoadingDetails(false);
      });

    return () => {
      isMounted = false;
      controller.abort();
    };
  }, [selectedDetailSpot?.id, selectedLanguage.name]);

  // On-demand Google Routes API v2 computation when Details modal is open & travel mode changes
  useEffect(() => {
    if (
      !selectedDetailSpot ||
      !currentCoords ||
      typeof selectedDetailSpot.latitude !== 'number' ||
      typeof selectedDetailSpot.longitude !== 'number' ||
      !Number.isFinite(selectedDetailSpot.latitude) ||
      !Number.isFinite(selectedDetailSpot.longitude)
    ) {
      setRouteSummary(null);
      setIsLoadingRoute(false);
      return;
    }

    let isMounted = true;
    const controller = new AbortController();
    setIsLoadingRoute(true);

    fetch('/api/routes/compute', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        origin: {
          latitude: currentCoords.latitude,
          longitude: currentCoords.longitude,
        },
        destination: {
          latitude: selectedDetailSpot.latitude,
          longitude: selectedDetailSpot.longitude,
        },
        travelMode: selectedTravelMode,
        languageCode: selectedLanguage.code,
      }),
      signal: controller.signal,
    })
      .then(async (res) => {
        notifyGmpQuotaExceededIfNeeded(res.status);
        const data = await res.json().catch(() => ({}));
        notifyGmpQuotaExceededIfNeeded(data);
        if (!isMounted) return;
        if (res.ok && data.success) {
          if (data.available && data.route) {
            setRouteSummary(data.route);
          } else {
            setRouteSummary({
              available: false,
              travelMode: selectedTravelMode,
              unavailableReason: data.unavailableReason || 'Route unavailable',
            });
          }
        }
      })
      .catch((err) => {
        if (err?.name !== 'AbortError') {
          console.warn('Routes computation failed:', err);
        }
      })
      .finally(() => {
        if (isMounted) setIsLoadingRoute(false);
      });

    return () => {
      isMounted = false;
      controller.abort();
    };
  }, [selectedDetailSpot?.id, selectedTravelMode, currentCoords?.latitude, currentCoords?.longitude, selectedLanguage.code]);

  // Lazy fetch grounded extended info for inline More / Less panel (cached per place + language)
  const fetchExtendedSpotInfo = async (spot: NearbyDiscoveredSpot, lang: Language) => {
    const cacheKey = `${spot.id}::${lang.code}`;
    if (extendedSpotData[cacheKey] || extendedSpotLoading[cacheKey]) return;

    setExtendedSpotLoading((prev) => ({ ...prev, [cacheKey]: true }));
    try {
      const res = await fetch('/api/places/extended-info', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          placeId: spot.placeId,
          googlePlaceId: spot.googlePlaceId,
          name: spot.name,
          category: spot.category,
          addressOrLocality: spot.formattedAddress || spot.addressOrLocality,
          city: currentCoords?.cityName || '',
          country: currentCoords?.country || '',
          latitude: spot.latitude,
          longitude: spot.longitude,
          language: lang.name,
          existingDescription: spot.description || spot.oneLineImportance,
          existingHighlights: spot.keyHighlights || [],
        }),
      });
      const data = await res.json().catch(() => ({}));
      if (res.ok && data.success) {
        setExtendedSpotData((prev) => ({
          ...prev,
          [cacheKey]: {
            about: data.about || '',
            history: data.history || '',
            architecture: data.architecture || '',
            culture: data.culture || '',
            folkloreNote: data.folkloreNote || '',
            visitorInfo: data.visitorInfo,
            interestingFacts: Array.isArray(data.interestingFacts) ? data.interestingFacts : [],
            sourceAttribution: data.sourceAttribution || '',
            wikipediaUrl: data.wikipediaUrl || '',
          },
        }));
      }
    } catch (err) {
      console.warn('Extended spot info lookup failed:', err);
    } finally {
      setExtendedSpotLoading((prev) => ({ ...prev, [cacheKey]: false }));
    }
  };

  const handleToggleExpandSpot = (spot: NearbyDiscoveredSpot) => {
    const nextOpen = !expandedSpotIds[spot.id];
    setExpandedSpotIds((prev) => ({ ...prev, [spot.id]: nextOpen }));
    if (nextOpen) {
      fetchExtendedSpotInfo(spot, selectedLanguage);
    }
  };

  // Re-fetch extended info automatically if user switches language while cards are expanded
  useEffect(() => {
    const openIds = Object.keys(expandedSpotIds).filter((id) => expandedSpotIds[id]);
    if (openIds.length === 0) return;
    openIds.forEach((id) => {
      const match = spots.find((s) => s.id === id) || textSearchSpots.find((s) => s.id === id);
      if (match) {
        fetchExtendedSpotInfo(match, selectedLanguage);
      }
    });
  }, [selectedLanguage.code]);

  const handleRequestExactLocation = async () => {
    setIsLocatingGps(true);
    setLocalGpsError(null);
    try {
      if (onRefreshDeviceLocation) {
        await onRefreshDeviceLocation();
      } else {
        const loc = await getDeviceExactLocation();
        setCurrentCoords({
          latitude: loc.latitude,
          longitude: loc.longitude,
          locationName: loc.locationName,
          cityName: loc.city,
          country: loc.country || '',
        });
      }
    } catch (e: any) {
      if (e instanceof GeolocationLookupError) {
        setLocalGpsError(e.message);
      } else {
        setLocalGpsError(e?.message || 'Unable to acquire device GPS location.');
      }
      console.warn('Error refreshing location:', e);
    } finally {
      setIsLocatingGps(false);
    }
  };

  // Audio Playback
  const handleTogglePlayAudio = (spot: NearbyDiscoveredSpot) => {
    if (activePlayingId === spot.id) {
      speechManager.stop();
      setActivePlayingId(null);
      return;
    }

    speechManager.stop();
    const cityLabel = spot.addressOrLocality || currentCoords?.cityName || 'this area';
    const narrationText = `${spot.name}, located ${spot.estimatedDistanceKm} kilometers away in ${cityLabel}. ${spot.oneLineImportance} ${spot.description}`;

    speechManager.speak({
      text: narrationText,
      language: selectedLanguage.name,
      languageCode: selectedLanguage.speechCode,
      rate: guideSettings?.speechRate || 1.0,
      pitch: guideSettings?.voicePitch || (guideSettings?.voiceGender === 'male' ? 0.95 : 1.08),
      gender: guideSettings?.voiceGender || 'female',
      onStart: () => setActivePlayingId(spot.id),
      onEnd: () => setActivePlayingId(null),
      onError: () => setActivePlayingId(null),
    });
  };

  // Open in Google Maps / Native Maps Navigation with Place ID & Travel Mode
  const handleOpenGoogleMaps = (
    spot: NearbyDiscoveredSpot,
    travelMode?: 'DRIVE' | 'WALK' | 'TWO_WHEELER' | 'TRANSIT'
  ) => {
    const modeLookup: Record<string, 'driving' | 'walking' | 'bicycling' | 'transit'> = {
      DRIVE: 'driving',
      WALK: 'walking',
      TWO_WHEELER: 'bicycling',
      TRANSIT: 'transit',
    };
    openNativeMapsNavigation({
      placeName: spot.name,
      localityOrCity: spot.addressOrLocality || currentCoords?.cityName,
      latitude: spot.latitude,
      longitude: spot.longitude,
      placeId: spot.googlePlaceId || spot.placeId,
      googleMapsUri: spot.googleMapsUri,
      travelMode: travelMode ? modeLookup[travelMode] : undefined,
    });
  };

  // Category filter definitions localized dynamically
  const categories = [
    { id: 'all', label: ui.catAll, icon: Compass },
    { id: 'history', label: ui.catHistory, icon: Building },
    { id: 'culture', label: ui.catCulture, icon: Landmark },
    { id: 'spiritual', label: ui.catSpiritual, icon: ShieldCheck },
    { id: 'food', label: ui.catFood, icon: Utensils },
    { id: 'nature', label: ui.catNature, icon: Trees },
    { id: 'shopping', label: ui.catShopping, icon: ShoppingBag },
    { id: 'hiddengems', label: ui.catHiddenGems, icon: Gem },
  ];

  // Merge Nearby Radar spots + optional Text Search spots without duplicates, then Filter & Sort
  const filteredSpots = useMemo(() => {
    const mergedPool: NearbyDiscoveredSpot[] = [...spots];
    for (const ts of textSearchSpots) {
      const exists = mergedPool.some(
        (p) =>
          (p.placeId && ts.placeId && p.placeId === ts.placeId) ||
          p.name.trim().toLowerCase() === ts.name.trim().toLowerCase()
      );
      if (!exists) {
        mergedPool.push(ts);
      }
    }

    let result = mergedPool.filter((spot) => {
      const matchesSearch =
        searchQuery === '' ||
        spot.name.toLowerCase().includes(searchQuery.toLowerCase()) ||
        spot.oneLineImportance.toLowerCase().includes(searchQuery.toLowerCase()) ||
        spot.description.toLowerCase().includes(searchQuery.toLowerCase()) ||
        (spot.addressOrLocality && spot.addressOrLocality.toLowerCase().includes(searchQuery.toLowerCase()));

      let matchesCat = selectedCategory === 'all';
      if (!matchesCat) {
        const spotCat = (spot.category || '').toLowerCase();
        const spotName = (spot.name || '').toLowerCase();
        const spotTypes = ((spot.types || []).join(' ')).toLowerCase();

        if (selectedCategory === 'spiritual' || selectedCategory === 'temple' || selectedCategory === 'temples') {
          matchesCat =
            spotCat === 'spiritual' ||
            spotCat === 'temple' ||
            spotCat === 'shrine' ||
            spotCat === 'place_of_worship' ||
            spotCat === 'hindu_temple' ||
            spotCat.includes('temple') ||
            spotCat.includes('spiritual') ||
            spotName.includes('temple') ||
            spotName.includes('mandir') ||
            spotName.includes('tekdi') ||
            spotName.includes('ganesh') ||
            spotName.includes('ganpati') ||
            spotName.includes('stupa') ||
            spotName.includes('deekshabhoomi') ||
            spotName.includes('church') ||
            spotName.includes('mosque') ||
            spotName.includes('dargah') ||
            spotName.includes('gurudwara') ||
            spotName.includes('kovil') ||
            spotTypes.includes('hindu_temple') ||
            spotTypes.includes('place_of_worship') ||
            spotTypes.includes('temple') ||
            spotTypes.includes('shrine');
        } else if (selectedCategory === 'history') {
          matchesCat =
            spotCat === 'history' ||
            spotCat === 'monument' ||
            spotCat === 'historical' ||
            spotCat === 'fort' ||
            spotName.includes('fort') ||
            spotName.includes('memorial') ||
            spotName.includes('zero mile') ||
            spotTypes.includes('historical_place') ||
            spotTypes.includes('fortress') ||
            spotTypes.includes('monument');
        } else if (selectedCategory === 'culture') {
          matchesCat =
            spotCat === 'culture' ||
            spotCat === 'museum' ||
            spotName.includes('museum') ||
            spotName.includes('science') ||
            spotTypes.includes('museum') ||
            spotTypes.includes('cultural_center');
        } else if (selectedCategory === 'nature') {
          matchesCat =
            spotCat === 'nature' ||
            spotCat === 'lake' ||
            spotCat === 'viewpoint' ||
            spotCat === 'park' ||
            spotName.includes('lake') ||
            spotName.includes('garden') ||
            spotName.includes('hills') ||
            spotName.includes('park') ||
            spotTypes.includes('park') ||
            spotTypes.includes('natural_feature') ||
            spotTypes.includes('lake');
        } else if (selectedCategory === 'food') {
          matchesCat =
            spotCat === 'food' ||
            spotCat === 'restaurant' ||
            spotCat === 'cafe' ||
            spotCat === 'bakery' ||
            spotName.includes('food') ||
            spotName.includes('bakery') ||
            spotName.includes('cafe') ||
            spotName.includes('poha') ||
            spotName.includes('saoji') ||
            spotName.includes('haldiram') ||
            spotName.includes('khau gali') ||
            spotName.includes('sweets') ||
            spotName.includes('dining') ||
            spotName.includes('dhaba') ||
            spotName.includes('biryani') ||
            spotName.includes('bhavan') ||
            spotName.includes('kitchen') ||
            spotTypes.includes('restaurant') ||
            spotTypes.includes('cafe') ||
            spotTypes.includes('bakery') ||
            spotTypes.includes('food') ||
            spotTypes.includes('fast_food') ||
            spotTypes.includes('meal_takeaway');
        } else if (selectedCategory === 'shopping') {
          matchesCat =
            spotCat === 'shopping' ||
            spotCat === 'bazaar' ||
            spotCat === 'market' ||
            spotCat.includes('shopping') ||
            spotCat.includes('market') ||
            spotCat.includes('bazaar') ||
            spotCat.includes('mall') ||
            spotName.includes('market') ||
            spotName.includes('bazaar') ||
            spotName.includes('mall') ||
            spotName.includes('sarafa') ||
            spotName.includes('handloom') ||
            spotName.includes('textile') ||
            spotName.includes('emporium') ||
            spotTypes.includes('market') ||
            spotTypes.includes('marketplace') ||
            spotTypes.includes('shopping_mall') ||
            spotTypes.includes('store') ||
            spotTypes.includes('shop');
        } else if (selectedCategory === 'hiddengems') {
          matchesCat =
            spotCat === 'hiddengems' ||
            spotCat.includes('gem') ||
            spotCat.includes('hidden') ||
            spotCat.includes('secret') ||
            spotName.includes('stepwell') ||
            spotName.includes('baoli') ||
            spotName.includes('pillar') ||
            spotName.includes('viewpoint') ||
            spotName.includes('mystery') ||
            spotName.includes('secret') ||
            spotName.includes('hidden') ||
            spotName.includes('cave');
        } else {
          matchesCat = spotCat.includes(selectedCategory.toLowerCase()) || spotName.includes(selectedCategory.toLowerCase());
        }
      }

      const matchesDist =
        maxDistanceFilter === 0 || spot.estimatedDistanceKm <= maxDistanceFilter;

      return matchesSearch && matchesCat && matchesDist;
    });

    // Apply Sorting cleanly with null-safe checks (never fabricate default 4.5 or 100 ratings)
    if (sortBy === 'nearest') {
      result.sort((a, b) => a.estimatedDistanceKm - b.estimatedDistanceKm);
    } else if (sortBy === 'rating') {
      result.sort((a, b) => (typeof b.rating === 'number' ? b.rating : -1) - (typeof a.rating === 'number' ? a.rating : -1));
    } else if (sortBy === 'relevant') {
      result.sort((a, b) => (typeof b.reviewCount === 'number' ? b.reviewCount : -1) - (typeof a.reviewCount === 'number' ? a.reviewCount : -1));
    }

    return result;
  }, [spots, textSearchSpots, searchQuery, selectedCategory, maxDistanceFilter, sortBy]);

  const effectiveGpsError = localGpsError || gpsError;

  return (
    <div
      id="nearby-attractions-screen"
      dir={selectedLanguage.direction === 'rtl' ? 'rtl' : 'ltr'}
      className="h-full flex flex-col overflow-hidden overflow-clip py-1 space-y-2 select-none"
    >
      {/* Location Banner */}
      <div
        style={{
          backgroundColor: 'var(--theme-card-bg)',
          borderColor: 'var(--theme-card-border)',
        }}
        className="shrink-0 p-3 rounded-2xl border shadow-lg flex flex-col sm:flex-row items-start sm:items-center justify-between gap-2.5 backdrop-blur-xl"
      >
        <div className="min-w-0 flex-1 flex items-start gap-2.5">
          {onBackToHome && (
            <BackButton
              id="btn-nearby-back-home"
              onClick={() => {
                speechManager.stop();
                setActivePlayingId(null);
                onBackToHome();
              }}
              selectedLanguage={selectedLanguage}
              className="mt-0.5"
            />
          )}
          <div className="min-w-0 flex-1">
            <div className="flex items-center gap-2 flex-wrap">
              <h2 className="text-xs sm:text-sm font-serif font-bold text-[var(--theme-text-title)] truncate">
                {currentCoords?.locationName ||
                  (gpsStatus === 'locating' ? 'Locating your GPS coordinates...' : 'Location Access Required')}
              </h2>

              {currentCoords?.cityName && currentCoords.cityName !== 'Current Area' && currentCoords.cityName !== 'Current GPS Area' && onOpenCityGuide && (
                <button
                  id="btn-nearby-explore-city"
                  onClick={() => onOpenCityGuide(currentCoords.cityName)}
                  className="px-2.5 py-0.5 rounded-full theme-badge-gold text-[10.5px] font-bold flex items-center gap-1 cursor-pointer active:scale-95 transition-all shadow-sm"
                  title={`Explore brief and in-depth guide for ${currentCoords.cityName}`}
                >
                  <Sparkles className="w-3 h-3 text-[var(--theme-accent-primary)]" />
                  <span>{ui.exploreCity}</span>
                </button>
              )}
            </div>
            <p className="text-[11px] text-[var(--theme-text-muted)] line-clamp-1 mt-0.5">
              {(selectedLanguage.code !== 'en' && translatedAreaOverview) ||
                areaOverview ||
                (currentCoords
                  ? `Discovered ${spots.length} verified places in ${currentCoords.cityName}.`
                  : effectiveGpsError || 'Enable GPS or select a destination city to discover nearby attractions.')}
            </p>
          </div>
        </div>

        <div className="flex items-center gap-2 shrink-0">
          {onOpenCitySelector && (
            <button
              type="button"
              onClick={onOpenCitySelector}
              style={{
                backgroundColor: 'var(--theme-card-bg-subtle)',
                color: 'var(--theme-text-title)',
                borderColor: 'var(--theme-card-border)',
              }}
              className="px-3 py-1.5 rounded-xl text-xs font-bold flex items-center gap-1.5 border cursor-pointer active:scale-95 transition-all shadow-sm hover:border-[var(--theme-card-border-glow)]"
            >
              <MapPin className="w-3.5 h-3.5 text-[var(--theme-accent-primary)]" />
              <span>{ui.chooseCity}</span>
            </button>
          )}
          {!isManualLocationMode && (
            <button
              onClick={handleRequestExactLocation}
              disabled={isLocatingGps}
              style={{
                backgroundColor: 'var(--theme-card-bg-subtle)',
                color: 'var(--theme-accent-primary)',
                borderColor: 'var(--theme-card-border)',
              }}
              className="px-3 py-1.5 rounded-xl text-xs font-bold flex items-center gap-1.5 border cursor-pointer active:scale-95 transition-all shadow-sm hover:border-[var(--theme-card-border-glow)]"
              title="Refresh device live GPS location"
            >
              <RefreshCw className={`w-3.5 h-3.5 text-[var(--theme-accent-primary)] ${isLocatingGps ? 'animate-spin' : ''}`} />
              <span>{isLocatingGps ? ui.locating : ui.refreshGps}</span>
            </button>
          )}
        </div>
      </div>

      {/* Explore Nearby Filter Controls */}
      <div className="shrink-0 space-y-2">
        {/* Search Input and Sort Selector */}
        <div className="flex items-center gap-2">
          <div className="relative flex-1">
            <Search className="w-4 h-4 absolute left-3 top-2.5 text-[var(--theme-accent-primary)]" />
            <input
              type="text"
              value={searchQuery}
              onChange={(e) => setSearchQuery(e.target.value)}
              placeholder={`${ui.searchPlaceholder}${currentCoords?.cityName ? ` · ${currentCoords.cityName}` : ''}...`}
              style={{
                backgroundColor: 'var(--theme-input-bg)',
                borderColor: 'var(--theme-input-border)',
                color: 'var(--theme-text-title)',
              }}
              className="w-full pl-9 pr-3 py-2 rounded-xl border placeholder-[var(--theme-text-muted)] text-xs sm:text-sm focus:outline-none focus:border-[var(--theme-card-border-glow)] backdrop-blur-md transition-colors"
            />
          </div>

          {/* Sort Menu */}
          <div
            style={{
              backgroundColor: 'var(--theme-card-bg)',
              borderColor: 'var(--theme-card-border)',
            }}
            className="shrink-0 flex items-center gap-1 px-2 py-1.5 rounded-xl border text-xs backdrop-blur-md"
          >
            <ArrowUpDown className="w-3.5 h-3.5 text-[var(--theme-accent-primary)]" />
            <select
              value={sortBy}
              onChange={(e: any) => setSortBy(e.target.value)}
              aria-label="Sort places by"
              style={{ color: 'var(--theme-accent-primary)' }}
              className="bg-transparent text-xs font-bold focus:outline-none cursor-pointer"
            >
              <option value="nearest" style={{ backgroundColor: 'var(--theme-card-bg)', color: 'var(--theme-text-title)' }}>{ui.sortNearest}</option>
              <option value="relevant" style={{ backgroundColor: 'var(--theme-card-bg)', color: 'var(--theme-text-title)' }}>{ui.sortRelevant}</option>
              <option value="rating" style={{ backgroundColor: 'var(--theme-card-bg)', color: 'var(--theme-text-title)' }}>{ui.sortRating}</option>
            </select>
          </div>
        </div>

        {/* Distance Filters Bar: 500m, 1km, 2km, 5km, 10km, All */}
        <div className="flex items-center gap-1.5 overflow-x-auto pb-0.5 scrollbar-none text-[11px]">
          <span className="text-[var(--theme-accent-primary)] font-bold px-1 flex items-center gap-1 shrink-0">
            <Footprints className="w-3.5 h-3.5 text-[var(--theme-accent-primary)]" />
            {ui.distanceLabel}
          </span>
          {[
            { val: 0, label: ui.catAll },
            { val: 0.5, label: '500m' },
            { val: 1.0, label: '1 km' },
            { val: 2.0, label: '2 km' },
            { val: 5.0, label: '5 km' },
            { val: 10.0, label: '10 km' },
          ].map((r) => (
            <button
              key={r.val}
              onClick={() => setMaxDistanceFilter(r.val)}
              style={
                maxDistanceFilter === r.val
                  ? {
                      background: 'var(--theme-accent-primary-gradient)',
                      color: 'var(--theme-accent-primary-text)',
                      borderColor: 'var(--theme-accent-primary)',
                    }
                  : {
                      backgroundColor: 'var(--theme-card-bg)',
                      color: 'var(--theme-text-body)',
                      borderColor: 'var(--theme-card-border)',
                    }
              }
              className="px-2.5 py-1 rounded-lg font-bold shrink-0 cursor-pointer transition-all border shadow-sm"
            >
              {r.label}
            </button>
          ))}
        </div>

        {/* Explore Nearby Category Filter Chips */}
        <div className="flex items-center gap-1.5 overflow-x-auto pb-1 scrollbar-none">
          {categories.map((cat) => {
            const Icon = cat.icon;
            const isSelected = selectedCategory === cat.id;
            return (
              <button
                key={cat.id}
                onClick={() => setSelectedCategory(cat.id)}
                style={
                  isSelected
                    ? {
                        background: 'var(--theme-accent-primary-gradient)',
                        color: 'var(--theme-accent-primary-text)',
                        borderColor: 'var(--theme-accent-primary)',
                      }
                    : {
                        backgroundColor: 'var(--theme-card-bg)',
                        color: 'var(--theme-text-body)',
                        borderColor: 'var(--theme-card-border)',
                      }
                }
                className="px-3 py-1 rounded-xl text-xs font-semibold flex items-center gap-1.5 whitespace-nowrap transition-all cursor-pointer border shrink-0 shadow-sm"
              >
                <Icon className="w-3.5 h-3.5" />
                <span>{cat.label}</span>
              </button>
            );
          })}
        </div>
      </div>

      {/* Main Discovered Spots List */}
      <div ref={listScrollRef} className="flex-1 min-h-0 overflow-y-auto pr-1 space-y-2.5">
        {!currentCoords ? (
          <div
            style={{
              backgroundColor: 'var(--theme-card-bg)',
              borderColor: 'var(--theme-card-border)',
            }}
            className="h-full rounded-2xl border flex flex-col items-center justify-center text-center p-8 space-y-3"
          >
            <MapPin className="w-10 h-10 text-[var(--theme-accent-primary)]" />
            <h4 className="text-sm font-bold text-[var(--theme-text-title)]">
              {isManualLocationMode && deviceExactLocation?.city
                ? `${deviceExactLocation.city} — Coordinates Unavailable`
                : gpsStatus === 'locating' || isLocatingGps
                ? ui.locatingGpsTitle
                : ui.locationNeededTitle}
            </h4>
            <p className="text-xs text-[var(--theme-text-muted)] max-w-md">
              {isManualLocationMode && deviceExactLocation?.city
                ? `Exact map coordinates are not available for custom destination "${deviceExactLocation.locationName}". Open the City Guide for "${deviceExactLocation.city}" or choose a verified destination.`
                : effectiveGpsError || ui.locationNeededBody}
            </p>
            <div className="flex items-center gap-2 flex-wrap justify-center pt-1">
              {isManualLocationMode && deviceExactLocation?.city && onOpenCityGuide ? (
                <button
                  type="button"
                  onClick={() => onOpenCityGuide(deviceExactLocation.city)}
                  className="px-4 py-2 rounded-xl theme-btn-primary text-xs font-bold flex items-center gap-1.5 cursor-pointer"
                >
                  <Compass className="w-3.5 h-3.5" />
                  <span>Explore {deviceExactLocation.city} Guide</span>
                </button>
              ) : (
                <button
                  type="button"
                  onClick={handleRequestExactLocation}
                  disabled={isLocatingGps}
                  className="px-4 py-2 rounded-xl theme-btn-primary text-xs font-bold flex items-center gap-1.5 cursor-pointer"
                >
                  <RefreshCw className={`w-3.5 h-3.5 ${isLocatingGps ? 'animate-spin' : ''}`} />
                  <span>{isLocatingGps ? ui.locating : ui.retryGps}</span>
                </button>
              )}
              {onOpenCitySelector && (
                <button
                  type="button"
                  onClick={onOpenCitySelector}
                  style={{
                    backgroundColor: 'var(--theme-card-bg-subtle)',
                    borderColor: 'var(--theme-card-border)',
                    color: 'var(--theme-text-title)',
                  }}
                  className="px-4 py-2 rounded-xl border text-xs font-bold flex items-center gap-1.5 cursor-pointer hover:border-[var(--theme-card-border-glow)]"
                >
                  <Compass className="w-3.5 h-3.5 text-[var(--theme-accent-primary)]" />
                  <span>{ui.chooseCityManually}</span>
                </button>
              )}
            </div>
          </div>
        ) : (
          <>
            {(isSyncingLive || isSearchingText) && (
              <div
                style={{
                  backgroundColor: 'var(--theme-card-bg-subtle)',
                  borderColor: 'var(--theme-card-border)',
                  color: 'var(--theme-text-body)',
                }}
                className="flex items-center justify-between p-2 rounded-xl border text-xs shadow-sm"
              >
                  <div className="flex items-center gap-2">
                  <RefreshCw className="w-3.5 h-3.5 animate-spin text-[var(--theme-accent-secondary)] shrink-0" />
                  <span className="font-medium">
                    {isSearchingText
                      ? `${ui.searchingMatching} "${searchQuery.trim()}"...`
                      : ui.syncingRadar}
                  </span>
                </div>
                <span className="text-[10px] text-[var(--theme-accent-secondary)] font-mono">
                  {filteredSpots.length} {ui.attractionsReady}
                </span>
              </div>
            )}

            {filteredSpots.length === 0 && (isLoadingSpots || isSyncingLive || isSearchingText) ? (
              <div className="grid grid-cols-1 md:grid-cols-2 gap-3 animate-pulse">
                {[1, 2, 3, 4].map((i) => (
                  <div
                    key={i}
                    style={{
                      backgroundColor: 'var(--theme-card-bg)',
                      borderColor: 'var(--theme-card-border)',
                    }}
                    className="rounded-2xl border p-3.5 space-y-3"
                  >
                    <div className="flex items-center gap-3">
                      <div
                        style={{ backgroundColor: 'var(--theme-card-bg-subtle)' }}
                        className="w-16 h-16 rounded-xl"
                      />
                      <div className="flex-1 space-y-2">
                        <div style={{ backgroundColor: 'var(--theme-card-bg-subtle)' }} className="h-4 rounded w-3/4" />
                        <div style={{ backgroundColor: 'var(--theme-card-bg-subtle)' }} className="h-3 rounded w-1/2" />
                      </div>
                    </div>
                    <div style={{ backgroundColor: 'var(--theme-card-bg-subtle)' }} className="h-3 rounded w-full" />
                  </div>
                ))}
              </div>
            ) : filteredSpots.length === 0 ? (
              <div className="h-full flex flex-col items-center justify-center text-center p-8 space-y-3">
                <Compass className="w-10 h-10 text-[var(--theme-text-muted)]" />
                <h4 className="text-sm font-bold text-[var(--theme-text-title)]">{ui.noPlacesFound}</h4>
                <p className="text-xs text-[var(--theme-text-muted)] max-w-sm">
                  {ui.noPlacesHint} ({currentCoords.cityName})
                </p>
              </div>
            ) : (
              <div className="grid grid-cols-1 md:grid-cols-2 gap-3">
                {filteredSpots.map((spot) => {
                  const isPlayingThis = activePlayingId === spot.id;
                  const distanceLabel =
                    spot.straightLineLabel || formatStraightLineDistance(spot.estimatedDistanceKm);
                  const translatedPair =
                    selectedLanguage.code !== 'en'
                      ? translatedSpotCopy[`${spot.id}::${selectedLanguage.code}`]
                      : undefined;
                  const displayImportance = translatedPair?.oneLineImportance || spot.oneLineImportance;
                  const displayDescription = translatedPair?.description || spot.description;
                  const isExpanded = Boolean(expandedSpotIds[spot.id]);
                  const extKey = `${spot.id}::${selectedLanguage.code}`;
                  const extInfo = extendedSpotData[extKey];
                  const isLoadingExt = Boolean(extendedSpotLoading[extKey]);

                  return (
                    <div
                      key={spot.id}
                      id={`spot-card-${spot.id}`}
                      style={{
                        backgroundColor: 'var(--theme-card-bg)',
                        borderColor: 'var(--theme-card-border)',
                      }}
                      className="rounded-2xl border hover:border-[var(--theme-card-border-glow)] overflow-hidden shadow-lg transition-all flex flex-col justify-between p-3 space-y-2.5 backdrop-blur-md"
                    >
                      <div className="flex items-start gap-3">
                        <PlaceCardImage
                          placeName={spot.name}
                          placeId={spot.googlePlaceId || spot.placeId}
                          initialImageUrl={spot.imageUrl}
                          authorAttributions={spot.authorAttributions}
                          photos={spot.photos}
                          category={spot.category}
                          locality={spot.addressOrLocality}
                          cityName={currentCoords.cityName}
                          latitude={spot.latitude}
                          longitude={spot.longitude}
                          size="md"
                        />

                        <div className="min-w-0 flex-1 space-y-1">
                          <div className="flex items-center justify-between gap-1 flex-wrap">
                            <div className="flex items-center gap-1.5">
                              <span className="px-2 py-0.5 rounded-md text-[9px] font-bold uppercase tracking-wider theme-badge-gold">
                                {spot.category === 'spiritual' || spot.category === 'temple'
                                  ? ui.catSpiritual
                                  : spot.category === 'history'
                                  ? ui.catHistory
                                  : spot.category === 'nature'
                                  ? ui.catNature
                                  : spot.category === 'food'
                                  ? ui.catFood
                                  : spot.category === 'culture'
                                  ? ui.catCulture
                                  : spot.category === 'shopping'
                                  ? ui.catShopping
                                  : spot.category === 'hiddengems'
                                  ? ui.catHiddenGems
                                  : spot.category}
                              </span>
                              {typeof spot.rating === 'number' && spot.rating > 0 && (
                                <span className="text-[10px] font-bold text-[var(--theme-accent-primary)] flex items-center gap-0.5">
                                  <Star className="w-3 h-3 text-[var(--theme-accent-primary)] fill-current" />
                                  <span>{spot.rating.toFixed(1)}</span>
                                </span>
                              )}
                            </div>
                            <span
                              style={{
                                backgroundColor: 'var(--theme-card-bg-subtle)',
                                color: 'var(--theme-accent-secondary)',
                                borderColor: 'var(--theme-card-border)',
                              }}
                              className="text-[10px] font-bold flex items-center gap-1 px-1.5 py-0.5 rounded border"
                              title="Straight-line distance from current location; tap Details for exact route"
                            >
                              <Footprints className="w-3 h-3 text-[var(--theme-accent-primary)]" />
                              <span>{distanceLabel}</span>
                            </span>
                          </div>

                          <h3 className="text-sm sm:text-base font-serif font-bold text-[var(--theme-text-title)] truncate hover:text-[var(--theme-accent-primary)] transition-colors">
                            {spot.name}
                          </h3>

                          <p className="text-xs text-[var(--theme-text-body)] line-clamp-2 leading-relaxed">
                            <strong className="text-[var(--theme-accent-primary)]">{ui.whyVisit} </strong>
                            {displayImportance}
                          </p>
                        </div>
                      </div>

                  {/* Audio Script & Highlights preview */}
                  <div
                    style={{
                      backgroundColor: 'var(--theme-card-bg-subtle)',
                      borderColor: 'var(--theme-card-border)',
                    }}
                    className="p-2.5 rounded-xl border text-xs text-[var(--theme-text-body)] leading-relaxed font-sans space-y-1"
                  >
                    <div className="flex items-center justify-between text-[10px] font-bold text-[var(--theme-accent-primary)] uppercase tracking-wider">
                      <span className="flex items-center gap-1">
                        <Volume2 className="w-3 h-3 text-[var(--theme-accent-primary)]" />
                        {ui.guideNarration} ({selectedLanguage.nativeName})
                      </span>
                      {isPlayingThis && (
                        <span className="text-emerald-400 animate-pulse">{ui.playingVoice}</span>
                      )}
                    </div>
                    <p className="line-clamp-2 text-[var(--theme-text-muted)] text-xs">
                      {displayDescription}
                    </p>
                  </div>

                  {/* Spot Action Buttons */}
                  <div className="pt-1 flex items-center gap-1.5 flex-wrap">
                    {/* Audio Play/Pause Button + Speed Control */}
                    <div className="flex-1 min-w-[165px] flex items-center gap-1">
                      <button
                        onClick={() => handleTogglePlayAudio({ ...spot, oneLineImportance: displayImportance, description: displayDescription })}
                        style={
                          isPlayingThis
                            ? {
                                backgroundColor: '#e11d48',
                                color: '#ffffff',
                                borderColor: '#fda4af',
                              }
                            : undefined
                        }
                        className={`flex-1 py-1.5 px-2.5 rounded-xl font-bold text-xs flex items-center justify-center gap-1.5 transition-all cursor-pointer border shadow-sm ${
                          isPlayingThis ? 'animate-pulse' : 'theme-btn-primary'
                        }`}
                      >
                        {isPlayingThis ? <Pause className="w-3.5 h-3.5" /> : <Play className="w-3.5 h-3.5 fill-current" />}
                        <span>{isPlayingThis ? ui.stopAudio : ui.listenNarration}</span>
                      </button>

                      <AudioSpeedControl
                        compact
                        speed={guideSettings?.speechRate}
                        onChangeSpeed={(nextRate) => {
                          speechManager.setRate(nextRate);
                          onUpdateSpeechRate?.(nextRate);
                        }}
                        isRtl={selectedLanguage.direction === 'rtl'}
                        tone="subtle"
                      />
                    </div>

                    {/* Open in Maps / Navigate */}
                    <button
                      onClick={() => handleOpenGoogleMaps(spot)}
                      style={{
                        backgroundColor: 'var(--theme-card-bg-subtle)',
                        color: 'var(--theme-accent-secondary)',
                        borderColor: 'var(--theme-card-border)',
                      }}
                      className="py-1.5 px-2.5 rounded-xl border font-bold text-xs flex items-center gap-1 cursor-pointer transition-all active:scale-95 shadow-sm hover:border-[var(--theme-card-border-glow)]"
                      title="Open in Google Maps / Turn-by-Turn Navigation"
                    >
                      <NavIcon className="w-3.5 h-3.5 text-[var(--theme-accent-primary)]" />
                      <span>{ui.navigate}</span>
                    </button>

                    {/* Deep Dive Dossier */}
                    <button
                      onClick={() => {
                        speechManager.stop();
                        setActivePlayingId(null);
                        setDeepDiveSpot(spot);
                      }}
                      style={{
                        backgroundColor: 'var(--theme-card-bg)',
                        color: 'var(--theme-text-title)',
                        borderColor: 'var(--theme-card-border)',
                      }}
                      className="py-1.5 px-2.5 rounded-xl border font-bold text-xs flex items-center gap-1 cursor-pointer shadow-sm hover:border-[var(--theme-card-border-glow)]"
                      title="Discover in-depth secrets and architectural facts"
                    >
                      <BookOpen className="w-3.5 h-3.5 text-[var(--theme-accent-primary)]" />
                      <span>{ui.deepDive}</span>
                    </button>

                    {/* Details Modal */}
                    <button
                      onClick={() => setSelectedDetailSpot(spot)}
                      style={{
                        backgroundColor: 'var(--theme-card-bg)',
                        color: 'var(--theme-text-muted)',
                        borderColor: 'var(--theme-card-border)',
                      }}
                      className="py-1.5 px-2.5 rounded-xl border text-xs font-semibold flex items-center gap-1 cursor-pointer hover:text-[var(--theme-text-title)]"
                    >
                      <Info className="w-3.5 h-3.5" />
                      <span>{ui.details}</span>
                    </button>

                    {/* Expandable More / Less Toggle */}
                    <button
                      type="button"
                      onClick={() => handleToggleExpandSpot(spot)}
                      aria-expanded={isExpanded}
                      aria-controls={`spot-expanded-${spot.id}`}
                      style={{
                        backgroundColor: isExpanded ? 'var(--theme-card-bg-subtle)' : 'var(--theme-card-bg)',
                        color: 'var(--theme-accent-primary)',
                        borderColor: isExpanded ? 'var(--theme-card-border-glow)' : 'var(--theme-card-border)',
                      }}
                      className="py-1.5 px-2.5 rounded-xl border text-xs font-bold flex items-center gap-1 cursor-pointer hover:border-[var(--theme-card-border-glow)] transition-all"
                    >
                      <span>{isExpanded ? lessButtonText : moreButtonText}</span>
                      {isExpanded ? <ChevronUp className="w-3.5 h-3.5" /> : <ChevronDown className="w-3.5 h-3.5" />}
                    </button>
                  </div>

                  {/* Lazy-loaded Inline Grounded Extended Info Panel */}
                  {isExpanded && (
                    <div
                      id={`spot-expanded-${spot.id}`}
                      style={{
                        backgroundColor: 'var(--theme-card-bg-subtle)',
                        borderColor: 'var(--theme-card-border)',
                      }}
                      className="mt-1 p-3 rounded-xl border text-xs space-y-2 leading-relaxed text-[var(--theme-text-body)]"
                    >
                      {isLoadingExt && !extInfo ? (
                        <div className="flex items-center gap-2 text-[var(--theme-text-muted)] py-1">
                          <RefreshCw className="w-3.5 h-3.5 animate-spin text-[var(--theme-accent-primary)]" />
                          <span>{ui.loadingDetails}</span>
                        </div>
                      ) : extInfo ? (
                        <>
                          {extInfo.about && (
                            <div>
                              <span className="text-[10px] font-bold uppercase tracking-wider text-[var(--theme-accent-primary)] block mb-0.5">
                                {ui.sectionAbout}
                              </span>
                              <p>{extInfo.about}</p>
                            </div>
                          )}

                          {extInfo.history && (
                            <div>
                              <span className="text-[10px] font-bold uppercase tracking-wider text-[var(--theme-accent-primary)] block mb-0.5">
                                {ui.sectionHistory}
                              </span>
                              <p>{extInfo.history}</p>
                            </div>
                          )}

                          {extInfo.architecture && (
                            <div>
                              <span className="text-[10px] font-bold uppercase tracking-wider text-[var(--theme-accent-primary)] block mb-0.5">
                                {ui.sectionArchitecture}
                              </span>
                              <p>{extInfo.architecture}</p>
                            </div>
                          )}

                          {(extInfo.culture || extInfo.folkloreNote) && (
                            <div className="space-y-1">
                              {extInfo.culture && (
                                <div>
                                  <span className="text-[10px] font-bold uppercase tracking-wider text-[var(--theme-accent-primary)] block mb-0.5">
                                    {ui.sectionCulture}
                                  </span>
                                  <p>{extInfo.culture}</p>
                                </div>
                              )}
                              {extInfo.folkloreNote && (
                                <div
                                  style={{
                                    backgroundColor: 'var(--theme-card-bg)',
                                    borderColor: 'var(--theme-card-border)',
                                  }}
                                  className="p-2 rounded-lg border text-[11px]"
                                >
                                  <span className="text-[9.5px] font-bold uppercase tracking-wider text-[var(--theme-accent-secondary)] block mb-0.5">
                                    {ui.sectionFolklore}
                                  </span>
                                  <p className="text-[var(--theme-text-muted)]">{extInfo.folkloreNote}</p>
                                </div>
                              )}
                            </div>
                          )}

                          {extInfo.visitorInfo &&
                            (extInfo.visitorInfo.address ||
                              (extInfo.visitorInfo.openingHours && extInfo.visitorInfo.openingHours.length > 0) ||
                              extInfo.visitorInfo.phone ||
                              extInfo.visitorInfo.accessibility) && (
                              <div className="space-y-0.5">
                                <span className="text-[10px] font-bold uppercase tracking-wider text-[var(--theme-accent-primary)] block">
                                  {ui.sectionVisitorInfo}
                                </span>
                                {extInfo.visitorInfo.address && (
                                  <p className="text-[11px] text-[var(--theme-text-muted)]">{extInfo.visitorInfo.address}</p>
                                )}
                                {extInfo.visitorInfo.openingHours && extInfo.visitorInfo.openingHours.length > 0 && (
                                  <p className="text-[11px] text-[var(--theme-text-muted)]">
                                    {extInfo.visitorInfo.openingHours.slice(0, 2).join(' • ')}
                                  </p>
                                )}
                                {extInfo.visitorInfo.phone && (
                                  <p className="text-[11px] text-[var(--theme-text-muted)]">{extInfo.visitorInfo.phone}</p>
                                )}
                                {extInfo.visitorInfo.accessibility && (
                                  <p className="text-[11px] text-emerald-400">{extInfo.visitorInfo.accessibility}</p>
                                )}
                              </div>
                            )}

                          {extInfo.interestingFacts && extInfo.interestingFacts.length > 0 && (
                            <div>
                              <span className="text-[10px] font-bold uppercase tracking-wider text-[var(--theme-accent-primary)] block mb-0.5">
                                {ui.sectionFacts}
                              </span>
                              <ul className="space-y-1">
                                {extInfo.interestingFacts.map((fact, idx) => (
                                  <li key={idx} className="flex items-start gap-1.5 text-[11px]">
                                    <CheckCircle2 className="w-3 h-3 text-emerald-400 shrink-0 mt-0.5" />
                                    <span>{fact}</span>
                                  </li>
                                ))}
                              </ul>
                            </div>
                          )}

                          {(extInfo.sourceAttribution || extInfo.wikipediaUrl) && (
                            <div
                              style={{ borderColor: 'var(--theme-card-border)' }}
                              className="pt-1.5 border-t flex items-center justify-between gap-2 flex-wrap text-[10px] text-[var(--theme-text-muted)]"
                            >
                              {extInfo.sourceAttribution && (
                                <span>
                                  {ui.sourceLabel}: {extInfo.sourceAttribution}
                                </span>
                              )}
                              {extInfo.wikipediaUrl && (
                                <a
                                  href={extInfo.wikipediaUrl}
                                  target="_blank"
                                  rel="noreferrer"
                                  className="text-[var(--theme-accent-primary)] hover:underline flex items-center gap-1"
                                >
                                  <span>Wikipedia</span>
                                  <ExternalLink className="w-2.5 h-2.5" />
                                </a>
                              )}
                            </div>
                          )}
                        </>
                      ) : (
                        <p className="text-[var(--theme-text-muted)]">{displayDescription}</p>
                      )}
                    </div>
                  )}
                </div>
                );
              })}
              </div>
            )}
          </>
        )}
      </div>

      {/* Spot Detail Modal with Live Place Details, Routes API v2 Travel Modes & Google Maps Navigation */}
      {selectedDetailSpot && (() => {
        const modalTranslatedPair =
          selectedLanguage.code !== 'en'
            ? translatedSpotCopy[`${selectedDetailSpot.id}::${selectedLanguage.code}`]
            : undefined;
        const mergedSpot: NearbyDiscoveredSpot = {
          ...selectedDetailSpot,
          ...(spotDetailsExtra || {}),
          oneLineImportance: modalTranslatedPair?.oneLineImportance || selectedDetailSpot.oneLineImportance,
          description: modalTranslatedPair?.description || selectedDetailSpot.description,
          photos:
            spotDetailsExtra?.photos && spotDetailsExtra.photos.length > 0
              ? spotDetailsExtra.photos
              : selectedDetailSpot.photos,
        };
        const googleMapsHref = getMapsNavigationUrl({
          placeName: mergedSpot.name,
          localityOrCity: mergedSpot.addressOrLocality || currentCoords?.cityName,
          latitude: mergedSpot.latitude,
          longitude: mergedSpot.longitude,
          placeId: mergedSpot.googlePlaceId || mergedSpot.placeId,
          googleMapsUri: mergedSpot.googleMapsUri,
          preferDirections: false,
        });

        return (
          <div
            className="fixed inset-0 z-50 bg-black/80 backdrop-blur-xl flex items-center justify-center p-3 sm:p-5 animate-in fade-in duration-200"
            onClick={() => setSelectedDetailSpot(null)}
          >
            <div
              dir={selectedLanguage.direction === 'rtl' ? 'rtl' : 'ltr'}
              style={{
                backgroundColor: 'var(--theme-card-bg)',
                borderColor: 'var(--theme-card-border-glow)',
                color: 'var(--theme-text-title)',
              }}
              className="w-full max-w-lg rounded-3xl border p-4 shadow-2xl space-y-3.5 max-h-[90vh] overflow-y-auto"
              onClick={(e) => e.stopPropagation()}
            >
              <div
                style={{ borderColor: 'var(--theme-card-border)' }}
                className="flex items-center justify-between gap-2.5 border-b pb-2"
              >
                <BackButton
                  compact
                  onClick={() => setSelectedDetailSpot(null)}
                  selectedLanguage={selectedLanguage}
                />
                <div className="min-w-0 flex-1">
                  <div className="flex items-center gap-2 flex-wrap">
                    <span className="text-[10px] font-bold text-[var(--theme-accent-primary)] uppercase tracking-wider">
                      {mergedSpot.category} • {mergedSpot.straightLineLabel || formatStraightLineDistance(mergedSpot.estimatedDistanceKm)}
                    </span>
                    {typeof mergedSpot.rating === 'number' && mergedSpot.rating > 0 && (
                      <span className="text-[10px] font-bold text-[var(--theme-accent-primary)] flex items-center gap-0.5">
                        <Star className="w-3 h-3 text-[var(--theme-accent-primary)] fill-current" />
                        <span>{mergedSpot.rating.toFixed(1)}</span>
                        {typeof mergedSpot.reviewCount === 'number' && mergedSpot.reviewCount > 0 && (
                          <span className="text-[var(--theme-text-muted)]">({mergedSpot.reviewCount.toLocaleString()})</span>
                        )}
                      </span>
                    )}
                    {mergedSpot.regularOpeningHours?.openNow !== undefined && (
                      <span
                        style={
                          mergedSpot.regularOpeningHours.openNow
                            ? undefined
                            : {
                                backgroundColor: 'var(--theme-card-bg-subtle)',
                                borderColor: 'var(--theme-card-border)',
                                color: 'var(--theme-text-title)',
                              }
                        }
                        className={`px-1.5 py-0.5 rounded text-[9px] font-bold border ${
                          mergedSpot.regularOpeningHours.openNow
                            ? 'theme-badge-teal'
                            : ''
                        }`}
                      >
                        {mergedSpot.regularOpeningHours.openNow ? ui.openNow : ui.closed}
                      </span>
                    )}
                  </div>
                  <h3 className="text-base sm:text-lg font-serif font-bold text-[var(--theme-text-title)] truncate">
                    {mergedSpot.name}
                  </h3>
                </div>
                <button
                  onClick={() => setSelectedDetailSpot(null)}
                  style={{
                    backgroundColor: 'var(--theme-card-bg-subtle)',
                    color: 'var(--theme-text-muted)',
                    borderColor: 'var(--theme-card-border)',
                  }}
                  className="p-1.5 rounded-xl border cursor-pointer hover:text-[var(--theme-text-title)]"
                >
                  <X className="w-5 h-5" />
                </button>
              </div>

              <div
                style={{
                  backgroundColor: 'var(--theme-card-bg-subtle)',
                  borderColor: 'var(--theme-card-border)',
                }}
                className="w-full h-52 rounded-2xl overflow-hidden border"
              >
                <PlaceCardImage
                  placeName={mergedSpot.name}
                  placeId={mergedSpot.googlePlaceId || mergedSpot.placeId}
                  initialImageUrl={mergedSpot.imageUrl}
                  authorAttributions={mergedSpot.authorAttributions}
                  photos={mergedSpot.photos}
                  category={mergedSpot.category}
                  locality={mergedSpot.addressOrLocality}
                  cityName={currentCoords?.cityName}
                  latitude={mergedSpot.latitude}
                  longitude={mergedSpot.longitude}
                  size="full"
                />
              </div>

              {/* Live Routes API v2 Travel Mode & Routed Distance */}
              <div
                style={{
                  backgroundColor: 'var(--theme-card-bg-subtle)',
                  borderColor: 'var(--theme-card-border)',
                }}
                className="p-2.5 rounded-2xl border space-y-2"
              >
                <div className="flex items-center justify-between gap-2 flex-wrap">
                  <span className="text-[10px] font-bold text-[var(--theme-accent-primary)] uppercase tracking-wider flex items-center gap-1">
                    <NavIcon className="w-3 h-3" />
                    <span>{ui.routeTravelTime}</span>
                  </span>
                  <div className="flex items-center gap-1">
                    {(['DRIVE', 'WALK', 'TWO_WHEELER', 'TRANSIT'] as const).map((mode) => (
                      <button
                        key={mode}
                        type="button"
                        onClick={() => setSelectedTravelMode(mode)}
                        style={
                          selectedTravelMode === mode
                            ? {
                                background: 'var(--theme-accent-primary-gradient)',
                                color: 'var(--theme-accent-primary-text)',
                                borderColor: 'var(--theme-accent-primary)',
                              }
                            : {
                                backgroundColor: 'var(--theme-card-bg)',
                                color: 'var(--theme-text-muted)',
                                borderColor: 'var(--theme-card-border)',
                              }
                        }
                        className="px-2 py-0.5 rounded-md border text-[9.5px] font-bold cursor-pointer"
                      >
                        {mode === 'TWO_WHEELER' ? '2-Wheeler' : mode.charAt(0) + mode.slice(1).toLowerCase()}
                      </button>
                    ))}
                  </div>
                </div>
                <div className="text-xs text-[var(--theme-text-body)] flex items-center justify-between gap-2 flex-wrap">
                  {isLoadingRoute ? (
                    <span className="text-[var(--theme-text-muted)]">{ui.calculatingRoute}</span>
                  ) : routeSummary?.available ? (
                    <span className="font-semibold text-[var(--theme-accent-secondary)]">
                      {routeSummary.localizedDistanceText || `${routeSummary.distanceKm} km`} •{' '}
                      {routeSummary.localizedDurationText ||
                        (routeSummary.durationSeconds ? formatRouteDuration(routeSummary.durationSeconds) : 'Routed')}
                    </span>
                  ) : (
                    <span className="text-[11px] text-[var(--theme-text-muted)]">
                      {routeSummary?.unavailableReason ||
                        mergedSpot.straightLineLabel ||
                        formatStraightLineDistance(mergedSpot.estimatedDistanceKm)}
                    </span>
                  )}

                  <a
                    href={googleMapsHref}
                    target="_blank"
                    rel="noreferrer"
                    className="text-[11px] font-bold text-[var(--theme-accent-primary)] hover:underline flex items-center gap-1"
                  >
                    <span>{ui.viewOnGoogleMaps}</span>
                    <ExternalLink className="w-3 h-3" />
                  </a>
                </div>
              </div>

              <div
                style={{
                  backgroundColor: 'var(--theme-card-bg-subtle)',
                  borderColor: 'var(--theme-card-border)',
                }}
                className="p-3 rounded-2xl border space-y-1.5"
              >
                <strong className="text-xs font-bold text-[var(--theme-accent-primary)] uppercase tracking-wider block">
                  {ui.whyMustVisit}
                </strong>
                <p className="text-xs sm:text-sm text-[var(--theme-text-body)] leading-relaxed">
                  {mergedSpot.oneLineImportance}
                </p>
              </div>

              {/* Verified Place Details (Hours, Address, Phone, Website, Accessibility) */}
              <div
                style={{
                  backgroundColor: 'var(--theme-card-bg-subtle)',
                  borderColor: 'var(--theme-card-border)',
                }}
                className="p-3 rounded-2xl border space-y-1.5 text-xs"
              >
                <div className="flex items-center justify-between">
                  <strong className="text-[10.5px] font-bold text-[var(--theme-accent-primary)] uppercase tracking-wider">
                    {ui.verifiedPlaceInfo}
                  </strong>
                  {isLoadingDetails && (
                    <span className="text-[10px] text-[var(--theme-text-muted)]">{ui.refreshingLiveInfo}</span>
                  )}
                </div>

                <div className="flex items-start gap-2 text-[var(--theme-text-body)]">
                  <MapPin className="w-3.5 h-3.5 text-[var(--theme-accent-primary)] shrink-0 mt-0.5" />
                  <span>{mergedSpot.formattedAddress || mergedSpot.addressOrLocality || ui.addressUnavailable}</span>
                </div>

                <div className="flex items-start gap-2 text-[var(--theme-text-body)]">
                  <Clock className="w-3.5 h-3.5 text-[var(--theme-accent-primary)] shrink-0 mt-0.5" />
                  <div className="space-y-0.5">
                    {mergedSpot.regularOpeningHours?.weekdayDescriptions &&
                    mergedSpot.regularOpeningHours.weekdayDescriptions.length > 0 ? (
                      mergedSpot.regularOpeningHours.weekdayDescriptions.slice(0, 3).map((line, i) => (
                        <div key={i} className="text-[11px]">
                          {line}
                        </div>
                      ))
                    ) : (
                      <span className="text-[11px] text-[var(--theme-text-muted)]">{ui.openingHoursUnavailable}</span>
                    )}
                  </div>
                </div>

                {mergedSpot.nationalPhoneNumber && (
                  <div className="flex items-center gap-2 text-[11px] text-[var(--theme-text-body)]">
                    <Phone className="w-3.5 h-3.5 text-[var(--theme-accent-primary)] shrink-0" />
                    <span>{mergedSpot.nationalPhoneNumber}</span>
                  </div>
                )}

                {mergedSpot.websiteUri && (
                  <div className="flex items-center gap-2 text-[11px]">
                    <Globe className="w-3.5 h-3.5 text-[var(--theme-accent-primary)] shrink-0" />
                    <a
                      href={mergedSpot.websiteUri}
                      target="_blank"
                      rel="noreferrer"
                      className="text-[var(--theme-accent-secondary)] underline truncate"
                    >
                      {mergedSpot.websiteUri}
                    </a>
                  </div>
                )}

                {mergedSpot.accessibilityOptions?.wheelchairAccessibleEntrance !== undefined && (
                  <div className="flex items-center gap-2 text-[11px] text-[var(--theme-text-body)]">
                    <Accessibility className="w-3.5 h-3.5 text-[var(--theme-accent-secondary)] shrink-0" />
                    <span>
                      {ui.wheelchairEntrance}{' '}
                      {mergedSpot.accessibilityOptions.wheelchairAccessibleEntrance ? ui.yesLabel : ui.noLabel}
                    </span>
                  </div>
                )}
              </div>

              <div className="space-y-1.5">
                <h4 className="text-xs font-bold text-[var(--theme-accent-primary)] uppercase tracking-wider">
                  {ui.overviewHistory}
                </h4>
                <WordByWordText
                  text={mergedSpot.description}
                  wordIntervalMs={26}
                  className="text-xs text-[var(--theme-text-body)] leading-relaxed whitespace-pre-line block"
                />
              </div>

              {mergedSpot.keyHighlights && mergedSpot.keyHighlights.length > 0 && (
                <div className="space-y-1.5">
                  <h4 className="text-xs font-bold text-[var(--theme-accent-primary)] uppercase tracking-wider">
                    {ui.keyThingsToSpot}
                  </h4>
                  <div className="space-y-1">
                    {mergedSpot.keyHighlights.map((hl, idx) => (
                      <div key={idx} className="flex items-start gap-2 text-xs text-[var(--theme-text-body)]">
                        <CheckCircle2 className="w-3.5 h-3.5 text-emerald-400 shrink-0 mt-0.5" />
                        <span>{hl}</span>
                      </div>
                    ))}
                  </div>
                </div>
              )}

              {/* Actions */}
              <div className="pt-2 flex items-center gap-2 flex-wrap">
                <button
                  onClick={() => handleOpenGoogleMaps(mergedSpot, selectedTravelMode)}
                  className="flex-1 py-2.5 px-3 rounded-xl theme-btn-teal font-bold text-xs flex items-center justify-center gap-1.5 shadow-md active:scale-98 transition-all cursor-pointer"
                >
                  <NavIcon className="w-4 h-4" />
                  <span>{ui.openInGoogleMaps}</span>
                </button>

                <button
                  onClick={() => {
                    speechManager.stop();
                    setSelectedDetailSpot(null);
                    setDeepDiveSpot(mergedSpot);
                  }}
                  className="py-2.5 px-3 rounded-xl theme-btn-primary font-bold text-xs flex items-center justify-center gap-1.5 shadow-md active:scale-98 transition-all cursor-pointer"
                >
                  <BookOpen className="w-4 h-4" />
                  <span>{ui.deepDive}</span>
                </button>

                <button
                  onClick={() => {
                    const q = `How do I reach ${mergedSpot.name} and what are the top secrets there?`;
                    setSelectedDetailSpot(null);
                    onOpenChatWithQuestion(q);
                  }}
                  style={{
                    backgroundColor: 'var(--theme-card-bg-subtle)',
                    color: 'var(--theme-text-title)',
                    borderColor: 'var(--theme-card-border)',
                  }}
                  className="py-2.5 px-3 rounded-xl border text-xs font-bold flex items-center gap-1.5 cursor-pointer hover:border-[var(--theme-card-border-glow)]"
                >
                  <MessageSquare className="w-4 h-4 text-[var(--theme-accent-primary)]" />
                  <span>{ui.askAiGuide}</span>
                </button>
              </div>
            </div>
          </div>
        );
      })()}

      {/* Deep Dive Dossier Modal */}
      {deepDiveSpot && (
        <DeepDiveModal
          title={deepDiveSpot.name}
          category={deepDiveSpot.category}
          locationName={
            deepDiveSpot.formattedAddress ||
            deepDiveSpot.shortFormattedAddress ||
            deepDiveSpot.addressOrLocality ||
            undefined
          }
          currentNarration={deepDiveSpot.description}
          selectedLanguage={selectedLanguage}
          guideSettings={guideSettings}
          onUpdateSpeechRate={onUpdateSpeechRate}
          outputMode={outputMode}
          onClose={() => setDeepDiveSpot(null)}
          onOpenChatWithQuestion={(q) => {
            setDeepDiveSpot(null);
            onOpenChatWithQuestion(q);
          }}
        />
      )}
    </div>
  );
};
