# OpenLineage 6804 complete delivery driver

Additive original carrier path: `receiving/openlineage-producers-6804-20261012/delivery_driver.py`.

This standalone Python 3 standard-library driver materializes the original immutable 41-file packet, invokes the original RECEIVING.mjs and PRODUCER_RECEIVING.mjs, packages their complete portable outputs and original reports, and saves the archive and summary through the current canonical Library helper in the same operation. Root A49AA and original receiving owner 7F5A coordinate native execution; 6804 retains source ownership.

## Same-process delivery

Materialize these exact inputs in the SAME private native invocation as execution:

- Source packet Git blob `c3cdef0798617b2f0d31685876688f870bb530d3` (446,514 UTF-8 bytes).
- Carrier README Git blob `f432c3e5e3b29f3f57adb13ecd92516fc4258c7e`. Source carrier COMMIT is `a4b62345a3a52d628e06635964edbc426906cc63`.
- Complete [delivery_driver.py](delivery_driver.py) source in this directory.
- Current unchanged Library helpers `library_upload.py`, `library_hosted_apps.py`, `library_file_transfer.py` together in a fresh private helper directory.
- `handover-command.json` containing an argv array with the actual existing Python executable and complete upload helper path, for example `["/usr/bin/python3","/dev/openlineage-inputs/library/library_upload.py"]`.

Exact driver argv, with actual materialized paths substituted:

```bash
python3 /dev/openlineage-inputs/delivery_driver.py \
  --directory /dev/openlineage-operation \
  --packet /dev/openlineage-inputs/source-packet.json \
  --guide /dev/openlineage-inputs/carrier-README.md \
  --handover-command-json /dev/openlineage-inputs/handover-command.json \
  deliver
```

Do all source materialization, this invocation, and its upload completion before the enclosing native process returns. Execution-private /dev namespaces disappear between separate native calls. The driver enforces an upload hook for deliver/package on those paths. A retained /workspace or /dev/shm operation can also use separate prepare/run/status/package calls.

The hook supplies the complete archive first and Markdown summary second in one canonical closed-stdin upload request. Optional `--handover-input-json` accepts the canonical uploads object with `{archive}`, `{summary}`, `{receipt}` placeholders to preserve a resolved folder or an existing guarded replacement. Only these generated deliverables can be selected. The hook checks every ordered result's path, purpose, status and Library ID. Its `saved.status="SAVED"` requires all results to succeed. Actual process exit, ordered saved identities and any partial/unknown outcome are retained; an interrupted upload is reconciled from its original receipt without submitting a duplicate request.

## Original native state and complete handover

Defaults under the operation root are separate source/, receiving/, producers/ and private .delivery/ directories. Original programs create their own private runtime directories. --source-dir, --receiving-dir, --producer-dir and --state-dir select retained original paths. Reuse the same state directory for continuation.

Completed original native phases are reused. Incomplete RECEIVING.mjs directories and original interruption records are preserved for original-owner continuation because the original program cannot resume them. PRODUCER_RECEIVING.mjs resumes its own checkpoint in its exact original directory. Source materialization compares every byte and never overwrites differing source.

Per-child stdout, stderr and actual exits stay in private state. A lost process exit remains unobserved. Full original native result files remain authoritative. Packaging selects all 41 source files, source packet, guide, driver, portable workspaces with their original complete application/history, reports, producer checkpoint/result, and original producer payloads. It uses a positive allowlist, with deterministic archive membership and byte readback. Runtime token files, connection/configuration files, Python/Java credential YAML and logs remain private. Identical merchant export aliases are recorded by SHA-256.

The original accepted 35-file baseline can be supplied as --baseline-archive with its known --baseline-sha256. The driver extracts only its original portable workspace and invokes the original cli.mjs verify --input. --baseline-export accepts the original workspace directly. Actual original CLI result is retained and included in the handover.

The driver retains the original receiving programs' result records and each child process's actual exit. Its private upload record links the helper run before launch, and its outer stderr forwards the canonical Library save markers while other helper logs remain private. Native execution and saved deliverable results return through the original receiving operation.

## Published source identity

Driver UTF-8 bytes: 47,188. SHA-256: `5a6fbab86c3fd1d8fa6288460382a0bd9a1923b711c183989b4dd87ca2e0fde2`.
