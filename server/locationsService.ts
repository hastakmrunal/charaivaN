import { Country, State, City } from 'country-state-city';
import { WORLD_LOCATIONS } from '../src/data/worldLocations';
import {
  GMP_SOLUTION_ID,
  isGmpQuotaError,
  mapLanguageToBcp47,
} from './realPlacesDiscovery';

export interface ServerStateOption {
  code: string;
  name: string;
  countryCode: string;
}

export interface ServerCityOption {
  id: string;
  name: string;
  state: string;
  stateCode: string;
  country: string;
  countryCode: string;
  subtitle: string;
  latitude: number | null;
  longitude: number | null;
  placeId?: string;
  source: 'curated' | 'country_state_city' | 'google_places_autocomplete' | 'google_geocoding' | 'openstreetmap';
  verified: boolean;
}

export function foldText(input: string): string {
  return String(input || '')
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '')
    .toLowerCase()
    .trim();
}

function scoreMatch(candidate: string, query: string): number {
  const c = foldText(candidate);
  const q = foldText(query);
  if (!q) return 100;
  if (!c) return 0;
  if (c === q) return 1000;
  if (c.startsWith(q)) return 800;
  const words = c.split(/[\s\-(),'/]+/);
  if (words.some((w) => w.startsWith(q))) return 600;
  if (c.includes(q)) return 350;
  return 0;
}

const stateCache = new Map<string, ServerStateOption[]>();
const stateNameByCodeCache = new Map<string, Map<string, string>>();

export function getStatesForCountry(
  countryCodeInput: string,
  query: string = '',
  limit: number = 60
): { states: ServerStateOption[]; hasStates: boolean; totalCount: number } {
  const countryCode = String(countryCodeInput || '').trim().toUpperCase();
  if (!countryCode || countryCode.length !== 2) {
    return { states: [], hasStates: false, totalCount: 0 };
  }

  let allStates = stateCache.get(countryCode);
  if (!allStates) {
    const raw = State.getStatesOfCountry(countryCode) || [];
    allStates = raw
      .map((s) => ({
        code: s.isoCode,
        name: s.name,
        countryCode,
      }))
      .sort((a, b) => a.name.localeCompare(b.name));
    stateCache.set(countryCode, allStates);

    const map = new Map<string, string>();
    for (const st of allStates) {
      map.set(st.code.toUpperCase(), st.name);
    }
    stateNameByCodeCache.set(countryCode, map);
  }

  const totalCount = allStates.length;
  const hasStates = totalCount > 0;
  const cleanQuery = String(query || '').trim();
  if (!cleanQuery) {
    return { states: allStates.slice(0, limit), hasStates, totalCount };
  }

  const scored = allStates
    .map((state) => ({
      state,
      score: Math.max(scoreMatch(state.name, cleanQuery), state.code.toUpperCase() === cleanQuery.toUpperCase() ? 900 : 0),
    }))
    .filter((item) => item.score > 0)
    .sort((a, b) => b.score - a.score || a.state.name.localeCompare(b.state.name));

  return {
    states: scored.slice(0, limit).map((item) => item.state),
    hasStates,
    totalCount,
  };
}

function resolveStateName(countryCode: string, stateCode?: string): string {
  if (!stateCode) return '';
  getStatesForCountry(countryCode);
  const map = stateNameByCodeCache.get(countryCode.toUpperCase());
  return map?.get(stateCode.toUpperCase()) || '';
}

const CITY_EXCLUDED_TYPES = new Set([
  'country',
  'continent',
  'ocean',
  'sea',
  'postal_code',
  'street_address',
  'route',
  'premise',
  'establishment',
  'point_of_interest',
]);

const CITY_SETTLEMENT_TYPES = new Set([
  'locality',
  'sublocality',
  'sublocality_level_1',
  'sublocality_level_2',
  'postal_town',
  'administrative_area_level_3',
  'administrative_area_level_4',
  'administrative_area_level_2',
  'neighborhood',
  'colloquial_area',
]);

export async function searchWorldwideSettlements(params: {
  countryCode: string;
  countryName?: string;
  stateCode?: string;
  stateName?: string;
  query?: string;
  language?: string;
  sessionToken?: string;
  limit?: number;
}): Promise<{
  cities: ServerCityOption[];
  providerErrors: string[];
  quotaExceeded: boolean;
}> {
  const countryCode = String(params.countryCode || '').trim().toUpperCase();
  const limit = Math.min(40, Math.max(5, Number(params.limit) || 20));
  if (!countryCode || countryCode.length !== 2) {
    return { cities: [], providerErrors: ['Valid country code is required'], quotaExceeded: false };
  }

  const countryRecord = Country.getCountryByCode(countryCode);
  const countryName = params.countryName?.trim() || countryRecord?.name || countryCode;
  const stateCode = String(params.stateCode || '').trim();
  const stateName =
    params.stateName?.trim() || (stateCode ? resolveStateName(countryCode, stateCode) : '');
  const query = String(params.query || '').trim();
  const foldQuery = foldText(query);
  const bcp47 = mapLanguageToBcp47(params.language || 'English');
  const providerErrors: string[] = [];
  let quotaExceeded = false;

  const collected: ServerCityOption[] = [];

  // 1. Curated destinations scoped strictly to selected country (& state if provided)
  for (const c of WORLD_LOCATIONS) {
    if (c.code.toUpperCase() !== countryCode) continue;
    for (const st of c.states) {
      if (stateName && foldText(st.name) !== foldText(stateName) && (!stateCode || st.code?.toUpperCase() !== stateCode.toUpperCase())) {
        continue;
      }
      for (const city of st.cities) {
        if (!foldQuery || scoreMatch(city.name, query) > 0) {
          collected.push({
            id: `curated:${countryCode}:${st.code || st.name}:${city.name}`,
            name: city.name,
            state: st.name,
            stateCode: st.code || '',
            country: countryName,
            countryCode,
            subtitle: [st.name, countryName].filter(Boolean).join(', '),
            latitude: city.latitude,
            longitude: city.longitude,
            source: 'curated',
            verified: true,
          });
        }
      }
    }
  }

  // 2. Worldwide country-state-city database (~148k settlements with lat/lng)
  const rawCscCities = stateCode
    ? City.getCitiesOfState(countryCode, stateCode) || []
    : City.getCitiesOfCountry(countryCode) || [];

  const matchedCsc: Array<{ city: any; score: number }> = [];
  for (const city of rawCscCities) {
    const lat = Number(city.latitude);
    const lng = Number(city.longitude);
    if (!Number.isFinite(lat) || !Number.isFinite(lng)) continue;

    if (!foldQuery) {
      matchedCsc.push({ city, score: 100 });
      if (matchedCsc.length >= limit * 2) break;
    } else {
      const s = scoreMatch(city.name, query);
      if (s > 0) {
        matchedCsc.push({ city, score: s });
      }
    }
  }

  matchedCsc.sort((a, b) => b.score - a.score || a.city.name.localeCompare(b.city.name));
  for (const { city } of matchedCsc.slice(0, limit)) {
    const resolvedState = stateName || resolveStateName(countryCode, city.stateCode);
    const lat = Number(city.latitude);
    const lng = Number(city.longitude);
    collected.push({
      id: `csc:${countryCode}:${city.stateCode || ''}:${city.name}`,
      name: city.name,
      state: resolvedState,
      stateCode: city.stateCode || stateCode || '',
      country: countryName,
      countryCode,
      subtitle: [resolvedState, countryName].filter(Boolean).join(', '),
      latitude: lat,
      longitude: lng,
      source: 'country_state_city',
      verified: true,
    });
  }

  // 3. Live worldwide Places Autocomplete (New) + Nominatim for villages/towns/non-Latin queries when user types >= 2 chars
  const hasExactOfflineMatch = foldQuery
    ? collected.some((c) => foldText(c.name) === foldQuery)
    : false;
  const shouldQueryRemote =
    query.length >= 2 && (!hasExactOfflineMatch || collected.length < 6);

  if (shouldQueryRemote) {
    const gmpApiKey = process.env.GOOGLE_MAPS_PLATFORM_KEY || '';
    const remoteTasks: Array<Promise<void>> = [];

    if (gmpApiKey) {
      remoteTasks.push(
        (async () => {
          try {
            const acInput = stateName ? `${query}, ${stateName}` : query;
            const body: Record<string, any> = {
              input: acInput,
              includedRegionCodes: [countryCode.toLowerCase()],
              includedPrimaryTypes: ['(regions)'],
              languageCode: bcp47,
            };
            if (params.sessionToken && typeof params.sessionToken === 'string') {
              body.sessionToken = params.sessionToken;
            }
            const acRes = await fetch('https://places.googleapis.com/v1/places:autocomplete', {
              method: 'POST',
              headers: {
                'Content-Type': 'application/json',
                'X-Goog-Api-Key': gmpApiKey,
                'X-Goog-Maps-Solution-ID': GMP_SOLUTION_ID,
                'X-Goog-FieldMask':
                  'suggestions.placePrediction.placeId,suggestions.placePrediction.text.text,suggestions.placePrediction.structuredFormat,suggestions.placePrediction.types',
              },
              body: JSON.stringify(body),
              signal: AbortSignal.timeout(4000),
            });

            if (!acRes.ok) {
              const errText = await acRes.text().catch(() => '');
              if (isGmpQuotaError(acRes.status, errText)) {
                quotaExceeded = true;
              } else {
                providerErrors.push(`Places autocomplete status ${acRes.status}`);
              }
              return;
            }

            const acData = await acRes.json();
            const suggestions: any[] = Array.isArray(acData?.suggestions) ? acData.suggestions : [];
            for (const s of suggestions) {
              const pred = s?.placePrediction;
              if (!pred?.placeId) continue;
              const types: string[] = Array.isArray(pred.types) ? pred.types : [];
              // Skip top-level country-only predictions or non-geographic establishments
              if (types.includes('country') && !types.some((t) => CITY_SETTLEMENT_TYPES.has(t))) {
                continue;
              }
              if (types.length > 0 && types.every((t) => CITY_EXCLUDED_TYPES.has(t))) {
                continue;
              }

              const mainText =
                pred.structuredFormat?.mainText?.text ||
                String(pred.text?.text || '').split(',')[0]?.trim() ||
                '';
              if (!mainText) continue;
              const secondaryText = pred.structuredFormat?.secondaryText?.text || '';
              // Extract likely state/region from secondaryText (e.g. "Maharashtra, India" or "Maharashtra")
              const secParts = secondaryText
                .split(',')
                .map((p: string) => p.trim())
                .filter(Boolean);
              const extractedState =
                secParts.length >= 2
                  ? secParts[secParts.length - 2]
                  : secParts[0] && foldText(secParts[0]) !== foldText(countryName)
                  ? secParts[0]
                  : stateName;

              collected.push({
                id: `gmp:${pred.placeId}`,
                name: mainText,
                state: extractedState || stateName || '',
                stateCode: stateCode || '',
                country: countryName,
                countryCode,
                subtitle: secondaryText || [extractedState || stateName, countryName].filter(Boolean).join(', '),
                latitude: null,
                longitude: null,
                placeId: pred.placeId,
                source: 'google_places_autocomplete',
                verified: false, // Will be verified via /api/locations/resolve-place on click
              });
            }
          } catch (err: any) {
            if (err?.name !== 'AbortError') {
              providerErrors.push('Places autocomplete unavailable');
            }
          }
        })()
      );
    }

    // OpenStreetMap Nominatim settlement lookup (catches small villages & non-Latin scripts cleanly)
    remoteTasks.push(
      (async () => {
        try {
          const nomQ = stateName ? `${query}, ${stateName}, ${countryName}` : `${query}, ${countryName}`;
          const url = `https://nominatim.openstreetmap.org/search?format=json&q=${encodeURIComponent(
            nomQ
          )}&countrycodes=${encodeURIComponent(
            countryCode.toLowerCase()
          )}&addressdetails=1&limit=10&accept-language=${encodeURIComponent(bcp47)}`;
          const nomRes = await fetch(url, {
            headers: { 'User-Agent': 'CharaivaLocationSelector/1.0' },
            signal: AbortSignal.timeout(4000),
          });
          if (!nomRes.ok) {
            providerErrors.push(`Nominatim status ${nomRes.status}`);
            return;
          }
          const nomData = await nomRes.json();
          if (!Array.isArray(nomData)) return;

          for (const item of nomData) {
            const itemCc = String(item?.address?.country_code || '').toUpperCase();
            if (itemCc && itemCc !== countryCode) continue;

            const lat = parseFloat(item.lat);
            const lng = parseFloat(item.lon);
            if (!Number.isFinite(lat) || !Number.isFinite(lng)) continue;

            const addr = item.address || {};
            const resolvedCityName =
              addr.city ||
              addr.town ||
              addr.village ||
              addr.hamlet ||
              addr.municipality ||
              addr.suburb ||
              item.name ||
              '';
            if (!resolvedCityName) continue;

            const resolvedState =
              addr.state || addr.province || addr.region || addr.county || stateName || '';
            const district = addr.state_district || addr.county || '';
            const subtitleParts = [
              district && foldText(district) !== foldText(resolvedCityName) && foldText(district) !== foldText(resolvedState)
                ? district
                : '',
              resolvedState,
              countryName,
            ].filter(Boolean);

            collected.push({
              id: `osm:${item.place_id || `${lat.toFixed(4)},${lng.toFixed(4)}`}`,
              name: resolvedCityName,
              state: resolvedState,
              stateCode: stateCode || '',
              country: countryName,
              countryCode,
              subtitle: subtitleParts.join(', '),
              latitude: lat,
              longitude: lng,
              source: 'openstreetmap',
              verified: true,
            });
          }
        } catch (err: any) {
          if (err?.name !== 'AbortError') {
            providerErrors.push('Settlement lookup timed out');
          }
        }
      })()
    );

    await Promise.allSettled(remoteTasks);
  }

  // Deduplicate cleanly while preserving disambiguated cities in different states/districts
  const dedupMap = new Map<string, ServerCityOption>();
  for (const item of collected) {
    const key = `${foldText(item.name)}|${foldText(item.state || '')}|${item.countryCode}`;
    const existing = dedupMap.get(key);
    if (!existing) {
      dedupMap.set(key, item);
      continue;
    }
    // Prefer entry with verified coords, Google Place ID, or richer subtitle
    const existingScore =
      (existing.source === 'curated' ? 50 : 0) +
      (existing.verified && existing.latitude !== null ? 30 : 0) +
      (existing.placeId ? 20 : 0);
    const candidateScore =
      (item.source === 'curated' ? 50 : 0) +
      (item.verified && item.latitude !== null ? 30 : 0) +
      (item.placeId ? 20 : 0);

    if (candidateScore > existingScore) {
      dedupMap.set(key, {
        ...item,
        placeId: item.placeId || existing.placeId,
        latitude: item.latitude ?? existing.latitude,
        longitude: item.longitude ?? existing.longitude,
        verified: item.verified || existing.verified,
      });
    } else if (!existing.placeId && item.placeId) {
      existing.placeId = item.placeId;
    }
  }

  const deduped = Array.from(dedupMap.values());
  deduped.sort((a, b) => {
    const scoreA =
      (foldQuery ? scoreMatch(a.name, query) : 0) +
      (stateName && foldText(a.state) === foldText(stateName) ? 150 : 0) +
      (a.source === 'curated' ? 60 : a.verified ? 30 : 15);
    const scoreB =
      (foldQuery ? scoreMatch(b.name, query) : 0) +
      (stateName && foldText(b.state) === foldText(stateName) ? 150 : 0) +
      (b.source === 'curated' ? 60 : b.verified ? 30 : 15);
    return scoreB - scoreA || a.name.localeCompare(b.name);
  });

  return {
    cities: deduped.slice(0, limit),
    providerErrors,
    quotaExceeded,
  };
}

export async function resolveLocationPlaceDetails(params: {
  placeId: string;
  sessionToken?: string;
  expectedCountryCode?: string;
  expectedCountryName?: string;
  expectedStateName?: string;
  expectedStateCode?: string;
  fallbackName?: string;
  language?: string;
}): Promise<{
  success: boolean;
  quotaExceeded?: boolean;
  error?: string;
  place?: ServerCityOption;
}> {
  const placeId = String(params.placeId || '').trim();
  if (!placeId) {
    return { success: false, error: 'placeId is required' };
  }

  const gmpApiKey = process.env.GOOGLE_MAPS_PLATFORM_KEY || '';
  if (!gmpApiKey) {
    return { success: false, error: 'Geocoding service key is not configured' };
  }

  const bcp47 = mapLanguageToBcp47(params.language || 'English');
  const expectedCc = String(params.expectedCountryCode || '').trim().toUpperCase();

  // 1. Google Geocoding API v4 Place ID Lookup
  try {
    const regionParam = expectedCc ? `&regionCode=${encodeURIComponent(expectedCc.toLowerCase())}` : '';
    const v4Url = `https://geocode.googleapis.com/v4/geocode/places/${encodeURIComponent(
      placeId
    )}?languageCode=${encodeURIComponent(bcp47)}${regionParam}`;
    const v4Res = await fetch(v4Url, {
      headers: {
        'X-Goog-Api-Key': gmpApiKey,
        'X-Goog-Maps-Solution-ID': GMP_SOLUTION_ID,
        'X-Goog-FieldMask':
          'placeId,location,formattedAddress,postalAddress,addressComponents',
      },
      signal: AbortSignal.timeout(4500),
    });

    if (!v4Res.ok) {
      const errText = await v4Res.text().catch(() => '');
      if (isGmpQuotaError(v4Res.status, errText)) {
        return { success: false, quotaExceeded: true, error: 'Google Maps quota exceeded' };
      }
    } else {
      const data = await v4Res.json();
      const loc = data?.location;
      if (loc && Number.isFinite(loc.latitude) && Number.isFinite(loc.longitude)) {
        const comps: Array<{ longText?: string; shortText?: string; types?: string[] }> =
          data.addressComponents || [];
        const findComp = (...t: string[]) =>
          comps.find((c) => c.types?.some((ct) => t.includes(ct)));

        const countryComp = findComp('country');
        const resolvedCc =
          String(data.postalAddress?.regionCode || countryComp?.shortText || expectedCc || '').toUpperCase();

        if (expectedCc && resolvedCc && resolvedCc !== expectedCc) {
          return {
            success: false,
            error: `Resolved place belongs to ${resolvedCc} instead of selected country ${expectedCc}.`,
          };
        }

        const stateComp = findComp('administrative_area_level_1');
        const cityComp =
          findComp('locality') ||
          findComp('postal_town') ||
          findComp('sublocality_level_1', 'sublocality') ||
          findComp('administrative_area_level_3') ||
          findComp('administrative_area_level_2');

        const cityName =
          cityComp?.longText ||
          data.postalAddress?.locality ||
          params.fallbackName ||
          String(data.formattedAddress || '').split(',')[0]?.trim() ||
          '';

        const stateName =
          stateComp?.longText ||
          data.postalAddress?.administrativeArea ||
          params.expectedStateName ||
          '';
        const stateCode = stateComp?.shortText || params.expectedStateCode || '';
        const countryName = countryComp?.longText || params.expectedCountryName || resolvedCc;

        return {
          success: true,
          place: {
            id: `gmp:${data.placeId || placeId}`,
            name: cityName,
            state: stateName,
            stateCode,
            country: countryName,
            countryCode: resolvedCc || expectedCc,
            subtitle: [stateName, countryName].filter(Boolean).join(', '),
            latitude: loc.latitude,
            longitude: loc.longitude,
            placeId: data.placeId || placeId,
            source: 'google_geocoding',
            verified: true,
          },
        };
      }
    }
  } catch (err) {
    console.warn('Geocoding v4 place lookup failed:', err);
  }

  // 2. Fallback: Places API (New) Place Details (completes sessionToken cleanly)
  try {
    const queryParams = new URLSearchParams({ languageCode: bcp47 });
    if (expectedCc) queryParams.set('regionCode', expectedCc.toLowerCase());
    if (params.sessionToken) queryParams.set('sessionToken', params.sessionToken);

    const pdRes = await fetch(
      `https://places.googleapis.com/v1/places/${encodeURIComponent(placeId)}?${queryParams.toString()}`,
      {
        headers: {
          'X-Goog-Api-Key': gmpApiKey,
          'X-Goog-Maps-Solution-ID': GMP_SOLUTION_ID,
          'X-Goog-FieldMask': 'id,displayName,formattedAddress,location,addressComponents',
        },
        signal: AbortSignal.timeout(4500),
      }
    );

    if (!pdRes.ok) {
      const errText = await pdRes.text().catch(() => '');
      if (isGmpQuotaError(pdRes.status, errText)) {
        return { success: false, quotaExceeded: true, error: 'Google Maps quota exceeded' };
      }
      return { success: false, error: `Place details lookup returned ${pdRes.status}` };
    }

    const pd = await pdRes.json();
    const loc = pd?.location;
    if (!loc || !Number.isFinite(loc.latitude) || !Number.isFinite(loc.longitude)) {
      return { success: false, error: 'Coordinates unavailable for selected place' };
    }

    const comps: Array<{ longText?: string; shortText?: string; types?: string[] }> =
      pd.addressComponents || [];
    const findComp = (...t: string[]) =>
      comps.find((c) => c.types?.some((ct) => t.includes(ct)));
    const countryComp = findComp('country');
    const resolvedCc = String(countryComp?.shortText || expectedCc || '').toUpperCase();

    if (expectedCc && resolvedCc && resolvedCc !== expectedCc) {
      return {
        success: false,
        error: `Resolved place belongs to ${resolvedCc} instead of selected country ${expectedCc}.`,
      };
    }

    const stateComp = findComp('administrative_area_level_1');
    const cityName =
      pd.displayName?.text ||
      findComp('locality', 'postal_town', 'administrative_area_level_3')?.longText ||
      params.fallbackName ||
      '';
    const stateName = stateComp?.longText || params.expectedStateName || '';
    const countryName = countryComp?.longText || params.expectedCountryName || resolvedCc;

    return {
      success: true,
      place: {
        id: `gmp:${pd.id || placeId}`,
        name: cityName,
        state: stateName,
        stateCode: stateComp?.shortText || params.expectedStateCode || '',
        country: countryName,
        countryCode: resolvedCc || expectedCc,
        subtitle: [stateName, countryName].filter(Boolean).join(', '),
        latitude: loc.latitude,
        longitude: loc.longitude,
        placeId: pd.id || placeId,
        source: 'google_places_autocomplete',
        verified: true,
      },
    };
  } catch (err: any) {
    return { success: false, error: err?.message || 'Could not resolve place coordinates' };
  }
}
