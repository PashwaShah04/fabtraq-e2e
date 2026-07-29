import path from 'node:path';
import { fileURLToPath } from 'node:url';
import type { Page } from '@playwright/test';

import { expect } from '../fixtures/test';
import { gotoAndExpect } from './nav';
import { fillByLabel, selectByAriaLabel, clickButton } from './forms';
import { expectToast } from './assert';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const FIXTURE_PDF = path.join(__dirname, '../fixtures/pdfs/gr=17545-b.pdf');

/**
 * Drives /designs/new -> Import from PDF -> map colour-way 1 + 2, leaving
 * colour-way 3 unmapped -> Create design. Extracted out of design-v2.spec.ts
 * (E7) so E9's visual verification can reuse the same ~50-line PDF-import
 * flow rather than rebuilding it — the design-detail "unmapped shades" badge
 * screenshot needs exactly this fixture shape.
 */
export async function importDesignWithUnmappedColourway3(
  page: Page,
  designName: string,
  quality: { id: string; code: string; name: string },
  sku: { id: string; code: string; name: string },
): Promise<string> {
  await gotoAndExpect(page, '/designs/new');
  await fillByLabel(page, 'design name', designName);

  await clickButton(page, 'Import from PDF');
  await page.getByLabel('Upload design PDF', { exact: false }).setInputFiles(FIXTURE_PDF);
  await expect(page.getByRole('heading', { name: 'Assign quality per group' })).toBeVisible({
    timeout: 60_000,
  });

  const qualityOption = `${quality.code} – ${quality.name}`;
  const groupRows: { readonly section: 'warp' | 'weft'; readonly label: string }[] = [
    { section: 'warp', label: 'A' },
    { section: 'warp', label: 'B' },
    { section: 'warp', label: 'C' },
    { section: 'warp', label: 'D' },
    { section: 'weft', label: 'A' },
  ];
  for (const g of groupRows) {
    await selectByAriaLabel(page, `quality, ${g.section} group ${g.label}`, qualityOption);
  }

  const skuOption = `${sku.name} (${sku.code})`;
  // Colour-way 1 + 2 cells (indices 0,3,6,9,12 and 1,4,7,10,13); colour-way
  // 3 (2,5,8,11,14) is deliberately left unmapped.
  const cellsToMap = [0, 3, 6, 9, 12, 1, 4, 7, 10, 13];
  for (const idx of cellsToMap) {
    await selectByAriaLabel(page, `sku, cell ${idx}`, skuOption);
  }

  await clickButton(page, 'Apply');
  await clickButton(page, 'Create design');
  await expectToast(page, /Design DSN-\d{3,} created/);
  await expect(page).toHaveURL(/\/designs\/[^/]+$/);
  return page.url().split('/').pop() as string;
}
