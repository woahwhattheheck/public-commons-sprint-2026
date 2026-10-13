"""BDNB business operation behind the maintained Workflow/Kestra transport.

The original workflow owns intake, correlation, publication attempts, result
receipts, complete delivery and editable handover. This adapter only composes
the installed BDNB actions on their original Analysis operator.
"""
from __future__ import annotations
import json
from pathlib import Path
import re

from operator_client import DatasetteOperatorClient
from workflow_analysis import (NativeWorkflowAdapter as OriginalAdapter,
                               _absolute, _file, _json, _record, _require, _sha)
from workflow_engine import CONFIG_SCHEMA, REQUEST_SCHEMA

ID = re.compile(r"[a-f0-9]{32}")
ACTIONS = {"bdnb.import", "bdnb.select", "bdnb.compare", "bdnb.review", "bdnb.publish", "bdnb.pack"}
SCHEMA = "stellar-forge.bdnb-workflow-native.v1"


class BdnbWorkflowAdapter(OriginalAdapter):
    def __init__(self, configuration, *, workspace, progress=None):
        _require(isinstance(configuration, dict) and configuration.get("adapter") == "bdnb",
                 "BDNB_WORKFLOW_SELECTION_REQUIRED")
        _require(configuration.get("schema") == CONFIG_SCHEMA and
                 isinstance(configuration.get("bdnb"), dict), "BDNB_WORKFLOW_CONFIGURATION_REQUIRED")
        # Reuse the original local journal, lock, action request and file roots.
        # Its source acquisition methods are never invoked for this profile.
        selected = json.loads(_json(configuration))
        selected.setdefault("source", {"kind": "bdnb-installed-source-descriptors"})
        super().__init__(selected, workspace=workspace, progress=progress)
        spec = self.configuration["bdnb"]
        _require(set(spec) == {"actions", "publication_id", "pack_id"} and
                 isinstance(spec["actions"], list) and 1 <= len(spec["actions"]) <= 200 and
                 all(isinstance(spec.get(k), str) and ID.fullmatch(spec[k])
                     for k in ("publication_id", "pack_id")), "BDNB_WORKFLOW_PLAN_INVALID")
        keys, outputs = set(), set()
        for item in spec["actions"]:
            _require(isinstance(item, dict) and set(item) == {"key", "action", "body"} and
                     isinstance(item["key"], str) and re.fullmatch(r"[a-z][a-z0-9_-]{0,63}", item["key"]) and
                     item["key"] not in keys and item["action"] in ACTIONS and isinstance(item["body"], dict) and
                     "resume" not in item["body"], "BDNB_WORKFLOW_ACTION_INVALID")
            keys.add(item["key"])
            field = {"bdnb.import": "edition_id", "bdnb.select": "selection_id", "bdnb.compare": "comparison_id",
                     "bdnb.review": "review_id", "bdnb.publish": "publication_id", "bdnb.pack": "pack_id"}[item["action"]]
            identity = item["body"].get(field)
            _require(isinstance(identity, str) and ID.fullmatch(identity) and identity not in outputs,
                     "BDNB_WORKFLOW_ENTITY_ID_INVALID")
            outputs.add(identity)
        publication = next((a for a in spec["actions"] if a["action"] == "bdnb.publish"
                            and a["body"]["publication_id"] == spec["publication_id"]), None)
        pack = spec["actions"][-1]
        _require(sum(a["action"] == "bdnb.pack" for a in spec["actions"]) == 1 and
                 publication is not None and pack["action"] == "bdnb.pack" and
                 pack["body"]["pack_id"] == spec["pack_id"] and
                 pack["body"]["publication_id"] == spec["publication_id"],
                 "BDNB_WORKFLOW_COMPLETE_PUBLICATION_AND_FINAL_PACK_REQUIRED")

    def _id(self, phase):
        final = self.configuration["bdnb"]["actions"][-1]
        if phase == "bdnb-" + final["key"]:
            value = self.configuration["bdnb"]["pack_id"]
            self.state["nativeIds"][phase] = value
            self._save()
            return value
        return super()._id(phase)

    def run(self, request, run_id):
        _require(isinstance(request, dict) and request.get("schema") == REQUEST_SCHEMA and
                 request.get("profile") == self.configuration["profile"] and
                 request.get("parameters") == {} and isinstance(run_id, str) and ID.fullmatch(run_id),
                 "BDNB_WORKFLOW_ORIGINAL_REQUEST_REQUIRED")
        binding = _sha(_json({"configuration": self.configuration, "request": request, "runId": run_id}))
        with self._lock():
            if self.path.exists():
                self.state = _record(self.path)
                _require(self.state.get("schema") == SCHEMA and self.state.get("runId") == run_id and
                         self.state.get("bindingSha256") == binding, "BDNB_WORKFLOW_ORIGINAL_RUN_CHANGED")
            else:
                self.state = {"schema": SCHEMA, "runId": run_id, "bindingSha256": binding,
                              "nativeIds": {}, "bindings": {}, "status": "RUNNING"}
                self._save()
            if self.state.get("result") is not None:
                result = self.state["result"]
                for item in [*result["files"], result["archive"]]:
                    _file(item["path"], expected=item)
                self._emit("COMPLETE", status="COMPLETE", reused=True)
                return result
            config = self.configuration["analysis"]
            self.client = DatasetteOperatorClient.from_workspace(_absolute(config["workspace"]))
            original = self.client.status()
            _require(original["operation_id"] == config["operationId"], "BDNB_WORKFLOW_OPERATION_CHANGED")
            self._bind("analysisWorkspace", {"workspaceId": original["workspace_id"],
                                           "operationId": original["operation_id"]})
            entities = []
            for step in self.configuration["bdnb"]["actions"]:
                value = self._action("bdnb-" + step["key"], step["action"], step["body"])
                entity = value.get("entity")
                _require(isinstance(entity, dict) and entity.get("sha256"), "BDNB_WORKFLOW_ENTITY_REQUIRED")
                current = self.client.bdnb_read("bdnb.get", {"entity_id": entity["id"]})
                _require(current == entity, "BDNB_WORKFLOW_ACCEPTED_ENTITY_CHANGED")
                self._bind("accepted:" + step["key"], entity)
                self.state["nativeIds"][step["key"]] = self._id("bdnb-" + step["key"])
                self._save()
                entities.append(entity)
            publication = self.client.bdnb_read("bdnb.get", {
                "entity_id": self.configuration["bdnb"]["publication_id"]})
            pack = self.client.bdnb_read("bdnb.get", {"entity_id": self.configuration["bdnb"]["pack_id"]})
            _require(publication["kind"] == "publication" and publication["summary"]["status"] == "COMPLETE" and
                     pack["kind"] == "pack" and pack["summary"]["publication_sha256"] == publication["sha256"],
                     "BDNB_WORKFLOW_COMPLETE_PRODUCTS_REQUIRED")
            files, archive, names = [], None, set()
            for selected in [*publication["files"], *pack["files"]]:
                name = selected["filename"]
                _require(isinstance(name, str) and Path(name).name == name and name not in {"", ".", ".."} and
                         name not in names, "BDNB_WORKFLOW_FILENAME_INVALID")
                names.add(name)
                downloaded = self.client.download(selected["name"], self.outputs / name,
                                                  expected_sha256=selected["sha256"])
                _require(downloaded["bytes"] == selected["bytes"], "BDNB_WORKFLOW_DOWNLOAD_CHANGED")
                item = {"name": name, "path": downloaded["path"], "bytes": downloaded["bytes"],
                        "sha256": downloaded["sha256"], "contentType": selected["content_type"]}
                files.append(item)
                if selected["kind"] == "bdnb-archive" and selected["native_name"] == "workspace.zip":
                    _require(archive is None, "BDNB_WORKFLOW_ARCHIVE_AMBIGUOUS")
                    archive = item
            _require(archive is not None, "BDNB_WORKFLOW_ARCHIVE_REQUIRED")
            result = {"edition": publication, "analysis": {
                "status": "COMPLETE", "workspaceId": original["workspace_id"],
                "operationId": original["operation_id"], "bdnbEntities": entities,
                "publication": publication, "pack": pack,
                "scope": "Complete immutable source collections and full annexes; bounded overview report/workbook."},
                "complete": True, "files": files, "archive": archive,
                "nativeIds": dict(self.state["nativeIds"])}
            self.state.update(status="COMPLETE", result=result)
            self._save()
            self._emit("COMPLETE", status="COMPLETE", files=len(files))
            return result
