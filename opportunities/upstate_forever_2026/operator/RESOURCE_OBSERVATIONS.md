# Native resource observations

Current release direction: `CURRENT_OWNER_DIRECTION.md` version `2026-10-14.1`,
including approved item 26 and the existing focused-use/rendered-product rules.

The workbench records process memory independently of scientific inputs, model
values and saved stage identities. These observations do not change cache or
thread settings, start calculations, enforce limits or control other processes.

## Platform meanings

Windows uses `K32GetProcessMemoryInfo` with a query-only handle. Current and peak
working sets are resident-byte observations. Private and peak private commit
remain separately named; they are not virtual address-space size or resident
memory. Unavailable counters are omitted rather than reported as zero.

Mac uses the maintained identity-aware `model/macos_process.py` task reader for
current resident/virtual bytes and threads. The running worker and standalone
grid tools obtain their process-lifetime peak from `getrusage(RUSAGE_SELF)`;
Darwin returns bytes. Linux retains `/proc` observations and its existing cgroup
accounting, with `getrusage` peaks converted from KiB to bytes. Cgroup totals are
shared-group measurements and can overlap; they are not per-process totals.
Windows and Mac explicitly mark Linux cgroups as not applicable.

Existing receipt consumers retain `VmRSS_bytes` and `VmHWM_bytes` aliases for
resident and peak-resident values. `VmSize_bytes` is included only when an actual
virtual-address-space measurement exists, never as a Windows commit alias.

## Grid tools, capacity command and reports

Both grid compilers and the precipitation-matching capacity command import the
same stdlib-only `source_tools/process_resources.py`. Windows does not import the
Unix-only `resource` module. New result records contain `peak_rss_bytes`, a
rounded `peak_rss_mib`, the platform and measurement source. Legacy `*_mb` fields
remain for existing consumers, with explicit `memory_unit: "MiB"`.

Each exported grid source directory includes the exact observer beside both
applicable compiler sources. It remains runnable after moving the export out of
the application. The report renderers prefer canonical bytes and display MiB;
missing observations read "unavailable". Old results without recorded units keep
their original number and are labeled as a legacy recorded value. No stored
scientific summary, geometry, class count, original table or historical report
is rewritten by the upgrade.

The peak covers the observing process's lifetime. It is not an incremental stage
allocation or the sum of descendant memory. Optional observation failures remain
execution metadata and do not replace a model, storage or cancellation outcome.
GDAL is observed only if already imported; its cache maximum is not read before
cached blocks establish initialization. Existing inherited settings stay intact.

## Receiving this source

Install the observer and the complete current callers together through the
maintained installer. The component fragment is
`integration/component_fragments/resource-observation-portability.json`.
`operator/native_jobs.py` additionally includes the observer in new worker source
bindings and checks the original worker identity around remote observations.
Preserve its concurrent storage/supervisor changes and the existing Windows/Mac
backends; this contribution introduces no replacement process controller.

The final native receiving course should observe the same running task's status,
close/reconnect normally, and inspect the changed resource values in the existing
view. Preserve all seven original workspaces and 82 completed runs. Source
assembly does not require repeating accepted scientific work.

## API references

- Microsoft memory counters and byte/commit meanings:
  https://learn.microsoft.com/en-us/windows/win32/api/psapi/ns-psapi-process_memory_counters_ex
- Query-only process handle and API availability:
  https://learn.microsoft.com/en-us/windows/win32/api/psapi/nf-psapi-getprocessmemoryinfo
- Apple XNU getrusage manual, Darwin byte units:
  https://github.com/apple/darwin-xnu/blob/main/bsd/man/man2/getrusage.2
- Linux kernel process-memory field definitions:
  https://docs.kernel.org/filesystems/proc.html
