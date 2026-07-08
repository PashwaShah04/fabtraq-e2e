import { test, expect } from '../../fixtures/test';
import { codes } from '../../fixtures/codes';
import { gotoAndExpect } from '../../support/nav';
import { fillByLabel, clickButton } from '../../support/forms';
import { expectToast } from '../../support/assert';

test('create → list → edit → persist a transporter', async ({ page }) => {
  const name = codes.transporterName();

  // CREATE — per transporter-form.page.tsx, `name` is the only required
  // field (contactPerson/mobile/vehicleNumber are optionalText, status
  // defaults to 'active'). The status Select wraps FormControl around
  // SelectTrigger directly (good a11y pattern, same as vendors' State
  // select), so it's not touched here since the default is already valid.
  await gotoAndExpect(page, '/transporters/new');
  await fillByLabel(page, 'Name', name);
  // Submit button text is just "Create" per transporter-form.page.tsx:
  // `isPending ? 'Saving…' : 'Create'` (not "Create transporter").
  await clickButton(page, 'Create');
  await expectToast(page, 'Transporter created');

  // LIST — new transporter appears
  await gotoAndExpect(page, '/transporters');
  await expect(page.getByRole('cell', { name })).toBeVisible();

  // EDIT — row's action cell renders an "Edit" <a> (react-router Link via
  // Button asChild), per fabtraq-fe/src/features/transporters/columns.tsx —
  // same shape as job-workers' and qualities' columns.tsx.
  await page.getByRole('row', { name }).getByRole('link', { name: 'Edit' }).click();
  await expect(page).toHaveURL(/\/transporters\/[^/]+\/edit/);
  await fillByLabel(page, 'Contact Person', 'E2E Contact EDITED');
  // Submit button text is "Save" on the edit form (not "Update transporter").
  await clickButton(page, 'Save');
  await expectToast(page, 'Transporter updated');

  // PERSIST — re-open the same transporter's edit form via a fresh fetch
  // and verify the field that was actually edited (Contact Person), not
  // just the untouched name still being present in the list.
  await gotoAndExpect(page, '/transporters');
  await page.getByRole('row', { name }).getByRole('link', { name: 'Edit' }).click();
  await expect(page).toHaveURL(/\/transporters\/[^/]+\/edit/);
  await expect(page.getByLabel('Contact Person')).toHaveValue('E2E Contact EDITED');
});
