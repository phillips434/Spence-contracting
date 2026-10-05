# Independent authentication cutover

Implementation replaces browser provider SDKs and remote identity lookups with PostgreSQL-backed credentials and opaque secure HttpOnly session cookies. Signup requires email verification. Existing users activate credentials through an emailed password setup link; their existing identity strings and company memberships are preserved. The historic PostgreSQL column name `firebase_uid` stores an identifier only; it makes no network request and does not require Firebase.

## Validation

- 276 automated tests pass, including isolated PostgreSQL-engine integration.
- Integration covers verified signup, invitation membership in the existing company, existing account password setup, revoked memberships, logout, reset invalidation, token replay, cross-origin rejection, and rejection of former bearer tokens.
- Inline application scripts compile.
- Production has not been switched. No business records were edited.

## Deployment prerequisites

Configure `CD_APP_ORIGIN=https://app.getcontractordesk.com`, `SMTP_HOST`, `SMTP_PORT`, `SMTP_USER`, `SMTP_PASSWORD` (secret), and `AUTH_EMAIL_FROM` using a verified sender. Real email delivery is mandatory for account verification and existing-account password setup. No email credential values exist in current production configuration. Never commit credentials or log account tokens/passwords.

Apply only `db/migrations/009_independent_auth.sql` as an additive migration before starting the replacement. Configure staging with its own HTTPS origin and mail settings, then verify a real verification/reset email end to end. Do not deploy until existing users can receive their account setup messages.

## Production verification and shutdown

Verify owner and member company access, unchanged business counts/totals, project and estimate saves, invitations, photos, shared portals, signing fixtures, and PWA updates. Check browser network traffic for no Firebase SDK, Auth, Firestore, or Storage requests. Audit stored attachment URLs separately; embedded uploads already use PostgreSQL. Retire remaining old Railway migration/audit services that access the former provider. Revoke legacy credentials and disable old provider access after migration is verified. Permanent deletion of former provider resources is a separate final action after verification.

## Remaining limits

Live browser flow, live SMTP delivery, production schema/application switch, stored external attachment URL audit, old service retirement, and Firebase shutdown are not completed. Existing passwords cannot be copied out of PostgreSQL because they were never stored there. This implementation uses verified emailed setup rather than contacting Firebase to authenticate passwords during migration.
