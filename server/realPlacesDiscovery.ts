import { VERIFIED_GROUND_TRUTH_POIS } from '../src/data/verifiedGroundTruthIndex';
import {
  CATEGORY_FILTERS,
  computeDistanceKm,
  formatStraightLineDistance,
  formatWalkOrDriveTime,
  getGmpTypesForCategory,
  normalizePlaceCategory,
} from '../src/utils/placesEngine';
import { generateContentWithFallback } from '../server';

export const GMP_SOLUTION_ID = 'gmp_mcp_codeassist_v1_aistudio';

const discoveryCache = new Map<string, { data: { places: Record<string, any>; areaOverview: string }; expiresAt: number }>();
const fullRadarSpotsCache = new Map<
  string,
  { data: { areaOverview: string; spots: DiscoveredRealPlace[]; groundTruthCount: number; sources?: string[]; quotaExceeded?: boolean }; expiresAt: number }
>();

export function isGmpQuotaError(status: number, bodyText: string = ''): boolean {
  if (status === 429) return true;
  const upper = bodyText.toUpperCase();
  return upper.includes('RESOURCE_EXHAUSTED') || upper.includes('RATE_LIMIT_EXCEEDED');
}

export function mapLanguageToBcp47(language: string = 'English'): string {
  const lower = (language || 'english').toLowerCase().trim();
  const map: Record<string, string> = {
    english: 'en',
    en: 'en',
    hindi: 'hi',
    hi: 'hi',
    spanish: 'es',
    es: 'es',
    french: 'fr',
    fr: 'fr',
    german: 'de',
    de: 'de',
    japanese: 'ja',
    ja: 'ja',
    mandarin: 'zh-CN',
    chinese: 'zh-CN',
    zh: 'zh-CN',
    'zh-cn': 'zh-CN',
    tamil: 'ta',
    ta: 'ta',
    bengali: 'bn',
    bn: 'bn',
    marathi: 'mr',
    mr: 'mr',
    telugu: 'te',
    te: 'te',
    gujarati: 'gu',
    gu: 'gu',
    kannada: 'kn',
    kn: 'kn',
    arabic: 'ar',
    ar: 'ar',
    urdu: 'ur',
    ur: 'ur',
    italian: 'it',
    it: 'it',
    portuguese: 'pt',
    pt: 'pt',
    russian: 'ru',
    ru: 'ru',
    korean: 'ko',
    ko: 'ko',
    turkish: 'tr',
    tr: 'tr',
    vietnamese: 'vi',
    vi: 'vi',
    malayalam: 'ml',
    ml: 'ml',
  };
  return map[lower] || 'en';
}

export interface DiscoveredRealPlace {
  id: string;
  name: string;
  category: string;
  primaryType?: string;
  primaryTypeDisplayName?: string;
  oneLineImportance: string;
  description: string;
  estimatedDistanceKm: number;
  straightLineLabel?: string;
  walkOrDriveTime: string;
  bestTimeToVisit?: string;
  addressOrLocality: string;
  formattedAddress?: string;
  shortFormattedAddress?: string;
  keyHighlights: string[];
  imageUrl: string;
  rating: number | null;
  reviewCount: number | null;
  businessStatus?: string;
  regularOpeningHours?: {
    openNow?: boolean;
    weekdayDescriptions?: string[];
  };
  googleMapsUri: string;
  latitude: number;
  longitude: number;
  source: 'google_places_api' | 'openstreetmap_osm' | 'wikipedia_geosearch' | 'verified_ground_truth_index';
  provider: 'google_places' | 'openstreetmap' | 'wikipedia' | 'curated_verified';
  sourceVerified: boolean;
  placeId?: string;
  googlePlaceId?: string;
  photoName?: string;
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

export interface ExactPlacePhotoResult {
  hasRealPhoto: boolean;
  photoUrl: string;
  photoUnavailable?: boolean;
  quotaExceeded?: boolean;
  placeId?: string;
  photoName?: string;
  authorAttributions: Array<{ displayName: string; uri?: string; photoUri?: string }>;
  photos: Array<{ name: string; url: string; authorAttributions: any[] }>;
}

export function safeJsonParse<T>(rawText: string | undefined | null, fallback: T): T {
  if (!rawText || typeof rawText !== 'string') return fallback;

  let clean = rawText.trim();
  // Strip markdown code block wrappers
  if (clean.startsWith('```json')) {
    clean = clean.replace(/^```json\s*/i, '').replace(/\s*```$/, '').trim();
  } else if (clean.startsWith('```')) {
    clean = clean.replace(/^```\s*/, '').replace(/\s*```$/, '').trim();
  }

  // First fast attempt: native JSON.parse
  try {
    return JSON.parse(clean);
  } catch (initialErr) {
    // Second attempt: Sanitize and repair truncated or malformed JSON
    try {
      const firstBrace = clean.indexOf('{');
      const firstBracket = clean.indexOf('[');
      let startIdx = -1;
      let isObject = false;

      if (firstBrace !== -1 && (firstBracket === -1 || firstBrace < firstBracket)) {
        startIdx = firstBrace;
        isObject = true;
      } else if (firstBracket !== -1) {
        startIdx = firstBracket;
        isObject = false;
      }

      if (startIdx !== -1) {
        let candidate = clean.slice(startIdx);
        // Balance strings, braces, and brackets
        let inString = false;
        let escaped = false;
        let openBraces = 0;
        let openBrackets = 0;

        for (let i = 0; i < candidate.length; i++) {
          const char = candidate[i];
          if (escaped) {
            escaped = false;
            continue;
          }
          if (char === '\\') {
            escaped = true;
            continue;
          }
          if (char === '"') {
            inString = !inString;
            continue;
          }
          if (!inString) {
            if (char === '{') openBraces++;
            else if (char === '}') openBraces--;
            else if (char === '[') openBrackets++;
            else if (char === ']') openBrackets--;
          }
        }

        // If truncated inside string
        if (inString) {
          candidate += '"';
        }
        // Remove trailing dangling comma or broken key-value
        candidate = candidate.replace(/,\s*$/, '');
        // Close open arrays and objects
        while (openBrackets > 0) {
          candidate += ']';
          openBrackets--;
        }
        while (openBraces > 0) {
          candidate += '}';
          openBraces--;
        }

        try {
          return JSON.parse(candidate);
        } catch (repairErr) {
          // If still failing, extract valid complete objects via regex
          if (isObject) {
            const spots: any[] = [];
            const objectRegex = /\{\s*"name"\s*:\s*"([^"]+)"[\s\S]*?\}/g;
            let match;
            while ((match = objectRegex.exec(clean)) !== null) {
              try {
                const item = JSON.parse(match[0]);
                if (item && item.name) {
                  spots.push(item);
                }
              } catch (_) {}
            }
            if (spots.length > 0) {
              return { spots } as any;
            }
          }
        }
      }
    } catch (_) {}
  }

  return fallback;
}

const WIKI_USER_AGENT = 'CharaivaTravelGuide/1.0 (https://charaiva.app; contact@charaiva.app)';
// Short-lived cache only for Wikimedia/Wikipedia lookups; Google Place photo names expire and are capped to 5 minutes max
const photoResolutionCache = new Map<string, { result: ExactPlacePhotoResult; expiresAt: number }>();

const CANONICAL_HERITAGE_ARCHIVE: Record<
  string,
  {
    title: string;
    city: string;
    lat: number;
    lng: number;
    url: string;
    placeId: string;
    author: string;
    sourceUri: string;
  }
> = {
  deekshabhoomi: {
    title: 'Deekshabhoomi Sacred Stupa',
    city: 'nagpur',
    lat: 21.1278,
    lng: 79.0669,
    url: 'https://upload.wikimedia.org/wikipedia/commons/thumb/c/c9/Dheekshabhoomi_in_Nagpur.jpg/960px-Dheekshabhoomi_in_Nagpur.jpg',
    placeId: 'wiki-page-734898',
    author: 'Wikimedia Commons',
    sourceUri: 'https://en.wikipedia.org/wiki/Deekshabhoomi',
  },
  zeromile: {
    title: 'Zero Mile Stone Nagpur',
    city: 'nagpur',
    lat: 21.1498,
    lng: 79.0806,
    url: 'https://upload.wikimedia.org/wikipedia/commons/2/23/Zero_mile_nagpur.jpg',
    placeId: 'wiki-page-17180214',
    author: 'Wikimedia Commons',
    sourceUri: 'https://en.wikipedia.org/wiki/Zero_Mile_Stone_(Nagpur)',
  },
  kasturchand: {
    title: 'Kasturchand Park',
    city: 'nagpur',
    lat: 21.1522,
    lng: 79.0844,
    url: 'https://upload.wikimedia.org/wikipedia/commons/thumb/6/68/Kasturchandparknagpur.jpg/960px-Kasturchandparknagpur.jpg',
    placeId: 'commons-file-kasturchand',
    author: 'Wikimedia Commons',
    sourceUri: 'https://en.wikipedia.org/wiki/Kasturchand_Park',
  },
  ramanscience: {
    title: 'Raman Science Centre',
    city: 'nagpur',
    lat: 21.1448,
    lng: 79.0965,
    url: 'https://upload.wikimedia.org/wikipedia/commons/thumb/9/90/Raman_Science_Centre_Nagpur.jpg/960px-Raman_Science_Centre_Nagpur.jpg',
    placeId: 'wiki-page-34674718',
    author: 'Wikimedia Commons',
    sourceUri: 'https://en.wikipedia.org/wiki/Raman_Science_Centre',
  },
  shriganeshmandirtekdi: {
    title: 'Shri Ganesh Mandir Tekdi',
    city: 'nagpur',
    lat: 21.1492,
    lng: 79.0911,
    url: 'https://upload.wikimedia.org/wikipedia/commons/thumb/d/d3/Shri_Ganesh_Tekdi.jpg/960px-Shri_Ganesh_Tekdi.jpg',
    placeId: 'commons-file-134034607',
    author: 'Wikimedia Commons',
    sourceUri: 'https://commons.wikimedia.org/wiki/File:Shri_Ganesh_Tekdi.jpg',
  },
  futalalake: {
    title: 'Futala Lake',
    city: 'nagpur',
    lat: 21.1558,
    lng: 79.0435,
    url: 'https://upload.wikimedia.org/wikipedia/commons/thumb/f/f7/Futala_Lake.jpg/960px-Futala_Lake.jpg',
    placeId: 'wiki-page-32986427',
    author: 'Wikimedia Commons',
    sourceUri: 'https://en.wikipedia.org/wiki/Futala_Lake',
  },
  sitabuldifort: {
    title: 'Sitabuldi Fort',
    city: 'nagpur',
    lat: 21.1472,
    lng: 79.0838,
    url: 'https://upload.wikimedia.org/wikipedia/commons/thumb/4/4c/Sitabuldi_fort_gate.JPG/960px-Sitabuldi_fort_gate.JPG',
    placeId: 'wiki-page-18342732',
    author: 'Wikimedia Commons',
    sourceUri: 'https://en.wikipedia.org/wiki/Sitabuldi_Fort',
  },
  ambazarilake: {
    title: 'Ambazari Lake',
    city: 'nagpur',
    lat: 21.1275,
    lng: 79.0345,
    url: 'https://upload.wikimedia.org/wikipedia/commons/thumb/c/c6/AmbazariLake.JPG/960px-AmbazariLake.JPG',
    placeId: 'wiki-page-23214589',
    author: 'Wikimedia Commons',
    sourceUri: 'https://en.wikipedia.org/wiki/Ambazari_Lake',
  },
  maharajbaghzoo: {
    title: 'Maharajbagh Zoo',
    city: 'nagpur',
    lat: 21.1425,
    lng: 79.0744,
    url: 'https://upload.wikimedia.org/wikipedia/commons/thumb/d/db/A_view_of_Maharajbag%2C_Nagpur.jpg/960px-A_view_of_Maharajbag%2C_Nagpur.jpg',
    placeId: 'commons-file-20536840',
    author: 'Wikimedia Commons',
    sourceUri: 'https://en.wikipedia.org/wiki/Maharajbagh_zoo',
  },
  bapsshriswaminarayanmandirnagpur: {
    title: 'BAPS Shri Swaminarayan Mandir Nagpur',
    city: 'nagpur',
    lat: 21.1412,
    lng: 79.1415,
    url: 'https://upload.wikimedia.org/wikipedia/commons/thumb/f/fc/BAPS_Swaminarayan_Temple%2C_Nagpur.jpg/960px-BAPS_Swaminarayan_Temple%2C_Nagpur.jpg',
    placeId: 'commons-file-baps-nagpur',
    author: 'Wikimedia Commons',
    sourceUri: 'https://commons.wikimedia.org/wiki/File:BAPS_Swaminarayan_Temple,_Nagpur.jpg',
  },
  seminaryhills: {
    title: 'Seminary Hills Natural Area',
    city: 'nagpur',
    lat: 21.1685,
    lng: 79.0625,
    url: 'https://upload.wikimedia.org/wikipedia/commons/thumb/1/1f/Seminary_Hill_Natural_Area_0194.jpg/960px-Seminary_Hill_Natural_Area_0194.jpg',
    placeId: 'commons-seminary-hills',
    author: 'Wikimedia Commons',
    sourceUri: 'https://commons.wikimedia.org/wiki/File:Seminary_Hill_Natural_Area_0194.jpg',
  },
  tajmahal: {
    title: 'Taj Mahal',
    city: 'agra',
    lat: 27.1751,
    lng: 78.0421,
    url: 'https://upload.wikimedia.org/wikipedia/commons/thumb/1/1d/Taj_Mahal_%28Edited%29.jpeg/960px-Taj_Mahal_%28Edited%29.jpeg',
    placeId: 'wiki-page-30467',
    author: 'Wikimedia Commons',
    sourceUri: 'https://en.wikipedia.org/wiki/Taj_Mahal',
  },
};

function mapGooglePhotosList(photos: any[] = []): {
  photoUrl: string;
  photoName?: string;
  authorAttributions: Array<{ displayName: string; uri?: string; photoUri?: string }>;
  mappedPhotos: Array<{ name: string; url: string; authorAttributions: any[] }>;
} {
  const validPhotos = (photos || []).filter((p: any) => p && typeof p.name === 'string' && /^places\/[A-Za-z0-9_-]+\/photos\/[A-Za-z0-9_-]+$/.test(p.name));
  if (validPhotos.length === 0) {
    return { photoUrl: '', authorAttributions: [], mappedPhotos: [] };
  }
  const firstPhoto = validPhotos[0];
  const mappedPhotos = validPhotos.slice(0, 6).map((ph: any) => ({
    name: ph.name,
    url: `/api/places/photo?name=${encodeURIComponent(ph.name)}&maxHeightPx=1200&maxWidthPx=1200`,
    authorAttributions: Array.isArray(ph.authorAttributions) ? ph.authorAttributions : [],
  }));
  return {
    photoUrl: `/api/places/photo?name=${encodeURIComponent(firstPhoto.name)}&maxHeightPx=800&maxWidthPx=800`,
    photoName: firstPhoto.name,
    authorAttributions: Array.isArray(firstPhoto.authorAttributions) ? firstPhoto.authorAttributions : [],
    mappedPhotos,
  };
}

/**
 * Resolve authentic place photo via Google Places API (New), exact ground truth archive, or Wikipedia/Wikimedia.
 * Returns photoUnavailable: true when no genuine photo exists for the specific place (never substitutes fake category photos).
 */
export function isGenericLocationLabel(name?: string): boolean {
  const clean = (name || '').toLowerCase().trim();
  if (!clean || clean.length < 2) return true;
  if (
    clean === 'current gps area' ||
    clean === 'current area' ||
    clean === 'local area' ||
    clean === 'current location' ||
    clean === 'gps location needed' ||
    clean === 'location unavailable' ||
    clean === 'choose destination city' ||
    clean === 'selected city'
  ) {
    return true;
  }
  if (/^current\s+(gps\s+)?area\s*\(/i.test(clean)) return true;
  if (/^locating\b/i.test(clean)) return true;
  return false;
}

export async function resolveExactPlacePhotoWithGooglePlaces(
  placeName: string,
  city?: string,
  lat?: number,
  lng?: number,
  placeId?: string,
  apiKey?: string
): Promise<ExactPlacePhotoResult> {
  if (isGenericLocationLabel(placeName) && !placeId) {
    return {
      hasRealPhoto: false,
      photoUnavailable: true,
      photoUrl: '',
      authorAttributions: [],
      photos: [],
    };
  }
  const gmpKey = apiKey || process.env.GOOGLE_MAPS_PLATFORM_KEY || '';
  const cleanName = (placeName || '').toLowerCase().trim();
  const safeCity = isGenericLocationLabel(city) ? '' : (city || '').trim();
  const cacheKey = `${cleanName}_${safeCity.toLowerCase()}_${placeId || ''}`;
  let quotaExceeded = false;

  const cachedEntry = photoResolutionCache.get(cacheKey);
  if (cachedEntry && cachedEntry.expiresAt > Date.now()) {
    return cachedEntry.result;
  }

  // 1. Exact Google Place ID lookup when Google Maps Platform Key is active
  if (placeId && !placeId.startsWith('osm-') && !placeId.startsWith('gt-') && !placeId.startsWith('wiki-') && !placeId.startsWith('commons-') && gmpKey) {
    try {
      const cleanId = placeId.replace(/^places\//, '');
      const detailsUrl = `https://places.googleapis.com/v1/places/${encodeURIComponent(cleanId)}`;
      const res = await fetch(detailsUrl, {
        headers: {
          'Content-Type': 'application/json',
          'X-Goog-Api-Key': gmpKey,
          'X-Goog-Maps-Solution-ID': GMP_SOLUTION_ID,
          'X-Goog-FieldMask': 'id,displayName,photos',
        },
        signal: AbortSignal.timeout(3500),
      });
      if (res.ok) {
        const placeData = await res.json();
        const mapped = mapGooglePhotosList(placeData.photos || []);
        if (mapped.photoUrl) {
          const result: ExactPlacePhotoResult = {
            hasRealPhoto: true,
            photoUnavailable: false,
            photoUrl: mapped.photoUrl,
            placeId: placeData.id,
            photoName: mapped.photoName,
            authorAttributions: mapped.authorAttributions,
            photos: mapped.mappedPhotos,
          };
          photoResolutionCache.set(cacheKey, { result, expiresAt: Date.now() + 4 * 60 * 1000 });
          return result;
        }
      } else {
        const errText = await res.text().catch(() => '');
        if (isGmpQuotaError(res.status, errText)) {
          quotaExceeded = true;
        }
      }
    } catch (err) {
      console.warn('Google Places Details photo lookup error:', err);
    }
  }

  // 2. Search place via Google Places API (New) Text Search (places:searchText)
  if (!quotaExceeded && gmpKey && placeName && placeName.length > 1) {
    try {
      const searchUrl = 'https://places.googleapis.com/v1/places:searchText';
      const searchBody: any = {
        textQuery: `${placeName} ${city || ''}`.trim(),
        maxResultCount: 3,
      };
      if (typeof lat === 'number' && typeof lng === 'number' && Number.isFinite(lat) && Number.isFinite(lng)) {
        searchBody.locationBias = {
          circle: {
            center: { latitude: lat, longitude: lng },
            radius: 25000,
          },
        };
      }

      const res = await fetch(searchUrl, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'X-Goog-Api-Key': gmpKey,
          'X-Goog-Maps-Solution-ID': GMP_SOLUTION_ID,
          'X-Goog-FieldMask': 'places.id,places.displayName,places.formattedAddress,places.photos',
        },
        body: JSON.stringify(searchBody),
        signal: AbortSignal.timeout(4000),
      });

      if (res.ok) {
        const data = await res.json();
        if (Array.isArray(data.places) && data.places.length > 0) {
          const found = data.places.find((p: any) => Array.isArray(p.photos) && p.photos.length > 0) || data.places[0];
          const mapped = mapGooglePhotosList(found?.photos || []);
          if (mapped.photoUrl) {
            const result: ExactPlacePhotoResult = {
              hasRealPhoto: true,
              photoUnavailable: false,
              photoUrl: mapped.photoUrl,
              placeId: found.id,
              photoName: mapped.photoName,
              authorAttributions: mapped.authorAttributions,
              photos: mapped.mappedPhotos,
            };
            photoResolutionCache.set(cacheKey, { result, expiresAt: Date.now() + 4 * 60 * 1000 });
            return result;
          }
        }
      } else {
        const errText = await res.text().catch(() => '');
        if (isGmpQuotaError(res.status, errText)) {
          quotaExceeded = true;
        }
      }
    } catch (err) {
      console.warn('Google Places Text Search photo lookup error:', err);
    }
  }

  // 3. Exact Canonical Ground Truth Dictionary check (strictly city & coordinate scoped — NEVER matches cross-city places)
  const normKey = cleanName.replace(/[^a-z0-9]/g, '');
  const hasCoordContext = typeof lat === 'number' && typeof lng === 'number' && Number.isFinite(lat) && Number.isFinite(lng);
  for (const [key, item] of Object.entries(CANONICAL_HERITAGE_ARCHIVE)) {
    const cityMatches = !safeCity || safeCity.toLowerCase().includes(item.city) || item.city.includes(safeCity.toLowerCase());
    const coordMatches = !hasCoordContext || computeDistanceKm(lat!, lng!, item.lat, item.lng) <= 50;
    if (!cityMatches || !coordMatches) continue;

    const matchesTekdiGanesh =
      key === 'shriganeshmandirtekdi' &&
      normKey.includes('tekdi') &&
      (normKey.includes('ganesh') || normKey.includes('ganapati'));
    const matchesBapsNagpur =
      key === 'bapsshriswaminarayanmandirnagpur' &&
      normKey.includes('swaminarayan') &&
      cityMatches &&
      coordMatches;

    if (normKey === key || normKey.includes(key) || matchesTekdiGanesh || matchesBapsNagpur) {
      const proxied = `/api/places/proxy-image?url=${encodeURIComponent(item.url)}`;
      const result: ExactPlacePhotoResult = {
        hasRealPhoto: true,
        photoUnavailable: false,
        quotaExceeded,
        photoUrl: proxied,
        placeId: item.placeId,
        authorAttributions: [{ displayName: item.author, uri: item.sourceUri }],
        photos: [{ name: item.title, url: proxied, authorAttributions: [{ displayName: item.author, uri: item.sourceUri }] }],
      };
      photoResolutionCache.set(cacheKey, { result, expiresAt: Date.now() + 30 * 60 * 1000 });
      return result;
    }
  }

  // 4. Wikipedia Pageimages API Resolution (parallelized across candidate titles)
  const candidateTitles = Array.from(
    new Set(
      [
        placeName,
        city ? `${placeName} (${city})` : '',
        city ? `${placeName}, ${city}` : '',
      ].filter((t) => t.length > 2)
    )
  );

  if (candidateTitles.length > 0) {
    try {
      const pUrl = `https://en.wikipedia.org/w/api.php?action=query&titles=${encodeURIComponent(
        candidateTitles.join('|')
      )}&prop=pageimages|info&inprop=url&redirects=1&pithumbsize=960&format=json`;
      const pRes = await fetch(pUrl, {
        headers: { 'User-Agent': WIKI_USER_AGENT },
        signal: AbortSignal.timeout(2000),
      });
      if (pRes.ok) {
        const pData = await pRes.json();
        const pages = Object.values(pData?.query?.pages || {}) as any[];
        const p = pages.find(
          (item) =>
            item &&
            item.pageid &&
            item.thumbnail?.source &&
            !String(item.title || '').includes('Disambiguation')
        );
        if (p) {
          const proxiedUrl = `/api/places/proxy-image?url=${encodeURIComponent(p.thumbnail.source)}`;
          const result: ExactPlacePhotoResult = {
            hasRealPhoto: true,
            photoUnavailable: false,
            quotaExceeded,
            photoUrl: proxiedUrl,
            placeId: `wiki-page-${p.pageid}`,
            authorAttributions: [
              {
                displayName: `${p.title} (Wikipedia / Wikimedia Commons)`,
                uri: p.fullurl || `https://en.wikipedia.org/wiki/${encodeURIComponent(p.title)}`,
              },
            ],
            photos: [
              {
                name: p.title,
                url: proxiedUrl,
                authorAttributions: [
                  {
                    displayName: `${p.title} (Wikimedia Commons)`,
                    uri: p.fullurl,
                  },
                ],
              },
            ],
          };
          photoResolutionCache.set(cacheKey, { result, expiresAt: Date.now() + 30 * 60 * 1000 });
          return result;
        }
      }
    } catch {}
  }

  // 5. Strict Wikipedia Search (must match distinctive place tokens)
  try {
    const sUrl = `https://en.wikipedia.org/w/api.php?action=query&list=search&srsearch=${encodeURIComponent(placeName + ' ' + (city || ''))}&srlimit=5&format=json`;
    const sRes = await fetch(sUrl, {
      headers: { 'User-Agent': WIKI_USER_AGENT },
      signal: AbortSignal.timeout(1800),
    });

    if (sRes.ok) {
      const sData = await sRes.json();
      const articles = sData?.query?.search || [];
      const placeTokens = cleanName
        .split(/\s+/)
        .filter((w) => w.length > 2 && !['and', '&', 'the', 'in', 'of', 'park', 'garden', 'centre', 'center', 'temple', 'lake', 'fort'].includes(w));

      for (const art of articles) {
        const titleLower = String(art.title || '').toLowerCase();
        const matchesDistinctive = placeTokens.length === 0 ? titleLower === cleanName : placeTokens.some((tok) => titleLower.includes(tok));
        if (!matchesDistinctive) continue;
        if (city && titleLower === city.toLowerCase() && cleanName !== city.toLowerCase()) continue;

        const infoUrl = `https://en.wikipedia.org/w/api.php?action=query&titles=${encodeURIComponent(art.title)}&prop=pageimages|info&inprop=url&pithumbsize=960&format=json`;
        const infoRes = await fetch(infoUrl, {
          headers: { 'User-Agent': WIKI_USER_AGENT },
          signal: AbortSignal.timeout(1800),
        });

        if (infoRes.ok) {
          const infoData = await infoRes.json();
          const p: any = Object.values(infoData?.query?.pages || {})[0];
          if (p && p.pageid && p.thumbnail?.source) {
            const proxiedUrl = `/api/places/proxy-image?url=${encodeURIComponent(p.thumbnail.source)}`;
            const result: ExactPlacePhotoResult = {
              hasRealPhoto: true,
              photoUnavailable: false,
              quotaExceeded,
              photoUrl: proxiedUrl,
              placeId: `wiki-page-${p.pageid}`,
              authorAttributions: [
                {
                  displayName: `${p.title} (Wikipedia / Wikimedia Commons)`,
                  uri: p.fullurl || `https://en.wikipedia.org/wiki/${encodeURIComponent(p.title)}`,
                },
              ],
              photos: [{ name: p.title, url: proxiedUrl, authorAttributions: [] }],
            };
            photoResolutionCache.set(cacheKey, { result, expiresAt: Date.now() + 30 * 60 * 1000 });
            return result;
          }
        }
      }
    }
  } catch {}

  // 6. Strict Wikimedia Commons File Search
  try {
    const cUrl = `https://commons.wikimedia.org/w/api.php?action=query&generator=search&gsrsearch=${encodeURIComponent(placeName + ' ' + (city || ''))}&gsrnamespace=6&gsrlimit=5&prop=imageinfo&iiprop=url&iiurlwidth=960&format=json&origin=*`;
    const cRes = await fetch(cUrl, {
      headers: { 'User-Agent': WIKI_USER_AGENT },
      signal: AbortSignal.timeout(1800),
    });

    if (cRes.ok) {
      const cData = await cRes.json();
      const pages = Object.values(cData?.query?.pages || {});
      const placeTokens = cleanName
        .split(/\s+/)
        .filter((w) => w.length > 2 && !['and', '&', 'the', 'in', 'of', 'park', 'garden', 'centre', 'center', 'temple', 'lake', 'fort'].includes(w));

      for (const cp of pages as any[]) {
        const fileTitle = (cp.title || '').toLowerCase();
        const matchesToken = placeTokens.length > 0 && placeTokens.some((tok) => fileTitle.includes(tok));
        if (!matchesToken) continue;

        const thumb = cp.imageinfo?.[0]?.thumburl || cp.imageinfo?.[0]?.url;
        if (thumb && (thumb.includes('.jpg') || thumb.includes('.png') || thumb.includes('.jpeg') || thumb.includes('px-'))) {
          const proxiedUrl = `/api/places/proxy-image?url=${encodeURIComponent(thumb)}`;
          const result: ExactPlacePhotoResult = {
            hasRealPhoto: true,
            photoUnavailable: false,
            quotaExceeded,
            photoUrl: proxiedUrl,
            placeId: `commons-file-${cp.pageid}`,
            authorAttributions: [
              {
                displayName: `${String(cp.title || '').replace(/^File:/, '')} (Wikimedia Commons)`,
                uri: `https://commons.wikimedia.org/wiki/${encodeURIComponent(cp.title)}`,
              },
            ],
            photos: [{ name: cp.title, url: proxiedUrl, authorAttributions: [] }],
          };
          photoResolutionCache.set(cacheKey, { result, expiresAt: Date.now() + 30 * 60 * 1000 });
          return result;
        }
      }
    }
  } catch {}

  // 7. Honest Unavailable state — do NOT substitute unrelated category stock photos
  const unavailableResult: ExactPlacePhotoResult = {
    hasRealPhoto: false,
    photoUnavailable: true,
    quotaExceeded,
    photoUrl: '',
    placeId,
    authorAttributions: [],
    photos: [],
  };
  photoResolutionCache.set(cacheKey, { result: unavailableResult, expiresAt: Date.now() + 3 * 60 * 1000 });
  return unavailableResult;
}

const PLACES_SEARCH_FIELD_MASK = [
  'places.id',
  'places.displayName',
  'places.formattedAddress',
  'places.shortFormattedAddress',
  'places.location',
  'places.primaryType',
  'places.primaryTypeDisplayName',
  'places.types',
  'places.rating',
  'places.userRatingCount',
  'places.businessStatus',
  'places.regularOpeningHours',
  'places.googleMapsUri',
  'places.photos',
].join(',');

function mapGooglePlaceObject(p: any, originLat?: number, originLng?: number): any {
  const pLat = typeof p.location?.latitude === 'number' ? p.location.latitude : null;
  const pLng = typeof p.location?.longitude === 'number' ? p.location.longitude : null;
  const hasCoords = pLat !== null && pLng !== null && Number.isFinite(pLat) && Number.isFinite(pLng);
  const distKm =
    hasCoords && typeof originLat === 'number' && typeof originLng === 'number' && Number.isFinite(originLat) && Number.isFinite(originLng)
      ? computeDistanceKm(originLat, originLng, pLat!, pLng!)
      : 0;
  const name = p.displayName?.text || p.shortFormattedAddress || 'Unnamed Place';
  const types: string[] = Array.isArray(p.types) ? p.types : [];
  if (p.primaryType && !types.includes(p.primaryType)) {
    types.unshift(p.primaryType);
  }
  const cat = normalizePlaceCategory(types, name);
  const mappedPhotos = mapGooglePhotosList(p.photos || []);

  return {
    id: p.id,
    placeId: p.id,
    googlePlaceId: p.id,
    name,
    category: cat,
    primaryType: p.primaryType,
    primaryTypeDisplayName: p.primaryTypeDisplayName?.text || undefined,
    address: p.shortFormattedAddress || p.formattedAddress || '',
    formattedAddress: p.formattedAddress || undefined,
    shortFormattedAddress: p.shortFormattedAddress || undefined,
    latitude: pLat,
    longitude: pLng,
    rating: typeof p.rating === 'number' ? p.rating : null,
    reviewCount: typeof p.userRatingCount === 'number' ? p.userRatingCount : null,
    businessStatus: p.businessStatus || undefined,
    regularOpeningHours: p.regularOpeningHours
      ? {
          openNow: typeof p.regularOpeningHours.openNow === 'boolean' ? p.regularOpeningHours.openNow : undefined,
          weekdayDescriptions: Array.isArray(p.regularOpeningHours.weekdayDescriptions)
            ? p.regularOpeningHours.weekdayDescriptions
            : undefined,
        }
      : undefined,
    types,
    googleMapsUri:
      p.googleMapsUri ||
      `https://www.google.com/maps/search/?api=1&query=${encodeURIComponent(name)}&query_place_id=${encodeURIComponent(p.id || '')}`,
    estimatedDistanceKm: distKm,
    straightLineLabel: hasCoords ? formatStraightLineDistance(distKm) : 'Distance unavailable',
    source: 'google_places_api' as const,
    provider: 'google_places' as const,
    sourceVerified: true,
    imageUrl: mappedPhotos.photoUrl,
    photoName: mappedPhotos.photoName,
    hasRealPhoto: Boolean(mappedPhotos.photoUrl),
    photoUnavailable: !mappedPhotos.photoUrl,
    authorAttributions: mappedPhotos.authorAttributions,
    photos: mappedPhotos.mappedPhotos,
  };
}

/**
 * 1. Query Google Places API (New) searchNearby via official REST endpoint (Table A types only)
 */
async function fetchGooglePlacesNearby(
  lat: number,
  lng: number,
  radiusMeters: number = 8000,
  apiKey: string,
  category: string = 'all',
  languageCode: string = 'en'
): Promise<{ places: any[]; quotaExceeded: boolean }> {
  let quotaExceeded = false;
  if (!apiKey) return { places: [], quotaExceeded: false };

  const safeRadius = Math.min(Math.max(Number(radiusMeters) || 8000, 500), 50000);
  const includedTypes = getGmpTypesForCategory(category);
  const places: any[] = [];
  let gmpHardBlocked = false;

  try {
    const url = 'https://places.googleapis.com/v1/places:searchNearby';
    const requestBody = {
      locationRestriction: {
        circle: {
          center: { latitude: lat, longitude: lng },
          radius: safeRadius,
        },
      },
      includedTypes,
      maxResultCount: 20,
      languageCode,
    };

    const res = await fetch(url, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'X-Goog-Api-Key': apiKey,
        'X-Goog-Maps-Solution-ID': GMP_SOLUTION_ID,
        'X-Goog-FieldMask': PLACES_SEARCH_FIELD_MASK,
      },
      body: JSON.stringify(requestBody),
      signal: AbortSignal.timeout(2600),
    });

    if (res.ok) {
      const data = await res.json();
      for (const p of data.places || []) {
        const mapped = mapGooglePlaceObject(p, lat, lng);
        if (mapped.latitude !== null && mapped.longitude !== null) {
          places.push(mapped);
        }
      }
    } else {
      const errText = await res.text().catch(() => '');
      if (isGmpQuotaError(res.status, errText)) {
        quotaExceeded = true;
      } else {
        if (res.status === 400 || res.status === 403 || res.status === 401) {
          gmpHardBlocked = true;
        }
        console.warn(`Google Places searchNearby HTTP ${res.status}:`, errText.slice(0, 180));
      }
    }
  } catch (err) {
    console.warn('Google Places searchNearby error:', err);
  }

  // Supplement categories without exact Table A types (forts, stepwells, lakes, waterfalls) via searchText when results are sparse
  const catMeta = CATEGORY_FILTERS.find((c) => c.id === category);
  if (!quotaExceeded && !gmpHardBlocked && catMeta && catMeta.searchQueries.length > 0 && places.length < 6) {
    const textResult = await searchGooglePlacesText({
      textQuery: catMeta.searchQueries[0],
      latitude: lat,
      longitude: lng,
      radiusMeters: safeRadius,
      languageCode,
      apiKey,
      maxResultCount: 8,
    });
    if (textResult.quotaExceeded) quotaExceeded = true;
    for (const item of textResult.places) {
      if (!places.some((p) => p.placeId === item.placeId)) {
        places.push(item);
      }
    }
  }

  return { places, quotaExceeded };
}

/**
 * 1b. Query Google Places API (New) Text Search (places:searchText)
 */
export async function searchGooglePlacesText({
  textQuery,
  latitude,
  longitude,
  radiusMeters = 15000,
  includedType,
  languageCode = 'en',
  apiKey,
  maxResultCount = 12,
}: {
  textQuery: string;
  latitude?: number;
  longitude?: number;
  radiusMeters?: number;
  includedType?: string;
  languageCode?: string;
  apiKey?: string;
  maxResultCount?: number;
}): Promise<{ places: any[]; quotaExceeded: boolean; error?: string }> {
  const gmpKey = apiKey || process.env.GOOGLE_MAPS_PLATFORM_KEY || '';
  if (!gmpKey) {
    return { places: [], quotaExceeded: false, error: 'Google Maps Platform key not configured' };
  }
  const cleanQuery = (textQuery || '').trim();
  if (!cleanQuery) {
    return { places: [], quotaExceeded: false, error: 'textQuery is required' };
  }

  try {
    const body: any = {
      textQuery: cleanQuery,
      maxResultCount: Math.min(Math.max(maxResultCount, 1), 20),
      languageCode,
    };
    if (includedType) {
      body.includedType = includedType;
    }
    if (typeof latitude === 'number' && typeof longitude === 'number' && Number.isFinite(latitude) && Number.isFinite(longitude)) {
      body.locationBias = {
        circle: {
          center: { latitude, longitude },
          radius: Math.min(Math.max(radiusMeters || 15000, 500), 50000),
        },
      };
    }

    const res = await fetch('https://places.googleapis.com/v1/places:searchText', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'X-Goog-Api-Key': gmpKey,
        'X-Goog-Maps-Solution-ID': GMP_SOLUTION_ID,
        'X-Goog-FieldMask': PLACES_SEARCH_FIELD_MASK,
      },
      body: JSON.stringify(body),
      signal: AbortSignal.timeout(5000),
    });

    if (!res.ok) {
      const errText = await res.text().catch(() => '');
      return {
        places: [],
        quotaExceeded: isGmpQuotaError(res.status, errText),
        error: `Places Text Search HTTP ${res.status}`,
      };
    }

    const data = await res.json();
    const mapped = (data.places || []).map((p: any) => mapGooglePlaceObject(p, latitude, longitude));
    return { places: mapped, quotaExceeded: false };
  } catch (err: any) {
    return { places: [], quotaExceeded: false, error: err?.message || 'Places Text Search failed' };
  }
}

const PLACE_DETAILS_FIELD_MASK = [
  'id',
  'displayName',
  'formattedAddress',
  'shortFormattedAddress',
  'location',
  'primaryType',
  'primaryTypeDisplayName',
  'types',
  'rating',
  'userRatingCount',
  'businessStatus',
  'regularOpeningHours',
  'currentOpeningHours',
  'websiteUri',
  'nationalPhoneNumber',
  'internationalPhoneNumber',
  'accessibilityOptions',
  'googleMapsUri',
  'photos',
].join(',');

/**
 * 1c. Fetch on-demand Place Details (New) for a specific Google Place ID
 */
export async function fetchGooglePlaceDetails({
  placeId,
  languageCode = 'en',
  apiKey,
}: {
  placeId: string;
  languageCode?: string;
  apiKey?: string;
}): Promise<{ details: any | null; quotaExceeded: boolean; notFound?: boolean; error?: string }> {
  const gmpKey = apiKey || process.env.GOOGLE_MAPS_PLATFORM_KEY || '';
  const cleanId = (placeId || '').replace(/^places\//, '').trim();
  if (!cleanId || !/^[A-Za-z0-9_-]+$/.test(cleanId)) {
    return { details: null, quotaExceeded: false, error: 'Invalid Google Place ID' };
  }
  if (!gmpKey) {
    return { details: null, quotaExceeded: false, error: 'Google Maps Platform key not configured' };
  }

  try {
    const url = new URL(`https://places.googleapis.com/v1/places/${encodeURIComponent(cleanId)}`);
    url.searchParams.set('languageCode', languageCode || 'en');

    const res = await fetch(url.toString(), {
      method: 'GET',
      headers: {
        'Content-Type': 'application/json',
        'X-Goog-Api-Key': gmpKey,
        'X-Goog-Maps-Solution-ID': GMP_SOLUTION_ID,
        'X-Goog-FieldMask': PLACE_DETAILS_FIELD_MASK,
      },
      signal: AbortSignal.timeout(5000),
    });

    if (!res.ok) {
      const errText = await res.text().catch(() => '');
      return {
        details: null,
        quotaExceeded: isGmpQuotaError(res.status, errText),
        notFound: res.status === 404,
        error: `Place Details HTTP ${res.status}`,
      };
    }

    const p = await res.json();
    const mappedPhotos = mapGooglePhotosList(p.photos || []);
    const details = {
      placeId: p.id || cleanId,
      name: p.displayName?.text || '',
      formattedAddress: p.formattedAddress || '',
      shortFormattedAddress: p.shortFormattedAddress || '',
      latitude: typeof p.location?.latitude === 'number' ? p.location.latitude : null,
      longitude: typeof p.location?.longitude === 'number' ? p.location.longitude : null,
      primaryType: p.primaryType,
      primaryTypeDisplayName: p.primaryTypeDisplayName?.text || undefined,
      types: Array.isArray(p.types) ? p.types : [],
      rating: typeof p.rating === 'number' ? p.rating : null,
      reviewCount: typeof p.userRatingCount === 'number' ? p.userRatingCount : null,
      businessStatus: p.businessStatus || undefined,
      regularOpeningHours: p.regularOpeningHours
        ? {
            openNow: typeof p.regularOpeningHours.openNow === 'boolean' ? p.regularOpeningHours.openNow : undefined,
            weekdayDescriptions: Array.isArray(p.regularOpeningHours.weekdayDescriptions)
              ? p.regularOpeningHours.weekdayDescriptions
              : undefined,
          }
        : undefined,
      currentOpeningHours: p.currentOpeningHours
        ? {
            openNow: typeof p.currentOpeningHours.openNow === 'boolean' ? p.currentOpeningHours.openNow : undefined,
            weekdayDescriptions: Array.isArray(p.currentOpeningHours.weekdayDescriptions)
              ? p.currentOpeningHours.weekdayDescriptions
              : undefined,
          }
        : undefined,
      websiteUri: p.websiteUri || undefined,
      nationalPhoneNumber: p.nationalPhoneNumber || undefined,
      internationalPhoneNumber: p.internationalPhoneNumber || undefined,
      accessibilityOptions: p.accessibilityOptions || undefined,
      googleMapsUri: p.googleMapsUri || `https://www.google.com/maps/place/?q=place_id:${encodeURIComponent(cleanId)}`,
      imageUrl: mappedPhotos.photoUrl,
      hasRealPhoto: Boolean(mappedPhotos.photoUrl),
      photoUnavailable: !mappedPhotos.photoUrl,
      authorAttributions: mappedPhotos.authorAttributions,
      photos: mappedPhotos.mappedPhotos,
    };

    return { details, quotaExceeded: false };
  } catch (err: any) {
    return { details: null, quotaExceeded: false, error: err?.message || 'Place Details lookup failed' };
  }
}

const osmNearbyCache = new Map<string, { places: any[]; expiresAt: number }>();
const OSM_COOLDOWN_MS = 90 * 1000;
const OSM_REQUEST_TIMEOUT_MS = 4800;
let osmCooldownUntil = 0;

export function resetOsmOverpassStateForTests(): void {
  osmNearbyCache.clear();
  osmCooldownUntil = 0;
}

function summarizeOverpassFailure(err: unknown): string {
  if (err && typeof err === 'object' && 'errors' in err && Array.isArray((err as any).errors)) {
    const reasons = Array.from(
      new Set(
        (err as any).errors.map((e: any) =>
          e?.name === 'TimeoutError'
            ? 'timeout'
            : e?.name === 'AbortError'
            ? 'aborted'
            : String(e?.message || e || 'unavailable').slice(0, 60)
        )
      )
    );
    return reasons.join(', ') || 'all mirrors unavailable';
  }
  const msg = err && typeof err === 'object' && 'message' in err ? String((err as any).message) : String(err || '');
  return msg.slice(0, 80) || 'unavailable';
}

function buildOsmPlaceDetails(tags: Record<string, any>, distKm: number, address: string): {
  oneLineSignificance: string;
  highlights: string[];
} {
  const typeLabel =
    tags.historic ||
    tags.tourism ||
    tags.amenity?.replace(/_/g, ' ') ||
    tags.leisure?.replace(/_/g, ' ') ||
    tags.shop ||
    'local landmark';
  const bits: string[] = [];
  if (tags.religion) bits.push(`Faith: ${tags.religion}`);
  if (tags.cuisine) bits.push(`Cuisine: ${tags.cuisine}`);
  if (tags.opening_hours) bits.push(`Hours: ${tags.opening_hours}`);
  if (tags.heritage) bits.push(`Heritage designation`);

  const oneLineSignificance = `Verified OpenStreetMap ${typeLabel}${address && address !== 'Local Area' ? ` at ${address}` : ''}${bits.length ? ` (${bits[0]})` : ''}.`;
  const highlights = [
    ...bits.slice(0, 2),
    `Distance: ${formatStraightLineDistance(distKm)}`,
  ];
  return { oneLineSignificance, highlights };
}

/**
 * 2. Query Live OpenStreetMap Overpass API with mirror fallback, cooldown gate, & caching (no fabricated ratings)
 */
export async function fetchOpenStreetMapNearby(
  lat: number,
  lng: number,
  radiusMeters: number = 3800,
  options?: {
    fetcher?: typeof fetch;
    timeoutMs?: number;
    cooldownMs?: number;
  }
): Promise<any[]> {
  const safeRadius = Math.min(Math.max(radiusMeters, 500), 3800);
  const osmCacheKey = `${lat.toFixed(2)}-${lng.toFixed(2)}-${Math.round(safeRadius / 1000)}`;
  const now = Date.now();
  const cachedOsm = osmNearbyCache.get(osmCacheKey);
  if (cachedOsm && cachedOsm.expiresAt > now) {
    return cachedOsm.places;
  }
  if (now < osmCooldownUntil) {
    return [];
  }

  const fetchImpl = options?.fetcher || fetch;
  const timeoutMs = options?.timeoutMs ?? OSM_REQUEST_TIMEOUT_MS;
  const cooldownMs = options?.cooldownMs ?? OSM_COOLDOWN_MS;
  const controllers: AbortController[] = [];
  const timers: ReturnType<typeof setTimeout>[] = [];

  try {
    const delta = (safeRadius / 111000) * 1.05;
    const south = lat - delta;
    const north = lat + delta;
    const west = lng - delta;
    const east = lng + delta;

    const overpassQuery = `[out:json][timeout:4];(
      nw["tourism"~"^(attraction|museum|viewpoint|artwork|gallery)$"](${south},${west},${north},${east});
      nw["historic"~"^(monument|memorial|castle|fort|ruins|archaeological_site|heritage)$"](${south},${west},${north},${east});
      nw["amenity"~"^(place_of_worship|arts_centre|marketplace|restaurant|cafe)$"](${south},${west},${north},${east});
      nw["leisure"~"^(park|garden|nature_reserve)$"](${south},${west},${north},${east});
    );out center 50;`;

    // Query distinct Overpass clusters (avoid hitting two endpoints on the same German cluster simultaneously)
    const endpoints = [
      'https://overpass-api.de/api/interpreter',
      'https://overpass.kumi.systems/api/interpreter',
    ];

    const data: any = await Promise.any(
      endpoints.map(async (ep) => {
        const controller = new AbortController();
        controllers.push(controller);
        const timer = setTimeout(() => {
          const timeoutErr =
            typeof DOMException !== 'undefined'
              ? new DOMException('Overpass request timed out', 'TimeoutError')
              : new Error('Overpass request timed out');
          controller.abort(timeoutErr);
        }, timeoutMs);
        timers.push(timer);

        try {
          const res = await fetchImpl(ep, {
            method: 'POST',
            headers: {
              'Content-Type': 'application/x-www-form-urlencoded',
              'User-Agent': 'CharaivaTravelGuide/1.0',
            },
            body: `data=${encodeURIComponent(overpassQuery)}`,
            signal: controller.signal,
          });
          if (!res.ok) throw new Error(`Overpass HTTP ${res.status}`);
          return await res.json();
        } finally {
          clearTimeout(timer);
        }
      })
    );

    const parsed = (data.elements || [])
      .map((el: any) => {
        const pLat = typeof el.lat === 'number' ? el.lat : el.center?.lat;
        const pLng = typeof el.lon === 'number' ? el.lon : el.center?.lon;
        const name = el.tags?.['name:en'] || el.tags?.name;
        if (!name || !Number.isFinite(pLat) || !Number.isFinite(pLng)) return null;

        const distKm = computeDistanceKm(lat, lng, pLat, pLng);
        const types = [
          el.tags.historic,
          el.tags.tourism,
          el.tags.amenity,
          el.tags.shop,
          el.tags.leisure,
          el.tags.religion,
        ].filter(Boolean);
        const cat = normalizePlaceCategory(types, name);
        const addrParts = [
          el.tags['addr:street'],
          el.tags['addr:suburb'] || el.tags['addr:neighbourhood'],
          el.tags['addr:city'],
        ].filter(Boolean);
        const address = addrParts.length > 0 ? addrParts.join(', ') : 'Local Area';
        const { oneLineSignificance, highlights } = buildOsmPlaceDetails(el.tags, distKm, address);

        return {
          id: `osm-${el.id}`,
          name,
          category: cat,
          address,
          latitude: pLat,
          longitude: pLng,
          rating: null,
          reviewCount: null,
          types,
          wikipediaTag: el.tags.wikipedia || undefined,
          websiteUri: el.tags.website || el.tags['contact:website'] || undefined,
          nationalPhoneNumber: el.tags.phone || el.tags['contact:phone'] || undefined,
          googleMapsUri: `https://www.google.com/maps/search/?api=1&query=${encodeURIComponent(name)}`,
          estimatedDistanceKm: distKm,
          straightLineLabel: formatStraightLineDistance(distKm),
          oneLineSignificance,
          highlights,
          source: 'openstreetmap_osm' as const,
          provider: 'openstreetmap' as const,
          sourceVerified: true,
        };
      })
      .filter(Boolean);

    osmCooldownUntil = 0;
    osmNearbyCache.set(osmCacheKey, {
      places: parsed,
      expiresAt: Date.now() + (parsed.length > 0 ? 8 * 60 * 1000 : 2 * 60 * 1000),
    });
    return parsed;
  } catch (err) {
    osmCooldownUntil = Date.now() + cooldownMs;
    osmNearbyCache.set(osmCacheKey, {
      places: [],
      expiresAt: Date.now() + cooldownMs,
    });
    console.info(
      `[OSM Overpass] Optional nearby lookup paused for ${Math.round(cooldownMs / 1000)}s (${summarizeOverpassFailure(err)}); Google Places, Wikipedia, and Ground Truth remain active.`
    );
  } finally {
    timers.forEach((timer) => clearTimeout(timer));
    controllers.forEach((controller) => {
      if (!controller.signal.aborted) {
        try {
          controller.abort();
        } catch {
          // ignore
        }
      }
    });
  }
  return [];
}

/**
 * 3. Query Ground Truth Index strictly within proximity radius of active coordinates
 */
function fetchGroundTruthIndexNearby(lat: number, lng: number, radiusKm: number = 45): any[] {
  return VERIFIED_GROUND_TRUTH_POIS.map((poi) => {
    const distKm = computeDistanceKm(lat, lng, poi.lat, poi.lng);
    const hasImg = Boolean(poi.imageUrl && poi.imageUrl.trim().length > 0);
    const proxiedUrl =
      hasImg && poi.imageUrl.startsWith('https://')
        ? `/api/places/proxy-image?url=${encodeURIComponent(poi.imageUrl)}`
        : poi.imageUrl;

    return {
      id: `gt-${poi.name.toLowerCase().replace(/[^a-z0-9]/g, '-')}`,
      name: poi.name,
      category: poi.category,
      address: `${poi.locality}, ${poi.city}`,
      latitude: poi.lat,
      longitude: poi.lng,
      rating: typeof poi.rating === 'number' ? poi.rating : null,
      reviewCount: typeof poi.reviewCount === 'number' ? poi.reviewCount : null,
      types: poi.types,
      imageUrl: hasImg ? proxiedUrl : '',
      hasRealPhoto: hasImg,
      photoUnavailable: !hasImg,
      googleMapsUri: `https://www.google.com/maps/search/?api=1&query=${encodeURIComponent(poi.name + ' ' + poi.city)}`,
      estimatedDistanceKm: distKm,
      straightLineLabel: formatStraightLineDistance(distKm),
      oneLineSignificance: poi.oneLineSignificance,
      highlights: poi.highlights,
      source: 'verified_ground_truth_index' as const,
      provider: 'curated_verified' as const,
      sourceVerified: true,
    };
  })
    .filter((p) => p.estimatedDistanceKm <= radiusKm)
    .sort((a, b) => a.estimatedDistanceKm - b.estimatedDistanceKm);
}

const wikiGeoCache = new Map<string, { places: any[]; expiresAt: number }>();

/**
 * 4. Fast global fallback using Wikipedia Geosearch API (~350ms, zero API key needed, verified landmark coords & thumbnails)
 */
async function fetchWikipediaGeosearchNearby(
  lat: number,
  lng: number,
  radiusMeters: number = 10000,
  city: string = ''
): Promise<any[]> {
  const safeRadius = Math.min(Math.max(radiusMeters, 500), 10000);
  const cacheKey = `wikigeo-${lat.toFixed(2)}-${lng.toFixed(2)}-${Math.round(safeRadius / 1000)}`;
  const hit = wikiGeoCache.get(cacheKey);
  if (hit && hit.expiresAt > Date.now()) {
    return hit.places;
  }

  try {
    const url =
      `https://en.wikipedia.org/w/api.php?action=query&generator=geosearch` +
      `&ggscoord=${lat}|${lng}&ggsradius=${safeRadius}&ggslimit=50` +
      `&prop=coordinates|pageimages|description|info&inprop=url&piprop=thumbnail&pithumbsize=640&format=json`;
    const res = await fetch(url, {
      headers: { 'User-Agent': WIKI_USER_AGENT },
      signal: AbortSignal.timeout(2200),
    });
    if (!res.ok) return [];
    const data = await res.json();
    const pages = Object.values(data?.query?.pages || {}) as any[];
    const safeCity = !isGenericLocationLabel(city) ? city : '';

    const filteredOutTitleRe = /\b(railway station|metro station|bus stand|airport|hospital|collage|college|university|school|constituency|municipal ward|lok sabha|vidhan sabha|highway|expressway|road|flyover|junction|bridge)\b/i;
    const filteredOutDescRe = /\b(electoral|constituency|district|state of india|suburb|neighbourhood|neighborhood|locality|census town|residential area|slum|railway station|train station|housing)\b/i;

    const results = pages
      .map((p: any) => {
        const title = String(p.title || '').trim();
        const desc = String(p.description || '').trim();
        const pLat = p.coordinates?.[0]?.lat;
        const pLng = p.coordinates?.[0]?.lon;
        if (!title || !Number.isFinite(pLat) || !Number.isFinite(pLng)) return null;
        if (filteredOutTitleRe.test(title) || filteredOutDescRe.test(desc)) return null;
        if (safeCity && title.toLowerCase() === safeCity.toLowerCase()) return null;

        const distKm = computeDistanceKm(lat, lng, pLat, pLng);
        const cat = normalizePlaceCategory([], `${title} ${desc}`);
        const rawThumb = p.thumbnail?.source || '';
        const proxiedThumb =
          rawThumb && rawThumb.startsWith('https://')
            ? `/api/places/proxy-image?url=${encodeURIComponent(rawThumb)}`
            : '';

        return {
          id: `wiki-${p.pageid}`,
          placeId: `wiki-${p.pageid}`,
          name: title,
          category: cat,
          address: safeCity || 'Verified Regional Landmark',
          latitude: pLat,
          longitude: pLng,
          rating: null,
          reviewCount: null,
          types: [cat],
          imageUrl: proxiedThumb,
          hasRealPhoto: Boolean(proxiedThumb),
          photoUnavailable: !proxiedThumb,
          authorAttributions: proxiedThumb
            ? [
                {
                  displayName: `${title} (Wikipedia / Wikimedia Commons)`,
                  uri: p.fullurl || `https://en.wikipedia.org/wiki/${encodeURIComponent(title)}`,
                },
              ]
            : [],
          photos: proxiedThumb ? [{ name: title, url: proxiedThumb, authorAttributions: [] }] : [],
          googleMapsUri: `https://www.google.com/maps/search/?api=1&query=${encodeURIComponent(title + (safeCity ? ' ' + safeCity : ''))}`,
          estimatedDistanceKm: distKm,
          straightLineLabel: formatStraightLineDistance(distKm),
          oneLineSignificance: desc
            ? `${desc}${safeCity ? ` in ${safeCity}` : ''}.`
            : `Noted landmark${safeCity ? ` in ${safeCity}` : ''} documented on Wikipedia.`,
          highlights: [desc || `${cat} landmark`, `Distance: ${formatStraightLineDistance(distKm)}`],
          source: 'wikipedia_geosearch' as const,
          provider: 'wikipedia' as const,
          sourceVerified: true,
        };
      })
      .filter(Boolean);

    if (results.length > 0) {
      wikiGeoCache.set(cacheKey, { places: results, expiresAt: Date.now() + 10 * 60 * 1000 });
    }
    return results;
  } catch {
    return [];
  }
}

const WIKI_CATEGORY_SEARCH_TERMS: Record<string, string> = {
  all: '(tourist OR landmark OR monument OR temple OR fort OR museum OR park)',
  spiritual: '(temple OR mosque OR church OR gurudwara OR dargah OR shrine)',
  history: '(fort OR palace OR monument OR memorial OR heritage)',
  food: '(restaurant OR cafe OR bakery OR bazaar OR market)',
  nature: '(lake OR park OR garden OR beach OR hill OR sanctuary)',
  shopping: '(bazaar OR market OR mall OR emporium)',
  culture: '(museum OR gallery OR theatre OR theater OR auditorium)',
  hiddengems: '(stepwell OR ghat OR cave OR historic OR viewpoint)',
};

async function fetchWikipediaCityCategorySearch(
  lat: number,
  lng: number,
  city: string,
  category: string,
  maxDistKm: number = 28
): Promise<any[]> {
  const safeCity = !isGenericLocationLabel(city) ? city.trim() : '';
  if (!safeCity) return [];
  const terms = WIKI_CATEGORY_SEARCH_TERMS[category] || WIKI_CATEGORY_SEARCH_TERMS.all;
  const cacheKey = `wikicat2-${safeCity.toLowerCase()}-${category}-${lat.toFixed(1)}-${lng.toFixed(1)}`;
  const hit = wikiGeoCache.get(cacheKey);
  if (hit && hit.expiresAt > Date.now()) {
    return hit.places;
  }

  try {
    const query = `${safeCity} ${terms}`;
    const url =
      `https://en.wikipedia.org/w/api.php?action=query&generator=search` +
      `&gsrsearch=${encodeURIComponent(query)}&gsrlimit=20` +
      `&prop=coordinates|pageimages|description|info&inprop=url&piprop=thumbnail&pithumbsize=640&format=json`;
    const res = await fetch(url, {
      headers: { 'User-Agent': WIKI_USER_AGENT },
      signal: AbortSignal.timeout(2200),
    });
    if (!res.ok) return [];
    const data = await res.json();
    const pages = Object.values(data?.query?.pages || {}) as any[];
    const filteredOutTitleRe = /\b(railway station|metro station|airport|hospital|college|university|school|constituency|municipal|lok sabha|vidhan sabha|highway|expressway)\b/i;

    const results = pages
      .map((p: any) => {
        const title = String(p.title || '').trim();
        const desc = String(p.description || '').trim();
        const pLat = p.coordinates?.[0]?.lat;
        const pLng = p.coordinates?.[0]?.lon;
        if (!title || !Number.isFinite(pLat) || !Number.isFinite(pLng)) return null;
        if (title.toLowerCase() === safeCity.toLowerCase() || filteredOutTitleRe.test(title)) return null;
        const distKm = computeDistanceKm(lat, lng, pLat, pLng);
        if (distKm > maxDistKm) return null;

        const inferredCat = normalizePlaceCategory([], `${title} ${desc}`);
        const cat =
          category !== 'all' && (inferredCat === category || inferredCat === 'hiddengems')
            ? category
            : inferredCat;
        const rawThumb = p.thumbnail?.source || '';
        const proxiedThumb =
          rawThumb && rawThumb.startsWith('https://')
            ? `/api/places/proxy-image?url=${encodeURIComponent(rawThumb)}`
            : '';

        return {
          id: `wiki-${p.pageid}`,
          placeId: `wiki-${p.pageid}`,
          name: title,
          category: cat,
          address: safeCity,
          latitude: pLat,
          longitude: pLng,
          rating: null,
          reviewCount: null,
          types: [cat],
          imageUrl: proxiedThumb,
          hasRealPhoto: Boolean(proxiedThumb),
          photoUnavailable: !proxiedThumb,
          authorAttributions: proxiedThumb
            ? [
                {
                  displayName: `${title} (Wikipedia / Wikimedia Commons)`,
                  uri: p.fullurl || `https://en.wikipedia.org/wiki/${encodeURIComponent(title)}`,
                },
              ]
            : [],
          photos: proxiedThumb ? [{ name: title, url: proxiedThumb, authorAttributions: [] }] : [],
          googleMapsUri: `https://www.google.com/maps/search/?api=1&query=${encodeURIComponent(title + ' ' + safeCity)}`,
          estimatedDistanceKm: distKm,
          straightLineLabel: formatStraightLineDistance(distKm),
          oneLineSignificance: desc ? `${desc} in ${safeCity}.` : `Landmark in ${safeCity} documented on Wikipedia.`,
          highlights: [desc || `${cat} landmark in ${safeCity}`, `Distance: ${formatStraightLineDistance(distKm)}`],
          source: 'wikipedia_geosearch' as const,
          provider: 'wikipedia' as const,
          sourceVerified: true,
        };
      })
      .filter(Boolean);

    if (results.length > 0) {
      wikiGeoCache.set(cacheKey, { places: results, expiresAt: Date.now() + 10 * 60 * 1000 });
    }
    return results;
  } catch {
    return [];
  }
}

/**
 * MAIN UNIFIED REAL PLACES RADAR:
 * Validated Coordinates -> Google Places API (New) + OSM + Proximity Ground Truth -> Multilingual Narration Enrichment
 */
export async function getRealNearbyPlaces({
  latitude,
  longitude,
  locationName = 'Current Location',
  city = 'Local Area',
  language = 'English',
  radiusMeters = 10000,
  category = 'all',
  gmpApiKey,
  aiClient,
}: {
  latitude: number;
  longitude: number;
  locationName?: string;
  city?: string;
  language?: string;
  radiusMeters?: number;
  category?: string;
  gmpApiKey?: string;
  aiClient?: any;
}): Promise<{
  areaOverview: string;
  spots: DiscoveredRealPlace[];
  groundTruthCount: number;
  sources?: string[];
  quotaExceeded: boolean;
}> {
  if (
    typeof latitude !== 'number' ||
    typeof longitude !== 'number' ||
    !Number.isFinite(latitude) ||
    !Number.isFinite(longitude) ||
    latitude < -90 ||
    latitude > 90 ||
    longitude < -180 ||
    longitude > 180
  ) {
    const err: any = new Error('Valid latitude and longitude coordinates are required.');
    err.status = 400;
    throw err;
  }

  const lat = latitude;
  const lng = longitude;
  const safeRadiusMeters = Math.min(Math.max(Number(radiusMeters) || 10000, 500), 50000);
  const languageCode = mapLanguageToBcp47(language);
  const radarCacheKey = `radar-${lat.toFixed(3)}-${lng.toFixed(3)}-${safeRadiusMeters}-${category}-${languageCode}`;

  const cachedRadar = fullRadarSpotsCache.get(radarCacheKey);
  if (cachedRadar && cachedRadar.expiresAt > Date.now()) {
    return {
      ...cachedRadar.data,
      quotaExceeded: Boolean(cachedRadar.data.quotaExceeded),
    };
  }

  // Gather real candidates concurrently across sources
  const [gmpResult, osmPlaces, wikiGeoPlaces, wikiCityPlaces] = await Promise.all([
    gmpApiKey
      ? fetchGooglePlacesNearby(lat, lng, safeRadiusMeters, gmpApiKey, category, languageCode)
      : Promise.resolve({ places: [], quotaExceeded: false }),
    fetchOpenStreetMapNearby(lat, lng, Math.min(safeRadiusMeters, 3800)),
    fetchWikipediaGeosearchNearby(lat, lng, Math.min(safeRadiusMeters, 10000), city),
    fetchWikipediaCityCategorySearch(lat, lng, city, category, Math.max(safeRadiusMeters / 1000, 26)),
  ]);

  const gmpPlaces = gmpResult.places;
  const quotaExceeded = gmpResult.quotaExceeded;
  const indexPlaces = fetchGroundTruthIndexNearby(lat, lng, Math.max(safeRadiusMeters / 1000, 35));

  // Deduplicate by Google Place ID first, then normalized name + proximity (<150m)
  const combinedRaw: any[] = [];
  const seenPlaceIds = new Set<string>();

  for (const list of [gmpPlaces, indexPlaces, osmPlaces, wikiCityPlaces, wikiGeoPlaces]) {
    for (const item of list) {
      if (item.googlePlaceId && seenPlaceIds.has(item.googlePlaceId)) continue;
      const normName = String(item.name || '')
        .toLowerCase()
        .replace(/[^a-z0-9]/g, '')
        .slice(0, 18);
      const isDuplicateNameNearby = combinedRaw.some((existing) => {
        const exName = String(existing.name || '')
          .toLowerCase()
          .replace(/[^a-z0-9]/g, '')
          .slice(0, 18);
        if (exName !== normName) return false;
        if (
          typeof existing.latitude === 'number' &&
          typeof existing.longitude === 'number' &&
          typeof item.latitude === 'number' &&
          typeof item.longitude === 'number'
        ) {
          return computeDistanceKm(existing.latitude, existing.longitude, item.latitude, item.longitude) < 0.15;
        }
        return true;
      });
      if (isDuplicateNameNearby) continue;

      if (item.googlePlaceId) seenPlaceIds.add(item.googlePlaceId);
      combinedRaw.push(item);
    }
  }

  // Balance categories cleanly when viewing "all", or filter by category
  const categoriesList = ['spiritual', 'history', 'food', 'nature', 'shopping', 'culture', 'hiddengems'];
  const selectedSpotsMap = new Map<string, any>();

  if (category === 'all') {
    for (const cat of categoriesList) {
      const matching = combinedRaw
        .filter((p) => p.category === cat || normalizePlaceCategory(p.types || [], p.name) === cat)
        .sort((a, b) => a.estimatedDistanceKm - b.estimatedDistanceKm);
      for (const item of matching.slice(0, 5)) {
        selectedSpotsMap.set(item.id, item);
      }
    }
    combinedRaw.sort((a, b) => a.estimatedDistanceKm - b.estimatedDistanceKm);
    for (const item of combinedRaw) {
      if (selectedSpotsMap.size >= 36) break;
      if (!selectedSpotsMap.has(item.id)) {
        selectedSpotsMap.set(item.id, item);
      }
    }
  } else {
    const matching = combinedRaw
      .filter((p) => p.category === category || normalizePlaceCategory(p.types || [], p.name) === category)
      .sort((a, b) => a.estimatedDistanceKm - b.estimatedDistanceKm);
    for (const item of matching.slice(0, 30)) {
      selectedSpotsMap.set(item.id, item);
    }
  }

  const topPlaces = Array.from(selectedSpotsMap.values()).sort((a, b) => a.estimatedDistanceKm - b.estimatedDistanceKm);

  const activeSources = Array.from(new Set(topPlaces.map((p) => p.source).filter(Boolean)));
  const areaOverview =
    topPlaces.length > 0
      ? `Showing ${topPlaces.length} verified places near ${city && !isGenericLocationLabel(city) ? city : locationName}.`
      : `No nearby places returned within ${(safeRadiusMeters / 1000).toFixed(1)} km of this location.`;

  // Fast initial return — never block the radar list on slow Gemini narration or N serial photo HTTP calls.
  // Photos on cards lazy-load asynchronously via PlaceCardImage IntersectionObserver when scrolled into view,
  // and rich multilingual descriptions/extended-info hydrate smoothly without delaying list rendering.
  const finalSpots: DiscoveredRealPlace[] = topPlaces.slice(0, 36).map((place) => {
    const categoryLabel = place.primaryTypeDisplayName || place.category;
    const oneLineImportance =
      place.oneLineSignificance ||
      `${categoryLabel} located in ${place.address && place.address !== 'Local Area' ? place.address : city || 'your current area'}.`;

    const description =
      place.oneLineSignificance ||
      `${place.name} is located ${formatStraightLineDistance(place.estimatedDistanceKm)} from your active location${place.address && place.address !== 'Local Area' ? ` at ${place.address}` : ''}.`;

    const defaultHighlights: string[] = [];
    if (place.address && place.address !== 'Local Area') defaultHighlights.push(`Address: ${place.address}`);
    if (typeof place.rating === 'number') {
      defaultHighlights.push(
        `Rating: ${place.rating.toFixed(1)} ★${typeof place.reviewCount === 'number' ? ` (${place.reviewCount.toLocaleString()} reviews)` : ''}`
      );
    }
    defaultHighlights.push(`Distance: ${formatStraightLineDistance(place.estimatedDistanceKm)}`);

    const keyHighlights =
      place.highlights && place.highlights.length > 0 ? place.highlights : defaultHighlights;

    return {
      id: place.id,
      placeId: place.placeId,
      googlePlaceId: place.googlePlaceId,
      name: place.name,
      category: place.category,
      primaryType: place.primaryType,
      primaryTypeDisplayName: place.primaryTypeDisplayName,
      oneLineImportance,
      description,
      estimatedDistanceKm: place.estimatedDistanceKm,
      straightLineLabel: place.straightLineLabel || formatStraightLineDistance(place.estimatedDistanceKm),
      walkOrDriveTime: formatWalkOrDriveTime(place.estimatedDistanceKm),
      addressOrLocality: place.address || city,
      formattedAddress: place.formattedAddress,
      shortFormattedAddress: place.shortFormattedAddress,
      websiteUri: place.websiteUri,
      nationalPhoneNumber: place.nationalPhoneNumber,
      keyHighlights,
      imageUrl: place.hasRealPhoto && place.imageUrl ? place.imageUrl : '',
      photoName: place.photoName,
      hasRealPhoto: Boolean(place.hasRealPhoto && place.imageUrl),
      photoUnavailable: !(place.hasRealPhoto && place.imageUrl),
      authorAttributions: place.authorAttributions || [],
      photos: place.photos || [],
      rating: typeof place.rating === 'number' ? place.rating : null,
      reviewCount: typeof place.reviewCount === 'number' ? place.reviewCount : null,
      businessStatus: place.businessStatus,
      regularOpeningHours: place.regularOpeningHours,
      googleMapsUri: place.googleMapsUri,
      latitude: place.latitude,
      longitude: place.longitude,
      source: place.source,
      provider: place.provider,
      sourceVerified: true,
    };
  });

  const radarResult = {
    areaOverview,
    spots: finalSpots,
    groundTruthCount: finalSpots.length,
    sources: activeSources,
    quotaExceeded,
  };

  if (!quotaExceeded && finalSpots.length > 0) {
    fullRadarSpotsCache.set(radarCacheKey, {
      data: radarResult,
      expiresAt: Date.now() + 4 * 60 * 1000,
    });
  }

  return radarResult;
}

export interface RepresentativeLocationPhotoResult extends ExactPlacePhotoResult {
  photoSubjectName?: string;
}

/**
 * Selects a representative photograph for the user's current or selected city/area:
 * Priority 1: Genuine city/location image from Google Places / Wikipedia / curated city index
 * Priority 2: Verified well-known heritage landmark inside the identified city (or <= 25 km)
 * Priority 3: Verified local tourist attraction / park / museum (never restaurants or residences)
 * Priority 4: Empty photoUnavailable state so frontend renders neutral travel placeholder
 */
export async function resolveRepresentativeLocationPhoto(options: {
  city?: string;
  country?: string;
  locationName?: string;
  lat: number;
  lng: number;
  curatedCityPhotoUrl?: string;
  apiKey?: string;
}): Promise<RepresentativeLocationPhotoResult> {
  const { city, country, lat, lng, curatedCityPhotoUrl, apiKey } = options;
  const gmpKey = apiKey || process.env.GOOGLE_MAPS_PLATFORM_KEY || '';
  const cleanCity = !isGenericLocationLabel(city) ? (city || '').trim() : '';
  let quotaExceeded = false;

  // Priority 1a: Authentic city/locality image via Google Places / Wikipedia
  if (cleanCity) {
    const cityQuery = country && !isGenericLocationLabel(country) ? `${cleanCity}` : cleanCity;
    const cityPhoto = await resolveExactPlacePhotoWithGooglePlaces(cityQuery, cleanCity, lat, lng, undefined, gmpKey);
    if (cityPhoto.quotaExceeded) quotaExceeded = true;
    if (cityPhoto.hasRealPhoto && cityPhoto.photoUrl) {
      return {
        ...cityPhoto,
        photoSubjectName: cleanCity,
      };
    }

    // Priority 1b: Curated verified city photo wrapped via secure image proxy
    if (curatedCityPhotoUrl && curatedCityPhotoUrl.startsWith('https://')) {
      const proxied = `/api/places/proxy-image?url=${encodeURIComponent(curatedCityPhotoUrl)}`;
      return {
        hasRealPhoto: true,
        photoUnavailable: false,
        quotaExceeded,
        photoUrl: proxied,
        photoSubjectName: cleanCity,
        authorAttributions: [{ displayName: `${cleanCity} Wikimedia Commons Archive` }],
        photos: [{ name: cleanCity, url: proxied, authorAttributions: [{ displayName: `${cleanCity} Wikimedia Commons Archive` }] }],
      };
    }
  }

  // Priority 2: Verified well-known landmark within the identified city (or within 25 km when city is unknown)
  const heritageCategories = new Set(['spiritual', 'history', 'culture', 'nature']);
  const candidatePois = VERIFIED_GROUND_TRUTH_POIS.filter((poi) => {
    if (!poi.imageUrl || !heritageCategories.has(poi.category)) return false;
    if (cleanCity) {
      return poi.city.toLowerCase() === cleanCity.toLowerCase();
    }
    return computeDistanceKm(lat, lng, poi.lat, poi.lng) <= 25;
  })
    .map((poi) => ({ poi, distKm: computeDistanceKm(lat, lng, poi.lat, poi.lng) }))
    .sort((a, b) => a.distKm - b.distKm);

  if (candidatePois.length > 0) {
    const { poi } = candidatePois[0];
    const resolvedPoiUrl =
      poi.imageUrl.startsWith('/api/')
        ? poi.imageUrl
        : `/api/places/proxy-image?url=${encodeURIComponent(poi.imageUrl)}`;
    return {
      hasRealPhoto: true,
      photoUnavailable: false,
      quotaExceeded,
      photoUrl: resolvedPoiUrl,
      photoSubjectName: poi.name,
      authorAttributions: [{ displayName: `${poi.name}, ${poi.city} (Wikimedia Commons)` }],
      photos: [
        {
          name: poi.name,
          url: resolvedPoiUrl,
          authorAttributions: [{ displayName: `${poi.name}, ${poi.city} (Wikimedia Commons)` }],
        },
      ],
    };
  }

  // Priority 3: Relevant verified local tourist attraction / landmark via Google Places API (New)
  if (!quotaExceeded && gmpKey) {
    try {
      const res = await fetch('https://places.googleapis.com/v1/places:searchNearby', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'X-Goog-Api-Key': gmpKey,
          'X-Goog-Maps-Solution-ID': GMP_SOLUTION_ID,
          'X-Goog-FieldMask': 'places.id,places.displayName,places.primaryType,places.photos',
        },
        body: JSON.stringify({
          locationRestriction: {
            circle: {
              center: { latitude: lat, longitude: lng },
              radius: 15000,
            },
          },
          includedTypes: ['tourist_attraction', 'historical_landmark', 'museum', 'park'],
          maxResultCount: 8,
        }),
        signal: AbortSignal.timeout(3000),
      });

      if (res.ok) {
        const data = await res.json();
        const withPhoto = (data.places || []).find((p: any) => Array.isArray(p.photos) && p.photos.length > 0);
        if (withPhoto) {
          const mapped = mapGooglePhotosList(withPhoto.photos);
          if (mapped.photoUrl) {
            return {
              hasRealPhoto: true,
              photoUnavailable: false,
              quotaExceeded: false,
              photoUrl: mapped.photoUrl,
              placeId: withPhoto.id,
              photoName: mapped.photoName,
              photoSubjectName: withPhoto.displayName?.text || cleanCity || 'Local Landmark',
              authorAttributions: mapped.authorAttributions,
              photos: mapped.mappedPhotos,
            };
          }
        }
      } else {
        const errText = await res.text().catch(() => '');
        if (isGmpQuotaError(res.status, errText)) quotaExceeded = true;
      }
    } catch {
      // Ignore transient network errors and fall through to Priority 4 placeholder
    }
  }

  // Priority 4: Neutral placeholder (never invent or cross-contaminate with another city's photo)
  return {
    hasRealPhoto: false,
    photoUnavailable: true,
    quotaExceeded,
    photoUrl: '',
    authorAttributions: [],
    photos: [],
  };
}

/**
 * Fetches grounded encyclopedic extract from Wikipedia for a specific place (city-disambiguated)
 */
export async function fetchWikipediaPlaceExtract(
  placeName: string,
  city?: string
): Promise<{ extract: string; title: string; url?: string } | null> {
  const cleanPlace = (placeName || '').trim();
  const safeCity = !isGenericLocationLabel(city) ? (city || '').trim() : '';
  if (!cleanPlace) return null;

  const candidateTitles = Array.from(
    new Set(
      [
        cleanPlace,
        safeCity ? `${cleanPlace}, ${safeCity}` : '',
        safeCity ? `${cleanPlace} (${safeCity})` : '',
      ].filter(Boolean)
    )
  );

  if (candidateTitles.length > 0) {
    try {
      const apiUrl = `https://en.wikipedia.org/w/api.php?action=query&prop=extracts|info&exintro=0&exchars=1800&explaintext=1&inprop=url&redirects=1&titles=${encodeURIComponent(
        candidateTitles.join('|')
      )}&format=json`;
      const res = await fetch(apiUrl, {
        headers: { 'User-Agent': WIKI_USER_AGENT },
        signal: AbortSignal.timeout(2200),
      });
      if (res.ok) {
        const data = await res.json();
        const pages = Object.values(data?.query?.pages || {}) as any[];
        const page = pages.find(
          (item) =>
            item &&
            item.pageid &&
            item.extract &&
            String(item.extract).trim().length > 60 &&
            !String(item.title || '').includes('Disambiguation')
        );
        if (page) {
          return {
            extract: String(page.extract).trim(),
            title: page.title,
            url: page.fullurl || `https://en.wikipedia.org/wiki/${encodeURIComponent(page.title)}`,
          };
        }
      }
    } catch {
      // ignore
    }
  }

  // Secondary Wikipedia search fallback bounded by distinctive tokens + city
  try {
    const searchUrl = `https://en.wikipedia.org/w/api.php?action=query&list=search&srsearch=${encodeURIComponent(
      `${cleanPlace} ${safeCity}`.trim()
    )}&srlimit=3&format=json`;
    const sRes = await fetch(searchUrl, {
      headers: { 'User-Agent': WIKI_USER_AGENT },
      signal: AbortSignal.timeout(2200),
    });
    if (!sRes.ok) return null;
    const sData = await sRes.json();
    const hits = sData?.query?.search || [];
    const tokens = cleanPlace
      .toLowerCase()
      .split(/\s+/)
      .filter((w) => w.length > 2 && !['the', 'and', 'of', 'in', 'temple', 'park', 'lake', 'fort'].includes(w));

    for (const hit of hits) {
      const hitTitle = String(hit.title || '');
      const hitLower = hitTitle.toLowerCase();
      if (safeCity && hitLower === safeCity.toLowerCase() && cleanPlace.toLowerCase() !== safeCity.toLowerCase()) {
        continue;
      }
      if (tokens.length > 0 && !tokens.some((tok) => hitLower.includes(tok))) {
        continue;
      }
      const pUrl = `https://en.wikipedia.org/w/api.php?action=query&prop=extracts|info&exintro=0&exchars=1800&explaintext=1&inprop=url&redirects=1&titles=${encodeURIComponent(
        hitTitle
      )}&format=json`;
      const pRes = await fetch(pUrl, {
        headers: { 'User-Agent': WIKI_USER_AGENT },
        signal: AbortSignal.timeout(2000),
      });
      if (!pRes.ok) continue;
      const pData = await pRes.json();
      const page: any = Object.values(pData?.query?.pages || {})[0];
      if (page && page.pageid && page.extract && String(page.extract).trim().length > 60) {
        return {
          extract: String(page.extract).trim(),
          title: page.title,
          url: page.fullurl,
        };
      }
    }
  } catch {
    // ignore
  }

  return null;
}

