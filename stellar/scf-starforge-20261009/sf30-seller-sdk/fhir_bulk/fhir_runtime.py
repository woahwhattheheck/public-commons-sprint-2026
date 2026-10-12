"""MIT. Stable binding to the unchanged SF30 XML workspace and private server."""
from __future__ import annotations
import importlib.util
from pathlib import Path
import sys
import threading

HERE = Path(__file__).resolve().parent
XML = HERE.parent / "xml"
if str(XML) not in sys.path:
    sys.path.insert(0, str(XML))
from xml_source import InputError, MAX_SOURCE

_IMPORT_LOCK = threading.RLock()


def _load(name, filename):
    expected = XML / filename
    existing = sys.modules.get(name)
    if existing is not None:
        if Path(existing.__file__).resolve() != expected.resolve():
            raise InputError("Original SF30 module name resolves to a different source")
        return existing
    spec = importlib.util.spec_from_file_location(name, expected)
    if spec is None or spec.loader is None:
        raise InputError("Original SF30 source dependency is unavailable: " + filename)
    module = importlib.util.module_from_spec(spec)
    sys.modules[name] = module
    try:
        spec.loader.exec_module(module)
    except BaseException:
        sys.modules.pop(name, None)
        raise
    return module


with _IMPORT_LOCK:
    existing = sys.modules.get("workspace")
    if existing is not None and Path(getattr(existing, "__file__", "")).resolve() == (XML / "workspace.py").resolve():
        original_workspace = existing
    else:
        original_workspace = _load("_sf30_fhir_original_xml_workspace", "workspace.py")
    # The unchanged original server's absolute workspace import is resolved
    # during its initial module load, then the caller's previous binding returns.
    saved = sys.modules.get("workspace")
    sys.modules["workspace"] = original_workspace
    try:
        original_server = _load("_sf30_fhir_original_xml_server", "server.py")
    finally:
        if saved is None:
            sys.modules.pop("workspace", None)
        else:
            sys.modules["workspace"] = saved
