import { Page } from '@playwright/test';

export const BASE = 'http://localhost:3000';
export const EMAIL = 'admin@maic.ai';
export const PASSWORD = 'YourPassword123!';

/**
 * Log in via the 2-step login form.
 * Uses pressSequentially (not fill) to guarantee React onChange fires.
 * Retries up to 3 times if "Login failed" appears (transient auth issues).
 */
export async function login(page: Page) {
  await page.goto('/');

  // Already in the app shell?
  const quickCheck = await page.locator('nav').first().isVisible({ timeout: 2000 }).catch(() => false);
  if (quickCheck) {
    const btnCount = await page.locator('nav button').count().catch(() => 0);
    if (btnCount > 3) return;
  }

  for (let attempt = 1; attempt <= 3; attempt++) {
    // Step 1 — email field
    const emailInput = page.locator('#maic-email');
    await emailInput.waitFor({ timeout: 12000 });
    await emailInput.click();
    await emailInput.clear();
    await emailInput.pressSequentially(EMAIL, { delay: 20 });
    await page.locator('form button[type="submit"]').first().click();

    // Step 2 — password field
    const passInput = page.locator('#maic-pass');
    await passInput.waitFor({ timeout: 8000 });
    await passInput.click();
    await passInput.clear();
    await passInput.pressSequentially(PASSWORD, { delay: 15 });
    await page.waitForTimeout(150);
    await page.locator('form button[type="submit"]').first().click();

    // Wait for either success (nav) or error message
    const outcome = await Promise.race([
      page.waitForSelector(
        'nav button:has-text("Connectors"), nav button:has-text("Ontology"), nav button:has-text("Data")',
        { timeout: 10000 }
      ).then(() => 'ok'),
      page.waitForSelector(
        '#maic-error, [class*="error"]',
        { timeout: 10000 }
      ).then(() => 'error'),
    ]).catch(() => 'timeout');

    if (outcome === 'ok') {
      await page.waitForTimeout(300);
      return;
    }

    if (attempt < 3) {
      // Retry: navigate back to login page
      console.log(`[login] Attempt ${attempt} failed (${outcome}), retrying…`);
      await page.goto('/');
      await page.waitForTimeout(500);
    }
  }

  // Final attempt: wait with long timeout
  await page.waitForSelector(
    'nav button:has-text("Connectors"), nav button:has-text("Ontology"), nav button:has-text("Data")',
    { timeout: 30000 }
  );
  await page.waitForTimeout(300);
}

/**
 * Click a nav item by its label text (partial regex match).
 */
export async function navTo(page: Page, labelPattern: string | RegExp) {
  const re = typeof labelPattern === 'string' ? new RegExp(labelPattern, 'i') : labelPattern;
  const btn = page.locator('nav button').filter({ hasText: re }).first();
  await btn.waitFor({ timeout: 10000 });
  await btn.click();
  await page.waitForTimeout(600);
}
