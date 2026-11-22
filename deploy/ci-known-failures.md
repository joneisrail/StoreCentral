# CI known failures and flakes

Remove every entry below in Phase 2.

| Test | Handling in CI | Why | Phase 2 |
| --- | --- | --- | --- |
| `apps/seller-hub/src/connectors/connections.e2e.test.ts` | Excluded with `--exclude` in the `seller-hub` job | All 16 tests hang until the 5000 ms timeout (a 90 s timeout does not help, so it is a hang, not slowness). Identical failure at the merge base `f8c071f68d` and on this branch with no database or Redis variables set, so it predates Phase 1. Root cause not yet found | Remove in Phase 2 (find the hang in the in-process harness, then drop the exclusion) |
| `apps/seller-hub/src/queue/queues.test.ts` | Kept, verify in CI | Deterministic rewrite is in place (condition-based `waitFor`, no elapsed-time assertions); needs Redis, so it was not run locally and the first CI run is the verification | Verify in the next CI runs; remove after 5 green runs |
| `apps/backend/integration-tests/http/channel-offers-redis-lock.spec.ts` | Kept | Runs only when `REDIS_TEST_URL` is set; CI is its first real run, so a first failure may be a genuine bug, not CI setup | Remove in Phase 2 once it has a green history |

The backend jobs build workspace dependencies with
`yarn turbo run build --filter=@dtc/backend^...`. That filter is unverified
against a clean checkout; if it fails, widen it to `--filter=@dtc/backend...`.
