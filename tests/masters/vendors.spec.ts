import { test, expect } from '../../fixtures/test';
import { codes } from '../../fixtures/codes';
import { gotoAndExpect } from '../../support/nav';
import { fillByLabel, selectByLabel, clickButton } from '../../support/forms';
import { expectToast } from '../../support/assert';

test('create → list → edit → persist a vendor', async ({ page }) => {
  const name = codes.vendorName();

  // CREATE
  await gotoAndExpect(page, '/vendors/new');
  await fillByLabel(page, 'Name', name);
  await fillByLabel(page, 'Contact Person', 'E2E Contact');
  await fillByLabel(page, 'Phone', '9876543210');
  // State is a shadcn Select; the FormLabel "State" labels the combobox
  // trigger via htmlFor, and options render the full state name.
  await selectByLabel(page, 'State', 'Gujarat');
  // Submit button text is "Create vendor" on the new-vendor form (not "Save").
  await clickButton(page, 'Create vendor');
  await expectToast(page, 'Vendor created');

  // LIST — new vendor appears
  await gotoAndExpect(page, '/vendors');
  await expect(page.getByRole('cell', { name })).toBeVisible();

  // EDIT — row's action cell renders an "Edit" <button> (not a link), per
  // fabtraq-fe/src/features/vendors/columns.tsx. The TableRow has role="row"
  // and its accessible name is computed from its cell contents.
  await page.getByRole('row', { name }).getByRole('button', { name: 'Edit' }).click();
  await expect(page).toHaveURL(/\/vendors\/[^/]+\/edit/);
  await fillByLabel(page, 'Contact Person', 'E2E Contact EDITED');
  // Submit button text is "Update vendor" on the edit form.
  await clickButton(page, 'Update vendor');
  await expectToast(page, 'Vendor updated');

  await gotoAndExpect(page, '/vendors');
  await expect(page.getByRole('cell', { name })).toBeVisible();
});
