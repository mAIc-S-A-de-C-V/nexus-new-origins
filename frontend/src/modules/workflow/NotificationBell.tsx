// Top-bar notification bell — drop into the app shell next to the user menu.
// Polls every 30s; click reveals dropdown of recent notifications. Clicking
// a notification marks it read and deep-links to the action.

import React, { useEffect, useRef, useState } from 'react';
import { Bell } from 'lucide-react';
import { useNavigationStore } from '../../store/navigationStore';
import { listNotifications, markNotificationRead, markAllNotificationsRead } from './api';
import type { NotificationItem } from './types';

const POLL_MS = 30_000;

const c = {
  border:'#E2E8F0', borderLight:'#EEF1F5', muted:'#64748B', dim:'#94A3B8',
  panel:'#FFFFFF', accent:'#2563EB', accentDim:'#EFF6FF', error:'#DC2626',
  text:'#0D1117',
};

const NotificationBell: React.FC = () => {
  const [open, setOpen] = useState(false);
  const [items, setItems] = useState<NotificationItem[]>([]);
  const [unread, setUnread] = useState(0);
  const dropdownRef = useRef<HTMLDivElement | null>(null);
  const navigateTo = useNavigationStore.getState().navigateTo;

  const refresh = async () => {
    try {
      const r = await listNotifications();
      setItems(r.notifications);
      setUnread(r.unread_count);
    } catch { /* ignore */ }
  };

  useEffect(() => {
    refresh();
    const t = setInterval(refresh, POLL_MS);
    return () => clearInterval(t);
  }, []);

  // Close on click outside
  useEffect(() => {
    if (!open) return;
    const onClick = (e: MouseEvent) => {
      if (!dropdownRef.current?.contains(e.target as Node)) setOpen(false);
    };
    setTimeout(() => document.addEventListener('mousedown', onClick), 0);
    return () => document.removeEventListener('mousedown', onClick);
  }, [open]);

  const handleClick = async (n: NotificationItem) => {
    if (!n.read_at) {
      try { await markNotificationRead(n.id); } catch { /* */ }
      setUnread((u) => Math.max(0, u - 1));
      setItems((cur) => cur.map((x) => x.id === n.id ? { ...x, read_at: new Date().toISOString() } : x));
    }
    if (n.action_execution_id) {
      // Deep-link: jump to Human Actions page (queue) — the panel will pick up
      // the execution if visible. Future: pre-select it via a route param.
      navigateTo('human-actions');
    }
    setOpen(false);
  };

  const handleReadAll = async () => {
    try {
      await markAllNotificationsRead();
      setUnread(0);
      setItems((cur) => cur.map((x) => ({ ...x, read_at: x.read_at || new Date().toISOString() })));
    } catch { /* */ }
  };

  return (
    <div ref={dropdownRef} style={{ position: 'relative' }}>
      <button
        onClick={() => { setOpen((v) => !v); refresh(); }}
        title={`${unread} unread`}
        style={{
          position: 'relative', width: 32, height: 32, borderRadius: 16,
          border: 'none', backgroundColor: 'transparent', cursor: 'pointer',
          display: 'flex', alignItems: 'center', justifyContent: 'center',
        }}>
        <Bell size={16} color={c.text} />
        {unread > 0 && (
          <span style={{
            position: 'absolute', top: 2, right: 2, minWidth: 16, height: 16,
            padding: '0 4px', borderRadius: 8, backgroundColor: c.error, color: '#FFF',
            fontSize: 9, fontWeight: 700, display: 'flex', alignItems: 'center', justifyContent: 'center',
          }}>
            {unread > 99 ? '99+' : unread}
          </span>
        )}
      </button>

      {open && (
        <div style={{
          position: 'absolute', top: 38, right: 0, width: 360, maxHeight: 480,
          backgroundColor: c.panel, border: `1px solid ${c.border}`, borderRadius: 6,
          boxShadow: '0 8px 24px rgba(15,23,42,0.10)', overflow: 'hidden', zIndex: 1000,
        }}>
          <div style={{
            display: 'flex', alignItems: 'center', justifyContent: 'space-between',
            padding: '10px 14px', borderBottom: `1px solid ${c.border}`,
          }}>
            <div style={{ fontSize: 13, fontWeight: 600 }}>Notifications</div>
            {unread > 0 && (
              <button onClick={handleReadAll}
                style={{ fontSize: 11, color: c.accent, background: 'transparent', border: 'none', cursor: 'pointer' }}>
                Mark all read
              </button>
            )}
          </div>
          <div style={{ overflowY: 'auto', maxHeight: 420 }}>
            {items.length === 0 && (
              <div style={{ padding: 24, fontSize: 12, color: c.dim, textAlign: 'center' }}>
                No notifications.
              </div>
            )}
            {items.map((n) => (
              <button key={n.id} onClick={() => handleClick(n)}
                style={{
                  display: 'block', width: '100%', textAlign: 'left',
                  padding: '10px 14px', border: 'none', cursor: 'pointer',
                  backgroundColor: n.read_at ? c.panel : c.accentDim,
                  borderBottom: `1px solid ${c.borderLight}`,
                }}>
                <div style={{ fontSize: 12, fontWeight: n.read_at ? 400 : 600, color: c.text }}>
                  {n.title}
                </div>
                {n.body && (
                  <div style={{ fontSize: 11, color: c.muted, marginTop: 2 }}>
                    {n.body.length > 120 ? n.body.slice(0, 120) + '…' : n.body}
                  </div>
                )}
                <div style={{ fontSize: 10, color: c.dim, marginTop: 4 }}>
                  {n.created_at ? new Date(n.created_at).toLocaleString() : ''}
                </div>
              </button>
            ))}
          </div>
        </div>
      )}
    </div>
  );
};

export default NotificationBell;
