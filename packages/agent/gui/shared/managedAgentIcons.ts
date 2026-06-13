import manageAgentClaudeCodeUrl from "../app/renderer/assets/icons/agents/manage-agent-claude-code.png";
import manageAgentCodexUrl from "../app/renderer/assets/icons/agents/manage-agent-codex.png";
import manageAgentGeminiUrl from "../app/renderer/assets/icons/agents/manage-agent-gemini.png";
import manageAgentHermesUrl from "../app/renderer/assets/icons/agents/manage-agent-hermes.png";
import manageAgentTuttiUrl from "../app/renderer/assets/icons/agents/manage-agent-tutti.png";
import manageAgentOpenclawUrl from "../app/renderer/assets/icons/agents/manage-agent-openclaw.png";
import claudeRoundedUrl from "../app/renderer/assets/icons/agents/claude-rounded.png";
import codexRoundedUrl from "../app/renderer/assets/icons/agents/codex-rounded.png";
import geminiRoundedUrl from "../app/renderer/assets/icons/agents/gemini-rounded.png";
import hermesRoundedUrl from "../app/renderer/assets/icons/agents/hermes-rounded.png";
import tuttiDocRoundedUrl from "../app/renderer/assets/icons/agents/tutti-doc-rounded.png";
import openclawRoundedUrl from "../app/renderer/assets/icons/agents/openclaw-rounded.png";
import { normalizeManagedAgentProvider } from "./managedAgentProviders";

/** Square avatar art for the managed toolchain agents (used by Manage Agents and Launch home Agents floor). */
export const MANAGED_AGENT_ICON_URLS: Record<string, string> = {
  "claude-code": manageAgentClaudeCodeUrl,
  codex: manageAgentCodexUrl,
  gemini: manageAgentGeminiUrl,
  hermes: manageAgentHermesUrl,
  tutti: manageAgentTuttiUrl,
  openclaw: manageAgentOpenclawUrl
};

/** Rounded avatars for Room status / room activity panel only. */
export const MANAGED_AGENT_ICON_ROUNDED_URLS: Record<string, string> = {
  "claude-code": claudeRoundedUrl,
  codex: codexRoundedUrl,
  gemini: geminiRoundedUrl,
  hermes: hermesRoundedUrl,
  tutti: tuttiDocRoundedUrl,
  openclaw: openclawRoundedUrl
};

/** 与 Manage Agents 列表用的方图区分；房间预览弹幕条等仅用圆图 */
const MANAGED_AGENT_ROUNDED_ICON_FALLBACK_URL = tuttiDocRoundedUrl;

export const MANAGED_AGENT_ICON_FALLBACK_URL = manageAgentTuttiUrl;

export function managedAgentRoundedIconUrl(
  provider: string | undefined
): string {
  return (
    MANAGED_AGENT_ICON_ROUNDED_URLS[normalizeManagedAgentProvider(provider)] ??
    MANAGED_AGENT_ROUNDED_ICON_FALLBACK_URL
  );
}
