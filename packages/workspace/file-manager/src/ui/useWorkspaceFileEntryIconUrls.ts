import { useEffect, useState } from "react";
import type { WorkspaceFileEntry } from "../services/workspaceFileManagerTypes.ts";
import {
  resolveWorkspaceFileEntryIconCacheKey,
  shouldResolveWorkspaceFileEntryIcon
} from "./workspaceFileEntryIconPolicy.ts";

export function useWorkspaceFileEntryIconUrls(input: {
  entries: readonly WorkspaceFileEntry[];
  resolveEntryIconUrl?: (
    entry: WorkspaceFileEntry
  ) => Promise<string | null | undefined>;
}): ReadonlyMap<string, string | null> {
  const { entries, resolveEntryIconUrl } = input;
  const [iconUrlByCacheKey, setIconUrlByCacheKey] = useState<
    ReadonlyMap<string, string | null>
  >(() => new Map());

  useEffect(() => {
    if (!resolveEntryIconUrl) {
      setIconUrlByCacheKey(new Map());
      return;
    }

    let cancelled = false;
    const targets = entries.filter(shouldResolveWorkspaceFileEntryIcon);

    void Promise.all(
      targets.map(async (entry) => {
        const cacheKey = resolveWorkspaceFileEntryIconCacheKey(entry);
        try {
          const iconUrl = await resolveEntryIconUrl(entry);
          return [cacheKey, iconUrl?.trim() || null] as const;
        } catch {
          return [cacheKey, null] as const;
        }
      })
    ).then((results) => {
      if (cancelled) {
        return;
      }
      setIconUrlByCacheKey((current) => {
        const next = new Map(current);
        for (const [cacheKey, iconUrl] of results) {
          next.set(cacheKey, iconUrl);
        }
        return next;
      });
    });

    return () => {
      cancelled = true;
    };
  }, [entries, resolveEntryIconUrl]);

  return iconUrlByCacheKey;
}
