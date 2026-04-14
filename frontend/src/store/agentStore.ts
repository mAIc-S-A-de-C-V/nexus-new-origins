import { create } from 'zustand';
import { getTenantId } from './authStore';

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

export interface StreamingTool {
  name: string;
  status: 'calling' | 'done' | 'error';
  input?: Record<string, unknown>;
  result?: unknown;
}

export interface AgentVersion {
  id: string;
  agent_id: string;
  version_number: number;
  config_snapshot: AgentConfig;
  created_at: string;
}

export interface AgentSchedule {
  id: string;
  agent_id: string;
  tenant_id: string;
  name: string;
  prompt: string;
  cron_expression: string;
  enabled: boolean;
  last_run_at?: string;
  created_at?: string;
  updated_at?: string;
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
  streamingText: string;
  streamingTools: StreamingTool[];
  schedules: AgentSchedule[];

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
  clearStreaming: () => void;

  fetchSchedules: (agentId: string) => Promise<void>;
  createSchedule: (agentId: string, data: Omit<AgentSchedule, 'id' | 'agent_id' | 'tenant_id' | 'last_run_at' | 'created_at' | 'updated_at'>) => Promise<AgentSchedule>;
  updateSchedule: (agentId: string, scheduleId: string, data: Partial<AgentSchedule>) => Promise<void>;
  deleteSchedule: (agentId: string, scheduleId: string) => Promise<void>;
  runScheduleNow: (agentId: string, scheduleId: string) => Promise<void>;

  versions: AgentVersion[];
  fetchVersions: (agentId: string) => Promise<void>;
  restoreVersion: (agentId: string, versionId: string) => Promise<void>;
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
  streamingText: '',
  streamingTools: [],
  schedules: [],
  versions: [],

  fetchAgents: async () => {
    set({ loading: true });
    try {
      const r = await fetch(`${AGENT_API}/agents`, {
        headers: { 'x-tenant-id': getTenantId() },
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
      headers: { 'x-tenant-id': getTenantId(), 'Content-Type': 'application/json' },
      body: JSON.stringify(data),
    });
    const agent = await r.json();
    set((s) => ({ agents: [agent, ...s.agents], selectedAgent: agent }));
    return agent;
  },

  updateAgent: async (id, data) => {
    const r = await fetch(`${AGENT_API}/agents/${id}`, {
      method: 'PUT',
      headers: { 'x-tenant-id': getTenantId(), 'Content-Type': 'application/json' },
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
      headers: { 'x-tenant-id': getTenantId() },
    });
    set((s) => ({
      agents: s.agents.filter((a) => a.id !== id),
      selectedAgent: s.selectedAgent?.id === id ? null : s.selectedAgent,
    }));
  },

  setKnowledgeScope: async (id, scope) => {
    const r = await fetch(`${AGENT_API}/agents/${id}/knowledge-scope`, {
      method: 'PUT',
      headers: { 'x-tenant-id': getTenantId(), 'Content-Type': 'application/json' },
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
      headers: { 'x-tenant-id': getTenantId() },
    });
    const data = await r.json();
    set({ availableTools: data.tools || [] });
  },

  fetchThreads: async (agentId) => {
    const r = await fetch(`${AGENT_API}/threads?agent_id=${agentId}`, {
      headers: { 'x-tenant-id': getTenantId() },
    });
    const data = await r.json();
    set({ threads: Array.isArray(data) ? data : [] });
  },

  createThread: async (agentId) => {
    const r = await fetch(`${AGENT_API}/threads/${agentId}`, {
      method: 'POST',
      headers: { 'x-tenant-id': getTenantId(), 'Content-Type': 'application/json' },
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
      headers: { 'x-tenant-id': getTenantId() },
    });
    const data = await r.json();
    set({ messages: Array.isArray(data) ? data : [] });
  },

  sendMessage: async (threadId, content) => {
    set({ sending: true, streamingText: '', streamingTools: [] });
    const userMsg: AgentMessage = {
      id: `tmp-${Date.now()}`,
      thread_id: threadId,
      role: 'user',
      content,
      created_at: new Date().toISOString(),
    };
    set((s) => ({ messages: [...s.messages, userMsg] }));

    let finalText = '';
    let streamError: string | null = null;
    try {
      const response = await fetch(`${AGENT_API}/threads/${threadId}/messages`, {
        method: 'POST',
        headers: { 'x-tenant-id': getTenantId(), 'Content-Type': 'application/json' },
        body: JSON.stringify({ content, stream: true }),
      });

      if (!response.ok) {
        throw new Error(`Server error ${response.status}`);
      }

      const reader = response.body!.getReader();
      const decoder = new TextDecoder();
      let buffer = '';

      while (true) {
        const { done, value } = await reader.read();
        if (done) break;
        buffer += decoder.decode(value, { stream: true });
        const lines = buffer.split('\n');
        buffer = lines.pop() || '';
        for (const line of lines) {
          if (!line.startsWith('data: ')) continue;
          try {
            const event = JSON.parse(line.slice(6));
            if (event.type === 'text_delta') {
              finalText += event.text;
              set({ streamingText: finalText });
            } else if (event.type === 'tool_start') {
              set((s) => ({
                streamingTools: [...s.streamingTools, { name: event.tool, status: 'calling' as const }],
              }));
            } else if (event.type === 'tool_result') {
              set((s) => ({
                streamingTools: s.streamingTools.map((t) =>
                  t.name === event.tool && t.status === 'calling'
                    ? { ...t, status: 'done' as const, result: event.result }
                    : t
                ),
              }));
            } else if (event.type === 'error') {
              streamError = event.error || 'Unknown error';
            }
          } catch { /* partial JSON */ }
        }
      }
    } catch (err) {
      streamError = err instanceof Error ? err.message : String(err);
    } finally {
      set({ sending: false, streamingText: '', streamingTools: [] });
      // Small delay so the backend's finally-block DB save completes before we reload
      await new Promise((r) => setTimeout(r, 400));
      await get().fetchMessages(threadId);
      if (streamError && !finalText) {
        const errMsg: AgentMessage = {
          id: `err-${Date.now()}`,
          thread_id: threadId,
          role: 'assistant',
          content: `⚠️ Stream error: ${streamError}`,
          created_at: new Date().toISOString(),
        };
        set((s) => ({ messages: [...s.messages, errMsg] }));
      }
    }
    return finalText;
  },

  clearStreaming: () => set({ streamingText: '', streamingTools: [] }),

  fetchSchedules: async (agentId) => {
    const r = await fetch(`${AGENT_API}/agents/${agentId}/schedules`, {
      headers: { 'x-tenant-id': getTenantId() },
    });
    const data = await r.json();
    set({ schedules: Array.isArray(data) ? data : [] });
  },

  createSchedule: async (agentId, data) => {
    const r = await fetch(`${AGENT_API}/agents/${agentId}/schedules`, {
      method: 'POST',
      headers: { 'x-tenant-id': getTenantId(), 'Content-Type': 'application/json' },
      body: JSON.stringify(data),
    });
    const schedule = await r.json();
    set((s) => ({ schedules: [schedule, ...s.schedules] }));
    return schedule;
  },

  updateSchedule: async (agentId, scheduleId, data) => {
    const r = await fetch(`${AGENT_API}/agents/${agentId}/schedules/${scheduleId}`, {
      method: 'PUT',
      headers: { 'x-tenant-id': getTenantId(), 'Content-Type': 'application/json' },
      body: JSON.stringify(data),
    });
    const schedule = await r.json();
    set((s) => ({ schedules: s.schedules.map((sc) => (sc.id === scheduleId ? schedule : sc)) }));
  },

  deleteSchedule: async (agentId, scheduleId) => {
    await fetch(`${AGENT_API}/agents/${agentId}/schedules/${scheduleId}`, {
      method: 'DELETE',
      headers: { 'x-tenant-id': getTenantId() },
    });
    set((s) => ({ schedules: s.schedules.filter((sc) => sc.id !== scheduleId) }));
  },

  runScheduleNow: async (agentId, scheduleId) => {
    await fetch(`${AGENT_API}/agents/${agentId}/schedules/${scheduleId}/run-now`, {
      method: 'POST',
      headers: { 'x-tenant-id': getTenantId() },
    });
  },

  fetchVersions: async (agentId) => {
    const r = await fetch(`${AGENT_API}/agents/${agentId}/versions`, {
      headers: { 'x-tenant-id': getTenantId() },
    });
    const data = await r.json();
    set({ versions: Array.isArray(data) ? data : [] });
  },

  restoreVersion: async (agentId, versionId) => {
    const r = await fetch(`${AGENT_API}/agents/${agentId}/versions/${versionId}/restore`, {
      method: 'POST',
      headers: { 'x-tenant-id': getTenantId() },
    });
    const agent = await r.json();
    set((s) => ({
      agents: s.agents.map((a) => (a.id === agentId ? agent : a)),
      selectedAgent: s.selectedAgent?.id === agentId ? agent : s.selectedAgent,
    }));
  },
}));
