import { create } from 'zustand';
import { persist, createJSONStorage, type StateStorage } from 'zustand/middleware';
import { getTenantId } from './authStore';

const MAX_CONVERSATIONS = 50;

/**
 * localStorage wrapper that recovers from QuotaExceededError by dropping the
 * oldest conversations from the persisted payload and retrying. Without this,
 * a full quota turns every assistant action into an uncaught exception.
 */
const quotaSafeStorage: StateStorage = {
  getItem: (name) => localStorage.getItem(name),
  removeItem: (name) => localStorage.removeItem(name),
  setItem: (name, value) => {
    try {
      localStorage.setItem(name, value);
      return;
    } catch (err) {
      if (!isQuotaError(err)) throw err;
    }
    let parsed: any;
    try { parsed = JSON.parse(value); } catch { localStorage.removeItem(name); return; }
    const convos: AssistantConversation[] | undefined = parsed?.state?.conversations;
    if (!Array.isArray(convos) || convos.length === 0) {
      localStorage.removeItem(name);
      return;
    }
    const sorted = [...convos].sort((a, b) => (b.updatedAt || '').localeCompare(a.updatedAt || ''));
    for (let keep = Math.max(1, sorted.length - 1); keep >= 1; keep--) {
      parsed.state.conversations = sorted.slice(0, keep);
      try {
        localStorage.setItem(name, JSON.stringify(parsed));
        return;
      } catch (err) {
        if (!isQuotaError(err)) throw err;
      }
    }
    localStorage.removeItem(name);
  },
};

function isQuotaError(err: unknown): boolean {
  if (!(err instanceof Error)) return false;
  return err.name === 'QuotaExceededError'
    || err.name === 'NS_ERROR_DOM_QUOTA_REACHED'
    || /quota/i.test(err.message);
}

export interface AssistantMessage {
  id: string;
  role: 'user' | 'assistant';
  content: string;
  timestamp: string;
  feedback?: 'up' | 'down';
  streaming?: boolean;
}

export interface AssistantConversation {
  id: string;
  title: string;
  messages: AssistantMessage[];
  createdAt: string;
  updatedAt: string;
  tenantId?: string;
}

interface AssistantStore {
  open: boolean;
  activeId: string | null;
  conversations: AssistantConversation[];
  streamingMessageId: string | null;
  setOpen: (open: boolean) => void;
  toggle: () => void;
  newConversation: () => string;
  selectConversation: (id: string) => void;
  deleteConversation: (id: string) => void;
  addMessage: (conversationId: string, msg: AssistantMessage) => void;
  updateLastMessage: (conversationId: string, content: string) => void;
  updateMessageContent: (msgId: string, content: string) => void;
  updateMessageStreaming: (msgId: string, streaming: boolean) => void;
  setMessageFeedback: (msgId: string, feedback: 'up' | 'down') => void;
  setStreamingMessageId: (id: string | null) => void;
}

function uid() { return Math.random().toString(36).slice(2, 10); }

export const useAssistantStore = create<AssistantStore>()(
  persist(
    (set, get) => ({
      open: false,
      activeId: null,
      conversations: [],
      streamingMessageId: null,

      setOpen: (open) => set({ open }),
      toggle: () => set((s) => ({ open: !s.open })),

      newConversation: () => {
        const id = uid();
        const now = new Date().toISOString();
        const convo: AssistantConversation = {
          id,
          title: 'New conversation',
          messages: [],
          createdAt: now,
          updatedAt: now,
          tenantId: getTenantId(),
        };
        set((s) => ({
          conversations: [convo, ...s.conversations].slice(0, MAX_CONVERSATIONS),
          activeId: id,
          open: true,
        }));
        return id;
      },

      selectConversation: (id) => set({ activeId: id }),

      deleteConversation: (id) => {
        const { conversations, activeId } = get();
        const filtered = conversations.filter((c) => c.id !== id);
        set({
          conversations: filtered,
          activeId: activeId === id ? (filtered[0]?.id ?? null) : activeId,
        });
      },

      addMessage: (conversationId, msg) => {
        set((s) => ({
          conversations: s.conversations.map((c) => {
            if (c.id !== conversationId) return c;
            const messages = [...c.messages, msg];
            const title = c.title === 'New conversation' && msg.role === 'user'
              ? msg.content.slice(0, 48) + (msg.content.length > 48 ? '…' : '')
              : c.title;
            return { ...c, messages, title, updatedAt: new Date().toISOString() };
          }),
        }));
      },

      updateLastMessage: (conversationId, content) => {
        set((s) => ({
          conversations: s.conversations.map((c) => {
            if (c.id !== conversationId) return c;
            const messages = [...c.messages];
            if (messages.length && messages[messages.length - 1].role === 'assistant') {
              messages[messages.length - 1] = { ...messages[messages.length - 1], content };
            }
            return { ...c, messages, updatedAt: new Date().toISOString() };
          }),
        }));
      },

      updateMessageContent: (msgId, content) => {
        set((s) => ({
          conversations: s.conversations.map((c) => ({
            ...c,
            messages: c.messages.map((m) =>
              m.id === msgId ? { ...m, content } : m
            ),
            updatedAt: c.messages.some((m) => m.id === msgId) ? new Date().toISOString() : c.updatedAt,
          })),
        }));
      },

      updateMessageStreaming: (msgId, streaming) => {
        set((s) => ({
          conversations: s.conversations.map((c) => ({
            ...c,
            messages: c.messages.map((m) =>
              m.id === msgId ? { ...m, streaming } : m
            ),
          })),
        }));
      },

      setMessageFeedback: (msgId, feedback) => {
        set((s) => ({
          conversations: s.conversations.map((c) => ({
            ...c,
            messages: c.messages.map((m) =>
              m.id === msgId ? { ...m, feedback } : m
            ),
          })),
        }));
      },

      setStreamingMessageId: (id) => set({ streamingMessageId: id }),
    }),
    {
      name: 'nexus-assistant',
      storage: createJSONStorage(() => quotaSafeStorage),
      partialize: (state) => ({
        activeId: state.activeId,
        conversations: state.conversations,
      }),
    }
  )
);

/** Conversations filtered to the current tenant. Unstamped legacy ones default to tenant-001. */
export function useTenantConversations() {
  const conversations = useAssistantStore(s => s.conversations);
  const tid = getTenantId();
  return conversations.filter(c => (c.tenantId || 'tenant-001') === tid);
}
