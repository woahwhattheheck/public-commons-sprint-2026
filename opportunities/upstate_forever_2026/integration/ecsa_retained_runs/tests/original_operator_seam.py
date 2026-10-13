"""Verbatim original methods, NOT a replacement server or model implementation.

Source: woahwhattheheck/commons@97d09111ac34899ea46ba9fdd599cccf5e46dbac
opportunities/upstate_forever_2026/operator/server.py
Git content blob: 8434eba9cf0243fe2d50ec879a993c7ffbbc86a9
Extracted _perform and _invoke, fetched 2026-10-13 via GitHub connector.
Dependencies are supplied only by the execution-protocol fixture in the test.
"""
class Operator:
    def _perform(self, key):
        with self.lock:
            task = self.task(key)
            if task["state"] != "queued" or self.closing:
                return
            task.update(state="running", started_at=now())
            task.pop("error", None)
            attempt = {"number": len(task["attempts"]) + 1, "started_at": task["started_at"]}
            task["attempts"].append(attempt)
            atomic_json(self.root / "tasks" / (key + ".json"), task)
        try:
            with self.gates[task["workspace"]]:
                result = self._invoke(task)
            task.update(state="complete", result=result, ended_at=now())
            attempt.update(state="complete", ended_at=task["ended_at"])
        except BaseException as error:
            detail, status = summary_error(error)
            task.update(state="failed", error=detail, ended_at=now())
            attempt.update(state="failed", error=detail, ended_at=task["ended_at"])
            error_file = self.root / "tasks" / (key + ".attempt-" + str(attempt["number"]) + ".error.txt")
            with contextlib.suppress(OSError):
                error_file.write_text(traceback.format_exc(), encoding="utf-8")
        with self.lock:
            atomic_json(self.root / "tasks" / (key + ".json"), task)

    def _invoke(self, task):
        ws = self.ws(task["workspace"])
        value = task["payload"]
        action = task["action"]
        if action in CUSTOMER_REVIEW_ACTIONS:
            return self.customer_reviews.invoke(task)
        if action == "source.import":
            preview = read_json(self.root / "previews" / (token(required(value, "preview_id")) + ".json"))
            manifest, cleanup = self.materialize_source(preview, task["id"])
            try:
                return ws.import_sources(manifest)
            finally:
                if cleanup:
                    shutil.rmtree(cleanup)
        if action.startswith("community."):
            from model.communities import invoke
            return invoke(ws, action, value)
        if action == "profile.save":
            return ws.save_profile(value)
        if action == "scenario.save":
            return ws.save_scenario(value)
        if action == "grid.prepare":
            return ws.prepare_grid(value)
        if action == "run.prepare":
            return ws.prepare_run(value)
        if action == "run.start":
            return ws.run(required(value, "run_id"))
        if action == "run.compare":
            return ws.compare_runs(value["run_ids"])
        if action == "observation.import":
            uploaded = self.upload(required(value, "upload_id"))
            return ws.import_observations(uploaded["path"], value["metadata"])
        if action == "observation.compare":
            return ws.compare_observations(required(value, "run_id"),
                                           required(value, "observation_id"), value["catchments"])
        if action == "spatial.review.save":
            return self.spatial_reviews[task["workspace"]].save(value)
        if action == "spatial.review.export":
            return self.spatial_exports[task["workspace"]].export(value)
        if action == "delivery.build":
            return ws.build_delivery(value)
        if action == "workspace.backup":
            destination = self.root / "outputs" / (task["id"] + ".zip")
            selection = bool(value.get("include_intermediates", True))
            if destination.exists():
                retained = portable.inspect_archive(destination, verify=True)
                if retained["project"] != ws.project or retained["selection"]["include_intermediates"] != selection:
                    raise Fault("BACKUP_CONFLICT", "The retained task output belongs to another backup selection.", 409)
                return {"project_id": ws.project["id"], "path": str(destination),
                        "bytes": destination.stat().st_size, "sha256": file_digest(destination),
                        "members": len(retained["members"]), "selection": retained["selection"],
                        "reused_completed_output": True}
            return ws.backup(destination, include_intermediates=selection)
        if action == "workspace.restore":
            uploaded = self.upload(required(value, "upload_id"))
            destination = self.restore_root / task["id"]
            if destination.exists():
                manifest = portable.inspect_archive(uploaded["path"], verify=True)
                for name, expected in manifest["members"].items():
                    path = destination.joinpath(*portable.member_name(name).parts)
                    if not path.is_file() or path.is_symlink() or path.stat().st_size != expected["bytes"] or file_digest(path) != expected["sha256"]:
                        raise Fault("RECEIVING_CHANGED", "The already-received task directory differs from its original archive.", 409)
                result = {"schema": "upstate.scientific-workspace-receiving/v1", "project": manifest["project"],
                          "directory": str(destination), "workspace": str(destination / "workspace"),
                          "application": str(destination / "application"), "archive_sha256": uploaded["sha256"],
                          "members": len(manifest["members"]), "selection": manifest["selection"],
                          "identity": "MATCH", "reused_completed_output": True}
            else:
                result = portable.restore(uploaded["path"], destination)
            result["workspace_key"] = self.register(Workspace(result["workspace"]), received={
                "at": now(), "archive_sha256": result["archive_sha256"], "identity": result["identity"]})
            return result
        raise Fault("ACTION_INVALID", "The original operation is not supported.")
