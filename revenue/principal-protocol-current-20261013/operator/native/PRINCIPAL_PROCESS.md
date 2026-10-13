# Principal native CLI stream integration

This is the maintained watershed process owner with one compatible API extension for separate complete CLI stdout and stderr. The process, namespace, pidfd, Windows Job, interruption and descendant-drain implementation is unchanged.

## Complete API

`run_owned(argv, log_stream, *, cwd=None, env=None, lease_fd=None, on_started=None, timeout=None, stderr_stream=None)`

The first stream captures stdout. With stderr_stream omitted or None, stderr is merged into that original stream exactly as before. With a supplied regular file stream, stderr is routed to that stream. The caller opens and retains both streams and the original operation lease throughout the call. Supplying the same stream explicitly retains a merged destination.

Use the source leaf `watershed_process.py` unchanged in the Principal runtime roster and import `run_owned` from it. Its historical module name is retained to make original-source reuse explicit. The dedicated Python attempt wrapper is the process owner; its parent Node service is not a competing subreaper.

## Suggested call inside the original leased attempt

```python
with open(stdout_path, "ab", buffering=0) as stdout, open(stderr_path, "ab", buffering=0) as stderr:
    outcome = run_owned(
        exact_argv,
        stdout,
        stderr_stream=stderr,
        cwd=selected_cwd,
        env=selected_environment,
        lease_fd=original_lease_fd,
        on_started=retain_actual_identity,
        timeout=selected_timeout,
    )
```

The wrapper must retain its exact prepared argv/environment/source/runtime/operation before creation and publish the original actual identity through on_started. It validates and retains the complete original typed output only after returncode and lifetimes have been observed. Output files belong to the same command attempt; the example does not authorize a second launch after an uncertain blockchain write. A restarted caller first reconciles its stored request/transaction/receipt through the original operation journal. The helper never retries or repeats a command.

## Platform implementation

Linux supplies the separate stream directly to Popen.stderr. It continues to use explicit argv with shell=False default, a new session, the original inherited lease descriptor and the unchanged namespace-qualified subreaper/pidfd implementation. Complete direct and adopted children must reach actual ECHILD before the caller can release its lease.

Windows duplicates exactly the selected stdout/stderr handles and null input into the existing HANDLE_LIST. hStdError selects the separate inherited duplicate when supplied. The Job remains non-inherited, atomically assigned during suspended creation, without breakaway permission, and kill-on-close. Exact original process and empty Job evidence precede handle release.

Each distinct supplied stream is flushed and checked as a regular file before child creation. After the platform owner has drained the whole tree, the helper attempts flush+fsync on each stream independently, retaining the first original failure and reporting subsequent sync errors. A stdout sync failure does not skip stderr sync. Streams and operation lease remain caller-owned and are never closed by this helper. The wrapper owns creation/publication and parent-directory durability for the output names.

## Source identities and review

Original complete helper: 28,656 bytes / c226a6cf09aaf2d5e4ab3041e9ffdcb30f78a752156567f04f5f5dc16649298c.
Successor complete helper: 29,581 bytes / 506634371a87cbdc005b65d4e9c75a480bef18e0f0a762c3de463c859018903c.
Original complete integration guide is retained alongside it. Thirteen unique guarded replacements mechanically reverse to the exact original helper. The original full platform ownership review remains applicable; the separate-stream delta is submitted for native integration review. No native process or CLI transaction was run to prepare this source.
