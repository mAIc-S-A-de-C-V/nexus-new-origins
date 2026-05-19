/**
 * Text-mode editor for an Expr AST. The user types something like
 *   monthly_salary / 30 * allocation_pct / 100
 * we parse it on the fly, show errors inline, and commit the AST to the
 * caller only when it parses cleanly.
 *
 * The point of this component (vs. raw textarea) is that the JSON AST
 * the /aggregate endpoint expects is unauthorable by hand — every
 * widget has to use *something* to translate human-readable text into
 * that shape, and centralizing the translation here means the same
 * editor can be reused for filter predicates, computed fields, and
 * window source references later.
 */
import React, { useState, useEffect, useRef } from 'react';
import type { Expr } from '../../../types/app';
import { parseExpression, unparseExpression, ExpressionParseError } from './expressionParser';

interface Props {
  /** Current AST (or undefined for empty). */
  value: Expr | undefined;
  /** Called with a valid AST when the input parses; null when cleared. */
  onChange: (expr: Expr | null) => void;
  /** Optional hint shown when the input is empty. */
  placeholder?: string;
  /** Optional list of fields the user can reference; shown as a help line. */
  availableFields?: string[];
  /** Treat parse errors as soft — don't show them while the user is typing. */
  deferErrors?: boolean;
}

export const ExpressionInput: React.FC<Props> = ({
  value,
  onChange,
  placeholder = 'e.g. monthly_salary / 30 * allocation_pct / 100',
  availableFields,
  deferErrors,
}) => {
  // The text shown in the input. Initialized from the AST and re-synced
  // when the AST changes externally (e.g. switching widgets).
  const [text, setText] = useState<string>(value ? unparseExpression(value) : '');
  const [error, setError] = useState<string | null>(null);
  const lastExternalAst = useRef<Expr | undefined>(value);

  useEffect(() => {
    // External value change — re-sync the textual representation, but
    // only if the AST is genuinely different (avoid stomping on the
    // user's in-progress edits).
    if (JSON.stringify(value) !== JSON.stringify(lastExternalAst.current)) {
      lastExternalAst.current = value;
      setText(value ? unparseExpression(value) : '');
      setError(null);
    }
  }, [value]);

  const onTextChange = (next: string) => {
    setText(next);
    if (!next.trim()) {
      setError(null);
      onChange(null);
      return;
    }
    try {
      const ast = parseExpression(next);
      lastExternalAst.current = ast;
      setError(null);
      onChange(ast);
    } catch (e) {
      if (e instanceof ExpressionParseError) {
        setError(`${e.message} (at position ${e.pos + 1})`);
      } else {
        setError(String(e));
      }
      // Don't propagate invalid AST upward — leave previous valid value in place.
    }
  };

  const showError = error && !deferErrors;

  return (
    <div>
      <input
        type="text"
        value={text}
        onChange={(e) => onTextChange(e.target.value)}
        placeholder={placeholder}
        style={{
          width: '100%',
          padding: '6px 8px',
          border: `1px solid ${showError ? '#DC2626' : '#CBD5E1'}`,
          borderRadius: 4,
          fontSize: 12,
          fontFamily: 'monospace',
          boxSizing: 'border-box',
          outline: 'none',
        }}
      />
      {showError && (
        <div style={{ marginTop: 4, fontSize: 11, color: '#DC2626' }}>
          {error}
        </div>
      )}
      {availableFields && availableFields.length > 0 && (
        <details style={{ marginTop: 4 }}>
          <summary style={{ fontSize: 10, color: '#94A3B8', cursor: 'pointer' }}>
            Available fields ({availableFields.length})
          </summary>
          <div style={{
            marginTop: 4, fontSize: 10, color: '#64748B',
            fontFamily: 'monospace', maxHeight: 120, overflow: 'auto',
            backgroundColor: '#F8FAFC', padding: 6, borderRadius: 4,
          }}>
            {availableFields.join(', ')}
          </div>
        </details>
      )}
      <details style={{ marginTop: 4 }}>
        <summary style={{ fontSize: 10, color: '#94A3B8', cursor: 'pointer' }}>
          Expression syntax
        </summary>
        <div style={{ marginTop: 4, fontSize: 11, color: '#64748B', lineHeight: 1.5 }}>
          <div><strong>Arithmetic:</strong> <code>+ - * / %</code></div>
          <div><strong>Comparison:</strong> <code>== != &lt; &lt;= &gt; &gt;=</code></div>
          <div><strong>Logical:</strong> <code>and or not</code></div>
          <div><strong>Strings:</strong> double-quoted, e.g. <code>"active"</code></div>
          <div><strong>Functions:</strong> <code>concat, lower, upper, coalesce,</code></div>
          <div style={{ marginLeft: 12 }}><code>date_diff("day", a, b), date_trunc("month", ts), now(),</code></div>
          <div style={{ marginLeft: 12 }}><code>to_number(x), to_date(x), to_text(x), if(cond, a, b),</code></div>
          <div style={{ marginLeft: 12 }}><code>round(x[, digits]), abs(x), floor(x), ceil(x), pow(b, e), length(s)</code></div>
          <div><strong>Joined fields:</strong> use dot syntax — <code>emp.full_name</code></div>
        </div>
      </details>
    </div>
  );
};
