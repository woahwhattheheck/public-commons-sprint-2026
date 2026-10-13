#!/usr/bin/env python3
"""Join the regional source review and issuer requirements to one native Workspace.

The spatial receiving programme owns the operation, browser and first backup.
This module performs the customer review's original native operations only.
"""
from __future__ import annotations
import argparse
import hashlib
import json
import os
from pathlib import Path
import sys
import tempfile

CONTEXT_SCHEMA = "upstate.customer-spatial-receiving-context/v1"
STATE_SCHEMA = "upstate.customer-spatial-receiving-state/v1"
SOURCE_ID = "upstate-wbd-upstream-domain-20261012"
SOURCE_MANIFEST_SHA = "ac652012c82671c8fdc5d6711f0f9a63f35c1573061419deae6153f8b19a2a03"
SOURCE_BODY_SHA = "6f49c2f1dc10709d7957e38e92642a1de4cda44e67e4d70a8bc2ff51388e6af9"
ISSUER_DIR = "source/acceptance/20261012"
ISSUER_ID = "upstate-ec-sdc-rfp-20261002"
ISSUER_MANIFEST_SHA = "c2121841d36f1c35ef20aebe2b294c2871759b2d15d2b1d33c22f0354894d814"
REVIEWER = {"name": "C79F internal engineering review", "role": "Internal engineering", "organization": "TJLabs"}
SOURCE_PINS = {
    "model/reviews.py": (61280, "2856adfc5b2c2b94478c1f3689a7d16465608fcf3b4eb062c84b87c111576a3a"),
    "model/review_cli.py": (11123, "ab70cf9ff6dbb289b1db4725675b35dd4e7e60bb04a191e8fd3782a02f82d579"),
    "operator/review_app.html": (61791, "17fafcc5f2ea4dd77fa3efbdfa83661ba9c64f414420e2864f3466301c0ab70c"),
    "operator/CUSTOMER_REVIEW.md": (8403, "92be15084b22aabc7ced0ec081c006ac6bb99c9d7ba3456c91e95d62d12fda2d"),
    ISSUER_DIR + "/acceptance-profile.json": (53691, "604fade1397073c8ecae168f5481d136c8fe503bb824746d5930906e0c77e6ed"),
    ISSUER_DIR + "/review-requirements.json": (19901, "23a6e7f171fb26f6c42658d2574b0f241812a9784454e0e524f926144607e52f"),
    ISSUER_DIR + "/community-context.csv": (1416, "ea6f6bd3705bc9662a2cace8a7247849dceb2bdbb92f8c17ef444efd109d103c"),
    ISSUER_DIR + "/README.md": (3200, "99f462c19a0fd768a4135dd7f5db5f01951e77a85bcdc12630a4452b86e1cb2e"),
    ISSUER_DIR + "/sources.json": (1909, ISSUER_MANIFEST_SHA),
    ISSUER_DIR + "/official-rfp.pdf": (7470549, "04313cdda0b19f98b4081ef1eeec2f52707437759f9058f8d0e5abc8d83d6dbf"),
}


def require(condition, message):
    if not condition:
        raise ValueError(message)


def encoded(value):
    return json.dumps(value, sort_keys=True, ensure_ascii=False, separators=(",", ":")).encode("utf-8")


def digest(value):
    return hashlib.sha256(encoded(value)).hexdigest()


def file_record(path):
    path = Path(path)
    require(path.is_file() and not path.is_symlink(), "Expected an ordinary retained file: " + str(path))
    h = hashlib.sha256()
    with path.open("rb") as stream:
        for block in iter(lambda: stream.read(1024 * 1024), b""):
            h.update(block)
    return {"path": str(path), "bytes": path.stat().st_size, "sha256": h.hexdigest()}


def read_json(path):
    return json.loads(Path(path).read_text(encoding="utf-8"))


def sync_directory(path):
    descriptor = os.open(path, os.O_RDONLY | getattr(os, "O_DIRECTORY", 0))
    try:
        os.fsync(descriptor)
    finally:
        os.close(descriptor)


def publish(path, value, *, immutable=False, raw=False):
    """Publish complete bytes, syncing the file and directory before return."""
    path = Path(path)
    body = value if raw else encoded(value) + b"\n"
    path.parent.mkdir(parents=True, exist_ok=True)
    require(not path.is_symlink(), "Preserve the existing symbolic link: " + str(path))
    if path.exists():
        if path.read_bytes() == body:
            sync_directory(path.parent)
            return
        require(not immutable, "Retained original bytes differ: " + str(path))
    descriptor, temporary = tempfile.mkstemp(prefix="." + path.name + "-", dir=path.parent)
    temporary = Path(temporary)
    try:
        with os.fdopen(descriptor, "wb") as stream:
            stream.write(body)
            stream.flush()
            os.fsync(stream.fileno())
        if immutable:
            try:
                os.link(temporary, path)
            except FileExistsError:
                require(path.is_file() and not path.is_symlink() and path.read_bytes() == body,
                        "A different original file appeared: " + str(path))
        else:
            os.replace(temporary, path)
        sync_directory(path.parent)
    finally:
        temporary.unlink(missing_ok=True)


def clean_packet(packet):
    # Offline previews are derived; every native record and original file stays.
    result = json.loads(json.dumps(packet))
    for artifact in result["review"]["artifacts"]:
        artifact.pop("preview", None)
    return result


class Receiving:
    def __init__(self, args):
        self.args = args
        self.context_path = Path(args.context).resolve()
        self.context = read_json(self.context_path)
        require(self.context.get("schema") == CONTEXT_SCHEMA, "Select the original customer receiving context")
        for key in ("operation_id", "application", "workspace_root", "output", "spatial_review_id", "source_collection_id"):
            require(isinstance(self.context.get(key), str) and self.context[key].strip(), "Missing context field: " + key)
        self.spatial_export_ids = self.context.get("spatial_export_ids", [])
        require(isinstance(self.spatial_export_ids, list)
                and all(isinstance(key, str) and key.strip() for key in self.spatial_export_ids)
                and len(self.spatial_export_ids) == len(set(self.spatial_export_ids)),
                "Select each original completed map export once")
        require(args.phase == "restored" or not (args.application or args.workspace),
                "Application/workspace relocation is only for the original restored phase")
        self.application = Path(args.application or self.context["application"]).resolve()
        self.workspace_path = Path(args.workspace or self.context["workspace_root"]).resolve()
        self.output = Path(self.context["output"]).resolve()
        require(not self.output.is_relative_to(self.application) and not self.output.is_relative_to(self.workspace_path),
                "Customer exports belong outside the application and Workspace")
        require((self.workspace_path / "workspace.json").is_file(), "Reopen the original retained Workspace")
        self.output.mkdir(parents=True, exist_ok=True)
        self.context_sha = digest(self.context)
        self.state_path = self.output / "customer-review-state.json"
        # The spatial programme has already frozen this complete application.
        for name, (size, sha) in SOURCE_PINS.items():
            actual = file_record(self.application / name)
            require((actual["bytes"], actual["sha256"]) == (size, sha), "Original customer/issuer source differs: " + name)
        sys.path.insert(0, str(self.application))
        from model import reviews
        from model.common import held
        from model.workspace import Workspace
        self.reviews, self.held = reviews, held
        self.workspace = Workspace(self.workspace_path)

    def load(self):
        publish(self.output / "original-context.json", self.context, immutable=True)
        if self.state_path.exists():
            self.state = read_json(self.state_path)
            require(self.state.get("schema") == STATE_SCHEMA and self.state.get("context_sha256") == self.context_sha,
                    "Continue the original customer review context")
        else:
            require(self.args.phase == "prepare", "Prepare the original review before continuing it")
            self.state = {"schema": STATE_SCHEMA, "context_sha256": self.context_sha,
                          "operation_id": self.context["operation_id"]}
            self.save()
        self.anchor("project", self.workspace.project)

    def save(self):
        publish(self.state_path, self.state)

    def anchor(self, key, value):
        if key in self.state:
            require(self.state[key] == value, "Original customer receiving identity changed: " + key)
        else:
            self.state[key] = value
            self.save()
        return value

    def sources_and_selection(self, *, create):
        workspace = self.workspace
        original_id = self.context["source_collection_id"]
        original = workspace._get("sources", original_id)
        require(original["original_manifest"]["sha256"] == SOURCE_MANIFEST_SHA,
                "Select the original 217-feature upstream source edition")
        original_body, original_entry = workspace.source_file(original_id, SOURCE_ID)
        require(file_record(original_body)["sha256"] == SOURCE_BODY_SHA, "Original upstream native bytes changed")
        entry = next((item for item in original["entries"] if item["id"] == SOURCE_ID), None)
        require(entry is not None and entry.get("role") == "MODEL_DOMAIN", "Retain the original upstream MODEL_DOMAIN role")
        spatial = workspace._get("spatial-reviews", self.context["spatial_review_id"])
        self.anchor("spatial_review", spatial)
        self.anchor("original_source", original)

        if "issuer_source_collection_id" in self.state:
            issuer = workspace._get("sources", self.state["issuer_source_collection_id"])
        else:
            matches = [item for item in workspace.sources()
                       if item.get("original_manifest", {}).get("sha256") == ISSUER_MANIFEST_SHA]
            require(len(matches) <= 1, "Preserve and reconcile the already retained issuer source editions")
            issuer = matches[0] if matches else None
            if issuer is None:
                require(create, "The restored Workspace lacks its original issuer source edition")
                issuer = workspace.import_sources(self.application / ISSUER_DIR / "sources.json")
            self.anchor("issuer_source_collection_id", issuer["id"])
        require(issuer["original_manifest"]["sha256"] == ISSUER_MANIFEST_SHA, "Original issuer manifest changed")
        issuer_body, issuer_entry = workspace.source_file(issuer["id"], ISSUER_ID)
        body = file_record(issuer_body)
        require((body["bytes"], body["sha256"]) == SOURCE_PINS[ISSUER_DIR + "/official-rfp.pdf"],
                "Original issuer PDF changed after native import")
        self.anchor("issuer_source", issuer)

        document = read_json(self.application / ISSUER_DIR / "review-requirements.json")
        requirements = document["requirements"]
        require(document.get("schema") == "upstate.rfp-review-requirements/v1"
                and len(requirements) == 33 and len({x["id"] for x in requirements}) == 33,
                "Select all 33 source-linked issuer requirements")
        require(all(set(item) == {"id", "title", "detail"} for item in requirements),
                "Keep each exact original requirement ID, title and detail")
        selection = {
            "schema": "upstate.customer-review-selection/v1",
            "title": "Upper Savannah source and issuer review",
            "purpose": ("Review the retained upstream MODEL_DOMAIN, the Upper Toxaway River spatial selection, "
                        "and the original EC-SDC issuer requirements for project planning and customer discussion. "
                        "Record source coverage and the review arrangements alongside the source-linked requirements. "
                        "Final modeled maps, delivery acceptance and issuer decisions remain separate project work."),
            "source_collection_ids": [original_id, issuer["id"]],
            "run_ids": [], "delivery_ids": [], "requirements": requirements,
            "notes": [
                "Receiving operation: " + self.context["operation_id"],
                "Original spatial review: " + self.context["spatial_review_id"],
                "Original receiving context SHA256: " + self.context_sha,
                "217-feature upstream MODEL_DOMAIN; HUC12 030601010101, Upper Toxaway River.",
                "C79F records this internal engineering response under its own identity. Customer comments and decisions can follow in the same native response history.",
                "The 33 source-linked requirements retain the issuer PDF and attributed community context."
            ]
        }
        if self.spatial_export_ids:
            selection["spatial_export_ids"] = self.spatial_export_ids
            selection["title"] = "Upper Savannah source, saved map and issuer review"
            selection["purpose"] = (
                "Review the retained upstream MODEL_DOMAIN, the selected completed Upper Toxaway River "
                "map exports and the original EC-SDC issuer requirements for project planning and customer "
                "discussion. Inspect the original map images, selected geographic view, source context "
                "and annotations beside the complete source-linked requirements.")
            selection["notes"].append("Original completed map exports: " + ", ".join(self.spatial_export_ids))
        selected = self.reviews._selection(selection)
        if "selection" in self.state:
            require(self.reviews._selection(self.state["selection"]) == selected,
                    "Continue the same original customer source, map and requirement selection")
        else:
            self.anchor("selection", selected)
        return selected

    def ensure_review(self, *, create):
        selection = self.sources_and_selection(create=create)
        if "review_id" in self.state:
            review = self.workspace._get("reviews", self.state["review_id"])
            require(self.reviews._selection(review["selection"]) == selection,
                    "Reopen the same selected native customer review")
        else:
            matches = [record for record in self.workspace._list("reviews")
                       if self.reviews._selection(record["selection"]) == selection]
            require(len(matches) <= 1, "Preserve the existing matching reviews before selecting one")
            require(create or matches, "The restored Workspace lacks the original customer review")
            review = matches[0] if matches else self.reviews.create_review(self.workspace, selection)
            self.anchor("review_id", review["id"])
        self.anchor("review", review)
        packet = self.reviews.show_review(self.workspace, review["id"], previews=False)
        self.anchor("files", packet["files"])
        self.anchor_map_exports(packet)
        return packet

    def anchor_map_exports(self, packet):
        """Retain the already inspected map records from the original review."""
        selected = [item for item in packet["review"]["selections"]
                    if item["kind"] == "spatial-exports"]
        require([item["id"] for item in selected] == self.spatial_export_ids,
                "The review must retain every selected original completed map export")
        originals, saved_views = [], []
        for item in selected:
            original = item["source"]
            require(original["id"] == item["id"] and original["state"] == "complete"
                    and original["project_id"] == self.workspace.project["id"],
                    "The completed map belongs to a different original project")
            saved_view = self.workspace._get("spatial-reviews", original["review_id"])
            require(saved_view["id"] == original["review_id"],
                    "Reopen the completed map's original saved geographic view")
            if not any(view["id"] == saved_view["id"] for view in saved_views):
                saved_views.append(saved_view)
            artifacts = [artifact for artifact in packet["review"]["artifacts"]
                         if artifact["selection_kind"] == "spatial-exports"
                         and artifact["selection_id"] == item["id"]]
            by_path = {artifact["original_path"]: artifact for artifact in artifacts}
            expected_paths = {"export.json"} | {member["path"] for member in original["files"].values()}
            require(len(by_path) == len(artifacts) and set(by_path) == expected_paths,
                    "The customer packet must include the complete original map file set")
            for member in original["files"].values():
                artifact = by_path[member["path"]]
                require((artifact["bytes"], artifact["sha256"]) == (member["bytes"], member["sha256"]),
                        "An original completed map member changed in the customer packet")
            originals.append(original)
        self.anchor("spatial_exports", originals)
        self.anchor("map_spatial_reviews", saved_views)

    def export(self, name, packet, *, archive=True):
        destination = self.output / name
        if destination.exists():
            retained = self.reviews.inspect_packet(destination)
            require(clean_packet(retained["packet"]) == clean_packet(packet),
                    "Retain the existing customer packet with its original response history: " + name)
        else:
            self.reviews.export_review(self.workspace, packet["review"]["id"], destination)
            retained = self.reviews.inspect_packet(destination)
            require(clean_packet(retained["packet"]) == clean_packet(packet), "Export changed a native review record")
        manifest = retained["manifest"]
        result = {"entry": str(destination / "index.html"), "packet_directory": str(destination),
                  "package_sha256": manifest["package_sha256"], "artifact_count": len(packet["files"])}
        if archive:
            archive_path = self.output / (name + ".zip")
            if not archive_path.exists():
                pending = archive_path.parent / (".review-archive-" + archive_path.name + ".pending")
                if pending.exists():
                    # Reuse a fully written original pending archive after interruption.
                    inspected = self.reviews.inspect_packet(pending)
                    require(inspected["manifest"] == manifest, "Pending archive belongs to a different original packet")
                    os.link(pending, archive_path)
                    sync_directory(archive_path.parent)
                    pending.unlink()
                else:
                    self.reviews.archive_packet(destination, archive_path)
                    sync_directory(archive_path.parent)
            checked_archive = self.reviews.inspect_packet(archive_path)
            require(checked_archive["manifest"] == manifest, "Retained customer archive differs from its packet")
            result["archive"] = {**file_record(archive_path), "package_sha256": manifest["package_sha256"]}
        return result

    def result(self, phase, packet, exported):
        response_id = self.state.get("response_id")
        return {"phase": phase, "operation_id": self.context["operation_id"],
                "review_id": packet["review"]["id"], "project_id": self.workspace.project["id"],
                "requirements": len(packet["review"]["requirements"]), "source_collection_id": self.context["source_collection_id"],
                "issuer_source_collection_id": self.state["issuer_source_collection_id"],
                "spatial_review_id": self.context["spatial_review_id"],
                "spatial_export_ids": list(self.spatial_export_ids),
                "spatial_exports": [{"id": item["id"], "title": item["title"],
                                     "review_id": item["review_id"], "files": item["files"]}
                                    for item in self.state.get("spatial_exports", [])],
                "response_exists": response_id is not None,
                "response_id": response_id, "response_file": str(self.output / "browser-response.json"),
                "expected_reviewer": REVIEWER, "state_file": str(self.state_path),
                "source_manifest_sha256": SOURCE_MANIFEST_SHA, "issuer_manifest_sha256": ISSUER_MANIFEST_SHA,
                "disposition": "in-review", **exported}

    def prepare(self):
        packet = self.ensure_review(create=True)
        preserved_response = self.output / "browser-response.json"
        if self.state.get("response_id") or packet["responses"] or preserved_response.exists():
            require(preserved_response.is_file(), "Reopen the exact original downloaded response with its native history")
            return self.import_response(preserved_response, phase="prepared")
        exported = self.export("initial-review", packet, archive=False)
        return self.result("prepared", packet, exported)

    def import_response(self, path, *, phase="response-imported"):
        packet = self.ensure_review(create=False)
        path = Path(path)
        require(path.is_file() and path.stat().st_size <= 2 * 1024 * 1024, "Select the complete original browser response")
        raw = path.read_bytes()
        response = json.loads(raw)
        require(response.get("reviewer") == REVIEWER, "Retain the original named internal engineering reviewer")
        require(response.get("disposition") == "in-review" and response.get("summary", "").strip(),
                "Retain the stated internal review purpose and response summary")
        decisions = response.get("requirement_decisions", [])
        questions = {"scope.basin", "work.review"}
        expected_ids = {item["id"] for item in packet["review"]["requirements"]}
        require(len(decisions) == 33 and {item.get("requirement_id") for item in decisions} == expected_ids,
                "The downloaded response must retain all 33 exact requirement decisions")
        for item in decisions:
            key = item["requirement_id"]
            require(item.get("decision") == ("question" if key in questions else "unreviewed"),
                    "Retain the actual internal decision for requirement: " + key)
            if key in questions:
                require(bool(item.get("comment", "").strip()), "Keep the source-specific review question: " + key)
        # The original engine validates every artifact, comment, correction, parent and ID.
        retained = self.output / "browser-response.json"
        publish(retained, raw, immutable=True, raw=True)
        self.anchor("browser_response", {"bytes": len(raw), "sha256": hashlib.sha256(raw).hexdigest()})
        record = self.reviews.import_response(self.workspace, response)
        self.anchor("response_id", record["id"])
        packet = self.reviews.show_review(self.workspace, self.state["review_id"], previews=False)
        require(packet["latest_response_id"] == record["id"], "The original imported response is no longer the selected latest revision")
        self.anchor("responses", packet["responses"])
        self.anchor("completed_packet_sha256", digest(clean_packet(packet)))
        publish(self.output / "completed-native-packet.json", clean_packet(packet), immutable=True)
        exported = self.export("completed-review", packet)
        self.anchor("completed_package_sha256", exported["package_sha256"])
        return self.result(phase, packet, exported)

    def restored(self):
        require(self.args.application and self.args.workspace, "Use the actual application and Workspace returned by native restore")
        require(self.state.get("response_id"), "Complete the original response before receiving the saved Workspace")
        packet = self.ensure_review(create=False)
        require(packet["responses"] == self.state["responses"]
                and packet["latest_response_id"] == self.state["response_id"],
                "Restored original response history differs")
        original_packet = read_json(self.output / "completed-native-packet.json")
        require(clean_packet(packet) == original_packet
                and digest(clean_packet(packet)) == self.state["completed_packet_sha256"],
                "Restored customer review or original source files differ")
        validation = self.reviews.validate_workspace(self.workspace, verify_files=True)
        exported = self.export("received-review", packet)
        self.anchor("received_package_sha256", exported["package_sha256"])
        result = self.result("restored", packet, exported)
        result["validation"] = validation
        publish(self.output / "received-customer-review.json", result, immutable=True)
        return result

    def run(self):
        with self.held(self.output / ".customer-review-receiving.lock", blocking=False):
            self.load()
            if self.args.phase == "prepare":
                return self.prepare()
            if self.args.phase == "import-response":
                require(self.args.response, "Select the exact browser-downloaded response")
                return self.import_response(self.args.response)
            return self.restored()


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--context", required=True)
    parser.add_argument("--response")
    parser.add_argument("--application")
    parser.add_argument("--workspace")
    parser.add_argument("phase", choices=("prepare", "import-response", "restored"))
    args = parser.parse_args()
    result = Receiving(args).run()
    print(json.dumps(result, sort_keys=True), flush=True)


if __name__ == "__main__":
    main()
