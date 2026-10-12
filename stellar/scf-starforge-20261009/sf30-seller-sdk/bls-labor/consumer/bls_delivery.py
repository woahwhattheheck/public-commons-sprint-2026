"""Restore an original BLS source-file capture from delivered SF88 pages."""
from __future__ import annotations

from dataclasses import dataclass
from pathlib import Path
import re
import sys
from typing import ClassVar

_SDK = Path(__file__).resolve().parents[2]
_loaded = sys.modules.get("source_file_delivery")
if _loaded is not None and Path(_loaded.__file__).resolve() != _SDK / "source_file_delivery.py":
    raise ImportError("SOURCE_FILES_IMPORT_CONFLICT")
sys.path.insert(0, str(_SDK))
from source_file_delivery import (
    COMMON_FIELDS, SourceFileContract, SourceFileDeliveryError,
    SourceFiles, restore_file_projection,
)

MANIFEST_PATH = "_bls/capture-manifest.json"
MANIFEST_SCHEMA = "stellar-forge.bls-labor-capture.v1"


class BlsDeliveryError(SourceFileDeliveryError):
    """A BLS capture or selected original receiver contract failed."""


def _manifest(value, identity, expected, contract):
    prefix = value.get("source_prefix")
    if not isinstance(prefix, str) or prefix and not prefix.endswith("/"):
        contract.fail("SOURCE_PREFIX_INVALID")
    if prefix:
        contract.name(prefix[:-1])
    if not isinstance(value.get("selection"), dict) or not isinstance(value.get("provenance"), dict):
        contract.fail("CAPTURE_SELECTION_INVALID")
    sources = value.get("sources")
    if not isinstance(sources, list) or not sources:
        contract.fail("CAPTURE_SOURCES_INVALID")
    seen = set()
    for item in sources:
        if not isinstance(item, dict):
            contract.fail("CAPTURE_SOURCES_INVALID")
        name = contract.name(item.get("path"))
        receipt = contract.name(item.get("receipt_path"))
        if name in seen or name not in expected or receipt not in expected:
            contract.fail("CAPTURE_SOURCE_MEMBER_MISMATCH", path=name)
        seen.add(name)
        if (not isinstance(item.get("role"), str) or not item["role"]
                or not isinstance(item.get("url"), str) or not item["url"]
                or not isinstance(item.get("retrieved_at"), str)):
            contract.fail("CAPTURE_SOURCE_IDENTITY_INVALID", path=name)
    keys = value.get("catalog_keys")
    if keys is not None and (
        not isinstance(keys, list) or not keys
        or any(not isinstance(key, str) or re.fullmatch(r"[a-z0-9][a-z0-9_-]{0,99}", key) is None for key in keys)
        or len(keys) != len(set(keys))
    ):
        contract.fail("CATALOG_KEYS_INVALID")


_CONTRACT = SourceFileContract(
    manifest_path=MANIFEST_PATH, manifest_schema=MANIFEST_SCHEMA,
    prefix="BLS", error_type=BlsDeliveryError, required_fields=COMMON_FIELDS,
    row_identity=lambda row, contract: (), validate_manifest=_manifest,
    staging_prefix=".bls-receive-",
)


@dataclass(frozen=True)
class BlsSourceDelivery(SourceFiles):
    contract: ClassVar[SourceFileContract] = _CONTRACT

    def summary(self):
        return {
            "schema": "stellar-forge.bls-labor-received.v1",
            "capture_id": self.capture_id,
            "source_directory": str(self.directory),
            "source_prefix": self.manifest["source_prefix"],
            "manifest_path": str(self.directory / MANIFEST_PATH),
            "source_files": len(self.manifest["files"]),
            "acquired_rows": self.acquired_rows,
            "native_status": self.native_status,
            "payment_status": self.payment_status,
            "reopened": self.reopened,
            "catalog_keys": self.manifest.get("catalog_keys"),
        }


def restore_source_files(delivery, destination, *, expected_capture_id=None):
    return restore_file_projection(delivery, destination,
        result_type=BlsSourceDelivery, expected_capture_id=expected_capture_id)


def receive_acquisition(acquisition, delivery_directory, source_directory, **expectations):
    return restore_source_files(acquisition.deliver(delivery_directory),
                                source_directory, **expectations)


def source_arguments(parser):
    parser.add_argument("--checkout", required=True, help="Original public application repository root")
    parser.add_argument("--session", required=True, help="Existing original SF88 dataset session")
    parser.add_argument("--delivery", required=True, help="Original SF100 delivery directory")
    parser.add_argument("--sources", required=True, help="Complete reconstructed source directory")
    parser.add_argument("--capture-id", required=True, help="Reviewed source capture manifest SHA256")
    parser.add_argument("--node", help="Selected original Node executable")
    parser.add_argument("--timeout", type=float, default=360, help="Original CLI subprocess timeout")


def receive_existing(args):
    checkout = Path(args.checkout).expanduser().resolve()
    python = checkout / "stellar/scf-starforge-20261009/sf88-operator-buyer-cli/python"
    if not python.is_dir():
        raise BlsDeliveryError("ORIGINAL_SF88_CHECKOUT_REQUIRED")
    sys.path.insert(0, str(python))
    from stellar_forge_buyer import datasets
    expected_module = python / "stellar_forge_buyer/datasets.py"
    if Path(datasets.__file__).resolve() != expected_module:
        raise BlsDeliveryError("ORIGINAL_SF88_CHECKOUT_REQUIRED")

    acquisition = datasets.DatasetAcquisition(
        checkout=checkout, session=args.session, node=args.node, timeout=args.timeout)
    return receive_acquisition(acquisition, args.delivery, args.sources,
                               expected_capture_id=args.capture_id)

