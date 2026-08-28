import React from 'react';
import { Outlet } from 'react-router-dom';
import Sidebar from './Sidebar';
import TitleBar from './TitleBar';
import GlobalSearch from '../common/GlobalSearch';
import { useSidebarStore } from '../../store/sidebar-store';

export default function AppShell(): React.ReactElement {
  // Sidebar collapse state now lives in `useSidebarStore` so pages
  // (SongViewPage in particular) can collapse/expand programmatically
  // — e.g. hiding the sidebar during auto-scroll for a clean read of
  // the scrolling lyrics.
  const collapsed = useSidebarStore((s) => s.collapsed);
  const toggleCollapsed = useSidebarStore((s) => s.toggleCollapsed);

  return (
    <div className="flex flex-col h-full">
      <TitleBar />
      <div className="flex flex-1 overflow-hidden">
        <Sidebar collapsed={collapsed} onToggle={toggleCollapsed} />
        <main className="flex-1 overflow-auto bg-[var(--bg)]">
          <Outlet />
        </main>
      </div>
      {/* App-wide search overlay (Ctrl+K). Mounted inside the router
          shell so it can navigate to results; floats above all pages. */}
      <GlobalSearch />
    </div>
  );
}
