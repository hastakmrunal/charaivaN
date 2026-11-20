import { useEffect, useLayoutEffect, useRef } from 'react';
import { AppTab, DeepConversationContext, RecognitionResult } from '../types';

export type ReplayScreenMode = 'intro' | 'tour' | 'login';

export type ScreenRoute =
  | { kind: 'tab'; tab: AppTab }
  | { kind: 'explanation'; originTab: AppTab; landmark: RecognitionResult }
  | { kind: 'deep_conversation'; originTab: AppTab; context: DeepConversationContext }
  | { kind: 'replay'; mode: ReplayScreenMode };

const MAX_HISTORY_STACK_LENGTH = 25;

export function getRouteTab(route: ScreenRoute): AppTab {
  if (route.kind === 'tab') return route.tab;
  if (route.kind === 'explanation' || route.kind === 'deep_conversation') return route.originTab;
  return 'home';
}

export function getRouteKey(route: ScreenRoute): string {
  if (route.kind === 'tab') return `tab:${route.tab}`;
  if (route.kind === 'explanation') return `explanation:${route.originTab}:${route.landmark.id}`;
  if (route.kind === 'deep_conversation') {
    return `deep_conversation:${route.originTab}:${route.context.landmark.id}:${route.context.selectedExploreTopic?.id || 'general'}`;
  }
  return `replay:${route.mode}`;
}

export function sameScreenRoute(a: ScreenRoute | undefined, b: ScreenRoute | undefined): boolean {
  if (!a || !b) return false;
  if (a.kind !== b.kind) return false;
  if (a.kind === 'tab' && b.kind === 'tab') return a.tab === b.tab;
  if (a.kind === 'replay' && b.kind === 'replay') return a.mode === b.mode;
  if (a.kind === 'explanation' && b.kind === 'explanation') {
    return a.originTab === b.originTab && a.landmark.id === b.landmark.id;
  }
  if (a.kind === 'deep_conversation' && b.kind === 'deep_conversation') {
    return (
      a.originTab === b.originTab &&
      a.context.landmark.id === b.context.landmark.id &&
      (a.context.selectedExploreTopic?.id || '') === (b.context.selectedExploreTopic?.id || '')
    );
  }
  return false;
}

export function createInitialScreenStack(initialTab: AppTab): ScreenRoute[] {
  const homeRoot: ScreenRoute = { kind: 'tab', tab: 'home' };
  if (initialTab === 'home') {
    return [homeRoot];
  }
  return [homeRoot, { kind: 'tab', tab: initialTab }];
}

export function pushScreenRoute(stack: ScreenRoute[], nextRoute: ScreenRoute): ScreenRoute[] {
  const safeBase: ScreenRoute[] = stack.length > 0 ? stack : [{ kind: 'tab', tab: 'home' }];

  // Exploring Home resets stack cleanly so Home remains the unambiguous root screen
  if (nextRoute.kind === 'tab' && nextRoute.tab === 'home') {
    return [nextRoute];
  }

  const currentTop = safeBase[safeBase.length - 1];
  if (sameScreenRoute(currentTop, nextRoute)) {
    // Allow updating landmark or deep_conversation payload cleanly
    if (
      (nextRoute.kind === 'explanation' && currentTop.kind === 'explanation') ||
      (nextRoute.kind === 'deep_conversation' && currentTop.kind === 'deep_conversation')
    ) {
      const updated = [...safeBase];
      updated[updated.length - 1] = nextRoute;
      return updated;
    }
    return safeBase;
  }

  const next = [...safeBase, nextRoute];
  if (next.length > MAX_HISTORY_STACK_LENGTH) {
    // Always preserve the root entry at index 0
    return [next[0], ...next.slice(next.length - (MAX_HISTORY_STACK_LENGTH - 1))];
  }
  return next;
}

export function replaceTopScreenRoute(stack: ScreenRoute[], nextRoute: ScreenRoute): ScreenRoute[] {
  const safeBase: ScreenRoute[] = stack.length > 0 ? stack : [{ kind: 'tab', tab: 'home' }];
  if (nextRoute.kind === 'tab' && nextRoute.tab === 'home') {
    return [nextRoute];
  }
  if (safeBase.length === 1) {
    // Never replace the anchor root with a non-home route; push so Back returns to root Home
    return pushScreenRoute(safeBase, nextRoute);
  }
  const next = [...safeBase];
  next[next.length - 1] = nextRoute;
  return next;
}

export function popScreenRoute(stack: ScreenRoute[]): {
  nextStack: ScreenRoute[];
  poppedRoute: ScreenRoute | null;
  didPop: boolean;
} {
  if (stack.length <= 1) {
    return {
      nextStack: stack.length === 1 ? stack : [{ kind: 'tab', tab: 'home' }],
      poppedRoute: null,
      didPop: false,
    };
  }
  const poppedRoute = stack[stack.length - 1];
  return {
    nextStack: stack.slice(0, -1),
    poppedRoute,
    didPop: true,
  };
}

// ============================================================================
// Centralized LIFO Overlay / Modal / Nested Sub-View Back Layer Registry
// ============================================================================

interface InternalBackLayer {
  id: string;
  priority: number;
  seq: number;
  dismiss: () => void;
}

class BackLayerRegistry {
  private layers = new Map<string, InternalBackLayer>();
  private listeners = new Set<() => void>();
  private nextSeq = 1;

  subscribe(listener: () => void): () => void {
    this.listeners.add(listener);
    return () => {
      this.listeners.delete(listener);
    };
  }

  private emit() {
    this.listeners.forEach((fn) => {
      try {
        fn();
      } catch {
        // ignore subscriber errors
      }
    });
  }

  register(id: string, dismiss: () => void, priority = 50): () => void {
    const existing = this.layers.get(id);
    const seq = existing ? existing.seq : this.nextSeq++;
    this.layers.set(id, { id, priority, seq, dismiss });
    this.emit();

    return () => {
      const current = this.layers.get(id);
      if (current && current.seq === seq) {
        this.layers.delete(id);
        this.emit();
      }
    };
  }

  updateHandler(id: string, dismiss: () => void, priority = 50): void {
    const existing = this.layers.get(id);
    if (existing) {
      existing.dismiss = dismiss;
      existing.priority = priority;
    }
  }

  hasActive(minPriority = 0): boolean {
    for (const layer of this.layers.values()) {
      if (layer.priority >= minPriority) return true;
    }
    return false;
  }

  getActiveIds(minPriority = 0): string[] {
    return this.getSorted(minPriority).map((l) => l.id);
  }

  private getSorted(minPriority = 0): InternalBackLayer[] {
    return Array.from(this.layers.values())
      .filter((l) => l.priority >= minPriority)
      .sort((a, b) => {
        if (b.priority !== a.priority) return b.priority - a.priority;
        return b.seq - a.seq;
      });
  }

  dismissTop(minPriority = 0): boolean {
    const sorted = this.getSorted(minPriority);
    if (sorted.length === 0) return false;
    const top = sorted[0];
    top.dismiss();
    return true;
  }

  clear(): void {
    if (this.layers.size > 0) {
      this.layers.clear();
      this.emit();
    }
  }
}

export const backLayerRegistry = new BackLayerRegistry();

/**
 * Registers an open modal, popup, lightbox, dropdown, or nested step with the
 * centralized LIFO Back / Escape handler stack while `enabled` is true.
 *
 * Suggested priorities:
 * - 100: Global Language Picker modal
 * - 95: Header Theme dropdown
 * - 90: City Guide Dossier modal
 * - 75: Image Zoom Lightbox / Fullscreen Photo Viewer
 * - 65: Deep Dive Dossier modal
 * - 60: Feature Detail Modal / Add-Edit Journal Entry Modal
 * - 50: Inline Confirmation Prompt
 * - 40: Inline Form Drawer / Profile Editor
 * - 20–25: Screen Nested State (Live Camera, Scan Result, Login Step 2)
 * - 10: Initial Onboarding Previous Step (Tour -> Intro, Login -> Tour)
 */
export function useBackLayer(
  id: string,
  enabled: boolean,
  onDismiss: () => void,
  priority = 50
): void {
  const dismissRef = useRef(onDismiss);
  dismissRef.current = onDismiss;

  useEffect(() => {
    if (!enabled) return;
    return backLayerRegistry.register(
      id,
      () => {
        dismissRef.current();
      },
      priority
    );
  }, [id, enabled, priority]);
}

// ============================================================================
// Per-View Scroll Position Preservation
// ============================================================================

const scrollPositions = new Map<string, number>();

export function saveScrollPosition(viewKey: string, scrollTop: number): void {
  if (!viewKey) return;
  scrollPositions.set(viewKey, Math.max(0, scrollTop));
}

export function getScrollPosition(viewKey: string): number {
  return scrollPositions.get(viewKey) ?? 0;
}

export function clearScrollPosition(viewKey: string): void {
  scrollPositions.delete(viewKey);
}

/**
 * Attaches a ref to a scrollable container to preserve scroll offset across
 * keep-alive visibility toggles (`display: none` resets scrollTop in Chromium)
 * and forward/back transitions.
 */
export function usePreservedScroll<T extends HTMLElement = HTMLDivElement>(
  viewKey: string,
  isActive = true
) {
  const scrollRef = useRef<T | null>(null);
  const wasActiveRef = useRef(isActive);
  const lastViewKeyRef = useRef(viewKey);

  useEffect(() => {
    const el = scrollRef.current;
    if (!el) return;
    const handleScroll = () => {
      if (isActive && el.clientHeight > 0 && el.offsetParent !== null) {
        saveScrollPosition(viewKey, el.scrollTop);
      }
    };
    el.addEventListener('scroll', handleScroll, { passive: true });
    return () => {
      el.removeEventListener('scroll', handleScroll);
    };
  }, [viewKey, isActive]);

  useLayoutEffect(() => {
    const el = scrollRef.current;
    if (!el) return;
    const prevActive = wasActiveRef.current;
    const viewKeyChanged = lastViewKeyRef.current !== viewKey;
    wasActiveRef.current = isActive;
    lastViewKeyRef.current = viewKey;

    if (!isActive) return;
    // React keeps tab screens mounted but hides inactive wrappers. Restoring a
    // previous offset while that wrapper is hidden (or after its scrollable
    // height has shrunk) can strand content outside the visible area.
    if (prevActive && !viewKeyChanged) return;

    const savedTop = getScrollPosition(viewKey);
    let cancelled = false;
    let userInteracted = false;
    const stopRestore = () => { userInteracted = true; };
    el.addEventListener('wheel', stopRestore, { passive: true });
    el.addEventListener('touchstart', stopRestore, { passive: true });
    el.addEventListener('pointerdown', stopRestore, { passive: true });
    el.addEventListener('keydown', stopRestore);

    const restoreOnceVisible = () => {
      if (cancelled || userInteracted || !el.isConnected) return;
      // Do not measure or restore while an ancestor is display:none.
      if (el.getClientRects().length === 0 || el.clientHeight <= 0) return;
      const maxTop = Math.max(0, el.scrollHeight - el.clientHeight);
      el.scrollTop = Math.min(Math.max(0, savedTop), maxTop);
    };

    // The first frame allows the newly active tab to finish layout. The second
    // covers browsers whose flex layout settles one frame later. Unlike the
    // previous ResizeObserver loop, this never keeps reapplying stale offsets
    // after the user begins scrolling or content changes asynchronously.
    restoreOnceVisible();
    let nextFrame = 0;
    const firstFrame = window.requestAnimationFrame(() => {
      restoreOnceVisible();
      nextFrame = window.requestAnimationFrame(restoreOnceVisible);
    });

    return () => {
      cancelled = true;
      window.cancelAnimationFrame(firstFrame);
      window.cancelAnimationFrame(nextFrame);
      el.removeEventListener('wheel', stopRestore);
      el.removeEventListener('touchstart', stopRestore);
      el.removeEventListener('pointerdown', stopRestore);
      el.removeEventListener('keydown', stopRestore);
    };
  }, [viewKey, isActive]);

  return scrollRef;
}
