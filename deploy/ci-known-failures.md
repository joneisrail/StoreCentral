# CI known failures and flakes

Remove every entry below once its exit condition in the last column is met.

| Test | Handling in CI | Why | Phase 2 |
| --- | --- | --- | --- |
| `apps/seller-hub/src/queue/queues.test.ts` | Kept, verify in CI | Condition-based rewrite is in place (condition-based `waitFor`, no elapsed-time assertions); needs Redis, so it was not run locally and the first CI run is the verification | Verify in the next CI runs; remove after 5 green runs |
| `apps/backend/integration-tests/http/channel-offers-redis-lock.spec.ts` | Kept | Runs only when `REDIS_TEST_URL` is set; CI is its first real run, so a first failure may be a genuine bug, not CI setup | Remove in Phase 2 once it has a green history |

The backend jobs build workspace dependencies with
`yarn turbo run build --filter=@dtc/backend^...`. That filter is unverified
against a clean checkout; if it fails, widen it to `--filter=@dtc/backend...`.
