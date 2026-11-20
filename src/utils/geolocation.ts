import { GpsLocationStatus } from '../types';
import { notifyGmpQuotaExceededIfNeeded } from './placesEngine';

export interface DeviceExactLocation {
  locationName: string;
  locality?: string;
  city: string;
  state?: string;
  stateCode?: string;
  country: string;
  countryCode?: string;
  placeId?: string;
  isVerified?: boolean;
  latitude: number | null;
  longitude: number | null;
  isLiveGps: boolean;
  accuracyMeters?: number;
  status?: GpsLocationStatus;
  errorMessage?: string;
  sourceProvider?:
    | 'google_geocoding'
    | 'google_places'
    | 'openstreetmap'
    | 'country_state_city'
    | 'bigdatacloud'
    | 'manual'
    | 'manual_custom'
    | 'fallback_coords';
}

export class GeolocationLookupError extends Error {
  status: GpsLocationStatus;
  constructor(status: GpsLocationStatus, message: string) {
    super(message);
    this.name = 'GeolocationLookupError';
    this.status = status;
  }
}

export const DEFAULT_FALLBACK_LOCATION: DeviceExactLocation = {
  locationName: 'Nagpur, Maharashtra, India',
  locality: 'Sitabuldi / Civil Lines',
  city: 'Nagpur',
  state: 'Maharashtra',
  country: 'India',
  latitude: 21.1458,
  longitude: 79.0882,
  isLiveGps: false,
  status: 'manual',
  sourceProvider: 'manual',
};

export function formatCoordFallbackName(latitude: number, longitude: number): string {
  return `Current Area (${latitude.toFixed(4)}°, ${longitude.toFixed(4)}°)`;
}

/**
 * Reverse geocodes coordinates into a human-readable address/place name.
 * If reverse geocoding fails, preserves the real coordinates cleanly rather than inventing another city.
 */
export async function reverseGeocodeCoords(latitude: number, longitude: number): Promise<DeviceExactLocation> {
  const cleanGeneric = (val?: string) => {
    const trimmed = (val || '').trim();
    const lower = trimmed.toLowerCase();
    if (!trimmed || lower === 'current area' || lower === 'current gps area' || lower === 'local area') {
      return '';
    }
    return trimmed;
  };

  try {
    const response = await fetch('/api/reverse-geocode', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ latitude, longitude }),
    });

    if (response.status === 429) {
      notifyGmpQuotaExceededIfNeeded(429);
    }

    const data = await response.json().catch(() => ({}));
    if (data?.quotaExceeded) {
      notifyGmpQuotaExceededIfNeeded(data);
    }

    const resolvedLocationName = cleanGeneric(data?.locationName);
    const resolvedCity = cleanGeneric(data?.city) || cleanGeneric(data?.locality) || cleanGeneric(data?.state);

    if (response.ok && data?.success && resolvedLocationName) {
      return {
        locationName: resolvedLocationName,
        locality: cleanGeneric(data.locality),
        city: resolvedCity,
        state: cleanGeneric(data.state),
        country: cleanGeneric(data.country),
        latitude,
        longitude,
        isLiveGps: true,
        status: 'live',
        sourceProvider: data.provider || 'google_geocoding',
      };
    }

    return {
      locationName: 'Current GPS Area',
      locality: '',
      city: '',
      state: '',
      country: '',
      latitude,
      longitude,
      isLiveGps: true,
      status: 'geocode_failed',
      sourceProvider: 'fallback_coords',
      errorMessage: data?.error || 'Could not resolve street or city name for your GPS coordinates.',
    };
  } catch (err: any) {
    console.warn('Reverse geocode request failed:', err);
    return {
      locationName: 'Current GPS Area',
      locality: '',
      city: '',
      state: '',
      country: '',
      latitude,
      longitude,
      isLiveGps: true,
      status: 'geocode_failed',
      sourceProvider: 'fallback_coords',
      errorMessage: err?.message || 'Reverse geocoding service temporarily unreachable.',
    };
  }
}

export type DeviceLocationResult =
  | { ok: true; location: DeviceExactLocation }
  | { ok: false; status: GpsLocationStatus; errorMessage: string };

/**
 * Retrieves device GPS location with structured status/error reporting instead of silently fabricating a city.
 */
export function getDeviceExactLocationResult(): Promise<DeviceLocationResult> {
  return new Promise((resolve) => {
    if (typeof navigator === 'undefined' || !('geolocation' in navigator)) {
      resolve({
        ok: false,
        status: 'unsupported',
        errorMessage: 'Geolocation is not supported in this browser. Please select a city manually.',
      });
      return;
    }

    navigator.geolocation.getCurrentPosition(
      async (position) => {
        const { latitude, longitude, accuracy } = position.coords;
        const exactLoc = await reverseGeocodeCoords(latitude, longitude);
        resolve({
          ok: true,
          location: {
            ...exactLoc,
            accuracyMeters: accuracy,
            isLiveGps: true,
          },
        });
      },
      (error) => {
        let status: GpsLocationStatus = 'unavailable';
        let errorMessage = 'Unable to acquire your current GPS position.';
        if (error.code === error.PERMISSION_DENIED) {
          status = 'permission_denied';
          errorMessage = 'Location permission was denied. Enable GPS access or choose a destination city manually.';
        } else if (error.code === error.TIMEOUT) {
          status = 'timeout';
          errorMessage = 'GPS request timed out. Retry GPS or pick a city manually.';
        } else if (error.code === error.POSITION_UNAVAILABLE) {
          status = 'unavailable';
          errorMessage = 'Device location signal is currently unavailable. Retry GPS or choose a city manually.';
        }
        resolve({ ok: false, status, errorMessage });
      },
      { enableHighAccuracy: true, timeout: 10000, maximumAge: 60000 }
    );
  });
}

/**
 * Throws typed GeolocationLookupError when GPS fails so callers never silently adopt fake coordinates.
 */
export async function getDeviceExactLocation(): Promise<DeviceExactLocation> {
  const result = await getDeviceExactLocationResult();
  if ('errorMessage' in result) {
    throw new GeolocationLookupError(result.status, result.errorMessage);
  }
  return result.location;
}

/**
 * Returns a canonical Google Maps Directions or Place URI.
 */
export function getMapsNavigationUrl(options: {
  placeName: string;
  localityOrCity?: string;
  latitude?: number | null;
  longitude?: number | null;
  placeId?: string;
  googleMapsUri?: string;
  travelMode?: 'driving' | 'walking' | 'bicycling' | 'transit';
  preferDirections?: boolean;
}): string {
  const {
    placeName,
    localityOrCity,
    latitude,
    longitude,
    placeId,
    googleMapsUri,
    travelMode,
    preferDirections = true,
  } = options;

  if (!preferDirections && googleMapsUri && googleMapsUri.startsWith('http')) {
    return googleMapsUri;
  }

  const validCoords =
    typeof latitude === 'number' &&
    typeof longitude === 'number' &&
    Number.isFinite(latitude) &&
    Number.isFinite(longitude);

  if (validCoords) {
    const params = new URLSearchParams({
      api: '1',
      destination: `${latitude},${longitude}`,
    });
    if (placeId && !placeId.startsWith('osm-') && !placeId.startsWith('gt-')) {
      params.set('destination_place_id', placeId);
    }
    if (travelMode) {
      params.set('travelmode', travelMode);
    }
    return `https://www.google.com/maps/dir/?${params.toString()}`;
  }

  if (googleMapsUri && googleMapsUri.startsWith('http')) {
    return googleMapsUri;
  }

  const queryText = `${placeName}${localityOrCity ? ', ' + localityOrCity : ''}`;
  const searchParams = new URLSearchParams({
    api: '1',
    query: queryText,
  });
  if (placeId && !placeId.startsWith('osm-') && !placeId.startsWith('gt-')) {
    searchParams.set('query_place_id', placeId);
  }
  return `https://www.google.com/maps/search/?${searchParams.toString()}`;
}

/**
 * Opens Google Maps navigation or place link safely in a new tab.
 */
export function openNativeMapsNavigation(options: {
  placeName: string;
  localityOrCity?: string;
  latitude?: number | null;
  longitude?: number | null;
  placeId?: string;
  googleMapsUri?: string;
  travelMode?: 'driving' | 'walking' | 'bicycling' | 'transit';
  preferDirections?: boolean;
}) {
  const url = getMapsNavigationUrl(options);
  window.open(url, '_blank', 'noopener,noreferrer');
}
