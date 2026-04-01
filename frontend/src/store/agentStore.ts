import { create } from 'zustand';

const AGENT_API = import.meta.env.VITE_AGENT_SERVICE_URL || 'http://localhost:8013';

export interface KnowledgeScopeEntry {
  object_type_id: string;
  label: string;
  filter?: { field: string; op: string; value: string } | null;
}

export interface AgentConfig {
  id: string;
  tenant_id: string;
  name: string;
  description?: string;
  system_prompt: string;
  model: string;
  enabled_tools: string[];
  tool_config: Record<string, unknown>;
  max_iterations: number;
  knowledge_scope: KnowledgeScopeEntry[] | null; // null = unrestricted
  enabled: boolean;
  created_at?: string;
  updated_at?: string;
}

export interface AgentThread {
  id: string;
  agent_id: string;
  title?: string;
  status: string;
  created_by?: string;
  created_at?: string;
  updated_at?: string;
}

export interface AgentMessage {
  id: string;
  thread_id: string;
  role: string;
  content: string;
  tool_name?: string;
  tool_use_id?: string;
  tool_input?: Record<string, unknown>;
  tool_result?: unknown;
  created_at?: string;
}

interface AgentStore {
  agents: AgentConfig[];
  selectedAgent: AgentConfig | null;
  threads: AgentThread[];
  selectedThread: AgentThread | null;
  messages: AgentMessage[];
  availableTools: string[];
  loading: boolean;
  sending: boolean;

  fetchAgents: () => Promise<void>;
  selectAgent: (agent: AgentConfig | null) => void;
  createAgent: (data: Partial<AgentConfig>) => Promise<AgentConfig>;
  updateAgent: (id: string, data: Partial<AgentConfig>) => Promise<void>;
  deleteAgent: (id: string) => Promise<void>;
  setKnowledgeScope: (id: string, scope: KnowledgeScopeEntry[] | null) => Promise<void>;
  fetchAvailableTools: () => Promise<void>;

  fetchThreads: (agentId: string) => Promise<void>;
  createThread: (agentId: string) => Promise<AgentThread>;
  selectThread: (thread: AgentThread | null) => void;
  fetchMessages: (threadId: string) => Promise<void>;
  sendMessage: (threadId: string, content: string) => Promise<string>;
}

export const useAgentStore = create<AgentStore>((set, get) => ({
  agents: [],
  selectedAgent: null,
  threads: [],
  selectedThread: null,
  messages: [],
  availableTools: [],
  loading: false,
  sending: false,

  fetchAgents: async () => {
    set({ loading: true });
    try {
      const r = await fetch(`${AGENT_API}/agents`, {
        headers: { 'x-tenant-id': 'tenant-001' },
      });
      const data = await r.json();
      set({ agents: Array.isArray(data) ? data : [] });
    } finally {
      set({ loading: false });
    }
  },

  selectAgent: (agent) => set({ selectedAgent: agent, threads: [], selectedThread: null, messages: [] }),

  createAgent: async (data) => {
    const r = await fetch(`${AGENT_API}/agents`, {
      method: 'POST',
      headers: { 'x-tenant-id': 'tenant-001', 'Content-Type': 'application/json' },
      body: JSON.stringify(data),
    });
    const agent = await r.json();
    set((s) => ({ agents: [agent, ...s.agents], selectedAgent: agent }));
    return agent;
  },

  updateAgent: async (id, data) => {
    const r = await fetch(`${AGENT_API}/agents/${id}`, {
      method: 'PUT',
      headers: { 'x-tenant-id': 'tenant-001', 'Content-Type': 'application/json' },
      body: JSON.stringify(data),
    });
    const agent = await r.json();
    set((s) => ({
      agents: s.agents.map((a) => (a.id === id ? agent : a)),
      selectedAgent: s.selectedAgent?.id === id ? agent : s.selectedAgent,
    }));
  },

  deleteAgent: async (id) => {
    await fetch(`${AGENT_API}/agents/${id}`, {
      method: 'DELETE',
      headers: { 'x-tenant-id': 'tenant-001' },
    });
    set((s) => ({
      agents: s.agents.filter((a) => a.id !== id),
      selectedAgent: s.selectedAgent?.id === id ? null : s.selectedAgent,
    }));
  },

  setKnowledgeScope: async (id, scope) => {
    const r = await fetch(`${AGENT_API}/agents/${id}/knowledge-scope`, {
      method: 'PUT',
      headers: { 'x-tenant-id': 'tenant-001', 'Content-Type': 'application/json' },
      body: JSON.stringify({ scope }),
    });
    const agent = await r.json();
    set((s) => ({
      agents: s.agents.map((a) => (a.id === id ? agent : a)),
      selectedAgent: s.selectedAgent?.id === id ? agent : s.selectedAgent,
    }));
  },

  fetchAvailableTools: async () => {
    const r = await fetch(`${AGENT_API}/agents/tools`, {
      headers: { 'x-tenant-id': 'tenant-001' },
    });
    const data = await r.json();
    set({ availableTools: data.tools || [] });
  },

  fetchThreads: async (agentId) => {
    const r = await fetch(`${AGENT_API}/threads?agent_id=${agentId}`, {
      headers: { 'x-tenant-id': 'tenant-001' },
    });
    const data = await r.json();
    set({ threads: Array.isArray(data) ? data : [] });
  },

  createThread: async (agentId) => {
    const r = await fetch(`${AGENT_API}/threads/${agentId}`, {
      method: 'POST',
      headers: { 'x-tenant-id': 'tenant-001', 'Content-Type': 'application/json' },
      body: JSON.stringify({ title: `Thread ${new Date().toLocaleTimeString()}` }),
    });
    const thread = await r.json();
    set((s) => ({
      threads: [thread, ...s.threads],
      selectedThread: thread,
      messages: [],
    }));
    return thread;
  },

  selectThread: (thread) => {
    set({ selectedThread: thread, messages: [] });
    if (thread) get().fetchMessages(thread.id);
  },

  fetchMessages: async (threadId) => {
    const r = await fetch(`${AGENT_API}/threads/${threadId}/messages`, {
      headers: { 'x-tenant-id': 'tenant-001' },
    });
    const data = await r.json();
    set({ messages: Array.isArray(data) ? data : [] });
  },

  sendMessage: async (threadId, content) => {
    set({ sending: true });
    // Optimistically add user message
    const userMsg: AgentMessage = {
      id: `tmp-${Date.now()}`,
      thread_id: threadId,
      role: 'user',
      content,
      created_at: new Date().toISOString(),
    };
    set((s) => ({ messages: [...s.messages, userMsg] }));

    try {
      const r = await fetch(`${AGENT_API}/threads/${threadId}/messages`, {
        method: 'POST',
        headers: { 'x-tenant-id': 'tenant-001', 'Content-Type': 'application/json' },
        body: JSON.stringify({ content, stream: false }),
      });
      const data = await r.json();
      // Re-fetch to get persisted messages including tool calls
      await get().fetchMessages(threadId);
      return data.final_text || '';
    } finally {
      set({ sending: false });
    }
  },
}));
