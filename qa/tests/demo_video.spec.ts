/**
 * demo_video.spec.ts
 * Records a polished video walkthrough of the insurance (siniestros) demo.
 * Tenant: tenant-seguros-demo / demo@seguros.sv
 */

import { test } from '@playwright/test';
import type { Page } from '@playwright/test';
import * as fs from 'fs';
import * as path from 'path';

const EMAIL = 'demo@seguros.sv';
const PASSWORD = 'DemoSeguros2026!';
const BASE = 'http://localhost:3000';
const OUTDIR = path.resolve(__dirname, '../results/demo-video');

test.use({
  video: { mode: 'on', size: { width: 1440, height: 900 } },
  viewport: { width: 1440, height: 900 },
});

// ── Helpers ──────────────────────────────────────────────────────────────

async function pause(p: Page, ms: number) { await p.waitForTimeout(ms); }

async function loginDemo(p: Page) {
  await p.goto(BASE);
  const emailInput = p.locator('#maic-email');
  await emailInput.waitFor({ timeout: 12000 });
  await emailInput.click(); await emailInput.clear();
  await emailInput.pressSequentially(EMAIL, { delay: 25 });
  await p.locator('form button[type="submit"]').first().click();
  const passInput = p.locator('#maic-pass');
  await passInput.waitFor({ timeout: 8000 });
  await passInput.click(); await passInput.clear();
  await passInput.pressSequentially(PASSWORD, { delay: 15 });
  await pause(p, 200);
  await p.locator('form button[type="submit"]').first().click();
  await p.waitForSelector('nav', { timeout: 15000 });
  await pause(p, 1500);
}

async function nav(p: Page, label: string) {
  const btn = p.locator('nav button').filter({ hasText: new RegExp(label, 'i') }).first();
  await btn.waitFor({ timeout: 8000 });
  await btn.click();
  await pause(p, 1500);
}

async function tryClick(p: Page, selector: string, timeout = 2500): Promise<boolean> {
  try {
    const el = p.locator(selector).first();
    if (await el.isVisible({ timeout })) { await el.click(); return true; }
  } catch {}
  return false;
}

async function tryClickText(p: Page, text: string, timeout = 2500): Promise<boolean> {
  return tryClick(p, `text=${text}`, timeout);
}

async function tryTab(p: Page, label: string): Promise<boolean> {
  return tryClick(p, `button:has-text("${label}")`, 2000);
}

async function scroll(p: Page, y = 400) {
  await p.mouse.wheel(0, y);
  await pause(p, 500);
}

// ── Main ─────────────────────────────────────────────────────────────────

test('insurance demo - full walkthrough', async ({ page: p }, testInfo) => {
  testInfo.setTimeout(600_000);
  fs.mkdirSync(OUTDIR, { recursive: true });

  // ── LOGIN ──────────────────────────────────────────────────────────────
  await loginDemo(p);
  await pause(p, 2000);

  // ── CONNECTORS ─────────────────────────────────────────────────────────
  await nav(p, 'Connectors');
  await pause(p, 5000);   // Show the 3 insurance connectors

  // Open Policies connector detail
  await tryClickText(p, 'Repositorio de Polizas');
  await pause(p, 4000);
  await tryTab(p, 'Configuration');
  await pause(p, 4000);

  // Open Claims connector
  await nav(p, 'Connectors');
  await pause(p, 2000);
  await tryClickText(p, 'Reclamos de Seguros');
  await pause(p, 4000);

  // ── ONTOLOGY ───────────────────────────────────────────────────────────
  await nav(p, 'Ontology');
  await pause(p, 3000);

  // Graph view first
  await tryTab(p, 'Graph');
  await pause(p, 6000);   // Show knowledge graph with linked entities

  // Click Poliza to see schema
  await tryClickText(p, 'Poliza');
  await pause(p, 4000);
  await tryTab(p, 'Records');
  await pause(p, 5000);   // Show policy records
  await scroll(p, 300);
  await pause(p, 3000);

  // Back to ontology, show ReclamoEvento
  await nav(p, 'Ontology');
  await pause(p, 2000);
  const clickedReclamo = await tryClickText(p, 'ReclamoEvento');
  if (!clickedReclamo) await tryClickText(p, 'Evento de Reclamo');
  await pause(p, 3000);
  await tryTab(p, 'Records');
  await pause(p, 5000);

  // ── DATA EXPLORER ──────────────────────────────────────────────────────
  await nav(p, 'Data');
  await pause(p, 3000);

  // Select Poliza from object type list
  await tryClickText(p, 'Poliza', 2000);
  await pause(p, 1500);

  // Click Run
  const runBtn = p.locator('button:has-text("Run"):not([disabled])').first();
  if (await runBtn.isVisible({ timeout: 2000 }).catch(() => false)) {
    await runBtn.click().catch(() => {});
    await pause(p, 5000);   // Show data table with policies
    await scroll(p, 300);
    await pause(p, 3000);
  } else {
    await pause(p, 4000);
  }

  // Chart tab
  await tryTab(p, 'Chart');
  await pause(p, 4000);

  // AIP Analyst tab
  await tryTab(p, 'AIP Analyst');
  await pause(p, 4000);

  // ── PIPELINES ──────────────────────────────────────────────────────────
  await nav(p, 'Pipelines');
  await pause(p, 5000);   // Show all 3 pipelines

  await tryClickText(p, 'Carga de Polizas');
  await pause(p, 5000);   // Show pipeline builder

  await nav(p, 'Pipelines');
  await pause(p, 2000);
  await tryClickText(p, 'Carga de Reclamos');
  await pause(p, 5000);

  // ── LOGIC STUDIO ───────────────────────────────────────────────────────
  try {
    await nav(p, 'Logic');
    await pause(p, 4000);
  } catch {}

  // ── AGENT STUDIO — THE MAIN EVENT ─────────────────────────────────────
  await nav(p, 'Agent');
  await pause(p, 3000);

  // Click agent
  await tryClickText(p, 'Verificador de Cobertura');
  await pause(p, 3000);

  // Show Configure tab - system prompt, tools
  await tryTab(p, 'Configure');
  await pause(p, 5000);
  await scroll(p, 400);    // Scroll to see tools list
  await pause(p, 4000);
  await scroll(p, -400);
  await pause(p, 1000);

  // Switch to Test tab
  await tryTab(p, 'Test');
  await pause(p, 2000);

  // Find the test textarea (placeholder: "Type a test message for the agent...")
  const testInput = p.locator('textarea[placeholder*="test message"]').first();
  const testInputAlt = p.locator('textarea').first();
  const input = await testInput.isVisible({ timeout: 2000 }).catch(() => false) ? testInput : testInputAlt;

  if (await input.isVisible({ timeout: 3000 }).catch(() => false)) {
    // QUERY 1: Coverage verification
    await input.click();
    await input.fill('');
    await pause(p, 500);
    await input.pressSequentially(
      'La solicitud SUB-30005, esta cubierta por su poliza? Dame el detalle completo de cobertura, copago y limites.',
      { delay: 30 }
    );
    await pause(p, 1500);

    // Click "Run Test" button
    const runTestBtn = p.locator('button:has-text("Run Test")').first();
    if (await runTestBtn.isVisible({ timeout: 2000 }).catch(() => false)) {
      await runTestBtn.click();
    }

    // Wait for agent — it does multiple tool calls (~20-30s)
    // Watch for "Running..." to appear and then disappear
    try {
      await p.locator('text=Running...').first().waitFor({ timeout: 5000 });
    } catch {}
    // Now wait for it to finish
    try {
      await p.locator('button:has-text("Run Test")').first().waitFor({ timeout: 60000 });
    } catch {}
    await pause(p, 3000);

    // Scroll down to see the REASONING TRACE and FINAL RESPONSE
    await scroll(p, 300);
    await pause(p, 5000);
    await scroll(p, 300);
    await pause(p, 5000);
    await scroll(p, 300);
    await pause(p, 5000);
    // Scroll back up to see FINAL RESPONSE header
    await scroll(p, -200);
    await pause(p, 4000);

    // QUERY 2: Statistics
    await scroll(p, -800);  // Scroll back to input
    await pause(p, 1000);
    await input.click();
    await input.fill('');
    await input.pressSequentially(
      'Dame estadisticas: cuantas polizas hay por nivel? Cuantas estan vencidas? Y las solicitudes pendientes por categoria?',
      { delay: 25 }
    );
    await pause(p, 1000);

    const runTestBtn2 = p.locator('button:has-text("Run Test")').first();
    if (await runTestBtn2.isVisible({ timeout: 2000 }).catch(() => false)) {
      await runTestBtn2.click();
    }

    try {
      await p.locator('text=Running...').first().waitFor({ timeout: 5000 });
    } catch {}
    try {
      await p.locator('button:has-text("Run Test")').first().waitFor({ timeout: 60000 });
    } catch {}
    await pause(p, 3000);

    await scroll(p, 300);
    await pause(p, 5000);
    await scroll(p, 300);
    await pause(p, 5000);
    await scroll(p, 200);
    await pause(p, 5000);
  }

  // ── EVALS ──────────────────────────────────────────────────────────────
  try {
    await nav(p, 'Evals');
    await pause(p, 4000);
  } catch {}

  // ── VALUE MONITOR ──────────────────────────────────────────────────────
  try {
    await nav(p, 'Value');
    await pause(p, 4000);
  } catch {}

  // ── ACTIVITY LOG ───────────────────────────────────────────────────────
  try {
    await nav(p, 'Activity');
    await pause(p, 4000);
  } catch {}

  // ── UTILITIES ──────────────────────────────────────────────────────────
  try {
    await nav(p, 'Utilities');
    await pause(p, 4000);
  } catch {}

  // ── ACTIONS ────────────────────────────────────────────────────────────
  try {
    await nav(p, 'Actions');
    await pause(p, 4000);
  } catch {}

  // ── ADMIN ──────────────────────────────────────────────────────────────
  try {
    await nav(p, 'Admin');
    await pause(p, 5000);
  } catch {}

  // ── SETTINGS ───────────────────────────────────────────────────────────
  try {
    await nav(p, 'Settings');
    await pause(p, 4000);
  } catch {}

  // ── FINAL: Back to Ontology Graph ──────────────────────────────────────
  await nav(p, 'Ontology');
  await pause(p, 1000);
  await tryTab(p, 'Graph');
  await pause(p, 5000);
});
