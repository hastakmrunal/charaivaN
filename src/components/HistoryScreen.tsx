import React, { useState } from 'react';
import { RecognitionResult, Language, GuideSettings, TravelJournalEntry } from '../types';
import { speechManager } from '../utils/speech';
import { AudioSpeedControl } from './AudioSpeedControl';
import { PlaceCardImage } from './PlaceCardImage';
import { getTodayDateStr } from '../utils/journalPersistence';
import {
  History,
  Volume2,
  Trash2,
  Search,
  ArrowRight,
  Compass,
  Plus,
  Edit3,
  Cloud,
  CloudOff,
  RefreshCw,
  Calendar,
  X,
  Check,
  Camera,
  CheckCircle2
} from 'lucide-react';
import { BackButton } from './BackButton';
import { useBackLayer, usePreservedScroll } from '../utils/navigationHistory';
import { useLocalizedTexts } from '../data/localizedStrings';
import { compressImageToJournalDataUrl, getPhotoByIdFromAppStorage } from '../utils/photoStorage';

const HISTORY_UI_DEFAULTS = {
  title: 'Tour Journal & Visit Log',
  offlineCache: 'Offline Cache',
  guestLog: 'Device-Only Guest Log',
  addBtn: 'Add',
  clearBtn: 'Clear',
  confirmBtn: 'Confirm',
  clearingBtn: 'Clearing...',
  cancelBtn: 'Cancel',
  retryBtn: 'Retry',
  searchPlaceholder: 'Search saved tour history...',
  loadingJournal: 'Loading your saved Travel Journal...',
  emptyTitle: 'Journal is Empty',
  emptyCloudHint: 'Scan monuments, save places from the AI Tour Guide, or tap Add to build your permanent Travel Journal!',
  emptyGuestHint: 'Scan monuments or tap Add to log visits. Entries here are device-only until you sign in with Google in Settings.',
  attachPhotoBtn: 'Attach Photo',
  changePhotoBtn: 'Change Photo',
  removePhotoBtn: 'Remove',
  optimizingPhoto: 'Optimizing photo...',
  savedCloudMsg: 'Saved to your account Travel Journal.',
  savedGuestMsg: 'Saved to device-only guest journal.',
  deletedMsg: 'Journal entry deleted.',
};

interface HistoryScreenProps {
  isActive?: boolean;
  visitedHistory: RecognitionResult[];
  selectedLanguage: Language;
  guideSettings?: GuideSettings;
  onUpdateSpeechRate?: (rate: number) => void;
  onSelectLandmarkToView: (landmark: RecognitionResult) => void;
  onClearHistory: () => Promise<void> | void;
  onBackToHome?: () => void;
  isAuthenticatedCloud?: boolean;
  accountOwnerName?: string;
  isLoadingJournal?: boolean;
  journalFromCache?: boolean;
  journalError?: string | null;
  onRetryLoadJournal?: () => void;
  onAddJournalEntry?: (
    entry: Omit<TravelJournalEntry, 'journalId' | 'userId' | 'createdAt' | 'updatedAt'>
  ) => Promise<void>;
  onUpdateJournalEntry?: (
    journalId: string,
    updates: Partial<TravelJournalEntry>
  ) => Promise<void>;
  onDeleteJournalEntry?: (journalId: string) => Promise<void>;
  defaultCity?: string;
  defaultCountry?: string;
}

export const HistoryScreen: React.FC<HistoryScreenProps> = ({
  isActive = true,
  visitedHistory,
  selectedLanguage,
  guideSettings,
  onUpdateSpeechRate,
  onSelectLandmarkToView,
  onClearHistory,
  onBackToHome,
  isAuthenticatedCloud = false,
  accountOwnerName,
  isLoadingJournal = false,
  journalFromCache = false,
  journalError = null,
  onRetryLoadJournal,
  onAddJournalEntry,
  onUpdateJournalEntry,
  onDeleteJournalEntry,
  defaultCity = '',
  defaultCountry = 'India',
}) => {
  const { t } = useLocalizedTexts(HISTORY_UI_DEFAULTS, selectedLanguage, 'Travel Journal screen labels');
  const [searchTerm, setSearchTerm] = useState('');
  const [currentlyPlayingId, setCurrentlyPlayingId] = useState<string | null>(null);
  const [confirmClearAll, setConfirmClearAll] = useState(false);
  const [isClearingAll, setIsClearingAll] = useState(false);
  const [deletingId, setDeletingId] = useState<string | null>(null);
  const [actionError, setActionError] = useState<string | null>(null);
  const [actionSuccess, setActionSuccess] = useState<string | null>(null);
  const [hydratedPhotos, setHydratedPhotos] = useState<Record<string, string>>({});

  // Add / Edit Modal State
  const [isEditorOpen, setIsEditorOpen] = useState(false);
  const [editingEntryId, setEditingEntryId] = useState<string | null>(null);
  const [formPlaceName, setFormPlaceName] = useState('');
  const [formCity, setFormCity] = useState('');
  const [formCountry, setFormCountry] = useState('India');
  const [formVisitDate, setFormVisitDate] = useState(getTodayDateStr());
  const [formNotes, setFormNotes] = useState('');
  const [formGuideSummary, setFormGuideSummary] = useState('');
  const [formCategory, setFormCategory] = useState<RecognitionResult['category']>('monument');
  const [formVisitedConfirmed, setFormVisitedConfirmed] = useState(true);
  const [formPhotoDataUrl, setFormPhotoDataUrl] = useState('');
  const [formImageUrl, setFormImageUrl] = useState('');
  const [isCompressingPhoto, setIsCompressingPhoto] = useState(false);
  const [isSavingForm, setIsSavingForm] = useState(false);
  const [formError, setFormError] = useState<string | null>(null);
  const photoFileInputRef = React.useRef<HTMLInputElement | null>(null);

  React.useEffect(() => {
    let cancelled = false;
    const missing = visitedHistory.filter((item) => {
      const id = item.journalId || item.id;
      return item.localPhotoId && !item.photoDataUrl && !item.imageUrl && !hydratedPhotos[id];
    });
    if (missing.length === 0) return;

    Promise.all(
      missing.map(async (item) => {
        const id = item.journalId || item.id;
        const rec = item.localPhotoId ? await getPhotoByIdFromAppStorage(item.localPhotoId) : null;
        return rec?.dataUrl ? ([id, rec.dataUrl] as const) : null;
      })
    ).then((pairs) => {
      if (cancelled) return;
      const updates: Record<string, string> = {};
      pairs.forEach((p) => {
        if (p) updates[p[0]] = p[1];
      });
      if (Object.keys(updates).length > 0) {
        setHydratedPhotos((prev) => ({ ...prev, ...updates }));
      }
    });
    return () => {
      cancelled = true;
    };
  }, [visitedHistory, hydratedPhotos]);

  React.useEffect(() => {
    if (!actionSuccess) return;
    const timer = window.setTimeout(() => setActionSuccess(null), 3500);
    return () => window.clearTimeout(timer);
  }, [actionSuccess]);

  useBackLayer(
    'history-entry-editor',
    isActive && isEditorOpen,
    () => {
      if (!isSavingForm) setIsEditorOpen(false);
    },
    60
  );
  useBackLayer(
    'history-confirm-clear',
    isActive && confirmClearAll,
    () => setConfirmClearAll(false),
    50
  );
  const listScrollRef = usePreservedScroll<HTMLDivElement>('tab:history', isActive);

  const filtered = visitedHistory.filter((item) => {
    const q = searchTerm.toLowerCase();
    return (
      item.title.toLowerCase().includes(q) ||
      item.category.toLowerCase().includes(q) ||
      item.summary.toLowerCase().includes(q) ||
      (item.notes || '').toLowerCase().includes(q) ||
      (item.locationName || '').toLowerCase().includes(q)
    );
  });

  const handlePlaySpeech = (landmark: RecognitionResult) => {
    if (currentlyPlayingId === landmark.id) {
      speechManager.stop();
      setCurrentlyPlayingId(null);
      return;
    }

    speechManager.speak({
      text: landmark.narration,
      language: selectedLanguage.name,
      languageCode: selectedLanguage.speechCode,
      rate: guideSettings?.speechRate || 1.0,
      pitch: guideSettings?.voicePitch || (guideSettings?.voiceGender === 'male' ? 0.95 : 1.08),
      gender: guideSettings?.voiceGender || 'female',
      onStart: () => setCurrentlyPlayingId(landmark.id),
      onEnd: () => setCurrentlyPlayingId(null),
      onError: () => setCurrentlyPlayingId(null),
    });
  };

  const openAddModal = () => {
    setEditingEntryId(null);
    setFormPlaceName('');
    setFormCity(defaultCity);
    setFormCountry(defaultCountry || 'India');
    setFormVisitDate(getTodayDateStr());
    setFormNotes('');
    setFormGuideSummary('');
    setFormCategory('monument');
    setFormVisitedConfirmed(true);
    setFormPhotoDataUrl('');
    setFormImageUrl('');
    setFormError(null);
    setActionError(null);
    setIsEditorOpen(true);
  };

  const openEditModal = (item: RecognitionResult) => {
    const entryId = item.journalId || item.id;
    setEditingEntryId(entryId);
    setFormPlaceName(item.title || '');
    setFormCity(item.city || '');
    setFormCountry(item.country || '');
    setFormVisitDate(item.visitDate || getTodayDateStr());
    setFormNotes(item.notes || '');
    setFormGuideSummary(item.summary || '');
    setFormCategory(item.category || 'monument');
    setFormVisitedConfirmed(item.visitedConfirmed ?? true);
    setFormPhotoDataUrl(item.photoDataUrl || hydratedPhotos[entryId] || '');
    setFormImageUrl(item.imageUrl && !item.imageUrl.startsWith('data:') ? item.imageUrl : '');
    setFormError(null);
    setActionError(null);
    setIsEditorOpen(true);
  };

  const handlePhotoFilePick = async (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    e.target.value = '';
    if (!file) return;
    setIsCompressingPhoto(true);
    setFormError(null);
    try {
      const compressed = await compressImageToJournalDataUrl(file, 560, 82000);
      if (!compressed) {
        setFormError('Could not process that image file. Please choose a JPEG or PNG photo.');
        return;
      }
      setFormPhotoDataUrl(compressed);
    } catch {
      setFormError('Failed to prepare photograph for journal storage.');
    } finally {
      setIsCompressingPhoto(false);
    }
  };

  const handleSubmitEditor = async (e: React.FormEvent) => {
    e.preventDefault();
    if (isSavingForm || isCompressingPhoto) return;
    const cleanPlace = formPlaceName.trim();
    if (!cleanPlace) {
      setFormError('Destination / place name is required.');
      return;
    }

    setIsSavingForm(true);
    setFormError(null);
    setActionError(null);
    setActionSuccess(null);
    try {
      const locationName = [formCity.trim(), formCountry.trim()].filter(Boolean).join(', ');
      if (editingEntryId && onUpdateJournalEntry) {
        const hasAnyPhoto = Boolean(formPhotoDataUrl || formImageUrl);
        await onUpdateJournalEntry(editingEntryId, {
          placeName: cleanPlace,
          city: formCity.trim(),
          country: formCountry.trim(),
          locationName,
          visitDate: formVisitDate || getTodayDateStr(),
          notes: formNotes.trim(),
          guideSummary: formGuideSummary.trim(),
          category: formCategory,
          visitedConfirmed: formVisitedConfirmed,
          photoDataUrl: formPhotoDataUrl,
          imageUrl: formImageUrl,
          localPhotoId: hasAnyPhoto ? undefined : '',
        });
        if (!hasAnyPhoto) {
          setHydratedPhotos((prev) => {
            if (!prev[editingEntryId]) return prev;
            const next = { ...prev };
            delete next[editingEntryId];
            return next;
          });
        }
      } else if (onAddJournalEntry) {
        await onAddJournalEntry({
          placeId: '',
          placeName: cleanPlace,
          city: formCity.trim(),
          country: formCountry.trim(),
          locationName: locationName || cleanPlace,
          category: formCategory,
          visitDate: formVisitDate || getTodayDateStr(),
          notes: formNotes.trim(),
          guideSummary: formGuideSummary.trim() || `Visited ${cleanPlace}.`,
          visitedConfirmed: formVisitedConfirmed,
          photoDataUrl: formPhotoDataUrl || undefined,
          imageUrl: formImageUrl || undefined,
        });
      }
      setIsEditorOpen(false);
      setActionSuccess(isAuthenticatedCloud ? t.savedCloudMsg : t.savedGuestMsg);
    } catch (err: any) {
      setFormError(err?.message || 'Unable to save journal entry. Please try again.');
    } finally {
      setIsSavingForm(false);
    }
  };

  const handleDeleteOne = async (item: RecognitionResult) => {
    const id = item.journalId || item.id;
    if (!onDeleteJournalEntry || deletingId === id) return;
    setDeletingId(id);
    setActionError(null);
    setActionSuccess(null);
    try {
      await onDeleteJournalEntry(id);
      setActionSuccess(t.deletedMsg);
    } catch (err: any) {
      setActionError(err?.message || 'Could not delete journal entry.');
    } finally {
      setDeletingId(null);
    }
  };

  const handleConfirmClearAll = async () => {
    if (isClearingAll) return;
    setIsClearingAll(true);
    setActionError(null);
    setActionSuccess(null);
    try {
      await onClearHistory();
      setConfirmClearAll(false);
    } catch (err: any) {
      setActionError(err?.message || 'Could not clear journal entries.');
    } finally {
      setIsClearingAll(false);
    }
  };

  return (
    <div
      id="history-screen"
      dir={selectedLanguage.direction === 'rtl' ? 'rtl' : 'ltr'}
      className="h-full flex flex-col overflow-hidden overflow-clip py-1 space-y-2 select-none relative"
    >
      {/* Header */}
      <div
        style={{
          backgroundColor: 'var(--theme-card-bg)',
          borderColor: 'var(--theme-card-border)',
        }}
        className="shrink-0 flex items-center justify-between gap-2 p-2.5 border rounded-2xl backdrop-blur-xl shadow-lg"
      >
        <div className="flex items-center gap-2 min-w-0">
          {onBackToHome && (
            <BackButton
              id="btn-history-back-home"
              onClick={onBackToHome}
              selectedLanguage={selectedLanguage}
            />
          )}
          <div className="min-w-0">
            <h3 className="text-sm font-serif font-bold text-[var(--theme-text-title)] flex items-center gap-1.5 truncate">
              <History className="w-4 h-4 text-[var(--theme-accent-primary)] shrink-0" />
              <span className="truncate">{t.title}</span>
            </h3>
            <p className="text-[11px] text-[var(--theme-accent-secondary)] flex items-center gap-1.5 truncate">
              <span>
                {visitedHistory.length} {visitedHistory.length === 1 ? 'place' : 'places'} in {selectedLanguage.nativeName}
              </span>
              <span>·</span>
              {isAuthenticatedCloud ? (
                <span className="inline-flex items-center gap-1 text-emerald-400 font-semibold truncate">
                  <Cloud className="w-3 h-3 shrink-0" />
                  <span className="truncate">
                    {journalFromCache
                      ? t.offlineCache
                      : `Synced · ${accountOwnerName || 'Account'}`}
                  </span>
                </span>
              ) : (
                <span className="inline-flex items-center gap-1 text-[var(--theme-text-muted)] truncate">
                  <CloudOff className="w-3 h-3 shrink-0" />
                  <span className="truncate">{t.guestLog}</span>
                </span>
              )}
            </p>
          </div>
        </div>

        <div className="flex items-center gap-1.5 shrink-0">
          {onAddJournalEntry && (
            <button
              id="btn-history-add-entry"
              type="button"
              onClick={openAddModal}
              className="px-2.5 py-1 rounded-xl theme-btn-primary text-xs font-bold flex items-center gap-1 cursor-pointer transition-all active:scale-95 shadow-sm"
              title="Add a visited destination to your Travel Journal"
            >
              <Plus className="w-3.5 h-3.5" />
              <span>{t.addBtn}</span>
            </button>
          )}

          {visitedHistory.length > 0 && !confirmClearAll && (
            <button
              id="btn-history-clear-prompt"
              type="button"
              onClick={() => setConfirmClearAll(true)}
              className="px-2.5 py-1 rounded-xl bg-rose-950/80 hover:bg-rose-900 text-rose-200 border border-rose-800/60 text-xs font-semibold flex items-center gap-1 cursor-pointer transition-all active:scale-95 shadow-sm"
            >
              <Trash2 className="w-3 h-3" />
              <span className="hidden xs:inline">{t.clearBtn}</span>
            </button>
          )}

          {confirmClearAll && (
            <div className="flex items-center gap-1">
              <button
                type="button"
                disabled={isClearingAll}
                onClick={handleConfirmClearAll}
                className="px-2 py-1 rounded-xl bg-rose-600 hover:bg-rose-500 text-white text-[11px] font-bold cursor-pointer disabled:opacity-60"
              >
                {isClearingAll ? t.clearingBtn : t.confirmBtn}
              </button>
              <button
                type="button"
                onClick={() => setConfirmClearAll(false)}
                style={{
                  backgroundColor: 'var(--theme-card-bg-subtle)',
                  borderColor: 'var(--theme-card-border)',
                  color: 'var(--theme-text-muted)',
                }}
                className="px-2 py-1 rounded-xl border text-[11px] font-semibold cursor-pointer"
              >
                {t.cancelBtn}
              </button>
            </div>
          )}
        </div>
      </div>

      {/* Sync Error / Offline / Success Feedback Banners */}
      {actionSuccess && !actionError && (
        <div
          id="history-action-success"
          style={{
            backgroundColor: 'var(--theme-card-bg)',
            borderColor: 'var(--theme-accent-secondary)',
          }}
          className="shrink-0 px-3 py-1.5 rounded-xl border text-[11px] flex items-center gap-2 text-emerald-300 font-semibold"
        >
          <CheckCircle2 className="w-3.5 h-3.5 shrink-0" />
          <span className="truncate">{actionSuccess}</span>
        </div>
      )}

      {(journalError || actionError) && (
        <div
          style={{
            backgroundColor: 'var(--theme-card-bg)',
            borderColor: journalFromCache ? 'var(--theme-accent-primary)' : 'rgba(244,63,94,0.6)',
          }}
          className="shrink-0 px-3 py-1.5 rounded-xl border text-[11px] flex items-center justify-between gap-2 text-[var(--theme-text-body)]"
        >
          <span className="truncate">{actionError || journalError}</span>
          {onRetryLoadJournal && journalError && (
            <button
              type="button"
              onClick={onRetryLoadJournal}
              className="px-2 py-0.5 rounded-lg theme-btn-primary text-[10px] font-bold flex items-center gap-1 shrink-0 cursor-pointer"
            >
              <RefreshCw className="w-3 h-3" />
              <span>{t.retryBtn}</span>
            </button>
          )}
        </div>
      )}

      {/* Search Bar */}
      {visitedHistory.length > 0 && (
        <div className="shrink-0 relative">
          <Search className="w-3.5 h-3.5 absolute left-3 top-2.5 text-[var(--theme-accent-primary)]" />
          <input
            type="text"
            value={searchTerm}
            onChange={(e) => setSearchTerm(e.target.value)}
            placeholder={t.searchPlaceholder}
            style={{
              backgroundColor: 'var(--theme-input-bg)',
              borderColor: 'var(--theme-input-border)',
              color: 'var(--theme-text-title)',
            }}
            className="w-full pl-9 pr-3 py-1.5 rounded-xl border placeholder:text-[var(--theme-text-muted)] text-xs focus:outline-none focus:border-[var(--theme-card-border-glow)] transition-colors backdrop-blur-md"
          />
        </div>
      )}

      {/* Scrollable Items Container */}
      <div ref={listScrollRef} className="flex-1 min-h-0 overflow-y-auto pr-1">
        {isLoadingJournal && visitedHistory.length === 0 ? (
          <div
            style={{
              backgroundColor: 'var(--theme-card-bg)',
              borderColor: 'var(--theme-card-border)',
            }}
            className="h-full flex flex-col items-center justify-center p-6 rounded-2xl border text-center space-y-2 backdrop-blur-md"
          >
            <RefreshCw className="w-6 h-6 text-[var(--theme-accent-primary)] animate-spin" />
            <p className="text-xs font-semibold text-[var(--theme-text-title)]">
              {t.loadingJournal}
            </p>
          </div>
        ) : visitedHistory.length === 0 ? (
          <div
            style={{
              backgroundColor: 'var(--theme-card-bg)',
              borderColor: 'var(--theme-card-border)',
            }}
            className="h-full flex flex-col items-center justify-center p-6 rounded-2xl border text-center space-y-2 backdrop-blur-md"
          >
            <div
              style={{
                backgroundColor: 'var(--theme-card-bg-subtle)',
                borderColor: 'var(--theme-card-border)',
              }}
              className="w-12 h-12 rounded-2xl border flex items-center justify-center mx-auto text-[var(--theme-accent-primary)]"
            >
              <Compass className="w-6 h-6" />
            </div>
            <h4 className="text-sm font-serif font-bold text-[var(--theme-text-title)]">
              {t.emptyTitle}
            </h4>
            <p className="text-xs text-[var(--theme-text-muted)] max-w-xs mx-auto">
              {isAuthenticatedCloud ? t.emptyCloudHint : t.emptyGuestHint}
            </p>
          </div>
        ) : filtered.length === 0 ? (
          <div
            style={{
              backgroundColor: 'var(--theme-card-bg)',
              borderColor: 'var(--theme-card-border)',
            }}
            className="p-6 rounded-2xl border text-center space-y-1.5 backdrop-blur-md"
          >
            <p className="text-xs font-semibold text-[var(--theme-text-title)]">
              No journal entries match "{searchTerm}"
            </p>
          </div>
        ) : (
          <div className="space-y-2">
            {filtered.map((item) => {
              const isPlaying = currentlyPlayingId === item.id;
              const entryId = item.journalId || item.id;
              return (
                <div
                  key={entryId}
                  style={{
                    backgroundColor: 'var(--theme-card-bg)',
                    borderColor: 'var(--theme-card-border)',
                  }}
                  className="p-2.5 rounded-xl border transition-all flex items-center justify-between gap-2.5 backdrop-blur-md shadow-sm hover:border-[var(--theme-card-border-glow)]"
                >
                  <div className="flex items-center gap-2.5 min-w-0 flex-1">
                    <PlaceCardImage
                      placeName={item.title}
                      initialImageUrl={item.photoDataUrl || hydratedPhotos[entryId] || item.imageUrl}
                      category={item.category}
                      locality={item.locationName}
                      size="sm"
                    />
                    <div className="min-w-0 flex-1">
                      <div className="flex items-center gap-1.5 flex-wrap">
                        <span className="px-1.5 py-0.5 rounded-md theme-badge-teal text-[9px] font-bold uppercase tracking-wider">
                          {item.category}
                        </span>
                        {item.visitDate && (
                          <span className="inline-flex items-center gap-0.5 text-[9.5px] text-[var(--theme-accent-secondary)] font-medium">
                            <Calendar className="w-2.5 h-2.5" />
                            <span>{item.visitDate}</span>
                          </span>
                        )}
                      </div>
                      <h4 className="text-xs font-serif font-bold text-[var(--theme-text-title)] truncate mt-0.5">
                        {item.title}
                      </h4>
                      <p className="text-[10px] text-[var(--theme-text-muted)] line-clamp-1">
                        {item.notes ? `${item.notes} · ${item.summary}` : item.summary}
                      </p>
                    </div>
                  </div>

                  <div className="flex items-center gap-1 shrink-0">
                    <button
                      type="button"
                      onClick={() => handlePlaySpeech(item)}
                      style={
                        !isPlaying
                          ? {
                              backgroundColor: 'var(--theme-card-bg-subtle)',
                              borderColor: 'var(--theme-card-border)',
                              color: 'var(--theme-accent-primary)',
                            }
                          : undefined
                      }
                      className={`p-2 rounded-lg text-xs font-bold transition-all cursor-pointer border ${
                        isPlaying
                          ? 'bg-rose-500 text-white shadow-md border-rose-400'
                          : 'hover:border-[var(--theme-card-border-glow)]'
                      }`}
                      title="Replay Audio"
                    >
                      <Volume2 className="w-3.5 h-3.5" />
                    </button>

                    <AudioSpeedControl
                      compact
                      speed={guideSettings?.speechRate}
                      onChangeSpeed={(nextRate) => {
                        speechManager.setRate(nextRate);
                        onUpdateSpeechRate?.(nextRate);
                      }}
                      isRtl={selectedLanguage.direction === 'rtl'}
                      tone="subtle"
                    />

                    {onUpdateJournalEntry && (
                      <button
                        type="button"
                        onClick={() => openEditModal(item)}
                        style={{
                          backgroundColor: 'var(--theme-card-bg-subtle)',
                          borderColor: 'var(--theme-card-border)',
                          color: 'var(--theme-text-title)',
                        }}
                        className="p-2 rounded-lg text-xs border transition-all cursor-pointer hover:border-[var(--theme-card-border-glow)]"
                        title="Edit Notes & Visit Date"
                      >
                        <Edit3 className="w-3.5 h-3.5" />
                      </button>
                    )}

                    {onDeleteJournalEntry && (
                      <button
                        type="button"
                        disabled={deletingId === entryId}
                        onClick={() => handleDeleteOne(item)}
                        style={{
                          backgroundColor: 'var(--theme-card-bg-subtle)',
                          borderColor: 'var(--theme-card-border)',
                          color: 'rgb(251, 113, 133)',
                        }}
                        className="p-2 rounded-lg text-xs border transition-all cursor-pointer hover:border-rose-400 disabled:opacity-50"
                        title="Delete Journal Entry"
                      >
                        <Trash2 className="w-3.5 h-3.5" />
                      </button>
                    )}

                    <button
                      type="button"
                      onClick={() => onSelectLandmarkToView(item)}
                      className="p-2 rounded-lg theme-btn-primary cursor-pointer font-bold shadow-sm"
                      title="View Details"
                    >
                      <ArrowRight className="w-3.5 h-3.5" />
                    </button>
                  </div>
                </div>
              );
            })}
          </div>
        )}
      </div>

      {/* Add / Edit Journal Entry Modal */}
      {isEditorOpen && (
        <div
          className="fixed inset-0 z-50 bg-black/75 backdrop-blur-sm flex items-center justify-center p-3"
          onClick={() => !isSavingForm && setIsEditorOpen(false)}
        >
          <form
            onSubmit={handleSubmitEditor}
            onClick={(e) => e.stopPropagation()}
            style={{
              backgroundColor: 'var(--theme-header-bg)',
              borderColor: 'var(--theme-card-border-glow)',
            }}
            className="w-full max-w-md max-h-[90dvh] overflow-y-auto rounded-2xl border p-4 shadow-2xl space-y-3 text-xs"
          >
            <div className="flex items-center justify-between gap-2">
              <div className="flex items-center gap-2 min-w-0">
                <BackButton
                  compact
                  onClick={() => !isSavingForm && setIsEditorOpen(false)}
                  selectedLanguage={selectedLanguage}
                />
                <h4 className="text-sm font-serif font-bold text-[var(--theme-text-title)] truncate">
                  {editingEntryId ? 'Edit Travel Journal Entry' : 'Add Travel Journal Entry'}
                </h4>
              </div>
              <button
                type="button"
                disabled={isSavingForm}
                onClick={() => setIsEditorOpen(false)}
                className="p-1 rounded-lg text-[var(--theme-text-muted)] hover:text-[var(--theme-text-title)] cursor-pointer shrink-0"
                aria-label="Close journal editor"
              >
                <X className="w-4 h-4" />
              </button>
            </div>

            <div className="space-y-2">
              <div>
                <label className="block text-[10px] font-bold uppercase tracking-wider text-[var(--theme-text-muted)] mb-1">
                  Place Name *
                </label>
                <input
                  type="text"
                  required
                  value={formPlaceName}
                  onChange={(e) => setFormPlaceName(e.target.value)}
                  placeholder="e.g., Gateway of India"
                  style={{
                    backgroundColor: 'var(--theme-input-bg)',
                    borderColor: 'var(--theme-input-border)',
                    color: 'var(--theme-text-title)',
                  }}
                  className="w-full px-3 py-2 rounded-xl border text-xs focus:outline-none focus:border-[var(--theme-card-border-glow)]"
                />
              </div>

              <div className="grid grid-cols-2 gap-2">
                <div>
                  <label className="block text-[10px] font-bold uppercase tracking-wider text-[var(--theme-text-muted)] mb-1">
                    City
                  </label>
                  <input
                    type="text"
                    value={formCity}
                    onChange={(e) => setFormCity(e.target.value)}
                    placeholder="e.g., Mumbai"
                    style={{
                      backgroundColor: 'var(--theme-input-bg)',
                      borderColor: 'var(--theme-input-border)',
                      color: 'var(--theme-text-title)',
                    }}
                    className="w-full px-3 py-2 rounded-xl border text-xs focus:outline-none focus:border-[var(--theme-card-border-glow)]"
                  />
                </div>
                <div>
                  <label className="block text-[10px] font-bold uppercase tracking-wider text-[var(--theme-text-muted)] mb-1">
                    Country
                  </label>
                  <input
                    type="text"
                    value={formCountry}
                    onChange={(e) => setFormCountry(e.target.value)}
                    placeholder="e.g., India"
                    style={{
                      backgroundColor: 'var(--theme-input-bg)',
                      borderColor: 'var(--theme-input-border)',
                      color: 'var(--theme-text-title)',
                    }}
                    className="w-full px-3 py-2 rounded-xl border text-xs focus:outline-none focus:border-[var(--theme-card-border-glow)]"
                  />
                </div>
              </div>

              <div className="grid grid-cols-2 gap-2">
                <div>
                  <label className="block text-[10px] font-bold uppercase tracking-wider text-[var(--theme-text-muted)] mb-1">
                    Visit Date
                  </label>
                  <input
                    type="date"
                    value={formVisitDate}
                    onChange={(e) => setFormVisitDate(e.target.value)}
                    style={{
                      backgroundColor: 'var(--theme-input-bg)',
                      borderColor: 'var(--theme-input-border)',
                      color: 'var(--theme-text-title)',
                    }}
                    className="w-full px-3 py-2 rounded-xl border text-xs focus:outline-none focus:border-[var(--theme-card-border-glow)]"
                  />
                </div>
                <div>
                  <label className="block text-[10px] font-bold uppercase tracking-wider text-[var(--theme-text-muted)] mb-1">
                    Category
                  </label>
                  <select
                    value={formCategory}
                    onChange={(e) => setFormCategory(e.target.value as RecognitionResult['category'])}
                    style={{
                      backgroundColor: 'var(--theme-input-bg)',
                      borderColor: 'var(--theme-input-border)',
                      color: 'var(--theme-text-title)',
                    }}
                    className="w-full px-3 py-2 rounded-xl border text-xs focus:outline-none focus:border-[var(--theme-card-border-glow)]"
                  >
                    <option value="monument">Monument</option>
                    <option value="temple">Temple</option>
                    <option value="fort">Fort</option>
                    <option value="museum">Museum</option>
                    <option value="landscape">Landscape</option>
                    <option value="food">Food</option>
                    <option value="building">Building</option>
                    <option value="object">Object</option>
                  </select>
                </div>
              </div>

              <div>
                <label className="block text-[10px] font-bold uppercase tracking-wider text-[var(--theme-text-muted)] mb-1">
                  Personal Visit Notes
                </label>
                <textarea
                  rows={2}
                  value={formNotes}
                  onChange={(e) => setFormNotes(e.target.value)}
                  placeholder="Share what you experienced here..."
                  style={{
                    backgroundColor: 'var(--theme-input-bg)',
                    borderColor: 'var(--theme-input-border)',
                    color: 'var(--theme-text-title)',
                  }}
                  className="w-full px-3 py-2 rounded-xl border text-xs focus:outline-none focus:border-[var(--theme-card-border-glow)] resize-none"
                />
              </div>

              <div>
                <label className="block text-[10px] font-bold uppercase tracking-wider text-[var(--theme-text-muted)] mb-1">
                  Guide Summary
                </label>
                <textarea
                  rows={2}
                  value={formGuideSummary}
                  onChange={(e) => setFormGuideSummary(e.target.value)}
                  placeholder="Highlights or historical summary..."
                  style={{
                    backgroundColor: 'var(--theme-input-bg)',
                    borderColor: 'var(--theme-input-border)',
                    color: 'var(--theme-text-title)',
                  }}
                  className="w-full px-3 py-2 rounded-xl border text-xs focus:outline-none focus:border-[var(--theme-card-border-glow)] resize-none"
                />
              </div>

              {/* Optional Visit Photograph */}
              <div>
                <label className="block text-[10px] font-bold uppercase tracking-wider text-[var(--theme-text-muted)] mb-1">
                  Visit Photograph (Optional)
                </label>
                <input
                  ref={photoFileInputRef}
                  id="input-history-entry-photo"
                  type="file"
                  accept="image/*"
                  onChange={handlePhotoFilePick}
                  className="sr-only"
                />
                <div className="flex items-center gap-2.5">
                  {(formPhotoDataUrl || formImageUrl) && (
                    <img
                      src={formPhotoDataUrl || formImageUrl}
                      alt={formPlaceName || 'Journal photo preview'}
                      className="w-12 h-12 rounded-xl object-cover border border-[var(--theme-card-border)] shrink-0"
                    />
                  )}
                  <button
                    type="button"
                    disabled={isCompressingPhoto || isSavingForm}
                    onClick={() => photoFileInputRef.current?.click()}
                    style={{
                      backgroundColor: 'var(--theme-input-bg)',
                      borderColor: 'var(--theme-input-border)',
                      color: 'var(--theme-text-title)',
                    }}
                    className="px-3 py-2 rounded-xl border text-[11px] font-semibold flex items-center gap-1.5 cursor-pointer hover:border-[var(--theme-card-border-glow)]"
                  >
                    <Camera className="w-3.5 h-3.5 text-[var(--theme-accent-primary)]" />
                    <span>
                      {isCompressingPhoto
                        ? t.optimizingPhoto
                        : formPhotoDataUrl || formImageUrl
                        ? t.changePhotoBtn
                        : t.attachPhotoBtn}
                    </span>
                  </button>
                  {(formPhotoDataUrl || formImageUrl) && (
                    <button
                      type="button"
                      disabled={isSavingForm}
                      onClick={() => {
                        setFormPhotoDataUrl('');
                        setFormImageUrl('');
                      }}
                      className="px-2.5 py-2 rounded-xl border border-rose-800/50 text-rose-300 text-[11px] font-semibold cursor-pointer hover:bg-rose-950/60"
                    >
                      {t.removePhotoBtn}
                    </button>
                  )}
                </div>
              </div>

              <label className="flex items-center gap-2 text-[11px] text-[var(--theme-text-body)] cursor-pointer pt-0.5">
                <input
                  type="checkbox"
                  checked={formVisitedConfirmed}
                  onChange={(e) => setFormVisitedConfirmed(e.target.checked)}
                  className="rounded accent-[var(--theme-accent-primary)]"
                />
                <span>Confirmed physical visit (log as visited place)</span>
              </label>
            </div>

            {formError && (
              <p className="text-[11px] text-rose-400 font-medium">{formError}</p>
            )}

            <div className="flex items-center justify-end gap-2 pt-1">
              <button
                type="button"
                disabled={isSavingForm}
                onClick={() => setIsEditorOpen(false)}
                style={{
                  backgroundColor: 'var(--theme-card-bg-subtle)',
                  borderColor: 'var(--theme-card-border)',
                  color: 'var(--theme-text-muted)',
                }}
                className="px-3.5 py-2 rounded-xl border text-xs font-semibold cursor-pointer"
              >
                Cancel
              </button>
              <button
                type="submit"
                disabled={isSavingForm}
                className="px-4 py-2 rounded-xl theme-btn-primary text-xs font-bold flex items-center gap-1.5 cursor-pointer disabled:opacity-60"
              >
                <Check className="w-3.5 h-3.5" />
                <span>{isSavingForm ? 'Saving...' : editingEntryId ? 'Update Entry' : 'Save Entry'}</span>
              </button>
            </div>
          </form>
        </div>
      )}
    </div>
  );
};

