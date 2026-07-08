import { test, expect } from '../../fixtures/test';
import { codes } from '../../fixtures/codes';
import { gotoAndExpect } from '../../support/nav';
import { fillByLabel, selectByAriaLabel, clickButton } from '../../support/forms';
import { expectToast } from '../../support/assert';

// Designs have NO edit route (recipe is immutable after create — BR-S4, see
// createDesignSchema's doc comment in fabtraq-shared). The row leads to a
// read-only detail page, so this spec is create → detail, not the usual
// master-CRUD create → list → edit → persist shape.
test('create (owner, role-guarded) a design and view its detail', async ({ page, db }) => {
  // design-form.page.tsx has no "code" input — the code (format DSN-NNN) is
  // server-generated (designCodeSchema). codes.designCode() therefore fills
  // the form's only text field, "Name" (mirrors how the qualities spec uses
  // codes.skuCode() only for a unique string, not the actual SKU code field).
  const name = codes.designCode();

  // Recipe items reference an existing active YarnQuality via a shadcn
  // Select (RecipeFieldArray.tsx) — the design form has no inline way to
  // create a quality. Like stock-transfer.spec.ts's floor lookup, derive a
  // real one from the seed rather than hand-rolling an id.
  const quality = await db.queryOne<{ code: string; name: string }>(
    `SELECT code, name FROM yarn_qualities WHERE status = 'active' ORDER BY code LIMIT 1`,
  );
  expect(quality, 'seed must provide at least one active yarn quality').not.toBeNull();

  // CREATE
  await gotoAndExpect(page, '/designs/new');
  // The "Name" <label> is overridden by an explicit aria-label="design name"
  // on the Input itself (design-form.page.tsx) — accessible name computation
  // gives aria-label precedence, so match on that rather than the label text.
  await fillByLabel(page, 'design name', name);

  await clickButton(page, 'Add ingredient');
  // Quality select's SelectTrigger carries its accessible name via a raw
  // aria-label (not a FormLabel htmlFor), per RecipeFieldArray.tsx — use
  // selectByAriaLabel, not selectByLabel.
  await selectByAriaLabel(page, 'quality, recipe row 1', `${quality!.code} – ${quality!.name}`);
  // SKU select already defaults to "No colour (plain)" (skuId stays
  // undefined in form state) — no interaction needed for the optional field.
  // Percentage must sum to 100 across all recipe items (createDesignSchema
  // superRefine); a single 100% row satisfies it.
  await page.getByLabel('percentage, recipe row 1').fill('100');

  await clickButton(page, 'Create design');
  await expectToast(page, /Design DSN-\d{3,} created/);

  // LIST — new design appears; follow its row into the detail page (no edit
  // route exists — columns.tsx renders a "View" link to /designs/:id).
  await gotoAndExpect(page, '/designs');
  await page.getByRole('row', { name }).getByRole('link', { name: 'View' }).click();
  await expect(page).toHaveURL(/\/designs\/[^/]+$/);

  // DETAIL — design-detail.page.tsx renders PageHeader title=name,
  // subtitle=code (design-detail.page.tsx / PageHeader.tsx).
  await expect(page.getByRole('heading', { name })).toBeVisible();
  await expect(page.getByText(/^DSN-\d{3,}$/)).toBeVisible();
});
