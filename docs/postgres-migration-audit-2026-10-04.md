# PostgreSQL migration verification — October 4, 2026

Scope: the existing Spence company workspace and the production `phase-2-stability` branch. This follows the additive migration: preserve complete legacy payloads, compare identities and nested data, keep Firebase Auth, and retain Firestore for rollback. Available prior-conversation records were reviewed; complete transcripts of both October 3 conversations were not available.

## Verified source data

Fresh read-only comparison completed October 4 at 14:57:10 UTC (10:57:10 America/New_York), after deployment and the live QA status check.

| Data | Firestore | PostgreSQL | Result |
|---|---:|---:|---|
| Projects | 42 | 42 | All identities and full payloads match; no missing, extra, or differing records |
| Estimates | 107 | 107 | All identities and full payloads match; no missing, extra, or differing records |
| Scope items | 205 | 205 | Child payload hashes match |
| Selections | 13 | 13 | Child payload hashes match |
| Costs | 10 | 10 | Child payload hashes match |
| Punch items | 62 | 62 | Child payload hashes match |
| Change orders | 16 | 16 | Child payload hashes match |
| Communications | 14 | 14 | Child payload hashes match |
| Daily logs | 53 | 53 | Child payload hashes match |
| Project notes | 26 | 26 | Child payload hashes match |
| Project payment milestones | 48 | 48 | Child payload hashes match |
| Estimate items | 629 | 629 | Child payload hashes match |
| Estimate payment milestones | 47 | 47 | Child payload hashes match |
| Company profiles | 5 | 5 | Authenticated full-payload comparison matches |
| Company invitations | 5 | 5 | Authenticated full-payload comparison matches |
| Owner, shared, and teammate personal notifications | 173 | 173 | Authenticated full-payload comparison matches |

Project budget totals match at **$691,552.91**; spent totals match at **$97,097.63**. Company settings match completely. Job counter 5 and estimate counter 164 were preserved.

The 107 estimates include **27 converted records** retained in storage and **80 unconverted records** visible in the app's All records estimate view. All records project view displayed 42 cards. Daily work totals apply their established archive/test filters.

The company settings `team` roster is empty in the source. This is separate from Team Access: all five identity profiles and their membership states were imported, and the live owner UI showed three active teammates and one revoked teammate alongside the owner account.

## Confirmed fixes and cutover

- Preserved empty arrays and maps distinctly from null, false, and zero. Corrected the proven settings importer error `team: null` to the source's `team: []`.
- Imported missing profiles, memberships, invitations, and notifications additively with transaction rollback on payload mismatch. The later audit additionally included teammate personal notifications and found 22 missing documents; these were imported without changing projects or estimates.
- Routed internal support, project, estimate, backup, and maintenance operations to PostgreSQL. Active membership determines the company; a client-supplied owner UID cannot select another company.
- Retained Firebase Auth and validated identities server-side. Invitation binding uses the signed-in email and a pending server invitation, with role and company derived from that invitation. Inactive/revoked memberships cannot reactivate themselves. Unmigrated existing Firestore identities are explicitly blocked from being replaced with empty companies.
- Moved public estimate, project, invoice, and subcontractor reads to PostgreSQL projections. Public writes use limited server actions and row locks, preserving the current complete document and normalizing it transactionally.
- Added scoped share tokens with stored scope and revocation. New share creation writes only share metadata. Existing tokenless links continue only where the legacy source record remains publicly readable under the existing Firestore rules; the current displayed document and permitted changes come from PostgreSQL.
- Estimate signatures preserve existing signatures and prices; duplicate signatures are rejected. Sent change orders validate identity, title, and amount and apply the existing scope, budget, client-total, and milestone accounting once. Subcontractor actions are restricted to assigned scopes, including the existing On Hold option.
- Public polling rerenders only when the document changes, so unchanged polls do not erase in-progress signatures. A no-op scope status action does not rewrite existing project/child data.
- Disabled the old per-user Firestore migration utility for PostgreSQL workspaces. PostgreSQL maintenance batches are transactional. Shared company logo saves resolve the company settings document.

## Validation and limits

`npm test`: **249 passing**. Browser inline JavaScript and changed server modules passed syntax checks. Tests cover decoding fidelity, company isolation, revoked users, invitation identity and roles, signatures, immutable amounts, duplicate change-order accounting, scope restrictions, projections, token revocation, and maintenance payload preservation.

Live production browser checks confirmed projects, estimates, Team Access, company settings, and all four existing public page types render. QA estimate total $1,632 and QA invoice amount $100 matched the owner views. The QA subcontractor's unchanged Complete status returned a successful PostgreSQL action response; the subsequent full source comparison remained exact. Share-link creation returned HTTP 200 and the UI reported Link copied.

The cloud browser's clipboard read returned an empty string, so opening the newly copied token URL was not verified in that browser. Token access, stored scope, revocation, and related-record restrictions are covered by fixture tests. Existing public links were verified live.

No real contract was signed, no client message was sent, and no existing source or destination business record was deleted or reimported. Signature/change-order actions were tested with fixtures, not real approvals. Live signup/invitation acceptance was not exercised by creating a real account.

Production code deployment: `2db1b5636a64464153011539ac702cc8e6f55bdb`, Railway deployment `b198b141-e02e-43e9-94e6-be0d20e8294c`, SUCCESS. Prior cutover deployment: `cc526063fbe75c5e6d2d908c5c80e262e4262b23`.

Firestore has **not** been disabled or deleted, and production Firestore rules were not changed. Source audits and old-link validation still read it; Firebase Auth intentionally remains. This verifies the current company migration and deployed app paths, not an administrative export of every historical Firebase namespace or unrelated company account.


## Actual route and database verification follow-up

The actual Express route modules were exercised against the production PostgreSQL database using synthetic companies, simulated Firebase identity lookup, and explicitly nonbinding fixture agreements. Every test write was confined to a single outer transaction; route transactions used savepoints. The outer transaction was rolled back, and row counts plus full-row fingerprints were identical before and after for all 24 public tables. Firebase account creation and legal acceptance were not performed. See `postgres-route-integration-2026-10-04.json` and `scripts/check-postgres-migration-integration.js` for reproducible checks and evidence.

**24/24 route checks passed**, including estimate signature save/reload and duplicate prevention; change-order amount validation and once-only accounting; subcontractor status/photo logs; new token access, stored scope tampering, revocation, and cross-record isolation; invitation acceptance and server-derived roles; member reloads; revoked-session blocking and owner reactivation; independent notification read state; and settings counters.

The first database run exposed an app-field normalization error: `poNum` and `tax` were absent from the normalized PO/tax mapping. Both ordinary saves and the backup importer now support the app fields, preserving empty PO values and zero tax. Migration 007 rebuilt only the two derived columns from preserved payloads. At 15:25:36 UTC it corrected 36 project PO columns and 107 estimate tax columns. Full-table fingerprints excluding only those two columns proved that all payloads, timestamps, child rows and other tables remained unchanged. The final rollback-only route rerun passed all 24 checks, and the full local suite passed 245 tests.

The separate three-test Playwright project-form suite could not launch: its Chromium executable is not installed in this execution environment. These tests were not counted as passes. Live cloud-browser production checks and the local project-form unit coverage remain separate evidence. Live Firebase signup/invitation acceptance with a real new account remains unverified; only the actual application/database acceptance path was exercised with simulated provider identities.


## Signup verification follow-up — October 4, 15:50 UTC

The expanded actual-route PostgreSQL run passed **26/26 checks**, including creation of a new trial company, authenticated email binding, server-controlled 14-day expiry, owner membership, initial settings and numbering, isolated empty records on reload, and refusal of access to another company. The transaction rolled back, and every public table retained identical full-row fingerprints and counts. The JSON evidence now contains this latest run.

Four additional frontend signup tests run the app's actual signup functions and PostgreSQL adapters with a simulated Firebase provider. They verify the agreement gate prevents provider calls, invited users bind through auth.currentUser before the session callback, users without invitations save trial profiles through the self-identity endpoint, and provider failures do not write profiles or invitations. The full local suite now passes **249 tests**.

Attempted to install Chromium with the official Playwright installer. The download returned an invalid/truncated archive (ZIP central-directory signature missing), so the separate three-test browser suite remains blocked and is not counted as passing. The same three project-form scenarios pass in the existing Mocha fixture suite. No real new Firebase account was created, and no real signup agreement was accepted. A real account test requires the user to enter a new password and accept the Terms, Privacy Policy and Beta Agreement.
