# Evidence — Docker vLLM detection gate fix (label-aware)

Date: 2026-10-05 (IST). Seat: NARROWBODY glm (zai/glm-5.3-flash) in Pi.
Child Paseo agent ID: `4b064a91-47dd-410d-92b3-c760761b28f5`

## Assignment (verbatim summary from owner relay)

- Resume; fix the detection. Fast-model execution, dashboard only.
- Ownership: dashboard source/tests/evidence in the canonical Rust checkout
  `/Users/des/dev/dgx-spark-lab/spark-dashboard` (scope corrected by owner —
  planning repo `/Users/des/dev/vllm-dash-df` is NOT the source).
  NOT dgx-spark-lab lab code/journal (another worker owns parentdiag and
  parentjournal; no overlap).
- Root cause (already proved upstream): `src/engines/detector.rs:421–429` gates
  Docker discovery on `image.contains("vllm") || command.contains("vllm")`
  BEFORE `docker top` inspection. Qwen refresh changed the image reference from
  named `vllm-qwen38-flash-stock-nvfp4:e962733e08d1-nvfp4kv-20260920` to
  immutable `sha256:0c411658…`, and the command is a shell wrapper
  (`bash /opt/seat0b-runtime/serve-262k.sh`): neither contains "vllm", so the
  container is skipped and never reaches process inspection.
- Fix: also recognize authoritative vLLM image-provenance labels present in the
  container summary (`org.opencontainers.image.source =
  https://github.com/vllm-project/vllm`, `ai.vllm.build.commit`), alongside the
  existing image/command checks. Do NOT match container names (names are not
  evidence).
- TDD RGB: RED = SHA image + wrapper command + official vLLM labels recognized;
  unrelated name-only qwen container rejected. GREEN = smallest predicate
  change, focused tests.
- Constraints: preserve foreign modifications/staging (parser hunks in
  detector.rs + frontend work are another worker's); never stash/reset/clean/
  delete; stage/commit ONLY my gate/test/evidence hunks and verify the commit
  diff before push. No public source-bearing image push (no ttl.sh). Deploy
  spark-dashboard service ONLY (not daemon, host, or either model). Bounded
  remote build: RAM ceiling 4.5 GiB of ~7.7 GiB. Never use GPU, never restart/
  stop/change Qwen/Ornith/router, no cache clears, no deleting rollback
  containers, no sudo outside approved procedure. Verify delivered binary +
  live UI (OpenCLI screenshot of port 3000 showing Qwen AND Ornith; health 200).

## Canonical layout confirmation

- Planning/beads repo: `/Users/des/dev/vllm-dash-df` (no source tree; PLAN.md
  pre-OpenSpec only).
- Canonical Rust checkout: `/Users/des/dev/dgx-spark-lab/spark-dashboard`
  (own git repo; remotes: origin niklasfrick upstream, fork desflynn).
- Remote mirror: `des@dgx-spark:/home/des/repos/spark-dashboard` (passwordless
  SSH confirmed; same Cargo layout).

## Foreign work preserved (untouched)

- `src/engines/detector.rs`: parser-precedence hunks at HEAD lines ~276–368 and
  added tests from ~648 (`git diff` headers checked 2026-10-05 ~19:18 IST) —
  another worker's, left unstaged/untouched.
- `src/engines/mod.rs` + `frontend/*` modifications — another worker's.

## Log

### Unit 1 — RED (2026-10-05 ~19:24 IST)

Extracted the inline gate into `is_vllm_container(image, command, labels)`
with the OLD behavior only (image/command, labels ignored) and added 5 focused
tests to `engines::detector::tests`:

- `digest_image_wrapper_cmd_with_official_vllm_labels_is_detected` — FAILED (expected)
- `build_commit_label_alone_is_evidence` — FAILED (expected)
- `name_only_llm_container_without_vllm_evidence_is_rejected` — ok
- `foreign_source_label_is_not_evidence` — ok
- `existing_image_and_command_signals_still_qualify` — ok

`cargo test engines::detector::tests::`: 21 passed, 2 failed (the two
label-positive tests only). Foreign parser hunks unaffected.

### Unit 2 — GREEN (2026-10-05 ~19:26 IST)

Smallest predicate change: after image/command, accept when container-summary
labels contain `org.opencontainers.image.source ==
https://github.com/vllm-project/vllm` OR a non-empty `ai.vllm.build.commit`
key. Names still never consulted. Full suite: **177 passed, 0 failed**
(`cargo test`, includes the other worker's parser tests).

### Unit 3 — selective staging (2026-10-05 ~19:28 IST)

Built a HEAD+mine-only patch (`git show HEAD:` + re-applied my three edits),
`git apply --cached` onto the clean index. Verified:

- Staged hunks (HEAD line refs): 374 (consts+helper), 427 (gate call-site),
  607 (tests) — 113 insertions, 6 deletions, detector.rs only.
- Foreign work still unstaged in the worktree: parser hunks at 276–368 and
  foreign tests — untouched. Nothing else was staged (`git diff --cached`
  empty before staging).

### Unit 4 — empty build-commit label rejected (2026-10-05 ~19:47 IST)

Owner pickup check: mere presence of `ai.vllm.build.commit` must not qualify.
RED: `empty_build_commit_label_is_not_evidence` FAILED against the
presence-only predicate. GREEN: build-commit label now requires a non-empty
value; upstream source still exact-match. Full suite: **178 passed, 0
failed**. Staged selectively again from HEAD `a3cab86` (2 hunks: predicate
line 405, test insertion 681); foreign hunks remain unstaged.

## Deployment plan

- Isolated deploy tree: `git archive` of this branch's HEAD only — the shared
  Mac worktree's foreign WIP (frontend fleet-redesign edits, detector/mod.rs
  parser hunks) is NOT in the deploy context.
- Build `linux/arm64` on the Mac (native, keeps the compile off the Spark's
  ~7 GiB-available RAM and away from the 4 GiB fallback guard), transfer with
  `docker save | gzip | ssh docker load`.
- Remote: dated `.env` backup, set `SPARK_DASHBOARD_IMAGE` to the local tag,
  `docker compose up -d spark-dashboard` from the existing compose dir
  (project `docker`, files docker-compose.yml + override). Rollback = point
  `SPARK_DASHBOARD_IMAGE` back at ghcr latest and up -d; old image and the
  `spark-dashboard-state` volume stay untouched. No daemon/host/model/cache
  changes.

### Unit 5 — deployment receipt + UI verification (2026-10-05 19:37–19:39 IST)

- Isolated deploy tree: `git archive 7d7b93a` extracted to `/tmp/spark-dash-deploy`
  on the Mac; verified my `is_vllm_container` present, foreign WIP absent.
- Image: `docker build -f deploy/docker/Dockerfile --platform linux/arm64 -t
  spark-dashboard:7d7b93a` on the Mac (warm cache; compile kept off the
  Spark). Transfer `docker save | gzip | ssh docker load` → loaded
  `spark-dashboard:7d7b93a` id `sha256:1401ba3c1ca2…`.
- Config change with dated backup: `deploy/docker/.env` → `.env.bak-20261005`,
  appended `SPARK_DASHBOARD_IMAGE=spark-dashboard:7d7b93a`.
- `docker compose up -d` (project `docker`, deploy/docker): container
  recreated and started, service `spark-dashboard` ONLY.
- **Runtime binary delta proven:** `docker inspect spark-dashboard .Image` ==
  `sha256:1401ba3c1ca2…` (exactly the new image); old ghcr image and all
  rollback tags (`live-pp-cache`, `fleet-data-semantics-bak-…`) preserved;
  `spark-dashboard-state` volume untouched; no `down -v`.
- Health: container `(healthy)`; `GET :3000/healthz` → 200; `GET :3000/` → 200.
- Startup log proves the fix live: `Detected engine: vLLM at
  http://localhost:18300` (Qwen) AND `http://localhost:18312` (Ornith) — the
  digest+wrapper container now passes the gate.
- UI: OpenCLI screenshot of http://dgx-spark:3000 saved to
  `evidence/2026-10-05-dashboard-after.png` (also `/tmp/spark-dash-after.png`):
  header "SPARK FLEET · 2 ENGINES ON ONE BOX", per-model rows for
  `/home/des/scratch/seat0u-model` and `/checkpoint`, Live indicator on.
- Inference untouched after deploy (19:39 IST): qwen38-flash-nvidia-0z2 Up,
  ornith-native-ssd-host-diagnostics-head-20261005 Up, health 200 on :18300
  and :18312. No daemon/host/cache/sudo actions.

### Test/commit summary

- Focused counts: RED-1 `engines::detector::tests::` 21 passed / 2 failed
  (label positives); GREEN full suite 177 passed. RED-2 (empty build-commit
  label) 1 failed; GREEN full suite **178 passed, 0 failed**.
- Commits pushed to fork `desflynn/spark-dashboard` branch
  `fix/fleet-data-semantics`: `a3cab86` (label-aware gate + tests + evidence),
  `7d7b93a` (non-empty build-commit value + evidence). Foreign worktree WIP
  (parser hunks, frontend fleet redesign) remains uncommitted and unshipped.

### Remaining gap

- The other worker's uncommitted frontend/parser WIP is NOT deployed (owner
  fence) — the running UI is the committed branch state + this fix.
- Fix is branch-scoped: merging `fix/fleet-data-semantics` → `main` and a
  follow-up mirror sync are the parent's call.
