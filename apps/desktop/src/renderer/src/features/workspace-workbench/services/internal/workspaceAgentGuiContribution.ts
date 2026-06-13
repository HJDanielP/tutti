import { createElement } from "react";
import { createAgentGuiWorkbenchContribution } from "@tutti-os/agent-gui/workbench/contribution";
import type { AgentGuiWorkbenchProvider } from "@tutti-os/agent-gui/workbench/types";
import type { I18nRuntime } from "@tutti-os/ui-i18n-runtime";
import type { TuttidClient } from "@tutti-os/client-tuttid-ts";
import type {
  WorkbenchContribution,
  WorkbenchDockPreviewCache
} from "@tutti-os/workbench-surface";
import type {
  DesktopHostFilesApi,
  DesktopPlatformApi,
  DesktopRuntimeApi
} from "@preload/types";
import type { IDesktopRichTextAtService } from "@renderer/features/rich-text-at";
import type { IWorkspaceAppCenterService } from "@renderer/features/workspace-app-center";
import type { IWorkspaceAgentActivityService } from "@renderer/features/workspace-agent";
import type { IWorkspaceUserProjectService } from "@renderer/features/workspace-user-project";
import type { IReporterService } from "@renderer/features/analytics";
import {
  createDesktopAgentGUIWorkbenchHostInput,
  DesktopAgentGUIWorkbenchBody,
  requestWorkspaceAgentGuiLaunch,
  type AgentProviderStatusService
} from "@renderer/features/workspace-agent";
import { runDesktopAgentGUILinkAction } from "@renderer/features/workspace-agent/services/desktopAgentGUILinkActions.ts";
import {
  workspaceWorkbenchDesktopI18nKeys,
  type WorkspaceWorkbenchDesktopI18nRuntime
} from "@shared/i18n";
import { requestWorkspaceBrowserLaunch } from "../workspaceBrowserLaunchCoordinator.ts";
import { requestWorkspaceFilesLaunch } from "../workspaceFilesLaunchCoordinator.ts";
import { requestWorkspaceIssueManagerLaunch } from "../workspaceIssueManagerLaunchCoordinator.ts";
import { workspaceAgentGuiNodeFrame } from "./workspaceWorkbenchComposition.ts";
import { isWorkspaceAgentGuiDefaultDockProvider } from "./workspaceAgentProviderCatalog.ts";

export function createWorkspaceAgentGuiContribution(input: {
  agentProviderStatusService: AgentProviderStatusService;
  appCenterService: IWorkspaceAppCenterService;
  appI18n: I18nRuntime<string>;
  dockPreviewCache: WorkbenchDockPreviewCache;
  dockIconUrls?: Parameters<
    typeof createAgentGuiWorkbenchContribution
  >[0]["dockIconUrls"];
  hostFilesApi: DesktopHostFilesApi;
  i18n: WorkspaceWorkbenchDesktopI18nRuntime;
  tuttidClient: TuttidClient;
  platformApi: Pick<
    DesktopPlatformApi,
    "homeDirectory" | "os" | "resolveDroppedPaths"
  >;
  resolveAppIconUrl?: (appId: string) => string | null;
  reporterService?: Pick<IReporterService, "trackEvents">;
  richTextAtService: IDesktopRichTextAtService;
  runtimeApi: DesktopRuntimeApi;
  workspaceAgentActivityService: IWorkspaceAgentActivityService;
  workspaceUserProjectService: IWorkspaceUserProjectService;
  workspaceId: string;
}): WorkbenchContribution {
  const agentGUIWorkbenchHostInput = createDesktopAgentGUIWorkbenchHostInput({
    hostFilesApi: input.hostFilesApi,
    tuttidClient: input.tuttidClient,
    platformApi: input.platformApi,
    reporterService: input.reporterService,
    richTextAtService: input.richTextAtService,
    runtimeApi: input.runtimeApi,
    workspaceAgentActivityService: input.workspaceAgentActivityService,
    workspaceUserProjectService: input.workspaceUserProjectService,
    workspaceId: input.workspaceId
  });

  return createAgentGuiWorkbenchContribution({
    copy: {
      collapseConversationRail: input.appI18n.t(
        "workspace.agentGui.collapseConversationRail"
      ),
      expandConversationRail: input.appI18n.t(
        "workspace.agentGui.expandConversationRail"
      ),
      fallbackAgentLabel: input.appI18n.t(
        "workspace.agentGui.fallbackAgentLabel"
      ),
      nodeTitle: input.i18n.t(workspaceWorkbenchDesktopI18nKeys.nodes.agent)
    },
    dockIconUrls: input.dockIconUrls,
    frame: workspaceAgentGuiNodeFrame,
    renderBody: (context, helpers) =>
      createElement(DesktopAgentGUIWorkbenchBody, {
        agentActivityRuntime: agentGUIWorkbenchHostInput.agentActivityRuntime,
        agentHostApi: agentGUIWorkbenchHostInput.agentHostApi,
        appCenterService: input.appCenterService,
        agentProviderStatusService: input.agentProviderStatusService,
        context,
        dockPreviewCache: input.dockPreviewCache,
        onLinkAction: (action) => {
          void runDesktopAgentGUILinkAction(action, {
            homeDirectory: input.platformApi.homeDirectory,
            launchAgentGui: requestWorkspaceAgentGuiLaunch,
            launchWorkspaceIssueManager: requestWorkspaceIssueManagerLaunch,
            launchWorkspaceFiles: requestWorkspaceFilesLaunch,
            openBrowserUrl: requestWorkspaceBrowserLaunch,
            workspaceId: input.workspaceId
          });
        },
        onStateChange: (state) => helpers.onStateChange(state),
        richTextAtProviders: agentGUIWorkbenchHostInput.richTextAtProviders,
        resolveAppIconUrl: input.resolveAppIconUrl,
        runtimeApi: input.runtimeApi,
        trackWorkspaceFileReferences: (referenceInput) =>
          agentGUIWorkbenchHostInput.trackWorkspaceFileReferences(
            referenceInput
          ),
        workspaceFileReferenceAdapter:
          agentGUIWorkbenchHostInput.workspaceFileReferenceAdapter,
        workspaceId: input.workspaceId
      }),
    resolveDockEntryVisibility: (provider: AgentGuiWorkbenchProvider) =>
      isWorkspaceAgentGuiDefaultDockProvider(provider) ? "always" : "never",
    workspaceId: input.workspaceId
  });
}
