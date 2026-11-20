import React, { useEffect, useRef, useState } from 'react';
import { GpsLocationStatus, Language, LocationCoords, PlaceProvider, RecognitionResult } from '../types';
import { DeviceExactLocation, getMapsNavigationUrl } from '../utils/geolocation';
import { notifyGmpQuotaExceededIfNeeded } from '../utils/placesEngine';
import { PlaceCardImage } from './PlaceCardImage';
import { BackButton } from './BackButton';
import { useLocalizedTexts } from '../data/localizedStrings';
import L from 'leaflet';
import 'leaflet/dist/leaflet.css';
import { Compass, ArrowRight, MapPin, RefreshCw, ExternalLink, Info } from 'lucide-react';

const MAP_UI_DEFAULTS = {
  title: 'Interactive Sightseeing Map',
  enablePrompt: 'Enable GPS or select a city to load the interactive map',
  osmPointsIn: 'OpenStreetMap points in',
  osmSpotsAround: 'OpenStreetMap spots around your GPS in',
  locating: 'Locating',
  noLocation: 'No Location',
  destinationActive: 'Destination Active',
  gpsActive: 'GPS Active',
  selectedDestination: 'Selected Destination',
  yourGpsLocation: 'Your GPS Location',
  osmSpots: 'OSM Spots',
  openGoogleMaps: 'Open Google Maps',
  acquiringLocation: 'Acquiring Your Location...',
  locationNeededTitle: 'Location Needed for Interactive Map',
  locationNeededBody: 'Enable device GPS permission or select a city to center the map and explore local landmarks.',
  retryGps: 'Retry GPS',
  chooseCity: 'Choose City',
};

interface MapViewProps {
  isActive?: boolean;
  selectedLanguage?: Language;
  locationCoords: LocationCoords | null;
  deviceExactLocation?: DeviceExactLocation | null;
  gpsStatus?: GpsLocationStatus;
  gpsError?: string | null;
  isManualLocationMode?: boolean;
  onRefreshDeviceLocation?: () => Promise<void>;
  onOpenCitySelector?: () => void;
  onSelectLandmarkToScan: (landmark: RecognitionResult) => void;
  onBackToHome?: () => void;
}

interface MapSpot {
  id: string;
  name: string;
  category: string;
  oneLineImportance: string;
  description: string;
  estimatedDistanceKm: number;
  walkOrDriveTime: string;
  imageUrl: string;
  latitude: number;
  longitude: number;
  placeId?: string;
  googlePlaceId?: string;
  provider?: PlaceProvider;
  source?: string;
  googleMapsUri?: string;
  hasRealPhoto?: boolean;
  photoUnavailable?: boolean;
  authorAttributions?: Array<{
    displayName: string;
    uri?: string;
    photoUri?: string;
  }>;
  photos?: Array<{
    name: string;
    url: string;
    authorAttributions?: Array<{
      displayName: string;
      uri?: string;
      photoUri?: string;
    }>;
  }>;
}

export const MapView: React.FC<MapViewProps> = ({
  isActive = true,
  selectedLanguage,
  locationCoords,
  deviceExactLocation,
  gpsStatus = 'idle',
  gpsError = null,
  isManualLocationMode = false,
  onRefreshDeviceLocation,
  onOpenCitySelector,
  onSelectLandmarkToScan,
  onBackToHome,
}) => {
  const { t } = useLocalizedTexts(MAP_UI_DEFAULTS, selectedLanguage, 'Interactive Map screen labels');
  const mapContainerRef = useRef<HTMLDivElement | null>(null);
  const mapInstanceRef = useRef<L.Map | null>(null);
  const markersLayerRef = useRef<L.LayerGroup | null>(null);

  useEffect(() => {
    if (isActive && mapInstanceRef.current) {
      const id = window.requestAnimationFrame(() => {
        mapInstanceRef.current?.invalidateSize({ animate: false });
      });
      return () => window.cancelAnimationFrame(id);
    }
  }, [isActive]);

  const [spots, setSpots] = useState<MapSpot[]>([]);
  const [selectedSpot, setSelectedSpot] = useState<MapSpot | null>(null);
  const [googlePlacesCount, setGooglePlacesCount] = useState(0);
  const [isLoading, setIsLoading] = useState(false);

  const rawLat = deviceExactLocation?.latitude ?? locationCoords?.latitude;
  const rawLng = deviceExactLocation?.longitude ?? locationCoords?.longitude;
  const hasValidCoords =
    typeof rawLat === 'number' &&
    typeof rawLng === 'number' &&
    Number.isFinite(rawLat) &&
    Number.isFinite(rawLng);
  const lat = hasValidCoords ? rawLat : null;
  const lng = hasValidCoords ? rawLng : null;
  const locationName =
    deviceExactLocation?.locationName ||
    locationCoords?.city ||
    (isManualLocationMode ? 'Selected City' : 'Location unavailable');
  const city = deviceExactLocation?.city || locationCoords?.city || '';
  const country = deviceExactLocation?.country || locationCoords?.country || '';

  // Fetch spots around current real coordinates (strictly filter OSM/curated markers onto Leaflet OSM map)
  useEffect(() => {
    if (!hasValidCoords || lat === null || lng === null) {
      setSpots([]);
      setSelectedSpot(null);
      setGooglePlacesCount(0);
      setIsLoading(false);
      return;
    }

    let isMounted = true;
    const controller = new AbortController();

    async function fetchSpots() {
      setIsLoading(true);
      try {
        const res = await fetch('/api/discover-nearby-spots', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          signal: controller.signal,
          body: JSON.stringify({
            latitude: lat,
            longitude: lng,
            locationName,
            city,
            country,
            language: 'English',
          }),
        });

        notifyGmpQuotaExceededIfNeeded(res.status);
        const data = await res.json();
        notifyGmpQuotaExceededIfNeeded(data);

        if (res.ok && isMounted && data.success && Array.isArray(data.spots)) {
          const isGooglePlaceItem = (s: any) =>
            s?.provider === 'google_places' ||
            s?.source === 'google_places_api' ||
            (typeof s?.source === 'string' && s.source.includes('google'));

          const googleItems = data.spots.filter(isGooglePlaceItem);
          setGooglePlacesCount(googleItems.length);

          // Compliance: NEVER plot Google Places API results on Leaflet/OpenStreetMap tiles,
          // and NEVER invent synthetic coordinates. Only render real OSM or curated ground-truth pins.
          const mappedSpots: MapSpot[] = data.spots
            .filter((s: any) => {
              if (isGooglePlaceItem(s)) return false;
              const isAllowedProvider =
                s?.source === 'openstreetmap_osm' ||
                s?.source === 'verified_ground_truth_index' ||
                s?.source === 'wikipedia_geosearch' ||
                s?.provider === 'openstreetmap' ||
                s?.provider === 'curated' ||
                s?.provider === 'wikipedia';
              if (!isAllowedProvider) return false;
              return (
                typeof s.latitude === 'number' &&
                typeof s.longitude === 'number' &&
                Number.isFinite(s.latitude) &&
                Number.isFinite(s.longitude)
              );
            })
            .map((s: any) => ({ ...s }));

          setSpots(mappedSpots);
          setSelectedSpot(mappedSpots.length > 0 ? mappedSpots[0] : null);
        }
      } catch (err: any) {
        if (err?.name !== 'AbortError') {
          console.warn('Failed to load map spots:', err);
        }
      } finally {
        if (isMounted) setIsLoading(false);
      }
    }

    fetchSpots();

    return () => {
      isMounted = false;
      controller.abort();
    };
  }, [hasValidCoords, lat, lng, locationName, city, country]);

  // Initialize and update Leaflet Map only when valid coordinates exist
  useEffect(() => {
    if (!hasValidCoords || lat === null || lng === null || !mapContainerRef.current) {
      if (mapInstanceRef.current) {
        mapInstanceRef.current.remove();
        mapInstanceRef.current = null;
        markersLayerRef.current = null;
      }
      return;
    }

    if (!mapInstanceRef.current) {
      const map = L.map(mapContainerRef.current, {
        center: [lat, lng],
        zoom: 14,
        zoomControl: false,
      });

      L.tileLayer('https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png', {
        attribution: '&copy; OpenStreetMap contributors',
        maxZoom: 19,
      }).addTo(map);

      const userPin = L.divIcon({
        className: 'user-gps-pin',
        html: `<div style="background:#10b981; color:#ffffff; width:22px; height:22px; border-radius:50%; display:flex; align-items:center; justify-content:center; font-weight:bold; border:3px solid #ffffff; box-shadow:0 0 12px #10b981;">📍</div>`,
        iconSize: [22, 22],
      });
      L.marker([lat, lng], { icon: userPin })
        .addTo(map)
        .bindPopup(`<b>${isManualLocationMode ? 'Selected City' : 'Your Device Location'}</b><br/>${locationName}`);

      const markersGroup = L.layerGroup().addTo(map);
      markersLayerRef.current = markersGroup;
      mapInstanceRef.current = map;
    } else {
      mapInstanceRef.current.setView([lat, lng], 14);
    }

    return () => {
      if (mapInstanceRef.current) {
        mapInstanceRef.current.remove();
        mapInstanceRef.current = null;
        markersLayerRef.current = null;
      }
    };
  }, [hasValidCoords, lat, lng, isManualLocationMode, locationName]);

  // Update spots markers
  useEffect(() => {
    if (!mapInstanceRef.current || !markersLayerRef.current) return;

    markersLayerRef.current.clearLayers();

    spots.forEach((spot) => {
      const isSelected = selectedSpot?.id === spot.id;
      const spotIcon = L.divIcon({
        className: 'custom-spot-pin',
        html: `<div style="background:${isSelected ? '#2a9d8f' : '#334155'}; color:#ffffff; width:${isSelected ? '32px' : '26px'}; height:${isSelected ? '32px' : '26px'}; border-radius:50%; display:flex; align-items:center; justify-content:center; font-weight:bold; border:2px solid #ffffff; box-shadow:0 2px 8px rgba(0,0,0,0.45); cursor:pointer; font-size:12px; transition:all 0.2s;">🏛️</div>`,
        iconSize: isSelected ? [32, 32] : [26, 26],
      });

      const marker = L.marker([spot.latitude, spot.longitude], { icon: spotIcon });
      marker.on('click', () => {
        setSelectedSpot(spot);
      });
      markersLayerRef.current?.addLayer(marker);
    });
  }, [spots, selectedSpot]);

  const handleTriggerTour = () => {
    if (!selectedSpot) return;
    const result: RecognitionResult = {
      id: selectedSpot.id,
      title: selectedSpot.name,
      category: selectedSpot.category as any,
      confidence: 0.98,
      locationName: `${selectedSpot.name}, ${locationName}`,
      summary: selectedSpot.oneLineImportance,
      narration: `${selectedSpot.name} located in ${locationName}. ${selectedSpot.oneLineImportance} ${selectedSpot.description}`,
      keyFacts: [selectedSpot.oneLineImportance, `Distance: ~${selectedSpot.estimatedDistanceKm} km (${selectedSpot.walkOrDriveTime})`],
      tags: [selectedSpot.category, 'Nearby Spot', isManualLocationMode ? 'Selected Destination' : 'Current GPS Area'],
      imageUrl: selectedSpot.imageUrl,
      language: 'English',
      city,
      country,
      placeId: selectedSpot.placeId,
      googlePlaceId: selectedSpot.googlePlaceId || selectedSpot.placeId,
      provider: selectedSpot.provider,
      googleMapsUri: selectedSpot.googleMapsUri,
      coords: {
        latitude: selectedSpot.latitude,
        longitude: selectedSpot.longitude,
        city,
        country,
      },
    };
    onSelectLandmarkToScan(result);
  };

  return (
    <div
      id="map-view-screen"
      dir={selectedLanguage?.direction === 'rtl' ? 'rtl' : 'ltr'}
      className="h-full flex flex-col overflow-hidden overflow-clip py-1 space-y-2 select-none"
    >
      {/* Top Header */}
      <div
        style={{
          backgroundColor: 'var(--theme-card-bg)',
          borderColor: 'var(--theme-card-border)',
        }}
        className="shrink-0 flex items-center justify-between p-2.5 border rounded-2xl backdrop-blur-xl shadow-lg"
      >
        <div className="flex items-center gap-2 min-w-0">
          {onBackToHome && (
            <BackButton
              id="btn-map-back-home"
              onClick={onBackToHome}
              selectedLanguage={selectedLanguage}
            />
          )}
          <div className="min-w-0">
            <h3 className="text-xs sm:text-sm font-serif font-bold text-[var(--theme-text-title)] flex items-center gap-1.5">
              <Compass className="w-4 h-4 text-[var(--theme-accent-primary)] shrink-0" />
              <span className="truncate">{t.title}</span>
            </h3>
            <p className="text-[11px] text-[var(--theme-accent-secondary)] truncate">
              {!hasValidCoords
                ? gpsError || t.enablePrompt
                : isManualLocationMode
                ? `${t.osmPointsIn} ${locationName}`
                : `${t.osmSpotsAround} ${locationName}`}
            </p>
          </div>
        </div>

        <div className="flex items-center gap-1 text-[10px] theme-badge-teal font-bold shadow-sm shrink-0">
          <span className="w-1.5 h-1.5 rounded-full bg-[var(--theme-accent-primary)]" />
          <span>{!hasValidCoords ? (gpsStatus === 'locating' ? t.locating : t.noLocation) : isManualLocationMode ? t.destinationActive : t.gpsActive}</span>
        </div>
      </div>

      {/* Leaflet Map Canvas or Clean Missing-GPS State */}
      <div
        style={{ borderColor: 'var(--theme-card-border)', backgroundColor: 'var(--theme-card-bg)' }}
        className="relative flex-1 min-h-0 rounded-2xl overflow-hidden border shadow-xl"
      >
        {hasValidCoords && lat !== null && lng !== null ? (
          <>
            <div ref={mapContainerRef} className="w-full h-full z-10" />

            {/* Legend Overlay */}
            <div
              style={{
                backgroundColor: 'var(--theme-card-bg)',
                borderColor: 'var(--theme-card-border)',
              }}
              className="absolute top-2 right-2 z-20 backdrop-blur-md px-2.5 py-1.5 rounded-xl border text-[10px] text-[var(--theme-text-title)] shadow-lg space-y-1"
            >
              <div className="flex items-center gap-1.5 font-bold text-[var(--theme-accent-primary)]">
                <span className="w-2 h-2 rounded-full bg-[var(--theme-accent-primary)]" />
                <span>{isManualLocationMode ? t.selectedDestination : t.yourGpsLocation}</span>
              </div>
              <div className="flex items-center gap-1.5 font-bold text-[var(--theme-accent-secondary)]">
                <span className="w-2 h-2 rounded-full bg-[var(--theme-accent-secondary)]" />
                <span>{t.osmSpots} ({isLoading ? '...' : spots.length})</span>
              </div>
            </div>

            {/* Google Maps Platform ToS Compliance Notice when Google Places items exist */}
            {googlePlacesCount > 0 && (
              <div
                style={{
                  backgroundColor: 'var(--theme-card-bg)',
                  borderColor: 'var(--theme-card-border)',
                }}
                className="absolute bottom-2 left-2 right-2 z-20 backdrop-blur-md px-2.5 py-1.5 rounded-xl border text-[10px] text-[var(--theme-text-muted)] shadow-lg flex items-center justify-between gap-2"
              >
                <span className="flex items-center gap-1.5 min-w-0 truncate">
                  <Info className="w-3.5 h-3.5 text-[var(--theme-accent-primary)] shrink-0" />
                  <span className="truncate">
                    {googlePlacesCount} Google Places spots are available in Attractions &amp; open directly in Google Maps.
                  </span>
                </span>
                <a
                  href={`https://www.google.com/maps/search/?api=1&query=${lat},${lng}`}
                  target="_blank"
                  rel="noopener noreferrer"
                  className="shrink-0 font-bold text-[var(--theme-accent-primary)] hover:underline flex items-center gap-1"
                >
                  <span>{t.openGoogleMaps}</span>
                  <ExternalLink className="w-3 h-3" />
                </a>
              </div>
            )}
          </>
        ) : (
          <div className="h-full w-full flex flex-col items-center justify-center p-6 text-center space-y-3">
            <MapPin className="w-8 h-8 text-[var(--theme-accent-primary)] opacity-80" />
            <div className="space-y-1 max-w-sm">
              <h4 className="text-sm font-serif font-bold text-[var(--theme-text-title)]">
                {isManualLocationMode && city
                  ? `${city} — Map Coordinates Unavailable`
                  : gpsStatus === 'locating'
                  ? t.acquiringLocation
                  : t.locationNeededTitle}
              </h4>
              <p className="text-xs text-[var(--theme-text-muted)] leading-relaxed">
                {isManualLocationMode && city
                  ? `Saved custom place "${locationName}" does not have verified map coordinates yet. Select a verified city/town to view interactive map pins.`
                  : gpsError || t.locationNeededBody}
              </p>
            </div>
            <div className="flex items-center gap-2 flex-wrap justify-center">
              {!isManualLocationMode && onRefreshDeviceLocation && (
                <button
                  type="button"
                  onClick={() => onRefreshDeviceLocation()}
                  className="px-3.5 py-2 rounded-xl theme-btn-primary text-xs font-bold flex items-center gap-1.5 cursor-pointer active:scale-95"
                >
                  <RefreshCw className={`w-3.5 h-3.5 ${gpsStatus === 'locating' ? 'animate-spin' : ''}`} />
                  <span>{t.retryGps}</span>
                </button>
              )}
              {onOpenCitySelector && (
                <button
                  type="button"
                  onClick={onOpenCitySelector}
                  style={{
                    backgroundColor: 'var(--theme-card-bg-subtle)',
                    borderColor: 'var(--theme-card-border)',
                    color: 'var(--theme-text-title)',
                  }}
                  className="px-3.5 py-2 rounded-xl border text-xs font-bold flex items-center gap-1.5 cursor-pointer hover:border-[var(--theme-card-border-glow)] active:scale-95"
                >
                  <MapPin className="w-3.5 h-3.5 text-[var(--theme-accent-primary)]" />
                  <span>{t.chooseCity}</span>
                </button>
              )}
            </div>
          </div>
        )}
      </div>

      {/* Selected Landmark Details Card */}
      {selectedSpot && hasValidCoords && (
        <div
          style={{
            backgroundColor: 'var(--theme-card-bg)',
            borderColor: 'var(--theme-card-border)',
          }}
          className="shrink-0 p-3 rounded-2xl border backdrop-blur-xl flex items-center justify-between gap-3 shadow-lg"
        >
          <div className="flex items-center gap-2.5 min-w-0">
            <PlaceCardImage
              placeName={selectedSpot.name}
              placeId={selectedSpot.placeId}
              initialImageUrl={selectedSpot.imageUrl}
              authorAttributions={selectedSpot.authorAttributions}
              photos={selectedSpot.photos}
              category={selectedSpot.category}
              cityName={city}
              latitude={selectedSpot.latitude}
              longitude={selectedSpot.longitude}
              size="sm"
            />
            <div className="min-w-0">
              <div className="flex items-center gap-1.5">
                <span className="text-[9px] font-bold text-[var(--theme-accent-primary)] uppercase tracking-wider">
                  {selectedSpot.category}
                </span>
                <span className="text-[10px] text-[var(--theme-accent-secondary)] font-bold">
                  • ~{selectedSpot.estimatedDistanceKm} km
                </span>
              </div>
              <h4 className="text-xs sm:text-sm font-serif font-bold text-[var(--theme-text-title)] truncate">
                {selectedSpot.name}
              </h4>
              <p className="text-[11px] text-[var(--theme-text-muted)] truncate">
                {selectedSpot.oneLineImportance}
              </p>
            </div>
          </div>

          <div className="shrink-0 flex items-center gap-1.5">
            <a
              href={getMapsNavigationUrl({
                placeName: selectedSpot.name,
                localityOrCity: city,
                latitude: selectedSpot.latitude,
                longitude: selectedSpot.longitude,
                placeId: selectedSpot.googlePlaceId || selectedSpot.placeId,
                googleMapsUri: selectedSpot.googleMapsUri,
              })}
              target="_blank"
              rel="noopener noreferrer"
              style={{
                backgroundColor: 'var(--theme-card-bg-subtle)',
                borderColor: 'var(--theme-card-border)',
                color: 'var(--theme-text-title)',
              }}
              className="p-2 rounded-xl border text-xs font-bold hover:border-[var(--theme-card-border-glow)] transition-all"
              title="Open in Google Maps"
              aria-label="Open in Google Maps"
            >
              <ExternalLink className="w-3.5 h-3.5 text-[var(--theme-accent-primary)]" />
            </a>
            <button
              id="btn-map-start-tour"
              onClick={handleTriggerTour}
              className="shrink-0 py-2 px-3 rounded-xl theme-btn-primary font-bold text-xs shadow-md active:scale-95 transition-all flex items-center gap-1 cursor-pointer"
            >
              <span>Audio Tour</span>
              <ArrowRight className="w-3.5 h-3.5" />
            </button>
          </div>
        </div>
      )}
    </div>
  );
};
