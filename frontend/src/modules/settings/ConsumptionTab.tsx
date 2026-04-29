import React, { useEffect, useMemo, useState } from 'react';
import {
  Gauge, Users, Bot, Database, FileText, Workflow, HardDrive, Activity,
  AlertTriangle, CheckCircle2, TrendingUp, ArrowUpRight, Calendar, Clock, Zap,
  RefreshCw,
} from 'lucide-react';
import { getTenantId, getAccessToken } from '../../store/authStore';

const ADMIN_API = import.meta.env.VITE_ADMIN_SERVICE_URL || 'http://localhost:8022';

const C = {
  bg: '#F8FAFC', panel: '#FFFFFF',
  border: '#E2E8F0', accent: '#7C3AED', accentDim: '#EDE9FE',
  text: '#0D1117', muted: '#64748B', dim: '#94A3B8',
  success: '#059669', successDim: '#ECFDF5',
  warn: '#B45309', warnDim: '#FEF3C7',
  error: '#DC2626', errorDim: '#FEE2E2',
  ink: '#1A1A1F',
};

// ── Bucket tier definitions (compute buckets from the hosting proposal) ────

type TierId = 'S' | 'M' | 'L' | 'XL' | 'XXL';

interface BucketTier {
  id: TierId;
  label: string;
  annualUSD: number;
  monthlyUSD: number;
  tokensPerDayM: number;     // millions
  tokensPerMonthM: number;
  concurrentUsers: number;
  totalUsers: number | string;
  agents: number | string;
  invocationsPerDay: number;
  ontologyRecords: number;
  ragGB: number;
  pipelinesParallel: number | string;
  dbConnections: number;
  storageGB: number;
  retentionAuditDays: number | string;
  models: string;
  sla: string;
  recommended?: boolean;
}

const BUCKETS: BucketTier[] = [
  { id: 'S',   label: 'Pilot',      annualUSD: 32_000,    monthlyUSD: 2_667,   tokensPerDayM: 2,   tokensPerMonthM: 60,    concurrentUsers: 25,    totalUsers: 75,         agents: 3,   invocationsPerDay: 5_000,    ontologyRecords: 100_000,    ragGB: 2,    pipelinesParallel: 5,           dbConnections: 100,    storageGB: 50,        retentionAuditDays: 180,   models: 'Haiku only',          sla: '99.0%',  recommended: true },
  { id: 'M',   label: 'Growth',     annualUSD: 64_000,    monthlyUSD: 5_333,   tokensPerDayM: 10,  tokensPerMonthM: 300,   concurrentUsers: 100,   totalUsers: 400,        agents: 10,  invocationsPerDay: 50_000,   ontologyRecords: 500_000,    ragGB: 10,   pipelinesParallel: 20,          dbConnections: 500,    storageGB: 500,       retentionAuditDays: 365,   models: 'Haiku, Sonnet (+ Opus on-demand)', sla: '99.5%' },
  { id: 'L',   label: 'Scale',      annualUSD: 127_000,   monthlyUSD: 10_583,  tokensPerDayM: 25,  tokensPerMonthM: 750,   concurrentUsers: 250,   totalUsers: 1_500,      agents: 30,  invocationsPerDay: 150_000,  ontologyRecords: 2_000_000,  ragGB: 30,   pipelinesParallel: 60,          dbConnections: 1_500,  storageGB: 2_000,     retentionAuditDays: 365,   models: '+ Opus, DeepSeek, Mistral, Nova',  sla: '99.9%' },
  { id: 'XL',  label: 'Production', annualUSD: 318_000,   monthlyUSD: 26_500,  tokensPerDayM: 80,  tokensPerMonthM: 2_400, concurrentUsers: 600,   totalUsers: 5_000,      agents: 80,  invocationsPerDay: 500_000,  ontologyRecords: 10_000_000, ragGB: 100,  pipelinesParallel: 200,         dbConnections: 5_000,  storageGB: 10_000,    retentionAuditDays: '3 yrs', models: 'All catalog + Provisioned',     sla: '99.95%' },
  { id: 'XXL', label: 'Enterprise', annualUSD: 3_493_000, monthlyUSD: 291_083, tokensPerDayM: 800, tokensPerMonthM: 24_000,concurrentUsers: 5_000, totalUsers: 'unlimited', agents: '500+', invocationsPerDay: 5_000_000, ontologyRecords: 100_000_000, ragGB: 1_000, pipelinesParallel: 'unlimited', dbConnections: 20_000, storageGB: 100_000,   retentionAuditDays: '7 yrs', models: 'Everything + dedicated PT',     sla: '99.99%' },
];

// Tier comes from the backend (/admin/me/consumption.bucket_tier). New tenants
// default to 'S'. Superadmin can change tier via SuperAdmin → Tenants.
// Metrics not yet measured server-side are flagged ESTIMATED in the UI rather
// than silently mocked.

interface LiveUsage {
  bucket_tier: TierId;
  tokens_today: number;
  tokens_month: number;
  invocations_today: number;
  invocations_month: number;
  daily_history: { day: string; tokens: number; calls: number }[];
  ontology_records: number;
  ontology_records_breakdown?: { object_records: number; events: number };
  agents_total: number;
  agents_active: number;
  pipelines_total: number;
  pipelines_running: number;
  storage_bytes: number;
  storage_breakdown?: { object_records_bytes: number; events_bytes: number };
  concurrent_users: number;
  daily_active_users: number;
  rag_corpus_bytes: number | null;   // null = not configured
  db_connections_process: number;
}

// Fallback values used only while loading or if the endpoint is unreachable.
// Not used for display once the live response arrives.
const FALLBACK_USAGE: LiveUsage = {
  bucket_tier: 'S',
  tokens_today: 0, tokens_month: 0, invocations_today: 0, invocations_month: 0,
  daily_history: [],
  ontology_records: 0, agents_total: 0, agents_active: 0,
  pipelines_total: 0, pipelines_running: 0,
  storage_bytes: 0, concurrent_users: 0, daily_active_users: 0,
  rag_corpus_bytes: null, db_connections_process: 0,
};

// ── Helpers ────────────────────────────────────────────────────────────────

const fmt = (n: number) => new Intl.NumberFormat('en-US').format(n);
const fmtMoney = (n: number) => '$' + new Intl.NumberFormat('en-US', { maximumFractionDigits: 0 }).format(n);
const fmtCompact = (n: number): string => {
  if (n >= 1_000_000) return `${(n / 1_000_000).toFixed(1)}M`;
  if (n >= 1_000) return `${(n / 1_000).toFixed(0)}K`;
  return String(n);
};

// ── Components ─────────────────────────────────────────────────────────────

const ProgressBar: React.FC<{ pct: number; color: string }> = ({ pct, color }) => (
  <div style={{
    width: '100%', height: 8, backgroundColor: C.bg,
    borderRadius: 4, overflow: 'hidden', border: `1px solid ${C.border}`,
  }}>
    <div style={{
      width: `${Math.min(pct, 100)}%`, height: '100%',
      backgroundColor: color, transition: 'width 250ms',
    }} />
  </div>
);

const UsageMetric: React.FC<{
  icon: React.ReactNode;
  label: string;
  current: number;
  limit: number | string;
  unit?: string;
  formatter?: (n: number) => string;
  source?: 'live' | 'estimated';
  hoverDetail?: string;
  subline?: string;
}> = ({ icon, label, current, limit, unit, formatter = fmt, source = 'live', hoverDetail, subline }) => {
  const numericLimit = typeof limit === 'number' ? limit : null;
  const pct = numericLimit ? (current / numericLimit) * 100 : 0;
  const color = pct < 60 ? C.success : pct < 85 ? C.warn : C.error;

  return (
    <div title={hoverDetail} style={{
      padding: '14px 16px', backgroundColor: C.panel,
      border: `1px solid ${C.border}`, borderRadius: 6,
      position: 'relative',
    }}>
      <span style={{
        position: 'absolute', top: 8, right: 8,
        fontSize: 8.5, fontWeight: 700, letterSpacing: '0.06em',
        padding: '2px 5px', borderRadius: 3,
        backgroundColor: source === 'live' ? C.successDim : '#FEF3C7',
        color: source === 'live' ? C.success : '#92400E',
      }}>
        {source === 'live' ? 'LIVE' : 'EST'}
      </span>
      <div style={{ display: 'flex', alignItems: 'center', gap: 6, color: C.muted, marginBottom: 8 }}>
        {icon}
        <span style={{ fontSize: 11, fontWeight: 600, letterSpacing: '0.04em' }}>{label.toUpperCase()}</span>
      </div>
      <div style={{ display: 'flex', alignItems: 'baseline', gap: 6, marginBottom: 8 }}>
        <span style={{ fontSize: 22, fontWeight: 700, color: C.text, fontFamily: 'monospace' }}>
          {formatter(current)}{unit}
        </span>
        <span style={{ fontSize: 12, color: C.dim, fontFamily: 'monospace' }}>
          / {numericLimit ? formatter(numericLimit) : limit}{numericLimit ? unit : ''}
        </span>
      </div>
      {numericLimit ? (
        <>
          <ProgressBar pct={pct} color={color} />
          <div style={{ display: 'flex', justifyContent: 'space-between', marginTop: 6 }}>
            <span style={{ fontSize: 10.5, color: C.muted, fontWeight: 500 }}>{pct.toFixed(0)}% used</span>
            <span style={{ fontSize: 10.5, color }}>
              {pct >= 85 ? 'Approaching limit' : pct >= 60 ? 'Healthy' : 'Plenty of room'}
            </span>
          </div>
        </>
      ) : (
        <div style={{ fontSize: 10.5, color: C.muted, fontStyle: 'italic' }}>No upper limit</div>
      )}
      {subline && (
        <div style={{ fontSize: 10, color: C.dim, marginTop: 4, fontFamily: 'monospace' }}>{subline}</div>
      )}
    </div>
  );
};

// Shown when a feature isn't deployed/applicable for this tenant — honest "—" instead of fake.
const UsageMetricNotConfigured: React.FC<{
  icon: React.ReactNode;
  label: string;
  reason?: string;
}> = ({ icon, label, reason }) => (
  <div style={{
    padding: '14px 16px', backgroundColor: C.panel,
    border: `1px dashed ${C.border}`, borderRadius: 6,
    position: 'relative',
  }}>
    <span style={{
      position: 'absolute', top: 8, right: 8,
      fontSize: 8.5, fontWeight: 700, letterSpacing: '0.06em',
      padding: '2px 5px', borderRadius: 3,
      backgroundColor: '#F1F5F9', color: C.muted,
    }}>
      N/A
    </span>
    <div style={{ display: 'flex', alignItems: 'center', gap: 6, color: C.muted, marginBottom: 8 }}>
      {icon}
      <span style={{ fontSize: 11, fontWeight: 600, letterSpacing: '0.04em' }}>{label.toUpperCase()}</span>
    </div>
    <div style={{ fontSize: 22, fontWeight: 700, color: C.dim, fontFamily: 'monospace' }}>—</div>
    <div style={{ fontSize: 10.5, color: C.dim, fontStyle: 'italic', marginTop: 6 }}>
      {reason || 'Not configured'}
    </div>
  </div>
);

// Shown for measurements that are real but not tenant-scoped (e.g. process-wide DB conns).
const UsageMetricInfo: React.FC<{
  icon: React.ReactNode;
  label: string;
  current: number;
  note: string;
}> = ({ icon, label, current, note }) => (
  <div style={{
    padding: '14px 16px', backgroundColor: C.panel,
    border: `1px solid ${C.border}`, borderRadius: 6,
    position: 'relative',
  }}>
    <span style={{
      position: 'absolute', top: 8, right: 8,
      fontSize: 8.5, fontWeight: 700, letterSpacing: '0.06em',
      padding: '2px 5px', borderRadius: 3,
      backgroundColor: '#DBEAFE', color: '#1E40AF',
    }}>
      INFO
    </span>
    <div style={{ display: 'flex', alignItems: 'center', gap: 6, color: C.muted, marginBottom: 8 }}>
      {icon}
      <span style={{ fontSize: 11, fontWeight: 600, letterSpacing: '0.04em' }}>{label.toUpperCase()}</span>
    </div>
    <div style={{ fontSize: 22, fontWeight: 700, color: C.text, fontFamily: 'monospace' }}>{current}</div>
    <div style={{ fontSize: 10.5, color: C.muted, fontStyle: 'italic', marginTop: 6 }}>{note}</div>
  </div>
);

// Inline 30-day sparkline / bar chart
const TokenChart: React.FC<{ data: number[]; limit: number }> = ({ data, limit }) => {
  const max = Math.max(limit, ...data) * 1.05;
  const W = 700, H = 160, P = 24;
  const innerW = W - P * 2, innerH = H - P * 2;
  const barW = innerW / data.length - 2;

  const xy = (i: number, v: number) => ({
    x: P + i * (innerW / data.length) + 1,
    y: P + innerH - (v / max) * innerH,
    h: (v / max) * innerH,
  });

  return (
    <div style={{ width: '100%', overflow: 'hidden' }}>
      <svg viewBox={`0 0 ${W} ${H}`} width="100%" height={H} style={{ display: 'block' }}>
        {/* Limit line */}
        <line
          x1={P} x2={W - P}
          y1={P + innerH - (limit / max) * innerH}
          y2={P + innerH - (limit / max) * innerH}
          stroke={C.error} strokeWidth={1} strokeDasharray="4 3"
        />
        <text
          x={W - P} y={P + innerH - (limit / max) * innerH - 4}
          textAnchor="end" fontSize={10} fill={C.error} fontFamily="monospace"
        >
          Daily limit · {limit}M
        </text>

        {/* Bars */}
        {data.map((v, i) => {
          const { x, y, h } = xy(i, v);
          const overLimit = v > limit;
          return (
            <rect
              key={i}
              x={x} y={y} width={barW} height={h} rx={2}
              fill={overLimit ? C.error : i === data.length - 1 ? C.accent : '#A78BFA'}
            />
          );
        })}

        {/* X labels (every 7 days) */}
        {data.map((_, i) => {
          if (i % 7 !== 0 && i !== data.length - 1) return null;
          const { x } = xy(i, 0);
          return (
            <text
              key={i}
              x={x + barW / 2} y={H - 6}
              textAnchor="middle" fontSize={9} fill={C.dim} fontFamily="monospace"
            >
              D-{data.length - i - 1}
            </text>
          );
        })}
      </svg>
    </div>
  );
};

// ── Saturation analysis ────────────────────────────────────────────────────

interface SaturationRow {
  resource: string;
  utilization: number;
  status: 'healthy' | 'watch' | 'critical';
  signal: string;
  remediation: string;
}

const computeSaturation = (usage: LiveUsage): SaturationRow[] => {
  const tier = BUCKETS.find(b => b.id === usage.bucket_tier) || BUCKETS[0];
  const tokensMonthM = usage.tokens_month / 1_000_000;
  const dayOfMonth = Math.max(1, new Date().getDate());
  const projectedMonthlyTokens = tokensMonthM / dayOfMonth * 30;
  const tokenPct = (projectedMonthlyTokens / tier.tokensPerMonthM) * 100;
  const agentPct = (usage.agents_active / (tier.agents as number)) * 100;

  const storageMB = usage.storage_bytes / 1_048_576;
  const storageGBLimit = tier.storageGB;
  const storagePct = (storageMB / 1024) / storageGBLimit * 100;
  const dbProcessPct = usage.db_connections_process;  // raw count; treat as informational, no fixed limit

  return [
    { resource: 'Tokens (bucket)',    utilization: tokenPct, status: tokenPct > 85 ? 'critical' : tokenPct > 60 ? 'watch' : 'healthy', signal: `Projected EOM: ${projectedMonthlyTokens.toFixed(0)}M / ${tier.tokensPerMonthM}M`, remediation: 'Activate aggressive caching · route more to Haiku · upgrade tier' },
    { resource: 'Storage (records)',  utilization: storagePct, status: storagePct > 85 ? 'critical' : storagePct > 60 ? 'watch' : 'healthy', signal: `${storageMB.toFixed(2)} MB of object_records + events payload · ${storageGBLimit} GB allowance`, remediation: 'Archive cold partitions · enable compression' },
    { resource: 'Database (process)', utilization: Math.min(dbProcessPct, 100), status: dbProcessPct > 70 ? 'watch' : 'healthy', signal: `${usage.db_connections_process} active connections (process-wide via pg_stat_activity)`, remediation: 'Add read replica · pgbouncer pool' },
    { resource: 'Vector store / RAG', utilization: 0, status: 'healthy', signal: usage.rag_corpus_bytes === null ? 'Not configured on this deployment' : `${(usage.rag_corpus_bytes / 1_073_741_824).toFixed(2)} GB`, remediation: usage.rag_corpus_bytes === null ? '— no action needed' : 'Increase OCU · pre-filter queries' },
    { resource: 'Concurrent users',   utilization: (usage.concurrent_users / (tier.concurrentUsers as number)) * 100, status: 'healthy', signal: `${usage.concurrent_users} active in last 60s · ${usage.daily_active_users} today (from audit_events)`, remediation: 'Scale app tier if sustained > 70%' },
    { resource: 'Agent runtime',      utilization: agentPct, status: agentPct > 70 ? 'watch' : 'healthy', signal: `${usage.agents_active}/${tier.agents} agents enabled · ${usage.pipelines_running} pipelines running`, remediation: 'Larger pool · stateless mode' },
  ];
};

const SaturationTable: React.FC<{ usage: LiveUsage }> = ({ usage }) => {
  const rows = computeSaturation(usage);

  const statusUI = {
    healthy:  { bg: C.successDim, fg: C.success, label: 'HEALTHY',  icon: <CheckCircle2 size={11} /> },
    watch:    { bg: C.warnDim,    fg: C.warn,    label: 'WATCH',    icon: <Activity size={11} /> },
    critical: { bg: C.errorDim,   fg: C.error,   label: 'CRITICAL', icon: <AlertTriangle size={11} /> },
  };

  return (
    <div style={{ border: `1px solid ${C.border}`, borderRadius: 6, overflow: 'hidden' }}>
      <table style={{ width: '100%', borderCollapse: 'collapse', fontSize: 12 }}>
        <thead>
          <tr style={{ backgroundColor: C.ink }}>
            <th style={{ padding: '9px 12px', textAlign: 'left',  color: '#FAFAF7', fontSize: 10, fontWeight: 600, letterSpacing: '0.06em' }}>RECURSO</th>
            <th style={{ padding: '9px 12px', textAlign: 'left',  color: '#FAFAF7', fontSize: 10, fontWeight: 600, letterSpacing: '0.06em', width: 220 }}>UTILIZACIÓN</th>
            <th style={{ padding: '9px 12px', textAlign: 'left',  color: '#FAFAF7', fontSize: 10, fontWeight: 600, letterSpacing: '0.06em' }}>SEÑAL</th>
            <th style={{ padding: '9px 12px', textAlign: 'left',  color: '#FAFAF7', fontSize: 10, fontWeight: 600, letterSpacing: '0.06em' }}>REMEDIACIÓN</th>
          </tr>
        </thead>
        <tbody>
          {rows.map((row, i) => {
            const ui = statusUI[row.status];
            const barColor = row.status === 'healthy' ? C.success : row.status === 'watch' ? C.warn : C.error;
            return (
              <tr key={row.resource} style={{ borderTop: i ? `1px solid ${C.border}` : undefined, backgroundColor: i % 2 ? C.bg : C.panel }}>
                <td style={{ padding: '10px 12px', color: C.text, fontWeight: 500 }}>
                  <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
                    <span style={{
                      display: 'inline-flex', alignItems: 'center', gap: 4,
                      fontSize: 9, fontWeight: 700, letterSpacing: '0.04em',
                      padding: '2px 6px', borderRadius: 3,
                      backgroundColor: ui.bg, color: ui.fg,
                    }}>
                      {ui.icon}
                      {ui.label}
                    </span>
                    {row.resource}
                  </div>
                </td>
                <td style={{ padding: '10px 12px' }}>
                  <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
                    <div style={{ flex: 1 }}>
                      <ProgressBar pct={row.utilization} color={barColor} />
                    </div>
                    <span style={{ fontSize: 11, color: C.muted, fontFamily: 'monospace', minWidth: 36, textAlign: 'right' }}>{row.utilization.toFixed(0)}%</span>
                  </div>
                </td>
                <td style={{ padding: '10px 12px', color: C.muted, fontSize: 11.5 }}>{row.signal}</td>
                <td style={{ padding: '10px 12px', color: C.muted, fontSize: 11.5, fontStyle: 'italic' }}>{row.remediation}</td>
              </tr>
            );
          })}
        </tbody>
      </table>
    </div>
  );
};

// ── Tier comparison table ──────────────────────────────────────────────────

const TierComparison: React.FC<{ current: TierId; onChooseUpgrade: (t: TierId) => void }> = ({ current, onChooseUpgrade }) => {
  return (
    <div style={{ border: `1px solid ${C.border}`, borderRadius: 6, overflow: 'auto' }}>
      <table style={{ width: '100%', borderCollapse: 'collapse', fontSize: 11.5, minWidth: 720 }}>
        <thead>
          <tr style={{ backgroundColor: C.ink }}>
            <th style={{ padding: '9px 10px', textAlign: 'left', color: '#FAFAF7', fontSize: 10, fontWeight: 600, letterSpacing: '0.06em' }}></th>
            {BUCKETS.map(b => (
              <th key={b.id} style={{
                padding: '9px 10px', textAlign: 'center',
                color: b.id === current ? '#FBBF24' : '#FAFAF7',
                fontSize: 10, fontWeight: 700, letterSpacing: '0.06em',
                backgroundColor: b.id === current ? '#3B2A0A' : undefined,
              }}>
                {b.id}{b.recommended && ' ★'}{b.id === current ? ' · CURRENT' : ''}
              </th>
            ))}
          </tr>
        </thead>
        <tbody>
          {[
            { label: 'Inversión anual',     getter: (b: BucketTier) => fmtMoney(b.annualUSD)   + (b.annualUSD >= 1_000_000 ? '' : '') },
            { label: 'Mensual',              getter: (b: BucketTier) => fmtMoney(b.monthlyUSD) },
            { label: 'Tokens / día',         getter: (b: BucketTier) => `${b.tokensPerDayM} M` },
            { label: 'Tokens / mes',         getter: (b: BucketTier) => `${b.tokensPerMonthM >= 1000 ? (b.tokensPerMonthM / 1000) + ' B' : b.tokensPerMonthM + ' M'}` },
            { label: 'Concurrent users',     getter: (b: BucketTier) => fmt(b.concurrentUsers) },
            { label: 'Total users',          getter: (b: BucketTier) => typeof b.totalUsers === 'number' ? `~${fmt(b.totalUsers)}` : String(b.totalUsers) },
            { label: 'Agentes',              getter: (b: BucketTier) => String(b.agents) },
            { label: 'Records ontología',    getter: (b: BucketTier) => fmtCompact(b.ontologyRecords) },
            { label: 'Corpus RAG',           getter: (b: BucketTier) => `${b.ragGB} GB` },
            { label: 'Pipelines paralelos',  getter: (b: BucketTier) => String(b.pipelinesParallel) },
            { label: 'Storage',              getter: (b: BucketTier) => b.storageGB >= 1000 ? `${b.storageGB / 1000} TB` : `${b.storageGB} GB` },
            { label: 'Modelos',              getter: (b: BucketTier) => b.models },
            { label: 'SLA',                  getter: (b: BucketTier) => b.sla },
          ].map((row, i) => (
            <tr key={row.label} style={{ borderTop: `1px solid ${C.border}`, backgroundColor: i % 2 ? C.bg : C.panel }}>
              <td style={{ padding: '7px 10px', color: C.text, fontWeight: 500 }}>{row.label}</td>
              {BUCKETS.map(b => (
                <td key={b.id} style={{
                  padding: '7px 10px', textAlign: 'center',
                  color: b.id === current ? C.accent : C.muted,
                  fontFamily: 'monospace', fontSize: 11,
                  backgroundColor: b.id === current ? C.accentDim : undefined,
                  fontWeight: b.id === current ? 600 : 400,
                }}>
                  {row.getter(b)}
                </td>
              ))}
            </tr>
          ))}
          <tr style={{ borderTop: `1px solid ${C.border}`, backgroundColor: C.bg }}>
            <td style={{ padding: '10px' }}></td>
            {BUCKETS.map(b => {
              if (b.id === current) {
                return <td key={b.id} style={{ padding: '10px', textAlign: 'center', backgroundColor: C.accentDim }}>
                  <span style={{ fontSize: 10, fontWeight: 700, color: C.accent }}>YOU ARE HERE</span>
                </td>;
              }
              const currentIdx = BUCKETS.findIndex(x => x.id === current);
              const targetIdx = BUCKETS.findIndex(x => x.id === b.id);
              const isUpgrade = targetIdx > currentIdx;
              return (
                <td key={b.id} style={{ padding: '10px', textAlign: 'center' }}>
                  <button
                    onClick={() => onChooseUpgrade(b.id)}
                    style={{
                      padding: '4px 10px', fontSize: 10, fontWeight: 600,
                      borderRadius: 3, cursor: 'pointer',
                      backgroundColor: isUpgrade ? C.accent : C.panel,
                      color: isUpgrade ? '#FFF' : C.dim,
                      border: `1px solid ${isUpgrade ? C.accent : C.border}`,
                    }}
                  >
                    {isUpgrade ? 'UPGRADE' : 'DOWNGRADE'}
                  </button>
                </td>
              );
            })}
          </tr>
        </tbody>
      </table>
    </div>
  );
};

// ── Main tab ───────────────────────────────────────────────────────────────

export const ConsumptionTab: React.FC = () => {
  const [showComparison, setShowComparison] = useState(false);
  const [upgradeRequest, setUpgradeRequest] = useState<TierId | null>(null);
  const [usage, setUsage] = useState<LiveUsage>(FALLBACK_USAGE);
  const [loading, setLoading] = useState(true);
  const [fetchError, setFetchError] = useState<string | null>(null);
  const [refreshKey, setRefreshKey] = useState(0);

  useEffect(() => {
    let cancelled = false;
    const load = async () => {
      setLoading(true);
      setFetchError(null);
      try {
        const token = getAccessToken();
        const r = await fetch(`${ADMIN_API}/admin/me/consumption`, {
          headers: {
            'x-tenant-id': getTenantId(),
            ...(token ? { Authorization: `Bearer ${token}` } : {}),
          },
        });
        if (!r.ok) throw new Error(`HTTP ${r.status}`);
        const data: LiveUsage = await r.json();
        if (!cancelled) setUsage(data);
      } catch (e) {
        if (!cancelled) setFetchError(e instanceof Error ? e.message : 'Failed to load');
      } finally {
        if (!cancelled) setLoading(false);
      }
    };
    load();
    return () => { cancelled = true; };
  }, [refreshKey]);

  const currentTier = usage.bucket_tier;
  const tier = BUCKETS.find(b => b.id === currentTier) || BUCKETS[0];

  // Derived live values
  const tokensTodayM   = usage.tokens_today / 1_000_000;
  const tokensMonthM   = usage.tokens_month / 1_000_000;
  const dayOfMonth     = Math.max(1, new Date().getDate());

  // Build a 30-day series aligned to today (zero-fill missing days)
  const tokenHistoryM = useMemo(() => {
    const byDay = new Map<string, number>();
    usage.daily_history.forEach(d => byDay.set(d.day, d.tokens / 1_000_000));
    const out: number[] = [];
    for (let i = 29; i >= 0; i--) {
      const d = new Date();
      d.setDate(d.getDate() - i);
      const key = d.toISOString().slice(0, 10);
      out.push(byDay.get(key) ?? 0);
    }
    return out;
  }, [usage.daily_history]);

  const projectedMonthlyTokens = tokensMonthM / dayOfMonth * 30;
  const overLimitProjection = projectedMonthlyTokens > tier.tokensPerMonthM;
  const peakDay = Math.max(0, ...tokenHistoryM);
  const avgDay  = tokenHistoryM.reduce((a, b) => a + b, 0) / Math.max(1, tokenHistoryM.length);

  return (
    <div style={{ maxWidth: 1100 }}>
      {/* Header */}
      <div style={{ marginBottom: 24 }}>
        <div style={{ display: 'flex', alignItems: 'center', gap: 10, marginBottom: 6 }}>
          <div style={{ fontSize: 15, fontWeight: 600, color: C.text }}>Consumption &amp; Capacity</div>
          <span style={{
            display: 'inline-flex', alignItems: 'center', gap: 4,
            fontSize: 10, fontWeight: 600, letterSpacing: '0.04em',
            padding: '2px 7px', borderRadius: 3,
            backgroundColor: fetchError ? C.errorDim : loading ? C.warnDim : C.successDim,
            color: fetchError ? C.error : loading ? C.warn : C.success,
          }}>
            <Activity size={10} />
            {fetchError ? 'OFFLINE' : loading ? 'LOADING' : 'LIVE'}
          </span>
          <button
            onClick={() => setRefreshKey(k => k + 1)}
            disabled={loading}
            title="Refresh live metrics"
            style={{
              display: 'inline-flex', alignItems: 'center', gap: 4,
              padding: '3px 8px', borderRadius: 3, fontSize: 11,
              backgroundColor: C.bg, color: C.muted,
              border: `1px solid ${C.border}`, cursor: loading ? 'wait' : 'pointer',
            }}
          >
            <RefreshCw size={10} style={{ animation: loading ? 'spin 0.8s linear infinite' : 'none' }} />
            Refresh
          </button>
          {fetchError && (
            <span style={{ fontSize: 11, color: C.error }}>· {fetchError} (using fallback)</span>
          )}
        </div>
        <div style={{ fontSize: 12, color: C.muted, lineHeight: 1.5 }}>
          Real-time monitoring of bucket consumption against your contracted Tier {currentTier} allowance.
          All values come from <code style={{ fontFamily: 'monospace' }}>/admin/me/consumption</code>: tokens from <code>token_usage</code>,
          records from <code>object_records</code> (Postgres) + <code>events</code> (TimescaleDB),
          agents from <code>agent_configs</code>, pipelines from <code>pipeline_runs</code>,
          concurrent users from <code>audit_events</code>, storage via <code>pg_column_size</code> on both stores.
          DB connections is process-wide (no tenant scope). RAG corpus shows N/A because no vector store is deployed in this stack.
        </div>
      </div>
      <style>{`@keyframes spin { to { transform: rotate(360deg); } }`}</style>

      {/* Current tier card */}
      <div style={{
        padding: '20px 24px', backgroundColor: C.panel,
        border: `2px solid ${C.accent}`, borderRadius: 8, marginBottom: 24,
        display: 'grid', gridTemplateColumns: 'auto 1fr auto', gap: 24, alignItems: 'center',
      }}>
        <div style={{
          width: 64, height: 64, borderRadius: 8,
          backgroundColor: C.accent, color: '#FFF',
          display: 'flex', alignItems: 'center', justifyContent: 'center',
          fontSize: 28, fontWeight: 700,
        }}>
          {currentTier}
        </div>
        <div>
          <div style={{ fontSize: 11, color: C.accent, fontWeight: 600, letterSpacing: '0.06em', marginBottom: 4 }}>
            CURRENT BUCKET · {tier.label.toUpperCase()}{tier.recommended ? ' ★' : ''}
          </div>
          <div style={{ fontSize: 22, fontWeight: 700, color: C.text, marginBottom: 4 }}>
            Tier {currentTier} — {fmtMoney(tier.monthlyUSD)} / mo
          </div>
          <div style={{ fontSize: 12, color: C.muted }}>
            {fmtMoney(tier.annualUSD)} annual commitment · {tier.tokensPerMonthM}M tokens/month · {tier.concurrentUsers} concurrent users · SLA {tier.sla}
          </div>
        </div>
        <button
          onClick={() => setShowComparison(s => !s)}
          style={{
            display: 'flex', alignItems: 'center', gap: 6,
            padding: '8px 14px', borderRadius: 4, fontSize: 13, fontWeight: 600,
            backgroundColor: C.accent, color: '#FFF',
            border: `1px solid ${C.accent}`, cursor: 'pointer',
          }}
        >
          <ArrowUpRight size={13} />
          {showComparison ? 'Hide tiers' : 'Compare tiers'}
        </button>
      </div>

      {/* Projection alert */}
      {overLimitProjection && (
        <div style={{
          marginBottom: 20, padding: '12px 16px',
          backgroundColor: '#FEF2F2', border: '1px solid #FECACA', borderRadius: 6,
          display: 'flex', alignItems: 'flex-start', gap: 10,
        }}>
          <AlertTriangle size={16} color={C.error} style={{ marginTop: 1, flexShrink: 0 }} />
          <div style={{ flex: 1 }}>
            <div style={{ fontSize: 13, fontWeight: 600, color: C.error, marginBottom: 4 }}>
              Overage projected · end of month
            </div>
            <div style={{ fontSize: 12, color: C.muted, lineHeight: 1.5 }}>
              At current run rate ({tokensMonthM.toFixed(0)}M in {dayOfMonth} days),
              we project <strong style={{ color: C.text }}>{projectedMonthlyTokens.toFixed(0)}M tokens</strong> by month end —
              <strong style={{ color: C.error }}> {((projectedMonthlyTokens / tier.tokensPerMonthM - 1) * 100).toFixed(0)}% over your bucket</strong>.
              Overage policy: provider cost + 15% margin auto-billed, or deducted from the next period.
            </div>
          </div>
          <button style={{
            padding: '6px 12px', fontSize: 12, fontWeight: 600,
            backgroundColor: '#FFF', color: C.error,
            border: `1px solid #FECACA`, borderRadius: 4, cursor: 'pointer', flexShrink: 0,
          }}>
            Notify me
          </button>
        </div>
      )}

      {/* Daily token chart */}
      <div style={{
        backgroundColor: C.panel, border: `1px solid ${C.border}`, borderRadius: 6,
        padding: 18, marginBottom: 24,
      }}>
        <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginBottom: 4 }}>
          <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
            <Calendar size={14} color={C.accent} />
            <div style={{ fontSize: 13, fontWeight: 600, color: C.text }}>Daily token consumption · last 30 days</div>
          </div>
          <div style={{ fontSize: 11, color: C.muted, fontFamily: 'monospace' }}>
            Avg: {avgDay.toFixed(1)}M/day · Peak: {peakDay.toFixed(1)}M · Today: {tokensTodayM.toFixed(1)}M
          </div>
        </div>
        <div style={{ fontSize: 11, color: C.muted, marginBottom: 8 }}>
          Bars over the dashed line consumed from burst tolerance (3× sustained absorbed without overage). Source: <code style={{ fontFamily: 'monospace' }}>token_usage</code> table.
        </div>
        <TokenChart data={tokenHistoryM} limit={tier.tokensPerDayM} />
      </div>

      {/* Tier comparison (collapsible) */}
      {showComparison && (
        <div style={{ marginBottom: 24 }}>
          <div style={{ fontSize: 13, fontWeight: 600, color: C.text, marginBottom: 10 }}>
            Tier Comparison · Choose your next bucket
          </div>
          <TierComparison current={currentTier} onChooseUpgrade={setUpgradeRequest} />
          {upgradeRequest && (
            <div style={{
              marginTop: 12, padding: '10px 14px',
              backgroundColor: C.accentDim, border: `1px solid ${C.accent}`, borderRadius: 4,
              fontSize: 12, color: C.accent, display: 'flex', alignItems: 'center', gap: 8,
            }}>
              <CheckCircle2 size={13} />
              Request sent for {upgradeRequest === currentTier ? '' : 'upgrade to '}Tier {upgradeRequest}.
              Your Customer Success Manager will be in touch within 24h.
              <button
                onClick={() => setUpgradeRequest(null)}
                style={{ marginLeft: 'auto', background: 'none', border: 'none', cursor: 'pointer', color: C.accent, fontWeight: 600 }}
              >
                Dismiss
              </button>
            </div>
          )}
        </div>
      )}

      {/* Capacity metrics grid */}
      <div style={{ marginBottom: 12, fontSize: 13, fontWeight: 600, color: C.text }}>
        Capacity utilization · this month
      </div>
      <div style={{
        display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(220px, 1fr))',
        gap: 10, marginBottom: 24,
      }}>
        <UsageMetric source="live" icon={<Zap size={13} />}        label="Tokens (month)"      current={tokensMonthM}              limit={tier.tokensPerMonthM} unit="M" formatter={(n) => n.toFixed(1)} />
        <UsageMetric source="live" icon={<TrendingUp size={13} />} label="Tokens (today)"      current={tokensTodayM}              limit={tier.tokensPerDayM}   unit="M" formatter={(n) => n.toFixed(2)} />
        <UsageMetric source="live" icon={<Bot size={13} />}        label="Active agents"       current={usage.agents_active}       limit={tier.agents as number} />
        <UsageMetric source="live" icon={<Clock size={13} />}      label="Invocations (today)" current={usage.invocations_today}   limit={tier.invocationsPerDay} formatter={fmtCompact} />
        <UsageMetric
          source="live" icon={<Database size={13} />} label="Ontology records"
          current={usage.ontology_records} limit={tier.ontologyRecords} formatter={fmtCompact}
          subline={usage.ontology_records_breakdown
            ? `${fmtCompact(usage.ontology_records_breakdown.object_records)} objects · ${fmtCompact(usage.ontology_records_breakdown.events)} events`
            : undefined}
          hoverDetail={usage.ontology_records_breakdown
            ? `object_records (Postgres): ${fmt(usage.ontology_records_breakdown.object_records)}\nevents (TimescaleDB): ${fmt(usage.ontology_records_breakdown.events)}`
            : undefined}
        />
        <UsageMetric source="live" icon={<Workflow size={13} />}   label="Pipelines running"   current={usage.pipelines_running}   limit={tier.pipelinesParallel as number} />
        <UsageMetric source="live" icon={<Users size={13} />}      label="Concurrent users"    current={usage.concurrent_users}    limit={tier.concurrentUsers} />
        <UsageMetric
          source="live" icon={<HardDrive size={13} />} label="Storage"
          current={usage.storage_bytes / 1_073_741_824} limit={tier.storageGB} unit=" GB"
          formatter={(n) => n < 0.01 ? n.toFixed(3) : n.toFixed(2)}
          subline={usage.storage_breakdown
            ? `${(usage.storage_breakdown.object_records_bytes / 1_048_576).toFixed(1)} MB objects · ${(usage.storage_breakdown.events_bytes / 1_048_576).toFixed(1)} MB events`
            : undefined}
          hoverDetail={usage.storage_breakdown
            ? `Postgres object_records.data: ${(usage.storage_breakdown.object_records_bytes / 1_048_576).toFixed(2)} MB\nTimescaleDB events.attributes: ${(usage.storage_breakdown.events_bytes / 1_048_576).toFixed(2)} MB`
            : undefined}
        />

        {/* RAG: not configured on this deployment — show as honest "—" instead of fake bar. */}
        <UsageMetricNotConfigured icon={<FileText size={13} />} label="RAG corpus" reason={usage.rag_corpus_bytes === null ? 'Vector store not deployed' : undefined} />
        <UsageMetricInfo icon={<Database size={13} />} label="DB connections" current={usage.db_connections_process} note="process-wide" />
      </div>

      {/* Saturation analysis */}
      <div style={{ marginBottom: 12, display: 'flex', alignItems: 'center', gap: 8 }}>
        <Gauge size={14} color={C.accent} />
        <div style={{ fontSize: 13, fontWeight: 600, color: C.text }}>Saturation analysis</div>
        <span style={{ fontSize: 11, color: C.muted }}>· what saturates first</span>
      </div>
      <SaturationTable usage={usage} />

      {/* Footer info */}
      <div style={{
        marginTop: 20, padding: '12px 16px',
        backgroundColor: C.bg, border: `1px solid ${C.border}`, borderRadius: 6,
        fontSize: 12, color: C.muted, lineHeight: 1.5,
      }}>
        <strong style={{ color: C.text }}>Overage policy:</strong> early warning at 90% of bucket ·
        3× burst absorbed without charge · auto-coverage at provider cost + 15% margin if sustained ·
        organic upgrade only at annual renewal, always optional for the client.
      </div>
    </div>
  );
};

export default ConsumptionTab;
