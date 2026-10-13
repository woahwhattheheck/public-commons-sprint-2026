# Receiving original runtime lease failures

The runtime workspace retains the original GNU `flock` probe from PR 2627. It operates on the same private lock file and inherited descriptor, with the original nonblocking request, contention exit code 75, five-second attempt deadline, child-drain cleanup, and bounded transient retry. This change carries the probe's returned evidence through the existing interfaces.

## Read the actual result

The existing error code remains authoritative:

| Returned error | Meaning |
| --- | --- |
| `RUNTIME_WORKSPACE_OPERATION_RUNNING` | The original probe returned its configured contention exit code 75. Preserve the current owner and use its original operation. |
| `RUNTIME_WORKSPACE_FLOCK_UNAVAILABLE` | The original probe could not establish an acquisition outcome through its normal result. Inspect the complete attempts below; this does not assert that another workspace owner holds the lease. |

These errors may contain `flock.attempts`. Each attempt preserves the actual `status`, `signal`, `error`, `timedOut`, `stderr`, `stderrTruncated`, and `elapsedMs` returned by the original probe. There are at most two attempts. The optional process error retains only its original `code`, `errno`, `syscall`, and bounded `message`.

Interpret combinations of those fields rather than treating the generic error as a retry instruction. An observed `error.code: "ENOENT"` identifies a failed executable lookup. An observed spawn error such as `EAGAIN` remains a spawn failure. `timedOut: true` identifies the original deadline path; `signal` records the returned termination signal. A nonzero `status` preserves an actual process exit. No missing outcome is converted into contention, acquisition, or a successful application start.

## Retained and operator paths

The same bounded structured receipt is preserved in:

- Existing runtime and managed operation `state.json` error projections.
- Applications connection and unavailable-state projections.
- An original managed command's recorded launch-failure error.
- Existing CLI JSON error output and worker diagnostics.
- Existing authenticated HTTP error responses.
- The original operator's immediate error display, operation details, managed operation details, and saved application history.

The normal message retains its current limit; the complete bounded attempt objects are separate, so a long message cannot truncate away the second attempt. The CLI retains its existing full message. Fields unrelated to the declared native receipt are not projected.

The browser displays these values as text and keeps its existing request, review, restart and recovery behavior. The reporting change starts no command, creates no alternative lock, retries no application action, and changes no account or authentication setting.

## Receive an interrupted application

Retain the original request ID, command, review, worker output and native operation record. A lock failure alone does not prove that a previous accepted command never ran. Read that command's actual state and perform the original Applications recovery before any new reviewed start. The native lease and retained operation remain authoritative when process namespaces differ.

A terminal recovery can have an explicit null public `result`: the original Applications history reads `command-result.json`, while some original recovery outcomes are saved under `state.json`. Preserve both fields as returned. Do not synthesize a command result from a status label.

This source change applies to a newly selected runtime built from the changed source. It does not rewrite previously reviewed installed runtimes, their source declarations, saved application bindings, or retained customer workspaces. In particular, the separate original Property receiving operation continues with its already-reviewed runtime and its exact recorded recovery.

## Validation

The fourteen-case source check exercises the exact pure error projection in V8: contention, missing executable, transient spawn error, timeout with KILL, signal termination, ordinary nonzero exit, two complete attempts, unrelated private fields, malformed and oversized records, cloned declared fields, the unchanged full CLI message, and preservation of the original error when optional diagnostics are unreadable. It also compares the entire original asynchronous `runFlock` implementation byte for byte with its preimage.

These fourteen checks run in V8. Original PR 2627 contains native acquisition/conflict/reopen, missing-executable and controlled-timeout results; customer receiving remains under its original operation.
