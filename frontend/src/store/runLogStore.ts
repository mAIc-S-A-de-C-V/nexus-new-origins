import { create } from 'zustand';
import { persist } from 'zustand/middleware';

export interface NodeAudit {
  node_id: string;
  node_type: string;
  label?: string;
  status: 'ok' | 'error' | 'skipped';
  rows_in: number;
  rows_out: number;
  error?: string;
  duration_ms?: number;
}

export interface RunLog {
  id: string;
  pipeline_id: string;
  pipeline_name: string;
  status: 'COMPLETED' | 'FAILED' | 'RUNNING';
  rows_in: number;
  rows_out: number;
  error?: string;
  node_audits: NodeAudit[];
  started_at: string;
  finished_at?: string;
  read: boolean;
}

interface RunLogState {
  logs: RunLog[];
  unreadCount: number;
  addLog: (log: RunLog) => void;
  markRead: (id: string) => void;
  markAllRead: () => void;
  deleteLog: (id: string) => void;
  clearAll: () => void;
}

export const useRunLogStore = create<RunLogState>()(
  persist(
    (set, get) => ({
      logs: [],
      unreadCount: 0,

      addLog: (log) => {
        set((state) => {
          const logs = [log, ...state.logs].slice(0, 200); // cap at 200
          return { logs, unreadCount: logs.filter((l) => !l.read).length };
        });
      },

      markRead: (id) => {
        set((state) => {
          const logs = state.logs.map((l) => (l.id === id ? { ...l, read: true } : l));
          return { logs, unreadCount: logs.filter((l) => !l.read).length };
        });
      },

      markAllRead: () => {
        set((state) => ({
          logs: state.logs.map((l) => ({ ...l, read: true })),
          unreadCount: 0,
        }));
      },

      deleteLog: (id) => {
        set((state) => {
          const logs = state.logs.filter((l) => l.id !== id);
          return { logs, unreadCount: logs.filter((l) => !l.read).length };
        });
      },

      clearAll: () => set({ logs: [], unreadCount: 0 }),
    }),
    { name: 'nexus-run-logs' }
  )
);
