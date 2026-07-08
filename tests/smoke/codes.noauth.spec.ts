import { test, expect } from '@playwright/test';
import { codes } from '../../fixtures/codes';

test('skuCode matches shared schema regex and is unique', () => {
  const a = codes.skuCode();
  const b = codes.skuCode();
  expect(a).toMatch(/^SKU-[0-9]{3,}$/);
  expect(b).toMatch(/^SKU-[0-9]{3,}$/);
  expect(a).not.toBe(b);
});

test('unique() prefixes are distinct', () => {
  expect(codes.unique('vendor')).not.toBe(codes.unique('vendor'));
});
