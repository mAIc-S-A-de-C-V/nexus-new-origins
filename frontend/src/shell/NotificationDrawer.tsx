import React, { useEffect } from 'react';
import { X, CheckCheck, AlertTriangle, AlertCircle, Trash2 } from 'lucide-react';
import { useAlertStore, AlertNotification } from '../store/alertStore';

interface Props {
  onClose: () => void;
}

const SeverityIcon: React.FC<{ severity: AlertNotification['severity'] }> = ({ severity }) =>
  severity === 'critical'
    ? <AlertCircle size={13} style={{ color: '#EF4444', flexShrink: 0 }} />
    : <AlertTriangle size={13} style={{ color: '#F59E0B', flexShrink: 0 }} />;

const timeAgo = (iso: string) => {
  const diff = Date.now() - new Date(iso).getTime();
  const m = Math.floor(diff / 60000);
  if (m < 1) return 'just now';
  if (m < 60) return `${m}m ago`;
  const h = Math.floor(m / 60);
  if (h < 24) return `${h}h ago`;
  return `${Math.floor(h / 24)}d ago`;
};

export const NotificationDrawer: React.FC<Props> = ({ onClose }) => {
  const {
    notifications, unreadCount,
    fetchNotifications, markRead, markAllRead, deleteNotification,
  } = useAlertStore();

  useEffect(() => {
    fetchNotifications();
  }, []);

  return (
    <>
      {/* Backdrop */}
      <div
        style={{ position: 'fixed', inset: 0, zIndex: 200 }}
        onClick={onClose}
      />

      {/* Drawer panel */}
      <div style={{
        position: 'fixed',
        top: 0, right: 0,
        width: 360, height: '100vh',
        backgroundColor: '#0F1824',
        borderLeft: '1px solid #1E2D42',
        display: 'flex', flexDirection: 'column',
        zIndex: 201,
        boxShadow: '-8px 0 32px rgba(0,0,0,0.4)',
      }}>
        {/* Header */}
        <div style={{
          height: 52, display: 'flex', alignItems: 'center', padding: '0 16px',
          borderBottom: '1px solid #1E2D42', gap: 10, flexShrink: 0,
        }}>
          <span style={{ fontSize: 14, fontWeight: 600, color: '#E2E8F0', flex: 1 }}>
            Alerts
            {unreadCount > 0 && (
              <span style={{
                marginLeft: 8, fontSize: 10, backgroundColor: '#EF4444',
                color: '#FFFFFF', borderRadius: 10, padding: '1px 6px',
              }}>
                {unreadCount}
              </span>
            )}
          </span>
          {unreadCount > 0 && (
            <button
              onClick={() => markAllRead()}
              title="Mark all read"
              style={{
                display: 'flex', alignItems: 'center', gap: 4,
                fontSize: 11, color: '#64748B', backgroundColor: 'transparent',
                border: 'none', cursor: 'pointer', padding: '4px 6px',
              }}
            >
              <CheckCheck size={13} />
              All read
            </button>
          )}
          <button
            onClick={onClose}
            style={{
              backgroundColor: 'transparent', border: 'none', cursor: 'pointer',
              color: '#475569', padding: 4, display: 'flex', alignItems: 'center',
            }}
          >
            <X size={16} />
          </button>
        </div>

        {/* Notification list */}
        <div style={{ flex: 1, overflowY: 'auto' }}>
          {notifications.length === 0 ? (
            <div style={{
              display: 'flex', flexDirection: 'column', alignItems: 'center',
              justifyContent: 'center', height: 200, gap: 8,
            }}>
              <span style={{ fontSize: 13, color: '#475569' }}>No alerts yet</span>
              <span style={{ fontSize: 11, color: '#334155' }}>Configure alert rules in Process Mining → Alerts</span>
            </div>
          ) : (
            notifications.map(n => (
              <NotificationRow
                key={n.id}
                notification={n}
                onRead={() => !n.read && markRead(n.id)}
                onDelete={() => deleteNotification(n.id)}
              />
            ))
          )}
        </div>

        {/* Footer */}
        <div style={{
          height: 40, borderTop: '1px solid #1E2D42', padding: '0 16px',
          display: 'flex', alignItems: 'center',
          fontSize: 11, color: '#334155',
        }}>
          {notifications.length} total · {unreadCount} unread
        </div>
      </div>
    </>
  );
};

const NotificationRow: React.FC<{
  notification: AlertNotification;
  onRead: () => void;
  onDelete: () => void;
}> = ({ notification: n, onRead, onDelete }) => {
  const [hovered, setHovered] = React.useState(false);

  return (
    <div
      onClick={onRead}
      onMouseEnter={() => setHovered(true)}
      onMouseLeave={() => setHovered(false)}
      style={{
        padding: '10px 16px',
        borderBottom: '1px solid #131C2E',
        backgroundColor: n.read ? 'transparent' : '#111926',
        cursor: n.read ? 'default' : 'pointer',
        display: 'flex', gap: 10, alignItems: 'flex-start',
        transition: 'background-color 80ms',
      }}
    >
      <SeverityIcon severity={n.severity} />

      <div style={{ flex: 1, minWidth: 0 }}>
        <div style={{ display: 'flex', alignItems: 'center', gap: 6, marginBottom: 3 }}>
          <span style={{
            fontSize: 11, fontWeight: 600,
            color: n.severity === 'critical' ? '#FCA5A5' : '#FCD34D',
            textTransform: 'uppercase', letterSpacing: '0.05em',
          }}>
            {n.rule_name}
          </span>
          {!n.read && (
            <span style={{
              width: 6, height: 6, borderRadius: '50%',
              backgroundColor: '#EF4444', flexShrink: 0,
            }} />
          )}
        </div>
        <div style={{
          fontSize: 12, color: '#CBD5E1', lineHeight: 1.4,
          whiteSpace: 'pre-wrap', wordBreak: 'break-word',
        }}>
          {n.message}
        </div>
        <div style={{ fontSize: 10, color: '#475569', marginTop: 4, fontFamily: 'var(--font-mono)' }}>
          {timeAgo(n.fired_at)}
        </div>
      </div>

      {hovered && (
        <button
          onClick={(e) => { e.stopPropagation(); onDelete(); }}
          style={{
            backgroundColor: 'transparent', border: 'none', cursor: 'pointer',
            color: '#475569', padding: 2, display: 'flex', alignItems: 'center', flexShrink: 0,
          }}
          title="Dismiss"
        >
          <Trash2 size={12} />
        </button>
      )}
    </div>
  );
};
