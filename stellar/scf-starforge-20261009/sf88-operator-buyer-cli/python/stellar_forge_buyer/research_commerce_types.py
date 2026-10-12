"""Typed original Research commerce inputs, native results and complete files.

Amounts remain positive decimal atomic-unit strings. Original checkout, Buyer
Runbook, dossier and source records retain their native schemas and identifiers.
"""
from __future__ import annotations

from typing import Any, Literal, TypeAlias, TypedDict
from .research_customer_types import (
    CustomerSourceWorkspaceSelection, CustomerHandoverSelection,
    CustomerHandoverManifest, CustomerFormattedHandoverFile, CustomerReceivingResult,
)

CommerceCollection: TypeAlias = Literal["publications", "purchases"]
CommerceFilePart: TypeAlias = Literal["publication", "handoff", "archive", "received"]
CommerceBuyerAction: TypeAlias = Literal["execute", "retrieve", "recover", "finalize", "cancel"]


class CommercePublicationBase(TypedDict):
    requestId: str
    merchant: str
    dossierId: str
    deliveryId: str
    revision: int
    title: str
    summary: str
    usage: str


class CommercePublicationRequest(CommercePublicationBase, total=False):
    sourceWorkspace: CustomerSourceWorkspaceSelection | None


class CommercePublicationEnrollment(TypedDict):
    id: str
    reviewSha256: str


class CommerceArchivePromise(TypedDict):
    name: Literal["research-customer.handover.gz"]
    bytes: int
    sha256: str
    contentType: Literal["application/gzip"]


class CommerceArchiveFile(CommerceArchivePromise):
    path: str


class CommercePublicDelivery(TypedDict):
    schema: Literal["sf88-research-customer-handover/v1"]
    dossierId: str
    deliveryId: str
    revision: int
    manifestSha256: str
    manifestBytes: int
    files: list[CustomerFormattedHandoverFile]


class CommercePublicPublication(TypedDict):
    schema: Literal["sf88-research-paid-publication/v1"]
    publicationId: str
    title: str
    summary: str
    usage: str
    delivery: CommercePublicDelivery
    archive: CommerceArchivePromise
    handoff: dict[str, Any]


class CommerceMerchantSelection(TypedDict):
    id: str
    label: str
    checkoutFile: str
    checkoutSha256: str
    routeId: str
    purchaseUrl: str
    payment: dict[str, Any]
    state: str
    outbox: str
    claimEnv: str
    claimAvailable: bool


class CommerceBuyerSelection(TypedDict):
    id: str
    label: str
    directory: str
    selectionSha256: str
    maximumFileBytes: int
    maximumExportBytes: int


class CommerceConfigurationError(TypedDict):
    kind: Literal["merchant", "buyer"]
    id: str
    code: str


class CommerceConfiguration(TypedDict):
    schema: Literal["sf88-research-customer-commerce-host/v1"]
    workspaceId: str
    configurationFile: str | None
    merchants: list[CommerceMerchantSelection]
    buyers: list[CommerceBuyerSelection]
    errors: list[CommerceConfigurationError]


class CommerceSummaryBase(TypedDict):
    id: str
    kind: CommerceCollection
    title: str
    createdAt: str
    dossierId: str
    deliveryId: str
    status: str


class CommerceSummary(CommerceSummaryBase, total=False):
    merchant: str
    buyer: str
    reviewSha256: str | None


class CommercePageError(TypedDict):
    id: str
    code: str


class CommercePage(TypedDict):
    schema: Literal["sf88-research-customer-commerce/v1"]
    workspaceId: str
    kind: CommerceCollection
    snapshot: str
    items: list[CommerceSummary]
    errors: list[CommercePageError]
    offset: int
    limit: int
    total: int
    nextOffset: int | None


class CommercePublicationReview(TypedDict):
    schema: Literal["sf88-research-paid-publication-review/v1"]
    id: str
    reviewSha256: str
    title: str
    summary: str
    usage: str
    dossierId: str
    deliveryId: str
    revision: int
    archive: CommerceArchivePromise
    manifestSha256: str
    manifestBytes: int
    files: list[CustomerFormattedHandoverFile]
    merchant: CommerceMerchantSelection
    orderReference: str
    createdAt: str


class CommercePublicationResult(TypedDict):
    publicationId: str
    orderReference: str
    publication: CommercePublicPublication
    publicationSha256: str
    publicationBytes: int
    merchantHandoffSha256: str
    nativeOrder: dict[str, Any]
    completedAt: str


class CommercePublicationViewBase(TypedDict):
    schema: Literal["sf88-research-customer-commerce/v1"]
    kind: Literal["publications"]
    id: str
    status: Literal["PREPARING", "REVIEWED", "ENROLLED"]
    review: CommercePublicationReview | None
    result: CommercePublicationResult | None


class CommercePublicationView(CommercePublicationViewBase, total=False):
    request: CommercePublicationRequest
    reused: bool


class CommercePurchaseIntake(TypedDict):
    requestId: str
    buyer: str
    filename: str
    base64: str


class CommercePurchasePreparation(TypedDict):
    id: str
    requestId: str
    expectedRevision: int
    totalAtomic: str
    dailyAtomic: str
    claimEnv: str


class CommercePurchasePrepared(TypedDict):
    schema: Literal["sf88-research-paid-purchase-prepared/v1"]
    input: CommercePurchasePreparation
    preparedSha256: str
    publicationSha256: str
    buyerBindingSha256: str
    paidFileId: str
    runId: str
    planId: str
    operationId: str
    intentId: str
    sourceConfigSha256: str
    configSha256: str
    handoffSha256: str
    orderReference: str
    archive: CommerceArchivePromise
    nativeReview: dict[str, Any]
    nativePreparation: dict[str, Any]
    nativeDraft: dict[str, Any]
    nativeInitialized: dict[str, Any]
    createdAt: str


class CommercePurchaseAction(TypedDict):
    id: str
    requestId: str
    preparedSha256: str


class CommercePurchaseCancellation(CommercePurchaseAction):
    executionId: str


class CommercePurchaseReconciliationBase(TypedDict):
    id: str
    requestId: str
    nativeRequestId: str


class CommercePurchaseReconciliation(CommercePurchaseReconciliationBase, total=False):
    nativeId: str


class CommercePurchaseReceiving(CommercePurchaseAction, total=False):
    sourceActor: str


class CommercePaidCustomerReceived(TypedDict):
    schema: Literal["sf88-research-paid-customer-received/v1"]
    workspaceId: str
    publicationSha256: str
    publicationId: str
    orderReference: str
    archive: CommerceArchivePromise
    buyer: dict[str, Any]
    nativeReceiving: CustomerReceivingResult
    completedAt: str


class CommercePurchaseViewBase(TypedDict):
    schema: Literal["sf88-research-customer-commerce/v1"]
    kind: Literal["purchases"]
    id: str
    status: Literal["RECEIVING", "OFFER_RECEIVED", "BUYER_PREPARED", "DOSSIER_RECEIVED"]
    publication: CommercePublicPublication
    buyer: CommerceBuyerSelection
    result: dict[str, Any] | None
    prepared: CommercePurchasePrepared | None
    received: CommercePaidCustomerReceived | None


class CommercePurchaseView(CommercePurchaseViewBase, total=False):
    buyerConnection: dict[str, Any]
    operator: dict[str, Any]
    paidFile: dict[str, Any] | None
    run: dict[str, Any] | None
    operation: dict[str, Any] | None
    approval: dict[str, Any]
    reused: bool


class CommercePurchasePreparationResult(TypedDict):
    schema: Literal["sf88-research-customer-commerce/v1"]
    kind: Literal["purchases"]
    id: str
    status: Literal["BUYER_PREPARED"]
    prepared: CommercePurchasePrepared
    reused: bool


class CommercePurchaseActionResult(TypedDict):
    schema: Literal["sf88-research-customer-commerce/v1"]
    kind: Literal["purchases"]
    id: str
    action: CommerceBuyerAction
    requestId: str
    original: dict[str, Any]
    run: dict[str, Any]
    operation: dict[str, Any]


class CommercePurchaseReceivingResult(TypedDict):
    schema: Literal["sf88-research-customer-commerce/v1"]
    kind: Literal["purchases"]
    id: str
    status: Literal["DOSSIER_RECEIVED"]
    received: CommercePaidCustomerReceived
    reused: bool


class CommerceFileDescriptor(TypedDict):
    name: str
    bytes: int
    sha256: str
    contentType: str


class CommerceFileMetadata(TypedDict):
    schema: Literal["sf88-research-commerce-file/v1"]
    workspaceId: str
    kind: CommerceCollection
    id: str
    file: CommerceFilePart
    descriptor: CommerceFileDescriptor


class CommerceLocalFile(CommerceFileDescriptor):
    path: str


class CommerceOperationResult(TypedDict):
    schema: Literal["sf88-research-commerce-operator-result/v1"]
    workspaceId: str
    requestSha256: str
    result: dict[str, Any]
    resultSha256: str
    completedAt: str
    directory: str
    reused: bool


class CommerceExportResult(TypedDict):
    schema: Literal["sf88-research-commerce-export-result/v1"]
    workspaceId: str
    selectionSha256: str
    file: CommerceLocalFile
    completedAt: str
    directory: str
    reused: bool


class CommerceInspectedHandover(TypedDict):
    schema: Literal["sf88-research-customer-handover-inspected/v1"]
    directory: str
    manifestSha256: str
    manifestBytes: int
    manifest: CustomerHandoverManifest
    selection: CustomerHandoverSelection
    files: list[CustomerFormattedHandoverFile]


class CommerceReceivedArchive(TypedDict):
    schema: Literal["sf88-research-paid-archive-received/v1"]
    directory: str
    archive: CommerceArchiveFile
    manifestSha256: str
    handover: CommerceInspectedHandover
    reused: bool
