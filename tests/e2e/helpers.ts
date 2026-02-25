import { expect } from '@playwright/test';
import type { Page } from '@playwright/test';

export async function loginAs(page: Page, username: string, password: string): Promise<void> {
  const usernameField = page
    .locator('input[autocomplete="username"], input[id*="user" i], input[name*="user" i], input[placeholder*="user" i]')
    .first();
  const passwordField = page.locator('input[type="password"]').first();
  const submitBtn = page.getByRole('button', { name: /login|sign in/i }).first();

  await usernameField.fill(username);
  await passwordField.fill(password);
  await submitBtn.click();
  await expect(
    page.locator('[role="tab"], .tab, button:has-text("Signer"), button:has-text("Configure")').first(),
    'login failed: expected dashboard tabs after submit'
  ).toBeVisible({ timeout: 10_000 });
}
