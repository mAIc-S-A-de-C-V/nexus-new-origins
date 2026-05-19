import { describe, it, expect } from 'vitest';
import { render, screen, fireEvent } from '@testing-library/react';
import { AdvancedSection } from './AdvancedSection';
import type { AppComponent } from '../../../types/app';

const objectTypes = [
  { id: 'emp-id', name: 'employee', displayName: 'Employee', properties: [{ name: 'full_name' }] },
];

describe('<AdvancedSection />', () => {
  it('renders collapsed by default with no summary when nothing is set', () => {
    const comp: AppComponent = { id: 'c', type: 'metric-card', title: '' };
    render(<AdvancedSection comp={comp} onChange={() => {}} objectTypes={objectTypes} />);
    expect(screen.getByText(/Advanced/)).toBeTruthy();
    // The JoinPicker / ComputedFields / Window sections are hidden until expanded.
    expect(screen.queryByText(/Joins \(\d+\)/)).toBeNull();
  });

  it('expanding reveals the three child editors', () => {
    const comp: AppComponent = { id: 'c', type: 'metric-card', title: '' };
    render(<AdvancedSection comp={comp} onChange={() => {}} objectTypes={objectTypes} />);
    fireEvent.click(screen.getByText(/Advanced/));
    expect(screen.getByText(/Joins \(0\)/)).toBeTruthy();
    expect(screen.getByText(/Computed fields \(0\)/)).toBeTruthy();
    expect(screen.getByText(/Make this a window function/)).toBeTruthy();
  });

  it('shows a counted summary when collapsed and joins/computed/window are populated', () => {
    const comp: AppComponent = {
      id: 'c', type: 'line-chart', title: '',
      joins: [{ alias: 'emp', target_object_type_id: 'emp-id', on: { source_field: 'employee_id', target_field: 'id' }, type: 'left' }],
      computedFields: [{ name: 'cf1', expression: { type: 'lit', value: 1 } }],
      window: { frame_mode: 'cumulative', partition_by: [], order_by: [{ field: 'grp', dir: 'asc' }] },
    };
    render(<AdvancedSection comp={comp} onChange={() => {}} objectTypes={objectTypes} />);
    expect(screen.getByText(/1 join.*1 computed.*window/)).toBeTruthy();
  });
});
