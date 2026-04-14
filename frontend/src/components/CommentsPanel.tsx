import React, { useEffect, useState, useRef } from 'react';
import { MessageSquare, Send, Check, Trash2, CornerDownRight } from 'lucide-react';
import { getTenantId } from '../store/authStore';
import { useAuthStore } from '../store/authStore';

const COLLAB_API = import.meta.env.VITE_COLLABORATION_SERVICE_URL || 'http://localhost:8020';

export interface Comment {
  id: string;
  entity_type: string;
  entity_id: string;
  parent_id: string | null;
  author_id: string;
  author_name: string;
  body: string;
  resolved: boolean;
  created_at: string;
  updated_at: string;
}

interface CommentsPanelProps {
  entityType: string;  // 'pipeline' | 'agent' | 'object_type' | 'connector' | 'logic'
  entityId: string;
  compact?: boolean;   // compact=true uses smaller font/padding for sidebar use
}

function timeAgo(iso: string): string {
  const diff = Date.now() - new Date(iso).getTime();
  const mins = Math.floor(diff / 60000);
  if (mins < 1) return 'just now';
  if (mins < 60) return `${mins}m ago`;
  const hrs = Math.floor(mins / 60);
  if (hrs < 24) return `${hrs}h ago`;
  return `${Math.floor(hrs / 24)}d ago`;
}

function Avatar({ name }: { name: string }) {
  const initials = name.split(' ').map(n => n[0]).join('').slice(0, 2).toUpperCase();
  const hue = name.split('').reduce((acc, c) => acc + c.charCodeAt(0), 0) % 360;
  return (
    <div style={{
      width: 26, height: 26, borderRadius: '50%', flexShrink: 0,
      backgroundColor: `hsl(${hue}, 60%, 70%)`,
      display: 'flex', alignItems: 'center', justifyContent: 'center',
      fontSize: 10, fontWeight: 700, color: '#fff',
    }}>
      {initials}
    </div>
  );
}

export const CommentsPanel: React.FC<CommentsPanelProps> = ({ entityType, entityId, compact = false }) => {
  const [comments, setComments] = useState<Comment[]>([]);
  const [loading, setLoading] = useState(false);
  const [input, setInput] = useState('');
  const [replyTo, setReplyTo] = useState<Comment | null>(null);
  const [submitting, setSubmitting] = useState(false);
  const inputRef = useRef<HTMLTextAreaElement>(null);

  // Get current user from auth store
  const user = useAuthStore(s => s.user);
  const authorId = user?.id || 'anonymous';
  const authorName = user?.name || user?.email || 'Anonymous';

  const headers = { 'Content-Type': 'application/json', 'x-tenant-id': getTenantId() };

  const load = async () => {
    setLoading(true);
    try {
      const res = await fetch(
        `${COLLAB_API}/comments?entity_type=${entityType}&entity_id=${entityId}`,
        { headers }
      );
      if (res.ok) setComments(await res.json());
    } finally { setLoading(false); }
  };

  useEffect(() => { load(); }, [entityType, entityId]);

  const submit = async () => {
    if (!input.trim()) return;
    setSubmitting(true);
    try {
      const res = await fetch(`${COLLAB_API}/comments`, {
        method: 'POST',
        headers,
        body: JSON.stringify({
          entity_type: entityType,
          entity_id: entityId,
          parent_id: replyTo?.id || null,
          author_id: authorId,
          author_name: authorName,
          body: input.trim(),
        }),
      });
      if (res.ok) {
        setInput('');
        setReplyTo(null);
        await load();
      }
    } finally { setSubmitting(false); }
  };

  const resolve = async (commentId: string, resolved: boolean) => {
    await fetch(`${COLLAB_API}/comments/${commentId}`, {
      method: 'PATCH',
      headers,
      body: JSON.stringify({ resolved }),
    });
    await load();
  };

  const del = async (commentId: string) => {
    await fetch(`${COLLAB_API}/comments/${commentId}`, { method: 'DELETE', headers });
    await load();
  };

  // Build threaded structure: top-level + replies
  const topLevel = comments.filter(c => !c.parent_id && !c.resolved);
  const resolved = comments.filter(c => !c.parent_id && c.resolved);
  const getReplies = (id: string) => comments.filter(c => c.parent_id === id);

  const fs = compact ? 11 : 12;
  const pad = compact ? '8px 10px' : '10px 12px';

  const CommentBlock = ({ comment, isReply = false }: { comment: Comment; isReply?: boolean }) => {
    const replies = getReplies(comment.id);
    return (
      <div style={{ marginLeft: isReply ? 28 : 0 }}>
        <div style={{ display: 'flex', gap: 8, padding: pad, borderBottom: '1px solid #F1F5F9' }}>
          <Avatar name={comment.author_name} />
          <div style={{ flex: 1, minWidth: 0 }}>
            <div style={{ display: 'flex', alignItems: 'center', gap: 6, marginBottom: 3 }}>
              <span style={{ fontSize: fs, fontWeight: 600, color: '#1E293B' }}>{comment.author_name}</span>
              <span style={{ fontSize: fs - 1, color: '#94A3B8' }}>{timeAgo(comment.created_at)}</span>
            </div>
            <p style={{ fontSize: fs, color: '#374151', margin: 0, lineHeight: 1.5, wordBreak: 'break-word' }}>{comment.body}</p>
            <div style={{ display: 'flex', gap: 8, marginTop: 4 }}>
              {!isReply && (
                <button onClick={() => { setReplyTo(comment); inputRef.current?.focus(); }} style={{ fontSize: fs - 1, color: '#64748B', background: 'none', border: 'none', cursor: 'pointer', padding: 0, display: 'flex', alignItems: 'center', gap: 2 }}>
                  <CornerDownRight size={10} /> Reply
                </button>
              )}
              <button onClick={() => resolve(comment.id, true)} style={{ fontSize: fs - 1, color: '#16A34A', background: 'none', border: 'none', cursor: 'pointer', padding: 0, display: 'flex', alignItems: 'center', gap: 2 }}>
                <Check size={10} /> Resolve
              </button>
              {comment.author_id === authorId && (
                <button onClick={() => del(comment.id)} style={{ fontSize: fs - 1, color: '#DC2626', background: 'none', border: 'none', cursor: 'pointer', padding: 0, display: 'flex', alignItems: 'center', gap: 2 }}>
                  <Trash2 size={10} /> Delete
                </button>
              )}
            </div>
          </div>
        </div>
        {replies.map(r => <CommentBlock key={r.id} comment={r} isReply />)}
      </div>
    );
  };

  return (
    <div style={{ display: 'flex', flexDirection: 'column', height: '100%', overflow: 'hidden' }}>
      {/* Comment list */}
      <div style={{ flex: 1, overflowY: 'auto' }}>
        {loading && <div style={{ padding: 16, textAlign: 'center', color: '#94A3B8', fontSize: fs }}>Loading...</div>}
        {!loading && topLevel.length === 0 && resolved.length === 0 && (
          <div style={{ padding: 24, textAlign: 'center', color: '#94A3B8', fontSize: fs }}>
            <MessageSquare size={20} style={{ display: 'block', margin: '0 auto 6px' }} />
            No comments yet
          </div>
        )}
        {topLevel.map(c => <CommentBlock key={c.id} comment={c} />)}
        {resolved.length > 0 && (
          <details style={{ padding: '6px 12px' }}>
            <summary style={{ fontSize: fs - 1, color: '#94A3B8', cursor: 'pointer' }}>{resolved.length} resolved</summary>
            {resolved.map(c => (
              <div key={c.id} style={{ opacity: 0.5, padding: '6px 0' }}>
                <CommentBlock comment={c} />
              </div>
            ))}
          </details>
        )}
      </div>

      {/* Input */}
      <div style={{ borderTop: '1px solid #E2E8F0', padding: '8px 10px', backgroundColor: '#FAFAFA', flexShrink: 0 }}>
        {replyTo && (
          <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', padding: '3px 8px', marginBottom: 6, backgroundColor: '#EFF6FF', borderRadius: 4, fontSize: fs - 1, color: '#2563EB' }}>
            <span>Replying to {replyTo.author_name}</span>
            <button onClick={() => setReplyTo(null)} style={{ background: 'none', border: 'none', cursor: 'pointer', color: '#2563EB', fontSize: 12 }}>×</button>
          </div>
        )}
        <div style={{ display: 'flex', gap: 6, alignItems: 'flex-end' }}>
          <textarea
            ref={inputRef}
            value={input}
            onChange={e => setInput(e.target.value)}
            onKeyDown={e => { if (e.key === 'Enter' && (e.metaKey || e.ctrlKey)) submit(); }}
            placeholder="Write a comment... (⌘↵ to send)"
            rows={2}
            style={{ flex: 1, resize: 'none', border: '1px solid #E2E8F0', borderRadius: 5, padding: '6px 8px', fontSize: fs, outline: 'none', fontFamily: 'inherit', lineHeight: 1.4 }}
          />
          <button
            onClick={submit}
            disabled={submitting || !input.trim()}
            style={{ height: 32, width: 32, border: 'none', borderRadius: 5, backgroundColor: input.trim() ? '#2563EB' : '#E2E8F0', color: input.trim() ? '#fff' : '#94A3B8', cursor: input.trim() ? 'pointer' : 'default', display: 'flex', alignItems: 'center', justifyContent: 'center', flexShrink: 0 }}
          >
            <Send size={13} />
          </button>
        </div>
      </div>
    </div>
  );
};

export default CommentsPanel;
