import type { ReactNode } from "react";

export type MentionPaletteFilterId = string;
export type MentionPaletteGroupId = string;

export interface MentionPaletteCategory {
  id: MentionPaletteFilterId;
  label: string;
}

export interface MentionPaletteGroup<TItem> {
  id: MentionPaletteGroupId;
  label?: string;
  items: readonly TItem[];
  totalCount: number;
  visibleCount: number;
  hasMore: boolean;
  emptyLabel?: string;
  /**
   * Optional precomputed label for the "show more" expand control. When omitted
   * the shell falls back to `+<remaining>`. Surfaces that need exact wording
   * (e.g. the agent's translated "show N more") compute this themselves so the
   * shell stays free of surface-specific i18n.
   */
  expandLabel?: string;
}

export type MentionPaletteState<TItem> =
  | {
      status: "idle";
      query: string;
      mode: "browse";
      filter: MentionPaletteFilterId;
      categories: readonly MentionPaletteCategory[];
      groups: readonly MentionPaletteGroup<TItem>[];
      error: null;
    }
  | {
      status: "loading" | "ready";
      query: string;
      mode: "browse" | "results";
      filter: MentionPaletteFilterId;
      categories: readonly MentionPaletteCategory[];
      groups: readonly MentionPaletteGroup<TItem>[];
      error: null;
    }
  | {
      status: "error";
      query: string;
      mode: "browse" | "results";
      filter: MentionPaletteFilterId;
      categories: readonly MentionPaletteCategory[];
      groups: readonly MentionPaletteGroup<TItem>[];
      error: string;
    };

export interface MentionPaletteEntry {
  key: string;
  type: "category" | "item" | "expand";
  categoryId?: MentionPaletteFilterId;
  groupId?: MentionPaletteGroupId;
  itemIndex?: number;
}

export interface MentionPaletteProps<TItem> {
  state: MentionPaletteState<TItem>;
  highlightedKey: string | null;
  getItemKey: (item: TItem, group: MentionPaletteGroup<TItem>) => string;
  renderItem: (item: TItem, ctx: { active: boolean }) => ReactNode;
  labels: { loading: string; empty: string; error: string; tabHint: string };
  hintLabels: { cycleFilter: string; moveSelection: string };
  maxHeightPx: number;
  onHighlightChange: (key: string) => void;
  onSelectItem: (item: TItem, group: MentionPaletteGroup<TItem>) => void;
  onSelectCategory: (categoryId: MentionPaletteFilterId) => void;
  onSelectFilter: (filter: MentionPaletteFilterId) => void;
  onExpandGroup: (groupId: MentionPaletteGroupId) => void;
  onCycleFilter: (delta: 1 | -1) => void;
  onMoveSelection: (delta: 1 | -1) => void;
  /** Rendered after the groups, before the keyboard hint bar. */
  renderListFooter?: () => ReactNode;
}
