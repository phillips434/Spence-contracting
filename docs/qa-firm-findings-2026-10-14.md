# October 14 external QA corrections

Source: Contractor Desk-Test Findings.xlsx, Findings rows 5–29, tested v216.
Candidate: v217 on firebase-free-auth. Changes apply to all company accounts.

| Finding | Correction |
|---|---|
| 1. Double submits | Submit locks and disabled buttons; stable draft/expense identifiers; repeated record writes reuse the record; server rejects duplicate nested IDs. |
| 2. Conflicting budgets | Scope now shows the same project totals as Budget and cards, with the allocation subtotal explicitly labeled separately. A zero budget shows “No budget set” instead of a fabricated percentage. Existing totals are not overwritten with inferred allocations. |
| 3. Approved change accounting | Approval from the button, status dropdown, or initial Approved status applies budget, contract and payment accounting once. Server reconciliation covers private API writes. Approved changes cannot be deleted or repriced; use a separate credit change. |
| 4. Contract total | Separate client contract-price input from internal cost budget. Payments use that price and show the scheduled amount and schedule difference. Missing contract prices are identified rather than inferred from costs. |
| 5. Paid invoice | Paid invoice due is zero; original invoice line prices remain visible. |
| 6. Negative pricing exploit | Reject negative markup and ordinary negative costs on client and server. Explicit credit/discount lines require zero markup and reduce client price without reducing estimated internal costs. Invoice imports preserve these credits. |
| 7. Margin | Calculate profit margin on pretax client price; monetary values round to cents. |
| 8. Empty forms | Field-level required messages and focus on the missing input. |
| 9. Invalid input | Validate contacts, numeric amounts, date order and edited financial records on server. Scope beyond the project end requires explicit acknowledgment. Unchanged legacy fields remain editable without destructive normalization. |
| 10. Stale screens | Re-render after successful saves and roll project state back after failed saves. Converted projects become available immediately without waiting for sync. |
| 11. Search | Include job number, address, PM and PO, with job-number separator tolerance. |
| 12. Internal tools | Hide and guard diagnostics, tagging and recovery for ordinary owners/members. Server diagnostic routes require the platform owner. |
| 13. Paywall | Downloading the public app shell remains normal. Private company and AI routes enforce the owner’s entitlement, including expiry for teammates. Subscription fields cannot be self-upgraded. |
| 14. Policies | Replace launch placeholders with accessible, dated Terms and Privacy pages describing actual hosting, email, AI, data ownership, sharing, export, retention and account-closure contact. No claim of legal certification. |
| 15. Invoice navigation | Preview opens within a dialog with Back to project, preserving the current project and tab. |
| 16. Delete controls | Minimum 44px targets; confirmations for tag/team-contact removals in addition to existing record confirmations. |
| 17. Negative remaining | Red over-budget remainder, formatted as -$2,800. |
| 18. Approval/conversion | Offer project creation on approval. Approved and converted estimates count toward contracted revenue, not the pending pipeline. Stable conversion identity prevents retry-created duplicate jobs. |
| 19. Work included | Include labor descriptions as well as materials, including when an older saved narrative omitted a current line item. Preserve other existing narrative content. |
| 20. Notification noise | Suppress own-action alerts for the acting user; retain meaningful activity for other company members. |
| 21. Scope progress | In Progress receives the same 50% weighting already used on individual scope bars. The project average now agrees with them. |
| 22. Password | Server already required 12 characters. Correct UI text and add a Pwned Passwords check using only a five-character SHA-1 hash prefix. Failed checks return a retry message; no plaintext password or full hash is transmitted. |
| 23. Copy | Singular change-order labels, compact currency without $0k, formatted invoice company phone. |
| 24. Mobile filters | Replace chip rows with labeled view/status dropdowns on small screens. |
| 25. Sign-in error | Clear the missing-email reset error when an email is entered; restore error styling for subsequent failures. |

## Verification

- Mocha regression and PostgreSQL integration suite: 333 passing.
- Chromium suite: 27 passing, including complete app fixtures at 390px and 1280px.
- Complete browser flow: create estimate, reject negative-markup exploit, add normal line and explicit credit, convert to project, import itemized invoice, mark paid, reload and confirm persistence.
- Actual isolated PostgreSQL HTTP routes verify approval accounting, retry-safe record writes, duplicate ID rejection, validation, paid persistence, diagnostic authorization, owner/team entitlement expiry and rejection of subscription self-upgrades.
- No production business data was modified by these tests. Existing duplicate records were not silently deleted.
- Browser tests use Chromium with controlled fixtures; they do not claim a physical iPhone/Safari test or a new live customer email/signature/payment.
- Release remains pending until Railway reports SUCCESS and the live release is checked.

## Operational note

New password setup depends on the Pwned Passwords service responding within five seconds. Existing sign-in does not perform that check. A provider outage leaves the account/password unchanged and asks the user to retry.
