import {
  AddIcon,
  Button,
  CloseIcon,
  LoadingIcon,
  cn
} from "@tutti-os/ui-system";
import { useExternalStoreSnapshot } from "@tutti-os/ui-react-hooks";
import { useCallback, useEffect, useRef, useState } from "react";
import type { HTMLAttributes, JSX, ReactNode } from "react";
import type {
  WorkbenchDisplayMode,
  WorkbenchHostActivation
} from "@tutti-os/workbench-surface";
import type { BrowserNodeFeature } from "../core/feature.ts";
import { createBrowserTabId } from "../core/tabStore.ts";
import type { BrowserNodeTabsState } from "../core/tabStore.ts";
import type {
  BrowserNodeNavigationPolicy,
  BrowserNodeSessionMode
} from "../core/types.ts";
import { BrowserNode, BrowserNodeWorkbenchHeader } from "./BrowserNode.tsx";

interface BrowserTabsOpenUrlPayload {
  asTab?: boolean;
  url?: string;
}

export interface BrowserTabsNodeBodyProps {
  activation?: WorkbenchHostActivation | null;
  defaultUrl: string;
  feature: BrowserNodeFeature;
  navigationPolicy?: BrowserNodeNavigationPolicy | null;
  newTabUrl: string;
  nodeId: string;
  onClearActivation?: (sequence: number) => void;
  onCloseRequest?: () => void;
  onFocusRequest?: () => void;
  onNavigated?: (url: string) => void;
  profileId?: string | null;
  restoreTabs?: { url: string }[];
  sessionMode?: BrowserNodeSessionMode;
  sessionPartition?: string | null;
}

function useBrowserTabsState(
  feature: BrowserNodeFeature,
  containerId: string
): BrowserNodeTabsState {
  return useExternalStoreSnapshot<BrowserNodeTabsState>({
    getSnapshot() {
      return feature.tabStore.getState(containerId);
    },
    subscribe(listener) {
      return feature.tabStore.subscribe(listener);
    }
  });
}

export function BrowserTabsNode({
  activation = null,
  defaultUrl,
  feature,
  navigationPolicy = null,
  newTabUrl,
  nodeId,
  onClearActivation,
  onCloseRequest,
  onFocusRequest,
  onNavigated,
  profileId = null,
  restoreTabs,
  sessionMode = "shared",
  sessionPartition = null
}: BrowserTabsNodeBodyProps): JSX.Element {
  const tabs = useBrowserTabsState(feature, nodeId);
  const runtimeSnapshot = useExternalStoreSnapshot({
    getSnapshot() {
      return feature.runtimeStore.getSnapshot();
    },
    subscribe(listener) {
      return feature.runtimeStore.subscribe(listener);
    }
  });

  // Seed tabs.  On first mount `restoreTabs` replays the full tab strip from
  // persisted state; otherwise a single default tab is created.  Idempotent
  // — a no-op once any tab exists, so it survives minimize / restore.
  useEffect(() => {
    if (feature.tabStore.getState(nodeId).tabs.length > 0) return;

    if (restoreTabs && restoreTabs.length > 0) {
      for (const t of restoreTabs) {
        // All opened with activate: false — the first tab auto-activates via
        // the store's null-activeTabId fallback.
        feature.tabStore.openTab(nodeId, t.url, { activate: false });
      }
    } else {
      feature.tabStore.ensureContainer(nodeId, defaultUrl);
    }
  }, [defaultUrl, feature, nodeId, restoreTabs]);

  // Stabilise callbacks so BrowserNode children do not re-render (and
  // re-register their webview guests) on every tab-store change.
  const onFocusRequestRef = useRef(onFocusRequest);
  onFocusRequestRef.current = onFocusRequest;
  const stableOnFocusRequest = useCallback(() => {
    onFocusRequestRef.current?.();
  }, []);

  const onNavigatedRef = useRef(onNavigated);
  onNavigatedRef.current = onNavigated;

  // ---- Stable pane order --------------------------------------------------
  // Electron destroys the native `<webview>` when its DOM node moves, so we
  // keep panes in insertion order (append-only, remove on close).
  const paneOrderRef = useRef<string[]>([]);

  const liveIds = new Set(tabs.tabs.map((t) => t.tabId));
  paneOrderRef.current = paneOrderRef.current.filter((id) => liveIds.has(id));
  for (const tab of tabs.tabs) {
    if (!paneOrderRef.current.includes(tab.tabId)) {
      paneOrderRef.current.push(tab.tabId);
    }
  }

  const orderedPanes = paneOrderRef.current.flatMap((id) => {
    const tab = tabs.tabs.find((t) => t.tabId === id);
    return tab ? [tab] : [];
  });

  // The initial activation is already reflected in `defaultUrl`/the seeded first
  // tab, so treat its sequence as handled and only react to later activations.
  const handledActivationSequence = useRef<number | null>(
    activation?.sequence ?? null
  );
  useEffect(() => {
    if (!activation || activation.type !== "open-url") {
      return;
    }
    if (handledActivationSequence.current === activation.sequence) {
      return;
    }
    handledActivationSequence.current = activation.sequence;
    onClearActivation?.(activation.sequence);

    const payload = (activation.payload ?? {}) as BrowserTabsOpenUrlPayload;
    const url = payload.url?.trim();
    if (!url) {
      return;
    }

    const state = feature.tabStore.getState(nodeId);
    if (state.tabs.length === 0) {
      feature.tabStore.ensureContainer(nodeId, url);
      return;
    }
    if (payload.asTab) {
      // In-page link / window.open: open as a new foreground tab.
      feature.tabStore.openTab(nodeId, url);
      return;
    }
    // External "open in browser" reuse keeps its old semantics: navigate the
    // currently active tab rather than spawning a separate window.
    if (state.activeTabId) {
      void feature.hostApi
        .navigate({ navigationPolicy, nodeId: state.activeTabId, url })
        .catch(() => undefined);
    }
  }, [activation, feature, navigationPolicy, nodeId, onClearActivation]);

  const handleSelectTab = useCallback(
    (tabId: string) => {
      feature.tabStore.activateTab(nodeId, tabId);
      onFocusRequest?.();
    },
    [feature, nodeId, onFocusRequest]
  );
  const handleCloseTab = useCallback(
    (tabId: string) => {
      const before = feature.tabStore.getState(nodeId).tabs.length;
      feature.tabStore.closeTab(nodeId, tabId);
      feature.runtimeStore.clearNode(tabId);
      if (before <= 1) {
        // Closing the last tab closes the Browser window.
        onCloseRequest?.();
      }
    },
    [feature, nodeId, onCloseRequest]
  );
  const handleNewTab = useCallback(() => {
    feature.tabStore.openTab(nodeId, newTabUrl);
    onFocusRequest?.();
  }, [feature, newTabUrl, nodeId, onFocusRequest]);
  const handleReorderTab = useCallback(
    (draggedTabId: string, targetTabId: string) => {
      if (draggedTabId === targetTabId) {
        return;
      }
      const targetIndex = feature.tabStore
        .getState(nodeId)
        .tabs.findIndex((tab) => tab.tabId === targetTabId);
      if (targetIndex >= 0) {
        feature.tabStore.moveTab(nodeId, draggedTabId, targetIndex);
      }
    },
    [feature, nodeId]
  );

  return (
    <div className="flex h-full min-h-0 flex-col overflow-hidden bg-[var(--background-panel)]">
      <BrowserTabStrip
        activeTabId={tabs.activeTabId}
        feature={feature}
        onCloseTab={handleCloseTab}
        onNewTab={handleNewTab}
        onReorderTab={handleReorderTab}
        onSelectTab={handleSelectTab}
        runtimeSnapshot={runtimeSnapshot}
        tabs={tabs}
      />
      {/* `isolate` keeps the active/inactive pane z-index from escaping into the
          workbench window stacking context and covering its resize handles. */}
      <div className="relative isolate min-h-0 flex-1 overflow-hidden bg-[var(--background-panel)]">
        {orderedPanes.map((tab) => {
          const isActive = tab.tabId === tabs.activeTabId;
          return (
            <div
              key={tab.tabId}
              aria-hidden={!isActive}
              className={cn(
                "absolute inset-0",
                isActive ? "z-10" : "invisible pointer-events-none"
              )}
            >
              <BrowserNode
                defaultUrl={tab.initialUrl}
                feature={feature}
                navigationPolicy={navigationPolicy}
                nodeId={tab.tabId}
                onFocusRequest={stableOnFocusRequest}
                onNavigated={
                  isActive
                    ? (url: string) => onNavigatedRef.current?.(url)
                    : undefined
                }
                profileId={profileId}
                sessionMode={sessionMode}
                sessionPartition={sessionPartition}
                showHeader={false}
              />
            </div>
          );
        })}
      </div>
    </div>
  );
}

const TAB_GAP_PX = 2; // gap-0.5 – keep in sync with the tab-list gap class
/** Pixels the pointer must move before a mousedown turns into a drag. */
const DRAG_THRESHOLD_PX = 4;

function resolveFaviconUrl(
  url: string | null | undefined
): string | null {
  if (!url) return null;
  try {
    const hostname = new URL(url).hostname;
    if (!hostname) return null;
    return `https://www.google.com/s2/favicons?domain=${hostname}&sz=32`;
  } catch {
    return null;
  }
}

interface TabDrag {
  tabId: string;
  startIndex: number;
  originX: number;
  currentX: number;
  /** Actual tab width + gap measured from the DOM, so drag re-targeting
   *  stays correct when tabs have flex-shrunk below 200 px. */
  tabStep: number;
}

function resolveDragTargetIndex(drag: TabDrag, tabCount: number): number {
  const offset = drag.currentX - drag.originX;
  const raw = drag.startIndex + Math.round(offset / drag.tabStep);
  return Math.max(0, Math.min(tabCount - 1, raw));
}

function BrowserTabStrip({
  activeTabId,
  feature,
  onCloseTab,
  onNewTab,
  onReorderTab,
  onSelectTab,
  runtimeSnapshot,
  tabs
}: {
  activeTabId: string | null;
  feature: BrowserNodeFeature;
  onCloseTab: (tabId: string) => void;
  onNewTab: () => void;
  onReorderTab: (draggedTabId: string, targetTabId: string) => void;
  onSelectTab: (tabId: string) => void;
  runtimeSnapshot: ReturnType<
    BrowserNodeFeature["runtimeStore"]["getSnapshot"]
  >;
  tabs: BrowserNodeTabsState;
}): JSX.Element {
  const fallbackLabel = feature.i18n.t("tabs.untitled");

  // ---- drag state ---------------------------------------------------------
  // `drag` triggers re-renders for CSS transforms.  It is only non-null once
  // the pointer has moved past DRAG_THRESHOLD_PX.
  const [drag, setDrag] = useState<TabDrag | null>(null);
  // After the user releases the mouse the tabs must snap to their final
  // positions *without* a CSS transition, otherwise the 180 ms animation from
  // the drag offset back to 0 produces visible jitter.  The flag is cleared
  // on the next animation frame so transitions are back for later updates
  // (e.g. hover / active changes).
  const [dragJustEnded, setDragJustEnded] = useState(false);
  useEffect(() => {
    if (!dragJustEnded) return;
    const raf = requestAnimationFrame(() => setDragJustEnded(false));
    return () => cancelAnimationFrame(raf);
  }, [dragJustEnded]);

  // Refs so the window-level listeners (mounted once) always see fresh data
  // without needing to be re-registered.
  const dragRef = useRef<TabDrag | null>(null);
  const originRef = useRef<{
    tabId: string;
    startIndex: number;
    originX: number;
    tabStep: number;
  } | null>(null);
  const tabsRef = useRef(tabs.tabs);
  tabsRef.current = tabs.tabs;
  const onReorderTabRef = useRef(onReorderTab);
  onReorderTabRef.current = onReorderTab;

  dragRef.current = drag; // keep window handlers in sync with React state

  // ---- mouse-down on a tab ------------------------------------------------
  const handleMouseDown = useCallback(
    (tabId: string, event: React.MouseEvent) => {
      if (event.button !== 0) return;
      const tabList = tabsRef.current;
      const index = tabList.findIndex((t) => t.tabId === tabId);
      if (index === -1) return;
      event.preventDefault(); // suppress text selection
      // Measure actual tab width so drag re-targeting stays correct when
      // tabs have flex-shrunk below the nominal 200 px.
      const tabWidth = (event.currentTarget as HTMLElement).getBoundingClientRect()
        .width;
      originRef.current = {
        tabId,
        startIndex: index,
        originX: event.clientX,
        tabStep: tabWidth + TAB_GAP_PX
      };
    },
    []
  );

  // ---- window-level mousemove / mouseup (mounted once) --------------------
  useEffect(() => {
    const handleMouseMove = (e: MouseEvent): void => {
      // If the left button was released outside the Electron window the
      // `mouseup` event is delivered to the OS instead of our renderer,
      // leaving the drag state dangling.  `e.buttons & 1` is zero when
      // the button is no longer held, so we cancel the drag immediately.
      if (!(e.buttons & 1)) {
        if (dragRef.current || originRef.current) {
          dragRef.current = null;
          originRef.current = null;
          setDrag(null);
        }
        return;
      }

      const origin = originRef.current;
      const current = dragRef.current;

      // Still waiting for the threshold?
      if (origin && !current) {
        if (Math.abs(e.clientX - origin.originX) < DRAG_THRESHOLD_PX) return;
        const next: TabDrag = {
          tabId: origin.tabId,
          startIndex: origin.startIndex,
          originX: origin.originX,
          currentX: e.clientX,
          tabStep: origin.tabStep
        };
        originRef.current = null;
        dragRef.current = next;
        setDrag(next);
        return;
      }

      // Already dragging — update position.
      if (current) {
        setDrag((prev) =>
          prev ? { ...prev, currentX: e.clientX } : null
        );
      }
    };

    const handleMouseUp = (e: MouseEvent): void => {
      const d = dragRef.current;
      originRef.current = null;

      if (d) {
        const tabList = tabsRef.current;
        const finalIndex = resolveDragTargetIndex(
          { ...d, currentX: e.clientX },
          tabList.length
        );
        if (finalIndex !== d.startIndex) {
          const targetTab = tabList[finalIndex];
          if (targetTab) {
            onReorderTabRef.current(d.tabId, targetTab.tabId);
          }
        }
        dragRef.current = null;
        // Clear drag state and snap transforms without a CSS transition so
        // the tabs do not visibly animate back from their drag positions.
        setDragJustEnded(true);
        setDrag(null);
      }
    };

    window.addEventListener("mousemove", handleMouseMove);
    window.addEventListener("mouseup", handleMouseUp);
    return () => {
      window.removeEventListener("mousemove", handleMouseMove);
      window.removeEventListener("mouseup", handleMouseUp);
    };
  }, []);

  // ---- per-tab transforms -------------------------------------------------
  const draggingTabId = drag?.tabId ?? null;
  const targetIndex = drag
    ? resolveDragTargetIndex(drag, tabs.tabs.length)
    : null;

  const getTabTransform = (tabId: string, index: number): string => {
    if (!drag || targetIndex === null) return "";
    const step = drag.tabStep;
    if (tabId === drag.tabId) {
      const rawOffset = drag.currentX - drag.originX;
      // Clamp so the dragged tab cannot escape the tab-list bounds.
      const maxLeft = -drag.startIndex * step;
      const maxRight = (tabs.tabs.length - 1 - drag.startIndex) * step;
      const offset = Math.max(maxLeft, Math.min(maxRight, rawOffset));
      return `translateX(${offset}px)`;
    }
    // Neighbouring tabs slide out of the way.
    if (drag.startIndex < targetIndex) {
      if (index > drag.startIndex && index <= targetIndex) {
        return `translateX(-${step}px)`;
      }
    } else if (drag.startIndex > targetIndex) {
      if (index >= targetIndex && index < drag.startIndex) {
        return `translateX(${step}px)`;
      }
    }
    return "";
  };

  // ---- render -------------------------------------------------------------
  return (
    <div
      className={cn(
        "flex h-10 min-h-10 items-end gap-1 bg-[var(--background-soft)] px-2 pt-1 [-webkit-app-region:no-drag] select-none",
        drag && "cursor-grabbing"
      )}
      data-browser-tabs-strip="true"
    >
      {/* Tabs keep a normal fixed width so the new-tab button sits right after
          the last one. The track only grows to fill (and then shrinks/scrolls
          the tabs) once they no longer fit, keeping the button always visible. */}
      <div
        className="flex min-w-0 items-end gap-0.5 overflow-x-auto"
        role="tablist"
      >
        {tabs.tabs.map((tab, index) => {
          const runtime = runtimeSnapshot[tab.tabId];
          const label = runtime?.title?.trim() || fallbackLabel;
          const faviconUrl = resolveFaviconUrl(runtime?.url);
          const isActive = tab.tabId === activeTabId;
          const isDragging = tab.tabId === draggingTabId;

          return (
            <div
              key={tab.tabId}
              aria-selected={isActive}
              className={cn(
                "group flex h-[32px] w-[200px] min-w-[44px] shrink items-center gap-1.5 rounded-t-[9px] px-3 text-[12px] transition-colors",
                isActive
                  ? "bg-[var(--background-panel)] font-medium text-[var(--text-primary)]"
                  : "bg-[color-mix(in_srgb,var(--background-panel)_30%,transparent)] text-[var(--text-secondary)] hover:bg-[color-mix(in_srgb,var(--background-panel)_70%,transparent)] hover:text-[var(--text-primary)]",
                isDragging &&
                  "z-10 shadow-[0_-1px_4px_rgba(0,0,0,0.12)]"
              )}
              data-tab-id={tab.tabId}
              role="tab"
              style={{
                transform: getTabTransform(tab.tabId, index),
                transition:
                  isDragging || dragJustEnded
                    ? "none"
                    : "transform 180ms cubic-bezier(0.2, 0, 0, 1)"
              }}
              onMouseDown={(event) => handleMouseDown(tab.tabId, event)}
            >
              <button
                className="min-w-0 flex-1 flex items-center text-left"
                onClick={() => onSelectTab(tab.tabId)}
                title={label}
                type="button"
              >
                {/* Fixed-width slot: spinner while loading, site favicon when
                    the page settles.  The slot never changes size so the
                    label stays put. */}
                <span className="mr-1.5 flex size-3.5 shrink-0 items-center justify-center">
                  {runtime?.isLoading ? (
                    <LoadingIcon className="size-3.5 animate-spin text-[var(--text-tertiary)]" />
                  ) : faviconUrl ? (
                    <img
                      className="size-3.5 rounded-[2px] object-contain"
                      src={faviconUrl}
                      alt=""
                      onError={(e) => {
                        (e.target as HTMLImageElement).style.display = "none";
                      }}
                    />
                  ) : null}
                </span>
                <span className="truncate leading-none">{label}</span>
              </button>
              <button
                aria-label={feature.i18n.t("tabs.close")}
                className={cn(
                  "shrink-0 rounded p-0.5 text-[var(--text-tertiary)] opacity-0 transition-opacity hover:bg-[var(--transparency-hover)] hover:text-[var(--text-primary)] group-hover:opacity-100",
                  isActive && "opacity-100"
                )}
                onClick={() => onCloseTab(tab.tabId)}
                type="button"
              >
                <CloseIcon className="size-3.5" />
              </button>
            </div>
          );
        })}
      </div>
      <Button
        aria-label={feature.i18n.t("tabs.new")}
        className="mb-0.5 shrink-0 self-center rounded-md"
        onClick={onNewTab}
        size="icon-sm"
        title={feature.i18n.t("tabs.new")}
        type="button"
        variant="chrome"
      >
        <AddIcon className="size-[15px]" />
      </Button>
    </div>
  );
}

export interface BrowserTabsNodeHeaderProps {
  className?: string;
  defaultActions?: ReactNode;
  defaultUrl: string;
  displayMode?: WorkbenchDisplayMode;
  dragHandleProps?: HTMLAttributes<HTMLElement>;
  feature: BrowserNodeFeature;
  nodeId: string;
  onCloseRequest?: () => void;
  onFocusRequest?: () => void;
}

export function BrowserTabsNodeHeader({
  className,
  defaultActions,
  defaultUrl,
  displayMode,
  dragHandleProps,
  feature,
  nodeId,
  onCloseRequest,
  onFocusRequest
}: BrowserTabsNodeHeaderProps): JSX.Element {
  const tabs = useBrowserTabsState(feature, nodeId);
  const activeTabId = tabs.activeTabId ?? createBrowserTabId(nodeId, 1);
  const activeTab = tabs.tabs.find((tab) => tab.tabId === activeTabId);

  return (
    <BrowserNodeWorkbenchHeader
      className={className}
      defaultActions={defaultActions}
      defaultUrl={activeTab?.initialUrl ?? defaultUrl}
      displayMode={displayMode}
      dragHandleProps={dragHandleProps}
      feature={feature}
      nodeId={activeTabId}
      onCloseRequest={onCloseRequest}
      onFocusRequest={onFocusRequest}
    />
  );
}
