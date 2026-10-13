#!/usr/bin/env python3
"""Run one sourced joint design through the original native/report/receiving APIs."""
from __future__ import annotations
import argparse
import json
import os
from pathlib import Path
import subprocess
import sys

APPLICATION = Path(__file__).resolve().parents[1]
if str(APPLICATION) not in sys.path:
    sys.path.insert(0, str(APPLICATION))

from model.common import atomic_json, digest, file_digest, held, now, read_json, verify_file
from model.workspace import Workspace
from model import experiments, joint_parameter_studies, joint_parameter_analysis, portable, study_transfer, study_report


def identity(path):
    return {"path": str(path), "bytes": path.stat().st_size, "sha256": file_digest(path)}


def require(value, message):
    if not value:
        raise ValueError(message)


def operate(workspace_path, specification_path, output, resume_study_id=None):
    workspace = Workspace(workspace_path)
    spec = read_json(specification_path)
    output = output.expanduser().absolute()
    require(not output.is_symlink(), "Use the original ordinary receiving output directory")
    output.mkdir(parents=True, exist_ok=True)
    with held(output / ".joint-receiving.lock", blocking=False):
        request = {
            "schema": "upstate.joint-parameter-receiving-selection/v1",
            "workspace_id": workspace.project["id"],
            "workspace": str(workspace.root),
            "specification": spec,
            "application_sha256": portable.application_digest(),
            "resume_study_id": resume_study_id,
        }
        request_id = digest(request)
        atomic_json(output / "selection.json", request, immutable=True)
        state_path = output / "operation.json"
        state = read_json(state_path) if state_path.exists() else {
            "schema": "upstate.joint-parameter-receiving/v1", "id": request_id,
            "created_at": now(), "state": "PREPARING", "phases": [],
        }
        require(state.get("id") == request_id, "Continue the exact source, workspace and selected design")
        def checkpoint(phase, **values):
            state.update(values, phase=phase, updated_at=now())
            state["phases"].append({"phase": phase, "at": now()})
            atomic_json(state_path, state)
            print(__import__("json").dumps({"operation": request_id, "phase": phase,
                                           "state": state["state"]}), flush=True)
        preview_path = output / "design-preview.json"
        if preview_path.exists():
            candidate = read_json(preview_path)
            require(candidate["definition"]["specification"] ==
                    joint_parameter_studies._normalise(workspace, spec)[0],
                    "The retained preview belongs to another specification")
        else:
            if resume_study_id:
                retained = joint_parameter_studies.inspect(workspace, resume_study_id)
                definition = retained["definition"]
                require(definition["specification"] == joint_parameter_studies._normalise(workspace, spec)[0],
                        "Continue the original retained design with its exact normalized specification")
                candidate = {"schema": joint_parameter_studies.SCHEMA, "id": resume_study_id,
                             "definition": definition, "sample_count": len(definition["samples"])}
            else:
                candidate = joint_parameter_studies.preview(workspace, spec)
            atomic_json(preview_path, candidate, immutable=True)
        study_id = candidate["id"]
        require(study_id == digest(candidate["definition"])
                and (resume_study_id is None or study_id == resume_study_id),
                "Retain the complete original definition and requested study identity")
        checkpoint("design-retained", study_id=study_id)
        try:
            # Completed preparation is read without rewriting its state timestamps;
            # the retained export and independent copy keep the same bytes.
            study_directory = workspace.root / joint_parameter_studies.DIRECTORY / study_id
            prepared = None
            if (study_directory / "state.json").is_file():
                prepared = joint_parameter_studies.inspect(workspace, study_id)
                require(prepared["definition"] == candidate["definition"],
                        "The prepared study differs from the complete retained design")
            if prepared is None or not prepared.get("experiment_id"):
                prepared = joint_parameter_studies.prepare(workspace, candidate["definition"])
            experiment_id = prepared["experiment_id"]
            checkpoint("original-experiment-prepared", experiment_id=experiment_id)
            completed = experiments.inspect(workspace, experiment_id, offset=0, limit=1)
            summary = experiments.read_summary(workspace, experiment_id)
            if completed["state"] != "complete" or summary is None:
                checkpoint("original-native-execution", state="RUNNING")
                joint_parameter_studies.execute(workspace, study_id)
                summary = experiments.read_summary(workspace, experiment_id)
            require(summary is not None and summary["state"] == "complete",
                    "Retain the original incomplete native cases and resume this same operation")
            checkpoint("native-complete", state="NATIVE_COMPLETE",
                       native_summary=identity(workspace.root / "experiments" / experiment_id / "summary.json"))
            # This request binds the complete rendering/analysis source as well as
            # the native summary; a newly received source rebuilds its own report.
            report_marker = workspace.root / "experiments" / experiment_id / "study-report.json"
            report_receipt = output / "report-source-receipt.json"
            if report_receipt.is_file():
                binding = read_json(report_receipt)
                require(binding.get("application_sha256") == request["application_sha256"]
                        and binding.get("summary_sha256") == state["native_summary"]["sha256"]
                        and report_marker.is_file() and binding.get("marker") == read_json(report_marker),
                        "The retained source-bound report changed; preserve this output and use a new receiving output")
            else:
                study_report.build(workspace, experiment_id)
                binding = {"schema": "upstate.joint-parameter-receiving-report/v1",
                           "application_sha256": request["application_sha256"],
                           "summary_sha256": state["native_summary"]["sha256"],
                           "marker": read_json(report_marker)}
                atomic_json(report_receipt, binding, immutable=True)
            marker = binding["marker"]
            require(marker.get("schema") == "upstate.study-report-downloads/v1"
                    and marker.get("experiment_id") == experiment_id
                    and marker.get("workspace_id") == workspace.project["id"]
                    and marker.get("summary_sha256") == state["native_summary"]["sha256"]
                    and isinstance(marker.get("files"), dict) and bool(marker["files"]),
                    "Retain the complete source-bound scientific report")
            for item in marker["files"].values():
                verify_file(report_marker.parent, item)
            original = joint_parameter_analysis.collect(workspace, experiments.read_summary(workspace, experiment_id))
            require(original is not None, "Keep the original joint-study/report binding")
            atomic_json(output / "original-analysis.json", original, immutable=True)
            checkpoint("original-report-complete", analysis_sha256=digest(original))

            selection_path = output / "export-selection.json"
            if selection_path.is_file():
                selection = read_json(selection_path)
            else:
                selection = {"schema": study_transfer.SELECTION_SCHEMA,
                             "title": candidate["definition"]["specification"]["title"],
                             "roots": [{"kind": joint_parameter_studies.DIRECTORY, "id": study_id}],
                             "include_related_results": True}
                preview = study_transfer.preview(workspace, selection)
                selection["preview_token"] = preview["preview_token"]
                atomic_json(selection_path, selection, immutable=True)
            require(selection["roots"] == [{"kind": joint_parameter_studies.DIRECTORY, "id": study_id}],
                    "Retain the selected original joint-study dependency closure")
            archive = output / "Joint_Parameter_Study_Complete.zip"
            exported = study_transfer.export_study(workspace, archive, selection)
            atomic_json(output / "export-result.json", exported)
            checkpoint("original-study-exported", archive=identity(archive))
            received_root = output / "received"
            if received_root.exists():
                received = portable.resume_restore(archive, received_root,
                                                    expected_archive_sha256=state["archive"]["sha256"])
            else:
                received = portable.restore(archive, received_root)
            atomic_json(output / "receiving-result.json", received)
            # Reconcile every received source/input/output member on continuation,
            # not only the retained completion receipt.
            manifest = portable.inspect_archive(archive, verify=True)
            for name, descriptor in manifest["members"].items():
                verify_file(received_root, {"path": name, **descriptor})
            receiver = Workspace(received["workspace"])
            cold_output = output / "cold-received-study.json"
            cold_analysis = output / "cold-received-analysis.json"
            cold_code = (
                "import json,sys;from model.workspace import Workspace;"
                "from model import joint_parameter_studies as j,experiments as e,joint_parameter_analysis as a;"
                "from model.common import atomic_json;"
                "w=Workspace(sys.argv[1]);s=j.inspect(w,sys.argv[2]);"
                "atomic_json(sys.argv[3],s);"
                "atomic_json(sys.argv[4],a.collect(w,e.read_summary(w,s['experiment_id'])))"
            )
            environment = dict(os.environ, PYTHONPATH=received["application"], PYTHONDONTWRITEBYTECODE="1")
            with (output / "cold-receiving.stdout").open("wb") as stdout, (output / "cold-receiving.stderr").open("wb") as stderr:
                result = subprocess.run([sys.executable, "-B", "-c", cold_code, received["workspace"], study_id,
                                         str(cold_output), str(cold_analysis)], cwd=received["application"],
                                        env=environment, stdout=stdout, stderr=stderr, check=False)
            require(result.returncode == 0, "The received application's own cold reader failed; inspect its retained stderr")
            restored = read_json(cold_output)
            require(restored["definition"] == candidate["definition"]
                    and restored["samples"] == prepared["samples"]
                    and restored["experiment_id"] == experiment_id,
                    "Independent receiving changed the scientific design or native sample bindings")
            restored_summary = experiments.read_summary(receiver, experiment_id)
            require(restored_summary is not None and restored_summary["state"] == "complete",
                    "The original completed native summary did not receive intact")
            restored_analysis = read_json(cold_analysis)
            # Native file descriptor paths are scope-relative and retained byte-for-byte.
            require(digest(restored_analysis) == digest(original),
                    "The independently received native analysis differs")
            atomic_json(output / "received-analysis.json", restored_analysis, immutable=True)
            state.pop("error", None)
            checkpoint("independent-receiving-complete", state="NATIVE_AND_RECEIVING_COMPLETE",
                       received_workspace=received["workspace"],
                       visual_acceptance="PENDING_ACTUAL_DESKTOP_AND_NARROW_VIEWING")
            return state
        except BaseException as error:
            checkpoint("continuation-required", state="INCOMPLETE",
                       error={"type": type(error).__name__, "message": str(error)})
            raise


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--workspace", type=Path, required=True)
    parser.add_argument("--specification", type=Path, required=True)
    parser.add_argument("--output", type=Path, required=True)
    parser.add_argument("--resume-study", help="Continue an exact already-retained study without drawing another design")
    args = parser.parse_args()
    operate(args.workspace, args.specification, args.output, args.resume_study)


if __name__ == "__main__":
    main()
