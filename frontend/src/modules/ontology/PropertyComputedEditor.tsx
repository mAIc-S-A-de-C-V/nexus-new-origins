/**
 * Per-property editor for OT-level computed columns. Surfaces under a
 * property row when the user toggles it on. The expression authored here
 * is sent to the backend on the next ObjectType save; /aggregate then
 * auto-merges it into every widget's computed_fields list.
 */
import React, { useState } from 'react';
import type { ObjectProperty } from '../../types/ontology';
import type { Expr } from '../../types/app';
import { ExpressionInput } from '../apps/widgets/ExpressionInput';

interface Props {
  property: ObjectProperty;
  /** All other property names on this OT — shown as autocomplete hints. */
  siblingFieldNames: string[];
  /** Persist the patched property back to the parent. */
  onChange: (patch: Partial<ObjectProperty>) => void;
}

export const PropertyComputedEditor: React.FC<Props> = ({ property, siblingFieldNames, onChange }) => {
  // Local state so toggling on can show a clean editor without
  // immediately persisting an empty expression.
  const [open, setOpen] = useState(!!property.computed);

  const computed = property.computed;
  const initialExpr = (computed?.expression as Expr | undefined);

  const toggle = () => {
    if (computed) {
      // Toggling OFF a previously-computed property — clear it.
      setOpen(false);
      onChange({ computed: undefined });
    } else {
      setOpen(true);
    }
  };

  const setExpression = (expr: Expr | null) => {
    if (!expr) {
      onChange({ computed: undefined });
      return;
    }
    onChange({ computed: { expression: expr } });
  };

  return (
    <div style={{ marginTop: 6 }}>
      <button
        type="button"
        onClick={toggle}
        style={{
          fontSize: 10,
          padding: '2px 8px',
          borderRadius: 3,
          border: `1px solid ${computed ? '#7C3AED' : '#E2E8F0'}`,
          backgroundColor: computed ? '#EDE9FE' : '#fff',
          color: computed ? '#5B21B6' : '#64748B',
          fontWeight: 500,
          cursor: 'pointer',
        }}
        title="Mark this property as a computed (virtual) column derived from other fields."
      >
        {computed ? '✓ Computed' : '+ Make computed'}
      </button>

      {open && (
        <div style={{
          marginTop: 6,
          padding: 8,
          backgroundColor: '#F8FAFC',
          border: '1px solid #E2E8F0',
          borderRadius: 4,
        }}>
          <div style={{ fontSize: 11, color: '#64748B', marginBottom: 4 }}>
            Expression — referenced fields must exist on this object type.
          </div>
          <ExpressionInput
            value={initialExpr}
            onChange={setExpression}
            placeholder="e.g. monthly_salary / 30 * allocation_pct / 100"
            availableFields={siblingFieldNames.filter((n) => n !== property.name)}
          />
        </div>
      )}
    </div>
  );
};
