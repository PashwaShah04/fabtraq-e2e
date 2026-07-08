import { test, expect } from '../../fixtures/test';
import { codes } from '../../fixtures/codes';
import { gotoAndExpect } from '../../support/nav';
import { fillByLabel, clickButton } from '../../support/forms';
import { expectToast } from '../../support/assert';

test('create → SKU field-array → list → edit → persist a quality', async ({ page }) => {
  const name = codes.qualityName();
  // The SKU form (sku-form.tsx) has no "code" input — the code (format
  // SKU-NNN) is server-generated and only appears in the response/list.
  // codes.skuCode() is therefore not used to fill a field; we use a
  // unique SKU *name* instead and assert the rendered code against the
  // documented format.
  const skuName = codes.unique('SKU Shade');

  // CREATE
  await gotoAndExpect(page, '/qualities/new');
  await fillByLabel(page, 'Name', name);
  // Category / Default Unit / Status are shadcn Selects left at their form
  // defaults (cotton / KG / active). Unlike vendors' State select — where
  // <FormControl> wraps <SelectTrigger> directly, giving the trigger an
  // accessible name via FormLabel's htmlFor — quality-form.page.tsx wraps
  // <FormControl> around the outer <Select> root instead (a real FE bug:
  // Radix's id prop on Select.Root isn't forwarded to the trigger DOM node),
  // so these triggers have NO accessible name and are not selectByLabel-able.
  // Routed around by not needing to change them; not fixed here (out of
  // scope for this spec — see task report for the cross-repo note).
  await fillByLabel(page, 'HSN Code', '52051200');
  // Submit button text is "Create Quality" (capital Q) on the new-quality
  // form — differs from vendors' "Create vendor" (lowercase v).
  await clickButton(page, 'Create Quality');
  await expectToast(page, 'Quality created');

  // Create redirects straight to the edit page — the SKUs tab only becomes
  // enabled once the quality has an id (TabsTrigger disabled={!isEditing}
  // in quality-form.page.tsx), so SKUs cannot be added inline during create.
  await expect(page).toHaveURL(/\/qualities\/[^/]+\/edit/);

  // SKU FIELD-ARRAY — add a SKU row under the SKUs tab.
  await page.getByRole('tab', { name: 'SKUs' }).click();
  await fillByLabel(page, 'Name', skuName);
  await clickButton(page, 'Add SKU');
  await expectToast(page, 'SKU created');
  await expect(
    page.getByRole('row', { name: skuName }).getByRole('cell', { name: /^SKU-\d{3,}$/ }),
  ).toBeVisible();

  // LIST — new quality appears
  await gotoAndExpect(page, '/qualities');
  await expect(page.getByRole('cell', { name })).toBeVisible();

  // EDIT — row's action cell renders an "Edit" <a> (react-router Link via
  // Button asChild), per fabtraq-fe/src/features/qualities/columns.tsx —
  // unlike vendors' columns.tsx, which renders a plain <button>.
  await page.getByRole('row', { name }).getByRole('link', { name: 'Edit' }).click();
  await expect(page).toHaveURL(/\/qualities\/[^/]+\/edit/);
  await fillByLabel(page, 'HSN Code', '52051300');
  // Submit button text is "Update Quality" on the edit form.
  await clickButton(page, 'Update Quality');
  await expectToast(page, 'Quality updated');

  // PERSIST — re-open the same quality's edit form via a fresh fetch and
  // verify the field that was actually edited (HSN Code), not just the
  // untouched name still being present in the list.
  await gotoAndExpect(page, '/qualities');
  await page.getByRole('row', { name }).getByRole('link', { name: 'Edit' }).click();
  await expect(page).toHaveURL(/\/qualities\/[^/]+\/edit/);
  await expect(page.getByLabel('HSN Code')).toHaveValue('52051300');

  // The SKU added earlier also persists — re-verify via a fresh fetch of
  // the SKUs tab, and re-assert the auto-generated code format.
  await page.getByRole('tab', { name: 'SKUs' }).click();
  await expect(
    page.getByRole('row', { name: skuName }).getByRole('cell', { name: /^SKU-\d{3,}$/ }),
  ).toBeVisible();
});
