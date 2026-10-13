"""Continue one original saved Monitoring campaign through editable field receiving.

Uses the native campaign handoff, Implementation report retention and original
Workspace capture/restore. Supply the actual campaign and saved revision IDs.
"""
from __future__ import annotations

import argparse
import datetime as dt
import hashlib
import json
from pathlib import Path
import sys
import traceback
import zipfile

APPLICATION = Path(__file__).resolve().parents[1]
if str(APPLICATION) not in sys.path:
    sys.path.insert(0, str(APPLICATION))

from model.common import held, identifier
from model.implementation import ImplementationStore
from model.monitoring_implementation import receive
from model.monitoring_workspace import MonitoringWorkspace
from model.workspace import Workspace
from source_tools.receive_implementation import (
    _separate, identity, now, read, run as receive_fieldwork, write,
)

SCHEMA = "upstate.monitoring-fieldwork-native-course/v1"
CODE = (
    "source_tools/receive_monitoring_fieldwork.py",
    "source_tools/receive_implementation.py",
    "model/monitoring_implementation.py", "model/monitoring_workspace.py",
    "model/monitoring_campaign.py", "model/monitoring_sources.py",
    "model/portable_parameter_studies.py",
)


def verify_packet(workspace, handoff):
    store = ImplementationStore(workspace)
    plan = store.get(handoff["plan_id"], handoff["revision"])
    source = next((row for row in plan["source_links"]
                   if row.get("source_id") == handoff["source_revision_id"]
                   and row.get("kind") == "monitoring_campaign"), None)
    if source is None:
        raise ValueError("The saved fieldwork revision lacks its original campaign source")
    attachment = handoff["attachment"]
    path = (workspace.root / attachment["reference"]).resolve(strict=True)
    allowed = (store.base / handoff["plan_id"] / "attachments").resolve(strict=True)
    if not path.is_relative_to(allowed):
        raise ValueError("The original campaign package leaves its managed fieldwork attachment")
    declared = {"bytes": attachment["size_bytes"], "sha256": attachment["sha256"]}
    if identity(path) != declared or source["snapshot"]["packet"] != declared:
        raise ValueError("The original campaign package differs from its retained source")
    with zipfile.ZipFile(path) as archive:
        names = archive.namelist()
        if len(names) != len(set(names)):
            raise ValueError("The original campaign package repeats a member")
        manifest = json.loads(archive.read("manifest.json"))
        if (manifest["source_revision_id"] != handoff["source_revision_id"]
                or manifest["campaign_id"] != handoff["campaign_id"]):
            raise ValueError("The campaign package names another selected revision")
        members = manifest["files"]
        if set(names) != {"manifest.json", *(row["path"] for row in members)}:
            raise ValueError("The original campaign member inventory differs")
        for row in members:
            with archive.open(row["path"]) as stream:
                checksum, size = hashlib.sha256(), 0
                for block in iter(lambda: stream.read(1024 * 1024), b""):
                    checksum.update(block)
                    size += len(block)
            if size != row["bytes"] or checksum.hexdigest() != row["sha256"]:
                raise ValueError("The original campaign source member differs: " + row["path"])
        revision = json.loads(archive.read("revision.json"))
        if revision["id"] != handoff["source_revision_id"]:
            raise ValueError("The frozen campaign revision identity differs")
    return {"attachment": attachment, "files": len(members),
            "campaign_id": handoff["campaign_id"],
            "source_revision_id": handoff["source_revision_id"], **declared}


def run(workspace_path, operation, *, campaign_id, revision_id, as_of="2026-10-13"):
    dt.date.fromisoformat(as_of)
    campaign_id, revision_id = identifier(campaign_id), identifier(revision_id)
    workspace_path = Path(workspace_path).expanduser().resolve(strict=True)
    root = Path(operation).expanduser().resolve()
    _separate(root, workspace_path, "Campaign receiving and original Workspace")
    _separate(root, APPLICATION, "Campaign receiving and installed application")
    root.mkdir(parents=True, exist_ok=True)
    with held(root / ".monitoring-fieldwork-course.lock", blocking=False):
        workspace = Workspace(workspace_path)
        selection = {"schema": SCHEMA, "workspace": str(workspace.root),
                     "project": workspace.project, "campaign_id": campaign_id,
                     "source_revision_id": revision_id, "as_of": as_of}
        write(root / "selection.json", selection, immutable=True)
        state_path = root / "state.json"
        state = read(state_path) if state_path.exists() else {
            "schema": SCHEMA, "created_at": now(), "code_editions": []}
        code = {name: identity(APPLICATION / name) for name in CODE}
        if not state["code_editions"] or state["code_editions"][-1]["files"] != code:
            state["code_editions"].append({"observed_at": now(), "files": code})
        def checkpoint(phase, **values):
            state.update(phase=phase, updated_at=now(), **values)
            write(state_path, state)
            print(json.dumps({"phase": phase, **values}, default=str), flush=True)
        try:
            handoff_path = root / "handoff.json"
            if handoff_path.exists():
                handoff = read(handoff_path)
                if (handoff["campaign_id"] != campaign_id
                        or handoff["source_revision_id"] != revision_id):
                    raise ValueError("The retained handoff belongs to another saved campaign")
            else:
                checkpoint("campaign_fieldwork")
                handoff = receive(
                    MonitoringWorkspace(workspace), campaign_id=campaign_id,
                    expected_revision_id=revision_id,
                    operation_id="MONITORING-FIELDWORK:" + hashlib.sha256(
                        str(root).encode("utf-8")).hexdigest())
                write(handoff_path, handoff, immutable=True)
            original_packet = verify_packet(workspace, handoff)
            checkpoint("original_packet", packet=original_packet,
                       plan_id=handoff["plan_id"], revision=handoff["revision"])
            fieldwork = receive_fieldwork(
                workspace.root, root / "fieldwork", as_of=as_of,
                plan_id=handoff["plan_id"], revision=handoff["revision"])
            restored = Workspace(fieldwork["receiving"]["workspace"])
            received_packet = verify_packet(restored, handoff)
            if original_packet != received_packet:
                raise ValueError("Fresh receiving changed the original campaign package")
            result = {"schema": SCHEMA, "state": "complete", "completed_at": now(),
                      "selection": selection, "handoff": handoff,
                      "packet": received_packet, "fieldwork": fieldwork}
            write(root / "receiving.json", result)
            checkpoint("complete", result=str(root / "receiving.json"))
            return result
        except Exception as error:
            checkpoint("failed", error={"type": type(error).__name__, "message": str(error)})
            raise


def main(argv=None):
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--workspace", required=True)
    parser.add_argument("--operation", required=True)
    parser.add_argument("--campaign-id", required=True)
    parser.add_argument("--revision-id", required=True)
    parser.add_argument("--as-of", default="2026-10-13")
    args = parser.parse_args(argv)
    try:
        result = run(args.workspace, args.operation, campaign_id=args.campaign_id,
                     revision_id=args.revision_id, as_of=args.as_of)
    except Exception:
        traceback.print_exc()
        return 1
    print(json.dumps(result, ensure_ascii=False, indent=2), flush=True)
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
