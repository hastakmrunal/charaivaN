import test from 'node:test';
import assert from 'node:assert/strict';

import {
  fetchOpenStreetMapNearby,
  resetOsmOverpassStateForTests,
} from '../server/realPlacesDiscovery';
import { APP_PRIMARY_FEATURES, FEATURE_DISTINCTION_NOTES } from '../src/data/appFeatures';

test('fetchOpenStreetMapNearby recovers gracefully from mirror TimeoutError without throwing AggregateError and enforces cooldown', async () => {
  resetOsmOverpassStateForTests();

  let callCount = 0;
  const timeoutFetcher = (async () => {
    callCount += 1;
    throw new DOMException('The operation was aborted due to timeout', 'TimeoutError');
  }) as unknown as typeof fetch;

  const firstResult = await fetchOpenStreetMapNearby(9.9195, 78.1193, 3000, {
    fetcher: timeoutFetcher,
    timeoutMs: 250,
    cooldownMs: 60_000,
  });

  assert.deepEqual(firstResult, []);
  const callsAfterFirst = callCount;
  assert.ok(callsAfterFirst >= 1, 'Expected initial Overpass attempt to invoke fetcher');

  // Second lookup with different coordinates during active cooldown must short-circuit immediately
  const secondResult = await fetchOpenStreetMapNearby(21.1458, 79.0882, 3000, {
    fetcher: timeoutFetcher,
    timeoutMs: 250,
    cooldownMs: 60_000,
  });

  assert.deepEqual(secondResult, []);
  assert.equal(
    callCount,
    callsAfterFirst,
    'Cooldown gate must prevent repeated Overpass bursts after timeouts'
  );

  resetOsmOverpassStateForTests();
});

test('fetchOpenStreetMapNearby parses valid Overpass elements and serves cached results without redundant fetches', async () => {
  resetOsmOverpassStateForTests();

  let callCount = 0;
  const successFetcher = (async () => {
    callCount += 1;
    return new Response(
      JSON.stringify({
        elements: [
          {
            id: 101,
            lat: 9.9195,
            lon: 78.1193,
            tags: {
              name: 'Meenakshi Amman Temple',
              amenity: 'place_of_worship',
              religion: 'hindu',
              'addr:city': 'Madurai',
            },
          },
        ],
      }),
      { status: 200, headers: { 'Content-Type': 'application/json' } }
    );
  }) as unknown as typeof fetch;

  const first = await fetchOpenStreetMapNearby(9.9195, 78.1193, 3000, {
    fetcher: successFetcher,
    timeoutMs: 1000,
  });

  assert.equal(first.length, 1);
  assert.equal(first[0].id, 'osm-101');
  assert.equal(first[0].name, 'Meenakshi Amman Temple');
  assert.equal(first[0].source, 'openstreetmap_osm');

  const countAfterFirst = callCount;
  const cached = await fetchOpenStreetMapNearby(9.9195, 78.1193, 3000, {
    fetcher: successFetcher,
    timeoutMs: 1000,
  });

  assert.equal(cached.length, 1);
  assert.equal(callCount, countAfterFirst, 'Subsequent request within cache TTL should hit cache');

  resetOsmOverpassStateForTests();
});

test('APP_PRIMARY_FEATURES preserves all 8 primary navigation items including Discover (Tab 3) in exact order', () => {
  assert.equal(APP_PRIMARY_FEATURES.length, 8);
  assert.deepEqual(
    APP_PRIMARY_FEATURES.map((f) => f.id),
    ['home', 'camera', 'discover', 'nearby', 'chat', 'map', 'history', 'settings']
  );

  const discoverFeature = APP_PRIMARY_FEATURES.find((f) => f.id === 'discover');
  assert.ok(discoverFeature);
  assert.equal(discoverFeature.stepNumber, '03');
  assert.equal(discoverFeature.primaryMobile, true);
  assert.match(discoverFeature.spokenHint, /Discover/i);
  assert.equal(FEATURE_DISTINCTION_NOTES.length, 1);
  assert.match(FEATURE_DISTINCTION_NOTES[0].discoverLabel, /Discover/i);
  assert.match(FEATURE_DISTINCTION_NOTES[0].exploreMoreLabel, /Explore More/i);
});
