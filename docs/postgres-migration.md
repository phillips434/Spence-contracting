# PostgreSQL backend migration

Contractor Desk is migrating from direct browser-to-Firestore persistence to a server/API + PostgreSQL architecture.

## Safety state

- Firestore remains the production source of truth.
- The production web app is not connected to PostgreSQL yet.
- No Firestore records are deleted or modified by this migration.
- PostgreSQL receives a company-scoped schema designed for multi-tenant SaaS use.
- Firebase Auth can remain the identity provider during the transition.

## Phase 1

1. Provision PostgreSQL on Railway.
2. Establish versioned SQL migrations.
3. Build server-side database access and authentication boundary.
4. Export/migrate the single existing company.
5. Reconcile record counts, IDs, financial totals, and nested project data.
6. Add read-only shadow verification.
7. Cut over only after explicit production approval.

The `legacy_payload` JSONB columns preserve source records during migration so fields not yet normalized are not discarded.
