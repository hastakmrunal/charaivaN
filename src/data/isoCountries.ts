import { LocationCountryOption } from '../types';

/**
 * Compact ISO 3166-1 alpha-2 country tuples: [isoCode, englishName, flagEmoji, hasSubdivisions]
 * Kept lightweight (~8 KB) so client bundle never imports heavy state/city datasets.
 */
const RAW_ISO_COUNTRIES: ReadonlyArray<readonly [string, string, string, 0 | 1]> = [
  ['AF', 'Afghanistan', '🇦🇫', 1],
  ['AX', 'Aland Islands', '🇦🇽', 0],
  ['AL', 'Albania', '🇦🇱', 1],
  ['DZ', 'Algeria', '🇩🇿', 1],
  ['AS', 'American Samoa', '🇦🇸', 0],
  ['AD', 'Andorra', '🇦🇩', 1],
  ['AO', 'Angola', '🇦🇴', 1],
  ['AI', 'Anguilla', '🇦🇮', 0],
  ['AQ', 'Antarctica', '🇦🇶', 0],
  ['AG', 'Antigua And Barbuda', '🇦🇬', 1],
  ['AR', 'Argentina', '🇦🇷', 1],
  ['AM', 'Armenia', '🇦🇲', 1],
  ['AW', 'Aruba', '🇦🇼', 0],
  ['AU', 'Australia', '🇦🇺', 1],
  ['AT', 'Austria', '🇦🇹', 1],
  ['AZ', 'Azerbaijan', '🇦🇿', 1],
  ['BS', 'The Bahamas', '🇧🇸', 1],
  ['BH', 'Bahrain', '🇧🇭', 1],
  ['BD', 'Bangladesh', '🇧🇩', 1],
  ['BB', 'Barbados', '🇧🇧', 1],
  ['BY', 'Belarus', '🇧🇾', 1],
  ['BE', 'Belgium', '🇧🇪', 1],
  ['BZ', 'Belize', '🇧🇿', 1],
  ['BJ', 'Benin', '🇧🇯', 1],
  ['BM', 'Bermuda', '🇧🇲', 1],
  ['BT', 'Bhutan', '🇧🇹', 1],
  ['BO', 'Bolivia', '🇧🇴', 1],
  ['BA', 'Bosnia and Herzegovina', '🇧🇦', 1],
  ['BW', 'Botswana', '🇧🇼', 1],
  ['BV', 'Bouvet Island', '🇧🇻', 0],
  ['BR', 'Brazil', '🇧🇷', 1],
  ['IO', 'British Indian Ocean Territory', '🇮🇴', 0],
  ['BN', 'Brunei', '🇧🇳', 1],
  ['BG', 'Bulgaria', '🇧🇬', 1],
  ['BF', 'Burkina Faso', '🇧🇫', 1],
  ['BI', 'Burundi', '🇧🇮', 1],
  ['KH', 'Cambodia', '🇰🇭', 1],
  ['CM', 'Cameroon', '🇨🇲', 1],
  ['CA', 'Canada', '🇨🇦', 1],
  ['CV', 'Cape Verde', '🇨🇻', 1],
  ['KY', 'Cayman Islands', '🇰🇾', 0],
  ['CF', 'Central African Republic', '🇨🇫', 1],
  ['TD', 'Chad', '🇹🇩', 1],
  ['CL', 'Chile', '🇨🇱', 1],
  ['CN', 'China', '🇨🇳', 1],
  ['CX', 'Christmas Island', '🇨🇽', 0],
  ['CC', 'Cocos (Keeling) Islands', '🇨🇨', 0],
  ['CO', 'Colombia', '🇨🇴', 1],
  ['KM', 'Comoros', '🇰🇲', 1],
  ['CG', 'Congo', '🇨🇬', 1],
  ['CD', 'Democratic Republic of the Congo', '🇨🇩', 1],
  ['CK', 'Cook Islands', '🇨🇰', 0],
  ['CR', 'Costa Rica', '🇨🇷', 1],
  ['CI', "Cote D'Ivoire (Ivory Coast)", '🇨🇮', 1],
  ['HR', 'Croatia', '🇭🇷', 1],
  ['CU', 'Cuba', '🇨🇺', 1],
  ['CY', 'Cyprus', '🇨🇾', 1],
  ['CZ', 'Czech Republic', '🇨🇿', 1],
  ['DK', 'Denmark', '🇩🇰', 1],
  ['DJ', 'Djibouti', '🇩🇯', 1],
  ['DM', 'Dominica', '🇩🇲', 1],
  ['DO', 'Dominican Republic', '🇩🇴', 1],
  ['TL', 'East Timor', '🇹🇱', 1],
  ['EC', 'Ecuador', '🇪🇨', 1],
  ['EG', 'Egypt', '🇪🇬', 1],
  ['SV', 'El Salvador', '🇸🇻', 1],
  ['GQ', 'Equatorial Guinea', '🇬🇶', 1],
  ['ER', 'Eritrea', '🇪🇷', 1],
  ['EE', 'Estonia', '🇪🇪', 1],
  ['ET', 'Ethiopia', '🇪🇹', 1],
  ['FK', 'Falkland Islands', '🇫🇰', 0],
  ['FO', 'Faroe Islands', '🇫🇴', 0],
  ['FJ', 'Fiji Islands', '🇫🇯', 1],
  ['FI', 'Finland', '🇫🇮', 1],
  ['FR', 'France', '🇫🇷', 1],
  ['GF', 'French Guiana', '🇬🇫', 0],
  ['PF', 'French Polynesia', '🇵🇫', 0],
  ['TF', 'French Southern Territories', '🇹🇫', 0],
  ['GA', 'Gabon', '🇬🇦', 1],
  ['GM', 'The Gambia', '🇬🇲', 1],
  ['GE', 'Georgia', '🇬🇪', 1],
  ['DE', 'Germany', '🇩🇪', 1],
  ['GH', 'Ghana', '🇬🇭', 1],
  ['GI', 'Gibraltar', '🇬🇮', 0],
  ['GR', 'Greece', '🇬🇷', 1],
  ['GL', 'Greenland', '🇬🇱', 0],
  ['GD', 'Grenada', '🇬🇩', 1],
  ['GP', 'Guadeloupe', '🇬🇵', 0],
  ['GU', 'Guam', '🇬🇺', 0],
  ['GT', 'Guatemala', '🇬🇹', 1],
  ['GG', 'Guernsey and Alderney', '🇬🇬', 0],
  ['GN', 'Guinea', '🇬🇳', 1],
  ['GW', 'Guinea-Bissau', '🇬🇼', 1],
  ['GY', 'Guyana', '🇬🇾', 1],
  ['HT', 'Haiti', '🇭🇹', 1],
  ['HM', 'Heard Island and McDonald Islands', '🇭🇲', 0],
  ['HN', 'Honduras', '🇭🇳', 1],
  ['HK', 'Hong Kong S.A.R.', '🇭🇰', 1],
  ['HU', 'Hungary', '🇭🇺', 1],
  ['IS', 'Iceland', '🇮🇸', 1],
  ['IN', 'India', '🇮🇳', 1],
  ['ID', 'Indonesia', '🇮🇩', 1],
  ['IR', 'Iran', '🇮🇷', 1],
  ['IQ', 'Iraq', '🇮🇶', 1],
  ['IE', 'Ireland', '🇮🇪', 1],
  ['IL', 'Israel', '🇮🇱', 1],
  ['IT', 'Italy', '🇮🇹', 1],
  ['JM', 'Jamaica', '🇯🇲', 1],
  ['JP', 'Japan', '🇯🇵', 1],
  ['JE', 'Jersey', '🇯🇪', 0],
  ['JO', 'Jordan', '🇯🇴', 1],
  ['KZ', 'Kazakhstan', '🇰🇿', 1],
  ['KE', 'Kenya', '🇰🇪', 1],
  ['KI', 'Kiribati', '🇰🇮', 1],
  ['KP', 'North Korea', '🇰🇵', 1],
  ['KR', 'South Korea', '🇰🇷', 1],
  ['KW', 'Kuwait', '🇰🇼', 1],
  ['KG', 'Kyrgyzstan', '🇰🇬', 1],
  ['LA', 'Laos', '🇱🇦', 1],
  ['LV', 'Latvia', '🇱🇻', 1],
  ['LB', 'Lebanon', '🇱🇧', 1],
  ['LS', 'Lesotho', '🇱🇸', 1],
  ['LR', 'Liberia', '🇱🇷', 1],
  ['LY', 'Libya', '🇱🇾', 1],
  ['LI', 'Liechtenstein', '🇱🇮', 1],
  ['LT', 'Lithuania', '🇱🇹', 1],
  ['LU', 'Luxembourg', '🇱🇺', 1],
  ['MO', 'Macau S.A.R.', '🇲🇴', 0],
  ['MK', 'North Macedonia', '🇲🇰', 1],
  ['MG', 'Madagascar', '🇲🇬', 1],
  ['MW', 'Malawi', '🇲🇼', 1],
  ['MY', 'Malaysia', '🇲🇾', 1],
  ['MV', 'Maldives', '🇲🇻', 1],
  ['ML', 'Mali', '🇲🇱', 1],
  ['MT', 'Malta', '🇲🇹', 1],
  ['IM', 'Isle of Man', '🇮🇲', 0],
  ['MH', 'Marshall Islands', '🇲🇭', 1],
  ['MQ', 'Martinique', '🇲🇶', 0],
  ['MR', 'Mauritania', '🇲🇷', 1],
  ['MU', 'Mauritius', '🇲🇺', 1],
  ['YT', 'Mayotte', '🇾🇹', 0],
  ['MX', 'Mexico', '🇲🇽', 1],
  ['FM', 'Micronesia', '🇫🇲', 1],
  ['MD', 'Moldova', '🇲🇩', 1],
  ['MC', 'Monaco', '🇲🇨', 1],
  ['MN', 'Mongolia', '🇲🇳', 1],
  ['ME', 'Montenegro', '🇲🇪', 1],
  ['MS', 'Montserrat', '🇲🇸', 0],
  ['MA', 'Morocco', '🇲🇦', 1],
  ['MZ', 'Mozambique', '🇲🇿', 1],
  ['MM', 'Myanmar', '🇲🇲', 1],
  ['NA', 'Namibia', '🇳🇦', 1],
  ['NR', 'Nauru', '🇳🇷', 1],
  ['NP', 'Nepal', '🇳🇵', 1],
  ['BQ', 'Bonaire, Sint Eustatius and Saba', '🇧🇶', 0],
  ['NL', 'Netherlands', '🇳🇱', 1],
  ['NC', 'New Caledonia', '🇳🇨', 0],
  ['NZ', 'New Zealand', '🇳🇿', 1],
  ['NI', 'Nicaragua', '🇳🇮', 1],
  ['NE', 'Niger', '🇳🇪', 1],
  ['NG', 'Nigeria', '🇳🇬', 1],
  ['NU', 'Niue', '🇳🇺', 0],
  ['NF', 'Norfolk Island', '🇳🇫', 0],
  ['MP', 'Northern Mariana Islands', '🇲🇵', 0],
  ['NO', 'Norway', '🇳🇴', 1],
  ['OM', 'Oman', '🇴🇲', 1],
  ['PK', 'Pakistan', '🇵🇰', 1],
  ['PW', 'Palau', '🇵🇼', 1],
  ['PS', 'Palestine', '🇵🇸', 0],
  ['PA', 'Panama', '🇵🇦', 1],
  ['PG', 'Papua New Guinea', '🇵🇬', 1],
  ['PY', 'Paraguay', '🇵🇾', 1],
  ['PE', 'Peru', '🇵🇪', 1],
  ['PH', 'Philippines', '🇵🇭', 1],
  ['PN', 'Pitcairn Island', '🇵🇳', 0],
  ['PL', 'Poland', '🇵🇱', 1],
  ['PT', 'Portugal', '🇵🇹', 1],
  ['PR', 'Puerto Rico', '🇵🇷', 0],
  ['QA', 'Qatar', '🇶🇦', 1],
  ['RE', 'Reunion', '🇷🇪', 0],
  ['RO', 'Romania', '🇷🇴', 1],
  ['RU', 'Russia', '🇷🇺', 1],
  ['RW', 'Rwanda', '🇷🇼', 1],
  ['SH', 'Saint Helena', '🇸🇭', 0],
  ['KN', 'Saint Kitts And Nevis', '🇰🇳', 1],
  ['LC', 'Saint Lucia', '🇱🇨', 1],
  ['PM', 'Saint Pierre and Miquelon', '🇵🇲', 0],
  ['VC', 'Saint Vincent And The Grenadines', '🇻🇨', 1],
  ['BL', 'Saint-Barthelemy', '🇧🇱', 0],
  ['MF', 'Saint-Martin (French part)', '🇲🇫', 0],
  ['WS', 'Samoa', '🇼🇸', 1],
  ['SM', 'San Marino', '🇸🇲', 1],
  ['ST', 'Sao Tome and Principe', '🇸🇹', 1],
  ['SA', 'Saudi Arabia', '🇸🇦', 1],
  ['SN', 'Senegal', '🇸🇳', 1],
  ['RS', 'Serbia', '🇷🇸', 1],
  ['SC', 'Seychelles', '🇸🇨', 1],
  ['SL', 'Sierra Leone', '🇸🇱', 1],
  ['SG', 'Singapore', '🇸🇬', 1],
  ['SK', 'Slovakia', '🇸🇰', 1],
  ['SI', 'Slovenia', '🇸🇮', 1],
  ['SB', 'Solomon Islands', '🇸🇧', 1],
  ['SO', 'Somalia', '🇸🇴', 1],
  ['ZA', 'South Africa', '🇿🇦', 1],
  ['GS', 'South Georgia', '🇬🇸', 0],
  ['SS', 'South Sudan', '🇸🇸', 1],
  ['ES', 'Spain', '🇪🇸', 1],
  ['LK', 'Sri Lanka', '🇱🇰', 1],
  ['SD', 'Sudan', '🇸🇩', 1],
  ['SR', 'Suriname', '🇸🇷', 1],
  ['SJ', 'Svalbard And Jan Mayen Islands', '🇸🇯', 0],
  ['SZ', 'Eswatini (Swaziland)', '🇸🇿', 1],
  ['SE', 'Sweden', '🇸🇪', 1],
  ['CH', 'Switzerland', '🇨🇭', 1],
  ['SY', 'Syria', '🇸🇾', 1],
  ['TW', 'Taiwan', '🇹🇼', 1],
  ['TJ', 'Tajikistan', '🇹🇯', 1],
  ['TZ', 'Tanzania', '🇹🇿', 1],
  ['TH', 'Thailand', '🇹🇭', 1],
  ['TG', 'Togo', '🇹🇬', 1],
  ['TK', 'Tokelau', '🇹🇰', 0],
  ['TO', 'Tonga', '🇹🇴', 1],
  ['TT', 'Trinidad And Tobago', '🇹🇹', 1],
  ['TN', 'Tunisia', '🇹🇳', 1],
  ['TR', 'Turkey', '🇹🇷', 1],
  ['TM', 'Turkmenistan', '🇹🇲', 1],
  ['TC', 'Turks And Caicos Islands', '🇹🇨', 0],
  ['TV', 'Tuvalu', '🇹🇻', 1],
  ['UG', 'Uganda', '🇺🇬', 1],
  ['UA', 'Ukraine', '🇺🇦', 1],
  ['AE', 'United Arab Emirates', '🇦🇪', 1],
  ['GB', 'United Kingdom', '🇬🇧', 1],
  ['US', 'United States', '🇺🇸', 1],
  ['UM', 'United States Minor Outlying Islands', '🇺🇲', 0],
  ['UY', 'Uruguay', '🇺🇾', 1],
  ['UZ', 'Uzbekistan', '🇺🇿', 1],
  ['VU', 'Vanuatu', '🇻🇺', 1],
  ['VA', 'Vatican City State (Holy See)', '🇻🇦', 0],
  ['VE', 'Venezuela', '🇻🇪', 1],
  ['VN', 'Vietnam', '🇻🇳', 1],
  ['VG', 'Virgin Islands (British)', '🇻🇬', 0],
  ['VI', 'Virgin Islands (US)', '🇻🇮', 0],
  ['WF', 'Wallis And Futuna Islands', '🇼🇫', 0],
  ['EH', 'Western Sahara', '🇪🇭', 0],
  ['YE', 'Yemen', '🇾🇪', 1],
  ['ZM', 'Zambia', '🇿🇲', 1],
  ['ZW', 'Zimbabwe', '🇿🇼', 1],
  ['XK', 'Kosovo', '🇽🇰', 1],
  ['CW', 'Curaçao', '🇨🇼', 0],
  ['SX', 'Sint Maarten (Dutch part)', '🇸🇽', 0],
];

const COUNTRY_ALIASES: Record<string, string[]> = {
  AE: ['UAE', 'Emirates', 'Dubai', 'Abu Dhabi'],
  BS: ['Bahamas'],
  CI: ['Ivory Coast', "Cote d'Ivoire"],
  CZ: ['Czechia'],
  DE: ['Deutschland'],
  ES: ['Espana', 'España'],
  FR: ['Republique Francaise'],
  GB: ['UK', 'Great Britain', 'Britain', 'England', 'Scotland', 'Wales', 'Northern Ireland'],
  GM: ['Gambia'],
  HK: ['Hong Kong'],
  IN: ['Bharat', 'Hindustan'],
  IT: ['Italia'],
  JP: ['Nippon', 'Nihon'],
  KR: ['Republic of Korea', 'Korea'],
  LK: ['Ceylon'],
  MK: ['Macedonia'],
  MM: ['Burma'],
  MO: ['Macau', 'Macao'],
  NL: ['Holland'],
  PS: ['Palestinian Territory'],
  RU: ['Russian Federation'],
  SZ: ['Swaziland', 'Eswatini'],
  TL: ['Timor-Leste', 'East Timor'],
  TR: ['Turkiye', 'Türkiye'],
  US: ['USA', 'America', 'United States of America'],
  VA: ['Vatican', 'Holy See', 'Vatican City'],
  VN: ['Viet Nam'],
};

export function foldDiacritics(input: string): string {
  return String(input || '')
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '')
    .toLowerCase()
    .trim();
}

const localizedCountryCache = new Map<string, LocationCountryOption[]>();

export function getWorldwideCountries(languageCode: string = 'en'): LocationCountryOption[] {
  const normLang = (languageCode || 'en').toLowerCase().trim() || 'en';
  const cached = localizedCountryCache.get(normLang);
  if (cached) return cached;

  let displayNames: Intl.DisplayNames | null = null;
  try {
    if (typeof Intl !== 'undefined' && typeof Intl.DisplayNames === 'function') {
      displayNames = new Intl.DisplayNames([normLang, 'en'], { type: 'region' });
    }
  } catch {
    displayNames = null;
  }

  const list: LocationCountryOption[] = RAW_ISO_COUNTRIES.map(([code, englishName, flag, hasStatesNum]) => {
    let localizedName = englishName;
    if (displayNames && normLang !== 'en') {
      try {
        const resolved = displayNames.of(code);
        if (resolved && resolved !== code) {
          localizedName = resolved;
        }
      } catch {
        // fallback to englishName
      }
    }
    return {
      code,
      name: englishName,
      localizedName,
      flag,
      hasStates: hasStatesNum === 1,
      aliases: COUNTRY_ALIASES[code] || [],
    };
  });

  localizedCountryCache.set(normLang, list);
  return list;
}

export function searchWorldwideCountries(
  query: string,
  languageCode: string = 'en',
  limit: number = 40
): LocationCountryOption[] {
  const countries = getWorldwideCountries(languageCode);
  const qRaw = String(query || '').trim();
  if (!qRaw) {
    // Keep top popular countries near the top initially while preserving full searchable list
    const priorityCodes = ['IN', 'US', 'GB', 'FR', 'JP', 'IT', 'DE', 'AE', 'ES', 'AU', 'CA', 'SG'];
    const prioritySet = new Set(priorityCodes);
    const prioritized = priorityCodes
      .map((code) => countries.find((c) => c.code === code))
      .filter((c): c is LocationCountryOption => Boolean(c));
    const rest = countries.filter((c) => !prioritySet.has(c.code));
    return [...prioritized, ...rest].slice(0, limit);
  }

  const q = foldDiacritics(qRaw);
  const qUpper = qRaw.toUpperCase();

  const scored: Array<{ country: LocationCountryOption; score: number }> = [];
  for (const country of countries) {
    const en = foldDiacritics(country.name);
    const loc = foldDiacritics(country.localizedName);
    const aliases = (country.aliases || []).map(foldDiacritics);
    let score = 0;

    if (country.code === qUpper || en === q || loc === q || aliases.includes(q)) {
      score = 1000;
    } else if (en.startsWith(q) || loc.startsWith(q)) {
      score = 800;
    } else if (aliases.some((a) => a.startsWith(q))) {
      score = 720;
    } else if (
      en.split(/[\s\-(),']+/).some((w) => w.startsWith(q)) ||
      loc.split(/[\s\-(),']+/).some((w) => w.startsWith(q))
    ) {
      score = 600;
    } else if (en.includes(q) || loc.includes(q) || aliases.some((a) => a.includes(q))) {
      score = 400;
    }

    if (score > 0) {
      scored.push({ country, score });
    }
  }

  scored.sort((a, b) => b.score - a.score || a.country.name.localeCompare(b.country.name));
  return scored.slice(0, limit).map((item) => item.country);
}

export function findCountryByNameOrCode(
  nameOrCode?: string | null,
  languageCode: string = 'en'
): LocationCountryOption | null {
  const raw = String(nameOrCode || '').trim();
  if (!raw) return null;
  const countries = getWorldwideCountries(languageCode);
  const upper = raw.toUpperCase();
  const byCode = countries.find((c) => c.code === upper);
  if (byCode) return byCode;

  const q = foldDiacritics(raw);
  return (
    countries.find(
      (c) =>
        foldDiacritics(c.name) === q ||
        foldDiacritics(c.localizedName) === q ||
        (c.aliases || []).some((a) => foldDiacritics(a) === q)
    ) || null
  );
}
