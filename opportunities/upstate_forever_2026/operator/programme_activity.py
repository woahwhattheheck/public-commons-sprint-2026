"""Compact activity for the original retained ComputeProgrammes manager.

The run desk already receives native run states through the operator state API.
This provider reads original programme identity, progress, controls and lock state;
it does not open every native run or submit an execution action.
"""
from __future__ import annotations

class ProgrammeActivity:
    def __init__(self, operator, fault):
        self.operator = operator
        self.fault = fault

    def read(self, workspace_key, operation, payload):
        if operation != "activity":
            raise self.fault("PROGRAMME_ACTIVITY_ROUTE",
                             "Choose retained programme activity.", 404)
        if not isinstance(payload, dict):
            raise self.fault("PROGRAMME_ACTIVITY_INPUT",
                             "Choose the retained programme identity.")
        try:
            from model.common import digest, identifier
            from model.compute_programme import ComputeProgrammes

            key = identifier(payload.get("programme_id"))
            manager = ComputeProgrammes(self.operator.ws(workspace_key))
            # These are the maintained manager's identity and workspace checks.
            # _load verifies both immutable selection and original run bindings.
            record = manager._load(key)
            progress = manager._state(key)
            active = manager._active(key)
            control = manager._control(key)
            requested = progress.get("requested_runs", [])
            if (not isinstance(requested, list) or
                    any(not isinstance(name, str) for name in requested)):
                raise ValueError("Retained programme requested cases are invalid")
            baseline = record["selection"]["baseline_run"]
            request_id = digest({"programme_id": key, "baseline_run": baseline,
                                 "requested_runs": requested})
            response = {
                "schema": "upstate.programme-activity/v1",
                "id": key,
                "programme_id": key,
                "workspace_id": record["workspace_id"],
                "bindings_id": key,
                "request_id": request_id,
                "baseline_run": baseline,
                "current_run": progress.get("current_run"),
                "recorded_state": progress["state"],
                "phase": progress["phase"],
                "active": active,
                "pause_requested": control["pause_requested"],
                "updated_at": progress["updated_at"],
            }
            # The programme identity binds these native selections. A client
            # holding this identity already has the same immutable bindings.
            if payload.get("bindings_id") != key:
                response["bindings"] = [
                    {"key": row["key"], "run_id": row["run_id"],
                     "native_selection": row["native_selection"]}
                    for row in record["runs"]
                ]
            # Requested subsets can differ between original execution tasks.
            # Return the list again only when its retained content changes.
            if payload.get("request_id") != request_id:
                response["requested_runs"] = requested
            return response
        except ImportError as error:
            raise self.fault("PROGRAMME_ACTIVITY_UNAVAILABLE",
                             "Open the installed native programme manager: " + str(error), 503) from error
        except FileNotFoundError as error:
            raise self.fault("PROGRAMME_ACTIVITY_MISSING", str(error), 404) from error
        except (ValueError, KeyError, TypeError) as error:
            raise self.fault("PROGRAMME_ACTIVITY_INPUT", str(error), 422) from error
        except (OSError, RuntimeError) as error:
            raise self.fault("PROGRAMME_ACTIVITY_READ",
                             str(error) or type(error).__name__, 500) from error

    def summaries(self, workspace_key, runs):
        """Catalogue rows from the same original runs already read for /api/state.

        Each native selection is verified once and each original execution lock
        observed once per response. Full detail retains its native artifact,
        storage and history inspection in ComputeProgrammes.status.
        """
        from model.common import digest, identifier
        from model.compute_programme import ComputeProgrammes, _error
        from model.model_selection import validate_completed_run
        from model.native_execution import _active

        workspace = self.operator.ws(workspace_key)
        manager = ComputeProgrammes(workspace)
        originals = {row["id"]: row for row in runs}
        observed = {}

        def native_activity(key):
            if key not in observed:
                try:
                    identifier(key)
                    native = originals[key]
                    if digest(native["selection"]) != key:
                        raise ValueError("Original run selection changed")
                    validate_completed_run(native)
                    # Detail rejects malformed retained output descriptors before
                    # reporting native state; preserve that metadata check here.
                    for descriptor in native.get("artifacts", {}).values():
                        descriptor["path"], descriptor["bytes"]
                    active = _active(workspace.root / "runs" / key)
                    state = native["state"]
                    if state == "running" and not active:
                        state = "interrupted"
                    observed[key] = (native, state, active)
                except (ValueError, OSError, KeyError) as error:
                    observed[key] = error
            value = observed[key]
            if isinstance(value, Exception):
                raise value
            return value

        summaries = []
        for path in sorted(manager.root.glob("*/programme.json")):
            key = path.parent.name
            try:
                record = manager._load(key)
                progress = manager._state(key)
                active = manager._active(key)
                control = manager._control(key)
                counts = {"total": len(record["runs"]), "complete": 0,
                          "failed": 0, "running": 0, "pending": 0}
                for binding in record["runs"]:
                    run_active = False
                    try:
                        native, state, run_active = native_activity(binding["run_id"])
                        if native["selection"] != binding["native_selection"]:
                            raise ValueError("Native run differs from the saved programme binding")
                    except (ValueError, OSError, KeyError):
                        state, run_active = "missing", False
                    attempts = progress["attempts"].get(binding["key"], [])
                    # Match the maintained native-observation catalogue: a
                    # previous programme failure cannot override an active run.
                    if attempts and attempts[-1]["state"] == "failed" and not run_active:
                        state = "failed"
                    count_key = state if state in ("complete", "failed", "running") else "pending"
                    counts[count_key] += 1
                visible = progress["state"]
                if visible == "running" and not active:
                    visible = "interrupted"
                if visible == "complete" and counts["complete"] != counts["total"]:
                    visible = "failed" if counts["failed"] else "partial"
                summaries.append({
                    "id": key, "title": record["title"], "state": visible,
                    "phase": progress["phase"], "counts": counts,
                    "updated_at": progress["updated_at"],
                    "baseline_run": record["selection"]["baseline_run"],
                    "active": active, "pause_requested": control["pause_requested"],
                })
            except (ValueError, OSError, KeyError) as error:
                summaries.append({"id": key, "state": "unavailable", "error": _error(error)})
        return summaries
