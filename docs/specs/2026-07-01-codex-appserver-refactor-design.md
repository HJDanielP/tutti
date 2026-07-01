# Codex App-Server Layer Refactor — Design

- Date: 2026-07-01
- Branch: `refactor/codex-appserver-layering`
- Baseline: rebased onto `origin/main` (includes #602 thread-scope, #604 session recycling, #608 attach hydration)
- Status: Design (decisions locked; ready for implementation planning)

## Problem

tutti already integrates the Codex **App Server** — `packages/agent/daemon/runtime/codex_appserver_adapter.go` implements `Start / Resume / Exec / Cancel / SubmitInteractive` and projects server requests into approval / interactive prompts. The integration works, but two different kinds of debt are tangled inside it.

### 1. Maintainability debt (the visible one)

- **No typed protocol boundary.** Methods are hand-maintained string constants (`appServerMethodThreadStart = "thread/start"`, …) and payloads are hand-assembled `map[string]any`. Protocol drift is caught only by humans and tests.
- **Tangled monoliths.** The Codex runtime layer mixes transport, lifecycle, protocol, event reduction, and approval handling across a few very large files:

  | File | Lines | Concerns mixed in |
  |---|---|---|
  | `codex_adapter.go` (Codex-over-ACP, legacy) | 3451 | initialize / prompt / lifecycle |
  | `codex_appserver_adapter.go` | 2209 | lifecycle + method strings + payload assembly |
  | `codex_appserver_events.go` | 1816 | event reduce / mapping |
  | `codex_appserver_review.go` | 140 | review |
  | `codex_appserver_startup_trace.go` | 187 | startup trace |

  ~7.8k hand-written lines covering **less** protocol surface, and harder to maintain, than the ~1.6k hand-written lines + generated types of the cleanest reference (`codex-sdk-go`).

### 2. Correctness debt (the one that actually ships bugs)

We reverse-derived the design goal from the real bug record (merged PRs + log-analysis sessions). The finding that reframes this refactor:

> **Hand-written protocol strings have produced ~0 user-facing bugs.** Every recurring bug clusters around **four state machines that are currently implicit and tangled together**, not around the protocol boundary.

| Cluster | Symptom & source | Root cause |
|---|---|---|
| **A. daemon↔desktop hydration / optimistic reconcile** (highest frequency) | "user sends a message, their own message disappears, only the Agent reply shows" (sessions `7633ebb9` / `2d73bad7` / `08920807`); #608 hydrate-after-attach; #585 / `aab952ba` keep submitted prompts visible / drain queued prompts. | Desktop performs its own optimistic echo + version tracking + reconcile; the transactional boundary is fragile. A live counter-example to the "second core" rule. **Note: the actual defect is desktop-rooted** — daemon correctly holds the user row at `version=1`; desktop pushed `after_version=1` without ever painting it. |
| **B. thread / sub-agent identity** | #602 foreign-thread events dropped. | `session ≡ thread` flat model; a sub-agent's child thread has nowhere to go, so #602 could only *drop* it via `appServerNotificationThreadMismatch`. |
| **C. turn / compaction lifecycle** | compact click fails after context hits 100% (session `67009835`); `4118312f` wait for `turn/completed` before closing a compact turn; `2412b08d` false compact alert from cumulative token count. | Turn lifecycle (including special compact turns) is not a robust, explicit state machine. |
| **D. session / live-session lifecycle** | #604 bolted an idle-recycle path into `controller.go` (2592 lines). | Live-session lifecycle is bolted on, not owned by a layer. |
| **E. approval / authorization** | #418 approval command detail not shown; cua driver auth/restart stalls (`1ec14c03`). | Approval projection & authorization sequencing. |

**Reframed design goal.** This refactor is still **shape-first (option C)** — but shape is the *vehicle*, not the point. The point is to consolidate the four tangled state machines (thread / turn+compact / session-lifecycle / hydration-snapshot) into **explicit, single-owner, tested layers, so that each bug class becomes structurally impossible.** The codegen typed boundary (§ D2/D3) is **demoted from "the point" to "enabling infrastructure"**: it is what lets each layer be built cleanly rather than patched again. Capability parity remains a later, separate effort.

## Goal & Scope

**In scope**
- Refactor the App-Server integration into layered, single-responsibility units backed by a typed protocol boundary, with each of the four state machines owned by exactly one layer.
- **Behavior-preserving by default, correctness-improving by exception:** where current behavior is a known bug/patch (the clusters above), the refactor replaces the patch with a by-construction fix, and the bug's case becomes a regression test (see § Bug Corpus).
- Retire the legacy **Codex-over-ACP** adapter (`codex_adapter.go`) as the final cleanup milestone — **without** touching the generic ACP stack that other agents use.

**In scope, daemon-half only (Cluster A):** the daemon side of the hydration contract — a `clientSubmitId`-keyed, gap-free, fully-resyncable snapshot that gives the desktop the means to self-heal.

**Out of scope (explicitly deferred)**
- **The desktop optimistic/reconcile rewrite (Cluster A desktop-half).** Its root cause is in the renderer, a different layer with a different blast radius. Sequenced as a separate final step (Step 9) / separate effort, on top of the daemon contract this refactor freezes.
- Adding new protocol capabilities (fork / compact / realtime / inject_items surfacing). The codegen layer *makes them available*; wiring them into the product is separate work.
- **Nested sub-agent activity visualization** (rendering a child thread's step-by-step activity). This refactor routes child-thread events to correctly populate the parent's collab tool card (§ D10); the expandable nested view is deferred and made cheap by the thread registry.
- Provider-relay / third-party-model concerns (a different product line; see CodexBridge `codex-provider-relay`).

## Key Decisions

| # | Decision | Rationale |
|---|---|---|
| D1 | **Only the *Codex-over-ACP* path (`codex_adapter.go`) is retired.** App-server is Codex's only future path. The **generic ACP stack is retained** — other agents integrate through it. | Product direction. `standard_acp_adapter.go` (Gemini / Hermes / Claude / future agents) and the shared ACP infra stay; only Codex's use of ACP goes away. |
| D2 | **The typed protocol boundary comes from codegen anchored on the official upstream schema**, not hand-written structs and not vendoring an external SDK. | Official `codex-rs/app-server-protocol` ships `src/bin/export.rs` emitting JSON Schema + TS. Upstream is the single source of truth; drift becomes automatically visible. |
| D3 | **Codegen in one step** — no interim hand-written structs. | Avoids building a typed layer only to throw it away; the pipeline is small and already proven downstream. |
| D4 | **The JSON-RPC transport is already shared and stays shared.** `acp_client.go` is a generic JSON-RPC-over-stdio client (`newACPClient` + `newAppServerJSONRPCClient`); it is **retained** as generic infra. The refactor adds a typed `Client` façade *on top of it* for the Codex app-server path; generic ACP adapters keep using the shared client. | A typed boundary above the shared client, not a transport merge/removal. |
| D5 | **Do not vendor `codex-sdk-go` wholesale into the daemon core.** Use it as pipeline template + skeleton reference + calibration baseline. | Supply-chain trust for daemon core; its facade semantics are its own product opinions. |
| **D6** | **The design goal is consolidating four state machines (thread / turn+compact / session-lifecycle / hydration-snapshot) into explicit single-owner layers; codegen is enabling infra, not the goal.** Each layer's acceptance is a bug class made structurally impossible, verified by the bug corpus. | Reverse-derived from the real bug record: the tangle, not the hand-written strings, is what ships bugs. #602's lesson — patching a bug in a tangled layer just reproduces it — forces "clean the layer first, then fix by construction." |
| **D7** | **The reducer/resolver seam is the type (`activityshared.Event`), not a new cross-protocol interface.** Rule: no Codex-wire type appears in any signature that touches `activityshared.Event`. | `activityshared.Event` is already agent-agnostic (typed `EventPayload`, `Provider` field, no Codex/ACP words) and already emitted by all three adapters. A shared `Reduce(Notification)` across ACP + app-server would require a fake unified input type. Extract an interface only when a *second* real implementation (a future standard_acp refactor) shows what is genuinely shared. |
| **D8** | **Thread becomes a first-class object with a registry; routing replaces #602's drop-filter.** The typed `Client` owns `threadId → thread context` and routes each notification to the right per-thread reducer. | The `session ≡ thread` flat model is the root of the entire foreign-thread bug class. Routing (not filtering) makes it impossible by construction and matches the `codex-sdk-go` `Thread/TurnHandle` shape. |
| **D9** | **Cluster A: daemon contract in scope; desktop rewrite deferred (Step 9).** This refactor guarantees a `clientSubmitId`-keyed, gap-free, resyncable snapshot; the desktop optimistic/reconcile rewrite is a separate final step. | The defect is desktop-rooted; pulling the renderer into a daemon-layering refactor breaks the one-layer-per-step discipline and balloons blast radius. Freeze the contract now so the desktop fix has a foundation. |
| **D10** | **Sub-agent child-thread events are routed to populate the parent collab tool card; nested visualization deferred.** | A sub-agent is a child thread surfaced in the parent as a single `collabAgentToolCall` item. Routing (D8) lets the card carry accurate final status/output/errors — exactly what #602 groped at with `appServerCollabAgentRawOutput`. Nested step-by-step view touches the renderer (out of scope) and is made cheap later by the registry. |
| **Ops-1** | Generated protocol package: **`packages/agent/daemon/runtime/codexproto`** (same module as its consumer; promote to a shared location only if another Go module needs it). | Lowest-friction placement; no premature sharing. |
| **Ops-2** | Schema artifacts: **vendored (committed) + CI drift check.** Commit the `export` output so builds need no Rust toolchain and are reproducible; CI regenerates from a pinned codex checkout and diffs to catch drift. | Gets reproducibility and freshness together. |

## ACP Surface: Keep vs Remove

The ACP code in `packages/agent/daemon/runtime` is a **generic multi-agent stack** with a Codex-specific adapter layered on it. Only the Codex-specific adapter is removed.

| File | Disposition | Why |
|---|---|---|
| `standard_acp_adapter.go` (3503) | **Keep** | Generic ACP adapter serving Gemini / Hermes / Claude / future agents (`NewGeminiAdapter`, `NewHermesAdapter`, …). The reusable path. Per-agent differences are already parameterized via `standardACPConfig`, not new adapters. |
| `acp_client.go` (823) | **Keep** | Generic JSON-RPC-over-stdio client, already dual-purpose (`newACPClient` + `newAppServerJSONRPCClient`). Shared by generic ACP adapters *and* the Codex app-server path. |
| `acp_live_state.go`, `acp_restore_errors.go`, `acp_turn_normalizer.go` | **Keep** | Shared helpers. `acpTurnNormalizer` is verified three-way shared (codex-over-ACP, codex-app-server, standard-ACP). Generic turn/state normalization, not Codex-specific. |
| `codex_adapter.go` (3451) | **Remove (Step 8)** | Codex-over-ACP adapter — the legacy path. |
| `codex_appserver_*.go` | **Refactor** | The subject of this effort. |

**Invariant for the deletion (Step 8):** removing `codex_adapter.go` must leave the generic ACP stack fully functional; its tests (`standard_acp_adapter_test.go`, `acp_*_test.go`) stay green. Any Codex-only branch inside a shared `acp_*` helper is pruned in place, not by deleting the helper.

## The Four State Machines → Owning Layer

| State machine | Cluster | Owning layer / step | By-construction fix |
|---|---|---|---|
| **Thread identity** | B | Thread registry in typed `Client` (Step 3) | Route by `threadId` instead of dropping foreign threads. |
| **Turn + compaction lifecycle** | C | Reducer (turn events, Step 4) + facade (Step 5) | Explicit turn state machine; compact is a first-class special turn (close only on `turn/completed`; correct token accounting). |
| **Session / live-session lifecycle** | D | Thread/Turn facade (Step 7), reconciled with `controller.go` | Facade owns idle-detection/recycling instead of it being bolted on. |
| **Hydration / snapshot contract** | A | Reducer output (Step 4, daemon-half) + deferred desktop (Step 9) | Daemon emits a `clientSubmitId`-keyed, gap-free, resyncable snapshot; desktop stops guessing. |

## Reference Mapping (borrow per-concern, never mono-copy)

| Layer / concern | Best reference | Notes |
|---|---|---|
| Protocol source of truth (types, method surface) | **Official `codex-rs/app-server-protocol`** `bin/export` (JSON Schema + TS, `--experimental` flag) | Everything else is downstream of this. |
| Event semantics / lossless tier | **Official `app-server-client`** (unifies in-process + remote into one `AppServerEvent`; deltas / `item/completed` / `turn/completed` must be delivered, progress may degrade) | Canonical backpressure design; directly informs the Cluster A snapshot contract. |
| Go layering (Transport / Client / typed stubs / facade) + first-class Thread | **`codex-sdk-go`** | Same language; ~1.6k hand-written lines cover ~90 client + 9 server methods via generated `types_gen.go`. Its `Thread/TurnHandle` shape is the target for the D8 thread registry. |
| Event reducer / tool mapping | `ai-sdk-provider-codex-asp` `CodexEventMapper` | Cross-turn tool-result backfill, worker affinity (if/when needed). |
| Approval → durable pending state | `openclaw-codex-app-server` pending-input model | Approval/user-input becomes durable state + UI-driven response, not a blocking RPC handler. |
| Non-destructive hydration; approval stall detection | `Agmente` (loaded-thread read over resume), `CodexBridge` (approved-but-no-signal detection) | Informs the Cluster A/E fixes and the reducer/resolver interfaces. |

## Invariant (tutti architecture rule)

Thread / turn / approval / history reconciliation lives in the daemon (`services/tuttid` / `packages/agent/daemon`). `apps/desktop` only consumes typed state/events and submits commands (approve / interrupt / start-turn). **The desktop must not grow into a second Codex business core.**

**Litmus test:** does the desktop need to know Codex's wire format?
- Yes (touches method names / event schema / JSON-RPC) → it is becoming a second core → **violation.**
- Only tutti's own `AgentActivity*` typed domain → **correct.**

**Post-refactor acceptance of the invariant:** what the desktop can obtain must not be *closer to the raw Codex protocol* than before. The lossless tier must reach the daemon's typed events; the desktop only ever sees tutti domain types. (Cluster A's daemon-half contract is how the desktop gets everything it needs *without* the wire.)

## Target Architecture

```
                                   ┌─ Event Reducer ──────→ tutti typed activity events (lossless tier)
                                   │   + hydration/snapshot contract (clientSubmitId-keyed, resyncable)
Transport ──→ typed Client ──→ Thread ┤
 (stdio)      (pending req      registry ├─ Approval Resolver ──→ durable pending state + typed responder
              / server req      (threadId │   (server requests)
              / notif sub)      → context)└─ Thread/Turn Facade ─→ lifecycle orchestration
                  ▲              per-thread     (session + live-session recycling; the thinned adapter)
                  │              routing;
                  │              child thread → parent collab card (D10)
           codexproto pkg (codegen; anchored on official export;
                           version-stamped; CI drift check)  — enabling infra
                  ▲
       shared JSON-RPC client (acp_client.go) ── also serves ──▶ generic ACP stack
                  ▲                                              (standard_acp_adapter.go:
       Codex-over-ACP adapter (codex_adapter.go)                 Gemini / Hermes / Claude …)
       — legacy, deleted in Step 8                                — RETAINED

  [deferred Step 9 / separate effort] desktop optimistic/reconcile rewrite,
  consuming the frozen Cluster A snapshot contract.
```

## Multi-Step Alignment Plan

All four state machines are consolidated, but sequenced into independently shippable steps. Order: safety net → additive codegen → bottom-up (transport → thread → events → turn → approvals → facade) → legacy deletion → deferred desktop. Each step keeps the work-area tests green and lands its bug-class regression tests.

### Step 0 — Characterization safety net + bug corpus
- Establish existing `codex_appserver_*_test.go` as the behavioral contract.
- **Import the bug corpus as regression tests** (Clusters A/B/C/D/E — currently green because the fixes are merged); the refactor must keep them green and, where it replaces a patch, keep the same observable outcome via the new structure.
- Add golden tests where thin: event reducer output, approval/interactive projection.
- Pin a Codex version baseline.
- **Exit:** a test set (including the bug corpus) that every subsequent step must keep green.

### Step 1 — Typed protocol layer (codegen, one step) · *enabling infra*
- New package `packages/agent/daemon/runtime/codexproto`: run official `export` → generate protocol types + RPC stubs → version-stamp. Vendor the artifacts (Ops-2).
- Add CI drift check (regenerate from pinned codex checkout and diff).
- **Purely additive** — nothing consumes it yet.
- **Exit:** generated typed layer builds; drift check runs in CI.

### Step 2 — Typed Client façade over the shared transport
- Add a typed `Client` (pending requests, server-request handling, notification subscriptions) for the Codex app-server path, aligned to `codex-sdk-go` `rpc/`, **wrapping the existing shared `acp_client.go`** rather than replacing it.
- App-server adapter now calls via typed stubs (`codexproto`) instead of string + `map[string]any`.
- **Do not** delete or restructure `acp_client.go` or the generic ACP adapters.
- **Exit:** Codex app-server path speaks through the typed `Client`; generic ACP stack untouched; tests green.

### Step 3 — Thread registry (state machine B)
- Promote thread to a first-class object: the `Client` owns `threadId → thread context` and routes each notification to the right per-thread reducer.
- **Routing replaces #602's `appServerNotificationThreadMismatch` drop-filter.** Child (sub-agent) threads route to their own context; their result folds into the parent's `collabAgentToolCall` card (D10).
- **Exit:** foreign-thread bug class impossible by construction; #602 regression tests pass via routing (not dropping); the drop-filter is removed.

### Step 4 — Event Reducer + hydration/snapshot contract (state machine A, daemon-half)
- Pull event handling out of the 1816-line file into a focused reducer: app-server notification → tutti typed activity event.
- Bake in the official **lossless tier**: deltas / `item/completed` / `turn/completed` guaranteed; progress-class events may degrade.
- **Define the daemon snapshot/hydration contract:** complete, `clientSubmitId`-keyed, gap-free, fully resyncable — so an unpainted-but-real user row cannot be skipped by `after_version`, and the desktop can always recover the true state.
- **Exit:** reducer is a standalone, tested unit; the Cluster A snapshot contract is specified and tested at the daemon boundary; adapter no longer parses raw notifications inline.

### Step 5 — Turn + compaction lifecycle (state machine C)
- Make the turn lifecycle an explicit state machine spanning the reducer (turn events) and facade; **compaction is a first-class special turn** (closed only on `turn/completed`; token accounting that cannot raise false compact alerts).
- **Exit:** Cluster C regression tests (compact-after-100%, compact-turn-close ordering, token-accounting) pass through the explicit state machine.

### Step 6 — Approval / Interactive Resolver (state machine E)
- Pull server-request handling (command/file/permissions approvals, `requestUserInput`, MCP elicitation) into a resolver that projects to durable pending state + a typed responder; surface approval command detail (#418).
- Cover the **unknown / unsupported server-request** path with an explicit reject/error surface.
- **Exit:** approval flow is a standalone, tested unit; Cluster E cases covered.

### Step 7 — Thin the Adapter into a Thread/Turn facade + session lifecycle (state machine D)
- What remains of `codex_appserver_adapter.go` collapses onto Thread/Turn lifecycle orchestration over the new layers (facade shape per `codex-sdk-go`).
- **The facade owns session / live-session lifecycle**, reconciled with `controller.go`'s idle-recycle path (#604) so recycling is owned, not bolted on.
- **Exit:** adapter is orchestration only; no protocol strings or inline reduction remain; Cluster D recycling behavior owned by the facade.

### Step 8 — Retire Codex-over-ACP
- Delete `codex_adapter.go` (3451) and any Codex-only helpers/branches; prune Codex-only branches inside shared `acp_*` helpers in place.
- **Explicitly preserve** `standard_acp_adapter.go`, `acp_client.go`, and the shared `acp_*` helpers.
- **Exit:** Codex speaks only app-server; `codex_adapter.go` gone; generic ACP stack green; full runtime package tests green.

### Step 9 — *(deferred / separate effort)* Desktop optimistic/reconcile rewrite (state machine A, desktop-half)
- On top of the frozen Cluster A snapshot contract, rewrite the desktop optimistic echo + version tracking + reconcile so an unpainted optimistic row cannot desync `after_version`, and a `clientSubmitId`-based backfill recovers the true user row.
- **Exit:** the "user message disappears" bug class is closed end-to-end; desktop consumes only tutti domain types (invariant holds).

## Testing Strategy

- **Contract:** Step 0's characterization tests **plus the bug corpus** are the invariant across all steps.
- **By state machine:** each of Steps 3–7 lands its extracted unit with focused tests *and* the corresponding bug-class regression tests as its acceptance gate.
- **Drift:** Step 1's CI check regenerates `codexproto` and fails on unexpected diff.
- **Baseline command (work area):** `go build ./runtime/...` + `go test ./runtime/ -run <app-server pattern>` in `packages/agent/daemon`.

## Risks & Mitigations

| Risk | Mitigation |
|---|---|
| Codegen toolchain depends on the Rust `export` bin / `go-jsonschema` | Vendor the schema output (Ops-2); document the regen command; CI drift check catches skew. |
| Upstream schema churn mid-refactor | Pin a baseline version (Step 0); treat version bumps as isolated, reviewable diffs. |
| **Routing (D8) changes behavior: child-thread events were dropped, now attributed** | Scope the change to populating the parent collab card (D10); nested rendering stays out of scope; Cluster B regression tests assert the parent card outcome, not new streams. |
| **Four-state-machine scope creep** | Each state machine is one step with a bug-class acceptance gate; the desktop half of Cluster A is explicitly deferred (Step 9); no step combines layers. |
| Cluster A daemon contract implies but does not deliver the desktop fix | Step 9 is explicit and sequenced; the contract is frozen and tested at the daemon boundary so the desktop fix has a stable foundation. |
| Step 8 deletion accidentally breaks the generic ACP stack | Keep/Remove table + deletion invariant; generic ACP tests gate the deletion; prune Codex-only branches in place. |
| Large blast radius if steps are batched | Each step is independently shippable and reviewable; do not combine. |

## Resolved Decisions (previously open)

- **Generated protocol package location** → `packages/agent/daemon/runtime/codexproto` (Ops-1).
- **Vendored vs CI-regenerated schema** → vendored + CI drift check (Ops-2).
- **Reducer/resolver interface breadth** → seam-is-the-type; no cross-protocol interface now (D7).
- **Refactor vs bug-fixing** → all four state machines in scope, sequenced; bugs reverse-define the goal and gate each step (D6); Cluster A desktop-half deferred to Step 9 (D9); sub-agent routing scoped to the parent card (D10).
