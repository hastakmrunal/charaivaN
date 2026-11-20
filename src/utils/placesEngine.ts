export interface RealPlaceRaw {
  id: string;
  name: string;
  category: string;
  address?: string;
  latitude: number;
  longitude: number;
  rating?: number;
  userRatingCount?: number;
  types?: string[];
  googleMapsUri?: string;
  photos?: Array<{ name?: string; authorAttributions?: any[] }>;
  source: 'google_places' | 'openstreetmap_osm' | 'verified_regional_index';
}

// Official Google Places API (New) Table A Filter Types only (no Table B types like place_of_worship, point_of_interest, landmark, natural_feature, food)
export const CATEGORY_FILTERS = [
  {
    id: 'all',
    label: 'All Places',
    gmpTypes: [] as string[],
    searchQueries: [] as string[],
  },
  {
    id: 'history',
    label: 'History & Forts',
    gmpTypes: ['historical_place', 'monument', 'castle', 'historical_landmark', 'cultural_landmark'],
    searchQueries: ['historic fort', 'stepwell heritage monument'],
  },
  {
    id: 'culture',
    label: 'Culture & Arts',
    gmpTypes: ['museum', 'art_gallery', 'art_museum', 'history_museum', 'cultural_center', 'performing_arts_theater', 'planetarium'],
    searchQueries: ['art museum', 'cultural center'],
  },
  {
    id: 'spiritual',
    label: 'Spiritual & Temples',
    gmpTypes: ['hindu_temple', 'buddhist_temple', 'church', 'mosque', 'shinto_shrine', 'synagogue'],
    searchQueries: ['famous temple', 'heritage shrine'],
  },
  {
    id: 'food',
    label: 'Local Food & Dining',
    gmpTypes: ['restaurant', 'cafe', 'bakery', 'indian_restaurant', 'vegetarian_restaurant', 'dessert_shop', 'tea_store', 'coffee_shop', 'food_court', 'ice_cream_shop'],
    searchQueries: ['iconic local restaurant', 'traditional street food'],
  },
  {
    id: 'nature',
    label: 'Nature & Lakes',
    gmpTypes: ['park', 'city_park', 'botanical_garden', 'garden', 'national_park', 'state_park', 'hiking_area', 'wildlife_park', 'wildlife_refuge', 'zoo'],
    searchQueries: ['scenic lake', 'waterfall viewpoint nature'],
  },
  {
    id: 'shopping',
    label: 'Markets & Shopping',
    gmpTypes: ['shopping_mall', 'market', 'farmers_market', 'flea_market', 'gift_shop', 'store', 'department_store'],
    searchQueries: ['traditional local bazaar', 'handicraft market'],
  },
  {
    id: 'hiddengems',
    label: 'Hidden Gems',
    gmpTypes: ['tourist_attraction', 'observation_deck', 'plaza', 'fountain', 'sculpture', 'visitor_center', 'amphitheatre'],
    searchQueries: ['hidden viewpoints', 'historic stepwell'],
  },
] as const;

export function getGmpTypesForCategory(categoryId: string = 'all'): string[] {
  const match = CATEGORY_FILTERS.find((c) => c.id === categoryId);
  if (match && match.gmpTypes.length > 0) {
    return [...match.gmpTypes];
  }
  return [
    'tourist_attraction',
    'historical_place',
    'monument',
    'hindu_temple',
    'museum',
    'park',
    'restaurant',
    'market',
  ];
}

// Haversine distance calculator in km
export function computeDistanceKm(lat1: number, lon1: number, lat2: number, lon2: number): number {
  const R = 6371; // Earth radius in km
  const dLat = ((lat2 - lat1) * Math.PI) / 180;
  const dLon = ((lon2 - lon1) * Math.PI) / 180;
  const a =
    Math.sin(dLat / 2) * Math.sin(dLat / 2) +
    Math.cos((lat1 * Math.PI) / 180) *
      Math.cos((lat2 * Math.PI) / 180) *
      Math.sin(dLon / 2) *
      Math.sin(dLon / 2);
  const c = 2 * Math.atan2(Math.sqrt(a), Math.sqrt(1 - a));
  return parseFloat((R * c).toFixed(2));
}

export function formatStraightLineDistance(distanceKm: number | null | undefined): string {
  if (typeof distanceKm !== 'number' || !Number.isFinite(distanceKm)) {
    return 'Distance unavailable';
  }
  if (distanceKm < 1) {
    return `~${Math.max(50, Math.round(distanceKm * 1000))} m straight-line`;
  }
  return `~${distanceKm.toFixed(1)} km straight-line`;
}

export function formatWalkOrDriveTime(distanceKm: number): string {
  if (distanceKm <= 0.3) return 'Est. ~3 min walk';
  if (distanceKm <= 0.8) return `Est. ~${Math.round(distanceKm * 12)} min walk`;
  if (distanceKm <= 1.5) return `Est. ~${Math.round(distanceKm * 10)} min walk`;
  if (distanceKm <= 5) return `Est. ~${Math.round(distanceKm * 2.5 + 3)} min drive`;
  return `Est. ~${Math.round(distanceKm * 2.2 + 5)} min drive`;
}

export function formatRouteDuration(seconds: number): string {
  if (!Number.isFinite(seconds) || seconds <= 0) return '';
  const totalMin = Math.max(1, Math.round(seconds / 60));
  if (totalMin < 60) return `${totalMin} min`;
  const hrs = Math.floor(totalMin / 60);
  const mins = totalMin % 60;
  return mins > 0 ? `${hrs} hr ${mins} min` : `${hrs} hr`;
}

export function notifyGmpQuotaExceededIfNeeded(statusOrPayload: number | { quotaExceeded?: boolean; error?: string }): void {
  if (typeof window === 'undefined') return;
  const isQuota =
    statusOrPayload === 429 ||
    (typeof statusOrPayload === 'object' &&
      statusOrPayload !== null &&
      (statusOrPayload.quotaExceeded === true ||
        String(statusOrPayload.error || '').includes('RESOURCE_EXHAUSTED')));
  if (isQuota) {
    window.dispatchEvent(new CustomEvent('gmp-quota-exceeded'));
  }
}

/**
 * Maps Places API (New) and OpenStreetMap types to Charaiva UI category string
 */
export function normalizePlaceCategory(types: string[] = [], name: string = ''): string {
  const lowerTypes = types.map(t => t.toLowerCase()).join(' ');
  const lowerName = name.toLowerCase();

  // 1. Places of Worship -> 'spiritual' (Temples, Shrines, Mosques, Churches, Gurudwaras, Stupas, etc.)
  if (
    lowerTypes.includes('hindu_temple') ||
    lowerTypes.includes('place_of_worship') ||
    lowerTypes.includes('church') ||
    lowerTypes.includes('mosque') ||
    lowerTypes.includes('shrine') ||
    lowerTypes.includes('synagogue') ||
    lowerTypes.includes('monastery') ||
    lowerTypes.includes('chapel') ||
    lowerTypes.includes('cathedral') ||
    lowerName.includes('temple') ||
    lowerName.includes('mandir') ||
    lowerName.includes('kovil') ||
    lowerName.includes('shrine') ||
    lowerName.includes('dargah') ||
    lowerName.includes('gurudwara') ||
    lowerName.includes('gurdwara') ||
    lowerName.includes('church') ||
    lowerName.includes('cathedral') ||
    lowerName.includes('basilica') ||
    lowerName.includes('chapel') ||
    lowerName.includes('mosque') ||
    lowerName.includes('masjid') ||
    lowerName.includes('jama masjid') ||
    lowerName.includes('stupa') ||
    lowerName.includes('deekshabhoomi') ||
    lowerName.includes('dheekshabhoomi') ||
    lowerName.includes('pagoda') ||
    lowerName.includes('ashram') ||
    lowerName.includes('mutt') ||
    lowerName.includes('matha') ||
    lowerName.includes('peeth') ||
    lowerName.includes('peetham') ||
    lowerName.includes('kshetram') ||
    lowerName.includes('jyotirlinga') ||
    lowerName.includes('dham') ||
    lowerName.includes('basadi') ||
    lowerName.includes('derasar') ||
    lowerName.includes('chaitya') ||
    lowerName.includes('vihara') ||
    lowerName.includes('gompa') ||
    lowerName.includes('sanctum') ||
    lowerName.includes('swaminarayan') ||
    lowerName.includes('iskcon') ||
    lowerName.includes('tekdi') ||
    lowerName.includes('ganesh') ||
    lowerName.includes('ganpati') ||
    lowerName.includes('saibaba') ||
    lowerName.includes('sai baba') ||
    lowerName.includes('hanuman') ||
    lowerName.includes('shiva') ||
    lowerName.includes('vishnu') ||
    lowerName.includes('durga') ||
    lowerName.includes('kali') ||
    lowerName.includes('amman') ||
    lowerName.includes('murugan') ||
    lowerName.includes('balaji') ||
    lowerName.includes('ghat') ||
    lowerName.includes('kund') ||
    lowerName.includes('pushkarini')
  ) {
    return 'spiritual';
  }

  // 2. Heritage Buildings, Forts, Palaces, Monuments -> 'history'
  if (
    lowerTypes.includes('monument') ||
    lowerTypes.includes('historical_place') ||
    lowerTypes.includes('fortress') ||
    lowerTypes.includes('castle') ||
    lowerTypes.includes('archaeological_site') ||
    lowerTypes.includes('ruins') ||
    lowerName.includes('fort') ||
    lowerName.includes('qila') ||
    lowerName.includes('killa') ||
    lowerName.includes('garh') ||
    lowerName.includes('kot') ||
    lowerName.includes('durg') ||
    lowerName.includes('mahal') ||
    lowerName.includes('palace') ||
    lowerName.includes('haveli') ||
    lowerName.includes('rajwada') ||
    lowerName.includes('kothi') ||
    lowerName.includes('mansion') ||
    lowerName.includes('gate') ||
    lowerName.includes('darwaza') ||
    lowerName.includes('gateway') ||
    lowerName.includes('buland darwaza') ||
    lowerName.includes('charminar') ||
    lowerName.includes('minar') ||
    lowerName.includes('minaret') ||
    lowerName.includes('clock tower') ||
    lowerName.includes('ghantaghar') ||
    lowerName.includes('tower') ||
    lowerName.includes('chhatri') ||
    lowerName.includes('cenotaph') ||
    lowerName.includes('tomb') ||
    lowerName.includes('maqbara') ||
    lowerName.includes('memorial') ||
    lowerName.includes('monument') ||
    lowerName.includes('heritage building') ||
    lowerName.includes('citadel') ||
    lowerName.includes('bastion') ||
    lowerName.includes('ancient') ||
    lowerName.includes('colonial') ||
    lowerName.includes('zero mile') ||
    lowerName.includes('stambha') ||
    lowerName.includes('stepwell') ||
    lowerName.includes('baoli') ||
    lowerName.includes('vav') ||
    lowerName.includes('high court') ||
    lowerName.includes('town hall') ||
    lowerName.includes('residency')
  ) {
    return 'history';
  }

  // 3. Food, Iconic Eateries & Top High-Rating Dining Establishments -> 'food'
  if (
    lowerTypes.includes('restaurant') ||
    lowerTypes.includes('cafe') ||
    lowerTypes.includes('bakery') ||
    lowerTypes.includes('indian_restaurant') ||
    lowerTypes.includes('vegetarian_restaurant') ||
    lowerTypes.includes('dessert_shop') ||
    lowerTypes.includes('tea_house') ||
    lowerTypes.includes('coffee_shop') ||
    lowerTypes.includes('fast_food') ||
    lowerTypes.includes('food_court') ||
    lowerName.includes('restaurant') ||
    (lowerName.includes('hotel') && (lowerName.includes('saravana') || lowerName.includes('annapoorna') || lowerName.includes('dining') || lowerName.includes('tiffin') || lowerName.includes('bhavan'))) ||
    lowerName.includes('cafe') ||
    lowerName.includes('café') ||
    lowerName.includes('bakery') ||
    lowerName.includes('bhavan') ||
    lowerName.includes('kitchen') ||
    lowerName.includes('dining') ||
    lowerName.includes('food') ||
    lowerName.includes('eatery') ||
    lowerName.includes('bistro') ||
    lowerName.includes('dhaba') ||
    lowerName.includes('tea') ||
    lowerName.includes('chai') ||
    lowerName.includes('coffee') ||
    lowerName.includes('poha') ||
    lowerName.includes('saoji') ||
    lowerName.includes('sweets') ||
    lowerName.includes('sweet') ||
    lowerName.includes('mithai') ||
    lowerName.includes('halwai') ||
    lowerName.includes('haldiram') ||
    lowerName.includes('chitale') ||
    lowerName.includes('biryani') ||
    lowerName.includes('chaat') ||
    lowerName.includes('thali') ||
    lowerName.includes('tiffin') ||
    lowerName.includes('parotta') ||
    lowerName.includes('dosa') ||
    lowerName.includes('idli') ||
    lowerName.includes('jigarthanda') ||
    lowerName.includes('khau gali') ||
    lowerName.includes('khaugali') ||
    lowerName.includes('chappan') ||
    lowerName.includes('snack') ||
    lowerName.includes('ice cream') ||
    lowerName.includes('lassi') ||
    lowerName.includes('barbeque') ||
    lowerName.includes('grill') ||
    lowerName.includes('sweet mart') ||
    lowerName.includes('udupi')
  ) {
    return 'food';
  }

  // 4. Museums, Art & Culture -> 'culture'
  if (
    lowerTypes.includes('museum') ||
    lowerTypes.includes('art_gallery') ||
    lowerTypes.includes('cultural_center') ||
    lowerTypes.includes('performing_arts_theater') ||
    lowerTypes.includes('planetarium') ||
    lowerName.includes('museum') ||
    lowerName.includes('science centre') ||
    lowerName.includes('science center') ||
    lowerName.includes('art gallery') ||
    lowerName.includes('cultural centre') ||
    lowerName.includes('planetarium') ||
    lowerName.includes('theatre') ||
    lowerName.includes('auditorium') ||
    lowerName.includes('crafts')
  ) {
    return 'culture';
  }

  // 5. Nature, Parks & Lakes -> 'nature'
  if (
    lowerTypes.includes('park') ||
    lowerTypes.includes('garden') ||
    lowerTypes.includes('lake') ||
    lowerTypes.includes('national_park') ||
    lowerTypes.includes('hiking_area') ||
    lowerTypes.includes('natural_feature') ||
    lowerTypes.includes('waterfall') ||
    lowerTypes.includes('zoo') ||
    lowerName.includes('lake') ||
    lowerName.includes('talab') ||
    lowerName.includes('sagar') ||
    lowerName.includes('lakefront') ||
    lowerName.includes('riverfront') ||
    lowerName.includes('promenade') ||
    lowerName.includes('park') ||
    lowerName.includes('garden') ||
    lowerName.includes('falls') ||
    lowerName.includes('waterfall') ||
    lowerName.includes('hills') ||
    lowerName.includes('hill') ||
    lowerName.includes('viewpoint') ||
    lowerName.includes('safari') ||
    lowerName.includes('reserve') ||
    lowerName.includes('sanctuary') ||
    lowerName.includes('woods') ||
    lowerName.includes('forest') ||
    lowerName.includes('valley') ||
    lowerName.includes('dam')
  ) {
    return 'nature';
  }

  // 6. Markets & Shopping -> 'shopping'
  if (
    lowerTypes.includes('market') ||
    lowerTypes.includes('shopping') ||
    lowerTypes.includes('bazaar') ||
    lowerTypes.includes('store') ||
    lowerTypes.includes('shopping_mall') ||
    lowerTypes.includes('marketplace') ||
    lowerTypes.includes('supermarket') ||
    lowerTypes.includes('gift_shop') ||
    lowerName.includes('bazaar') ||
    lowerName.includes('market') ||
    lowerName.includes('mall') ||
    lowerName.includes('handloom') ||
    lowerName.includes('sarafa') ||
    lowerName.includes('emporium') ||
    lowerName.includes('textiles') ||
    lowerName.includes('silks') ||
    lowerName.includes('sarees') ||
    lowerName.includes('shopping')
  ) {
    return 'shopping';
  }

  return 'hiddengems';
}
