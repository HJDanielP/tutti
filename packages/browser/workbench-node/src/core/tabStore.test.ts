import assert from "node:assert/strict";
import test from "node:test";
import {
  createBrowserNodeTabStore,
  createBrowserTabId,
  resolveBrowserContainerNodeId
} from "./tabStore.ts";

const container = "browser:abc";

test("derives and resolves composite tab ids", () => {
  const tabId = createBrowserTabId(container, 3);
  assert.equal(tabId, "browser:abc::t3");
  assert.equal(resolveBrowserContainerNodeId(tabId), container);
  // Plain node ids (no tab suffix) resolve to themselves.
  assert.equal(resolveBrowserContainerNodeId(container), container);
  // The browser: prefix is preserved so event routing keeps matching.
  assert.ok(tabId.startsWith("browser:"));
});

test("ensureContainer seeds a single active first tab and is idempotent", () => {
  const store = createBrowserNodeTabStore();
  let notifications = 0;
  store.subscribe(() => {
    notifications += 1;
  });

  store.ensureContainer(container, "https://example.com/");
  const seeded = store.getState(container);
  assert.equal(seeded.tabs.length, 1);
  const [firstTab] = seeded.tabs;
  assert.ok(firstTab);
  assert.equal(firstTab.initialUrl, "https://example.com/");
  assert.equal(seeded.activeTabId, firstTab.tabId);
  assert.equal(notifications, 1);

  store.ensureContainer(container, "https://other.com/");
  assert.equal(store.getState(container).tabs.length, 1);
  assert.equal(notifications, 1);
});

test("openTab appends and foreground/background control which tab is active", () => {
  const store = createBrowserNodeTabStore();
  store.ensureContainer(container, "https://a.com/");
  const first = store.getState(container).activeTabId;

  const second = store.openTab(container, "https://b.com/");
  assert.equal(store.getState(container).activeTabId, second);
  assert.equal(store.getState(container).tabs.length, 2);

  const background = store.openTab(container, "https://c.com/", {
    activate: false
  });
  assert.equal(store.getState(container).activeTabId, second);
  const thirdTab = store.getState(container).tabs[2];
  assert.ok(thirdTab);
  assert.equal(thirdTab.tabId, background);
  assert.notEqual(background, first);
});

test("closeTab activates a neighbor and empties the container on last close", () => {
  const store = createBrowserNodeTabStore();
  store.ensureContainer(container, "https://a.com/");
  const a = store.getState(container).activeTabId as string;
  const b = store.openTab(container, "https://b.com/");
  const c = store.openTab(container, "https://c.com/");

  // Closing the active middle-ish tab falls through to the next tab.
  store.activateTab(container, b);
  store.closeTab(container, b);
  assert.equal(store.getState(container).activeTabId, c);
  assert.deepEqual(
    store.getState(container).tabs.map((tab) => tab.tabId),
    [a, c]
  );

  // Closing the active last tab falls back to the previous tab.
  store.closeTab(container, c);
  assert.equal(store.getState(container).activeTabId, a);

  store.closeTab(container, a);
  assert.deepEqual(store.getState(container), { activeTabId: null, tabs: [] });
});

test("closing an inactive tab keeps the active tab", () => {
  const store = createBrowserNodeTabStore();
  store.ensureContainer(container, "https://a.com/");
  const a = store.getState(container).activeTabId as string;
  const b = store.openTab(container, "https://b.com/");
  store.activateTab(container, a);

  store.closeTab(container, b);
  assert.equal(store.getState(container).activeTabId, a);
});

test("moveTab reorders without changing the active tab", () => {
  const store = createBrowserNodeTabStore();
  store.ensureContainer(container, "https://a.com/");
  const a = store.getState(container).activeTabId as string;
  const b = store.openTab(container, "https://b.com/");
  const c = store.openTab(container, "https://c.com/");

  store.moveTab(container, c, 0);
  assert.deepEqual(
    store.getState(container).tabs.map((tab) => tab.tabId),
    [c, a, b]
  );
  assert.equal(store.getState(container).activeTabId, c);
});

test("getState returns a stable snapshot reference until mutated", () => {
  const store = createBrowserNodeTabStore();
  assert.equal(store.getState(container), store.getState("missing"));

  store.ensureContainer(container, "https://a.com/");
  const snapshot = store.getState(container);
  assert.equal(store.getState(container), snapshot);

  store.activateTab(container, snapshot.activeTabId as string);
  assert.equal(store.getState(container), snapshot);

  store.openTab(container, "https://b.com/");
  assert.notEqual(store.getState(container), snapshot);
});

test("clearContainer drops all tab state", () => {
  const store = createBrowserNodeTabStore();
  store.ensureContainer(container, "https://a.com/");
  store.clearContainer(container);
  assert.deepEqual(store.getState(container), { activeTabId: null, tabs: [] });
});
