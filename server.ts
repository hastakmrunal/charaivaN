import express from 'express';
import fs from 'fs';
import path from 'path';
import dotenv from 'dotenv';
import { createServer as createViteServer } from 'vite';
import { GoogleGenAI, Type, Modality } from '@google/genai';
import {
  GMP_SOLUTION_ID,
  fetchGooglePlaceDetails,
  fetchWikipediaPlaceExtract,
  getRealNearbyPlaces,
  isGenericLocationLabel,
  isGmpQuotaError,
  mapLanguageToBcp47,
  resolveExactPlacePhotoWithGooglePlaces,
  resolveRepresentativeLocationPhoto,
  safeJsonParse,
  searchGooglePlacesText,
} from './server/realPlacesDiscovery';
import {
  analyzeDetailByDetail,
  generateDeepConversationTurn,
  generateDiscoverExplanation,
  generateExploreTopicExpansion,
  getDiscoverAutocompleteSuggestions,
  identifyPhotoCandidates,
  isGeminiQuotaExhaustedError,
  isTimeoutOrAbortError,
  resolveAuthenticSupplementaryScenes,
  sanitizeUserText,
  searchDiscoverCandidates,
} from './server/discoverEngine';
import {
  SupportValidationError,
  checkSupportRateLimitBeforeSend,
  recordSupportSubmissionOutcome,
  sendSupportFeedbackEmail,
  validateSupportFeedbackPayload,
  verifyFirebaseIdTokenEmail,
} from './server/supportMailer';
import { buildChatContextForGemini } from './server/aiChatContext';
import {
  getStatesForCountry,
  resolveLocationPlaceDetails,
  searchWorldwideSettlements,
} from './server/locationsService';
import { fetchGooglePlacePhotoMedia } from './server/placesPhotoProxy';
import { searchWorldwideCountries } from './src/data/isoCountries';

dotenv.config({ override: process.env.NODE_ENV !== 'production' });

const app = express();
const PORT = 3000;

// Increase payload limit for base64 image data from camera
app.use(express.json({ limit: '15mb' }));

// Lazy init Gemini AI
let genAIClient: GoogleGenAI | null = null;
function getGenAI(): GoogleGenAI {
  if (!genAIClient) {
    const apiKey = process.env.GEMINI_API_KEY;
    if (!apiKey) {
      console.warn('GEMINI_API_KEY environment variable is missing.');
    }
    genAIClient = new GoogleGenAI({
      apiKey: apiKey || '',
      httpOptions: {
        apiVersion: 'v1beta',
        headers: {
          'User-Agent': 'aistudio-build',
        },
      },
    });
  }
  return genAIClient;
}

// In-memory cache for location overviews and expensive AI queries to prevent redundant quota exhaustion
const queryCache = new Map<string, { data: any; expiresAt: number }>();
function getCached(key: string): any | null {
  const item = queryCache.get(key);
  if (item && item.expiresAt > Date.now()) {
    return item.data;
  }
  return null;
}
function setCached(key: string, data: any, ttlSeconds: number = 300) {
  queryCache.set(key, { data, expiresAt: Date.now() + ttlSeconds * 1000 });
}

// Resilient AI generation with automatic fallback across multiple model tiers for temporary 503 / 429 quota exhaustion
export async function generateContentWithFallback(ai: GoogleGenAI, params: any) {
  const fallbackModels = [
    'gemini-3.1-flash-lite',
    'gemini-4-hydrogen',
  ];
  const preferredModel = params.model || 'gemini-3.1-flash-lite';
  const modelsToTry = [preferredModel, ...fallbackModels.filter((m) => m !== preferredModel)];

  let lastError: any = null;
  for (let attempt = 0; attempt < modelsToTry.length; attempt++) {
    const modelName = modelsToTry[attempt];
    try {
      const res = await ai.models.generateContent({
        ...params,
        model: modelName,
      });
      return res;
    } catch (err: any) {
      lastError = err;
      const status = err?.status || err?.code || err?.response?.status;
      const msg = err?.message || String(err);
      const isRetryableModelOrQuota =
        status === 503 ||
        status === 429 ||
        status === 500 ||
        status === 404 ||
        msg.includes('503') ||
        msg.includes('429') ||
        msg.includes('404') ||
        msg.includes('NOT_FOUND') ||
        msg.includes('high demand') ||
        msg.includes('spikes in demand') ||
        msg.includes('UNAVAILABLE') ||
        msg.includes('RESOURCE_EXHAUSTED') ||
        msg.includes('Quota exceeded') ||
        msg.includes('quota');

      if (isRetryableModelOrQuota && attempt < modelsToTry.length - 1) {
        console.info(`[AI Tier Resilience] Model ${modelName} returned ${status || 'temporary load condition'}, switching to fallback tier ${modelsToTry[attempt + 1]}.`);
        await new Promise((r) => setTimeout(r, 150 * (attempt + 1)));
        continue;
      }
      if (!isRetryableModelOrQuota) {
        throw err;
      }
    }
  }
  throw lastError;
}

// Resilient AI streaming with fallback across fast tiers
export async function generateContentStreamWithFallback(ai: GoogleGenAI, params: any) {
  const fallbackModels = [
    'gemini-3.1-flash-lite',
    'gemini-4-hydrogen',
  ];
  const preferredModel = params.model || 'gemini-3.1-flash-lite';
  const modelsToTry = [preferredModel, ...fallbackModels.filter((m) => m !== preferredModel)];

  let lastError: any = null;
  for (let attempt = 0; attempt < modelsToTry.length; attempt++) {
    const modelName = modelsToTry[attempt];
    try {
      const stream = await ai.models.generateContentStream({
        ...params,
        model: modelName,
      });
      return stream;
    } catch (err: any) {
      lastError = err;
      const status = err?.status || err?.code || err?.response?.status;
      const msg = err?.message || String(err);
      const isRetryable =
        status === 503 ||
        status === 429 ||
        status === 500 ||
        status === 404 ||
        msg.includes('503') ||
        msg.includes('429') ||
        msg.includes('404') ||
        msg.includes('NOT_FOUND') ||
        msg.includes('UNAVAILABLE') ||
        msg.includes('RESOURCE_EXHAUSTED');

      if (isRetryable && attempt < modelsToTry.length - 1) {
        await new Promise((r) => setTimeout(r, 120 * (attempt + 1)));
        continue;
      }
      throw err;
    }
  }
  throw lastError;
}

// Extracts an evolving JSON string field value cleanly from a partially streamed JSON buffer
function extractPartialJsonStringField(partialJson: string, fieldName: string): string | null {
  const regex = new RegExp(`"${fieldName}"\\s*:\\s*"((?:\\\\.|[^"\\\\])*)`, 's');
  const match = partialJson.match(regex);
  if (!match) return null;
  return match[1]
    .replace(/\\n/g, '\n')
    .replace(/\\r/g, '')
    .replace(/\\t/g, ' ')
    .replace(/\\"/g, '"')
    .replace(/\\\\/g, '\\');
}

// Health check
app.get('/api/health', (req, res) => {
  res.json({
    status: 'ok',
    service: 'Charaiva Tourist Guide API',
    mapsConfigured: Boolean(process.env.GOOGLE_MAPS_PLATFORM_KEY),
  });
});

// Helper to construct structured topic and persona guidance
function buildTopicGuidance(topics?: Record<string, boolean>, persona: string = 'warm_female', gender: string = 'female'): string {
  const selectedList: string[] = [];
  if (!topics || Object.values(topics).every(v => v === false)) {
    selectedList.push(
      'Historical context & origin dates',
      'Geographical setting & orientation',
      'Architectural style & engineering highlights',
      'Cultural & spiritual legends',
      'Fascinating trivia & photography tips'
    );
  } else {
    if (topics.historical) selectedList.push('Historical context (exact founding dates, dynasties, rulers/patrons, eras, archaeological rediscovery)');
    if (topics.geographical) selectedList.push('Geographical setting (exact terrain, altitude, river basins, surrounding landscape, strategic coordinates)');
    if (topics.political) selectedList.push('Political significance (treaties, royal court politics, imperial capitals, power struggles, sovereign decrees)');
    if (topics.architectural) selectedList.push('Architectural & engineering feats (stone masonry techniques, vaulted ceilings, load-bearing domes, acoustic tricks, materials)');
    if (topics.culturalMythology) selectedList.push('Cultural, spiritual & mythological folklore (sacred symbolism, deities, epic rituals, devotional heritage)');
    if (topics.culinary) selectedList.push('Culinary & gastronomy heritage (royal feast recipes, street food culture, local spices and culinary traditions)');
    if (topics.economic) selectedList.push('Economic & modern day impact (ancient trade routes, silk road commerce, modern conservation and local economy)');
    if (topics.ecological) selectedList.push('Ecology, flora & fauna (indigenous trees, sacred groves, surrounding wildlife and ecological microclimate)');
    if (topics.photography) selectedList.push('Photography & secret vantage spots (golden hour angles, hidden uncrowded alcoves, reflections, best lighting)');
    if (topics.mysteries) selectedList.push('Curiosities, riddles & hidden mysteries (secret passages, unsolved historical enigmas, legends, local lore)');
  }

  const voiceLabel = gender === 'male' ? 'male' : 'female';
  let personaStyle = `Speak as a warm, charismatic, articulate, and engaging ${voiceLabel} tour guide with welcoming spoken cadence, personal anecdotes, and vivid storytelling.`;
  if (persona === 'scholarly') {
    personaStyle = 'Speak with scholarly rigor, academic precision, chronological accuracy, and authoritative architectural and historical citations.';
  } else if (persona === 'adventurous') {
    personaStyle = 'Speak as an adventurous explorer and folklore guide, weaving dramatic tension, mysteries, and vivid epic tales.';
  } else if (persona === 'concise') {
    personaStyle = 'Speak with crisp, punchy, bulleted clarity designed for fast walking audio tours.';
  }

  return `
GUIDE PERSONA & VOICE TONING:
${personaStyle} (Voice Character: ${gender === 'male' ? 'Male Guide - Clear, Rich & Natural' : 'Female Guide - Warm & Natural'})

MANDATORY SPEECH CATEGORY REQUIREMENTS:
Your audio narration and explanation MUST explicitly cover and weave in the following selected dimensions:
${selectedList.map((item, i) => `${i + 1}. ${item}`).join('\n')}
`;
}

// Supplementary scene media is resolved dynamically per subject from Wikimedia Commons / Wikipedia (no generic Unsplash stock photos).

const MAX_INLINE_IMAGE_BYTES = 12 * 1024 * 1024;

function isPrivateOrLoopbackHost(hostname: string): boolean {
  const h = hostname.toLowerCase();
  if (
    h === 'localhost' ||
    h === '0.0.0.0' ||
    h === '::1' ||
    h === '[::1]' ||
    h.endsWith('.local') ||
    h.endsWith('.internal')
  ) {
    return true;
  }
  const ipv4Match = h.match(/^(\d{1,3})\.(\d{1,3})\.(\d{1,3})\.(\d{1,3})$/);
  if (ipv4Match) {
    const [, a, b] = ipv4Match.map(Number);
    if (a === 10 || a === 127 || a === 0) return true;
    if (a === 169 && b === 254) return true;
    if (a === 192 && b === 168) return true;
    if (a === 172 && b >= 16 && b <= 31) return true;
  }
  return false;
}

function normalizeImageMimeType(rawMime?: string | null): string {
  const cleaned = (rawMime || '').split(';')[0].trim().toLowerCase();
  if (!cleaned.startsWith('image/')) return 'image/jpeg';
  if (cleaned === 'image/jpg') return 'image/jpeg';
  return cleaned;
}

/**
 * Normalizes a data URI, remote HTTP(S) image URL, or raw base64 string into a valid Gemini inlineData part.
 * Prevents TYPE_BYTES base64 decoding errors when image URLs or WebP/PNG data URLs are submitted.
 */
async function resolveImageToInlinePart(rawImg: string): Promise<{ mimeType: string; data: string }> {
  const trimmed = (rawImg || '').trim();
  if (!trimmed) {
    const err: any = new Error('Image data is required');
    err.status = 400;
    throw err;
  }

  // 1. Standard Data URLs (e.g. data:image/webp;base64,..., data:image/jpeg;base64,...)
  if (trimmed.startsWith('data:')) {
    const match = trimmed.match(/^data:([^;,\s]+)(?:;[^,]*)?;base64,(.+)$/s);
    if (!match) {
      const err: any = new Error('Invalid base64 data URI format for image');
      err.status = 400;
      throw err;
    }
    const mimeType = normalizeImageMimeType(match[1]);
    const cleanBase64 = match[2].replace(/\s+/g, '');
    if (!cleanBase64 || !/^[A-Za-z0-9+/]+={0,2}$/.test(cleanBase64)) {
      const err: any = new Error('Invalid base64 image payload');
      err.status = 400;
      throw err;
    }
    return { mimeType, data: cleanBase64 };
  }

  // 2. Remote HTTP(S) image URLs (e.g., 1-tap famous sight presets or remote URLs)
  if (/^https?:\/\//i.test(trimmed)) {
    let parsedUrl: URL;
    try {
      parsedUrl = new URL(trimmed);
    } catch {
      const err: any = new Error('Invalid image URL provided');
      err.status = 400;
      throw err;
    }
    if (isPrivateOrLoopbackHost(parsedUrl.hostname)) {
      const err: any = new Error('Blocked unsafe private or loopback image URL');
      err.status = 400;
      throw err;
    }

    const imgRes = await fetch(parsedUrl.toString(), {
      headers: {
        'User-Agent': 'CharaivaTravelGuide/1.0 (https://charaiva.app)',
        Accept: 'image/webp,image/jpeg,image/png,image/*;q=0.8',
      },
      redirect: 'follow',
      signal: AbortSignal.timeout(10000),
    });

    if (!imgRes.ok) {
      const err: any = new Error(`Failed to fetch remote image URL (HTTP ${imgRes.status})`);
      err.status = 400;
      throw err;
    }

    if (imgRes.url) {
      try {
        const finalUrl = new URL(imgRes.url);
        if (isPrivateOrLoopbackHost(finalUrl.hostname)) {
          const err: any = new Error('Blocked unsafe redirected image URL');
          err.status = 400;
          throw err;
        }
      } catch (e: any) {
        if (e?.status === 400) throw e;
      }
    }

    const rawContentType = (imgRes.headers.get('content-type') || '').split(';')[0].trim().toLowerCase();
    if (
      rawContentType &&
      !rawContentType.startsWith('image/') &&
      rawContentType !== 'application/octet-stream' &&
      rawContentType !== 'binary/octet-stream'
    ) {
      const err: any = new Error(`Remote URL did not return an image (received ${rawContentType})`);
      err.status = 400;
      throw err;
    }

    const arrayBuffer = await imgRes.arrayBuffer();
    if (arrayBuffer.byteLength === 0 || arrayBuffer.byteLength > MAX_INLINE_IMAGE_BYTES) {
      const err: any = new Error('Fetched image is empty or exceeds maximum 12MB size limit');
      err.status = 400;
      throw err;
    }

    const buffer = Buffer.from(arrayBuffer);
    let mimeType = normalizeImageMimeType(rawContentType);
    if (!rawContentType.startsWith('image/')) {
      if (buffer.length >= 4 && buffer[0] === 0x89 && buffer[1] === 0x50 && buffer[2] === 0x4e && buffer[3] === 0x47) {
        mimeType = 'image/png';
      } else if (buffer.length >= 12 && buffer.subarray(0, 4).toString('ascii') === 'RIFF' && buffer.subarray(8, 12).toString('ascii') === 'WEBP') {
        mimeType = 'image/webp';
      } else {
        mimeType = 'image/jpeg';
      }
    }

    return {
      mimeType,
      data: buffer.toString('base64'),
    };
  }

  // 3. Raw base64 strings (validate strictly so non-base64 strings never reach Gemini inlineData)
  const stripped = trimmed.replace(/\s+/g, '');
  if (stripped.length < 32 || !/^[A-Za-z0-9+/]+={0,2}$/.test(stripped)) {
    const err: any = new Error('Image payload must be a valid base64 image, data URI, or HTTPS image URL');
    err.status = 400;
    throw err;
  }

  return {
    mimeType: 'image/jpeg',
    data: stripped,
  };
}

function haversineDistanceKmServer(lat1: number, lon1: number, lat2: number, lon2: number): number {
  const R = 6371;
  const dLat = ((lat2 - lat1) * Math.PI) / 180;
  const dLon = ((lon2 - lon1) * Math.PI) / 180;
  const a =
    Math.sin(dLat / 2) * Math.sin(dLat / 2) +
    Math.cos((lat1 * Math.PI) / 180) * Math.cos((lat2 * Math.PI) / 180) * Math.sin(dLon / 2) * Math.sin(dLon / 2);
  return R * 2 * Math.atan2(Math.sqrt(a), Math.sqrt(1 - a));
}

function normalizeVisionLocationConfidence(raw: any): 'confirmed_local' | 'confirmed_nonlocal' | 'object_or_no_location' | 'uncertain' {
  const v = String(raw || '').toLowerCase().trim();
  if (v === 'confirmed_local') return 'confirmed_local';
  if (v === 'confirmed_nonlocal') return 'confirmed_nonlocal';
  if (v === 'object_or_no_location') return 'object_or_no_location';
  return 'uncertain';
}

async function resolveRecognizedLandmarkLocation(
  parsedResult: any,
  effectiveCoords?: { latitude?: number; longitude?: number; city?: string; country?: string } | null
): Promise<{
  locationName: string;
  locationConfidence: 'confirmed_local' | 'confirmed_nonlocal' | 'object_or_no_location' | 'uncertain';
  locationEvidence: string;
  resolvedCoords: { latitude: number; longitude: number; city?: string; country?: string } | null;
}> {
  const confidenceFlag = normalizeVisionLocationConfidence(parsedResult?.locationConfidence);
  const category = String(parsedResult?.category || '').toLowerCase();
  const title = String(parsedResult?.title || '').trim();
  const parsedLocName = String(parsedResult?.locationName || '').trim();
  const subjectCity = String(parsedResult?.subjectCity || '').trim();
  const subjectCountry = String(parsedResult?.subjectCountry || '').trim();
  const gpsCity = String(effectiveCoords?.city || '').trim();

  const isEverydayObject =
    confidenceFlag === 'object_or_no_location' ||
    (['object', 'food', 'plant', 'animal'].includes(category) && !subjectCity && !subjectCountry);

  if (isEverydayObject) {
    const safeObjLocation =
      parsedLocName && (!gpsCity || !parsedLocName.toLowerCase().includes(gpsCity.toLowerCase()))
        ? parsedLocName
        : 'Everyday Object · Visual Identification';
    return {
      locationName: safeObjLocation,
      locationConfidence: 'object_or_no_location',
      locationEvidence:
        String(parsedResult?.locationEvidence || '').trim() ||
        'Identified from visual design and material traits (not tied to a fixed monument location).',
      resolvedCoords: null,
    };
  }

  const combinedLocationLabel =
    parsedLocName ||
    [subjectCity, subjectCountry].filter(Boolean).join(', ') ||
    'Location requires visual verification';

  const gpsMatchesSubject =
    Boolean(gpsCity) &&
    (combinedLocationLabel.toLowerCase().includes(gpsCity.toLowerCase()) ||
      subjectCity.toLowerCase() === gpsCity.toLowerCase());

  if (
    confidenceFlag === 'confirmed_local' &&
    gpsMatchesSubject &&
    typeof effectiveCoords?.latitude === 'number' &&
    typeof effectiveCoords?.longitude === 'number'
  ) {
    return {
      locationName: combinedLocationLabel,
      locationConfidence: 'confirmed_local',
      locationEvidence:
        String(parsedResult?.locationEvidence || '').trim() ||
        `Visually matches this site in ${gpsCity}.`,
      resolvedCoords: {
        latitude: effectiveCoords.latitude,
        longitude: effectiveCoords.longitude,
        city: subjectCity || effectiveCoords.city,
        country: subjectCountry || effectiveCoords.country,
      },
    };
  }

  // Query authoritative global sources (Wikipedia coordinates -> Google Places) for the recognized subject
  let trueCoords: { latitude: number; longitude: number; city?: string; country?: string } | null = null;
  if (title) {
    try {
      const searchQ = [title, subjectCity, subjectCountry].filter(Boolean).join(' ');
      const wikiCoordUrl = `https://en.wikipedia.org/w/api.php?action=query&generator=search&gsrsearch=${encodeURIComponent(
        searchQ
      )}&gsrlimit=2&prop=coordinates|description&redirects=1&format=json`;
      const wRes = await fetch(wikiCoordUrl, {
        headers: { 'User-Agent': 'CharaivaTravelGuide/1.0 (https://charaiva.app)' },
        signal: AbortSignal.timeout(1800),
      });
      if (wRes.ok) {
        const wData = await wRes.json();
        const pages = Object.values(wData?.query?.pages || {}) as any[];
        pages.sort((a, b) => (a.index ?? 99) - (b.index ?? 99));
        for (const p of pages) {
          const c0 = Array.isArray(p?.coordinates) ? p.coordinates[0] : null;
          if (c0 && typeof c0.lat === 'number' && typeof c0.lon === 'number') {
            trueCoords = {
              latitude: c0.lat,
              longitude: c0.lon,
              city: subjectCity || undefined,
              country: subjectCountry || undefined,
            };
            break;
          }
        }
      }
    } catch {
      // ignore timeout
    }

    if (!trueCoords && process.env.GOOGLE_MAPS_PLATFORM_KEY) {
      try {
        const gp = await Promise.race([
          searchGooglePlacesText({
            textQuery: [title, subjectCity, subjectCountry].filter(Boolean).join(' '),
            apiKey: process.env.GOOGLE_MAPS_PLATFORM_KEY,
          }),
          new Promise<{ places: any[] }>((r) => setTimeout(() => r({ places: [] }), 1600)),
        ]);
        const p0 = gp.places?.[0];
        if (p0 && typeof p0.latitude === 'number' && typeof p0.longitude === 'number') {
          trueCoords = {
            latitude: p0.latitude,
            longitude: p0.longitude,
            city: subjectCity || undefined,
            country: subjectCountry || undefined,
          };
        }
      } catch {
        // ignore
      }
    }
  }

  // Only allow user's GPS coords if explicitly confirmed local AND within 80km of the resolved subject coords
  if (
    trueCoords &&
    effectiveCoords &&
    typeof effectiveCoords.latitude === 'number' &&
    typeof effectiveCoords.longitude === 'number'
  ) {
    const km = haversineDistanceKmServer(
      trueCoords.latitude,
      trueCoords.longitude,
      effectiveCoords.latitude,
      effectiveCoords.longitude
    );
    if (km <= 80 && confidenceFlag === 'confirmed_local') {
      return {
        locationName: combinedLocationLabel,
        locationConfidence: 'confirmed_local',
        locationEvidence:
          String(parsedResult?.locationEvidence || '').trim() ||
          `Confirmed within ${Math.round(km)} km of your current GPS location.`,
        resolvedCoords: trueCoords,
      };
    }
  }

  const finalConfidence =
    confidenceFlag === 'confirmed_local' && !gpsMatchesSubject
      ? 'confirmed_nonlocal'
      : confidenceFlag === 'confirmed_local' && !trueCoords
      ? 'uncertain'
      : confidenceFlag;

  return {
    locationName: combinedLocationLabel,
    locationConfidence: finalConfidence,
    locationEvidence:
      String(parsedResult?.locationEvidence || '').trim() ||
      (finalConfidence === 'confirmed_nonlocal'
        ? 'Identified from landmark visual architecture independently of device GPS.'
        : 'Identified primarily from visual evidence; confirm exact site if multiple similar monuments exist.'),
    resolvedCoords: trueCoords,
  };
}

// Helper to handle landmark recognition from either endpoint
async function handleLandmarkRecognition(req: express.Request, res: express.Response) {
  try {
    const {
      image,
      imageBase64,
      imageUrl,
      location,
      coords,
      language = 'English',
      history = [],
      userPrompt,
      topics,
      persona = 'warm_female',
      voiceGender = 'female',
    } = req.body;

    const rawImg = image || imageBase64 || imageUrl;
    if (!rawImg) {
      return res.status(400).json({ error: 'Image data is required' });
    }

    const effectiveCoords = location || coords;

    // Resolve data URI, remote image URL, or validated raw base64 to Gemini inlineData
    const inlineImage = await resolveImageToInlinePart(rawImg);

    const ai = getGenAI();

    // Prepare system instructions for AI Tourist Guide
    const historyContext = history.length > 0
      ? `CRITICAL MEMORY DIRECTIVE: The user has ALREADY visited and received explanations for these topics during this session: [${history.join(', ')}]. DO NOT repeat basic introductory information or facts about these already explained items. Instead, provide NEW, unique, deep-dive architectural nuances, local folklore, uncrowded photo spots, or surrounding secrets.`
      : `Provide a captivating, accurate introductory explanation as a personal local guide.`;

    const topicDirectives = buildTopicGuidance(topics, persona, voiceGender);

    const gpsContextLine = effectiveCoords
      ? `Optional weak background GPS hint (CONTEXT ONLY, NEVER PROOF — image may be an uploaded photo from anywhere in the world or an indoor object): ${effectiveCoords.city ? `${effectiveCoords.city}${effectiveCoords.country ? `, ${effectiveCoords.country}` : ''} ` : ''}(Lat ${effectiveCoords.latitude}, Lng ${effectiveCoords.longitude})`
      : 'Device GPS location: Unavailable';

    const promptText = `You are Charaiva, an elite AI multilingual universal visual guide, expert historian, and object identifier.
${gpsContextLine}.
${userPrompt ? `User specifically asked: "${userPrompt}"` : ''}

CRITICAL LOCATION & TRUTHFULNESS RULES (MANDATORY):
1. Identify the image VISUALLY FIRST across the entire world — NEVER force-match an uploaded photo to the device's GPS city! For example, if the device GPS is Pune/India and the photo shows the Eiffel Tower, Paris — identify Eiffel Tower, Paris, France with locationConfidence = "confirmed_nonlocal".
2. Use device GPS ONLY as secondary context if a regional site is ambiguous AND visibly plausible there. Never overwrite a recognizable non-local monument with the user's current city.
3. For everyday indoor/portable objects (chair, mug, book, bottle, gadget) with no landmark setting, set locationConfidence = "object_or_no_location" and set locationName to the object/design context (never user's city).
4. If visual features or inscription are unclear/weathered/ambiguous between places, set locationConfidence = "uncertain" and explain what cannot be confirmed in "locationEvidence".
5. NEVER invent dates, builders, prices, opening hours, coordinates, or confidence percentages.

Language Requirement: Produce ALL text response fields strictly in the language: "${language}".

${historyContext}

${topicDirectives}

UNIVERSAL RECOGNITION DIRECTIVE (MANDATORY):
- The image may contain ANY object:
  1. UNIQUE CULTURAL / HISTORICAL / MONUMENTAL SIGHTS (e.g. Eiffel Tower, singing pillars in Madurai/Hampi, ancient gopurams, stonework, sculptures, fort walls): Provide exhaustive, awe-inspiring historical, architectural, and cultural explanations with truthful sourcing.
  2. EVERYDAY, CONTEMPORARY, OR COMMON OBJECTS (e.g. chair, table, water bottle, book, cup, fan, plant, tool):
     - Treat everyday objects with engaging storytelling covering design style, materials, practical purpose, origin history, and fascinating facts.

Your task:
1. Detect any visible text, brand logos, model markings, inscriptions, or plaques using OCR and transcribe them into "ocrDetectedText" (only legible text).
2. Accurately identify the item shown worldwide.
3. Determine category: monument, temple, fort, museum, landscape, food, plant, object, building, or animal.
4. Set "confidence" realistically (e.g. 0.94–0.99 for iconic landmarks, 0.55–0.77 if weathered/ambiguous).
5. Populate "locationName", "subjectCity", "subjectCountry", "locationConfidence" ('confirmed_local' | 'confirmed_nonlocal' | 'object_or_no_location' | 'uncertain'), and "locationEvidence".
6. Provide a lively, spoken-style narration in "${language}", a 2-sentence summary, 4 verified keyFacts, 3 architecturalHighlights, 3 suggestedQuestions, historicalPeriod, 3-4 supplementaryScenes, and 4 tags.`;

    const response = await generateContentWithFallback(ai, {
      model: 'gemini-4-hydrogen',
      contents: {
        parts: [
          {
            inlineData: {
              mimeType: inlineImage.mimeType,
              data: inlineImage.data,
            },
          },
          { text: promptText },
        ],
      },
      config: {
        responseMimeType: 'application/json',
        responseSchema: {
          type: Type.OBJECT,
          properties: {
            title: { type: Type.STRING, description: 'Title of the identified subject' },
            nativeTitle: { type: Type.STRING, description: 'Title in local native script if applicable' },
            category: {
              type: Type.STRING,
              description: 'One of: monument, temple, fort, museum, landscape, food, plant, object, building, animal',
            },
            confidence: { type: Type.NUMBER, description: 'Confidence between 0 and 1' },
            locationName: { type: Type.STRING, description: 'True location of the pictured subject (or design origin for everyday object)' },
            subjectCity: { type: Type.STRING, description: 'True city of the pictured monument/site (empty if everyday object or unknown)' },
            subjectCountry: { type: Type.STRING, description: 'True country of the pictured monument/site (empty if everyday object or unknown)' },
            locationConfidence: {
              type: Type.STRING,
              description: 'One of: confirmed_local, confirmed_nonlocal, object_or_no_location, uncertain',
            },
            locationEvidence: { type: Type.STRING, description: '1 sentence explaining the visual/contextual basis for the resolved location' },
            historicalPeriod: { type: Type.STRING, description: 'Era, century, or origin' },
            ocrDetectedText: { type: Type.STRING, description: 'Any OCR text detected on plaques, signs, or labels' },
            summary: { type: Type.STRING, description: '2 sentence quick summary' },
            narration: { type: Type.STRING, description: 'Audio narration script in target language' },
            keyFacts: {
              type: Type.ARRAY,
              items: { type: Type.STRING },
              description: '4 distinct bullet point facts',
            },
            architecturalHighlights: {
              type: Type.ARRAY,
              items: { type: Type.STRING },
              description: '3 visual or architectural highlights',
            },
            suggestedQuestions: {
              type: Type.ARRAY,
              items: { type: Type.STRING },
              description: '3 follow-up questions',
            },
            supplementaryScenes: {
              type: Type.ARRAY,
              items: {
                type: Type.OBJECT,
                properties: {
                  title: { type: Type.STRING },
                  caption: { type: Type.STRING },
                  type: { type: Type.STRING, description: 'historical, interior, aerial, night, detail, or art' },
                },
                required: ['title', 'caption', 'type'],
              },
              description: '3-4 contextual scenes or complementary images',
            },
            culturalSignificance: { type: Type.STRING, description: 'Cultural importance or UNESCO status' },
            tags: {
              type: Type.ARRAY,
              items: { type: Type.STRING },
              description: '4 keywords or tags',
            },
          },
          required: ['title', 'category', 'confidence', 'locationName', 'locationConfidence', 'summary', 'narration', 'keyFacts', 'suggestedQuestions', 'tags'],
        },
      },
    });

    const jsonText = response.text || '{}';
    const parsedResult = safeJsonParse<any>(jsonText, {});

    const [supplementaryImages, verifiedLoc] = await Promise.all([
      resolveAuthenticSupplementaryScenes({
        title: parsedResult.title || '',
        locationName: parsedResult.locationName,
        scenes: Array.isArray(parsedResult.supplementaryScenes) ? parsedResult.supplementaryScenes : [],
        gmpApiKey: process.env.GOOGLE_MAPS_PLATFORM_KEY || '',
      }),
      resolveRecognizedLandmarkLocation(parsedResult, effectiveCoords),
    ]);

    const result = {
      id: `scan-${Date.now()}`,
      ...parsedResult,
      locationName: verifiedLoc.locationName,
      locationConfidence: verifiedLoc.locationConfidence,
      locationEvidence: verifiedLoc.locationEvidence,
      supplementaryImages,
      timestamp: new Date().toISOString(),
      audioDurationSeconds: Math.max(20, Math.round((parsedResult.narration?.length || 200) / 12)),
      coords: verifiedLoc.resolvedCoords || undefined,
      batchStatus: {
        batch1Ready: true,
        batch2Ready: true,
        batch3Ready: true,
        stage: 'complete',
        timestamp: Date.now(),
      },
    };

    res.json({ success: true, landmark: result });
  } catch (error: any) {
    console.error('Error in landmark recognition:', error);
    const statusCode = error?.status === 400 ? 400 : 500;
    res.status(statusCode).json({
      error: statusCode === 400 ? error.message : 'Failed to identify landmark from camera image',
      details: error.message || String(error),
    });
  }
}

// Progressive Batch-Streaming Landmark Recognition Endpoint (Server-Sent Events)
async function handleLandmarkRecognitionStream(req: express.Request, res: express.Response) {
  res.setHeader('Content-Type', 'text/event-stream');
  res.setHeader('Cache-Control', 'no-cache, no-transform');
  res.setHeader('Connection', 'keep-alive');
  res.flushHeaders?.();

  const sendEvent = (type: string, data: any) => {
    if (res.writableEnded) return;
    try {
      res.write(`data: ${JSON.stringify({ type, data })}\n\n`);
    } catch (e) {
      console.warn('Error writing SSE event:', e);
    }
  };

  try {
    const {
      image,
      imageBase64,
      imageUrl,
      location,
      coords,
      language = 'English',
      history = [],
      userPrompt,
      topics,
      persona = 'warm_female',
      voiceGender = 'female',
    } = req.body;

    const rawImg = image || imageBase64 || imageUrl;
    if (!rawImg) {
      sendEvent('error', { message: 'Image data is required' });
      return;
    }

    const effectiveCoords = location || coords;
    const scanId = `scan-${Date.now()}`;

    // -------------------------------------------------------------
    // BATCH 1 (Immediate / < 100ms): Neutral structural state (NEVER assume user GPS is the photo's city!)
    // -------------------------------------------------------------
    const batch1Data = {
      id: scanId,
      title: userPrompt ? `Exploring "${userPrompt}"` : 'Analyzing Visual Clues...',
      category: 'monument' as const,
      confidence: 0.9,
      locationName: 'Identifying location from visual evidence...',
      summary: 'Analyzing captured sight and historical context...',
      narration: '',
      keyFacts: [],
      tags: ['heritage', 'sightseeing'],
      timestamp: new Date().toISOString(),
      coords: null,
      batchStatus: {
        batch1Ready: true,
        batch2Ready: false,
        batch3Ready: false,
        stage: 'batch1_structural' as const,
        timestamp: Date.now(),
      },
    };

    sendEvent('batch1', batch1Data);

    // -------------------------------------------------------------
    // BATCH 2 (Fast Stream / < 600ms): Resolve image bytes + Core text, narration & OCR
    // -------------------------------------------------------------
    const inlineImage = await resolveImageToInlinePart(rawImg);
    const ai = getGenAI();
    const historyContext = history.length > 0
      ? `CRITICAL MEMORY DIRECTIVE: The user has ALREADY visited and received explanations for these topics: [${history.join(', ')}]. DO NOT repeat basic introductory information. Provide NEW deep-dive folklore, architecture, and photography insights.`
      : `Provide a captivating, accurate introductory explanation as a personal local guide.`;

    const topicDirectives = buildTopicGuidance(topics, persona, voiceGender);
    const gpsContextLine = effectiveCoords
      ? `Optional weak background GPS hint (CONTEXT ONLY, NEVER PROOF — image may be an uploaded photo from anywhere worldwide or an indoor object): ${effectiveCoords.city ? `${effectiveCoords.city}${effectiveCoords.country ? `, ${effectiveCoords.country}` : ''} ` : ''}(Lat ${effectiveCoords.latitude}, Lng ${effectiveCoords.longitude})`
      : 'Device GPS location: Unavailable';

    const promptText = `You are Charaiva, an elite AI multilingual universal visual guide, expert historian, and object identifier.
${gpsContextLine}.
${userPrompt ? `User specifically asked: "${userPrompt}"` : ''}

CRITICAL LOCATION & TRUTHFULNESS RULES:
- Identify the image VISUALLY FIRST across the entire world. NEVER stamp the user's GPS city onto an international monument (e.g. Eiffel Tower uploaded in Pune = Paris, France; locationConfidence = "confirmed_nonlocal") or onto an everyday indoor object (locationConfidence = "object_or_no_location").
- Use device GPS ONLY when a local regional site is genuinely ambiguous and plausible at those coordinates.
- If unclear or weathered, set locationConfidence = "uncertain" and explain why in "locationEvidence".

Language Requirement: Produce ALL text response fields strictly in the language: "${language}".

${historyContext}

${topicDirectives}

Your task:
1. Detect any visible text, brand logos, markings, or inscriptions using OCR and transcribe only legible characters into "ocrDetectedText".
2. Accurately identify the item shown: cultural/historical sights, statues, architecture, food, plant, or everyday common objects.
3. Determine category: monument, temple, fort, museum, landscape, food, plant, object, building, or animal.
4. Set realistic "confidence" between 0.55 and 0.99.
5. Output "locationName", "subjectCity", "subjectCountry", "locationConfidence" ('confirmed_local' | 'confirmed_nonlocal' | 'object_or_no_location' | 'uncertain'), and "locationEvidence".
6. Provide narration in "${language}", 2-sentence summary, 4 keyFacts, 3 architecturalHighlights, 3 suggestedQuestions, historicalPeriod, 3-4 supplementaryScenes, and 4 tags.`;

    const stream = await generateContentStreamWithFallback(ai, {
      model: 'gemini-3.1-flash-lite',
      contents: {
        parts: [
          {
            inlineData: {
              mimeType: inlineImage.mimeType,
              data: inlineImage.data,
            },
          },
          { text: promptText },
        ],
      },
      config: {
        responseMimeType: 'application/json',
        responseSchema: {
          type: Type.OBJECT,
          properties: {
            title: { type: Type.STRING, description: 'Title of the identified subject' },
            nativeTitle: { type: Type.STRING, description: 'Title in local native script' },
            category: {
              type: Type.STRING,
              description: 'One of: monument, temple, fort, museum, landscape, food, plant, object, building, animal',
            },
            confidence: { type: Type.NUMBER, description: 'Confidence between 0 and 1' },
            locationName: { type: Type.STRING, description: 'True verified location or object context' },
            subjectCity: { type: Type.STRING, description: 'True city of the pictured monument/site' },
            subjectCountry: { type: Type.STRING, description: 'True country of the pictured monument/site' },
            locationConfidence: {
              type: Type.STRING,
              description: 'confirmed_local, confirmed_nonlocal, object_or_no_location, or uncertain',
            },
            locationEvidence: { type: Type.STRING, description: 'Visual/contextual basis for location' },
            historicalPeriod: { type: Type.STRING, description: 'Era, century, or origin' },
            ocrDetectedText: { type: Type.STRING, description: 'Any OCR text detected' },
            summary: { type: Type.STRING, description: '2 sentence quick summary' },
            narration: { type: Type.STRING, description: 'Audio narration script in target language' },
            keyFacts: {
              type: Type.ARRAY,
              items: { type: Type.STRING },
              description: '4 distinct bullet point facts',
            },
            architecturalHighlights: {
              type: Type.ARRAY,
              items: { type: Type.STRING },
              description: '3 visual highlights',
            },
            suggestedQuestions: {
              type: Type.ARRAY,
              items: { type: Type.STRING },
              description: '3 follow-up questions',
            },
            supplementaryScenes: {
              type: Type.ARRAY,
              items: {
                type: Type.OBJECT,
                properties: {
                  title: { type: Type.STRING },
                  caption: { type: Type.STRING },
                  type: { type: Type.STRING, description: 'historical, interior, aerial, night, detail, or art' },
                },
                required: ['title', 'caption', 'type'],
              },
            },
            culturalSignificance: { type: Type.STRING },
            tags: { type: Type.ARRAY, items: { type: Type.STRING } },
          },
          required: ['title', 'category', 'confidence', 'locationName', 'locationConfidence', 'summary', 'narration', 'keyFacts', 'suggestedQuestions', 'tags'],
        },
      },
    });

    let accumulatedJson = '';
    let lastDeltaSentAt = 0;
    let lastSentTitle = '';
    let lastSentSummary = '';
    let lastSentNarrationLen = 0;

    for await (const chunk of stream) {
      const piece = chunk.text || '';
      if (!piece) continue;
      accumulatedJson += piece;

      const now = Date.now();
      if (now - lastDeltaSentAt >= 70) {
        const partialTitle = extractPartialJsonStringField(accumulatedJson, 'title');
        const partialLocation = extractPartialJsonStringField(accumulatedJson, 'locationName');
        const partialSummary = extractPartialJsonStringField(accumulatedJson, 'summary');
        const partialNarration = extractPartialJsonStringField(accumulatedJson, 'narration');

        if (
          (partialTitle && partialTitle !== lastSentTitle) ||
          (partialSummary && partialSummary !== lastSentSummary) ||
          (partialNarration && partialNarration.length > lastSentNarrationLen + 8)
        ) {
          if (partialTitle) lastSentTitle = partialTitle;
          if (partialSummary) lastSentSummary = partialSummary;
          if (partialNarration) lastSentNarrationLen = partialNarration.length;
          lastDeltaSentAt = now;
          sendEvent('batch2_delta', {
            ...(partialTitle ? { title: partialTitle } : {}),
            ...(partialLocation ? { locationName: partialLocation } : {}),
            ...(partialSummary ? { summary: partialSummary } : {}),
            ...(partialNarration ? { narration: partialNarration } : {}),
          });
        }
      }
    }

    const jsonText = accumulatedJson || '{}';
    const parsedResult = safeJsonParse<any>(jsonText, {});
    const prelimLocConfidence = normalizeVisionLocationConfidence(parsedResult.locationConfidence);

    const batch2Data = {
      title: parsedResult.title || 'Identified Subject',
      nativeTitle: parsedResult.nativeTitle,
      category: parsedResult.category || 'monument',
      confidence: parsedResult.confidence || 0.9,
      locationName:
        parsedResult.locationName ||
        (prelimLocConfidence === 'object_or_no_location' ? 'Everyday Object · Visual Identification' : 'Visual Identification'),
      locationConfidence: prelimLocConfidence,
      locationEvidence: parsedResult.locationEvidence,
      historicalPeriod: parsedResult.historicalPeriod,
      ocrDetectedText: parsedResult.ocrDetectedText,
      summary: parsedResult.summary || 'Subject analyzed from visual evidence.',
      narration: parsedResult.narration || parsedResult.summary || 'This remarkable sight reflects rich craftsmanship and heritage.',
      keyFacts: parsedResult.keyFacts || [],
      architecturalHighlights: parsedResult.architecturalHighlights || [],
      suggestedQuestions: parsedResult.suggestedQuestions || [],
      culturalSignificance: parsedResult.culturalSignificance,
      tags: parsedResult.tags || [],
      coords: null,
      batchStatus: {
        batch1Ready: true,
        batch2Ready: true,
        batch3Ready: false,
        stage: 'batch2_core_text' as const,
        timestamp: Date.now(),
      },
    };

    sendEvent('batch2', batch2Data);

    // -------------------------------------------------------------
    // BATCH 3 (Deferred Async): Resolve authentic photos + verified subject coordinates
    // -------------------------------------------------------------
    const [supplementaryImages, verifiedLoc] = await Promise.all([
      resolveAuthenticSupplementaryScenes({
        title: parsedResult.title || '',
        locationName: parsedResult.locationName,
        scenes: Array.isArray(parsedResult.supplementaryScenes) ? parsedResult.supplementaryScenes : [],
        gmpApiKey: process.env.GOOGLE_MAPS_PLATFORM_KEY || '',
      }),
      resolveRecognizedLandmarkLocation(parsedResult, effectiveCoords),
    ]);

    const batch3Data = {
      locationName: verifiedLoc.locationName,
      locationConfidence: verifiedLoc.locationConfidence,
      locationEvidence: verifiedLoc.locationEvidence,
      supplementaryImages,
      audioDurationSeconds: Math.max(20, Math.round((parsedResult.narration?.length || 200) / 12)),
      coords: verifiedLoc.resolvedCoords ?? null,
      batchStatus: {
        batch1Ready: true,
        batch2Ready: true,
        batch3Ready: true,
        stage: 'complete' as const,
        timestamp: Date.now(),
      },
    };

    sendEvent('batch3', batch3Data);
    sendEvent('done', { id: scanId });
  } catch (error: any) {
    console.error('Error in streaming landmark recognition:', error);
    sendEvent('error', { message: error.message || 'Stream processing failed' });
  } finally {
    if (!res.writableEnded) {
      res.end();
    }
  }
}

// Identify Landmark / Sight endpoints (support both routes)
app.post('/api/identify-landmark', handleLandmarkRecognition);
app.post('/api/recognize-landmark', handleLandmarkRecognition);
app.post('/api/recognize-landmark-stream', handleLandmarkRecognitionStream);
app.post('/api/recognize-landmark/stream', handleLandmarkRecognitionStream);
app.post('/api/stream-scan', handleLandmarkRecognitionStream);

// Audio TTS Endpoint using Gemini TTS with caching & male/female voice clarity
app.post('/api/tts', async (req, res) => {
  try {
    const { text, voiceName, gender = 'female' } = req.body;
    if (!text) {
      return res.status(400).json({ error: 'Text parameter required' });
    }

    const isMale = gender === 'male';
    const selectedVoice = voiceName || (isMale ? 'Fenrir' : 'Kore');
    const cleanSnippet = String(text).slice(0, 500).trim();
    const ttsCacheKey = `tts:${selectedVoice}:${cleanSnippet}`;
    const cachedTts = getCached(ttsCacheKey);
    if (cachedTts) {
      return res.json({ success: true, audioBase64: cachedTts, format: 'audio/wav', voiceName: selectedVoice });
    }

    const ai = getGenAI();
    const speechStyle = isMale
      ? 'Clear, calm, articulate male tour guide narrator with warm resonant tone'
      : 'Clear, warm, natural female tour guide narrator';

    const requestTts = (modelName: string) =>
      ai.models.generateContent({
        model: modelName,
        contents: [
          {
            role: 'user',
            parts: [
              {
                text: cleanSnippet,
                speechMetadata: {
                  style: speechStyle,
                },
              },
            ],
          },
        ],
        config: {
          responseModalities: [Modality.AUDIO],
          speechConfig: {
            voiceConfig: {
              prebuiltVoiceConfig: { voiceName: selectedVoice },
            },
          },
        },
      });

    let ttsResponse;
    try {
      ttsResponse = await requestTts('gemini-3.8-flash-lite-tts');
    } catch {
      ttsResponse = await requestTts('gemini-3.8-flash-tts');
    }

    const base64Audio = ttsResponse.candidates?.[0]?.content?.parts?.[0]?.inlineData?.data;

    if (base64Audio) {
      setCached(ttsCacheKey, base64Audio, 900);
      res.json({ success: true, audioBase64: base64Audio, format: 'audio/wav', voiceName: selectedVoice });
    } else {
      res.json({ success: false, fallbackToBrowser: true });
    }
  } catch (error: any) {
    console.warn('Gemini TTS failed, signalling fallback to Web Speech Synthesis:', error.message);
    res.json({ success: false, fallbackToBrowser: true });
  }
});

// Interactive AI Tour Guide Chat Streaming Endpoint (SSE word-by-word with multi-turn memory)
app.post('/api/chat-stream', async (req, res) => {
  res.setHeader('Content-Type', 'text/event-stream');
  res.setHeader('Cache-Control', 'no-cache, no-transform');
  res.setHeader('Connection', 'keep-alive');
  res.flushHeaders?.();

  const sendEvent = (type: string, data: any) => {
    if (res.writableEnded) return;
    try {
      res.write(`data: ${JSON.stringify({ type, data })}\n\n`);
    } catch {
      // ignore
    }
  };

  try {
    const {
      conversationId,
      message,
      question,
      historyMessages,
      rollingSummary,
      activeTopicContext,
      landmarkContext,
      language = 'English',
      history = [],
      topics,
      persona = 'warm_female',
      voiceGender = 'female',
    } = req.body;

    const userMessage = String(message || question || '').trim();
    if (!userMessage) {
      sendEvent('error', { message: 'A question or message is required.' });
      return;
    }

    const ai = getGenAI();
    const topicDirectives = buildTopicGuidance(topics, persona, voiceGender);
    const builtContext = buildChatContextForGemini({
      userMessage,
      historyMessages: Array.isArray(historyMessages) ? historyMessages : undefined,
      rollingSummary: typeof rollingSummary === 'string' ? rollingSummary : undefined,
      activeTopicContext: activeTopicContext || null,
      landmarkContext: landmarkContext || null,
      visitedTopics: Array.isArray(history) ? history : [],
      language,
      topicDirectives,
      persona,
      voiceGender,
    });

    const stream = await generateContentStreamWithFallback(ai, {
      model: 'gemini-3.1-flash-lite',
      contents: builtContext.contents,
      config: {
        systemInstruction: builtContext.systemInstruction,
      },
    });

    let fullReply = '';
    for await (const chunk of stream) {
      const piece = chunk.text || '';
      if (piece) {
        fullReply += piece;
        sendEvent('delta', { text: piece });
      }
    }

    if (!fullReply.trim()) {
      sendEvent('error', { message: 'Empty response received from AI guide.' });
      return;
    }

    sendEvent('done', {
      conversationId: typeof conversationId === 'string' ? conversationId : undefined,
      reply: fullReply,
      updatedRollingSummary: builtContext.updatedRollingSummary,
    });
  } catch (error: any) {
    console.error('Error in chat-stream:', error);
    sendEvent('error', { message: error?.message || 'Chat stream unavailable' });
  } finally {
    if (!res.writableEnded) res.end();
  }
});

// Interactive AI Tour Guide Chat Endpoint (JSON fallback with multi-turn memory)
app.post('/api/chat', async (req, res) => {
  try {
    const {
      conversationId,
      message,
      question,
      historyMessages,
      rollingSummary,
      activeTopicContext,
      landmarkContext,
      language = 'English',
      history = [],
      topics,
      persona = 'warm_female',
      voiceGender = 'female',
    } = req.body;

    const userMessage = String(message || question || '').trim();
    if (!userMessage) {
      return res.status(400).json({ error: 'A question or message is required' });
    }

    const ai = getGenAI();
    const topicDirectives = buildTopicGuidance(topics, persona, voiceGender);
    const builtContext = buildChatContextForGemini({
      userMessage,
      historyMessages: Array.isArray(historyMessages) ? historyMessages : undefined,
      rollingSummary: typeof rollingSummary === 'string' ? rollingSummary : undefined,
      activeTopicContext: activeTopicContext || null,
      landmarkContext: landmarkContext || null,
      visitedTopics: Array.isArray(history) ? history : [],
      language,
      topicDirectives,
      persona,
      voiceGender,
    });

    const response = await generateContentWithFallback(ai, {
      model: 'gemini-3.1-flash-lite',
      contents: builtContext.contents,
      config: {
        systemInstruction: builtContext.systemInstruction,
      },
    });

    const replyText = (response.text || '').trim();
    if (!replyText) {
      return res.status(502).json({ error: 'Empty response from AI guide' });
    }

    res.json({
      success: true,
      conversationId: typeof conversationId === 'string' ? conversationId : undefined,
      reply: replyText,
      updatedRollingSummary: builtContext.updatedRollingSummary,
    });
  } catch (error: any) {
    console.error('Error in chat:', error);
    res.status(500).json({ error: 'Chat guide unavailable', details: error.message });
  }
});

// Translate Landmark Explanation into Selected Language
app.post('/api/translate-landmark', async (req, res) => {
  try {
    const { landmark, targetLanguage } = req.body;
    if (!landmark || !targetLanguage) {
      return res.status(400).json({ error: 'landmark and targetLanguage are required' });
    }

    const ai = getGenAI();
    const prompt = `Translate and localize the following tourist guide landmark details strictly into "${targetLanguage}".
Keep historical accuracy, cultural nuance, vivid storytelling style, and clear formatting suitable for audio narration.

Landmark details:
${JSON.stringify(landmark, null, 2)}

Produce valid JSON with translated properties:
- title
- nativeTitle (name in target language native script)
- locationName
- historicalPeriod
- ocrDetectedText (translated or original inscription)
- summary
- narration (spoke narration script in ${targetLanguage})
- keyFacts (array of strings)
- architecturalHighlights (array of strings)
- suggestedQuestions (array of strings in ${targetLanguage})
- culturalSignificance
- tags (array of strings)`;

    const response = await generateContentWithFallback(ai, {
      model: 'gemini-3.1-flash-lite',
      contents: prompt,
      config: {
        responseMimeType: 'application/json',
        responseSchema: {
          type: Type.OBJECT,
          properties: {
            title: { type: Type.STRING },
            nativeTitle: { type: Type.STRING },
            locationName: { type: Type.STRING },
            historicalPeriod: { type: Type.STRING },
            ocrDetectedText: { type: Type.STRING },
            summary: { type: Type.STRING },
            narration: { type: Type.STRING },
            keyFacts: { type: Type.ARRAY, items: { type: Type.STRING } },
            architecturalHighlights: { type: Type.ARRAY, items: { type: Type.STRING } },
            suggestedQuestions: { type: Type.ARRAY, items: { type: Type.STRING } },
            culturalSignificance: { type: Type.STRING },
            tags: { type: Type.ARRAY, items: { type: Type.STRING } },
          },
          required: ['title', 'summary', 'narration', 'keyFacts', 'suggestedQuestions'],
        },
      },
    });

    const parsed = safeJsonParse<Record<string, any>>(response.text, {});
    const cleanParsed = Object.fromEntries(
      Object.entries(parsed).filter(([, val]) => val !== undefined && val !== null && val !== '')
    );
    const updatedLandmark = {
      ...landmark,
      ...cleanParsed,
      id: landmark.id,
      placeId: landmark.placeId,
      googlePlaceId: landmark.googlePlaceId,
      provider: landmark.provider,
      googleMapsUri: landmark.googleMapsUri,
      coords: landmark.coords,
      city: landmark.city,
      country: landmark.country,
      imageUrl: landmark.imageUrl,
      journalId: landmark.journalId,
      language: targetLanguage,
    };

    res.json({ success: true, landmark: updatedLandmark });
  } catch (error: any) {
    console.error('Error translating landmark:', error);
    res.status(500).json({ error: 'Failed to translate landmark', details: error.message });
  }
});

// Batch translate UI labels and dynamic spot summaries into the selected language
const translationStringCache = new Map<string, { value: string; expiresAt: number }>();

app.post('/api/translate-batch', async (req, res) => {
  try {
    const { texts, targetLanguage = 'English', context = 'travel guide UI and spot descriptions' } = req.body || {};
    let entries: Array<[string, string]> = [];
    if (Array.isArray(texts)) {
      entries = texts.map((v, idx) => [String(idx), typeof v === 'string' ? v : String(v ?? '')]);
    } else if (texts && typeof texts === 'object') {
      entries = Object.entries(texts as Record<string, string>);
    } else {
      return res.status(400).json({ success: false, error: 'texts object is required', translations: {} });
    }

    const cleanTargetLang = String(targetLanguage || 'English').trim();
    const isEnglish = cleanTargetLang.toLowerCase() === 'english' || cleanTargetLang.toLowerCase() === 'en';
    const resultTranslations: Record<string, string> = {};

    if (isEnglish || entries.length === 0) {
      for (const [k, v] of entries) {
        resultTranslations[k] = typeof v === 'string' ? v : '';
      }
      return res.json({ success: true, translations: resultTranslations });
    }

    const now = Date.now();
    const pendingItems: Array<{ key: string; text: string }> = [];

    for (const [key, rawVal] of entries) {
      const val = typeof rawVal === 'string' ? rawVal : '';
      if (!val.trim()) {
        resultTranslations[key] = val;
        continue;
      }
      const cacheKey = `${cleanTargetLang.toLowerCase()}::${val}`;
      const hit = translationStringCache.get(cacheKey);
      if (hit && hit.expiresAt > now) {
        resultTranslations[key] = hit.value;
      } else {
        resultTranslations[key] = val; // safe identity default
        pendingItems.push({ key, text: val });
      }
    }

    if (pendingItems.length === 0) {
      return res.json({ success: true, translations: resultTranslations });
    }

    const ai = getGenAI();
    const prompt = `Translate each entry's "text" value into natural, fluent, culturally accurate ${cleanTargetLang} (${context}).
RULES:
- Preserve proper nouns, place names (keep recognizable or accurately transliterate alongside where helpful), numbers, distances (km, m), URLs, and symbols.
- Do not add explanations, markdown, or extra keys.
- Return every "key" exactly unchanged with its translated "translated" string.

Input entries:
${JSON.stringify(pendingItems.slice(0, 40))}`;

    try {
      const aiRes = await generateContentWithFallback(ai, {
        model: 'gemini-3.1-flash-lite',
        contents: prompt,
        config: {
          responseMimeType: 'application/json',
          responseSchema: {
            type: Type.OBJECT,
            properties: {
              items: {
                type: Type.ARRAY,
                items: {
                  type: Type.OBJECT,
                  properties: {
                    key: { type: Type.STRING },
                    translated: { type: Type.STRING },
                  },
                  required: ['key', 'translated'],
                },
              },
            },
            required: ['items'],
          },
        },
      });

      const parsed = safeJsonParse<{ items?: Array<{ key?: string; translated?: string }> }>(aiRes.text, {});
      const itemMap = new Map<string, string>();
      for (const item of parsed.items || []) {
        if (item?.key && typeof item.translated === 'string' && item.translated.trim()) {
          itemMap.set(item.key, item.translated.trim());
        }
      }

      for (const p of pendingItems) {
        const tr = itemMap.get(p.key);
        if (tr) {
          resultTranslations[p.key] = tr;
          translationStringCache.set(`${cleanTargetLang.toLowerCase()}::${p.text}`, {
            value: tr,
            expiresAt: Date.now() + 24 * 3600 * 1000,
          });
        }
      }

      return res.json({ success: true, translations: resultTranslations });
    } catch (aiErr: any) {
      console.warn('Batch translation fallback to identity text:', aiErr?.message || aiErr);
      return res.json({ success: true, translations: resultTranslations, partial: true });
    }
  } catch (error: any) {
    console.error('Error in /api/translate-batch:', error);
    return res.status(500).json({ success: false, error: 'Batch translation failed', translations: {} });
  }
});

// Nearby Landmarks Discovery (grounded in real Google Places / OSM discovery — no fabricated landmarks)
app.post('/api/nearby-landmarks', async (req, res) => {
  try {
    const { lat, lng, latitude, longitude, language = 'English', city = '', locationName = '' } = req.body || {};
    const rawLat = lat !== undefined ? lat : latitude;
    const rawLng = lng !== undefined ? lng : longitude;
    const parsedLat = Number(rawLat);
    const parsedLng = Number(rawLng);

    if (
      rawLat === undefined ||
      rawLat === null ||
      rawLng === undefined ||
      rawLng === null ||
      !Number.isFinite(parsedLat) ||
      !Number.isFinite(parsedLng) ||
      parsedLat < -90 ||
      parsedLat > 90 ||
      parsedLng < -180 ||
      parsedLng > 180
    ) {
      return res.status(400).json({ success: false, error: 'Valid latitude and longitude are required' });
    }

    const gmpApiKey = process.env.GOOGLE_MAPS_PLATFORM_KEY || '';
    const ai = getGenAI();
    const result = await getRealNearbyPlaces({
      latitude: parsedLat,
      longitude: parsedLng,
      locationName: locationName || city || 'Current Area',
      city,
      language,
      gmpApiKey,
      aiClient: ai,
    });

    if (result.quotaExceeded && result.spots.length === 0) {
      return res.status(429).json({
        success: false,
        quotaExceeded: true,
        error: 'Google Maps Platform quota exceeded',
        landmarks: [],
      });
    }

    const landmarks = result.spots.slice(0, 8).map((s) => ({
      id: s.id,
      title: s.name,
      category: s.category,
      distanceMeters: Math.round((s.estimatedDistanceKm || 0) * 1000),
      teaser: s.oneLineImportance,
      imageUrl: s.imageUrl || '',
      lat: s.latitude,
      lng: s.longitude,
      rating: s.rating,
    }));

    return res.json({
      success: true,
      landmarks,
      ...(result.quotaExceeded ? { quotaExceeded: true } : {}),
    });
  } catch (error: any) {
    console.error('Error in nearby-landmarks:', error);
    return res.status(500).json({ success: false, error: 'Failed to load nearby landmarks', landmarks: [] });
  }
});

function extractGeocodingV4Parts(result: any) {
  const components: Array<{ longText?: string; shortText?: string; types?: string[] }> =
    result?.addressComponents || [];
  const findComp = (...targetTypes: string[]) =>
    components.find((c) => c.types?.some((t) => targetTypes.includes(t)))?.longText || '';

  const locality =
    findComp('sublocality_level_1', 'sublocality', 'neighborhood') ||
    result?.postalAddress?.sublocality ||
    '';
  const city =
    findComp('locality') ||
    result?.postalAddress?.locality ||
    findComp('administrative_area_level_2', 'administrative_area_level_3') ||
    '';
  const state = findComp('administrative_area_level_1') || result?.postalAddress?.administrativeArea || '';
  const country = findComp('country') || '';

  const parts = [locality, city, state, country].filter((p) => Boolean(p) && p.trim().length > 0);
  const cleanParts = parts.filter((p, i, arr) => arr.indexOf(p) === i);
  const locationName = cleanParts.join(', ') || result?.formattedAddress || '';

  return {
    placeId: result?.placeId || undefined,
    formattedAddress: result?.formattedAddress || locationName,
    locationName,
    locality,
    city: city || locality || state || 'Current Area',
    state,
    country,
  };
}

// Reverse Geocode: Convert Device GPS (lat/lng) into Exact Human-Readable Location (Google Geocoding v4 -> v3 -> BigDataCloud)
app.post('/api/reverse-geocode', async (req, res) => {
  try {
    const { latitude, longitude } = req.body || {};
    if (latitude === undefined || latitude === null || longitude === undefined || longitude === null) {
      return res.status(400).json({ success: false, error: 'Latitude and longitude are required' });
    }

    const lat = Number(latitude);
    const lng = Number(longitude);
    if (!Number.isFinite(lat) || !Number.isFinite(lng) || lat < -90 || lat > 90 || lng < -180 || lng > 180) {
      return res.status(400).json({ success: false, error: 'Invalid latitude or longitude coordinates' });
    }

    const gmpApiKey = process.env.GOOGLE_MAPS_PLATFORM_KEY || '';

    // 1. Primary: Google Maps Geocoding API v4
    if (gmpApiKey) {
      try {
        const v4Url = `https://geocode.googleapis.com/v4/geocode/location?location.latitude=${encodeURIComponent(
          lat
        )}&location.longitude=${encodeURIComponent(lng)}&languageCode=en`;
        const v4Res = await fetch(v4Url, {
          headers: {
            'X-Goog-Api-Key': gmpApiKey,
            'X-Goog-Maps-Solution-ID': GMP_SOLUTION_ID,
            'X-Goog-FieldMask':
              'results.placeId,results.formattedAddress,results.addressComponents,results.postalAddress,plusCode',
          },
          signal: AbortSignal.timeout(4500),
        });

        if (!v4Res.ok) {
          const errText = await v4Res.text().catch(() => '');
          if (isGmpQuotaError(v4Res.status, errText)) {
            return res.status(429).json({
              success: false,
              quotaExceeded: true,
              error: 'Google Maps Geocoding quota exceeded',
            });
          }
        } else {
          const v4Data = await v4Res.json();
          const first = v4Data?.results?.[0];
          if (first) {
            const extracted = extractGeocodingV4Parts(first);
            if (extracted.locationName) {
              return res.json({
                success: true,
                provider: 'google_geocoding',
                ...extracted,
                latitude: lat,
                longitude: lng,
              });
            }
          }
        }
      } catch (e) {
        console.warn('Google Geocoding v4 reverse geocode failed:', e);
      }

      // 2. Secondary: Google Geocoding API v3
      try {
        const v3Url = `https://maps.googleapis.com/maps/api/geocode/json?latlng=${lat},${lng}&language=en&key=${gmpApiKey}`;
        const v3Res = await fetch(v3Url, {
          headers: {
            'X-Goog-Maps-Solution-ID': GMP_SOLUTION_ID,
          },
          signal: AbortSignal.timeout(4500),
        });
        if (v3Res.status === 429) {
          return res.status(429).json({
            success: false,
            quotaExceeded: true,
            error: 'Google Maps Geocoding quota exceeded',
          });
        }
        if (v3Res.ok) {
          const v3Data = await v3Res.json();
          if (v3Data?.status === 'OVER_QUERY_LIMIT') {
            return res.status(429).json({
              success: false,
              quotaExceeded: true,
              error: 'Google Maps Geocoding quota exceeded',
            });
          }
          const first = v3Data?.results?.[0];
          if (first) {
            const comps: Array<{ long_name?: string; types?: string[] }> = first.address_components || [];
            const findV3 = (...types: string[]) =>
              comps.find((c) => c.types?.some((t) => types.includes(t)))?.long_name || '';
            const locality = findV3('sublocality_level_1', 'sublocality', 'neighborhood');
            const city = findV3('locality') || findV3('administrative_area_level_2');
            const state = findV3('administrative_area_level_1');
            const country = findV3('country');
            const parts = [locality, city, state, country].filter((p) => Boolean(p) && p.trim().length > 0);
            const cleanParts = parts.filter((p, i, arr) => arr.indexOf(p) === i);
            const locationName = cleanParts.join(', ') || first.formatted_address || '';
            if (locationName) {
              return res.json({
                success: true,
                provider: 'google_geocoding',
                placeId: first.place_id,
                formattedAddress: first.formatted_address || locationName,
                locationName,
                locality,
                city: city || locality || state || 'Current Area',
                state,
                country,
                latitude: lat,
                longitude: lng,
              });
            }
          }
        }
      } catch (e) {
        console.warn('Google Geocoding v3 reverse geocode failed:', e);
      }
    }

    // 3. Fallback: BigDataCloud (no Gemini hallucination or Madurai fallback)
    try {
      const bdcUrl = `https://api.bigdatacloud.net/data/reverse-geocode-client?latitude=${lat}&longitude=${lng}&localityLanguage=en`;
      const response = await fetch(bdcUrl, {
        headers: { 'User-Agent': 'CharaivaTouristGuide/1.0' },
        signal: AbortSignal.timeout(4500),
      });

      if (response.ok) {
        const data = await response.json();
        const adminList: Array<{ name?: string; order?: number; adminLevel?: number }> =
          Array.isArray(data.localityInfo?.administrative) ? data.localityInfo.administrative : [];
        const districtFallback =
          adminList.find((a) => a.adminLevel === 5 || a.adminLevel === 6)?.name || '';
        const locality =
          data.locality ||
          adminList[3]?.name ||
          adminList[2]?.name ||
          '';
        const city =
          data.city ||
          districtFallback ||
          data.principalSubdivision ||
          adminList[1]?.name ||
          '';
        const state = data.principalSubdivision || '';
        const country = data.countryName || '';

        const parts = [locality, city, state, country].filter((p) => Boolean(p) && p.trim().length > 0);
        const cleanParts = parts.filter((p, i, arr) => arr.indexOf(p) === i);
        const formattedLocationName = cleanParts.join(', ');

        if (formattedLocationName) {
          return res.json({
            success: true,
            provider: 'bigdatacloud',
            locationName: formattedLocationName,
            locality,
            city: city || locality || state || '',
            state,
            country,
            latitude: lat,
            longitude: lng,
          });
        }
      }
    } catch (e) {
      console.warn('BigDataCloud reverse geocode failed:', e);
    }

    // 4. Fallback: OpenStreetMap Nominatim reverse geocoding
    try {
      const nomUrl = `https://nominatim.openstreetmap.org/reverse?format=jsonv2&lat=${encodeURIComponent(
        lat
      )}&lon=${encodeURIComponent(lng)}&zoom=14&addressdetails=1&accept-language=en`;
      const nomRes = await fetch(nomUrl, {
        headers: { 'User-Agent': 'CharaivaTouristGuide/1.0 (https://charaiva.app)' },
        signal: AbortSignal.timeout(4500),
      });

      if (nomRes.ok) {
        const nomData = await nomRes.json();
        const addr = nomData?.address || {};
        const locality = addr.suburb || addr.neighbourhood || addr.quarter || addr.city_district || '';
        const city = addr.city || addr.town || addr.village || addr.municipality || addr.state_district || addr.county || '';
        const state = addr.state || '';
        const country = addr.country || '';

        const parts = [locality, city, state, country].filter((p) => Boolean(p) && p.trim().length > 0);
        const cleanParts = parts.filter((p, i, arr) => arr.indexOf(p) === i);
        const formattedLocationName = cleanParts.join(', ') || nomData?.display_name || '';

        if (formattedLocationName) {
          return res.json({
            success: true,
            provider: 'nominatim_osm',
            locationName: formattedLocationName,
            locality,
            city: city || locality || state || '',
            state,
            country,
            latitude: lat,
            longitude: lng,
          });
        }
      }
    } catch (e) {
      console.warn('Nominatim reverse geocode failed:', e);
    }

    return res.status(502).json({
      success: false,
      error: 'Unable to resolve street or city name for these coordinates.',
      latitude: lat,
      longitude: lng,
    });
  } catch (error: any) {
    console.error('Error in reverse geocode:', error);
    return res.status(500).json({
      success: false,
      error: 'Reverse geocoding failed',
    });
  }
});

function sanitizeDeepDiveSubjectLocation(rawLocation?: string): string {
  const cleaned = typeof rawLocation === 'string' ? rawLocation.trim() : '';
  if (!cleaned) return '';
  if (isGenericLocationLabel(cleaned)) return '';
  const lower = cleaned.toLowerCase();
  if (
    lower === 'visual identification' ||
    lower === 'everyday object · visual identification' ||
    lower === 'heritage discovery' ||
    lower === 'location requires visual verification' ||
    lower === 'identifying location from visual evidence...' ||
    lower === 'explore mode' ||
    lower === 'exploring local heritage'
  ) {
    return '';
  }
  return cleaned.slice(0, 200);
}

// Deep-Dive Topic Endpoint: Expands any recognized sight or topic with grounded in-depth context, architecture, traditions, and visitor guidance
app.post('/api/deep-dive-topic', async (req, res) => {
  try {
    const rawBody = req.body && typeof req.body === 'object' ? req.body : {};
    const cleanTitle = sanitizeUserText(rawBody.title || '', 200);
    if (!cleanTitle) {
      return res.status(400).json({
        success: false,
        error: 'Title is required for deep exploration',
        code: 'MISSING_TITLE',
        retryable: false,
      });
    }

    const cleanCategory = sanitizeUserText(rawBody.category || 'Landmark', 80) || 'Landmark';
    const cleanLocationName = sanitizeDeepDiveSubjectLocation(rawBody.locationName);
    const cleanLanguage = sanitizeUserText(rawBody.language || 'English', 60) || 'English';
    const cleanNarration = sanitizeUserText(rawBody.currentNarration || '', 400);
    const cleanQuestion = sanitizeUserText(rawBody.userQuestion || '', 260);

    const cacheKey = `deep_dive::${cleanTitle.toLowerCase()}::${cleanCategory.toLowerCase()}::${(cleanLocationName || 'unknown').toLowerCase()}::${cleanLanguage.toLowerCase()}::${cleanQuestion.toLowerCase()}`;
    const cached = getCached(cacheKey);
    if (cached) {
      return res.json({ success: true, ...cached });
    }

    const ai = getGenAI();
    const locationDirective = cleanLocationName
      ? `- Verified Subject Location: "${cleanLocationName}"`
      : `- Subject Location: Unknown / Not specified (CRITICAL: Do NOT assume the user's current city, do NOT invent a city, state, country, or coordinates, and acknowledge location uncertainty if the subject's location is ambiguous or unverified.)`;

    const prompt = `You are Charaiva, an expert historian and personal AI tourist guide committed to strict factual accuracy.
The user wants an in-depth exploration dossier about this specific subject:
- Title/Subject: "${cleanTitle}"
- Category: "${cleanCategory}"
${locationDirective}
- Existing summary context: "${cleanNarration || 'None'}"
${cleanQuestion ? `- Specific user curiosity: "${cleanQuestion}"` : ''}

Language requirement: Produce ALL fields strictly in "${cleanLanguage}", preserving established English or local proper place names where helpful for clarity.

STRICT ACCURACY & VERIFICATION RULES:
1. NEVER fabricate dates, builders, dynasties, inscriptions, secret chambers, astronomical alignments, entry fees, operating hours, coordinates, or source citations.
2. Distinguish clearly between well-documented historical/architectural facts, local legends/oral traditions (explicitly label traditions as folklore or traditional belief), and aspects that remain historically uncertain or unverified.
3. If reliable evidence for a sub-detail is limited or uncertain, state that honestly rather than inventing generic statements.
4. Keep Subject Location faithful to the verified subject itself — never substitute the user's current city when location is unknown.

Include:
1. "deepDiveNarration": 3-4 vivid, accurate paragraphs in spoken tour guide style covering documented history, cultural context, and notable traditions. (Plain text only, no markdown symbols.)
2. "secretFacts": 3-4 lesser-known documented facts or explicitly labeled local traditions visitors often overlook (fewer if uncertain — never pad with guesses).
3. "architecturalSecrets": 2-3 verified architectural, artistic, or structural features to observe closely (or craft/material traits if it is an artifact/object).
4. "historicalTimeline": 2-4 verified chronological milestones or eras (avoid inventing exact years if uncertain; use broader centuries or "Period Uncertain" when needed).
5. "unsolvedMysteries": 1-2 genuine open historical questions, scholarly debates, or points of limited evidence.
6. "visitorProTips": 2-3 practical visitor tips (without inventing exact ticket prices or opening hours).`;

    const aiRes = await generateContentWithFallback(ai, {
      model: 'gemini-3.1-flash-lite',
      contents: prompt,
      config: {
        responseMimeType: 'application/json',
        responseSchema: {
          type: Type.OBJECT,
          properties: {
            title: { type: Type.STRING },
            deepDiveNarration: { type: Type.STRING },
            secretFacts: {
              type: Type.ARRAY,
              items: { type: Type.STRING },
            },
            architecturalSecrets: {
              type: Type.ARRAY,
              items: { type: Type.STRING },
            },
            historicalTimeline: {
              type: Type.ARRAY,
              items: {
                type: Type.OBJECT,
                properties: {
                  era: { type: Type.STRING },
                  event: { type: Type.STRING },
                },
                required: ['era', 'event'],
              },
            },
            unsolvedMysteries: {
              type: Type.ARRAY,
              items: { type: Type.STRING },
            },
            visitorProTips: {
              type: Type.ARRAY,
              items: { type: Type.STRING },
            },
          },
          required: ['title', 'deepDiveNarration', 'secretFacts', 'architecturalSecrets', 'visitorProTips'],
        },
      },
    });

    const parsed = safeJsonParse<any>(aiRes?.text, {});
    const deepDiveNarration =
      typeof parsed?.deepDiveNarration === 'string' ? parsed.deepDiveNarration.trim() : '';

    if (!deepDiveNarration) {
      return res.status(502).json({
        success: false,
        error: 'Deep exploration could not be generated reliably right now. Please try again.',
        code: 'EMPTY_AI_RESPONSE',
        retryable: true,
      });
    }

    const cleanArray = (val: any, max = 6): string[] =>
      Array.isArray(val)
        ? val.filter((item) => typeof item === 'string' && item.trim().length > 0).map((s) => s.trim()).slice(0, max)
        : [];

    const cleanTimeline = Array.isArray(parsed?.historicalTimeline)
      ? parsed.historicalTimeline
          .filter(
            (item: any) =>
              item &&
              typeof item.era === 'string' &&
              item.era.trim() &&
              typeof item.event === 'string' &&
              item.event.trim()
          )
          .map((item: any) => ({ era: item.era.trim(), event: item.event.trim() }))
          .slice(0, 6)
      : [];

    const responsePayload = {
      title: typeof parsed?.title === 'string' && parsed.title.trim() ? parsed.title.trim() : cleanTitle,
      deepDiveNarration,
      secretFacts: cleanArray(parsed?.secretFacts, 6),
      architecturalSecrets: cleanArray(parsed?.architecturalSecrets, 5),
      historicalTimeline: cleanTimeline,
      unsolvedMysteries: cleanArray(parsed?.unsolvedMysteries, 4),
      visitorProTips: cleanArray(parsed?.visitorProTips, 5),
    };

    setCached(cacheKey, responsePayload, 900);
    return res.json({
      success: true,
      ...responsePayload,
    });
  } catch (error: any) {
    console.error('Error in deep-dive-topic:', error);
    const status = Number(error?.status || error?.code || error?.response?.status);
    const msg = String(error?.message || error || '').toLowerCase();
    const isRateLimit =
      status === 429 || msg.includes('429') || msg.includes('quota') || msg.includes('resource_exhausted');
    const isTimeout =
      status === 504 || error?.name === 'AbortError' || msg.includes('timeout') || msg.includes('timed out');
    const isAuth = status === 401 || status === 403 || msg.includes('api key');

    const httpStatus = isRateLimit ? 429 : isTimeout ? 504 : isAuth ? 503 : 503;
    return res.status(httpStatus).json({
      success: false,
      error: isRateLimit
        ? 'Deep exploration is temporarily rate-limited. Please wait a moment and try again.'
        : isTimeout
        ? 'Deep exploration request timed out. Please try again.'
        : 'Deep exploration service is temporarily unavailable. Please try again.',
      code: isRateLimit ? 'RATE_LIMITED' : isTimeout ? 'AI_TIMEOUT' : 'AI_UNAVAILABLE',
      retryable: true,
    });
  }
});

// Proxy endpoint to securely fetch photos from Google Places Photo API (New) without exposing server API key
app.get('/api/places/photo', async (req, res) => {
  const clientAbortController = new AbortController();
  res.on('close', () => {
    if (!res.writableEnded) {
      clientAbortController.abort();
    }
  });

  try {
    const photoName = ((req.query.name as string) || '').trim();
    const rawH = parseInt(req.query.maxHeightPx as string, 10);
    const rawW = parseInt(req.query.maxWidthPx as string, 10);
    const maxHeightPx = Math.min(4800, Math.max(1, Number.isFinite(rawH) ? rawH : 800));
    const maxWidthPx = Math.min(4800, Math.max(1, Number.isFinite(rawW) ? rawW : 800));
    const gmpApiKey = process.env.GOOGLE_MAPS_PLATFORM_KEY || '';

    const result = await fetchGooglePlacePhotoMedia({
      photoName,
      maxHeightPx,
      maxWidthPx,
      apiKey: gmpApiKey,
      clientSignal: clientAbortController.signal,
      isDisallowedHost: isPrivateOrLoopbackHost,
    });

    if (res.writableEnded || res.headersSent) {
      return;
    }

    if (result.ok === true) {
      res.setHeader('Content-Type', result.contentType);
      // Ephemeral policy: do not persist Google Places photos in HTTP/browser caches
      res.setHeader('Cache-Control', 'no-store, max-age=0');
      return res.send(result.buffer);
    } else {
      const failure = result as Extract<typeof result, { ok: false }>;
      if (failure.abortedByClient) {
        return res.end();
      }

      if (failure.quotaExceeded) {
        return res.status(429).json({
          success: false,
          quotaExceeded: true,
          error: failure.message,
        });
      }

      if (failure.timedOut) {
        console.warn('Google Places Photo timed out after retry:', photoName);
        return res.status(504).send(failure.message);
      }

      return res.status(failure.status).send(failure.message);
    }
  } catch (error: any) {
    if (clientAbortController.signal.aborted || res.writableEnded) {
      return;
    }
    console.warn('Google Places Photo proxy error:', error?.message || error);
    return res.status(502).send('Error fetching photo');
  }
});

const ALLOWED_IMAGE_PROXY_HOSTS = new Set([
  'upload.wikimedia.org',
  'thumb.wikimedia.org',
  'commons.wikimedia.org',
  'en.wikipedia.org',
  'images.unsplash.com',
]);

function isAllowedImageHost(hostname: string): boolean {
  const lower = hostname.toLowerCase();
  return (
    ALLOWED_IMAGE_PROXY_HOSTS.has(lower) ||
    lower.endsWith('.wikimedia.org') ||
    lower.endsWith('.wikipedia.org')
  );
}

const proxyImageCache = new Map<string, { buffer: Buffer; contentType: string; timestamp: number }>();

// Proxy endpoint to securely stream and cache Wikipedia / Wikimedia / heritage photos without referer blocking
app.get('/api/places/proxy-image', async (req, res) => {
  try {
    const targetUrl = ((req.query.url as string) || '').trim();
    if (!targetUrl) {
      return res.status(400).send('Valid HTTPS image URL required');
    }

    let parsedUrl: URL;
    try {
      parsedUrl = new URL(targetUrl);
    } catch {
      return res.status(400).send('Invalid image URL');
    }

    const host = parsedUrl.hostname.toLowerCase();
    if (
      parsedUrl.protocol !== 'https:' ||
      isPrivateOrLoopbackHost(host) ||
      !isAllowedImageHost(host)
    ) {
      return res.status(400).send('Blocked untrusted or non-HTTPS image host');
    }

    // Check in-memory buffer cache first
    const cached = proxyImageCache.get(targetUrl);
    if (cached && Date.now() - cached.timestamp < 24 * 3600 * 1000) {
      res.setHeader('Content-Type', cached.contentType);
      res.setHeader('Cache-Control', 'public, max-age=604800, stale-while-revalidate=2592000');
      return res.send(cached.buffer);
    }

    let imgRes = await fetch(parsedUrl.toString(), {
      headers: {
        'User-Agent': 'CharaivaTravelGuide/1.0 (https://charaiva.app; contact@charaiva.app)',
        Accept: 'image/webp,image/apng,image/jpeg,image/png,image/*,*/*;q=0.8',
      },
      redirect: 'follow',
      signal: AbortSignal.timeout(9000),
    });

    if (imgRes.url) {
      try {
        const finalUrl = new URL(imgRes.url);
        if (finalUrl.protocol !== 'https:' || isPrivateOrLoopbackHost(finalUrl.hostname)) {
          return res.status(400).send('Blocked unsafe redirect destination');
        }
      } catch {
        return res.status(400).send('Invalid redirect URL');
      }
    }

    // If direct thumbnail gave 429 or 404, fallback to Special:FilePath or original image
    if (!imgRes.ok && (host.includes('wikimedia.org') || host.includes('wikipedia.org'))) {
      const fileName = targetUrl.split('/').pop()?.replace(/^\d+px-/, '') || '';
      if (fileName) {
        const specialUrl = `https://commons.wikimedia.org/wiki/Special:FilePath/${encodeURIComponent(fileName)}?width=960`;
        try {
          const fallbackRes = await fetch(specialUrl, {
            headers: {
              'User-Agent': 'CharaivaTravelGuide/1.0 (https://charaiva.app; contact@charaiva.app)',
            },
            redirect: 'follow',
            signal: AbortSignal.timeout(9000),
          });
          if (fallbackRes.ok) {
            imgRes = fallbackRes;
          }
        } catch (e) {
          console.warn('Special:FilePath fallback failed:', e);
        }
      }
    }

    if (!imgRes.ok) {
      return res.status(imgRes.status).send('Failed to retrieve image');
    }

    const contentType = imgRes.headers.get('content-type') || 'image/jpeg';
    if (!contentType.startsWith('image/')) {
      return res.status(400).send('Upstream resource is not an image');
    }

    res.setHeader('Content-Type', contentType);
    res.setHeader('Cache-Control', 'public, max-age=604800, stale-while-revalidate=2592000');

    const arrayBuffer = await imgRes.arrayBuffer();
    const buffer = Buffer.from(arrayBuffer);

    // Save to memory cache
    proxyImageCache.set(targetUrl, {
      buffer,
      contentType,
      timestamp: Date.now(),
    });

    return res.send(buffer);
  } catch (error: any) {
    console.error('Error proxying image:', error);
    return res.status(500).send('Image proxy error');
  }
});

// Resolve exact place photo on demand via Google Places API (New)
app.post('/api/places/resolve-photo', async (req, res) => {
  try {
    const { placeName, city, lat, lng, placeId } = req.body || {};
    const gmpApiKey = process.env.GOOGLE_MAPS_PLATFORM_KEY || '';

    if (isGenericLocationLabel(placeName) && !placeId) {
      return res.json({
        success: true,
        hasRealPhoto: false,
        photoUnavailable: true,
        photoUrl: '',
        authorAttributions: [],
        photos: [],
      });
    }

    const parsedLat = lat !== undefined && lat !== null ? Number(lat) : undefined;
    const parsedLng = lng !== undefined && lng !== null ? Number(lng) : undefined;

    const photoResult = await resolveExactPlacePhotoWithGooglePlaces(
      placeName || '',
      city || '',
      Number.isFinite(parsedLat) ? parsedLat : undefined,
      Number.isFinite(parsedLng) ? parsedLng : undefined,
      placeId,
      gmpApiKey
    );

    if (photoResult.quotaExceeded && !photoResult.hasRealPhoto) {
      return res.status(429).json({
        success: false,
        quotaExceeded: true,
        hasRealPhoto: false,
        photoUnavailable: true,
        photoUrl: '',
        authorAttributions: [],
        photos: [],
      });
    }

    return res.json({
      success: true,
      ...photoResult,
    });
  } catch (error: any) {
    console.error('Error resolving place photo:', error);
    return res.json({
      success: false,
      hasRealPhoto: false,
      photoUnavailable: true,
      photoUrl: '',
      authorAttributions: [],
      photos: [],
    });
  }
});

// Google Places API (New): Text Search for exact place queries & attraction discovery
app.post('/api/places/search-text', async (req, res) => {
  try {
    const {
      textQuery,
      latitude,
      longitude,
      radiusMeters = 10000,
      includedType,
      language = 'English',
    } = req.body || {};

    const trimmedQuery = typeof textQuery === 'string' ? textQuery.trim() : '';
    if (!trimmedQuery) {
      return res.status(400).json({ success: false, error: 'textQuery is required', places: [] });
    }

    const gmpApiKey = process.env.GOOGLE_MAPS_PLATFORM_KEY || '';
    if (!gmpApiKey) {
      return res.status(503).json({
        success: false,
        error: 'Google Places service not configured',
        places: [],
      });
    }

    const parsedLat = latitude !== undefined && latitude !== null ? Number(latitude) : undefined;
    const parsedLng = longitude !== undefined && longitude !== null ? Number(longitude) : undefined;
    const hasCoords =
      typeof parsedLat === 'number' &&
      typeof parsedLng === 'number' &&
      Number.isFinite(parsedLat) &&
      Number.isFinite(parsedLng) &&
      parsedLat >= -90 &&
      parsedLat <= 90 &&
      parsedLng >= -180 &&
      parsedLng <= 180;

    const result = await searchGooglePlacesText({
      textQuery: trimmedQuery,
      latitude: hasCoords ? parsedLat : undefined,
      longitude: hasCoords ? parsedLng : undefined,
      radiusMeters: Number.isFinite(Number(radiusMeters)) ? Number(radiusMeters) : 10000,
      includedType: typeof includedType === 'string' ? includedType : undefined,
      languageCode: mapLanguageToBcp47(language),
      apiKey: gmpApiKey,
    });

    if (result.quotaExceeded && result.places.length === 0) {
      return res.status(429).json({
        success: false,
        quotaExceeded: true,
        error: 'Google Places API quota exceeded',
        places: [],
      });
    }

    return res.json({
      success: true,
      places: result.places,
      ...(result.quotaExceeded ? { quotaExceeded: true } : {}),
    });
  } catch (error: any) {
    console.error('Error in /api/places/search-text:', error);
    return res.status(500).json({ success: false, error: 'Place text search failed', places: [] });
  }
});

// Google Places API (New): Place Details for live hours, phone, website, wheelchair access & Maps URI
app.get('/api/places/details', async (req, res) => {
  try {
    const placeId = ((req.query.placeId as string) || '').trim();
    const language = ((req.query.language as string) || 'English').trim();

    if (!placeId || !/^[A-Za-z0-9_-]{8,}$/.test(placeId)) {
      return res.status(400).json({ success: false, error: 'Valid Google Place ID is required' });
    }

    const gmpApiKey = process.env.GOOGLE_MAPS_PLATFORM_KEY || '';
    if (!gmpApiKey) {
      return res.status(503).json({
        success: false,
        error: 'Google Places Details service not configured',
      });
    }

    const result = await fetchGooglePlaceDetails({
      placeId,
      languageCode: mapLanguageToBcp47(language),
      apiKey: gmpApiKey,
    });

    if (result.quotaExceeded) {
      return res.status(429).json({
        success: false,
        quotaExceeded: true,
        error: 'Google Places Details quota exceeded',
      });
    }

    if (!result.details) {
      return res.status(404).json({
        success: false,
        error: 'Place details not found',
      });
    }

    return res.json({
      success: true,
      details: result.details,
    });
  } catch (error: any) {
    console.error('Error in /api/places/details:', error);
    return res.status(500).json({ success: false, error: 'Failed to load place details' });
  }
});

// Lazy-loaded grounded extended place information for the inline Explore "More / Less" panel
app.post('/api/places/extended-info', async (req, res) => {
  try {
    const {
      placeId = '',
      googlePlaceId = '',
      name = '',
      category = '',
      addressOrLocality = '',
      city = '',
      country = '',
      latitude,
      longitude,
      language = 'English',
      existingDescription = '',
      existingHighlights = [],
    } = req.body || {};

    const cleanName = typeof name === 'string' ? name.trim() : '';
    if (!cleanName) {
      return res.status(400).json({ success: false, error: 'Place name is required' });
    }

    const cleanCity = !isGenericLocationLabel(city) ? String(city).trim() : '';
    const cleanLanguage = typeof language === 'string' && language.trim() ? language.trim() : 'English';
    const targetGoogleId = String(googlePlaceId || placeId || '').trim();
    const isValidGoogleId =
      Boolean(targetGoogleId) &&
      !targetGoogleId.startsWith('osm-') &&
      !targetGoogleId.startsWith('gt_') &&
      /^[A-Za-z0-9_-]{8,}$/.test(targetGoogleId);

    const cacheKey = `ext_info_${(targetGoogleId || cleanName).toLowerCase()}_${cleanCity.toLowerCase()}_${cleanLanguage.toLowerCase()}`;
    const cached = getCached(cacheKey);
    if (cached) {
      return res.json({ success: true, ...cached });
    }

    const gmpApiKey = process.env.GOOGLE_MAPS_PLATFORM_KEY || '';
    const langCode = mapLanguageToBcp47(cleanLanguage);

    const [googleDetailsRes, wikiRes] = await Promise.all([
      isValidGoogleId && gmpApiKey
        ? fetchGooglePlaceDetails({ placeId: targetGoogleId, languageCode: langCode, apiKey: gmpApiKey }).catch(() => ({
            details: null,
          }))
        : Promise.resolve({ details: null }),
      !isGenericLocationLabel(cleanName)
        ? fetchWikipediaPlaceExtract(cleanName, cleanCity).catch(() => null)
        : Promise.resolve(null),
    ]);

    const gDetails = googleDetailsRes?.details || null;
    const verifiedHighlights = Array.isArray(existingHighlights)
      ? existingHighlights.filter((h: any) => typeof h === 'string' && h.trim().length > 0).slice(0, 6)
      : [];

    const visitorInfo = {
      address: gDetails?.formattedAddress || addressOrLocality || '',
      openingHours:
        gDetails?.regularOpeningHours?.weekdayDescriptions &&
        gDetails.regularOpeningHours.weekdayDescriptions.length > 0
          ? gDetails.regularOpeningHours.weekdayDescriptions
          : [],
      openNow:
        typeof gDetails?.regularOpeningHours?.openNow === 'boolean'
          ? gDetails.regularOpeningHours.openNow
          : undefined,
      phone: gDetails?.nationalPhoneNumber || '',
      website: gDetails?.websiteUri || '',
      accessibility:
        gDetails?.accessibilityOptions?.wheelchairAccessibleEntrance === true
          ? 'Wheelchair accessible entrance available'
          : gDetails?.accessibilityOptions?.wheelchairAccessibleEntrance === false
          ? 'Entrance may not be wheelchair accessible'
          : '',
    };

    const sourceTags: string[] = [];
    if (gDetails) sourceTags.push('Google Places');
    if (wikiRes) sourceTags.push('Wikipedia');
    if (verifiedHighlights.length > 0 || existingDescription) sourceTags.push('Verified Place Record');
    const sourceAttribution = sourceTags.join(' + ') || 'Verified Geographic Record';

    const hasWiki = Boolean(wikiRes?.extract && wikiRes.extract.trim().length > 0);
    const hasSeedText = Boolean(existingDescription && String(existingDescription).trim().length > 0);

    // If no external knowledge and no existing description exist, avoid hallucinating history
    if (!hasWiki && !hasSeedText && verifiedHighlights.length === 0) {
      const minimalResult = {
        about: `${cleanName}${category ? ` (${category})` : ''}${cleanCity ? ` in ${cleanCity}` : ''}.`,
        history: '',
        architecture: '',
        culture: '',
        folkloreNote: '',
        visitorInfo,
        interestingFacts: [],
        sourceAttribution,
        wikipediaUrl: wikiRes?.url || '',
        language: cleanLanguage,
      };
      setCached(cacheKey, minimalResult, 900);
      return res.json({ success: true, ...minimalResult });
    }

    const ai = getGenAI();
    const groundingContext = {
      placeName: cleanName,
      category,
      city: cleanCity,
      country,
      address: visitorInfo.address,
      existingDescription: typeof existingDescription === 'string' ? existingDescription : '',
      verifiedHighlights,
      wikipediaTitle: wikiRes?.title || '',
      wikipediaExtract: wikiRes?.extract || '',
      coordinates:
        Number.isFinite(Number(latitude)) && Number.isFinite(Number(longitude))
          ? `${latitude}, ${longitude}`
          : '',
    };

    const prompt = `You are Charaiva's strict, fact-grounded heritage editor.
Write a concise, helpful extended travel summary for "${cleanName}" strictly in "${cleanLanguage}" using ONLY the grounded source data below.

CRITICAL GROUNDING RULES:
1. Total combined text across all sections must be concise (~100 to 200 words total).
2. NEVER invent historical dates, builders, dynasties, ticket prices, timings, or architectural specifications that are not present in the grounded source data.
3. If a section (history, architecture, culture, folkloreNote, interestingFacts) is NOT supported by the grounded data below, return "" (empty string) or [] (empty array) for that field. Do NOT pad or guess.
4. Distinguish clearly between historical fact and traditional legend: if local folklore, mythology, or devotional belief is mentioned, place it in "folkloreNote" and frame it explicitly as local tradition/legend.
5. Output ONLY valid JSON.

Grounded source data:
${JSON.stringify(groundingContext)}`;

    try {
      const aiRes = await generateContentWithFallback(ai, {
        model: 'gemini-3.1-flash-lite',
        contents: prompt,
        config: {
          responseMimeType: 'application/json',
          responseSchema: {
            type: Type.OBJECT,
            properties: {
              about: { type: Type.STRING },
              history: { type: Type.STRING },
              architecture: { type: Type.STRING },
              culture: { type: Type.STRING },
              folkloreNote: { type: Type.STRING },
              interestingFacts: { type: Type.ARRAY, items: { type: Type.STRING } },
            },
            required: ['about', 'history', 'architecture', 'culture', 'folkloreNote', 'interestingFacts'],
          },
        },
      });

      const parsed = safeJsonParse<{
        about?: string;
        history?: string;
        architecture?: string;
        culture?: string;
        folkloreNote?: string;
        interestingFacts?: string[];
      }>(aiRes.text, {});

      const resultData = {
        about: parsed.about?.trim() || (hasWiki ? wikiRes!.extract.slice(0, 320) : String(existingDescription).trim()),
        history: parsed.history?.trim() || '',
        architecture: parsed.architecture?.trim() || '',
        culture: parsed.culture?.trim() || '',
        folkloreNote: parsed.folkloreNote?.trim() || '',
        visitorInfo,
        interestingFacts: Array.isArray(parsed.interestingFacts)
          ? parsed.interestingFacts.filter((f) => typeof f === 'string' && f.trim()).slice(0, 4)
          : [],
        sourceAttribution,
        wikipediaUrl: wikiRes?.url || '',
        language: cleanLanguage,
      };

      setCached(cacheKey, resultData, 1800);
      return res.json({ success: true, ...resultData });
    } catch (aiErr: any) {
      console.warn('Extended info AI summarization failed, using grounded extract:', aiErr?.message || aiErr);
      const fallbackResult = {
        about: (hasWiki ? wikiRes!.extract.slice(0, 420) : String(existingDescription || cleanName)).trim(),
        history: '',
        architecture: '',
        culture: '',
        folkloreNote: '',
        visitorInfo,
        interestingFacts: verifiedHighlights.slice(0, 3),
        sourceAttribution,
        wikipediaUrl: wikiRes?.url || '',
        language: cleanLanguage,
      };
      return res.json({ success: true, ...fallbackResult });
    }
  } catch (error: any) {
    console.error('Error in /api/places/extended-info:', error);
    return res.status(500).json({ success: false, error: 'Failed to load extended place info' });
  }
});

// Google Maps Routes API v2: Real travel distance & duration
app.post('/api/routes/compute', async (req, res) => {
  try {
    const {
      origin,
      destination,
      travelMode: rawTravelMode = 'DRIVE',
      languageCode = 'en-US',
    } = req.body || {};

    const origLat = Number(origin?.latitude);
    const origLng = Number(origin?.longitude);
    const destLat = Number(destination?.latitude);
    const destLng = Number(destination?.longitude);

    if (
      origin?.latitude === undefined ||
      origin?.latitude === null ||
      origin?.longitude === undefined ||
      origin?.longitude === null ||
      destination?.latitude === undefined ||
      destination?.latitude === null ||
      destination?.longitude === undefined ||
      destination?.longitude === null ||
      !Number.isFinite(origLat) ||
      !Number.isFinite(origLng) ||
      !Number.isFinite(destLat) ||
      !Number.isFinite(destLng) ||
      origLat < -90 ||
      origLat > 90 ||
      origLng < -180 ||
      origLng > 180 ||
      destLat < -90 ||
      destLat > 90 ||
      destLng < -180 ||
      destLng > 180
    ) {
      return res.status(400).json({
        success: false,
        available: false,
        error: 'Valid origin and destination coordinates are required',
      });
    }

    const modeMap: Record<string, 'DRIVE' | 'WALK' | 'TWO_WHEELER' | 'TRANSIT'> = {
      DRIVE: 'DRIVE',
      DRIVING: 'DRIVE',
      WALK: 'WALK',
      WALKING: 'WALK',
      TWO_WHEELER: 'TWO_WHEELER',
      BICYCLING: 'TWO_WHEELER',
      TRANSIT: 'TRANSIT',
    };
    const normalizedMode = modeMap[String(rawTravelMode).toUpperCase().trim()];
    if (!normalizedMode) {
      return res.status(400).json({
        success: false,
        available: false,
        error: 'Unsupported travelMode. Allowed: DRIVE, WALK, TWO_WHEELER, TRANSIT',
      });
    }

    const gmpApiKey = process.env.GOOGLE_MAPS_PLATFORM_KEY || '';
    if (!gmpApiKey) {
      return res.json({
        success: true,
        available: false,
        unavailableReason: 'Routes service not configured',
      });
    }

    const requestBody: Record<string, any> = {
      origin: {
        location: { latLng: { latitude: origLat, longitude: origLng } },
      },
      destination: {
        location: { latLng: { latitude: destLat, longitude: destLng } },
      },
      travelMode: normalizedMode,
      computeAlternativeRoutes: false,
      languageCode: typeof languageCode === 'string' && languageCode.trim() ? languageCode : 'en-US',
      units: 'METRIC',
    };

    // routingPreference is only supported for DRIVE and TWO_WHEELER
    if (normalizedMode === 'DRIVE' || normalizedMode === 'TWO_WHEELER') {
      requestBody.routingPreference = 'TRAFFIC_AWARE';
    }

    const routeRes = await fetch('https://routes.googleapis.com/directions/v2:computeRoutes', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'X-Goog-Api-Key': gmpApiKey,
        'X-Goog-Maps-Solution-ID': GMP_SOLUTION_ID,
        'X-Goog-FieldMask': 'routes.distanceMeters,routes.duration,routes.localizedValues',
      },
      body: JSON.stringify(requestBody),
      signal: AbortSignal.timeout(7000),
    });

    if (!routeRes.ok) {
      const errText = await routeRes.text().catch(() => '');
      if (isGmpQuotaError(routeRes.status, errText)) {
        return res.status(429).json({
          success: false,
          available: false,
          quotaExceeded: true,
          error: 'Google Routes API quota exceeded',
        });
      }
      return res.json({
        success: true,
        available: false,
        unavailableReason: `Route unavailable for ${normalizedMode} mode`,
      });
    }

    const data = await routeRes.json();
    const firstRoute = data?.routes?.[0];
    if (!firstRoute) {
      return res.json({
        success: true,
        available: false,
        unavailableReason: `No ${normalizedMode.toLowerCase()} route found between these coordinates`,
      });
    }

    const distanceMeters = typeof firstRoute.distanceMeters === 'number' ? firstRoute.distanceMeters : undefined;
    const durationMatch = typeof firstRoute.duration === 'string' ? firstRoute.duration.match(/^([\d.]+)s$/) : null;
    const durationSeconds = durationMatch ? Math.round(parseFloat(durationMatch[1])) : undefined;

    return res.json({
      success: true,
      available: true,
      route: {
        available: true,
        travelMode: normalizedMode,
        distanceMeters,
        distanceKm: typeof distanceMeters === 'number' ? Math.round((distanceMeters / 1000) * 10) / 10 : undefined,
        durationSeconds,
        localizedDistanceText: firstRoute.localizedValues?.distance?.text,
        localizedDurationText: firstRoute.localizedValues?.duration?.text,
      },
    });
  } catch (error: any) {
    console.error('Error in /api/routes/compute:', error);
    return res.status(500).json({
      success: false,
      available: false,
      error: 'Failed to compute route',
    });
  }
});

// Discover Real Nearby Spots around the user's exact current GPS location
// Architecture: GPS Coordinates -> Google Places (New) / OpenStreetMap / Ground Truth POI index -> Real Places DB -> Gemini AI Storyteller
app.post('/api/discover-nearby-spots', async (req, res) => {
  try {
    const {
      latitude,
      longitude,
      locationName = 'Current Location',
      city = '',
      language = 'English',
      category = 'all',
      radiusMeters = 10000,
    } = req.body || {};

    if (latitude === undefined || latitude === null || longitude === undefined || longitude === null) {
      return res.status(400).json({ success: false, error: 'Valid latitude and longitude are required', spots: [] });
    }

    const lat = Number(latitude);
    const lng = Number(longitude);
    if (!Number.isFinite(lat) || !Number.isFinite(lng) || lat < -90 || lat > 90 || lng < -180 || lng > 180) {
      return res.status(400).json({ success: false, error: 'Invalid latitude or longitude coordinates', spots: [] });
    }

    const ai = getGenAI();
    const gmpApiKey = process.env.GOOGLE_MAPS_PLATFORM_KEY || '';
    const parsedRadius = Number(radiusMeters);

    const { areaOverview, spots, groundTruthCount, quotaExceeded, sources } = await getRealNearbyPlaces({
      latitude: lat,
      longitude: lng,
      locationName,
      city,
      language,
      gmpApiKey,
      aiClient: ai,
      category: typeof category === 'string' ? category : 'all',
      radiusMeters: Number.isFinite(parsedRadius) && parsedRadius > 0 ? parsedRadius : 10000,
    });

    if (quotaExceeded && spots.length === 0) {
      return res.status(429).json({
        success: false,
        quotaExceeded: true,
        error: 'Google Places API quota exceeded',
        spots: [],
      });
    }

    return res.json({
      success: true,
      areaOverview,
      spots,
      groundTruthCount,
      sources,
      locationName,
      city,
      ...(quotaExceeded ? { quotaExceeded: true } : {}),
    });
  } catch (error: any) {
    console.error('Error in discover-nearby-spots:', error);
    const status = error?.status === 400 ? 400 : 500;
    return res.status(status).json({
      success: false,
      error: error?.message || 'Failed to discover nearby spots',
      spots: [],
    });
  }
});

// Location Overview endpoint: Provides representative authentic photo & overview of current GPS/selected area
app.post('/api/location-overview', async (req, res) => {
  const { latitude, longitude, locationName = 'Current GPS Area', city = '', country = '', language = 'English' } = req.body || {};
  if (latitude === undefined || latitude === null || longitude === undefined || longitude === null) {
    return res.status(400).json({ success: false, error: 'Valid latitude and longitude are required' });
  }
  const lat = Number(latitude);
  const lng = Number(longitude);
  if (!Number.isFinite(lat) || !Number.isFinite(lng) || lat < -90 || lat > 90 || lng < -180 || lng > 180) {
    return res.status(400).json({ success: false, error: 'Invalid latitude or longitude coordinates' });
  }
  const cleanCity = !isGenericLocationLabel(city) ? String(city).trim() : '';
  const cleanLocationName = !isGenericLocationLabel(locationName) ? String(locationName).trim() : (cleanCity || 'Current GPS Area');
  const cacheKey = `loc-overview-${lat.toFixed(2)}-${lng.toFixed(2)}-${encodeURIComponent(cleanCity)}-${language}`;

  const cached = getCached(cacheKey);
  if (cached && cached.photoUrl) {
    return res.json({ success: true, ...cached });
  }

  const gmpApiKey = process.env.GOOGLE_MAPS_PLATFORM_KEY || '';
  const matchedPopularCity = cleanCity
    ? POPULAR_CITIES.find((c) => c.name.toLowerCase() === cleanCity.toLowerCase())
    : undefined;
  const ai = getGenAI();
  const prompt = `Provide a grounded tourist overview of the user's current geographic area:
Area/Place: "${cleanLocationName}"
City: "${cleanCity || 'Unresolved city name'}", Country: "${country || ''}"
Coordinates: Lat ${lat}, Lng ${lng}
Language: "${language}"

Constraints:
- Stay strictly grounded in the given city/coordinates. Never describe a different city.
- If the city name is unresolved, keep the description neutral and geographically safe without inventing landmark names.

Return JSON:
- "headline": Engaging place title (e.g. "Welcome to Nagpur" or "Exploring Current GPS Area")
- "description": 2 sentence overview of this exact geographic zone's character and atmosphere
- "photoKeyword": best keyword for an image of this place
- "localMustDos": 3 short practical bullet points for exploring nearby
- "currentAtmosphere": e.g. "Cultural Hub", "Historic Old Town", "Local Neighborhood"`;

  // Run Priority 1-4 photo lookup and AI overview generation in parallel
  const photoPromise = Promise.race([
    resolveRepresentativeLocationPhoto({
      city: cleanCity,
      country,
      locationName: cleanLocationName,
      lat,
      lng,
      curatedCityPhotoUrl: matchedPopularCity?.photoUrl,
      apiKey: gmpApiKey,
    }).catch(() => null),
    new Promise<null>((resolve) => setTimeout(() => resolve(null), 4000)),
  ]);

  let resolvedPhotoUrl = '';
  let resolvedPhotoMeta: {
    photoSubjectName?: string;
    placeId?: string;
    authorAttributions: any[];
    photos: any[];
  } = {
    authorAttributions: [],
    photos: [],
  };

  try {
    const [photoResult, aiRes] = await Promise.all([
      photoPromise,
      generateContentWithFallback(ai, {
        model: 'gemini-3.1-flash-lite',
        contents: prompt,
        config: {
          responseMimeType: 'application/json',
          responseSchema: {
            type: Type.OBJECT,
            properties: {
              headline: { type: Type.STRING },
              description: { type: Type.STRING },
              photoKeyword: { type: Type.STRING },
              localMustDos: {
                type: Type.ARRAY,
                items: { type: Type.STRING },
              },
              currentAtmosphere: { type: Type.STRING },
            },
            required: ['headline', 'description', 'localMustDos', 'currentAtmosphere'],
          },
        },
      }),
    ]);

    if (photoResult?.hasRealPhoto && photoResult.photoUrl) {
      resolvedPhotoUrl = photoResult.photoUrl;
      resolvedPhotoMeta = {
        photoSubjectName: photoResult.photoSubjectName,
        placeId: photoResult.placeId,
        authorAttributions: photoResult.authorAttributions || [],
        photos: photoResult.photos || [],
      };
    }

    const parsed = safeJsonParse<any>(aiRes.text, {});

    const resultData = {
      headline: parsed.headline || `Welcome to ${cleanLocationName}`,
      description:
        parsed.description ||
        (cleanCity
          ? `Exploring ${cleanLocationName}. Discover verified local sights, or point your camera at any landmark or object for instant audio guide narration.`
          : 'Exploring your current GPS area. Point your camera at any sight nearby or open Attractions to discover verified places around you.'),
      localMustDos: parsed.localMustDos || ['Point camera at nearby sights', 'Explore local streets', 'Open Attractions nearby'],
      currentAtmosphere: parsed.currentAtmosphere || (cleanCity ? 'Local Cultural Hub' : 'GPS Area'),
      photoUrl: resolvedPhotoUrl || '',
      photoUnavailable: !resolvedPhotoUrl,
      photoSubjectName: resolvedPhotoMeta.photoSubjectName,
      placeId: resolvedPhotoMeta.placeId,
      authorAttributions: resolvedPhotoMeta.authorAttributions,
      photos: resolvedPhotoMeta.photos,
      latitude: lat,
      longitude: lng,
      locationName: cleanLocationName,
      city: cleanCity,
    };

    if (resolvedPhotoUrl) {
      setCached(cacheKey, resultData, 600);
    }
    res.json({ success: true, ...resultData });
  } catch (error: any) {
    console.warn('Location overview fallback used:', error?.message || error);
    const fallbackData = {
      headline: `Welcome to ${cleanLocationName}`,
      description: cleanCity
        ? `Exploring ${cleanLocationName}. Point your camera at any monument, temple, statue, or local sight for instant multilingual audio tour narration.`
        : 'Exploring your current GPS area. Point your camera at any nearby sight or select a city to browse curated highlights.',
      localMustDos: [
        'Point camera at historic facades & sights',
        'Explore authentic local attractions nearby',
        'Tap any nearby spot for live audio guide narration',
      ],
      currentAtmosphere: cleanCity ? 'Local Cultural Precinct' : 'GPS Area',
      photoUrl: resolvedPhotoUrl || '',
      photoUnavailable: !resolvedPhotoUrl,
      photoSubjectName: resolvedPhotoMeta.photoSubjectName,
      placeId: resolvedPhotoMeta.placeId,
      authorAttributions: resolvedPhotoMeta.authorAttributions,
      photos: resolvedPhotoMeta.photos,
      latitude: lat,
      longitude: lng,
      locationName: cleanLocationName,
      city: cleanCity,
    };

    if (resolvedPhotoUrl) {
      setCached(cacheKey, fallbackData, 300);
    }
    res.json({
      success: true,
      ...fallbackData,
    });
  }
});

const proxyHeritageUrl = (url: string) => `/api/places/proxy-image?url=${encodeURIComponent(url)}`;

// Curated Popular Indian & Global Cities with coordinates and highlights
const POPULAR_CITIES = [
  {
    name: 'Nagpur',
    state: 'Maharashtra',
    country: 'India',
    latitude: 21.1458,
    longitude: 79.0882,
    tagline: 'The Orange City & Zero Mile Center of India',
    photoUrl: proxyHeritageUrl('https://upload.wikimedia.org/wikipedia/commons/thumb/d/d4/Dheekshabhoomi_in_Nagpur.jpg/960px-Dheekshabhoomi_in_Nagpur.jpg'),
    topLandmarks: ['Deekshabhoomi', 'Shree Ganesh Mandir Tekdi', 'Futala Lake', 'Sitabuldi Fort', 'Zero Mile Stone'],
    famousFoods: ['Nagpur Tarri Poha', 'Saoji Mutton & Chicken', 'Haldiram\'s Sweets', 'Orange Barfi']
  },
  {
    name: 'Madurai',
    state: 'Tamil Nadu',
    country: 'India',
    latitude: 9.9195,
    longitude: 78.1193,
    tagline: 'The Ancient City of Temples & Jasmine',
    photoUrl: '',
    topLandmarks: ['Meenakshi Amman Temple', 'Thirumalai Nayakkar Palace', 'Gandhi Memorial Museum', 'Vandiyur Mariamman Teppakulam'],
    famousFoods: ['Jigarthanda', 'Madurai Kari Dosa', 'Bun Parotta', 'Filter Coffee']
  },
  {
    name: 'Varanasi',
    state: 'Uttar Pradesh',
    country: 'India',
    latitude: 25.3176,
    longitude: 82.9739,
    tagline: 'The Spiritual Capital of India & Sacred Ganga Ghats',
    photoUrl: '',
    topLandmarks: ['Kashi Vishwanath Temple', 'Dashashwamedh Ghat', 'Assi Ghat', 'Sarnath Buddhist Complex'],
    famousFoods: ['Banarasi Paan', 'Kachori Sabzi', 'Malaiyo', 'Banarasi Lassi']
  },
  {
    name: 'Jaipur',
    state: 'Rajasthan',
    country: 'India',
    latitude: 26.9124,
    longitude: 75.7873,
    tagline: 'The Pink City of Royal Forts & Palaces',
    photoUrl: proxyHeritageUrl('https://upload.wikimedia.org/wikipedia/commons/thumb/8/86/Hawa_Mahal_2011.jpg/1200px-Hawa_Mahal_2011.jpg'),
    topLandmarks: ['Hawa Mahal', 'Amer Fort', 'City Palace', 'Jantar Mantar', 'Nahargarh Fort'],
    famousFoods: ['Dal Baati Churma', 'Pyaaz Kachori', 'Ghevar', 'Lassi on MI Road']
  },
  {
    name: 'Mumbai',
    state: 'Maharashtra',
    country: 'India',
    latitude: 18.9220,
    longitude: 72.8347,
    tagline: 'City of Dreams & Victorian Gothic Heritage',
    photoUrl: proxyHeritageUrl('https://upload.wikimedia.org/wikipedia/commons/thumb/c/cd/Gateway_of_India_Mumbai.jpg/1200px-Gateway_of_India_Mumbai.jpg'),
    topLandmarks: ['Gateway of India', 'Chhatrapati Shivaji Maharaj Terminus (CSMT)', 'Marine Drive', 'Elephanta Caves', 'Haji Ali Dargah'],
    famousFoods: ['Vada Pav', 'Pav Bhaji', 'Bombay Duck', 'Brun Maska & Irani Chai']
  },
  {
    name: 'Delhi',
    state: 'Delhi NCR',
    country: 'India',
    latitude: 28.6139,
    longitude: 77.2090,
    tagline: 'The Historic Capital of Empires & Grand Monuments',
    photoUrl: proxyHeritageUrl('https://upload.wikimedia.org/wikipedia/commons/thumb/a/a2/India_Gate_in_New_Delhi_03-2016.jpg/1200px-India_Gate_in_New_Delhi_03-2016.jpg'),
    topLandmarks: ['India Gate', 'Red Fort (Lal Qila)', 'Qutub Minar', 'Humayun\'s Tomb', 'Lotus Temple'],
    famousFoods: ['Chole Bhature', 'Butter Chicken', 'Chandni Chowk Paranthe', 'Dilli Chaat']
  },
  {
    name: 'Amritsar',
    state: 'Punjab',
    country: 'India',
    latitude: 31.6340,
    longitude: 74.8723,
    tagline: 'The Golden City of Peace & Valour',
    photoUrl: '',
    topLandmarks: ['Golden Temple (Harmandir Sahib)', 'Jallianwala Bagh', 'Wagah Border', 'Gobindgarh Fort'],
    famousFoods: ['Amritsari Kulcha', 'Langar Prashad', 'Lassi', 'Maa ki Dal']
  },
  {
    name: 'Hampi',
    state: 'Karnataka',
    country: 'India',
    latitude: 15.3350,
    longitude: 76.4600,
    tagline: 'UNESCO World Heritage Ruins of Vijayanagara Empire',
    photoUrl: '',
    topLandmarks: ['Vittala Temple Stone Chariot', 'Virupaksha Temple', 'Lotus Mahal', 'Matanga Hill Viewpoint'],
    famousFoods: ['South Indian Thali', 'Badam Milk', 'Bisi Bele Bath', 'Fresh Coconut Water']
  },
  {
    name: 'Agra',
    state: 'Uttar Pradesh',
    country: 'India',
    latitude: 27.1751,
    longitude: 78.0421,
    tagline: 'Home of the Taj Mahal & Mughal Splendor',
    photoUrl: proxyHeritageUrl('https://upload.wikimedia.org/wikipedia/commons/thumb/1/1d/Taj_Mahal_%28Edited%29.jpeg/960px-Taj_Mahal_%28Edited%29.jpeg'),
    topLandmarks: ['Taj Mahal', 'Agra Fort', 'Fatehpur Sikri', 'Itmad-ud-Daulah (Baby Taj)'],
    famousFoods: ['Agra Petha (Angoori & Kesar)', 'Bedmi Puri', 'Mughlai Biryani', 'Dalmoth']
  }
];

// Endpoint: Search Cities (POPULAR_CITIES + Google Geocoding v4 + Places Text Search + Nominatim fallback)
app.post('/api/city/search', async (req, res) => {
  try {
    const rawQuery = typeof req.body?.query === 'string' ? req.body.query.trim() : '';
    const cleanQuery = rawQuery.toLowerCase();

    if (!cleanQuery) {
      return res.json({ success: true, cities: POPULAR_CITIES });
    }

    const matchedPopular = POPULAR_CITIES.filter(
      (c) =>
        c.name.toLowerCase().includes(cleanQuery) ||
        c.state.toLowerCase().includes(cleanQuery) ||
        c.tagline.toLowerCase().includes(cleanQuery) ||
        c.country.toLowerCase().includes(cleanQuery)
    );

    if (matchedPopular.length >= 3) {
      return res.json({ success: true, cities: matchedPopular });
    }

    const combined: Array<{
      name: string;
      state: string;
      country: string;
      latitude: number;
      longitude: number;
      tagline: string;
      photoUrl: string;
      topLandmarks: string[];
      famousFoods: string[];
      placeId?: string;
    }> = [...matchedPopular];
    let quotaExceeded = false;
    const gmpApiKey = process.env.GOOGLE_MAPS_PLATFORM_KEY || '';

    // 1. Google Geocoding API v4 forward address lookup
    if (gmpApiKey) {
      try {
        const v4Url = `https://geocode.googleapis.com/v4/geocode/address/${encodeURIComponent(rawQuery)}`;
        const v4Res = await fetch(v4Url, {
          headers: {
            'X-Goog-Api-Key': gmpApiKey,
            'X-Goog-Maps-Solution-ID': GMP_SOLUTION_ID,
            'X-Goog-FieldMask':
              'results.placeId,results.location,results.formattedAddress,results.postalAddress,results.addressComponents',
          },
          signal: AbortSignal.timeout(4500),
        });

        if (!v4Res.ok) {
          const errText = await v4Res.text().catch(() => '');
          if (isGmpQuotaError(v4Res.status, errText)) {
            quotaExceeded = true;
          }
        } else {
          const v4Data = await v4Res.json();
          const results: any[] = v4Data?.results || [];
          for (const item of results.slice(0, 6)) {
            const loc = item.location;
            if (!loc || !Number.isFinite(loc.latitude) || !Number.isFinite(loc.longitude)) continue;
            const comps: Array<{ longText?: string; types?: string[] }> = item.addressComponents || [];
            const findComp = (...t: string[]) =>
              comps.find((c) => c.types?.some((ct) => t.includes(ct)))?.longText || '';
            const cityName =
              findComp('locality') ||
              item.postalAddress?.locality ||
              findComp('administrative_area_level_2', 'administrative_area_level_1') ||
              item.formattedAddress?.split(',')[0]?.trim() ||
              rawQuery;
            const state = findComp('administrative_area_level_1') || item.postalAddress?.administrativeArea || '';
            const country = findComp('country') || '';

            if (!combined.some((x) => x.name.toLowerCase() === cityName.toLowerCase() && x.country.toLowerCase() === country.toLowerCase())) {
              combined.push({
                name: cityName,
                state,
                country,
                latitude: loc.latitude,
                longitude: loc.longitude,
                tagline: item.formattedAddress || [cityName, state, country].filter(Boolean).join(', '),
                photoUrl: '',
                topLandmarks: [],
                famousFoods: [],
                placeId: item.placeId,
              });
            }
          }
        }
      } catch (e) {
        console.warn('Google Geocoding v4 city search failed:', e);
      }

      // 2. Google Places Text Search supplement if Geocoding returned fewer matches and no quota hit
      if (!quotaExceeded && combined.length < 3) {
        try {
          const ptRes = await searchGooglePlacesText({
            textQuery: rawQuery,
            includedType: 'locality',
            languageCode: 'en',
            apiKey: gmpApiKey,
          });
          if (ptRes.quotaExceeded) {
            quotaExceeded = true;
          }
          for (const p of ptRes.places.slice(0, 5)) {
            const parts = (p.formattedAddress || '').split(',').map((s) => s.trim());
            const country = parts.length > 0 ? parts[parts.length - 1] : '';
            const state = parts.length > 2 ? parts[parts.length - 2] : '';
            if (!combined.some((x) => x.name.toLowerCase() === p.name.toLowerCase())) {
              combined.push({
                name: p.name,
                state,
                country,
                latitude: p.latitude,
                longitude: p.longitude,
                tagline: p.formattedAddress || p.addressOrLocality || p.name,
                photoUrl: p.imageUrl || '',
                topLandmarks: [],
                famousFoods: [],
                placeId: p.googlePlaceId || p.placeId,
              });
            }
          }
        } catch (e) {
          console.warn('Google Places Text Search city lookup failed:', e);
        }
      }
    }

    if (quotaExceeded && combined.length === 0) {
      return res.status(429).json({
        success: false,
        quotaExceeded: true,
        error: 'Google Maps quota exceeded for city search',
        cities: [],
      });
    }

    if (combined.length > matchedPopular.length) {
      return res.json({
        success: true,
        cities: combined,
        ...(quotaExceeded ? { quotaExceeded: true } : {}),
      });
    }

    // 3. Fallback: OpenStreetMap Nominatim without inventing fake landmarks/photos
    try {
      const nominatimUrl = `https://nominatim.openstreetmap.org/search?format=json&q=${encodeURIComponent(rawQuery)}&limit=6&addressdetails=1`;
      const nomRes = await fetch(nominatimUrl, {
        headers: { 'User-Agent': 'CharaivaCitySearch/1.0' },
        signal: AbortSignal.timeout(3500),
      });

      if (nomRes.ok) {
        const nomData = await nomRes.json();
        const customMatches = nomData
          .filter((item: any) => Number.isFinite(parseFloat(item.lat)) && Number.isFinite(parseFloat(item.lon)))
          .map((item: any) => ({
            name: item.address?.city || item.address?.town || item.address?.state_district || item.name,
            state: item.address?.state || item.address?.county || '',
            country: item.address?.country || '',
            latitude: parseFloat(item.lat),
            longitude: parseFloat(item.lon),
            tagline: `Destination in ${[item.address?.state, item.address?.country].filter(Boolean).join(', ') || 'Region'}`,
            photoUrl: '',
            topLandmarks: [],
            famousFoods: [],
          }));

        for (const cm of customMatches) {
          if (cm.name && !combined.some((x) => x.name.toLowerCase() === cm.name.toLowerCase())) {
            combined.push(cm);
          }
        }
        return res.json({
          success: true,
          cities: combined,
          ...(quotaExceeded ? { quotaExceeded: true } : {}),
        });
      }
    } catch (e) {
      console.warn('Nominatim city search failed:', e);
    }

    return res.json({
      success: true,
      cities: combined,
      ...(quotaExceeded ? { quotaExceeded: true } : {}),
    });
  } catch (error: any) {
    console.error('Error in city search:', error);
    return res.status(500).json({ success: false, error: 'City search failed', cities: [] });
  }
});

// Worldwide Location Endpoints: Countries -> States/Regions -> Cities/Towns/Villages + Place ID Resolution
app.get('/api/locations/countries', (req, res) => {
  try {
    const query = typeof req.query?.q === 'string' ? req.query.q : '';
    const language = typeof req.query?.language === 'string' ? req.query.language : 'en';
    const limit = Math.min(250, Math.max(10, Number(req.query?.limit) || 250));
    const countries = searchWorldwideCountries(query, language, limit);
    return res.json({ success: true, countries });
  } catch (error: any) {
    console.error('Error in /api/locations/countries:', error);
    return res.status(500).json({ success: false, error: 'Could not load countries', countries: [] });
  }
});

app.get('/api/locations/states', (req, res) => {
  try {
    const countryCode = typeof req.query?.countryCode === 'string' ? req.query.countryCode : '';
    const query = typeof req.query?.q === 'string' ? req.query.q : '';
    const limit = Math.min(120, Math.max(10, Number(req.query?.limit) || 80));
    if (!countryCode || countryCode.trim().length !== 2) {
      return res.status(400).json({ success: false, error: 'Valid 2-letter countryCode is required', states: [], hasStates: false });
    }
    const result = getStatesForCountry(countryCode, query, limit);
    return res.json({ success: true, ...result });
  } catch (error: any) {
    console.error('Error in /api/locations/states:', error);
    return res.status(500).json({ success: false, error: 'Could not load states', states: [], hasStates: false });
  }
});

app.post('/api/locations/cities', async (req, res) => {
  try {
    const { countryCode, countryName, stateCode, stateName, query, language, sessionToken, limit } = req.body || {};
    if (!countryCode || typeof countryCode !== 'string' || countryCode.trim().length !== 2) {
      return res.status(400).json({ success: false, error: 'Valid 2-letter countryCode is required', cities: [] });
    }
    const result = await searchWorldwideSettlements({
      countryCode,
      countryName,
      stateCode,
      stateName,
      query,
      language,
      sessionToken,
      limit,
    });
    if (result.quotaExceeded && result.cities.length === 0) {
      return res.status(429).json({
        success: false,
        quotaExceeded: true,
        error: 'Location search quota temporarily exceeded',
        cities: [],
      });
    }
    return res.json({
      success: true,
      cities: result.cities,
      providerErrors: result.providerErrors,
      ...(result.quotaExceeded ? { quotaExceeded: true } : {}),
    });
  } catch (error: any) {
    console.error('Error in /api/locations/cities:', error);
    return res.status(500).json({ success: false, error: 'Settlement search failed', cities: [] });
  }
});

app.post('/api/locations/resolve-place', async (req, res) => {
  try {
    const {
      placeId,
      sessionToken,
      expectedCountryCode,
      expectedCountryName,
      expectedStateName,
      expectedStateCode,
      fallbackName,
      language,
    } = req.body || {};
    if (!placeId || typeof placeId !== 'string') {
      return res.status(400).json({ success: false, error: 'placeId is required' });
    }
    const result = await resolveLocationPlaceDetails({
      placeId,
      sessionToken,
      expectedCountryCode,
      expectedCountryName,
      expectedStateName,
      expectedStateCode,
      fallbackName,
      language,
    });
    if (result.quotaExceeded) {
      return res.status(429).json(result);
    }
    if (!result.success) {
      return res.status(422).json(result);
    }
    return res.json(result);
  } catch (error: any) {
    console.error('Error in /api/locations/resolve-place:', error);
    return res.status(500).json({ success: false, error: 'Failed to resolve place details' });
  }
});

// Endpoint: Rich City Overview & In-Depth Guide (Two-Tier Information)
app.post('/api/city/info', async (req, res) => {
  try {
    const { city, state = '', country = 'India', language = 'English' } = req.body;
    const targetCity = city || 'Nagpur';

    const cacheKey = `city_guide_${targetCity.toLowerCase()}_${language.toLowerCase()}`;
    const cached = getCached(cacheKey);
    if (cached) {
      return res.json({ success: true, ...cached });
    }

    // Check if we have verified ground truth / curated preset for this city
    const popularPreset = POPULAR_CITIES.find(
      (c) => c.name.toLowerCase() === targetCity.toLowerCase()
    );

    const ai = getGenAI();
    const gmpApiKey = process.env.GOOGLE_MAPS_PLATFORM_KEY || '';
    const prompt = `You are Charaiva, the world-renowned AI heritage historian and tourist guide.
Generate a structured, captivating, and highly accurate TWO-TIER City Tourist Dossier for the city: "${targetCity}", State: "${state}", Country: "${country}".
Language Requirement: Produce ALL text fields strictly in "${language}".

Return JSON strictly matching this schema:
Tier 1 (Brief Overview):
- "cityName": string
- "state": string
- "country": string
- "moniker": string (e.g. "The Orange City & Tiger Capital of India" or "City of Temples")
- "briefOverview": string (2-3 vivid, informative paragraphs summarizing the city's essence, significance, and travel appeal)
- "quickHighlights": string[] (4-5 key highlights/facts)
- "famousFoods": string[] (4-5 iconic dishes and where to eat them)
- "bestTimeToVisit": string (e.g. "October to March (Pleasant winter, 12°C - 28°C)")
- "climateAndGeography": string (1-2 sentences on geographical setting and climate)

Tier 2 (In-Depth Guide - for "Explore More"):
- "foundingAndHistory": string (2-3 detailed paragraphs about the founding rulers/dynasties, historical eras, transformations)
- "architecturalHeritage": string (detailed breakdown of prominent temple, fort, colonial, and modern architectural styles)
- "culinaryTrail": string (insider guide to famous food streets, historic sweet houses, and signature local flavors)
- "topDistricts": array of objects with { "name": string, "character": string, "mustSee": string } (3-4 top neighborhoods)
- "visitorInsiderTips": string[] (4-5 practical tips on local transit, best times, cultural etiquette, shopping)`;

    // Resolve photo and AI city dossier concurrently
    const photoLookupPromise = popularPreset?.photoUrl
      ? Promise.resolve(popularPreset.photoUrl)
      : Promise.race([
          resolveExactPlacePhotoWithGooglePlaces(
            targetCity,
            state || country,
            popularPreset?.latitude,
            popularPreset?.longitude,
            undefined,
            gmpApiKey
          )
            .then(async (r) => {
              if (r.hasRealPhoto && r.photoUrl) return r.photoUrl;
              if (popularPreset && Number.isFinite(popularPreset.latitude) && Number.isFinite(popularPreset.longitude)) {
                const rep = await resolveRepresentativeLocationPhoto({
                  city: targetCity,
                  country,
                  lat: popularPreset.latitude,
                  lng: popularPreset.longitude,
                  apiKey: gmpApiKey,
                });
                return rep.hasRealPhoto && rep.photoUrl ? rep.photoUrl : '';
              }
              return '';
            })
            .catch(() => ''),
          new Promise<string>((resolve) => setTimeout(() => resolve(''), 3500)),
        ]);

    const [resolvedPhoto, aiRes] = await Promise.all([
      photoLookupPromise,
      generateContentWithFallback(ai, {
        model: 'gemini-3.1-flash-lite',
        contents: prompt,
        config: {
          responseMimeType: 'application/json',
          responseSchema: {
            type: Type.OBJECT,
            properties: {
              cityName: { type: Type.STRING },
              state: { type: Type.STRING },
              country: { type: Type.STRING },
              moniker: { type: Type.STRING },
              briefOverview: { type: Type.STRING },
              quickHighlights: { type: Type.ARRAY, items: { type: Type.STRING } },
              famousFoods: { type: Type.ARRAY, items: { type: Type.STRING } },
              bestTimeToVisit: { type: Type.STRING },
              climateAndGeography: { type: Type.STRING },
              foundingAndHistory: { type: Type.STRING },
              architecturalHeritage: { type: Type.STRING },
              culinaryTrail: { type: Type.STRING },
              topDistricts: {
                type: Type.ARRAY,
                items: {
                  type: Type.OBJECT,
                  properties: {
                    name: { type: Type.STRING },
                    character: { type: Type.STRING },
                    mustSee: { type: Type.STRING },
                  },
                  required: ['name', 'character', 'mustSee'],
                },
              },
              visitorInsiderTips: { type: Type.ARRAY, items: { type: Type.STRING } },
            },
            required: [
              'cityName',
              'moniker',
              'briefOverview',
              'quickHighlights',
              'famousFoods',
              'bestTimeToVisit',
              'foundingAndHistory',
              'architecturalHeritage',
              'culinaryTrail',
              'visitorInsiderTips',
            ],
          },
        },
      }),
    ]);

    const parsed = safeJsonParse<any>(aiRes.text, {});
    const resultData = {
      cityName: parsed.cityName || targetCity,
      state: parsed.state || state,
      country: parsed.country || country,
      moniker: parsed.moniker || popularPreset?.tagline || `Heritage Destination of ${country}`,
      photoUrl: resolvedPhoto || popularPreset?.photoUrl || '',
      briefOverview: parsed.briefOverview || `${targetCity} is a destination in ${country || 'its region'}. Explore nearby verified attractions and local landmarks.`,
      quickHighlights: parsed.quickHighlights || popularPreset?.topLandmarks || [],
      famousFoods: parsed.famousFoods || popularPreset?.famousFoods || [],
      bestTimeToVisit: parsed.bestTimeToVisit || 'Not available',
      climateAndGeography: parsed.climateAndGeography || 'Not available',
      inDepthGuide: {
        foundingAndHistory: parsed.foundingAndHistory || `${targetCity} has historical roots across its regional eras.`,
        architecturalHeritage: parsed.architecturalHeritage || `Explore local architecture and public spaces across ${targetCity}.`,
        culinaryTrail: parsed.culinaryTrail || `Discover regional dining spots and local eateries in ${targetCity}.`,
        topDistricts: parsed.topDistricts || [],
        visitorInsiderTips: parsed.visitorInsiderTips || []
      }
    };

    setCached(cacheKey, resultData, 1800);
    res.json({ success: true, ...resultData });
  } catch (error: any) {
    console.error('Error generating city guide:', error);
    const targetCity = req.body?.city?.trim();
    if (!targetCity) {
      return res.status(400).json({ success: false, error: 'City name is required' });
    }
    const popularPreset = POPULAR_CITIES.find(
      (c) => c.name.toLowerCase() === targetCity.toLowerCase()
    );
    const state = req.body?.state || popularPreset?.state || '';
    const country = req.body?.country || popularPreset?.country || '';
    const fallbackData = {
      cityName: targetCity,
      state,
      country,
      moniker: popularPreset?.tagline || [state, country].filter(Boolean).join(', ') || targetCity,
      photoUrl: popularPreset?.photoUrl || '',
      briefOverview: `${targetCity}${country ? `, ${country}` : ''} — live city overview is temporarily limited. Use Attractions and Nearby Search to explore verified local sights.`,
      quickHighlights: popularPreset?.topLandmarks || [],
      famousFoods: popularPreset?.famousFoods || [],
      bestTimeToVisit: 'Not available',
      climateAndGeography: 'Not available',
      inDepthGuide: {
        foundingAndHistory: `Historical dossier for ${targetCity} is temporarily unavailable.`,
        architecturalHeritage: `Architectural summary for ${targetCity} is temporarily unavailable.`,
        culinaryTrail: `Culinary trail details for ${targetCity} are temporarily unavailable.`,
        topDistricts: [],
        visitorInsiderTips: []
      }
    };
    res.json({ success: true, ...fallbackData });
  }
});

// =========================================================================
// DISCOVER ENGINE, UNIFIED MULTI-LEVEL EXPLANATION & DETAIL-BY-DETAIL ROUTES
// =========================================================================

// Step 1: Global Discover Search -> Ranked Candidate Matches (supports names, clues, typos, nicknames, voice transcripts, pagination)
app.post('/api/discover/search', async (req, res) => {
  try {
    const { query, language = 'English', offset = 0, limit = 8, latitude, longitude } = req.body || {};
    const cleanQuery = sanitizeUserText(query, 280);
    if (!cleanQuery || cleanQuery.length < 2) {
      return res.status(400).json({
        success: false,
        error: 'Please enter a monument name, sculpture clue, city, artwork, or object description (at least 2 characters).',
        candidates: [],
      });
    }

    const ai = getGenAI();
    const gmpApiKey = process.env.GOOGLE_MAPS_PLATFORM_KEY || '';
    const parsedLat = latitude !== undefined && latitude !== null ? Number(latitude) : undefined;
    const parsedLng = longitude !== undefined && longitude !== null ? Number(longitude) : undefined;

    const result = await searchDiscoverCandidates({
      query: cleanQuery,
      language: sanitizeUserText(language, 40) || 'English',
      offset: Number(offset) || 0,
      limit: Number(limit) || 8,
      latitude: Number.isFinite(parsedLat) ? parsedLat : undefined,
      longitude: Number.isFinite(parsedLng) ? parsedLng : undefined,
      aiClient: ai,
      gmpApiKey,
    });

    return res.json({
      success: true,
      ...result,
    });
  } catch (error: any) {
    if (isGeminiQuotaExhaustedError(error)) {
      console.info('[DiscoverAPI] Gemini quota limit reached (429) on /api/discover/search.');
      return res.status(429).json({
        success: false,
        quotaExceeded: true,
        error: 'Gemini AI quota limit reached right now. Please wait a moment and try again, or check your Gemini API key in Settings > Secrets.',
        candidates: [],
      });
    }
    console.error('Error in /api/discover/search:', error);
    return res.status(500).json({
      success: false,
      error: 'Search temporarily unavailable. Please try again.',
      candidates: [],
    });
  }
});

// Step 1B: Live Search Autocomplete (supports places, monuments, architectural styles, typos, homonyms & multilingual names)
async function handleDiscoverAutocomplete(req: express.Request, res: express.Response) {
  try {
    const src = req.method === 'GET' ? req.query : req.body || {};
    const cleanQuery = sanitizeUserText(src.query || src.q, 180);
    if (!cleanQuery || cleanQuery.length < 2) {
      return res.json({ success: true, suggestions: [], sanitizedQuery: cleanQuery });
    }

    const ai = getGenAI();
    const gmpApiKey = process.env.GOOGLE_MAPS_PLATFORM_KEY || '';
    const parsedLat = src.latitude !== undefined && src.latitude !== null ? Number(src.latitude) : undefined;
    const parsedLng = src.longitude !== undefined && src.longitude !== null ? Number(src.longitude) : undefined;

    const result = await getDiscoverAutocompleteSuggestions({
      query: cleanQuery,
      language: sanitizeUserText(src.language || 'English', 40) || 'English',
      latitude: Number.isFinite(parsedLat) ? parsedLat : undefined,
      longitude: Number.isFinite(parsedLng) ? parsedLng : undefined,
      aiClient: ai,
      gmpApiKey,
    });

    return res.json({
      success: true,
      ...result,
    });
  } catch (error: any) {
    if (isGeminiQuotaExhaustedError(error)) {
      console.info('[DiscoverAPI] Gemini quota limit reached (429) on /api/discover/autocomplete.');
      return res.status(429).json({
        success: false,
        quotaExceeded: true,
        suggestions: [],
        error: 'Gemini AI quota limit reached right now. Please try again shortly.',
      });
    }
    console.error('Error in /api/discover/autocomplete:', error);
    return res.status(500).json({
      success: false,
      suggestions: [],
      error: 'Autocomplete temporarily unavailable.',
    });
  }
}

app.post('/api/discover/autocomplete', handleDiscoverAutocomplete);
app.get('/api/discover/autocomplete', handleDiscoverAutocomplete);

// Step 2: Complete Unified Explanation (Overview / Detailed / In-Depth / Expert) synced with Language, Persona & Voice
app.post('/api/discover/explain', async (req, res) => {
  try {
    const { candidate, title, category, locationOrOrigin, wikipediaTitle, level = 'standard', language = 'English', guideSettings } = req.body || {};
    const rawTitle = candidate?.title || title;
    const cleanTitle = sanitizeUserText(rawTitle, 180);

    if (!cleanTitle) {
      return res.status(400).json({
        success: false,
        error: 'Subject title or candidate selection is required.',
      });
    }

    const ai = getGenAI();
    const gmpApiKey = process.env.GOOGLE_MAPS_PLATFORM_KEY || '';
    const normalizedLevel =
      level === 'quick' || level === 'deep' || level === 'expert' ? level : 'standard';

    const explanation = await generateDiscoverExplanation({
      candidate: {
        ...(candidate && typeof candidate === 'object' ? candidate : {}),
        title: cleanTitle,
        category: candidate?.category || category,
        locationOrOrigin: candidate?.locationOrOrigin || locationOrOrigin,
        wikipediaTitle: candidate?.wikipediaTitle || wikipediaTitle,
      },
      level: normalizedLevel,
      language: sanitizeUserText(language, 40) || 'English',
      guideSettings,
      aiClient: ai,
      gmpApiKey,
    });

    return res.json({
      success: true,
      ...explanation,
    });
  } catch (error: any) {
    if (isGeminiQuotaExhaustedError(error)) {
      console.info('[DiscoverAPI] Gemini quota limit reached (429) on /api/discover/explain.');
      return res.status(429).json({
        success: false,
        quotaExceeded: true,
        error: 'Gemini AI quota limit reached right now. Please wait a moment and try again, or check your Gemini API plan/billing in Settings > Secrets.',
      });
    }
    if (isTimeoutOrAbortError(error)) {
      console.warn('[DiscoverAPI] Upstream timeout/abort on /api/discover/explain:', error?.message || error);
      return res.status(504).json({
        success: false,
        timedOut: true,
        error: 'The guide request timed out while contacting the AI service. Please try again.',
      });
    }
    console.error('Error in /api/discover/explain:', error);
    return res.status(500).json({
      success: false,
      error: 'Could not generate subject explanation right now.',
    });
  }
});

// Part 6: Expand one of the 5 Dynamic Explore More Suggestions without repeating basic overview
app.post('/api/discover/explore-topic', async (req, res) => {
  try {
    const {
      landmarkTitle,
      title,
      category,
      locationOrOrigin,
      topicId,
      topicTitle,
      topicAngle,
      promptSeed,
      existingSummary,
      level = 'deep',
      language = 'English',
      guideSettings,
    } = req.body || {};

    const cleanSubject = sanitizeUserText(landmarkTitle || title, 180);
    const cleanTopic = sanitizeUserText(topicTitle, 180);

    if (!cleanSubject || !cleanTopic) {
      return res.status(400).json({
        success: false,
        error: 'Subject title and Explore More topic title are required.',
      });
    }

    const ai = getGenAI();
    const expansion = await generateExploreTopicExpansion({
      landmarkTitle: cleanSubject,
      category: sanitizeUserText(category || '', 80),
      locationOrOrigin: sanitizeUserText(locationOrOrigin || '', 140),
      topicId: sanitizeUserText(topicId || '', 60) || undefined,
      topicTitle: cleanTopic,
      topicAngle: sanitizeUserText(topicAngle || '', 60) || undefined,
      promptSeed: sanitizeUserText(promptSeed || '', 260) || undefined,
      existingSummary: sanitizeUserText(existingSummary || '', 500) || undefined,
      level: level === 'quick' || level === 'deep' || level === 'expert' ? level : 'standard',
      language: sanitizeUserText(language, 40) || 'English',
      guideSettings,
      aiClient: ai,
    });

    return res.json({
      success: true,
      expansion,
    });
  } catch (error: any) {
    if (isGeminiQuotaExhaustedError(error)) {
      console.info('[DiscoverAPI] Gemini quota limit reached (429) on /api/discover/explore-topic.');
      return res.status(429).json({
        success: false,
        quotaExceeded: true,
        error: 'Gemini AI quota limit reached right now. Please wait a moment and try again, or check your Gemini API plan/billing in Settings > Secrets.',
      });
    }
    if (isTimeoutOrAbortError(error)) {
      console.warn('[DiscoverAPI] Upstream timeout/abort on /api/discover/explore-topic:', error?.message || error);
      return res.status(504).json({
        success: false,
        timedOut: true,
        error: 'The topic expansion timed out while contacting the AI service. Please try again.',
      });
    }
    console.error('Error in /api/discover/explore-topic:', error);
    return res.status(500).json({
      success: false,
      error: 'Could not expand this exploration topic right now.',
    });
  }
});

// Part 7: Option B — Open Deep Conversation (Context-locked JSON + SSE Stream routes)
app.post('/api/discover/deep-conversation', async (req, res) => {
  try {
    const { context, messages = [], userMessage, language = 'English', guideSettings } = req.body || {};
    if (!context || (!context.landmark?.title && !context.subjectTitle)) {
      return res.status(400).json({
        success: false,
        error: 'Deep Conversation context with subject title is required.',
      });
    }

    const ai = getGenAI();
    const normalizedMessages = Array.isArray(messages)
      ? messages
          .filter((m: any) => m && typeof m.text === 'string' && m.text.trim())
          .map((m: any) => ({
            sender: (m.sender === 'user' ? 'user' : 'assistant') as 'user' | 'assistant',
            text: String(m.text),
          }))
      : [];

    const turn = await generateDeepConversationTurn({
      context,
      messages: normalizedMessages,
      userMessage: userMessage ? sanitizeUserText(userMessage, 600) : undefined,
      language: sanitizeUserText(language || context.landmark?.language || 'English', 40) || 'English',
      guideSettings,
      aiClient: ai,
    });

    return res.json({
      success: true,
      ...turn,
    });
  } catch (error: any) {
    if (isGeminiQuotaExhaustedError(error)) {
      console.info('[DiscoverAPI] Gemini quota limit reached (429) on /api/discover/deep-conversation.');
      return res.status(429).json({
        success: false,
        quotaExceeded: true,
        error: 'Gemini AI quota limit reached right now. Please wait a moment and try again, or check your Gemini API plan/billing in Settings > Secrets.',
      });
    }
    if (isTimeoutOrAbortError(error)) {
      console.warn('[DiscoverAPI] Upstream timeout/abort on /api/discover/deep-conversation:', error?.message || error);
      return res.status(504).json({
        success: false,
        timedOut: true,
        error: 'Deep conversation timed out while contacting the AI service. Please try again.',
      });
    }
    console.error('Error in /api/discover/deep-conversation:', error);
    return res.status(500).json({
      success: false,
      error: 'Deep conversation turn could not be generated right now.',
    });
  }
});

app.post('/api/discover/deep-conversation-stream', async (req, res) => {
  res.setHeader('Content-Type', 'text/event-stream');
  res.setHeader('Cache-Control', 'no-cache, no-transform');
  res.setHeader('Connection', 'keep-alive');
  res.flushHeaders?.();

  try {
    const { context, messages = [], userMessage, language = 'English', guideSettings } = req.body || {};
    if (!context || (!context.landmark?.title && !context.subjectTitle)) {
      res.write(`data: ${JSON.stringify({ type: 'error', message: 'Context required' })}\n\n`);
      return res.end();
    }

    const ai = getGenAI();
    const normalizedMessages = Array.isArray(messages)
      ? messages
          .filter((m: any) => m && typeof m.text === 'string' && m.text.trim())
          .map((m: any) => ({
            sender: (m.sender === 'user' ? 'user' : 'assistant') as 'user' | 'assistant',
            text: String(m.text),
          }))
      : [];

    const turn = await generateDeepConversationTurn({
      context,
      messages: normalizedMessages,
      userMessage: userMessage ? sanitizeUserText(userMessage, 600) : undefined,
      language: sanitizeUserText(language || context.landmark?.language || 'English', 40) || 'English',
      guideSettings,
      aiClient: ai,
    });

    // Stream progressively in clean word chunks for smooth live display
    const words = turn.reply.split(/(\s+)/);
    const step = 12;
    for (let i = 0; i < words.length; i += step) {
      if (res.writableEnded) break;
      res.write(`data: ${JSON.stringify({ type: 'delta', text: words.slice(i, i + step).join('') })}\n\n`);
    }

    res.write(
      `data: ${JSON.stringify({
        type: 'done',
        reply: turn.reply,
        followUpSuggestions: turn.followUpSuggestions,
      })}\n\n`
    );
    return res.end();
  } catch (error: any) {
    const isQuota = isGeminiQuotaExhaustedError(error);
    if (isQuota) {
      console.info('[DiscoverAPI] Gemini quota limit reached (429) on /api/discover/deep-conversation-stream.');
    } else {
      console.error('Error in /api/discover/deep-conversation-stream:', error);
    }
    if (!res.writableEnded) {
      res.write(
        `data: ${JSON.stringify({
          type: 'error',
          quotaExceeded: isQuota,
          message: isQuota
            ? 'Gemini AI quota limit reached right now. Please wait a moment and try again.'
            : 'Stream failed',
        })}\n\n`
      );
      res.end();
    }
  }
});

// Detail-by-Detail Component Explorer & Visual Tap / Ask About This Detail
app.post('/api/discover/detail-by-detail', async (req, res) => {
  try {
    const {
      subjectTitle,
      category,
      locationOrOrigin,
      language = 'English',
      guideSettings,
      question,
      tapCoords,
      imageBase64,
      imageUrl,
      existingComponents,
    } = req.body || {};

    const cleanTitle = sanitizeUserText(subjectTitle, 180);
    if (!cleanTitle) {
      return res.status(400).json({
        success: false,
        error: 'Subject title is required for Detail by Detail analysis.',
      });
    }

    let inlineImage: { mimeType: string; data: string } | null = null;
    const rawImg = imageBase64 || imageUrl;
    if (typeof rawImg === 'string' && rawImg.trim().length > 20) {
      try {
        // Resolve relative proxy URLs cleanly or remote/data URLs safely
        if (rawImg.startsWith('data:') || /^https?:\/\//i.test(rawImg)) {
          inlineImage = await resolveImageToInlinePart(rawImg);
        }
      } catch (imgErr: any) {
        console.warn('Detail-by-Detail optional image skipped:', imgErr?.message || imgErr);
      }
    }

    const rawTapCoords = tapCoords || (req.body && req.body.coordinates);
    const validTapCoords =
      rawTapCoords &&
      Number.isFinite(Number(rawTapCoords.x)) &&
      Number.isFinite(Number(rawTapCoords.y))
        ? {
            x: Math.max(0, Math.min(1, Number(rawTapCoords.x))),
            y: Math.max(0, Math.min(1, Number(rawTapCoords.y))),
          }
        : undefined;

    const ai = getGenAI();
    const detailResult = await analyzeDetailByDetail({
      subjectTitle: cleanTitle,
      category: sanitizeUserText(category || '', 60),
      locationOrOrigin: sanitizeUserText(locationOrOrigin || '', 120),
      language: sanitizeUserText(language, 40) || 'English',
      guideSettings,
      question: sanitizeUserText(question || '', 300),
      tapCoords: validTapCoords,
      inlineImage,
      existingComponents: Array.isArray(existingComponents) ? existingComponents : undefined,
      aiClient: ai,
    });

    return res.json({
      success: true,
      ...detailResult,
    });
  } catch (error: any) {
    if (isGeminiQuotaExhaustedError(error)) {
      console.info('[DiscoverAPI] Gemini quota limit reached (429) on /api/discover/detail-by-detail.');
      return res.status(429).json({
        success: false,
        quotaExceeded: true,
        error: 'Gemini AI quota limit reached right now. Please wait a moment and try again, or check your Gemini API plan/billing in Settings > Secrets.',
      });
    }
    if (isTimeoutOrAbortError(error)) {
      console.warn('[DiscoverAPI] Upstream timeout/abort on /api/discover/detail-by-detail:', error?.message || error);
      return res.status(504).json({
        success: false,
        timedOut: true,
        error: 'Detail analysis timed out while contacting the AI service. Please try again.',
      });
    }
    console.error('Error in /api/discover/detail-by-detail:', error);
    return res.status(500).json({
      success: false,
      error: 'Could not analyze detail components right now.',
    });
  }
});

// Photo Guide Ranked Candidate Matching (supports ambiguous sculptures, inscriptions & everyday objects)
app.post('/api/camera/identify-candidates', async (req, res) => {
  try {
    const { image, imageBase64, imageUrl, coords, location, language = 'English', guideSettings, userPrompt } = req.body || {};
    const rawImg = image || imageBase64 || imageUrl;
    if (!rawImg) {
      return res.status(400).json({ success: false, error: 'Image data is required' });
    }

    const inlineImage = await resolveImageToInlinePart(rawImg);
    const ai = getGenAI();
    const gmpApiKey = process.env.GOOGLE_MAPS_PLATFORM_KEY || '';
    const effectiveCoords = location || coords;

    const result = await identifyPhotoCandidates({
      inlineImage,
      coords: effectiveCoords,
      language: sanitizeUserText(language, 40) || 'English',
      guideSettings,
      userPrompt: sanitizeUserText(userPrompt || '', 260),
      aiClient: ai,
      gmpApiKey,
    });

    return res.json({
      success: true,
      ...result,
    });
  } catch (error: any) {
    if (isGeminiQuotaExhaustedError(error)) {
      console.info('[DiscoverAPI] Gemini quota limit reached (429) on /api/camera/identify-candidates.');
      return res.status(429).json({
        success: false,
        quotaExceeded: true,
        error: 'Gemini AI quota limit reached right now. Please wait a moment and try again, or check your Gemini API plan/billing in Settings > Secrets.',
        candidates: [],
      });
    }
    console.error('Error in /api/camera/identify-candidates:', error);
    const status = error?.status === 400 ? 400 : 500;
    return res.status(status).json({
      success: false,
      error: status === 400 ? error.message : 'Photo candidate identification failed',
      candidates: [],
    });
  }
});

let cachedFirebaseWebApiKey: string | null = null;
function getFirebaseWebApiKey(): string {
  if (cachedFirebaseWebApiKey !== null) return cachedFirebaseWebApiKey;
  try {
    const configPath = path.join(process.cwd(), 'firebase-applet-config.json');
    if (fs.existsSync(configPath)) {
      const parsed = JSON.parse(fs.readFileSync(configPath, 'utf8'));
      cachedFirebaseWebApiKey = typeof parsed?.apiKey === 'string' ? parsed.apiKey.trim() : '';
    } else {
      cachedFirebaseWebApiKey = '';
    }
  } catch {
    cachedFirebaseWebApiKey = '';
  }
  return cachedFirebaseWebApiKey;
}

// Help & Support Feedback Delivery Endpoint -> sends exclusively to charaiva10@gmail.com
app.post('/api/support/feedback', async (req, res) => {
  try {
    const body = req.body || {};
    const forwardedHeader = req.headers['x-forwarded-for'];
    const clientIp = Array.isArray(forwardedHeader)
      ? forwardedHeader[0]
      : typeof forwardedHeader === 'string'
      ? forwardedHeader.split(',')[0].trim()
      : req.ip || 'unknown';

    let verifiedSessionEmail: string | null = null;
    const authHeader = req.headers.authorization;
    if (typeof authHeader === 'string' && authHeader.startsWith('Bearer ')) {
      const idToken = authHeader.slice(7).trim();
      if (!idToken) {
        return res.status(401).json({ success: false, error: 'Invalid authentication token.' });
      }
      try {
        const verified = await verifyFirebaseIdTokenEmail(idToken, getFirebaseWebApiKey());
        if (!verified.verifiedEmail) {
          return res.status(401).json({
            success: false,
            error: 'Signed-in session did not provide a verified email address.',
          });
        }
        verifiedSessionEmail = verified.verifiedEmail;
      } catch (authErr: any) {
        return res.status(401).json({
          success: false,
          errorCode: 'AUTH_ERROR',
          error: authErr?.message || 'Could not verify authenticated session.',
        });
      }
    }

    let validated: ReturnType<typeof validateSupportFeedbackPayload>;
    try {
      validated = validateSupportFeedbackPayload({
        feedbackType: body.feedbackType,
        relatedFeature: body.relatedFeature,
        message: body.message,
        replyEmail: body.replyEmail,
        language: body.language,
        screenshotDataUrl: body.screenshotDataUrl,
        honeypot: body.honeypot,
        isSignedInSession: Boolean(verifiedSessionEmail),
        verifiedSessionEmail,
      });
    } catch (valErr: any) {
      return res.status(400).json({
        success: false,
        errorCode: valErr instanceof SupportValidationError ? valErr.code : 'INVALID_INPUT',
        error: valErr?.message || 'Invalid feedback submission.',
      });
    }

    const rateCheck = checkSupportRateLimitBeforeSend(clientIp, validated.replyEmail, validated.message);
    if (!rateCheck.allowed) {
      return res.status(429).json({
        success: false,
        errorCode: rateCheck.errorCode || 'RATE_LIMITED',
        error: rateCheck.reason || 'Too many submissions. Please try again later.',
      });
    }

    const outcome = await sendSupportFeedbackEmail(validated, {
      isSignedIn: Boolean(verifiedSessionEmail),
    });

    // Record duplicate lock & success window ONLY when provider accepted the email
    recordSupportSubmissionOutcome(clientIp, validated.replyEmail, validated.message, outcome.delivered);

    if (outcome.delivered) {
      return res.status(200).json({
        success: true,
        deliveryStatus: 'sent',
        deliveryStage: outcome.deliveryStage || 'provider_accepted',
        provider: outcome.provider,
        messageId: outcome.messageId,
        recipient: outcome.recipient,
        replyEmail: outcome.replyEmail,
        submittedAt: outcome.submittedAt,
        mailtoUrl: outcome.mailtoUrl,
      });
    }

    if (outcome.deliveryStatus === 'not_configured') {
      return res.status(503).json({
        success: false,
        deliveryStatus: 'not_configured',
        deliveryStage: 'not_accepted',
        errorCode: outcome.errorCode || 'MAIL_NOT_CONFIGURED',
        missingConfig: outcome.missingConfig,
        error: outcome.error,
        recipient: outcome.recipient,
        mailtoUrl: outcome.mailtoUrl,
      });
    }

    return res.status(502).json({
      success: false,
      deliveryStatus: 'delivery_failed',
      deliveryStage: 'not_accepted',
      provider: outcome.provider,
      errorCode: outcome.errorCode || 'SMTP_DELIVERY_FAILED',
      error: outcome.error,
      recipient: outcome.recipient,
      mailtoUrl: outcome.mailtoUrl,
    });
  } catch (error: any) {
    console.error('Unexpected error in /api/support/feedback:', error);
    return res.status(500).json({
      success: false,
      deliveryStatus: 'delivery_failed',
      deliveryStage: 'not_accepted',
      errorCode: 'SMTP_DELIVERY_FAILED',
      error: 'An unexpected server error occurred while processing your feedback.',
    });
  }
});

// Ensure unmatched /api/* endpoints always return structured JSON (never HTML from Vite/SPA catch-all)
app.all('/api/*', (req, res) => {
  res.status(404).json({
    success: false,
    error: 'API endpoint not found',
    code: 'API_NOT_FOUND',
  });
});

// Setup Vite or static serving
async function startServer() {
  if (process.env.NODE_ENV !== 'production') {
    const vite = await createViteServer({
      server: { middlewareMode: true },
      appType: 'spa',
    });
    app.use(vite.middlewares);
  } else {
    const distPath = path.join(process.cwd(), 'dist');
    app.use(express.static(distPath));
    app.get('*', (req, res) => {
      res.sendFile(path.join(distPath, 'index.html'));
    });
  }

  // Centralized JSON error handler so malformed JSON payloads or unexpected errors on /api/* never return HTML
  app.use((err: any, req: express.Request, res: express.Response, next: express.NextFunction) => {
    if (res.headersSent) {
      return next(err);
    }
    const isApiRequest = req.path.startsWith('/api/');
    const status = Number(err?.status || err?.statusCode) || (err?.type === 'entity.parse.failed' ? 400 : 500);
    if (isApiRequest) {
      return res.status(status).json({
        success: false,
        error:
          err?.type === 'entity.parse.failed'
            ? 'Invalid JSON request body'
            : err?.type === 'entity.too.large'
            ? 'Request payload exceeds maximum allowed size'
            : 'Internal API error',
        code:
          err?.type === 'entity.parse.failed'
            ? 'INVALID_JSON_BODY'
            : err?.type === 'entity.too.large'
            ? 'PAYLOAD_TOO_LARGE'
            : 'INTERNAL_API_ERROR',
      });
    }
    return res.status(status).send('Internal server error');
  });

  app.listen(PORT, '0.0.0.0', () => {
    console.log(`Charaiva Tourist Guide Server active on http://0.0.0.0:${PORT}`);
  });
}

startServer();
