import {
  collection,
  deleteDoc,
  doc,
  getDocs,
  orderBy,
  query,
  serverTimestamp,
  setDoc,
  Timestamp,
  updateDoc,
  where,
  writeBatch,
} from 'firebase/firestore';
import { auth, db } from '../firebase';
import { AiChatConversation, AiChatTopicContext, ChatMessage, RecognitionResult } from '../types';
import { handleFirestoreError, OperationType } from './userPersistence';

const IDB_NAME = 'charaiva_ai_chats_v1';
const IDB_VERSION = 1;
const IDB_STORE = 'conversations';
const FALLBACK_LS_PREFIX = 'charaiva_ai_chats_fallback_v1:';
const ACTIVE_CHAT_ID_PREFIX = 'charaiva_active_chat_id_v1:';
const LEGACY_CHAT_STORAGE_KEYS = ['charaiva_chat_history', 'charaiva_ai_chat_messages'];

export type ChatDateGroupKey =
  | 'today'
  | 'yesterday'
  | 'previous7Days'
  | 'previous30Days'
  | 'older';

export interface GroupedConversationsBucket {
  key: ChatDateGroupKey;
  conversations: AiChatConversation[];
}

function clampStr(val: unknown, maxLen: number, fallback = ''): string {
  const cleaned = String(val ?? fallback).trim();
  return cleaned.length > maxLen ? cleaned.slice(0, maxLen) : cleaned;
}

export function generateSafeChatId(prefix: string = 'chat'): string {
  const safePrefix = prefix.replace(/[^a-zA-Z0-9_-]/g, '').slice(0, 16) || 'chat';
  const rand = Math.random().toString(36).replace(/[^a-z0-9]/g, '').slice(0, 7) || 'x1';
  return `${safePrefix}_${Date.now()}_${rand}`.slice(0, 120);
}

/**
 * Generates a short, readable, deterministic conversation title from the user's
 * first message without making an extra paid AI call.
 */
export function generateConversationTitleFromMessage(
  firstUserMessage: string,
  topicPlaceName?: string
): string {
  const raw = String(firstUserMessage || '').replace(/\s+/g, ' ').trim();
  if (!raw) {
    return clampStr(topicPlaceName, 60, 'New Chat') || 'New Chat';
  }

  let stripped = raw
    .replace(
      /^(?:please\s+|can you\s+|could you\s+|would you\s+|hey charaiva[,\s]+|charaiva[,\s]+)*(?:tell me more about|tell me about|explain(?:\s+more\s+about)?|what is|what are|who built|who constructed|when was|where is|how was|how did|why is|why does|describe)\s+/i,
      ''
    )
    .replace(/^(?:the|a|an)\s+/i, '')
    .replace(/[?!.]+$/g, '')
    .trim();

  // If topicPlaceName is known and user sent a pronoun-only opening like "Who built it?"
  const isPronounOnlyOpening = /^(?:it|them|they|this|that|there|history|architecture|secrets|facts|story)$/i.test(
    stripped
  );

  if (stripped.length < 3 && !isPronounOnlyOpening) {
    stripped = raw.replace(/[?!.]+$/g, '').trim();
  }

  if (topicPlaceName && topicPlaceName.trim() && (isPronounOnlyOpening || stripped.length < 6)) {
    stripped = `${topicPlaceName.trim()} — ${stripped}`;
  }

  if (stripped.length > 48) {
    const cut = stripped.slice(0, 48);
    const lastSpace = cut.lastIndexOf(' ');
    stripped = (lastSpace > 20 ? cut.slice(0, lastSpace) : cut).trim();
  }

  if (!stripped) {
    return clampStr(topicPlaceName, 60, 'New Chat') || 'New Chat';
  }

  return stripped.charAt(0).toUpperCase() + stripped.slice(1);
}

export function landmarkToTopicContext(
  landmark?: RecognitionResult | null
): AiChatTopicContext | null {
  if (!landmark || !landmark.title) return null;
  const historicalContext =
    landmark.structuredData?.history || landmark.historicalPeriod || '';
  const architecturalDetails =
    landmark.structuredData?.architectureAndConstruction ||
    (Array.isArray(landmark.architecturalHighlights)
      ? landmark.architecturalHighlights.slice(0, 3).join('; ')
      : '');
  const culturalSignificance =
    landmark.structuredData?.meaningAndSignificance ||
    landmark.culturalSignificance ||
    '';

  return {
    placeName: clampStr(landmark.title, 160),
    locationName: clampStr(landmark.locationName, 200),
    summary: clampStr(landmark.summary, 1500),
    historicalContext: clampStr(historicalContext, 1500),
    architecturalDetails: clampStr(architecturalDetails, 1500),
    culturalSignificance: clampStr(culturalSignificance, 1500),
    landmarkId: clampStr(landmark.id, 160),
  };
}

export function hasRealUserMessages(conv: Pick<AiChatConversation, 'messages' | 'hasUserMessages'>): boolean {
  if (Array.isArray(conv.messages) && conv.messages.some((m) => m.sender === 'user')) {
    return true;
  }
  return Boolean(conv.hasUserMessages);
}

export function sortConversationsNewestFirst(list: AiChatConversation[]): AiChatConversation[] {
  return [...list].sort((a, b) => {
    const tB = Date.parse(b.updatedAt || b.createdAt || '') || 0;
    const tA = Date.parse(a.updatedAt || a.createdAt || '') || 0;
    return tB - tA;
  });
}

export function getLatestMessagePreview(conv: AiChatConversation): string {
  const msgs = Array.isArray(conv.messages) ? conv.messages : [];
  for (let i = msgs.length - 1; i >= 0; i--) {
    const m = msgs[i];
    if (m && typeof m.text === 'string' && m.text.trim()) {
      return clampStr(m.text.replace(/\s+/g, ' '), 110);
    }
  }
  return conv.activeTopicContext?.placeName || '';
}

/**
 * Searches conversations case-insensitively across title, active topic place, and all message bodies.
 */
export function searchConversations(
  conversations: AiChatConversation[],
  rawQuery: string
): AiChatConversation[] {
  const q = String(rawQuery || '').trim().toLowerCase();
  if (!q) return sortConversationsNewestFirst(conversations);

  return sortConversationsNewestFirst(
    conversations.filter((conv) => {
      if ((conv.title || '').toLowerCase().includes(q)) return true;
      if ((conv.activeTopicContext?.placeName || '').toLowerCase().includes(q)) return true;
      if ((conv.rollingSummary || '').toLowerCase().includes(q)) return true;
      return Array.isArray(conv.messages)
        ? conv.messages.some((m) => (m.text || '').toLowerCase().includes(q))
        : false;
    })
  );
}

/**
 * Groups conversations into local-timezone calendar buckets:
 * Today, Yesterday, Previous 7 Days, Previous 30 Days, Older.
 * Empty buckets are omitted and each bucket is sorted newest-first.
 */
export function groupConversationsByDate(
  conversations: AiChatConversation[],
  now: Date = new Date()
): GroupedConversationsBucket[] {
  const startOfToday = new Date(now.getFullYear(), now.getMonth(), now.getDate()).getTime();
  const oneDayMs = 24 * 60 * 60 * 1000;
  const startOfYesterday = startOfToday - oneDayMs;
  const startOf7Days = startOfToday - 7 * oneDayMs;
  const startOf30Days = startOfToday - 30 * oneDayMs;

  const buckets: Record<ChatDateGroupKey, AiChatConversation[]> = {
    today: [],
    yesterday: [],
    previous7Days: [],
    previous30Days: [],
    older: [],
  };

  const sorted = sortConversationsNewestFirst(conversations);
  for (const conv of sorted) {
    const ts = Date.parse(conv.updatedAt || conv.createdAt || '') || now.getTime();
    if (ts >= startOfToday) {
      buckets.today.push(conv);
    } else if (ts >= startOfYesterday) {
      buckets.yesterday.push(conv);
    } else if (ts >= startOf7Days) {
      buckets.previous7Days.push(conv);
    } else if (ts >= startOf30Days) {
      buckets.previous30Days.push(conv);
    } else {
      buckets.older.push(conv);
    }
  }

  const orderedKeys: ChatDateGroupKey[] = [
    'today',
    'yesterday',
    'previous7Days',
    'previous30Days',
    'older',
  ];

  return orderedKeys
    .filter((key) => buckets[key].length > 0)
    .map((key) => ({ key, conversations: buckets[key] }));
}

export function formatConversationUpdatedTime(
  isoDate: string,
  locale: string = 'en',
  now: Date = new Date()
): string {
  const ms = Date.parse(isoDate || '');
  if (!Number.isFinite(ms)) return '';
  const d = new Date(ms);
  const startOfToday = new Date(now.getFullYear(), now.getMonth(), now.getDate()).getTime();
  if (ms >= startOfToday) {
    try {
      return d.toLocaleTimeString(locale || undefined, { hour: '2-digit', minute: '2-digit' });
    } catch {
      return d.toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' });
    }
  }
  try {
    return d.toLocaleDateString(locale || undefined, { month: 'short', day: 'numeric' });
  } catch {
    return d.toLocaleDateString([], { month: 'short', day: 'numeric' });
  }
}

// ============================================================================
// IndexedDB + Safe LocalStorage Fallback (Owner-Isolated)
// ============================================================================

interface StoredIdbRecord extends AiChatConversation {
  storageKey: string;
}

function makeStorageKey(ownerId: string, convId: string): string {
  return `${ownerId}::${convId}`;
}

function openChatIdb(): Promise<IDBDatabase> {
  return new Promise((resolve, reject) => {
    if (typeof window === 'undefined' || !window.indexedDB) {
      reject(new Error('IndexedDB unavailable'));
      return;
    }
    const req = window.indexedDB.open(IDB_NAME, IDB_VERSION);
    req.onupgradeneeded = (event) => {
      const idb = (event.target as IDBOpenDBRequest).result;
      if (!idb.objectStoreNames.contains(IDB_STORE)) {
        const store = idb.createObjectStore(IDB_STORE, { keyPath: 'storageKey' });
        store.createIndex('ownerId', 'ownerId', { unique: false });
        store.createIndex('updatedAt', 'updatedAt', { unique: false });
      }
    };
    req.onsuccess = () => resolve(req.result);
    req.onerror = () => reject(req.error || new Error('IndexedDB open error'));
  });
}

function readLocalFallbackConversations(ownerId: string): AiChatConversation[] {
  if (typeof window === 'undefined') return [];
  try {
    const raw = window.localStorage.getItem(`${FALLBACK_LS_PREFIX}${ownerId}`);
    if (!raw) return [];
    const parsed = JSON.parse(raw);
    if (!Array.isArray(parsed)) return [];
    return parsed.filter(
      (c): c is AiChatConversation =>
        Boolean(c && typeof c.id === 'string' && c.ownerId === ownerId && Array.isArray(c.messages))
    );
  } catch {
    return [];
  }
}

function writeLocalFallbackConversations(ownerId: string, convs: AiChatConversation[]): void {
  if (typeof window === 'undefined') return;
  try {
    const scoped = sortConversationsNewestFirst(
      convs.filter((c) => c.ownerId === ownerId && hasRealUserMessages(c))
    ).slice(0, 60);
    window.localStorage.setItem(`${FALLBACK_LS_PREFIX}${ownerId}`, JSON.stringify(scoped));
  } catch {
    // ignore quota errors
  }
}

async function readIdbConversations(ownerId: string): Promise<AiChatConversation[] | null> {
  try {
    const idb = await openChatIdb();
    return await new Promise<AiChatConversation[]>((resolve, reject) => {
      const tx = idb.transaction(IDB_STORE, 'readonly');
      const store = tx.objectStore(IDB_STORE);
      const idx = store.index('ownerId');
      const req = idx.getAll(ownerId);
      req.onsuccess = () => {
        const rows = (req.result as StoredIdbRecord[]) || [];
        const clean: AiChatConversation[] = rows
          .filter((r) => r && r.ownerId === ownerId && typeof r.id === 'string')
          .map(({ storageKey: _k, ...rest }) => rest);
        resolve(clean);
      };
      req.onerror = () => reject(req.error);
    });
  } catch {
    return null;
  }
}

async function putIdbConversation(ownerId: string, conv: AiChatConversation): Promise<void> {
  try {
    const idb = await openChatIdb();
    await new Promise<void>((resolve, reject) => {
      const tx = idb.transaction(IDB_STORE, 'readwrite');
      const store = tx.objectStore(IDB_STORE);
      const record: StoredIdbRecord = {
        ...conv,
        ownerId,
        storageKey: makeStorageKey(ownerId, conv.id),
      };
      const req = store.put(record);
      req.onsuccess = () => resolve();
      req.onerror = () => reject(req.error);
    });
  } catch {
    // fallback mirror still persists in localStorage
  }
}

async function deleteIdbConversation(ownerId: string, conversationId: string): Promise<void> {
  try {
    const idb = await openChatIdb();
    await new Promise<void>((resolve, reject) => {
      const tx = idb.transaction(IDB_STORE, 'readwrite');
      const store = tx.objectStore(IDB_STORE);
      const req = store.delete(makeStorageKey(ownerId, conversationId));
      req.onsuccess = () => resolve();
      req.onerror = () => reject(req.error);
    });
  } catch {
    // ignore
  }
}

export function getStoredActiveConversationId(ownerId: string): string | null {
  if (typeof window === 'undefined') return null;
  try {
    return window.localStorage.getItem(`${ACTIVE_CHAT_ID_PREFIX}${ownerId}`) || null;
  } catch {
    return null;
  }
}

export function setStoredActiveConversationId(ownerId: string, conversationId: string | null): void {
  if (typeof window === 'undefined') return;
  try {
    const key = `${ACTIVE_CHAT_ID_PREFIX}${ownerId}`;
    if (!conversationId) {
      window.localStorage.removeItem(key);
    } else {
      window.localStorage.setItem(key, conversationId);
    }
  } catch {
    // ignore
  }
}

/**
 * Migrates any legacy single-chat message array cleanly into the new store once if present.
 */
async function checkAndMigrateLegacyLocalChats(ownerId: string): Promise<AiChatConversation[]> {
  if (typeof window === 'undefined' || ownerId !== 'guest') return [];
  const migrated: AiChatConversation[] = [];
  for (const legacyKey of LEGACY_CHAT_STORAGE_KEYS) {
    try {
      const raw = window.localStorage.getItem(legacyKey);
      if (!raw) continue;
      const parsed = JSON.parse(raw);
      if (Array.isArray(parsed) && parsed.some((m: any) => m?.sender === 'user')) {
        const firstUser = parsed.find((m: any) => m?.sender === 'user');
        const nowIso = new Date().toISOString();
        const conv: AiChatConversation = {
          id: generateSafeChatId('legacy'),
          title: generateConversationTitleFromMessage(firstUser?.text || ''),
          createdAt: nowIso,
          updatedAt: nowIso,
          messages: parsed.filter((m: any) => m && typeof m.text === 'string'),
          ownerId: 'guest',
          hasUserMessages: true,
        };
        migrated.push(conv);
        await putIdbConversation('guest', conv);
      }
      window.localStorage.removeItem(legacyKey);
    } catch {
      // ignore malformed legacy entries
    }
  }
  return migrated;
}

// ============================================================================
// Firestore Sync (Verified Google Accounts Only)
// ============================================================================

function timestampToIso(val: unknown): string {
  if (!val) return new Date().toISOString();
  if (val instanceof Timestamp) return val.toDate().toISOString();
  if (typeof (val as { toDate?: () => Date }).toDate === 'function') {
    return (val as { toDate: () => Date }).toDate().toISOString();
  }
  if (typeof val === 'string') return val;
  return new Date().toISOString();
}

function isVerifiedOwnerSession(ownerId: string): boolean {
  return Boolean(
    ownerId &&
      ownerId !== 'guest' &&
      auth.currentUser &&
      auth.currentUser.uid === ownerId
  );
}

async function fetchConversationsFromFirestore(uid: string): Promise<AiChatConversation[]> {
  if (!isVerifiedOwnerSession(uid)) return [];
  const convCollectionPath = `users/${uid}/aiConversations`;
  try {
    const convSnap = await getDocs(
      query(
        collection(db, 'users', uid, 'aiConversations'),
        where('userId', '==', uid),
        orderBy('updatedAt', 'desc')
      )
    );

    const results: AiChatConversation[] = [];
    for (const d of convSnap.docs) {
      const data = d.data();
      const conversationId = String(data.conversationId || d.id);
      const msgsPath = `users/${uid}/aiConversations/${conversationId}/messages`;
      let loadedMsgs: ChatMessage[] = [];
      try {
        const msgSnap = await getDocs(
          query(
            collection(db, 'users', uid, 'aiConversations', conversationId, 'messages'),
            where('userId', '==', uid),
            orderBy('clientCreatedAtMs', 'asc')
          )
        );
        loadedMsgs = msgSnap.docs.map((md) => {
          const m = md.data();
          const createdMs = typeof m.clientCreatedAtMs === 'number' ? m.clientCreatedAtMs : Date.now();
          return {
            id: String(m.messageId || md.id),
            conversationId,
            sender: m.sender === 'user' ? 'user' : 'guide',
            text: String(m.text || ''),
            timestamp: String(m.displayTimestamp || ''),
            createdAt: new Date(createdMs).toISOString(),
            status: m.status === 'error' ? 'error' : 'done',
          };
        });
      } catch (msgErr: any) {
        if (
          msgErr?.code === 'permission-denied' ||
          String(msgErr?.message).includes('Missing or insufficient permissions')
        ) {
          handleFirestoreError(msgErr, OperationType.LIST, msgsPath);
        }
        console.warn('Skipping message load for conversation', conversationId, msgErr);
      }

      const activeTopicContext: AiChatTopicContext | null = data.topicPlaceName
        ? {
            placeName: String(data.topicPlaceName),
            locationName: data.topicLocationName ? String(data.topicLocationName) : undefined,
            summary: data.topicSummary ? String(data.topicSummary) : undefined,
            historicalContext: data.topicHistoricalContext ? String(data.topicHistoricalContext) : undefined,
            architecturalDetails: data.topicArchitecturalDetails
              ? String(data.topicArchitecturalDetails)
              : undefined,
            culturalSignificance: data.topicCulturalSignificance
              ? String(data.topicCulturalSignificance)
              : undefined,
            landmarkId: data.topicLandmarkId ? String(data.topicLandmarkId) : undefined,
          }
        : null;

      results.push({
        id: conversationId,
        title: String(data.title || 'New Chat'),
        createdAt: timestampToIso(data.createdAt),
        updatedAt: timestampToIso(data.updatedAt),
        messages: loadedMsgs,
        rollingSummary: data.rollingSummary ? String(data.rollingSummary) : undefined,
        activeTopicContext,
        languageCode: data.languageCode ? String(data.languageCode) : undefined,
        ownerId: uid,
        hasUserMessages: loadedMsgs.some((m) => m.sender === 'user'),
      });
    }
    return sortConversationsNewestFirst(results.filter(hasRealUserMessages));
  } catch (err: any) {
    if (
      err?.code === 'permission-denied' ||
      String(err?.message).includes('Missing or insufficient permissions')
    ) {
      handleFirestoreError(err, OperationType.LIST, convCollectionPath);
    }
    console.warn('Firestore AI conversations fetch skipped/offline:', err);
    return [];
  }
}

async function syncConversationToFirestore(uid: string, conv: AiChatConversation): Promise<void> {
  if (!isVerifiedOwnerSession(uid) || !hasRealUserMessages(conv)) return;
  const conversationId = conv.id;
  const convPath = `users/${uid}/aiConversations/${conversationId}`;
  const convRef = doc(db, 'users', uid, 'aiConversations', conversationId);

  const safeTitle = clampStr(conv.title, 160, 'New Chat');
  const preview = clampStr(getLatestMessagePreview(conv), 300);
  const persistedMsgs = conv.messages.filter(
    (m) => m && typeof m.text === 'string' && m.text.trim().length > 0 && m.status !== 'sending'
  );

  const baseFields: Record<string, any> = {
    title: safeTitle,
    messageCount: Math.max(0, Math.min(5000, persistedMsgs.length)),
    updatedAt: serverTimestamp(),
  };

  if (conv.rollingSummary) {
    baseFields.rollingSummary = clampStr(conv.rollingSummary, 2500);
  }
  if (preview) {
    baseFields.lastMessagePreview = preview;
  }
  if (conv.languageCode) {
    baseFields.languageCode = clampStr(conv.languageCode, 16);
  }
  if (conv.activeTopicContext?.placeName) {
    baseFields.topicPlaceName = clampStr(conv.activeTopicContext.placeName, 160);
    if (conv.activeTopicContext.locationName) {
      baseFields.topicLocationName = clampStr(conv.activeTopicContext.locationName, 200);
    }
    if (conv.activeTopicContext.summary) {
      baseFields.topicSummary = clampStr(conv.activeTopicContext.summary, 1500);
    }
    if (conv.activeTopicContext.historicalContext) {
      baseFields.topicHistoricalContext = clampStr(conv.activeTopicContext.historicalContext, 1500);
    }
    if (conv.activeTopicContext.architecturalDetails) {
      baseFields.topicArchitecturalDetails = clampStr(
        conv.activeTopicContext.architecturalDetails,
        1500
      );
    }
    if (conv.activeTopicContext.culturalSignificance) {
      baseFields.topicCulturalSignificance = clampStr(
        conv.activeTopicContext.culturalSignificance,
        1500
      );
    }
    if (conv.activeTopicContext.landmarkId) {
      baseFields.topicLandmarkId = clampStr(conv.activeTopicContext.landmarkId, 160);
    }
  }

  try {
    // First try update; if doc does not exist yet, create cleanly
    try {
      await updateDoc(convRef, baseFields);
    } catch (updateErr: any) {
      if (updateErr?.code === 'not-found' || String(updateErr?.message).includes('No document to update')) {
        await setDoc(convRef, {
          ...baseFields,
          conversationId,
          userId: uid,
          createdAt: serverTimestamp(),
        });
      } else {
        throw updateErr;
      }
    }

    // Upsert each finalized message cleanly in order
    for (let idx = 0; idx < persistedMsgs.length; idx++) {
      const m = persistedMsgs[idx];
      const messageId = String(m.id || `msg_${idx}`).replace(/[^a-zA-Z0-9_-]/g, '_').slice(0, 128);
      const msgRef = doc(db, 'users', uid, 'aiConversations', conversationId, 'messages', messageId);
      const msgPath = `users/${uid}/aiConversations/${conversationId}/messages/${messageId}`;
      const createdMs = m.createdAt ? Date.parse(m.createdAt) || Date.now() + idx : Date.now() + idx;
      const cleanStatus = m.status === 'error' ? 'error' : 'done';
      try {
        await updateDoc(msgRef, {
          text: clampStr(m.text, 12000, '...'),
          displayTimestamp: clampStr(m.timestamp, 40),
          status: cleanStatus,
        });
      } catch (msgUpdateErr: any) {
        if (
          msgUpdateErr?.code === 'not-found' ||
          String(msgUpdateErr?.message).includes('No document to update')
        ) {
          await setDoc(msgRef, {
            messageId,
            conversationId,
            userId: uid,
            sender: m.sender === 'user' ? 'user' : 'guide',
            text: clampStr(m.text, 12000, '...'),
            displayTimestamp: clampStr(m.timestamp, 40),
            clientCreatedAtMs: Math.max(0, Math.floor(createdMs)),
            status: cleanStatus,
            createdAt: serverTimestamp(),
          });
        } else if (
          msgUpdateErr?.code === 'permission-denied' ||
          String(msgUpdateErr?.message).includes('Missing or insufficient permissions')
        ) {
          handleFirestoreError(msgUpdateErr, OperationType.WRITE, msgPath);
        }
      }
    }
  } catch (err: any) {
    if (
      err?.code === 'permission-denied' ||
      String(err?.message).includes('Missing or insufficient permissions')
    ) {
      handleFirestoreError(err, OperationType.WRITE, convPath);
    }
    console.warn('Firestore AI conversation sync skipped/offline:', err);
  }
}

async function renameConversationInFirestore(
  uid: string,
  conversationId: string,
  newTitle: string
): Promise<void> {
  if (!isVerifiedOwnerSession(uid)) return;
  const convPath = `users/${uid}/aiConversations/${conversationId}`;
  const convRef = doc(db, 'users', uid, 'aiConversations', conversationId);
  try {
    await updateDoc(convRef, {
      title: clampStr(newTitle, 160, 'New Chat'),
      updatedAt: serverTimestamp(),
    });
  } catch (err: any) {
    if (err?.code === 'not-found') return;
    if (
      err?.code === 'permission-denied' ||
      String(err?.message).includes('Missing or insufficient permissions')
    ) {
      handleFirestoreError(err, OperationType.UPDATE, convPath);
    }
    console.warn('Firestore rename skipped/offline:', err);
  }
}

async function deleteConversationInFirestore(uid: string, conversationId: string): Promise<void> {
  if (!isVerifiedOwnerSession(uid)) return;
  const convPath = `users/${uid}/aiConversations/${conversationId}`;
  try {
    const msgsSnap = await getDocs(
      query(
        collection(db, 'users', uid, 'aiConversations', conversationId, 'messages'),
        where('userId', '==', uid)
      )
    );
    if (!msgsSnap.empty) {
      const batch = writeBatch(db);
      msgsSnap.docs.forEach((d) => batch.delete(d.ref));
      await batch.commit();
    }
    await deleteDoc(doc(db, 'users', uid, 'aiConversations', conversationId));
  } catch (err: any) {
    if (err?.code === 'not-found') return;
    if (
      err?.code === 'permission-denied' ||
      String(err?.message).includes('Missing or insufficient permissions')
    ) {
      handleFirestoreError(err, OperationType.DELETE, convPath);
    }
    console.warn('Firestore delete conversation skipped/offline:', err);
  }
}

// ============================================================================
// Public Session Storage Orchestrator
// ============================================================================

export async function loadConversationsForOwner(ownerId: string): Promise<AiChatConversation[]> {
  const scopedOwner = ownerId || 'guest';
  const [idbList, migratedLegacy] = await Promise.all([
    readIdbConversations(scopedOwner),
    checkAndMigrateLegacyLocalChats(scopedOwner),
  ]);
  const fallbackList = readLocalFallbackConversations(scopedOwner);

  // Merge local caches by conversation ID (keeping newest/most complete)
  const mergedMap = new Map<string, AiChatConversation>();
  for (const item of [...fallbackList, ...(idbList || []), ...migratedLegacy]) {
    if (!item || item.ownerId !== scopedOwner || !hasRealUserMessages(item)) continue;
    const prev = mergedMap.get(item.id);
    if (
      !prev ||
      Date.parse(item.updatedAt || '') > Date.parse(prev.updatedAt || '') ||
      item.messages.length > prev.messages.length
    ) {
      mergedMap.set(item.id, item);
    }
  }

  // Merge cloud conversations when signed in as verified Google user
  if (isVerifiedOwnerSession(scopedOwner)) {
    const cloudList = await fetchConversationsFromFirestore(scopedOwner);
    for (const cloudConv of cloudList) {
      const localConv = mergedMap.get(cloudConv.id);
      if (
        !localConv ||
        cloudConv.messages.length > localConv.messages.length ||
        (cloudConv.messages.length === localConv.messages.length &&
          Date.parse(cloudConv.updatedAt || '') >= Date.parse(localConv.updatedAt || ''))
      ) {
        mergedMap.set(cloudConv.id, cloudConv);
        await putIdbConversation(scopedOwner, cloudConv);
      }
    }
  }

  const finalSorted = sortConversationsNewestFirst(Array.from(mergedMap.values()));
  writeLocalFallbackConversations(scopedOwner, finalSorted);
  return finalSorted;
}

export async function saveConversationForOwner(
  ownerId: string,
  conv: AiChatConversation,
  allConversationsSnapshot?: AiChatConversation[]
): Promise<void> {
  const scopedOwner = ownerId || 'guest';
  if (!hasRealUserMessages(conv)) return;
  const scopedConv: AiChatConversation = {
    ...conv,
    ownerId: scopedOwner,
    hasUserMessages: true,
  };

  await putIdbConversation(scopedOwner, scopedConv);

  const currentFallback = allConversationsSnapshot
    ? allConversationsSnapshot.map((c) => (c.id === scopedConv.id ? scopedConv : c))
    : [
        scopedConv,
        ...readLocalFallbackConversations(scopedOwner).filter((c) => c.id !== scopedConv.id),
      ];
  writeLocalFallbackConversations(scopedOwner, currentFallback);

  if (isVerifiedOwnerSession(scopedOwner)) {
    await syncConversationToFirestore(scopedOwner, scopedConv);
  }
}

export async function renameConversationForOwner(
  ownerId: string,
  conversationId: string,
  newTitle: string,
  allConversationsSnapshot?: AiChatConversation[]
): Promise<void> {
  const scopedOwner = ownerId || 'guest';
  const cleanTitle = clampStr(newTitle, 160);
  if (!cleanTitle) return;

  const existingList = allConversationsSnapshot || readLocalFallbackConversations(scopedOwner);
  const target = existingList.find((c) => c.id === conversationId);
  if (target) {
    const updated: AiChatConversation = {
      ...target,
      title: cleanTitle,
      updatedAt: new Date().toISOString(),
    };
    await putIdbConversation(scopedOwner, updated);
    writeLocalFallbackConversations(
      scopedOwner,
      existingList.map((c) => (c.id === conversationId ? updated : c))
    );
  }

  if (isVerifiedOwnerSession(scopedOwner)) {
    await renameConversationInFirestore(scopedOwner, conversationId, cleanTitle);
  }
}

export async function deleteConversationForOwner(
  ownerId: string,
  conversationId: string,
  allConversationsSnapshot?: AiChatConversation[]
): Promise<void> {
  const scopedOwner = ownerId || 'guest';
  await deleteIdbConversation(scopedOwner, conversationId);

  const remaining = (allConversationsSnapshot || readLocalFallbackConversations(scopedOwner)).filter(
    (c) => c.id !== conversationId
  );
  writeLocalFallbackConversations(scopedOwner, remaining);

  if (getStoredActiveConversationId(scopedOwner) === conversationId) {
    setStoredActiveConversationId(scopedOwner, remaining[0]?.id || null);
  }

  if (isVerifiedOwnerSession(scopedOwner)) {
    await deleteConversationInFirestore(scopedOwner, conversationId);
  }
}
