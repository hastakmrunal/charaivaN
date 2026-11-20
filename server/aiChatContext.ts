export interface ChatHistoryTurnInput {
  sender: 'user' | 'guide';
  text: string;
  status?: 'sending' | 'done' | 'error';
}

export interface ChatTopicContextInput {
  placeName?: string;
  title?: string;
  locationName?: string;
  summary?: string;
  historicalContext?: string;
  architecturalDetails?: string;
  culturalSignificance?: string;
  landmarkId?: string;
}

export interface NormalizedContentPart {
  role: 'user' | 'model';
  parts: Array<{ text: string }>;
}

export interface BuiltChatRequestContext {
  systemInstruction: string;
  contents: NormalizedContentPart[];
  updatedRollingSummary: string;
  recentTurnsUsed: number;
  droppedTurnsCount: number;
}

const MAX_RECENT_MESSAGES = 12;
const MAX_RECENT_HISTORY_CHARS = 7500;
const MAX_SUMMARY_CHARS = 1800;

function cleanText(raw: unknown, maxLen: number): string {
  const s = typeof raw === 'string' ? raw.replace(/\s+/g, ' ').trim() : '';
  return s.length > maxLen ? `${s.slice(0, Math.max(0, maxLen - 1)).trim()}…` : s;
}

function cleanPreserveNewlines(raw: unknown, maxLen: number): string {
  const s = typeof raw === 'string' ? raw.trim() : '';
  return s.length > maxLen ? s.slice(0, maxLen) : s;
}

/**
 * Deterministic, non-inventive rolling summary compressor for older turns
 * that fall outside the recent multi-turn window. Preserves user topics and
 * key factual entities mentioned without making extra paid LLM calls.
 */
export function buildRollingSummary(
  previousSummary: string | undefined,
  droppedTurns: ChatHistoryTurnInput[],
  topic?: ChatTopicContextInput | null
): string {
  const segments: string[] = [];
  const prevClean = cleanText(previousSummary, 900);
  if (prevClean) {
    segments.push(prevClean);
  }

  const placeName = cleanText(topic?.placeName || topic?.title, 120);
  if (placeName && !prevClean.toLowerCase().includes(placeName.toLowerCase())) {
    segments.push(`Primary subject: ${placeName}`);
  }

  for (const turn of droppedTurns) {
    if (turn.status === 'error') continue;
    const text = cleanText(turn.text, turn.sender === 'user' ? 160 : 220);
    if (!text) continue;
    const prefix = turn.sender === 'user' ? 'User asked' : 'Guide covered';
    segments.push(`${prefix}: ${text}`);
  }

  const combined = segments.join(' | ').trim();
  if (combined.length <= MAX_SUMMARY_CHARS) {
    return combined;
  }
  // Keep latest context while retaining the beginning anchor
  const head = combined.slice(0, 320);
  const tail = combined.slice(-(MAX_SUMMARY_CHARS - 340));
  return `${head} … ${tail}`;
}

/**
 * Splits historical turns into (olderDropped, recentWindow) bounded by message count
 * and character budget so Gemini context stays focused and responsive.
 */
export function partitionConversationHistory(
  historyMessages: ChatHistoryTurnInput[] | undefined
): {
  dropped: ChatHistoryTurnInput[];
  recent: ChatHistoryTurnInput[];
} {
  if (!Array.isArray(historyMessages) || historyMessages.length === 0) {
    return { dropped: [], recent: [] };
  }

  const valid = historyMessages.filter(
    (m) =>
      m &&
      (m.sender === 'user' || m.sender === 'guide') &&
      m.status !== 'error' &&
      typeof m.text === 'string' &&
      m.text.trim().length > 0
  );

  if (valid.length === 0) {
    return { dropped: [], recent: [] };
  }

  // Strip a solitary synthetic welcome greeting before the first user turn
  const firstUserIdx = valid.findIndex((m) => m.sender === 'user');
  if (firstUserIdx === -1) {
    // Only guide greeting existed; treat as non-essential starter
    return { dropped: [], recent: [] };
  }
  const meaningful = valid.slice(firstUserIdx);

  let charCount = 0;
  let splitIdx = meaningful.length;
  for (let i = meaningful.length - 1; i >= 0; i--) {
    const turnLen = meaningful[i].text.length;
    const keptCount = meaningful.length - i;
    if (keptCount > MAX_RECENT_MESSAGES || (keptCount > 2 && charCount + turnLen > MAX_RECENT_HISTORY_CHARS)) {
      break;
    }
    charCount += turnLen;
    splitIdx = i;
  }

  return {
    dropped: meaningful.slice(0, splitIdx),
    recent: meaningful.slice(splitIdx),
  };
}

/**
 * Normalizes multi-turn Gemini `contents` array so roles always alternate cleanly,
 * starting with `'user'` and ending with the current user message.
 */
export function buildNormalizedGeminiContents(
  recentTurns: ChatHistoryTurnInput[],
  currentUserMessage: string
): NormalizedContentPart[] {
  const rawContents: NormalizedContentPart[] = [];

  for (const turn of recentTurns) {
    const role: 'user' | 'model' = turn.sender === 'user' ? 'user' : 'model';
    const text = cleanPreserveNewlines(turn.text, 4000);
    if (!text) continue;

    // Gemini requires the first turn to be 'user'
    if (rawContents.length === 0 && role !== 'user') continue;

    const prev = rawContents[rawContents.length - 1];
    if (prev && prev.role === role) {
      prev.parts[0].text = `${prev.parts[0].text}\n\n${text}`;
    } else {
      rawContents.push({ role, parts: [{ text }] });
    }
  }

  const trimmedCurrent = cleanPreserveNewlines(currentUserMessage, 4000);
  if (trimmedCurrent) {
    const prev = rawContents[rawContents.length - 1];
    if (prev && prev.role === 'user') {
      // Avoid duplicating if caller accidentally included current message at end of historyMessages
      if (prev.parts[0].text.trim() !== trimmedCurrent) {
        prev.parts[0].text = `${prev.parts[0].text}\n\n${trimmedCurrent}`;
      }
    } else {
      rawContents.push({ role: 'user', parts: [{ text: trimmedCurrent }] });
    }
  }

  return rawContents;
}

export function buildChatContextForGemini(params: {
  userMessage: string;
  historyMessages?: ChatHistoryTurnInput[];
  rollingSummary?: string;
  activeTopicContext?: ChatTopicContextInput | null;
  landmarkContext?: ChatTopicContextInput | null;
  visitedTopics?: string[];
  language?: string;
  topicDirectives?: string;
  persona?: string;
  voiceGender?: string;
}): BuiltChatRequestContext {
  const language = cleanText(params.language || 'English', 60) || 'English';
  const guideRole = params.voiceGender === 'male' ? 'live personal male guide' : 'live personal female guide';

  const topic = params.activeTopicContext || params.landmarkContext || null;
  const topicPlace = cleanText(topic?.placeName || topic?.title, 160);
  const topicLocation = cleanText(topic?.locationName, 200);
  const topicSummary = cleanText(topic?.summary, 1000);
  const topicHistorical = cleanText(topic?.historicalContext, 800);
  const topicArchitectural = cleanText(topic?.architecturalDetails, 800);
  const topicCultural = cleanText(topic?.culturalSignificance, 800);

  const { dropped, recent } = partitionConversationHistory(params.historyMessages);
  const updatedRollingSummary = buildRollingSummary(params.rollingSummary, dropped, topic);

  const topicContextLines: string[] = [];
  if (topicPlace) topicContextLines.push(`Subject/Monument: ${topicPlace}`);
  if (topicLocation) topicContextLines.push(`Location: ${topicLocation}`);
  if (topicSummary) topicContextLines.push(`Overview: ${topicSummary}`);
  if (topicHistorical) topicContextLines.push(`Historical Context: ${topicHistorical}`);
  if (topicArchitectural) topicContextLines.push(`Architectural Details: ${topicArchitectural}`);
  if (topicCultural) topicContextLines.push(`Cultural Significance: ${topicCultural}`);

  const visitedList = Array.isArray(params.visitedTopics)
    ? params.visitedTopics.filter((x) => typeof x === 'string' && x.trim()).slice(0, 8)
    : [];

  const systemInstruction = `You are Charaiva, an expert multilingual AI Tourist Guide having an ongoing, persistent conversation with the traveler.

User Language: "${language}". Always reply naturally in "${language}".
Guide Voice & Tone: Warm, knowledgeable, concise, engaging (${guideRole}).

${
  topicContextLines.length > 0
    ? `Active Conversation Subject Context:\n${topicContextLines.join('\n')}`
    : 'Active Conversation Subject Context: General heritage, monuments, architecture, culture, food, and travel conversation.'
}

${
  updatedRollingSummary
    ? `Earlier Conversation Summary (preserve continuity seamlessly):\n${updatedRollingSummary}`
    : ''
}

${
  visitedList.length > 0
    ? `Traveler's Recent Visited Journal Highlights (background reference ONLY if relevant or asked; NEVER force these onto unrelated questions): [${visitedList.join(', ')}].`
    : ''
}

${params.topicDirectives ? `${params.topicDirectives}\n` : ''}Conversational Memory & Grounding Rules:
1. Maintain multi-turn memory across this conversation. When the user uses pronouns or follow-ups ("Who constructed them?", "How was it built?", "Tell me more", "Why does that happen?", "Compare them"), resolve them strictly against prior turns and the Active Conversation Subject Context above.
2. If the user transitions to a related sub-site or new topic in this chat (for example, from Ellora Caves to Kailasa Temple, or comparing two monuments), address the new focus accurately while retaining awareness of earlier turns in this chat.
3. Never invent facts, inscriptions, dates, or fake context. If a short question is genuinely ambiguous with no prior referent or active subject, politely ask a concise clarifying question in "${language}".
4. Do not force unrelated nearby cities or GPS locations onto a general or non-local question unless the user asks about a nearby place.
5. Keep answers clear, vivid, and concise (typically under 180 words unless the user asks for deep detail).`;

  const contents = buildNormalizedGeminiContents(recent, params.userMessage);

  return {
    systemInstruction,
    contents,
    updatedRollingSummary,
    recentTurnsUsed: recent.length,
    droppedTurnsCount: dropped.length,
  };
}
