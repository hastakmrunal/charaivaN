import test from 'node:test';
import assert from 'node:assert/strict';
import {
  backLayerRegistry,
  clearScrollPosition,
  createInitialScreenStack,
  getRouteTab,
  getScrollPosition,
  popScreenRoute,
  pushScreenRoute,
  replaceTopScreenRoute,
  saveScrollPosition,
} from '../src/utils/navigationHistory.ts';
import type { DeepConversationContext, RecognitionResult } from '../src/types.ts';

function makeLandmark(id: string, title: string): RecognitionResult {
  return {
    id,
    title,
    category: 'monument',
    locationName: 'Agra, India',
    summary: `${title} summary`,
    narration: `${title} narration`,
    culturalSignificance: 'Cultural significance',
    imageUrl: '',
    confidence: 0.98,
    keyFacts: [],
    tags: [],
  };
}

test('navigation stack preserves Search -> Explanation -> Deep Conversation -> Back -> Search roundtrips', () => {
  let stack = createInitialScreenStack('home');
  assert.equal(getRouteTab(stack[stack.length - 1]), 'home');

  stack = pushScreenRoute(stack, { kind: 'tab', tab: 'discover' });
  assert.equal(stack.length, 2);

  const taj = makeLandmark('wiki-taj', 'Taj Mahal');
  stack = pushScreenRoute(stack, { kind: 'explanation', originTab: 'discover', landmark: taj });
  assert.equal(stack.length, 3);
  assert.equal(getRouteTab(stack[stack.length - 1]), 'discover');

  const convContext: DeepConversationContext = {
    landmark: taj,
    activeTab: 'detail',
    activeLevel: 'deep',
    activeDetailsType: 'Historical, Architectural',
  };
  stack = pushScreenRoute(stack, { kind: 'deep_conversation', originTab: 'discover', context: convContext });
  assert.equal(stack.length, 4);

  // Back from Deep Conversation returns directly to preserved ExplanationView
  const pop1 = popScreenRoute(stack);
  assert.equal(pop1.didPop, true);
  stack = pop1.nextStack;
  assert.equal(stack[stack.length - 1].kind, 'explanation');

  // Back from Explanation returns directly to Discover Search
  const pop2 = popScreenRoute(stack);
  assert.equal(pop2.didPop, true);
  stack = pop2.nextStack;
  assert.deepEqual(stack[stack.length - 1], { kind: 'tab', tab: 'discover' });

  // Back from Discover returns to Home root
  const pop3 = popScreenRoute(stack);
  assert.equal(pop3.didPop, true);
  assert.deepEqual(pop3.nextStack, [{ kind: 'tab', tab: 'home' }]);
});

test('nested Related Discovery Explanation preserves parent Explanation on stack', () => {
  const taj = makeLandmark('wiki-taj', 'Taj Mahal');
  const agraFort = makeLandmark('wiki-fort', 'Agra Fort');

  let stack = createInitialScreenStack('home');
  stack = pushScreenRoute(stack, { kind: 'tab', tab: 'discover' });
  stack = pushScreenRoute(stack, { kind: 'explanation', originTab: 'discover', landmark: taj });
  stack = pushScreenRoute(stack, { kind: 'explanation', originTab: 'discover', landmark: agraFort });

  const explEntries = stack.filter((r) => r.kind === 'explanation');
  assert.equal(explEntries.length, 2);

  const popped = popScreenRoute(stack);
  assert.equal(popped.didPop, true);
  const top = popped.nextStack[popped.nextStack.length - 1];
  assert.equal(top.kind, 'explanation');
  if (top.kind === 'explanation') {
    assert.equal(top.landmark.id, 'wiki-taj');
  }
});

test('replay routes (intro/tour/login) restore underlying workspace route on Back', () => {
  let stack = createInitialScreenStack('home');
  stack = pushScreenRoute(stack, { kind: 'tab', tab: 'settings' });
  stack = pushScreenRoute(stack, { kind: 'replay', mode: 'intro' });
  assert.equal(stack[stack.length - 1].kind, 'replay');

  const afterTour = replaceTopScreenRoute(stack, { kind: 'replay', mode: 'tour' });
  assert.equal(afterTour.length, 3);

  const popped = popScreenRoute(afterTour);
  assert.equal(popped.didPop, true);
  assert.deepEqual(popped.nextStack[popped.nextStack.length - 1], { kind: 'tab', tab: 'settings' });
});

test('backLayerRegistry dismisses modals and drawers in LIFO priority order', () => {
  backLayerRegistry.clear();
  const dismissed: string[] = [];

  const unsubCity = backLayerRegistry.register('city-guide', () => dismissed.push('city-guide'), 90);
  const unsubLang = backLayerRegistry.register('language-modal', () => dismissed.push('language-modal'), 100);
  const unsubDeepDive = backLayerRegistry.register('deep-dive', () => dismissed.push('deep-dive'), 65);

  assert.equal(backLayerRegistry.dismissTop(0), true);
  assert.equal(dismissed[0], 'language-modal');
  unsubLang();

  assert.equal(backLayerRegistry.dismissTop(0), true);
  assert.equal(dismissed[1], 'city-guide');
  unsubCity();

  assert.equal(backLayerRegistry.dismissTop(0), true);
  assert.equal(dismissed[2], 'deep-dive');
  unsubDeepDive();

  assert.equal(backLayerRegistry.hasActive(0), false);
});

test('per-view and per-subtab scroll offsets remain isolated and restorable', () => {
  saveScrollPosition('tab:nearby', 260);
  saveScrollPosition('settings:voice', 180);
  saveScrollPosition('settings:language', 0);
  saveScrollPosition('explanation:wiki-taj:overview', 420);
  saveScrollPosition('explanation:wiki-taj:detail', 95);

  assert.equal(getScrollPosition('tab:nearby'), 260);
  assert.equal(getScrollPosition('settings:voice'), 180);
  assert.equal(getScrollPosition('settings:language'), 0);
  assert.equal(getScrollPosition('explanation:wiki-taj:overview'), 420);
  assert.equal(getScrollPosition('explanation:wiki-taj:detail'), 95);

  clearScrollPosition('tab:nearby');
  assert.equal(getScrollPosition('tab:nearby'), 0);
  clearScrollPosition('settings:voice');
  clearScrollPosition('settings:language');
  clearScrollPosition('explanation:wiki-taj:overview');
  clearScrollPosition('explanation:wiki-taj:detail');
});
