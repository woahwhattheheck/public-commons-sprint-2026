"""Compose the maintained GIS filesystem arm into its complete original source.

Usage: python -B source_tools/apply_gis_portability.py APPLICATION
       python -B source_tools/apply_gis_portability.py APPLICATION --output gis_project.py

The full scientific implementation is retained byte-for-byte outside the named
filesystem callers. This is an authoring/assembly tool, not a runtime patch or
import hook. The emitted gis_project.py is the ordinary complete production file.
"""
from __future__ import annotations

import argparse
import ast
import hashlib
import json
import os
from pathlib import Path
import stat
import sys
import uuid

sys.dont_write_bytecode = True
PREIMAGE = "e63cbf9b12893009eca6b3806d51296230142978"
MARKER = "# Q47: complete portable GIS filesystem callers."
HELPER = '''# Q47: complete portable GIS filesystem callers.
def _portable():
    if __package__:
        from . import gis_project_portable
    else:
        import importlib
        import sys
        parent = str(Path(__file__).resolve().parent.parent)
        if parent not in sys.path:
            sys.path.insert(0, parent)
        gis_project_portable = importlib.import_module("model.gis_project_portable")
    return gis_project_portable


'''
FUNCTIONS = {
    "save": '''def save(path: Path, value: Any) -> None:
    _portable().save(path, canonical(value) + b"\\n")
''',
    "member": '''def member(name: str) -> PurePosixPath:
    return PurePosixPath(_portable().member(name))
''',
    "local": '''def local(root: Path, name: str, *, exists: bool = True) -> Path:
    root = _portable().native_path(root)
    p = root / member(name)
    if p.is_symlink() or not p.resolve().is_relative_to(root.resolve()):
        raise ValueError("Member escapes the selected root: " + name)
    if exists and not p.is_file():
        raise FileNotFoundError("Missing retained file: " + name)
    return p
''',
    "locked": '''@contextlib.contextmanager
def locked(path: Path):
    """Keep the shared native whole-file lock and the existing nonblocking API."""
    with _portable().locked(path):
        yield
''',
    "copy_checked": '''def copy_checked(source_root: Path, rec: dict, target: Path) -> None:
    _portable().copy_checked(source_root, rec, target)
''',
    "pack": '''def pack(root: Path | str, destination: Path | str) -> dict:
    return _portable().pack(root, destination)
''',
    "receive": '''def receive(archive: Path | str, destination: Path | str) -> dict:
    return _portable().receive(archive, destination)
''',
}


def git_blob(body):
    return hashlib.sha1(b"blob " + str(len(body)).encode("ascii") + b"\0" + body).hexdigest()


def function_range(source, name):
    candidates = [node for node in ast.parse(source).body
                  if isinstance(node, (ast.FunctionDef, ast.AsyncFunctionDef)) and node.name == name]
    if len(candidates) != 1:
        raise ValueError("Expected exactly one original function: " + name)
    node = candidates[0]
    start = min([node.lineno] + [item.lineno for item in node.decorator_list]) - 1
    return start, node.end_lineno


def replace_function(source, name, replacement):
    lines = source.splitlines(keepends=True)
    start, end = function_range(source, name)
    return "".join(lines[:start]) + replacement + "".join(lines[end:])


def replace_inside(source, name, old, new, count=1):
    lines = source.splitlines(keepends=True)
    start, end = function_range(source, name)
    body = "".join(lines[start:end])
    if body.count(old) != count:
        raise ValueError("The original " + name + " caller differs at " + repr(old[:80]))
    return "".join(lines[:start]) + body.replace(old, new) + "".join(lines[end:])


def compose(original):
    source = original.decode("utf-8")
    if MARKER in source:
        compile(source, "gis_project.py", "exec")
        return original
    if git_blob(original) != PREIMAGE:
        raise ValueError("GIS source advanced: expected " + PREIMAGE + ", received " + git_blob(original)
                         + ". Reconcile that complete source before applying this authoring join.")
    for name, replacement in FUNCTIONS.items():
        source = replace_function(source, name, replacement)
    anchor = "def canonical(value: Any) -> bytes:"
    if source.count(anchor) != 1:
        raise ValueError("The original GIS canonical boundary changed")
    source = source.replace(anchor, HELPER + anchor, 1)
    imports = "import os\nfrom pathlib import Path, PurePosixPath"
    if source.count(imports) != 1:
        raise ValueError("The original GIS imports changed")
    source = source.replace(imports, "import os\nimport posixpath\nfrom pathlib import Path, PurePosixPath", 1)
    source = replace_inside(source, "verify",
        "root = Path(root).resolve(strict=True)",
        "root = _portable().native_path(Path(root).resolve(strict=True))")
    source = replace_inside(source, "verify",
        '        raise ValueError("Duplicate inventory member")\n',
        '        raise ValueError("Duplicate inventory member")\n'
        '    _portable().validate_members([*expected, "inventory.json"])\n')
    source = replace_inside(source, "build",
        "source_root, destination = Path(source_root).resolve(strict=True), Path(destination).resolve()",
        "source_root, destination = (_portable().native_path(Path(source_root).resolve(strict=True)),\n"
        "                                _portable().native_path(Path(destination).resolve()))")
    # These are logical ZIP/member names on EVERY platform, not host paths.
    source = replace_inside(source, "build", "common=os.path.commonpath(",
                            "common=posixpath.commonpath(", count=2)
    source = replace_inside(source, "build",
        '                         "gis_vector_metadata.py","fgdc_metadata.py"):',
        '                         "gis_vector_metadata.py","fgdc_metadata.py","__init__.py",\n'
        '                         "gis_project_portable.py","portable_fs.py","windows_fs.py"):')
    source = replace_inside(source, "build", "os.replace(stage,destination)",
                            "_portable().publish_directory(stage,destination)")
    source = replace_inside(source, "seal", "root=Path(root).resolve(strict=True)",
                            "root=_portable().native_path(Path(root).resolve(strict=True))")
    compile(source, "gis_project.py", "exec")
    return source.encode("utf-8")


def write_complete(path, body, mode):
    path.parent.mkdir(parents=True, exist_ok=True)
    pending = path.with_name(".gis-source-" + uuid.uuid4().hex)
    try:
        with pending.open("xb") as stream:
            stream.write(body)
            stream.flush()
            os.fsync(stream.fileno())
        os.chmod(pending, mode)
        os.replace(pending, path)
    finally:
        pending.unlink(missing_ok=True)


def main(argv=None):
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("application", type=Path)
    parser.add_argument("--output", type=Path, help="Emit the complete file separately instead of updating APPLICATION")
    parser.add_argument("--check", action="store_true", help="Compose and compile in memory without writing")
    args = parser.parse_args(argv)
    try:
        application = args.application.expanduser().resolve(strict=True)
        path = application / "model" / "gis_project.py"
        if path.is_symlink():
            raise ValueError("Select the original regular GIS source file")
        original = path.read_bytes()
        completed = compose(original)
        destination = args.output.expanduser().resolve() if args.output else path
        if not args.check and (completed != original or destination != path):
            write_complete(destination, completed, stat.S_IMODE(path.stat().st_mode))
        print(json.dumps({"source": str(path), "destination": str(destination),
                          "before_git_blob": git_blob(original), "git_blob": git_blob(completed),
                          "bytes": len(completed), "sha256": hashlib.sha256(completed).hexdigest(),
                          "changed": completed != original, "written": not args.check}, indent=2))
        return 0
    except (OSError, ValueError, SyntaxError, UnicodeError) as error:
        print(str(error), file=sys.stderr)
        return 2


if __name__ == "__main__":
    raise SystemExit(main())
