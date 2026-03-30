import React, { useEffect, useState } from 'react';
import { X, User } from 'lucide-react';
import { useProcessStore, CaseTimelineEvent } from '../../store/processStore';

interface Props {
  caseId: string;
  objectTypeId: string;
  onClose: () => void;
}

function formatDuration(hours: number | null): { label: string; speed: 'fast' | 'normal' | 'slow' } {
  if (hours === null) return { label: '', speed: 'normal' };
  const label = hours < 1
    ? `${Math.round(hours * 60)}m`
    : hours < 24
    ? `${hours.toFixed(1)}h`
    : `${(hours / 24).toFixed(1)}d`;
  const speed = hours < 1 ? 'fast' : hours > 72 ? 'slow' : 'normal';
  return { label, speed };
}

const speedColor = { fast: '#15803D', normal: '#64748B', slow: '#DC2626' };
const speedBg = { fast: '#F0FDF4', normal: '#F8FAFC', slow: '#FEF2F2' };

export const CaseTimeline: React.FC<Props> = ({ caseId, objectTypeId, onClose }) => {
  const { fetchCaseTimeline } = useProcessStore();
  const [events, setEvents] = useState<CaseTimelineEvent[]>([]);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    setLoading(true);
    fetchCaseTimeline(objectTypeId, caseId)
      .then(setEvents)
      .finally(() => setLoading(false));
  }, [caseId, objectTypeId]);

  const totalDays = events.length >= 2
    ? ((new Date(events[events.length - 1].timestamp).getTime() - new Date(events[0].timestamp).getTime()) / 86400000).toFixed(1)
    : '0';

  return (
    <div style={{
      width: 360,
      backgroundColor: '#FFFFFF',
      borderLeft: '1px solid #E2E8F0',
      display: 'flex',
      flexDirection: 'column',
      flexShrink: 0,
      overflow: 'hidden',
    }}>
      {/* Header */}
      <div style={{ padding: '12px 16px', borderBottom: '1px solid #E2E8F0', backgroundColor: '#F8FAFC' }}>
        <div style={{ display: 'flex', alignItems: 'flex-start', justifyContent: 'space-between' }}>
          <div>
            <div style={{ fontSize: 10, fontWeight: 600, color: '#94A3B8', textTransform: 'uppercase', letterSpacing: '0.06em', marginBottom: 3 }}>
              Case Timeline · {objectTypeId}
            </div>
            <div style={{ fontSize: 13, fontWeight: 600, color: '#0D1117', fontFamily: 'var(--font-mono)' }}>{caseId}</div>
            <div style={{ fontSize: 11, color: '#64748B', marginTop: 3 }}>
              {events.length} events · {totalDays} days total
            </div>
          </div>
          <button onClick={onClose} style={{ background: 'none', border: 'none', cursor: 'pointer', color: '#94A3B8', padding: 2 }}>
            <X size={15} />
          </button>
        </div>
      </div>

      {/* Timeline */}
      <div style={{ flex: 1, overflowY: 'auto', padding: '16px' }}>
        {loading ? (
          <div style={{ fontSize: 12, color: '#94A3B8', textAlign: 'center', paddingTop: 40 }}>Loading timeline...</div>
        ) : events.length === 0 ? (
          <div style={{ fontSize: 12, color: '#94A3B8', textAlign: 'center', paddingTop: 40 }}>No events found for this case.</div>
        ) : (
          <div style={{ position: 'relative' }}>
            {/* Vertical line */}
            <div style={{ position: 'absolute', left: 7, top: 8, bottom: 8, width: 1, backgroundColor: '#E2E8F0' }} />

            {events.map((evt, idx) => {
              const { label: durLabel, speed } = formatDuration(evt.duration_since_prev_hours);
              const isLast = idx === events.length - 1;
              const date = new Date(evt.timestamp);
              const dateStr = date.toLocaleDateString('en-US', { month: 'short', day: 'numeric' });
              const timeStr = date.toLocaleTimeString('en-US', { hour: '2-digit', minute: '2-digit' });

              return (
                <div key={evt.id} style={{ marginBottom: isLast ? 0 : 0 }}>
                  {/* Duration pill between events */}
                  {evt.duration_since_prev_hours !== null && (
                    <div style={{ display: 'flex', alignItems: 'center', marginLeft: 16, marginBottom: 4, marginTop: 4 }}>
                      <div style={{
                        fontSize: 10,
                        fontFamily: 'var(--font-mono)',
                        color: speedColor[speed],
                        backgroundColor: speedBg[speed],
                        border: `1px solid ${speedColor[speed]}22`,
                        padding: '1px 7px',
                        borderRadius: 10,
                      }}>
                        {durLabel}
                      </div>
                    </div>
                  )}

                  {/* Event row */}
                  <div style={{ display: 'flex', gap: 10, alignItems: 'flex-start', marginBottom: 2 }}>
                    {/* Dot */}
                    <div style={{
                      width: 15,
                      height: 15,
                      borderRadius: '50%',
                      backgroundColor: speed === 'slow' ? '#DC2626' : '#1E3A5F',
                      border: '2px solid #FFFFFF',
                      boxShadow: '0 0 0 1px #E2E8F0',
                      flexShrink: 0,
                      marginTop: 2,
                      zIndex: 1,
                      position: 'relative',
                    }} />

                    {/* Content */}
                    <div style={{ flex: 1, paddingBottom: 12 }}>
                      <div style={{ display: 'flex', alignItems: 'baseline', gap: 8, marginBottom: 2 }}>
                        <span style={{ fontSize: 11, fontWeight: 600, color: '#0D1117' }}>
                          {evt.activity.replace(/_/g, ' ')}
                        </span>
                      </div>
                      <div style={{ fontSize: 10, color: '#94A3B8', fontFamily: 'var(--font-mono)' }}>
                        {dateStr} · {timeStr}
                      </div>
                      {evt.resource && (
                        <div style={{ fontSize: 10, color: '#64748B', marginTop: 2, display: 'flex', alignItems: 'center', gap: 4 }}>
                          <User size={9} />
                          {evt.resource}
                        </div>
                      )}
                      {/* Attributes preview */}
                      {evt.attributes && Object.keys(evt.attributes).length > 0 && (
                        <div style={{ marginTop: 6, padding: '5px 8px', backgroundColor: '#F8FAFC', borderRadius: 4, border: '1px solid #E2E8F0' }}>
                          {Object.entries(evt.attributes).slice(0, 4).map(([k, v]) => (
                            <div key={k} style={{ display: 'flex', gap: 6, fontSize: 10, lineHeight: '18px' }}>
                              <span style={{ color: '#94A3B8', flexShrink: 0 }}>{k.replace(/_/g, ' ')}</span>
                              <span style={{ color: '#0D1117', fontFamily: 'var(--font-mono)', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
                                {Array.isArray(v) ? `[${(v as unknown[]).length} items]` : String(v ?? '')}
                              </span>
                            </div>
                          ))}
                        </div>
                      )}
                    </div>
                  </div>
                </div>
              );
            })}
          </div>
        )}
      </div>
    </div>
  );
};
