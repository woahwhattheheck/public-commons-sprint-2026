"""MIT. Load the maintained XML modules without changing sibling console routing."""
from importlib.util import module_from_spec, spec_from_file_location
from pathlib import Path
import sys

XML_ROOT = Path(__file__).resolve().parents[1] / "xml"

def original_module(name, filename):
    if name in sys.modules:
        return sys.modules[name]
    spec = spec_from_file_location(name, XML_ROOT / filename)
    module = module_from_spec(spec)
    sys.modules[name] = module
    try:
        spec.loader.exec_module(module)
    except Exception:
        sys.modules.pop(name, None)
        raise
    return module

source = original_module("_sf30_feed_original_xml_source", "xml_source.py")
previous = sys.modules.get("xml_source")
sys.modules["xml_source"] = source
try:
    workspace = original_module("_sf30_feed_original_xml_workspace", "workspace.py")
finally:
    if previous is None:
        sys.modules.pop("xml_source", None)
    else:
        sys.modules["xml_source"] = previous

InputError, parser, parse_stream = source.InputError, source.parser, source.parse_stream
expanded, MAX_DEPTH, Node = source.expanded, source.MAX_DEPTH, source.Node
Workspace, json_bytes, load_json, digest = workspace.Workspace, workspace.json_bytes, workspace.load_json, workspace.digest
checked_id, private_write, file_digest = workspace.checked_id, workspace.private_write, workspace.file_digest
regular, sync_dir = workspace.regular, workspace.sync_dir
