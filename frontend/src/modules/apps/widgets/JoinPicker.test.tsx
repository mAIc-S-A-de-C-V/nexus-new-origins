import { describe, it, expect, vi } from 'vitest';
import { render, screen, fireEvent } from '@testing-library/react';
import { JoinPicker } from './JoinPicker';
import type { AppComponent } from '../../../types/app';

const objectTypes = [
  { id: 'emp-id', name: 'employee', displayName: 'Employee', properties: [
    { name: 'id' }, { name: 'full_name' }, { name: 'monthly_salary' },
  ] },
  { id: 'proj-id', name: 'project', displayName: 'Project', properties: [{ name: 'id' }] },
];

const baseComp: AppComponent = { id: 'c', type: 'metric-card', title: '' };

describe('<JoinPicker />', () => {
  it('renders zero joins by default', () => {
    render(<JoinPicker comp={baseComp} onChange={() => {}} objectTypes={objectTypes} />);
    expect(screen.getByText(/Joins \(0\)/)).toBeTruthy();
  });

  it('clicking + Add join appends a default JoinSpec', () => {
    const onChange = vi.fn();
    render(<JoinPicker comp={baseComp} onChange={onChange} objectTypes={objectTypes} />);
    fireEvent.click(screen.getByText('+ Add join'));
    expect(onChange).toHaveBeenCalledWith([
      expect.objectContaining({
        alias: 'j1',
        target_object_type_id: '',
        on: { source_field: '', target_field: 'id' },
        type: 'left',
      }),
    ]);
  });

  it('editing the alias updates the join', () => {
    const compWithJoin: AppComponent = {
      ...baseComp,
      joins: [{ alias: 'j1', target_object_type_id: '', on: { source_field: '', target_field: 'id' }, type: 'left' }],
    };
    const onChange = vi.fn();
    render(<JoinPicker comp={compWithJoin} onChange={onChange} objectTypes={objectTypes} />);
    const aliasInput = screen.getByDisplayValue('j1');
    fireEvent.change(aliasInput, { target: { value: 'emp' } });
    expect(onChange).toHaveBeenCalledWith([
      expect.objectContaining({ alias: 'emp' }),
    ]);
  });

  it('removing a join emits undefined when none remain', () => {
    const compWithJoin: AppComponent = {
      ...baseComp,
      joins: [{ alias: 'emp', target_object_type_id: 'emp-id', on: { source_field: 'employee_id', target_field: 'id' }, type: 'left' }],
    };
    const onChange = vi.fn();
    render(<JoinPicker comp={compWithJoin} onChange={onChange} objectTypes={objectTypes} />);
    fireEvent.click(screen.getByTitle('Remove join'));
    expect(onChange).toHaveBeenCalledWith(undefined);
  });

  it('shows the joined columns once a target OT is picked', () => {
    const compWithJoin: AppComponent = {
      ...baseComp,
      joins: [{ alias: 'emp', target_object_type_id: 'emp-id', on: { source_field: 'employee_id', target_field: 'id' }, type: 'left' }],
    };
    render(<JoinPicker comp={compWithJoin} onChange={() => {}} objectTypes={objectTypes} />);
    // The collapsible block lists fields as `emp.full_name`
    expect(screen.getByText(/Available joined columns/)).toBeTruthy();
  });
});
