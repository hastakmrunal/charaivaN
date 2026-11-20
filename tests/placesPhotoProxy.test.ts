import test from 'node:test';
import assert from 'node:assert/strict';
import { fetchGooglePlacePhotoMedia, isValidGooglePlacePhotoName } from '../server/placesPhotoProxy';

test('isValidGooglePlacePhotoName rejects invalid or traversal photo names', () => {
  assert.equal(isValidGooglePlacePhotoName('places/ChIJ123/photos/AUacShh3_Dd8'), true);
  assert.equal(isValidGooglePlacePhotoName('places/ChIJ123/photos/photo.v1-abc'), true);
  assert.equal(isValidGooglePlacePhotoName('../etc/passwd'), false);
  assert.equal(isValidGooglePlacePhotoName('places/ChIJ123/../photos/abc'), false);
  assert.equal(isValidGooglePlacePhotoName(''), false);
});

test('fetchGooglePlacePhotoMedia resolves photoUri via skipHttpRedirect=true without leaking API key to CDN', async () => {
  const calls: Array<{ url: string; headers: Record<string, string> }> = [];

  const mockFetch = (async (input: string | URL, init?: RequestInit) => {
    const url = String(input);
    const rawHeaders = (init?.headers || {}) as Record<string, string>;
    calls.push({ url, headers: rawHeaders });

    if (url.includes('skipHttpRedirect=true')) {
      return new Response(
        JSON.stringify({
          name: 'places/ChIJ123/photos/ABC/media',
          photoUri: 'https://lh3.googleusercontent.com/places/TEST_PHOTO_URI',
        }),
        { status: 200, headers: { 'content-type': 'application/json' } }
      );
    }

    return new Response(new Uint8Array([1, 2, 3, 4]), {
      status: 200,
      headers: { 'content-type': 'image/jpeg' },
    });
  }) as typeof fetch;

  const result = await fetchGooglePlacePhotoMedia({
    photoName: 'places/ChIJ123/photos/ABC',
    maxHeightPx: 800,
    maxWidthPx: 800,
    apiKey: 'test-key-123',
    fetchFn: mockFetch,
  });

  assert.equal(result.ok, true);
  if (result.ok) {
    assert.equal(result.contentType, 'image/jpeg');
    assert.deepEqual(Array.from(result.buffer), [1, 2, 3, 4]);
  }
  assert.equal(calls.length, 2);
  assert.ok(calls[0].url.includes('skipHttpRedirect=true'));
  assert.equal(calls[0].headers['X-Goog-Api-Key'], 'test-key-123');
  assert.equal(calls[0].headers['X-Goog-Maps-Solution-ID'], 'gmp_mcp_codeassist_v1_aistudio');
  assert.equal(calls[1].url, 'https://lh3.googleusercontent.com/places/TEST_PHOTO_URI');
  assert.equal(calls[1].headers['X-Goog-Api-Key'], undefined);
});

test('fetchGooglePlacePhotoMedia retries once on transient TimeoutError and succeeds', async () => {
  let metaAttempts = 0;

  const mockFetch = (async (input: string | URL) => {
    const url = String(input);
    if (url.includes('skipHttpRedirect=true')) {
      metaAttempts++;
      if (metaAttempts === 1) {
        throw new DOMException('The operation was aborted due to timeout', 'TimeoutError');
      }
      return new Response(
        JSON.stringify({ photoUri: 'https://lh3.googleusercontent.com/places/RETRY_OK' }),
        { status: 200, headers: { 'content-type': 'application/json' } }
      );
    }
    return new Response(new Uint8Array([9, 8, 7]), {
      status: 200,
      headers: { 'content-type': 'image/png' },
    });
  }) as typeof fetch;

  const result = await fetchGooglePlacePhotoMedia({
    photoName: 'places/ChIJ123/photos/RETRY',
    maxHeightPx: 600,
    maxWidthPx: 600,
    apiKey: 'test-key-123',
    fetchFn: mockFetch,
  });

  assert.equal(metaAttempts, 2);
  assert.equal(result.ok, true);
  if (result.ok) {
    assert.equal(result.contentType, 'image/png');
    assert.deepEqual(Array.from(result.buffer), [9, 8, 7]);
  }
});

test('fetchGooglePlacePhotoMedia returns clean 504 on persistent timeout and 499 on client abort', async () => {
  const alwaysTimeoutFetch = (async () => {
    throw new DOMException('The operation was aborted due to timeout', 'TimeoutError');
  }) as typeof fetch;

  const timedOutResult = await fetchGooglePlacePhotoMedia({
    photoName: 'places/ChIJ123/photos/SLOW',
    maxHeightPx: 800,
    maxWidthPx: 800,
    apiKey: 'test-key-123',
    fetchFn: alwaysTimeoutFetch,
  });

  assert.equal(timedOutResult.ok, false);
  if (!timedOutResult.ok) {
    assert.equal(timedOutResult.status, 504);
    assert.equal(timedOutResult.timedOut, true);
  }

  const clientAbortController = new AbortController();
  clientAbortController.abort();
  const abortedResult = await fetchGooglePlacePhotoMedia({
    photoName: 'places/ChIJ123/photos/ABORTED',
    maxHeightPx: 800,
    maxWidthPx: 800,
    apiKey: 'test-key-123',
    clientSignal: clientAbortController.signal,
    fetchFn: alwaysTimeoutFetch,
  });

  assert.equal(abortedResult.ok, false);
  if (!abortedResult.ok) {
    assert.equal(abortedResult.status, 499);
    assert.equal(abortedResult.abortedByClient, true);
  }
});

test('fetchGooglePlacePhotoMedia detects Google Maps quota exhaustion cleanly', async () => {
  const quotaFetch = (async () =>
    new Response(
      JSON.stringify({
        error: {
          code: 429,
          status: 'RESOURCE_EXHAUSTED',
          message: 'Quota exceeded',
        },
      }),
      { status: 429, headers: { 'content-type': 'application/json' } }
    )) as typeof fetch;

  const result = await fetchGooglePlacePhotoMedia({
    photoName: 'places/ChIJ123/photos/QUOTA',
    maxHeightPx: 800,
    maxWidthPx: 800,
    apiKey: 'test-key-123',
    fetchFn: quotaFetch,
  });

  assert.equal(result.ok, false);
  if (!result.ok) {
    assert.equal(result.status, 429);
    assert.equal(result.quotaExceeded, true);
  }
});
