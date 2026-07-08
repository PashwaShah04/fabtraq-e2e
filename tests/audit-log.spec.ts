import { test, expect } from '../fixtures/test';
import { gotoAndExpect } from '../support/nav';

// STUB, not functional — verified by reading source before writing this spec:
//
// - fabtraq-fe/src/features/audit/audit.page.tsx renders a static
//   <PageHeader title="Audit Log"> + <EmptyState> pair. It performs no
//   query/fetch — there is no api.ts, hooks.ts, or react-query call anywhere
//   in the audit feature folder (only audit.page.tsx exists in that dir).
//   The EmptyState copy says outright: "The audit log read endpoint has not
//   been implemented yet. Check back after the backend ships GET /audit-log."
// - fabtraq-be/src/shared/audit/audit.repository.ts (IAuditRepository) only
//   exposes a write method, `log(entry, tx?)`, used by AuditService to record
//   create/update/delete on entities (so audit_log rows ARE written on
//   mutations). There is no read/list method on the repository, and no
//   controller/route registers GET /audit-log anywhere under fabtraq-be/src.
// - fabtraq-fe/src/app/router.tsx registers `audit-log` with no RoleGuard,
//   so the page shell is reachable by any authenticated role, but it never
//   renders real audit_log rows.
//
// Per the task brief, a stub gets a shell-only assertion — no fabricated
// create→list chain the feature doesn't actually support.
test('audit log page renders its shell (read-only stub, not wired to real entries)', async ({ page }) => {
  await gotoAndExpect(page, '/audit-log');

  await expect(page.getByRole('heading', { name: 'Audit Log' })).toBeVisible();
  await expect(
    page.getByText('The audit log read endpoint has not been implemented yet. Check back after the backend ships GET /audit-log.'),
  ).toBeVisible();
});
