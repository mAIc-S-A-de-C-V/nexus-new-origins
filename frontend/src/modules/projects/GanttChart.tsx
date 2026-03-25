import React, { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { ProjectStage, TeamMember, STAGE_META } from '../../types/project';
import { Plus, ChevronDown, ChevronRight, Trash2, User } from 'lucide-react';

// ── Date utils ────────────────────────────────────────────────────────────────

const parseDate = (s: string): Date => {
  const [y, m, d] = s.split('-').map(Number);
  return new Date(y, m - 1, d);
};
const fmtDate = (d: Date): string =>
  `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
const addDays = (s: string, n: number): string => {
  const d = parseDate(s);
  d.setDate(d.getDate() + n);
  return fmtDate(d);
};
const daysBetween = (a: string, b: string): number =>
  Math.round((parseDate(b).getTime() - parseDate(a).getTime()) / 86400000);
const getMonday = (d: Date): Date => {
  const copy = new Date(d);
  const day = copy.getDay();
  copy.setDate(copy.getDate() - (day === 0 ? 6 : day - 1));
  return copy;
};
const MONTHS = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];

// ── Constants ─────────────────────────────────────────────────────────────────

const DAY_W = 28;          // px per day
const ROW_H = 48;          // px per main stage row
const SUB_ROW_H = 40;      // px per sub-stage row
const HEADER_H = 56;       // px for the two-line date header
const LEFT_W = 360;        // px for left info panel (widened from 300)

// ── Avatar ────────────────────────────────────────────────────────────────────

const Avatar: React.FC<{ member?: TeamMember; size?: number }> = ({ member, size = 22 }) => {
  if (!member) return (
    <div style={{
      width: size, height: size, borderRadius: '50%',
      backgroundColor: '#E2E8F0', display: 'flex', alignItems: 'center', justifyContent: 'center',
    }}>
      <User size={size * 0.55} color="#94A3B8" />
    </div>
  );
  const initials = member.name.split(' ').map(w => w[0]).join('').slice(0, 2).toUpperCase();
  return (
    <div title={member.name} style={{
      width: size, height: size, borderRadius: '50%', flexShrink: 0,
      backgroundColor: member.color, display: 'flex', alignItems: 'center', justifyContent: 'center',
      fontSize: size * 0.4, fontWeight: 700, color: '#fff',
    }}>
      {initials}
    </div>
  );
};

// ── Props ─────────────────────────────────────────────────────────────────────

interface Props {
  stages: ProjectStage[];
  members: TeamMember[];
  onUpdateStage: (id: string, patch: Partial<ProjectStage>) => void;
  onAddSubStage: (parentId: string) => void;
  onDeleteStage: (id: string) => void;
  onOpenDetail: (id: string) => void;
}

// ── GanttChart ────────────────────────────────────────────────────────────────

export const GanttChart: React.FC<Props> = ({
  stages, members, onUpdateStage, onAddSubStage, onDeleteStage, onOpenDetail,
}) => {
  const scrollRef = useRef<HTMLDivElement>(null);
  const [expanded, setExpanded] = useState<Record<string, boolean>>({});
  const [hoveredRow, setHoveredRow] = useState<string | null>(null);

  // Drag state (ref so no re-render during move)
  const drag = useRef<{
    stageId: string;
    handle: 'bar' | 'left' | 'right';
    startClientX: number;
    origStart: string;
    origEnd: string;
  } | null>(null);

  // ── Timeline bounds ──────────────────────────────────────────────────────

  const { timelineStart, timelineEnd, totalDays } = useMemo(() => {
    const dated = stages.filter(s => s.startDate && s.endDate);
    let earliest = new Date();
    let latest = new Date();
    latest.setDate(latest.getDate() + 90);

    if (dated.length > 0) {
      earliest = new Date(Math.min(...dated.map(s => parseDate(s.startDate!).getTime())));
      latest = new Date(Math.max(...dated.map(s => parseDate(s.endDate!).getTime())));
      latest.setDate(latest.getDate() + 14); // buffer
    }

    const start = getMonday(new Date(earliest.getTime() - 14 * 86400000)); // 2 weeks before
    const end = new Date(latest.getTime() + 14 * 86400000);
    const totalDays = Math.ceil((end.getTime() - start.getTime()) / 86400000);
    return { timelineStart: fmtDate(start), timelineEnd: fmtDate(end), totalDays };
  }, [stages]);

  const totalW = totalDays * DAY_W;

  // ── Date <-> X ───────────────────────────────────────────────────────────

  const dateToX = useCallback((date: string): number =>
    daysBetween(timelineStart, date) * DAY_W, [timelineStart]);

  const xToDate = useCallback((x: number): string =>
    addDays(timelineStart, Math.round(x / DAY_W)), [timelineStart]);

  // ── Week/month headers ───────────────────────────────────────────────────

  const { weekHeaders, monthHeaders } = useMemo(() => {
    const weeks: { x: number; label: string }[] = [];
    const months: { x: number; w: number; label: string }[] = [];

    let cur = parseDate(timelineStart);
    const end = parseDate(timelineEnd);
    let lastMonth = -1;
    let monthStartX = 0;

    while (cur <= end) {
      const x = daysBetween(timelineStart, fmtDate(cur)) * DAY_W;
      weeks.push({ x, label: `${cur.getDate()} ${MONTHS[cur.getMonth()]}` });

      if (cur.getMonth() !== lastMonth) {
        if (lastMonth !== -1) {
          months.push({ x: monthStartX, w: x - monthStartX, label: `${MONTHS[lastMonth]} ${cur.getMonth() === 0 ? cur.getFullYear() - 1 : cur.getFullYear()}` });
        }
        lastMonth = cur.getMonth();
        monthStartX = x;
      }

      cur = new Date(cur.getTime() + 7 * 86400000);
    }
    if (lastMonth !== -1) {
      months.push({ x: monthStartX, w: totalW - monthStartX, label: `${MONTHS[lastMonth]} ${parseDate(timelineEnd).getFullYear()}` });
    }
    return { weekHeaders: weeks, monthHeaders: months };
  }, [timelineStart, timelineEnd, totalW]);

  // ── Today line ───────────────────────────────────────────────────────────

  const todayX = useMemo(() => {
    const today = fmtDate(new Date());
    const d = daysBetween(timelineStart, today);
    if (d < 0 || d > totalDays) return null;
    return d * DAY_W;
  }, [timelineStart, totalDays]);

  // ── Drag handlers ────────────────────────────────────────────────────────

  const startDrag = (e: React.MouseEvent, stage: ProjectStage, handle: 'bar' | 'left' | 'right') => {
    if (!stage.startDate || !stage.endDate) return;
    e.preventDefault();
    e.stopPropagation();
    drag.current = {
      stageId: stage.id,
      handle,
      startClientX: e.clientX,
      origStart: stage.startDate,
      origEnd: stage.endDate,
    };
  };

  useEffect(() => {
    const onMove = (e: MouseEvent) => {
      if (!drag.current) return;
      const { stageId, handle, startClientX, origStart, origEnd } = drag.current;
      const dx = e.clientX - startClientX;
      const days = Math.round(dx / DAY_W);
      if (days === 0) return;

      let newStart = origStart;
      let newEnd = origEnd;

      if (handle === 'bar') {
        newStart = addDays(origStart, days);
        newEnd = addDays(origEnd, days);
      } else if (handle === 'left') {
        newStart = addDays(origStart, days);
        if (daysBetween(newStart, origEnd) < 1) return;
      } else {
        newEnd = addDays(origEnd, days);
        if (daysBetween(origStart, newEnd) < 1) return;
      }

      onUpdateStage(stageId, { startDate: newStart, endDate: newEnd });
    };

    const onUp = () => { drag.current = null; };

    window.addEventListener('mousemove', onMove);
    window.addEventListener('mouseup', onUp);
    return () => {
      window.removeEventListener('mousemove', onMove);
      window.removeEventListener('mouseup', onUp);
    };
  }, [onUpdateStage]);

  // ── Click on timeline (create date range) ────────────────────────────────

  const handleTimelineClick = (e: React.MouseEvent, stage: ProjectStage) => {
    if (drag.current || stage.startDate) return;
    const rect = (e.currentTarget as HTMLDivElement).getBoundingClientRect();
    const scrollLeft = scrollRef.current?.scrollLeft || 0;
    const relX = e.clientX - rect.left + scrollLeft - LEFT_W;
    const clickedDate = xToDate(Math.max(0, relX));
    onUpdateStage(stage.id, {
      startDate: clickedDate,
      endDate: addDays(clickedDate, 13),
    });
  };

  // ── Row rendering ─────────────────────────────────────────────────────────

  const mainStages = stages.filter(s => !s.parentId).sort((a, b) => a.order - b.order);

  const renderRow = (stage: ProjectStage, isSubStage = false): React.ReactNode => {
    const meta = STAGE_META[stage.stageType] || STAGE_META.custom;
    const member = members.find(m => m.id === stage.assignedToId);
    const hasDate = !!(stage.startDate && stage.endDate);
    const subStages = stages.filter(s => s.parentId === stage.id).sort((a, b) => a.order - b.order);
    const isExpanded = expanded[stage.id] !== false;
    const isHovered = hoveredRow === stage.id;

    const barLeft = hasDate ? dateToX(stage.startDate!) : 0;
    const barW = hasDate ? Math.max(DAY_W, daysBetween(stage.startDate!, stage.endDate!) * DAY_W) : 0;
    const rowH = isSubStage ? SUB_ROW_H : ROW_H;

    const displayName = stage.name && stage.name.trim() ? stage.name : '';

    return (
      <React.Fragment key={stage.id}>
        {/* Row */}
        <div
          style={{ display: 'flex', height: rowH, position: 'relative' }}
          onMouseEnter={() => setHoveredRow(stage.id)}
          onMouseLeave={() => setHoveredRow(null)}
          onDoubleClick={() => onOpenDetail(stage.id)}
        >
          {/* Left cell */}
          <div style={{
            width: LEFT_W, minWidth: LEFT_W,
            display: 'flex', flexDirection: 'column', justifyContent: 'center',
            padding: isSubStage ? '0 8px 0 36px' : '0 8px 0 12px',
            borderBottom: '1px solid #F1F5F9',
            borderRight: '1px solid #E2E8F0',
            backgroundColor: '#FFFFFF',
            position: 'sticky', left: 0, zIndex: 2,
            cursor: 'default',
          }}>
          <div style={{ display: 'flex', alignItems: 'center', gap: 6 }}>
            {/* Expand toggle (only for main stages with sub-stages) */}
            {!isSubStage && (
              <button
                onClick={() => setExpanded(p => ({ ...p, [stage.id]: !isExpanded }))}
                style={{ padding: 2, color: subStages.length > 0 ? '#64748B' : 'transparent', lineHeight: 0, flexShrink: 0 }}
              >
                {isExpanded ? <ChevronDown size={14} /> : <ChevronRight size={14} />}
              </button>
            )}

            {/* Stage type dot */}
            <div style={{
              width: 8, height: 8, borderRadius: '50%', flexShrink: 0,
              backgroundColor: meta.color,
            }} />

            {/* Stage type badge (main stages only) */}
            {!isSubStage && (
              <span style={{
                fontSize: 10, fontWeight: 600, color: meta.color,
                backgroundColor: meta.light,
                padding: '1px 6px', borderRadius: 10,
                flexShrink: 0, whiteSpace: 'nowrap',
              }}>
                {meta.label}
              </span>
            )}

            {/* Name — editable inline input */}
            <input
              type="text"
              value={displayName}
              placeholder="Unnamed stage"
              onChange={e => onUpdateStage(stage.id, { name: e.target.value })}
              onBlur={e => onUpdateStage(stage.id, { name: e.target.value })}
              onClick={e => e.stopPropagation()}
              style={{
                fontSize: isSubStage ? 12 : 13,
                fontWeight: isSubStage ? 400 : 500,
                color: displayName ? '#0D1117' : '#94A3B8',
                flex: 1,
                minWidth: 0,
                border: 'none',
                outline: 'none',
                background: 'transparent',
                padding: 0,
                cursor: 'text',
                fontFamily: 'inherit',
              }}
              onFocus={e => {
                e.currentTarget.style.outline = '1px solid #CBD5E1';
                e.currentTarget.style.borderRadius = '3px';
                e.currentTarget.style.padding = '0 2px';
              }}
              onBlurCapture={e => {
                e.currentTarget.style.outline = 'none';
                e.currentTarget.style.padding = '0';
              }}
            />

            {/* Assignee picker */}
            <select
              value={stage.assignedToId || ''}
              onChange={e => onUpdateStage(stage.id, { assignedToId: e.target.value })}
              onClick={e => e.stopPropagation()}
              style={{
                border: 'none', background: 'transparent', fontSize: 11, color: '#64748B',
                cursor: 'pointer', maxWidth: 72, overflow: 'hidden', textOverflow: 'ellipsis',
                flexShrink: 0,
              }}
            >
              <option value="">— assign</option>
              {members.map(m => <option key={m.id} value={m.id}>{m.name}</option>)}
            </select>

            <Avatar member={member} size={24} />

            {/* Actions (hover) */}
            {isHovered && (
              <div style={{ display: 'flex', gap: 2, flexShrink: 0 }}>
                {!isSubStage && (
                  <button
                    title="Add sub-stage"
                    onClick={e => { e.stopPropagation(); onAddSubStage(stage.id); }}
                    style={{ padding: 3, color: '#94A3B8', lineHeight: 0 }}
                  >
                    <Plus size={13} />
                  </button>
                )}
                <button
                  title="Delete"
                  onClick={() => onDeleteStage(stage.id)}
                  style={{ padding: 3, color: '#94A3B8', lineHeight: 0 }}
                >
                  <Trash2 size={13} />
                </button>
              </div>
            )}
          </div>{/* Progress bar */}
          {(stage.progress !== undefined && stage.progress !== null && stage.progress > 0) && (
            <div style={{ marginTop: 3, height: 3, borderRadius: 2, backgroundColor: '#F1F5F9', overflow: 'hidden' }}>
              <div style={{ width: `${stage.progress}%`, height: '100%', backgroundColor: meta.color, borderRadius: 2, transition: 'width 300ms' }} />
            </div>
          )}
          </div>

          {/* Timeline cell */}
          <div
            style={{ flex: 1, position: 'relative', borderBottom: '1px solid #F1F5F9', cursor: hasDate ? 'default' : 'crosshair' }}
            onClick={e => handleTimelineClick(e, stage)}
          >
            {/* Alternating week bands */}
            {weekHeaders.map((w, wi) => (
              wi % 2 === 1 && (
                <div key={wi} style={{
                  position: 'absolute', left: w.x, top: 0, width: DAY_W * 7, height: '100%',
                  backgroundColor: '#F8FAFC',
                }} />
              )
            ))}

            {/* Today line */}
            {todayX !== null && (
              <div style={{
                position: 'absolute', left: todayX, top: 0, width: 2, height: '100%',
                backgroundColor: '#EF4444', opacity: 0.6, zIndex: 1,
              }} />
            )}

            {/* Stage bar */}
            {hasDate && (
              <div
                style={{
                  position: 'absolute',
                  left: barLeft,
                  width: barW,
                  top: '50%',
                  transform: 'translateY(-50%)',
                  height: isSubStage ? 20 : 26,
                  backgroundColor: meta.color,
                  borderRadius: 6,
                  display: 'flex',
                  alignItems: 'center',
                  paddingLeft: 8,
                  paddingRight: 8,
                  cursor: 'grab',
                  userSelect: 'none',
                  zIndex: 3,
                  overflow: 'hidden',
                  boxShadow: '0 1px 3px rgba(0,0,0,0.15)',
                }}
                onMouseDown={e => startDrag(e, stage, 'bar')}
                title={`${stage.startDate} → ${stage.endDate}`}
              >
                {/* Left resize handle */}
                <div
                  style={{
                    position: 'absolute', left: 0, top: 0, width: 8, height: '100%',
                    cursor: 'ew-resize', zIndex: 4,
                  }}
                  onMouseDown={e => startDrag(e, stage, 'left')}
                />
                {/* Label */}
                <span style={{ fontSize: 11, color: '#fff', fontWeight: 500, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap', flex: 1 }}>
                  {barW > 60 ? (stage.name || 'Unnamed stage') : ''}
                </span>
                {/* Avatar on bar */}
                {member && barW > 90 && (
                  <div style={{ marginLeft: 4, flexShrink: 0 }}>
                    <Avatar member={member} size={16} />
                  </div>
                )}
                {/* Right resize handle */}
                <div
                  style={{
                    position: 'absolute', right: 0, top: 0, width: 8, height: '100%',
                    cursor: 'ew-resize', zIndex: 4,
                  }}
                  onMouseDown={e => startDrag(e, stage, 'right')}
                />
              </div>
            )}

            {/* "Click to set dates" hint */}
            {!hasDate && isHovered && (
              <div style={{
                position: 'absolute', top: '50%', left: 20, transform: 'translateY(-50%)',
                fontSize: 11, color: '#CBD5E1', whiteSpace: 'nowrap', pointerEvents: 'none',
              }}>
                Click to place stage
              </div>
            )}
          </div>
        </div>

        {/* Sub-stages */}
        {!isSubStage && isExpanded && subStages.map(sub => renderRow(sub, true))}
      </React.Fragment>
    );
  };

  // ── Render ────────────────────────────────────────────────────────────────

  return (
    <div style={{ display: 'flex', flexDirection: 'column', height: '100%', overflow: 'hidden' }}>
      {/* Scrollable container */}
      <div ref={scrollRef} style={{ flex: 1, overflowX: 'auto', overflowY: 'auto' }}>
        <div style={{ minWidth: LEFT_W + totalW, position: 'relative' }}>

          {/* ── Header ── */}
          <div style={{ display: 'flex', height: HEADER_H, position: 'sticky', top: 0, zIndex: 10, backgroundColor: '#fff' }}>
            {/* Left header */}
            <div style={{
              width: LEFT_W, minWidth: LEFT_W, borderBottom: '2px solid #E2E8F0',
              borderRight: '1px solid #E2E8F0', backgroundColor: '#F8FAFC',
              display: 'flex', alignItems: 'flex-end', padding: '0 12px 8px',
              position: 'sticky', left: 0, zIndex: 11,
            }}>
              <span style={{ fontSize: 12, fontWeight: 600, color: '#64748B', textTransform: 'uppercase', letterSpacing: '0.05em' }}>
                Stage
              </span>
            </div>

            {/* Timeline header */}
            <div style={{ flex: 1, position: 'relative', borderBottom: '2px solid #E2E8F0' }}>
              {/* Month row */}
              <div style={{ position: 'absolute', top: 0, left: 0, height: 28, width: totalW }}>
                {monthHeaders.map((m, i) => (
                  <div key={i} style={{
                    position: 'absolute', left: m.x, width: m.w, height: '100%',
                    display: 'flex', alignItems: 'center', paddingLeft: 8,
                    borderRight: '1px solid #E2E8F0',
                    fontSize: 11, fontWeight: 600, color: '#374151',
                    backgroundColor: i % 2 === 0 ? '#F8FAFC' : '#F1F5F9',
                    overflow: 'hidden',
                  }}>
                    {m.label}
                  </div>
                ))}
              </div>

              {/* Week row */}
              <div style={{ position: 'absolute', top: 28, left: 0, height: HEADER_H - 28, width: totalW }}>
                {weekHeaders.map((w, i) => (
                  <div key={i} style={{
                    position: 'absolute', left: w.x, width: DAY_W * 7, height: '100%',
                    display: 'flex', alignItems: 'center', paddingLeft: 4,
                    borderRight: '1px solid #F1F5F9',
                    fontSize: 10, color: '#94A3B8',
                  }}>
                    {w.label}
                  </div>
                ))}
                {/* Today in header */}
                {todayX !== null && (
                  <div style={{
                    position: 'absolute', left: todayX - 1, top: 0, width: 2, height: '100%',
                    backgroundColor: '#EF4444', opacity: 0.8,
                  }} />
                )}
              </div>
            </div>
          </div>

          {/* ── Rows ── */}
          {mainStages.map(stage => renderRow(stage, false))}

          {/* Empty state */}
          {mainStages.length === 0 && (
            <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'center', height: 200, color: '#CBD5E1', fontSize: 13 }}>
              No stages yet
            </div>
          )}
        </div>
      </div>
    </div>
  );
};
