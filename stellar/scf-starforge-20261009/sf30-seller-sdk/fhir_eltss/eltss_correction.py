"""MIT. Reviewed exact-path corrections retain their full original predecessor."""
from __future__ import annotations
import os
from pathlib import Path

from eltss_runtime import InputError, ConflictError, original_workspace, write_zip
import eltss_source as source
from eltss_validation import typed


def _selected(root, tokens):
    value = root
    for token in tokens:
        if isinstance(value, dict) and token in value:
            value = value[token]
        elif isinstance(value, list) and token.isdecimal() and (token == "0" or not token.startswith("0")) and int(token) < len(value):
            value = value[int(token)]
        else:
            raise InputError("Correction path does not select an existing original value")
    return value


def _change(root, tokens, action, value=None):
    if any(token == "*" for token in tokens):
        raise InputError("Corrections require exact paths, without wildcard selection")
    if not tokens:
        if action != "replace" or not isinstance(value, dict):
            raise InputError("A complete resource can only be replaced by another complete resource object")
        return value
    parent = _selected(root, tokens[:-1])
    key = tokens[-1]
    if isinstance(parent, dict):
        exists = key in parent
        if action in {"replace", "remove"} and not exists:
            raise InputError("Correction replace/remove requires an existing original object field")
        if action == "remove":
            del parent[key]
        else:
            parent[key] = value
    elif isinstance(parent, list):
        if key == "-" and action == "add":
            number = len(parent)
        elif key.isdecimal() and (key == "0" or not key.startswith("0")):
            number = int(key)
        else:
            raise InputError("Array corrections require an exact original index or explicit add '-'")
        if action == "add":
            if number > len(parent):
                raise InputError("Array addition is outside its actual bounds")
            parent.insert(number, value)
        elif number >= len(parent):
            raise InputError("Array correction is outside its actual bounds")
        elif action == "remove":
            del parent[number]
        else:
            parent[number] = value
    else:
        raise InputError("Correction parent must be an original object or array")
    return root


class CorrectionMixin:
    def _correction_request(self, raw):
        value = typed("correction", raw)
        if not value["patches"]:
            raise InputError("A correction needs at least one explicit original resource patch")
        for patch in value["patches"]:
            if not {"recordId", "path", "action"} <= set(patch):
                raise InputError("Every correction patch requires recordId, path and action")
            if patch["action"] in {"add", "replace"}:
                if patch.get("valueJson") is None:
                    raise InputError("Add/replace requires complete authored valueJson")
                source.json_value(patch["valueJson"], lexical=True)
            elif patch.get("valueJson") is not None:
                raise InputError("Remove does not carry a replacement value")
        return value

    def _derive_correction(self, request, temp):
        edition = self.edition(request["editionId"])
        request_sha = source.sha(source.jbytes(request))
        bundle_path, change_path = Path(temp) / "corrected-bundle.json", Path(temp) / "patches.jsonl"
        groups, originals, record_locations, top_order = {}, {}, {}, {}
        change_count, change_bytes, bundle_bytes = 0, 0, 0
        with self._index(edition["sourceId"]) as index:
            for patch in request["patches"]:
                row = index.row(patch["recordId"])
                top = row
                visited = set()
                while top.get("containedIn") or top.get("bundleIn"):
                    if top["recordId"] in visited:
                        raise InputError("Original resource ownership cycle")
                    visited.add(top["recordId"])
                    top = index.row(top.get("containedIn") or top["bundleIn"])
                top_tokens = source.pointer_tokens(top["entryPointer"])
                own_tokens = source.pointer_tokens(row["entryPointer"])
                if own_tokens[:len(top_tokens)] != top_tokens:
                    raise InputError("Original correction record is outside its owning resource")
                groups.setdefault(top["recordId"], []).append((patch, own_tokens[len(top_tokens):]))
                originals[row["recordId"]] = row["resourceSha256"]
            with os.fdopen(os.open(bundle_path, os.O_WRONLY | os.O_CREAT | os.O_EXCL, 0o600), "wb") as bundle, \
                    os.fdopen(os.open(change_path, os.O_WRONLY | os.O_CREAT | os.O_EXCL, 0o600), "wb") as changes:
                def write(data):
                    nonlocal bundle_bytes
                    bundle_bytes += len(data)
                    if bundle_bytes > source.MAX_SOURCE:
                        raise InputError("Complete corrected Bundle exceeds 256 MiB")
                    bundle.write(data)
                prefix = {"resourceType": "Bundle", "type": "collection", "id": "operator-correction-" + request_sha[:32]}
                write((source.lexical_json(prefix)[:-1] + ',"entry":[').encode())
                number = 0
                for row in index.all_rows():
                    if row.get("containedIn") or row.get("bundleIn"):
                        continue
                    resource = row["_resource"]
                    expected = dict(originals)
                    for patch, base in groups.get(row["recordId"], []):
                        selected_resource = _selected(resource, base)
                        if source.sha(source.lexical_json(selected_resource).encode()) != expected[patch["recordId"]]:
                            raise InputError("An earlier patch changed another selected resource's location or body; select one common owning record for these ordered edits")
                        absolute = base + patch["path"]
                        before_exists = True
                        try:
                            before = _selected(resource, absolute)
                            before_text = source.lexical_json(before)
                        except InputError:
                            before_exists, before_text = False, None
                        replacement = source.json_value(patch["valueJson"], lexical=True) if patch.get("valueJson") is not None else None
                        resource = _change(resource, absolute, patch["action"], replacement)
                        expected[patch["recordId"]] = source.sha(source.lexical_json(_selected(resource, base)).encode())
                        after_text = None
                        if patch["action"] != "remove":
                            # Array append '-' resolves to the newly appended actual index.
                            after_path = absolute
                            if absolute and absolute[-1] == "-":
                                parent = _selected(resource, absolute[:-1])
                                after_path = absolute[:-1] + [str(len(parent) - 1)]
                            after_text = source.lexical_json(_selected(resource, after_path))
                        change = {"recordId": patch["recordId"], "owningRecordId": row["recordId"],
                            "path": patch["path"], "originalPointer": index.row(patch["recordId"])["entryPointer"] + source.pointer(patch["path"]),
                            "action": patch["action"], "beforeExists": before_exists,
                            "beforeJson": before_text, "afterJson": after_text}
                        raw_change = source.jbytes(change)
                        change_bytes += len(raw_change)
                        if change_bytes > source.MAX_SOURCE:
                            raise InputError("Complete correction changes exceed 256 MiB")
                        changes.write(raw_change)
                        change_count += 1
                    if not isinstance(resource, dict) or not isinstance(resource.get("resourceType"), str):
                        raise InputError("Correction must retain a complete resource")
                    entry = {"resource": resource}
                    if row.get("fullUrl") is not None:
                        entry["fullUrl"] = row["fullUrl"]
                    if number:
                        write(b",")
                    write(source.lexical_json(entry).encode())
                    top_order[row["recordId"]] = (number, row["entryPointer"])
                    number += 1
                write(b"]}\n")
                for stream in [bundle, changes]:
                    stream.flush()
                    os.fsync(stream.fileno())
            document_sha = original_workspace.file_digest(bundle_path)
            document = {"name": "documents/corrected-bundle.json", "bytes": bundle_path.stat().st_size,
                "sha256": document_sha, "role": "authored-resource-collection", "sourceUrl": None}
            member_id = source.sha(source.jbytes({"name": document["name"], "sha256": document_sha}))
            for row in index.all_rows():
                top = row
                while top.get("containedIn") or top.get("bundleIn"):
                    top = index.row(top.get("containedIn") or top["bundleIn"])
                ordinal, original_pointer = top_order[top["recordId"]]
                suffix = row["entryPointer"][len(original_pointer):]
                at = "/entry/" + str(ordinal) + "/resource" + suffix
                record_locations[row["recordId"]] = source.sha(source.jbytes({
                    "memberId": member_id, "pointer": at, "ordinal": ordinal + 1}))
        return {"requestSha256": request_sha, "bundlePath": bundle_path, "document": document,
                "changesPath": change_path, "changeCount": change_count, "recordMap": record_locations}

    def preview_correction(self, raw):
        request = self._correction_request(raw)
        request_sha = source.sha(source.jbytes(request))
        with self.mutex:
            for old in self._list("correctionPreviews"):
                if old["requestSha256"] == request_sha:
                    self._file_path(old["changesFile"])
                    return old
            with self.scratch() as temp:
                derived = self._derive_correction(request, temp)
                retained = self._retain_file(derived["changesPath"], "correction-preview-changes")
                preview, size = [], 0
                with derived["changesPath"].open("rb") as stream:
                    for raw_change in stream:
                        change = source.json_value(raw_change)
                        row = {key: change[key] for key in ["recordId", "owningRecordId", "path", "originalPointer", "action", "beforeExists"]}
                        for field in ["beforeJson", "afterJson"]:
                            text = change[field]
                            row[field] = text if text is None or len(text.encode()) <= 8192 else None
                            row[field + "Sha256"] = source.sha(text.encode()) if text is not None else None
                            row[field + "Bytes"] = len(text.encode()) if text is not None else 0
                        count = len(source.jbytes(row))
                        if size + count <= 1024 * 1024:
                            preview.append(row)
                            size += count
                return self._store("correctionPreviews", {"request": request, "changes": preview,
                    "changeCount": derived["changeCount"], "changesFile": retained,
                    "sourceEditionId": request["editionId"], "requestSha256": request_sha,
                    "derivedDocument": derived["document"]})

    def apply_correction(self, raw):
        source.exact(raw, {"previewId", "expectedRequestSha256"}, "Apply reviewed original correction")
        preview_id, expected = source.identity(raw.get("previewId")), source.identity(raw.get("expectedRequestSha256"))
        with self.mutex:
            preview = self._get("correctionPreviews", preview_id)
            if preview["requestSha256"] != expected:
                raise ConflictError("Correction preview no longer matches the exact reviewed request")
            for old in self._list("corrections"):
                if old["previewId"] == preview_id:
                    self.source(old["sourceId"])
                    self.edition(old["editionId"])
                    return old
            request = preview["request"]
            predecessor = self.edition(request["editionId"])
            original = self.source_path(predecessor["sourceId"])
            with self.scratch() as temp:
                derived = self._derive_correction(request, temp)
                if derived["document"] != preview["derivedDocument"] or \
                        original_workspace.file_digest(derived["changesPath"]) != preview["changesFile"]["sha256"]:
                    raise ConflictError("Exact original correction inputs differ from the retained preview")
                metadata = {"schema": "stellar-forge.eltss-correction.v1", "previewId": preview_id,
                    "requestSha256": expected, "request": request, "recordMap": derived["recordMap"],
                    "sourceEditionId": predecessor["id"], "sourceId": predecessor["sourceId"]}
                metadata_bytes = source.jbytes(metadata)
                predecessor_member = {"name": "predecessors/" + predecessor["sourceId"] + ".eltss",
                    "bytes": original.stat().st_size, "sha256": predecessor["sourceId"], "role": "complete-original-predecessor"}
                protocol = source.descriptor("protocol/correction.json", metadata_bytes, role="authored-correction")
                manifest = {"schema": source.SOURCE_SCHEMA, "origin": "operator_transformation",
                    "documents": [derived["document"]], "protocol": [protocol], "predecessors": [predecessor_member],
                    "context": metadata}
                members = {derived["document"]["name"]: derived["bundlePath"], protocol["name"]: metadata_bytes,
                    predecessor_member["name"]: original, "manifest.json": source.jbytes(manifest)}
                total = sum(len(item) if isinstance(item, bytes) else item.stat().st_size for item in members.values())
                if total > source.MAX_SOURCE:
                    raise InputError("The complete corrected collection plus its unchanged predecessor exceeds the 256 MiB source packet budget")
                path = Path(temp) / "corrected-source.zip"
                write_zip(path, members)
                with path.open("rb") as stream:
                    original_source = self.add_source(stream, request["label"], "eltss-authored-correction.zip")
                successor = self.save_edition({"label": request["label"], "sourceId": original_source["id"],
                    "predecessorId": predecessor["id"],
                    "carePlanIds": [derived["recordMap"][ident] for ident in predecessor["carePlanIds"]],
                    "referencePolicy": predecessor["referencePolicy"], "baseUrl": predecessor["baseUrl"],
                    "decisionIds": [], "owner": predecessor.get("owner", ""), "actor": request["actor"],
                    "note": request["reason"]})
            return self._store("corrections", {"sourceEditionId": predecessor["id"],
                "sourceId": original_source["id"], "editionId": successor["id"], "previewId": preview_id,
                "requestSha256": expected, "recordMap": derived["recordMap"],
                "actor": request["actor"], "reason": request["reason"]})
