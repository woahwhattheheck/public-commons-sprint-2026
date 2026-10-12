"""Restore original WordPress files acquired by the existing SF88 DatasetDelivery."""
from __future__ import annotations
from dataclasses import dataclass
import json
import re
from pathlib import Path
from typing import ClassVar
from source_file_delivery import (
    COMMON_FIELDS, SourceFileContract, SourceFileDeliveryError,
    SourceFiles, restore_file_projection,
)
from .packet import SCHEMA, WORKSPACE_SCHEMA, MANIFEST, allowed

class WordPressSourceError(SourceFileDeliveryError):
    pass

def row_identity(row, contract):
    workspace_id = row.get("workspace_id")
    if not isinstance(workspace_id, str) or not re.fullmatch(
            r"[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}", workspace_id):
        contract.fail("WORKSPACE_ID_INVALID")
    if row["path"] != MANIFEST and not allowed(row["path"]):
        contract.fail("SOURCE_PATH_INVALID")
    return {"workspace_id": workspace_id}

def validate_manifest(value, identity, expected, contract):
    if value.get("workspaceId") != identity["workspace_id"] or type(value.get("revision")) is not int:
        contract.fail("WORKSPACE_IDENTITY_MISMATCH")
    if "workspace.json" not in expected or any(not allowed(name) for name in expected):
        contract.fail("WORKSPACE_FILES_INVALID")

CONTRACT = SourceFileContract(
    manifest_path=MANIFEST, manifest_schema=SCHEMA, prefix="WORDPRESS",
    error_type=WordPressSourceError,
    required_fields=COMMON_FIELDS | frozenset({"workspace_id"}),
    row_identity=row_identity, validate_manifest=validate_manifest,
    staging_prefix=".wordpress-source-receive-",
)

@dataclass(frozen=True)
class WordPressSourceFiles(SourceFiles):
    contract: ClassVar[SourceFileContract] = CONTRACT

    def workspace(self) -> dict:
        value = json.loads(self.read_file("workspace.json"))
        if (value.get("schema") != WORKSPACE_SCHEMA
                or value.get("id") != self.manifest.get("workspaceId")
                or value.get("revision") != self.manifest.get("revision")
                or value.get("operations") or value.get("packets")):
            self.contract.fail("WORKSPACE_BINDING_MISMATCH")
        return value

    @property
    def workspace_directory(self) -> Path:
        self.workspace()
        return self.directory

def restore_wordpress_source(delivery, destination, *, expected_capture_id=None, expected_workspace_id=None):
    """The supplied original DatasetDelivery retains native payment and page state."""
    def check(identity):
        if expected_workspace_id is not None and identity["workspace_id"] != expected_workspace_id:
            CONTRACT.fail("WORKSPACE_IDENTITY_MISMATCH")
    result = restore_file_projection(
        delivery, destination, result_type=WordPressSourceFiles,
        expected_capture_id=expected_capture_id, check_identity=check,
    )
    result.workspace()
    return result
