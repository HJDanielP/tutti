#!/usr/bin/env node
import { execFileSync, spawn } from "node:child_process";
import { existsSync } from "node:fs";
import { homedir } from "node:os";
import { join, resolve } from "node:path";

const DEFAULT_PROMPT = "/goal";
const DEFAULT_TIMEOUT_MS = 45_000;
let activeChild = null;

function parseArgs(argv) {
  const out = {};
  for (let index = 0; index < argv.length; index += 1) {
    const arg = argv[index];
    if (!arg.startsWith("--")) {
      throw new Error(`Unexpected argument: ${arg}`);
    }
    const key = arg.slice(2);
    if (key === "help") {
      out.help = true;
      continue;
    }
    const value = argv[index + 1];
    if (!value || value.startsWith("--")) {
      throw new Error(`Missing value for --${key}`);
    }
    out[key] = value;
    index += 1;
  }
  return out;
}

function usage() {
  return `Usage:
  node tools/scripts/verify-claude-acp-slash-goal.mjs [--prompt "/goal ..."] [--cwd <dir>] [--command <cmd>] [--timeout-ms 45000]

Defaults:
  - Finds Tutti's managed claude-acp install under TUTTI_STATE_DIR, ~/.tutti-dev, ~/.tutti, then PATH.
  - Sends initialize -> session/new -> session/prompt with a single text prompt.
  - For "/goal <objective>", waits for ACP thread_goal_update and then stops the probe.
`;
}

function stateDirs() {
  const dirs = [];
  if (process.env.TUTTI_STATE_DIR) {
    dirs.push(process.env.TUTTI_STATE_DIR);
  }
  dirs.push(join(homedir(), ".tutti-dev"));
  dirs.push(join(homedir(), ".tutti"));
  return [...new Set(dirs.map((dir) => resolve(dir)))];
}

function managedCandidates() {
  const candidates = [];
  for (const stateDir of stateDirs()) {
    const prefix = join(
      stateDir,
      "agent-providers",
      "external-agent-registry",
      "packages",
      "claude-acp"
    );
    const bin = join(prefix, "node_modules", ".bin", "claude-agent-acp");
    const dist = join(
      prefix,
      "node_modules",
      "@agentclientprotocol",
      "claude-agent-acp",
      "dist",
      "acp-agent.js"
    );
    if (existsSync(bin)) {
      candidates.push({ command: bin, args: [], label: bin });
    }
    if (existsSync(dist)) {
      candidates.push({
        command: process.execPath,
        args: [dist],
        label: `node ${dist}`
      });
    }
  }
  return candidates;
}

function pathCandidate() {
  try {
    const bin = execFileSync("which", ["claude-agent-acp"], {
      encoding: "utf8",
      stdio: ["ignore", "pipe", "ignore"]
    }).trim();
    if (bin) {
      return { command: bin, args: [], label: bin };
    }
  } catch {
    return null;
  }
  return null;
}

function resolveTarget(args) {
  if (args.command) {
    return {
      command: args.command,
      args: [],
      label: args.command,
      shell: true
    };
  }
  const candidates = managedCandidates();
  const path = pathCandidate();
  if (path) {
    candidates.push(path);
  }
  if (candidates.length === 0) {
    throw new Error(
      "claude-agent-acp not found. Install Claude ACP in Tutti, put claude-agent-acp on PATH, or pass --command."
    );
  }
  return candidates[0];
}

function claudeInitializeParams() {
  return {
    protocolVersion: 1,
    clientCapabilities: {
      fs: {
        readTextFile: true,
        writeTextFile: true
      },
      terminal: true,
      auth: {
        terminal: true
      },
      _meta: {
        terminal_output: true,
        "terminal-auth": true
      }
    },
    clientInfo: {
      name: "tsh-desktop",
      title: "tsh",
      version: "0.1.0"
    }
  };
}

function claudeSessionMeta() {
  return {
    claudeCode: {
      options: {
        planModeInstructions:
          "You are in plan mode. Inspect files and gather context as needed, but do not edit files, run mutation commands, or make external changes."
      },
      emitRawSDKMessages: [
        { type: "system", subtype: "init" },
        { type: "result" }
      ]
    }
  };
}

class JsonRpcProbe {
  constructor(child, timeoutMs) {
    this.child = child;
    this.timeoutMs = timeoutMs;
    this.nextId = 1;
    this.pending = new Map();
    this.buffer = "";
    this.updates = [];
    this.acpCommands = null;
    this.sdkSlashCommands = null;
    this.goalUpdate = null;
    this.goalWaiters = [];
    child.stdout.setEncoding("utf8");
    child.stdout.on("data", (chunk) => this.onStdout(chunk));
    child.stderr.setEncoding("utf8");
    child.stderr.on("data", (chunk) => {
      process.stderr.write(`[acp stderr] ${chunk}`);
    });
    child.on("exit", (code, signal) => {
      const error = new Error(
        `claude-agent-acp exited code=${code} signal=${signal}`
      );
      for (const pending of this.pending.values()) {
        pending.reject(error);
      }
      this.pending.clear();
      for (const waiter of this.goalWaiters.splice(0)) {
        waiter.reject(error);
      }
    });
  }

  onStdout(chunk) {
    this.buffer += chunk;
    for (;;) {
      const newline = this.buffer.indexOf("\n");
      if (newline === -1) {
        break;
      }
      const line = this.buffer.slice(0, newline).trim();
      this.buffer = this.buffer.slice(newline + 1);
      if (line) {
        this.onLine(line);
      }
    }
  }

  onLine(line) {
    let message;
    try {
      message = JSON.parse(line);
    } catch {
      console.log(`[acp stdout] ${line}`);
      return;
    }
    if (message.id !== undefined && this.pending.has(String(message.id))) {
      const pending = this.pending.get(String(message.id));
      this.pending.delete(String(message.id));
      clearTimeout(pending.timer);
      pending.resolve(message);
      return;
    }
    if (message.method) {
      this.updates.push(message);
      this.captureACPCommands(message);
      this.captureSDKSlashCommands(message);
      this.captureGoalUpdate(message);
      console.log(
        `[acp notify] ${message.method} ${compactJSON(message.params)}`
      );
      if (message.id !== undefined) {
        this.respondUnsupported(message.id, message.method);
      }
      return;
    }
    console.log(`[acp message] ${compactJSON(message)}`);
  }

  captureACPCommands(message) {
    const update = message.params?.update;
    if (update?.sessionUpdate !== "available_commands_update") {
      return;
    }
    const commands = update.availableCommands ?? update.commands;
    if (!Array.isArray(commands)) {
      return;
    }
    this.acpCommands = commands
      .map((command) =>
        typeof command === "string" ? command : String(command?.name ?? "")
      )
      .filter(Boolean);
  }

  captureSDKSlashCommands(message) {
    const sdk =
      message.params?.message ?? message.params?.sdkMessage ?? message.params;
    const slashCommands = sdk?.slash_commands ?? sdk?.slashCommands;
    if (Array.isArray(slashCommands)) {
      this.sdkSlashCommands = slashCommands.map(String);
    }
  }

  captureGoalUpdate(message) {
    const update = message.params?.update;
    if (update?.sessionUpdate !== "thread_goal_update") {
      return;
    }
    this.goalUpdate = update;
    for (const waiter of this.goalWaiters.splice(0)) {
      waiter.resolve(update);
    }
  }

  async waitForGoalUpdate() {
    if (this.goalUpdate) {
      return this.goalUpdate;
    }
    return await new Promise((resolveWait, reject) => {
      const waiter = {
        resolve: (value) => {
          clearTimeout(timer);
          resolveWait(value);
        },
        reject: (error) => {
          clearTimeout(timer);
          reject(error);
        }
      };
      const timer = setTimeout(() => {
        const index = this.goalWaiters.indexOf(waiter);
        if (index !== -1) {
          this.goalWaiters.splice(index, 1);
        }
        reject(
          new Error(`thread_goal_update timed out after ${this.timeoutMs}ms`)
        );
      }, this.timeoutMs);
      this.goalWaiters.push(waiter);
    });
  }

  respondUnsupported(id, method) {
    this.child.stdin.write(
      `${JSON.stringify({
        jsonrpc: "2.0",
        id,
        error: {
          code: -32601,
          message: `Probe does not implement client method ${method}`
        }
      })}\n`
    );
  }

  async call(method, params) {
    const id = this.nextId++;
    const request = { jsonrpc: "2.0", id, method, params };
    const response = await new Promise((resolveCall, reject) => {
      const timer = setTimeout(() => {
        this.pending.delete(String(id));
        reject(new Error(`${method} timed out after ${this.timeoutMs}ms`));
      }, this.timeoutMs);
      this.pending.set(String(id), { resolve: resolveCall, reject, timer });
      this.child.stdin.write(`${JSON.stringify(request)}\n`);
    });
    if (response.error) {
      const error = new Error(
        `${method} failed: ${compactJSON(response.error)}`
      );
      error.response = response;
      throw error;
    }
    console.log(`[acp result] ${method} ${compactJSON(response.result)}`);
    return response.result;
  }
}

function compactJSON(value) {
  const json = JSON.stringify(value);
  if (!json || json.length <= 900) {
    return json;
  }
  return `${json.slice(0, 900)}...`;
}

function goalObjectiveFromPrompt(prompt) {
  const match = prompt.trim().match(/^\/goal(?:\s+([\s\S]*))?$/);
  if (!match) {
    return "";
  }
  const args = (match[1] ?? "").trim();
  if (!args || args.toLowerCase() === "clear") {
    return "";
  }
  return args;
}

async function main() {
  const args = parseArgs(process.argv.slice(2));
  if (args.help) {
    console.log(usage());
    return;
  }
  const target = resolveTarget(args);
  const prompt = args.prompt ?? DEFAULT_PROMPT;
  const cwd = resolve(args.cwd ?? process.cwd());
  const timeoutMs = Number(args["timeout-ms"] ?? DEFAULT_TIMEOUT_MS);
  if (!Number.isFinite(timeoutMs) || timeoutMs <= 0) {
    throw new Error(`Invalid --timeout-ms: ${args["timeout-ms"]}`);
  }

  console.log(`[probe] command: ${target.label}`);
  console.log(`[probe] cwd: ${cwd}`);
  console.log(`[probe] prompt: ${prompt}`);

  const child = spawn(target.command, target.args, {
    cwd,
    env: { ...process.env, TUTTI_AGENT_ROUTING: "1" },
    shell: target.shell === true,
    stdio: ["pipe", "pipe", "pipe"]
  });
  activeChild = child;
  const rpc = new JsonRpcProbe(child, timeoutMs);

  const initialize = await rpc.call("initialize", claudeInitializeParams());
  console.log(
    `[probe] agent: ${compactJSON(initialize?.agentInfo ?? initialize?.agent)}`
  );

  const session = await rpc.call("session/new", {
    cwd,
    mcpServers: [],
    _meta: claudeSessionMeta()
  });
  const sessionId = session?.sessionId;
  if (!sessionId) {
    throw new Error(
      `session/new did not return sessionId: ${compactJSON(session)}`
    );
  }

  const expectedGoalObjective = goalObjectiveFromPrompt(prompt);
  const promptCall = rpc.call("session/prompt", {
    sessionId,
    prompt: [{ type: "text", text: prompt }]
  });
  const guardedPromptCall = expectedGoalObjective
    ? promptCall.catch(() => null)
    : promptCall;
  if (expectedGoalObjective) {
    const update = await rpc.waitForGoalUpdate();
    const actualObjective = String(update.goal?.objective ?? "").trim();
    if (actualObjective !== expectedGoalObjective) {
      console.log(
        `[probe] FAIL: ACP thread_goal_update objective=${JSON.stringify(actualObjective)}, want ${JSON.stringify(expectedGoalObjective)}.`
      );
      process.exitCode = 2;
    } else {
      console.log(
        "[probe] PASS: ACP emitted thread_goal_update for /goal objective."
      );
    }
    child.kill("SIGTERM");
    await guardedPromptCall;
  } else {
    await guardedPromptCall;
  }

  if (rpc.sdkSlashCommands) {
    console.log(
      `[probe] sdk slash_commands: ${rpc.sdkSlashCommands.join(", ")}`
    );
    if (rpc.sdkSlashCommands.includes("goal")) {
      console.log("[probe] PASS: SDK init advertised native /goal.");
    } else {
      console.log("[probe] FAIL: SDK init did not advertise native /goal.");
      process.exitCode = 2;
    }
  } else {
    console.log(
      "[probe] WARN: no raw SDK system/init slash_commands observed."
    );
  }
  if (rpc.acpCommands) {
    console.log(`[probe] acp availableCommands: ${rpc.acpCommands.join(", ")}`);
    if (rpc.acpCommands.includes("goal")) {
      console.log("[probe] PASS: ACP advertised provider-native /goal.");
    } else {
      console.log("[probe] FAIL: ACP availableCommands did not include /goal.");
      process.exitCode = 2;
    }
  } else {
    console.log("[probe] WARN: no ACP available_commands_update observed.");
  }
}

main()
  .catch((error) => {
    console.error(`[probe] ERROR: ${error.message}`);
    if (error.response) {
      console.error(`[probe] response: ${compactJSON(error.response)}`);
    }
    process.exitCode = 1;
  })
  .finally(() => {
    if (activeChild && !activeChild.killed) {
      activeChild.kill("SIGTERM");
    }
    setTimeout(() => process.exit(process.exitCode ?? 0), 50);
  });
