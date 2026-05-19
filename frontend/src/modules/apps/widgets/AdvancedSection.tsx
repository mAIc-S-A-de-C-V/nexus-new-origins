/**
 * Collapsible "Advanced" section hosted in the widget ConfigPanel.
 * Bundles JoinPicker + ComputedFieldsEditor + WindowConfig under a
 * single foldable header so the regular field/value config stays the
 * focal point for the common case.
 *
 * Each widget gets the same advanced surface. The components inside
 * read/write `comp.joins`, `comp.computedFields`, and `comp.window`
 * respectively — those are all already plumbed to /aggregate via the
 * useAggregate caller.
 */
import React, { useState } from 'react';
import type { AppComponent } from '../../../types/app';
import { JoinPicker } from './JoinPicker';
import { ComputedFieldsEditor } from './ComputedFieldsEditor';
import { WindowConfig } from './WindowConfig';

interface OntologyType {
  id: string;
  name: string;
  displayName?: string;
  properties?: { name: string }[];
}

interface Props {
  comp: AppComponent;
  onChange: (patch: Partial<AppComponent>) => void;
  objectTypes: OntologyType[];
}

export const AdvancedSection: React.FC<Props> = ({ comp, onChange, objectTypes }) => {
  const [open, setOpen] = useState(false);

  // Field list for ExpressionInput's autocomplete hint. Mixes base-OT
  // columns and joined-OT columns (aliased) so analysts can see what's
  // reachable from this widget.
  const baseOt = objectTypes.find((ot) => ot.id === comp.objectTypeId);
  const baseFields = (baseOt?.properties ?? []).map((p) => p.name);
  const joinedFields: string[] = [];
  for (const j of (comp.joins ?? [])) {
    const tgt = objectTypes.find((ot) => ot.id === j.target_object_type_id);
    for (const p of (tgt?.properties ?? [])) {
      joinedFields.push(`${j.alias}.${p.name}`);
    }
  }
  const availableFields = [...baseFields, ...joinedFields];

  // Possible window sources — the dimension columns + each non-windowed agg's alias.
  // For widgets with a single inline aggregation, that's just grp/series/agg_0.
  const availableSources = ['grp', 'series', 'agg_0'];

  const summary = describeAdvanced(comp);

  return (
    <div style={{
      marginTop: 10,
      border: '1px solid #E2E8F0',
      borderRadius: 6,
      overflow: 'hidden',
    }}>
      <button
        type="button"
        onClick={() => setOpen(!open)}
        style={{
          width: '100%', textAlign: 'left',
          padding: '8px 10px',
          border: 'none',
          backgroundColor: open ? '#F1F5F9' : '#fff',
          cursor: 'pointer',
          display: 'flex', alignItems: 'center', justifyContent: 'space-between',
          fontSize: 12, fontWeight: 500, color: '#0D1117',
        }}
      >
        <span>{open ? '▼' : '▶'} Advanced (joins, computed fields, window)</span>
        {!open && summary && (
          <span style={{ fontSize: 10, color: '#7C3AED', fontWeight: 400 }}>{summary}</span>
        )}
      </button>
      {open && (
        <div style={{ padding: 10, display: 'flex', flexDirection: 'column', gap: 14 }}>
          <JoinPicker
            comp={comp}
            objectTypes={objectTypes}
            onChange={(joins) => onChange({ joins })}
          />
          <ComputedFieldsEditor
            comp={comp}
            availableFields={availableFields}
            onChange={(computedFields) => onChange({ computedFields })}
          />
          <WindowConfig
            comp={comp}
            availableSources={availableSources}
            onChange={(window) => onChange({ window })}
          />
        </div>
      )}
    </div>
  );
};

function describeAdvanced(comp: AppComponent): string {
  const parts: string[] = [];
  if (comp.joins && comp.joins.length > 0) parts.push(`${comp.joins.length} join${comp.joins.length === 1 ? '' : 's'}`);
  if (comp.computedFields && comp.computedFields.length > 0) parts.push(`${comp.computedFields.length} computed`);
  if (comp.window) parts.push('window');
  return parts.join(' · ');
}
