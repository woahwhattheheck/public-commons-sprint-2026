"""One live SQLite WAL and complete portable Workspace receiving check."""
import contextlib
import hashlib
import json
from pathlib import Path
import shutil
import sqlite3
import subprocess
import sys
import tempfile

HERE = Path(__file__).resolve().parent
MODULES = ("__init__", "common", "profiles", "model_selection", "grid_reuse", "reuse",
           "workspace", "portable", "portable_databases", "cli")
RECEIVING = ("install_economic_desk.py", "receive_decision_source.py", "README_RECEIVING.md")


def exercise(root):
    from model.common import retain_file
    from model.workspace import Workspace
    from model.portable import backup, inspect_archive, restore

    workspace = Workspace(root / "workspace", create=True, title="Portable SQLite receiving check")
    original = workspace.root / "reference" / "original.sqlite"
    original.parent.mkdir()
    with contextlib.closing(sqlite3.connect(original)) as connection:
        connection.execute("CREATE TABLE source(value TEXT)")
        connection.execute("INSERT INTO source VALUES ('retained original')")
        connection.commit()
    package = workspace.root / "original.gpkg"
    shutil.copyfile(original, package)
    retained = retain_file(workspace.root, original)
    originals = [original, package, workspace.root / retained["object"]]
    hashes = {path.relative_to(workspace.root).as_posix():
              hashlib.sha256(path.read_bytes()).hexdigest() for path in originals}

    component_names = ("integration", "integrations", "eco_intelligence", "ecsa_runs", "docs")
    for name in component_names:
        folder = HERE / name
        folder.mkdir(exist_ok=True)
        (folder / "retained-component.txt").write_text(name, encoding="utf-8")
    for root_path in (workspace.root, HERE / "integration"):
        (root_path / "loose.pyc").write_bytes(b"bytecode fixture")
        runtime = root_path / "local-python"
        runtime.mkdir()
        (runtime / "pyvenv.cfg").write_text("home = /fixture/python", encoding="utf-8")
        (runtime / "runtime.py").write_text("runtime fixture", encoding="utf-8")
        for name in (".venv", "node_modules", ".git"):
            folder = root_path / name
            folder.mkdir()
            (folder / "transient.txt").write_text(name, encoding="utf-8")
    run = workspace.root / "runs" / "check"
    run.mkdir(parents=True)
    for name in (".native-recovery-reserve", ".native-recovery-reserve.allocating"):
        (run / name).write_bytes(b"temporary metadata capacity")

    database = workspace.root / "intelligence" / "investigations.sqlite3"
    database.parent.mkdir()
    with contextlib.closing(sqlite3.connect(database)) as writer:
        assert writer.execute("PRAGMA journal_mode=WAL").fetchone()[0] == "wal"
        writer.execute("PRAGMA wal_autocheckpoint=0")
        writer.execute("CREATE TABLE state(project_id TEXT, value TEXT)")
        writer.execute("INSERT INTO state VALUES (?, ?)", (workspace.project["id"], "committed WAL"))
        writer.commit()
        assert database.with_name(database.name + "-wal").stat().st_size > 0
        archive = root / "workspace.zip"
        backup(workspace, archive)
        manifest = inspect_archive(archive)
        assert set(manifest["database_snapshots"]) == {"workspace/intelligence/investigations.sqlite3"}
        names = set(manifest["members"])
        assert all("application/" + name + "/retained-component.txt" in names for name in component_names)
        assert all("application/" + name in names for name in RECEIVING)
        assert not any(name.endswith((".pyc", "-wal", "-shm")) or
                       ".native-recovery-reserve" in name or
                       any(part in {".venv", ".git", "node_modules", "local-python"}
                           for part in Path(name).parts) for name in names)
        received = restore(archive, root / "received")
        reopened = Workspace(received["workspace"])
        assert reopened.project == workspace.project
        for relative, expected in hashes.items():
            assert hashlib.sha256((reopened.root / relative).read_bytes()).hexdigest() == expected
        with contextlib.closing(sqlite3.connect(reopened.root / "intelligence/investigations.sqlite3")) as reader:
            assert reader.execute("SELECT project_id, value FROM state").fetchall() == [
                (workspace.project["id"], "committed WAL")]
        result = subprocess.run([sys.executable, "-B", str(Path(received["application"]) / "model/cli.py"),
                                 "--workspace", received["workspace"], "overview"],
                                check=True, capture_output=True, text=True)
        assert json.loads(result.stdout)["project"] == workspace.project
    print(json.dumps({"portable_sqlite_check": "passed", "workspace_id": workspace.project["id"],
                      "committed_wal": True, "original_files": len(hashes),
                      "restored_application_cli": True, "archive_members": len(names),
                      "source_sha256": {name: hashlib.sha256((HERE / "model" / (name + ".py")).read_bytes()).hexdigest()
                                        for name in ("portable", "portable_databases")}}, sort_keys=True))


if __name__ == "__main__":
    if len(sys.argv) == 3 and sys.argv[1] == "--exercise":
        exercise(Path(sys.argv[2]))
    else:
        with tempfile.TemporaryDirectory(prefix="portable-sqlite-check-") as temporary:
            root = Path(temporary)
            application = root / "application"
            (application / "model").mkdir(parents=True)
            for name in MODULES:
                shutil.copyfile(HERE / "model" / (name + ".py"), application / "model" / (name + ".py"))
            for name in RECEIVING:
                shutil.copyfile(HERE / name, application / name)
            script = application / Path(__file__).name
            shutil.copyfile(__file__, script)
            subprocess.run([sys.executable, "-B", str(script), "--exercise", str(root)], check=True)
