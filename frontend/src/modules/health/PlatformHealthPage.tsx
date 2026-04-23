import React, { useEffect, useState, useCallback } from 'react';
import { RefreshCw, CheckCircle, XCircle, Clock, Activity } from 'lucide-react';

interface ServiceDef {
  name: string;
  port: number;
  group: string;
}

const SERVICES: ServiceDef[] = [
  // Core
  { name: 'Auth Service',        port: 8011, group: 'Core' },
  { name: 'Ontology Service',    port: 8004, group: 'Core' },
  { name: 'Event Log',           port: 8005, group: 'Core' },
  { name: 'Audit Service',       port: 8006, group: 'Core' },
  // Data
  { name: 'Connector Service',   port: 8001, group: 'Data' },
  { name: 'Pipeline Service',    port: 8002, group: 'Data' },
  { name: 'Schema Registry',     port: 8007, group: 'Data' },
  { name: 'Analytics Service',   port: 8015, group: 'Data' },
  { name: 'Lineage Service',     port: 8017, group: 'Data' },
  // Intelligence
  { name: 'Inference (AI)',      port: 8003, group: 'Intelligence' },
  { name: 'Agent Service',       port: 8013, group: 'Intelligence' },
  { name: 'Logic Service',       port: 8012, group: 'Intelligence' },
  { name: 'Correlation Engine',  port: 8008, group: 'Intelligence' },
  // Operations
  { name: 'Alert Engine',        port: 8010, group: 'Operations' },
  { name: 'Process Engine',      port: 8009, group: 'Operations' },
  { name: 'Utility Service',     port: 8014, group: 'Operations' },
  { name: 'Eval Service',        port: 8016, group: 'Operations' },
  // Platform
  { name: 'Search Service',      port: 8018, group: 'Platform' },
  { name: 'Data Quality',        port: 8019, group: 'Platform' },
];

type ServiceStatus = 'checking' | 'healthy' | 'degraded' | 'down';

interface ServiceState {
  name: string;
  port: number;
  group: string;
  status: ServiceStatus;
  latency: number | null;  // ms
  lastChecked: Date | null;
  error?: string;
}

async function checkService(svc: ServiceDef): Promise<ServiceState> {
  const start = performance.now();
  try {
    const host = window.location.hostname || 'localhost';
    const res = await fetch(`${window.location.protocol}//${host}:${svc.port}/health`, {
      signal: AbortSignal.timeout(4000),
    });
    const latency = Math.round(performance.now() - start);
    if (res.ok) {
      return { ...svc, status: latency > 2000 ? 'degraded' : 'healthy', latency, lastChecked: new Date() };
    }
    return { ...svc, status: 'degraded', latency, lastChecked: new Date(), error: `HTTP ${res.status}` };
  } catch (e: any) {
    return { ...svc, status: 'down', latency: null, lastChecked: new Date(), error: e?.message || 'Unreachable' };
  }
}

const STATUS_META: Record<ServiceStatus, { icon: React.ReactNode; label: string; color: string; bg: string }> = {
  checking: { icon: <Clock size={13} />,       label: 'Checking',  color: '#64748B', bg: '#F1F5F9' },
  healthy:  { icon: <CheckCircle size={13} />, label: 'Healthy',   color: '#16A34A', bg: '#DCFCE7' },
  degraded: { icon: <Activity size={13} />,    label: 'Degraded',  color: '#D97706', bg: '#FEF3C7' },
  down:     { icon: <XCircle size={13} />,     label: 'Down',      color: '#DC2626', bg: '#FEE2E2' },
};

export const PlatformHealthPage: React.FC = () => {
  const [services, setServices] = useState<ServiceState[]>(
    SERVICES.map(s => ({ ...s, status: 'checking' as ServiceStatus, latency: null, lastChecked: null }))
  );
  const [lastRefresh, setLastRefresh] = useState<Date | null>(null);
  const [checking, setChecking] = useState(false);

  const runChecks = useCallback(async () => {
    setChecking(true);
    // Set all to checking
    setServices(prev => prev.map(s => ({ ...s, status: 'checking' as ServiceStatus })));
    // Fan out all checks in parallel
    const results = await Promise.all(SERVICES.map(checkService));
    setServices(results);
    setLastRefresh(new Date());
    setChecking(false);
  }, []);

  // Run on mount and every 30s
  useEffect(() => {
    runChecks();
    const interval = setInterval(runChecks, 30000);
    return () => clearInterval(interval);
  }, [runChecks]);

  // Summary counts
  const healthy = services.filter(s => s.status === 'healthy').length;
  const degraded = services.filter(s => s.status === 'degraded').length;
  const down = services.filter(s => s.status === 'down').length;
  const checking_ = services.filter(s => s.status === 'checking').length;

  // Overall status
  const overallStatus: ServiceStatus = down > 0 ? 'down' : degraded > 0 ? 'degraded' : checking_ > 0 ? 'checking' : 'healthy';
  const overallMeta = STATUS_META[overallStatus];

  // Group services
  const groups = ['Core', 'Data', 'Intelligence', 'Operations', 'Platform'];

  return (
    <div style={{ display: 'flex', flexDirection: 'column', height: '100%', backgroundColor: '#F8FAFC', overflow: 'hidden' }}>
      {/* Header */}
      <div style={{ padding: '20px 24px 16px', borderBottom: '1px solid #E2E8F0', backgroundColor: '#FFFFFF', flexShrink: 0 }}>
        <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginBottom: 12 }}>
          <div>
            <h1 style={{ fontSize: 18, fontWeight: 600, color: '#0D1117', margin: 0 }}>Platform Health</h1>
            <p style={{ fontSize: 12, color: '#64748B', margin: '2px 0 0' }}>
              {lastRefresh ? `Last checked ${lastRefresh.toLocaleTimeString()}` : 'Checking services...'}
              {' · '}Auto-refreshes every 30s
            </p>
          </div>
          <div style={{ display: 'flex', alignItems: 'center', gap: 12 }}>
            {/* Overall status badge */}
            <div style={{ display: 'flex', alignItems: 'center', gap: 6, padding: '6px 12px', borderRadius: 20, backgroundColor: overallMeta.bg, color: overallMeta.color, fontSize: 13, fontWeight: 600 }}>
              {overallMeta.icon}
              {overallStatus === 'healthy' ? 'All Systems Operational' : overallStatus === 'degraded' ? 'Partial Outage' : overallStatus === 'down' ? 'Service Disruption' : 'Checking...'}
            </div>
            <button
              onClick={runChecks}
              disabled={checking}
              style={{ display: 'flex', alignItems: 'center', gap: 5, height: 32, padding: '0 12px', border: '1px solid #E2E8F0', borderRadius: 5, backgroundColor: '#fff', cursor: 'pointer', fontSize: 12, color: '#374151', opacity: checking ? 0.6 : 1 }}
            >
              <RefreshCw size={12} style={{ animation: checking ? 'spin 1s linear infinite' : 'none' }} />
              Refresh
            </button>
          </div>
        </div>

        {/* Summary bar */}
        <div style={{ display: 'flex', gap: 16 }}>
          {[
            { label: 'Healthy', count: healthy, color: '#16A34A', bg: '#DCFCE7' },
            { label: 'Degraded', count: degraded, color: '#D97706', bg: '#FEF3C7' },
            { label: 'Down', count: down, color: '#DC2626', bg: '#FEE2E2' },
            { label: 'Total', count: services.length, color: '#374151', bg: '#F1F5F9' },
          ].map(item => (
            <div key={item.label} style={{ display: 'flex', alignItems: 'center', gap: 6, padding: '4px 10px', borderRadius: 5, backgroundColor: item.bg }}>
              <span style={{ fontSize: 18, fontWeight: 700, color: item.color }}>{item.count}</span>
              <span style={{ fontSize: 11, color: item.color, fontWeight: 500 }}>{item.label}</span>
            </div>
          ))}
        </div>
      </div>

      {/* Service groups */}
      <div style={{ flex: 1, overflowY: 'auto', padding: 24 }}>
        <style>{`@keyframes spin { from{transform:rotate(0deg)} to{transform:rotate(360deg)} }`}</style>
        <div style={{ display: 'flex', flexDirection: 'column', gap: 24 }}>
          {groups.map(group => {
            const groupServices = services.filter(s => s.group === group);
            return (
              <div key={group}>
                <h2 style={{ fontSize: 11, fontWeight: 600, color: '#64748B', textTransform: 'uppercase', letterSpacing: '0.06em', marginBottom: 10 }}>
                  {group}
                </h2>
                <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fill, minmax(260px, 1fr))', gap: 10 }}>
                  {groupServices.map(svc => {
                    const meta = STATUS_META[svc.status];
                    return (
                      <div
                        key={svc.name}
                        style={{
                          backgroundColor: '#FFFFFF', border: '1px solid #E2E8F0',
                          borderRadius: 8, padding: '12px 14px',
                          borderLeft: `3px solid ${meta.color}`,
                        }}
                      >
                        <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginBottom: 6 }}>
                          <span style={{ fontSize: 13, fontWeight: 500, color: '#0D1117' }}>{svc.name}</span>
                          <div style={{ display: 'flex', alignItems: 'center', gap: 4, padding: '2px 7px', borderRadius: 10, backgroundColor: meta.bg, color: meta.color, fontSize: 11, fontWeight: 500 }}>
                            {meta.icon}
                            {meta.label}
                          </div>
                        </div>
                        <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between' }}>
                          <span style={{ fontSize: 11, color: '#94A3B8' }}>:{svc.port}</span>
                          <span style={{ fontSize: 11, color: svc.latency ? (svc.latency < 200 ? '#16A34A' : svc.latency < 1000 ? '#D97706' : '#DC2626') : '#94A3B8' }}>
                            {svc.status === 'checking' ? '...' : svc.latency !== null ? `${svc.latency}ms` : svc.error || 'Timeout'}
                          </span>
                        </div>
                      </div>
                    );
                  })}
                </div>
              </div>
            );
          })}
        </div>
      </div>
    </div>
  );
};

export default PlatformHealthPage;
