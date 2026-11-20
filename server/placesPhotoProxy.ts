import { GMP_SOLUTION_ID, isGmpQuotaError } from './realPlacesDiscovery';
import { isTimeoutOrAbortError } from './discoverEngine';

export interface FetchGooglePlacePhotoOptions {
  photoName: string;
  maxHeightPx: number;
  maxWidthPx: number;
  apiKey: string;
  clientSignal?: AbortSignal;
  fetchFn?: typeof fetch;
  metadataTimeoutMs?: number;
  mediaTimeoutMs?: number;
  isDisallowedHost?: (hostname: string) => boolean;
}

export type GooglePlacePhotoResult =
  | {
      ok: true;
      buffer: Buffer;
      contentType: string;
    }
  | {
      ok: false;
      status: number;
      quotaExceeded?: boolean;
      abortedByClient?: boolean;
      timedOut?: boolean;
      message: string;
    };

export function isValidGooglePlacePhotoName(photoName: string): boolean {
  const trimmed = (photoName || '').trim();
  if (!trimmed || trimmed.includes('..')) return false;
  return /^places\/[A-Za-z0-9_.-]+\/photos\/[A-Za-z0-9_.-]+$/.test(trimmed);
}

function isDefaultDisallowedHost(hostname: string): boolean {
  const lower = (hostname || '').toLowerCase();
  if (
    lower === 'localhost' ||
    lower === '127.0.0.1' ||
    lower === '::1' ||
    lower === '0.0.0.0' ||
    lower.endsWith('.local') ||
    lower.endsWith('.internal')
  ) {
    return true;
  }
  const parts = lower.split('.');
  if (parts.length === 4 && parts.every((p) => /^\d+$/.test(p))) {
    const [a, b] = parts.map(Number);
    if (a === 10 || a === 127 || (a === 172 && b >= 16 && b <= 31) || (a === 192 && b === 168) || (a === 169 && b === 254)) {
      return true;
    }
  }
  return false;
}

function buildStepSignal(timeoutMs: number, clientSignal?: AbortSignal): AbortSignal {
  const timeoutSignal = AbortSignal.timeout(timeoutMs);
  if (!clientSignal) return timeoutSignal;
  if (typeof AbortSignal.any === 'function') {
    return AbortSignal.any([clientSignal, timeoutSignal]);
  }
  const controller = new AbortController();
  const onAbort = () => controller.abort();
  if (clientSignal.aborted) {
    controller.abort();
    return controller.signal;
  }
  clientSignal.addEventListener('abort', onAbort, { once: true });
  timeoutSignal.addEventListener('abort', onAbort, { once: true });
  return controller.signal;
}

function isTransientNetworkOrTimeoutError(err: unknown): boolean {
  if (isTimeoutOrAbortError(err)) return true;
  const code = String((err as any)?.code || (err as any)?.cause?.code || '');
  return (
    code === 'ECONNRESET' ||
    code === 'ETIMEDOUT' ||
    code === 'UND_ERR_CONNECT_TIMEOUT' ||
    code === 'UND_ERR_HEADERS_TIMEOUT' ||
    code === 'UND_ERR_BODY_TIMEOUT'
  );
}

async function fetchWithSingleTransientRetry(
  url: string,
  initFactory: (signal: AbortSignal) => RequestInit,
  timeoutMs: number,
  clientSignal?: AbortSignal,
  fetchFn: typeof fetch = fetch
): Promise<Response> {
  let lastError: unknown;
  for (let attempt = 0; attempt < 2; attempt++) {
    if (clientSignal?.aborted) {
      throw clientSignal.reason || new DOMException('Client aborted request', 'AbortError');
    }
    const stepSignal = buildStepSignal(timeoutMs, clientSignal);
    try {
      const response = await fetchFn(url, initFactory(stepSignal));
      if (attempt === 0 && (response.status === 502 || response.status === 503 || response.status === 504)) {
        continue;
      }
      return response;
    } catch (err) {
      lastError = err;
      if (clientSignal?.aborted) {
        throw err;
      }
      if (attempt === 0 && isTransientNetworkOrTimeoutError(err)) {
        continue;
      }
      throw err;
    }
  }
  throw lastError;
}

/**
 * Fetches Google Places Photo API (New) media without holding a single timeout across redirect + download.
 * 1. Resolves short-lived CDN photoUri via skipHttpRedirect=true (per GMP Place Photos New Option A).
 * 2. Downloads the binary image from photoUri without forwarding the Google API key, using a dedicated timeout.
 * 3. Falls back cleanly to direct media redirect fetch if skipHttpRedirect JSON omits photoUri.
 */
export async function fetchGooglePlacePhotoMedia(
  options: FetchGooglePlacePhotoOptions
): Promise<GooglePlacePhotoResult> {
  const {
    photoName,
    maxHeightPx,
    maxWidthPx,
    apiKey,
    clientSignal,
    fetchFn = fetch,
    metadataTimeoutMs = 12000,
    mediaTimeoutMs = 20000,
    isDisallowedHost = isDefaultDisallowedHost,
  } = options;

  if (!isValidGooglePlacePhotoName(photoName)) {
    return { ok: false, status: 400, message: 'Invalid Google Places photo resource name' };
  }
  if (!apiKey) {
    return { ok: false, status: 503, message: 'Google Maps Platform key not configured' };
  }

  const clampedH = Math.min(4800, Math.max(1, Math.round(maxHeightPx || 800)));
  const clampedW = Math.min(4800, Math.max(1, Math.round(maxWidthPx || 800)));

  try {
    const metadataUrl = `https://places.googleapis.com/v1/${photoName}/media?maxHeightPx=${clampedH}&maxWidthPx=${clampedW}&skipHttpRedirect=true`;
    const metaRes = await fetchWithSingleTransientRetry(
      metadataUrl,
      (signal) => ({
        headers: {
          Accept: 'application/json',
          'User-Agent': 'CharaivaGuide/1.0',
          'X-Goog-Api-Key': apiKey,
          'X-Goog-Maps-Solution-ID': GMP_SOLUTION_ID,
        },
        signal,
      }),
      metadataTimeoutMs,
      clientSignal,
      fetchFn
    );

    if (!metaRes.ok) {
      const errText = await metaRes.text().catch(() => '');
      if (isGmpQuotaError(metaRes.status, errText)) {
        return {
          ok: false,
          status: 429,
          quotaExceeded: true,
          message: 'Google Maps Platform photo quota exceeded',
        };
      }
      return {
        ok: false,
        status: metaRes.status,
        message: 'Photo fetch failed',
      };
    }

    const metaContentType = (metaRes.headers.get('content-type') || '').toLowerCase();
    let resolvedPhotoUri = '';

    if (metaContentType.includes('application/json')) {
      const metaJson = (await metaRes.json().catch(() => ({}))) as { photoUri?: string };
      resolvedPhotoUri = typeof metaJson?.photoUri === 'string' ? metaJson.photoUri.trim() : '';
    } else if (metaContentType.startsWith('image/')) {
      const arrayBuffer = await metaRes.arrayBuffer();
      return {
        ok: true,
        buffer: Buffer.from(arrayBuffer),
        contentType: metaContentType || 'image/jpeg',
      };
    }

    let imageRes: Response;
    if (resolvedPhotoUri) {
      let parsedPhotoUrl: URL;
      try {
        parsedPhotoUrl = new URL(resolvedPhotoUri);
      } catch {
        return { ok: false, status: 502, message: 'Invalid Google Places photo URI' };
      }
      if (parsedPhotoUrl.protocol !== 'https:' || isDisallowedHost(parsedPhotoUrl.hostname)) {
        return { ok: false, status: 400, message: 'Blocked untrusted Google Places photo URI' };
      }

      imageRes = await fetchWithSingleTransientRetry(
        parsedPhotoUrl.toString(),
        (signal) => ({
          redirect: 'follow',
          headers: {
            Accept: 'image/webp,image/apng,image/jpeg,image/png,image/*,*/*;q=0.8',
            'User-Agent': 'CharaivaGuide/1.0',
          },
          signal,
        }),
        mediaTimeoutMs,
        clientSignal,
        fetchFn
      );
    } else {
      const directUrl = `https://places.googleapis.com/v1/${photoName}/media?maxHeightPx=${clampedH}&maxWidthPx=${clampedW}`;
      imageRes = await fetchWithSingleTransientRetry(
        directUrl,
        (signal) => ({
          redirect: 'follow',
          headers: {
            Accept: 'image/*',
            'User-Agent': 'CharaivaGuide/1.0',
            'X-Goog-Api-Key': apiKey,
            'X-Goog-Maps-Solution-ID': GMP_SOLUTION_ID,
          },
          signal,
        }),
        mediaTimeoutMs,
        clientSignal,
        fetchFn
      );
    }

    if (!imageRes.ok) {
      const errText = await imageRes.text().catch(() => '');
      if (isGmpQuotaError(imageRes.status, errText)) {
        return {
          ok: false,
          status: 429,
          quotaExceeded: true,
          message: 'Google Maps Platform photo quota exceeded',
        };
      }
      return {
        ok: false,
        status: imageRes.status,
        message: 'Photo fetch failed',
      };
    }

    // Download body with explicit timeout guard so slow stalled streams abort cleanly
    const arrayBuffer = await new Promise<ArrayBuffer>((resolve, reject) => {
      const bodyTimeout = setTimeout(() => {
        reject(new DOMException('Image download body timed out', 'TimeoutError'));
      }, mediaTimeoutMs);
      const onClientAbort = () => {
        clearTimeout(bodyTimeout);
        reject(clientSignal?.reason || new DOMException('Client aborted request', 'AbortError'));
      };
      if (clientSignal?.aborted) {
        onClientAbort();
        return;
      }
      clientSignal?.addEventListener('abort', onClientAbort, { once: true });
      imageRes
        .arrayBuffer()
        .then((buf) => {
          clearTimeout(bodyTimeout);
          clientSignal?.removeEventListener('abort', onClientAbort);
          resolve(buf);
        })
        .catch((err) => {
          clearTimeout(bodyTimeout);
          clientSignal?.removeEventListener('abort', onClientAbort);
          reject(err);
        });
    });

    const contentType = imageRes.headers.get('content-type') || 'image/jpeg';
    return {
      ok: true,
      buffer: Buffer.from(arrayBuffer),
      contentType,
    };
  } catch (error: unknown) {
    if (clientSignal?.aborted) {
      return {
        ok: false,
        status: 499,
        abortedByClient: true,
        message: 'Client closed photo request',
      };
    }
    if (isTransientNetworkOrTimeoutError(error)) {
      return {
        ok: false,
        status: 504,
        timedOut: true,
        message: 'Google Places photo request timed out',
      };
    }
    throw error;
  }
}
