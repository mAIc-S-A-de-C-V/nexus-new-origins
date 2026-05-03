/**
 * OperationsModule — top-level page.
 *
 * Routing precedence:
 *   1. A drilldown is open (a specific run was selected) → RunDrilldown
 *   2. An entity's history is open (user clicked a Catalog pill) → EntityHistory
 *   3. Default → HivemindGrid
 */
import React from 'react';
import { useOperationsStore } from '../../store/operationsStore';
import HivemindGrid from './HivemindGrid';
import RunDrilldown from './RunDrilldown';
import EntityHistory from './EntityHistory';

const OperationsModule: React.FC = () => {
  const selected = useOperationsStore((s) => s.selected);
  const entityHistory = useOperationsStore((s) => s.entityHistory);
  if (selected) return <RunDrilldown />;
  if (entityHistory) return <EntityHistory />;
  return <HivemindGrid />;
};

export default OperationsModule;
