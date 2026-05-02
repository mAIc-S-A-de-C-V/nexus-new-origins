/**
 * OperationsModule — top-level page.
 * Renders the Hivemind grid by default; swaps to RunDrilldown when a card is selected.
 */
import React from 'react';
import { useOperationsStore } from '../../store/operationsStore';
import HivemindGrid from './HivemindGrid';
import RunDrilldown from './RunDrilldown';

const OperationsModule: React.FC = () => {
  const selected = useOperationsStore((s) => s.selected);
  if (selected) return <RunDrilldown />;
  return <HivemindGrid />;
};

export default OperationsModule;
