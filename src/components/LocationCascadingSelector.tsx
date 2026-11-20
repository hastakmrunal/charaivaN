import React, { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import {
  AlertCircle,
  Building,
  Check,
  CheckCircle2,
  ChevronDown,
  Globe,
  Loader2,
  MapPin,
  PlusCircle,
  Search,
  Sparkles,
  X,
} from 'lucide-react';
import {
  Language,
  LocationCityOption,
  LocationCountryOption,
  LocationStateOption,
  SavedLocationPreference,
} from '../types';
import {
  findCountryByNameOrCode,
  foldDiacritics,
  searchWorldwideCountries,
} from '../data/isoCountries';
import { DeviceExactLocation } from '../utils/geolocation';
import { useLocalizedTexts } from '../data/localizedStrings';
import { useBackLayer } from '../utils/navigationHistory';
import { notifyGmpQuotaExceededIfNeeded } from '../utils/placesEngine';

export interface AppliedManualLocationPayload {
  cityName: string;
  state: string;
  stateCode: string;
  country: string;
  countryCode: string;
  latitude: number | null;
  longitude: number | null;
  locationName: string;
  placeId?: string;
  isVerified: boolean;
}

interface LocationCascadingSelectorProps {
  selectedLanguage: Language;
  locationPref?: SavedLocationPreference;
  deviceExactLocation?: DeviceExactLocation | null;
  isManualLocationMode?: boolean;
  onApplyLocation: (payload: AppliedManualLocationPayload) => void;
  applyButtonLabel?: string;
  compact?: boolean;
}

const SELECTOR_UI_DEFAULTS = {
  heading: 'Select Worldwide Destination',
  subheading: 'Country → State / Region → City, Town or Village',
  countryLabel: '1. Country',
  countryPlaceholder: 'Search any country worldwide...',
  countryRequiredHint: 'Please select a valid country from the list.',
  noCountriesFound: 'No matching countries found.',
  stateLabel: '2. State / Region (Optional)',
  statePlaceholder: 'Search state or leave blank...',
  statePickCountryFirst: 'Select a country first',
  stateNotApplicable: 'No subdivisions — search city/town below',
  noStatesFound: 'No matching state/region. You can still search places below.',
  clearStateTitle: 'Clear state filter',
  cityLabel: '3. City / Town / Village',
  cityPlaceholder: 'Type city, town, or village...',
  cityPickCountryFirst: 'Select a country first',
  searchingPlaces: 'Searching worldwide places...',
  resolvingPlace: 'Verifying place coordinates...',
  useCustomPrefix: 'Use',
  customUnverifiedHint: 'Save custom place name without fabricated coordinates',
  noCityMatches: 'No listed matches found. You can use the entered name below.',
  providerErrorHint: 'Live place lookup unavailable — matching local & custom entry still works.',
  applyButton: 'Apply Selected Place',
  applyingButton: 'Saving...',
  verifiedBadge: 'Verified coordinates',
  unverifiedBadge: 'Custom place (no map coordinates)',
  activeSelectionPrefix: 'Selected:',
};

function generateSessionToken(): string {
  if (typeof crypto !== 'undefined' && typeof crypto.randomUUID === 'function') {
    return crypto.randomUUID();
  }
  return `sess_${Date.now()}_${Math.random().toString(36).slice(2, 10)}`;
}

export const LocationCascadingSelector: React.FC<LocationCascadingSelectorProps> = ({
  selectedLanguage,
  locationPref,
  deviceExactLocation,
  onApplyLocation,
  applyButtonLabel,
  compact = false,
}) => {
  const { t: ui } = useLocalizedTexts(
    SELECTOR_UI_DEFAULTS,
    selectedLanguage,
    'Worldwide Country, State, and City/Town/Village searchable location selector'
  );

  const langCode = selectedLanguage?.code || 'en';
  const langName = selectedLanguage?.name || 'English';
  const isRtl = selectedLanguage?.direction === 'rtl';

  const containerRef = useRef<HTMLDivElement | null>(null);
  const countryInputRef = useRef<HTMLInputElement | null>(null);
  const stateInputRef = useRef<HTMLInputElement | null>(null);
  const cityInputRef = useRef<HTMLInputElement | null>(null);

  // Hydrate initial selection cleanly from locationPref or deviceExactLocation (only when valid)
  const initialCountry = useMemo(() => {
    const codeOrName =
      locationPref?.manualCountryCode ||
      locationPref?.manualCountryName ||
      deviceExactLocation?.countryCode ||
      deviceExactLocation?.country;
    return findCountryByNameOrCode(codeOrName, langCode);
  }, []);

  const [selectedCountry, setSelectedCountry] = useState<LocationCountryOption | null>(
    initialCountry
  );
  const [countryQuery, setCountryQuery] = useState<string>(
    initialCountry ? initialCountry.localizedName || initialCountry.name : ''
  );

  const initialStateName =
    locationPref?.manualStateName || deviceExactLocation?.state || '';
  const initialStateCode =
    locationPref?.manualStateCode || deviceExactLocation?.stateCode || '';
  const [selectedState, setSelectedState] = useState<LocationStateOption | null>(() =>
    initialCountry && initialStateName
      ? {
          code: initialStateCode,
          name: initialStateName,
          countryCode: initialCountry.code,
        }
      : null
  );
  const [stateQuery, setStateQuery] = useState<string>(initialStateName);

  const initialCityName =
    locationPref?.manualCityName || deviceExactLocation?.city || '';
  const initialLat =
    locationPref?.locationMode === 'manual'
      ? locationPref.manualLatitude ?? null
      : typeof deviceExactLocation?.latitude === 'number'
      ? deviceExactLocation.latitude
      : null;
  const initialLng =
    locationPref?.locationMode === 'manual'
      ? locationPref.manualLongitude ?? null
      : typeof deviceExactLocation?.longitude === 'number'
      ? deviceExactLocation.longitude
      : null;

  const [selectedCity, setSelectedCity] = useState<LocationCityOption | null>(() =>
    initialCountry && initialCityName
      ? {
          id: locationPref?.manualPlaceId || `init:${initialCountry.code}:${initialCityName}`,
          name: initialCityName,
          state: initialStateName,
          stateCode: initialStateCode,
          country: initialCountry.localizedName || initialCountry.name,
          countryCode: initialCountry.code,
          subtitle: [initialStateName, initialCountry.localizedName || initialCountry.name]
            .filter(Boolean)
            .join(', '),
          latitude: typeof initialLat === 'number' ? initialLat : null,
          longitude: typeof initialLng === 'number' ? initialLng : null,
          placeId: locationPref?.manualPlaceId,
          verified:
            typeof locationPref?.manualLocationVerified === 'boolean'
              ? locationPref.manualLocationVerified
              : typeof initialLat === 'number' && typeof initialLng === 'number',
        }
      : null
  );
  const [cityQuery, setCityQuery] = useState<string>(initialCityName);

  // Sync when saved manual location changes externally (e.g., 1-Tap Popular chip or cloud restore)
  const lastExternalKeyRef = useRef<string>('');
  useEffect(() => {
    const extCountryKey =
      locationPref?.manualCountryCode ||
      locationPref?.manualCountryName ||
      deviceExactLocation?.countryCode ||
      deviceExactLocation?.country ||
      '';
    const extStateKey = locationPref?.manualStateName || deviceExactLocation?.state || '';
    const extCityKey = locationPref?.manualCityName || deviceExactLocation?.city || '';
    const extLat = locationPref?.manualLatitude ?? deviceExactLocation?.latitude ?? 'null';
    const extLng = locationPref?.manualLongitude ?? deviceExactLocation?.longitude ?? 'null';
    const key = `${extCountryKey}|${extStateKey}|${extCityKey}|${extLat}|${extLng}`;
    if (!extCityKey && !extCountryKey) return;
    if (lastExternalKeyRef.current === key) return;
    lastExternalKeyRef.current = key;

    const matchedCountry = findCountryByNameOrCode(extCountryKey, langCode);
    if (matchedCountry) {
      setSelectedCountry(matchedCountry);
      setCountryQuery(matchedCountry.localizedName || matchedCountry.name);
      if (extStateKey) {
        setSelectedState({
          code: locationPref?.manualStateCode || deviceExactLocation?.stateCode || '',
          name: extStateKey,
          countryCode: matchedCountry.code,
        });
        setStateQuery(extStateKey);
      } else {
        setSelectedState(null);
        setStateQuery('');
      }
      if (extCityKey) {
        const hasCoords = typeof extLat === 'number' && typeof extLng === 'number';
        setSelectedCity({
          id: locationPref?.manualPlaceId || `ext:${matchedCountry.code}:${extCityKey}`,
          name: extCityKey,
          state: extStateKey,
          stateCode: locationPref?.manualStateCode || deviceExactLocation?.stateCode || '',
          country: matchedCountry.localizedName || matchedCountry.name,
          countryCode: matchedCountry.code,
          subtitle: [extStateKey, matchedCountry.localizedName || matchedCountry.name]
            .filter(Boolean)
            .join(', '),
          latitude: hasCoords ? extLat : null,
          longitude: hasCoords ? extLng : null,
          placeId: locationPref?.manualPlaceId,
          verified:
            typeof locationPref?.manualLocationVerified === 'boolean'
              ? locationPref.manualLocationVerified
              : hasCoords,
        });
        setCityQuery(extCityKey);
      }
    }
  }, [
    locationPref?.manualCountryCode,
    locationPref?.manualCountryName,
    locationPref?.manualStateName,
    locationPref?.manualStateCode,
    locationPref?.manualCityName,
    locationPref?.manualLatitude,
    locationPref?.manualLongitude,
    locationPref?.manualPlaceId,
    locationPref?.manualLocationVerified,
    deviceExactLocation?.countryCode,
    deviceExactLocation?.country,
    deviceExactLocation?.state,
    deviceExactLocation?.stateCode,
    deviceExactLocation?.city,
    deviceExactLocation?.latitude,
    deviceExactLocation?.longitude,
    langCode,
  ]);

  // Dropdown visibility & active keyboard index
  const [openDropdown, setOpenDropdown] = useState<'country' | 'state' | 'city' | null>(null);
  const [highlightedIndex, setHighlightedIndex] = useState<number>(-1);
  const [validationError, setValidationError] = useState<string | null>(null);
  const [isResolvingPlace, setIsResolvingPlace] = useState<boolean>(false);

  // Close open dropdown on Back button / Escape
  useBackLayer(
    'location-combobox-dropdown',
    openDropdown !== null,
    () => setOpenDropdown(null),
    75
  );

  // Outside click / pointerdown handler (zero full-screen backdrop blocking UI)
  useEffect(() => {
    if (!openDropdown) return;
    const handlePointerDown = (e: PointerEvent) => {
      if (containerRef.current && !containerRef.current.contains(e.target as Node)) {
        setOpenDropdown(null);
      }
    };
    document.addEventListener('pointerdown', handlePointerDown);
    return () => document.removeEventListener('pointerdown', handlePointerDown);
  }, [openDropdown]);

  // 1. Country Options (instant localized search across all 250 countries)
  const countryResults = useMemo(() => {
    const queryForSearch =
      selectedCountry &&
      foldDiacritics(countryQuery) === foldDiacritics(selectedCountry.localizedName || selectedCountry.name)
        ? ''
        : countryQuery;
    return searchWorldwideCountries(queryForSearch, langCode, 60);
  }, [countryQuery, selectedCountry, langCode]);

  // 2. State / Region Options (scoped strictly to selectedCountry.code)
  const [stateResults, setStateResults] = useState<LocationStateOption[]>([]);
  const [countryHasStates, setCountryHasStates] = useState<boolean>(true);
  const [isLoadingStates, setIsLoadingStates] = useState<boolean>(false);
  const stateCacheRef = useRef<Map<string, { states: LocationStateOption[]; hasStates: boolean }>>(new Map());

  useEffect(() => {
    if (!selectedCountry) {
      setStateResults([]);
      setCountryHasStates(false);
      setIsLoadingStates(false);
      return;
    }

    const q =
      selectedState && foldDiacritics(stateQuery) === foldDiacritics(selectedState.name)
        ? ''
        : stateQuery.trim();
    const cacheKey = `${selectedCountry.code}|${foldDiacritics(q)}`;
    const cached = stateCacheRef.current.get(cacheKey);
    if (cached) {
      setStateResults(cached.states);
      setCountryHasStates(cached.hasStates);
      setIsLoadingStates(false);
      return;
    }

    const controller = new AbortController();
    const timer = setTimeout(async () => {
      setIsLoadingStates(true);
      try {
        const res = await fetch(
          `/api/locations/states?countryCode=${encodeURIComponent(
            selectedCountry.code
          )}&q=${encodeURIComponent(q)}&limit=80`,
          { signal: controller.signal }
        );
        const data = await res.json().catch(() => ({}));
        if (res.ok && data?.success) {
          const entry = {
            states: Array.isArray(data.states) ? data.states : [],
            hasStates: Boolean(data.hasStates),
          };
          stateCacheRef.current.set(cacheKey, entry);
          setStateResults(entry.states);
          setCountryHasStates(entry.hasStates);
        }
      } catch (err: any) {
        if (err?.name !== 'AbortError') {
          setStateResults([]);
        }
      } finally {
        setIsLoadingStates(false);
      }
    }, q ? 160 : 0);

    return () => {
      controller.abort();
      clearTimeout(timer);
    };
  }, [selectedCountry?.code, stateQuery, selectedState]);

  // 3. City / Town / Village Options (scoped to selectedCountry + optional selectedState)
  const [cityResults, setCityResults] = useState<LocationCityOption[]>([]);
  const [isLoadingCities, setIsLoadingCities] = useState<boolean>(false);
  const [cityProviderWarning, setCityProviderWarning] = useState<string | null>(null);
  const cityCacheRef = useRef<Map<string, LocationCityOption[]>>(new Map());
  const cityReqSeqRef = useRef<number>(0);
  const sessionTokenRef = useRef<string>(generateSessionToken());

  useEffect(() => {
    if (!selectedCountry) {
      setCityResults([]);
      setIsLoadingCities(false);
      setCityProviderWarning(null);
      return;
    }

    const effectiveQuery =
      selectedCity && foldDiacritics(cityQuery) === foldDiacritics(selectedCity.name)
        ? ''
        : cityQuery.trim();
    const stateKey = selectedState?.code || selectedState?.name || '';
    const cacheKey = `${selectedCountry.code}|${stateKey}|${langCode}|${foldDiacritics(effectiveQuery)}`;
    const cached = cityCacheRef.current.get(cacheKey);
    if (cached) {
      setCityResults(cached);
      setIsLoadingCities(false);
      setCityProviderWarning(null);
      return;
    }

    const reqSeq = ++cityReqSeqRef.current;
    const controller = new AbortController();
    const delay = effectiveQuery ? 250 : 0;

    const timer = setTimeout(async () => {
      setIsLoadingCities(true);
      setCityProviderWarning(null);
      try {
        const res = await fetch('/api/locations/cities', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          signal: controller.signal,
          body: JSON.stringify({
            countryCode: selectedCountry.code,
            countryName: selectedCountry.name,
            stateCode: selectedState?.code || '',
            stateName: selectedState?.name || '',
            query: effectiveQuery,
            language: langName,
            sessionToken: sessionTokenRef.current,
            limit: 20,
          }),
        });
        notifyGmpQuotaExceededIfNeeded(res.status);
        const data = await res.json().catch(() => ({}));
        notifyGmpQuotaExceededIfNeeded(data);

        if (cityReqSeqRef.current !== reqSeq) return;

        if (res.ok && data?.success) {
          const list: LocationCityOption[] = Array.isArray(data.cities) ? data.cities : [];
          cityCacheRef.current.set(cacheKey, list);
          setCityResults(list);
          if (Array.isArray(data.providerErrors) && data.providerErrors.length > 0 && list.length === 0) {
            setCityProviderWarning(ui.providerErrorHint);
          }
        } else {
          setCityResults([]);
          setCityProviderWarning(ui.providerErrorHint);
        }
      } catch (err: any) {
        if (err?.name !== 'AbortError' && cityReqSeqRef.current === reqSeq) {
          setCityResults([]);
          setCityProviderWarning(ui.providerErrorHint);
        }
      } finally {
        if (cityReqSeqRef.current === reqSeq) {
          setIsLoadingCities(false);
        }
      }
    }, delay);

    return () => {
      controller.abort();
      clearTimeout(timer);
    };
  }, [
    selectedCountry?.code,
    selectedCountry?.name,
    selectedState?.code,
    selectedState?.name,
    cityQuery,
    selectedCity,
    langCode,
    langName,
    ui.providerErrorHint,
  ]);

  // Build final City dropdown list including custom "Use '[Entered Place Name]'" fallback when needed
  const cityDropdownOptions = useMemo<LocationCityOption[]>(() => {
    const trimmed = cityQuery.trim();
    const list = [...cityResults];
    if (!selectedCountry || trimmed.length < 2) {
      return list;
    }
    const alreadyExact = list.some((c) => foldDiacritics(c.name) === foldDiacritics(trimmed));
    if (!alreadyExact) {
      const countryDisplay = selectedCountry.localizedName || selectedCountry.name;
      list.push({
        id: `custom:${selectedCountry.code}:${selectedState?.code || ''}:${trimmed}`,
        name: trimmed,
        state: selectedState?.name || '',
        stateCode: selectedState?.code || '',
        country: countryDisplay,
        countryCode: selectedCountry.code,
        subtitle: [selectedState?.name, countryDisplay].filter(Boolean).join(', '),
        latitude: null,
        longitude: null,
        verified: false,
        isCustomEntry: true,
      });
    }
    return list;
  }, [cityResults, cityQuery, selectedCountry, selectedState]);

  // Selection Handlers (Strict Cascading Reset & Stale Coordinate Prevention)
  const handleSelectCountry = useCallback(
    (country: LocationCountryOption) => {
      setSelectedCountry(country);
      setCountryQuery(country.localizedName || country.name);
      // Clear downstream State & City completely
      setSelectedState(null);
      setStateQuery('');
      setSelectedCity(null);
      setCityQuery('');
      setCityResults([]);
      setValidationError(null);
      setOpenDropdown(null);
      setHighlightedIndex(-1);
      sessionTokenRef.current = generateSessionToken();
    },
    []
  );

  const handleSelectState = useCallback((state: LocationStateOption) => {
    setSelectedState(state);
    setStateQuery(state.name);
    // Clear downstream City completely
    setSelectedCity(null);
    setCityQuery('');
    setCityResults([]);
    setValidationError(null);
    setOpenDropdown(null);
    setHighlightedIndex(-1);
    sessionTokenRef.current = generateSessionToken();
  }, []);

  const commitCityToApp = useCallback(
    (resolvedCity: LocationCityOption) => {
      if (!selectedCountry) return;
      const finalState = resolvedCity.state || selectedState?.name || '';
      const finalStateCode = resolvedCity.stateCode || selectedState?.code || '';
      const finalCountry =
        resolvedCity.country || selectedCountry.localizedName || selectedCountry.name;
      const finalCountryCode = resolvedCity.countryCode || selectedCountry.code;
      const hasCoords =
        typeof resolvedCity.latitude === 'number' &&
        typeof resolvedCity.longitude === 'number' &&
        Number.isFinite(resolvedCity.latitude) &&
        Number.isFinite(resolvedCity.longitude);

      const formattedLocationName = [resolvedCity.name, finalState, finalCountry]
        .filter((part, idx, arr) => Boolean(part) && arr.indexOf(part) === idx)
        .join(', ');

      onApplyLocation({
        cityName: resolvedCity.name,
        state: finalState,
        stateCode: finalStateCode,
        country: finalCountry,
        countryCode: finalCountryCode,
        latitude: hasCoords ? resolvedCity.latitude : null,
        longitude: hasCoords ? resolvedCity.longitude : null,
        locationName: formattedLocationName,
        placeId: resolvedCity.placeId,
        isVerified: Boolean(resolvedCity.verified && hasCoords),
      });
    },
    [onApplyLocation, selectedCountry, selectedState]
  );

  const handleSelectCityOption = useCallback(
    async (option: LocationCityOption) => {
      if (!selectedCountry) return;
      setValidationError(null);
      setOpenDropdown(null);
      setHighlightedIndex(-1);

      // If this option comes from Google Places Autocomplete without coords yet, resolve Place ID first
      if (
        !option.isCustomEntry &&
        option.placeId &&
        (option.latitude === null || option.longitude === null)
      ) {
        setIsResolvingPlace(true);
        try {
          const res = await fetch('/api/locations/resolve-place', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({
              placeId: option.placeId,
              sessionToken: sessionTokenRef.current,
              expectedCountryCode: selectedCountry.code,
              expectedCountryName: selectedCountry.name,
              expectedStateName: option.state || selectedState?.name || '',
              expectedStateCode: option.stateCode || selectedState?.code || '',
              fallbackName: option.name,
              language: langName,
            }),
          });
          notifyGmpQuotaExceededIfNeeded(res.status);
          const data = await res.json().catch(() => ({}));
          notifyGmpQuotaExceededIfNeeded(data);

          sessionTokenRef.current = generateSessionToken();

          if (res.ok && data?.success && data?.place) {
            const resolved: LocationCityOption = data.place;
            setSelectedCity(resolved);
            setCityQuery(resolved.name);
            if (!selectedState && resolved.state) {
              setSelectedState({
                code: resolved.stateCode || '',
                name: resolved.state,
                countryCode: selectedCountry.code,
              });
              setStateQuery(resolved.state);
            }
            commitCityToApp(resolved);
            return;
          }
        } catch {
          // fall through cleanly to honest unverified fallback
        } finally {
          setIsResolvingPlace(false);
        }

        // Honest fallback without fabricating coords if Place ID resolution was unavailable
        const honestUnverified: LocationCityOption = {
          ...option,
          latitude: null,
          longitude: null,
          verified: false,
        };
        setSelectedCity(honestUnverified);
        setCityQuery(honestUnverified.name);
        commitCityToApp(honestUnverified);
        return;
      }

      sessionTokenRef.current = generateSessionToken();
      setSelectedCity(option);
      setCityQuery(option.name);
      if (!selectedState && option.state) {
        setSelectedState({
          code: option.stateCode || '',
          name: option.state,
          countryCode: selectedCountry.code,
        });
        setStateQuery(option.state);
      }
      commitCityToApp(option);
    },
    [commitCityToApp, langName, selectedCountry, selectedState]
  );

  // Explicit Apply Button Handler (supports clicking Apply after selecting or typing custom name)
  const handleExplicitApply = useCallback(async () => {
    setValidationError(null);
    if (!selectedCountry) {
      setValidationError(ui.countryRequiredHint);
      setOpenDropdown('country');
      countryInputRef.current?.focus();
      return;
    }

    if (selectedCity) {
      await handleSelectCityOption(selectedCity);
      return;
    }

    const typedCity = cityQuery.trim();
    if (!typedCity) {
      setOpenDropdown('city');
      cityInputRef.current?.focus();
      return;
    }

    const exactMatch = cityResults.find(
      (c) => foldDiacritics(c.name) === foldDiacritics(typedCity)
    );
    if (exactMatch) {
      await handleSelectCityOption(exactMatch);
      return;
    }

    const countryDisplay = selectedCountry.localizedName || selectedCountry.name;
    const customOption: LocationCityOption = {
      id: `custom:${selectedCountry.code}:${selectedState?.code || ''}:${typedCity}`,
      name: typedCity,
      state: selectedState?.name || '',
      stateCode: selectedState?.code || '',
      country: countryDisplay,
      countryCode: selectedCountry.code,
      subtitle: [selectedState?.name, countryDisplay].filter(Boolean).join(', '),
      latitude: null,
      longitude: null,
      verified: false,
      isCustomEntry: true,
    };
    await handleSelectCityOption(customOption);
  }, [
    cityQuery,
    cityResults,
    handleSelectCityOption,
    selectedCity,
    selectedCountry,
    selectedState,
    ui.countryRequiredHint,
  ]);

  // Keyboard navigation helper
  const handleKeyDown = (
    field: 'country' | 'state' | 'city',
    e: React.KeyboardEvent<HTMLInputElement>
  ) => {
    const optionsLength =
      field === 'country'
        ? countryResults.length
        : field === 'state'
        ? stateResults.length
        : cityDropdownOptions.length;

    if (e.key === 'ArrowDown') {
      e.preventDefault();
      if (openDropdown !== field) {
        setOpenDropdown(field);
        setHighlightedIndex(optionsLength > 0 ? 0 : -1);
      } else if (optionsLength > 0) {
        setHighlightedIndex((prev) => (prev + 1) % optionsLength);
      }
    } else if (e.key === 'ArrowUp') {
      e.preventDefault();
      if (openDropdown !== field) {
        setOpenDropdown(field);
        setHighlightedIndex(optionsLength > 0 ? optionsLength - 1 : -1);
      } else if (optionsLength > 0) {
        setHighlightedIndex((prev) => (prev <= 0 ? optionsLength - 1 : prev - 1));
      }
    } else if (e.key === 'Enter') {
      if (openDropdown === field && highlightedIndex >= 0 && highlightedIndex < optionsLength) {
        e.preventDefault();
        if (field === 'country') {
          handleSelectCountry(countryResults[highlightedIndex]);
        } else if (field === 'state') {
          handleSelectState(stateResults[highlightedIndex]);
        } else {
          handleSelectCityOption(cityDropdownOptions[highlightedIndex]);
        }
      } else if (field === 'city' && cityQuery.trim()) {
        e.preventDefault();
        handleExplicitApply();
      }
    } else if (e.key === 'Escape') {
      if (openDropdown === field) {
        e.preventDefault();
        e.stopPropagation();
        setOpenDropdown(null);
        setHighlightedIndex(-1);
      }
    } else if (e.key === 'Tab') {
      setOpenDropdown(null);
      setHighlightedIndex(-1);
    }
  };

  return (
    <div
      ref={containerRef}
      dir={isRtl ? 'rtl' : 'ltr'}
      className="space-y-3 relative"
    >
      {!compact && (
        <div className="flex items-center justify-between gap-2 flex-wrap">
          <h3 className="text-xs font-bold text-[var(--theme-accent-primary)] uppercase tracking-wider flex items-center gap-1.5">
            <Globe className="w-3.5 h-3.5 shrink-0" />
            <span>{ui.heading}</span>
          </h3>
          <span className="text-[10.5px] text-[var(--theme-text-muted)]">{ui.subheading}</span>
        </div>
      )}

      {/* 3 Cascading Searchable Comboboxes */}
      <div className="grid grid-cols-1 sm:grid-cols-3 gap-2.5">
        {/* 1. COUNTRY COMBOBOX */}
        <div className={`space-y-1 relative ${openDropdown === 'country' ? 'z-[60]' : 'z-20'}`}>
          <label
            htmlFor="input-country-search"
            className="text-[10.5px] font-bold text-[var(--theme-text-body)] flex items-center gap-1"
          >
            <Globe className="w-3 h-3 text-[var(--theme-accent-primary)] shrink-0" />
            <span>{ui.countryLabel}</span>
          </label>
          <div className="relative">
            <input
              ref={countryInputRef}
              id="input-country-search"
              type="text"
              role="combobox"
              aria-expanded={openDropdown === 'country'}
              aria-controls="listbox-country-options"
              aria-autocomplete="list"
              aria-activedescendant={
                openDropdown === 'country' && highlightedIndex >= 0
                  ? `option-country-${highlightedIndex}`
                  : undefined
              }
              value={countryQuery}
              placeholder={ui.countryPlaceholder}
              onFocus={() => {
                setOpenDropdown('country');
                setHighlightedIndex(-1);
              }}
              onClick={() => {
                setOpenDropdown('country');
              }}
              onChange={(e) => {
                const next = e.target.value;
                setCountryQuery(next);
                setOpenDropdown('country');
                setHighlightedIndex(0);
                setValidationError(null);
                // Immediately clear confirmed Country + downstream State/City when text changes
                if (
                  selectedCountry &&
                  foldDiacritics(next) !==
                    foldDiacritics(selectedCountry.localizedName || selectedCountry.name)
                ) {
                  setSelectedCountry(null);
                  setSelectedState(null);
                  setStateQuery('');
                  setSelectedCity(null);
                  setCityQuery('');
                  setCityResults([]);
                }
              }}
              onKeyDown={(e) => handleKeyDown('country', e)}
              style={{
                backgroundColor: 'var(--theme-input-bg)',
                borderColor:
                  openDropdown === 'country'
                    ? 'var(--theme-accent-primary)'
                    : 'var(--theme-input-border)',
                color: 'var(--theme-text-title)',
              }}
              className="w-full min-h-[40px] py-2 ps-3 pe-9 rounded-xl border text-xs font-semibold focus:outline-none placeholder:text-[var(--theme-text-muted)]"
            />
            {countryQuery ? (
              <button
                type="button"
                aria-label="Clear country"
                onClick={() => {
                  setCountryQuery('');
                  setSelectedCountry(null);
                  setSelectedState(null);
                  setStateQuery('');
                  setSelectedCity(null);
                  setCityQuery('');
                  setCityResults([]);
                  setOpenDropdown('country');
                  countryInputRef.current?.focus();
                }}
                className="absolute end-2 top-1/2 -translate-y-1/2 p-1 rounded-md text-[var(--theme-text-muted)] hover:text-[var(--theme-text-title)] cursor-pointer"
              >
                <X className="w-3.5 h-3.5" />
              </button>
            ) : (
              <ChevronDown className="w-3.5 h-3.5 text-[var(--theme-accent-primary)] absolute end-2.5 top-1/2 -translate-y-1/2 pointer-events-none" />
            )}
          </div>

          {openDropdown === 'country' && (
            <ul
              id="listbox-country-options"
              role="listbox"
              style={{
                backgroundColor: 'var(--theme-card-bg)',
                borderColor: 'var(--theme-card-border-glow)',
              }}
              className="absolute start-0 end-0 top-full mt-1 max-h-60 overflow-y-auto overscroll-contain rounded-xl border shadow-2xl py-1 backdrop-blur-xl z-[70]"
            >
              {countryResults.length === 0 ? (
                <li className="px-3 py-2.5 text-xs text-[var(--theme-text-muted)]">
                  {ui.noCountriesFound}
                </li>
              ) : (
                countryResults.map((c, idx) => {
                  const isActive = selectedCountry?.code === c.code;
                  const isHighlighted = highlightedIndex === idx;
                  const showEnglishSub =
                    c.localizedName &&
                    foldDiacritics(c.localizedName) !== foldDiacritics(c.name);
                  return (
                    <li
                      key={c.code}
                      id={`option-country-${idx}`}
                      role="option"
                      aria-selected={isActive}
                      onMouseDown={(e) => {
                        e.preventDefault();
                        handleSelectCountry(c);
                      }}
                      style={{
                        backgroundColor:
                          isHighlighted || isActive
                            ? 'var(--theme-card-bg-subtle)'
                            : 'transparent',
                        color: 'var(--theme-text-title)',
                      }}
                      className="px-3 py-2 text-xs cursor-pointer flex items-center justify-between gap-2 hover:bg-[var(--theme-card-bg-subtle)] transition-colors"
                    >
                      <span className="flex items-center gap-2 min-w-0">
                        <span className="text-sm shrink-0">{c.flag}</span>
                        <span className="font-semibold truncate">
                          {c.localizedName || c.name}
                          {showEnglishSub ? (
                            <span className="ms-1.5 text-[10.5px] font-normal text-[var(--theme-text-muted)]">
                              ({c.name})
                            </span>
                          ) : null}
                        </span>
                      </span>
                      <span className="text-[10px] font-mono text-[var(--theme-text-muted)] shrink-0">
                        {c.code}
                      </span>
                    </li>
                  );
                })
              )}
            </ul>
          )}
        </div>

        {/* 2. STATE / REGION COMBOBOX */}
        <div className={`space-y-1 relative ${openDropdown === 'state' ? 'z-[60]' : 'z-20'}`}>
          <label
            htmlFor="input-state-search"
            className="text-[10.5px] font-bold text-[var(--theme-text-body)] flex items-center gap-1"
          >
            <Building className="w-3 h-3 text-[var(--theme-accent-primary)] shrink-0" />
            <span>{ui.stateLabel}</span>
          </label>
          <div className="relative">
            <input
              ref={stateInputRef}
              id="input-state-search"
              type="text"
              role="combobox"
              disabled={!selectedCountry || (selectedCountry && !countryHasStates && !isLoadingStates)}
              aria-expanded={openDropdown === 'state'}
              aria-controls="listbox-state-options"
              aria-autocomplete="list"
              aria-activedescendant={
                openDropdown === 'state' && highlightedIndex >= 0
                  ? `option-state-${highlightedIndex}`
                  : undefined
              }
              value={stateQuery}
              placeholder={
                !selectedCountry
                  ? ui.statePickCountryFirst
                  : !countryHasStates && !isLoadingStates
                  ? ui.stateNotApplicable
                  : ui.statePlaceholder
              }
              onFocus={() => {
                if (selectedCountry && countryHasStates) {
                  setOpenDropdown('state');
                  setHighlightedIndex(-1);
                }
              }}
              onClick={() => {
                if (selectedCountry && countryHasStates) {
                  setOpenDropdown('state');
                }
              }}
              onChange={(e) => {
                const next = e.target.value;
                setStateQuery(next);
                setOpenDropdown('state');
                setHighlightedIndex(0);
                // Clear confirmed State + downstream City immediately when edited
                if (selectedState && foldDiacritics(next) !== foldDiacritics(selectedState.name)) {
                  setSelectedState(null);
                  setSelectedCity(null);
                  setCityQuery('');
                  setCityResults([]);
                }
              }}
              onKeyDown={(e) => handleKeyDown('state', e)}
              style={{
                backgroundColor: 'var(--theme-input-bg)',
                borderColor:
                  openDropdown === 'state'
                    ? 'var(--theme-accent-primary)'
                    : 'var(--theme-input-border)',
                color: 'var(--theme-text-title)',
              }}
              className="w-full min-h-[40px] py-2 ps-3 pe-9 rounded-xl border text-xs font-semibold focus:outline-none placeholder:text-[var(--theme-text-muted)] disabled:opacity-55 disabled:cursor-not-allowed"
            />
            {isLoadingStates ? (
              <Loader2 className="w-3.5 h-3.5 animate-spin text-[var(--theme-accent-primary)] absolute end-2.5 top-1/2 -translate-y-1/2 pointer-events-none" />
            ) : stateQuery && selectedCountry ? (
              <button
                type="button"
                aria-label={ui.clearStateTitle}
                title={ui.clearStateTitle}
                onClick={() => {
                  setStateQuery('');
                  setSelectedState(null);
                  setSelectedCity(null);
                  setCityQuery('');
                  setCityResults([]);
                  if (countryHasStates) {
                    setOpenDropdown('state');
                    stateInputRef.current?.focus();
                  }
                }}
                className="absolute end-2 top-1/2 -translate-y-1/2 p-1 rounded-md text-[var(--theme-text-muted)] hover:text-[var(--theme-text-title)] cursor-pointer"
              >
                <X className="w-3.5 h-3.5" />
              </button>
            ) : (
              <ChevronDown className="w-3.5 h-3.5 text-[var(--theme-accent-primary)] absolute end-2.5 top-1/2 -translate-y-1/2 pointer-events-none" />
            )}
          </div>

          {openDropdown === 'state' && selectedCountry && countryHasStates && (
            <ul
              id="listbox-state-options"
              role="listbox"
              style={{
                backgroundColor: 'var(--theme-card-bg)',
                borderColor: 'var(--theme-card-border-glow)',
              }}
              className="absolute start-0 end-0 top-full mt-1 max-h-60 overflow-y-auto overscroll-contain rounded-xl border shadow-2xl py-1 backdrop-blur-xl z-[70]"
            >
              {stateResults.length === 0 ? (
                <li className="px-3 py-2.5 text-xs text-[var(--theme-text-muted)]">
                  {ui.noStatesFound}
                </li>
              ) : (
                stateResults.map((s, idx) => {
                  const isActive =
                    selectedState?.code === s.code &&
                    foldDiacritics(selectedState?.name) === foldDiacritics(s.name);
                  const isHighlighted = highlightedIndex === idx;
                  return (
                    <li
                      key={`${s.countryCode}-${s.code}-${s.name}`}
                      id={`option-state-${idx}`}
                      role="option"
                      aria-selected={isActive}
                      onMouseDown={(e) => {
                        e.preventDefault();
                        handleSelectState(s);
                      }}
                      style={{
                        backgroundColor:
                          isHighlighted || isActive
                            ? 'var(--theme-card-bg-subtle)'
                            : 'transparent',
                        color: 'var(--theme-text-title)',
                      }}
                      className="px-3 py-2 text-xs cursor-pointer flex items-center justify-between gap-2 hover:bg-[var(--theme-card-bg-subtle)] transition-colors"
                    >
                      <span className="font-semibold truncate">{s.name}</span>
                      {s.code && (
                        <span className="text-[10px] font-mono text-[var(--theme-text-muted)] shrink-0">
                          {s.code}
                        </span>
                      )}
                    </li>
                  );
                })
              )}
            </ul>
          )}
        </div>

        {/* 3. CITY / TOWN / VILLAGE COMBOBOX */}
        <div className={`space-y-1 relative ${openDropdown === 'city' ? 'z-[60]' : 'z-20'}`}>
          <label
            htmlFor="input-city-search"
            className="text-[10.5px] font-bold text-[var(--theme-text-body)] flex items-center gap-1"
          >
            <MapPin className="w-3 h-3 text-[var(--theme-accent-primary)] shrink-0" />
            <span>{ui.cityLabel}</span>
          </label>
          <div className="relative">
            <input
              ref={cityInputRef}
              id="input-city-search"
              type="text"
              role="combobox"
              disabled={!selectedCountry}
              aria-expanded={openDropdown === 'city'}
              aria-controls="listbox-city-options"
              aria-autocomplete="list"
              aria-activedescendant={
                openDropdown === 'city' && highlightedIndex >= 0
                  ? `option-city-${highlightedIndex}`
                  : undefined
              }
              value={cityQuery}
              placeholder={selectedCountry ? ui.cityPlaceholder : ui.cityPickCountryFirst}
              onFocus={() => {
                if (selectedCountry) {
                  setOpenDropdown('city');
                  setHighlightedIndex(-1);
                }
              }}
              onClick={() => {
                if (selectedCountry) {
                  setOpenDropdown('city');
                }
              }}
              onChange={(e) => {
                const next = e.target.value;
                setCityQuery(next);
                setOpenDropdown('city');
                setHighlightedIndex(0);
                setValidationError(null);
                // CRITICAL: Immediately clear stale placeId/lat/lng/isVerified when typing into city input
                if (selectedCity && foldDiacritics(next) !== foldDiacritics(selectedCity.name)) {
                  setSelectedCity(null);
                }
              }}
              onKeyDown={(e) => handleKeyDown('city', e)}
              style={{
                backgroundColor: 'var(--theme-input-bg)',
                borderColor:
                  openDropdown === 'city'
                    ? 'var(--theme-accent-primary)'
                    : 'var(--theme-input-border)',
                color: 'var(--theme-text-title)',
              }}
              className="w-full min-h-[40px] py-2 ps-3 pe-9 rounded-xl border text-xs font-semibold focus:outline-none placeholder:text-[var(--theme-text-muted)] disabled:opacity-55 disabled:cursor-not-allowed"
            />
            {isLoadingCities || isResolvingPlace ? (
              <Loader2 className="w-3.5 h-3.5 animate-spin text-[var(--theme-accent-primary)] absolute end-2.5 top-1/2 -translate-y-1/2 pointer-events-none" />
            ) : cityQuery && selectedCountry ? (
              <button
                type="button"
                aria-label="Clear city"
                onClick={() => {
                  setCityQuery('');
                  setSelectedCity(null);
                  setOpenDropdown('city');
                  cityInputRef.current?.focus();
                }}
                className="absolute end-2 top-1/2 -translate-y-1/2 p-1 rounded-md text-[var(--theme-text-muted)] hover:text-[var(--theme-text-title)] cursor-pointer"
              >
                <X className="w-3.5 h-3.5" />
              </button>
            ) : (
              <Search className="w-3.5 h-3.5 text-[var(--theme-accent-primary)] absolute end-2.5 top-1/2 -translate-y-1/2 pointer-events-none" />
            )}
          </div>

          {openDropdown === 'city' && selectedCountry && (
            <ul
              id="listbox-city-options"
              role="listbox"
              style={{
                backgroundColor: 'var(--theme-card-bg)',
                borderColor: 'var(--theme-card-border-glow)',
              }}
              className="absolute start-0 end-0 top-full mt-1 max-h-64 overflow-y-auto overscroll-contain rounded-xl border shadow-2xl py-1 backdrop-blur-xl z-[70]"
            >
              {isLoadingCities && cityDropdownOptions.length === 0 ? (
                <li className="px-3 py-2.5 text-xs text-[var(--theme-text-muted)] flex items-center gap-2">
                  <Loader2 className="w-3.5 h-3.5 animate-spin text-[var(--theme-accent-primary)] shrink-0" />
                  <span>{ui.searchingPlaces}</span>
                </li>
              ) : cityDropdownOptions.length === 0 ? (
                <li className="px-3 py-2.5 text-xs text-[var(--theme-text-muted)]">
                  {cityProviderWarning || ui.noCityMatches}
                </li>
              ) : (
                cityDropdownOptions.map((item, idx) => {
                  const isActive = selectedCity?.id === item.id;
                  const isHighlighted = highlightedIndex === idx;
                  return (
                    <li
                      key={item.id}
                      id={`option-city-${idx}`}
                      role="option"
                      aria-selected={isActive}
                      onMouseDown={(e) => {
                        e.preventDefault();
                        handleSelectCityOption(item);
                      }}
                      style={{
                        backgroundColor:
                          isHighlighted || isActive
                            ? 'var(--theme-card-bg-subtle)'
                            : 'transparent',
                        color: 'var(--theme-text-title)',
                      }}
                      className="px-3 py-2 text-xs cursor-pointer flex items-start justify-between gap-2 hover:bg-[var(--theme-card-bg-subtle)] transition-colors"
                    >
                      {item.isCustomEntry ? (
                        <div className="flex items-start gap-2 min-w-0">
                          <PlusCircle className="w-4 h-4 text-[var(--theme-accent-primary)] shrink-0 mt-0.5" />
                          <div className="min-w-0">
                            <div className="font-bold text-[var(--theme-accent-primary)] truncate">
                              {ui.useCustomPrefix} &ldquo;{item.name}&rdquo;
                            </div>
                            <div className="text-[10.5px] text-[var(--theme-text-muted)] truncate">
                              {ui.customUnverifiedHint}
                              {item.subtitle ? ` · ${item.subtitle}` : ''}
                            </div>
                          </div>
                        </div>
                      ) : (
                        <>
                          <div className="min-w-0">
                            <div className="font-semibold truncate flex items-center gap-1.5">
                              <MapPin className="w-3 h-3 text-[var(--theme-accent-primary)] shrink-0" />
                              <span className="truncate">{item.name}</span>
                            </div>
                            {item.subtitle && (
                              <div className="text-[10.5px] text-[var(--theme-text-muted)] truncate ps-4">
                                {item.subtitle}
                              </div>
                            )}
                          </div>
                          {item.verified && item.latitude !== null && (
                            <CheckCircle2 className="w-3.5 h-3.5 text-emerald-400 shrink-0 mt-0.5" />
                          )}
                        </>
                      )}
                    </li>
                  );
                })
              )}
            </ul>
          )}
        </div>
      </div>

      {/* Validation / Provider Notice */}
      {validationError && (
        <p role="alert" className="text-[11px] text-rose-400 font-medium flex items-center gap-1.5">
          <AlertCircle className="w-3.5 h-3.5 shrink-0" />
          <span>{validationError}</span>
        </p>
      )}
      {!validationError && cityProviderWarning && (
        <p className="text-[11px] text-amber-300/90 font-medium flex items-center gap-1.5">
          <AlertCircle className="w-3.5 h-3.5 shrink-0" />
          <span>{cityProviderWarning}</span>
        </p>
      )}

      {/* Summary & Primary Apply Action */}
      <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-2 pt-1">
        <div className="text-xs text-[var(--theme-text-muted)] min-w-0 flex items-center gap-1.5 flex-wrap">
          {selectedCity ? (
            <>
              <span className="font-bold text-[var(--theme-accent-primary)] shrink-0">
                {ui.activeSelectionPrefix}
              </span>
              <span className="font-semibold text-[var(--theme-text-title)] truncate">
                {[selectedCity.name, selectedCity.state || selectedState?.name, selectedCountry?.localizedName || selectedCountry?.name]
                  .filter((p, i, arr) => Boolean(p) && arr.indexOf(p) === i)
                  .join(', ')}
              </span>
              <span
                className={`text-[10px] px-2 py-0.5 rounded-full font-semibold ${
                  selectedCity.verified && selectedCity.latitude !== null
                    ? 'theme-badge-teal'
                    : 'theme-badge-gold'
                }`}
              >
                {selectedCity.verified && selectedCity.latitude !== null
                  ? ui.verifiedBadge
                  : ui.unverifiedBadge}
              </span>
            </>
          ) : selectedCountry ? (
            <span className="truncate">
              {selectedCountry.flag} {selectedCountry.localizedName || selectedCountry.name}
              {selectedState ? ` · ${selectedState.name}` : ''}
            </span>
          ) : (
            <span>{ui.countryRequiredHint}</span>
          )}
        </div>

        <button
          id="btn-apply-manual-city"
          type="button"
          disabled={
            isResolvingPlace ||
            !selectedCountry ||
            (!selectedCity && cityQuery.trim().length < 2)
          }
          onClick={handleExplicitApply}
          className="w-full sm:w-auto min-h-[40px] px-4 py-2 rounded-xl theme-btn-primary font-bold text-xs shadow-md active:scale-95 transition-all cursor-pointer flex items-center justify-center gap-1.5 whitespace-nowrap disabled:opacity-55 disabled:cursor-not-allowed shrink-0"
        >
          {isResolvingPlace ? (
            <Loader2 className="w-4 h-4 animate-spin" />
          ) : (
            <Check className="w-4 h-4" />
          )}
          <span>
            {isResolvingPlace ? ui.resolvingPlace : applyButtonLabel || ui.applyButton}
          </span>
        </button>
      </div>
    </div>
  );
};
