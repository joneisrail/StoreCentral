# Upgrading the vendored dashboard to a new upstream Medusa version

Applies to `packages/admin/dashboard`, the only Medusa package kept in this repository (decision `docs/decisions/0001-medusa-fork-strategy.md`). The file `packages/admin/dashboard/UPSTREAM_VERSION` holds the upstream version our copy is based on.

Why this works: npm publishes `@medusajs/dashboard` WITH its `src/` folder, so the exact upstream source of any version can be downloaded and used as the merge base. This was rehearsed against 2.21.2 to 2.23.0 on scratch copies (results in the decision record).

## Cadence and owner

Owner: see the decision record. Every month: check `npm view @medusajs/medusa version` and read the release notes and security advisories. Security releases: within 7 days.

## Procedure

Do the work on a branch in a git worktree. Never run it on `master` directly.

1. Pick the target version `T` and read `packages/admin/dashboard/UPSTREAM_VERSION` as the base `B`.
2. In a scratch directory OUTSIDE the repository, download both versions and unpack them:

   ```sh
   npm pack @medusajs/dashboard@B @medusajs/dashboard@T
   mkdir base target
   tar xzf medusajs-dashboard-B.tgz -C base
   tar xzf medusajs-dashboard-T.tgz -C target
   ```

   The sources are in `base/package/src` and `target/package/src`.
3. Line endings differ between the npm files (CRLF) and the repository (LF in git, CRLF in a Windows working copy). Normalise all three sides to LF before comparing: use `tr -d '\r'` on every file (the script below does it).
4. For every file upstream changed between B and T, decide:

   | Case | Action |
   |---|---|
   | our copy equals the base | take the target file as is |
   | our copy already equals the target | nothing to do (this happens when upstream adopted a change we also made, for example Tailwind class sorting) |
   | both changed | three-way merge with `git merge-file ours base theirs`; clean result is kept, a conflict is resolved by hand |
   | file added upstream | add it |
   | file removed upstream | delete it unless we use it |

   Script (rehearsed; set the four directories first and run it from any directory, it only writes under `WORK`):

   ```sh
   BASE=base/package/src
   TARGET=target/package/src
   OURS=<repo>/packages/admin/dashboard/src
   WORK=work
   CR=$(printf '\r')
   mkdir -p "$WORK"; : > "$WORK/conflicts.txt"
   diff -rq --strip-trailing-cr "$BASE" "$TARGET" \
     | sed -nE "s#^Files ([^ ]+) and .*#\1#p" | sed "s#^$BASE/##" > "$WORK/changed.txt"
   while read rel; do
     [ -f "$OURS/$rel" ] || { echo "absent in fork: $rel"; continue; }
     mkdir -p "$WORK/$(dirname "$rel")"
     tr -d "$CR" < "$BASE/$rel"   > "$WORK/$rel.base"
     tr -d "$CR" < "$TARGET/$rel" > "$WORK/$rel.theirs"
     tr -d "$CR" < "$OURS/$rel"   > "$WORK/$rel.ours"
     if cmp -s "$WORK/$rel.base" "$WORK/$rel.ours"; then cp "$WORK/$rel.theirs" "$WORK/$rel.result"; continue; fi
     if cmp -s "$WORK/$rel.ours" "$WORK/$rel.theirs"; then continue; fi
     cp "$WORK/$rel.ours" "$WORK/$rel.result"
     git merge-file -q "$WORK/$rel.result" "$WORK/$rel.base" "$WORK/$rel.theirs" || echo "$rel" >> "$WORK/conflicts.txt"
   done < "$WORK/changed.txt"
   ```

   Files that are new in the target are found with `diff -rq` lines starting `Only in .../target/...`. Copy them over by hand. Files with a `.result` copy are the new content; files listed in `conflicts.txt` contain conflict markers to resolve.
5. Copy the `.result` files back into `packages/admin/dashboard/src` (keep the repository's line-ending convention), resolve conflicts, then update the dashboard's `package.json` dependencies to the versions the target package declares (`@medusajs/ui`, `icons`, `js-sdk`, `types`, `admin-shared`, ...). Bump the backend's `@medusajs/*` packages to the same target version in the same change.
6. Write `T` into `packages/admin/dashboard/UPSTREAM_VERSION`.
7. Verify before merging: build the dashboard (`yarn build` in `packages/admin/dashboard`), run its full test suite (`npx vitest run`), run lint (`npx eslint` on changed files), start the admin and walk the order list, order detail, sales channel and Channel stock & pricing pages.
8. Merge through a pull request; CI runs the same checks.

## Known sources of conflict

- Formatting from our earlier lint cleanup (semicolons, class order). If a file conflicts on every line, compare it ignoring whitespace first.
- Our own pages: `routes/orders/order-list`, `hooks/api/orders.tsx`, `dashboard-app/routes/get-route.map.tsx` (474 lines of our changes), `i18n/translations/en.json`. Expect hand work there at every upgrade.
