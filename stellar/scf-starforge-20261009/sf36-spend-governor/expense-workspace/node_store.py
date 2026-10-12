"""Original Node-file intake in the existing source/capture/request transaction."""
import json
from domain import Problem, canonical, digest, text
from native_node import capture_original, original_bytes
from credits import data_context


def summary(native):
    value = native["snapshot"]["inspection"]
    return {"source_sha256": value["sourceSha256"], "source_bytes": value["sourceBytes"],
        "source_identity_sha256": value["sourceIdentitySha256"], "intent_id": value["intentId"],
        "command_id": value["commandId"], "outcome": value["native"]["result"]["outcome"],
        "record_authority": value["native"]["recordAuthority"], "attempt_created_at": value["attemptCreatedAt"],
        "source_observed_at": value["sourceObservedAt"], "accounting_completed_at": value["native"]["completedAt"],
        "approved_request": value["approvedRequest"], "row": native["report"]["rows"][0],
        "notes": native["report"]["notes"]}


class NodeStore:
    def _node_input(self, payload):
        selected = dict(payload)
        selected["data_context"] = data_context(payload.get("data_context"))
        selected["filename"] = text(payload.get("filename"), "Original export filename", maximum=240)
        if "/" in selected["filename"] or "\\" in selected["filename"] or selected["filename"] in (".", ".."):
            raise Problem("NODE_SOURCE_FILENAME", "Retain the original filename without a directory")
        selected["name"] = text(payload.get("name"), "Source name", maximum=160)
        selected["provenance"] = text(payload.get("provenance"), "Original operation provenance", maximum=6000)
        selected["operator"] = text(payload.get("operator"), "Source intake owner", maximum=240)
        return selected

    def _node_preview(self, selected, native):
        existing = next((s for s in self._bodies("sources") if s.get("kind") == "node_operation" and
            s["identity"] == native["identity"]), None)
        result = summary(native)
        result["existing_source_id"] = existing["id"] if existing else None
        result["current_capture"] = existing.get("current_capture") if existing else None
        matches = []
        if existing:
            matches = [json.loads(row[0]) for row in self.connection.execute(
                "SELECT body FROM captures WHERE source_id=? ORDER BY created_at DESC,id DESC", (existing["id"],))
                if json.loads(row[0])["snapshot"].get("source_sha256") == result["source_sha256"]]
        reusable = next((value for value in matches if
            value["status"] == "ACCEPTED" and value["id"] == result["current_capture"] or
            value["status"] == "PENDING" and value["parent_id"] == result["current_capture"]), None)
        result["previous_capture"] = self._capture_summary(matches[0]) if matches else None
        result["reuse_capture"] = reusable["id"] if reusable else None
        result["intake_behavior"] = ("REUSE_CURRENT_ACCEPTED" if reusable and reusable["status"] == "ACCEPTED" else
            "REUSE_CURRENT_PENDING" if reusable else "CREATE_CURRENT_PARENT_CAPTURE")
        result["data_context"] = selected["data_context"]
        result["filename"] = selected["filename"]
        # Exact original source and explicit intake choices, independent of a
        # clock or display ordering. Revision is guarded at the actual mutation.
        result["preview_sha256"] = digest({"source": result, "name": selected["name"],
            "provenance": selected["provenance"], "operator": selected["operator"]})
        return result

    def preview_node_operation(self, payload):
        selected = self._node_input(payload)
        native = capture_original(selected, self.node_executable)
        with self.lock:
            self._context(selected["data_context"])
            return self._node_preview(selected, native)

    def capture_node_operation(self, payload, expected):
        selected = self._node_input(payload)
        native = capture_original(selected, self.node_executable)
        def operation():
            from domain import identifier, now
            self._context(selected["data_context"])
            current = self._node_preview(selected, native)
            if payload.get("preview_sha256") != current["preview_sha256"]:
                raise Problem("NODE_PREVIEW_CHANGED", "Review this original file against the current source before importing", 409)
            existing = self._get("sources", current["existing_source_id"]) if current["existing_source_id"] else None
            source = existing or {"id": identifier("source"), "name": selected["name"], "kind": "node_operation",
                "path": native["path"], "identity": native["identity"], "provenance": selected["provenance"],
                "data_context": selected["data_context"], "created_at": now(), "current_capture": None,
                "immutable_intake": True}
            if current["reuse_capture"]:
                saved = self._get("captures", current["reuse_capture"])
                return {"id": source["id"], "source": source, "capture": self._capture_summary(saved),
                    "original_intake": saved.get("node_intake"), "reopened": True}
            self._context(selected["data_context"], commit=True)
            if not existing:
                self._put("sources", source)
            native["node_intake"] = {key: selected[key] for key in
                ("filename", "name", "provenance", "operator", "data_context")}
            native["node_intake"]["preview_sha256"] = current["preview_sha256"]
            return {"id": source["id"], "source": source, "capture": self._new_capture(source, native), "reopened": False}
        return self._change(expected, "node_operation.capture", operation)

    def node_operation_original(self, capture_id):
        with self.lock:
            captured = self._get("captures", capture_id)
            if captured["report"]["source"].get("kind") != "node_operation":
                raise Problem("NODE_CAPTURE_REQUIRED", "Select a retained original Node operation export", 404)
            snapshot = captured["snapshot"]
            raw = original_bytes(snapshot)
            if len(raw) != snapshot["source_bytes"]:
                raise Problem("NODE_SOURCE_BYTES", "The retained source length changed", 409)
            return raw
