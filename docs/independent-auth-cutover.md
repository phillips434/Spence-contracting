# Independent authentication cutover

Contractor Desk uses PostgreSQL-backed credentials and opaque secure HttpOnly session cookies. Signup requires email verification. Existing users activate credentials through an emailed password setup link; their identity strings and company memberships are preserved. The historic PostgreSQL column `firebase_uid` is an identifier only and makes no Firebase network request.

## Production status — October 5, 2026

- Independent authentication, additive migration 009 and SMTP are deployed. SMTP authentication, real password setup delivery and account completion were verified live.
- Production backend health identifies PostgreSQL database `railway`. Dashboard projects and estimates render. Business records were preserved through the cutover.
- The production runtime and the three retired app previews have no Firebase-related environment variable names. Public previews return HTTP 410.
- Legacy public Firebase import/audit services and migration diagnostics are retired. No active import path remains in those services.
- A read-only scan of all 30 public PostgreSQL tables found no Firebase attachment URLs. This verifies the scanned database, not deletion of historical external resources.
- A production volume backup and PostgreSQL PITR are available. An isolated restore previously matched all 30 table counts and full-row hashes. Production was not restored in place.

## Configuration

`CD_APP_ORIGIN=https://app.getcontractordesk.com`, `SMTP_HOST`, `SMTP_PORT`, `SMTP_USER`, `SMTP_PASSWORD` and `AUTH_EMAIL_FROM` are configured in Railway. Never commit secrets or log account tokens/passwords. Google app passwords belong only in the SMTP secret configuration; they do not replace the user's normal Google or Contractor Desk password.

Migration `db/migrations/009_independent_auth.sql` is additive and idempotent. The production predeploy guard verifies SMTP and business-record preservation before starting the app.

## Validation

Authentication integration tests cover verified signup, invitation membership, existing-account password setup, revoked memberships, logout, reset invalidation, token replay, cross-origin rejection and rejection of former bearer tokens. Browser checks cover core project/estimate save and persistence paths. Production synthetic kitchen and MasterRib fixtures are marked test/nonbinding; no customer communication or contract was sent.

Estimate generation separates direct material cost from person-hour labor, enforces the company rate, recomputes new direct totals, allows a bounded 120-second request and preserves initial price rows after intake. Rectangular material takeoffs use explicit measurement references; the server computes square feet, opening deductions and waste. Unknown references, duplicate references, invalid deductions and measured metal-panel rows without a takeoff are rejected without applying changes. Existing updateItems are not rewritten by this calculator.

## Controlled beta operating requirements

A contractor must review scope, selected surfaces, measurements, quantities, waste, labor and unit costs before sending an estimate. Rectangular takeoff arithmetic is deterministic; selecting the correct surfaces and interpreting construction scope still requires review. Unlabelled dimensions are not silently treated as feet. Roof slope, derived perimeters, labor productivity and supplier prices are not validated by the rectangular calculator.

Keep beta participation limited and supervised. Use test/nonbinding fixtures for testing; preserve real projects and estimates. Confirm email delivery for new participants and their company access before they use customer records.

## External shutdown still requires verification

The original Firebase project has not been inspected through an authenticated administrator session. Its remaining credentials, billing and resource deletion status are unknown. The current app's independence does not prove that the historical Firebase project is empty or shut down. Identify the correct former project and verify migration/backups before revoking credentials or permanently deleting resources. Never delete production PostgreSQL records as part of this cleanup.
