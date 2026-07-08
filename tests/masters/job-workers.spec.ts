import { test, expect } from '../../fixtures/test';
import { codes } from '../../fixtures/codes';
import { gotoAndExpect } from '../../support/nav';
import { fillByLabel, selectByLabel, clickButton } from '../../support/forms';
import { expectToast } from '../../support/assert';

test('create → list → edit → persist a job worker', async ({ page }) => {
  const name = codes.jobWorkerName();

  // CREATE
  await gotoAndExpect(page, '/job-workers/new');
  await fillByLabel(page, 'Name', name);
  await fillByLabel(page, 'Contact Person', 'E2E Contact');
  // State is a shadcn Select; job-worker-form.page.tsx wraps <FormControl>
  // around <SelectTrigger> directly (same good pattern as vendors' State
  // select, not the qualities-form a11y bug), so the trigger gets an
  // accessible name via FormLabel's htmlFor.
  await selectByLabel(page, 'State', 'Gujarat');
  // jobWorkTypes is a required non-empty array, rendered as a plain
  // checkbox group (role="group", aria-label "Job work types") — not a
  // shadcn Select. Each <input type="checkbox"> is wrapped in a <label>
  // with visible text, which gives it an accessible name via getByRole.
  await page.getByRole('checkbox', { name: 'Twisting' }).check();
  // Submit button text is just "Create" (not "Create job worker") per
  // job-worker-form.page.tsx: `isPending ? 'Saving…' : isEdit ? 'Update' : 'Create'`.
  await clickButton(page, 'Create');
  await expectToast(page, 'Job worker created');

  // LIST — new job worker appears
  await gotoAndExpect(page, '/job-workers');
  await expect(page.getByRole('cell', { name })).toBeVisible();

  // EDIT — row's action cell renders an "Edit" <a> (react-router Link via
  // Button asChild), per fabtraq-fe/src/features/job-workers/columns.tsx —
  // same shape as qualities' columns.tsx (a link, not a plain button).
  await page.getByRole('row', { name }).getByRole('link', { name: 'Edit' }).click();
  await expect(page).toHaveURL(/\/job-workers\/[^/]+\/edit/);
  await fillByLabel(page, 'Contact Person', 'E2E Contact EDITED');
  // Submit button text is "Update" on the edit form.
  await clickButton(page, 'Update');
  await expectToast(page, 'Job worker updated');

  // PERSIST — re-open the same job worker's edit form via a fresh fetch and
  // verify the field that was actually edited (Contact Person), not just
  // the untouched name still being present in the list.
  await gotoAndExpect(page, '/job-workers');
  await page.getByRole('row', { name }).getByRole('link', { name: 'Edit' }).click();
  await expect(page).toHaveURL(/\/job-workers\/[^/]+\/edit/);
  await expect(page.getByLabel('Contact Person')).toHaveValue('E2E Contact EDITED');
});
