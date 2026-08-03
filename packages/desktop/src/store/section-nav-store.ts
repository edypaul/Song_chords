import { create } from 'zustand';

/**
 * Session-only shared state for the section navigator's open flag.
 *
 * The navigator itself is hover-driven and lives in
 * `SectionNavigator.tsx`, but other components need to react to
 * that open/close signal too — most notably `BottomSectionSpacer`,
 * which mounts a tall spacer at the end of the song so short
 * trailing sections can still be scrolled to the top of the
 * viewport.
 *
 * `keepSpacer` is a sticky signal — once the user clicks the LAST
 * section from the nav, the spacer stays mounted even after the
 * nav closes, so the trailing heading remains scrolled to the
 * top instead of jumping down when the scrollable range shrinks.
 * Resets when the user picks any non-last section (spacer tears
 * down after the smooth-scroll settles) or reopens the nav.
 *
 * Nothing persists — flags reset on every page load. Hover UIs
 * don't survive across sessions.
 */
interface SectionNavState {
  open: boolean;
  keepSpacer: boolean;
  setOpen: (v: boolean) => void;
  setKeepSpacer: (v: boolean) => void;
}

export const useSectionNavStore = create<SectionNavState>((set) => ({
  open: false,
  keepSpacer: false,
  setOpen: (v) => set({ open: v }),
  setKeepSpacer: (v) => set({ keepSpacer: v }),
}));
