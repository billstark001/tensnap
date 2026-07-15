# TenSnap Protocol v0.3 behavior

This document records only cross-message behavior. Field meanings and local
validation rules live beside their Zod schemas.

1. The simulator sends `simulator_info` first. A renderer must not issue a
   state sync, action, or restore before it has accepted that identity. A model
   ID mismatch isolates the existing project; it never triggers an automatic
   sync or restore.
2. `state_sync` is read-only inventory. `state_sync_begin` through
   `state_sync_end` are one non-nestable transaction: renderer state changes
   become visible only after the matching end succeeds. `replace` starts empty;
   `reconcile` is only valid for the same instance.
3. Each parsed `action_invoke` has exactly one correlated `action_result`.
   Simulator updates precede that result. An error, or `should_continue: false`,
   ends the current continuous renderer loop; actions are never retried
   automatically.
4. Scene restore is a separate, non-nestable transaction. It stops scheduling
   first, applies checkpoint → parameters → environments → time, and commits
   only on `scene_restore_end { status: "ok" }`. Disconnect leaves the outcome
   unknown and requires a fresh state sync.
5. Create of an existing ID and update of a missing ID are protocol errors.
   Delete of a missing ID is an idempotent no-op. Duplicate identities inside a
   transaction reject that entire transaction.
6. Monitor updates replace the current value. Chart operations use explicit
   `kind`; same-series same-time points are last-write-wins. Truncate deletes
   `>= time` when inclusive and `> time` otherwise.
7. Canonical v0.3 is strict snake_case. The session-selected legacy codec is
   the sole compatibility boundary; it uses the exact table in `V0.3-DRAFT.md`
   and never rewrites arbitrary user maps.
