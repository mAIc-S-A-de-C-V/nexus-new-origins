import React, { useState, useEffect, useRef, useCallback } from 'react';
import { X, MessageCircle, QrCode, CheckCircle2, Loader2, Users, Eye, EyeOff, Search } from 'lucide-react';
import { useConnectorStore } from '../../store/connectorStore';

const CONNECTOR_API = import.meta.env.VITE_CONNECTOR_SERVICE_URL || 'http://localhost:8001';

interface Props {
  onClose: () => void;
}

interface Chat {
  jid: string;
  chatType: string;
  name: string;
  description: string | null;
  isMonitored: boolean;
  participantCount: number;
  messageCount: number;
  lastActivity: string | null;
}

type Step = 'name' | 'qr' | 'chats';

export const WhatsAppSetupModal: React.FC<Props> = ({ onClose }) => {
  const { addConnector, fetchConnectors } = useConnectorStore();
  const [step, setStep] = useState<Step>('name');
  const [name, setName] = useState('');
  const [description, setDescription] = useState('');
  const [connectorId, setConnectorId] = useState<string | null>(null);
  const [qrDataUrl, setQrDataUrl] = useState<string | null>(null);
  const [sessionStatus, setSessionStatus] = useState('disconnected');
  const [phoneNumber, setPhoneNumber] = useState<string | null>(null);
  const [chats, setChats] = useState<Chat[]>([]);
  const [searchQuery, setSearchQuery] = useState('');
  const [loading, setLoading] = useState(false);
  const eventSourceRef = useRef<EventSource | null>(null);

  const tenantId = (() => {
    try {
      const raw = localStorage.getItem('nexus_auth');
      if (raw) return JSON.parse(raw)?.tenantId || 'tenant-001';
    } catch { /* */ }
    return 'tenant-001';
  })();

  // Step 1: Create connector
  const handleCreate = async () => {
    if (!name.trim()) return;
    setLoading(true);
    try {
      const created = await addConnector({
        name: name.trim(),
        type: 'WHATSAPP',
        category: 'Messaging',
        description: description.trim(),
        authType: 'None',
        status: 'idle',
      } as any);
      setConnectorId(created.id);
      setStep('qr');
      // Start session
      await fetch(`${CONNECTOR_API}/connectors/${created.id}/whatsapp/start`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', 'x-tenant-id': tenantId },
        body: JSON.stringify({ tenantId }),
      });
      // Subscribe to QR SSE
      startQrStream(created.id);
    } catch (e) {
      console.error('Failed to create WhatsApp connector:', e);
    } finally {
      setLoading(false);
    }
  };

  const startQrStream = useCallback((cId: string) => {
    if (eventSourceRef.current) eventSourceRef.current.close();
    const es = new EventSource(`${CONNECTOR_API}/connectors/${cId}/whatsapp/qr`);
    eventSourceRef.current = es;

    es.onmessage = (event) => {
      try {
        const data = JSON.parse(event.data);
        if (data.qr) setQrDataUrl(data.qr);
        if (data.status) setSessionStatus(data.status);
        if (data.phoneNumber) setPhoneNumber(data.phoneNumber);
        if (data.status === 'connected') {
          es.close();
          setStep('chats');
          fetchChats(cId);
        }
      } catch { /* */ }
    };

    es.onerror = () => {
      // Poll status as fallback
      setTimeout(async () => {
        try {
          const r = await fetch(`${CONNECTOR_API}/connectors/${cId}/whatsapp/status`, {
            headers: { 'x-tenant-id': tenantId },
          });
          const data = await r.json();
          setSessionStatus(data.status);
          if (data.status === 'connected') {
            setPhoneNumber(data.phoneNumber);
            es.close();
            setStep('chats');
            fetchChats(cId);
          }
        } catch { /* */ }
      }, 3000);
    };
  }, [tenantId]);

  const fetchChats = async (cId: string, retries = 8) => {
    try {
      const r = await fetch(`${CONNECTOR_API}/connectors/${cId}/whatsapp/chats`, {
        headers: { 'x-tenant-id': tenantId },
      });
      const data = await r.json();
      const found = data.chats || [];
      setChats(found);
      // Chat discovery runs async after connection — poll until chats appear
      if (found.length === 0 && retries > 0) {
        setTimeout(() => fetchChats(cId, retries - 1), 2000);
      }
    } catch { /* */ }
  };

  const toggleMonitor = async (jid: string, monitored: boolean) => {
    if (!connectorId) return;
    setChats(prev => prev.map(c => c.jid === jid ? { ...c, isMonitored: monitored } : c));
    await fetch(`${CONNECTOR_API}/connectors/${connectorId}/whatsapp/chats/${encodeURIComponent(jid)}/monitor`, {
      method: 'PATCH',
      headers: { 'Content-Type': 'application/json', 'x-tenant-id': tenantId },
      body: JSON.stringify({ monitored }),
    });
  };

  const toggleAll = async (monitored: boolean) => {
    if (!connectorId) return;
    setChats(prev => prev.map(c => ({ ...c, isMonitored: monitored })));
    await fetch(`${CONNECTOR_API}/connectors/${connectorId}/whatsapp/chats/monitor-all`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', 'x-tenant-id': tenantId },
      body: JSON.stringify({ monitored }),
    });
  };

  useEffect(() => {
    return () => {
      if (eventSourceRef.current) eventSourceRef.current.close();
    };
  }, []);

  const handleDone = () => {
    fetchConnectors();
    onClose();
  };

  const filteredChats = chats.filter(c =>
    c.name.toLowerCase().includes(searchQuery.toLowerCase())
  );

  const monitoredCount = chats.filter(c => c.isMonitored).length;

  const overlayStyle: React.CSSProperties = {
    position: 'fixed', inset: 0, backgroundColor: 'rgba(0,0,0,0.5)',
    display: 'flex', alignItems: 'center', justifyContent: 'center', zIndex: 10000,
  };
  const modalStyle: React.CSSProperties = {
    backgroundColor: '#FFFFFF', borderRadius: 12, width: 520, maxHeight: '85vh',
    display: 'flex', flexDirection: 'column', boxShadow: '0 20px 60px rgba(0,0,0,0.3)',
  };
  const headerStyle: React.CSSProperties = {
    padding: '16px 20px', borderBottom: '1px solid #E2E8F0',
    display: 'flex', alignItems: 'center', justifyContent: 'space-between', flexShrink: 0,
  };
  const bodyStyle: React.CSSProperties = {
    padding: '20px', flex: 1, overflow: 'auto',
  };
  const inputStyle: React.CSSProperties = {
    width: '100%', padding: '8px 12px', borderRadius: 6, border: '1px solid #E2E8F0',
    fontSize: 13, outline: 'none', boxSizing: 'border-box',
  };
  const btnPrimary: React.CSSProperties = {
    padding: '8px 20px', borderRadius: 6, border: 'none',
    backgroundColor: '#25D366', color: '#FFFFFF', fontSize: 13,
    fontWeight: 600, cursor: 'pointer',
  };
  const btnSecondary: React.CSSProperties = {
    padding: '8px 16px', borderRadius: 6, border: '1px solid #E2E8F0',
    backgroundColor: '#FFFFFF', color: '#475569', fontSize: 12,
    fontWeight: 600, cursor: 'pointer',
  };

  return (
    <div style={overlayStyle} onClick={onClose}>
      <div style={modalStyle} onClick={e => e.stopPropagation()}>
        {/* Header */}
        <div style={headerStyle}>
          <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
            <div style={{
              width: 32, height: 32, borderRadius: 8, backgroundColor: '#25D366',
              display: 'flex', alignItems: 'center', justifyContent: 'center',
            }}>
              <MessageCircle size={18} color="#FFF" />
            </div>
            <div>
              <div style={{ fontSize: 14, fontWeight: 700, color: '#0D1117' }}>
                {step === 'name' ? 'Connect WhatsApp' : step === 'qr' ? 'Scan QR Code' : 'Select Chats'}
              </div>
              <div style={{ fontSize: 11, color: '#64748B' }}>
                Step {step === 'name' ? '1' : step === 'qr' ? '2' : '3'} of 3
              </div>
            </div>
          </div>
          <button onClick={onClose} style={{ background: 'none', border: 'none', cursor: 'pointer', padding: 4 }}>
            <X size={18} color="#94A3B8" />
          </button>
        </div>

        {/* Body */}
        <div style={bodyStyle}>
          {/* ── Step 1: Name ── */}
          {step === 'name' && (
            <div style={{ display: 'flex', flexDirection: 'column', gap: 16 }}>
              <div>
                <label style={{ fontSize: 12, fontWeight: 600, color: '#1E293B', display: 'block', marginBottom: 6 }}>
                  Connector Name
                </label>
                <input
                  style={inputStyle}
                  value={name}
                  onChange={e => setName(e.target.value)}
                  placeholder="e.g. Operations WhatsApp"
                  autoFocus
                  onKeyDown={e => e.key === 'Enter' && handleCreate()}
                />
              </div>
              <div>
                <label style={{ fontSize: 12, fontWeight: 600, color: '#1E293B', display: 'block', marginBottom: 6 }}>
                  Description (optional)
                </label>
                <input
                  style={inputStyle}
                  value={description}
                  onChange={e => setDescription(e.target.value)}
                  placeholder="What chats will you monitor?"
                />
              </div>
              <div style={{
                padding: 12, borderRadius: 8, backgroundColor: '#F0FDF4', border: '1px solid #BBF7D0',
                fontSize: 11, color: '#166534', lineHeight: 1.6,
              }}>
                <strong>How it works:</strong> After creating the connector, you'll scan a QR code with your
                WhatsApp app (Settings &rarr; Linked Devices &rarr; Link a Device). This links your WhatsApp account
                to Nexus as a read-only listener. Messages from selected chats will flow into the platform
                as a data source for pipelines and agents.
              </div>
              <div style={{ display: 'flex', justifyContent: 'flex-end', gap: 8 }}>
                <button style={btnSecondary} onClick={onClose}>Cancel</button>
                <button
                  style={{ ...btnPrimary, opacity: !name.trim() || loading ? 0.5 : 1 }}
                  disabled={!name.trim() || loading}
                  onClick={handleCreate}
                >
                  {loading ? 'Creating...' : 'Continue'}
                </button>
              </div>
            </div>
          )}

          {/* ── Step 2: QR Code ── */}
          {step === 'qr' && (
            <div style={{ display: 'flex', flexDirection: 'column', alignItems: 'center', gap: 16 }}>
              <div style={{
                width: 280, height: 280, borderRadius: 12, border: '2px solid #E2E8F0',
                display: 'flex', alignItems: 'center', justifyContent: 'center',
                backgroundColor: '#F8FAFC',
              }}>
                {qrDataUrl ? (
                  <img src={qrDataUrl} alt="WhatsApp QR Code" style={{ width: 260, height: 260, borderRadius: 8 }} />
                ) : (
                  <div style={{ textAlign: 'center', color: '#94A3B8' }}>
                    <Loader2 size={32} style={{ animation: 'spin 1s linear infinite' }} />
                    <p style={{ fontSize: 12, marginTop: 8 }}>Generating QR code...</p>
                  </div>
                )}
              </div>
              <div style={{ textAlign: 'center' }}>
                <p style={{ fontSize: 13, fontWeight: 600, color: '#0D1117', margin: '0 0 4px' }}>
                  Scan with WhatsApp
                </p>
                <p style={{ fontSize: 11, color: '#64748B', margin: 0, lineHeight: 1.6 }}>
                  Open WhatsApp on your phone &rarr; Settings &rarr; Linked Devices &rarr; Link a Device
                </p>
              </div>
              <div style={{
                display: 'flex', alignItems: 'center', gap: 6,
                padding: '6px 14px', borderRadius: 20,
                backgroundColor: sessionStatus === 'connected' ? '#F0FDF4' : '#FFF7ED',
                border: `1px solid ${sessionStatus === 'connected' ? '#BBF7D0' : '#FED7AA'}`,
              }}>
                {sessionStatus === 'connected' ? (
                  <CheckCircle2 size={14} color="#16A34A" />
                ) : (
                  <QrCode size={14} color="#EA580C" />
                )}
                <span style={{
                  fontSize: 11, fontWeight: 600,
                  color: sessionStatus === 'connected' ? '#16A34A' : '#EA580C',
                }}>
                  {sessionStatus === 'connected'
                    ? `Connected as ${phoneNumber}`
                    : sessionStatus === 'qr_pending'
                    ? 'Waiting for scan...'
                    : 'Connecting...'}
                </span>
              </div>
            </div>
          )}

          {/* ── Step 3: Chat Selection ── */}
          {step === 'chats' && (
            <div style={{ display: 'flex', flexDirection: 'column', gap: 12 }}>
              <div style={{
                display: 'flex', alignItems: 'center', gap: 8,
                padding: '6px 12px', borderRadius: 20, backgroundColor: '#F0FDF4',
                border: '1px solid #BBF7D0', alignSelf: 'flex-start',
              }}>
                <CheckCircle2 size={14} color="#16A34A" />
                <span style={{ fontSize: 11, fontWeight: 600, color: '#16A34A' }}>
                  Connected as {phoneNumber}
                </span>
              </div>

              <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between' }}>
                <span style={{ fontSize: 12, fontWeight: 600, color: '#0D1117' }}>
                  {chats.length} chats found &middot; {monitoredCount} monitored
                </span>
                <div style={{ display: 'flex', gap: 6 }}>
                  <button style={btnSecondary} onClick={() => toggleAll(true)}>
                    <Eye size={12} style={{ marginRight: 4 }} />Monitor All
                  </button>
                  <button style={btnSecondary} onClick={() => toggleAll(false)}>
                    <EyeOff size={12} style={{ marginRight: 4 }} />None
                  </button>
                </div>
              </div>

              <div style={{ position: 'relative' }}>
                <Search size={14} style={{ position: 'absolute', left: 10, top: 9, color: '#94A3B8' }} />
                <input
                  style={{ ...inputStyle, paddingLeft: 30 }}
                  placeholder="Search chats..."
                  value={searchQuery}
                  onChange={e => setSearchQuery(e.target.value)}
                />
              </div>

              <div style={{
                maxHeight: 320, overflow: 'auto', display: 'flex', flexDirection: 'column', gap: 2,
                border: '1px solid #E2E8F0', borderRadius: 8,
              }}>
                {filteredChats.map(chat => (
                  <div
                    key={chat.jid}
                    style={{
                      display: 'flex', alignItems: 'center', gap: 10, padding: '10px 12px',
                      borderBottom: '1px solid #F1F5F9',
                      backgroundColor: chat.isMonitored ? '#F0FDF9' : '#FFFFFF',
                      cursor: 'pointer',
                    }}
                    onClick={() => toggleMonitor(chat.jid, !chat.isMonitored)}
                  >
                    <div style={{
                      width: 36, height: 36, borderRadius: 18, flexShrink: 0,
                      backgroundColor: chat.chatType === 'group' ? '#DBEAFE' : '#F3E8FF',
                      display: 'flex', alignItems: 'center', justifyContent: 'center',
                    }}>
                      {chat.chatType === 'group'
                        ? <Users size={16} color="#2563EB" />
                        : <MessageCircle size={16} color="#7C3AED" />}
                    </div>
                    <div style={{ flex: 1, minWidth: 0 }}>
                      <div style={{ fontSize: 12, fontWeight: 600, color: '#0D1117', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
                        {chat.name}
                      </div>
                      <div style={{ fontSize: 10, color: '#94A3B8' }}>
                        {chat.chatType === 'group' ? `${chat.participantCount} members` : 'Direct message'}
                        {chat.messageCount > 0 && ` · ${chat.messageCount} msgs`}
                      </div>
                    </div>
                    <div style={{
                      width: 36, height: 20, borderRadius: 10, padding: 2,
                      backgroundColor: chat.isMonitored ? '#25D366' : '#E2E8F0',
                      transition: 'background-color 0.15s ease',
                      cursor: 'pointer', flexShrink: 0,
                    }}>
                      <div style={{
                        width: 16, height: 16, borderRadius: 8, backgroundColor: '#FFFFFF',
                        transform: chat.isMonitored ? 'translateX(16px)' : 'translateX(0)',
                        transition: 'transform 0.15s ease',
                        boxShadow: '0 1px 3px rgba(0,0,0,0.2)',
                      }} />
                    </div>
                  </div>
                ))}
                {filteredChats.length === 0 && (
                  <div style={{ padding: 24, textAlign: 'center', color: '#94A3B8', fontSize: 12 }}>
                    {chats.length === 0 ? 'Discovering chats...' : 'No chats match your search'}
                  </div>
                )}
              </div>

              <div style={{ display: 'flex', justifyContent: 'flex-end', paddingTop: 8 }}>
                <button style={btnPrimary} onClick={handleDone}>
                  Done — {monitoredCount} chat{monitoredCount !== 1 ? 's' : ''} monitored
                </button>
              </div>
            </div>
          )}
        </div>
      </div>

      <style>{`
        @keyframes spin { from { transform: rotate(0deg); } to { transform: rotate(360deg); } }
      `}</style>
    </div>
  );
};
