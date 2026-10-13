# Streamed source capacity and retained-object reuse

The original-source continuation measures the resources its next HTTP range consumes. It preserves the archive capture, operation ID, recovery implementation, validators and contiguous range behavior described in [HTTP_CAPTURE_RESUME.md](HTTP_CAPTURE_RESUME.md).

## Resource accounting

The filesystem snapshot resolves the actual destination mount and reports available bytes from statvfs.f_bavail, read-only status, reserved blocks, inodes and whether the destination is memory-backed. A root-directory alias resolves to its physical destination before classification.

The memory snapshot reads the current Linux cgroup and all visible ancestors. It supports cgroup v1 and v2. Each finite limit contributes limit minus current usage plus clean reclaimable file-LRU pages. Shared-memory, dirty and writeback pages are excluded from that reclaim allowance. The final effective availability is the minimum of those limits and host MemAvailable. No host memory or cache settings are changed.

For each requested range the planner requires its appended bytes plus a 4 MiB filesystem reserve. In memory, it requires two actual receiver buffers plus a 4 MiB reserve. The retained appended extent is also counted for tmpfs, ramfs, hugetlbfs or an unobserved destination type. For the existing 1 MiB buffer and 32 MiB range, these are 36 MiB of storage and either 6 MiB of memory for disk or 38 MiB for a memory-backed destination.

Availability is a current observation. Other workers can consume resources afterward; the receiver's interruption and original-prefix recovery behavior remains applicable. A missing memory observation is exposed as memory_capacity_observed=false and memory_ok=null; an observed filesystem shortage still stops the range. The reserves are explicit per-invocation options.

## Retaining repeated originals

model.common.retain_file returns the same content-addressed object for a repeated original. It hashes the input and verifies an existing object before allocating a staging file. Large originals shared by multiple scenarios therefore require no additional full-size temporary copy during repeated intake.

A genuinely new object is copied into a private temporary file while its SHA256 is checked. The flushed file is published with an exclusive link inside the object store. Concurrent intake verifies an existing winner and preserves its inode. The source file remains independent of the retained object, and the public return fields remain sha256, bytes, object and filename.

## Use

Run the commands from the application directory. Inspect both possible destinations without starting a request:

```sh
python source_tools/storage_resources.py \
  /dev/shm/upstate-405f-20261012/inputs /path/to/disk-operation/inputs \
  --append-bytes 33554432
```

Continue the same retained source after its prefix and receiver sidecars have been adopted through the existing operation helpers:

```sh
python source_tools/continue_original_capture.py \
  --root /path/to/disk-operation \
  --application /path/to/retained-application
```

The selected root identifies the original operation and its retained prefix. The capacity module does not relocate data. The continuation preserves operation_id UPSTATE-ORIGINAL-SOURCES-DBC61, continuation 405F, Annual_NLCD_LndCov_2025_CU_C1V2.zip, maximum size 1457983950 and 32 MiB ranges. It requires the imported http_capture_resume.py to match SHA256 d42bf1174e31bff7a6c0e25073b5f25638fda384ee9b52cb78a55b11ab72e4ed. The receiver handles ETag, continuity and transport validation.

If --application is omitted, application source is loaded from ROOT/application. The default root is /dev/shm/upstate-405f-20261012. Capacity interruptions retain the receiver's original prefix and use exit 75. Progress includes the actual filesystem and cgroup breakdown, requested-range plan and exact resource quantities. Optional --disk-reserve-mib and --memory-reserve-mib accept nonnegative integer MiB values; both default to 4.

## Focused check

This single command checks the disk/tmpfs distinction and repeated intake when staging raises ENOSPC. It writes only a tiny temporary original and one retained object. Run it from the application directory; it does not download data or execute native models. The final snapshot reports the actual host alongside the small constructed classifier cases.

```sh
python - <<'PY'
import errno
import json
import tempfile
from pathlib import Path
from unittest.mock import patch

from model import common
from source_tools.storage_resources import MIB, capacity_snapshot, plan_range_capacity

snapshot = {
    "filesystem": {"memory_backed": False, "read_only": False,
                   "available_bytes": 64 * MIB},
    "memory": {"effective_available_bytes": 12 * MIB},
}
disk = plan_range_capacity(snapshot, 32 * MIB)
assert disk["can_start"] and disk["required_memory_bytes"] == 6 * MIB
snapshot["filesystem"]["memory_backed"] = True
assert not plan_range_capacity(snapshot, 32 * MIB)["can_start"]
snapshot["filesystem"].update(memory_backed=False, available_bytes=35 * MIB)
assert not plan_range_capacity(snapshot, 32 * MIB)["can_start"]

with tempfile.TemporaryDirectory(prefix="retained-source-check-") as name:
    root = Path(name)
    original = root / "original.txt"
    original.write_bytes(b"retained original\n")
    first = common.retain_file(root / "project", original)
    destination = root / "project" / first["object"]
    inode = destination.stat().st_ino
    with patch.object(common.tempfile, "NamedTemporaryFile",
                      side_effect=OSError(errno.ENOSPC, "no staging capacity")):
        assert common.retain_file(root / "project", original) == first
        assert common.retain_file(root / "project", original,
                                  first["sha256"]) == first
    assert destination.stat().st_ino == inode
print(json.dumps({"focused_check": "passed",
                  "actual_capacity": capacity_snapshot(".")}, sort_keys=True))
PY
```

A memory-accounting reference case is a cgroup at its limit with file=1024 MiB, shmem=900 MiB, file LRU=124 MiB, dirty=20 MiB and writeback=4 MiB. Its clean reclaim allowance is 100 MiB, before taking the minimum with host and ancestor availability.
