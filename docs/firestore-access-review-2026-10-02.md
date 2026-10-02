# Firestore access review

Source: complete production rules supplied by Phillip on October 2, 2026; local production source at c44b505.

## Confirmed exposures

- Projects and estimates permit public reads of complete documents.
- Unauthenticated and anonymous callers can update project documents without a field restriction; estimates permit all updates.
- Self-written profiles can select ownerUid and status, which the rules trust for company membership.
- Active users can read and write notifications and team invites without tenant restrictions.
- Missing userId is treated as authorization for legacy documents.

## App dependencies inspected

- Client CO approval reads a project, modifies changeOrders, scopeItems, notesLog and financial accounting, then writes the complete project with set(p).
- Estimate signing updates signedBy, signedAt, signatureData and status directly in Firestore.
- Signup reads an invite keyed by email, writes ownerUid into its own profile, and marks the invite accepted.
- These flows must be migrated alongside rules. Owner-only rules alone would break portals and team onboarding.
- Whole-project portal writes can overwrite newer changes from another session. This is a plausible data-loss mechanism, not proof of the reported missing selections.

## Implementation sequence

1. Preserve the complete current rules and back up affected documents before production migration.
2. Test existing owner and employee flows against Firestore Emulator fixtures.
3. Move portal approval/status actions to authenticated or scoped, revocable server handlers. Use transactions and validate immutable amounts and allowed state transitions.
4. Return explicit portal projections instead of complete internal project documents.
5. Validate membership using owner-controlled invitations, matching verified identity; forbid arbitrary self-assignment of ownerUid/status.
6. Scope notifications, invites, settings, projects and estimates to their owner/workspace, including a reviewed migration for legacy records.
7. Test unauthorized reads/writes and each valid role; deploy app and rules as a coordinated release.

No production rules were changed. Firebase administrative access and an emulator run remain unverified. This document is a review plan, not a deployable rules replacement.
