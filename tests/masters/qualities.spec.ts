import { test, expect } from '../../fixtures/test';
import { codes } from '../../fixtures/codes';
import { gotoAndExpect } from '../../support/nav';
import { fillByLabel, clickButton, selectByAriaLabel } from '../../support/forms';
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

// Both tests below add their SKUs under the seeded QTY-001 quality (owner of
// SKU-001 "RED"/SKU-002 "BLUE", both colourless in the seed) rather than a
// fresh quality: E2's colour-swatch comparison against the legacy SKUs only
// means something if the new SKU and the legacy ones share one SKU select.
test('SKU shade colour round-trips through create, DB storage, and the purchase select swatch', async ({
  page,
  db,
}) => {
  const quality = await db.queryOne<{ id: string; code: string; name: string }>(
    `SELECT id, code, name FROM yarn_qualities WHERE code = 'QTY-001'`,
  );
  expect(quality, 'seed must provide QTY-001, owner of legacy SKU-001/SKU-002').not.toBeNull();

  const skuName = codes.unique('SKU Colour');
  const HEX_INPUT = '#C41E3A';
  const HEX_STORED = '#c41e3a'; // D1b: FE lowercases at the mapper boundary before submit.

  // CREATE — add a SKU with a shade colour, driving both halves of the
  // control: typing in the hex text input recomputes the native colour
  // picker's controlled value (sku-form.tsx `pickerValue`).
  await gotoAndExpect(page, `/qualities/${quality!.id}/edit`);
  await page.getByRole('tab', { name: 'SKUs' }).click();
  await fillByLabel(page, 'Name', skuName);
  await page.getByTestId('shade-colour-gate').check();
  await fillByLabel(page, 'Shade colour hex', HEX_INPUT);
  await expect(page.getByLabel('Shade colour', { exact: true })).toHaveValue(HEX_STORED);
  await clickButton(page, 'Add SKU');
  await expectToast(page, 'SKU created');

  const stored = await db.queryOne<{ shade_color_hex: string | null }>(
    `SELECT shade_color_hex FROM yarn_skus WHERE name = $1`,
    [skuName],
  );
  expect(stored?.shade_color_hex).toBe(HEX_STORED);

  // REOPEN via a fresh navigation (away, then back) — assert the round-trip.
  await gotoAndExpect(page, '/qualities');
  await gotoAndExpect(page, `/qualities/${quality!.id}/edit`);
  await page.getByRole('tab', { name: 'SKUs' }).click();
  await page.getByRole('row', { name: skuName }).getByRole('button', { name: 'Edit' }).click();
  await expect(page.getByTestId('shade-colour-gate')).toBeChecked();
  await expect(page.getByLabel('Shade colour hex')).toHaveValue(HEX_STORED);
  await expect(page.getByLabel('Shade colour', { exact: true })).toHaveValue(HEX_STORED);

  // SWATCH — the purchase SKU select shows a swatch for this SKU and NONE at
  // all for the seeded legacy SKUs (D1: absence, not a fake default colour,
  // for a colourless SKU). Options are scoped by role first: sku-swatch is
  // aria-hidden and not unique across the list on its own.
  const legacySkus = await db.queryMany<{ name: string; shade_number: string | null }>(
    `SELECT name, shade_number FROM yarn_skus WHERE code IN ('SKU-001', 'SKU-002') ORDER BY code`,
  );
  expect(legacySkus).toHaveLength(2);

  await gotoAndExpect(page, '/yarn-purchases/new');
  await selectByAriaLabel(page, 'Quality for line 1', `${quality!.code} – ${quality!.name}`);
  await page.getByTestId('sku-answer-select').click();

  const coloredOption = page.getByRole('option', { name: skuName, exact: true });
  await expect(coloredOption.getByTestId('sku-swatch')).toHaveCount(1);
  // The browser reflects an inline hex background-color back as rgb(), so
  // compare against the computed style rather than the DOM's style attribute.
  const [r, g, b] = [HEX_STORED.slice(1, 3), HEX_STORED.slice(3, 5), HEX_STORED.slice(5, 7)].map((h) =>
    parseInt(h, 16),
  );
  await expect(coloredOption.getByTestId('sku-swatch')).toHaveCSS('background-color', `rgb(${r}, ${g}, ${b})`);

  for (const legacy of legacySkus) {
    const label =
      legacy.shade_number !== null && legacy.shade_number !== ''
        ? `${legacy.name} — ${legacy.shade_number}`
        : legacy.name;
    await expect(
      page.getByRole('option', { name: label, exact: true }).getByTestId('sku-swatch'),
    ).toHaveCount(0);
  }
});

test('D1a: the shade-colour gate never stamps an unset colour onto a SKU', async ({ page, db }) => {
  const quality = await db.queryOne<{ id: string; code: string; name: string }>(
    `SELECT id, code, name FROM yarn_qualities WHERE code = 'QTY-001'`,
  );
  expect(quality, 'seed must provide QTY-001, owner of legacy SKU-001').not.toBeNull();

  // STEP 1 — create a SKU without touching the colour affordance at all.
  // `<input type="color">` has no empty state (reports #000000 when
  // untouched), so a naive implementation would silently turn this black.
  const skuName = codes.unique('SKU Unset');
  await gotoAndExpect(page, `/qualities/${quality!.id}/edit`);
  await page.getByRole('tab', { name: 'SKUs' }).click();
  await fillByLabel(page, 'Name', skuName);
  await clickButton(page, 'Add SKU');
  await expectToast(page, 'SKU created');

  let stored = await db.queryOne<{ shade_color_hex: string | null }>(
    `SELECT shade_color_hex FROM yarn_skus WHERE name = $1`,
    [skuName],
  );
  expect(stored?.shade_color_hex).toBeNull();
  await expect(
    page.getByRole('row', { name: skuName }).getByTestId('shade-colour-unset'),
  ).toBeVisible();

  // All three edits below hit the same PATCH URL shape with the same
  // "SKU updated" toast text — waiting on the toast alone is a race (same
  // shape as place-stock-transfer-sync.spec.ts's documented placement-edit
  // race): if the PREVIOUS edit's toast hasn't auto-dismissed yet,
  // `expectToast` matches the stale toast instantly and the DB gets queried
  // before THIS edit's PATCH has actually committed. Wait deterministically
  // on the matching PATCH response (registered before the click) instead,
  // keyed on the request's own body so a same-shaped-but-different edit
  // can't satisfy it.
  const waitForSkuPatch = (predicate: (body: Record<string, unknown>) => boolean) =>
    page.waitForResponse((res) => {
      if (res.request().method() !== 'PATCH') return false;
      if (!res.url().includes('/skus/')) return false;
      if (res.status() !== 200) return false;
      const body = res.request().postDataJSON() as Record<string, unknown> | null;
      return body !== null && predicate(body);
    });

  // STEP 2 — edit the seeded legacy SKU-001 ("RED"), touching ONLY
  // Description. This is the exact D1a regression the gate exists to catch.
  // Never touch the colour affordance on SKU-001 here: single-spec runs do
  // not reseed, so a failure mid-cycle would permanently colour it and
  // silently break the "legacy SKUs show no swatch" assertion above on
  // every later run.
  await page.getByRole('row', { name: 'RED' }).getByRole('button', { name: 'Edit' }).click();
  await fillByLabel(page, 'Description', 'D1a regression guard');
  await Promise.all([
    waitForSkuPatch((b) => b.description === 'D1a regression guard'),
    clickButton(page, 'Update SKU'),
  ]);
  await expectToast(page, 'SKU updated');

  stored = await db.queryOne<{ shade_color_hex: string | null }>(
    `SELECT shade_color_hex FROM yarn_skus WHERE code = 'SKU-001'`,
  );
  expect(stored?.shade_color_hex).toBeNull();

  // STEP 3 — set-then-clear on THIS test's own SKU, driven through the gate
  // (`shade-colour-gate`) rather than the colour input directly, since
  // bypassing the gate is precisely what this test is meant to catch.
  await page.getByRole('row', { name: skuName }).getByRole('button', { name: 'Edit' }).click();
  await page.getByTestId('shade-colour-gate').check();
  await fillByLabel(page, 'Shade colour hex', '#1E90FF');
  await Promise.all([
    waitForSkuPatch((b) => b.shadeColorHex === '#1e90ff'),
    clickButton(page, 'Update SKU'),
  ]);
  await expectToast(page, 'SKU updated');

  stored = await db.queryOne<{ shade_color_hex: string | null }>(
    `SELECT shade_color_hex FROM yarn_skus WHERE name = $1`,
    [skuName],
  );
  expect(stored?.shade_color_hex).toBe('#1e90ff');
  // STEP 4, coloured half — the unset indicator is absent for a coloured SKU.
  await expect(
    page.getByRole('row', { name: skuName }).getByTestId('shade-colour-unset'),
  ).toHaveCount(0);

  await page.getByRole('row', { name: skuName }).getByRole('button', { name: 'Edit' }).click();
  await expect(page.getByTestId('shade-colour-gate')).toBeChecked();
  await page.getByTestId('shade-colour-gate').uncheck();
  await Promise.all([
    waitForSkuPatch((b) => b.shadeColorHex === null),
    clickButton(page, 'Update SKU'),
  ]);
  await expectToast(page, 'SKU updated');

  stored = await db.queryOne<{ shade_color_hex: string | null }>(
    `SELECT shade_color_hex FROM yarn_skus WHERE name = $1`,
    [skuName],
  );
  expect(stored?.shade_color_hex).toBeNull();
  // STEP 4, colourless half — the unset indicator is visible again, and the
  // column returned to NULL rather than '#000000'.
  await expect(
    page.getByRole('row', { name: skuName }).getByTestId('shade-colour-unset'),
  ).toBeVisible();
});
