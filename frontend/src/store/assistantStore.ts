import { create } from 'zustand';
import { persist } from 'zustand/middleware';

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
        };
        set((s) => ({ conversations: [convo, ...s.conversations], activeId: id, open: true }));
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
    { name: 'nexus-assistant' }
  )
);
