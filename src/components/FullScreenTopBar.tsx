import React from 'react';
import { Home } from 'lucide-react';
import { Language } from '../types';
import { BackButton } from './BackButton';
import { getLocalizedHomeLabel } from '../data/localizedStrings';

export const SCREEN_PRIMARY_BACK_SELECTOR = [
  '#btn-chat-back-home',
  '#btn-camera-back-home',
  '#btn-city-back-home',
  '#btn-deep-conversation-back',
  '#btn-discover-back',
  '#btn-explanation-back',
  '#btn-settings-back-home',
  '#btn-history-back-home',
  '#btn-map-back-home',
  '#btn-nearby-back-home',
].join(',');

interface FullScreenTopBarProps {
  selectedLanguage: Pick<Language, 'code' | 'direction'>;
  onBack: () => void;
  onHome: () => void;
}

export const FullScreenTopBar: React.FC<FullScreenTopBarProps> = ({
  selectedLanguage,
  onBack,
  onHome,
}) => {
  const homeLabel = getLocalizedHomeLabel(selectedLanguage);

  return (
    <div
      id="charaiva-fullscreen-topbar"
      dir={selectedLanguage.direction === 'rtl' ? 'rtl' : 'ltr'}
      style={{
        backgroundColor: 'var(--theme-header-bg)',
        borderColor: 'var(--theme-card-border)',
        paddingTop: 'env(safe-area-inset-top)',
      }}
      className="shrink-0 -mx-1.5 flex items-center justify-between gap-2 px-2 py-1 border-b backdrop-blur-xl shadow-md"
    >
      <BackButton
        id="btn-fullscreen-back"
        onClick={onBack}
        selectedLanguage={selectedLanguage}
        className="!min-h-[44px]"
      />

      <button
        id="btn-fullscreen-home"
        type="button"
        onClick={onHome}
        aria-label={homeLabel}
        title={homeLabel}
        style={{
          backgroundColor: 'var(--theme-card-bg-subtle)',
          borderColor: 'var(--theme-card-border)',
          color: 'var(--theme-text-title)',
        }}
        className="min-h-[44px] px-3.5 py-1.5 rounded-xl border text-xs font-bold inline-flex items-center gap-1.5 shrink-0 cursor-pointer transition-all active:scale-95 hover:border-[var(--theme-card-border-glow)] shadow-sm whitespace-nowrap select-none"
      >
        <Home className="w-4 h-4 shrink-0 text-[var(--theme-accent-primary)]" />
        <span>{homeLabel}</span>
      </button>
    </div>
  );
};
