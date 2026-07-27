import React from 'react';
import { NavLink, useNavigate, useLocation } from 'react-router-dom';
import { Library, ListMusic, Upload, Settings, Menu, Guitar, Tags, LayoutDashboard, LogOut, Star, Cast } from 'lucide-react';
import TuningForkIcon from '../common/TuningForkIcon';
import { useNavigationGuard } from '../../context/NavigationGuard';
import { useT } from '../../i18n';
import type { TKey } from '../../i18n';

// Nav items carry their DICTIONARY KEY (not a hard-coded English
// label) so the sidebar re-renders in the active language when the
// user changes it in Settings.
const NAV_ITEMS: Array<{ to: string; labelKey: TKey; icon: typeof Library }> = [
  { to: '/dashboard',  labelKey: 'sidebar.dashboard',  icon: LayoutDashboard },
  { to: '/library',    labelKey: 'sidebar.songs',      icon: Library },
  { to: '/favorites',  labelKey: 'sidebar.favorites',  icon: Star },
  { to: '/categories', labelKey: 'sidebar.categories', icon: Tags },
  { to: '/setlists',   labelKey: 'sidebar.setLists',   icon: ListMusic },
  { to: '/chords',     labelKey: 'sidebar.chords',     icon: Guitar },
  { to: '/tuner',      labelKey: 'sidebar.tuner',      icon: TuningForkIcon },
  { to: '/import',     labelKey: 'sidebar.import',     icon: Upload },
  { to: '/cast',       labelKey: 'sidebar.cast',       icon: Cast },
];

interface SidebarProps {
  collapsed: boolean;
  onToggle: () => void;
}

export default function Sidebar({ collapsed, onToggle }: SidebarProps): React.ReactElement {
  const t = useT();
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
        title={collapsed ? t('sidebar.expand') : t('sidebar.collapse')}
      >
        <Menu size={18} />
      </button>

      {NAV_ITEMS.map(({ to, labelKey, icon: Icon }) => {
        const label = t(labelKey);
        return (
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
        );
      })}

      <div className="flex-1" />

      <NavLink
        to="/settings"
        onClick={handleNavClick('/settings')}
        title={collapsed ? t('sidebar.settings') : undefined}
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
        {!collapsed && <span className="text-sm">{t('sidebar.settings')}</span>}
      </NavLink>

      <button
        onClick={handleQuit}
        title={collapsed ? t('sidebar.quit') : undefined}
        className="flex items-center rounded-lg mx-2 transition-colors text-[var(--text-secondary)] hover:bg-[var(--surface-elevated)] hover:text-[var(--text-primary)]"
        style={{ gap: 12, padding: collapsed ? '8px 0' : '8px 12px', justifyContent: collapsed ? 'center' : 'flex-start' }}
      >
        <LogOut size={16} style={{ flexShrink: 0 }} />
        {!collapsed && <span className="text-sm">{t('sidebar.quit')}</span>}
      </button>
    </nav>
  );
}
