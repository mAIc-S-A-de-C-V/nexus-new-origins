/**
 * Editor for the array of ComputedField on a widget. Each entry is an
 * alias + an expression authored via ExpressionInput. The alias becomes
 * referenceable in valueField / labelField / agg.field / filter.field.
 */
import React from 'react';
import type { AppComponent, ComputedField } from '../../../types/app';
import { ExpressionInput } from './ExpressionInput';

interface Props {
  comp: AppComponent;
  onChange: (computedFields: ComputedField[] | undefined) => void;
  availableFields?: string[];
}

export const ComputedFieldsEditor: React.FC<Props> = ({ comp, onChange, availableFields }) => {
  const items = comp.computedFields ?? [];

  const update = (idx: number, patch: Partial<ComputedField>) => {
    const next = items.map((c, i) => (i === idx ? { ...c, ...patch } : c));
    onChange(next);
  };

  const remove = (idx: number) => {
    const next = items.filter((_, i) => i !== idx);
    onChange(next.length > 0 ? next : undefined);
  };

  const add = () => {
    onChange([
      ...items,
      // Placeholder expression — the input shows empty and the user
      // types the real formula. We require *something* in the AST to
      // keep the type happy; lit:null parses to 'null' and is harmless.
      { name: `cf_${items.length + 1}`, expression: { type: 'lit', value: null } },
    ]);
  };

  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: 8 }}>
      <div style={{ fontSize: 11, color: '#475569', fontWeight: 500 }}>
        Computed fields ({items.length})
      </div>

      {items.map((cf, i) => (
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
              value={cf.name}
              onChange={(e) => update(i, { name: e.target.value })}
              placeholder="alias"
              style={{
                flex: 1,
                padding: '5px 8px',
                border: '1px solid #CBD5E1',
                borderRadius: 4,
                fontSize: 12,
                fontFamily: 'monospace',
              }}
            />
            <button
              type="button"
              onClick={() => remove(i)}
              style={{
                width: 22, height: 22,
                border: '1px solid #FCA5A5',
                borderRadius: 4,
                backgroundColor: '#FEF2F2',
                color: '#DC2626',
                fontSize: 14, fontWeight: 600, cursor: 'pointer',
              }}
            >×</button>
          </div>
          <ExpressionInput
            value={cf.expression}
            onChange={(expr) => update(i, { expression: expr ?? { type: 'lit', value: null } })}
            availableFields={availableFields}
          />
        </div>
      ))}

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
        + Add computed field
      </button>
    </div>
  );
};
