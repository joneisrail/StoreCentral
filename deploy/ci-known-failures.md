# CI known failures and flakes

Remove every entry below in Phase 2.

| Test | Handling in CI | Why | Phase 2 |
| --- | --- | --- | --- |
| `apps/seller-hub/src/medusa/admin-client.test.ts` | Excluded with `--exclude` in the `seller-hub` job | Reads a real local Medusa backend that CI does not run | Remove in Phase 2 (mock the backend or run it as a service, then drop the exclusion) |
| `apps/seller-hub/src/queue/queues.test.ts` | Kept, may flake | Timing-sensitive under load; needs Redis, which the job provides as a service container | Remove in Phase 2 (make it deterministic) |
| `apps/backend/integration-tests/http/channel-offers-redis-lock.spec.ts` | Kept | Runs only when `REDIS_TEST_URL` is set; CI is its first real run, so a first failure may be a genuine bug, not CI setup | Remove in Phase 2 once it has a green history |

The backend jobs build workspace dependencies with
`yarn turbo run build --filter=@dtc/backend^...`. That filter is unverified
against a clean checkout; if it fails, widen it to `--filter=@dtc/backend...`.
