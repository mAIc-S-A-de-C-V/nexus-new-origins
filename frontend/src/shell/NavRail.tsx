import React, { useState, useEffect } from 'react';
import {
  Plug, Network, Activity, Workflow, Settings,
  ChevronLeft, ChevronRight, LayoutDashboard, ChevronDown, ChevronUp,
  FolderKanban, Users, LogOut, DollarSign, Briefcase,
  BrainCircuit, Bot, MessageSquare, ShieldCheck, Wrench, Globe, FlaskConical,
  Database, Shield, TrendingUp, BookOpen, Clock, Radio,
} from 'lucide-react';
import { useTranslation } from 'react-i18next';
import { useTimezone, COMMON_TIMEZONES } from '../lib/timezone';
import { useAuth } from './TenantContext';
import { usePermission } from '../hooks/usePermission';
import { useAppStore } from '../store/appStore';
import { useAssistantStore, useTenantConversations } from '../store/assistantStore';
import { useAuthStore } from '../store/authStore';
import { useHumanActionsStore } from '../store/humanActionsStore';

const LANGUAGES = [
  { code: 'en', label: 'English', flag: '🇺🇸' },
  { code: 'es', label: 'Español', flag: '🇸🇻' },
];

// ── maic icon SVG ──────────────────────────────────────────────────────────

const MaicIcon: React.FC<{ size?: number }> = ({ size = 22 }) => (
  <svg width={size} height={size} viewBox="0 0 44 44" fill="none" xmlns="http://www.w3.org/2000/svg">
    <line x1="18" y1="18" x2="9"  y2="9"  stroke="var(--color-brand)" strokeWidth="2.8" strokeLinecap="round" />
    <line x1="26" y1="18" x2="35" y2="9"  stroke="var(--color-brand)" strokeWidth="2.8" strokeLinecap="round" />
    <line x1="18" y1="26" x2="9"  y2="35" stroke="var(--color-brand)" strokeWidth="2.8" strokeLinecap="round" />
    <line x1="26" y1="26" x2="35" y2="35" stroke="var(--color-brand)" strokeWidth="2.8" strokeLinecap="round" />
    <line x1="26" y1="22" x2="31" y2="22" stroke="var(--color-brand)" strokeWidth="2.8" strokeLinecap="round" />
    <circle cx="8"  cy="8"  r="5.5" fill="var(--color-brand)" />
    <circle cx="36" cy="8"  r="5.5" fill="var(--color-brand)" />
    <circle cx="8"  cy="36" r="5.5" fill="var(--color-brand)" />
    <circle cx="36" cy="36" r="5.5" fill="var(--color-brand)" />
    <circle cx="33" cy="22" r="3.5" fill="var(--color-brand)" />
    <rect x="17" y="17" width="10" height="10" rx="2.5" fill="var(--color-brand)" />
  </svg>
);

// ── Nav items ──────────────────────────────────────────────────────────────

interface NavItem {
  id: string;
  label: string;
  i18nKey: string;
  icon: React.ReactNode;
  active: boolean;
  comingSoon?: boolean;
  path: string;
  adminOnly?: boolean;
  superadminOnly?: boolean;
  alwaysVisible?: boolean;
}

const NAV_ITEMS: NavItem[] = [
  { id: 'apps',          label: 'Dashboards',   i18nKey: 'nav.dashboards',  icon: <LayoutDashboard size={16} />, active: true, path: 'apps' },
  { id: 'apps-app',      label: 'Apps',         i18nKey: 'nav.apps',        icon: <LayoutDashboard size={16} />, active: true, path: 'apps-app' },
  { id: 'workbench',     label: 'Workbench',    i18nKey: 'nav.workbench',   icon: <BookOpen size={16} />,        active: true, path: 'workbench', alwaysVisible: true },
  { id: 'connectors',    label: 'Connectors',   i18nKey: 'nav.connectors',  icon: <Plug size={16} />,            active: true, path: 'connectors' },
  { id: 'ontology',      label: 'Ontology',     i18nKey: 'nav.ontology',    icon: <Network size={16} />,         active: true, path: 'ontology' },
  { id: 'data',          label: 'Data',         i18nKey: 'nav.data',        icon: <Database size={16} />,        active: true, path: 'data' },
  { id: 'pipelines',     label: 'Pipelines',    i18nKey: 'nav.pipelines',   icon: <Workflow size={16} />,        active: true, path: 'pipelines' },
  { id: 'logic',         label: 'Logic Studio', i18nKey: 'nav.logicStudio', icon: <BrainCircuit size={16} />,    active: true, path: 'logic' },
  { id: 'agents',        label: 'Agent Studio', i18nKey: 'nav.agentStudio', icon: <Bot size={16} />,             active: true, path: 'agents' },
  { id: 'evals',         label: 'Evals',        i18nKey: 'nav.evals',       icon: <FlaskConical size={16} />,    active: true, path: 'evals' },
  { id: 'value',         label: 'Value Monitor',i18nKey: 'nav.value',       icon: <TrendingUp size={16} />,      active: true, path: 'value' },
  { id: 'activity',      label: 'Activity',     i18nKey: 'nav.activity',    icon: <Activity size={16} />,        active: true, path: 'activity' },
  { id: 'operations',    label: 'Operations',   i18nKey: 'nav.operations',  icon: <Radio size={16} />,           active: true, path: 'operations', alwaysVisible: true },
  { id: 'utilities',     label: 'Utilities',    i18nKey: 'nav.utilities',   icon: <Wrench size={16} />,          active: true, path: 'utilities' },
  { id: 'human-actions', label: 'Actions',      i18nKey: 'nav.actions',     icon: <ShieldCheck size={16} />,     active: true, path: 'human-actions', alwaysVisible: true },
  { id: 'admin',         label: 'Admin',        i18nKey: 'nav.admin',       icon: <Shield size={16} />,          active: true, path: 'admin', adminOnly: true },
  { id: 'platform',      label: 'Platform',     i18nKey: 'nav.platform',    icon: <Globe size={16} />,           active: true, path: 'platform', superadminOnly: true },
  { id: 'settings',      label: 'Settings',     i18nKey: 'nav.settings',    icon: <Settings size={16} />,        active: true, path: 'settings', alwaysVisible: true },
];

const MAIC_SUBITEMS: NavItem[] = [
  { id: 'projects', label: 'Projects', i18nKey: 'nav.projects', icon: <Briefcase size={14} />, active: true, path: 'projects' },
  { id: 'finance',  label: 'Finance',  i18nKey: 'nav.finance',  icon: <DollarSign size={14} />, active: true, path: 'finance' },
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
  const [tz, setTz] = useTimezone();
  const { isAdmin: isAdminNew, isSuperAdmin, canAccess, modules } = usePermission();
  const { t, i18n } = useTranslation();
  const { apps } = useAppStore();
  const { toggle: toggleAssistant, open: assistantOpen } = useAssistantStore();
  const conversations = useTenantConversations();
  const isImpersonating = !!useAuthStore(s => s.user?.impersonated_by);
  const { pendingCount, fetchPending } = useHumanActionsStore();

  // Poll for pending actions every 30s
  useEffect(() => {
    fetchPending();
    const interval = setInterval(fetchPending, 30_000);
    return () => clearInterval(interval);
  }, []);

  // isAdmin: prefer JWT role from authStore, fall back to TenantContext for legacy compat
  const isAdmin = isAdminNew || currentUser?.role === 'ADMIN';
  const width = expanded ? 220 : 56;

  const canSee = (moduleId: string): boolean => {
    if (isAdmin) return true;
    // Use JWT modules if available, otherwise fall back to TenantContext allowed_modules
    if (modules.length > 0) return modules.includes(moduleId);
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
        borderLeft: isActive ? '2px solid var(--color-brand)' : '2px solid transparent',
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
            {t(item.i18nKey, item.label)}
          </span>
          {item.comingSoon && (
            <span style={{
              marginLeft: 'auto', fontSize: 9, color: '#334155',
              border: '1px solid #1E293B', padding: '1px 4px',
              flexShrink: 0, letterSpacing: '0.04em',
            }}>
              {t('nav.soon')}
            </span>
          )}
        </>
      )}
    </button>
  );

  return (
    <nav style={{
      width, minWidth: width, height: '100vh',
      backgroundColor: isImpersonating ? '#0E0708' : '#080E18',
      display: 'flex', flexDirection: 'column',
      transition: 'width 120ms ease-out, min-width 120ms ease-out',
      overflow: 'hidden',
      borderRight: isImpersonating ? '2px solid #DC2626' : '1px solid #131C2E',
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
          .filter((item) => {
            if (item.alwaysVisible) return item.active;
            if (item.superadminOnly) return isSuperAdmin;
            if (item.adminOnly && !isAdmin) return false;
            // 'apps-app' is a second view of the 'apps' module; gate it by the same module id.
            const moduleForPath = item.path === 'apps-app' ? 'apps' : item.path;
            if (modules.length > 0 && !canAccess(moduleForPath)) return false;
            // Legacy TenantContext module check when no JWT modules present
            if (modules.length === 0 && !canSee(moduleForPath)) return false;
            return item.active;
          })
          .map((item) => {
            const btn = navBtn(item, currentPage === item.path, () => item.active && onNavigate(item.path));
            // Overlay badge for human-actions pending count
            if (item.id === 'human-actions' && pendingCount > 0 && expanded) {
              return (
                <div key={item.id} style={{ position: 'relative' }}>
                  {btn}
                  <span style={{
                    position: 'absolute', top: 8, right: 10,
                    fontSize: 9, fontWeight: 700, minWidth: 16, height: 16,
                    backgroundColor: '#D97706', color: '#FFF',
                    borderRadius: 8, display: 'flex', alignItems: 'center', justifyContent: 'center',
                    padding: '0 4px', pointerEvents: 'none',
                  }}>{pendingCount}</span>
                </div>
              );
            }
            return btn;
          })}

        {/* ── maic group — only visible to @maic.ai users ────────────── */}
        {currentUser?.email?.endsWith('@maic.ai') && (canSee('projects') || canSee('finance')) && (
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
                borderLeft: (currentPage === 'projects' || currentPage === 'finance') ? '2px solid var(--color-brand)' : '2px solid transparent',
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
              {/* Language selector */}
              <div style={{ padding: '8px 12px 6px', borderBottom: '1px solid #1E2D42' }}>
                <div style={{ fontSize: 10, fontWeight: 600, color: '#334155', textTransform: 'uppercase',
                  letterSpacing: '0.06em', marginBottom: 6, display: 'flex', alignItems: 'center', gap: 5 }}>
                  <Globe size={11} /> {t('user.language')}
                </div>
                <div style={{ display: 'flex', gap: 4 }}>
                  {LANGUAGES.map(lang => (
                    <button
                      key={lang.code}
                      onClick={() => i18n.changeLanguage(lang.code)}
                      style={{
                        flex: 1, height: 28, fontSize: 11, fontWeight: 500,
                        borderRadius: 3, cursor: 'pointer',
                        border: `1px solid ${i18n.language === lang.code ? 'var(--color-brand)' : '#1E2D42'}`,
                        backgroundColor: i18n.language === lang.code ? '#1E1040' : 'transparent',
                        color: i18n.language === lang.code ? 'var(--color-brand-text, #A78BFA)' : '#64748B',
                        display: 'flex', alignItems: 'center', justifyContent: 'center', gap: 4,
                        transition: 'all 80ms',
                      }}
                    >
                      <span>{lang.flag}</span>
                      <span>{lang.label}</span>
                    </button>
                  ))}
                </div>
              </div>

              {/* Timezone selector — drives time-range filters and
                  timestamp display platform-wide. */}
              <div style={{ padding: '8px 12px 6px', borderBottom: '1px solid #1E2D42' }}>
                <div style={{ fontSize: 10, fontWeight: 600, color: '#334155', textTransform: 'uppercase',
                  letterSpacing: '0.06em', marginBottom: 6, display: 'flex', alignItems: 'center', gap: 5 }}>
                  <Clock size={11} /> Timezone
                </div>
                <select
                  value={tz}
                  onChange={(e) => setTz(e.target.value)}
                  style={{
                    width: '100%', height: 28, fontSize: 11,
                    backgroundColor: '#0F1824', color: '#CBD5E1',
                    border: '1px solid #1E2D42', borderRadius: 3, padding: '0 6px',
                    outline: 'none', cursor: 'pointer',
                  }}
                >
                  {COMMON_TIMEZONES.map((t) => (
                    <option key={t.tz} value={t.tz} style={{ backgroundColor: '#0F1824' }}>
                      {t.label}
                    </option>
                  ))}
                </select>
              </div>

              {/* Sign out */}
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
                {t('user.signOut')}
              </button>
            </div>
          </>
        )}

        {/* Nexus Assistant button */}
        <button
          onClick={toggleAssistant}
          title={!expanded ? 'Nexus Assistant' : undefined}
          style={{
            display: 'flex', alignItems: 'center', gap: 10,
            width: '100%', padding: expanded ? '6px 14px' : '6px',
            justifyContent: expanded ? 'flex-start' : 'center',
            backgroundColor: assistantOpen ? '#1E1040' : 'transparent',
            border: 'none', cursor: 'pointer',
            borderLeft: assistantOpen ? '2px solid var(--color-brand)' : '2px solid transparent',
            transition: 'background-color 80ms',
            marginBottom: 2,
          }}
          onMouseEnter={(e) => { if (!assistantOpen) (e.currentTarget as HTMLElement).style.backgroundColor = '#0F1620'; }}
          onMouseLeave={(e) => { if (!assistantOpen) (e.currentTarget as HTMLElement).style.backgroundColor = 'transparent'; }}
        >
          <MessageSquare size={16} color={assistantOpen ? 'var(--color-brand)' : '#475569'} style={{ flexShrink: 0 }} />
          {expanded && (
            <>
              <span style={{ fontSize: 13, color: assistantOpen ? 'var(--color-brand)' : '#64748B', fontWeight: assistantOpen ? 500 : 400 }}>
                Assistant
              </span>
              {conversations.length > 0 && (
                <span style={{
                  marginLeft: 'auto', fontSize: 9, color: 'var(--color-brand)',
                  backgroundColor: 'var(--color-brand-dim)', padding: '1px 6px', borderRadius: 10, flexShrink: 0,
                  border: '1px solid var(--color-brand-border)',
                }}>
                  {conversations.length}
                </span>
              )}
            </>
          )}
        </button>

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
              backgroundColor: 'var(--color-brand-dim)', border: '1px solid var(--color-brand-border)',
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
                  {isImpersonating ? (
                    <div style={{
                      fontSize: 9, color: '#fff', backgroundColor: '#DC2626',
                      padding: '1px 6px', borderRadius: 3, fontWeight: 700,
                      letterSpacing: '0.05em', display: 'inline-block', marginTop: 1,
                    }}>
                      IMPERSONATING
                    </div>
                  ) : (
                    <div style={{ fontSize: 10, color: '#334155', letterSpacing: '0.04em' }}>
                      {currentUser.role}
                    </div>
                  )}
                </div>
                <ChevronDown size={11} style={{ color: '#334155', flexShrink: 0, transform: userMenuOpen ? 'rotate(180deg)' : 'none', transition: 'transform 120ms' }} />
              </>
            )}
          </button>
        )}

      </div>

      {/* Edge collapse tab — sits flush on the right border */}
      <button
        onClick={() => setExpanded(!expanded)}
        title={expanded ? 'Collapse sidebar' : 'Expand sidebar'}
        style={{
          position: 'absolute',
          top: '50%',
          right: -12,
          transform: 'translateY(-50%)',
          width: 12,
          height: 40,
          backgroundColor: '#131C2E',
          border: '1px solid #1E2D42',
          borderLeft: 'none',
          borderRadius: '0 4px 4px 0',
          cursor: 'pointer',
          display: 'flex',
          alignItems: 'center',
          justifyContent: 'center',
          color: '#334155',
          padding: 0,
          zIndex: 20,
          transition: 'background-color 80ms, color 80ms',
        }}
        onMouseEnter={(e) => {
          (e.currentTarget as HTMLElement).style.backgroundColor = '#1E2D42';
          (e.currentTarget as HTMLElement).style.color = '#64748B';
        }}
        onMouseLeave={(e) => {
          (e.currentTarget as HTMLElement).style.backgroundColor = '#131C2E';
          (e.currentTarget as HTMLElement).style.color = '#334155';
        }}
      >
        {expanded ? <ChevronLeft size={10} /> : <ChevronRight size={10} />}
      </button>
    </nav>
  );
};

export default NavRail;
