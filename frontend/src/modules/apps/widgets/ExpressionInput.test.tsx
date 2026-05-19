import { describe, it, expect, vi } from 'vitest';
import { render, screen, fireEvent } from '@testing-library/react';
import { ExpressionInput } from './ExpressionInput';

describe('<ExpressionInput />', () => {
  it('renders the unparsed AST as initial text', () => {
    render(
      <ExpressionInput
        value={{ type: 'op', op: 'div',
                 left: { type: 'field', name: 'monthly_salary' },
                 right: { type: 'lit', value: 30 } }}
        onChange={() => {}}
      />,
    );
    const input = screen.getByRole('textbox') as HTMLInputElement;
    // The unparser collapses whitespace down to single spaces around binops.
    expect(input.value).toBe('monthly_salary / 30');
  });

  it('parses on input and emits a valid AST', () => {
    const onChange = vi.fn();
    render(<ExpressionInput value={undefined} onChange={onChange} />);
    const input = screen.getByRole('textbox');
    fireEvent.change(input, { target: { value: 'amount * 2' } });
    expect(onChange).toHaveBeenCalledWith({
      type: 'op', op: 'mul',
      left: { type: 'field', name: 'amount' },
      right: { type: 'lit', value: 2 },
    });
  });

  it('shows an inline error on invalid syntax and does not propagate', () => {
    const onChange = vi.fn();
    render(<ExpressionInput value={undefined} onChange={onChange} />);
    fireEvent.change(screen.getByRole('textbox'), { target: { value: '1 + ' } });
    expect(screen.getByText(/Unexpected token/i)).toBeTruthy();
    // No call with an AST — the previous value (null) stays intact.
    expect(onChange).not.toHaveBeenCalledWith(expect.objectContaining({ type: 'op' }));
  });

  it('clearing the input emits null', () => {
    const onChange = vi.fn();
    render(
      <ExpressionInput
        value={{ type: 'field', name: 'x' }}
        onChange={onChange}
      />,
    );
    fireEvent.change(screen.getByRole('textbox'), { target: { value: '' } });
    expect(onChange).toHaveBeenCalledWith(null);
  });

  it('shows available-field hint when provided', () => {
    render(
      <ExpressionInput
        value={undefined}
        onChange={() => {}}
        availableFields={['monthly_salary', 'allocation_pct']}
      />,
    );
    expect(screen.getByText(/Available fields \(2\)/)).toBeTruthy();
  });
});
