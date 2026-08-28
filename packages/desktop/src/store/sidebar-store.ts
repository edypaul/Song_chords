import { create } from 'zustand';

/**
 * Session-only shared state for the left-hand navigation sidebar's
 * collapsed flag. Lifted out of `AppShell` so pages can programmatically
 * collapse / expand it — most notably the Song View page, which
 * collapses the sidebar on auto-scroll start (clean read of the
 * scrolling lyrics) and restores it when auto-scroll ends.
 *
 * The user can always toggle the sidebar manually via the hamburger
 * icon in `Sidebar.tsx`; both AppShell's toggle and any page's
 * programmatic call go through the same `setCollapsed` setter.
 *
 * Not persisted — the sidebar always starts expanded on app boot.
 */
interface SidebarState {
  collapsed: boolean;
  setCollapsed: (v: boolean) => void;
  toggleCollapsed: () => void;
}

export const useSidebarStore = create<SidebarState>((set) => ({
  collapsed: false,
  setCollapsed: (v) => set({ collapsed: v }),
  toggleCollapsed: () => set((s) => ({ collapsed: !s.collapsed })),
}));
