"""Installable Python interface to the original Stellar Forge buyer runtime.

Public names resolve to their original modules on first access. Importing a
local reader does not initialize the unrelated customer product interfaces.
"""
from importlib import import_module as _import_module
from typing import TYPE_CHECKING as _TYPE_CHECKING

if _TYPE_CHECKING:
    from .client import Buyer, Operation, Review
    from .inbox import Inbox, InboxResult, InboxError
    from .acquisitions import AcquisitionWorkspace, AcquisitionResult, AcquisitionProcess, AcquisitionError
    from .datasets import DatasetAcquisition, DatasetDelivery, DatasetError
    from .duckdb_dataset import DuckDBWorkspace
    from .duckdb_spatial import DuckDBSpatial
    from .errors import BuyerError, DeliveryError, NativeError, StateError
    from .postgres_delivery import Column, DatasetMapping, PostgresWarehouse, WarehouseError, review_delivery
    from .objects import ObjectBuyer, ObjectSession, ObjectReport, ObjectDelivery, ObjectDownloadError
    from .recovery import WorkspaceRecovery, WorkspaceRecoveryResult, WorkspaceRecoveryProcess, WorkspaceRecoveryError
    from .result import AccountingResult, BuyerResult, FileDelivery, FileTransfer, SessionAccountingResult
    from .research_workspace import ResearchWorkspace, ResearchError
    from .research_extraction import ResearchExtraction
    from .research_documents import ResearchDocuments, ResearchPipelines, ResearchSelection, ResearchInputFile, ResearchDocumentSource
    from .requests import MultipartRequest, UploadFile
    from .streams import SSEEvent, NDJSONRecord, StreamDelivery, read_retained_response, export_saved_stream

__all__ = [
    "ResearchWorkspace", "ResearchError", "ResearchExtraction", "ResearchDocuments", "ResearchPipelines",
    "ResearchSelection", "ResearchInputFile", "ResearchDocumentSource",
    "AcquisitionWorkspace", "AcquisitionResult", "AcquisitionProcess", "AcquisitionError",
    "WorkspaceRecovery", "WorkspaceRecoveryResult", "WorkspaceRecoveryProcess", "WorkspaceRecoveryError",
    "Inbox", "InboxResult", "InboxError",
    "Buyer", "Operation", "Review", "BuyerResult", "FileDelivery", "FileTransfer", "AccountingResult", "SessionAccountingResult",
    "DatasetAcquisition", "DatasetDelivery", "DatasetError", "DuckDBWorkspace", "DuckDBSpatial",
    "Column", "DatasetMapping", "PostgresWarehouse", "WarehouseError", "review_delivery",
    "ObjectBuyer", "ObjectSession", "ObjectReport", "ObjectDelivery", "ObjectDownloadError",
    "BuyerError", "DeliveryError", "NativeError", "StateError",
    "MultipartRequest", "UploadFile", "SSEEvent", "NDJSONRecord", "StreamDelivery", "read_retained_response", "export_saved_stream",
]

_EXPORTS = {
    "ResearchWorkspace": ".research_workspace",
    "ResearchError": ".research_workspace",
    "ResearchExtraction": ".research_extraction",
    "ResearchDocuments": ".research_documents",
    "ResearchPipelines": ".research_documents",
    "ResearchSelection": ".research_documents",
    "ResearchInputFile": ".research_documents",
    "ResearchDocumentSource": ".research_documents",
    "AcquisitionWorkspace": ".acquisitions",
    "AcquisitionResult": ".acquisitions",
    "AcquisitionProcess": ".acquisitions",
    "AcquisitionError": ".acquisitions",
    "WorkspaceRecovery": ".recovery",
    "WorkspaceRecoveryResult": ".recovery",
    "WorkspaceRecoveryProcess": ".recovery",
    "WorkspaceRecoveryError": ".recovery",
    "Inbox": ".inbox",
    "InboxResult": ".inbox",
    "InboxError": ".inbox",
    "Buyer": ".client",
    "Operation": ".client",
    "Review": ".client",
    "BuyerResult": ".result",
    "FileDelivery": ".result",
    "FileTransfer": ".result",
    "AccountingResult": ".result",
    "SessionAccountingResult": ".result",
    "DatasetAcquisition": ".datasets",
    "DatasetDelivery": ".datasets",
    "DatasetError": ".datasets",
    "DuckDBWorkspace": ".duckdb_dataset",
    "DuckDBSpatial": ".duckdb_spatial",
    "Column": ".postgres_delivery",
    "DatasetMapping": ".postgres_delivery",
    "PostgresWarehouse": ".postgres_delivery",
    "WarehouseError": ".postgres_delivery",
    "review_delivery": ".postgres_delivery",
    "ObjectBuyer": ".objects",
    "ObjectSession": ".objects",
    "ObjectReport": ".objects",
    "ObjectDelivery": ".objects",
    "ObjectDownloadError": ".objects",
    "BuyerError": ".errors",
    "DeliveryError": ".errors",
    "NativeError": ".errors",
    "StateError": ".errors",
    "MultipartRequest": ".requests",
    "UploadFile": ".requests",
    "SSEEvent": ".streams",
    "NDJSONRecord": ".streams",
    "StreamDelivery": ".streams",
    "read_retained_response": ".streams",
    "export_saved_stream": ".streams",
}

# importlib.reload refreshes facade bindings while the original modules keep
# their normal import identities and lifetimes.
for _public_name in __all__:
    globals().pop(_public_name, None)
del _public_name


def __getattr__(name):
    module_name = _EXPORTS.get(name)
    if module_name is None:
        raise AttributeError(f"module {__name__!r} has no attribute {name!r}")
    value = getattr(_import_module(module_name, __name__), name)
    globals()[name] = value
    return value


def __dir__():
    return sorted(set(globals()) | set(__all__))
