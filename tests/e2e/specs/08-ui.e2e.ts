/**
 * Browser UI smoke tests – uses Playwright's full browser to exercise the SPA.
 *
 * Prerequisites: `bun run build` must have been run so static/app.js exists.
 * The server is already running (started in global-setup).
 */

import { test, expect } from '@playwright/test';
import { loginAs } from '../helpers.js';
import { loadState } from '../state.js';
import type { SmokeTestState } from '../state.js';

const state: SmokeTestState = loadState();
const { baseUrl, adminUsername, adminPassword } = state;

test.describe('UI – Login page', () => {
  test('/ renders the login form when not authenticated', async ({ page }) => {
    await page.goto(baseUrl);
    // The SPA should show either the login form or onboarding
    // Since onboarding is complete, we expect the login form
    await expect(page).toHaveURL(new URL('/', baseUrl).toString());
    // Login form has username + password inputs
    await expect(page.locator('input[type="text"], input[id*="user"], input[name*="user"]').first()).toBeVisible({
      timeout: 10_000,
    });
    await expect(page.locator('input[type="password"]').first()).toBeVisible();
  });

  test('login form accepts credentials and navigates to dashboard', async ({ page }) => {
    await page.goto(baseUrl);
    await loginAs(page, adminUsername, adminPassword);

    // After login we should see the main app tabs
    await expect(page.locator('[role="tab"], .tab, button:has-text("Signer"), button:has-text("Configure")').first()).toBeVisible({
      timeout: 10_000,
    });
  });
});

test.describe('UI – Authenticated app', () => {
  // Log in once per test block using page fixtures (each test gets a fresh page)
  test.beforeEach(async ({ page }) => {
    await page.goto(baseUrl);
    await loginAs(page, adminUsername, adminPassword);
  });

  test('Signer tab is visible and shows node status indicator', async ({ page }) => {
    // The Signer tab or its content should be visible after login
    const signerTab = page.locator('[role="tab"]:has-text("Signer"), button:has-text("Signer"), a:has-text("Signer")').first();
    await expect(signerTab).toBeVisible({ timeout: 8_000 });
    await signerTab.click();
    await expect(page.locator('body')).toContainText(/server signer:\s*(running|starting|stopped)/i, { timeout: 8_000 });
    await expect(page.locator('body')).toContainText(/\bnode\s+(active|inactive)\b/i, { timeout: 8_000 });
  });

  test('Configure tab is accessible', async ({ page }) => {
    const configureTab = page
      .locator('[role="tab"]:has-text("Configure"), button:has-text("Configure"), a:has-text("Configure")')
      .first();
    await expect(configureTab).toBeVisible({ timeout: 8_000 });
    await configureTab.click();
    // After clicking, the configure panel content should appear
    await page.waitForLoadState('networkidle');
    // Scope to likely configure containers to avoid matching unrelated page inputs.
    const configContent = page.locator(
      '[role="tabpanel"] input, [role="tabpanel"] textarea, [role="tabpanel"] [data-testid*="cred"], [data-testid*="config"] input, [data-testid*="config"] textarea, [id*="config"] input, [id*="config"] textarea'
    ).first();
    await expect(configContent).toBeVisible({ timeout: 8_000 });
  });

  test('API Keys tab is accessible', async ({ page }) => {
    const apiKeysTab = page
      .locator('[role="tab"]:has-text("API Keys"), [role="tab"]:has-text("Api Keys"), button:has-text("API Keys")')
      .first();
    await expect(apiKeysTab).toBeVisible({ timeout: 8_000 });
    await apiKeysTab.click();
    await page.waitForLoadState('networkidle');
    // The tab panel should render without error
    await expect(page.locator('body')).not.toContainText('Something went wrong', { timeout: 5_000 });
  });

  test('Event Log section is visible on Signer tab and shows no errors', async ({ page }) => {
    // The Event Log is a collapsible section embedded in the Signer tab (not a top-level tab).
    // It renders a div with role="button" and a span containing "Event Log".
    const eventLogToggle = page.locator('[role="button"]:has-text("Event Log")').first();
    await expect(eventLogToggle).toBeVisible({ timeout: 8_000 });
    await eventLogToggle.click();
    await page.waitForLoadState('networkidle');
    await expect(page.locator('body')).not.toContainText('Something went wrong', { timeout: 5_000 });
  });

  test('Logout button signs out and returns to login', async ({ page }) => {
    // Find and click a logout button
    const logoutBtn = page
      .locator('button:has-text("Logout"), button:has-text("Sign out"), a:has-text("Logout"), [aria-label*="logout" i]')
      .first();
    await expect(logoutBtn).toBeVisible({ timeout: 8_000 });
    await logoutBtn.click();
    await page.waitForLoadState('networkidle');

    // Should be back at the login form
    await expect(page.locator('input[type="password"]').first()).toBeVisible({ timeout: 8_000 });
  });
});

test.describe('UI – Onboarding already completed', () => {
  test('/ does not show onboarding when DB is initialised', async ({ page }) => {
    await page.goto(baseUrl);
    // Specific onboarding copy should not appear once DB is initialized.
    await expect(page.locator('body')).not.toContainText(/enter the admin secret to begin setting up your igloo server/i, { timeout: 6_000 });
    await expect(page.locator('body')).not.toContainText(/create your admin account to secure your igloo server/i, { timeout: 6_000 });
  });
});
