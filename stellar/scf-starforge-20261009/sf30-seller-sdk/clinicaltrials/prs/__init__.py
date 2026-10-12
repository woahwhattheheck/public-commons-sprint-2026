"""Source-native PRS Protocol/Results validation, modernization and reconciliation.

The host retains original/candidate bytes and owns its existing workspace,
review state, authenticated operator and PRS submission channel.
"""
from .errors import PrsError
from .schema import doctor, inspect, compare
from .modernization import prepare, apply
from .upload import preview_upload
from .reconcile import reconcile, catalog, parse_native_json

__version__ = "1.0.0"
__all__ = ["PrsError", "doctor", "inspect", "compare", "prepare", "apply",
           "preview_upload", "reconcile", "catalog", "parse_native_json"]
