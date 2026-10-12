"""Restore complete Census captures from original SF88/SF100 delivered rows."""
from __future__ import annotations

from dataclasses import dataclass
from pathlib import Path
import sys
from typing import ClassVar, TYPE_CHECKING

_SDK = Path(__file__).resolve().parents[2]
_loaded = sys.modules.get("source_file_delivery")
if _loaded is not None and Path(_loaded.__file__).resolve() != _SDK / "source_file_delivery.py":
    raise ImportError("SOURCE_FILES_IMPORT_CONFLICT")
sys.path.insert(0, str(_SDK))
from source_file_delivery import (
    CHUNK_BYTES, COMMON_FIELDS, SourceFileContract, SourceFileDeliveryError,
    SourceFiles, restore_file_projection,
)

if TYPE_CHECKING:
    from stellar_forge_buyer.datasets import DatasetDelivery

MANIFEST_PATH = "_census/capture-manifest.json"
MANIFEST_SCHEMA = "stellar-forge.census-acs-capture.v1"
NATIVE_PACKAGE_PATH = "native-source-package.json"


class CensusDeliveryError(SourceFileDeliveryError):
    """A source-format or output conflict after original acquisition handling."""


def _identity(row, contract):
    return tuple(contract.integer(row[name], name)
                 for name in ("release_year", "period_start", "period_end"))


def _manifest(value, identity, expected, contract):
    period = value.get("period")
    if (not isinstance(period, dict)
            or type(value.get("year")) is not int
            or type(period.get("start")) is not int
            or type(period.get("end")) is not int
            or (value["year"], period["start"], period["end"]) != identity):
        contract.fail("RELEASE_IDENTITY_MISMATCH")
    for field in ("tables", "geography_ids"):
        values = value.get(field)
        if (not isinstance(values, list) or not values
                or any(not isinstance(item, str) or not item for item in values)
                or len(values) != len(set(values))):
            contract.fail("CAPTURE_SELECTION_INVALID", field=field)
    annotations = value.get("annotations", [])
    if not isinstance(annotations, list):
        contract.fail("ANNOTATIONS_INVALID")
    for item in annotations:
        if not isinstance(item, dict):
            contract.fail("ANNOTATIONS_INVALID")
        name = contract.name(item.get("path"))
        if name not in expected or expected[name]["sha256"] != item.get("sha256"):
            contract.fail("ANNOTATION_SOURCE_MISMATCH", path=name)
        if item.get("receipt_path") is not None and contract.name(item["receipt_path"]) not in expected:
            contract.fail("ANNOTATION_RECEIPT_MISSING", path=name)


_CONTRACT = SourceFileContract(
    manifest_path=MANIFEST_PATH, manifest_schema=MANIFEST_SCHEMA,
    prefix="CENSUS", error_type=CensusDeliveryError,
    required_fields=COMMON_FIELDS | {"release_year", "period_start", "period_end"},
    row_identity=_identity, validate_manifest=_manifest, staging_prefix=".census-receive-",
)


@dataclass(frozen=True)
class CensusSourceDelivery(SourceFiles):
    contract: ClassVar[SourceFileContract] = _CONTRACT

    def native_package_bytes(self) -> bytes:
        """Return the optional original assembler package without re-encoding."""
        return self.read_file(NATIVE_PACKAGE_PATH)

    def method_sources(self) -> list[tuple[Path, Path]]:
        return [(self.source_path(item["path"]), self.source_path(item["receipt_path"]))
                for item in self.manifest.get("annotations", [])
                if item.get("receipt_path") is not None]

    def summary(self) -> dict:
        value = {
            "schema": "stellar-forge.census-acs-received.v1",
            "capture_id": self.capture_id,
            "year": self.manifest["year"],
            "period": self.manifest["period"],
            "source_directory": str(self.directory),
            "manifest_path": str(self.directory / MANIFEST_PATH),
            "source_files": len(self.manifest["files"]),
            "acquired_rows": self.acquired_rows,
            "native_status": self.native_status,
            "payment_status": self.payment_status,
            "reopened": self.reopened,
        }
        package = next((item for item in self.manifest["files"]
                        if item["path"] == NATIVE_PACKAGE_PATH), None)
        if package is not None:
            value["native_package"] = {
                **package, "path": str(self.directory / NATIVE_PACKAGE_PATH)}
        return value


def restore_source_files(delivery: "DatasetDelivery", destination, *,
                         expected_capture_id=None, expected_year=None) -> CensusSourceDelivery:
    """Restore the complete capture; verify and reopen matching existing output."""
    if expected_year is not None:
        _CONTRACT.integer(expected_year, "expected_year")

    def check_identity(identity):
        if expected_year is not None and identity[0] != expected_year:
            _CONTRACT.fail("RELEASE_IDENTITY_MISMATCH")

    return restore_file_projection(delivery, destination,
        result_type=CensusSourceDelivery, expected_capture_id=expected_capture_id,
        check_identity=check_identity)


def receive_acquisition(acquisition, delivery_directory, source_directory, **expectations):
    return restore_source_files(acquisition.deliver(delivery_directory),
                                source_directory, **expectations)

