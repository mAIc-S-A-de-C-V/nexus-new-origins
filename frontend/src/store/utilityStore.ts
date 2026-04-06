import { create } from 'zustand';

const UTILITY_API = import.meta.env.VITE_UTILITY_SERVICE_URL || 'http://localhost:8014';

export interface UtilityInputField {
  name: string;
  type: string;
  required: boolean;
  description?: string;
}

export interface UtilityDefinition {
  id: string;
  name: string;
  category: string;
  description: string;
  icon: string;
  color: string;
  input_schema: UtilityInputField[];
  output_schema: Record<string, string>;
}

interface UtilityStore {
  utilities: UtilityDefinition[];
  loading: boolean;
  fetchUtilities: () => Promise<void>;
  runUtility: (utilityId: string, inputs: Record<string, unknown>) => Promise<{ utility_id: string; result: unknown }>;
}

export const useUtilityStore = create<UtilityStore>((set) => ({
  utilities: [],
  loading: false,

  fetchUtilities: async () => {
    set({ loading: true });
    try {
      const r = await fetch(`${UTILITY_API}/utilities`);
      const data = await r.json();
      set({ utilities: Array.isArray(data) ? data : [] });
    } catch {
      set({ utilities: [] });
    } finally {
      set({ loading: false });
    }
  },

  runUtility: async (utilityId, inputs) => {
    const r = await fetch(`${UTILITY_API}/utilities/${utilityId}/run`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ inputs }),
    });
    return r.json();
  },
}));
