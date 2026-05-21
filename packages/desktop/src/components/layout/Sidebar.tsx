import React from 'react';
import { NavLink, useNavigate, useLocation } from 'react-router-dom';
import { Library, ListMusic, Upload, Settings, Menu, Guitar, Tags, LayoutDashboard, LogOut, Star, Cast } from 'lucide-react';
import TuningForkIcon from '../common/TuningForkIcon';
import { useNavigationGuard } from '../../context/NavigationGuard';

const NAV_ITEMS = [
  { to: '/dashboard',  label: 'Dashboard',  icon: LayoutDashboard },
  { to: '/library',    label: 'Songs',      icon: Library },
  { to: '/favorites',  label: 'Favorites',  icon: Star },
  { to: '/categories', label: 'Categories', icon: Tags },
  { to: '/setlists',   label: 'Set Lists',  icon: ListMusic },
  { to: '/chords',     label: 'Chords',     icon: Guitar },
  { to: '/tuner',      label: 'Tuner',      icon: TuningForkIcon },
  { to: '/import',     label: 'Import',     icon: Upload },
  { to: '/cast',       label: 'Cast',       icon: Cast },
];

interface SidebarProps {
  collapsed: boolean;
  onToggle: () => void;
}

export default function Sidebar({ collapsed, onToggle }: SidebarProps): React.ReactElement {
  // 160px is just wide enough for the longest label ("Categories") with the
  // icon, gap, and surrounding padding, leaving a small margin for comfort.
  const w = collapsed ? 48 : 180;
  const { tryNavigate } = useNavigationGuard();
  const navigate = useNavigate();
  const location = useLocation();

  // Intercept clicks so active navigation guards (e.g. unsaved changes on
  // the Song Edit page) can prompt before the route actually changes.
  const handleNavClick = (to: string) => (e: React.MouseEvent) => {
    // Don't interfere with non-primary clicks (middle-click, Ctrl+click).
    if (e.defaultPrevented || e.button !== 0 || e.ctrlKey || e.metaKey || e.shiftKey || e.altKey) return;
    if (location.pathname === to) return;
    e.preventDefault();
    tryNavigate(() => navigate(to));
  };

  const handleQuit = (e: React.MouseEvent) => {
    e.preventDefault();
    tryNavigate(() => { void window.electronAPI?.app?.quit?.(); });
  };

  return (
    <nav
      className="flex flex-col shrink-0 border-r py-3 gap-1"
      style={{
        width: w,
        minWidth: w,
        background: 'var(--bg-secondary)',
        borderColor: 'var(--border)',
        transition: 'width 0.2s ease, min-width 0.2s ease',
        overflow: 'hidden',
      }}
    >
      {/* Hamburger toggle */}
      <button
        onClick={onToggle}
        className="flex items-center justify-center rounded-lg mx-2 mb-1 transition-colors hover:bg-[var(--surface-elevated)]"
        style={{ height: 36, minWidth: 32, color: 'var(--text-secondary)' }}
        title={collapsed ? 'Expand menu' : 'Collapse menu'}
      >
        <Menu size={18} />
      </button>

      {NAV_ITEMS.map(({ to, label, icon: Icon }) => (
        <NavLink
          key={to}
          to={to}
          onClick={handleNavClick(to)}
          title={collapsed ? label : undefined}
          className={({ isActive }) =>
            `flex items-center rounded-lg mx-2 transition-colors ${
              isActive
                ? 'bg-[var(--accent)] text-white'
                : 'text-[var(--text-secondary)] hover:bg-[var(--surface-elevated)] hover:text-[var(--text-primary)]'
            }`
          }
          style={{ gap: 12, padding: collapsed ? '8px 0' : '8px 12px', justifyContent: collapsed ? 'center' : 'flex-start' }}
        >
          <Icon size={16} style={{ flexShrink: 0 }} />
          {!collapsed && <span className="text-sm truncate">{label}</span>}
        </NavLink>
      ))}

      <div className="flex-1" />

      <NavLink
        to="/settings"
        onClick={handleNavClick('/settings')}
        title={collapsed ? 'Settings' : undefined}
        className={({ isActive }) =>
          `flex items-center rounded-lg mx-2 transition-colors ${
            isActive
              ? 'bg-[var(--accent)] text-white'
              : 'text-[var(--text-secondary)] hover:bg-[var(--surface-elevated)] hover:text-[var(--text-primary)]'
          }`
        }
        style={{ gap: 12, padding: collapsed ? '8px 0' : '8px 12px', justifyContent: collapsed ? 'center' : 'flex-start' }}
      >
        <Settings size={16} style={{ flexShrink: 0 }} />
        {!collapsed && <span className="text-sm">Settings</span>}
      </NavLink>

      <button
        onClick={handleQuit}
        title={collapsed ? 'Quit' : undefined}
        className="flex items-center rounded-lg mx-2 transition-colors text-[var(--text-secondary)] hover:bg-[var(--surface-elevated)] hover:text-[var(--text-primary)]"
        style={{ gap: 12, padding: collapsed ? '8px 0' : '8px 12px', justifyContent: collapsed ? 'center' : 'flex-start' }}
      >
        <LogOut size={16} style={{ flexShrink: 0 }} />
        {!collapsed && <span className="text-sm">Quit</span>}
      </button>
    </nav>
  );
}
