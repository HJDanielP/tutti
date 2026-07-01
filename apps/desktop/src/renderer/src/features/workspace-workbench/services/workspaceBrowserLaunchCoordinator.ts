export interface WorkspaceBrowserLaunchRequest {
  openInTab?: boolean;
  reuseIfOpen?: boolean;
  source?:
    | "agent_command"
    | "browser"
    | "file_manager"
    | "terminal"
    | "workspace_app";
  sourceNodeId?: string;
  url: string;
  workspaceId: string;
}

export type WorkspaceBrowserLaunchHandler = (
  request: WorkspaceBrowserLaunchRequest
) => Promise<boolean> | boolean;

const launchHandlersByWorkspaceId = new Map<
  string,
  WorkspaceBrowserLaunchHandler
>();
const allowedBrowserLaunchProtocols = new Set(["http:", "https:"]);

export function registerWorkspaceBrowserLaunchHandler(
  workspaceId: string,
  handler: WorkspaceBrowserLaunchHandler
): () => void {
  const normalizedWorkspaceId = workspaceId.trim();
  if (!normalizedWorkspaceId) {
    return noop;
  }

  launchHandlersByWorkspaceId.set(normalizedWorkspaceId, handler);
  return () => {
    if (launchHandlersByWorkspaceId.get(normalizedWorkspaceId) === handler) {
      launchHandlersByWorkspaceId.delete(normalizedWorkspaceId);
    }
  };
}

export async function requestWorkspaceBrowserLaunch(
  request: WorkspaceBrowserLaunchRequest
): Promise<boolean> {
  const normalizedWorkspaceId = request.workspaceId.trim();
  const normalizedUrl = normalizeWorkspaceBrowserLaunchUrl(request.url);
  if (!normalizedWorkspaceId || !normalizedUrl) {
    return false;
  }

  return dispatchWorkspaceBrowserLaunch({
    handler: launchHandlersByWorkspaceId.get(normalizedWorkspaceId),
    request: {
      ...(request.openInTab !== undefined ? { openInTab: request.openInTab } : {}),
      ...(request.reuseIfOpen !== undefined
        ? { reuseIfOpen: request.reuseIfOpen }
        : {}),
      ...(request.source ? { source: request.source } : {}),
      ...(request.sourceNodeId ? { sourceNodeId: request.sourceNodeId } : {}),
      url: normalizedUrl,
      workspaceId: normalizedWorkspaceId
    }
  });
}

export async function requestWorkspaceBrowserHostFileLaunch(
  request: WorkspaceBrowserLaunchRequest
): Promise<boolean> {
  const normalizedWorkspaceId = request.workspaceId.trim();
  const normalizedUrl = normalizeWorkspaceBrowserHostFileLaunchUrl(request.url);
  if (!normalizedWorkspaceId || !normalizedUrl) {
    return false;
  }

  return dispatchWorkspaceBrowserLaunch({
    handler: launchHandlersByWorkspaceId.get(normalizedWorkspaceId),
    request: {
      reuseIfOpen: request.reuseIfOpen,
      source: request.source ?? "file_manager",
      url: normalizedUrl,
      workspaceId: normalizedWorkspaceId
    }
  });
}

function dispatchWorkspaceBrowserLaunch(input: {
  handler: WorkspaceBrowserLaunchHandler | undefined;
  request: WorkspaceBrowserLaunchRequest & { workspaceId: string; url: string };
}): Promise<boolean> | boolean {
  if (!input.handler) {
    return false;
  }

  return input.handler({
    ...(input.request.openInTab !== undefined
      ? { openInTab: input.request.openInTab }
      : {}),
    ...(input.request.reuseIfOpen !== undefined
      ? { reuseIfOpen: input.request.reuseIfOpen }
      : {}),
    ...(input.request.source ? { source: input.request.source } : {}),
    ...(input.request.sourceNodeId
      ? { sourceNodeId: input.request.sourceNodeId }
      : {}),
    url: input.request.url,
    workspaceId: input.request.workspaceId
  });
}

function normalizeWorkspaceBrowserLaunchUrl(url: string): string | null {
  try {
    const parsed = new URL(url.trim());
    return allowedBrowserLaunchProtocols.has(parsed.protocol)
      ? parsed.toString()
      : null;
  } catch {
    return null;
  }
}

function normalizeWorkspaceBrowserHostFileLaunchUrl(
  url: string
): string | null {
  try {
    const parsed = new URL(url.trim());
    if (parsed.protocol === "file:") {
      return parsed.toString();
    }
    return normalizeWorkspaceBrowserLaunchUrl(url);
  } catch {
    return null;
  }
}

function noop(): void {}
