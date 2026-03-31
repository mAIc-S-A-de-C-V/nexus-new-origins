import React, { useState } from 'react';
import {
  Plug, Network, GitBranch, Activity, Workflow, Settings,
  ChevronLeft, ChevronRight, LayoutDashboard, ChevronDown, ChevronUp,
  FolderKanban, Users, LogOut, ScanSearch, DollarSign, Briefcase,
} from 'lucide-react';
import { useAuth } from './TenantContext';
import { useAppStore } from '../store/appStore';

// ── maic icon SVG ──────────────────────────────────────────────────────────

const MaicIcon: React.FC<{ size?: number }> = ({ size = 22 }) => (
  <svg width={size} height={size} viewBox="0 0 44 44" fill="none" xmlns="http://www.w3.org/2000/svg">
    <line x1="18" y1="18" x2="9"  y2="9"  stroke="#7C3AED" strokeWidth="2.8" strokeLinecap="round" />
    <line x1="26" y1="18" x2="35" y2="9"  stroke="#7C3AED" strokeWidth="2.8" strokeLinecap="round" />
    <line x1="18" y1="26" x2="9"  y2="35" stroke="#7C3AED" strokeWidth="2.8" strokeLinecap="round" />
    <line x1="26" y1="26" x2="35" y2="35" stroke="#7C3AED" strokeWidth="2.8" strokeLinecap="round" />
    <line x1="26" y1="22" x2="31" y2="22" stroke="#7C3AED" strokeWidth="2.8" strokeLinecap="round" />
    <circle cx="8"  cy="8"  r="5.5" fill="#7C3AED" />
    <circle cx="36" cy="8"  r="5.5" fill="#7C3AED" />
    <circle cx="8"  cy="36" r="5.5" fill="#7C3AED" />
    <circle cx="36" cy="36" r="5.5" fill="#7C3AED" />
    <circle cx="33" cy="22" r="3.5" fill="#7C3AED" />
    <rect x="17" y="17" width="10" height="10" rx="2.5" fill="#7C3AED" />
  </svg>
);

// ── Nav items ──────────────────────────────────────────────────────────────

interface NavItem {
  id: string;
  label: string;
  icon: React.ReactNode;
  active: boolean;
  comingSoon?: boolean;
  path: string;
  adminOnly?: boolean;
}

const NAV_ITEMS: NavItem[] = [
  { id: 'connectors', label: 'Connectors',     icon: <Plug size={16} />,         active: true,  path: 'connectors' },
  { id: 'ontology',   label: 'Ontology',       icon: <Network size={16} />,       active: true,  path: 'ontology' },
  { id: 'lineage',    label: 'Lineage',        icon: <GitBranch size={16} />,     active: false, comingSoon: true, path: 'lineage' },
  { id: 'events',     label: 'Event Log',      icon: <Activity size={16} />,      active: true,  path: 'events' },
  { id: 'process',    label: 'Process Mining', icon: <ScanSearch size={16} />,    active: true,  path: 'process' },
  { id: 'pipelines',  label: 'Pipelines',      icon: <Workflow size={16} />,      active: true,  path: 'pipelines' },
  { id: 'users',      label: 'Users',          icon: <Users size={16} />,         active: true,  path: 'users', adminOnly: true },
  { id: 'settings',   label: 'Settings',       icon: <Settings size={16} />,      active: false, comingSoon: true, path: 'settings' },
];

const MAIC_SUBITEMS: NavItem[] = [
  { id: 'projects', label: 'Projects', icon: <Briefcase size={14} />, active: true, path: 'projects' },
  { id: 'finance',  label: 'Finance',  icon: <DollarSign size={14} />, active: true, path: 'finance' },
];

// ── Component ──────────────────────────────────────────────────────────────

interface NavRailProps {
  currentPage: string;
  onNavigate: (page: string) => void;
}

export const NavRail: React.FC<NavRailProps> = ({ currentPage, onNavigate }) => {
  const [expanded, setExpanded] = useState(true);
  const [appsExpanded, setAppsExpanded] = useState(true);
  const [maicExpanded, setMaicExpanded] = useState(true);
  const [userMenuOpen, setUserMenuOpen] = useState(false);
  const { currentUser, logout } = useAuth();
  const { apps } = useAppStore();

  const isAdmin = currentUser?.role === 'ADMIN';
  const width = expanded ? 220 : 56;

  const canSee = (moduleId: string): boolean => {
    if (isAdmin) return true;
    const mods = currentUser?.allowed_modules;
    if (!mods || mods.length === 0) return true;
    return mods.includes(moduleId);
  };

  const navBtn = (
    item: NavItem,
    isActive: boolean,
    onClick: () => void,
    indented = false,
    small = false,
  ) => (
    <button
      key={item.id}
      onClick={onClick}
      title={!expanded ? item.label : undefined}
      style={{
        display: 'flex', alignItems: 'center', gap: 10,
        width: '100%', height: small ? 34 : 38,
        padding: expanded ? (indented ? '0 16px 0 32px' : '0 14px') : '0',
        justifyContent: expanded ? 'flex-start' : 'center',
        backgroundColor: isActive ? '#161D2B' : 'transparent',
        color: isActive ? '#E2E8F0' : item.comingSoon ? '#334155' : '#64748B',
        cursor: item.active ? 'pointer' : 'default',
        transition: 'background-color 80ms, color 80ms',
        borderLeft: isActive ? '2px solid #7C3AED' : '2px solid transparent',
        borderTop: 'none', borderRight: 'none', borderBottom: 'none',
        flexShrink: 0, textAlign: 'left',
      }}
      onMouseEnter={(e) => {
        if (!isActive && item.active) {
          (e.currentTarget as HTMLElement).style.backgroundColor = '#0F1620';
          (e.currentTarget as HTMLElement).style.color = '#CBD5E1';
        }
      }}
      onMouseLeave={(e) => {
        if (!isActive) {
          (e.currentTarget as HTMLElement).style.backgroundColor = 'transparent';
          (e.currentTarget as HTMLElement).style.color = item.comingSoon ? '#334155' : '#64748B';
        }
      }}
    >
      <span style={{ flexShrink: 0, lineHeight: 0, opacity: item.comingSoon ? 0.4 : 1 }}>{item.icon}</span>
      {expanded && (
        <>
          <span style={{
            fontSize: small ? 12 : 13, fontWeight: isActive ? 500 : 400,
            whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis',
            opacity: item.comingSoon ? 0.4 : 1,
          }}>
            {item.label}
          </span>
          {item.comingSoon && (
            <span style={{
              marginLeft: 'auto', fontSize: 9, color: '#334155',
              border: '1px solid #1E293B', padding: '1px 4px',
              flexShrink: 0, letterSpacing: '0.04em',
            }}>
              SOON
            </span>
          )}
        </>
      )}
    </button>
  );

  return (
    <nav style={{
      width, minWidth: width, height: '100vh',
      backgroundColor: '#080E18',
      display: 'flex', flexDirection: 'column',
      transition: 'width 120ms ease-out, min-width 120ms ease-out',
      overflow: 'hidden',
      borderRight: '1px solid #131C2E',
      flexShrink: 0, position: 'relative', zIndex: 10,
    }}>
      {/* Logo */}
      <div style={{
        height: 52, display: 'flex', alignItems: 'center',
        padding: expanded ? '0 14px' : '0', justifyContent: expanded ? 'flex-start' : 'center',
        borderBottom: '1px solid #131C2E', gap: 10, flexShrink: 0,
      }}>
        <MaicIcon size={22} />
        {expanded && (
          <span style={{ color: '#F8FAFC', fontSize: 15, fontWeight: 700, letterSpacing: '-0.02em', whiteSpace: 'nowrap' }}>
            maic
          </span>
        )}
      </div>

      {/* Nav items */}
      <div style={{ flex: 1, padding: '6px 0', overflowY: 'auto', overflowX: 'hidden' }}>
        {NAV_ITEMS
          .filter((item) => !item.adminOnly || isAdmin)
          .filter((item) => canSee(item.path))
          .map((item) =>
            navBtn(item, currentPage === item.path, () => item.active && onNavigate(item.path)),
          )}

        {/* ── maic group ───────────────────────────────────────────────── */}
        {(canSee('projects') || canSee('finance')) && (
          <>
            <button
              onClick={() => expanded ? setMaicExpanded((v) => !v) : onNavigate('projects')}
              title={!expanded ? 'maic' : undefined}
              style={{
                display: 'flex', alignItems: 'center', gap: 10,
                width: '100%', height: 38,
                padding: expanded ? '0 14px' : '0',
                justifyContent: expanded ? 'flex-start' : 'center',
                backgroundColor: (currentPage === 'projects' || currentPage === 'finance') ? '#161D2B' : 'transparent',
                color: (currentPage === 'projects' || currentPage === 'finance') ? '#E2E8F0' : '#64748B',
                cursor: 'pointer', transition: 'background-color 80ms, color 80ms',
                borderLeft: (currentPage === 'projects' || currentPage === 'finance') ? '2px solid #7C3AED' : '2px solid transparent',
                borderTop: 'none', borderRight: 'none', borderBottom: 'none',
                flexShrink: 0,
              }}
              onMouseEnter={(e) => {
                if (currentPage !== 'projects' && currentPage !== 'finance') {
                  (e.currentTarget as HTMLElement).style.backgroundColor = '#0F1620';
                  (e.currentTarget as HTMLElement).style.color = '#CBD5E1';
                }
              }}
              onMouseLeave={(e) => {
                if (currentPage !== 'projects' && currentPage !== 'finance') {
                  (e.currentTarget as HTMLElement).style.backgroundColor = 'transparent';
                  (e.currentTarget as HTMLElement).style.color = '#64748B';
                }
              }}
            >
              <span style={{ flexShrink: 0, lineHeight: 0 }}><FolderKanban size={16} /></span>
              {expanded && (
                <>
                  <span style={{ fontSize: 13, fontWeight: (currentPage === 'projects' || currentPage === 'finance') ? 500 : 400 }}>maic</span>
                  <span style={{ marginLeft: 'auto', lineHeight: 0, flexShrink: 0, color: '#475569' }}>
                    {maicExpanded ? <ChevronUp size={11} /> : <ChevronDown size={11} />}
                  </span>
                </>
              )}
            </button>
            {expanded && maicExpanded && MAIC_SUBITEMS.filter(s => canSee(s.path)).map((sub) =>
              navBtn(sub, currentPage === sub.path, () => onNavigate(sub.path), true, true),
            )}
          </>
        )}

        {/* Apps section */}
        <div style={{ borderTop: '1px solid #131C2E', marginTop: 6, paddingTop: 4 }}>
          <button
            onClick={() => { if (expanded) setAppsExpanded((v) => !v); onNavigate('apps'); }}
            title={!expanded ? 'Apps' : undefined}
            style={{
              display: 'flex', alignItems: 'center', gap: 10,
              width: '100%', height: 38,
              padding: expanded ? '0 14px' : '0',
              justifyContent: expanded ? 'flex-start' : 'center',
              backgroundColor: currentPage === 'apps' ? '#161D2B' : 'transparent',
              color: currentPage === 'apps' ? '#E2E8F0' : '#64748B',
              cursor: 'pointer', transition: 'background-color 80ms, color 80ms',
              borderLeft: currentPage === 'apps' ? '2px solid #7C3AED' : '2px solid transparent',
              borderTop: 'none', borderRight: 'none', borderBottom: 'none',
              flexShrink: 0,
            }}
            onMouseEnter={(e) => {
              if (currentPage !== 'apps') {
                (e.currentTarget as HTMLElement).style.backgroundColor = '#0F1620';
                (e.currentTarget as HTMLElement).style.color = '#CBD5E1';
              }
            }}
            onMouseLeave={(e) => {
              if (currentPage !== 'apps') {
                (e.currentTarget as HTMLElement).style.backgroundColor = 'transparent';
                (e.currentTarget as HTMLElement).style.color = '#64748B';
              }
            }}
          >
            <span style={{ flexShrink: 0, lineHeight: 0 }}><LayoutDashboard size={16} /></span>
            {expanded && (
              <>
                <span style={{ fontSize: 13, fontWeight: currentPage === 'apps' ? 500 : 400 }}>Apps</span>
                {apps.length > 0 && (
                  <span style={{
                    marginLeft: 'auto', fontSize: 10, color: '#7C3AED',
                    backgroundColor: '#1E1040', padding: '1px 6px', borderRadius: 10, flexShrink: 0,
                  }}>{apps.length}</span>
                )}
                {apps.length > 0 && (
                  <span onClick={(e) => { e.stopPropagation(); setAppsExpanded((v) => !v); }}
                    style={{ marginLeft: 4, lineHeight: 0, flexShrink: 0, color: '#475569' }}>
                    {appsExpanded ? <ChevronDown size={11} /> : <ChevronUp size={11} />}
                  </span>
                )}
              </>
            )}
          </button>

          {expanded && appsExpanded && apps.map((app) => {
            const appPage = `app-${app.id}`;
            const isAppActive = currentPage === appPage;
            return (
              <button
                key={app.id}
                onClick={() => onNavigate(appPage)}
                style={{
                  display: 'flex', alignItems: 'center', gap: 8,
                  width: '100%', height: 32, padding: '0 14px 0 30px',
                  backgroundColor: isAppActive ? '#161D2B' : 'transparent',
                  color: isAppActive ? '#E2E8F0' : '#475569',
                  cursor: 'pointer', transition: 'background-color 80ms, color 80ms',
                  borderLeft: isAppActive ? '2px solid #7C3AED' : '2px solid transparent',
                  borderTop: 'none', borderRight: 'none', borderBottom: 'none',
                  flexShrink: 0, textAlign: 'left',
                }}
                onMouseEnter={(e) => {
                  if (!isAppActive) {
                    (e.currentTarget as HTMLElement).style.backgroundColor = '#0F1620';
                    (e.currentTarget as HTMLElement).style.color = '#CBD5E1';
                  }
                }}
                onMouseLeave={(e) => {
                  if (!isAppActive) {
                    (e.currentTarget as HTMLElement).style.backgroundColor = 'transparent';
                    (e.currentTarget as HTMLElement).style.color = '#475569';
                  }
                }}
              >
                <div style={{
                  width: 15, height: 15, backgroundColor: '#1E1040',
                  display: 'flex', alignItems: 'center', justifyContent: 'center',
                  fontSize: 8, fontWeight: 700, color: '#7C3AED', flexShrink: 0,
                }}>
                  {app.name.charAt(0).toUpperCase()}
                </div>
                <span style={{
                  fontSize: 12, fontWeight: isAppActive ? 500 : 400,
                  whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis',
                }}>
                  {app.name}
                </span>
              </button>
            );
          })}
        </div>
      </div>

      {/* Bottom: user + collapse */}
      <div style={{ borderTop: '1px solid #131C2E', padding: '8px 0', flexShrink: 0, position: 'relative' }}>

        {/* User dropdown menu */}
        {userMenuOpen && currentUser && (
          <>
            {/* Backdrop */}
            <div
              style={{ position: 'fixed', inset: 0, zIndex: 99 }}
              onClick={() => setUserMenuOpen(false)}
            />
            <div style={{
              position: 'absolute', bottom: '100%', left: 8, right: 8,
              backgroundColor: '#0F1824', border: '1px solid #1E2D42',
              borderRadius: 4, overflow: 'hidden', zIndex: 100,
              boxShadow: '0 -4px 16px rgba(0,0,0,0.4)',
            }}>
              <button
                onClick={() => { logout(); setUserMenuOpen(false); }}
                style={{
                  display: 'flex', alignItems: 'center', gap: 10,
                  width: '100%', height: 36, padding: '0 12px',
                  backgroundColor: 'transparent', color: '#64748B',
                  cursor: 'pointer', border: 'none', textAlign: 'left',
                  fontSize: 12, transition: 'color 80ms, background-color 80ms',
                }}
                onMouseEnter={(e) => {
                  (e.currentTarget as HTMLElement).style.color = '#F87171';
                  (e.currentTarget as HTMLElement).style.backgroundColor = '#1A0A0A';
                }}
                onMouseLeave={(e) => {
                  (e.currentTarget as HTMLElement).style.color = '#64748B';
                  (e.currentTarget as HTMLElement).style.backgroundColor = 'transparent';
                }}
              >
                <LogOut size={13} />
                Sign out
              </button>
            </div>
          </>
        )}

        {/* User row — clickable, opens dropdown */}
        {currentUser && (
          <button
            onClick={() => setUserMenuOpen((v) => !v)}
            title={!expanded ? currentUser.name : undefined}
            style={{
              display: 'flex', alignItems: 'center', gap: 10,
              width: '100%', padding: expanded ? '6px 14px' : '6px',
              justifyContent: expanded ? 'flex-start' : 'center',
              backgroundColor: userMenuOpen ? '#0F1620' : 'transparent',
              border: 'none', cursor: 'pointer',
              transition: 'background-color 80ms',
            }}
            onMouseEnter={(e) => {
              if (!userMenuOpen) (e.currentTarget as HTMLElement).style.backgroundColor = '#0F1620';
            }}
            onMouseLeave={(e) => {
              if (!userMenuOpen) (e.currentTarget as HTMLElement).style.backgroundColor = 'transparent';
            }}
          >
            <div style={{
              width: 26, height: 26, borderRadius: '50%',
              backgroundColor: '#1E1040', border: '1px solid #2D1B69',
              display: 'flex', alignItems: 'center', justifyContent: 'center',
              fontSize: 10, fontWeight: 700, color: '#A78BFA', flexShrink: 0,
            }}>
              {currentUser.name.split(' ').map((w) => w[0]).join('').slice(0, 2).toUpperCase()}
            </div>
            {expanded && (
              <>
                <div style={{ overflow: 'hidden', flex: 1, minWidth: 0, textAlign: 'left' }}>
                  <div style={{ fontSize: 12, fontWeight: 500, color: '#E2E8F0', whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis' }}>
                    {currentUser.name}
                  </div>
                  <div style={{ fontSize: 10, color: '#334155', letterSpacing: '0.04em' }}>
                    {currentUser.role}
                  </div>
                </div>
                <ChevronDown size={11} style={{ color: '#334155', flexShrink: 0, transform: userMenuOpen ? 'rotate(180deg)' : 'none', transition: 'transform 120ms' }} />
              </>
            )}
          </button>
        )}

        {/* Collapse toggle */}
        <button
          onClick={() => setExpanded(!expanded)}
          style={{
            display: 'flex', alignItems: 'center',
            justifyContent: expanded ? 'flex-end' : 'center',
            width: '100%', height: 28,
            padding: expanded ? '0 10px' : '0',
            color: '#1E293B', border: 'none', backgroundColor: 'transparent',
            cursor: 'pointer', transition: 'color 80ms',
          }}
          onMouseEnter={(e) => { (e.currentTarget as HTMLElement).style.color = '#334155'; }}
          onMouseLeave={(e) => { (e.currentTarget as HTMLElement).style.color = '#1E293B'; }}
          title={expanded ? 'Collapse' : 'Expand'}
        >
          {expanded ? <ChevronLeft size={14} /> : <ChevronRight size={14} />}
        </button>
      </div>
    </nav>
  );
};

export default NavRail;
