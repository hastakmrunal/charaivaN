import React, { useState, useRef, useEffect } from 'react';
import {
  DiscoverAutocompleteSuggestion,
  DiscoverCandidate,
  DiscoverSourceCitation,
  GuideSettings,
  Language,
  LocationCoords,
  RecognitionResult,
} from '../types';
import { PlaceCardImage } from './PlaceCardImage';
import { BackButton } from './BackButton';
import { useBackLayer, usePreservedScroll } from '../utils/navigationHistory';
import { useLocalizedTexts } from '../data/localizedStrings';
import {
  Compass,
  Search,
  Mic,
  MicOff,
  Loader2,
  Sparkles,
  ArrowRight,
  MapPin,
  Clock,
  BookOpen,
  ExternalLink,
  AlertCircle,
  Globe,
  Plus,
  X,
} from 'lucide-react';

interface DiscoverScreenProps {
  isActive?: boolean;
  selectedLanguage: Language;
  guideSettings?: GuideSettings;
  locationCoords: LocationCoords | null;
  onSelectResultToView: (landmark: RecognitionResult) => void;
  onBackToHome: () => void;
}

const DISCOVER_UI_DEFAULTS = {
  title: 'Global Heritage & Subject Discover',
  subtitle:
    'Search any monument, temple, sculpture, inscription, artwork, or everyday object worldwide — by name, local term, typo, or visual clue.',
  searchPlaceholder: 'e.g. Dancing Shiva in bronze ring of fire, Ajintha, Three lions pillar...',
  searchBtn: 'Search',
  searchingBtn: 'Searching...',
  voiceStartTitle: 'Speak search clue or name',
  voiceStopTitle: 'Listening... tap to stop',
  voiceUnsupported: 'Voice search is not supported in this browser. Please type your query instead.',
  voiceDenied: 'Microphone permission denied or unavailable. Please type your search query.',
  sampleCluesLabel: 'Try Clues, Nicknames & Global Sights:',
  recentSearchesLabel: 'Recent Searches:',
  stepOneBanner: 'Step 1 of 2 · Choose the closest matching subject below to open its full multi-level guide',
  resultsCountSuffix: 'related matches found',
  openGuideBtn: 'Explore Full Guide',
  loadingExplanation: 'Preparing structured explanation in',
  loadMoreBtn: 'Load More Results',
  loadingMoreBtn: 'Loading more...',
  noResultsTitle: 'No matching subjects found yet',
  noResultsBody:
    'Try adding a location, material, deity/figure name, architectural clue, or spelling variation.',
  exampleBadge: 'Reference / Similar Example',
  shortQueryError: 'Please enter at least 2 characters to search.',
  globalReadyBadge: 'Worldwide Search · No GPS Required',
  sourcesLabel: 'Search Grounding Sources',
};

const SAMPLE_CLUES = [
  'Taj Mahal',
  'Dancing Shiva in bronze ring of fire',
  'Three lions pillar',
  'Ajintha',
  'Black Pagoda',
  'Charminar',
  'Ellora Kailasa Temple',
];

const RECENT_DISCOVER_KEY = 'charaiva_recent_discover_v1';

export const DiscoverScreen: React.FC<DiscoverScreenProps> = ({
  isActive = true,
  selectedLanguage,
  guideSettings,
  locationCoords,
  onSelectResultToView,
  onBackToHome,
}) => {
  const { t } = useLocalizedTexts(DISCOVER_UI_DEFAULTS, selectedLanguage, 'Global Discover search screen labels');

  const [query, setQuery] = useState('');
  const [submittedQuery, setSubmittedQuery] = useState('');
  const [candidates, setCandidates] = useState<DiscoverCandidate[]>([]);
  const [hasMore, setHasMore] = useState(false);
  const [sources, setSources] = useState<DiscoverSourceCitation[]>([]);
  const [isSearching, setIsSearching] = useState(false);
  const [isLoadingMore, setIsLoadingMore] = useState(false);
  const [explainingCandidateId, setExplainingCandidateId] = useState<string | null>(null);
  const [errorMsg, setErrorMsg] = useState<string | null>(null);

  const [isListeningVoice, setIsListeningVoice] = useState(false);
  const [voiceNotice, setVoiceNotice] = useState<string | null>(null);
  const recognitionRef = useRef<any>(null);

  // Part 3: Live Search Autocomplete state
  const [suggestions, setSuggestions] = useState<DiscoverAutocompleteSuggestion[]>([]);
  const [isLoadingSuggestions, setIsLoadingSuggestions] = useState(false);
  const [showSuggestions, setShowSuggestions] = useState(false);
  const [highlightedIdx, setHighlightedIdx] = useState(-1);
  const suppressNextAutocompleteRef = useRef(false);
  const userEditedQueryRef = useRef(false);
  const autocompleteAbortRef = useRef<AbortController | null>(null);
  const autocompleteSeqRef = useRef(0);
  const searchBoxWrapperRef = useRef<HTMLDivElement | null>(null);

  const [recentQueries, setRecentQueries] = useState<string[]>(() => {
    try {
      const raw = localStorage.getItem(RECENT_DISCOVER_KEY);
      const parsed = raw ? JSON.parse(raw) : [];
      return Array.isArray(parsed) ? parsed.slice(0, 6) : [];
    } catch {
      return [];
    }
  });

  const scrollRef = usePreservedScroll<HTMLDivElement>('tab:discover', isActive);

  useBackLayer(
    'discover-autocomplete',
    isActive && showSuggestions && suggestions.length > 0,
    () => {
      setShowSuggestions(false);
      setHighlightedIdx(-1);
    },
    42
  );

  useEffect(() => {
    if (!isActive && recognitionRef.current) {
      try {
        recognitionRef.current.stop();
      } catch {
        // ignore
      }
      setIsListeningVoice(false);
    }
    if (!isActive) {
      userEditedQueryRef.current = false;
      autocompleteSeqRef.current += 1;
      if (autocompleteAbortRef.current) {
        try {
          autocompleteAbortRef.current.abort();
        } catch {
          // ignore
        }
        autocompleteAbortRef.current = null;
      }
      setShowSuggestions(false);
      setIsLoadingSuggestions(false);
    }
  }, [isActive]);

  useEffect(() => {
    const handleOutside = (e: MouseEvent) => {
      if (searchBoxWrapperRef.current && !searchBoxWrapperRef.current.contains(e.target as Node)) {
        setShowSuggestions(false);
        setHighlightedIdx(-1);
      }
    };
    document.addEventListener('mousedown', handleOutside);
    return () => document.removeEventListener('mousedown', handleOutside);
  }, []);

  // Debounced (250ms) live autocomplete query (triggered only by user edits while Discover is active)
  useEffect(() => {
    const clean = query.trim();
    if (suppressNextAutocompleteRef.current) {
      suppressNextAutocompleteRef.current = false;
      return;
    }
    if (!isActive || clean.length < 2) {
      setSuggestions([]);
      setShowSuggestions(false);
      setIsLoadingSuggestions(false);
      setHighlightedIdx(-1);
      return;
    }
    if (!userEditedQueryRef.current) {
      return;
    }

    const reqSeq = ++autocompleteSeqRef.current;
    const controller = new AbortController();
    autocompleteAbortRef.current = controller;

    const timer = window.setTimeout(async () => {
      if (!userEditedQueryRef.current || reqSeq !== autocompleteSeqRef.current) return;
      setIsLoadingSuggestions(true);
      try {
        const res = await fetch('/api/discover/autocomplete', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          signal: controller.signal,
          body: JSON.stringify({
            query: clean,
            language: selectedLanguage.name,
            latitude: locationCoords?.latitude,
            longitude: locationCoords?.longitude,
          }),
        });
        const data = await res.json();
        if (
          !controller.signal.aborted &&
          reqSeq === autocompleteSeqRef.current &&
          userEditedQueryRef.current &&
          res.ok &&
          data.success
        ) {
          const list = Array.isArray(data.suggestions) ? data.suggestions : [];
          setSuggestions(list);
          setShowSuggestions(list.length > 0);
          setHighlightedIdx(-1);
        }
      } catch (err: any) {
        if (err?.name !== 'AbortError') {
          setSuggestions([]);
        }
      } finally {
        if (!controller.signal.aborted && reqSeq === autocompleteSeqRef.current) {
          setIsLoadingSuggestions(false);
        }
      }
    }, 250);

    return () => {
      window.clearTimeout(timer);
      controller.abort();
      if (autocompleteAbortRef.current === controller) {
        autocompleteAbortRef.current = null;
      }
    };
  }, [query, isActive, selectedLanguage.name, locationCoords?.latitude, locationCoords?.longitude]);

  useEffect(() => {
    return () => {
      if (recognitionRef.current) {
        try {
          recognitionRef.current.stop();
        } catch {
          // ignore
        }
      }
    };
  }, []);

  const recordRecentQuery = (q: string) => {
    const clean = q.trim();
    if (!clean) return;
    setRecentQueries((prev) => {
      const next = [clean, ...prev.filter((item) => item.toLowerCase() !== clean.toLowerCase())].slice(0, 6);
      try {
        localStorage.setItem(RECENT_DISCOVER_KEY, JSON.stringify(next));
      } catch {
        // ignore
      }
      return next;
    });
  };

  const runSearch = async (searchStr: string, offset: number = 0) => {
    const clean = searchStr.trim();
    if (clean.length < 2) {
      setErrorMsg(t.shortQueryError);
      return;
    }

    userEditedQueryRef.current = false;
    autocompleteSeqRef.current += 1;
    if (autocompleteAbortRef.current) {
      try {
        autocompleteAbortRef.current.abort();
      } catch {
        // ignore
      }
      autocompleteAbortRef.current = null;
    }
    setIsLoadingSuggestions(false);
    setErrorMsg(null);
    setVoiceNotice(null);
    setShowSuggestions(false);
    setHighlightedIdx(-1);
    if (offset === 0) {
      setIsSearching(true);
      setSubmittedQuery(clean);
      recordRecentQuery(clean);
    } else {
      setIsLoadingMore(true);
    }

    try {
      const res = await fetch('/api/discover/search', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          query: clean,
          language: selectedLanguage.name,
          offset,
          limit: 8,
          latitude: locationCoords?.latitude,
          longitude: locationCoords?.longitude,
        }),
      });
      const data = await res.json();
      if (!res.ok || !data.success) {
        throw new Error(data.error || 'Search temporarily unavailable.');
      }

      const incoming: DiscoverCandidate[] = Array.isArray(data.candidates) ? data.candidates : [];
      if (offset === 0) {
        setCandidates(incoming);
        setSources(Array.isArray(data.sources) ? data.sources : []);
      } else {
        setCandidates((prev) => {
          const seen = new Set(prev.map((c) => c.title.toLowerCase()));
          const deduped = incoming.filter((c) => !seen.has(c.title.toLowerCase()));
          return [...prev, ...deduped];
        });
      }
      setHasMore(Boolean(data.hasMore) && incoming.length > 0);
    } catch (err: any) {
      setErrorMsg(err?.message || 'Unable to complete search right now.');
    } finally {
      setIsSearching(false);
      setIsLoadingMore(false);
    }
  };

  const handleSelectCandidate = async (candidate: DiscoverCandidate) => {
    if (explainingCandidateId) return;
    userEditedQueryRef.current = false;
    autocompleteSeqRef.current += 1;
    if (autocompleteAbortRef.current) {
      try {
        autocompleteAbortRef.current.abort();
      } catch {
        // ignore
      }
      autocompleteAbortRef.current = null;
    }
    setIsLoadingSuggestions(false);
    setShowSuggestions(false);
    setHighlightedIdx(-1);
    setExplainingCandidateId(candidate.id);
    setErrorMsg(null);

    try {
      const res = await fetch('/api/discover/explain', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          candidate,
          level: 'standard',
          language: selectedLanguage.name,
          guideSettings,
        }),
      });
      const data = await res.json();
      if (!res.ok || !data.success || !data.landmark) {
        throw new Error(data.error || 'Could not load subject explanation.');
      }
      onSelectResultToView(data.landmark as RecognitionResult);
    } catch (err: any) {
      setErrorMsg(err?.message || 'Failed to generate complete explanation.');
    } finally {
      setExplainingCandidateId(null);
    }
  };

  const handleSelectAutocompleteSuggestion = (sugg: DiscoverAutocompleteSuggestion) => {
    suppressNextAutocompleteRef.current = true;
    userEditedQueryRef.current = false;
    autocompleteSeqRef.current += 1;
    if (autocompleteAbortRef.current) {
      try {
        autocompleteAbortRef.current.abort();
      } catch {
        // ignore
      }
      autocompleteAbortRef.current = null;
    }
    setIsLoadingSuggestions(false);
    setQuery(sugg.title);
    recordRecentQuery(sugg.title);
    setShowSuggestions(false);
    setHighlightedIdx(-1);
    handleSelectCandidate(sugg.candidate);
  };

  const handleToggleVoiceSearch = () => {
    setVoiceNotice(null);
    if (isListeningVoice && recognitionRef.current) {
      try {
        recognitionRef.current.stop();
      } catch {
        // ignore
      }
      setIsListeningVoice(false);
      return;
    }

    const SpeechRec =
      (window as any).SpeechRecognition || (window as any).webkitSpeechRecognition;
    if (!SpeechRec) {
      setVoiceNotice(t.voiceUnsupported);
      return;
    }

    try {
      const rec = new SpeechRec();
      rec.lang = selectedLanguage.speechCode || 'en-US';
      rec.interimResults = false;
      rec.maxAlternatives = 1;

      rec.onresult = (event: any) => {
        const transcript = event?.results?.[0]?.[0]?.transcript?.trim();
        if (transcript) {
          setQuery(transcript);
          runSearch(transcript, 0);
        }
      };
      rec.onerror = () => {
        setVoiceNotice(t.voiceDenied);
        setIsListeningVoice(false);
      };
      rec.onend = () => {
        setIsListeningVoice(false);
      };

      recognitionRef.current = rec;
      setIsListeningVoice(true);
      rec.start();
    } catch {
      setIsListeningVoice(false);
      setVoiceNotice(t.voiceUnsupported);
    }
  };

  return (
    <div
      id="discover-screen"
      dir={selectedLanguage.direction === 'rtl' ? 'rtl' : 'ltr'}
      className="h-full flex flex-col overflow-hidden overflow-clip py-1.5 space-y-2 select-none"
    >
      {/* Top Bar */}
      <div
        style={{
          backgroundColor: 'var(--theme-card-bg)',
          borderColor: 'var(--theme-card-border)',
        }}
        className="shrink-0 flex items-center justify-between gap-2 p-2.5 rounded-2xl border shadow-sm backdrop-blur-md"
      >
        <div className="flex items-center gap-2 min-w-0">
          <BackButton
            id="btn-discover-back"
            onClick={onBackToHome}
            selectedLanguage={selectedLanguage}
            compact
          />
          <div className="min-w-0">
            <h2 className="text-sm sm:text-base font-serif font-bold text-[var(--theme-text-title)] truncate flex items-center gap-1.5">
              <Compass className="w-4 h-4 text-[var(--theme-accent-primary)] shrink-0" />
              <span>{t.title}</span>
            </h2>
            <p className="text-[10.5px] text-[var(--theme-text-muted)] truncate hidden sm:block">
              {t.subtitle}
            </p>
          </div>
        </div>

        <span className="hidden xs:inline-flex items-center gap-1 px-2.5 py-1 rounded-full text-[10px] font-bold theme-badge-teal shrink-0">
          <Globe className="w-3 h-3 shrink-0" />
          <span>{t.globalReadyBadge}</span>
        </span>
      </div>

      {/* Search Bar & Voice Input */}
      <div
        ref={searchBoxWrapperRef}
        style={{
          backgroundColor: 'var(--theme-card-bg)',
          borderColor: 'var(--theme-card-border)',
        }}
        className="shrink-0 relative z-20 p-3 rounded-2xl border shadow-md space-y-2.5 backdrop-blur-md"
      >
        <form
          onSubmit={(e) => {
            e.preventDefault();
            if (showSuggestions && highlightedIdx >= 0 && suggestions[highlightedIdx]) {
              handleSelectAutocompleteSuggestion(suggestions[highlightedIdx]);
              return;
            }
            setShowSuggestions(false);
            runSearch(query, 0);
          }}
          className="flex items-center gap-2 relative"
        >
          <div className="relative flex-1 min-w-0">
            <Search className="w-4 h-4 absolute left-3 top-1/2 -translate-y-1/2 text-[var(--theme-accent-primary)]" />
            <input
              id="input-discover-query"
              type="text"
              autoComplete="off"
              aria-autocomplete="list"
              aria-expanded={showSuggestions && suggestions.length > 0}
              value={query}
              onFocus={() => {
                if (
                  userEditedQueryRef.current &&
                  suggestions.length > 0 &&
                  query.trim().length >= 2 &&
                  !isSearching &&
                  !explainingCandidateId
                ) {
                  setShowSuggestions(true);
                }
              }}
              onChange={(e) => {
                userEditedQueryRef.current = true;
                setQuery(e.target.value);
              }}
              onKeyDown={(e) => {
                if (!showSuggestions || suggestions.length === 0) return;
                if (e.key === 'ArrowDown') {
                  e.preventDefault();
                  setHighlightedIdx((prev) => (prev + 1) % suggestions.length);
                } else if (e.key === 'ArrowUp') {
                  e.preventDefault();
                  setHighlightedIdx((prev) => (prev <= 0 ? suggestions.length - 1 : prev - 1));
                } else if (e.key === 'Escape') {
                  setShowSuggestions(false);
                  setHighlightedIdx(-1);
                }
              }}
              placeholder={t.searchPlaceholder}
              className="theme-input w-full pl-9 pr-9 py-2.5 text-xs sm:text-sm min-h-[44px]"
            />
            {(isLoadingSuggestions || query.length > 0) && (
              <div className="absolute right-2.5 top-1/2 -translate-y-1/2 flex items-center gap-1">
                {isLoadingSuggestions && (
                  <Loader2 className="w-3.5 h-3.5 animate-spin text-[var(--theme-accent-primary)]" />
                )}
                {query.length > 0 && (
                  <button
                    type="button"
                    onClick={() => {
                      setQuery('');
                      setSuggestions([]);
                      setShowSuggestions(false);
                    }}
                    aria-label="Clear search query"
                    className="p-0.5 rounded-full text-[var(--theme-text-muted)] hover:text-[var(--theme-text-title)] cursor-pointer"
                  >
                    <X className="w-3.5 h-3.5" />
                  </button>
                )}
              </div>
            )}
          </div>

          <button
            id="btn-discover-voice"
            type="button"
            onClick={handleToggleVoiceSearch}
            style={
              isListeningVoice
                ? {
                    backgroundColor: '#e11d48',
                    color: '#ffffff',
                    borderColor: '#fda4af',
                  }
                : {
                    backgroundColor: 'var(--theme-card-bg-subtle)',
                    borderColor: 'var(--theme-card-border)',
                    color: 'var(--theme-accent-secondary)',
                  }
            }
            className="min-w-[44px] min-h-[44px] px-2.5 rounded-xl border flex items-center justify-center cursor-pointer transition-all shrink-0"
            title={isListeningVoice ? t.voiceStopTitle : t.voiceStartTitle}
            aria-label={isListeningVoice ? t.voiceStopTitle : t.voiceStartTitle}
          >
            {isListeningVoice ? <MicOff className="w-4 h-4" /> : <Mic className="w-4 h-4" />}
          </button>

          <button
            id="btn-discover-search"
            type="submit"
            disabled={isSearching}
            className="min-h-[44px] px-4 rounded-xl theme-btn-primary text-xs sm:text-sm font-bold flex items-center gap-1.5 cursor-pointer shrink-0 disabled:opacity-60"
          >
            {isSearching ? (
              <Loader2 className="w-4 h-4 animate-spin" />
            ) : (
              <Sparkles className="w-4 h-4" />
            )}
            <span>{isSearching ? t.searchingBtn : t.searchBtn}</span>
          </button>

          {/* Part 3: Live Search Autocomplete Dropdown */}
          {showSuggestions && suggestions.length > 0 && (
            <div
              id="discover-autocomplete-dropdown"
              role="listbox"
              style={{
                backgroundColor: 'var(--theme-header-bg)',
                borderColor: 'var(--theme-card-border-glow)',
              }}
              className="absolute left-0 right-0 top-full mt-1.5 z-30 rounded-2xl border shadow-2xl backdrop-blur-xl overflow-hidden max-h-80 overflow-y-auto divide-y divide-[var(--theme-card-border)]"
            >
              {suggestions.map((sugg, idx) => {
                const isActiveRow = idx === highlightedIdx;
                return (
                  <button
                    key={sugg.id}
                    type="button"
                    role="option"
                    aria-selected={isActiveRow}
                    onMouseEnter={() => setHighlightedIdx(idx)}
                    onClick={() => handleSelectAutocompleteSuggestion(sugg)}
                    style={{
                      backgroundColor: isActiveRow ? 'var(--theme-card-hover)' : 'transparent',
                    }}
                    className="w-full px-3.5 py-2.5 text-left hover:bg-[var(--theme-card-hover)] transition-colors flex items-start justify-between gap-2.5 cursor-pointer"
                  >
                    <div className="min-w-0 flex-1 space-y-0.5">
                      <div className="flex items-center gap-1.5 flex-wrap">
                        <span className="px-1.5 py-0.5 rounded text-[9px] font-bold uppercase tracking-wider theme-badge-gold shrink-0">
                          {sugg.category}
                        </span>
                        <span className="text-xs sm:text-sm font-serif font-bold text-[var(--theme-text-title)] truncate">
                          {sugg.title}
                        </span>
                        {sugg.nativeTitle && sugg.nativeTitle !== sugg.title && (
                          <span className="text-[11px] text-[var(--theme-text-muted)] truncate">
                            ({sugg.nativeTitle})
                          </span>
                        )}
                      </div>
                      <div className="flex items-center gap-2 text-[11px] text-[var(--theme-accent-secondary)] font-medium">
                        <MapPin className="w-3 h-3 shrink-0" />
                        <span className="truncate">{sugg.locationOrOrigin}</span>
                      </div>
                      {sugg.subtitle && (
                        <p className="text-[11px] text-[var(--theme-text-muted)] line-clamp-1">
                          {sugg.subtitle}
                        </p>
                      )}
                    </div>
                    <ArrowRight className="w-4 h-4 text-[var(--theme-accent-primary)] shrink-0 mt-1" />
                  </button>
                );
              })}
            </div>
          )}
        </form>

        {voiceNotice && (
          <div className="text-[11px] text-[var(--theme-accent-primary)] font-medium flex items-center gap-1.5">
            <AlertCircle className="w-3.5 h-3.5 shrink-0" />
            <span>{voiceNotice}</span>
          </div>
        )}

        {errorMsg && (
          <div className="text-xs text-rose-500 font-semibold flex items-center gap-1.5">
            <AlertCircle className="w-3.5 h-3.5 shrink-0" />
            <span>{errorMsg}</span>
          </div>
        )}

        {/* Quick Clue & Recent Chips */}
        <div className="space-y-1.5">
          <div className="flex items-center gap-1.5 overflow-x-auto pb-0.5 scrollbar-none">
            <span className="text-[10px] font-bold uppercase tracking-wider text-[var(--theme-text-muted)] shrink-0">
              {t.sampleCluesLabel}
            </span>
            {SAMPLE_CLUES.map((sample) => (
              <button
                key={sample}
                type="button"
                onClick={() => {
                  setQuery(sample);
                  runSearch(sample, 0);
                }}
                style={{
                  backgroundColor: 'var(--theme-card-bg-subtle)',
                  borderColor: 'var(--theme-card-border)',
                  color: 'var(--theme-text-body)',
                }}
                className="px-2.5 py-1 rounded-lg border text-[11px] font-medium whitespace-nowrap cursor-pointer hover:border-[var(--theme-card-border-glow)] transition-colors shrink-0"
              >
                {sample}
              </button>
            ))}
          </div>

          {recentQueries.length > 0 && (
            <div className="flex items-center gap-1.5 overflow-x-auto pb-0.5 scrollbar-none">
              <span className="text-[10px] font-bold uppercase tracking-wider text-[var(--theme-accent-secondary)] shrink-0">
                {t.recentSearchesLabel}
              </span>
              {recentQueries.map((rq) => (
                <button
                  key={rq}
                  type="button"
                  onClick={() => {
                    setQuery(rq);
                    runSearch(rq, 0);
                  }}
                  style={{
                    backgroundColor: 'var(--theme-card-bg-subtle)',
                    borderColor: 'var(--theme-card-border)',
                    color: 'var(--theme-text-title)',
                  }}
                  className="px-2 py-0.5 rounded-lg border text-[10.5px] font-semibold whitespace-nowrap cursor-pointer hover:border-[var(--theme-accent-secondary)] shrink-0"
                >
                  {rq}
                </button>
              ))}
            </div>
          )}
        </div>
      </div>

      {/* Results Stage (Two-Step: Related Search Candidates -> Select One -> Full Explanation) */}
      <div ref={scrollRef} className="flex-1 min-h-0 overflow-y-auto space-y-2.5 pr-0.5">
        {/* Explaining Loading Banner */}
        {explainingCandidateId && (
          <div
            style={{
              backgroundColor: 'var(--theme-card-bg)',
              borderColor: 'var(--theme-accent-primary)',
            }}
            className="p-3 rounded-2xl border flex items-center gap-2.5 text-xs font-semibold text-[var(--theme-text-title)] shadow-md"
          >
            <Loader2 className="w-4 h-4 animate-spin text-[var(--theme-accent-primary)] shrink-0" />
            <span>
              {t.loadingExplanation} <strong>{selectedLanguage.nativeName}</strong>...
            </span>
          </div>
        )}

        {isSearching ? (
          <div className="grid grid-cols-1 md:grid-cols-2 gap-3 animate-pulse">
            {[1, 2, 3, 4].map((i) => (
              <div
                key={i}
                style={{
                  backgroundColor: 'var(--theme-card-bg)',
                  borderColor: 'var(--theme-card-border)',
                }}
                className="p-3.5 rounded-2xl border space-y-2.5"
              >
                <div className="flex items-start gap-3">
                  <div
                    style={{ backgroundColor: 'var(--theme-card-bg-subtle)' }}
                    className="w-20 h-20 rounded-xl shrink-0"
                  />
                  <div className="flex-1 space-y-2">
                    <div style={{ backgroundColor: 'var(--theme-card-bg-subtle)' }} className="h-4 rounded w-3/4" />
                    <div style={{ backgroundColor: 'var(--theme-card-bg-subtle)' }} className="h-3 rounded w-1/2" />
                    <div style={{ backgroundColor: 'var(--theme-card-bg-subtle)' }} className="h-3 rounded w-full" />
                  </div>
                </div>
              </div>
            ))}
          </div>
        ) : candidates.length > 0 ? (
          <>
            {/* Step 1 Banner */}
            <div
              style={{
                backgroundColor: 'var(--theme-card-bg-subtle)',
                borderColor: 'var(--theme-card-border)',
              }}
              className="p-2.5 rounded-xl border flex items-center justify-between gap-2 flex-wrap text-xs"
            >
              <span className="font-semibold text-[var(--theme-text-title)] flex items-center gap-1.5">
                <BookOpen className="w-3.5 h-3.5 text-[var(--theme-accent-primary)] shrink-0" />
                <span>{t.stepOneBanner}</span>
              </span>
              <span className="text-[11px] font-bold text-[var(--theme-accent-secondary)]">
                {candidates.length} {t.resultsCountSuffix}
              </span>
            </div>

            {/* Candidate Cards Grid */}
            <div className="grid grid-cols-1 md:grid-cols-2 gap-3">
              {candidates.map((cand) => {
                const isOpeningThis = explainingCandidateId === cand.id;
                return (
                  <div
                    key={cand.id}
                    id={`discover-card-${cand.id}`}
                    role="button"
                    tabIndex={0}
                    onClick={() => handleSelectCandidate(cand)}
                    onKeyDown={(e) => {
                      if (e.key === 'Enter' || e.key === ' ') {
                        e.preventDefault();
                        handleSelectCandidate(cand);
                      }
                    }}
                    style={{
                      backgroundColor: 'var(--theme-card-bg)',
                      borderColor: isOpeningThis
                        ? 'var(--theme-accent-primary)'
                        : 'var(--theme-card-border)',
                    }}
                    className="p-3 rounded-2xl border hover:border-[var(--theme-card-border-glow)] transition-all shadow-md cursor-pointer flex flex-col justify-between gap-2.5 backdrop-blur-md"
                  >
                    <div className="flex items-start gap-3">
                      <PlaceCardImage
                        placeName={cand.wikipediaTitle || cand.title}
                        displayTitle={cand.title}
                        placeId={cand.placeId}
                        initialImageUrl={cand.imageUrl}
                        authorAttributions={
                          cand.imageAttribution
                            ? [{ displayName: cand.imageAttribution, uri: cand.imageSourceUrl }]
                            : undefined
                        }
                        category={cand.category}
                        cityName={cand.locationOrOrigin}
                        size="md"
                      />

                      <div className="min-w-0 flex-1 space-y-1">
                        <div className="flex items-center gap-1.5 flex-wrap">
                          <span className="px-2 py-0.5 rounded-md text-[9.5px] font-bold uppercase tracking-wider theme-badge-gold">
                            {cand.category}
                          </span>
                          <span
                            className={`px-2 py-0.5 rounded-md text-[9.5px] font-bold ${
                              cand.sourceType === 'ai_suggested'
                                ? 'border border-[var(--theme-card-border)] text-[var(--theme-text-muted)]'
                                : 'theme-badge-teal'
                            }`}
                          >
                            {cand.certaintyLabel}
                          </span>
                          {cand.isExampleImage && cand.imageUrl && (
                            <span className="px-1.5 py-0.5 rounded text-[9px] font-semibold border border-[var(--theme-card-border)] text-[var(--theme-text-muted)]">
                              {t.exampleBadge}
                            </span>
                          )}
                        </div>

                        <h3 className="text-sm sm:text-base font-serif font-bold text-[var(--theme-text-title)] leading-snug">
                          {cand.title}
                          {cand.nativeTitle && cand.nativeTitle !== cand.title && (
                            <span className="text-xs font-sans font-normal text-[var(--theme-text-muted)] ml-1.5">
                              ({cand.nativeTitle})
                            </span>
                          )}
                        </h3>

                        <div className="flex items-center gap-2 flex-wrap text-[11px] text-[var(--theme-accent-secondary)] font-medium">
                          {cand.locationOrOrigin && (
                            <span className="flex items-center gap-1 truncate max-w-[220px]">
                              <MapPin className="w-3 h-3 shrink-0" />
                              <span className="truncate">{cand.locationOrOrigin}</span>
                            </span>
                          )}
                          {cand.historicalPeriod && (
                            <span className="flex items-center gap-1 text-[var(--theme-text-muted)]">
                              <Clock className="w-3 h-3 shrink-0" />
                              <span>{cand.historicalPeriod}</span>
                            </span>
                          )}
                        </div>

                        <p className="text-xs text-[var(--theme-text-body)] line-clamp-2 leading-relaxed">
                          {cand.shortDescription}
                        </p>

                        {cand.alternativeNames && cand.alternativeNames.length > 0 && (
                          <p className="text-[10.5px] text-[var(--theme-text-muted)] truncate">
                            {cand.alternativeNames.join(' · ')}
                          </p>
                        )}
                      </div>
                    </div>

                    <div
                      style={{ borderColor: 'var(--theme-card-border)' }}
                      className="pt-2 border-t flex items-center justify-between gap-2"
                    >
                      <span className="text-[10.5px] text-[var(--theme-text-muted)] truncate flex-1">
                        {cand.matchReason || cand.imageAttribution || ''}
                      </span>
                      <span className="px-3 py-1.5 rounded-xl theme-btn-primary text-xs font-bold inline-flex items-center gap-1.5 shrink-0">
                        {isOpeningThis ? (
                          <Loader2 className="w-3.5 h-3.5 animate-spin" />
                        ) : (
                          <ArrowRight className="w-3.5 h-3.5" />
                        )}
                        <span>{t.openGuideBtn}</span>
                      </span>
                    </div>
                  </div>
                );
              })}
            </div>

            {/* Pagination: Load More Results */}
            {hasMore && (
              <div className="flex justify-center pt-1 pb-2">
                <button
                  id="btn-discover-load-more"
                  type="button"
                  disabled={isLoadingMore}
                  onClick={() => runSearch(submittedQuery, candidates.length)}
                  className="px-5 py-2.5 rounded-xl theme-btn-secondary text-xs font-bold flex items-center gap-1.5 cursor-pointer min-h-[44px]"
                >
                  {isLoadingMore ? (
                    <Loader2 className="w-4 h-4 animate-spin text-[var(--theme-accent-primary)]" />
                  ) : (
                    <Plus className="w-4 h-4 text-[var(--theme-accent-primary)]" />
                  )}
                  <span>{isLoadingMore ? t.loadingMoreBtn : t.loadMoreBtn}</span>
                </button>
              </div>
            )}

            {/* Search Grounding Sources */}
            {sources.length > 0 && (
              <div
                style={{
                  backgroundColor: 'var(--theme-card-bg-subtle)',
                  borderColor: 'var(--theme-card-border)',
                }}
                className="p-2.5 rounded-xl border space-y-1"
              >
                <span className="text-[10px] font-bold uppercase tracking-wider text-[var(--theme-text-muted)] block">
                  {t.sourcesLabel}
                </span>
                <div className="flex flex-wrap gap-1.5">
                  {sources.map((src, idx) =>
                    src.url ? (
                      <a
                        key={idx}
                        href={src.url}
                        target="_blank"
                        rel="noopener noreferrer"
                        className="text-[11px] px-2 py-1 rounded-lg theme-btn-secondary inline-flex items-center gap-1"
                      >
                        <span className="truncate max-w-[200px]">{src.title}</span>
                        <ExternalLink className="w-2.5 h-2.5 shrink-0" />
                      </a>
                    ) : null
                  )}
                </div>
              </div>
            )}
          </>
        ) : submittedQuery ? (
          <div
            style={{
              backgroundColor: 'var(--theme-card-bg)',
              borderColor: 'var(--theme-card-border)',
            }}
            className="p-8 rounded-2xl border text-center space-y-2"
          >
            <Compass className="w-9 h-9 text-[var(--theme-accent-primary)] mx-auto" />
            <h3 className="text-sm font-serif font-bold text-[var(--theme-text-title)]">
              {t.noResultsTitle}
            </h3>
            <p className="text-xs text-[var(--theme-text-muted)] max-w-md mx-auto">
              {t.noResultsBody}
            </p>
          </div>
        ) : (
          <div
            style={{
              backgroundColor: 'var(--theme-card-bg)',
              borderColor: 'var(--theme-card-border)',
            }}
            className="p-6 sm:p-8 rounded-2xl border text-center space-y-3"
          >
            <div className="w-12 h-12 rounded-2xl theme-badge-gold flex items-center justify-center mx-auto">
              <Sparkles className="w-6 h-6 text-[var(--theme-accent-primary)]" />
            </div>
            <h3 className="text-base font-serif font-bold text-[var(--theme-text-title)]">
              {t.title}
            </h3>
            <p className="text-xs sm:text-sm text-[var(--theme-text-muted)] max-w-lg mx-auto leading-relaxed">
              {t.subtitle}
            </p>
          </div>
        )}
      </div>
    </div>
  );
};
