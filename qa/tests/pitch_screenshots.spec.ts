/**
 * pitch_screenshots.spec.ts
 * Takes screenshots of key Nexus screens for the pitch deck.
 * Tenant: tenant-finance
 */

import { test, expect } from '@playwright/test';
import { login, navTo } from './helpers';
import * as path from 'path';

const OUTDIR = path.resolve(__dirname, '../results/pitch');
const TENANT = 'tenant-finance';

// APIs
const CONNECTOR_API = 'http://localhost:8001';
const ONTOLOGY_API  = 'http://localhost:8004';
const PIPELINE_API  = 'http://localhost:8002';

test.describe.configure({ mode: 'serial' });

// Helper: set tenant in localStorage
async function setTenant(page: any) {
  await page.evaluate((t: string) => {
    localStorage.setItem('nexus_tenant_id', t);
    localStorage.setItem('tenantId', t);
  }, TENANT);
}

async function shot(page: any, name: string) {
  await page.waitForTimeout(1500);
  await page.screenshot({ path: path.join(OUTDIR, `${name}.png`), fullPage: false });
  console.log(`[screenshot] ${name}.png`);
}

test('login and set tenant', async ({ page }) => {
  await login(page);
  await setTenant(page);
  await page.reload();
  await page.waitForTimeout(2000);
});

test('01 - Connectors list', async ({ page }) => {
  await login(page);
  await setTenant(page);
  await page.reload();
  await page.waitForTimeout(1000);
  await navTo(page, 'Connectors');
  await page.waitForTimeout(2000);
  await shot(page, '01_connectors_list');
});

test('02 - Connector detail', async ({ page }) => {
  await login(page);
  await setTenant(page);
  await page.reload();
  await page.waitForTimeout(1000);
  await navTo(page, 'Connectors');
  await page.waitForTimeout(1500);
  // Click the first connector row
  const row = page.locator('table tbody tr, [class*="connector"] [class*="card"], [class*="row"]').first();
  if (await row.isVisible({ timeout: 3000 }).catch(() => false)) {
    await row.click();
    await page.waitForTimeout(2000);
  }
  await shot(page, '02_connector_detail');
});

test('03 - Pipelines list', async ({ page }) => {
  await login(page);
  await setTenant(page);
  await page.reload();
  await page.waitForTimeout(1000);
  await navTo(page, 'Pipelines');
  await page.waitForTimeout(2000);
  await shot(page, '03_pipelines_list');
});

test('04 - Pipeline graph', async ({ page }) => {
  await login(page);
  await setTenant(page);
  await page.reload();
  await page.waitForTimeout(1000);
  await navTo(page, 'Pipelines');
  await page.waitForTimeout(1500);
  // Click first pipeline
  const row = page.locator('table tbody tr, [class*="pipeline"] [class*="card"], [class*="row"]').first();
  if (await row.isVisible({ timeout: 3000 }).catch(() => false)) {
    await row.click();
    await page.waitForTimeout(2000);
  }
  // Look for graph/visual tab
  const graphTab = page.locator('button:has-text("Graph"), button:has-text("Visual"), button:has-text("DAG"), [role="tab"]:has-text("Graph")').first();
  if (await graphTab.isVisible({ timeout: 2000 }).catch(() => false)) {
    await graphTab.click();
    await page.waitForTimeout(2000);
  }
  await shot(page, '04_pipeline_graph');
});

test('05 - Ontology / Object Types', async ({ page }) => {
  await login(page);
  await setTenant(page);
  await page.reload();
  await page.waitForTimeout(1000);
  // Try different nav names
  const navOptions = ['Ontology', 'Data', 'Object'];
  for (const n of navOptions) {
    try {
      await navTo(page, n);
      break;
    } catch { /* try next */ }
  }
  await page.waitForTimeout(2000);
  await shot(page, '05_ontology_list');
});

test('06 - Object type records', async ({ page }) => {
  await login(page);
  await setTenant(page);
  await page.reload();
  await page.waitForTimeout(1000);
  const navOptions = ['Ontology', 'Data', 'Object'];
  for (const n of navOptions) {
    try {
      await navTo(page, n);
      break;
    } catch { /* try next */ }
  }
  await page.waitForTimeout(1500);
  // Click first object type
  const row = page.locator('table tbody tr, [class*="object"] [class*="card"], [class*="row"]').first();
  if (await row.isVisible({ timeout: 3000 }).catch(() => false)) {
    await row.click();
    await page.waitForTimeout(2000);
  }
  await shot(page, '06_object_records');
});

test('07 - Data Explorer', async ({ page }) => {
  await login(page);
  await setTenant(page);
  await page.reload();
  await page.waitForTimeout(1000);
  try { await navTo(page, 'Explorer'); } catch {
    try { await navTo(page, 'Data'); } catch { /* skip */ }
  }
  await page.waitForTimeout(2000);
  await shot(page, '07_data_explorer');
});

test('08 - Agent Studio', async ({ page }) => {
  await login(page);
  await setTenant(page);
  await page.reload();
  await page.waitForTimeout(1000);
  await navTo(page, 'Agent');
  await page.waitForTimeout(2000);
  await shot(page, '08_agent_studio');
});

test('09 - Agent conversation', async ({ page }) => {
  await login(page);
  await setTenant(page);
  await page.reload();
  await page.waitForTimeout(1000);
  await navTo(page, 'Agent');
  await page.waitForTimeout(1500);
  // Click first agent if available
  const agentRow = page.locator('table tbody tr, [class*="agent"] [class*="card"], [class*="row"]').first();
  if (await agentRow.isVisible({ timeout: 3000 }).catch(() => false)) {
    await agentRow.click();
    await page.waitForTimeout(1500);
  }
  // Look for test/chat button
  const testBtn = page.locator('button:has-text("Test"), button:has-text("Chat"), button:has-text("Run")').first();
  if (await testBtn.isVisible({ timeout: 2000 }).catch(() => false)) {
    await testBtn.click();
    await page.waitForTimeout(1500);
  }
  await shot(page, '09_agent_chat');
});

test('10 - Process Intelligence', async ({ page }) => {
  await login(page);
  await setTenant(page);
  await page.reload();
  await page.waitForTimeout(1000);
  try { await navTo(page, 'Process'); } catch {
    try { await navTo(page, 'Mining'); } catch { /* skip */ }
  }
  await page.waitForTimeout(2000);
  await shot(page, '10_process_mining');
});

test('11 - Graph Explorer', async ({ page }) => {
  await login(page);
  await setTenant(page);
  await page.reload();
  await page.waitForTimeout(1000);
  try { await navTo(page, 'Graph'); } catch {
    try { await navTo(page, 'Knowledge'); } catch { /* skip */ }
  }
  await page.waitForTimeout(2000);
  await shot(page, '11_graph_explorer');
});

test('12 - Admin / Platform Health', async ({ page }) => {
  await login(page);
  await setTenant(page);
  await page.reload();
  await page.waitForTimeout(1000);
  try { await navTo(page, 'Admin'); } catch {
    try { await navTo(page, 'Health'); } catch {
      try { await navTo(page, 'Platform'); } catch { /* skip */ }
    }
  }
  await page.waitForTimeout(2000);
  await shot(page, '12_admin_health');
});
