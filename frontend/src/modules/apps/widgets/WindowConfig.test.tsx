import { describe, it, expect, vi } from 'vitest';
import { render, screen, fireEvent } from '@testing-library/react';
import { WindowConfig } from './WindowConfig';
import type { AppComponent } from '../../../types/app';

const compNoWindow: AppComponent = { id: 'c1', type: 'line-chart', title: '' };

const compWithWindow: AppComponent = {
  id: 'c1', type: 'line-chart', title: '',
  window: {
    frame_mode: 'cumulative',
    partition_by: [],
    order_by: [{ field: 'grp', dir: 'asc' }],
  },
};

describe('<WindowConfig />', () => {
  it('renders with the toggle off when comp.window is unset', () => {
    render(<WindowConfig comp={compNoWindow} onChange={() => {}} availableSources={['grp', 'agg_0']} />);
    const checkbox = screen.getByRole('checkbox') as HTMLInputElement;
    expect(checkbox.checked).toBe(false);
  });

  it('toggling on emits a cumulative default', () => {
    const onChange = vi.fn();
    render(<WindowConfig comp={compNoWindow} onChange={onChange} availableSources={['grp', 'agg_0']} />);
    fireEvent.click(screen.getByRole('checkbox'));
    expect(onChange).toHaveBeenCalledWith(expect.objectContaining({
      frame_mode: 'cumulative',
      order_by: [{ field: 'grp', dir: 'asc' }],
    }));
  });

  it('toggling off emits undefined', () => {
    const onChange = vi.fn();
    render(<WindowConfig comp={compWithWindow} onChange={onChange} availableSources={['grp', 'agg_0']} />);
    fireEvent.click(screen.getByRole('checkbox'));
    expect(onChange).toHaveBeenCalledWith(undefined);
  });

  it('switching to rolling reveals the rows input', () => {
    const onChange = vi.fn();
    const { rerender } = render(
      <WindowConfig comp={compWithWindow} onChange={onChange} availableSources={['grp', 'agg_0']} />,
    );
    // Pick the first <select> (the Frame picker)
    const frameSelect = screen.getAllByRole('combobox')[0];
    fireEvent.change(frameSelect, { target: { value: 'rolling' } });
    expect(onChange).toHaveBeenCalledWith(expect.objectContaining({ frame_mode: 'rolling' }));

    // Re-render with the rolling state so the rows input appears
    rerender(
      <WindowConfig
        comp={{ ...compWithWindow, window: { ...compWithWindow.window!, frame_mode: 'rolling', frame_rows: 7 } }}
        onChange={onChange}
        availableSources={['grp', 'agg_0']}
      />,
    );
    expect(screen.getByDisplayValue('7')).toBeTruthy();
  });

  it('clicking a partition chip toggles inclusion', () => {
    const onChange = vi.fn();
    render(<WindowConfig comp={compWithWindow} onChange={onChange} availableSources={['grp', 'series']} />);
    // The chip is a <button> — there are multiple "series" matches (chip + hint text),
    // disambiguate by role + accessible name.
    const chip = screen.getByRole('button', { name: 'series' });
    fireEvent.click(chip);
    expect(onChange).toHaveBeenCalledWith(expect.objectContaining({
      partition_by: ['series'],
    }));
  });
});
