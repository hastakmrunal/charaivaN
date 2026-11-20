import React from 'react';
import { ArrowLeft, ArrowRight } from 'lucide-react';
import { Language } from '../types';
import { getLocalizedBackLabel } from '../data/localizedStrings';

interface BackButtonProps {
  onClick: () => void;
  selectedLanguage?: Pick<Language, 'code' | 'direction'> | null;
  id?: string;
  labelOverride?: string;
  ariaLabel?: string;
  title?: string;
  className?: string;
  compact?: boolean;
}

export const BackButton: React.FC<BackButtonProps> = ({
  onClick,
  selectedLanguage,
  id,
  labelOverride,
  ariaLabel,
  title,
  className = '',
  compact = false,
}) => {
  const isRtl = selectedLanguage?.direction === 'rtl';
  const label = labelOverride || getLocalizedBackLabel(selectedLanguage);
  const accessibleLabel = ariaLabel || label;

  return (
    <button
      id={id}
      type="button"
      onClick={onClick}
      aria-label={accessibleLabel}
      title={title || accessibleLabel}
      style={{
        backgroundColor: 'var(--theme-card-bg-subtle)',
        borderColor: 'var(--theme-card-border)',
        color: 'var(--theme-text-title)',
      }}
      className={`${
        compact
          ? 'min-h-[38px] px-2.5 sm:px-3 py-1'
          : 'min-h-[40px] sm:min-h-[44px] px-3 sm:px-3.5 py-1.5'
      } rounded-xl border text-xs font-bold inline-flex items-center gap-1.5 shrink-0 cursor-pointer transition-all active:scale-95 hover:border-[var(--theme-card-border-glow)] shadow-sm whitespace-nowrap select-none ${className}`}
    >
      {isRtl ? (
        <ArrowRight className="w-4 h-4 shrink-0 text-[var(--theme-accent-primary)]" />
      ) : (
        <ArrowLeft className="w-4 h-4 shrink-0 text-[var(--theme-accent-primary)]" />
      )}
      <span>{label}</span>
    </button>
  );
};
