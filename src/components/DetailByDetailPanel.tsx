import React, { useState, useRef, useEffect } from 'react';
import {
  CertaintyStatus,
  DetailComponent,
  DiscoverSourceCitation,
  GuideSettings,
  InscriptionAnalysis,
  Language,
} from '../types';
import { speechManager } from '../utils/speech';
import { AudioSpeedControl } from './AudioSpeedControl';
import { useLocalizedTexts } from '../data/localizedStrings';
import {
  Crosshair,
  Eye,
  HelpCircle,
  Loader2,
  Play,
  Pause,
  Send,
  ShieldAlert,
  Sparkles,
  CheckCircle2,
  BookOpen,
  ExternalLink,
  Search,
  Layers,
} from 'lucide-react';

interface DetailByDetailPanelProps {
  subjectTitle: string;
  category?: string;
  locationOrOrigin?: string;
  imageUrl?: string;
  imageSourceUrl?: string;
  imageAttribution?: string;
  isExampleImage?: boolean;
  initialComponents?: DetailComponent[];
  initialInscription?: InscriptionAnalysis;
  selectedLanguage: Language;
  guideSettings?: GuideSettings;
  onUpdateSpeechRate?: (rate: number) => void;
  onComponentsUpdated?: (components: DetailComponent[], inscription?: InscriptionAnalysis) => void;
}

const DETAIL_UI_DEFAULTS = {
  title: 'Detail by Detail Visual & Symbolic Explorer',
  subtitle:
    'Inspect individual sculptural features, architectural stonework, iconography, and inscriptions component by component.',
  tapPhotoHint: 'Tap any spot on the photograph to inspect that visual region (coordinate inspection, no synthetic masks)',
  tappedRegionLabel: 'Inspected Visual Region',
  askPlaceholder: 'Ask about a posture, mudra, carving, ornament, inscription, or material...',
  askBtn: 'Ask Detail',
  analyzeBtn: 'Analyze All Details',
  refreshBtn: 'Refresh Breakdown',
  loadingAnalysis: 'Examining fine visual & historical details...',
  speakAnswer: 'Speak Answer',
  pauseAnswer: 'Pause Audio',
  inscriptionHeading: 'Epigraphic & Inscription Analysis',
  scriptLabel: 'Script',
  confirmedReadingLabel: 'Confirmed Reading',
  transliterationLabel: 'Approximate Transliteration',
  translationLabel: 'Translation',
  uncertaintyLabel: 'Caution & Uncertainty Note',
  noComponentsYet: 'Tap "Analyze All Details" or tap any point on the photograph to inspect individual features.',
  visualCueLabel: 'What to Look For',
  meaningLabel: 'Meaning & Significance',
  craftLabel: 'Material & Craft',
  askThisPart: 'Inspect this detail deeper',
  quickChipPosture: 'Explain posture & hand gestures',
  quickChipOrnaments: 'Crown, halo & ornaments',
  quickChipInscription: 'Read or explain any inscriptions',
  quickChipCraft: 'Construction / casting technique',
  sourcesLabel: 'Reference Sources',
  certEstablished: 'Established Fact',
  certTraditional: 'Traditional Interpretation',
  certPossible: 'Possible Identification',
  certUnknown: 'Unknown / Unverified',
  examplePhotoBadge: 'Reference / Similar Example',
};

function unwrapExternalImageUrl(url?: string, fallbackSourceUrl?: string): { imageBase64?: string; imageUrl?: string } {
  if (url && url.startsWith('data:image/')) {
    return { imageBase64: url };
  }
  if (url && url.startsWith('/api/places/proxy-image?')) {
    try {
      const qIdx = url.indexOf('url=');
      if (qIdx !== -1) {
        const rawParam = url.slice(qIdx + 4).split('&')[0];
        const decoded = decodeURIComponent(rawParam);
        if (/^https:\/\//i.test(decoded)) {
          return { imageUrl: decoded };
        }
      }
    } catch {
      // ignore
    }
  }
  if (url && /^https:\/\//i.test(url)) {
    return { imageUrl: url };
  }
  if (fallbackSourceUrl && /^https:\/\/upload\.wikimedia\.org\//i.test(fallbackSourceUrl)) {
    return { imageUrl: fallbackSourceUrl };
  }
  return {};
}

export function CertaintyBadge({
  certainty,
  labels,
}: {
  certainty: CertaintyStatus;
  labels?: {
    established: string;
    traditional: string;
    possible: string;
    unknown: string;
  };
}) {
  const map: Record<CertaintyStatus, { text: string; badgeClass: string }> = {
    established_fact: {
      text: labels?.established || 'Established Fact',
      badgeClass: 'theme-badge-teal',
    },
    traditional_interpretation: {
      text: labels?.traditional || 'Traditional Interpretation',
      badgeClass: 'theme-badge-gold',
    },
    possible_identification: {
      text: labels?.possible || 'Possible Identification',
      badgeClass: 'theme-badge-gold',
    },
    unknown: {
      text: labels?.unknown || 'Unknown / Unverified',
      badgeClass: 'border border-[var(--theme-card-border)] text-[var(--theme-text-muted)]',
    },
  };
  const cfg = map[certainty] || map.possible_identification;

  return (
    <span className={`inline-flex items-center gap-1 px-2 py-0.5 rounded-md text-[10px] font-bold ${cfg.badgeClass}`}>
      {certainty === 'established_fact' ? (
        <CheckCircle2 className="w-2.5 h-2.5 shrink-0" />
      ) : certainty === 'unknown' ? (
        <ShieldAlert className="w-2.5 h-2.5 shrink-0" />
      ) : (
        <BookOpen className="w-2.5 h-2.5 shrink-0" />
      )}
      <span>{cfg.text}</span>
    </span>
  );
}

export const DetailByDetailPanel: React.FC<DetailByDetailPanelProps> = ({
  subjectTitle,
  category,
  locationOrOrigin,
  imageUrl,
  imageSourceUrl,
  imageAttribution,
  isExampleImage,
  initialComponents = [],
  initialInscription,
  selectedLanguage,
  guideSettings,
  onComponentsUpdated,
  onUpdateSpeechRate,
}) => {
  const { t } = useLocalizedTexts(DETAIL_UI_DEFAULTS, selectedLanguage, 'Detail by Detail visual inspector labels');

  const [components, setComponents] = useState<DetailComponent[]>(initialComponents);
  const [inscription, setInscription] = useState<InscriptionAnalysis | undefined>(initialInscription);
  const [selectedComponentId, setSelectedComponentId] = useState<string | null>(
    initialComponents[0]?.id || null
  );
  const [tapCoords, setTapCoords] = useState<{ x: number; y: number } | null>(null);
  const [questionInput, setQuestionInput] = useState('');
  const [isAnalyzing, setIsAnalyzing] = useState(false);
  const [analysisError, setAnalysisError] = useState<string | null>(null);
  const [answerText, setAnswerText] = useState<string | null>(null);
  const [answerCertainty, setAnswerCertainty] = useState<CertaintyStatus>('possible_identification');
  const [highlightedPartName, setHighlightedPartName] = useState<string | null>(null);
  const [sources, setSources] = useState<DiscoverSourceCitation[]>([]);
  const [isPlayingAnswer, setIsPlayingAnswer] = useState(false);
  const [hasImageError, setHasImageError] = useState(false);
  const autoRequestedRef = useRef<string>('');

  useEffect(() => {
    setComponents(initialComponents);
    if (initialComponents.length > 0 && !selectedComponentId) {
      setSelectedComponentId(initialComponents[0].id);
    }
  }, [initialComponents]);

  useEffect(() => {
    setInscription(initialInscription);
  }, [initialInscription]);

  // Stop speech when leaving subject
  useEffect(() => {
    return () => {
      speechManager.stop();
      setIsPlayingAnswer(false);
    };
  }, [subjectTitle]);

  const runDetailAnalysis = async (opts: {
    question?: string;
    coords?: { x: number; y: number };
  }) => {
    setIsAnalyzing(true);
    setAnalysisError(null);
    speechManager.stop();
    setIsPlayingAnswer(false);

    try {
      const resolvedImg = unwrapExternalImageUrl(imageUrl, imageSourceUrl);
      const res = await fetch('/api/discover/detail-by-detail', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          subjectTitle,
          category,
          locationOrOrigin,
          language: selectedLanguage.name,
          guideSettings,
          question: opts.question || '',
          tapCoords: opts.coords,
          ...resolvedImg,
          existingComponents: components,
        }),
      });
      const data = await res.json();
      if (!res.ok || !data.success) {
        throw new Error(data.error || 'Could not inspect details right now.');
      }

      if (Array.isArray(data.components) && data.components.length > 0) {
        setComponents(data.components);
        if (!selectedComponentId) {
          setSelectedComponentId(data.components[0].id);
        }
      }
      if (data.inscription?.detected) {
        setInscription(data.inscription);
      }
      if (data.answer) {
        setAnswerText(data.answer);
        setAnswerCertainty(data.answerCertainty || 'possible_identification');
        setHighlightedPartName(data.highlightedPartName || null);
      }
      if (Array.isArray(data.sources)) {
        setSources(data.sources);
      }

      onComponentsUpdated?.(
        Array.isArray(data.components) && data.components.length > 0 ? data.components : components,
        data.inscription?.detected ? data.inscription : inscription
      );
    } catch (err: any) {
      setAnalysisError(err?.message || 'Detail analysis failed.');
    } finally {
      setIsAnalyzing(false);
    }
  };

  // Auto-populate component breakdown if subject came from Map/History with 0 detail components
  useEffect(() => {
    const key = `${subjectTitle}::${selectedLanguage.code}`;
    if (initialComponents.length === 0 && autoRequestedRef.current !== key) {
      autoRequestedRef.current = key;
      runDetailAnalysis({});
    }
  }, [subjectTitle, selectedLanguage.code, initialComponents.length]);

  const handleImageTap = (e: React.MouseEvent<HTMLDivElement>) => {
    const rect = e.currentTarget.getBoundingClientRect();
    if (!rect.width || !rect.height) return;
    const x = Math.max(0, Math.min(1, (e.clientX - rect.left) / rect.width));
    const y = Math.max(0, Math.min(1, (e.clientY - rect.top) / rect.height));
    setTapCoords({ x, y });
    runDetailAnalysis({
      coords: { x, y },
      question: questionInput.trim() || undefined,
    });
  };

  const handleAskSubmit = (e: React.FormEvent) => {
    e.preventDefault();
    const q = questionInput.trim();
    if (!q) return;
    runDetailAnalysis({ question: q, coords: tapCoords || undefined });
  };

  const handleToggleSpeakAnswer = () => {
    if (!answerText) return;
    if (isPlayingAnswer) {
      speechManager.stop();
      setIsPlayingAnswer(false);
      return;
    }
    speechManager.speak({
      text: answerText,
      language: selectedLanguage.name,
      languageCode: selectedLanguage.speechCode,
      rate: guideSettings?.speechRate || 1.0,
      pitch: guideSettings?.voicePitch,
      gender: guideSettings?.voiceGender || 'female',
      onStart: () => setIsPlayingAnswer(true),
      onEnd: () => setIsPlayingAnswer(false),
      onError: () => setIsPlayingAnswer(false),
    });
  };

  const certaintyLabels = {
    established: t.certEstablished,
    traditional: t.certTraditional,
    possible: t.certPossible,
    unknown: t.certUnknown,
  };

  return (
    <div className="space-y-3.5" dir={selectedLanguage.direction === 'rtl' ? 'rtl' : 'ltr'}>
      {/* Section Header */}
      <div className="flex items-start justify-between gap-2 flex-wrap">
        <div className="space-y-0.5 min-w-0 flex-1">
          <h4 className="text-xs sm:text-sm font-serif font-bold text-[var(--theme-accent-primary)] flex items-center gap-1.5">
            <Eye className="w-4 h-4 shrink-0" />
            <span>{t.title}</span>
          </h4>
          <p className="text-[11px] text-[var(--theme-text-muted)] leading-snug">{t.subtitle}</p>
        </div>

        <button
          type="button"
          onClick={() => runDetailAnalysis({})}
          disabled={isAnalyzing}
          className="px-2.5 py-1.5 rounded-xl theme-btn-secondary text-[11px] font-bold flex items-center gap-1.5 cursor-pointer shrink-0 min-h-[36px]"
        >
          {isAnalyzing ? (
            <Loader2 className="w-3.5 h-3.5 animate-spin text-[var(--theme-accent-primary)]" />
          ) : (
            <Sparkles className="w-3.5 h-3.5 text-[var(--theme-accent-primary)]" />
          )}
          <span>{components.length > 0 ? t.refreshBtn : t.analyzeBtn}</span>
        </button>
      </div>

      {/* Interactive Photo Tap Inspector (when photo exists) */}
      {imageUrl && !hasImageError && (
        <div
          style={{
            backgroundColor: 'var(--theme-card-bg-subtle)',
            borderColor: 'var(--theme-card-border)',
          }}
          className="p-2.5 rounded-2xl border space-y-2"
        >
          <div className="flex items-center justify-between gap-2 flex-wrap text-[11px]">
            <span className="text-[var(--theme-text-body)] font-semibold flex items-center gap-1.5">
              <Crosshair className="w-3.5 h-3.5 text-[var(--theme-accent-secondary)] shrink-0" />
              <span>{t.tapPhotoHint}</span>
            </span>
            {isExampleImage && (
              <span className="px-2 py-0.5 rounded-md text-[10px] font-bold theme-badge-gold">
                {t.examplePhotoBadge}
              </span>
            )}
          </div>

          <div
            role="button"
            tabIndex={0}
            aria-label={t.tapPhotoHint}
            onClick={handleImageTap}
            onKeyDown={(e) => {
              if (e.key === 'Enter' || e.key === ' ') {
                e.preventDefault();
                setTapCoords({ x: 0.5, y: 0.5 });
                runDetailAnalysis({ coords: { x: 0.5, y: 0.5 } });
              }
            }}
            style={{ borderColor: 'var(--theme-card-border-glow)' }}
            className="relative w-full max-h-72 rounded-xl overflow-hidden border bg-black/80 cursor-crosshair select-none flex items-center justify-center"
          >
            <img
              src={imageUrl}
              alt={subjectTitle}
              onError={() => setHasImageError(true)}
              className="w-full max-h-72 object-contain"
              draggable={false}
            />

            {tapCoords && (
              <div
                style={{
                  left: `${tapCoords.x * 100}%`,
                  top: `${tapCoords.y * 100}%`,
                  borderColor: 'var(--theme-accent-primary)',
                  backgroundColor: 'rgba(201, 154, 78, 0.25)',
                }}
                className="absolute -translate-x-1/2 -translate-y-1/2 w-8 h-8 rounded-full border-2 shadow-lg pointer-events-none flex items-center justify-center"
              >
                <div
                  style={{ backgroundColor: 'var(--theme-accent-primary)' }}
                  className="w-2 h-2 rounded-full"
                />
              </div>
            )}
          </div>

          {(imageAttribution || tapCoords) && (
            <div className="flex items-center justify-between gap-2 text-[10px] text-[var(--theme-text-muted)] flex-wrap">
              {tapCoords ? (
                <span className="font-mono text-[var(--theme-accent-secondary)] font-semibold">
                  {t.tappedRegionLabel}: ({Math.round(tapCoords.x * 100)}%, {Math.round(tapCoords.y * 100)}%)
                </span>
              ) : (
                <span />
              )}
              {imageAttribution && (
                <span className="truncate max-w-xs">
                  {imageSourceUrl ? (
                    <a
                      href={imageSourceUrl}
                      target="_blank"
                      rel="noopener noreferrer"
                      className="hover:underline text-[var(--theme-accent-primary)]"
                    >
                      {imageAttribution}
                    </a>
                  ) : (
                    imageAttribution
                  )}
                </span>
              )}
            </div>
          )}
        </div>
      )}

      {/* Ask About This Detail Inline Form */}
      <form onSubmit={handleAskSubmit} className="space-y-2">
        <div className="flex items-center gap-2">
          <div className="relative flex-1">
            <Search className="w-3.5 h-3.5 absolute left-3 top-1/2 -translate-y-1/2 text-[var(--theme-text-muted)]" />
            <input
              type="text"
              value={questionInput}
              onChange={(e) => setQuestionInput(e.target.value)}
              placeholder={t.askPlaceholder}
              className="theme-input w-full pl-8 pr-3 py-2 text-xs min-h-[40px]"
            />
          </div>
          <button
            type="submit"
            disabled={isAnalyzing || !questionInput.trim()}
            className="px-3.5 py-2 rounded-xl theme-btn-primary text-xs font-bold flex items-center gap-1.5 cursor-pointer shrink-0 min-h-[40px] disabled:opacity-50"
          >
            {isAnalyzing ? <Loader2 className="w-3.5 h-3.5 animate-spin" /> : <Send className="w-3.5 h-3.5" />}
            <span>{t.askBtn}</span>
          </button>
        </div>

        {/* Quick Detail Inquiry Chips */}
        <div className="flex items-center gap-1.5 overflow-x-auto pb-1 scrollbar-none">
          {[t.quickChipPosture, t.quickChipOrnaments, t.quickChipInscription, t.quickChipCraft].map(
            (chip, idx) => (
              <button
                key={idx}
                type="button"
                disabled={isAnalyzing}
                onClick={() => {
                  setQuestionInput(chip);
                  runDetailAnalysis({ question: chip, coords: tapCoords || undefined });
                }}
                style={{
                  backgroundColor: 'var(--theme-card-bg-subtle)',
                  borderColor: 'var(--theme-card-border)',
                  color: 'var(--theme-text-body)',
                }}
                className="px-2.5 py-1.5 rounded-lg border text-[11px] font-medium whitespace-nowrap cursor-pointer hover:border-[var(--theme-card-border-glow)] transition-colors shrink-0"
              >
                {chip}
              </button>
            )
          )}
        </div>
      </form>

      {/* Loading Indicator */}
      {isAnalyzing && (
        <div
          style={{
            backgroundColor: 'var(--theme-card-bg-subtle)',
            borderColor: 'var(--theme-card-border)',
          }}
          className="p-3 rounded-xl border flex items-center gap-2 text-xs text-[var(--theme-accent-secondary)]"
        >
          <Loader2 className="w-4 h-4 animate-spin shrink-0" />
          <span>{t.loadingAnalysis}</span>
        </div>
      )}

      {/* Error Message */}
      {analysisError && (
        <div
          style={{
            backgroundColor: 'var(--theme-card-bg-subtle)',
            borderColor: 'var(--theme-accent-primary)',
          }}
          className="p-2.5 rounded-xl border text-xs text-[var(--theme-text-title)]"
        >
          {analysisError}
        </div>
      )}

      {/* Specific Visual Tap / Question Answer Card */}
      {answerText && (
        <div
          style={{
            backgroundColor: 'var(--theme-card-bg-subtle)',
            borderColor: 'var(--theme-card-border-glow)',
          }}
          className="p-3.5 rounded-2xl border space-y-2 shadow-sm"
        >
          <div className="flex items-center justify-between gap-2 flex-wrap">
            <div className="flex items-center gap-2 flex-wrap">
              <span className="text-xs font-serif font-bold text-[var(--theme-accent-primary)] flex items-center gap-1">
                <HelpCircle className="w-3.5 h-3.5" />
                <span>{highlightedPartName || t.tappedRegionLabel}</span>
              </span>
              <CertaintyBadge certainty={answerCertainty} labels={certaintyLabels} />
            </div>

            <div className="flex items-center gap-1.5 shrink-0">
              <button
                type="button"
                onClick={handleToggleSpeakAnswer}
                className="px-2.5 py-1 rounded-lg theme-btn-primary text-[11px] font-bold flex items-center gap-1 cursor-pointer min-h-[32px]"
              >
                {isPlayingAnswer ? <Pause className="w-3 h-3" /> : <Play className="w-3 h-3" />}
                <span>{isPlayingAnswer ? t.pauseAnswer : t.speakAnswer}</span>
              </button>

              <AudioSpeedControl
                id="btn-detail-panel-audio-speed"
                compact
                speed={guideSettings?.speechRate}
                onChangeSpeed={(nextRate) => {
                  speechManager.setRate(nextRate);
                  onUpdateSpeechRate?.(nextRate);
                }}
                isRtl={selectedLanguage.direction === 'rtl'}
              />
            </div>
          </div>

          <p className="text-xs sm:text-sm text-[var(--theme-text-body)] leading-relaxed whitespace-pre-line max-w-2xl">
            {answerText}
          </p>
        </div>
      )}

      {/* Epigraphic / Inscription Caution Block */}
      {inscription?.detected && (
        <div
          style={{
            backgroundColor: 'var(--theme-card-bg-subtle)',
            borderColor: 'var(--theme-card-border-glow)',
          }}
          className="p-3.5 rounded-2xl border space-y-2"
        >
          <div className="flex items-center justify-between gap-2 flex-wrap">
            <h5 className="text-xs font-serif font-bold text-[var(--theme-accent-primary)] flex items-center gap-1.5">
              <BookOpen className="w-3.5 h-3.5" />
              <span>{t.inscriptionHeading}</span>
            </h5>
            <CertaintyBadge certainty={inscription.certainty} labels={certaintyLabels} />
          </div>

          <div className="grid grid-cols-1 gap-1.5 text-xs">
            {inscription.script && (
              <div>
                <span className="font-bold text-[var(--theme-accent-secondary)]">{t.scriptLabel}: </span>
                <span className="text-[var(--theme-text-title)]">{inscription.script}</span>
              </div>
            )}
            {inscription.confirmedReading && (
              <div>
                <span className="font-bold text-[var(--theme-accent-secondary)]">{t.confirmedReadingLabel}: </span>
                <span className="font-mono text-[var(--theme-text-title)]">{inscription.confirmedReading}</span>
              </div>
            )}
            {inscription.approximateTransliteration && (
              <div>
                <span className="font-bold text-[var(--theme-accent-secondary)]">{t.transliterationLabel}: </span>
                <span className="italic text-[var(--theme-text-body)]">{inscription.approximateTransliteration}</span>
              </div>
            )}
            {inscription.translation && (
              <div>
                <span className="font-bold text-[var(--theme-accent-secondary)]">{t.translationLabel}: </span>
                <span className="text-[var(--theme-text-body)]">{inscription.translation}</span>
              </div>
            )}
            {inscription.uncertaintyNote && (
              <div
                style={{
                  backgroundColor: 'var(--theme-card-bg)',
                  borderColor: 'var(--theme-card-border)',
                }}
                className="p-2 rounded-xl border text-[11px] text-[var(--theme-text-muted)] flex items-start gap-1.5"
              >
                <ShieldAlert className="w-3.5 h-3.5 text-[var(--theme-accent-primary)] shrink-0 mt-0.5" />
                <span>
                  <strong className="text-[var(--theme-text-title)]">{t.uncertaintyLabel}: </strong>
                  {inscription.uncertaintyNote}
                </span>
              </div>
            )}
          </div>
        </div>
      )}

      {/* Component-by-Component List */}
      {components.length === 0 && !isAnalyzing ? (
        <div
          style={{
            backgroundColor: 'var(--theme-card-bg-subtle)',
            borderColor: 'var(--theme-card-border)',
          }}
          className="p-4 rounded-2xl border text-center text-xs text-[var(--theme-text-muted)]"
        >
          {t.noComponentsYet}
        </div>
      ) : (
        <div className="space-y-2">
          {components.map((comp) => {
            const isSelected = selectedComponentId === comp.id;
            return (
              <div
                key={comp.id}
                style={{
                  backgroundColor: isSelected ? 'var(--theme-card-hover)' : 'var(--theme-card-bg-subtle)',
                  borderColor: isSelected ? 'var(--theme-card-border-glow)' : 'var(--theme-card-border)',
                }}
                className="p-3 rounded-2xl border transition-all space-y-2"
              >
                <div
                  role="button"
                  tabIndex={0}
                  onClick={() => setSelectedComponentId(isSelected ? null : comp.id)}
                  onKeyDown={(e) => {
                    if (e.key === 'Enter' || e.key === ' ') {
                      e.preventDefault();
                      setSelectedComponentId(isSelected ? null : comp.id);
                    }
                  }}
                  className="flex items-start justify-between gap-2 cursor-pointer"
                >
                  <div className="min-w-0 flex-1 space-y-1">
                    <div className="flex items-center gap-1.5 flex-wrap">
                      <span className="px-1.5 py-0.5 rounded text-[9.5px] font-bold uppercase tracking-wider theme-badge-gold flex items-center gap-1">
                        <Layers className="w-2.5 h-2.5" />
                        {comp.category}
                      </span>
                      <CertaintyBadge certainty={comp.certainty} labels={certaintyLabels} />
                    </div>
                    <h5 className="text-xs sm:text-sm font-serif font-bold text-[var(--theme-text-title)]">
                      {comp.name}
                    </h5>
                  </div>
                </div>

                {comp.visualCue && (
                  <p className="text-xs text-[var(--theme-text-body)] leading-relaxed">
                    <strong className="text-[var(--theme-accent-primary)]">{t.visualCueLabel}: </strong>
                    {comp.visualCue}
                  </p>
                )}

                {comp.meaningAndSymbolism && (
                  <p className="text-xs text-[var(--theme-text-body)] leading-relaxed">
                    <strong className="text-[var(--theme-accent-secondary)]">{t.meaningLabel}: </strong>
                    {comp.meaningAndSymbolism}
                  </p>
                )}

                {comp.craftTechnique && (
                  <p className="text-[11px] text-[var(--theme-text-muted)] leading-relaxed">
                    <strong className="text-[var(--theme-text-title)]">{t.craftLabel}: </strong>
                    {comp.craftTechnique}
                  </p>
                )}

                <div className="pt-0.5 flex justify-end">
                  <button
                    type="button"
                    disabled={isAnalyzing}
                    onClick={() => {
                      const q = `Explain "${comp.name}" in detail — visual markers, symbolism, and historical evidence.`;
                      setQuestionInput(q);
                      runDetailAnalysis({ question: q });
                    }}
                    className="px-2.5 py-1 rounded-lg theme-btn-secondary text-[11px] font-semibold flex items-center gap-1 cursor-pointer"
                  >
                    <Sparkles className="w-3 h-3 text-[var(--theme-accent-primary)]" />
                    <span>{t.askThisPart}</span>
                  </button>
                </div>
              </div>
            );
          })}
        </div>
      )}

      {/* Grounded Sources if returned */}
      {sources.length > 0 && (
        <div
          style={{
            backgroundColor: 'var(--theme-card-bg-subtle)',
            borderColor: 'var(--theme-card-border)',
          }}
          className="p-2.5 rounded-xl border space-y-1.5"
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
                  className="text-[11px] px-2 py-1 rounded-lg theme-btn-secondary inline-flex items-center gap-1 hover:underline"
                >
                  <span className="truncate max-w-[200px]">{src.title}</span>
                  <ExternalLink className="w-2.5 h-2.5 shrink-0" />
                </a>
              ) : null
            )}
          </div>
        </div>
      )}
    </div>
  );
};
