import { AppTab } from '../types';
import { SUPPORTED_LANGUAGES } from './languages';

export interface AppFeatureMetadata {
  id: AppTab;
  stepNumber: string;
  navLabel: string;
  introTitle: string;
  tourTitle: string;
  tourHeadline: string;
  summary: string;
  tourDescription: string;
  whatItDoes: Array<{ label: string; detail: string }>;
  spokenHint: string;
  primaryMobile: boolean;
}

export const SUPPORTED_LANGUAGE_COUNT = SUPPORTED_LANGUAGES.length;

/**
 * Single canonical source of truth for Charaiva's 8 primary navigation features,
 * preserving exact Navigation tab order across Navigation, App Introduction,
 * Screen Tour, and spoken guidance.
 */
export const APP_PRIMARY_FEATURES: AppFeatureMetadata[] = [
  {
    id: 'home',
    stepNumber: '01',
    navLabel: 'Explore',
    introTitle: 'Explore Home & City Dossier',
    tourTitle: 'Explore Home & Two-Tier City Dossier',
    tourHeadline: 'Your live destination hub for GPS or chosen cities',
    summary:
      'Displays your active GPS location or manually selected city overview, current atmosphere tag, and launches the two-tier City Guide modal.',
    tourDescription:
      'Shows your live GPS city or manually chosen destination with an authentic overview, location badge, and direct shortcuts to Photo Guide, Attractions, City Guide Dossiers, or onboarding replay.',
    whatItDoes: [
      {
        label: 'Explore City Modal',
        detail:
          'Opens a two-tier City Guide with both an instant brief overview and a structured multi-section historian dossier.',
      },
      {
        label: 'Live GPS or Chosen City Badge',
        detail:
          'Always shows whether you are viewing your physical GPS location or a manually chosen remote city.',
      },
      {
        label: '1-Tap Launch Strip',
        detail:
          'Jumps directly into Click / Upload Sight, Attractions Radar, Settings, App Intro, or Screen Tour.',
      },
    ],
    spokenHint:
      'Option one is Explore Home. View your live GPS or chosen destination overview and open two-tier City Guides anytime.',
    primaryMobile: true,
  },
  {
    id: 'camera',
    stepNumber: '02',
    navLabel: 'Photo Guide',
    introTitle: 'Photo Guide & Deep Dive',
    tourTitle: 'Photo Guide & Progressive Vision Analysis',
    tourHeadline: 'Snap or upload any sight—monument, carving, food, or sign',
    summary:
      'Capture with your camera or upload any photograph for ranked identification, OCR inscription reading, multi-level explanations, Detail by Detail breakdown, and Deep Dive insights.',
    tourDescription:
      'A unified screen for live camera capture and photo library upload. It streams recognition and stories cleanly without freezing, deciphers legible script/signage, and opens ranked candidates when a subject or everyday object could match more than one work.',
    whatItDoes: [
      {
        label: 'Three-Batch Progressive Vision',
        detail:
          'Initial title and heritage identity appear first, followed smoothly by core narration, speech playback, and deeper architectural facts.',
      },
      {
        label: 'OCR Plaque & Script Translation',
        detail:
          'Reads legible carvings, museum plaques, and street signage aloud in your chosen language while distinguishing uncertain letters.',
      },
      {
        label: 'Ranked Matches & Storage Control',
        detail:
          'Lets you pick from candidate matches when helpful, with photos stored to /app-data/photos only if you enable YES in Settings.',
      },
    ],
    spokenHint:
      'Option two is Photo Guide. Snap or upload a monument, sculpture, dish, or sign for OCR reading, spoken narration, and Detail by Detail exploration.',
    primaryMobile: true,
  },
  {
    id: 'discover',
    stepNumber: '03',
    navLabel: 'Discover',
    introTitle: 'Discover — Global Subject Search',
    tourTitle: 'Discover — Global Two-Step Subject Search',
    tourHeadline: 'Find any monument, sculpture, artwork, inscription, or object worldwide',
    summary:
      'Two-step worldwide search by exact name, partial clue, nickname, spelling variation, or voice dictation—showing related candidate matches first before opening its full multi-level guide.',
    tourDescription:
      'Unlike Nearby Attractions (which scans physical places near a location) and Explore More (which expands 5 subtopics inside an open explanation), Discover searches globally by query or clue. Step 1 lists verified related matches so you pick the exact subject first; Step 2 opens its full Overview, Detail by Detail, Architecture & Craft, and Deep Conversation guide.',
    whatItDoes: [
      {
        label: 'Search by Name, Clue, Nickname, or Voice',
        detail:
          'Supports live autocomplete, typo-tolerant matching, descriptive clues (such as "bronze dancing Shiva"), and microphone voice search.',
      },
      {
        label: 'Step 1 Related Candidates First',
        detail:
          'Displays ranked candidates from verified heritage records, Wikipedia, Google Places, and grounded search with certainty labels before loading the full guide.',
      },
      {
        label: 'Step 2 Complete Multi-Level Guide & Explore More',
        detail:
          'Selecting a match opens multi-depth explanations (Quick, Standard, Deep, Expert), authentic images, Detail by Detail parts, and 5 Explore More deeper subtopics.',
      },
    ],
    spokenHint:
      'Option three is Discover. Search worldwide by name, clue, nickname, or voice to see related matches first, then pick one to open a complete multi-level guide.',
    primaryMobile: true,
  },
  {
    id: 'nearby',
    stepNumber: '04',
    navLabel: 'Attractions',
    introTitle: 'Attractions Radar',
    tourTitle: 'Nearby Attractions Radar',
    tourHeadline: 'Browse real physical places around your GPS or selected city',
    summary:
      'Sweeps real Google Places and OpenStreetMap points of interest around your live GPS or chosen destination with category filters, radius slider, spoken pitch, and map directions.',
    tourDescription:
      'Focuses strictly on physical places around your active GPS or picked destination city—unlike Discover’s worldwide topic search. Filter monuments, temples, museums, nature, food, markets, or viewpoints across 500m to 10km.',
    whatItDoes: [
      {
        label: 'Category Chips & Radius Slider',
        detail:
          'Filter real sights by Temples, Heritage, Museums, Nature, Food & Chai, Markets, or Viewpoints from 500m up to 10km.',
      },
      {
        label: 'Spoken Pitch & Full Guide Launch',
        detail:
          'Hear a quick spoken overview or open any attraction’s full Explanation View with Detail by Detail and Explore More.',
      },
      {
        label: 'Google Maps Directions',
        detail:
          'Open external map directions directly to any nearby monument, landmark, or local spot.',
      },
    ],
    spokenHint:
      'Option four is Attractions. Sweep real physical places around your GPS or selected city with category filters, radius control, and map directions.',
    primaryMobile: true,
  },
  {
    id: 'chat',
    stepNumber: '05',
    navLabel: 'AI Guide',
    introTitle: 'AI Guide Chat',
    tourTitle: 'Multilingual AI Guide Chat with Session Memory',
    tourHeadline: 'Ask anything by voice or text—without repeating what you already saw',
    summary:
      `Hold natural voice or text conversations across ${SUPPORTED_LANGUAGE_COUNT} languages with session memory and optional saving of places explored in chat to your Tour Journal.`,
    tourDescription:
      `Chat freely by typing or speaking aloud across ${SUPPORTED_LANGUAGE_COUNT} supported languages. AI Guide remembers landmarks you already visited in this session so answers add fresh details instead of repeating earlier intros.`,
    whatItDoes: [
      {
        label: 'Voice Dictation & Live Replies',
        detail:
          `Ask questions naturally using microphone dictation or text across ${SUPPORTED_LANGUAGE_COUNT} supported languages with optional spoken playback.`,
      },
      {
        label: 'Anti-Repetition Session Memory',
        detail:
          'Tracks discussed landmarks from your tour so follow-up answers stay connected and skip redundant basics.',
      },
      {
        label: 'Save Explored Places to Journal',
        detail:
          'Log memorable places discussed during chat straight into your persistent Tour Journal with notes and photos.',
      },
    ],
    spokenHint:
      'Option five is AI Guide. Ask spoken or typed follow-up questions across all supported languages while Charaiva remembers sites from your session.',
    primaryMobile: true,
  },
  {
    id: 'map',
    stepNumber: '06',
    navLabel: 'Map',
    introTitle: 'Interactive Map',
    tourTitle: 'Interactive Sightseeing Map',
    tourHeadline: 'Visualize nearby heritage pins around your active position',
    summary:
      'Live interactive Leaflet map centered on your GPS coordinates or chosen destination city with tap-to-tour landmark pins and spatial distance awareness.',
    tourDescription:
      'Centers automatically on your live GPS coordinates or manually picked city worldwide so you can inspect landmark pins spatially and launch a guided view directly from any pin.',
    whatItDoes: [
      {
        label: 'Auto-Centered Destination Viewport',
        detail:
          'Updates immediately whenever you switch between GPS mode and a manually picked city.',
      },
      {
        label: 'Tap Pin to Launch Guide',
        detail:
          'Inspect real monument markers on the map, review highlights, and jump into their full explanation view.',
      },
    ],
    spokenHint:
      'Option six is Map. Explore heritage pins around your active GPS or chosen city and tap any marker to open its story.',
    primaryMobile: false,
  },
  {
    id: 'history',
    stepNumber: '07',
    navLabel: 'Journal',
    introTitle: 'Tour Journal',
    tourTitle: 'Tour Journal & Personal Memory Log',
    tourHeadline: 'Searchable log of scanned sights, saved discoveries, notes, and photos',
    summary:
      'Chronological, searchable travel journal of scanned sights, manual entries, personal notes, and saved discoveries with instant story and audio replay.',
    tourDescription:
      'Saves explored monuments, manual logs, travel notes, dates, and optional photos privately per explorer account (or guest session on this device) so you can search, edit, replay audio, or reopen complete guides anytime.',
    whatItDoes: [
      {
        label: 'Add, Edit, Search & Delete Entries',
        detail:
          'Record new places manually, attach a photo, edit visit notes or dates, filter with live search, or remove individual entries.',
      },
      {
        label: 'Instant Story & Audio Replay',
        detail:
          'Reopen full explanations and replay spoken narration in your active language and voice speed.',
      },
      {
        label: 'Account-Scoped Cloud & Privacy Control',
        detail:
          'Syncs securely when signed in with Google or stays isolated on this device for Guest explorers.',
      },
    ],
    spokenHint:
      'Option seven is Tour Journal. Search, edit, add notes, and replay stories or saved photos from your journeys.',
    primaryMobile: false,
  },
  {
    id: 'settings',
    stepNumber: '08',
    navLabel: 'Settings',
    introTitle: 'Settings & Personalization',
    tourTitle: 'Settings, Profile & Personalization',
    tourHeadline: 'Control language, voice output mode, GPS/city mode, topics, privacy & themes',
    summary:
      `Configure Google Sync/Profile, GPS or manual destination city, ${SUPPORTED_LANGUAGE_COUNT} languages, Output Mode (Speech, Text, Both), voice gender/speed/pitch, device photo storage (YES/NO), 10 topic lenses, and 4 color themes.`,
    tourDescription:
      `One place for all explorer preferences saved once during setup and synchronized across every Charaiva screen: language across ${SUPPORTED_LANGUAGE_COUNT} options, Speech/Text/Both mode, voice gender/speed/pitch, GPS vs chosen city, photo storage toggle, 10 story topics, color theme, and onboarding replay.`,
    whatItDoes: [
      {
        label: `${SUPPORTED_LANGUAGE_COUNT} Languages & Output Modes`,
        detail:
          'Switch narration & UI language and choose Speech + Text, Speech Only, or silent Text Only reading mode.',
      },
      {
        label: 'Voice Tuning, Storage & 10 Topic Lenses',
        detail:
          'Set Male or Female voice, adjust pitch and speaking rate, toggle clicked photo storage (YES/NO), and pick story topics.',
      },
      {
        label: 'Themes, Location Mode & Onboarding Replay',
        detail:
          'Preview 4 color atmospheres, switch GPS or city mode, manage Google sync, or replay the Intro or Screen Tour.',
      },
    ],
    spokenHint:
      'Option eight is Settings. Customize your language, output mode, voice speed and tone, location mode, photo storage choice, topic lenses, and theme.',
    primaryMobile: false,
  },
];

export const FEATURE_DISTINCTION_NOTES = [
  {
    id: 'discover-vs-attractions-vs-explore-more',
    discoverLabel: 'Discover (Tab 3)',
    discoverText:
      'Global two-step search by name, clue, nickname, or voice—shows matching candidates first, then opens a full multi-level guide for any monument, artwork, inscription, or object anywhere.',
    attractionsLabel: 'Attractions (Tab 4)',
    attractionsText:
      'Location-based radar scanning real physical places around your live GPS or chosen city with category filters, 500m–10km distance radius, and map directions.',
    exploreMoreLabel: 'Explore More (Inside Explanations)',
    exploreMoreText:
      'Five dynamic subtopic cards generated inside an already opened subject’s Explanation View so you can dive deeper into one specific angle without repeating overview basics.',
  },
];
