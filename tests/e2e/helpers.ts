import type { Page } from '@playwright/test';

export async function loginAs(page: Page, username: string, password: string): Promise<void> {
  const usernameField = page
    .locator('input[type="text"], input[id*="user"], input[name*="user"], input[name*="ur"]')
    .first();
  const passwordField = page.locator('input[type="password"]').first();
  const submitBtn = page
    .locator('button[type="submit"], button:has-text("Login"), button:has-text("Sign in")')
    .first();

  await usernameField.fill(username);
  await passwordField.fill(password);
  await submitBtn.click();
  await page.waitForLoadState('networkidle');
}
