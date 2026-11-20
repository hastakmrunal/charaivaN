export const SUPPORTED_AUDIO_SPEEDS = [0.5, 0.75, 1, 1.25, 1.5, 1.75, 2] as const;

export type SupportedAudioSpeed = (typeof SUPPORTED_AUDIO_SPEEDS)[number];

export const DEFAULT_AUDIO_SPEED: SupportedAudioSpeed = 1;

/**
 * Normalizes any persisted or user-supplied speed value to the closest
 * supported playback speed in [0.5, 0.75, 1, 1.25, 1.5, 1.75, 2].
 */
export function normalizeAudioSpeed(value: unknown): SupportedAudioSpeed {
  const num = typeof value === 'number' ? value : Number(value);
  if (!Number.isFinite(num) || num <= 0) {
    return DEFAULT_AUDIO_SPEED;
  }

  const clamped = Math.min(2, Math.max(0.5, num));
  let closest: SupportedAudioSpeed = DEFAULT_AUDIO_SPEED;
  let minDiff = Infinity;

  for (const candidate of SUPPORTED_AUDIO_SPEEDS) {
    const diff = Math.abs(clamped - candidate);
    if (diff < minDiff - 1e-9 || (Math.abs(diff - minDiff) <= 1e-9 && candidate === DEFAULT_AUDIO_SPEED)) {
      minDiff = diff;
      closest = candidate;
    }
  }

  return closest;
}

export function formatAudioSpeedLabel(
  speed: number,
  options?: { withNormal?: boolean }
): string {
  const normalized = normalizeAudioSpeed(speed);
  if (options?.withNormal && normalized === 1) {
    return '1× (Normal)';
  }
  return `${normalized}×`;
}

/**
 * Safely applies playbackRate to an HTMLMediaElement-like target without
 * throwing on engines with stricter playbackRate guards.
 */
export function applyHtmlAudioPlaybackRate(
  target: { playbackRate: number } | null | undefined,
  rate: number
): boolean {
  if (!target) return false;
  const normalized = normalizeAudioSpeed(rate);
  try {
    target.playbackRate = normalized;
    return true;
  } catch {
    try {
      target.playbackRate = DEFAULT_AUDIO_SPEED;
    } catch {
      // ignore fallback assignment error
    }
    return false;
  }
}
