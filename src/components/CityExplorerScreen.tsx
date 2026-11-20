import React, { useState, useEffect, useMemo } from 'react';
import { GpsLocationStatus, Language } from '../types';
import { DeviceExactLocation, GeolocationLookupError, getDeviceExactLocation } from '../utils/geolocation';
import { notifyGmpQuotaExceededIfNeeded } from '../utils/placesEngine';
import { PlaceCardImage } from './PlaceCardImage';
import {
  LocationCascadingSelector,
  AppliedManualLocationPayload,
} from './LocationCascadingSelector';
import { BackButton } from './BackButton';
import { usePreservedScroll } from '../utils/navigationHistory';
import {
  Compass,
  MapPin,
  Search,
  Sparkles,
  Navigation as NavIcon,
  Globe,
  Radio,
  Building,
  CheckCircle2,
  ArrowRight,
  RefreshCw,
  Landmark,
  Utensils,
  BookOpen,
  Eye,
  Map,
  ChevronDown,
  Layers,
  SlidersHorizontal,
  Check
} from 'lucide-react';

interface CityItem {
  name: string;
  state?: string;
  country: string;
  latitude: number;
  longitude: number;
  tagline: string;
  photoUrl: string;
  topLandmarks: string[];
  famousFoods: string[];
}

interface CityExplorerScreenProps {
  currentCity: string;
  currentCountry: string;
  currentLocationName: string;
  isManualLocationMode: boolean;
  onSetLocationMode: (mode: 'gps' | 'manual') => void;
  onSelectCity: (cityData: {
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
  selectedLanguage: Language;
  onOpenCityGuideModal: (cityName: string, stateName?: string, countryName?: string) => void;
  onProceedToNearby: () => void;
  onProceedToMap: () => void;
  onProceedToCamera: () => void;
  deviceExactLocation?: DeviceExactLocation | null;
  gpsStatus?: GpsLocationStatus;
  gpsError?: string | null;
  onRefreshGpsLocation?: () => Promise<void>;
  onBackToHome?: () => void;
  isActive?: boolean;
}

export const CityExplorerScreen: React.FC<CityExplorerScreenProps> = ({
  isActive = true,
  currentCity,
  currentCountry,
  currentLocationName,
  isManualLocationMode,
  onSetLocationMode,
  onSelectCity,
  selectedLanguage,
  onOpenCityGuideModal,
  onProceedToNearby,
  onProceedToMap,
  deviceExactLocation,
  gpsStatus,
  gpsError,
  onRefreshGpsLocation,
  onBackToHome,
}) => {
  // Quick search filter for browsing
  const [searchQuery, setSearchQuery] = useState('');
  const [searchResults, setSearchResults] = useState<CityItem[]>([]);
  const [isSearching, setIsSearching] = useState(false);
  const [isRefreshingGps, setIsRefreshingGps] = useState(false);
  const [statusMessage, setStatusMessage] = useState<string | null>(null);

  // Active City brief preview data
  const [activeCityPreview, setActiveCityPreview] = useState<any>(null);
  const [isLoadingPreview, setIsLoadingPreview] = useState(false);
  const listScrollRef = usePreservedScroll<HTMLDivElement>('tab:city', isActive);

  // Search cities API for the query bar
  useEffect(() => {
    let isMounted = true;
    const controller = new AbortController();
    const delayDebounce = setTimeout(async () => {
      setIsSearching(true);
      try {
        const res = await fetch('/api/city/search', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          signal: controller.signal,
          body: JSON.stringify({ query: searchQuery }),
        });
        notifyGmpQuotaExceededIfNeeded(res.status);
        const data = await res.json();
        notifyGmpQuotaExceededIfNeeded(data);
        if (res.ok && isMounted && data.success && data.cities) {
          setSearchResults(data.cities);
        }
      } catch (err: any) {
        if (err?.name !== 'AbortError') {
          console.warn('City search failed:', err);
        }
      } finally {
        if (isMounted) setIsSearching(false);
      }
    }, searchQuery ? 300 : 0);

    return () => {
      isMounted = false;
      controller.abort();
      clearTimeout(delayDebounce);
    };
  }, [searchQuery]);

  // Load current active city brief overview only when a city is set
  useEffect(() => {
    if (!currentCity || !currentCity.trim()) {
      setActiveCityPreview(null);
      setIsLoadingPreview(false);
      return;
    }

    let isMounted = true;
    const controller = new AbortController();
    async function loadCityPreview() {
      setIsLoadingPreview(true);
      try {
        const res = await fetch('/api/city/info', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          signal: controller.signal,
          body: JSON.stringify({
            city: currentCity,
            country: currentCountry,
            language: selectedLanguage.name,
          }),
        });
        notifyGmpQuotaExceededIfNeeded(res.status);
        const data = await res.json();
        notifyGmpQuotaExceededIfNeeded(data);
        if (res.ok && isMounted && data.success) {
          setActiveCityPreview(data);
        }
      } catch (err: any) {
        if (err?.name !== 'AbortError') {
          console.warn('Failed to load active city preview:', err);
        }
      } finally {
        if (isMounted) setIsLoadingPreview(false);
      }
    }

    loadCityPreview();
    return () => {
      isMounted = false;
      controller.abort();
    };
  }, [currentCity, currentCountry, selectedLanguage.name]);

  const handleToggleToGps = async () => {
    setIsRefreshingGps(true);
    try {
      if (onRefreshGpsLocation) {
        await onRefreshGpsLocation();
        if (gpsError) {
          setStatusMessage(gpsError);
        } else {
          setStatusMessage('Requested live GPS location update.');
        }
      } else {
        const exactLoc = await getDeviceExactLocation();
        onSelectCity({
          cityName: exactLoc.city,
          state: exactLoc.country,
          country: exactLoc.country || '',
          latitude: exactLoc.latitude,
          longitude: exactLoc.longitude,
          locationName: exactLoc.locationName,
        });
        onSetLocationMode('gps');
        setStatusMessage(`Switched to Live GPS Mode: ${exactLoc.locationName}`);
      }
      setTimeout(() => setStatusMessage(null), 4000);
    } catch (e: any) {
      if (e instanceof GeolocationLookupError) {
        setStatusMessage(e.message);
      } else {
        setStatusMessage(e?.message || 'Unable to acquire device GPS location.');
      }
      setTimeout(() => setStatusMessage(null), 5000);
    } finally {
      setIsRefreshingGps(false);
    }
  };

  // Set city from Worldwide Cascading Selector
  const handleApplyWorldwideDestination = (payload: AppliedManualLocationPayload) => {
    onSelectCity(payload);
    setStatusMessage(`Active location set to ${payload.locationName}. App has updated for this destination!`);
    setTimeout(() => setStatusMessage(null), 4000);
  };

  // Set city from quick-pick card
  const handlePickCityCard = (city: CityItem) => {
    onSelectCity({
      cityName: city.name,
      state: city.state,
      country: city.country,
      latitude: city.latitude,
      longitude: city.longitude,
      locationName: `${city.name}, ${city.state ? city.state + ', ' : ''}${city.country}`,
      isVerified: true,
    });
    setStatusMessage(`Active location set to ${city.name}. App has processed everything for this destination!`);
    setTimeout(() => setStatusMessage(null), 4000);
  };

  return (
    <div
      id="city-explorer-screen"
      dir={selectedLanguage.direction === 'rtl' ? 'rtl' : 'ltr'}
      className="h-full flex flex-col overflow-hidden overflow-clip py-1 space-y-2 select-none"
    >
      {/* Mode Switch Bar: Automatic GPS vs Manual City Exploration */}
      <div
        style={{
          backgroundColor: 'var(--theme-card-bg)',
          borderColor: 'var(--theme-card-border)',
        }}
        className="shrink-0 p-2.5 sm:p-3 rounded-2xl border shadow-md flex flex-col sm:flex-row items-start sm:items-center justify-between gap-2.5 backdrop-blur-md"
      >
        <div className="flex items-center gap-2">
          {onBackToHome && (
            <BackButton
              id="btn-city-back-home"
              onClick={onBackToHome}
              selectedLanguage={selectedLanguage}
            />
          )}
          <div>
            <div className="flex items-center gap-1.5">
              <Radio className="w-4 h-4 text-[var(--theme-accent-primary)]" />
              <h2 className="text-xs sm:text-sm font-serif font-bold text-[var(--theme-text-title)]">
                Exploration Location Mode
              </h2>
            </div>
            <p className="text-[11px] text-[var(--theme-text-muted)]">
              {isManualLocationMode
                ? `Currently exploring manually: ${currentCity} (App updated for this city)`
                : `Automatic Live GPS Mode: ${currentLocationName}`}
            </p>
          </div>
        </div>

        {/* Switch Control with 2 Options */}
        <div
          style={{
            backgroundColor: 'var(--theme-card-bg-subtle)',
            borderColor: 'var(--theme-card-border)',
          }}
          className="shrink-0 p-1 rounded-xl border flex items-center gap-1"
        >
          <button
            id="btn-switch-gps-mode"
            onClick={handleToggleToGps}
            disabled={isRefreshingGps}
            style={{
              background: !isManualLocationMode ? 'var(--theme-accent-primary-gradient)' : 'transparent',
              color: !isManualLocationMode ? 'var(--theme-accent-primary-text)' : 'var(--theme-text-muted)',
            }}
            className={`px-3 py-1.5 rounded-lg text-xs font-bold transition-all flex items-center gap-1.5 cursor-pointer ${
              !isManualLocationMode
                ? 'shadow-md font-extrabold'
                : 'hover:text-[var(--theme-text-title)]'
            }`}
          >
            <RefreshCw className={`w-3.5 h-3.5 ${isRefreshingGps ? 'animate-spin' : ''}`} />
            <span>Automatic GPS</span>
          </button>

          <button
            id="btn-switch-manual-mode"
            onClick={() => onSetLocationMode('manual')}
            style={{
              background: isManualLocationMode ? 'var(--theme-accent-primary-gradient)' : 'transparent',
              color: isManualLocationMode ? 'var(--theme-accent-primary-text)' : 'var(--theme-text-muted)',
            }}
            className={`px-3 py-1.5 rounded-lg text-xs font-bold transition-all flex items-center gap-1.5 cursor-pointer ${
              isManualLocationMode
                ? 'shadow-md font-extrabold'
                : 'hover:text-[var(--theme-text-title)]'
            }`}
          >
            <MapPin className="w-3.5 h-3.5" />
            <span>Manual City Dropdown</span>
          </button>
        </div>
      </div>

      {/* Status Toast / Notification Banner */}
      {statusMessage && (
        <div className="shrink-0 px-3 py-2 rounded-xl bg-emerald-950/90 border border-emerald-500/60 text-emerald-200 text-xs font-medium flex items-center gap-2 animate-fadeIn">
          <Check className="w-4 h-4 text-emerald-400 shrink-0" />
          <span>{statusMessage}</span>
        </div>
      )}

      {/* WORLDWIDE CASCADING SELECTOR: Country -> State/Region -> City/Town/Village */}
      <div
        style={{
          backgroundColor: 'var(--theme-card-bg)',
          borderColor: 'var(--theme-card-border)',
        }}
        className="shrink-0 p-3 sm:p-3.5 rounded-2xl border shadow-xl space-y-2.5 backdrop-blur-md overflow-visible relative z-30"
      >
        <div
          style={{ borderColor: 'var(--theme-card-border)' }}
          className="flex items-center justify-between gap-2 border-b pb-2"
        >
          <div className="flex items-center gap-2">
            <SlidersHorizontal className="w-4 h-4 text-[var(--theme-accent-primary)]" />
            <h3 className="text-xs sm:text-sm font-serif font-bold text-[var(--theme-text-title)]">
              Manual Destination Selector
            </h3>
          </div>
          <span className="text-[10px] font-bold px-2 py-0.5 rounded-full theme-badge-gold">
            Country • State • City / Village
          </span>
        </div>

        <LocationCascadingSelector
          selectedLanguage={selectedLanguage}
          deviceExactLocation={deviceExactLocation}
          isManualLocationMode={isManualLocationMode}
          onApplyLocation={handleApplyWorldwideDestination}
          applyButtonLabel="Set & Process App For This Place"
          compact
        />
      </div>

      {/* Active City Overview Card with "Explore City" & "Proceed Full App" */}
      {currentCity && currentCity.trim() ? (
      <div
        style={{
          backgroundColor: 'var(--theme-card-bg)',
          borderColor: 'var(--theme-card-border)',
        }}
        className="shrink-0 rounded-2xl border shadow-lg overflow-hidden flex flex-col sm:flex-row items-stretch backdrop-blur-md"
      >
        <div
          style={{ backgroundColor: 'var(--theme-card-bg-subtle)' }}
          className="relative w-full sm:w-44 h-28 sm:h-auto shrink-0 overflow-hidden"
        >
          <PlaceCardImage
            placeName={currentCity}
            cityName={currentCity}
            initialImageUrl={activeCityPreview?.photoUrl}
            size="full"
            className="w-full h-full object-cover !rounded-none"
          />
          <div className="absolute inset-0 bg-gradient-to-t from-black/80 via-transparent to-transparent sm:hidden pointer-events-none" />
          <div className="absolute top-2 left-2 px-2 py-0.5 rounded-full bg-black/75 backdrop-blur-md text-[9px] font-bold text-[var(--theme-accent-primary)] border border-[var(--theme-card-border)] z-10 pointer-events-none">
            {isManualLocationMode ? '📍 Active Selected City' : '⚡ GPS Detected City'}
          </div>
        </div>

        <div className="p-3 sm:p-3.5 flex-1 flex flex-col justify-between space-y-1.5 min-w-0">
          <div>
            <div className="flex items-center gap-2 flex-wrap">
              <span className="text-[10px] font-bold uppercase tracking-wider px-2 py-0.5 rounded-full theme-badge-gold truncate">
                {activeCityPreview?.moniker || 'Heritage City'}
              </span>
            </div>
            <h3 className="text-sm sm:text-base font-serif font-bold text-[var(--theme-text-title)] truncate mt-0.5">
              {currentCity}
            </h3>
            <p className="text-xs text-[var(--theme-text-body)] line-clamp-2 leading-relaxed">
              {activeCityPreview?.briefOverview ||
                `Set ${currentCity} as active location to discover verified temples, monuments, food specialties, and audio guide stories.`}
            </p>
          </div>

          {/* Quick Action Row */}
          <div className="flex items-center gap-2 pt-1 flex-wrap">
            {/* Button beside city location to explore more about that city */}
            <button
              id="btn-city-tab-explore-city"
              onClick={() => onOpenCityGuideModal(currentCity, deviceExactLocation?.state || '', currentCountry)}
              style={{
                backgroundColor: 'var(--theme-card-bg-subtle)',
                borderColor: 'var(--theme-card-border)',
                color: 'var(--theme-text-title)',
              }}
              className="py-1.5 px-3 rounded-xl border font-bold text-xs flex items-center gap-1.5 cursor-pointer active:scale-95 transition-all hover:border-[var(--theme-card-border-glow)]"
              title="Open Brief Overview and In-Depth City Guide"
            >
              <Sparkles className="w-3.5 h-3.5 text-[var(--theme-accent-primary)]" />
              <span>Explore City Info</span>
            </button>

            {/* Proceed Full App for this City */}
            <button
              id="btn-proceed-full-app-nearby"
              onClick={onProceedToNearby}
              className="py-1.5 px-3 rounded-xl theme-btn-primary font-bold text-xs flex items-center gap-1.5 shadow-md cursor-pointer active:scale-95 transition-all"
            >
              <NavIcon className="w-3.5 h-3.5" />
              <span>Proceed to Attractions</span>
              <ArrowRight className="w-3.5 h-3.5" />
            </button>

            <button
              id="btn-proceed-full-app-map"
              onClick={onProceedToMap}
              style={{
                backgroundColor: 'var(--theme-card-bg-subtle)',
                borderColor: 'var(--theme-card-border)',
                color: 'var(--theme-text-title)',
              }}
              className="py-1.5 px-2.5 rounded-xl border text-xs font-medium flex items-center gap-1 cursor-pointer hover:border-[var(--theme-card-border-glow)]"
            >
              <Map className="w-3.5 h-3.5 text-[var(--theme-accent-primary)]" />
              <span>Map View</span>
            </button>
          </div>
        </div>
      </div>
      ) : (
        <div
          style={{
            backgroundColor: 'var(--theme-card-bg)',
            borderColor: 'var(--theme-card-border)',
          }}
          className="shrink-0 rounded-2xl border p-3.5 text-xs text-[var(--theme-text-muted)] backdrop-blur-md"
        >
          {gpsError ? `${gpsError} Choose a city above or tap a destination card below.` : 'Enable Automatic GPS or choose a destination city above to begin exploring.'}
        </div>
      )}

      {/* Search and Quick Preset Grid */}
      <div className="flex-1 min-h-0 flex flex-col space-y-2 overflow-hidden">
        {/* Search Bar */}
        <div className="shrink-0 relative">
          <Search className="w-4 h-4 absolute left-3 top-2.5 text-[var(--theme-accent-primary)]" />
          <input
            type="text"
            value={searchQuery}
            onChange={(e) => setSearchQuery(e.target.value)}
            placeholder="Quick search any city in the world (e.g. Nagpur, Madurai, Varanasi, Jaipur, Kyoto, Paris)..."
            style={{
              backgroundColor: 'var(--theme-card-bg-subtle)',
              borderColor: 'var(--theme-card-border)',
              color: 'var(--theme-text-title)',
            }}
            className="w-full pl-9 pr-8 py-2 rounded-xl border placeholder-[var(--theme-text-muted)] text-xs sm:text-sm focus:outline-none focus:border-[var(--theme-card-border-glow)]"
          />
          {searchQuery && (
            <button
              onClick={() => setSearchQuery('')}
              className="absolute right-3 top-2.5 text-xs text-[var(--theme-accent-primary)] hover:text-[var(--theme-text-title)]"
            >
              Clear
            </button>
          )}
        </div>

        {/* City Cards Grid */}
        <div ref={listScrollRef} className="flex-1 min-h-0 overflow-y-auto pr-1 space-y-2">
          <div className="flex items-center justify-between text-xs text-[var(--theme-accent-primary)] font-bold px-1">
            <span>
              {searchQuery ? `Search Results (${searchResults.length})` : 'Popular Heritage & Cultural Cities'}
            </span>
            <span className="text-[11px] text-[var(--theme-text-muted)] font-normal">
              Tap any city to set and process
            </span>
          </div>

          {isSearching ? (
            <div className="py-12 flex flex-col items-center justify-center space-y-2 text-center text-[var(--theme-accent-secondary)]">
              <div className="w-6 h-6 border-2 border-[var(--theme-accent-primary)] border-t-transparent rounded-full animate-spin" />
              <span className="text-xs">Searching destinations worldwide...</span>
            </div>
          ) : searchResults.length === 0 ? (
            <div
              style={{
                backgroundColor: 'var(--theme-card-bg)',
                borderColor: 'var(--theme-card-border)',
                color: 'var(--theme-text-muted)',
              }}
              className="py-12 text-center text-xs rounded-2xl border p-4"
            >
              No matching cities found for &quot;{searchQuery}&quot;. Try searching for Nagpur, Varanasi, Madurai, or Jaipur.
            </div>
          ) : (
            <div className="grid grid-cols-1 sm:grid-cols-2 gap-2.5">
              {searchResults.map((city) => {
                const isSelected = city.name.toLowerCase() === currentCity.toLowerCase();
                return (
                  <div
                    key={city.name}
                    style={{
                      backgroundColor: 'var(--theme-card-bg)',
                      borderColor: isSelected ? 'var(--theme-card-border-glow)' : 'var(--theme-card-border)',
                      boxShadow: isSelected ? '0 0 15px var(--theme-ambient-glow)' : undefined,
                    }}
                    className="p-3 rounded-2xl border transition-all flex flex-col justify-between space-y-2 backdrop-blur-md"
                  >
                    <div className="flex items-start gap-3">
                      {/* Photo Thumbnail */}
                      <div
                        style={{
                          backgroundColor: 'var(--theme-card-bg-subtle)',
                          borderColor: 'var(--theme-card-border)',
                        }}
                        className="w-16 h-16 rounded-xl overflow-hidden shrink-0 border"
                      >
                        <PlaceCardImage
                          placeName={city.name}
                          cityName={city.name}
                          latitude={city.latitude}
                          longitude={city.longitude}
                          initialImageUrl={city.photoUrl}
                          size="sm"
                          className="w-full h-full object-cover"
                        />
                      </div>

                      {/* City Name & Tagline */}
                      <div className="min-w-0 flex-1">
                        <div className="flex items-center justify-between gap-1">
                          <h4 className="text-sm font-serif font-bold text-[var(--theme-text-title)] truncate">
                            {city.name}
                          </h4>
                          {isSelected && (
                            <span className="text-[9px] font-bold px-1.5 py-0.5 rounded-full theme-badge-teal flex items-center gap-1 shrink-0">
                              <CheckCircle2 className="w-2.5 h-2.5" />
                              <span>Active</span>
                            </span>
                          )}
                        </div>

                        <p className="text-[11px] text-[var(--theme-accent-secondary)] line-clamp-1 mt-0.5">
                          {city.state ? `${city.state}, ${city.country}` : city.country}
                        </p>

                        <p className="text-[10px] text-[var(--theme-text-muted)] line-clamp-1 mt-0.5 italic">
                          {city.tagline}
                        </p>
                      </div>
                    </div>

                    {/* Landmarks & Food Highlights Tags */}
                    {city.topLandmarks && city.topLandmarks.length > 0 && (
                      <div className="flex flex-wrap gap-1 text-[9.5px]">
                        {city.topLandmarks.slice(0, 3).map((lm, i) => (
                          <span
                            key={i}
                            style={{
                              backgroundColor: 'var(--theme-card-bg-subtle)',
                              borderColor: 'var(--theme-card-border)',
                              color: 'var(--theme-accent-primary)',
                            }}
                            className="px-1.5 py-0.5 rounded-md border truncate max-w-[130px]"
                          >
                            {lm}
                          </span>
                        ))}
                      </div>
                    )}

                    {/* Action Buttons */}
                    <div
                      style={{ borderColor: 'var(--theme-card-border)' }}
                      className="flex items-center gap-2 pt-1 border-t"
                    >
                      <button
                        onClick={() => handlePickCityCard(city)}
                        style={{
                          background: isSelected ? 'var(--theme-accent-primary-gradient)' : 'var(--theme-card-bg-subtle)',
                          color: isSelected ? 'var(--theme-accent-primary-text)' : 'var(--theme-text-title)',
                          borderColor: isSelected ? 'transparent' : 'var(--theme-card-border)',
                        }}
                        className="flex-1 py-1.5 px-2 rounded-xl text-xs font-bold transition-all flex items-center justify-center gap-1 cursor-pointer active:scale-95 border"
                      >
                        <MapPin className="w-3 h-3" />
                        <span>{isSelected ? 'Active City' : 'Set as Active City'}</span>
                      </button>

                      <button
                        onClick={() => onOpenCityGuideModal(city.name, city.state, city.country)}
                        style={{
                          backgroundColor: 'var(--theme-card-bg-subtle)',
                          borderColor: 'var(--theme-card-border)',
                          color: 'var(--theme-text-title)',
                        }}
                        className="py-1.5 px-2.5 rounded-xl border text-xs font-semibold flex items-center gap-1 cursor-pointer hover:border-[var(--theme-card-border-glow)]"
                        title="Explore Brief & In-Depth Guide"
                      >
                        <Sparkles className="w-3 h-3 text-[var(--theme-accent-primary)]" />
                        <span>About</span>
                      </button>
                    </div>
                  </div>
                );
              })}
            </div>
          )}
        </div>
      </div>
    </div>
  );
};
