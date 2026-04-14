import React, { memo } from 'react';
import { Handle, Position, NodeProps } from '@xyflow/react';

// ── Color helpers ─────────────────────────────────────────────────────────────

export function typeColor(id: string): { bg: string; border: string; badge: string; text: string } {
  let hash = 0;
  for (let i = 0; i < id.length; i++) {
    hash = (hash * 31 + id.charCodeAt(i)) | 0;
  }
  const hue = Math.abs(hash) % 360;
  return {
    bg: `hsl(${hue}, 30%, 96%)`,
    border: `hsl(${hue}, 45%, 75%)`,
    badge: `hsl(${hue}, 55%, 45%)`,
    text: `hsl(${hue}, 55%, 25%)`,
  };
}

// ── Type-level node (ObjectType) ───────────────────────────────────────────────

export interface TypeNodeData {
  id: string;
  display_name: string;
  name: string;
  record_count: number;
  properties: { name: string; data_type: string; semantic_type: string }[];
  version: number;
  description?: string;
  selected?: boolean;
}

export const TypeNodeComponent: React.FC<NodeProps> = memo(({ data, selected }) => {
  const d = data as unknown as TypeNodeData;
  const colors = typeColor(d.id);
  const topProps = d.properties.slice(0, 5);

  return (
    <div
      style={{
        width: 200,
        backgroundColor: selected ? colors.bg : '#FFFFFF',
        border: `2px solid ${selected ? colors.badge : colors.border}`,
        borderRadius: 8,
        overflow: 'hidden',
        boxShadow: selected
          ? `0 0 0 3px ${colors.border}, 0 4px 16px rgba(0,0,0,0.12)`
          : '0 2px 8px rgba(0,0,0,0.08)',
        transition: 'all 120ms',
        cursor: 'pointer',
      }}
    >
      {/* Header */}
      <div
        style={{
          padding: '8px 10px',
          backgroundColor: colors.badge,
          display: 'flex',
          alignItems: 'center',
          gap: 6,
        }}
      >
        <div
          style={{
            width: 22,
            height: 22,
            borderRadius: 4,
            backgroundColor: 'rgba(255,255,255,0.25)',
            display: 'flex',
            alignItems: 'center',
            justifyContent: 'center',
            fontSize: 10,
            fontWeight: 800,
            color: '#fff',
            flexShrink: 0,
          }}
        >
          {d.display_name.charAt(0).toUpperCase()}
        </div>
        <span
          style={{
            fontSize: 12,
            fontWeight: 700,
            color: '#fff',
            overflow: 'hidden',
            textOverflow: 'ellipsis',
            whiteSpace: 'nowrap',
            flex: 1,
          }}
        >
          {d.display_name}
        </span>
        <span
          style={{
            fontSize: 10,
            fontWeight: 700,
            color: 'rgba(255,255,255,0.85)',
            backgroundColor: 'rgba(0,0,0,0.18)',
            padding: '1px 5px',
            borderRadius: 10,
            flexShrink: 0,
          }}
        >
          {d.record_count.toLocaleString()}
        </span>
      </div>

      {/* Properties list */}
      <div style={{ padding: '6px 0' }}>
        {topProps.map((p) => (
          <div
            key={p.name}
            style={{
              display: 'flex',
              alignItems: 'center',
              gap: 6,
              padding: '2px 10px',
            }}
          >
            <span
              style={{
                width: 5,
                height: 5,
                borderRadius: '50%',
                backgroundColor: colors.badge,
                flexShrink: 0,
              }}
            />
            <span
              style={{
                fontSize: 11,
                color: '#374151',
                overflow: 'hidden',
                textOverflow: 'ellipsis',
                whiteSpace: 'nowrap',
                flex: 1,
                fontFamily: 'var(--font-mono, monospace)',
              }}
            >
              {p.name}
            </span>
            <span
              style={{
                fontSize: 9,
                color: '#9CA3AF',
                flexShrink: 0,
                textTransform: 'uppercase',
                letterSpacing: '0.04em',
              }}
            >
              {p.data_type}
            </span>
          </div>
        ))}
        {d.properties.length > 5 && (
          <div style={{ fontSize: 10, color: '#9CA3AF', padding: '3px 10px' }}>
            +{d.properties.length - 5} more
          </div>
        )}
        {topProps.length === 0 && (
          <div style={{ fontSize: 11, color: '#9CA3AF', padding: '4px 10px', fontStyle: 'italic' }}>
            No properties defined
          </div>
        )}
      </div>

      <Handle type="source" position={Position.Right} style={{ background: colors.badge, width: 8, height: 8, border: '2px solid white' }} />
      <Handle type="target" position={Position.Left} style={{ background: colors.badge, width: 8, height: 8, border: '2px solid white' }} />
    </div>
  );
});

TypeNodeComponent.displayName = 'TypeNodeComponent';


// ── Record-level node ─────────────────────────────────────────────────────────

export interface RecordNodeData {
  record_id: string;
  object_type_id: string;
  type_name: string;
  data: Record<string, unknown>;
  depth: number;
  selected?: boolean;
}

function topFields(data: Record<string, unknown>, max = 3): [string, unknown][] {
  return Object.entries(data)
    .filter(([k]) => !k.startsWith('_'))
    .slice(0, max);
}

export const RecordNodeComponent: React.FC<NodeProps> = memo(({ data, selected }) => {
  const d = data as unknown as RecordNodeData;
  const colors = typeColor(d.object_type_id);
  const fields = topFields(d.data, 4);
  const shortId = d.record_id.slice(0, 8);

  return (
    <div
      style={{
        width: 190,
        backgroundColor: '#FFFFFF',
        border: `2px solid ${selected ? colors.badge : colors.border}`,
        borderRadius: 6,
        overflow: 'hidden',
        boxShadow: selected
          ? `0 0 0 3px ${colors.border}, 0 4px 12px rgba(0,0,0,0.1)`
          : '0 1px 4px rgba(0,0,0,0.07)',
        transition: 'all 120ms',
        cursor: 'pointer',
      }}
    >
      {/* Type badge */}
      <div
        style={{
          padding: '4px 8px',
          backgroundColor: colors.bg,
          borderBottom: `1px solid ${colors.border}`,
          display: 'flex',
          alignItems: 'center',
          gap: 5,
        }}
      >
        <span
          style={{
            fontSize: 9,
            fontWeight: 700,
            color: colors.text,
            textTransform: 'uppercase',
            letterSpacing: '0.06em',
          }}
        >
          {d.type_name}
        </span>
        <span
          style={{
            marginLeft: 'auto',
            fontSize: 9,
            color: '#9CA3AF',
            fontFamily: 'var(--font-mono, monospace)',
          }}
        >
          {shortId}
        </span>
      </div>

      {/* Record fields */}
      <div style={{ padding: '5px 0' }}>
        {fields.map(([k, v]) => (
          <div key={k} style={{ display: 'flex', gap: 5, padding: '1px 8px', alignItems: 'baseline' }}>
            <span
              style={{
                fontSize: 10,
                color: '#6B7280',
                flexShrink: 0,
                fontFamily: 'var(--font-mono, monospace)',
                maxWidth: 70,
                overflow: 'hidden',
                textOverflow: 'ellipsis',
                whiteSpace: 'nowrap',
              }}
            >
              {k}
            </span>
            <span
              style={{
                fontSize: 11,
                color: '#111827',
                overflow: 'hidden',
                textOverflow: 'ellipsis',
                whiteSpace: 'nowrap',
                flex: 1,
              }}
            >
              {v == null ? '—' : String(v).slice(0, 30)}
            </span>
          </div>
        ))}
        {fields.length === 0 && (
          <div style={{ fontSize: 10, color: '#9CA3AF', padding: '3px 8px', fontStyle: 'italic' }}>
            empty record
          </div>
        )}
      </div>

      <Handle type="source" position={Position.Right} style={{ background: colors.badge, width: 7, height: 7, border: '2px solid white' }} />
      <Handle type="target" position={Position.Left} style={{ background: colors.badge, width: 7, height: 7, border: '2px solid white' }} />
    </div>
  );
});

RecordNodeComponent.displayName = 'RecordNodeComponent';
