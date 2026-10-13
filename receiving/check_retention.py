"""One standard-library receiving journey for exact independent file retention."""
from __future__ import annotations
import argparse
import ast
import copy
import json
from pathlib import Path
import shutil
import sys
import tempfile

def main():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--source", required=True, type=Path)
    parser.add_argument("--output", required=True, type=Path)
    parser.add_argument("--work", type=Path)
    args = parser.parse_args()
    source_root = args.source.resolve()
    sys.path.insert(0, str(source_root))
    from eco_scenario_lab.retention import RetentionSession
    from eco_scenario_lab.store import (ScenarioError, atomic_json, dataset_hash,
                                       export_workspace, file_hash, inside, receive_workspace)
    module_hashes = {name: file_hash(source_root / "eco_scenario_lab" / name)
                     for name in ("retention.py", "store.py", "upstate_intake.py")}
    with tempfile.TemporaryDirectory(prefix="ed6e-retention-", dir=args.work) as temp:
        root = Path(temp)
        original, receiver = root / "original", root / "receiver"
        inputs = original / "inputs"
        inputs.mkdir(parents=True)
        # Opaque file bodies exercise filename/family retention without GIS parsing.
        (inputs / "landcover.tif").write_bytes(bytes(range(256)) * 128)
        (inputs / "landcover.tif.msk").write_bytes(b"retained mask bytes\n")
        (inputs / "landcover.tif.aux.xml").write_bytes(b"<metadata>original</metadata>\n")
        for suffix in (".shp", ".shx", ".dbf", ".prj"):
            (inputs / ("domain" + suffix)).write_bytes(("original" + suffix + "\n").encode())
        native = original / "native"
        (native / "intermediate").mkdir(parents=True)
        (native / "result.csv").write_text("id,total\n1,10\n", encoding="utf-8")
        (native / "intermediate" / "flow.dat").write_bytes(bytes(range(128)) * 64)
        (native / ".taskgraph-state").write_bytes(b"original hidden metadata\n")
        duplicate = original / "same-native"
        alternative = original / "other-native"
        shutil.copytree(native, duplicate)
        shutil.copytree(native, alternative)
        (alternative / "result.csv").write_text("id,total\n1,12\n", encoding="utf-8")
        originals = {p.relative_to(original).as_posix(): file_hash(p)
                     for p in original.rglob("*") if p.is_file()}
        retention = RetentionSession(receiver)
        first, inventory = retention.snapshot(inputs / "landcover.tif")
        repeated, repeated_inventory = retention.snapshot(inputs / "landcover.tif")
        assert (first, inventory) == (repeated, repeated_inventory)
        assert len(inventory) == 3
        assert retention.dataset_hash(inputs / "landcover.tif") == dataset_hash(inputs / "landcover.tif")
        _, shape_inventory = retention.snapshot(inputs / "domain.shp")
        assert len(shape_inventory) == 4
        a = retention.native_directory(native)
        again = retention.native_directory(native)
        same = retention.native_directory(duplicate)
        other = retention.native_directory(alternative)
        assert a == again == same
        assert a["path"] != other["path"]
        assert {f["path"] for f in a["files"]} == {"result.csv", "intermediate/flow.dat", ".taskgraph-state"}
        stats = retention.verify()
        assert stats["native_directory_requests"] == 4
        assert stats["native_unique_directories"] == 2 and stats["native_directory_reuses"] == 2
        assert stats["native_logical_bytes_avoided"] == a["logical_bytes"] * 2
        assert stats["native_logical_bytes_requested"] == a["logical_bytes"] * 3 + other["logical_bytes"]
        assert stats["native_logical_bytes_retained"] == a["logical_bytes"] + other["logical_bytes"]
        assert stats["source_files_hashed"] == len(originals)
        assert originals == {p.relative_to(original).as_posix(): file_hash(p)
                             for p in original.rglob("*") if p.is_file()}
        for item in a["files"]:
            src, dst = native / item["path"], receiver / a["path"] / item["path"]
            assert file_hash(src) == file_hash(dst)
            assert (src.stat().st_dev, src.stat().st_ino) != (dst.stat().st_dev, dst.stat().st_ino)
        # Exercise the exact current receiver class without importing native engines.
        module = ast.parse((source_root / "eco_scenario_lab" / "upstate_intake.py").read_text(encoding="utf-8"))
        receiver_class = next(node for node in module.body if isinstance(node, ast.ClassDef) and node.name == "_Receiver")
        scope = {"Path": Path, "ScenarioError": ScenarioError, "RetentionSession": RetentionSession,
                 "inside": inside, "atomic_json": atomic_json, "file_hash": file_hash, "copy": copy}
        exec(compile(ast.Module(body=[receiver_class], type_ignores=[]), "upstate_intake.py", "exec"), scope)
        original_paths = scope["_Receiver"](original, receiver)
        original_paths.copy_tree("native")
        original_paths.copy_tree("native")
        table_meta = {"bytes": (native / "result.csv").stat().st_size,
                      "sha256": file_hash(native / "result.csv")}
        assert original_paths.copy_file("native/result.csv", table_meta) == "original/native/result.csv"
        path_stats = original_paths.verify()
        assert path_stats["source_files_hashed"] == 3 and path_stats["retained_files"] == 3
        assert path_stats["relative_file_requests"] == 7 and path_stats["relative_file_reuses"] == 4
        assert path_stats["relative_tree_requests"] == 2
        assert set(original_paths.inventory) == {"original/native/" + item["path"] for item in a["files"]}
        for item in a["files"]:
            left, right = native / item["path"], receiver / "original" / "native" / item["path"]
            assert file_hash(left) == file_hash(right)
            assert (left.stat().st_dev, left.stat().st_ino) != (right.stat().st_dev, right.stat().st_ino)
        atomic_json(receiver / "receiving-storage.json", stats)
        exported = export_workspace(receiver, root / "received.zip")
        received = receive_workspace(root / "received.zip", root / "independent")
        assert exported["files"] == received["files"]
        for file in receiver.rglob("*"):
            if file.is_file() and file.name != ".workspace.lock":
                assert file_hash(file) == file_hash(root / "independent" / file.relative_to(receiver))
        independent_table = root / "independent" / a["path"] / "result.csv"
        independent_table.write_bytes(b"edited independent copy\n")
        assert file_hash(receiver / a["path"] / "result.csv") == file_hash(native / "result.csv")
        retained_input = receiver / first
        expected = file_hash(retained_input)
        with (inputs / "landcover.tif").open("ab") as out:
            out.write(b"changed sender")
        assert file_hash(retained_input) == expected
        try:
            retention.snapshot(inputs / "landcover.tif")
        except ScenarioError as exc:
            assert "changed" in str(exc)
        else:
            raise AssertionError("An original input changed without detection")
        (native / "new-native-file").write_bytes(b"new")
        try:
            retention.native_directory(native)
        except ScenarioError as exc:
            assert "changed" in str(exc)
        else:
            raise AssertionError("An original native directory changed without detection")
        result = {"kind": "source-retention-receiving", "status": "passed",
                  "source_sha256": module_hashes, "storage": stats, "original_path_storage": path_stats,
                  "checks": ["complete_input_families", "repeated_source_cache",
                             "same_directory_reuse", "exact_inventory_reuse",
                             "distinct_directory_preserved", "hidden_and_nested_files",
                             "source_and_receiver_independence", "portable_export_receive",
                             "independent_received_edit", "changed_source_rejected",
                             "changed_native_membership_rejected", "current_receiver_original_paths",
                             "current_receiver_repeated_registered_files"],
                  "portable_files": exported["files"]}
    atomic_json(args.output, result)
    print(json.dumps(result, indent=2))
    return 0

if __name__ == "__main__":
    raise SystemExit(main())
