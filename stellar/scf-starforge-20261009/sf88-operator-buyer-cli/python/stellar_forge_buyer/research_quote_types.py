"""Typed selections and original native records for Research customer quotations."""
from __future__ import annotations
from typing import Any, Literal, TypeAlias, TypedDict

QuoteJson: TypeAlias = None | bool | int | float | str | list["QuoteJson"] | dict[str, "QuoteJson"]
QuoteObject: TypeAlias = dict[str, QuoteJson]
QuoteKind: TypeAlias = Literal["CASE", "BRIEF", "RESPONSE", "PUBLICATION", "REALIZED"]
QuoteStatus: TypeAlias = Literal["PREPARING", "REVIEWED", "COMPLETE"]
QuoteCommand: TypeAlias = Literal[
    "create-case", "native-case", "pricing", "prepare", "apply", "prepare-response",
    "prepare-publication", "enroll-publication", "prepare-report",
]
QuoteCaseAction: TypeAlias = Literal[
    "preview", "save-draft", "publish", "receive", "receive-pricing", "compare",
    "preview-implementation", "adopt-implementation", "receiving-status",
    "receiving-capture", "receiving-inspect", "receiving-attach", "receiving-case",
    "receiving-restore", "tariff-status", "tariff-catalog", "tariff-selection",
    "tariff-capture", "tariff-inspect", "tariff-attach", "tariff-case", "tariff-restore",
]
QuotePricingAction: TypeAlias = Literal[
    "state", "preview", "save", "version", "compare", "planning-state",
    "planning-preview", "planning-save", "planning-read", "economics-state",
    "economics-preview", "economics-save", "economics-edition", "economics-proposal",
    "economics-apply", "repricing-source", "repricing-preview", "repricing-save", "repricing-stage",
]


class QuoteActor(TypedDict):
    id: str
    name: str


class QuoteScope(TypedDict):
    component: Literal["IMPLEMENTATION", "RECURRING", "ROUTE_USAGE", "KEEP"]
    unit: str
    note: str


class QuoteCaseSelection(TypedDict):
    requestId: str
    caseId: str
    dossierId: str
    revision: int
    projectId: str
    briefId: str
    actor: QuoteActor


class QuoteBriefSelection(TypedDict):
    requestId: str
    caseId: str
    caseRevision: str
    quoteId: str
    quoteSha256: str
    dossierId: str
    revision: int
    projectId: str
    briefId: str
    merchant: str
    scope: QuoteScope
    reason: str
    actor: QuoteActor


class QuoteResponseSelection(TypedDict):
    requestId: str
    bindingId: str
    caseRevision: str
    responseId: str
    revision: int
    actor: QuoteActor
    by: QuoteActor


class QuoteSourceWorkspace(TypedDict):
    library: str
    actor: str
    requestId: str


class _QuotePublicationRequired(TypedDict):
    requestId: str
    bindingId: str
    dossierId: str
    revision: int
    deliveryId: str
    title: str
    summary: str
    usage: str


class QuotePublicationSelection(_QuotePublicationRequired, total=False):
    sourceWorkspace: QuoteSourceWorkspace | None


class _QuotePricingRequired(TypedDict):
    profile: str
    version: str


class QuotePricingSelection(_QuotePricingRequired, total=False):
    costEdition: str


class QuoteReportSelection(TypedDict):
    requestId: str
    bindingId: str
    publicationId: str
    purchaseIds: list[str]
    revision: int
    pricing: QuotePricingSelection | None
    actor: QuoteActor


class QuoteApplySelection(TypedDict):
    id: str
    reviewSha256: str


QuoteSelection: TypeAlias = (
    QuoteCaseSelection | QuoteBriefSelection | QuoteResponseSelection |
    QuotePublicationSelection | QuoteReportSelection | QuoteApplySelection
)


class QuoteFile(TypedDict):
    name: str
    bytes: int
    sha256: str
    contentType: str


class QuoteLocalFile(QuoteFile):
    path: str


class QuoteOperation(TypedDict):
    schema: Literal["sf88-research-customer-quote-operation/v1"]
    workspaceId: str
    casesWorkspaceId: str
    id: str
    kind: QuoteKind
    status: QuoteStatus
    request: QuoteObject
    requestSha256: str
    createdAt: str
    review: QuoteObject | None
    result: QuoteJson


class QuoteOperationSummary(TypedDict):
    id: str
    kind: QuoteKind
    createdAt: str
    dossierId: str | None
    caseId: str | None
    quoteId: str | None
    status: QuoteStatus
    bindingId: str | None


class QuotePageError(TypedDict):
    id: str
    code: str


class QuoteInventory(TypedDict):
    schema: Literal["sf88-research-customer-quote-operation/v1"]
    workspaceId: str
    snapshot: str
    items: list[QuoteOperationSummary]
    errors: list[QuotePageError]
    offset: int
    limit: int
    total: int
    nextOffset: int | None


class QuoteFiles(TypedDict):
    schema: Literal["sf88-research-customer-quotes/v1"]
    workspaceId: str
    id: str
    files: list[QuoteFile]


class QuoteFileMetadata(TypedDict):
    schema: Literal["sf88-research-customer-quotes/v1"]
    workspaceId: str
    id: str
    descriptor: QuoteFile


class QuoteCaseIdentity(TypedDict):
    id: str
    revision: str


class QuoteCaseFileMetadata(TypedDict):
    schema: Literal["sf88-research-customer-quotes/v1"]
    workspaceId: str
    caseId: str
    case: QuoteObject
    descriptor: QuoteFile


class _QuoteNativeRequired(TypedDict):
    schema: Literal["sf88-research-customer-quotes/v1"]
    workspaceId: str
    action: str
    result: QuoteJson


class QuoteNativeResponse(_QuoteNativeRequired, total=False):
    caseId: str
    profile: str
    binding: QuoteJson
    bindingSha256: str


class QuoteCasePage(TypedDict):
    enabled: bool
    cases: list[QuoteObject]
    total: int
    offset: int
    limit: int
    nextOffset: int | None
    unavailable: QuoteJson


class QuoteCaseStore(TypedDict):
    directory: str
    workspaceId: str
    identity: QuoteObject


class _QuotePricingProfileRequired(TypedDict):
    id: str
    label: str
    config: str
    directory: str


class QuotePricingProfile(_QuotePricingProfileRequired, total=False):
    snapshot: str
    history: str
    nativeOutbox: str
    sourcePackage: str
    releaseStore: str
    releaseRuntime: QuoteObject


class QuoteMerchants(TypedDict):
    items: list[QuoteJson]
    errors: list[QuoteJson]


class QuoteConfiguration(TypedDict):
    schema: Literal["sf88-research-customer-quotes-host/v1"]
    workspaceId: str
    configurationFile: str | None
    cases: QuoteCaseStore
    pricing: list[QuotePricingProfile]
    merchants: QuoteMerchants


class QuoteOperatorResult(TypedDict):
    schema: Literal["sf88-research-quote-operator-result/v1"]
    workspaceId: str
    requestSha256: str
    attemptId: str
    result: QuoteOperation | QuoteNativeResponse
    resultSha256: str
    completedAt: str
    directory: str
    reused: bool


class QuoteExportResult(TypedDict):
    schema: Literal["sf88-research-quote-export-result/v1"]
    workspaceId: str
    selectionSha256: str
    request: QuoteObject
    files: list[QuoteLocalFile]
    selection: QuoteObject
    completedAt: str
    directory: str
    reused: bool


class QuoteSavedDescriptor(TypedDict):
    path: str
    bytes: int
    sha256: str


class QuoteDownload(TypedDict):
    schema: Literal["sf88-research-quotes-python-download/v1"]
    workspaceId: str
    id: str
    metadata: QuoteFileMetadata
    file: QuoteSavedDescriptor
    transfer: QuoteObject | None
    directory: str


class QuoteExportCopy(TypedDict):
    schema: Literal["sf88-research-quotes-python-export-copy/v1"]
    workspaceId: str
    selectionSha256: str
    directory: str
    manifest: QuoteSavedDescriptor
    files: list[QuoteSavedDescriptor]


class QuoteSavedCall(TypedDict, total=False):
    request: dict[str, Any]
    attempts: int
    completed: bool
    result: QuoteOperatorResult | QuoteExportResult | QuoteExportCopy | QuoteDownload
    attempt: dict[str, Any]
