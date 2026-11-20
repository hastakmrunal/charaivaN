import React, { useCallback, useEffect, useId, useLayoutEffect, useRef, useState } from 'react';
import { createPortal } from 'react-dom';
import { Check, ChevronDown, RotateCcw } from 'lucide-react';
import {
  DEFAULT_AUDIO_SPEED,
  SUPPORTED_AUDIO_SPEEDS,
  SupportedAudioSpeed,
  formatAudioSpeedLabel,
  normalizeAudioSpeed,
} from '../utils/audioSpeed';
import { useBackLayer } from '../utils/navigationHistory';

interface AudioSpeedControlProps {
  speed?: number;
  onChangeSpeed?: (nextSpeed: SupportedAudioSpeed) => void;
  compact?: boolean;
  isRtl?: boolean;
  disabled?: boolean;
  placement?: 'auto' | 'top' | 'bottom';
  tone?: 'card' | 'subtle';
  className?: string;
  id?: string;
}

interface MenuCoords {
  top?: number;
  bottom?: number;
  left: number;
  maxHeight: number;
}

const MENU_WIDTH = 152;
const ESTIMATED_MENU_HEIGHT = 276;

export const AudioSpeedControl: React.FC<AudioSpeedControlProps> = ({
  speed = DEFAULT_AUDIO_SPEED,
  onChangeSpeed,
  compact = false,
  isRtl = false,
  disabled = false,
  placement = 'auto',
  tone = 'card',
  className = '',
  id,
}) => {
  const normalizedSpeed = normalizeAudioSpeed(speed);
  const isCustomSpeed = normalizedSpeed !== DEFAULT_AUDIO_SPEED;
  const instanceId = useId();
  const [isOpen, setIsOpen] = useState(false);
  const [menuCoords, setMenuCoords] = useState<MenuCoords | null>(null);

  const triggerRef = useRef<HTMLButtonElement | null>(null);
  const menuRef = useRef<HTMLDivElement | null>(null);

  const closeMenu = useCallback(() => {
    setIsOpen(false);
  }, []);

  useBackLayer(`audio-speed-menu:${instanceId}`, isOpen, closeMenu, 85);

  const updatePosition = useCallback(() => {
    const trigger = triggerRef.current;
    if (!trigger || typeof window === 'undefined') return;

    const rect = trigger.getBoundingClientRect();
    const vw = window.innerWidth;
    const vh = window.innerHeight;
    const spaceBelow = vh - rect.bottom - 8;
    const spaceAbove = rect.top - 8;

    const shouldPlaceTop =
      placement === 'top' ||
      (placement === 'auto' && spaceBelow < ESTIMATED_MENU_HEIGHT && spaceAbove > spaceBelow);

    const rawLeft = isRtl ? rect.left : rect.right - MENU_WIDTH;
    const clampedLeft = Math.max(8, Math.min(vw - MENU_WIDTH - 8, rawLeft));

    if (shouldPlaceTop) {
      setMenuCoords({
        bottom: Math.max(8, vh - rect.top + 6),
        left: clampedLeft,
        maxHeight: Math.max(150, Math.min(310, spaceAbove)),
      });
    } else {
      setMenuCoords({
        top: Math.max(8, rect.bottom + 6),
        left: clampedLeft,
        maxHeight: Math.max(150, Math.min(310, spaceBelow)),
      });
    }
  }, [isRtl, placement]);

  useLayoutEffect(() => {
    if (!isOpen) return;
    updatePosition();
  }, [isOpen, updatePosition]);

  useEffect(() => {
    if (!isOpen) return;

    const handlePointerDown = (event: PointerEvent) => {
      const target = event.target as Node | null;
      if (!target) return;
      if (triggerRef.current?.contains(target) || menuRef.current?.contains(target)) {
        return;
      }
      setIsOpen(false);
    };

    const handleViewportChange = (event?: Event) => {
      if (event && event.type === 'scroll' && menuRef.current && event.target instanceof Node) {
        if (menuRef.current.contains(event.target)) return;
      }
      setIsOpen(false);
    };

    document.addEventListener('pointerdown', handlePointerDown);
    window.addEventListener('resize', handleViewportChange);
    window.addEventListener('scroll', handleViewportChange, true);

    return () => {
      document.removeEventListener('pointerdown', handlePointerDown);
      window.removeEventListener('resize', handleViewportChange);
      window.removeEventListener('scroll', handleViewportChange, true);
    };
  }, [isOpen]);

  const handleSelectSpeed = (nextSpeed: SupportedAudioSpeed, e: React.MouseEvent) => {
    e.stopPropagation();
    onChangeSpeed?.(nextSpeed);
    setIsOpen(false);
  };

  const triggerStyle: React.CSSProperties = {
    backgroundColor: tone === 'subtle' ? 'var(--theme-card-bg-subtle)' : 'var(--theme-card-bg)',
    borderColor: isOpen || isCustomSpeed ? 'var(--theme-accent-primary)' : 'var(--theme-card-border)',
    color: isCustomSpeed ? 'var(--theme-accent-primary)' : 'var(--theme-text-title)',
  };

  const sizeClasses = compact
    ? 'min-h-[32px] px-2 py-1 text-[10.5px] rounded-lg gap-0.5'
    : 'min-h-[38px] px-2.5 py-1.5 text-[11px] rounded-xl gap-1';

  return (
    <>
      <button
        ref={triggerRef}
        id={id}
        type="button"
        disabled={disabled}
        onClick={(e) => {
          e.stopPropagation();
          if (disabled) return;
          setIsOpen((prev) => !prev);
        }}
        aria-haspopup="listbox"
        aria-expanded={isOpen}
        aria-label={`Audio playback speed (${formatAudioSpeedLabel(normalizedSpeed, { withNormal: true })})`}
        title={`Playback speed: ${formatAudioSpeedLabel(normalizedSpeed, { withNormal: true })}`}
        style={triggerStyle}
        className={`inline-flex items-center justify-center border font-bold whitespace-nowrap shrink-0 cursor-pointer transition-all hover:border-[var(--theme-card-border-glow)] active:scale-95 disabled:opacity-50 disabled:cursor-not-allowed select-none ${sizeClasses} ${className}`}
      >
        <span>{formatAudioSpeedLabel(normalizedSpeed)}</span>
        <ChevronDown
          className={`w-3 h-3 shrink-0 opacity-80 transition-transform ${isOpen ? 'rotate-180' : ''}`}
        />
      </button>

      {isOpen &&
        menuCoords &&
        typeof document !== 'undefined' &&
        createPortal(
          <div
            ref={menuRef}
            role="listbox"
            aria-label="Select audio playback speed"
            dir={isRtl ? 'rtl' : 'ltr'}
            onClick={(e) => e.stopPropagation()}
            style={{
              position: 'fixed',
              top: menuCoords.top,
              bottom: menuCoords.bottom,
              left: menuCoords.left,
              width: MENU_WIDTH,
              maxHeight: menuCoords.maxHeight,
              zIndex: 9999,
              backgroundColor: 'var(--theme-card-bg)',
              borderColor: 'var(--theme-card-border-glow)',
              color: 'var(--theme-text-title)',
            }}
            className="rounded-2xl border shadow-2xl backdrop-blur-xl p-1.5 overflow-y-auto space-y-1 animate-fadeIn select-none"
          >
            <div className="flex items-center justify-between gap-1 px-2 py-1 border-b border-[var(--theme-card-border)]">
              <span className="text-[10px] font-bold uppercase tracking-wider text-[var(--theme-text-muted)]">
                Speed
              </span>
              {isCustomSpeed && (
                <button
                  type="button"
                  onClick={(e) => handleSelectSpeed(DEFAULT_AUDIO_SPEED, e)}
                  className="text-[10px] font-bold text-[var(--theme-accent-primary)] hover:underline inline-flex items-center gap-0.5 cursor-pointer"
                  title="Reset speed to Normal (1×)"
                >
                  <RotateCcw className="w-2.5 h-2.5" />
                  <span>1×</span>
                </button>
              )}
            </div>

            <div className="space-y-0.5">
              {SUPPORTED_AUDIO_SPEEDS.map((option) => {
                const isSelected = option === normalizedSpeed;
                return (
                  <button
                    key={option}
                    type="button"
                    role="option"
                    aria-selected={isSelected}
                    onClick={(e) => handleSelectSpeed(option, e)}
                    style={
                      isSelected
                        ? {
                            background: 'var(--theme-accent-primary-gradient)',
                            color: 'var(--theme-accent-primary-text)',
                          }
                        : {
                            backgroundColor: 'transparent',
                            color: 'var(--theme-text-title)',
                          }
                    }
                    className={`w-full px-2.5 py-1.5 rounded-xl text-xs font-bold flex items-center justify-between gap-2 cursor-pointer transition-colors ${
                      isSelected ? 'shadow-sm' : 'hover:bg-white/10'
                    }`}
                  >
                    <span className="flex items-center gap-1.5">
                      <span>{formatAudioSpeedLabel(option)}</span>
                      {option === DEFAULT_AUDIO_SPEED && (
                        <span
                          className={`text-[10px] font-medium ${
                            isSelected ? 'opacity-90' : 'text-[var(--theme-text-muted)]'
                          }`}
                        >
                          Normal
                        </span>
                      )}
                    </span>
                    {isSelected && <Check className="w-3.5 h-3.5 shrink-0" />}
                  </button>
                );
              })}
            </div>
          </div>,
          document.body
        )}
    </>
  );
};

interface AudioSpeedSettingsControlProps {
  speed?: number;
  onChangeSpeed: (nextSpeed: SupportedAudioSpeed) => void;
}

export const AudioSpeedSettingsControl: React.FC<AudioSpeedSettingsControlProps> = ({
  speed = DEFAULT_AUDIO_SPEED,
  onChangeSpeed,
}) => {
  const normalizedSpeed = normalizeAudioSpeed(speed);
  const isNormal = normalizedSpeed === DEFAULT_AUDIO_SPEED;

  return (
    <div className="space-y-2">
      <div className="flex items-center justify-between gap-2 flex-wrap">
        <div className="flex items-center gap-2 text-xs">
          <span className="text-[var(--theme-text-muted)]">Speech Pace (Speed):</span>
          <span className="font-bold text-[var(--theme-accent-primary)]">
            {formatAudioSpeedLabel(normalizedSpeed, { withNormal: true })}
          </span>
        </div>

        <button
          id="btn-settings-reset-speech-speed"
          type="button"
          disabled={isNormal}
          onClick={() => onChangeSpeed(DEFAULT_AUDIO_SPEED)}
          style={{
            backgroundColor: 'var(--theme-card-bg-subtle)',
            borderColor: isNormal ? 'var(--theme-card-border)' : 'var(--theme-accent-primary)',
            color: isNormal ? 'var(--theme-text-muted)' : 'var(--theme-accent-primary)',
          }}
          className="px-2.5 py-1 rounded-lg border text-[11px] font-bold inline-flex items-center gap-1 cursor-pointer transition-all hover:border-[var(--theme-card-border-glow)] disabled:opacity-50 disabled:cursor-default"
        >
          <RotateCcw className="w-3 h-3" />
          <span>Reset to Normal (1×)</span>
        </button>
      </div>

      <div
        role="radiogroup"
        aria-label="Audio playback speed"
        className="grid grid-cols-4 sm:grid-cols-7 gap-1.5"
      >
        {SUPPORTED_AUDIO_SPEEDS.map((option) => {
          const isSelected = option === normalizedSpeed;
          return (
            <button
              key={option}
              type="button"
              role="radio"
              aria-checked={isSelected}
              onClick={() => onChangeSpeed(option)}
              style={
                isSelected
                  ? {
                      background: 'var(--theme-accent-primary-gradient)',
                      borderColor: 'transparent',
                      color: 'var(--theme-accent-primary-text)',
                    }
                  : {
                      backgroundColor: 'var(--theme-card-bg-subtle)',
                      borderColor: 'var(--theme-card-border)',
                      color: 'var(--theme-text-body)',
                    }
              }
              className={`min-h-[36px] px-2 py-1.5 rounded-xl border text-xs font-bold transition-all cursor-pointer flex items-center justify-center ${
                isSelected
                  ? 'shadow-md'
                  : 'hover:border-[var(--theme-card-border-glow)] hover:text-[var(--theme-text-title)]'
              }`}
            >
              {formatAudioSpeedLabel(option)}
            </button>
          );
        })}
      </div>
    </div>
  );
};
