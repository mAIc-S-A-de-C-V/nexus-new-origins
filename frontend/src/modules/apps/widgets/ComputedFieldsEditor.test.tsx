import { describe, it, expect, vi } from 'vitest';
import { render, screen, fireEvent } from '@testing-library/react';
import { ComputedFieldsEditor } from './ComputedFieldsEditor';
import type { AppComponent } from '../../../types/app';

const baseComp: AppComponent = { id: 'c', type: 'metric-card', title: '' };

describe('<ComputedFieldsEditor />', () => {
  it('renders zero computed fields by default', () => {
    render(<ComputedFieldsEditor comp={baseComp} onChange={() => {}} />);
    expect(screen.getByText(/Computed fields \(0\)/)).toBeTruthy();
  });

  it('+ Add computed field appends a row with a unique placeholder name', () => {
    const onChange = vi.fn();
    render(<ComputedFieldsEditor comp={baseComp} onChange={onChange} />);
    fireEvent.click(screen.getByText('+ Add computed field'));
    expect(onChange).toHaveBeenCalledWith([
      expect.objectContaining({ name: 'cf_1' }),
    ]);
  });

  it('editing the expression text propagates the parsed AST', () => {
    const compWithCf: AppComponent = {
      ...baseComp,
      computedFields: [{ name: 'daily_cost', expression: { type: 'lit', value: null } }],
    };
    const onChange = vi.fn();
    render(<ComputedFieldsEditor comp={compWithCf} onChange={onChange} />);
    // The textbox here is the *second* input — first is the alias.
    const inputs = screen.getAllByRole('textbox');
    fireEvent.change(inputs[1], { target: { value: 'monthly_salary / 30' } });
    expect(onChange).toHaveBeenCalledWith([
      expect.objectContaining({
        name: 'daily_cost',
        expression: expect.objectContaining({ type: 'op', op: 'div' }),
      }),
    ]);
  });

  it('removing a row emits undefined when the list is empty', () => {
    const compWithCf: AppComponent = {
      ...baseComp,
      computedFields: [{ name: 'x', expression: { type: 'lit', value: 1 } }],
    };
    const onChange = vi.fn();
    render(<ComputedFieldsEditor comp={compWithCf} onChange={onChange} />);
    // First × button = remove first row
    const removeBtns = screen.getAllByRole('button').filter((b) => b.textContent === '×');
    fireEvent.click(removeBtns[0]);
    expect(onChange).toHaveBeenCalledWith(undefined);
  });
});
