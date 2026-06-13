import assert from "node:assert/strict";
import test from "node:test";
import {
  createDesktopIssueManagerAgentBreakdownLauncher,
  createDesktopIssueManagerAgentRunner,
  type DesktopIssueManagerAgentGuiLaunchInput
} from "./desktopIssueManagerAgentRunner.ts";
import { createI18nRuntime } from "@tutti-os/ui-i18n-runtime";
import { issueManagerI18nResources } from "@tutti-os/workspace-issue-manager";

test("desktop issue-manager agent runner sends execute handoff without run context", async () => {
  let capturedActivation:
    | {
        agentSessionId?: string | null;
        mode?: string | null;
        provider?: string | null;
        settings?: Record<string, never>;
        title?: string | null;
        workspaceId?: string | null;
      }
    | undefined;
  let capturedExec:
    | {
        agentSessionId?: string | null;
        prompt?: string | null;
      }
    | undefined;
  let capturedLaunch: DesktopIssueManagerAgentGuiLaunchInput | undefined;
  const runner = createDesktopIssueManagerAgentRunner({
    agentHostApi: {
      agentSessions: {
        async activate(input) {
          capturedActivation = input;
          return {
            activation: { status: "attached" },
            session: {
              agentSessionId: input.agentSessionId,
              cwd: "/Users/example/.tutti-dev/sessions/2026-06-03-001",
              status: "ready"
            }
          };
        },
        async exec(input) {
          capturedExec = input;
          return {
            accepted: true,
            agentSessionId: input.agentSessionId,
            sessionStatus: "working",
            status: "started",
            turnId: "turn-1"
          };
        },
        getState: undefined
      }
    },
    launchAgentGui(input) {
      capturedLaunch = input;
    },
    workspaceId: "workspace-1"
  });

  const result = await runner.runTask(createRunRequest());

  assert.equal(capturedActivation?.provider, "codex");
  assert.equal(capturedActivation?.title, "Port renderer");
  assert.equal(capturedActivation?.workspaceId, "workspace-1");
  assert.equal(capturedActivation?.mode, "new");
  assert.deepEqual(capturedActivation?.settings, {});
  assert.equal(capturedActivation?.agentSessionId, "agent-session-1");
  assert.deepEqual(capturedLaunch, {
    agentSessionId: "agent-session-1",
    provider: "codex",
    workspaceId: "workspace-1"
  });
  assert.equal(capturedExec?.agentSessionId, "agent-session-1");
  assert.match(capturedExec?.prompt ?? "", /Handle this issue reference/);
  assert.match(
    capturedExec?.prompt ?? "",
    /\[@Plan migration \/ Port renderer\]\(mention:\/\/workspace-issue\?workspaceId=workspace-1&id=issue-1&mode=execute&topicId=topic-1&taskId=task-1\)/
  );
  assert.doesNotMatch(capturedExec?.prompt ?? "", /runId=/);
  assert.doesNotMatch(capturedExec?.prompt ?? "", /outputDir=/);
  assert.doesNotMatch(capturedExec?.prompt ?? "", /Task 标题：Port renderer/);
  assert.doesNotMatch(
    capturedExec?.prompt ?? "",
    /工作目录：\/Users\/liying\/\.tutti-dev\/sessions\/2026-06-03-001/
  );
  assert.doesNotMatch(capturedExec?.prompt ?? "", /建议输出目录：/);
  assert.doesNotMatch(capturedExec?.prompt ?? "", /docs\/spec\.md/);
  assert.doesNotMatch(capturedExec?.prompt ?? "", /docs\/design\.md/);
  assert.doesNotMatch(capturedExec?.prompt ?? "", /Tutti Issue Run Context/);
  assert.doesNotMatch(capturedExec?.prompt ?? "", /Agent Provider：codex/);
  assert.doesNotMatch(
    capturedExec?.prompt ?? "",
    /Agent Session ID：agent-session-1/
  );
  assert.deepEqual(result, {
    sessionId: "agent-session-1",
    status: "opened"
  });
});

test("desktop issue-manager agent runner reports exec rejection", async () => {
  let capturedActivation:
    | {
        agentSessionId?: string | null;
      }
    | undefined;
  const runner = createDesktopIssueManagerAgentRunner({
    agentHostApi: {
      agentSessions: {
        async activate(input) {
          capturedActivation = input;
          return {
            activation: { status: "attached" },
            session: {
              agentSessionId: input.agentSessionId,
              cwd: "/Users/example/.tutti-dev/sessions/2026-06-03-002",
              status: "ready"
            }
          };
        },
        async exec(input) {
          return {
            accepted: false,
            agentSessionId: input.agentSessionId,
            sessionStatus: "working",
            status: "started"
          };
        }
      }
    },
    workspaceId: "workspace-1"
  });

  const result = await runner.runTask(createRunRequest());

  assert.equal(capturedActivation?.agentSessionId, "agent-session-1");
  assert.deepEqual(result, {
    errorMessage: "issue_manager.agent_exec_rejected",
    sessionId: "agent-session-1",
    status: "failed"
  });
});

test("desktop issue-manager agent runner sends localized execute prompt", async () => {
  let capturedPrompt = "";
  const runner = createDesktopIssueManagerAgentRunner({
    agentHostApi: {
      agentSessions: {
        async activate(input) {
          return {
            activation: { status: "attached" },
            session: {
              agentSessionId: input.agentSessionId,
              cwd: "/Users/example/.tutti-dev/sessions/2026-06-03-001",
              status: "ready"
            }
          };
        },
        async exec(input) {
          capturedPrompt = input.prompt;
          return {
            accepted: true,
            agentSessionId: input.agentSessionId,
            sessionStatus: "working",
            status: "started"
          };
        }
      }
    },
    i18n: createI18nRuntime({
      dictionaries: [issueManagerI18nResources["zh-CN"]]
    }),
    workspaceId: "workspace-1"
  });

  await runner.runTask(createRunRequest());

  assert.match(capturedPrompt, /请处理这个 Issue 引用/);
  assert.doesNotMatch(capturedPrompt, /Handle this issue reference/);
});

test("desktop issue-manager agent runner passes selected execution directory", async () => {
  let capturedActivation:
    | {
        cwd?: string;
      }
    | undefined;
  const runner = createDesktopIssueManagerAgentRunner({
    agentHostApi: {
      agentSessions: {
        async activate(input) {
          capturedActivation = input;
          return {
            activation: { status: "attached" },
            session: {
              agentSessionId: input.agentSessionId,
              cwd: input.cwd,
              status: "ready"
            }
          };
        },
        async exec(input) {
          assert.doesNotMatch(input.prompt, /\/Users\/liying\/project\/tutti/);
          assert.match(input.prompt, /mention:\/\/workspace-issue/);
          return {
            accepted: true,
            agentSessionId: input.agentSessionId,
            sessionStatus: "working",
            status: "started"
          };
        },
        getState: undefined
      }
    },
    workspaceId: "workspace-1"
  });

  const result = await runner.runTask(
    createRunRequest({ executionDirectory: "/Users/example/project/tutti" })
  );

  assert.equal(capturedActivation?.cwd, "/Users/example/project/tutti");
  assert.equal(result.status, "opened");
});

test("desktop issue-manager agent breakdown launcher opens agent gui handoff", async () => {
  let capturedLaunch: DesktopIssueManagerAgentGuiLaunchInput | undefined;
  const launcher = createDesktopIssueManagerAgentBreakdownLauncher({
    launchAgentGui(input) {
      capturedLaunch = input;
    },
    workspaceId: "workspace-1"
  });

  const result = await launcher.startBreakdown({
    issueDetail: {
      contextRefs: [
        {
          contextRefId: "ctx-1",
          displayName: "spec.md",
          issueId: "issue-1",
          parentKind: "issue",
          path: "/workspace/spec.md",
          refType: "file",
          workspaceId: "workspace-1"
        }
      ],
      issue: {
        content: "Need a phased migration",
        creatorUserId: "local",
        issueId: "issue-1",
        status: "not_started",
        title: "Plan migration",
        topicId: "topic-1",
        workspaceId: "workspace-1"
      },
      tasks: []
    },
    provider: "gemini",
    workspaceId: "workspace-1"
  });

  assert.deepEqual(result, { status: "opened" });
  assert.equal(capturedLaunch?.agentSessionId, undefined);
  assert.equal(capturedLaunch?.provider, "gemini");
  assert.equal(capturedLaunch?.workspaceId, "workspace-1");
  assert.equal(capturedLaunch?.pendingHandoff?.issueId, "issue-1");
  assert.equal(capturedLaunch?.pendingHandoff?.taskId, null);
  assert.match(
    capturedLaunch?.pendingHandoff?.requestId ?? "",
    /^issue-breakdown-/
  );
  assert.match(
    capturedLaunch?.pendingHandoff?.prompt ?? "",
    /Break this issue reference down into executable tasks/
  );
  assert.match(
    capturedLaunch?.pendingHandoff?.prompt ?? "",
    /mention:\/\/workspace-issue\?workspaceId=workspace-1&id=issue-1&mode=breakdown&topicId=topic-1/
  );
  assert.doesNotMatch(
    capturedLaunch?.pendingHandoff?.prompt ?? "",
    /引用资料数：1/
  );
});

test("desktop issue-manager agent breakdown launcher sends localized prompt", async () => {
  let capturedLaunch: DesktopIssueManagerAgentGuiLaunchInput | undefined;
  const launcher = createDesktopIssueManagerAgentBreakdownLauncher({
    i18n: createI18nRuntime({
      dictionaries: [issueManagerI18nResources["zh-CN"]]
    }),
    launchAgentGui(input) {
      capturedLaunch = input;
    },
    workspaceId: "workspace-1"
  });

  await launcher.startBreakdown({
    issueDetail: {
      contextRefs: [],
      issue: {
        content: "Need a phased migration",
        creatorUserId: "local",
        issueId: "issue-1",
        status: "not_started",
        title: "Plan migration",
        topicId: "topic-1",
        workspaceId: "workspace-1"
      },
      tasks: []
    },
    provider: "gemini",
    workspaceId: "workspace-1"
  });

  assert.match(
    capturedLaunch?.pendingHandoff?.prompt ?? "",
    /请基于这个 Issue 引用做任务拆解/
  );
  assert.doesNotMatch(
    capturedLaunch?.pendingHandoff?.prompt ?? "",
    /Break this issue reference down into executable tasks/
  );
});

function createRunRequest(input?: { executionDirectory?: string | null }) {
  return {
    agentSessionId: "agent-session-1",
    ...(input?.executionDirectory
      ? { executionDirectory: input.executionDirectory }
      : {}),
    issue: {
      content: "[spec](/workspace/docs/spec.md)",
      creatorUserId: "local",
      issueId: "issue-1",
      status: "running" as const,
      title: "Plan migration",
      topicId: "topic-1",
      workspaceId: "workspace-1"
    },
    provider: "codex",
    task: {
      content: "[design](/workspace/docs/design.md)",
      creatorUserId: "local",
      issueId: "issue-1",
      priority: "high" as const,
      status: "not_started" as const,
      taskId: "task-1",
      title: "Port renderer",
      workspaceId: "workspace-1"
    },
    workspaceId: "workspace-1"
  };
}
