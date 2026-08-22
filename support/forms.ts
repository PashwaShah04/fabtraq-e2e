import { expect, type Locator, type Page } from '@playwright/test';

export async function fillByLabel(page: Page, label: string, value: string): Promise<void> {
  await page.getByLabel(label, { exact: false }).fill(value);
}

// Click a select/combobox trigger, click the option, then WAIT for the option
// list to unmount before returning. The barrier matters: a just-closed
// combobox popover stays mounted for its ~180ms exit animation, so the next
// helper call's page-wide getByRole('option') can strict-mode-collide with (or
// worse, click into) the stale popover — seen live as duplicate
// "RED (SKU-001)" options in the colour-way grid and a re-map that silently
// hit the wrong popover. Do NOT scope via the trigger's aria-controls instead:
// an open Radix Select aria-hides everything outside its content — its own
// trigger included — so re-resolving the trigger after the click hangs.
async function clickTriggerThenOption(page: Page, trigger: Locator, optionText: string): Promise<void> {
  await trigger.click();
  const option = page.getByRole('option', { name: optionText });
  await option.click();
  await expect(option).toBeHidden();
}

// shadcn Select: click the trigger (a button), then the option in the listbox.
export async function selectByLabel(page: Page, triggerName: string, optionText: string): Promise<void> {
  await clickTriggerThenOption(page, page.getByRole('combobox', { name: triggerName }), optionText);
}

export async function selectByAriaLabel(page: Page, ariaLabel: string, optionText: string): Promise<void> {
  await clickTriggerThenOption(page, page.locator(`[aria-label="${ariaLabel}"]`), optionText);
}

export async function clickButton(page: Page, name: string): Promise<void> {
  await page.getByRole('button', { name, exact: false }).click();
}
