/**
 * CheckpointGate — wraps a sensitive action with a checkpoint evaluation.
 *
 * Usage:
 *   <CheckpointGate resource_type="object_type" operation="delete" onProceed={handleDelete}>
 *     {(trigger) => <button onClick={trigger}>Delete</button>}
 *   </CheckpointGate>
 *
 * Flow:
 *   1. User clicks the trigger button
 *   2. Gate evaluates checkpoint via POST /audit/checkpoints/evaluate
 *   3a. No checkpoint required → onProceed() called immediately
 *   3b. Checkpoint required → show CheckpointModal
 *   4. User submits justification → proof token returned → onProceed(token) called
 */
import React, { useState, useCallback } from 'react';
import { useCheckpointStore } from '../../store/checkpointStore';
import { CheckpointModal } from './CheckpointModal';

interface Props {
  resource_type: string;
  operation: string;
  user_role?: string;
  onProceed: (proofToken?: string) => void | Promise<void>;
  children: (trigger: () => void, checking: boolean) => React.ReactNode;
}

interface GateState {
  open: boolean;
  checkpointId: string;
  checkpointName: string;
  minLength: number;
}

export const CheckpointGate: React.FC<Props> = ({
  resource_type,
  operation,
  user_role = 'admin',
  onProceed,
  children,
}) => {
  const { evaluate } = useCheckpointStore();
  const [checking, setChecking] = useState(false);
  const [gate, setGate] = useState<GateState | null>(null);

  const trigger = useCallback(async () => {
    setChecking(true);
    try {
      const result = await evaluate(resource_type, operation, user_role);
      if (!result.required) {
        await onProceed();
      } else {
        setGate({
          open: true,
          checkpointId: result.checkpoint_id!,
          checkpointName: result.checkpoint_name || 'Checkpoint',
          minLength: 10,
        });
      }
    } catch {
      // If evaluate fails, allow the action through (fail-open for UX)
      await onProceed();
    } finally {
      setChecking(false);
    }
  }, [resource_type, operation, user_role, onProceed, evaluate]);

  const handleConfirm = useCallback(async (token: string) => {
    setGate(null);
    await onProceed(token);
  }, [onProceed]);

  const handleCancel = useCallback(() => {
    setGate(null);
  }, []);

  return (
    <>
      {children(trigger, checking)}
      {gate?.open && (
        <CheckpointModal
          checkpointId={gate.checkpointId}
          checkpointName={gate.checkpointName}
          minLength={gate.minLength}
          onConfirm={handleConfirm}
          onCancel={handleCancel}
        />
      )}
    </>
  );
};
