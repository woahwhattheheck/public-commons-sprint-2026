"""Read original scientific recipe sections and complete verified source members.

This is a view of retained source bytes. It neither collects/render reports nor
creates a new study, changes a source selection, or recomputes measurements.
"""
from __future__ import annotations

from hashlib import sha256
from pathlib import PurePosixPath
from urllib.parse import quote

from model import observed_context
from model.common import identifier


class ScientificSourceReader:
    def __init__(self, operator, fault):
        self.operator, self.Fault = operator, fault

    @staticmethod
    def _key(source_id):
        return sha256(source_id.encode("utf-8")).hexdigest()

    def _source(self, workspace, payload):
        choices = observed_context.source_choices({"observed_context_sources": [{
            "source_collection_id": payload.get("source_collection_id"),
            "source_id": payload.get("source_id"),
        }]})
        choice = choices[0]
        identifier(choice["source_collection_id"])
        source = observed_context._source(
            self.operator.ws(workspace), {"source_roles": {observed_context.ROLE: choice}})
        expected = payload.get("body_sha256")
        if expected is not None and identifier(expected) != source["binding"]["body_sha256"]:
            raise self.Fault("SCIENTIFIC_SOURCE_CHANGED",
                             "Read the exact retained source edition selected for this report.", 409)
        return source

    def _url(self, workspace, source, name):
        binding = source["binding"]
        parts = [workspace, binding["source_collection_id"], self._key(binding["source_id"])]
        return ("/api/file/scientific-source/" + "/".join(quote(str(x), safe="") for x in parts)
                + "/" + quote(name, safe="/"))

    def detail(self, workspace, payload):
        source = self._source(workspace, payload)
        entry, recipe, members = source["entry"], source["recipe"], source["members"]
        collection_id = source["binding"]["source_collection_id"]
        collection = self.operator.ws(workspace)._get("sources", collection_id)
        original = collection["original_manifest"]
        files = [{"path": name, "bytes": item["bytes"], "sha256": item["sha256"],
                  "url": self._url(workspace, source, name),
                  "kind": ("html" if PurePosixPath(name).suffix.lower() in (".html", ".htm")
                           else "svg" if PurePosixPath(name).suffix.lower() == ".svg" else "data")}
                 for name, item in sorted(members.items())]
        return {
            "schema": "upstate.scientific-source-reader/v1", "workspace_key": workspace,
            "source": {**source["binding"], "title": entry["title"], "vintage": entry["vintage"],
                       "uri": entry["uri"], "collection_title": collection.get("title", collection_id),
                       "metadata": entry.get("metadata") or {}},
            # Keep complete original typed blocks, extra metadata and exact raw cells.
            "recipe": recipe, "files": files,
            "original_manifest": self.operator._ticket(
                workspace, self.operator.ws(workspace).root / original["object"], original,
                "Complete original source manifest"),
        }

    def member(self, workspace, collection_id, source_key, name):
        identifier(collection_id)
        identifier(source_key)
        collection = self.operator.ws(workspace)._get("sources", collection_id)
        matches = [entry for entry in collection.get("entries", [])
                   if self._key(entry["id"]) == source_key]
        if len(matches) != 1:
            raise self.Fault("SCIENTIFIC_SOURCE_MEMBER", "Choose one exact original scientific source.", 404)
        source = self._source(workspace, {"source_collection_id": collection_id,
                                         "source_id": matches[0]["id"]})
        # _source has already checked every retained member's canonical path, bytes and hash.
        item = source["members"].get(name)
        if item is None:
            raise self.Fault("SCIENTIFIC_SOURCE_MEMBER", "Choose a member of this exact original source.", 404)
        descriptor = {"path": name, "bytes": item["bytes"], "sha256": item["sha256"]}
        ticket = self.operator._ticket(workspace, item["path"], descriptor, name)
        policy = None
        if PurePosixPath(name).suffix.lower() in (".html", ".htm"):
            from source_reports import document_policy
            policy = document_policy(item["path"].read_bytes())
        return ticket, policy
