/**
 * Visual editor for AppComponent.joins — one or more query-time joins.
 * Each join needs an alias (e.g. "emp"), a target object type, and a
 * join key pair (source_field on the base record → target_field on the
 * joined record). Once declared, joined columns become reachable
 * everywhere a field name is expected via `alias.field` dot notation.
 *
 * If the user already has an ontology link declared between the two
 * OTs, the picker offers it as a quick-fill so they don't need to
 * remember the field names.
 */
import React from 'react';
import type { AppComponent, JoinSpec } from '../../../types/app';

interface OntologyType {
  id: string;
  name: string;
  displayName?: string;
  properties?: { name: string }[];
}

interface Props {
  comp: AppComponent;
  onChange: (joins: JoinSpec[] | undefined) => void;
  objectTypes: OntologyType[];
}

export const JoinPicker: React.FC<Props> = ({ comp, onChange, objectTypes }) => {
  const joins = comp.joins ?? [];

  const update = (idx: number, patch: Partial<JoinSpec>) => {
    const next = joins.map((j, i) => (i === idx ? { ...j, ...patch } : j));
    onChange(next);
  };

  const remove = (idx: number) => {
    const next = joins.filter((_, i) => i !== idx);
    onChange(next.length > 0 ? next : undefined);
  };

  const add = () => {
    onChange([
      ...joins,
      {
        alias: `j${joins.length + 1}`,
        target_object_type_id: '',
        on: { source_field: '', target_field: 'id' },
        type: 'left',
      },
    ]);
  };

  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: 8 }}>
      <div style={{ fontSize: 11, color: '#475569', fontWeight: 500 }}>
        Joins ({joins.length})
      </div>

      {joins.map((j, i) => {
        const targetOt = objectTypes.find((ot) => ot.id === j.target_object_type_id);
        return (
          <div key={i} style={{
            border: '1px solid #E2E8F0',
            borderRadius: 6,
            padding: 10,
            backgroundColor: '#F8FAFC',
            display: 'flex', flexDirection: 'column', gap: 6,
          }}>
            <div style={{ display: 'flex', gap: 6, alignItems: 'center' }}>
              <input
                type="text"
                value={j.alias}
                onChange={(e) => update(i, { alias: e.target.value })}
                placeholder="alias"
                style={{ ...textStyle, flex: 1, fontFamily: 'monospace' }}
              />
              <select
                value={j.type ?? 'left'}
                onChange={(e) => update(i, { type: e.target.value as 'left' | 'inner' })}
                style={{ ...textStyle, width: 80 }}
              >
                <option value="left">left</option>
                <option value="inner">inner</option>
              </select>
              <button
                type="button"
                onClick={() => remove(i)}
                style={removeBtnStyle}
                title="Remove join"
              >×</button>
            </div>

            <div>
              <label style={labelStyle}>Joined object type</label>
              <select
                value={j.target_object_type_id}
                onChange={(e) => update(i, { target_object_type_id: e.target.value })}
                style={textStyle}
              >
                <option value="">— pick —</option>
                {objectTypes.map((ot) => (
                  <option key={ot.id} value={ot.id}>
                    {ot.displayName || ot.name}
                  </option>
                ))}
              </select>
            </div>

            <div style={{ display: 'flex', gap: 6 }}>
              <div style={{ flex: 1 }}>
                <label style={labelStyle}>Source field (on this OT)</label>
                <input
                  type="text"
                  value={j.on?.source_field ?? ''}
                  onChange={(e) => update(i, { on: { source_field: e.target.value, target_field: j.on?.target_field ?? 'id' } })}
                  placeholder="employee_id"
                  style={{ ...textStyle, fontFamily: 'monospace' }}
                />
              </div>
              <div style={{ flex: 1 }}>
                <label style={labelStyle}>Target field (on {targetOt?.displayName || targetOt?.name || 'joined'})</label>
                <input
                  type="text"
                  value={j.on?.target_field ?? 'id'}
                  onChange={(e) => update(i, { on: { source_field: j.on?.source_field ?? '', target_field: e.target.value } })}
                  placeholder="id"
                  style={{ ...textStyle, fontFamily: 'monospace' }}
                />
              </div>
            </div>

            {targetOt?.properties && targetOt.properties.length > 0 && (
              <details>
                <summary style={{ fontSize: 10, color: '#94A3B8', cursor: 'pointer' }}>
                  Available joined columns — reference as <code>{j.alias}.field</code>
                </summary>
                <div style={{
                  fontSize: 10, color: '#64748B', fontFamily: 'monospace',
                  marginTop: 4, padding: 6, backgroundColor: '#fff',
                  borderRadius: 4, maxHeight: 100, overflow: 'auto',
                }}>
                  {targetOt.properties.map((p) => `${j.alias}.${p.name}`).join('\n')}
                </div>
              </details>
            )}
          </div>
        );
      })}

      <button
        type="button"
        onClick={add}
        style={{
          padding: '5px 10px',
          border: '1px dashed #CBD5E1',
          borderRadius: 4,
          backgroundColor: 'transparent',
          color: '#7C3AED',
          fontSize: 12,
          fontWeight: 500,
          cursor: 'pointer',
        }}
      >
        + Add join
      </button>
    </div>
  );
};

const textStyle: React.CSSProperties = {
  padding: '5px 8px',
  border: '1px solid #CBD5E1',
  borderRadius: 4,
  fontSize: 12,
  width: '100%',
  boxSizing: 'border-box',
  backgroundColor: '#fff',
};

const labelStyle: React.CSSProperties = {
  fontSize: 11, color: '#475569', display: 'block', marginBottom: 3,
};

const removeBtnStyle: React.CSSProperties = {
  width: 22, height: 22,
  border: '1px solid #FCA5A5',
  borderRadius: 4,
  backgroundColor: '#FEF2F2',
  color: '#DC2626',
  fontSize: 14,
  fontWeight: 600,
  cursor: 'pointer',
  display: 'flex', alignItems: 'center', justifyContent: 'center',
};
