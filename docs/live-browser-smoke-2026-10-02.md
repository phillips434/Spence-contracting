# Live browser smoke tests — October 2, 2026

Tested in the production app using the owner's signed-in session and labeled QA records. No messages or signed agreements were sent.

## Verified

- Projects, estimates, dashboard navigation and project search render.
- New deck command reached follow-up questions without the reported 'No estimate loaded' failure.
- Answer submission generated 11 priced line items, scope, work included, and assumptions.
- Exclusions-only command produced suggestions while retaining the $7,405 displayed price and 11 line items.
- After correcting owner workspace resolution, a new estimate survived reload. Its edited title, 16-hour labor item at $85, $1,360 cost and $1,632 sale price survived another reload.
- Corrected numbering allocated EST-0161 above existing visible EST-0160.

## Defects fixed

1. Established owner account's profile was a team profile pointing to another UID. Load treated it as owner while writes used that profile UID. Both owner and settings resolvers now consistently retain the established owner workspace. Profile itself and old misassigned documents were not migrated.
2. Stale settings counter allocated low estimate numbers. New allocation floors above visible existing records. Initial estimate snapshot must be ready before a new save; the retry message preserves form input. This is not an atomic multi-session allocator, and converted records absent from the list are not used in the floor.
3. Independently rounding 30/40/30 milestones yielded $1,633 for a $1,632 estimate. Final milestone now uses the residual balance. Regression cases include cent totals.

## Remaining validation

- Office account shared visibility and legacy employee-owned or misassigned documents need separate verification/migration.
- Firebase security rules and cross-tenant protection remain unresolved; browser success does not clear security.
- Existing Mike Booth Choices tab was empty during read-only inspection. Historical selections were not restored.
- Real client/subcontractor portals, signatures, messaging, photo uploads, invoice flows, concurrency, and phone-specific behavior still need dedicated tests.
- Startup guard tested locally; ordinary ready-state numbering verified live. No deliberate network throttling was used to force its live retry branch.

Local regression suite: 171 passing. Owner/numbering changes deployed in PRs #3 and #4; milestone correction in this PR.
