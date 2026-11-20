import { GoogleGenAI, ThinkingLevel, Type } from '@google/genai';
import { VERIFIED_GROUND_TRUTH_POIS } from '../src/data/verifiedGroundTruthIndex';
import { WORLD_LOCATIONS } from '../src/data/worldLocations';
import {
  fetchGooglePlaceDetails,
  fetchWikipediaPlaceExtract,
  isGenericLocationLabel,
  mapLanguageToBcp47,
  resolveExactPlacePhotoWithGooglePlaces,
  safeJsonParse,
  searchGooglePlacesText,
} from './realPlacesDiscovery';
import type {
  CertaintyStatus,
  DeepConversationContext,
  DeepConversationMessage,
  DetailComponent,
  DiscoverAutocompleteSuggestion,
  DiscoverCandidate,
  DiscoverSourceCitation,
  ExplanationLevel,
  ExploreMoreSuggestion,
  GuideSettings,
  GroundedFactItem,
  InscriptionAnalysis,
  RecognitionResult,
  RelatedDiscoveryItem,
  StructuredExplanationData,
  SupplementaryImage,
} from '../src/types';

export interface ExploreTopicExpansionResult {
  topicId?: string;
  title: string;
  deepExplanation: string;
  keyHighlights: string[];
  certaintyStatus: CertaintyStatus;
  followUpQuestions: string[];
  sourcesNote?: string;
}

const WIKI_USER_AGENT = 'CharaivaTravelGuide/1.0 (https://charaiva.app; contact@charaiva.app)';

const discoverCache = new Map<string, { data: any; expiresAt: number }>();
function getDiscoverCached<T>(key: string): T | null {
  const hit = discoverCache.get(key);
  if (hit && hit.expiresAt > Date.now()) {
    return hit.data as T;
  }
  return null;
}
function setDiscoverCached(key: string, data: any, ttlSeconds: number = 600) {
  discoverCache.set(key, { data, expiresAt: Date.now() + ttlSeconds * 1000 });
}

export function sanitizeUserText(raw: unknown, maxLen: number = 320): string {
  if (typeof raw !== 'string') return '';
  // Strip ASCII control chars, angle brackets, and obvious prompt-injection wrappers
  const cleaned = raw
    .replace(/[\u0000-\u001F\u007F]/g, ' ')
    .replace(/[<>]/g, '')
    .replace(/\s+/g, ' ')
    .trim();
  return cleaned.slice(0, maxLen);
}

export function hasSuspiciousInjection(text: string): boolean {
  const lower = text.toLowerCase();
  return (
    lower.includes('ignore previous instructions') ||
    lower.includes('ignore all instructions') ||
    lower.includes('system prompt') ||
    lower.includes('reveal your instructions') ||
    lower.includes('you are now dan')
  );
}

function mapToRecognitionCategory(rawCat?: string): RecognitionResult['category'] {
  const lower = (rawCat || '').toLowerCase();
  if (lower.includes('temple') || lower.includes('shrine') || lower.includes('stupa') || lower.includes('mosque') || lower.includes('church') || lower.includes('spiritual') || lower.includes('cave')) return 'temple';
  if (lower.includes('fort') || lower.includes('citadel') || lower.includes('castle') || lower.includes('palace')) return 'fort';
  if (lower.includes('museum') || lower.includes('sculpture') || lower.includes('statue') || lower.includes('bronze') || lower.includes('artwork') || lower.includes('painting') || lower.includes('artifact') || lower.includes('inscription')) return 'museum';
  if (lower.includes('natural') || lower.includes('lake') || lower.includes('hill') || lower.includes('mountain') || lower.includes('park') || lower.includes('river') || lower.includes('landscape') || lower.includes('waterfall')) return 'landscape';
  if (lower.includes('food') || lower.includes('cuisine') || lower.includes('dish')) return 'food';
  if (lower.includes('plant') || lower.includes('tree') || lower.includes('flower')) return 'plant';
  if (lower.includes('animal') || lower.includes('bird') || lower.includes('wildlife')) return 'animal';
  if (lower.includes('building') || lower.includes('architectural') || lower.includes('tower') || lower.includes('gate') || lower.includes('bridge')) return 'building';
  if (lower.includes('object') || lower.includes('furniture') || lower.includes('tool') || lower.includes('everyday') || lower.includes('coin')) return 'object';
  return 'monument';
}

function normalizeCertainty(raw?: string): CertaintyStatus {
  const lower = (raw || '').toLowerCase().trim();
  if (lower === 'established_fact' || lower.includes('established') || lower.includes('confirmed') || lower.includes('documented')) {
    return 'established_fact';
  }
  if (lower === 'traditional_interpretation' || lower.includes('tradition') || lower.includes('folklore') || lower.includes('myth') || lower.includes('scholarly_debate')) {
    return 'traditional_interpretation';
  }
  if (lower === 'unknown' || lower.includes('unknown') || lower.includes('unverified')) {
    return 'unknown';
  }
  return 'possible_identification';
}

function certaintyLabelFromStatus(status: CertaintyStatus, sourceType: DiscoverCandidate['sourceType']): string {
  if (sourceType === 'ai_suggested') return 'AI Suggested Match — Verify Details';
  if (status === 'established_fact') {
    return sourceType === 'verified_index' ? 'Curated Heritage Record' : 'Encyclopedia / Public Record';
  }
  if (status === 'traditional_interpretation') return 'Traditional / Historical Source';
  if (status === 'unknown') return 'Uncertain Identification';
  return 'Candidate Match';
}

function buildPersonaInstructions(guideSettings?: Partial<GuideSettings>): string {
  const persona = guideSettings?.persona || 'warm_female';
  const voiceGender = guideSettings?.voiceGender || 'female';
  const topics = guideSettings?.topics;
  const activeTopics = topics
    ? Object.entries(topics)
        .filter(([, enabled]) => Boolean(enabled))
        .map(([k]) => k)
    : [];

  let styleLine = `Warm, engaging, accurate ${voiceGender} museum & travel guide narration.`;
  if (persona === 'scholarly') {
    styleLine = 'Scholarly art-historian & archaeologist tone: precise chronology, primary evidence, material analysis, and explicit distinction between proven fact and scholarly hypothesis.';
  } else if (persona === 'adventurous') {
    styleLine = 'Vivid explorer storytelling style with historical atmosphere and sensory detail while staying strictly truthful.';
  } else if (persona === 'concise') {
    styleLine = 'Crisp, structured, scannable walking-guide style focusing on essential takeaways.';
  }

  const topicLine =
    activeTopics.length > 0
      ? `Prioritize user's selected focus dimensions when relevant to this subject: [${activeTopics.join(', ')}].`
      : 'Cover balanced historical, artistic, architectural, cultural, and practical dimensions.';

  return `${styleLine}\n${topicLine}`;
}

export class GeminiQuotaError extends Error {
  status = 429;
  quotaExceeded = true;
  constructor(
    message: string = 'Gemini AI quota limit reached right now. Please wait a moment and retry, or check your Gemini API plan/billing in Settings > Secrets.'
  ) {
    super(message);
    this.name = 'GeminiQuotaError';
  }
}

export function isGeminiQuotaExhaustedError(err: any): boolean {
  if (!err) return false;
  if (err instanceof GeminiQuotaError || err?.quotaExceeded === true) return true;
  const status = Number(err?.status || err?.code || err?.response?.status);
  const msg = String(err?.message || err || '');
  return (
    status === 429 ||
    /429|RESOURCE_EXHAUSTED|exceeded your current quota|RATE_LIMIT_EXCEEDED/i.test(msg)
  );
}

export function isTimeoutOrAbortError(err: any): boolean {
  if (!err) return false;
  const name = String(err?.name || '');
  const msg = String(err?.message || err || '');
  return (
    name === 'AbortError' ||
    name === 'TimeoutError' ||
    /aborted|timeout|timed out|ETIMEDOUT/i.test(msg)
  );
}

let googleSearchCooldownUntil = 0;

export function resetDiscoverQuotaCooldownForTests(): void {
  googleSearchCooldownUntil = 0;
}

async function generateWithActiveModels(
  ai: GoogleGenAI,
  params: {
    model?: string;
    contents: any;
    config?: any;
  }
) {
  const preferred = params.model || 'gemini-3.1-flash-lite';
  const models = Array.from(new Set([preferred, 'gemini-4-hydrogen', 'gemini-3.1-flash-lite']));
  const hasSearchTool = Boolean(params.config && Array.isArray(params.config.tools) && params.config.tools.length > 0);
  let lastErr: any = null;

  for (let i = 0; i < models.length; i++) {
    const modelName = models[i];
    try {
      const mergedConfig: any = {
        ...(params.config || {}),
        abortSignal:
          params.config?.abortSignal ||
          AbortSignal.timeout(modelName === 'gemini-4-hydrogen' ? 28_000 : 22_000),
      };
      if (modelName === 'gemini-4-hydrogen' && !mergedConfig.thinkingConfig) {
        mergedConfig.thinkingConfig = { thinkingLevel: ThinkingLevel.LOW };
      }
      return await ai.models.generateContent({
        ...params,
        model: modelName,
        config: mergedConfig,
      });
    } catch (err: any) {
      lastErr = err;
      const msg = String(err?.message || err);
      const status = Number(err?.status || err?.code || err?.response?.status);
      const isQuota = isGeminiQuotaExhaustedError(err);

      if (params.config?.abortSignal?.aborted) {
        throw err;
      }

      if (isQuota && hasSearchTool) {
        googleSearchCooldownUntil = Date.now() + 60_000;
        throw err;
      }

      const retryable =
        status === 503 ||
        status === 429 ||
        status === 404 ||
        status === 500 ||
        isTimeoutOrAbortError(err) ||
        msg.includes('503') ||
        msg.includes('429') ||
        msg.includes('404') ||
        msg.includes('NOT_FOUND') ||
        msg.includes('RESOURCE_EXHAUSTED') ||
        msg.includes('UNAVAILABLE');

      if (retryable && i < models.length - 1) {
        await new Promise((r) => setTimeout(r, 150 * (i + 1)));
        continue;
      }
      throw err;
    }
  }
  throw lastErr;
}

/**
 * Fetches rich Wikipedia candidates (title, extract, thumbnail, coords, URL) in a single HTTP request.
 */
async function searchWikipediaCandidates(
  query: string,
  offset: number = 0,
  limit: number = 8
): Promise<DiscoverCandidate[]> {
  try {
    const url = `https://en.wikipedia.org/w/api.php?action=query&generator=search&gsrsearch=${encodeURIComponent(
      query
    )}&gsrlimit=${Math.min(limit, 12)}&gsroffset=${Math.max(0, offset)}&prop=pageimages|extracts|coordinates|info|description&piprop=thumbnail&pithumbsize=640&exintro=1&exchars=240&explaintext=1&inprop=url&redirects=1&format=json`;
    const res = await fetch(url, {
      headers: { 'User-Agent': WIKI_USER_AGENT },
      signal: AbortSignal.timeout(2600),
    });
    if (!res.ok) return [];
    const data = await res.json();
    const pages = Object.values(data?.query?.pages || {}) as any[];
    pages.sort((a, b) => (a.index ?? 999) - (b.index ?? 999));

    return pages
      .filter((p) => p && p.pageid && p.title && !String(p.title).includes('(disambiguation)'))
      .map((p) => {
        const desc = String(p.description || '').trim();
        const extract = String(p.extract || '').trim();
        const combinedDesc = extract || desc || 'Encyclopedic entry on Wikipedia.';
        const thumb = p.thumbnail?.source
          ? `/api/places/proxy-image?url=${encodeURIComponent(p.thumbnail.source)}`
          : undefined;
        const coords =
          Array.isArray(p.coordinates) &&
          typeof p.coordinates[0]?.lat === 'number' &&
          typeof p.coordinates[0]?.lon === 'number'
            ? { latitude: p.coordinates[0].lat, longitude: p.coordinates[0].lon }
            : undefined;
        const categoryHint = inferDiscoverCategory(`${p.title} ${desc} ${combinedDesc}`);
        return {
          id: `wiki-${p.pageid}`,
          title: String(p.title),
          category: categoryHint,
          mappedCategory: mapToRecognitionCategory(categoryHint),
          shortDescription: combinedDesc.length > 180 ? `${combinedDesc.slice(0, 177).trim()}...` : combinedDesc,
          locationOrOrigin: coords ? 'Geographic / Heritage Site' : extractLocationHint(desc || combinedDesc),
          imageUrl: thumb,
          imageAttribution: thumb ? `${p.title} (Wikimedia Commons)` : undefined,
          imageSourceUrl: p.fullurl || `https://en.wikipedia.org/wiki/${encodeURIComponent(p.title)}`,
          isExampleImage: false,
          sourceType: 'wikipedia' as const,
          certaintyStatus: 'established_fact' as const,
          certaintyLabel: 'Wikipedia & Public Record',
          wikipediaTitle: String(p.title),
          wikipediaUrl: p.fullurl || `https://en.wikipedia.org/wiki/${encodeURIComponent(p.title)}`,
          coords,
          isVisitableSite: Boolean(coords) || /temple|monument|caves|fort|palace|mosque|stupa|tower|gate|park|museum/i.test(`${p.title} ${desc}`),
        };
      });
  } catch {
    return [];
  }
}

function inferDiscoverCategory(text: string): string {
  const lower = text.toLowerCase();
  if (/sculpture|bronze|statue|idol|pillar|capital|chola|carving/.test(lower)) return 'Sculpture';
  if (/temple|mandir|stupa|pagoda|monastery|shrine|mosque|masjid|church|cathedral|charminar|caves/.test(lower)) return 'Temple / Sacred Heritage';
  if (/inscription|edict|epigraph|copper plate|stele|script/.test(lower)) return 'Inscription & Epigraphy';
  if (/fort|citadel|castle|palace/.test(lower)) return 'Historic Fort / Palace';
  if (/monument|mausoleum|memorial|tomb|arch|minar|gate/.test(lower)) return 'Monument';
  if (/painting|fresco|mural|artwork|canvas|art/.test(lower)) return 'Artwork';
  if (/museum|artifact|relic|pottery|coin|manuscript/.test(lower)) return 'Museum Object';
  if (/waterfall|lake|canyon|mountain|hill|forest|park|river|valley|natural/.test(lower)) return 'Natural Feature';
  if (/column|dome|arch|gopuram|archway|facade|jharokha|window/.test(lower)) return 'Architectural Detail';
  if (/chair|table|cup|bottle|lamp|phone|book|bicycle|tool|clock|furniture/.test(lower)) return 'Everyday Object';
  return 'Historical Subject';
}

function extractLocationHint(text: string): string {
  const inMatch = text.match(/\bin\s+([A-Z][A-Za-z\s,]{2,36}?)(?:\.|,|;|$)/);
  if (inMatch && inMatch[1]) return inMatch[1].trim();
  return 'Global Heritage / General';
}

function searchLocalGroundTruth(query: string): DiscoverCandidate[] {
  const q = query.toLowerCase().trim();
  if (q.length < 2) return [];
  const stopWords = new Set(['the', 'and', 'for', 'with', 'from', 'india', 'city', 'in', 'of', 'at', 'to', 'a', 'an']);
  const tokens = q
    .split(/[^a-z0-9]+/)
    .filter((t) => t.length >= 2 && !stopWords.has(t));
  const results: Array<{ score: number; cand: DiscoverCandidate }> = [];

  for (const poi of VERIFIED_GROUND_TRUTH_POIS) {
    const titleLower = poi.name.toLowerCase();
    const haystack = `${poi.name} ${poi.locality} ${poi.city} ${poi.category} ${poi.oneLineSignificance} ${poi.highlights.join(' ')} ${poi.types.join(' ')}`.toLowerCase();
    const exactPhrase = titleLower.includes(q) || haystack.includes(q);
    let tokenHits = 0;
    let titleHits = 0;
    for (const tok of tokens) {
      const wordRe = new RegExp(`\\b${tok.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')}`, 'i');
      if (wordRe.test(titleLower)) titleHits++;
      if (wordRe.test(haystack)) tokenHits++;
    }
    const minRequired = tokens.length <= 1 ? 1 : Math.ceil(tokens.length * 0.75);
    if (exactPhrase || (tokens.length > 0 && tokenHits >= minRequired && (tokens.length <= 2 || titleHits >= 1))) {
      const proxied = poi.imageUrl
        ? poi.imageUrl.startsWith('/api/')
          ? poi.imageUrl
          : `/api/places/proxy-image?url=${encodeURIComponent(poi.imageUrl)}`
        : undefined;
      const slug = poi.name.toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, '');
      const relevance = (titleLower === q ? 100 : titleLower.includes(q) ? 60 : 0) + titleHits * 15 + tokenHits * 5;
      results.push({
        score: relevance,
        cand: {
          id: `gt-${slug}`,
          title: poi.name,
          category: inferDiscoverCategory(`${poi.name} ${poi.category}`),
          mappedCategory: mapToRecognitionCategory(poi.category),
          shortDescription: poi.oneLineSignificance,
          locationOrOrigin: [poi.locality, poi.city].filter(Boolean).join(', '),
          imageUrl: proxied,
          imageAttribution: proxied ? `${poi.name} (Wikimedia Commons)` : undefined,
          isExampleImage: false,
          sourceType: 'verified_index',
          certaintyStatus: 'established_fact',
          certaintyLabel: 'Curated Heritage Record',
          coords: { latitude: poi.lat, longitude: poi.lng },
          isVisitableSite: true,
        },
      });
    }
  }

  results.sort((a, b) => b.score - a.score);
  const finalResults = results.map((r) => r.cand);

  for (const country of WORLD_LOCATIONS) {
    for (const state of country.states) {
      for (const city of state.cities) {
        const cityLower = city.name.toLowerCase();
        if (cityLower.length >= 3 && (cityLower.includes(q) || new RegExp(`\\b${cityLower.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')}\\b`).test(q))) {
          finalResults.push({
            id: `city-${cityLower.replace(/[^a-z0-9]/g, '')}`,
            title: city.name,
            category: 'Historic City & Destination',
            mappedCategory: 'monument',
            shortDescription: `Destination in ${state.name}, ${country.name}. Explore monuments, cultural architecture, and local heritage.`,
            locationOrOrigin: `${state.name}, ${country.name}`,
            sourceType: 'verified_index',
            certaintyStatus: 'established_fact',
            certaintyLabel: 'Curated Geographic Record',
            coords: { latitude: city.latitude, longitude: city.longitude },
            isVisitableSite: true,
          });
        }
      }
    }
  }

  return finalResults;
}

/**
 * Gemini Search Grounding candidate discovery for clues, typos, nicknames, artworks,
 * sculptures, inscriptions, local names, and everyday objects.
 */
async function searchCandidatesWithGeminiGrounding(
  ai: GoogleGenAI,
  query: string,
  language: string,
  offset: number = 0
): Promise<{ candidates: DiscoverCandidate[]; sources: DiscoverSourceCitation[] }> {
  if (Date.now() < googleSearchCooldownUntil) {
    return { candidates: [], sources: [] };
  }
  try {
    const offsetHint =
      offset > 0
        ? `Skip the top ${offset} most obvious exact matches and return additional closely related or alternative candidates.`
        : '';

    const prompt = `You are Charaiva's Global Discovery Engine.
User query / visual clue / name / typo / question: "${query}"
Target display language: "${language}"
${offsetHint}

Task: Identify 4 to 6 real, distinct candidate subjects worldwide matching this input.
Handle:
- Exact or misspelled heritage sites, monuments, caves, temples (e.g. "Taj Mehal" -> Taj Mahal, "Konarak" -> Konark Sun Temple)
- Visual/iconographic clues (e.g. "four-armed dancing Shiva in bronze ring of fire" -> Nataraja (Chola bronze), "three lions pillar" -> Lion Capital of Ashoka)
- Nicknames & vernacular/local names (e.g. "Pink City" -> Jaipur, "Black Pagoda" -> Konark Sun Temple, "Ajintha" -> Ajanta Caves)
- Artworks, museum objects, inscriptions, architectural elements, natural wonders, AND everyday common objects (e.g. "wooden office chair", "ceramic coffee mug")
- If the clue describes an unidentified, fragmented, or ambiguous object/sculpture, DO NOT invent a specific monument name. Instead return an honest candidate marked certaintyStatus: "unknown" (e.g. "Unidentified Sandstone Torso Sculpture (Stylistic Comparison)") plus 1-2 general period/style possibilities marked certaintyStatus: "possible_identification".

Output STRICTLY a valid JSON object (no markdown fences) with this shape:
{
  "candidates": [
    {
      "title": "Official or widely accepted name in ${language} (with English or native script if helpful)",
      "englishCanonicalTitle": "Exact English Wikipedia/canonical title for photo & encyclopedia lookup (or general style category if unidentified)",
      "alternativeNames": ["Nickname or native/local name"],
      "category": "Monument | Sculpture | Temple | Artwork | Museum Object | Natural Feature | Architectural Detail | Historical Artifact | Everyday Object",
      "shortDescription": "Concise 1-2 sentence accurate description explaining why it matches or what remains uncertain",
      "locationOrOrigin": "City, Country or Culture/Origin (or 'Origin not uniquely established' if unknown)",
      "historicalPeriod": "Era or century if applicable, or Modern / Contemporary / Unverified",
      "isVisitableSite": true,
      "matchReason": "Brief phrase why this matches the clue",
      "certaintyStatus": "established_fact | traditional_interpretation | possible_identification | unknown"
    }
  ]
}`;

    const aiRes = await generateWithActiveModels(ai, {
      model: 'gemini-3.1-flash-lite',
      contents: prompt,
      config: {
        tools: [{ googleSearch: {} }],
      },
    });

    const rawText = aiRes.text || '';
    const parsed = safeJsonParse<{ candidates?: any[] }>(rawText, {});
    const groundingChunks: any[] = aiRes.candidates?.[0]?.groundingMetadata?.groundingChunks || [];
    const sources: DiscoverSourceCitation[] = groundingChunks
      .map((c) => ({
        title: String(c?.web?.title || 'Search Grounding Source'),
        url: typeof c?.web?.uri === 'string' ? c.web.uri : undefined,
        provider: 'Google Search Grounding',
      }))
      .filter((s) => s.url)
      .slice(0, 6);

    const list = Array.isArray(parsed.candidates) ? parsed.candidates : [];
    const candidates: DiscoverCandidate[] = list
      .filter((c) => c && typeof c.title === 'string' && c.title.trim().length > 0)
      .map((c, idx) => {
        const canonicalTitle = String(c.englishCanonicalTitle || c.title).trim();
        const certaintyStatus = normalizeCertainty(c.certaintyStatus || 'possible_identification');
        const hasSearchGround = sources.length > 0;
        const sourceType: DiscoverCandidate['sourceType'] = hasSearchGround ? 'wikipedia' : 'ai_suggested';
        return {
          id: `ai-${canonicalTitle.toLowerCase().replace(/[^a-z0-9]/g, '').slice(0, 28)}-${offset + idx}`,
          title: String(c.title).trim(),
          alternativeNames: Array.isArray(c.alternativeNames)
            ? c.alternativeNames.filter((x: any) => typeof x === 'string' && x.trim()).slice(0, 4)
            : [],
          category: String(c.category || inferDiscoverCategory(canonicalTitle)),
          mappedCategory: mapToRecognitionCategory(String(c.category || canonicalTitle)),
          shortDescription: String(c.shortDescription || '').trim(),
          locationOrOrigin: String(c.locationOrOrigin || 'Global'),
          historicalPeriod: c.historicalPeriod ? String(c.historicalPeriod).trim() : undefined,
          sourceType,
          certaintyStatus,
          certaintyLabel:
            sourceType === 'ai_suggested'
              ? 'AI Suggested Match — Verify Details'
              : certaintyLabelFromStatus(certaintyStatus, 'wikipedia'),
          wikipediaTitle: canonicalTitle,
          isVisitableSite: typeof c.isVisitableSite === 'boolean' ? c.isVisitableSite : undefined,
          matchReason: c.matchReason ? String(c.matchReason).trim() : undefined,
        };
      });

    return { candidates, sources };
  } catch (err: any) {
    if (isGeminiQuotaExhaustedError(err)) {
      googleSearchCooldownUntil = Date.now() + 60_000;
      console.info(
        '[DiscoverEngine] Gemini Search Grounding quota limit (429); serving Wikipedia/Places/Verified sources cleanly.'
      );
    } else {
      console.info(
        '[DiscoverEngine] Gemini Discover search grounding skipped:',
        sanitizeUserText(err?.message || String(err), 140)
      );
    }
    return { candidates: [], sources: [] };
  }
}

/**
 * Resolves Wikipedia thumbnails for candidates missing imageUrl in a single batched MediaWiki API call.
 */
async function hydrateCandidateThumbnails(candidates: DiscoverCandidate[]): Promise<DiscoverCandidate[]> {
  const titlesToFetch = Array.from(
    new Set(
      candidates
        .filter((c) => !c.imageUrl && (c.wikipediaTitle || c.title))
        .map((c) => (c.wikipediaTitle || c.title).trim())
        .filter((t) => t.length >= 2)
    )
  ).slice(0, 10);

  if (titlesToFetch.length === 0) return candidates;

  try {
    const url = `https://en.wikipedia.org/w/api.php?action=query&titles=${encodeURIComponent(
      titlesToFetch.join('|')
    )}&prop=pageimages|info&inprop=url&redirects=1&pithumbsize=640&format=json`;
    const res = await fetch(url, {
      headers: { 'User-Agent': WIKI_USER_AGENT },
      signal: AbortSignal.timeout(2000),
    });
    if (!res.ok) return candidates;
    const data = await res.json();
    const pages = Object.values(data?.query?.pages || {}) as any[];
    const normalize = (s: string) => s.toLowerCase().replace(/[^a-z0-9]/g, '');
    const pageByNormTitle = new Map<string, any>();

    for (const p of pages) {
      if (p && p.pageid && !String(p.title || '').includes('Disambiguation')) {
        pageByNormTitle.set(normalize(String(p.title)), p);
      }
    }
    // Map redirects too
    const redirects = data?.query?.redirects || [];
    for (const r of redirects) {
      const target = pageByNormTitle.get(normalize(String(r.to || '')));
      if (target && r.from) {
        pageByNormTitle.set(normalize(String(r.from)), target);
      }
    }

    return candidates.map((c) => {
      if (c.imageUrl) return c;
      const p =
        pageByNormTitle.get(normalize(c.wikipediaTitle || '')) ||
        pageByNormTitle.get(normalize(c.title));
      if (!p) return c;
      const thumb = p.thumbnail?.source
        ? `/api/places/proxy-image?url=${encodeURIComponent(p.thumbnail.source)}`
        : undefined;
      return {
        ...c,
        imageUrl: thumb || c.imageUrl,
        imageAttribution: thumb ? `${p.title} (Wikimedia Commons)` : c.imageAttribution,
        imageSourceUrl: p.fullurl || c.imageSourceUrl,
        wikipediaUrl: p.fullurl || c.wikipediaUrl,
        wikipediaTitle: p.title || c.wikipediaTitle,
        sourceType: c.sourceType === 'ai_suggested' && p.pageid ? 'wikipedia' : c.sourceType,
        certaintyLabel:
          c.sourceType === 'ai_suggested' && p.pageid
            ? 'Wikipedia & Public Record'
            : c.certaintyLabel,
      };
    });
  } catch {
    return candidates;
  }
}

function hasExplicitLocalIntent(query: string): boolean {
  return /\b(near me|nearby|closest|nearest|around me|around here|walking distance|in this city|local here|my location)\b/i.test(
    query
  );
}

/**
 * Fast, debounced multilingual & typo-tolerant Autocomplete Suggestions (Part 3).
 * Distinguishes homonyms by verified city/country and evaluates local + global subjects independently.
 */
export async function getDiscoverAutocompleteSuggestions(options: {
  query: string;
  language?: string;
  latitude?: number;
  longitude?: number;
  aiClient: GoogleGenAI;
  gmpApiKey?: string;
}): Promise<{
  suggestions: DiscoverAutocompleteSuggestion[];
  sanitizedQuery: string;
}> {
  const cleanQuery = sanitizeUserText(options.query, 160);
  const language = sanitizeUserText(options.language || 'English', 40) || 'English';

  if (!cleanQuery || cleanQuery.length < 2 || hasSuspiciousInjection(cleanQuery)) {
    return { suggestions: [], sanitizedQuery: cleanQuery };
  }

  const localIntent = hasExplicitLocalIntent(cleanQuery);
  const geoScope =
    localIntent && typeof options.latitude === 'number' && typeof options.longitude === 'number'
      ? `local:${options.latitude.toFixed(1)},${options.longitude.toFixed(1)}`
      : 'global';

  const cacheKey = `disc_auto:${cleanQuery.toLowerCase()}:${language.toLowerCase()}:${geoScope}`;
  const cached = getDiscoverCached<{
    suggestions: DiscoverAutocompleteSuggestion[];
    sanitizedQuery: string;
  }>(cacheKey);
  if (cached) return cached;

  const localMatches = searchLocalGroundTruth(cleanQuery).slice(0, 4);

  const [wikiSearchSettled, wikiPrefixSettled, gmpSettled] = await Promise.allSettled([
    searchWikipediaCandidates(cleanQuery, 0, 6),
    (async (): Promise<DiscoverCandidate[]> => {
      try {
        const url = `https://en.wikipedia.org/w/api.php?action=query&generator=prefixsearch&gpssearch=${encodeURIComponent(
          cleanQuery
        )}&gpslimit=5&prop=pageimages|extracts|coordinates|info|description&piprop=thumbnail&pithumbsize=320&exintro=1&exchars=180&explaintext=1&inprop=url&redirects=1&format=json`;
        const res = await fetch(url, {
          headers: { 'User-Agent': WIKI_USER_AGENT },
          signal: AbortSignal.timeout(1600),
        });
        if (!res.ok) return [];
        const data = await res.json();
        const pages = Object.values(data?.query?.pages || {}) as any[];
        pages.sort((a, b) => (a.index ?? 999) - (b.index ?? 999));
        return pages
          .filter((p) => p && p.pageid && p.title && !String(p.title).includes('(disambiguation)'))
          .map((p) => {
            const desc = String(p.description || '').trim();
            const extract = String(p.extract || '').trim();
            const combined = extract || desc || 'Encyclopedic entry on Wikipedia.';
            const thumb = p.thumbnail?.source
              ? `/api/places/proxy-image?url=${encodeURIComponent(p.thumbnail.source)}`
              : undefined;
            const coords =
              Array.isArray(p.coordinates) &&
              typeof p.coordinates[0]?.lat === 'number' &&
              typeof p.coordinates[0]?.lon === 'number'
                ? { latitude: p.coordinates[0].lat, longitude: p.coordinates[0].lon }
                : undefined;
            const categoryHint = inferDiscoverCategory(`${p.title} ${desc} ${combined}`);
            return {
              id: `wiki-${p.pageid}`,
              title: String(p.title),
              category: categoryHint,
              mappedCategory: mapToRecognitionCategory(categoryHint),
              shortDescription: combined.length > 160 ? `${combined.slice(0, 157).trim()}...` : combined,
              locationOrOrigin: desc || extractLocationHint(combined),
              imageUrl: thumb,
              imageAttribution: thumb ? `${p.title} (Wikimedia Commons)` : undefined,
              imageSourceUrl: p.fullurl || `https://en.wikipedia.org/wiki/${encodeURIComponent(p.title)}`,
              isExampleImage: false,
              sourceType: 'wikipedia' as const,
              certaintyStatus: 'established_fact' as const,
              certaintyLabel: 'Wikipedia & Public Record',
              wikipediaTitle: String(p.title),
              wikipediaUrl: p.fullurl || `https://en.wikipedia.org/wiki/${encodeURIComponent(p.title)}`,
              coords,
              isVisitableSite: Boolean(coords),
            };
          });
      } catch {
        return [];
      }
    })(),
    options.gmpApiKey && cleanQuery.split(/\s+/).length <= 5
      ? Promise.race([
          searchGooglePlacesText({
            textQuery: cleanQuery,
            // Only bias Places coordinates when user explicitly asks for nearby results
            latitude: localIntent ? options.latitude : undefined,
            longitude: localIntent ? options.longitude : undefined,
            radiusMeters: 50000,
            languageCode: mapLanguageToBcp47(language),
            apiKey: options.gmpApiKey,
          }),
          new Promise<{ places: any[] }>((resolve) => setTimeout(() => resolve({ places: [] }), 1400)),
        ])
      : Promise.resolve({ places: [] }),
  ]);

  const wikiSearch = wikiSearchSettled.status === 'fulfilled' ? wikiSearchSettled.value : [];
  const wikiPrefix = wikiPrefixSettled.status === 'fulfilled' ? wikiPrefixSettled.value : [];
  const gmpPlaces =
    gmpSettled.status === 'fulfilled' && Array.isArray(gmpSettled.value?.places)
      ? gmpSettled.value.places.slice(0, 4)
      : [];

  const gmpCands: DiscoverCandidate[] = gmpPlaces.map((p: any) => ({
    id: `gmp-${p.id}`,
    title: p.name,
    category: p.primaryTypeDisplayName || inferDiscoverCategory(`${p.name} ${p.category}`),
    mappedCategory: mapToRecognitionCategory(p.category || p.name),
    shortDescription: p.oneLineImportance || p.addressOrLocality || 'Verified location via Google Places.',
    locationOrOrigin: p.formattedAddress || p.addressOrLocality || 'Verified Location',
    imageUrl: p.hasRealPhoto ? p.imageUrl : undefined,
    imageAttribution: p.authorAttributions?.[0]?.displayName
      ? `${p.authorAttributions[0].displayName} (Google Places)`
      : undefined,
    imageSourceUrl: p.googleMapsUri,
    sourceType: 'google_places',
    certaintyStatus: 'established_fact',
    certaintyLabel: 'Google Places Verified Record',
    placeId: p.googlePlaceId || p.id,
    coords:
      typeof p.latitude === 'number' && typeof p.longitude === 'number'
        ? { latitude: p.latitude, longitude: p.longitude }
        : undefined,
    isVisitableSite: true,
  }));

  const prelimCount = localMatches.length + wikiSearch.length + wikiPrefix.length + gmpCands.length;
  const hasNonAscii = /[^\u0000-\u007F]/.test(cleanQuery);
  const looksClueOrTypo = cleanQuery.split(/\s+/).length >= 3 || prelimCount < 3 || hasNonAscii;

  let aiAliasCands: DiscoverCandidate[] = [];
  if (looksClueOrTypo) {
    try {
      const aliasPrompt = `Provide 3 to 5 accurate autocomplete suggestions worldwide for query: "${cleanQuery}".
Language for display labels/subtitles: "${language}".
Support spelling typos (e.g. "Ajintha" -> Ajanta Caves), alternate/native names, homonyms (distinguish each with real City, Country), monuments, architectural styles, museums, historical events, cultural traditions, and objects.
Do NOT invent nonexistent entities or pad with unrelated suggestions.
Return ONLY valid JSON:
{
  "items": [
    {
      "title": "Display name in ${language}",
      "englishCanonicalTitle": "Exact English Wikipedia/canonical title",
      "category": "Monument | Temple | Architectural Style | Museum | Historical Event | Cultural Tradition | Artwork | Sculpture | City | Everyday Object",
      "locationOrOrigin": "City, Country or Origin",
      "subtitle": "Crisp distinguishing 1-line summary in ${language}",
      "isVisitableSite": true
    }
  ]
}`;
      const aiRes = await Promise.race([
        generateWithActiveModels(options.aiClient, {
          model: 'gemini-3.1-flash-lite',
          contents: aliasPrompt,
          config: { responseMimeType: 'application/json' },
        }),
        new Promise<null>((resolve) => setTimeout(() => resolve(null), 1900)),
      ]);
      if (aiRes && aiRes.text) {
        const parsed = safeJsonParse<{ items?: any[] }>(aiRes.text, {});
        const arr = Array.isArray(parsed.items) ? parsed.items : [];
        aiAliasCands = arr
          .filter((x) => x && typeof x.title === 'string' && x.title.trim())
          .slice(0, 5)
          .map((x, idx) => {
            const canonical = String(x.englishCanonicalTitle || x.title).trim();
            return {
              id: `ac-${canonical.toLowerCase().replace(/[^a-z0-9]/g, '').slice(0, 24)}-${idx}`,
              title: String(x.title).trim(),
              category: String(x.category || inferDiscoverCategory(canonical)),
              mappedCategory: mapToRecognitionCategory(String(x.category || canonical)),
              shortDescription: String(x.subtitle || '').trim() || `Matched for "${cleanQuery}"`,
              locationOrOrigin: String(x.locationOrOrigin || 'Global').trim(),
              sourceType: 'ai_suggested' as const,
              certaintyStatus: 'possible_identification' as const,
              certaintyLabel: 'Related Match',
              wikipediaTitle: canonical,
              isVisitableSite: typeof x.isVisitableSite === 'boolean' ? x.isVisitableSite : undefined,
            };
          });
      }
    } catch {
      // keep fast non-AI suggestions
    }
  }

  // Deduplicate carefully while keeping distinct geographic homonyms (title + location key)
  const normKey = (s: string) => s.toLowerCase().replace(/[^a-z0-9\u00C0-\u024F\u0900-\u097F]/g, '');
  const dedupMap = new Map<string, DiscoverCandidate>();

  const addCand = (c: DiscoverCandidate) => {
    const titleKey = normKey(c.wikipediaTitle || c.title);
    if (!titleKey) return;
    // Include short location qualifier if distinct homonyms (e.g. Victoria Memorial Kolkata vs London)
    const locParts = (c.locationOrOrigin || '').split(',').map((p) => p.trim()).filter(Boolean);
    const locTail = locParts.length > 0 ? normKey(locParts[locParts.length - 1]).slice(0, 14) : '';
    const key =
      locTail && !['global', 'globalheritage', 'generichistoricalsubject', 'worldwide'].includes(locTail)
        ? `${titleKey}::${locTail}`
        : titleKey;

    const existing = dedupMap.get(key);
    if (!existing) {
      dedupMap.set(key, c);
    } else {
      dedupMap.set(key, {
        ...existing,
        imageUrl: existing.imageUrl || c.imageUrl,
        placeId: existing.placeId || c.placeId,
        coords: existing.coords || c.coords,
        wikipediaUrl: existing.wikipediaUrl || c.wikipediaUrl,
        wikipediaTitle: existing.wikipediaTitle || c.wikipediaTitle,
        locationOrOrigin:
          existing.locationOrOrigin && existing.locationOrOrigin !== 'Global Heritage / General'
            ? existing.locationOrOrigin
            : c.locationOrOrigin,
      });
    }
  };

  if (hasNonAscii || cleanQuery.split(/\s+/).length >= 3) {
    aiAliasCands.forEach(addCand);
    localMatches.forEach(addCand);
    wikiPrefix.forEach(addCand);
    wikiSearch.forEach(addCand);
    gmpCands.forEach(addCand);
  } else {
    localMatches.forEach(addCand);
    wikiPrefix.forEach(addCand);
    wikiSearch.forEach(addCand);
    gmpCands.forEach(addCand);
    aiAliasCands.forEach(addCand);
  }

  const qLower = cleanQuery.toLowerCase();
  const scored = Array.from(dedupMap.values()).map((cand, idx) => {
    const tLower = cand.title.toLowerCase();
    const altHit = (cand.alternativeNames || []).some((a) => a.toLowerCase().includes(qLower));
    let score = 0;
    if (tLower === qLower) score += 220;
    else if (tLower.startsWith(qLower)) score += 150;
    else if (tLower.includes(qLower)) score += 105;
    else if (altHit) score += 90;
    if (cand.sourceType === 'verified_index') score += 8;
    if (cand.sourceType === 'google_places') score += 6;
    return { cand, score, idx };
  });

  scored.sort((a, b) => (b.score !== a.score ? b.score - a.score : a.idx - b.idx));

  const suggestions: DiscoverAutocompleteSuggestion[] = scored.slice(0, 7).map(({ cand }) => ({
    id: cand.id,
    title: cand.title,
    nativeTitle: cand.nativeTitle,
    category: cand.category,
    subtitle: cand.shortDescription,
    locationOrOrigin: cand.locationOrOrigin || 'Global',
    wikipediaTitle: cand.wikipediaTitle,
    placeId: cand.placeId,
    coords: cand.coords,
    isVisitableSite: cand.isVisitableSite,
    candidate: cand,
  }));

  const payload = { suggestions, sanitizedQuery: cleanQuery };
  if (suggestions.length > 0) {
    setDiscoverCached(cacheKey, payload, 300);
  }
  return payload;
}

export async function searchDiscoverCandidates(options: {
  query: string;
  language?: string;
  offset?: number;
  limit?: number;
  latitude?: number;
  longitude?: number;
  aiClient: GoogleGenAI;
  gmpApiKey?: string;
}): Promise<{
  candidates: DiscoverCandidate[];
  hasMore: boolean;
  totalReturned: number;
  sources: DiscoverSourceCitation[];
  sanitizedQuery: string;
}> {
  const cleanQuery = sanitizeUserText(options.query, 280);
  const language = sanitizeUserText(options.language || 'English', 40) || 'English';
  const offset = Math.max(0, Math.min(50, Number(options.offset) || 0));
  const limit = Math.max(3, Math.min(12, Number(options.limit) || 8));

  if (!cleanQuery || cleanQuery.length < 2) {
    return { candidates: [], hasMore: false, totalReturned: 0, sources: [], sanitizedQuery: cleanQuery };
  }

  if (hasSuspiciousInjection(cleanQuery)) {
    return { candidates: [], hasMore: false, totalReturned: 0, sources: [], sanitizedQuery: cleanQuery };
  }

  const localIntent = hasExplicitLocalIntent(cleanQuery);
  const hasUsableCoords =
    typeof options.latitude === 'number' &&
    typeof options.longitude === 'number' &&
    Number.isFinite(options.latitude) &&
    Number.isFinite(options.longitude);

  // Separate cache keys by geographic scope so cached local results never pollute global searches (and vice versa)
  const geoScope =
    localIntent && hasUsableCoords
      ? `local:${options.latitude!.toFixed(1)},${options.longitude!.toFixed(1)}`
      : hasUsableCoords
      ? `global_ctx:${options.latitude!.toFixed(1)},${options.longitude!.toFixed(1)}`
      : 'global';

  const cacheKey = `disc_search:${cleanQuery.toLowerCase()}:${language.toLowerCase()}:${offset}:${limit}:${geoScope}`;
  const cached = getDiscoverCached<any>(cacheKey);
  if (cached) return cached;

  const looksGeoOrNamed = cleanQuery.split(/\s+/).length <= 5 && offset === 0;
  const localMatches = offset === 0 ? searchLocalGroundTruth(cleanQuery) : [];

  // Part 2 Architecture: Evaluate Global Search AND Local Context independently.
  // Never pass the user's GPS to override a global query — global Places runs unbiased!
  const [wikiSettled, geminiSettled, gmpGlobalSettled, gmpLocalSettled] = await Promise.allSettled([
    searchWikipediaCandidates(cleanQuery, offset, limit),
    searchCandidatesWithGeminiGrounding(options.aiClient, cleanQuery, language, offset),
    looksGeoOrNamed && options.gmpApiKey
      ? Promise.race([
          searchGooglePlacesText({
            textQuery: cleanQuery,
            // Explicitly global (unbiased by user's GPS)
            latitude: undefined,
            longitude: undefined,
            languageCode: mapLanguageToBcp47(language),
            apiKey: options.gmpApiKey,
          }),
          new Promise<{ places: any[] }>((resolve) => setTimeout(() => resolve({ places: [] }), 2200)),
        ])
      : Promise.resolve({ places: [] }),
    localIntent && hasUsableCoords && looksGeoOrNamed && options.gmpApiKey
      ? Promise.race([
          searchGooglePlacesText({
            textQuery: cleanQuery,
            latitude: options.latitude,
            longitude: options.longitude,
            radiusMeters: 50000,
            languageCode: mapLanguageToBcp47(language),
            apiKey: options.gmpApiKey,
          }),
          new Promise<{ places: any[] }>((resolve) => setTimeout(() => resolve({ places: [] }), 1800)),
        ])
      : Promise.resolve({ places: [] }),
  ]);

  const wikiCandidates = wikiSettled.status === 'fulfilled' ? wikiSettled.value : [];
  const geminiResult =
    geminiSettled.status === 'fulfilled' ? geminiSettled.value : { candidates: [], sources: [] };
  const rawGmpPlaces = [
    ...(gmpGlobalSettled.status === 'fulfilled' && Array.isArray(gmpGlobalSettled.value?.places)
      ? gmpGlobalSettled.value.places.slice(0, 4)
      : []),
    ...(gmpLocalSettled.status === 'fulfilled' && Array.isArray(gmpLocalSettled.value?.places)
      ? gmpLocalSettled.value.places.slice(0, 4)
      : []),
  ];

  const gmpCandidates: DiscoverCandidate[] = rawGmpPlaces.map((p: any) => ({
    id: `gmp-${p.id}`,
    title: p.name,
    category: p.primaryTypeDisplayName || inferDiscoverCategory(`${p.name} ${p.category}`),
    mappedCategory: mapToRecognitionCategory(p.category || p.name),
    shortDescription: p.oneLineImportance || p.addressOrLocality || 'Verified location via Google Places.',
    locationOrOrigin: p.formattedAddress || p.addressOrLocality || 'Verified Location',
    imageUrl: p.hasRealPhoto ? p.imageUrl : undefined,
    imageAttribution: p.authorAttributions?.[0]?.displayName
      ? `${p.authorAttributions[0].displayName} (Google Places)`
      : undefined,
    imageSourceUrl: p.googleMapsUri,
    sourceType: 'google_places',
    certaintyStatus: 'established_fact',
    certaintyLabel: 'Google Places Verified Record',
    placeId: p.googlePlaceId || p.id,
    coords:
      typeof p.latitude === 'number' && typeof p.longitude === 'number'
        ? { latitude: p.latitude, longitude: p.longitude }
        : undefined,
    isVisitableSite: true,
  }));

  // Merge & rank cleanly while keeping homonyms separated if they belong to different locations
  const norm = (s: string) => s.toLowerCase().replace(/[^a-z0-9\u00C0-\u024F\u0900-\u097F]/g, '');
  const mergedMap = new Map<string, DiscoverCandidate>();

  const upsert = (cand: DiscoverCandidate) => {
    const baseKey = norm(cand.wikipediaTitle || cand.title);
    if (!baseKey) return;
    const locTail = (cand.locationOrOrigin || '').split(',').pop()?.trim().toLowerCase().replace(/[^a-z0-9]/g, '') || '';
    const key =
      locTail && !['global', 'globalheritagegeneral', 'verifiedlocation'].includes(locTail)
        ? `${baseKey}::${locTail.slice(0, 12)}`
        : baseKey;
    const existing = mergedMap.get(key) || mergedMap.get(baseKey);
    if (!existing) {
      mergedMap.set(key, cand);
      return;
    }
    const targetKey = mergedMap.has(key) ? key : baseKey;
    mergedMap.set(targetKey, {
      ...existing,
      shortDescription:
        existing.shortDescription.length >= cand.shortDescription.length
          ? existing.shortDescription
          : cand.shortDescription,
      imageUrl: existing.imageUrl || cand.imageUrl,
      imageAttribution: existing.imageAttribution || cand.imageAttribution,
      imageSourceUrl: existing.imageSourceUrl || cand.imageSourceUrl,
      wikipediaUrl: existing.wikipediaUrl || cand.wikipediaUrl,
      wikipediaTitle: existing.wikipediaTitle || cand.wikipediaTitle,
      placeId: existing.placeId || cand.placeId,
      coords: existing.coords || cand.coords,
      historicalPeriod: existing.historicalPeriod || cand.historicalPeriod,
      alternativeNames: Array.from(
        new Set([...(existing.alternativeNames || []), ...(cand.alternativeNames || [])])
      ).slice(0, 4),
      sourceType:
        existing.sourceType === 'verified_index' || cand.sourceType === 'verified_index'
          ? 'verified_index'
          : existing.sourceType === 'wikipedia' || cand.sourceType === 'wikipedia'
          ? 'wikipedia'
          : existing.sourceType,
    });
  };

  const isClueQuery = cleanQuery.split(/\s+/).length >= 3;
  if (isClueQuery) {
    geminiResult.candidates.forEach(upsert);
    localMatches.forEach(upsert);
    wikiCandidates.forEach(upsert);
    gmpCandidates.forEach(upsert);
  } else {
    wikiCandidates.forEach(upsert);
    localMatches.forEach(upsert);
    geminiResult.candidates.forEach(upsert);
    gmpCandidates.forEach(upsert);
  }

  // Rank candidates strictly by evidentiary & title match strength (no blind local GPS boost)
  const qLower = cleanQuery.toLowerCase();
  const qWords = qLower.split(/[^a-z0-9\u00C0-\u024F\u0900-\u097F]+/).filter((w) => w.length >= 2);
  const scoredList = Array.from(mergedMap.values()).map((cand, originalIdx) => {
    const tLower = cand.title.toLowerCase();
    let score = 0;
    if (tLower === qLower) score += 220;
    else if (tLower.startsWith(qLower)) score += 140;
    else if (tLower.includes(qLower)) score += 100;
    if (qWords.length > 0) {
      const matchedInTitle = qWords.filter((w) => tLower.includes(w)).length;
      score += Math.round((matchedInTitle / qWords.length) * 85);
    }
    if (cand.coords) score += 6;
    if (cand.imageUrl) score += 8;
    if (cand.sourceType === 'verified_index' && !isClueQuery && qWords.some((w) => tLower.includes(w))) {
      score += 10;
    }
    return { cand, score, originalIdx };
  });

  scoredList.sort((a, b) => (b.score !== a.score ? b.score - a.score : a.originalIdx - b.originalIdx));
  let ranked = scoredList.map((item) => item.cand).slice(0, limit);

  if (ranked.length === 0 && offset === 0 && cleanQuery.length >= 5) {
    ranked = [
      {
        id: `unknown-${Date.now().toString(36)}`,
        title: cleanQuery.length > 70 ? `${cleanQuery.slice(0, 67)}...` : cleanQuery,
        category: inferDiscoverCategory(cleanQuery),
        mappedCategory: mapToRecognitionCategory(cleanQuery),
        shortDescription:
          'No unique monument or catalogued artwork matches this description with certainty. Select this entry to review material traits, probable stylistic context, and what details remain unknown without provenance.',
        locationOrOrigin: 'Origin / Provenance Not Uniquely Established',
        sourceType: 'ai_suggested',
        certaintyStatus: 'unknown',
        certaintyLabel: 'Unidentified — Further Context Needed',
        isVisitableSite: false,
        matchReason: 'Descriptive clue with multiple or unconfirmed real-world possibilities',
      },
    ];
  }

  ranked = await hydrateCandidateThumbnails(ranked);

  const output = {
    candidates: ranked,
    hasMore: ranked.length >= Math.min(limit, 5) || wikiCandidates.length >= limit,
    totalReturned: ranked.length,
    sources: geminiResult.sources,
    sanitizedQuery: cleanQuery,
  };

  if (ranked.length > 0) {
    setDiscoverCached(cacheKey, output, 600);
  }
  return output;
}

/**
 * Generates unified, source-grounded Complete Explanation for any selected subject
 * at 'quick' (Overview), 'standard' (Detailed Explanation), 'deep' (In-Depth Exploration),
 * or 'expert' (Expert-Level Detail), including 5 dynamic Explore More suggestions.
 */
export async function generateDiscoverExplanation(options: {
  candidate: Partial<DiscoverCandidate> & { title: string };
  level?: ExplanationLevel;
  language?: string;
  guideSettings?: Partial<GuideSettings>;
  aiClient: GoogleGenAI;
  gmpApiKey?: string;
}): Promise<{
  landmark: RecognitionResult;
  structuredData: StructuredExplanationData;
}> {
  const cleanTitle = sanitizeUserText(options.candidate.title, 180);
  const lookupTitle = sanitizeUserText(options.candidate.wikipediaTitle || options.candidate.title, 180);
  const level: ExplanationLevel =
    options.level === 'quick' || options.level === 'deep' || options.level === 'expert'
      ? options.level
      : 'standard';
  const language = sanitizeUserText(options.language || 'English', 40) || 'English';
  const personaKey = options.guideSettings?.persona || 'warm_female';
  const voiceGender = options.guideSettings?.voiceGender || 'female';

  const locCacheTag = sanitizeUserText(options.candidate.locationOrOrigin || '', 60).toLowerCase();
  const cacheKey = `disc_expl_v2:${lookupTitle.toLowerCase()}:${locCacheTag}:${level}:${language.toLowerCase()}:${personaKey}:${voiceGender}`;
  const cached = getDiscoverCached<{ landmark: RecognitionResult; structuredData: StructuredExplanationData }>(cacheKey);
  if (cached) return cached;

  // Ground concurrently from Wikipedia + Photo Resolver + Optional Google Place Details
  const isValidGoogleId =
    Boolean(options.candidate.placeId) &&
    !String(options.candidate.placeId).startsWith('wiki-') &&
    !String(options.candidate.placeId).startsWith('gt-') &&
    !String(options.candidate.placeId).startsWith('osm-') &&
    /^[A-Za-z0-9_-]{8,}$/.test(String(options.candidate.placeId));

  const [wikiSettled, photoSettled, gDetailsSettled] = await Promise.allSettled([
    fetchWikipediaPlaceExtract(lookupTitle, options.candidate.locationOrOrigin),
    options.candidate.imageUrl
      ? Promise.resolve({
          hasRealPhoto: true,
          photoUrl: options.candidate.imageUrl,
          authorAttributions: options.candidate.imageAttribution
            ? [{ displayName: options.candidate.imageAttribution, uri: options.candidate.imageSourceUrl }]
            : [],
          photos: [],
        })
      : options.candidate.certaintyStatus === 'unknown'
      ? Promise.resolve({
          hasRealPhoto: false,
          photoUrl: undefined,
          authorAttributions: [],
          photos: [],
        })
      : resolveExactPlacePhotoWithGooglePlaces(
          lookupTitle,
          options.candidate.locationOrOrigin,
          options.candidate.coords?.latitude,
          options.candidate.coords?.longitude,
          options.candidate.placeId,
          options.gmpApiKey
        ),
    isValidGoogleId && options.gmpApiKey
      ? fetchGooglePlaceDetails({
          placeId: String(options.candidate.placeId),
          languageCode: mapLanguageToBcp47(language),
          apiKey: options.gmpApiKey,
        })
      : Promise.resolve({ details: null }),
  ]);

  const wikiInfo = wikiSettled.status === 'fulfilled' ? wikiSettled.value : null;
  const photoRes = photoSettled.status === 'fulfilled' ? photoSettled.value : null;
  const gDetails = gDetailsSettled.status === 'fulfilled' ? gDetailsSettled.value?.details : null;

  const levelSpec =
    level === 'quick'
      ? `EXPLANATION LEVEL = OVERVIEW (Concise Introduction):
- Keep "narration" clear and engaging (90–130 spoken words, 1 crisp paragraph).
- Cover exact identity, origin/location, historical context, 3 verified facts, 2-3 Detail Components, 3 Related Discoveries, and 5 dynamic Explore More topics.`
      : level === 'deep'
      ? `EXPLANATION LEVEL = IN-DEPTH EXPLORATION (Thorough Multi-Faceted Analysis):
- "narration": 3–4 rich, engaging spoken paragraphs (~260–340 words).
- Thoroughly explain origin and chronological development, architectural engineering/materials, hidden or overlooked architectural traits, symbolism, changes over time, folklore explicitly separated from history, comparisons, common misconceptions, 5–6 sourced facts, 5–7 granular Detail Components, and 5 dynamic Explore More topics.`
      : level === 'expert'
      ? `EXPLANATION LEVEL = EXPERT-LEVEL DETAIL (Scholarly, Archaeological & Carefully Qualified):
- "narration": 4–5 authoritative, deeply researched paragraphs (~360–480 words) backed by institutional/archaeological scholarship (ASI, UNESCO, museums, epigraphy, primary chronicles).
- Explicitly cite scholarly disagreements or unresolved questions rather than guessing; clearly separate documented facts, academic interpretations, traditional accounts/folklore, and unknown points.
- Populate rich sections: history, architectureAndConstruction, sculptureAndFineDetails (if relevant), conservationAndChanges (repairs, weathering, preservation status), folkloreVsHistory, comparativeContext (comparisons & unusual characteristics), misconceptions (2–4 factual corrections), 6–8 sourced facts with provenance notes, 6–9 granular Detail Components, 4–5 Related Discoveries, and 5 deeply specific Explore More topics.`
      : `EXPLANATION LEVEL = DETAILED EXPLANATION (Balanced Comprehensive Guide):
- Rich personal-guide depth (~180–240 spoken words across 2–3 vivid paragraphs).
- Cover exact identification, geographic & historical background, key chronological events/patrons, construction/materials, cultural meaning, conservation or changes over time where relevant, 4–5 sourced facts, 4–6 Detail Components, 4 Related Discoveries, and 5 dynamic Explore More topics.`;

  const personaGuidance = buildPersonaInstructions(options.guideSettings);

  const groundingContext = {
    subject: cleanTitle,
    canonicalTitle: lookupTitle,
    categoryHint: options.candidate.category || 'Historical Subject',
    locationOrOriginHint: options.candidate.locationOrOrigin || '',
    shortHint: options.candidate.shortDescription || '',
    wikipediaTitle: wikiInfo?.title || '',
    wikipediaUrl: wikiInfo?.url || options.candidate.wikipediaUrl || '',
    wikipediaExtract: wikiInfo?.extract || '',
    googlePlaceAddress: gDetails?.formattedAddress || '',
    googleOpeningHours: gDetails?.regularOpeningHours?.weekdayDescriptions || [],
    isVisitableHint: options.candidate.isVisitableSite,
  };

  const prompt = `You are Charaiva, an authoritative, truthful museum curator, art historian, archaeologist, and multilingual tour guide.
Generate a deeply accurate structured dossier for "${cleanTitle}" strictly in language "${language}".

${personaGuidance}

${levelSpec}

AUTHORITATIVE SOURCE HIERARCHY (Part 8):
- Prioritize official government & tourism bodies, Archaeological Survey of India (ASI) / heritage authorities, UNESCO documentation, official museum databases, credible academic research, Google Places, and specialist encyclopedias.
- Cross-verify claims against the subject's true location ("${options.candidate.locationOrOrigin || 'verify globally'}"). Never mix facts from similarly named sites in other cities.
- Never invent entry fees, clock hours, builders, dates, coordinates, or URLs. If unknown or unconfirmed, state so plainly.

STRICT TRUTHFULNESS & RELEVANCE RULES:
1. Mark every fact with certaintyStatus: "established_fact" (documented/archaeological), "traditional_interpretation" (folklore/religious tradition), "possible_identification" (scholarly hypothesis), or "unknown".
2. Only populate sections genuinely relevant to THIS subject (leave "sculptureAndFineDetails", "history", "folkloreVsHistory", etc. empty if truly inapplicable to a plain modern object or natural feature).
3. "exploreMoreTopics" MUST contain EXACTLY 5 dynamic, subject-specific, clickable subtopics tailored ONLY to "${cleanTitle}" in "${language}" (e.g. for Taj Mahal: optical illusions, Pietra Dura gemstone inlay, Yamuna river foundation engineering, conservation vs air pollution, Mumtaz Mahal's historical inscriptions — NEVER generic repeated templates).
4. Ensure ALL output text fields are written naturally in "${language}", keeping canonical proper nouns clear.
5. Output ONLY valid JSON matching the schema below (no markdown fences).

Grounded reference context:
${JSON.stringify(groundingContext)}

Required JSON structure:
{
  "title": "Subject title in ${language}",
  "nativeTitle": "Native or canonical script name if applicable",
  "categoryLabel": "Human-readable category",
  "locationName": "Exact verified Place, City, Country or Origin",
  "historicalPeriod": "Verified dating/dynasty/era or Contemporary",
  "summary": "2-sentence crisp summary",
  "narration": "Spoken audio guide script matching requested level depth & persona",
  "basicIdentification": "What it is, true verified location/origin, confirmed dating, and confidence basis",
  "history": "Historical background, origin, patronage, chronological events (empty string if non-historical)",
  "architectureAndConstruction": "Architectural design/styles, construction methods, engineering, and materials",
  "sculptureAndFineDetails": "Hidden/fine artistic details, posture, attributes, calligraphy, carvings (empty string if inapplicable)",
  "conservationAndChanges": "Changes over time, historical alterations, conservation/preservation status (empty string if inapplicable)",
  "comparativeContext": "Meaningful stylistic/historical comparisons and unusual overlooked traits",
  "folkloreVsHistory": "Local stories & traditions clearly distinguished from documented archaeological/historical evidence (empty string if inapplicable)",
  "misconceptions": ["Common misconception corrected accurately with documented facts (only if relevant)"],
  "inscription": {
    "detected": false,
    "script": "",
    "confirmedReading": "",
    "approximateTransliteration": "",
    "translation": "",
    "uncertaintyNote": "",
    "certainty": "established_fact"
  },
  "meaningAndSignificance": "Cultural, historical, symbolic, environmental, or functional significance",
  "interestingFacts": [
    { "text": "Lesser-known or verified fact", "certainty": "established_fact | traditional_interpretation | possible_identification | unknown", "note": "Source basis or caveat" }
  ],
  "visitorInfo": {
    "visitable": true,
    "locationNote": "Setting and access overview",
    "bestTime": "Season/time recommendation (no invented ticket fees or unverified hours)",
    "hoursNote": "Only if confirmed from public record/Google Place data, else empty string",
    "etiquetteOrTips": ["Practical respectful visitor guidance"],
    "mapsQuery": "Exact query for Maps if visitable"
  },
  "detailComponents": [
    {
      "id": "comp-1",
      "name": "Specific component name",
      "category": "sculpture | architecture | iconography | inscription | material | context",
      "visualCue": "Where and what to look for visually",
      "meaningAndSymbolism": "What it represents or its engineering role",
      "craftTechnique": "Material / carving / construction method",
      "certainty": "established_fact | traditional_interpretation | possible_identification"
    }
  ],
  "exploreMoreTopics": [
    {
      "id": "exp-1",
      "title": "Specific compelling exploration title for ${cleanTitle} in ${language}",
      "subtitle": "Short 1-line hook showing why this angle deepens understanding",
      "angle": "architecture | history | construction | symbolism | conservation | culture | science",
      "promptSeed": "Concise focal instruction for deeper exploration of this exact angle"
    }
  ],
  "relatedDiscoveries": [
    {
      "title": "Related subject name",
      "wikipediaTitle": "Exact English canonical title",
      "category": "Monument | Sculpture | Temple | Artwork | Museum Object",
      "relationReason": "1-line reason why this connects",
      "locationOrOrigin": "City, Country or Culture"
    }
  ],
  "suggestedQuestions": ["3 insightful follow-up questions in ${language}"],
  "tags": ["4 tags"],
  "certaintySummary": "established_fact | traditional_interpretation | possible_identification | unknown",
  "certaintyNote": "Evidence summary noting source consensus or uncertainty"
}`;

  let parsed: any = {};
  let groundingSources: DiscoverSourceCitation[] = [];

  const hasRichWikiGrounding = Boolean(wikiInfo?.extract && wikiInfo.extract.trim().length >= 180);
  const shouldUseGoogleSearch =
    Date.now() >= googleSearchCooldownUntil &&
    (level === 'deep' || level === 'expert' || !hasRichWikiGrounding);

  if (shouldUseGoogleSearch) {
    try {
      const modelToUse = level === 'deep' || level === 'expert' ? 'gemini-4-hydrogen' : 'gemini-3.1-flash-lite';
      const aiRes = await generateWithActiveModels(options.aiClient, {
        model: modelToUse,
        contents: prompt,
        config: {
          tools: [{ googleSearch: {} }],
          ...(modelToUse === 'gemini-4-hydrogen'
            ? { thinkingConfig: { thinkingLevel: ThinkingLevel.LOW } }
            : {}),
        },
      });

      const rawText = aiRes.text || '';
      parsed = safeJsonParse<any>(rawText, {});
      const chunks: any[] = aiRes.candidates?.[0]?.groundingMetadata?.groundingChunks || [];
      groundingSources = chunks
        .map((c) => ({
          title: String(c?.web?.title || 'Reference Source'),
          url: typeof c?.web?.uri === 'string' ? c.web.uri : undefined,
          provider: 'Google Search Grounding',
        }))
        .filter((s) => s.url)
        .slice(0, 6);
    } catch (err: any) {
      if (isGeminiQuotaExhaustedError(err)) {
        googleSearchCooldownUntil = Date.now() + 60_000;
        console.info(
          '[DiscoverEngine] Grounded Discover explanation hit 429 quota; using structured JSON with Wikipedia/Places grounding.'
        );
      } else {
        console.info(
          '[DiscoverEngine] Grounded Discover explanation fallback to structured JSON:',
          sanitizeUserText(err?.message || String(err), 140)
        );
      }
    }
  }

  // Fallback structured JSON call if first call skipped cooldown or didn't return usable narration
  if (!parsed || !parsed.narration || !parsed.basicIdentification) {
    const fallbackPrompt = `${prompt}\nRespond strictly with valid JSON.`;
    try {
      const fbRes = await generateWithActiveModels(options.aiClient, {
        model: 'gemini-3.1-flash-lite',
        contents: fallbackPrompt,
        config: {
          responseMimeType: 'application/json',
        },
      });
      parsed = safeJsonParse<any>(fbRes.text, {});
    } catch (fbErr: any) {
      if (isGeminiQuotaExhaustedError(fbErr)) {
        throw new GeminiQuotaError();
      }
      throw fbErr;
    }
  }

  const sources: DiscoverSourceCitation[] = [];
  if (wikiInfo?.url) {
    sources.push({
      title: `Wikipedia: ${wikiInfo.title}`,
      url: wikiInfo.url,
      provider: 'Wikipedia',
    });
  } else if (options.candidate.wikipediaUrl) {
    sources.push({
      title: `Wikipedia: ${lookupTitle}`,
      url: options.candidate.wikipediaUrl,
      provider: 'Wikipedia',
    });
  }
  if (gDetails?.googleMapsUri) {
    sources.push({
      title: 'Google Maps Verified Place',
      url: gDetails.googleMapsUri,
      provider: 'Google Places',
    });
  }
  for (const gs of groundingSources) {
    if (!sources.some((existing) => existing.url === gs.url)) {
      sources.push(gs);
    }
  }

  const imageUrl =
    options.candidate.imageUrl || (photoRes?.hasRealPhoto ? photoRes.photoUrl : undefined) || undefined;
  const imageAttribution =
    options.candidate.imageAttribution ||
    photoRes?.authorAttributions?.[0]?.displayName ||
    undefined;
  const imageSourceUrl =
    options.candidate.imageSourceUrl ||
    photoRes?.authorAttributions?.[0]?.uri ||
    wikiInfo?.url ||
    undefined;

  const rawFacts: GroundedFactItem[] = Array.isArray(parsed.interestingFacts)
    ? parsed.interestingFacts
        .filter((f: any) => f && (typeof f === 'string' || typeof f.text === 'string'))
        .map((f: any) =>
          typeof f === 'string'
            ? { text: f, certainty: 'established_fact' as CertaintyStatus }
            : {
                text: String(f.text).trim(),
                certainty: normalizeCertainty(f.certainty),
                note: f.note ? String(f.note).trim() : undefined,
              }
        )
    : [];

  const detailComponents: DetailComponent[] = Array.isArray(parsed.detailComponents)
    ? parsed.detailComponents
        .filter((d: any) => d && typeof d.name === 'string' && d.name.trim())
        .map((d: any, idx: number) => ({
          id: d.id ? String(d.id) : `detail-${idx + 1}`,
          name: String(d.name).trim(),
          category: (['sculpture', 'architecture', 'iconography', 'inscription', 'material', 'context'].includes(d.category)
            ? d.category
            : 'iconography') as DetailComponent['category'],
          visualCue: String(d.visualCue || '').trim(),
          meaningAndSymbolism: String(d.meaningAndSymbolism || '').trim(),
          craftTechnique: d.craftTechnique ? String(d.craftTechnique).trim() : undefined,
          certainty: normalizeCertainty(d.certainty),
        }))
    : [];

  const rawRelated: RelatedDiscoveryItem[] = Array.isArray(parsed.relatedDiscoveries)
    ? parsed.relatedDiscoveries
        .filter((r: any) => r && typeof r.title === 'string' && r.title.trim())
        .slice(0, 5)
        .map((r: any, idx: number) => ({
          id: `rel-${String(r.wikipediaTitle || r.title).toLowerCase().replace(/[^a-z0-9]/g, '').slice(0, 24)}-${idx}`,
          title: String(r.title).trim(),
          wikipediaTitle: r.wikipediaTitle ? String(r.wikipediaTitle).trim() : String(r.title).trim(),
          category: String(r.category || 'Monument'),
          mappedCategory: mapToRecognitionCategory(String(r.category || r.title)),
          relationReason: String(r.relationReason || '').trim(),
          locationOrOrigin: r.locationOrOrigin ? String(r.locationOrOrigin).trim() : undefined,
        }))
    : [];

  // Quickly hydrate thumbnails for related discoveries in 1 batched Wikipedia API call
  let relatedDiscoveries = rawRelated;
  const relTitles = rawRelated.map((r) => r.wikipediaTitle || r.title).filter(Boolean);
  if (relTitles.length > 0) {
    try {
      const rUrl = `https://en.wikipedia.org/w/api.php?action=query&titles=${encodeURIComponent(
        relTitles.join('|')
      )}&prop=pageimages|info&inprop=url&redirects=1&pithumbsize=480&format=json`;
      const rRes = await fetch(rUrl, {
        headers: { 'User-Agent': WIKI_USER_AGENT },
        signal: AbortSignal.timeout(1800),
      });
      if (rRes.ok) {
        const rData = await rRes.json();
        const rPages = Object.values(rData?.query?.pages || {}) as any[];
        const norm = (s: string) => s.toLowerCase().replace(/[^a-z0-9]/g, '');
        const byNorm = new Map<string, any>();
        for (const p of rPages) {
          if (p && p.pageid) byNorm.set(norm(String(p.title)), p);
        }
        for (const red of rData?.query?.redirects || []) {
          const t = byNorm.get(norm(String(red.to || '')));
          if (t && red.from) byNorm.set(norm(String(red.from)), t);
        }
        relatedDiscoveries = rawRelated.map((rel) => {
          const p = byNorm.get(norm(rel.wikipediaTitle || '')) || byNorm.get(norm(rel.title));
          if (!p) return rel;
          const thumb = p.thumbnail?.source
            ? `/api/places/proxy-image?url=${encodeURIComponent(p.thumbnail.source)}`
            : undefined;
          return {
            ...rel,
            imageUrl: thumb,
            imageAttribution: thumb ? `${p.title} (Wikimedia Commons)` : undefined,
            wikipediaUrl: p.fullurl,
            wikipediaTitle: p.title || rel.wikipediaTitle,
          };
        });
      }
    } catch {
      // keep without thumbnails
    }
  }

  const parsedInscription: InscriptionAnalysis | undefined =
    parsed.inscription && parsed.inscription.detected
      ? {
          detected: true,
          script: parsed.inscription.script ? String(parsed.inscription.script).trim() : undefined,
          confirmedReading: parsed.inscription.confirmedReading
            ? String(parsed.inscription.confirmedReading).trim()
            : undefined,
          approximateTransliteration: parsed.inscription.approximateTransliteration
            ? String(parsed.inscription.approximateTransliteration).trim()
            : undefined,
          translation: parsed.inscription.translation
            ? String(parsed.inscription.translation).trim()
            : undefined,
          uncertaintyNote: parsed.inscription.uncertaintyNote
            ? String(parsed.inscription.uncertaintyNote).trim()
            : undefined,
          certainty: normalizeCertainty(parsed.inscription.certainty),
        }
      : undefined;

  const isVisitable =
    typeof parsed.visitorInfo?.visitable === 'boolean'
      ? parsed.visitorInfo.visitable
      : Boolean(options.candidate.isVisitableSite);

  const usedExploreIds = new Set<string>();
  const exploreMoreTopics: ExploreMoreSuggestion[] = Array.isArray(parsed.exploreMoreTopics)
    ? parsed.exploreMoreTopics
        .filter((e: any) => e && typeof e.title === 'string' && e.title.trim())
        .slice(0, 5)
        .map((e: any, idx: number) => {
          const baseId =
            (e.id ? String(e.id) : `explore-${idx + 1}`)
              .toLowerCase()
              .replace(/[^a-z0-9_-]+/g, '-')
              .replace(/^-|-$/g, '') || `explore-${idx + 1}`;
          let uniqueId = baseId;
          if (usedExploreIds.has(uniqueId)) {
            uniqueId = `${baseId}-${idx + 1}`;
          }
          usedExploreIds.add(uniqueId);
          return {
            id: uniqueId,
            title: String(e.title).trim(),
            subtitle: String(e.subtitle || '').trim() || `Examine this specific aspect of ${cleanTitle}`,
            angle: e.angle ? String(e.angle).trim() : undefined,
            promptSeed: e.promptSeed ? String(e.promptSeed).trim() : undefined,
          };
        })
    : [];

  const structuredData: StructuredExplanationData = {
    basicIdentification:
      String(parsed.basicIdentification || '').trim() ||
      wikiInfo?.extract?.slice(0, 320) ||
      options.candidate.shortDescription ||
      cleanTitle,
    history: parsed.history ? String(parsed.history).trim() : undefined,
    architectureAndConstruction: parsed.architectureAndConstruction
      ? String(parsed.architectureAndConstruction).trim()
      : undefined,
    sculptureAndFineDetails: parsed.sculptureAndFineDetails
      ? String(parsed.sculptureAndFineDetails).trim()
      : undefined,
    conservationAndChanges: parsed.conservationAndChanges
      ? String(parsed.conservationAndChanges).trim()
      : undefined,
    comparativeContext: parsed.comparativeContext
      ? String(parsed.comparativeContext).trim()
      : undefined,
    folkloreVsHistory: parsed.folkloreVsHistory
      ? String(parsed.folkloreVsHistory).trim()
      : undefined,
    misconceptions: Array.isArray(parsed.misconceptions)
      ? parsed.misconceptions.filter((m: any) => typeof m === 'string' && m.trim()).slice(0, 5)
      : undefined,
    inscription: parsedInscription,
    meaningAndSignificance: parsed.meaningAndSignificance
      ? String(parsed.meaningAndSignificance).trim()
      : undefined,
    interestingFacts: rawFacts,
    visitorInfo: isVisitable
      ? {
          visitable: true,
          locationNote: parsed.visitorInfo?.locationNote
            ? String(parsed.visitorInfo.locationNote).trim()
            : gDetails?.formattedAddress || options.candidate.locationOrOrigin,
          bestTime: parsed.visitorInfo?.bestTime ? String(parsed.visitorInfo.bestTime).trim() : undefined,
          hoursNote:
            gDetails?.regularOpeningHours?.weekdayDescriptions?.slice(0, 2).join(' · ') ||
            (parsed.visitorInfo?.hoursNote ? String(parsed.visitorInfo.hoursNote).trim() : undefined),
          etiquetteOrTips: Array.isArray(parsed.visitorInfo?.etiquetteOrTips)
            ? parsed.visitorInfo.etiquetteOrTips.filter((t: any) => typeof t === 'string' && t.trim()).slice(0, 4)
            : [],
          mapsQuery: parsed.visitorInfo?.mapsQuery
            ? String(parsed.visitorInfo.mapsQuery).trim()
            : `${cleanTitle} ${options.candidate.locationOrOrigin || ''}`.trim(),
        }
      : { visitable: false },
    detailComponents,
    exploreMoreTopics,
    relatedDiscoveries,
    sources,
    certaintySummary: normalizeCertainty(parsed.certaintySummary || options.candidate.certaintyStatus),
    certaintyNote: parsed.certaintyNote ? String(parsed.certaintyNote).trim() : undefined,
    levelNarration: {
      [level]: String(parsed.narration || parsed.summary || '').trim(),
    },
    activeLevel: level,
    imageMeta: {
      url: imageUrl,
      attribution: imageAttribution,
      sourceUrl: imageSourceUrl,
      isExampleImage: Boolean(options.candidate.isExampleImage),
    },
  };

  const categoryLabel = String(parsed.categoryLabel || options.candidate.category || 'Historical Subject');
  const mappedCat = mapToRecognitionCategory(categoryLabel);

  const landmark: RecognitionResult = {
    id: options.candidate.id || `discover-${Date.now()}`,
    title: String(parsed.title || cleanTitle).trim(),
    nativeTitle: parsed.nativeTitle ? String(parsed.nativeTitle).trim() : undefined,
    category: mappedCat,
    categoryLabel,
    confidence: structuredData.certaintySummary === 'established_fact' ? 0.96 : 0.84,
    locationName:
      String(parsed.locationName || options.candidate.locationOrOrigin || gDetails?.formattedAddress || 'Global Heritage').trim(),
    historicalPeriod: parsed.historicalPeriod
      ? String(parsed.historicalPeriod).trim()
      : options.candidate.historicalPeriod,
    ocrDetectedText: parsedInscription?.confirmedReading || parsedInscription?.approximateTransliteration,
    summary: String(parsed.summary || structuredData.basicIdentification).trim(),
    narration: String(parsed.narration || structuredData.basicIdentification).trim(),
    keyFacts: rawFacts.map((f) => f.text),
    architecturalHighlights: detailComponents.slice(0, 4).map((d) => `${d.name}: ${d.visualCue}`),
    suggestedQuestions: Array.isArray(parsed.suggestedQuestions)
      ? parsed.suggestedQuestions.filter((q: any) => typeof q === 'string' && q.trim()).slice(0, 4)
      : [
          `What are the most important details of ${cleanTitle}?`,
          `What historical evidence confirms the origin of ${cleanTitle}?`,
        ],
    culturalSignificance: structuredData.meaningAndSignificance,
    imageUrl,
    imageAttribution,
    imageSourceUrl,
    isExampleImage: Boolean(options.candidate.isExampleImage),
    placeId: options.candidate.placeId,
    googleMapsUri: gDetails?.googleMapsUri,
    coords: options.candidate.coords,
    tags: Array.isArray(parsed.tags)
      ? parsed.tags.filter((t: any) => typeof t === 'string' && t.trim()).slice(0, 6)
      : [categoryLabel],
    language,
    discoverCandidate: {
      ...options.candidate,
      id: options.candidate.id || `discover-${Date.now()}`,
      title: String(parsed.title || cleanTitle).trim(),
      category: categoryLabel,
      mappedCategory: mappedCat,
      shortDescription: String(parsed.summary || options.candidate.shortDescription || '').trim(),
      locationOrOrigin: String(parsed.locationName || options.candidate.locationOrOrigin || '').trim(),
      sourceType: options.candidate.sourceType || (wikiInfo ? 'wikipedia' : 'ai_suggested'),
      certaintyStatus: structuredData.certaintySummary,
      certaintyLabel:
        options.candidate.certaintyLabel ||
        certaintyLabelFromStatus(structuredData.certaintySummary, wikiInfo ? 'wikipedia' : 'ai_suggested'),
      wikipediaTitle: wikiInfo?.title || lookupTitle,
      wikipediaUrl: wikiInfo?.url || options.candidate.wikipediaUrl,
      imageUrl,
      imageAttribution,
      imageSourceUrl,
      isVisitableSite: isVisitable,
    },
    structuredData,
  };

  const result = { landmark, structuredData };
  setDiscoverCached(cacheKey, result, 900);
  return result;
}

/**
 * Answers "Detail by Detail" visual tap / region queries or component-specific questions,
 * honoring strict inscription caution and distinguishing fact vs. tradition vs. unknown.
 */
export async function analyzeDetailByDetail(options: {
  subjectTitle: string;
  category?: string;
  locationOrOrigin?: string;
  language?: string;
  guideSettings?: Partial<GuideSettings>;
  question?: string;
  tapCoords?: { x: number; y: number };
  inlineImage?: { mimeType: string; data: string } | null;
  existingComponents?: DetailComponent[];
  aiClient: GoogleGenAI;
}): Promise<{
  answer?: string;
  answerCertainty?: CertaintyStatus;
  highlightedPartName?: string;
  components: DetailComponent[];
  inscription?: InscriptionAnalysis;
  sources: DiscoverSourceCitation[];
}> {
  const cleanTitle = sanitizeUserText(options.subjectTitle, 180);
  const cleanQuestion = sanitizeUserText(options.question || '', 300);
  const language = sanitizeUserText(options.language || 'English', 40) || 'English';

  if (cleanQuestion && hasSuspiciousInjection(cleanQuestion)) {
    return {
      answer: 'Please enter a specific question about the sculpture, inscription, architecture, or material details of this subject.',
      answerCertainty: 'unknown',
      components: options.existingComponents || [],
      sources: [],
    };
  }

  const tapDesc =
    options.tapCoords &&
    Number.isFinite(options.tapCoords.x) &&
    Number.isFinite(options.tapCoords.y)
      ? `The user tapped normalized image coordinates (x=${(options.tapCoords.x * 100).toFixed(0)}%, y=${(options.tapCoords.y * 100).toFixed(0)}%) on the subject photograph.`
      : '';

  const prompt = `You are Charaiva's Detail-by-Detail Visual & Art-History Analyst.
Subject: "${cleanTitle}" (${options.category || 'Heritage Subject'}, Origin/Location: "${options.locationOrOrigin || 'Unknown'}")
Language: "${language}"
${buildPersonaInstructions(options.guideSettings)}
${tapDesc}
${cleanQuestion ? `User's specific detail question: "${cleanQuestion}"` : 'Provide a complete part-by-part / feature-by-feature visual & symbolic breakdown.'}
${
  options.existingComponents && options.existingComponents.length > 0
    ? `Already known components: ${options.existingComponents.map((c) => c.name).join(', ')}.`
    : ''
}

CRITICAL HONESTY RULES:
1. If an image is attached and the user tapped coordinates (x, y), examine that region visually. If the resolution/angle is unclear or no distinct feature can be confirmed at that spot, say so honestly ("unknown" or "possible_identification"). NEVER pretend to see invisible details.
2. If an inscription is present or asked about, NEVER fabricate script decipherments. Provide script name, confirmedReading (only if legible/documented), approximateTransliteration, translation, and uncertaintyNote.
3. Cover granular observable elements where applicable (for sculptures: posture, mudras, attributes, facial expression, crown/halo, dwarf/mount, pedestal, casting technique; for buildings: dome, inlay/pietra dura, arch/iwans, minarets, plinth, calligraphy bands; for everyday items: joinery, ergonomics, materials, finish).
4. Respond strictly in "${language}" as valid JSON (no markdown fences):
{
  "highlightedPartName": "Name of the specific detail/part addressed (if question/tap was asked)",
  "answer": "Clear, insightful answer to the user's question or tapped region (1-2 concise paragraphs, or empty string if only listing components)",
  "answerCertainty": "established_fact | traditional_interpretation | possible_identification | unknown",
  "components": [
    {
      "id": "part-1",
      "name": "Component name",
      "category": "sculpture | architecture | iconography | inscription | material | context",
      "visualCue": "Exact visible feature to look at",
      "meaningAndSymbolism": "Meaning, iconography, engineering, or cultural role",
      "craftTechnique": "Material / carving / casting note",
      "certainty": "established_fact | traditional_interpretation | possible_identification | unknown"
    }
  ],
  "inscription": {
    "detected": false,
    "script": "",
    "confirmedReading": "",
    "approximateTransliteration": "",
    "translation": "",
    "uncertaintyNote": "",
    "certainty": "established_fact"
  }
}`;

  const contents = options.inlineImage
    ? {
        parts: [
          {
            inlineData: {
              mimeType: options.inlineImage.mimeType,
              data: options.inlineImage.data,
            },
          },
          { text: prompt },
        ],
      }
    : prompt;

  let parsed: any = {};
  let sources: DiscoverSourceCitation[] = [];

  if (options.inlineImage || Date.now() >= googleSearchCooldownUntil) {
    try {
      const aiRes = await generateWithActiveModels(options.aiClient, {
        model: options.inlineImage ? 'gemini-4-hydrogen' : 'gemini-3.1-flash-lite',
        contents,
        config: options.inlineImage ? { responseMimeType: 'application/json' } : { tools: [{ googleSearch: {} }] },
      });

      parsed = safeJsonParse<any>(aiRes.text, {});
      const chunks: any[] = aiRes.candidates?.[0]?.groundingMetadata?.groundingChunks || [];
      sources = chunks
        .map((c) => ({
          title: String(c?.web?.title || 'Reference Source'),
          url: typeof c?.web?.uri === 'string' ? c.web.uri : undefined,
          provider: 'Google Search Grounding',
        }))
        .filter((s) => s.url)
        .slice(0, 4);
    } catch (err: any) {
      if (isGeminiQuotaExhaustedError(err)) {
        if (options.inlineImage) {
          throw new GeminiQuotaError();
        }
        googleSearchCooldownUntil = Date.now() + 60_000;
        console.info(
          '[DiscoverEngine] Detail-by-Detail grounded call hit 429; using structured JSON analysis.'
        );
      } else {
        console.info(
          '[DiscoverEngine] Detail-by-Detail grounded call fallback to structured JSON:',
          sanitizeUserText(err?.message || String(err), 140)
        );
      }
    }
  }

  if (!parsed || (!parsed.answer && (!Array.isArray(parsed.components) || parsed.components.length === 0))) {
    try {
      const fbRes = await generateWithActiveModels(options.aiClient, {
        model: 'gemini-3.1-flash-lite',
        contents,
        config: { responseMimeType: 'application/json' },
      });
      parsed = safeJsonParse<any>(fbRes.text, {});
    } catch (fbErr: any) {
      if (isGeminiQuotaExhaustedError(fbErr)) {
        throw new GeminiQuotaError();
      }
      throw fbErr;
    }
  }

  const components: DetailComponent[] = Array.isArray(parsed.components) && parsed.components.length > 0
    ? parsed.components
        .filter((d: any) => d && typeof d.name === 'string' && d.name.trim())
        .map((d: any, idx: number) => ({
          id: d.id ? String(d.id) : `detail-${idx + 1}`,
          name: String(d.name).trim(),
          category: (['sculpture', 'architecture', 'iconography', 'inscription', 'material', 'context'].includes(d.category)
            ? d.category
            : 'iconography') as DetailComponent['category'],
          visualCue: String(d.visualCue || '').trim(),
          meaningAndSymbolism: String(d.meaningAndSymbolism || '').trim(),
          craftTechnique: d.craftTechnique ? String(d.craftTechnique).trim() : undefined,
          certainty: normalizeCertainty(d.certainty),
        }))
    : options.existingComponents || [];

  return {
    answer: parsed.answer ? String(parsed.answer).trim() : undefined,
    answerCertainty: normalizeCertainty(parsed.answerCertainty || 'possible_identification'),
    highlightedPartName: parsed.highlightedPartName ? String(parsed.highlightedPartName).trim() : undefined,
    components,
    inscription:
      parsed.inscription && parsed.inscription.detected
        ? {
            detected: true,
            script: parsed.inscription.script || undefined,
            confirmedReading: parsed.inscription.confirmedReading || undefined,
            approximateTransliteration: parsed.inscription.approximateTransliteration || undefined,
            translation: parsed.inscription.translation || undefined,
            uncertaintyNote: parsed.inscription.uncertaintyNote || undefined,
            certainty: normalizeCertainty(parsed.inscription.certainty),
          }
        : undefined,
    sources,
  };
}

/**
 * Resolves authentic Wikimedia / Wikipedia images for supplementary perspective scenes
 * instead of injecting unrelated Unsplash stock images.
 */
export async function resolveAuthenticSupplementaryScenes(options: {
  title: string;
  locationName?: string;
  scenes: Array<{ title?: string; caption?: string; type?: string }>;
  gmpApiKey?: string;
}): Promise<SupplementaryImage[]> {
  const cleanTitle = sanitizeUserText(options.title, 120);
  if (!cleanTitle) return [];

  try {
    // Query Wikipedia/Wikimedia Commons directly for authentic images of THIS subject
    const commonsUrl = `https://commons.wikimedia.org/w/api.php?action=query&generator=search&gsrsearch=${encodeURIComponent(
      cleanTitle
    )}&gsrnamespace=6&gsrlimit=6&prop=imageinfo&iiprop=url|extmetadata&iiurlwidth=800&format=json&origin=*`;
    const res = await fetch(commonsUrl, {
      headers: { 'User-Agent': WIKI_USER_AGENT },
      signal: AbortSignal.timeout(2200),
    });

    if (!res.ok) return [];
    const data = await res.json();
    const pages = Object.values(data?.query?.pages || {}) as any[];
    const titleTokens = cleanTitle
      .toLowerCase()
      .split(/\s+/)
      .filter((t) => t.length > 2 && !['the', 'and', 'of', 'in', 'a', 'an'].includes(t));

    const validFiles = pages.filter((p) => {
      const fileTitle = String(p?.title || '').toLowerCase();
      const thumb = p?.imageinfo?.[0]?.thumburl || p?.imageinfo?.[0]?.url || '';
      if (!thumb || (!thumb.includes('.jpg') && !thumb.includes('.jpeg') && !thumb.includes('.png') && !thumb.includes('px-'))) {
        return false;
      }
      if (titleTokens.length === 0) return true;
      return titleTokens.some((tok) => fileTitle.includes(tok));
    });

    return validFiles.slice(0, 4).map((p, idx) => {
      const thumb = p.imageinfo[0].thumburl || p.imageinfo[0].url;
      const proxied = `/api/places/proxy-image?url=${encodeURIComponent(thumb)}`;
      const rawTitle = String(p.title || '')
        .replace(/^File:/i, '')
        .replace(/\.[a-z0-9]+$/i, '')
        .replace(/_/g, ' ');
      const sceneMeta = options.scenes[idx];
      const allowedTypes = ['historical', 'interior', 'aerial', 'night', 'detail', 'art', 'context'];
      const sceneType = (sceneMeta?.type && allowedTypes.includes(sceneMeta.type) ? sceneMeta.type : 'context') as SupplementaryImage['type'];

      return {
        id: `supp-real-${p.pageid || idx}`,
        url: proxied,
        title: sceneMeta?.title || rawTitle.slice(0, 60),
        caption: sceneMeta?.caption || `${rawTitle} — Wikimedia Commons archive view`,
        type: sceneType,
        attribution: `${rawTitle} (Wikimedia Commons)`,
        sourceUrl: `https://commons.wikimedia.org/wiki/${encodeURIComponent(p.title)}`,
        isExampleImage: false,
      };
    });
  } catch {
    return [];
  }
}

/**
 * Analyzes an uploaded or captured camera photo and produces ranked Candidate Identifications
 * along with uncertainty/ambiguity handling (for inscriptions, sculptures, everyday items, landmarks).
 */
export async function identifyPhotoCandidates(options: {
  inlineImage: { mimeType: string; data: string };
  coords?: { latitude?: number; longitude?: number; city?: string; country?: string };
  language?: string;
  guideSettings?: Partial<GuideSettings>;
  userPrompt?: string;
  aiClient: GoogleGenAI;
  gmpApiKey?: string;
}): Promise<{
  candidates: DiscoverCandidate[];
  ocrDetectedText?: string;
  visualObservations: string[];
}> {
  const language = sanitizeUserText(options.language || 'English', 40) || 'English';
  const cleanPrompt = sanitizeUserText(options.userPrompt || '', 260);
  const coordNote =
    options.coords?.latitude && options.coords?.longitude
      ? `Optional GPS hint: Lat ${options.coords.latitude}, Lng ${options.coords.longitude}${options.coords.city ? ` (${options.coords.city})` : ''}. Do NOT assume the image belongs to this city if the image visibly shows another monument or indoor object.`
      : 'No GPS location provided.';

  const prompt = `You are Charaiva's Visual Identification & Candidate Matching Engine.
Examine the attached image carefully. ${coordNote}
${cleanPrompt ? `User's additional clue or question: "${cleanPrompt}"` : ''}
Target display language: "${language}"

RULES:
1. Identify 2 to 4 realistic ranked candidate matches for what is shown:
   - Candidate 1 is the strongest visual identification.
   - Candidates 2–4 are plausible alternatives, regional variants, or sister works when a sculpture, temple fragment, inscription, or object could be ambiguous (if an iconic site like Taj Mahal is unmistakable, give 1 primary match plus closely related sub-structures/views if applicable, or clearly mark high certainty on Candidate 1).
2. If the image is an everyday object (chair, mug, book, bottle, plant, gadget), identify its specific style/type honestly (category: "Everyday Object").
3. If the image is an inscription or plaque, transcribe ONLY legible characters into "ocrDetectedText" — NEVER fabricate unreadable letters.
4. Explicitly state "certaintyStatus" honestly: "established_fact" ONLY if iconic/unmistakable, "possible_identification" if visually inferred or weathered sculpture/fragment, "unknown" if unrecognizable.
5. Output valid JSON strictly matching this schema.`;

  const aiRes = await generateWithActiveModels(options.aiClient, {
    model: 'gemini-4-hydrogen',
    contents: {
      parts: [
        {
          inlineData: {
            mimeType: options.inlineImage.mimeType,
            data: options.inlineImage.data,
          },
        },
        { text: prompt },
      ],
    },
    config: {
      responseMimeType: 'application/json',
      responseSchema: {
        type: Type.OBJECT,
        properties: {
          ocrDetectedText: { type: Type.STRING },
          visualObservations: { type: Type.ARRAY, items: { type: Type.STRING } },
          candidates: {
            type: Type.ARRAY,
            items: {
              type: Type.OBJECT,
              properties: {
                title: { type: Type.STRING },
                englishCanonicalTitle: { type: Type.STRING },
                category: { type: Type.STRING },
                shortDescription: { type: Type.STRING },
                locationOrOrigin: { type: Type.STRING },
                historicalPeriod: { type: Type.STRING },
                certaintyStatus: { type: Type.STRING },
                matchReason: { type: Type.STRING },
                isVisitableSite: { type: Type.BOOLEAN },
              },
              required: ['title', 'englishCanonicalTitle', 'category', 'shortDescription', 'locationOrOrigin', 'certaintyStatus'],
            },
          },
        },
        required: ['visualObservations', 'candidates'],
      },
    },
  });

  const parsed = safeJsonParse<any>(aiRes.text, {});
  const rawCands = Array.isArray(parsed.candidates) ? parsed.candidates : [];

  let mapped: DiscoverCandidate[] = rawCands.slice(0, 4).map((c: any, idx: number) => {
    const certaintyStatus = normalizeCertainty(c.certaintyStatus || 'possible_identification');
    const canonical = String(c.englishCanonicalTitle || c.title).trim();
    return {
      id: `photo-cand-${idx}-${Date.now()}`,
      title: String(c.title).trim(),
      category: String(c.category || 'Heritage Subject').trim(),
      mappedCategory: mapToRecognitionCategory(String(c.category || c.title)),
      shortDescription: String(c.shortDescription || '').trim(),
      locationOrOrigin: String(c.locationOrOrigin || 'Unknown').trim(),
      historicalPeriod: c.historicalPeriod ? String(c.historicalPeriod).trim() : undefined,
      sourceType: 'ai_suggested',
      certaintyStatus,
      certaintyLabel:
        certaintyStatus === 'established_fact'
          ? 'High-Confidence Visual Match'
          : certaintyStatus === 'unknown'
          ? 'Uncertain — Needs Context'
          : 'Possible Visual Match — Verify Details',
      wikipediaTitle: canonical,
      isExampleImage: true,
      matchReason: c.matchReason ? String(c.matchReason).trim() : undefined,
      isVisitableSite: typeof c.isVisitableSite === 'boolean' ? c.isVisitableSite : undefined,
    };
  });

  mapped = await hydrateCandidateThumbnails(mapped);

  return {
    candidates: mapped,
    ocrDetectedText: parsed.ocrDetectedText ? String(parsed.ocrDetectedText).trim() : undefined,
    visualObservations: Array.isArray(parsed.visualObservations)
      ? parsed.visualObservations.filter((v: any) => typeof v === 'string' && v.trim()).slice(0, 5)
      : [],
  };
}

/**
 * Generates an in-depth, non-repetitive exploration of a clicked Explore More topic (Part 6).
 */
export async function generateExploreTopicExpansion(options: {
  landmarkTitle: string;
  category?: string;
  locationOrOrigin?: string;
  topicId?: string;
  topicTitle: string;
  topicAngle?: string;
  promptSeed?: string;
  existingSummary?: string;
  level?: ExplanationLevel;
  language?: string;
  guideSettings?: Partial<GuideSettings>;
  aiClient: GoogleGenAI;
}): Promise<ExploreTopicExpansionResult> {
  const cleanSubject = sanitizeUserText(options.landmarkTitle, 180);
  const cleanTopic = sanitizeUserText(options.topicTitle, 180);
  const cleanLocation = sanitizeUserText(options.locationOrOrigin || '', 120);
  const language = sanitizeUserText(options.language || 'English', 40) || 'English';
  const level = options.level || 'deep';
  const personaKey = String(options.guideSettings?.persona || 'warm_female').toLowerCase();

  const cacheKey = `disc_topic_exp:${cleanSubject.toLowerCase()}:${cleanLocation.toLowerCase()}:${cleanTopic.toLowerCase()}:${level}:${language.toLowerCase()}:${personaKey}`;
  const cached = getDiscoverCached<ExploreTopicExpansionResult>(cacheKey);
  if (cached) return cached;

  const prompt = `You are Charaiva, an authoritative specialist guide, archaeologist, and architectural historian.
Subject: "${cleanSubject}" (${options.category || 'Heritage Subject'}, Verified Location/Origin: "${cleanLocation || 'Global'}")
Clicked Explore More Subtopic: "${cleanTopic}" ${options.topicAngle ? `(Angle: ${options.topicAngle})` : ''}
${options.promptSeed ? `Focus instruction: "${sanitizeUserText(options.promptSeed, 240)}"` : ''}
${options.existingSummary ? `Already covered overview (DO NOT repeat these basics): "${sanitizeUserText(options.existingSummary, 400)}"` : ''}

Target Language: "${language}"
${buildPersonaInstructions(options.guideSettings)}

STRICT ACCURACY & NON-REPETITION RULES:
1. Dive straight into substantive, concrete details about "${cleanTopic}" specifically for "${cleanSubject}". Do NOT rehash the general introduction.
2. Prioritize official heritage/archaeological authorities (ASI, UNESCO, museums, academic scholarship).
3. Distinguish documented facts from folklore/theories, and clearly state if any specific point is unknown or debated. NEVER invent dates, builders, prices, timings, or URLs.
4. Provide 3 to 4 genuinely new, non-repetitive follow-up questions in "${language}".
5. Output ONLY valid JSON (no markdown fences):
{
  "title": "${cleanTopic}",
  "deepExplanation": "2–3 rich, specific paragraphs strictly about this aspect in ${language}",
  "keyHighlights": ["3–5 specific factual highlights or overlooked nuances"],
  "certaintyStatus": "established_fact | traditional_interpretation | possible_identification | unknown",
  "sourcesNote": "Brief note on scholarly/institutional basis (no invented URLs)",
  "followUpQuestions": ["3–4 non-repetitive deep follow-up questions in ${language}"]
}`;

  const aiRes = await generateWithActiveModels(options.aiClient, {
    model: level === 'expert' || level === 'deep' ? 'gemini-4-hydrogen' : 'gemini-3.1-flash-lite',
    contents: prompt,
    config: { responseMimeType: 'application/json' },
  });

  const parsed = safeJsonParse<any>(aiRes.text, {});
  const deepExplanation = String(parsed?.deepExplanation || '').trim();
  if (!deepExplanation) {
    throw new Error(`Unable to generate detailed analysis for "${cleanTopic}" right now.`);
  }

  const result: ExploreTopicExpansionResult = {
    topicId: options.topicId,
    title: String(parsed.title || cleanTopic).trim(),
    deepExplanation,
    keyHighlights: Array.isArray(parsed.keyHighlights)
      ? parsed.keyHighlights.filter((h: any) => typeof h === 'string' && h.trim()).slice(0, 5)
      : [],
    certaintyStatus: normalizeCertainty(parsed.certaintyStatus || 'established_fact'),
    sourcesNote: parsed.sourcesNote ? String(parsed.sourcesNote).trim() : undefined,
    followUpQuestions: Array.isArray(parsed.followUpQuestions)
      ? parsed.followUpQuestions.filter((q: any) => typeof q === 'string' && q.trim()).slice(0, 4)
      : [],
  };

  setDiscoverCached(cacheKey, result, 900);
  return result;
}

/**
 * Generates a context-aware turn for Option B: Open Deep Conversation (Part 7).
 */
export async function generateDeepConversationTurn(options: {
  context: DeepConversationContext | any;
  messages: Array<{ sender: 'user' | 'assistant'; text: string }>;
  userMessage?: string;
  language?: string;
  guideSettings?: Partial<GuideSettings>;
  aiClient: GoogleGenAI;
}): Promise<{
  reply: string;
  followUpSuggestions: string[];
}> {
  const ctx = options.context || {};
  const cleanSubject = sanitizeUserText(ctx.subjectTitle || ctx.landmark?.title || '', 180);
  const cleanVerifiedLoc = sanitizeUserText(
    ctx.verifiedLocation || ctx.verifiedOrigin || ctx.landmark?.locationName || '',
    160
  );
  const cleanNativeTitle = sanitizeUserText(ctx.nativeTitle || ctx.landmark?.nativeTitle || '', 120);
  const cleanCategory = sanitizeUserText(ctx.category || ctx.landmark?.categoryLabel || ctx.landmark?.category || 'Heritage Subject', 80);
  const cleanDetailsType = sanitizeUserText(ctx.activeDetailsType || '', 120);
  const cleanTopic = sanitizeUserText(ctx.selectedExploreTopic?.title || '', 180);
  const language = sanitizeUserText(options.language || ctx.language || ctx.landmark?.language || 'English', 40) || 'English';
  const cleanUserMsg = sanitizeUserText(options.userMessage || '', 600);

  if (cleanUserMsg && hasSuspiciousInjection(cleanUserMsg)) {
    return {
      reply: `Let us keep exploring verified historical, architectural, and cultural details about ${cleanSubject}. What specific detail would you like to examine?`,
      followUpSuggestions: [],
    };
  }

  const recentTurns = (options.messages || [])
    .slice(-10)
    .map((m) => `${m.sender === 'user' ? 'Explorer' : 'Charaiva'}: ${sanitizeUserText(m.text, 700)}`)
    .join('\n');

  const prompt = `You are Charaiva in "Open Deep Conversation" mode — a dedicated, context-locked specialist guide.
LOCKED SUBJECT CONTEXT (NEVER switch to a homonym or confuse with user's GPS city):
- Subject: "${cleanSubject}"${cleanNativeTitle ? ` (${cleanNativeTitle})` : ''}
- Category: "${cleanCategory}"
- Verified Location / Origin: "${cleanVerifiedLoc || 'Use authentic origin for this entity only'}"
- Active View Tab / Level: "${ctx.activeTab || 'overview'}" / "${ctx.activeLevel || 'standard'}"
${cleanDetailsType ? `- Active Details Type / Lens: "${cleanDetailsType}"` : ''}
${cleanTopic ? `- Selected Explore More Topic: "${cleanTopic}"${ctx.selectedExploreTopic?.subtitle ? ` — ${ctx.selectedExploreTopic.subtitle}` : ''}` : ''}
- Strict Response Language: "${language}"
${buildPersonaInstructions(options.guideSettings)}

${recentTurns ? `PRIOR CONVERSATION IN THIS SESSION:\n${recentTurns}\n` : ''}

CURRENT REQUEST:
${cleanUserMsg ? `Explorer asks: "${cleanUserMsg}"` : `Opening Deep Conversation specifically focused on "${cleanTopic || cleanDetailsType || cleanSubject}". Welcome the explorer briefly in 1 sentence and dive straight into detailed, non-repetitive insight on "${cleanTopic || cleanDetailsType || cleanSubject}" without rehashing the basic intro!`}

STRICT ACCURACY & CONVERSATION RULES:
1. Stay anchored to "${cleanSubject}" (${cleanVerifiedLoc}). Never assign unrelated local facts from the user's current city if this entity is located elsewhere.
2. Distinguish documented historical/archaeological evidence (ASI, UNESCO, museums, scholarly sources) from traditional folklore/legends, and admit when something is unverified or unknown. Never fabricate dates, builders, prices, timings, or confidence percentages.
3. Build progressively on prior turns — DO NOT repeat information already given above.
4. Provide 3 concise, non-repetitive follow-up suggestions in "${language}" for continuing the inquiry.
5. Output ONLY valid JSON (no markdown fences):
{
  "reply": "Detailed, conversational, factually grounded response in ${language}",
  "followUpSuggestions": ["3 crisp follow-up questions in ${language}"]
}`;

  const aiRes = await generateWithActiveModels(options.aiClient, {
    model: 'gemini-3.1-flash-lite',
    contents: prompt,
    config: { responseMimeType: 'application/json' },
  });

  const parsed = safeJsonParse<any>(aiRes.text, {});
  const reply =
    String(parsed.reply || '').trim() ||
    `Continuing our in-depth exploration of ${cleanSubject}${cleanTopic ? ` (${cleanTopic})` : ''}. Please ask any specific historical, architectural, or cultural question you would like to examine.`;
  const followUpSuggestions = Array.isArray(parsed.followUpSuggestions)
    ? parsed.followUpSuggestions.filter((q: any) => typeof q === 'string' && q.trim()).slice(0, 4)
    : [];

  return { reply, followUpSuggestions };
}

