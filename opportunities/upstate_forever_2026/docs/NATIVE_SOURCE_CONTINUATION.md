# Portable original-source continuation

Continue an existing capture with the application's native Python, from its application directory:

```sh
python -m source_tools.continue_original_capture --archive "/data/original.zip"
```

Keep the original `.partial`, `.capture.json` and `.range-recovery` directory beside the original destination. An existing recovery selection supplies its original maximum-byte budget. A newly selected archive takes its budget from the original receipt's Content-Length, or an explicit `--maximum-bytes`. The original national-source invocation, `--root ROOT`, retains its NLCD name, budget, progress directory and operation identity. `--application PATH` selects a complete retained application. Without that flag, the operator uses ROOT/application when present, otherwise its installed application; Windows/macOS default to the current directory, not a fabricated Linux shared-memory path.

The receiver rechecks the same strong ETag, contiguous response boundaries and original prefix digest. A resource pause exits 75 before a range request and retains the prefix. Run the same command to continue. Completed captures reopen without another download, including after moving the entire capture directory. No source receipt or scientific value is relabeled. Progress records identify the actual recovery source hash instead of rejecting maintained portability changes against a stale historical hash.

Windows observes quota-aware 64-bit disk space at the actual resolved destination, including UNC shares and mounted volumes. Available memory is capped by physical, current-process commit and virtual availability. Optional volume metadata can be unavailable on a remote server without discarding its valid space counters. macOS uses its native vm_stat page size, including Apple Silicon; free, speculative and inactive pages produce a reclaimability estimate without double-counting purgeable/compressed pages. Linux retains its existing host/cgroup hierarchy and clean-file reclaim accounting. Unknown memory remains unknown; it is not reported as zero. Capacity can change after observation; normal write failures still preserve the recovery state.

The existing planner CLI is also portable:

```sh
python -m source_tools.storage_resources "/data" --append-bytes 33554432
```

Install the four source_tools modules together and retain the current shared model/portable_fs.py and model/windows_fs.py. The component fragment registers that dependency closure; it does not replace the shared filesystem implementation or installer. Source capture and resource handling have no browser controls.

Native API references: Microsoft GetDiskFreeSpaceExW, GetVolumePathNameW, GetVolumeInformationW and MEMORYSTATUSEX; Apple system_cmds/vm_stat/vm_stat.c (snapshot output subtracts speculative from the displayed free count). The local receiving course used the unchanged 117,778,355-byte Current195 application archive over trusted local HTTPS, including interrupted body, resource pause, changed ETag, resumed full bytes, physical Unicode relocation and cold completed reopening. This is a transport exercise; the scientific run records are not recalculated by it.
