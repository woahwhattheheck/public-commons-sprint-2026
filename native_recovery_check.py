"""One focused check of native recovery control flow; standard library only."""
import contextlib
import copy
import errno
import io
import json
from pathlib import Path
import tempfile

from model.common import atomic_json, describe_file, digest, held, read_json
from model.native_execution import (NativeExecution, RESERVE_HEADER, RESERVE_NAME,
                                    RESERVE_PENDING_NAME, inspect_execution)
from model import native


class RetainedWorkspace:
    def __init__(self, root, selection):
        self.root = root
        self.project = {"id": "recovery-check"}
        self.selection = selection
        self.key = digest(selection)
        self.directory = root / "runs" / self.key
        self.directory.mkdir(parents=True)

    def inspect_run(self, key):
        assert key == self.key
        return read_json(self.directory / "run.json")

    def get_grid(self, key):
        raise AssertionError("Completed stages and exports should not reload grid inputs")


with tempfile.TemporaryDirectory(prefix="native-recovery-check-") as temporary:
    ws = RetainedWorkspace(Path(temporary), {"models": ["ndr"], "grid_id": "g",
        "profile_id": "p", "scenario_id": "s", "invest_version": "3.20.0"})
    state = {"id": ws.key, "selection": ws.selection, "state": "prepared",
             "created_at": "retained", "stages": {}, "artifacts": {}}
    atomic_json(ws.directory / "run.json", state)
    # A killed allocator can leave its staging file before any header is written.
    (ws.directory / RESERVE_PENDING_NAME).write_bytes(b"")
    primary = OSError(errno.ENOSPC, "original native disk exhaustion")
    stderr = io.StringIO()
    try:
        with held(ws.directory / ".run.lock", blocking=False):
            with contextlib.redirect_stderr(stderr), NativeExecution(ws.directory, state) as attempt:
                attempt.phase("native", model="ndr")
                active = inspect_execution(ws, ws.key, log_bytes=0)
                assert active["active"] is True
                assert active["execution"]["phase"] == "native"
                assert active["execution"]["storage_recorded_at"]
                assert not (ws.directory / RESERVE_PENDING_NAME).exists()
                assert (ws.directory / RESERVE_NAME).stat().st_size >= 262144
                raise primary
    except OSError as caught:
        assert caught is primary
    failed = ws.inspect_run(ws.key)
    assert failed["state"] == "failed"
    assert failed["error"]["errno"] == errno.ENOSPC
    assert failed["error"]["phase"] == "native"
    assert failed["error"]["model"] == "ndr"
    assert failed["error"]["kind"] == "storage_exhausted"
    assert failed["error"]["storage_recorded_at"]
    assert not (ws.directory / RESERVE_NAME).exists()
    assert json.loads(stderr.getvalue())["error"]["message"] == str(primary)

    # Retain actual file descriptors from a completed native stage and exports.
    # This checks final-state recovery without executing a model or a raster step.
    for filename in ("ndr-arguments.json", "n-total.dat", "p-surface.dat",
                     "nitrogen_export.tif", "phosphorus_export.tif"):
        (ws.directory / filename).write_bytes(filename.encode("ascii"))
    files = {"n_total_export": describe_file(ws.directory, ws.directory / "n-total.dat"),
             "p_surface_export": describe_file(ws.directory, ws.directory / "p-surface.dat")}
    failed["stages"]["ndr"] = {"completed_at": "original-completion",
        "arguments": describe_file(ws.directory, ws.directory / "ndr-arguments.json"),
        "files": files, "companions": []}
    for name in ("nitrogen_export", "phosphorus_export"):
        failed["artifacts"][name] = describe_file(ws.directory, ws.directory / (name + ".tif"),
                                                units="kg/pixel/year")
    atomic_json(ws.directory / "run.json", failed)
    # The same recovery also accepts an interrupted partial staging header.
    (ws.directory / RESERVE_PENDING_NAME).write_bytes(RESERVE_HEADER[:5])
    original_runtime = native.runtime
    def unexpected_runtime(*args, **kwargs):
        raise AssertionError("Recovery attempted to load the native engine")
    native.runtime = unexpected_runtime
    try:
        completed = native.execute_run(ws, ws.key)
    finally:
        native.runtime = original_runtime
    assert completed["state"] == "complete"
    assert completed["execution"]["phase"] == "complete"
    assert completed["execution"]["storage_recorded_at"]
    assert not (ws.directory / RESERVE_PENDING_NAME).exists()
    assert completed["execution_history"][-1]["error"]["message"] == str(primary)
    assert completed["stages"]["ndr"]["completed_at"] == "original-completion"
    assert not (ws.directory / RESERVE_NAME).exists()
    inspected = inspect_execution(ws, ws.key, verify=True, log_bytes=0)
    assert inspected["active"] is False
    assert all(row["availability"] == "verified" for row in inspected["artifacts"].values())
    assert inspected["stages"]["ndr"]["state"] == "verified"

    # A failure in failure publication must still return the original exception.
    import model.native_execution as journal_module
    original_writer = journal_module.atomic_json
    replay = copy.deepcopy(failed)
    replay["stages"] = {}
    replay["artifacts"] = {}
    secondary = OSError(errno.ENOSPC, "failure record could not be written")
    try:
        with held(ws.directory / ".run.lock", blocking=False):
            with contextlib.redirect_stderr(io.StringIO()), NativeExecution(ws.directory, replay):
                def unavailable_writer(*args, **kwargs):
                    raise secondary
                journal_module.atomic_json = unavailable_writer
                raise primary
    except OSError as caught:
        assert caught is primary
        assert caught.native_failure["state_publication_error"]["message"] == str(secondary)
    finally:
        journal_module.atomic_json = original_writer
    assert not (ws.directory / RESERVE_NAME).exists()
    stale = inspect_execution(ws, ws.key, log_bytes=0)
    assert stale["state"] == "interrupted"
print(json.dumps({"native_recovery_check": "passed",
                  "checks": ["active lock and phase", "disk failure retained",
                             "reserve released", "interrupted reserve allocation recovered",
                             "completed exports recovered",
                             "attempt history preserved", "original exception preserved",
                             "interrupted state detected"],
                  "model_executions": 0}, sort_keys=True))
