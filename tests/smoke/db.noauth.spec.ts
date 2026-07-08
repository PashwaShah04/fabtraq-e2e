import { test, expect } from '../../fixtures/test';

test('ledgerBalance returns a finite number for an empty key', async ({ db }) => {
  // A random non-existent lot must sum to 0 (no rows), not throw.
  const bal = await db.ledgerBalance({ lotNumber: 'NO-SUCH-LOT-zzz' });
  expect(bal).toBe(0);
});

test('ledgerRowExists is false for a non-existent key', async ({ db }) => {
  expect(await db.ledgerRowExists({ lotNumber: 'NO-SUCH-LOT-zzz' })).toBe(false);
});
