"""Original-workspace integration and recoverable revision-bound calculations."""
from __future__ import annotations
import fcntl
from pathlib import Path
from contextlib import contextmanager
from .store import Store
from .engine import solve, frontier
from .native import from_experiment, from_workspace


class DecisionWorkspace:
    def __init__(self, workspace):
        """Accept the existing model.Workspace, or its owned root directory."""
        self.native_workspace = workspace if hasattr(workspace, "project") else None
        root = workspace.root if self.native_workspace is not None else Path(workspace)
        self.store = Store(Path(root) / "robust_decisions")
        self.locks = self.store.root / "run_locks"
        self.locks.mkdir(exist_ok=True)

    def import_experiment(self, experiment_id, configuration):
        if self.native_workspace is None:
            raise ValueError("Pass the original model.Workspace to import a retained experiment")
        return self.store.create(from_workspace(self.native_workspace, experiment_id, configuration))

    def import_summary(self, summary, configuration):
        return self.store.create(from_experiment(summary, configuration))

    def recover(self, sid=None):
        """A process-death releases its OS lock. Never interrupt a held live lock."""
        recovered = []
        with self.store.connect() as db:
            rows = db.execute("SELECT id FROM runs WHERE status='running'" +
                              (" AND study_id=?" if sid else ""), (sid,) if sid else ()).fetchall()
        for row in rows:
            path = self.locks / (row["id"] + ".lock")
            with path.open("a+") as lock:
                try:
                    fcntl.flock(lock, fcntl.LOCK_EX | fcntl.LOCK_NB)
                except BlockingIOError:
                    continue
                try:
                    with self.store.connect() as db:
                        cursor = db.execute("UPDATE runs SET status='interrupted',error=? WHERE id=? AND status='running'",
                                            ("Calculation process ended; replay the retained revision and objective", row["id"]))
                        if cursor.rowcount:
                            recovered.append(row["id"])
                finally:
                    fcntl.flock(lock, fcntl.LOCK_UN)
        return recovered

    @contextmanager
    def _execution(self, sid, revision, objective):
        import uuid
        rid = "run_" + uuid.uuid4().hex
        with (self.locks / (rid + ".lock")).open("a+") as lock:
            fcntl.flock(lock, fcntl.LOCK_EX)
            self.store.start_run(sid, revision, objective, run_id=rid)
            try:
                yield rid
            except BaseException as exc:
                self.store.finish_run(rid, error=f"{type(exc).__name__}: {exc}")
                raise
            finally:
                fcntl.flock(lock, fcntl.LOCK_UN)

    def solve(self, sid, revision, objective="worst_case", *, time_limit=30, mip_rel_gap=0):
        document = self.store.read(sid, revision)
        with self._execution(sid, revision, objective) as rid:
            result = solve(document["study"], objective, time_limit=time_limit, mip_rel_gap=mip_rel_gap)
            result["execution"] = {"study_id": sid, "revision": revision,
                                   "time_limit": time_limit, "mip_rel_gap": mip_rel_gap}
            self.store.finish_run(rid, result)
        return {"run_id": rid, "revision": revision, "answer": result}

    def frontier(self, sid, revision, budgets, objective="worst_case", *, time_limit=60):
        document = self.store.read(sid, revision)
        with self._execution(sid, revision, "frontier:" + objective) as rid:
            result = frontier(document["study"], budgets, objective, time_limit=time_limit)
            result["execution"] = {"study_id": sid, "revision": revision, "objective": objective,
                                   "budgets": budgets, "time_limit": time_limit}
            self.store.finish_run(rid, result)
        return {"run_id": rid, "revision": revision, "answer": result}
