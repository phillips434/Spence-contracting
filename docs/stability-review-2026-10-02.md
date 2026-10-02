# Contractor Desk stability review — October 2, 2026

Baseline: production branch `phase-2-stability`, commit `c44b5050bcccfd2a44071145f7b3020035239ff1`. Railway source configuration was confirmed from the owner's screenshot. Live deployment logs and Firestore rules/data were not inspected.

## Changes

- Point `npm test` to the actual `tests` directory.
- Separate Playwright browser tests from Mocha tests; previously Playwright tried to run Mocha files and failed on `describe`.
- Recognize hourly durations, including decimal hours and `hr`/`hrs`, when computing contractor labor.
- Preserve material takeoff quantities when allocating authoritative labor hours. Use one dedicated hourly row when present; otherwise distribute hours across existing labor-bearing trade rows.
- Clear previous client phone/email, job number and PO when opening a new project form.
- Update the project cache after successful database writes so navigation does not depend on the next Firestore snapshot; keep existing selections during edits.
- Refresh compatible dependencies with `npm audit fix --ignore-scripts`; no forced major-version upgrades. Production dependency audit now reports zero vulnerabilities.

## Validation

- Baseline direct Mocha run: 107 passing, 30 failing. Original `npm test` ran no tests.
- Final full Mocha run: 118 passing, 24 failing.
- Focused project form, labor quantity, geometry and workspace tests: 10 passing.
- Node syntax checks passed for server and inline application JavaScript.
- Local HTTP smoke checks: homepage and `/api/build-info` returned 200.
- Three browser regression tests are committed, but did not execute: Chromium was absent and its download repeatedly produced invalid archives. Equivalent project-form scenarios passed in VM tests with a mocked database. These do not prove live persistence.
- AI provider calls in the existing suite are mocked; no live billable provider calls were made.

## Remaining work before release

The full suite is still red; this change must not be represented as production-ready.

1. Repair isolated browser-function test contexts: missing `deriveAuthoritativeLaborFromScope`, `alert`, `window`, `withSharedOwnerMetadata`, `resolveEstimateProjectClass`, `getCanonicalCustomerScope`, and `normalizeExclusionText`. Some tests slice out functions without their real dependencies.
2. Investigate three-round estimate intake and reset behavior with browser fixtures; current assertions show loss of original scope. Confirm whether application behavior or the fixture is responsible before changing logic.
3. Reconcile residential scope summary, duplicate narrative, legacy fallback and section-edit expectations with current application behavior. A multi-trade scope test omits “master closet.”
4. Investigate the CO normalization fixture expecting `lineItems` and a pricing fixture expecting `aiBreakdown.laborHours`; do not weaken the assertions without checking response contracts.
5. Reconcile project-class validation and missing-provider error-message assertions.
6. Run browser tests after `npx playwright install chromium`, then exercise actual sign-in, project create/edit, selection persistence after reload, team permissions, estimate generation and multi-round CO intake in an isolated test account.
7. Inspect Firestore security rules, backups, and deployed Railway logs/build identity. These require access beyond the repository.
8. Review server protection for paid AI routes. The inspected server has no inbound token verification or rate limiting; CORS is present but does not authenticate callers. Design this with the existing client authentication before enforcing it, to avoid locking out users.
9. Remaining development dependency advisories require a separate compatibility review; `npm audit fix --force` was not used.

## Owner verification

- Create a project after editing a different customer's project; ensure phone, email and PO belong to the new customer.
- Add tile/cabinet/countertop selections, edit the project, reload and sign in on a second device; ensure selections persist.
- Check an estimate using an hourly crew duration and a material takeoff; verify hours and measured quantity remain distinct.
- Compare final labor rate, material totals, markup and client total against a manually calculated sample.
- Confirm current local development changes not yet committed are preserved before any merge.

These files are a review candidate. GitHub branch creation returned HTTP 403 “Resource not accessible by integration,” so no remote branch or pull request was created. The connector can read the repository; write access is blocked despite the repository permissions response listing push permission. Railway production and customer data were not changed.
