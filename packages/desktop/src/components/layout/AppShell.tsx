import React, { useState } from 'react';
import { Outlet } from 'react-router-dom';
import Sidebar from './Sidebar';
import TitleBar from './TitleBar';
import GlobalSearch from '../common/GlobalSearch';

export default function AppShell(): React.ReactElement {
  const [collapsed, setCollapsed] = useState(false);

  return (
    <div className="flex flex-col h-full">
      <TitleBar />
      <div className="flex flex-1 overflow-hidden">
        <Sidebar collapsed={collapsed} onToggle={() => setCollapsed((c) => !c)} />
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
