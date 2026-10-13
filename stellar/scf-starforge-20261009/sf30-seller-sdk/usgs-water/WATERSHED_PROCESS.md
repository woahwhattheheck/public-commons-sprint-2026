# Watershed native process ownership

## Integration

This module is Python 3 orchestration. The existing watershed_native.py remains the Jython 2.7 HEC driver. Keep run_owned inside the original operation lock.

1. Have locked(root) yield the exact open lock descriptor: yield f.fileno() on both platform branches.
2. Bind the descriptor from with locked(root) as lease_fd in commands that call native.
3. Add lease_fd to native(root, action, request, lease_fd). Replace subprocess.run with:

    from watershed_process import run_owned
    with open(log, "ab", buffering=0) as stream:
        outcome = run_owned(
            command + [str(HERE / "watershed_native.py"), str(input_path), str(result_path), key],
            stream, lease_fd=lease_fd,
            on_started=lambda owner: save(process_path, {**record, "process": owner})
        )
    record.update(returncode=outcome["returncode"], lifetimes=outcome["lifetimes"],
                  process=outcome["process"], completedAt=time.time())

Use outcome["returncode"] in the original result validation. Keep the same request key, source/runtime binding, log and child result; the helper does not publish a replacement operation or retry it. On exception, retain the original attempt failure/log through the caller's existing exception path. The helper has already drained the original tree before it raises.

API:
run_owned(argv, log_stream, *, cwd=None, env=None, lease_fd=None, on_started=None, timeout=None)

The caller owns a regular log stream and the operation-lock descriptor. The helper never closes either. It flushes/fsyncs the complete log after actual native closure, including failed/interrupted exits. Timeout is an explicitly selected positive number of seconds; omission waits for the complete original operation. The callback receives actual process identity once, under retained ownership. A callback publication failure cancels and drains the same child.

## Linux

Use a dedicated, single-threaded watershed CLI process with no earlier children. The helper requires procfs namespace identity, pidfd_open/pidfd_send_signal and Linux child subreaping. It sets the subreaper before creation, immediately retains the actual Popen object, passes the held original lease FD to that child and starts a new session. The original maintained Source Desk primitive maps mounted PIDs through NSpid, binds start identity on both sides of pidfd acquisition, and signals adopted children only through the resulting pidfd.

The normal path waits for the complete tree, including a Java process whose launcher has already exited. On interruption/failure, it sends TERM then KILL after five seconds and continues through observation/diagnostic failures until waitpid proves ECHILD. It then restores the earlier subreaper state. It never kills unrelated process groups or interprets a mounted PID as a syscall PID.

## Windows

Requires Windows 10 / Windows Server 2016 or newer with documented STARTUPINFOEX PROC_THREAD_ATTRIBUTE_JOB_LIST support. The helper creates an unnamed Job with KILL_ON_JOB_CLOSE and no breakaway permissions. CreateProcessW assigns that Job atomically while the initial thread is suspended; process and thread handles are retained before ResumeThread. A HANDLE_LIST limits inherited handles to exact duplicate log and null-input handles. The Job itself is not inherited.

Select a real executable launcher, for example the installed HEC-DSSVue.exe or the actual configured Java executable/arguments. For a .bat or .cmd launcher, supply its explicit existing command-interpreter argv; the helper does not invent shell quoting or convert a batch path into an executable. No broad process lookup is used. Normal completion waits for both the original process handle and Job ActiveProcesses=0. Cancellation terminates this exact Job, waits for closure, then releases its handles. Failed cleanup retries retain the owned handles and the caller's operation lease.

The SIGINT/SIGTERM handlers defer an exception across process creation and stop new work afterwards. Cleanup cannot be interrupted by those signals. Uncatchable OS termination is outside a Python exception recovery claim; on Windows the non-inherited kill-on-close Job additionally binds the process tree to the owner lifetime.

## Maintained source and official contracts

Linux proc/start/pidfd/ECHILD block is preserved verbatim from installation-source-desk-receiving.py, 59,262 bytes / SHA256 50dfdf116bf782ea8db26e57958b04a406e7c763c5430d7af356ff414e835da9, Git blob 8db7e2629b8bd056269a33feef20e6d42d5400fd in woahwhattheheck/tjlabs-stellar-merchant-workspace. Its use here is confined to the dedicated original watershed CLI.

Windows primary contracts:
- https://learn.microsoft.com/en-us/windows/win32/api/processthreadsapi/nf-processthreadsapi-updateprocthreadattribute
- https://learn.microsoft.com/en-us/windows/win32/api/processthreadsapi/nf-processthreadsapi-createprocessw
- https://learn.microsoft.com/en-us/windows/win32/procthread/job-objects
- https://learn.microsoft.com/en-us/windows/win32/api/jobapi2/nf-jobapi2-queryinformationjobobject

This source has a pending native grammar/materialization request; no DSS/native product execution is asserted. Full file publication, result/artifact revalidation, model reference semantics and conversion serialization remain in the original watershed modules.
