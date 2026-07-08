import { test as base, expect } from '@playwright/test';
import { Db } from './db';

export const test = base.extend<{ db: Db }>({
  db: async ({}, use) => {
    const db = new Db();
    await use(db);
    await db.close();
  },
});

export { expect };
