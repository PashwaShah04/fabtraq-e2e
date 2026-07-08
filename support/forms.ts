import type { Page } from '@playwright/test';

export async function fillByLabel(page: Page, label: string, value: string): Promise<void> {
  await page.getByLabel(label, { exact: false }).fill(value);
}

// shadcn Select: click the trigger (a button), then the option in the listbox.
export async function selectByLabel(page: Page, triggerName: string, optionText: string): Promise<void> {
  await page.getByRole('combobox', { name: triggerName }).click();
  await page.getByRole('option', { name: optionText }).click();
}

export async function selectByAriaLabel(page: Page, ariaLabel: string, optionText: string): Promise<void> {
  await page.locator(`[aria-label="${ariaLabel}"]`).click();
  await page.getByRole('option', { name: optionText }).click();
}

export async function clickButton(page: Page, name: string): Promise<void> {
  await page.getByRole('button', { name, exact: false }).click();
}
