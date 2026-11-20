import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import {
  buildChatContextForGemini,
  buildNormalizedGeminiContents,
  buildRollingSummary,
  partitionConversationHistory,
} from '../server/aiChatContext';
import {
  generateConversationTitleFromMessage,
  generateSafeChatId,
  groupConversationsByDate,
  hasRealUserMessages,
  searchConversations,
} from '../src/utils/aiChatPersistence';
import { AiChatConversation } from '../src/types';

function makeConv(overrides: Partial<AiChatConversation> = {}): AiChatConversation {
  const id = overrides.id || generateSafeChatId('test');
  const nowIso = new Date().toISOString();
  return {
    id,
    title: 'Sample Chat',
    createdAt: nowIso,
    updatedAt: nowIso,
    messages: [
      { id: 'w1', sender: 'guide', text: 'Namaste!', timestamp: '10:00 AM' },
      { id: 'u1', sender: 'user', text: 'Tell me about Taj Mahal.', timestamp: '10:01 AM' },
      { id: 'g1', sender: 'guide', text: 'Built by Shah Jahan in Agra.', timestamp: '10:01 AM' },
    ],
    ownerId: 'guest',
    hasUserMessages: true,
    ...overrides,
  };
}

describe('Backend AI Chat Conversation Memory & Context Builder', () => {
  it('builds chronological multi-turn Gemini contents starting and ending with user', () => {
    const built = buildChatContextForGemini({
      userMessage: 'Why did he build it?',
      historyMessages: [
        { sender: 'guide', text: 'Namaste! Ask me anything.' },
        { sender: 'user', text: 'Tell me about Taj Mahal.' },
        { sender: 'guide', text: 'It is a white marble mausoleum in Agra commissioned by Emperor Shah Jahan.' },
        { sender: 'user', text: 'Who built it?' },
        { sender: 'guide', text: 'Shah Jahan commissioned it in 1632.' },
      ],
      language: 'English',
    });

    assert.equal(built.contents[0].role, 'user');
    assert.equal(built.contents[built.contents.length - 1].role, 'user');
    assert.equal(built.contents[built.contents.length - 1].parts[0].text, 'Why did he build it?');
    assert.equal(built.contents.length, 5);
    assert.match(built.systemInstruction, /resolve them strictly against prior turns/i);
  });

  it('ignores error placeholder messages and deduplicates repeated trailing user turn', () => {
    const { recent } = partitionConversationHistory([
      { sender: 'user', text: 'First question', status: 'done' },
      { sender: 'guide', text: 'Error message', status: 'error' },
      { sender: 'guide', text: 'Real guide answer', status: 'done' },
      { sender: 'user', text: 'Follow up', status: 'done' },
    ]);
    assert.equal(recent.length, 3);
    const contents = buildNormalizedGeminiContents(recent, 'Follow up');
    assert.equal(contents.length, 3);
    assert.equal(contents[2].parts[0].text, 'Follow up');
  });

  it('compresses overflow turns into rollingSummary for long multi-turn chats', () => {
    const longHistory = Array.from({ length: 18 }, (_, i) => ({
      sender: (i % 2 === 0 ? 'user' : 'guide') as 'user' | 'guide',
      text: `Turn ${i + 1}: Ellora Caves rock-cut architecture detail ${i + 1}`,
      status: 'done' as const,
    }));

    const built = buildChatContextForGemini({
      userMessage: 'Now tell me specifically about Kailasa Temple.',
      historyMessages: longHistory,
      activeTopicContext: { placeName: 'Ellora Caves', locationName: 'Maharashtra, India' },
      language: 'English',
    });

    assert.ok(built.droppedTurnsCount > 0);
    assert.equal(built.recentTurnsUsed, 12);
    assert.match(built.updatedRollingSummary, /Ellora Caves/);
    assert.match(built.updatedRollingSummary, /Turn 1:/);
    assert.match(built.systemInstruction, /Earlier Conversation Summary/);
    assert.match(built.systemInstruction, /Subject\/Monument: Ellora Caves/);
  });

  it('never appends empty rolling summary on invalid/empty history', () => {
    const summary = buildRollingSummary('', [], null);
    assert.equal(summary, '');
  });
});

describe('Frontend AI Chat History Helpers', () => {
  it('auto-generates concise readable titles without paid API calls', () => {
    assert.equal(generateConversationTitleFromMessage('Tell me about Taj Mahal.'), 'Taj Mahal');
    assert.equal(
      generateConversationTitleFromMessage('Who built it?', 'Brihadeeswarar Temple'),
      'Brihadeeswarar Temple — it'
    );
    const longPrompt =
      'Can you explain the fascinating granite engineering techniques used to construct the Brihadeeswarar Temple gopuram?';
    const title = generateConversationTitleFromMessage(longPrompt);
    assert.ok(title.length <= 50 && title.length > 10);
  });

  it('detects real user messages so empty drafts do not pollute History', () => {
    const emptyDraft = makeConv({
      messages: [{ id: 'w1', sender: 'guide', text: 'Welcome!', timestamp: '10:00' }],
      hasUserMessages: false,
    });
    assert.equal(hasRealUserMessages(emptyDraft), false);
    const activeChat = makeConv();
    assert.equal(hasRealUserMessages(activeChat), true);
  });

  it('searches across conversation title, topic place, and message bodies', () => {
    const c1 = makeConv({ id: 'c1', title: 'Taj Mahal Secrets' });
    const c2 = makeConv({
      id: 'c2',
      title: 'Hampi Ruins',
      messages: [
        { id: 'u2', sender: 'user', text: 'Where are the musical pillars in Vittala Temple?', timestamp: '11:00' },
      ],
    });
    const byMsg = searchConversations([c1, c2], 'musical pillars');
    assert.deepEqual(
      byMsg.map((c) => c.id),
      ['c2']
    );
    const byTitle = searchConversations([c1, c2], 'taj');
    assert.deepEqual(
      byTitle.map((c) => c.id),
      ['c1']
    );
  });

  it('groups conversations into Today, Yesterday, Previous 7 Days, Previous 30 Days, Older and omits empty buckets', () => {
    const now = new Date(2026, 6, 15, 14, 0, 0); // July 15, 2026 2:00 PM local
    const todayConv = makeConv({ id: 'today', updatedAt: new Date(2026, 6, 15, 10, 0, 0).toISOString() });
    const yestConv = makeConv({ id: 'yest', updatedAt: new Date(2026, 6, 14, 18, 0, 0).toISOString() });
    const prev7Conv = makeConv({ id: 'p7', updatedAt: new Date(2026, 6, 10, 12, 0, 0).toISOString() });
    const olderConv = makeConv({ id: 'old', updatedAt: new Date(2026, 4, 1, 12, 0, 0).toISOString() });

    const groups = groupConversationsByDate([olderConv, prev7Conv, todayConv, yestConv], now);
    assert.deepEqual(
      groups.map((g) => g.key),
      ['today', 'yesterday', 'previous7Days', 'older']
    );
    assert.equal(groups[0].conversations[0].id, 'today');
    assert.equal(groups[1].conversations[0].id, 'yest');
  });
});
