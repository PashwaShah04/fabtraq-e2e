import { test, expect } from '../../fixtures/test';
import { codes } from '../../fixtures/codes';
import { gotoAndExpect } from '../../support/nav';
import { fillByLabel, clickButton } from '../../support/forms';
import { expectToast } from '../../support/assert';

test('create with floors field-array → list → edit → persist a location', async ({ page }) => {
  const name = codes.locationName();
  const floor1 = codes.unique('Ground Floor');
  const floor2 = codes.unique('First Floor');

  // CREATE — createLocationSchema requires a nonempty floors array, so the
  // floors field-array must be populated before submit (unlike qualities'
  // SKUs, which are added via a separate post-create API call, floors are
  // plain react-hook-form useFieldArray rows submitted with the main form).
  await gotoAndExpect(page, '/locations/new');
  await fillByLabel(page, 'Name', name);

  // Floor rows: floor-row.tsx gives each row's Input an
  // aria-label="Floor {n} name" (not a <FormLabel>/htmlFor pairing), so
  // getByLabel resolves it directly — no accessible-name gap here, unlike
  // quality-form.page.tsx's Select-wrapping bug noted in qualities.spec.ts.
  await clickButton(page, 'Add floor');
  await fillByLabel(page, 'Floor 1 name', floor1);
  await clickButton(page, 'Add floor');
  await fillByLabel(page, 'Floor 2 name', floor2);

  // Submit button text is "Create location" (lowercase l) on the new-location form.
  await clickButton(page, 'Create location');
  await expectToast(page, 'Location created');

  // LIST — new location appears
  await gotoAndExpect(page, '/locations');
  await expect(page.getByRole('cell', { name })).toBeVisible();

  // EDIT — row's action cell renders an "Edit" <a> (react-router Link via
  // Button asChild), per fabtraq-fe/src/features/locations/columns.tsx.
  await page.getByRole('row', { name }).getByRole('link', { name: 'Edit' }).click();
  await expect(page).toHaveURL(/\/locations\/[^/]+\/edit/);

  // The backend returns floors ORDER BY name ASC (confirmed via server
  // query log), so a fresh fetch does NOT preserve creation order — the
  // "Floor 1 name" / "Floor 2 name" aria-labels are positional (field-array
  // index), not tied to which floor was added first. Resolve rows by their
  // current value instead of assuming a slot, then confirm both floors that
  // were added actually saved.
  const row1 = page.getByLabel('Floor 1 name', { exact: false });
  const row2 = page.getByLabel('Floor 2 name', { exact: false });
  const row1Value = await row1.inputValue();
  const floor1Input = row1Value === floor1 ? row1 : row2;
  const floor2Input = row1Value === floor1 ? row2 : row1;
  await expect(floor1Input).toHaveValue(floor1);
  await expect(floor2Input).toHaveValue(floor2);

  // Edit floor 1's name — this is the field we'll re-verify post-persist per
  // the MASTER-CRUD PERSISTENCE RULE (must re-verify the EDITED field, not
  // an untouched one like the location name).
  const floor1Edited = `${floor1} EDITED`;
  await floor1Input.fill(floor1Edited);

  // Submit button text is "Update location" on the edit form.
  await clickButton(page, 'Update location');
  await expectToast(page, 'Location updated');

  // PERSIST — re-open the same location's edit form via a fresh fetch and
  // verify the field that was actually edited (the renamed floor), and
  // that the other floor is still present. Resolve rows by value again —
  // the sort order may again differ from the previous fetch.
  await gotoAndExpect(page, '/locations');
  await page.getByRole('row', { name }).getByRole('link', { name: 'Edit' }).click();
  await expect(page).toHaveURL(/\/locations\/[^/]+\/edit/);
  const pRow1 = page.getByLabel('Floor 1 name', { exact: false });
  const pRow2 = page.getByLabel('Floor 2 name', { exact: false });
  const pRow1Value = await pRow1.inputValue();
  const editedInput = pRow1Value === floor1Edited ? pRow1 : pRow2;
  const otherInput = pRow1Value === floor1Edited ? pRow2 : pRow1;
  await expect(editedInput).toHaveValue(floor1Edited);
  await expect(otherInput).toHaveValue(floor2);
});
