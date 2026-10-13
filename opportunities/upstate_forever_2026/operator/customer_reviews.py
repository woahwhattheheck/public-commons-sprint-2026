"""Customer review operations composed with the original Workspace and operator.

Review records, response chains and packages remain model.reviews objects.  This
adapter binds them to the operator's existing task identities and file tickets.
"""
from __future__ import annotations

import base64
import hashlib
import json
from pathlib import Path, PurePosixPath
import re
import urllib.parse

from model.common import atomic_json, canonical, digest, file_digest, identifier, read_json
from model import reviews, review_handback

ACTIONS = frozenset({
    "customer.review.create", "customer.review.export", "customer.review.response.import",
    "customer.review.handback.save", "customer.review.handback.export", "customer.review.handback.import",
})
READS = frozenset({"catalog", "review", "template", "compare", "spatial-export",
                   "handbacks", "handback", "handback-template"})
APPLICATION = Path(__file__).resolve().parents[1]


class CustomerReviews:
    def __init__(self, operator, fault):
        self.operator = operator
        self.Fault = fault

    def _id(self, value, field):
        try:
            return identifier(value.get(field))
        except (ValueError, TypeError) as error:
            raise self.Fault("REVIEW_SELECTION", "Choose the retained " + field.replace("_", " ") + ".") from error

    def _json_ticket(self, workspace, value, filename, label):
        directory = self.operator.root / "outputs" / "customer-review-documents" / digest(value)
        directory.mkdir(parents=True, exist_ok=True)
        target = directory / filename
        atomic_json(target, value, immutable=True)
        return self.operator._ticket(workspace, target, {
            "bytes": target.stat().st_size, "sha256": file_digest(target), "filename": filename,
        }, label)

    def _issuer(self):
        path = APPLICATION / "source" / "acceptance" / "20261012" / "review-requirements.json"
        if not path.is_file():
            return None
        value = read_json(path)
        if value.get("schema") != "upstate.rfp-review-requirements/v1":
            raise ValueError("The retained issuer requirement profile has a different schema")
        return {
            "profile_id": value["profile_id"], "title": value["title"],
            "requirements": value["requirements"], "sha256": file_digest(path),
            "filename": path.name,
        }

    def _exports(self, workspace, review_id=None):
        result = []
        for task in self.operator.task_list(workspace):
            if task["action"] != "customer.review.export" or task["state"] != "complete":
                continue
            value = task["result"]
            if review_id is not None and value["review_id"] != review_id:
                continue
            result.append({
                "task_id": task["id"], "review_id": value["review_id"],
                "created_at": task["created_at"], "completed_at": task.get("ended_at"),
                "latest_response_id": value["latest_response_id"],
                "package_sha256": value["package_sha256"], "members": value["members"],
                "archive_bytes": value["archive"]["bytes"],
                "desk_url": self._desk_url(task["id"]),
            })
        return result

    def _handback_exports(self, workspace, handback_id=None):
        result = []
        for task in self.operator.task_list(workspace):
            if task["action"] != "customer.review.handback.export" or task["state"] != "complete":
                continue
            value = task["result"]
            if handback_id is not None and value["handback_id"] != handback_id:
                continue
            result.append({
                "task_id": task["id"], "review_id": value["review_id"], "handback_id": value["handback_id"],
                "created_at": task["created_at"], "completed_at": task.get("ended_at"),
                "package_sha256": value["package_sha256"], "members": value["members"],
                "archive_bytes": value["archive"]["bytes"], "desk_url": self._desk_url(task["id"]),
            })
        return result

    @staticmethod
    def _desk_url(task_id, member="index.html"):
        return "/api/file/review-desk/" + task_id + "/" + urllib.parse.quote(member, safe="/")

    def read(self, workspace, operation, value=None):
        value = value or {}
        ws = self.operator.ws(workspace)
        if operation == "catalog":
            overview = ws.overview()
            def choice(row, kind):
                title = row.get("title") or row.get("selection", {}).get("title")
                if not title and kind == "runs":
                    title = "Native run " + row["id"][:12]
                return {
                    "id": row["id"], "title": title or row["id"][:12],
                    "created_at": row.get("created_at") or row.get("captured_at"),
                    "state": row.get("state", "retained"),
                    "entries": len(row.get("entries", [])),
                    "selection": row.get("selection", {}),
                }
            spatial_exports = []
            for row in overview.get("spatial_exports", []):
                if row.get("state") != "complete":
                    continue
                original = self.operator.spatial_exports[workspace].inspect(row["id"])
                spatial_exports.append({
                    **choice(original, "spatial_exports"),
                    "review_id": original["review_id"],
                    "files": len(original["files"]),
                    "bytes": sum(item["bytes"] for item in original["files"].values()),
                    "summary": original.get("summary", {}),
                })
            return {
                "workspace_key": workspace, "project": ws.project,
                "reviews": reviews.list_reviews(ws),
                "sources": [choice(row, "sources") for row in overview["sources"]],
                "runs": [choice(row, "runs") for row in overview["runs"] if row.get("state") == "complete"],
                "deliveries": [choice(row, "deliveries") for row in overview["deliveries"] if row.get("state") == "complete"],
                "spatial_exports": spatial_exports,
                "issuer": self._issuer(), "exports": self._exports(workspace),
            }
        if operation == "handbacks":
            review_id = self._id(value, "review_id")
            return {"review_id": review_id, "handbacks": review_handback.list_handbacks(ws, review_id)}
        if operation == "handback-template":
            kwargs = {name: self._id(value, name) for name in ("response_id", "handback_id") if value.get(name)}
            if "revised_review_id" in value and value["revised_review_id"] is not None:
                kwargs["revised_review_id"] = self._id(value, "revised_review_id") if value["revised_review_id"] else None
            return review_handback.template(ws, self._id(value, "review_id"), **kwargs)
        if operation == "handback":
            handback_id = self._id(value, "handback_id")
            result = review_handback.show(ws, handback_id)
            result["_exports"] = self._handback_exports(workspace, handback_id)
            result["_downloads"] = [self._json_ticket(workspace, result["handback"], "engineering-handback.json",
                                                        "Complete retained engineering edition")]
            return result
        if operation == "spatial-export":
            export_id = self._id(value, "export_id")
            result = self.operator.item(workspace, "spatial_exports", export_id)
            if result.get("state") != "complete":
                raise self.Fault("REVIEW_MAP_PENDING", "Choose a completed saved map export.", 409)
            return result
        if operation == "review":
            review_id = self._id(value, "review_id")
            packet = reviews.show_review(ws, review_id, previews=True)
            downloads = []
            for item in packet["review"]["artifacts"]:
                path, original = reviews.review_file(ws, review_id, item["id"])
                downloads.append({
                    **self.operator._ticket(workspace, path, {**original, "filename": PurePosixPath(item["original_path"]).name}, item["label"]),
                    "artifact_id": item["id"], "kind": item["kind"], "group": item["group"],
                    "role": item["role"], "media_type": item["media_type"],
                })
            packet["_downloads"] = downloads
            packet["_packet_download"] = self._json_ticket(
                workspace, {key: packet[key] for key in ("schema", "review", "responses", "latest_response_id", "files")},
                "review.json", "Complete retained review and response history")
            packet["_response_downloads"] = [{
                "response_id": record["id"],
                **self._json_ticket(workspace, record["response"], "response.json",
                                    "Response by " + record["response"]["reviewer"]["name"]),
            } for record in packet["responses"]]
            packet["_exports"] = self._exports(workspace, review_id)
            packet["_handbacks"] = review_handback.list_handbacks(ws, review_id)
            return packet
        if operation == "template":
            review_id = self._id(value, "review_id")
            template = reviews.response_template(ws, review_id)
            return {"response": template, "_download": self._json_ticket(
                workspace, template, "response-template.json", "Current response template")}
        if operation == "compare":
            before_id, after_id = self._id(value, "before_id"), self._id(value, "after_id")
            result = reviews.compare_reviews(ws, before_id, after_id)
            before = ws._get("reviews", before_id)
            after = ws._get("reviews", after_id)
            old = {item["id"]: item for item in before["requirements"]}
            new = {item["id"]: item for item in after["requirements"]}
            result["requirements"] = {
                "added": [new[key] for key in sorted(set(new) - set(old))],
                "removed": [old[key] for key in sorted(set(old) - set(new))],
                "changed": [{"before": old[key], "after": new[key]}
                            for key in sorted(set(old) & set(new)) if old[key] != new[key]],
                "unchanged": [new[key] for key in sorted(set(old) & set(new)) if old[key] == new[key]],
            }
            result["before"] = {key: before[key] for key in ("id", "title", "purpose", "selection")}
            result["after"] = {key: after[key] for key in ("id", "title", "purpose", "selection")}
            result["_download"] = self._json_ticket(workspace, result, "review-comparison.json",
                                                     "Complete selected review comparison")
            return result
        raise self.Fault("REVIEW_READ", "Choose a supported customer review view.", 404)

    def invoke(self, task):
        workspace, payload = task["workspace"], task["payload"]
        ws = self.operator.ws(workspace)
        action = task["action"]
        if action == "customer.review.handback.save":
            record = review_handback.save(ws, payload.get("handback"), created_at=task["created_at"])
            return {"review_id": record["review_id"], "handback_id": record["id"], "handback": record}
        if action == "customer.review.handback.export":
            return self._export_handback(task)
        if action == "customer.review.handback.import":
            uploaded = self.operator.upload(self._id(payload, "upload_id"))
            directory = self.operator.root / "outputs" / "customer-review-handback-imports" / task["id"]
            directory.mkdir(parents=True, exist_ok=True)
            desk = directory / "desk"
            if desk.exists():
                inspected = review_handback.inspect_packet(desk)
                incoming = review_handback.inspect_packet(uploaded["path"])
                if inspected["manifest"] != incoming["manifest"]:
                    raise ValueError("This receiving task retained a different original handback")
                joined = review_handback._join(ws, inspected)
                return {**review_handback.describe_export(desk), "joined": joined}
            return review_handback.receive_packet(uploaded["path"], desk, workspace=ws)
        if action == "customer.review.create":
            selection = payload.get("selection")
            record = reviews.create_review(ws, selection, created_at=task["created_at"])
            return {"review_id": record["id"], "review": record}
        if action == "customer.review.response.import":
            review_id = self._id(payload, "review_id")
            if ("upload_id" in payload) == ("response" in payload):
                raise ValueError("Choose one complete response document or its retained upload")
            if "upload_id" in payload:
                uploaded = self.operator.upload(self._id(payload, "upload_id"))
                response = reviews._read_json_file(Path(uploaded["path"]))
            else:
                response = payload["response"]
            if not isinstance(response, dict) or response.get("review_id") != review_id:
                raise ValueError("The returned response belongs to a different selected review")
            record = reviews.import_response(ws, response)
            return {"review_id": review_id, "response_id": record["id"], "record": record}
        if action == "customer.review.export":
            return self._export(task)
        raise self.Fault("REVIEW_ACTION", "Choose a supported customer review operation.")

    def _export(self, task):
        ws = self.operator.ws(task["workspace"])
        payload = task["payload"]
        review_id = self._id(payload, "review_id")
        if "expected_response_id" not in payload:
            raise ValueError("Reopen the selected review before exporting its current response generation")
        expected = payload["expected_response_id"]
        if expected is not None:
            identifier(expected)
        directory = self.operator.root / "outputs" / "customer-review-exports" / task["id"]
        directory.mkdir(parents=True, exist_ok=True)
        desk, archive = directory / "desk", directory / "review-desk.zip"
        if desk.exists():
            result = reviews.describe_export(desk)
        else:
            result = reviews.export_review(ws, review_id, desk, expected_response_id=expected)
        if (result["review_id"] != review_id or result["project_id"] != ws.project["id"]
                or result["latest_response_id"] != expected):
            raise self.Fault("REVIEW_EXPORT_GENERATION",
                             "This export belongs to another review or response generation.", 409)
        if not archive.exists():
            pending = archive.parent / (".review-archive-" + archive.name + ".pending")
            if pending.exists():
                # This task exclusively owns this original helper temporary.
                # All published review members remain in its inspected desk.
                pending.unlink()
            reviews.archive_packet(desk, archive)
        result = reviews.describe_export(desk, archive=archive)
        manifest_path = desk / "review-manifest.json"
        result["manifest"] = {"path": str(manifest_path), "bytes": manifest_path.stat().st_size,
                              "sha256": file_digest(manifest_path)}
        return result

    def _export_handback(self, task):
        ws = self.operator.ws(task["workspace"])
        handback_id = self._id(task["payload"], "handback_id")
        directory = self.operator.root / "outputs" / "customer-review-handbacks" / task["id"]
        directory.mkdir(parents=True, exist_ok=True)
        desk, archive = directory / "desk", directory / "engineering-handback.zip"
        if desk.exists():
            result = review_handback.describe_export(desk)
        else:
            result = review_handback.export_handback(ws, handback_id, desk)
        if result["handback_id"] != handback_id or result["project_id"] != ws.project["id"]:
            raise ValueError("This export belongs to a different original engineering edition")
        if not archive.exists():
            review_handback.archive_packet(desk, archive)
        result = review_handback.describe_export(desk, archive=archive)
        manifest = desk / review_handback.MANIFEST
        result["manifest"] = {"path": str(manifest), "bytes": manifest.stat().st_size, "sha256": file_digest(manifest)}
        return result

    def _export_manifest(self, task):
        if task["action"] not in ("customer.review.export", "customer.review.handback.export") or task["state"] != "complete":
            raise self.Fault("REVIEW_EXPORT_PENDING", "Open a completed review export.", 409)
        result = task["result"]
        engineering = task["action"] == "customer.review.handback.export"
        family = "customer-review-handbacks" if engineering else "customer-review-exports"
        expected_root = self.operator.root / "outputs" / family / task["id"] / "desk"
        directory = Path(result["directory"])
        if directory != expected_root:
            raise self.Fault("REVIEW_EXPORT_PATH", "The retained export is outside its original task directory.", 409)
        file = directory / (review_handback.MANIFEST if engineering else "review-manifest.json")
        descriptor = result["manifest"]
        if file.is_symlink() or file.stat().st_size != descriptor["bytes"] or file_digest(file) != descriptor["sha256"]:
            raise self.Fault("REVIEW_MANIFEST_CHANGED", "The original review export inventory changed.", 409)
        manifest = read_json(file)
        if engineering and manifest.get("handback_id") != result.get("handback_id"):
            raise self.Fault("REVIEW_EXPORT_CHANGED", "The retained engineering edition changed.", 409)
        if (manifest["package_sha256"] != result["package_sha256"]
                or manifest["review_id"] != result["review_id"]
                or manifest["project_id"] != result["project_id"]):
            raise self.Fault("REVIEW_EXPORT_CHANGED", "The retained review export identity changed.", 409)
        return directory, manifest

    def decorate_task(self, task):
        if task["action"] not in ACTIONS or task["state"] != "complete":
            return task
        result = task["result"]
        task["_review"] = {"review_id": result["review_id"]}
        if task["action"].startswith("customer.review.handback."):
            task["_review"].update(handback_id=result["handback_id"], kind="engineering-handback")
        if task["action"] == "customer.review.handback.export":
            directory, manifest = self._export_manifest(task)
            task["_downloads"] = [
                self.operator._ticket(task["workspace"], result["archive"]["path"], result["archive"],
                                      "Complete engineering handback with both original review desks"),
                self.operator._ticket(task["workspace"], directory / "handback.json",
                                      manifest["members"]["handback.json"], "Complete engineering history"),
                self.operator._ticket(task["workspace"], directory / "request-resolutions.csv",
                                      manifest["members"]["request-resolutions.csv"], "All request resolutions"),
            ]
            task["_review"].update(desk_url=self._desk_url(task["id"]), package_sha256=result["package_sha256"])
        elif task["action"] in ("customer.review.handback.save", "customer.review.handback.import"):
            record = review_handback.show(self.operator.ws(task["workspace"]), result["handback_id"])["handback"]
            task["_downloads"] = [self._json_ticket(task["workspace"], record, "engineering-handback.json",
                                                    "Retained engineering response")]
        elif task["action"] == "customer.review.export":
            directory, manifest = self._export_manifest(task)
            files = [self.operator._ticket(task["workspace"], result["archive"]["path"],
                                            result["archive"], "Complete offline review desk")]
            for name, label in (("review.json", "Complete selected review and history"),
                                ("response-template.json", "Current response template")):
                files.append(self.operator._ticket(task["workspace"], directory / name,
                                                    manifest["members"][name], label))
            files.append(self.operator._ticket(task["workspace"], result["manifest"]["path"],
                                                result["manifest"], "Original review file inventory"))
            task["_downloads"] = files
            task["_review"].update(desk_url=self._desk_url(task["id"]),
                                   latest_response_id=result["latest_response_id"],
                                   package_sha256=result["package_sha256"])
        elif task["action"] == "customer.review.response.import":
            task["_downloads"] = [self._json_ticket(task["workspace"], result["record"]["response"],
                                                     "response.json", "Retained customer response")]
        return task

    def desk_member(self, task_id, member):
        task = self.operator.task(identifier(task_id))
        directory, manifest = self._export_manifest(task)
        relative = PurePosixPath(member)
        if ("\\" in member or "\0" in member or relative.is_absolute()
                or str(relative) != member or any(part in (".", "..") for part in relative.parts)):
            raise self.Fault("REVIEW_MEMBER", "Choose an original review package member.", 404)
        if member == (review_handback.MANIFEST if task["action"] == "customer.review.handback.export" else "review-manifest.json"):
            descriptor = task["result"]["manifest"]
        else:
            descriptor = manifest["members"].get(member)
        if descriptor is None:
            raise self.Fault("REVIEW_MEMBER", "This file is outside the selected review package.", 404)
        path = directory.joinpath(*relative.parts)
        if not path.resolve().is_relative_to(directory.resolve()) or path.is_symlink():
            raise self.Fault("REVIEW_MEMBER_CHANGED", "The original review package member changed.", 409)
        ticket = self.operator._ticket(task["workspace"], path, descriptor, path.name)
        policy = None
        engineering_desk = (task["action"] == "customer.review.handback.export"
                            and re.fullmatch(r"reviews/[0-9a-f]{64}/(?:[0-9a-f]{64}|original)/index\.html", member))
        if member == "index.html" or engineering_desk:
            # Only the original exporter-created application gets executable
            # scripts.  Arbitrary selected HTML retains the normal file sandbox.
            content = path.read_bytes()
            if len(content) != descriptor["bytes"] or hashlib.sha256(content).hexdigest() != descriptor["sha256"]:
                raise self.Fault("REVIEW_APPLICATION_CHANGED", "The original review application changed.", 409)
            scripts = re.findall(r"<script\b[^>]*>(.*?)</script>", content.decode("utf-8"), re.S | re.I)
            hashes = ["'sha256-" + base64.b64encode(hashlib.sha256(script.encode("utf-8")).digest()).decode("ascii") + "'"
                      for script in scripts]
            policy = ("default-src 'none'; script-src " + " ".join(hashes)
                      + "; style-src 'unsafe-inline'; img-src 'self' data: blob:; "
                      "object-src 'self'; frame-src 'self'; connect-src 'none'; "
                      "base-uri 'none'; form-action 'none'; frame-ancestors 'self'")
        return ticket, policy
