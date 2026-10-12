"""MIT. Reuse the source-native XML workspace and projection implementation."""
from pathlib import Path
import importlib.util
import sys

XML = Path(__file__).resolve().parent.parent / "xml"
def _load(name, filename):
    path = XML / filename
    existing = sys.modules.get(name)
    if existing is not None:
        if Path(existing.__file__).resolve() != path.resolve():
            raise ImportError("An unrelated XML module is already loaded")
        return existing
    spec = importlib.util.spec_from_file_location(name, path)
    module = importlib.util.module_from_spec(spec)
    sys.modules[name] = module
    spec.loader.exec_module(module)
    return module

xml = _load("xml_source", "xml_source.py")
storage = _load("starforge_original_xml_workspace", "workspace.py")
InputError = xml.InputError
