const browserTabIdSeparator = "::t";
const browserTabIdPattern = /^(.*)::t\d+$/;

export interface BrowserNodeTab {
  readonly initialUrl: string;
  readonly tabId: string;
}

export interface BrowserNodeTabsState {
  readonly activeTabId: string | null;
  readonly tabs: readonly BrowserNodeTab[];
}

export interface BrowserNodeTabStore {
  activateTab(containerId: string, tabId: string): void;
  clearContainer(containerId: string): void;
  closeTab(containerId: string, tabId: string): void;
  ensureContainer(containerId: string, initialUrl: string): void;
  getState(containerId: string): BrowserNodeTabsState;
  moveTab(containerId: string, tabId: string, toIndex: number): void;
  openTab(
    containerId: string,
    initialUrl: string,
    options?: { activate?: boolean }
  ): string;
  subscribe(listener: () => void): () => void;
}

const emptyBrowserNodeTabsState: BrowserNodeTabsState = {
  activeTabId: null,
  tabs: []
};

interface BrowserNodeTabContainer {
  nextSequence: number;
  snapshot: BrowserNodeTabsState;
}

/**
 * A browser tab is modeled as a synthetic node id derived from its container
 * node id. Because the webview / guest / runtime layers all key by whatever id
 * they are handed, this lets each tab own an independent webview, guest session,
 * and runtime entry while the container keeps the `browser:` prefix that event
 * routing matches on.
 */
export function createBrowserTabId(
  containerId: string,
  sequence: number
): string {
  return `${containerId}${browserTabIdSeparator}${sequence}`;
}

/**
 * Resolve the owning container node id for a tab id. Plain node ids (no tab
 * suffix) are returned unchanged, so callers can pass either a container node id
 * or a tab id.
 */
export function resolveBrowserContainerNodeId(idOrTabId: string): string {
  return browserTabIdPattern.exec(idOrTabId)?.[1] ?? idOrTabId;
}

export function createBrowserNodeTabStore(): BrowserNodeTabStore {
  const listeners = new Set<() => void>();
  const containers = new Map<string, BrowserNodeTabContainer>();

  const notify = (): void => {
    for (const listener of listeners) {
      listener();
    }
  };

  const setSnapshot = (
    containerId: string,
    container: BrowserNodeTabContainer,
    snapshot: BrowserNodeTabsState
  ): void => {
    container.snapshot = snapshot;
    containers.set(containerId, container);
    notify();
  };

  const getOrCreateContainer = (
    containerId: string
  ): BrowserNodeTabContainer => {
    const existing = containers.get(containerId);
    if (existing) {
      return existing;
    }
    const created: BrowserNodeTabContainer = {
      nextSequence: 1,
      snapshot: emptyBrowserNodeTabsState
    };
    containers.set(containerId, created);
    return created;
  };

  const appendTab = (
    containerId: string,
    initialUrl: string,
    activate: boolean
  ): string => {
    const container = getOrCreateContainer(containerId);
    const tabId = createBrowserTabId(containerId, container.nextSequence);
    container.nextSequence += 1;
    const tabs = [...container.snapshot.tabs, { initialUrl, tabId }];
    setSnapshot(containerId, container, {
      activeTabId: activate ? tabId : (container.snapshot.activeTabId ?? tabId),
      tabs
    });
    return tabId;
  };

  return {
    activateTab(containerId, tabId) {
      const container = containers.get(containerId);
      if (
        !container ||
        container.snapshot.activeTabId === tabId ||
        !container.snapshot.tabs.some((tab) => tab.tabId === tabId)
      ) {
        return;
      }
      setSnapshot(containerId, container, {
        activeTabId: tabId,
        tabs: container.snapshot.tabs
      });
    },
    clearContainer(containerId) {
      if (containers.delete(containerId)) {
        notify();
      }
    },
    closeTab(containerId, tabId) {
      const container = containers.get(containerId);
      if (!container) {
        return;
      }
      const index = container.snapshot.tabs.findIndex(
        (tab) => tab.tabId === tabId
      );
      if (index === -1) {
        return;
      }
      const tabs = container.snapshot.tabs.filter((tab) => tab.tabId !== tabId);
      const wasActive = container.snapshot.activeTabId === tabId;
      const nextActiveTabId = wasActive
        ? (tabs[index]?.tabId ?? tabs[index - 1]?.tabId ?? null)
        : container.snapshot.activeTabId;
      setSnapshot(containerId, container, {
        activeTabId: nextActiveTabId,
        tabs
      });
    },
    ensureContainer(containerId, initialUrl) {
      const container = getOrCreateContainer(containerId);
      if (container.snapshot.tabs.length > 0) {
        return;
      }
      appendTab(containerId, initialUrl, true);
    },
    getState(containerId) {
      return containers.get(containerId)?.snapshot ?? emptyBrowserNodeTabsState;
    },
    moveTab(containerId, tabId, toIndex) {
      const container = containers.get(containerId);
      if (!container) {
        return;
      }
      const fromIndex = container.snapshot.tabs.findIndex(
        (tab) => tab.tabId === tabId
      );
      if (fromIndex === -1) {
        return;
      }
      const clampedIndex = Math.max(
        0,
        Math.min(toIndex, container.snapshot.tabs.length - 1)
      );
      if (clampedIndex === fromIndex) {
        return;
      }
      const tabs = [...container.snapshot.tabs];
      const [moved] = tabs.splice(fromIndex, 1);
      if (!moved) {
        return;
      }
      tabs.splice(clampedIndex, 0, moved);
      setSnapshot(containerId, container, {
        activeTabId: container.snapshot.activeTabId,
        tabs
      });
    },
    openTab(containerId, initialUrl, options) {
      return appendTab(containerId, initialUrl, options?.activate ?? true);
    },
    subscribe(listener) {
      listeners.add(listener);
      return () => {
        listeners.delete(listener);
      };
    }
  };
}
