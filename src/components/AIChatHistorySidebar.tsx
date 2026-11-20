import React, { useEffect, useMemo, useRef, useState } from 'react';
import {
  Check,
  MessageSquare,
  MoreVertical,
  Pencil,
  Plus,
  Search,
  Trash2,
  X,
} from 'lucide-react';
import { AiChatConversation, Language } from '../types';
import { AiChatUiStrings } from '../data/aiChatStrings';
import {
  ChatDateGroupKey,
  formatConversationUpdatedTime,
  getLatestMessagePreview,
  groupConversationsByDate,
  hasRealUserMessages,
  searchConversations,
} from '../utils/aiChatPersistence';

interface AIChatHistorySidebarProps {
  isOpen: boolean;
  onClose: () => void;
  conversations: AiChatConversation[];
  activeConversationId: string;
  onSelectConversation: (conversationId: string) => void;
  onNewChat: () => void;
  onRenameConversation: (conversationId: string, newTitle: string) => void | Promise<void>;
  onDeleteConversation: (conversationId: string) => void | Promise<void>;
  selectedLanguage: Language;
  strings: AiChatUiStrings;
  returnFocusRef?: React.RefObject<HTMLElement | null>;
}

export const AIChatHistorySidebar: React.FC<AIChatHistorySidebarProps> = ({
  isOpen,
  onClose,
  conversations,
  activeConversationId,
  onSelectConversation,
  onNewChat,
  onRenameConversation,
  onDeleteConversation,
  selectedLanguage,
  strings,
  returnFocusRef,
}) => {
  const isRtl = selectedLanguage.direction === 'rtl';
  const [shouldRender, setShouldRender] = useState(isOpen);
  const [isEntered, setIsEntered] = useState(isOpen);
  const [searchQuery, setSearchQuery] = useState('');
  const [openMenuConvId, setOpenMenuConvId] = useState<string | null>(null);
  const [renamingConvId, setRenamingConvId] = useState<string | null>(null);
  const [renameDraft, setRenameDraft] = useState('');
  const [pendingDeleteConv, setPendingDeleteConv] = useState<AiChatConversation | null>(null);

  const panelRef = useRef<HTMLDivElement | null>(null);
  const deleteDialogRef = useRef<HTMLDivElement | null>(null);
  const searchInputRef = useRef<HTMLInputElement | null>(null);
  const renameInputRef = useRef<HTMLInputElement | null>(null);
  const cancelDeleteBtnRef = useRef<HTMLButtonElement | null>(null);
  const wasOpenRef = useRef(false);

  // Smooth mount/unmount drawer animation so closed drawer is never present in DOM or tab order
  useEffect(() => {
    if (isOpen) {
      setShouldRender(true);
      const raf = window.requestAnimationFrame(() => {
        window.requestAnimationFrame(() => {
          setIsEntered(true);
        });
      });
      return () => window.cancelAnimationFrame(raf);
    }
    setIsEntered(false);
    setOpenMenuConvId(null);
    setRenamingConvId(null);
    setPendingDeleteConv(null);
    const timer = window.setTimeout(() => {
      setShouldRender(false);
    }, 230);
    return () => window.clearTimeout(timer);
  }, [isOpen]);

  // Focus entry + focus return when drawer opens/closes
  useEffect(() => {
    if (isOpen && shouldRender) {
      wasOpenRef.current = true;
      const focusTimer = window.setTimeout(() => {
        searchInputRef.current?.focus();
      }, 60);
      return () => window.clearTimeout(focusTimer);
    }
    if (!isOpen && wasOpenRef.current) {
      wasOpenRef.current = false;
      window.setTimeout(() => {
        returnFocusRef?.current?.focus?.();
      }, 20);
    }
  }, [isOpen, shouldRender, returnFocusRef]);

  // Auto-focus inline rename field or delete dialog when activated
  useEffect(() => {
    if (renamingConvId) {
      const timer = window.setTimeout(() => {
        renameInputRef.current?.focus();
        renameInputRef.current?.select();
      }, 20);
      return () => window.clearTimeout(timer);
    }
  }, [renamingConvId]);

  useEffect(() => {
    if (pendingDeleteConv) {
      const timer = window.setTimeout(() => {
        cancelDeleteBtnRef.current?.focus();
      }, 20);
      return () => window.clearTimeout(timer);
    }
  }, [pendingDeleteConv]);

  // Keyboard focus trap inside sidebar overlay when open
  useEffect(() => {
    if (!isOpen || !shouldRender) return;

    const handleKeyDown = (e: KeyboardEvent) => {
      if (e.key === 'Escape') {
        if (pendingDeleteConv) {
          e.preventDefault();
          e.stopPropagation();
          setPendingDeleteConv(null);
          return;
        }
        if (renamingConvId) {
          e.preventDefault();
          e.stopPropagation();
          setRenamingConvId(null);
          setRenameDraft('');
          return;
        }
        if (openMenuConvId) {
          e.preventDefault();
          e.stopPropagation();
          setOpenMenuConvId(null);
          return;
        }
        return;
      }

      if (e.key !== 'Tab') return;
      const container = pendingDeleteConv ? deleteDialogRef.current : panelRef.current;
      if (!container) return;

      const focusable = Array.from<HTMLElement>(
        container.querySelectorAll<HTMLElement>(
          'button:not([disabled]), input:not([disabled]), [tabindex]:not([tabindex="-1"])'
        )
      ).filter((el) => el.offsetParent !== null);

      if (focusable.length === 0) return;
      const first = focusable[0];
      const last = focusable[focusable.length - 1];

      if (e.shiftKey) {
        if (document.activeElement === first || !container.contains(document.activeElement)) {
          e.preventDefault();
          last.focus();
        }
      } else {
        if (document.activeElement === last || !container.contains(document.activeElement)) {
          e.preventDefault();
          first.focus();
        }
      }
    };

    document.addEventListener('keydown', handleKeyDown, true);
    return () => document.removeEventListener('keydown', handleKeyDown, true);
  }, [isOpen, shouldRender, pendingDeleteConv, renamingConvId, openMenuConvId]);

  const savedHistoryConversations = useMemo(
    () => conversations.filter((c) => hasRealUserMessages(c)),
    [conversations]
  );

  const filteredConversations = useMemo(
    () => searchConversations(savedHistoryConversations, searchQuery),
    [savedHistoryConversations, searchQuery]
  );

  const groupedBuckets = useMemo(
    () => groupConversationsByDate(filteredConversations),
    [filteredConversations]
  );

  const groupLabelMap: Record<ChatDateGroupKey, string> = {
    today: strings.today,
    yesterday: strings.yesterday,
    previous7Days: strings.previous7Days,
    previous30Days: strings.previous30Days,
    older: strings.older,
  };

  if (!shouldRender) return null;

  const startRename = (conv: AiChatConversation) => {
    setOpenMenuConvId(null);
    setRenamingConvId(conv.id);
    setRenameDraft(conv.title);
  };

  const commitRename = async () => {
    if (!renamingConvId) return;
    const trimmed = renameDraft.trim();
    const targetId = renamingConvId;
    setRenamingConvId(null);
    setRenameDraft('');
    if (trimmed) {
      await onRenameConversation(targetId, trimmed);
    }
  };

  const requestDelete = (conv: AiChatConversation) => {
    setOpenMenuConvId(null);
    setPendingDeleteConv(conv);
  };

  const confirmDelete = async () => {
    if (!pendingDeleteConv) return;
    const targetId = pendingDeleteConv.id;
    setPendingDeleteConv(null);
    await onDeleteConversation(targetId);
  };

  const offscreenClass = isRtl ? 'translate-x-full' : '-translate-x-full';
  const anchorSideClass = isRtl ? 'right-0 border-l' : 'left-0 border-r';

  return (
    <div
      id="ai-chat-history-overlay"
      dir={isRtl ? 'rtl' : 'ltr'}
      className="fixed inset-0 z-50 flex"
      role="presentation"
      onWheel={(e) => e.stopPropagation()}
    >
      {/* Dimmed Backdrop */}
      <div
        id="ai-chat-history-backdrop"
        aria-hidden="true"
        onClick={onClose}
        className={`fixed inset-0 bg-black/55 backdrop-blur-[2px] transition-opacity duration-200 ${
          isEntered ? 'opacity-100' : 'opacity-0'
        }`}
      />

      {/* Sliding Side Panel */}
      <aside
        id="ai-chat-history-drawer"
        ref={panelRef}
        role="dialog"
        aria-modal="true"
        aria-label={strings.chatHistoryTitle}
        style={{
          backgroundColor: 'var(--theme-header-bg)',
          borderColor: 'var(--theme-card-border)',
          paddingTop: 'env(safe-area-inset-top)',
          paddingBottom: 'env(safe-area-inset-bottom)',
        }}
        className={`fixed top-0 bottom-0 ${anchorSideClass} w-[83vw] max-w-[320px] sm:w-[320px] flex flex-col shadow-2xl transition-transform duration-200 ease-out will-change-transform ${
          isEntered ? 'translate-x-0' : offscreenClass
        }`}
        onClick={(e) => e.stopPropagation()}
      >
        {/* Sidebar Header */}
        <div
          style={{ borderColor: 'var(--theme-card-border)' }}
          className="shrink-0 px-3 py-3 border-b flex items-center justify-between gap-2"
        >
          <h2 className="text-sm font-serif font-bold text-[var(--theme-text-title)] truncate">
            {strings.chatHistoryTitle}
          </h2>
          <button
            id="btn-sidebar-close"
            type="button"
            onClick={onClose}
            aria-label={strings.close}
            title={strings.close}
            style={{
              backgroundColor: 'var(--theme-card-bg-subtle)',
              borderColor: 'var(--theme-card-border)',
              color: 'var(--theme-text-title)',
            }}
            className="min-w-[44px] min-h-[44px] rounded-xl border flex items-center justify-center shrink-0 cursor-pointer hover:border-[var(--theme-card-border-glow)] focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[var(--theme-accent-secondary)]"
          >
            <X className="w-4 h-4" />
          </button>
        </div>

        {/* + New Chat & Search */}
        <div
          style={{ borderColor: 'var(--theme-card-border)' }}
          className="shrink-0 p-3 space-y-2.5 border-b"
        >
          <button
            id="btn-sidebar-new-chat"
            type="button"
            onClick={() => {
              onNewChat();
              onClose();
            }}
            className="w-full min-h-[44px] px-3 py-2 rounded-xl theme-btn-primary text-xs font-bold flex items-center justify-center gap-1.5 cursor-pointer whitespace-nowrap focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[var(--theme-accent-secondary)]"
          >
            <Plus className="w-4 h-4 shrink-0" />
            <span>{strings.newChat}</span>
          </button>

          <div className="relative flex items-center">
            <Search
              className={`w-3.5 h-3.5 text-[var(--theme-text-muted)] absolute pointer-events-none ${
                isRtl ? 'right-3' : 'left-3'
              }`}
            />
            <input
              id="input-sidebar-chat-search"
              ref={searchInputRef}
              type="text"
              value={searchQuery}
              onChange={(e) => setSearchQuery(e.target.value)}
              placeholder={strings.searchChats}
              aria-label={strings.searchChats}
              style={{
                backgroundColor: 'var(--theme-input-bg)',
                borderColor: 'var(--theme-input-border)',
                color: 'var(--theme-text-title)',
              }}
              className={`w-full min-h-[40px] py-1.5 rounded-xl border text-xs placeholder:text-[var(--theme-text-muted)] focus:outline-none focus:border-[var(--theme-card-border-glow)] ${
                isRtl ? 'pr-9 pl-8' : 'pl-9 pr-8'
              }`}
            />
            {searchQuery && (
              <button
                type="button"
                onClick={() => setSearchQuery('')}
                aria-label={strings.clearSearch}
                className={`absolute p-1.5 text-[var(--theme-text-muted)] hover:text-[var(--theme-text-title)] cursor-pointer ${
                  isRtl ? 'left-1.5' : 'right-1.5'
                }`}
              >
                <X className="w-3.5 h-3.5" />
              </button>
            )}
          </div>
        </div>

        {/* Grouped Conversations List */}
        <div
          id="ai-chat-history-list"
          className="flex-1 min-h-0 overflow-y-auto px-2.5 py-2 space-y-4"
          onClick={() => {
            if (openMenuConvId) setOpenMenuConvId(null);
          }}
        >
          {groupedBuckets.length === 0 ? (
            <div className="py-10 px-4 text-center space-y-2">
              <MessageSquare className="w-7 h-7 mx-auto text-[var(--theme-text-muted)] opacity-60" />
              <p className="text-xs text-[var(--theme-text-muted)]">
                {searchQuery.trim() ? strings.noMatchingChats : strings.noConversationsYet}
              </p>
            </div>
          ) : (
            groupedBuckets.map((bucket) => (
              <section key={bucket.key} aria-label={groupLabelMap[bucket.key]} className="space-y-1">
                <h3 className="px-2 py-1 text-[10px] font-bold uppercase tracking-wider text-[var(--theme-text-muted)]">
                  {groupLabelMap[bucket.key]}
                </h3>
                <div className="space-y-1">
                  {bucket.conversations.map((conv) => {
                    const isSelected = conv.id === activeConversationId;
                    const isRenaming = renamingConvId === conv.id;
                    const isMenuOpen = openMenuConvId === conv.id;
                    const preview = getLatestMessagePreview(conv);
                    const timeLabel = formatConversationUpdatedTime(
                      conv.updatedAt,
                      selectedLanguage.code
                    );

                    return (
                      <div
                        key={conv.id}
                        data-conversation-id={conv.id}
                        style={
                          isSelected
                            ? {
                                backgroundColor: 'var(--theme-card-hover)',
                                borderColor: 'var(--theme-card-border-glow)',
                              }
                            : {
                                backgroundColor: 'var(--theme-card-bg-subtle)',
                                borderColor: 'var(--theme-card-border)',
                              }
                        }
                        className="relative rounded-xl border transition-colors"
                      >
                        {isRenaming ? (
                          <div className="p-2 flex items-center gap-1.5">
                            <input
                              ref={renameInputRef}
                              type="text"
                              value={renameDraft}
                              onChange={(e) => setRenameDraft(e.target.value)}
                              onKeyDown={(e) => {
                                if (e.key === 'Enter') {
                                  e.preventDefault();
                                  commitRename();
                                } else if (e.key === 'Escape') {
                                  e.preventDefault();
                                  e.stopPropagation();
                                  setRenamingConvId(null);
                                  setRenameDraft('');
                                }
                              }}
                              placeholder={strings.renameInputPlaceholder}
                              style={{
                                backgroundColor: 'var(--theme-input-bg)',
                                borderColor: 'var(--theme-input-border)',
                                color: 'var(--theme-text-title)',
                              }}
                              className="flex-1 min-w-0 px-2.5 py-1.5 rounded-lg border text-xs focus:outline-none focus:border-[var(--theme-card-border-glow)]"
                            />
                            <button
                              type="button"
                              onClick={commitRename}
                              aria-label={strings.save}
                              className="min-w-[36px] min-h-[36px] rounded-lg theme-btn-primary flex items-center justify-center shrink-0 cursor-pointer"
                            >
                              <Check className="w-3.5 h-3.5" />
                            </button>
                            <button
                              type="button"
                              onClick={() => {
                                setRenamingConvId(null);
                                setRenameDraft('');
                              }}
                              aria-label={strings.cancel}
                              style={{
                                backgroundColor: 'var(--theme-card-bg)',
                                borderColor: 'var(--theme-card-border)',
                                color: 'var(--theme-text-muted)',
                              }}
                              className="min-w-[36px] min-h-[36px] rounded-lg border flex items-center justify-center shrink-0 cursor-pointer"
                            >
                              <X className="w-3.5 h-3.5" />
                            </button>
                          </div>
                        ) : (
                          <div className="flex items-center gap-1">
                            <button
                              type="button"
                              onClick={() => {
                                onSelectConversation(conv.id);
                                onClose();
                              }}
                              className="flex-1 min-w-0 min-h-[52px] px-2.5 py-2 text-start cursor-pointer rounded-xl focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[var(--theme-accent-secondary)]"
                            >
                              <div className="flex items-baseline justify-between gap-2">
                                <span
                                  style={{
                                    color: isSelected
                                      ? 'var(--theme-accent-primary)'
                                      : 'var(--theme-text-title)',
                                  }}
                                  className="text-xs font-bold truncate"
                                >
                                  {conv.title}
                                </span>
                                {timeLabel && (
                                  <span className="text-[10px] text-[var(--theme-text-muted)] shrink-0 whitespace-nowrap">
                                    {timeLabel}
                                  </span>
                                )}
                              </div>
                              {preview && (
                                <p className="text-[11px] text-[var(--theme-text-muted)] truncate mt-0.5">
                                  {preview}
                                </p>
                              )}
                            </button>

                            <button
                              type="button"
                              aria-label={`${strings.chatActionsLabel}: ${conv.title}`}
                              aria-expanded={isMenuOpen}
                              aria-haspopup="menu"
                              onClick={(e) => {
                                e.stopPropagation();
                                setOpenMenuConvId((prev) => (prev === conv.id ? null : conv.id));
                              }}
                              className="min-w-[40px] min-h-[44px] rounded-xl flex items-center justify-center text-[var(--theme-text-muted)] hover:text-[var(--theme-text-title)] shrink-0 cursor-pointer focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[var(--theme-accent-secondary)]"
                            >
                              <MoreVertical className="w-4 h-4" />
                            </button>
                          </div>
                        )}

                        {/* Contextual 3-Dot Action Menu */}
                        {isMenuOpen && !isRenaming && (
                          <div
                            role="menu"
                            style={{
                              backgroundColor: 'var(--theme-header-bg)',
                              borderColor: 'var(--theme-card-border-glow)',
                            }}
                            className={`absolute top-11 z-20 min-w-[144px] rounded-xl border shadow-xl p-1 space-y-0.5 ${
                              isRtl ? 'left-2' : 'right-2'
                            }`}
                            onClick={(e) => e.stopPropagation()}
                          >
                            <button
                              type="button"
                              role="menuitem"
                              onClick={() => startRename(conv)}
                              className="w-full min-h-[40px] px-2.5 py-1.5 rounded-lg text-xs font-semibold text-[var(--theme-text-title)] hover:bg-[var(--theme-card-hover)] flex items-center gap-2 cursor-pointer"
                            >
                              <Pencil className="w-3.5 h-3.5 text-[var(--theme-accent-primary)] shrink-0" />
                              <span>{strings.rename}</span>
                            </button>
                            <button
                              type="button"
                              role="menuitem"
                              onClick={() => requestDelete(conv)}
                              className="w-full min-h-[40px] px-2.5 py-1.5 rounded-lg text-xs font-semibold text-rose-400 hover:bg-rose-500/15 flex items-center gap-2 cursor-pointer"
                            >
                              <Trash2 className="w-3.5 h-3.5 shrink-0" />
                              <span>{strings.delete}</span>
                            </button>
                          </div>
                        )}
                      </div>
                    );
                  })}
                </div>
              </section>
            ))
          )}
        </div>

        {/* Delete Confirmation Modal inside Drawer */}
        {pendingDeleteConv && (
          <div
            role="alertdialog"
            aria-modal="true"
            aria-labelledby="delete-chat-dialog-title"
            aria-describedby="delete-chat-dialog-desc"
            className="absolute inset-0 z-30 bg-black/65 backdrop-blur-xs flex items-center justify-center p-4"
            onClick={() => setPendingDeleteConv(null)}
          >
            <div
              ref={deleteDialogRef}
              style={{
                backgroundColor: 'var(--theme-header-bg)',
                borderColor: 'var(--theme-card-border-glow)',
              }}
              className="w-full max-w-[280px] rounded-2xl border p-4 shadow-2xl space-y-3"
              onClick={(e) => e.stopPropagation()}
            >
              <h4
                id="delete-chat-dialog-title"
                className="text-sm font-serif font-bold text-[var(--theme-text-title)]"
              >
                {strings.deleteConfirmTitle}
              </h4>
              <p
                id="delete-chat-dialog-desc"
                className="text-xs text-[var(--theme-text-body)] leading-relaxed"
              >
                <span className="font-semibold text-[var(--theme-accent-primary)] block mb-1 truncate">
                  {pendingDeleteConv.title}
                </span>
                {strings.deleteConfirmMessage}
              </p>
              <div className="flex items-center justify-end gap-2 pt-1">
                <button
                  id="btn-cancel-delete-chat"
                  ref={cancelDeleteBtnRef}
                  type="button"
                  onClick={() => setPendingDeleteConv(null)}
                  style={{
                    backgroundColor: 'var(--theme-card-bg-subtle)',
                    borderColor: 'var(--theme-card-border)',
                    color: 'var(--theme-text-title)',
                  }}
                  className="min-h-[44px] px-3.5 py-1.5 rounded-xl border text-xs font-semibold cursor-pointer"
                >
                  {strings.cancel}
                </button>
                <button
                  id="btn-confirm-delete-chat"
                  type="button"
                  onClick={confirmDelete}
                  className="min-h-[44px] px-3.5 py-1.5 rounded-xl bg-rose-600 hover:bg-rose-500 text-white text-xs font-bold cursor-pointer"
                >
                  {strings.confirmDelete}
                </button>
              </div>
            </div>
          </div>
        )}
      </aside>
    </div>
  );
};
