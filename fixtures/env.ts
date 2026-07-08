export const env = {
  DATABASE_URL:
    process.env.DATABASE_URL ??
    'postgresql://fabtraq:fabtraq_dev@localhost:5432/fabtraq_dev',
  BASE_URL: process.env.E2E_BASE_URL ?? 'http://localhost:5173',
  API_URL: process.env.E2E_API_URL ?? 'http://localhost:4000',
  OWNER: { email: 'owner@fabtraq.local', password: 'Fabtraq#2026' },
  STOREKEEPER: { email: 'storekeeper@fabtraq.local', password: 'Fabtraq#2026' },
  ACCOUNTANT: { email: 'accountant@fabtraq.local', password: 'Fabtraq#2026' },
} as const;
