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

// Native <select> (not a shadcn Select — e.g. jw-challan-out-form.page.tsx's
// "Job worker" field is a plain HTML <select aria-label="Job worker">). Native
// select popups are an OS-level widget, not a DOM listbox, so the
// click-trigger-then-click-option pattern used for shadcn Selects above does not
// reliably open/interact with them under Playwright — use selectOption() instead.
// `optionLabel` must match the rendered <option> text exactly (selectOption's
// `label` match is exact, not substring).
export async function selectNativeByLabel(
  page: Page,
  label: string,
  optionLabel: string,
): Promise<void> {
  await page.getByLabel(label, { exact: false }).selectOption({ label: optionLabel });
}

export async function clickButton(page: Page, name: string): Promise<void> {
  await page.getByRole('button', { name, exact: false }).click();
}
