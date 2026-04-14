import React, { useEffect, useRef, useState } from 'react';
import { Bell } from 'lucide-react';
import { useAlertStore } from '../store/alertStore';
import { useRunLogStore } from '../store/runLogStore';
import { useApprovalStore } from '../store/approvalStore';
import { NotificationDrawer } from './NotificationDrawer';

const POLL_INTERVAL_MS = 30_000;

export const NotificationBell: React.FC = () => {
  const { unreadCount: alertUnread, pollUnreadCount } = useAlertStore();
  const { unreadCount: logUnread } = useRunLogStore();
  const { pendingCount: approvalCount, fetchPendingForMe } = useApprovalStore();
  const unreadCount = alertUnread + logUnread + approvalCount;
  const [open, setOpen] = useState(false);
  const intervalRef = useRef<ReturnType<typeof setInterval> | null>(null);

  useEffect(() => {
    pollUnreadCount();
    fetchPendingForMe();
    intervalRef.current = setInterval(() => {
      pollUnreadCount();
      fetchPendingForMe();
    }, POLL_INTERVAL_MS);
    return () => {
      if (intervalRef.current) clearInterval(intervalRef.current);
    };
  }, []);

  return (
    <>
      <button
        onClick={() => setOpen(v => !v)}
        title="Alerts"
        style={{
          position: 'relative',
          width: 32, height: 32,
          display: 'flex', alignItems: 'center', justifyContent: 'center',
          backgroundColor: open ? '#161D2B' : 'transparent',
          border: '1px solid transparent',
          borderRadius: 4,
          cursor: 'pointer',
          color: unreadCount > 0 ? '#F59E0B' : '#64748B',
          transition: 'background-color 80ms, color 80ms',
          flexShrink: 0,
        }}
        onMouseEnter={(e) => {
          (e.currentTarget as HTMLElement).style.backgroundColor = '#161D2B';
          (e.currentTarget as HTMLElement).style.color = '#E2E8F0';
        }}
        onMouseLeave={(e) => {
          if (!open) {
            (e.currentTarget as HTMLElement).style.backgroundColor = 'transparent';
            (e.currentTarget as HTMLElement).style.color = unreadCount > 0 ? '#F59E0B' : '#64748B';
          }
        }}
      >
        <Bell size={15} />
        {unreadCount > 0 && (
          <span style={{
            position: 'absolute',
            top: 4, right: 4,
            width: 7, height: 7,
            borderRadius: '50%',
            backgroundColor: '#EF4444',
            border: '1.5px solid #080E18',
          }} />
        )}
      </button>

      {open && <NotificationDrawer onClose={() => setOpen(false)} />}
    </>
  );
};
