#!/usr/bin/env python3
"""Open the original EC-SDC issuer acceptance review in the Upstate Workspace.

Create and export the issuer review:
  python source/acceptance/20261012/open_review.py \
    --workspace /path/to/workspace --destination /path/to/issuer-review \
    --zip /path/to/issuer-review.zip

Export the same retained review again, including its current response history:
  python source/acceptance/20261012/open_review.py \
    --workspace /path/to/workspace --review-id REVIEW_ID \
    --destination /path/to/reopened-review --zip /path/to/reopened-review.zip
"""
from __future__ import annotations

import argparse
import json
from pathlib import Path
import sys

HERE = Path(__file__).resolve().parent
APPLICATION = Path(__file__).resolve().parents[3]
PROFILE_ID = "upstate-ec-sdc-rfp-20261002"
ISSUER_URI = (
    "https://www.upstateforever.org/files/files/"
    "20261002_FINAL_EC-SDC%20Mapping%20RFP%20APPENDIX%20COMBINED.pdf"
)
ORIGINAL_PDF_SHA256 = "04313cdda0b19f98b4081ef1eeec2f52707437759f9058f8d0e5abc8d83d6dbf"
ORIGINAL_PDF_BYTES = 7470549
REQUIREMENTS_SHA256 = "23a6e7f171fb26f6c42658d2574b0f241812a9784454e0e524f926144607e52f"
PROFILE_SHA256 = "604fade1397073c8ecae168f5481d136c8fe503bb824746d5930906e0c77e6ed"
TITLE = "EC-SDC issuer requirements and delivery acceptance"
PURPOSE = (
    "Review the original RFP's seven map products, 30 metre grid, basin buffer, "
    "source and model interpretation, complete GIS and report handover, and proposal "
    "requirements against the retained issuer pages before binding the delivery runs."
)


def _apis():
    """Load the existing scientific workspace and review implementation."""
    required = (APPLICATION / "model/workspace.py", APPLICATION / "model/reviews.py")
    if not all(path.is_file() for path in required):
        raise ValueError(
            "Keep this entrypoint at source/acceptance/20261012/open_review.py "
            "inside the original Upstate application containing model/workspace.py "
            "and model/reviews.py."
        )
    sys.path.insert(0, str(APPLICATION))
    from model.common import file_digest, read_json, relative_file
    from model.workspace import Workspace
    from model import reviews
    return Workspace, reviews, file_digest, read_json, relative_file


def _fresh_destination(workspace_path, destination, archive):
    destination = Path(destination).absolute()
    workspace_path = Path(workspace_path).absolute()
    if destination.exists() or destination.is_symlink():
        raise ValueError("Choose a new review destination; the existing packet is retained.")
    if (destination.resolve().is_relative_to(workspace_path.resolve())
            or destination.resolve().is_relative_to(APPLICATION)):
        raise ValueError("Choose a review destination outside the workspace and application.")
    if archive is not None:
        archive = Path(archive).absolute()
        if archive.exists() or archive.is_symlink():
            raise ValueError("Choose a new review ZIP path; the existing archive is retained.")
        if archive.resolve().is_relative_to(destination.resolve()):
            raise ValueError("Place the ZIP outside the exported review directory.")
    return workspace_path, destination, archive


def _issuer_selection(file_digest, read_json, relative_file):
    manifest_path = HERE / "sources.json"
    manifest = read_json(manifest_path)
    if manifest.get("schema") != "upstate.sources/v1":
        raise ValueError("Select the original upstate.sources/v1 issuer intake manifest.")
    entries = manifest.get("entries")
    if not isinstance(entries, list) or len(entries) != 1:
        raise ValueError("The issuer intake needs its one original RFP document entry.")
    entry = entries[0]
    if (entry.get("id") != PROFILE_ID or entry.get("kind") != "document"
            or entry.get("uri") != ISSUER_URI or entry.get("path") != "official-rfp.pdf"
            or entry.get("sha256") != ORIGINAL_PDF_SHA256):
        raise ValueError("The source manifest belongs to a different issuer document edition.")
    pdf = relative_file(HERE, entry["path"])
    if pdf.stat().st_size != ORIGINAL_PDF_BYTES or file_digest(pdf) != ORIGINAL_PDF_SHA256:
        raise ValueError("The original issuer PDF bytes differ from this acceptance profile.")
    for companion in entry.get("companions", []):
        path = relative_file(HERE, companion["path"])
        if file_digest(path) != companion["sha256"]:
            raise ValueError("An issuer source companion differs: " + companion["path"])
    requirements_path = HERE / "review-requirements.json"
    profile_path = HERE / "acceptance-profile.json"
    if (file_digest(requirements_path) != REQUIREMENTS_SHA256
            or file_digest(profile_path) != PROFILE_SHA256):
        raise ValueError("Use the complete requirements and profile for this issuer edition.")
    requirements_document = read_json(requirements_path)
    profile = read_json(profile_path)
    if (requirements_document.get("schema") != "upstate.rfp-review-requirements/v1"
            or requirements_document.get("profile_id") != PROFILE_ID
            or profile.get("schema") != "upstate.rfp-acceptance-profile/v1"
            or profile.get("id") != PROFILE_ID):
        raise ValueError("The requirements and acceptance profile identify another source edition.")
    requirements = requirements_document.get("requirements")
    if (not isinstance(requirements, list) or len(requirements) != 33
            or len({item["id"] for item in requirements}) != 33):
        raise ValueError("The complete issuer acceptance selection has 33 distinct requirements.")
    selection = {
        "schema": "upstate.customer-review-selection/v1",
        "title": TITLE,
        "purpose": PURPOSE,
        "source_collection_ids": [],
        "run_ids": [],
        "delivery_ids": [],
        "requirements": requirements,
        "notes": [
            "Issuer PDF: " + ISSUER_URI + "; 7,470,549 bytes; SHA256 " + ORIGINAL_PDF_SHA256 + ".",
            "The acceptance profile distinguishes issuer requirements, issuer process and "
            "engineering acceptance, and records the scientific implementation decisions.",
            "Each requirement retains exact PDF page references. The original 17-record "
            "community table and complete source companions remain with the imported edition.",
            "Join completed model and delivery selections through the original Workspace "
            "review workflow as those products are produced.",
        ],
    }
    return manifest_path, selection


def prepare(workspace_path, destination, archive=None, *, review_id=None, progress=None):
    """Compose original intake, review and export APIs; preserve their immutable records."""
    state = progress if progress is not None else {}
    workspace_path, destination, archive = _fresh_destination(
        workspace_path, destination, archive
    )
    Workspace, reviews, file_digest, read_json, relative_file = _apis()
    state.update({"workspace": str(workspace_path), "destination": str(destination)})
    if review_id is not None:
        state["phase"] = "reopen"
        workspace = Workspace(workspace_path)
        packet = reviews.show_review(workspace, review_id, previews=False)
        review = packet["review"]
        source_ids = list(review["selection"]["source_collection_ids"])
        mode = "reopened"
    else:
        state["phase"] = "source"
        manifest_path, selected = _issuer_selection(file_digest, read_json, relative_file)
        workspace = Workspace(
            workspace_path, create=True, title="Upstate Forever — scientific source review"
        )
        edition = workspace.import_sources(manifest_path)
        state["source_collection_id"] = edition["id"]
        selected["source_collection_ids"] = [edition["id"]]
        state["phase"] = "review"
        review = reviews.create_review(workspace, selected)
        review_id = review["id"]
        source_ids = [edition["id"]]
        mode = "created"
    state.update({"phase": "export", "review_id": review_id, "mode": mode})
    print(json.dumps({
        "state": "review-retained", "workspace": str(workspace_path),
        "review_id": review_id, "source_collection_ids": source_ids,
        "requirement_count": len(review["requirements"]),
    }, separators=(",", ":")), file=sys.stderr, flush=True)
    exported = reviews.export_review(workspace, review_id, destination, archive=archive)
    state["phase"] = "complete"
    return {
        "schema": "upstate.issuer-review-launch/v1",
        "state": "complete",
        "mode": mode,
        "workspace": str(workspace_path),
        "project_id": workspace.project["id"],
        "review_id": review_id,
        "title": review["title"],
        "purpose": review["purpose"],
        "source_collection_ids": source_ids,
        "requirement_count": len(review["requirements"]),
        "export": exported,
    }


def parser():
    result = argparse.ArgumentParser(description=__doc__,
                                     formatter_class=argparse.RawDescriptionHelpFormatter)
    result.add_argument("--workspace", type=Path, required=True,
                        help="Original scientific workspace; created for a new issuer review")
    result.add_argument("--destination", type=Path, required=True,
                        help="Fresh review export directory outside the workspace and application")
    result.add_argument("--zip", dest="archive", type=Path,
                        help="Optional fresh ZIP path outside the exported review directory")
    result.add_argument("--review-id",
                        help="Reopen and export this retained review without importing sources again")
    return result


def main(argv=None):
    args = parser().parse_args(argv)
    state = {}
    try:
        result = prepare(args.workspace, args.destination, args.archive,
                         review_id=args.review_id, progress=state)
        print(json.dumps(result, indent=2, ensure_ascii=False, sort_keys=True, allow_nan=False))
        return 0
    except (OSError, ValueError, TypeError, KeyError, IndexError, ImportError, RuntimeError) as error:
        print(json.dumps({
            "state": "error", "type": type(error).__name__, "message": str(error),
            **state,
        }, ensure_ascii=False, sort_keys=True), file=sys.stderr, flush=True)
        return 1


if __name__ == "__main__":
    raise SystemExit(main())
