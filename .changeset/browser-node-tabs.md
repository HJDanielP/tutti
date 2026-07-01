---
"@tutti-os/browser-node": minor
---

Add tabbed browsing to the browser node: multiple pages now open as tabs within a single window instead of spawning a new window per link. In-page link opens — and external "open in browser" launches — become tabs in the existing browser window (⌘/Ctrl-click opens a background tab), and the tab strip supports adding, closing, and drag-to-reorder. All open tabs are persisted and restored on relaunch.
