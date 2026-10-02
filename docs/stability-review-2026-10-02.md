# Contractor Desk stability review — October 2, 2026

Baseline: production branch `phase-2-stability`, commit `c44b5050bcccfd2a44071145f7b3020035239ff1`. Railway source configuration, deployment status and selected runtime logs were inspected through the connected Railway plugin. The owner supplied the deployed Firestore rules; live database records were not inspected.

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
- Initial stability pass: 118 passing, 24 failing.
- Follow-up failure repair: 143 passing, zero failing.
- Focused project form, labor quantity, geometry and workspace tests: 10 passing.
- Node syntax checks passed for server and inline application JavaScript.
- Local HTTP smoke checks: homepage and `/api/build-info` returned 200.
- Three browser regression tests are committed, but did not execute: Chromium was absent and its download repeatedly produced invalid archives. Equivalent project-form scenarios passed in VM tests with a mocked database. These do not prove live persistence.
- AI provider calls in the existing suite are mocked; no live billable provider calls were made.

## Remaining work before release

The automated suite is green. Production readiness still requires the checks below.

1. Run browser tests when Chromium is available, then exercise sign-in, project create/edit, selection persistence after reload, team permissions, estimate generation and multi-round CO intake in an isolated test account.
2. Address the Firestore exposures documented in `firestore-access-review-2026-10-02.md`, with coordinated portal changes and permission tests. No production rules were changed.
3. Confirm backups and live persistence; repository tests use a mocked database.
4. Add authentication and rate limiting to paid AI routes with matching client changes. CORS does not authenticate callers.
5. Review remaining development dependency advisories separately; no forced upgrades were made.

## Follow-up failure repairs

- Remove duplicate canonical-scope and obsolete estimate-save declarations so source extraction and runtime behavior agree.
- Preserve legacy saved project scope and arrays while supplying missing summary/detail fallback values. Rendering does not mutate saved estimates or pricing.
- Avoid repeating the same detailed task in summary, overview, work and conditions; keep work details available and distinguish installation tasks from conditions.
- Resolve a bare numerical crew answer from its follow-up question and accept “additional days” in browser labor derivation.
- Preserve change-order original scope and follow-up history when an intake response is ready, including its authoritative labor facts.
- Repair isolated VM contexts to load the actual application helpers. Provide form fields and database mocks used by real UI flows.
- Correct the three-round fixture to submit the original scope first and assert reset after successful generation. Check the next request's scope rather than expecting completed intake state to remain active.
- Check labor hours in the existing `aiBreakdown` response contract and match current project-class/error labels.
- Explicitly compile the dormant breakdown branch in its integration test. The production experiment remains disabled; no environment flag was enabled.
- Accept “Master-closet” as the same work-area spelling as “master closet” rather than rewriting customer text.

## Owner verification

- Create a project after editing a different customer's project; ensure phone, email and PO belong to the new customer.
- Add tile/cabinet/countertop selections, edit the project, reload and sign in on a second device; ensure selections persist.
- Check an estimate using an hourly crew duration and a material takeoff; verify hours and measured quantity remain distinct.
- Compare final labor rate, material totals, markup and client total against a manually calculated sample.
- Confirm current local development changes not yet committed are preserved before any merge.

These files are committed on `codex/stability-review-2026-10-02` in draft PR #1. GitHub write access is working. Railway production and customer data were not changed.
