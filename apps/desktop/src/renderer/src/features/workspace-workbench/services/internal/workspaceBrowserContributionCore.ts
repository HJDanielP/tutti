import type { BrowserNodeRuntimeState } from "@tutti-os/browser-node";
import type {
  WorkbenchHostExternalStateLookupInput,
  WorkbenchHostExternalStateSource
} from "@tutti-os/workbench-surface";
import { workspaceBrowserNodeID } from "./workspaceWorkbenchComposition.ts";

const browserNodeSearchBaseUrl = "https://www.google.com/search";

export interface WorkspaceBrowserNavigationAnalyticsParams {
  isLocalhost: boolean;
  urlDomain: string;
}

export function resolveWorkspaceBrowserSearchUrl(query: string): string {
  const searchUrl = new URL(browserNodeSearchBaseUrl);
  searchUrl.searchParams.set("q", query);
  return searchUrl.toString();
}

export function resolveWorkspaceBrowserNavigationAnalyticsParams(
  url: string
): WorkspaceBrowserNavigationAnalyticsParams | null {
  try {
    const parsed = new URL(url);
    const hostname = parsed.hostname.trim().toLowerCase();
    if (!hostname) {
      return null;
    }
    return {
      isLocalhost: isWorkspaceBrowserLocalhost(hostname),
      urlDomain: hostname
    };
  } catch {
    return null;
  }
}

function isWorkspaceBrowserLocalhost(hostname: string): boolean {
  return (
    hostname === "localhost" ||
    hostname.endsWith(".localhost") ||
    hostname.startsWith("127.") ||
    hostname === "::1" ||
    hostname === "[::1]"
  );
}

export interface WorkspaceBrowserNodeExternalState {
  title: string | null;
  url: string | null;
  /** All open tab URLs so the full tab strip is restored on relaunch. */
  tabs?: { url: string }[];
}

export function createWorkspaceBrowserNodeExternalStateSource(input: {
  runtimeStore: {
    getSnapshot(): Record<string, BrowserNodeRuntimeState | undefined>;
    subscribe(listener: () => void): () => void;
  };
  tabStore: {
    getState(containerId: string): {
      activeTabId: string | null;
      tabs: readonly { initialUrl: string; tabId: string }[];
    };
    subscribe(listener: () => void): () => void;
  };
}): WorkbenchHostExternalStateSource<
  WorkspaceBrowserNodeExternalState | null,
  null
> {
  const resolveRuntimeNodeId = (containerNodeId: string): string =>
    input.tabStore.getState(containerNodeId).activeTabId ?? containerNodeId;

  const readState = (
    request: WorkbenchHostExternalStateLookupInput
  ): WorkspaceBrowserNodeExternalState | null => {
    if (!isBrowserNodeExternalStateRequest(request)) return null;
    const tabState = input.tabStore.getState(request.nodeId);
    const runtime = input.runtimeStore.getSnapshot();
    const base = readWorkspaceBrowserRuntimeNodeState(
      runtime,
      resolveRuntimeNodeId(request.nodeId)
    );
    if (!base && tabState.tabs.length === 0) return null;

    return {
      title: base?.title ?? null,
      url: base?.url ?? null,
      // Persist each tab's *current* URL from the runtime store so a
      // navigated tab is restored to the page the user was viewing, not
      // the initial new-tab URL it was created with.
      tabs: tabState.tabs.map((t) => ({
        url: runtime[t.tabId]?.url?.trim() || t.initialUrl
      }))
    };
  };

  return {
    getNodeState: readState,
    getSnapshotNodeState: readState,
    getWorkspaceState() {
      return null;
    },
    subscribe(listener) {
      const unsubscribeRuntime = input.runtimeStore.subscribe(listener);
      const unsubscribeTabs = input.tabStore.subscribe(listener);
      return () => {
        unsubscribeRuntime();
        unsubscribeTabs();
      };
    }
  };
}

function isBrowserNodeExternalStateRequest(
  request: WorkbenchHostExternalStateLookupInput
): boolean {
  return request.typeId === workspaceBrowserNodeID;
}

function readWorkspaceBrowserRuntimeNodeState(
  runtimeSnapshot: Record<string, BrowserNodeRuntimeState | undefined>,
  nodeId: string
): WorkspaceBrowserNodeExternalState | null {
  const state = runtimeSnapshot[nodeId];
  const url = state?.url?.trim() ?? "";
  if (url.length === 0) {
    return null;
  }

  return {
    title: state?.title?.trim() || null,
    url
  };
}
