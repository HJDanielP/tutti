import { useEffect, useRef } from "react";
import type { WorkbenchHostHandle } from "@tutti-os/workbench-surface";
import { workspaceOnboardingAppId } from "../services/workspaceOnboarding.ts";
import type { IWorkspaceWorkbenchHostService } from "../services/workspaceWorkbenchHostService.interface.ts";

interface WorkspaceOnboardingApp {
  appId: string;
  installed?: boolean;
}

interface WorkspaceOnboardingAppCenterService {
  readonly store: {
    readonly apps: readonly WorkspaceOnboardingApp[];
  };
  refresh(workspaceId: string): Promise<void>;
  refreshCatalog(workspaceId: string): Promise<void>;
  installApp(input: { appId: string; workspaceId: string }): Promise<void>;
  openApp(input: { appId: string; workspaceId: string }): Promise<boolean>;
}

export type WorkspaceOnboardingAutoOpenResult =
  | "already-opened"
  | "canceled"
  | "install-timeout"
  | "not-found"
  | "not-opened"
  | "opened";

interface OpenWorkspaceOnboardingInput {
  appCenterService: WorkspaceOnboardingAppCenterService;
  appId?: string;
  isCanceled?: () => boolean;
  maxInstallAttempts?: number;
  maxAttempts?: number;
  wait?: (delayMs: number) => Promise<void>;
  workbenchHostService: Pick<
    IWorkspaceWorkbenchHostService,
    | "hasWorkspaceOnboardingAutoOpened"
    | "logWorkspaceOnboardingAutoOpenDiagnostic"
    | "markWorkspaceOnboardingAutoOpened"
  >;
  workspaceId: string;
}

export async function openWorkspaceOnboardingIfNeeded({
  appCenterService,
  appId = workspaceOnboardingAppId,
  isCanceled = () => false,
  maxInstallAttempts = 120,
  maxAttempts = 20,
  wait = defaultWait,
  workbenchHostService,
  workspaceId
}: OpenWorkspaceOnboardingInput): Promise<WorkspaceOnboardingAutoOpenResult> {
  if (isCanceled()) {
    logAutoOpenDiagnostic(workbenchHostService, {
      appId,
      event: "workspace-onboarding.auto-open.canceled",
      level: "info",
      maxInstallAttempts,
      maxAttempts,
      reason: "before-start",
      workspaceId
    });
    return "canceled";
  }
  logAutoOpenDiagnostic(workbenchHostService, {
    appId,
    event: "workspace-onboarding.auto-open.started",
    level: "info",
    maxInstallAttempts,
    maxAttempts,
    workspaceId
  });
  if (
    await workbenchHostService.hasWorkspaceOnboardingAutoOpened(workspaceId)
  ) {
    logAutoOpenDiagnostic(workbenchHostService, {
      appId,
      event: "workspace-onboarding.auto-open.already-opened",
      level: "info",
      maxInstallAttempts,
      maxAttempts,
      workspaceId
    });
    return "already-opened";
  }

  await appCenterService.refreshCatalog(workspaceId);
  logAutoOpenDiagnostic(workbenchHostService, {
    appId,
    event: "workspace-onboarding.auto-open.catalog-refreshed",
    level: "debug",
    maxInstallAttempts,
    maxAttempts,
    workspaceId
  });

  let installRequested = false;
  let installed = false;
  for (let attempt = 0; attempt < maxInstallAttempts; attempt += 1) {
    const attemptNumber = attempt + 1;
    if (isCanceled()) {
      logAutoOpenDiagnostic(workbenchHostService, {
        appId,
        attempt: attemptNumber,
        event: "workspace-onboarding.auto-open.canceled",
        level: "info",
        maxInstallAttempts,
        maxAttempts,
        reason: "during-install-wait",
        workspaceId
      });
      return "canceled";
    }
    await appCenterService.refresh(workspaceId);
    const app = appCenterService.store.apps.find(
      (candidate) => candidate.appId === appId
    );
    if (!app) {
      logAutoOpenDiagnostic(workbenchHostService, {
        appId,
        attempt: attemptNumber,
        event: "workspace-onboarding.auto-open.app-missing",
        level: "debug",
        maxInstallAttempts,
        maxAttempts,
        workspaceId
      });
      await wait(500);
      continue;
    }
    if (app.installed) {
      installed = true;
      if (installRequested) {
        logAutoOpenDiagnostic(workbenchHostService, {
          appId,
          attempt: attemptNumber,
          event: "workspace-onboarding.auto-open.installed-detected",
          level: "info",
          maxInstallAttempts,
          maxAttempts,
          workspaceId
        });
      }
      break;
    }
    if (!installRequested) {
      logAutoOpenDiagnostic(workbenchHostService, {
        appId,
        attempt: attemptNumber,
        event: "workspace-onboarding.auto-open.install-requested",
        level: "info",
        maxInstallAttempts,
        maxAttempts,
        workspaceId
      });
      await appCenterService.installApp({ appId, workspaceId });
      installRequested = true;
      logAutoOpenDiagnostic(workbenchHostService, {
        appId,
        attempt: attemptNumber,
        event: "workspace-onboarding.auto-open.install-request-accepted",
        level: "info",
        maxInstallAttempts,
        maxAttempts,
        workspaceId
      });
    } else {
      logAutoOpenDiagnostic(workbenchHostService, {
        appId,
        attempt: attemptNumber,
        event: "workspace-onboarding.auto-open.install-waiting",
        level: "debug",
        maxInstallAttempts,
        maxAttempts,
        workspaceId
      });
    }
    await wait(500);
  }

  if (!installed) {
    const event = installRequested
      ? "workspace-onboarding.auto-open.install-timeout"
      : "workspace-onboarding.auto-open.not-found";
    logAutoOpenDiagnostic(workbenchHostService, {
      appId,
      event,
      level: "warn",
      maxInstallAttempts,
      maxAttempts,
      workspaceId
    });
    return installRequested ? "install-timeout" : "not-found";
  }

  let openAttempted = false;
  for (let attempt = 0; attempt < maxAttempts; attempt += 1) {
    const attemptNumber = attempt + 1;
    if (isCanceled()) {
      logAutoOpenDiagnostic(workbenchHostService, {
        appId,
        attempt: attemptNumber,
        event: "workspace-onboarding.auto-open.canceled",
        level: "info",
        maxInstallAttempts,
        maxAttempts,
        reason: "during-attempt",
        workspaceId
      });
      return "canceled";
    }
    await appCenterService.refresh(workspaceId);
    const app = appCenterService.store.apps.find(
      (candidate) => candidate.appId === appId
    );
    if (!app?.installed) {
      logAutoOpenDiagnostic(workbenchHostService, {
        appId,
        attempt: attemptNumber,
        event: "workspace-onboarding.auto-open.launch-not-ready",
        level: "warn",
        maxInstallAttempts,
        maxAttempts,
        reason: app ? "app-not-installed" : "app-missing",
        workspaceId
      });
      await wait(500);
      continue;
    }

    openAttempted = true;
    const opened = await appCenterService.openApp({ appId, workspaceId });
    if (!opened) {
      logAutoOpenDiagnostic(workbenchHostService, {
        appId,
        attempt: attemptNumber,
        event: "workspace-onboarding.auto-open.launch-not-ready",
        level: "warn",
        maxInstallAttempts,
        maxAttempts,
        workspaceId
      });
      await wait(500);
      continue;
    }
    if (isCanceled()) {
      logAutoOpenDiagnostic(workbenchHostService, {
        appId,
        attempt: attemptNumber,
        event: "workspace-onboarding.auto-open.canceled",
        level: "info",
        maxInstallAttempts,
        maxAttempts,
        reason: "after-open",
        workspaceId
      });
      return "canceled";
    }
    await workbenchHostService.markWorkspaceOnboardingAutoOpened(workspaceId);
    logAutoOpenDiagnostic(workbenchHostService, {
      appId,
      attempt: attemptNumber,
      event: "workspace-onboarding.auto-open.opened",
      level: "info",
      maxInstallAttempts,
      maxAttempts,
      workspaceId
    });
    return "opened";
  }

  if (isCanceled()) {
    logAutoOpenDiagnostic(workbenchHostService, {
      appId,
      event: "workspace-onboarding.auto-open.canceled",
      level: "info",
      maxInstallAttempts,
      maxAttempts,
      reason: "after-attempts",
      workspaceId
    });
    return "canceled";
  }
  logAutoOpenDiagnostic(workbenchHostService, {
    appId,
    event: openAttempted
      ? "workspace-onboarding.auto-open.not-opened"
      : "workspace-onboarding.auto-open.not-found",
    level: "warn",
    maxInstallAttempts,
    maxAttempts,
    workspaceId
  });
  return openAttempted ? "not-opened" : "not-found";
}

export function useWorkspaceOnboardingAutoOpen({
  appCenterService,
  workbenchHost,
  workbenchHostService,
  workspaceId
}: {
  appCenterService: WorkspaceOnboardingAppCenterService;
  workbenchHost: WorkbenchHostHandle | null;
  workbenchHostService: OpenWorkspaceOnboardingInput["workbenchHostService"];
  workspaceId: string;
}): void {
  const activeWorkspaceIdsRef = useRef(new Set<string>());

  useEffect(() => {
    const normalizedWorkspaceId = workspaceId.trim();
    if (!workbenchHost || !normalizedWorkspaceId) {
      return;
    }
    if (activeWorkspaceIdsRef.current.has(normalizedWorkspaceId)) {
      return;
    }

    let canceled = false;
    activeWorkspaceIdsRef.current.add(normalizedWorkspaceId);
    void openWorkspaceOnboardingIfNeeded({
      appCenterService,
      isCanceled: () => canceled,
      workbenchHostService,
      workspaceId: normalizedWorkspaceId
    })
      .catch((error: unknown) => {
        logAutoOpenDiagnostic(workbenchHostService, {
          event: "workspace-onboarding.auto-open.failed",
          level: "error",
          reason: stringifyDiagnosticError(error),
          workspaceId: normalizedWorkspaceId
        });
      })
      .finally(() => {
        activeWorkspaceIdsRef.current.delete(normalizedWorkspaceId);
      });

    return () => {
      canceled = true;
      activeWorkspaceIdsRef.current.delete(normalizedWorkspaceId);
    };
  }, [appCenterService, workbenchHost, workbenchHostService, workspaceId]);
}

function defaultWait(delayMs: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, delayMs));
}

function logAutoOpenDiagnostic(
  workbenchHostService: Pick<
    IWorkspaceWorkbenchHostService,
    "logWorkspaceOnboardingAutoOpenDiagnostic"
  >,
  input: {
    appId?: string;
    attempt?: number;
    event: string;
    level: "debug" | "info" | "warn" | "error";
    maxInstallAttempts?: number;
    maxAttempts?: number;
    reason?: string;
    workspaceId: string;
  }
): void {
  const { event, level, workspaceId, ...details } = input;
  workbenchHostService.logWorkspaceOnboardingAutoOpenDiagnostic({
    details,
    event,
    level,
    workspaceId
  });
}

function stringifyDiagnosticError(error: unknown): string {
  if (error instanceof Error) {
    return error.message;
  }
  return String(error);
}
