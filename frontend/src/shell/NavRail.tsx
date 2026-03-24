import React, { useState } from 'react';
import {
  Plug, Network, GitBranch, Activity, Workflow, Settings,
  ChevronLeft, ChevronRight, LayoutDashboard, ChevronDown, ChevronUp,
} from 'lucide-react';
import { useUser } from './TenantContext';
import { useAppStore } from '../store/appStore';

interface NavItem {
  id: string;
  label: string;
  icon: React.ReactNode;
  active: boolean;
  comingSoon?: boolean;
  path: string;
}

interface NavRailProps {
  currentPage: string;
  onNavigate: (page: string) => void;
}

const NAV_ITEMS: NavItem[] = [
  { id: 'connectors', label: 'Connectors', icon: <Plug size={18} />, active: true, path: 'connectors' },
  { id: 'ontology', label: 'Ontology', icon: <Network size={18} />, active: true, path: 'ontology' },
  { id: 'lineage', label: 'Lineage', icon: <GitBranch size={18} />, active: false, comingSoon: true, path: 'lineage' },
  { id: 'events', label: 'Event Log', icon: <Activity size={18} />, active: true, path: 'events' },
  { id: 'pipelines', label: 'Pipelines', icon: <Workflow size={18} />, active: true, path: 'pipelines' },
  { id: 'settings', label: 'Settings', icon: <Settings size={18} />, active: false, comingSoon: true, path: 'settings' },
];

export const NavRail: React.FC<NavRailProps> = ({ currentPage, onNavigate }) => {
  const [expanded, setExpanded] = useState(true);
  const [appsExpanded, setAppsExpanded] = useState(true);
  const user = useUser();
  const { apps } = useAppStore();

  const width = expanded ? 220 : 56;

  return (
    <nav
      style={{
        width,
        minWidth: width,
        height: '100vh',
        backgroundColor: '#0D1117',
        display: 'flex',
        flexDirection: 'column',
        transition: 'width 120ms ease-out, min-width 120ms ease-out',
        overflow: 'hidden',
        borderRight: '1px solid #1E293B',
        flexShrink: 0,
        position: 'relative',
        zIndex: 10,
      }}
    >
      {/* Logo / Brand */}
      <div style={{
        height: 56,
        display: 'flex',
        alignItems: 'center',
        padding: '0 16px',
        borderBottom: '1px solid #1E293B',
        gap: '10px',
        flexShrink: 0,
      }}>
        <div style={{
          width: 24,
          height: 24,
          borderRadius: '4px',
          backgroundColor: '#2563EB',
          display: 'flex',
          alignItems: 'center',
          justifyContent: 'center',
          flexShrink: 0,
        }}>
          <span style={{ color: '#fff', fontSize: '12px', fontWeight: 700 }}>N</span>
        </div>
        {expanded && (
          <span style={{
            color: '#F8F9FA',
            fontSize: '14px',
            fontWeight: 600,
            whiteSpace: 'nowrap',
            overflow: 'hidden',
          }}>
            Nexus Origins
          </span>
        )}
      </div>

      {/* Nav Items */}
      <div style={{ flex: 1, padding: '8px 0', overflowY: 'auto', overflowX: 'hidden' }}>
        {NAV_ITEMS.map((item) => {
          const isActive = currentPage === item.path;
          const isClickable = item.active;

          return (
            <button
              key={item.id}
              onClick={() => isClickable && onNavigate(item.path)}
              title={!expanded ? item.label : undefined}
              style={{
                display: 'flex',
                alignItems: 'center',
                gap: '10px',
                width: '100%',
                height: '40px',
                padding: expanded ? '0 16px' : '0',
                justifyContent: expanded ? 'flex-start' : 'center',
                backgroundColor: isActive ? '#1E293B' : 'transparent',
                color: isActive ? '#F8F9FA' : item.comingSoon ? '#475569' : '#94A3B8',
                cursor: isClickable ? 'pointer' : 'default',
                transition: 'background-color 80ms ease-out, color 80ms ease-out',
                borderLeft: isActive ? '3px solid #2563EB' : '3px solid transparent',
                position: 'relative',
                flexShrink: 0,
              }}
              onMouseEnter={(e) => {
                if (!isActive && isClickable) {
                  (e.currentTarget as HTMLElement).style.backgroundColor = '#1E293B';
                  (e.currentTarget as HTMLElement).style.color = '#CBD5E1';
                }
              }}
              onMouseLeave={(e) => {
                if (!isActive) {
                  (e.currentTarget as HTMLElement).style.backgroundColor = 'transparent';
                  (e.currentTarget as HTMLElement).style.color = item.comingSoon ? '#475569' : '#94A3B8';
                }
              }}
            >
              <span style={{ flexShrink: 0, lineHeight: 0 }}>{item.icon}</span>
              {expanded && (
                <span style={{
                  fontSize: '13px',
                  fontWeight: isActive ? 500 : 400,
                  whiteSpace: 'nowrap',
                  overflow: 'hidden',
                  textOverflow: 'ellipsis',
                }}>
                  {item.label}
                </span>
              )}
              {expanded && item.comingSoon && (
                <span style={{
                  marginLeft: 'auto',
                  fontSize: '10px',
                  color: '#475569',
                  backgroundColor: '#1E293B',
                  padding: '1px 4px',
                  borderRadius: '2px',
                  flexShrink: 0,
                }}>
                  Soon
                </span>
              )}
            </button>
          );
        })}

        {/* ── Apps section ── */}
        <div style={{ borderTop: '1px solid #1E293B', marginTop: 8, paddingTop: 4 }}>
          {/* Apps header row */}
          <button
            onClick={() => {
              if (expanded) setAppsExpanded((v) => !v);
              onNavigate('apps');
            }}
            title={!expanded ? 'Apps' : undefined}
            style={{
              display: 'flex',
              alignItems: 'center',
              gap: '10px',
              width: '100%',
              height: '40px',
              padding: expanded ? '0 16px' : '0',
              justifyContent: expanded ? 'flex-start' : 'center',
              backgroundColor: currentPage === 'apps' ? '#1E293B' : 'transparent',
              color: currentPage === 'apps' ? '#F8F9FA' : '#94A3B8',
              cursor: 'pointer',
              transition: 'background-color 80ms ease-out, color 80ms ease-out',
              borderLeft: currentPage === 'apps' ? '3px solid #2563EB' : '3px solid transparent',
              flexShrink: 0,
            }}
            onMouseEnter={(e) => {
              if (currentPage !== 'apps') {
                (e.currentTarget as HTMLElement).style.backgroundColor = '#1E293B';
                (e.currentTarget as HTMLElement).style.color = '#CBD5E1';
              }
            }}
            onMouseLeave={(e) => {
              if (currentPage !== 'apps') {
                (e.currentTarget as HTMLElement).style.backgroundColor = 'transparent';
                (e.currentTarget as HTMLElement).style.color = '#94A3B8';
              }
            }}
          >
            <span style={{ flexShrink: 0, lineHeight: 0 }}><LayoutDashboard size={18} /></span>
            {expanded && (
              <>
                <span style={{ fontSize: '13px', fontWeight: currentPage === 'apps' ? 500 : 400 }}>
                  Apps
                </span>
                {apps.length > 0 && (
                  <span style={{
                    marginLeft: 'auto',
                    fontSize: '10px',
                    color: '#2563EB',
                    backgroundColor: '#1A3C6E',
                    padding: '1px 5px',
                    borderRadius: '10px',
                    flexShrink: 0,
                  }}>
                    {apps.length}
                  </span>
                )}
                {apps.length > 0 && (
                  <span
                    onClick={(e) => { e.stopPropagation(); setAppsExpanded((v) => !v); }}
                    style={{ marginLeft: apps.length > 0 ? 4 : 'auto', lineHeight: 0, flexShrink: 0 }}
                  >
                    {appsExpanded ? <ChevronDown size={12} /> : <ChevronUp size={12} />}
                  </span>
                )}
              </>
            )}
          </button>

          {/* Individual app nav items */}
          {expanded && appsExpanded && apps.map((app) => {
            const appPage = `app-${app.id}`;
            const isAppActive = currentPage === appPage;
            return (
              <button
                key={app.id}
                onClick={() => onNavigate(appPage)}
                style={{
                  display: 'flex',
                  alignItems: 'center',
                  gap: '8px',
                  width: '100%',
                  height: '34px',
                  padding: '0 16px 0 32px',
                  backgroundColor: isAppActive ? '#1E293B' : 'transparent',
                  color: isAppActive ? '#F8F9FA' : '#64748B',
                  cursor: 'pointer',
                  transition: 'background-color 80ms, color 80ms',
                  borderLeft: isAppActive ? '3px solid #2563EB' : '3px solid transparent',
                  flexShrink: 0,
                  textAlign: 'left',
                }}
                onMouseEnter={(e) => {
                  if (!isAppActive) {
                    (e.currentTarget as HTMLElement).style.backgroundColor = '#1E293B';
                    (e.currentTarget as HTMLElement).style.color = '#CBD5E1';
                  }
                }}
                onMouseLeave={(e) => {
                  if (!isAppActive) {
                    (e.currentTarget as HTMLElement).style.backgroundColor = 'transparent';
                    (e.currentTarget as HTMLElement).style.color = '#64748B';
                  }
                }}
              >
                <div style={{
                  width: 16, height: 16, borderRadius: 3,
                  backgroundColor: '#1A3C6E',
                  display: 'flex', alignItems: 'center', justifyContent: 'center',
                  fontSize: 9, fontWeight: 700, color: '#60A5FA', flexShrink: 0,
                }}>
                  {app.name.charAt(0).toUpperCase()}
                </div>
                <span style={{
                  fontSize: '12px',
                  fontWeight: isAppActive ? 500 : 400,
                  whiteSpace: 'nowrap',
                  overflow: 'hidden',
                  textOverflow: 'ellipsis',
                }}>
                  {app.name}
                </span>
              </button>
            );
          })}
        </div>
      </div>

      {/* Bottom section: user + toggle */}
      <div style={{
        borderTop: '1px solid #1E293B',
        padding: '8px 0',
        flexShrink: 0,
      }}>
        {/* User avatar */}
        <div style={{
          display: 'flex',
          alignItems: 'center',
          gap: '10px',
          padding: expanded ? '8px 16px' : '8px',
          justifyContent: expanded ? 'flex-start' : 'center',
        }}>
          <div style={{
            width: 28,
            height: 28,
            borderRadius: '50%',
            backgroundColor: '#1A3C6E',
            display: 'flex',
            alignItems: 'center',
            justifyContent: 'center',
            flexShrink: 0,
          }}>
            <span style={{ color: '#fff', fontSize: '11px', fontWeight: 600 }}>
              {user.avatarInitials}
            </span>
          </div>
          {expanded && (
            <div style={{ overflow: 'hidden' }}>
              <div style={{
                fontSize: '12px',
                fontWeight: 500,
                color: '#F8F9FA',
                whiteSpace: 'nowrap',
                overflow: 'hidden',
                textOverflow: 'ellipsis',
              }}>
                {user.name}
              </div>
              <div style={{
                fontSize: '11px',
                color: '#475569',
                whiteSpace: 'nowrap',
              }}>
                {user.role}
              </div>
            </div>
          )}
        </div>

        {/* Collapse toggle */}
        <button
          onClick={() => setExpanded(!expanded)}
          style={{
            display: 'flex',
            alignItems: 'center',
            justifyContent: expanded ? 'flex-end' : 'center',
            width: '100%',
            height: '32px',
            padding: expanded ? '0 12px' : '0',
            color: '#475569',
            transition: 'color 80ms ease-out',
          }}
          onMouseEnter={(e) => { (e.currentTarget as HTMLElement).style.color = '#94A3B8'; }}
          onMouseLeave={(e) => { (e.currentTarget as HTMLElement).style.color = '#475569'; }}
          title={expanded ? 'Collapse sidebar' : 'Expand sidebar'}
        >
          {expanded ? <ChevronLeft size={16} /> : <ChevronRight size={16} />}
        </button>
      </div>
    </nav>
  );
};

export default NavRail;
