import React, { useEffect, useMemo, useState } from 'react';
import {
  Cpu, Check, X, Lock, Download, Sparkles, Zap, Layers,
  ShieldCheck, Activity, Calculator, RefreshCw, Info, ChevronDown,
  AlertTriangle,
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

// ── Model catalog data (from maic_hosting_proposal.pdf) ────────────────────

type Tier = 'frontier' | 'productive' | 'economic';
type Provider = 'anthropic' | 'amazon' | 'meta' | 'deepseek' | 'mistral' | 'cohere';
type Status = 'enabled' | 'available' | 'pending' | 'restricted';

interface CatalogModel {
  id: string;
  label: string;
  provider: Provider;
  tier: Tier;
  inputPrice: number;   // USD per 1M tokens
  outputPrice: number;
  contextWindow: number; // tokens
  useCase: string;
  region: string;
  flags?: string[];
}

const CATALOG: CatalogModel[] = [
  // Tier Frontera
  { id: 'claude-opus-4-7',     label: 'Claude Opus 4.7',     provider: 'anthropic', tier: 'frontier',  inputPrice: 5.00, outputPrice: 25.00, contextWindow: 1_000_000, useCase: 'Complex agents, coding, deep reasoning', region: 'us-east-1', flags: ['+25% buffer (new tokenizer)'] },
  { id: 'claude-sonnet-4-6',   label: 'Claude Sonnet 4.6',   provider: 'anthropic', tier: 'frontier',  inputPrice: 3.00, outputPrice: 15.00, contextWindow: 1_000_000, useCase: 'Workhorse — RAG, generation, tool use', region: 'us-east-1', flags: ['recommended default'] },
  { id: 'claude-haiku-4-5',    label: 'Claude Haiku 4.5',    provider: 'anthropic', tier: 'frontier',  inputPrice: 1.00, outputPrice: 5.00,  contextWindow: 200_000,   useCase: 'Routing, classification, sub-tasks', region: 'us-east-1' },

  // Tier Productivo
  { id: 'amazon-nova-premier', label: 'Amazon Nova Premier', provider: 'amazon',    tier: 'productive', inputPrice: 2.50, outputPrice: 12.50, contextWindow: 300_000,   useCase: 'AWS-native backup, multi-modal', region: 'us-east-1' },
  { id: 'amazon-nova-pro',     label: 'Amazon Nova Pro',     provider: 'amazon',    tier: 'productive', inputPrice: 0.80, outputPrice: 3.20,  contextWindow: 300_000,   useCase: 'Production volume', region: 'us-east-1' },
  { id: 'deepseek-v3-2',       label: 'DeepSeek V3.2',       provider: 'deepseek',  tier: 'productive', inputPrice: 0.62, outputPrice: 1.85,  contextWindow: 128_000,   useCase: 'Economic reasoning', region: 'us-east-1' },
  { id: 'mistral-large-3',     label: 'Mistral Large 3',     provider: 'mistral',   tier: 'productive', inputPrice: 2.00, outputPrice: 6.00,  contextWindow: 128_000,   useCase: 'Multilingual Europe / LATAM', region: 'us-east-1' },
  { id: 'llama-4-scout-fp8',   label: 'Llama 4 Scout (FP8)', provider: 'meta',      tier: 'productive', inputPrice: 0.20, outputPrice: 0.60,  contextWindow: 10_000_000, useCase: 'Open-weight, huge context', region: 'us-east-1' },
  { id: 'llama-4-maverick',    label: 'Llama 4 Maverick',    provider: 'meta',      tier: 'productive', inputPrice: 0.27, outputPrice: 0.85,  contextWindow: 1_000_000, useCase: 'Open-weight flagship', region: 'us-east-1' },

  // Tier Económico
  { id: 'amazon-nova-lite',    label: 'Amazon Nova Lite',    provider: 'amazon',    tier: 'economic',  inputPrice: 0.06, outputPrice: 0.24,  contextWindow: 300_000,   useCase: 'Extraction, OCR-text', region: 'us-east-1' },
  { id: 'amazon-nova-micro',   label: 'Amazon Nova Micro',   provider: 'amazon',    tier: 'economic',  inputPrice: 0.035, outputPrice: 0.14, contextWindow: 128_000,   useCase: 'Routing, intent detection', region: 'us-east-1' },
  { id: 'mistral-small-3',     label: 'Mistral Small 3',     provider: 'mistral',   tier: 'economic',  inputPrice: 0.20, outputPrice: 0.60,  contextWindow: 32_000,    useCase: 'Backup low-cost', region: 'us-east-1' },
];

const PROVIDER_BADGE: Record<Provider, { bg: string; fg: string; label: string }> = {
  anthropic: { bg: '#FEF3C7', fg: '#92400E', label: 'Anthropic' },
  amazon:    { bg: '#FED7AA', fg: '#9A3412', label: 'Amazon'    },
  meta:      { bg: '#DBEAFE', fg: '#1E40AF', label: 'Meta'      },
  deepseek:  { bg: '#E0E7FF', fg: '#3730A3', label: 'DeepSeek'  },
  mistral:   { bg: '#FCE7F3', fg: '#9D174D', label: 'Mistral'   },
  cohere:    { bg: '#F1F5F9', fg: '#475569', label: 'Cohere'    },
};

const TIER_INFO: Record<Tier, { label: string; description: string; icon: React.ReactNode; color: string }> = {
  frontier:   { label: 'Frontier',   description: 'Premium reasoning · agents · maximum capability',           icon: <Sparkles size={12} />, color: '#7C3AED' },
  productive: { label: 'Productive', description: 'High-volume workhorses · multilingual · open-weight',       icon: <Zap size={12} />,      color: '#059669' },
  economic:   { label: 'Economic',   description: 'Routing · classification · extraction at scale',            icon: <Layers size={12} />,   color: '#2563EB' },
};

type BucketTier = 'S' | 'M' | 'L' | 'XL' | 'XXL';

// Bucket allowance from the hosting proposal — drives the cost estimator default.
const BUCKET_ALLOWANCE: Record<BucketTier, { tokensPerDayM: number; tokensPerMonthM: number; monthlyUSD: number; label: string }> = {
  S:   { tokensPerDayM: 2,   tokensPerMonthM: 60,    monthlyUSD: 2_667,   label: 'Pilot' },
  M:   { tokensPerDayM: 10,  tokensPerMonthM: 300,   monthlyUSD: 5_333,   label: 'Growth' },
  L:   { tokensPerDayM: 25,  tokensPerMonthM: 750,   monthlyUSD: 10_583,  label: 'Scale' },
  XL:  { tokensPerDayM: 80,  tokensPerMonthM: 2_400, monthlyUSD: 26_500,  label: 'Production' },
  XXL: { tokensPerDayM: 800, tokensPerMonthM: 24_000, monthlyUSD: 291_083, label: 'Enterprise' },
};

const fmtMoney = (n: number) => '$' + new Intl.NumberFormat('en-US', { minimumFractionDigits: 0, maximumFractionDigits: 0 }).format(n);
const fmtCtx = (n: number) => n >= 1_000_000 ? `${(n / 1_000_000).toFixed(0)}M` : `${(n / 1000).toFixed(0)}K`;

// ── Model card ─────────────────────────────────────────────────────────────

const ModelCard: React.FC<{
  model: CatalogModel;
  status: Status;
  onToggle: () => void;
  installing: boolean;
}> = ({ model, status, onToggle, installing }) => {
  const provBadge = PROVIDER_BADGE[model.provider];
  const tier = TIER_INFO[model.tier];

  const statusUI = {
    enabled:    { label: 'ENABLED',    bg: C.successDim, fg: C.success, icon: <Check size={11} /> },
    available:  { label: 'AVAILABLE',  bg: C.bg,         fg: C.muted,   icon: <Download size={11} /> },
    pending:    { label: 'PROVISIONING', bg: C.warnDim,    fg: C.warn,    icon: <RefreshCw size={11} style={{ animation: 'spin 0.8s linear infinite' }} /> },
    restricted: { label: 'RESTRICTED', bg: C.errorDim,   fg: C.error,   icon: <Lock size={11} /> },
  }[status];

  return (
    <div style={{
      padding: 14,
      backgroundColor: C.panel,
      border: `1px solid ${status === 'enabled' ? '#A7F3D0' : C.border}`,
      borderRadius: 6,
      display: 'flex', flexDirection: 'column', gap: 10,
      transition: 'all 100ms',
    }}>
      <div style={{ display: 'flex', alignItems: 'flex-start', gap: 10 }}>
        <div style={{
          width: 32, height: 32, borderRadius: 4,
          backgroundColor: provBadge.bg, color: provBadge.fg,
          display: 'flex', alignItems: 'center', justifyContent: 'center',
          fontSize: 14, fontWeight: 700, flexShrink: 0,
        }}>
          {provBadge.label[0]}
        </div>
        <div style={{ flex: 1, minWidth: 0 }}>
          <div style={{ fontSize: 13.5, fontWeight: 600, color: C.text, lineHeight: 1.2 }}>
            {model.label}
          </div>
          <div style={{ display: 'flex', alignItems: 'center', gap: 5, marginTop: 4 }}>
            <span style={{
              fontSize: 9.5, fontWeight: 600, letterSpacing: '0.04em',
              padding: '2px 6px', borderRadius: 3,
              backgroundColor: provBadge.bg, color: provBadge.fg,
            }}>
              {provBadge.label.toUpperCase()}
            </span>
            <span style={{
              fontSize: 9.5, fontWeight: 600, letterSpacing: '0.04em',
              padding: '2px 6px', borderRadius: 3,
              backgroundColor: '#F1F5F9', color: tier.color,
              display: 'inline-flex', alignItems: 'center', gap: 3,
            }}>
              {tier.icon}
              {tier.label.toUpperCase()}
            </span>
          </div>
        </div>
        <span style={{
          display: 'inline-flex', alignItems: 'center', gap: 4,
          fontSize: 9.5, fontWeight: 600, letterSpacing: '0.04em',
          padding: '3px 7px', borderRadius: 3,
          backgroundColor: statusUI.bg, color: statusUI.fg, flexShrink: 0,
        }}>
          {statusUI.icon}
          {statusUI.label}
        </span>
      </div>

      <div style={{
        display: 'grid', gridTemplateColumns: '1fr 1fr 1fr',
        gap: 8, padding: '8px 10px',
        backgroundColor: C.bg, borderRadius: 4,
      }}>
        <div>
          <div style={{ fontSize: 9.5, color: C.muted, letterSpacing: '0.04em', fontWeight: 600 }}>INPUT</div>
          <div style={{ fontSize: 12.5, fontWeight: 600, color: C.text, fontFamily: 'monospace' }}>${model.inputPrice}/1M</div>
        </div>
        <div>
          <div style={{ fontSize: 9.5, color: C.muted, letterSpacing: '0.04em', fontWeight: 600 }}>OUTPUT</div>
          <div style={{ fontSize: 12.5, fontWeight: 600, color: C.text, fontFamily: 'monospace' }}>${model.outputPrice}/1M</div>
        </div>
        <div>
          <div style={{ fontSize: 9.5, color: C.muted, letterSpacing: '0.04em', fontWeight: 600 }}>CONTEXT</div>
          <div style={{ fontSize: 12.5, fontWeight: 600, color: C.text, fontFamily: 'monospace' }}>{fmtCtx(model.contextWindow)}</div>
        </div>
      </div>

      <div style={{ fontSize: 11.5, color: C.muted, lineHeight: 1.4, minHeight: 32 }}>
        {model.useCase}
      </div>

      {model.flags && (
        <div style={{ display: 'flex', flexWrap: 'wrap', gap: 4 }}>
          {model.flags.map(f => (
            <span key={f} style={{
              fontSize: 10, padding: '2px 6px', borderRadius: 3,
              backgroundColor: '#FFFBEB', color: '#92400E',
              border: '1px solid #FDE68A',
            }}>
              {f}
            </span>
          ))}
        </div>
      )}

      <button
        onClick={onToggle}
        disabled={installing || status === 'pending' || status === 'restricted'}
        style={{
          height: 30, borderRadius: 4, fontSize: 12, fontWeight: 600,
          cursor: (installing || status === 'pending' || status === 'restricted') ? 'not-allowed' : 'pointer',
          display: 'flex', alignItems: 'center', justifyContent: 'center', gap: 6,
          ...(status === 'enabled'
            ? { backgroundColor: C.bg, color: C.muted, border: `1px solid ${C.border}` }
            : status === 'pending'
            ? { backgroundColor: C.warnDim, color: C.warn, border: `1px solid #FDE68A` }
            : status === 'restricted'
            ? { backgroundColor: C.errorDim, color: C.error, border: `1px solid #FECACA` }
            : { backgroundColor: C.accent, color: '#FFF', border: `1px solid ${C.accent}` }),
        }}
      >
        {status === 'enabled' && (<><X size={11} /> Disable for tenant</>)}
        {status === 'available' && (<><Download size={11} /> Enable in VPC</>)}
        {status === 'pending' && (<><RefreshCw size={11} style={{ animation: 'spin 0.8s linear infinite' }} /> Provisioning…</>)}
        {status === 'restricted' && (<><Lock size={11} /> Tier upgrade required</>)}
      </button>
    </div>
  );
};

// ── Cost Estimator ─────────────────────────────────────────────────────────

type Scenario = 'A' | 'B' | 'C' | 'D' | 'custom';

interface ScenarioConfig {
  label: string;
  description: string;
  mix: { modelId: string; pct: number }[]; // share of total tokens
}

// Scenarios reference models. We filter unavailable scenarios out per tier.
const SCENARIOS: Record<Exclude<Scenario, 'custom'>, ScenarioConfig> = {
  A: { label: 'Conservative',    description: '80% Haiku · 20% Sonnet · cost-optimized for extraction & RAG',
       mix: [{ modelId: 'claude-haiku-4-5', pct: 0.80 }, { modelId: 'claude-sonnet-4-6', pct: 0.20 }] },
  B: { label: 'Smart Routing ★', description: '60% Haiku · 30% Sonnet · 10% Opus · recommended default',
       mix: [{ modelId: 'claude-haiku-4-5', pct: 0.60 }, { modelId: 'claude-sonnet-4-6', pct: 0.30 }, { modelId: 'claude-opus-4-7', pct: 0.10 }] },
  C: { label: 'Premium',         description: '100% Sonnet · consistent quality, no routing logic',
       mix: [{ modelId: 'claude-sonnet-4-6', pct: 1.0 }] },
  D: { label: 'Frontier',        description: '80% Opus · 20% Sonnet · for revenue-moving workloads',
       mix: [{ modelId: 'claude-opus-4-7', pct: 0.80 }, { modelId: 'claude-sonnet-4-6', pct: 0.20 }] },
};

// Min tier required for each scenario (must satisfy ALL models in the mix).
const SCENARIO_MIN_TIER: Record<Exclude<Scenario, 'custom'>, BucketTier> = {
  A: 'M',  // needs Sonnet
  B: 'L',  // needs Opus
  C: 'M',  // Sonnet only
  D: 'L',  // needs Opus
};

const TIER_RANK: Record<BucketTier, number> = { S: 0, M: 1, L: 2, XL: 3, XXL: 4 };

// Tier S has no Sonnet → fall back to a Haiku-only sandbox scenario.
const TIER_S_FALLBACK_SCENARIO: ScenarioConfig = {
  label: 'Haiku sandbox',
  description: '100% Haiku · only scenario available at Tier S (Pilot)',
  mix: [{ modelId: 'claude-haiku-4-5', pct: 1.0 }],
};

const INFRA_COST_USD_MO = 2340; // From Section 3 of proposal

const CostEstimator: React.FC<{ bucketTier: BucketTier }> = ({ bucketTier }) => {
  const allowance = BUCKET_ALLOWANCE[bucketTier];

  // Pre-pick a scenario the tier can actually afford.
  const defaultScenario: Scenario = useMemo(() => {
    const tierIdx = TIER_RANK[bucketTier];
    const ordered: Scenario[] = ['B', 'A', 'C', 'D'];
    return (ordered.find(s => s !== 'custom' && TIER_RANK[SCENARIO_MIN_TIER[s as Exclude<Scenario,'custom'>]] <= tierIdx)
      || 'A') as Scenario;
  }, [bucketTier]);

  const [scenario, setScenario] = useState<Scenario>(defaultScenario);
  const [tokensPerDay, setTokensPerDay] = useState(allowance.tokensPerDayM);
  const [inputRatio, setInputRatio] = useState(70);
  const [cachingPct, setCachingPct] = useState(40);
  const [batchPct, setBatchPct] = useState(0);

  // Reset scenario + tokens-per-day when the tier changes.
  useEffect(() => {
    setScenario(defaultScenario);
    setTokensPerDay(allowance.tokensPerDayM);
  }, [bucketTier, defaultScenario, allowance.tokensPerDayM]);

  const tierAllowsScenario = (s: Scenario): boolean => {
    if (s === 'custom') return true;
    return TIER_RANK[bucketTier] >= TIER_RANK[SCENARIO_MIN_TIER[s as Exclude<Scenario,'custom'>]];
  };

  const cfg: ScenarioConfig = scenario === 'custom' || !tierAllowsScenario(scenario)
    ? (bucketTier === 'S' ? TIER_S_FALLBACK_SCENARIO : SCENARIOS.A)
    : SCENARIOS[scenario as Exclude<Scenario,'custom'>];

  const tokensPerMonth = tokensPerDay * 30;
  const overBudget = tokensPerMonth > allowance.tokensPerMonthM;
  const overagePct = ((tokensPerMonth / allowance.tokensPerMonthM) - 1) * 100;

  const breakdown = useMemo(() => {
    return cfg.mix.map(m => {
      const model = CATALOG.find(x => x.id === m.modelId)!;
      const modelTokensM = tokensPerMonth * m.pct;
      const inputM = modelTokensM * (inputRatio / 100);
      const outputM = modelTokensM * (1 - inputRatio / 100);

      const cachedInputM = inputM * (cachingPct / 100);
      const fullInputM = inputM - cachedInputM;
      const inputCost = (fullInputM + cachedInputM * 0.10) * model.inputPrice;
      const outputCost = outputM * model.outputPrice;

      const baseCost = inputCost + outputCost;
      const batchDiscount = baseCost * (batchPct / 100) * 0.50; // batch = 50% off
      const final = baseCost - batchDiscount;

      return { model, tokensM: modelTokensM, inputM, outputM, baseCost, final };
    });
  }, [cfg, tokensPerMonth, inputRatio, cachingPct, batchPct]);

  const totalTokens = breakdown.reduce((s, b) => s + b.final, 0);
  const totalMonthly = totalTokens + INFRA_COST_USD_MO;

  return (
    <div style={{
      backgroundColor: C.panel, border: `1px solid ${C.border}`, borderRadius: 6,
      padding: 18, marginTop: 24,
    }}>
      <div style={{ display: 'flex', alignItems: 'center', gap: 8, marginBottom: 6, flexWrap: 'wrap' }}>
        <Calculator size={15} color={C.accent} />
        <div style={{ fontSize: 14, fontWeight: 600, color: C.text }}>Cost Estimator</div>
        <span style={{
          fontSize: 9.5, fontWeight: 600, letterSpacing: '0.04em',
          padding: '2px 7px', borderRadius: 3, backgroundColor: C.accentDim, color: C.accent,
        }}>BEDROCK PRICING</span>
        <span style={{
          fontSize: 9.5, fontWeight: 600, letterSpacing: '0.04em',
          padding: '2px 7px', borderRadius: 3,
          backgroundColor: '#F1F5F9', color: C.text,
        }}>
          BUCKET {bucketTier} · {allowance.label.toUpperCase()} · {allowance.tokensPerMonthM}M/mo
        </span>
      </div>
      <div style={{ fontSize: 11.5, color: C.muted, marginBottom: 16 }}>
        Defaults pinned to your bucket allowance. Sliding tokens/day past your bucket triggers an overage warning.
        Includes prompt caching and Batch API discounts.
      </div>

      {/* Scenario picker */}
      <div style={{ display: 'grid', gridTemplateColumns: 'repeat(4, 1fr)', gap: 8, marginBottom: 16 }}>
        {(['A', 'B', 'C', 'D'] as const).map(s => {
          const isActive = scenario === s;
          const cfgS = SCENARIOS[s];
          const allowed = tierAllowsScenario(s);
          const minTier = SCENARIO_MIN_TIER[s];
          return (
            <button
              key={s}
              onClick={() => allowed && setScenario(s)}
              disabled={!allowed}
              title={!allowed ? `Requires bucket ${minTier}+ (current: ${bucketTier})` : ''}
              style={{
                padding: '10px 12px', textAlign: 'left', position: 'relative',
                backgroundColor: isActive ? C.accentDim : C.bg,
                border: `1px solid ${isActive ? C.accent : C.border}`,
                borderRadius: 4, cursor: allowed ? 'pointer' : 'not-allowed',
                opacity: allowed ? 1 : 0.5, transition: 'all 100ms',
              }}
            >
              {!allowed && (
                <span style={{
                  position: 'absolute', top: 6, right: 6,
                  display: 'inline-flex', alignItems: 'center', gap: 3,
                  fontSize: 9, fontWeight: 700, letterSpacing: '0.04em',
                  padding: '1px 5px', borderRadius: 3,
                  backgroundColor: C.errorDim, color: C.error,
                }}>
                  <Lock size={9} /> {minTier}+
                </span>
              )}
              <div style={{ fontSize: 11, fontWeight: 600, color: isActive ? C.accent : C.muted, letterSpacing: '0.04em', marginBottom: 4 }}>
                SCENARIO {s}
              </div>
              <div style={{ fontSize: 13, fontWeight: 600, color: C.text, marginBottom: 4 }}>{cfgS.label}</div>
              <div style={{ fontSize: 11, color: C.muted, lineHeight: 1.4 }}>{cfgS.description}</div>
            </button>
          );
        })}
      </div>

      {/* Sliders */}
      <div style={{ display: 'grid', gridTemplateColumns: 'repeat(4, 1fr)', gap: 12, marginBottom: 8 }}>
        <SliderField
          label={`Tokens / day · bucket = ${allowance.tokensPerDayM}M`}
          value={tokensPerDay}
          min={1}
          max={Math.max(800, allowance.tokensPerDayM * 2)}
          step={1}
          unit="M"
          onChange={setTokensPerDay}
          hint={overBudget ? `${overagePct.toFixed(0)}% over bucket allowance` : 'within allowance'}
          warn={overBudget}
        />
        <SliderField label="Input ratio"    value={inputRatio}   min={50} max={95}  step={5}  unit="%" onChange={setInputRatio} />
        <SliderField label="Prompt cached"  value={cachingPct}   min={0}  max={70}  step={5}  unit="%" onChange={setCachingPct} hint="−90% on input" />
        <SliderField label="Batch API"      value={batchPct}     min={0}  max={50}  step={5}  unit="%" onChange={setBatchPct} hint="−50% on async" />
      </div>

      {overBudget && (
        <div style={{
          marginBottom: 14, padding: '8px 12px',
          backgroundColor: '#FEF2F2', border: '1px solid #FECACA', borderRadius: 4,
          fontSize: 11.5, color: C.error, display: 'flex', alignItems: 'flex-start', gap: 6,
        }}>
          <AlertTriangle size={12} style={{ marginTop: 2, flexShrink: 0 }} />
          <div>
            <strong>Overage projected.</strong> {tokensPerMonth.toLocaleString()}M tokens/month vs. bucket allowance of {allowance.tokensPerMonthM}M ({overagePct.toFixed(0)}% over).
            Overage policy: provider cost + 15% margin, or deducted from next period's bucket. Consider upgrading to{' '}
            {(['M','L','XL','XXL'] as BucketTier[]).find(t => BUCKET_ALLOWANCE[t].tokensPerMonthM >= tokensPerMonth) || 'XXL'}.
          </div>
        </div>
      )}

      {/* Breakdown */}
      <div style={{
        border: `1px solid ${C.border}`, borderRadius: 4, overflow: 'hidden',
        marginBottom: 14,
      }}>
        <table style={{ width: '100%', borderCollapse: 'collapse', fontSize: 12 }}>
          <thead>
            <tr style={{ backgroundColor: C.ink }}>
              <th style={{ padding: '8px 12px', textAlign: 'left',  color: '#FAFAF7', fontSize: 10, fontWeight: 600, letterSpacing: '0.06em' }}>MODEL</th>
              <th style={{ padding: '8px 12px', textAlign: 'right', color: '#FAFAF7', fontSize: 10, fontWeight: 600, letterSpacing: '0.06em' }}>TOKENS/MES</th>
              <th style={{ padding: '8px 12px', textAlign: 'right', color: '#FAFAF7', fontSize: 10, fontWeight: 600, letterSpacing: '0.06em' }}>INPUT</th>
              <th style={{ padding: '8px 12px', textAlign: 'right', color: '#FAFAF7', fontSize: 10, fontWeight: 600, letterSpacing: '0.06em' }}>OUTPUT</th>
              <th style={{ padding: '8px 12px', textAlign: 'right', color: '#FAFAF7', fontSize: 10, fontWeight: 600, letterSpacing: '0.06em' }}>BASE</th>
              <th style={{ padding: '8px 12px', textAlign: 'right', color: '#FAFAF7', fontSize: 10, fontWeight: 600, letterSpacing: '0.06em' }}>FINAL</th>
            </tr>
          </thead>
          <tbody>
            {breakdown.map(b => (
              <tr key={b.model.id} style={{ borderTop: `1px solid ${C.border}` }}>
                <td style={{ padding: '8px 12px', color: C.text, fontWeight: 500 }}>{b.model.label}</td>
                <td style={{ padding: '8px 12px', textAlign: 'right', fontFamily: 'monospace', color: C.muted }}>{b.tokensM.toFixed(1)}M</td>
                <td style={{ padding: '8px 12px', textAlign: 'right', fontFamily: 'monospace', color: C.muted }}>{b.inputM.toFixed(1)}M × ${b.model.inputPrice}</td>
                <td style={{ padding: '8px 12px', textAlign: 'right', fontFamily: 'monospace', color: C.muted }}>{b.outputM.toFixed(1)}M × ${b.model.outputPrice}</td>
                <td style={{ padding: '8px 12px', textAlign: 'right', fontFamily: 'monospace', color: C.muted }}>{fmtMoney(b.baseCost)}</td>
                <td style={{ padding: '8px 12px', textAlign: 'right', fontFamily: 'monospace', color: C.success, fontWeight: 600 }}>{fmtMoney(b.final)}</td>
              </tr>
            ))}
            <tr style={{ borderTop: `1px solid ${C.border}`, backgroundColor: C.bg }}>
              <td style={{ padding: '8px 12px', color: C.muted, fontStyle: 'italic' }}>Infrastructure (VPC, RDS, OpenSearch, ALB, KMS, Guardrails)</td>
              <td style={{ padding: '8px 12px', textAlign: 'right', color: C.muted }}>—</td>
              <td colSpan={3} style={{ padding: '8px 12px', textAlign: 'right', color: C.muted }}>Section 3 baseline</td>
              <td style={{ padding: '8px 12px', textAlign: 'right', fontFamily: 'monospace', color: C.text, fontWeight: 600 }}>{fmtMoney(INFRA_COST_USD_MO)}</td>
            </tr>
          </tbody>
        </table>
      </div>

      <div style={{
        display: 'grid', gridTemplateColumns: '1fr 1fr 1fr', gap: 12,
      }}>
        <SummaryStat label="TOKEN COSTS" value={fmtMoney(totalTokens)} />
        <SummaryStat label="INFRA"        value={fmtMoney(INFRA_COST_USD_MO)} />
        <SummaryStat label="TOTAL / MES"   value={fmtMoney(totalMonthly)} highlight />
      </div>

      <div style={{
        marginTop: 14, padding: '8px 12px',
        backgroundColor: '#FFFBEB', border: '1px solid #FDE68A', borderRadius: 4,
        fontSize: 11.5, color: '#92400E', display: 'flex', alignItems: 'flex-start', gap: 6,
      }}>
        <Info size={12} style={{ marginTop: 2, flexShrink: 0 }} />
        <div>
          Estimates use Bedrock on-demand pricing. Provisioned Throughput (sustained &gt;$30/day per model) saves an additional 15–40%.
          Region pricing: LATAM endpoints add +10%; us-east-1 / global has no surcharge.
        </div>
      </div>
    </div>
  );
};

const SliderField: React.FC<{ label: string; value: number; min: number; max: number; step: number; unit: string; onChange: (v: number) => void; hint?: string; warn?: boolean }> = ({ label, value, min, max, step, unit, onChange, hint, warn }) => (
  <div>
    <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'baseline', marginBottom: 4 }}>
      <label style={{ fontSize: 11, color: C.muted, fontWeight: 500 }}>{label}</label>
      <span style={{ fontSize: 13, fontWeight: 600, color: warn ? C.error : C.text, fontFamily: 'monospace' }}>{value}{unit}</span>
    </div>
    <input
      type="range" min={min} max={max} step={step} value={value}
      onChange={e => onChange(Number(e.target.value))}
      style={{ width: '100%', accentColor: warn ? C.error : C.accent }}
    />
    {hint && <div style={{ fontSize: 10, color: warn ? C.error : C.dim, marginTop: 2, fontWeight: warn ? 600 : 400 }}>{hint}</div>}
  </div>
);

const SummaryStat: React.FC<{ label: string; value: string; highlight?: boolean }> = ({ label, value, highlight }) => (
  <div style={{
    padding: '12px 14px',
    backgroundColor: highlight ? C.accentDim : C.bg,
    border: `1px solid ${highlight ? C.accent : C.border}`,
    borderRadius: 4,
  }}>
    <div style={{ fontSize: 10, fontWeight: 600, color: highlight ? C.accent : C.muted, letterSpacing: '0.06em' }}>{label}</div>
    <div style={{ fontSize: 22, fontWeight: 700, color: highlight ? C.accent : C.text, marginTop: 4, fontFamily: 'monospace' }}>{value}</div>
  </div>
);

// ── Main tab ───────────────────────────────────────────────────────────────

export const ModelCatalogTab: React.FC = () => {
  const [statuses, setStatuses] = useState<Record<string, Status>>({});
  const [bucketTier, setBucketTier] = useState<BucketTier>('S');
  const [installing, setInstalling] = useState<string | null>(null);
  const [tierFilter, setTierFilter] = useState<Tier | 'all'>('all');
  const [providerFilter, setProviderFilter] = useState<Provider | 'all'>('all');
  const [showEstimator, setShowEstimator] = useState(true);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  const headers = (): Record<string, string> => {
    const t = getAccessToken();
    const h: Record<string, string> = {
      'Content-Type': 'application/json',
      'x-tenant-id': getTenantId(),
    };
    if (t) h.Authorization = `Bearer ${t}`;
    return h;
  };

  const fetchCatalog = async () => {
    setLoading(true);
    setError(null);
    try {
      const r = await fetch(`${ADMIN_API}/admin/me/bedrock-models`, { headers: headers() });
      if (!r.ok) throw new Error(`HTTP ${r.status}`);
      const data: { bucket_tier: BucketTier; models: { model_id: string; status: Status }[] } = await r.json();
      setBucketTier(data.bucket_tier);
      const next: Record<string, Status> = {};
      data.models.forEach(m => { next[m.model_id] = m.status; });
      setStatuses(next);
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Failed to load');
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => { fetchCatalog(); }, []);

  const toggleModel = async (id: string) => {
    const current = statuses[id] || 'available';
    if (current === 'restricted' || current === 'pending') return;

    const enabling = current === 'available';
    setInstalling(id);
    if (enabling) setStatuses(s => ({ ...s, [id]: 'pending' }));

    try {
      const r = await fetch(`${ADMIN_API}/admin/me/bedrock-models/${id}`, {
        method: 'POST',
        headers: headers(),
        body: JSON.stringify({ enabled: enabling }),
      });
      if (!r.ok) {
        const err = await r.json().catch(() => ({}));
        alert(`Failed: ${err.detail || r.status}`);
        await fetchCatalog();
        return;
      }
      setStatuses(s => ({ ...s, [id]: enabling ? 'enabled' : 'available' }));
    } finally {
      setInstalling(null);
    }
  };

  const filtered = CATALOG.filter(m =>
    (tierFilter === 'all' || m.tier === tierFilter) &&
    (providerFilter === 'all' || m.provider === providerFilter)
  );

  const grouped = (['frontier', 'productive', 'economic'] as Tier[]).map(t => ({
    tier: t,
    models: filtered.filter(m => m.tier === t),
  })).filter(g => g.models.length > 0);

  const enabledCount = Object.values(statuses).filter(s => s === 'enabled').length;
  const totalCount = CATALOG.length;

  return (
    <div style={{ maxWidth: 1100 }}>
      {/* Header */}
      <div style={{ marginBottom: 24 }}>
        <div style={{ display: 'flex', alignItems: 'center', gap: 10, marginBottom: 6 }}>
          <div style={{ fontSize: 15, fontWeight: 600, color: C.text }}>Bedrock Model Catalog</div>
          <span style={{
            display: 'inline-flex', alignItems: 'center', gap: 4,
            fontSize: 10, fontWeight: 600, letterSpacing: '0.04em',
            padding: '2px 7px', borderRadius: 3, backgroundColor: C.accentDim, color: C.accent,
          }}>
            <ShieldCheck size={10} /> WALLED-GARDEN VPC
          </span>
        </div>
        <div style={{ fontSize: 12, color: C.muted, lineHeight: 1.5 }}>
          Walled-garden LLMs deployed via Amazon Bedrock inside your private VPC. Enable models on demand —
          inference happens on AWS-managed copies, your data never leaves your perimeter and is never used for training.
          Anthropic Zero Data Retention (ZDR) is configured by default.
        </div>
      </div>

      {/* Stat strip */}
      <div style={{ display: 'grid', gridTemplateColumns: 'repeat(4, 1fr)', gap: 10, marginBottom: 18 }}>
        <StatBox icon={<Cpu size={13} />}         label="Models enabled" value={loading ? '…' : `${enabledCount} / ${totalCount}`} />
        <StatBox icon={<Sparkles size={13} />}    label="Bucket tier"    value={`${bucketTier} · ${BUCKET_ALLOWANCE[bucketTier].label}`} />
        <StatBox icon={<ShieldCheck size={13} />} label="Isolation"      value="VPC + PrivateLink" />
        <StatBox icon={<Activity size={13} />}    label="Region"         value="us-east-1" />
      </div>

      {error && (
        <div style={{
          marginBottom: 14, padding: '8px 12px', borderRadius: 4,
          backgroundColor: C.errorDim, border: `1px solid #FECACA`,
          fontSize: 12, color: C.error,
        }}>
          Could not load catalog: {error}
        </div>
      )}

      {/* Filters */}
      <div style={{ display: 'flex', gap: 8, marginBottom: 16, flexWrap: 'wrap' }}>
        <FilterChip label="All tiers" active={tierFilter === 'all'} onClick={() => setTierFilter('all')} />
        <FilterChip label="Frontier"   active={tierFilter === 'frontier'}   onClick={() => setTierFilter('frontier')} icon={<Sparkles size={11} />} />
        <FilterChip label="Productive" active={tierFilter === 'productive'} onClick={() => setTierFilter('productive')} icon={<Zap size={11} />} />
        <FilterChip label="Economic"   active={tierFilter === 'economic'}   onClick={() => setTierFilter('economic')} icon={<Layers size={11} />} />

        <div style={{ width: 1, backgroundColor: C.border, margin: '0 4px' }} />

        <FilterChip label="All providers" active={providerFilter === 'all'} onClick={() => setProviderFilter('all')} />
        {(['anthropic', 'amazon', 'meta', 'deepseek', 'mistral'] as Provider[]).map(p => (
          <FilterChip
            key={p}
            label={PROVIDER_BADGE[p].label}
            active={providerFilter === p}
            onClick={() => setProviderFilter(p)}
          />
        ))}
      </div>

      {/* Sections */}
      {grouped.map(({ tier, models }) => {
        const info = TIER_INFO[tier];
        return (
          <section key={tier} style={{ marginBottom: 28 }}>
            <div style={{
              display: 'flex', alignItems: 'center', gap: 10,
              paddingBottom: 8, marginBottom: 12,
              borderBottom: `1px solid ${C.border}`,
            }}>
              <div style={{
                display: 'inline-flex', alignItems: 'center', gap: 5,
                fontSize: 10, fontWeight: 700, letterSpacing: '0.06em',
                padding: '3px 9px', borderRadius: 3,
                backgroundColor: '#F1F5F9', color: info.color,
              }}>
                {info.icon}
                {info.label.toUpperCase()} TIER
              </div>
              <div style={{ fontSize: 12, color: C.muted, flex: 1 }}>{info.description}</div>
              <div style={{ fontSize: 11, color: C.dim, fontFamily: 'monospace' }}>{models.length} models</div>
            </div>

            <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fill, minmax(290px, 1fr))', gap: 12 }}>
              {models.map(m => (
                <ModelCard
                  key={m.id}
                  model={m}
                  status={statuses[m.id] || 'available'}
                  onToggle={() => toggleModel(m.id)}
                  installing={installing === m.id}
                />
              ))}
            </div>
          </section>
        );
      })}

      {/* Cost Estimator toggle */}
      <button
        onClick={() => setShowEstimator(s => !s)}
        style={{
          display: 'flex', alignItems: 'center', gap: 8,
          padding: '10px 14px', borderRadius: 4, fontSize: 13, fontWeight: 600,
          backgroundColor: C.bg, color: C.text,
          border: `1px solid ${C.border}`, cursor: 'pointer',
          width: '100%', justifyContent: 'space-between',
          marginTop: 8,
        }}
      >
        <span style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
          <Calculator size={14} color={C.accent} />
          Cost Estimator
        </span>
        <ChevronDown size={14} style={{ transform: showEstimator ? 'rotate(180deg)' : 'none', transition: 'transform 150ms' }} />
      </button>

      {showEstimator && <CostEstimator bucketTier={bucketTier} />}

      <style>{`@keyframes spin { to { transform: rotate(360deg); } }`}</style>
    </div>
  );
};

const StatBox: React.FC<{ icon: React.ReactNode; label: string; value: string }> = ({ icon, label, value }) => (
  <div style={{
    padding: '10px 12px', backgroundColor: C.panel,
    border: `1px solid ${C.border}`, borderRadius: 6,
  }}>
    <div style={{ display: 'flex', alignItems: 'center', gap: 6, color: C.muted, marginBottom: 4 }}>
      {icon}
      <span style={{ fontSize: 10.5, fontWeight: 600, letterSpacing: '0.06em' }}>{label.toUpperCase()}</span>
    </div>
    <div style={{ fontSize: 14, fontWeight: 600, color: C.text }}>{value}</div>
  </div>
);

const FilterChip: React.FC<{ label: string; active: boolean; onClick: () => void; icon?: React.ReactNode }> = ({ label, active, onClick, icon }) => (
  <button
    onClick={onClick}
    style={{
      display: 'inline-flex', alignItems: 'center', gap: 5,
      padding: '5px 11px', borderRadius: 14, fontSize: 12, fontWeight: 500,
      backgroundColor: active ? C.accent : C.panel,
      color: active ? '#FFF' : C.muted,
      border: `1px solid ${active ? C.accent : C.border}`,
      cursor: 'pointer', transition: 'all 100ms',
    }}
  >
    {icon}
    {label}
  </button>
);

export default ModelCatalogTab;
