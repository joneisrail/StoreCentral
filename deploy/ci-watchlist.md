# CI watch list: tests that still need CI verification

No test is excluded from CI. The two tests below have never run in CI, so a
first failure may be a genuine bug rather than a CI setup problem. Each row has
an exit condition; remove the row once it is met, and delete this file when
the table is empty.

| Test | Handling in CI | Why | Exit condition |
| --- | --- | --- | --- |
| `apps/seller-hub/src/queue/queues.test.ts` | Runs, verify in CI | Condition-based rewrite is in place (condition-based `waitFor`, no elapsed-time assertions); needs Redis, so it was not run locally and the first CI run is the verification | Remove after 5 green CI runs |
| `apps/backend/integration-tests/http/channel-offers-redis-lock.spec.ts` | Runs | Runs only when `REDIS_TEST_URL` is set; CI is its first real run | Remove once it has a green history |

The backend jobs build workspace dependencies with
`yarn turbo run build --filter=@dtc/backend^...`. That filter is unverified
against a clean checkout; if it fails, widen it to `--filter=@dtc/backend...`.
