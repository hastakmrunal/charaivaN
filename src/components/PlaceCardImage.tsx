import React, { useState, useEffect, useRef } from 'react';
import { Camera, Compass, ZoomIn, ChevronLeft, ChevronRight, X, ExternalLink, User } from 'lucide-react';
import { notifyGmpQuotaExceededIfNeeded } from '../utils/placesEngine';
import { getMapsNavigationUrl } from '../utils/geolocation';
import { BackButton } from './BackButton';
import { useBackLayer } from '../utils/navigationHistory';

export interface AuthorAttribution {
  displayName: string;
  uri?: string;
  photoUri?: string;
}

export interface PlacePhotoItem {
  name: string;
  url: string;
  authorAttributions?: AuthorAttribution[];
}

export interface PlaceCardImageProps {
  placeName: string;
  displayTitle?: string;
  placeId?: string;
  initialImageUrl?: string;
  authorAttributions?: AuthorAttribution[];
  photos?: PlacePhotoItem[];
  category?: string;
  locality?: string;
  cityName?: string;
  latitude?: number | null;
  longitude?: number | null;
  className?: string;
  size?: 'sm' | 'md' | 'lg' | 'full';
  showGalleryButton?: boolean;
  showAttribution?: boolean;
  deferResolve?: boolean;
  isExampleImage?: boolean;
}

const EMPTY_ATTRIBUTIONS: AuthorAttribution[] = [];
const EMPTY_PHOTOS: PlacePhotoItem[] = [];

// Module-level concurrency limiter (max 3 simultaneous resolve-photo requests) to prevent Wikimedia 429 throttling
const MAX_CONCURRENT_PHOTO_RESOLVES = 3;
let activePhotoResolves = 0;
const photoResolveWaitQueue: Array<() => void> = [];

function acquirePhotoResolveSlot(): Promise<void> {
  if (activePhotoResolves < MAX_CONCURRENT_PHOTO_RESOLVES) {
    activePhotoResolves++;
    return Promise.resolve();
  }
  return new Promise((resolve) => {
    photoResolveWaitQueue.push(() => {
      activePhotoResolves++;
      resolve();
    });
  });
}

function releasePhotoResolveSlot() {
  activePhotoResolves = Math.max(0, activePhotoResolves - 1);
  const next = photoResolveWaitQueue.shift();
  if (next) next();
}

function isGenericNonPlaceLabel(name?: string): boolean {
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

export const PlaceCardImage: React.FC<PlaceCardImageProps> = ({
  placeName,
  displayTitle,
  placeId,
  initialImageUrl,
  authorAttributions = EMPTY_ATTRIBUTIONS,
  photos = EMPTY_PHOTOS,
  locality = '',
  cityName = '',
  latitude,
  longitude,
  className = '',
  size = 'md',
  showGalleryButton = true,
  deferResolve = false,
  isExampleImage = false,
}) => {
  const shownTitle = displayTitle || placeName;
  const isResolvablePlace = !isGenericNonPlaceLabel(placeName) || Boolean(placeId);

  const safeAttributions = authorAttributions || EMPTY_ATTRIBUTIONS;
  const safePhotos = photos || EMPTY_PHOTOS;

  const photosKey = safePhotos.map((p) => p?.url || '').filter(Boolean).join('|');
  const attributionsKey = safeAttributions
    .map((a) => `${a?.displayName || ''}::${a?.uri || ''}`)
    .join('|');

  const safeAttributionsRef = useRef<AuthorAttribution[]>(safeAttributions);
  safeAttributionsRef.current = safeAttributions;
  const safePhotosRef = useRef<PlacePhotoItem[]>(safePhotos);
  safePhotosRef.current = safePhotos;

  const [photoList, setPhotoList] = useState<string[]>(() => {
    if (initialImageUrl && initialImageUrl.trim().length > 0) {
      return [initialImageUrl];
    }
    if (safePhotos.length > 0) {
      return safePhotos.map((p) => p.url).filter(Boolean);
    }
    return [];
  });

  const [resolvedPlaceId, setResolvedPlaceId] = useState<string | undefined>(placeId);
  const [attributions, setAttributions] = useState<AuthorAttribution[]>(() => safeAttributions);
  const [currentIndex, setCurrentIndex] = useState<number>(0);
  const [isLoading, setIsLoading] = useState<boolean>(
    () => !initialImageUrl && safePhotos.length === 0 && (deferResolve || isResolvablePlace)
  );
  const [isPhotoUnavailable, setIsPhotoUnavailable] = useState<boolean>(
    () => !initialImageUrl && safePhotos.length === 0 && !deferResolve && !isResolvablePlace
  );
  const [isViewerOpen, setIsViewerOpen] = useState<boolean>(false);
  const [showDebugBadge, setShowDebugBadge] = useState<boolean>(false);
  const [hasImageError, setHasImageError] = useState<boolean>(false);
  const [isNearViewport, setIsNearViewport] = useState<boolean>(() => size === 'full' || typeof IntersectionObserver === 'undefined');
  const containerRef = useRef<HTMLDivElement | null>(null);
  const lastResolvedKeyRef = useRef<string>('');
  const prevContextKeyRef = useRef<string>(`${placeName}::${placeId || ''}::${cityName || ''}`);
  const viewerInstanceId = React.useId();

  useBackLayer(
    `place-photo-viewer-${viewerInstanceId}`,
    isViewerOpen,
    () => setIsViewerOpen(false),
    75
  );

  // Observe card visibility so offscreen list thumbnails defer network requests until near viewport
  useEffect(() => {
    if (isNearViewport || (initialImageUrl && initialImageUrl.trim().length > 0) || photosKey.length > 0) {
      return;
    }
    const el = containerRef.current;
    if (!el || typeof IntersectionObserver === 'undefined') {
      setIsNearViewport(true);
      return;
    }

    const observer = new IntersectionObserver(
      (entries) => {
        if (entries.some((entry) => entry.isIntersecting)) {
          setIsNearViewport(true);
          observer.disconnect();
        }
      },
      { rootMargin: '180px' }
    );
    observer.observe(el);

    return () => observer.disconnect();
  }, [isNearViewport, initialImageUrl, photosKey]);

  // Clear stale images immediately when the place/city context changes, and sync props using primitive keys
  useEffect(() => {
    const contextKey = `${placeName}::${placeId || ''}::${cityName || ''}`;
    const contextChanged = prevContextKeyRef.current !== contextKey;
    if (contextChanged) {
      prevContextKeyRef.current = contextKey;
      lastResolvedKeyRef.current = '';
      setCurrentIndex(0);
      setHasImageError(false);
      setIsPhotoUnavailable(false);
    }

    setResolvedPlaceId(placeId);
    setAttributions(safeAttributionsRef.current);

    const validPhotos = safePhotosRef.current.map((p) => p.url).filter(Boolean);
    if (validPhotos.length > 0) {
      const merged = [...validPhotos];
      if (initialImageUrl && initialImageUrl.trim().length > 0 && !merged.includes(initialImageUrl)) {
        merged.unshift(initialImageUrl);
      }
      setPhotoList(merged);
      setCurrentIndex(0);
      setIsPhotoUnavailable(false);
      setIsLoading(false);
      setHasImageError(false);
    } else if (initialImageUrl && initialImageUrl.trim().length > 0) {
      setPhotoList([initialImageUrl]);
      setCurrentIndex(0);
      setIsPhotoUnavailable(false);
      setIsLoading(false);
      setHasImageError(false);
    } else if (contextChanged) {
      setPhotoList([]);
      setIsLoading(deferResolve || isResolvablePlace);
      setIsPhotoUnavailable(!deferResolve && !isResolvablePlace);
    }
  }, [placeName, cityName, initialImageUrl, attributionsKey, photosKey, placeId, deferResolve, isResolvablePlace]);

  // On-demand Google Places API / Wikipedia photo resolution if no authentic photo was supplied initially
  useEffect(() => {
    if (initialImageUrl && initialImageUrl.trim().length > 0) return;
    if (photosKey.length > 0) return;
    if (deferResolve) {
      setIsLoading(true);
      setIsPhotoUnavailable(false);
      return;
    }
    if (!isResolvablePlace) {
      setPhotoList([]);
      setIsLoading(false);
      setIsPhotoUnavailable(true);
      return;
    }
    if (!isNearViewport) {
      return;
    }

    const resolveKey = `${placeName}::${placeId || ''}::${cityName || ''}::${typeof latitude === 'number' ? latitude.toFixed(3) : ''}`;
    if (lastResolvedKeyRef.current === resolveKey) return;
    lastResolvedKeyRef.current = resolveKey;

    let isMounted = true;
    const controller = new AbortController();
    setIsLoading(true);
    setIsPhotoUnavailable(false);
    setHasImageError(false);

    async function resolvePlacePhoto() {
      let acquired = false;
      try {
        await acquirePhotoResolveSlot();
        acquired = true;
        if (!isMounted || controller.signal.aborted) return;

        const res = await fetch('/api/places/resolve-photo', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({
            placeName,
            placeId,
            city: cityName,
            lat: typeof latitude === 'number' && Number.isFinite(latitude) ? latitude : undefined,
            lng: typeof longitude === 'number' && Number.isFinite(longitude) ? longitude : undefined,
          }),
          signal: controller.signal,
        });

        notifyGmpQuotaExceededIfNeeded(res.status);
        const data = await res.json().catch(() => ({}));
        notifyGmpQuotaExceededIfNeeded(data);

        if (!isMounted) return;

        if (res.ok && data.success && data.hasRealPhoto && data.photoUrl) {
          const extraUrls = Array.isArray(data.photos)
            ? data.photos.map((p: any) => p.url).filter((u: string) => u && u !== data.photoUrl)
            : [];
          setPhotoList([data.photoUrl, ...extraUrls]);
          setCurrentIndex(0);
          if (data.placeId) setResolvedPlaceId(data.placeId);
          if (data.authorAttributions && data.authorAttributions.length > 0) {
            setAttributions(data.authorAttributions);
          }
          setIsPhotoUnavailable(false);
          setHasImageError(false);
        } else {
          setPhotoList([]);
          setIsPhotoUnavailable(true);
        }
      } catch (err: any) {
        if (err?.name !== 'AbortError') {
          console.warn('PlaceCardImage resolution failed:', err);
          if (isMounted) {
            setPhotoList([]);
            setIsPhotoUnavailable(true);
          }
        }
      } finally {
        if (acquired) releasePhotoResolveSlot();
        if (isMounted) setIsLoading(false);
      }
    }

    resolvePlacePhoto();

    return () => {
      isMounted = false;
      controller.abort();
    };
  }, [placeName, placeId, cityName, latitude, longitude, initialImageUrl, photosKey, deferResolve, isResolvablePlace, isNearViewport]);

  const handleImageError = () => {
    if (currentIndex + 1 < photoList.length) {
      setCurrentIndex((prev) => prev + 1);
      return;
    }
    setHasImageError(true);
    setIsPhotoUnavailable(true);
  };

  const handleNextPhoto = (e: React.MouseEvent) => {
    e.stopPropagation();
    if (photoList.length > 1) {
      setCurrentIndex((prev) => (prev + 1) % photoList.length);
    }
  };

  const handlePrevPhoto = (e: React.MouseEvent) => {
    e.stopPropagation();
    if (photoList.length > 1) {
      setCurrentIndex((prev) => (prev - 1 + photoList.length) % photoList.length);
    }
  };

  // Dimensions based on size prop
  const sizeClasses = {
    sm: 'w-16 h-16 rounded-lg',
    md: 'w-24 h-24 sm:w-28 sm:h-28 rounded-2xl',
    lg: 'w-full h-44 rounded-2xl',
    full: 'w-full h-full rounded-2xl',
  }[size];

  const currentAuthor = attributions[0] || photos[currentIndex]?.authorAttributions?.[0];
  const activeUrl = photoList[currentIndex];

  // Derive photo source information
  let photoSource = 'None';
  if (activeUrl) {
    if (activeUrl.includes('places.googleapis.com') || activeUrl.includes('/api/places/photo')) {
      photoSource = 'Google Places API (New)';
    } else if (activeUrl.includes('wikimedia.org') || activeUrl.includes('commons')) {
      photoSource = 'Wikimedia Commons';
    } else if (activeUrl.includes('wikipedia.org')) {
      photoSource = 'Wikipedia Pageimages';
    } else if (activeUrl.includes('/api/places/proxy-image')) {
      photoSource = 'Regional Heritage Archive (Proxied)';
    } else {
      photoSource = 'Verified Place Source';
    }
  }

  const effectivePlaceId = resolvedPlaceId || placeId || 'Not available';

  let imageStatus: 'Loaded' | 'Loading' | 'Failed' | 'Unavailable' = 'Loaded';
  if (isLoading) imageStatus = 'Loading';
  else if (isPhotoUnavailable || !activeUrl) imageStatus = 'Unavailable';
  else if (hasImageError) imageStatus = 'Failed';

  // 1. Loading Skeleton State
  if (isLoading) {
    return (
      <div
        ref={containerRef}
        style={{
          backgroundColor: 'var(--theme-card-bg-subtle)',
          borderColor: 'var(--theme-card-border)',
        }}
        className={`relative overflow-hidden border shrink-0 flex items-center justify-center ${sizeClasses} ${className}`}
      >
        <div className="absolute inset-0 bg-gradient-to-r from-transparent via-[var(--theme-accent-primary)]/10 to-transparent animate-pulse" />
        <Compass className="w-5 h-5 text-[var(--theme-accent-primary)]/50 animate-pulse" />
      </div>
    );
  }

  // 2. Clean Neutral Travel Placeholder (No broken-image icon, no raw error text, preserves container size)
  if (isPhotoUnavailable || !activeUrl || hasImageError) {
    const cleanPlaceholderLabel =
      !isGenericNonPlaceLabel(shownTitle)
        ? shownTitle
        : !isGenericNonPlaceLabel(cityName)
        ? cityName
        : 'Explore Nearby';

    return (
      <div
        ref={containerRef}
        style={{
          background: 'linear-gradient(135deg, var(--theme-card-bg-subtle) 0%, var(--theme-card-bg) 100%)',
          borderColor: 'var(--theme-card-border)',
        }}
        className={`relative overflow-hidden border shrink-0 flex flex-col items-center justify-center p-2 text-center select-none ${sizeClasses} ${className}`}
        title={cleanPlaceholderLabel}
      >
        <div className="w-9 h-9 rounded-full bg-[var(--theme-accent-primary)]/12 border border-[var(--theme-card-border)] flex items-center justify-center mb-1">
          <Compass className={`${size === 'sm' ? 'w-4 h-4' : 'w-5 h-5'} text-[var(--theme-accent-primary)]`} />
        </div>
        {size !== 'sm' && (
          <span className="text-[10px] font-medium text-[var(--theme-text-muted)] line-clamp-1 px-2">
            {cleanPlaceholderLabel}
          </span>
        )}
      </div>
    );
  }

  // 3. Real Photo Render
  return (
    <>
      <div
        className={`relative group overflow-hidden bg-black/60 border border-amber-800/60 shrink-0 ${sizeClasses} ${className}`}
      >
        {/* Main Image */}
        <img
          src={activeUrl}
          alt={shownTitle}
          className="w-full h-full object-cover transition-transform duration-500 group-hover:scale-105"
          onError={handleImageError}
          loading="lazy"
          referrerPolicy="no-referrer"
        />

        {isExampleImage && size !== 'sm' && (
          <span
            style={{
              backgroundColor: 'rgba(15, 23, 42, 0.85)',
              color: '#fde68a',
              borderColor: 'rgba(245, 158, 11, 0.45)',
            }}
            className="absolute top-1.5 left-1.5 z-10 px-1.5 py-0.5 rounded border text-[8.5px] font-bold uppercase tracking-wider pointer-events-none"
          >
            Reference / Similar Example
          </span>
        )}

        {/* Real Photo Tag & Zoom overlay */}
        <div
          onClick={() => setIsViewerOpen(true)}
          className="absolute inset-0 bg-gradient-to-t from-black/80 via-transparent to-transparent opacity-0 group-hover:opacity-100 transition-opacity flex flex-col justify-between p-1.5 cursor-pointer"
          title="Click to view full-resolution photo & debug info"
        >
          <div className="flex justify-between items-start">
            <span
              onClick={(e) => {
                e.stopPropagation();
                setShowDebugBadge(!showDebugBadge);
              }}
              className="px-1.5 py-0.5 rounded bg-black/80 text-[8px] font-mono text-amber-300 border border-amber-500/40 hover:bg-amber-900"
              title="Toggle Pipeline Debug Info"
            >
              Debug
            </span>
            <span className="p-1 rounded-md bg-black/70 text-amber-300 border border-amber-500/40">
              <ZoomIn className="w-3.5 h-3.5" />
            </span>
          </div>

          <div className="flex items-center justify-between text-[9px] font-bold text-amber-200">
            <span className="flex items-center gap-1">
              <Camera className="w-3 h-3 text-amber-400" />
              Real Place Photo
            </span>
            {photoList.length > 1 && (
              <span className="px-1 py-0.2 rounded bg-amber-950/80 border border-amber-700/50">
                {currentIndex + 1}/{photoList.length}
              </span>
            )}
          </div>
        </div>

        {/* Inline Debug Badge Overlay */}
        {showDebugBadge && (
          <div
            onClick={(e) => {
              e.stopPropagation();
              setShowDebugBadge(false);
            }}
            className="absolute inset-0 bg-black/95 p-2 text-[8.5px] text-amber-200 flex flex-col justify-center text-left font-mono z-30 space-y-0.5 cursor-pointer"
          >
            <div className="text-amber-400 font-bold border-b border-amber-800 pb-0.5 mb-0.5">Place Photo Debug</div>
            <div><strong>Place:</strong> {placeName}</div>
            <div className="truncate"><strong>Place ID:</strong> {effectivePlaceId}</div>
            <div><strong>Source:</strong> {photoSource}</div>
            <div><strong>Status:</strong> {imageStatus}</div>
            <div className="text-emerald-400"><strong>Fallback Used:</strong> NO</div>
            <div className="text-[7.5px] text-amber-400/60 pt-0.5">Click to close</div>
          </div>
        )}

        {/* Multi-Photo Carousel Controls if more than 1 photo exists */}
        {showGalleryButton && photoList.length > 1 && (
          <div className="absolute bottom-1 right-1 flex items-center gap-1 opacity-90 group-hover:opacity-100 transition-opacity">
            <button
              onClick={handleNextPhoto}
              className="p-1 rounded-md bg-black/80 hover:bg-amber-950 text-amber-300 border border-amber-700/60 text-[9px] font-bold flex items-center gap-0.5 cursor-pointer shadow"
              title="Next authentic place photo"
            >
              <Camera className="w-2.5 h-2.5 text-amber-400" />
              <span>+{photoList.length}</span>
            </button>
          </div>
        )}
      </div>

      {/* Fullscreen High-Resolution Photo Viewer Modal */}
      {isViewerOpen && (
        <div
          className="fixed inset-0 z-50 bg-black/90 backdrop-blur-md flex items-center justify-center p-3 sm:p-6"
          onClick={() => setIsViewerOpen(false)}
        >
          <div
            style={{
              backgroundColor: 'var(--theme-card-bg)',
              borderColor: 'var(--theme-card-border)',
            }}
            className="relative w-full max-w-2xl border rounded-3xl overflow-hidden shadow-2xl space-y-3 p-4 text-[var(--theme-text-title)]"
            onClick={(e) => e.stopPropagation()}
          >
            {/* Header */}
            <div
              style={{ borderColor: 'var(--theme-card-border)' }}
              className="flex items-center justify-between gap-2.5 border-b pb-2.5"
            >
              <BackButton
                compact
                onClick={() => setIsViewerOpen(false)}
              />
              <div className="min-w-0 flex-1">
                <div className="flex items-center gap-2">
                  <span className="px-2 py-0.5 rounded-full theme-badge-teal text-[10px] font-bold uppercase tracking-wider flex items-center gap-1">
                    <Camera className="w-3 h-3 text-[var(--theme-accent-primary)]" />
                    {isExampleImage ? 'Reference / Similar Example' : 'Exact Place Photo'} ({currentIndex + 1} of {Math.max(1, photoList.length)})
                  </span>
                  {cityName && <span className="text-xs text-[var(--theme-accent-secondary)]">{cityName}</span>}
                </div>
                <h3 className="text-base sm:text-lg font-serif font-bold text-[var(--theme-text-title)] truncate mt-1">
                  {shownTitle}
                </h3>
              </div>

              <button
                onClick={() => setIsViewerOpen(false)}
                style={{
                  backgroundColor: 'var(--theme-card-bg-subtle)',
                  borderColor: 'var(--theme-card-border)',
                  color: 'var(--theme-text-title)',
                }}
                className="p-2 rounded-xl border hover:border-[var(--theme-card-border-glow)] cursor-pointer"
              >
                <X className="w-5 h-5" />
              </button>
            </div>

            {/* Pipeline Verification Details Panel */}
            <div
              style={{
                backgroundColor: 'var(--theme-card-bg-subtle)',
                borderColor: 'var(--theme-card-border)',
              }}
              className="rounded-xl p-2.5 border text-[11px] font-mono grid grid-cols-1 sm:grid-cols-2 gap-1.5 text-[var(--theme-accent-secondary)]"
            >
              <div><strong>Exact Place ID:</strong> <span className="text-[var(--theme-text-title)]">{effectivePlaceId}</span></div>
              <div><strong>Photo Source:</strong> <span className="text-[var(--theme-text-title)]">{photoSource}</span></div>
              <div><strong>Image Status:</strong> <span className="text-emerald-400 font-bold">{imageStatus}</span></div>
              <div><strong>Fallback Used:</strong> <span className="text-emerald-400 font-bold">NO (Authentic only)</span></div>
              <div className="sm:col-span-2 truncate"><strong>Photo Resource:</strong> <span className="text-[var(--theme-accent-primary)]">{activeUrl}</span></div>
            </div>

            {/* Photo Stage */}
            <div
              style={{ borderColor: 'var(--theme-card-border)' }}
              className="relative w-full h-72 sm:h-96 rounded-2xl overflow-hidden bg-black flex items-center justify-center border"
            >
              <img
                src={activeUrl}
                alt={shownTitle}
                className="w-full h-full object-contain"
                referrerPolicy="no-referrer"
                crossOrigin="anonymous"
              />

              {/* Prev / Next controls */}
              {photoList.length > 1 && (
                <>
                  <button
                    onClick={handlePrevPhoto}
                    style={{
                      backgroundColor: 'rgba(0, 0, 0, 0.7)',
                      borderColor: 'var(--theme-card-border)',
                      color: 'var(--theme-accent-primary)',
                    }}
                    className="absolute left-2.5 top-1/2 -translate-y-1/2 p-2 rounded-full border shadow-lg cursor-pointer hover:scale-110 transition-transform"
                  >
                    <ChevronLeft className="w-5 h-5" />
                  </button>
                  <button
                    onClick={handleNextPhoto}
                    style={{
                      backgroundColor: 'rgba(0, 0, 0, 0.7)',
                      borderColor: 'var(--theme-card-border)',
                      color: 'var(--theme-accent-primary)',
                    }}
                    className="absolute right-2.5 top-1/2 -translate-y-1/2 p-2 rounded-full border shadow-lg cursor-pointer hover:scale-110 transition-transform"
                  >
                    <ChevronRight className="w-5 h-5" />
                  </button>
                </>
              )}
            </div>

            {/* Photo thumbnails strip */}
            {photoList.length > 1 && (
              <div className="flex items-center gap-2 overflow-x-auto pb-1 scrollbar-none">
                {photoList.map((imgUrl, idx) => (
                  <button
                    key={idx}
                    onClick={() => setCurrentIndex(idx)}
                    style={{
                      borderColor: currentIndex === idx ? 'var(--theme-accent-primary)' : 'var(--theme-card-border)',
                    }}
                    className={`w-16 h-12 rounded-xl overflow-hidden border-2 shrink-0 transition-all cursor-pointer ${
                      currentIndex === idx
                        ? 'scale-105 shadow-md'
                        : 'opacity-60 hover:opacity-100'
                    }`}
                  >
                    <img
                      src={imgUrl}
                      alt={`${placeName} thumb ${idx + 1}`}
                      className="w-full h-full object-cover"
                      referrerPolicy="no-referrer"
                    />
                  </button>
                ))}
              </div>
            )}

            {/* Footer with Google Places / Wikimedia Author Attribution & Maps Direct Link */}
            <div className="flex items-center justify-between text-xs text-[var(--theme-accent-secondary)] pt-1 flex-wrap gap-2">
              <div className="flex items-center gap-1.5 text-[11px] truncate max-w-sm">
                {currentAuthor ? (
                  <>
                    <User className="w-3.5 h-3.5 text-[var(--theme-accent-primary)] shrink-0" />
                    <span>
                      Photo by{' '}
                      {currentAuthor.uri ? (
                        <a
                          href={currentAuthor.uri}
                          target="_blank"
                          rel="noreferrer"
                          className="text-[var(--theme-accent-primary)] underline hover:opacity-80"
                        >
                          {currentAuthor.displayName}
                        </a>
                      ) : (
                        <strong className="text-[var(--theme-text-title)]">{currentAuthor.displayName}</strong>
                      )}
                    </span>
                  </>
                ) : (
                  <span>Authentic place photo from {photoSource}.</span>
                )}
              </div>

              <a
                href={getMapsNavigationUrl({
                  placeName,
                  localityOrCity: cityName || locality,
                  placeId: resolvedPlaceId || placeId,
                  preferDirections: false,
                })}
                target="_blank"
                rel="noreferrer"
                style={{
                  backgroundColor: 'var(--theme-card-bg-subtle)',
                  borderColor: 'var(--theme-card-border)',
                  color: 'var(--theme-accent-primary)',
                }}
                className="px-2.5 py-1 rounded-lg hover:border-[var(--theme-card-border-glow)] text-[11px] font-bold flex items-center gap-1 border"
              >
                <span>View on Google Maps</span>
                <ExternalLink className="w-3 h-3 text-[var(--theme-accent-primary)]" />
              </a>
            </div>
          </div>
        </div>
      )}
    </>
  );
};
