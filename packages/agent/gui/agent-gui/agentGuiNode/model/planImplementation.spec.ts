import { describe, expect, it } from "vitest";
import {
  PLAN_IMPLEMENTATION_PROMPT,
  shouldOfferPlanImplementation
} from "./planImplementation";

describe("shouldOfferPlanImplementation", () => {
  const base = {
    provider: "codex",
    previousStatus: "working",
    status: "ready",
    planModeActive: true
  };

  it("offers after a codex plan-mode turn completes", () => {
    expect(shouldOfferPlanImplementation(base)).toBe(true);
  });

  it("does not offer outside plan mode", () => {
    expect(
      shouldOfferPlanImplementation({ ...base, planModeActive: false })
    ).toBe(false);
  });

  it("does not offer for providers with their own exit-plan flow", () => {
    expect(
      shouldOfferPlanImplementation({ ...base, provider: "claude-code" })
    ).toBe(false);
  });

  it("only offers on the working-to-ready transition", () => {
    expect(
      shouldOfferPlanImplementation({ ...base, previousStatus: "ready" })
    ).toBe(false);
    expect(shouldOfferPlanImplementation({ ...base, status: "failed" })).toBe(
      false
    );
    expect(
      shouldOfferPlanImplementation({ ...base, previousStatus: null })
    ).toBe(false);
  });

  it("submits the same literal message as the codex TUI", () => {
    expect(PLAN_IMPLEMENTATION_PROMPT).toBe("Implement the plan.");
  });
});
