"""Typed original Research customer-update requests, files and native results.

Wire field spelling is shared with the JavaScript customer model. Monetary
amounts and provider query parameters retain the caller's original strings.
"""
from __future__ import annotations

from typing import Any, Literal, TypeAlias, TypedDict, Union

Json: TypeAlias = Union[None, bool, int, float, str, list["Json"], dict[str, "Json"]]
CustomerAction: TypeAlias = Literal["create-project", "revise-brief", "record-agreement",
    "request-update", "revise-request", "attach-intake", "review-work",
    "publish-delivery", "record-delivery", "set-project-status"]
CustomerSection: TypeAlias = Literal["overview", "projects", "briefs", "agreements",
    "requests", "intakes", "work", "deliveries", "delivery-events", "operations",
    "records", "editions", "questions"]
CustomerPreviewSection: TypeAlias = Literal["overview", "changes", "sources", "records",
    "intakes", "editions", "uncovered-plans"]
CustomerReportFormat: TypeAlias = Literal["json", "md", "html", "csv"]
CustomerExportFormat: TypeAlias = Literal["json", "md", "html", "csv", "portable", "portable.gz"]


class CustomerActor(TypedDict):
    id: str
    name: str


class CustomerIdentity(TypedDict):
    id: str
    name: str
    reference: str


class CustomerProtocol(TypedDict):
    title: str
    version: str
    source: str
    notes: str


class CustomerScope(TypedDict):
    currency: str
    amount: str
    unit: str
    note: str
    reference: str


class CustomerSourcePlan(TypedDict):
    id: str
    name: str
    questionId: str
    provider: str
    query: str
    parameters: dict[str, Json]
    original: dict[str, Json]
    terms: str
    constraints: str


class CustomerOutput(TypedDict):
    id: str
    label: str
    format: str
    acceptance: str


class CustomerBrief(TypedDict):
    name: str
    customer: CustomerIdentity
    purpose: str
    owner: CustomerActor
    questionIds: list[str]
    protocol: CustomerProtocol
    sourcePlans: list[CustomerSourcePlan]
    outputs: list[CustomerOutput]
    scope: CustomerScope
    updatePolicy: str


CustomerPeriod = TypedDict("CustomerPeriod", {
    "planId": str, "field": str, "from": str, "until": str, "notes": str})


class CustomerRequestSource(TypedDict):
    by: CustomerActor
    receivedAt: str
    reference: str
    note: str


class CustomerRequestedUpdate(TypedDict):
    briefId: str
    kind: Literal["BASELINE", "UPDATE", "CORRECTION"]
    previousDeliveryId: str | None
    label: str
    request: CustomerRequestSource
    periods: list[CustomerPeriod]
    instructions: str


class CustomerRecordSelection(TypedDict):
    path: str
    sha256: str


class CustomerLabeledRecordSelection(CustomerRecordSelection, total=False):
    label: str


class CustomerWorkSelection(TypedDict):
    intakeIds: list[str]
    records: list[CustomerLabeledRecordSelection]


class CustomerChangeDecision(TypedDict):
    sourceId: str
    fingerprint: str
    disposition: Literal["reviewed", "needs_review", "not_applicable"]
    reason: str


class CustomerAcceptance(TypedDict):
    outputId: str
    status: Literal["met", "partly_met", "not_met", "not_applicable", "not_reviewed"]
    note: str


class CustomerReviewWorkInput(TypedDict):
    projectId: str
    cycleId: str
    requestEditionId: str
    selection: CustomerWorkSelection
    fingerprint: str
    summary: str
    limitations: str
    changeDecisions: list[CustomerChangeDecision]
    acceptance: list[CustomerAcceptance]
    note: str


class CustomerRequestBase(TypedDict):
    requestId: str
    expectedRevision: int
    actor: CustomerActor


class CreateProjectData(TypedDict):
    brief: CustomerBrief


class ReviseBriefData(TypedDict):
    projectId: str
    expectedBriefId: str
    brief: CustomerBrief
    reason: str


class RecordAgreementData(TypedDict):
    projectId: str
    briefId: str
    disposition: Literal["PROPOSED", "ACCEPTED", "CHANGES_REQUESTED", "DECLINED"]
    by: CustomerActor
    occurredAt: str
    reference: str
    message: str


class RecordAgreementWithRecords(RecordAgreementData, total=False):
    records: dict[str, Json]


class RequestUpdateData(TypedDict):
    projectId: str
    definition: CustomerRequestedUpdate


class ReviseRequestData(RequestUpdateData):
    cycleId: str
    expectedRequestEditionId: str
    reason: str


class AttachIntakeData(TypedDict):
    projectId: str
    cycleId: str
    requestEditionId: str
    planId: str
    editionIds: list[str]
    original: dict[str, Json]
    note: str


class PublishDeliveryData(TypedDict):
    projectId: str
    workId: str
    expectedWorkSha256: str
    title: str
    coverNote: str
    deliveryNote: str


class RecordDeliveryData(TypedDict):
    projectId: str
    deliveryId: str
    status: Literal["SENT", "RECEIVED", "ACCEPTED", "CORRECTIONS_REQUESTED", "WITHDRAWN"]
    by: CustomerActor
    occurredAt: str
    channel: str
    reference: str
    message: str


class RecordDeliveryWithOriginal(RecordDeliveryData, total=False):
    original: dict[str, Json]


class SetProjectStatusData(TypedDict):
    projectId: str
    status: Literal["ACTIVE", "PAUSED", "COMPLETE"]
    reason: str


class CreateProjectRequest(CustomerRequestBase):
    action: Literal["create-project"]
    data: CreateProjectData


class ReviseBriefRequest(CustomerRequestBase):
    action: Literal["revise-brief"]
    data: ReviseBriefData


class RecordAgreementRequest(CustomerRequestBase):
    action: Literal["record-agreement"]
    data: RecordAgreementWithRecords


class RequestUpdateRequest(CustomerRequestBase):
    action: Literal["request-update"]
    data: RequestUpdateData


class ReviseRequestRequest(CustomerRequestBase):
    action: Literal["revise-request"]
    data: ReviseRequestData


class AttachIntakeRequest(CustomerRequestBase):
    action: Literal["attach-intake"]
    data: AttachIntakeData


class ReviewWorkRequest(CustomerRequestBase):
    action: Literal["review-work"]
    data: CustomerReviewWorkInput


class PublishDeliveryRequest(CustomerRequestBase):
    action: Literal["publish-delivery"]
    data: PublishDeliveryData


class RecordDeliveryRequest(CustomerRequestBase):
    action: Literal["record-delivery"]
    data: RecordDeliveryWithOriginal


class SetProjectStatusRequest(CustomerRequestBase):
    action: Literal["set-project-status"]
    data: SetProjectStatusData


CustomerUpdateRequest: TypeAlias = Union[CreateProjectRequest, ReviseBriefRequest,
    RecordAgreementRequest, RequestUpdateRequest, ReviseRequestRequest, AttachIntakeRequest,
    ReviewWorkRequest, PublishDeliveryRequest, RecordDeliveryRequest, SetProjectStatusRequest]


class CustomerPreparedRequest(TypedDict):
    schema: Literal["sf88-research-customer-python-prepared/v1"]
    workspaceId: str
    dossierId: str
    request: CustomerUpdateRequest
    sha256: str


class CustomerFile(TypedDict):
    bytes: int
    sha256: str


class CustomerReportFile(CustomerFile):
    format: CustomerReportFormat
    name: str
    contentType: str


class CustomerEdition(TypedDict):
    id: str
    projectId: str
    createdAt: str
    actor: CustomerActor
    revision: int


class CustomerWork(CustomerEdition):
    cycleId: str
    requestEditionId: str
    selection: CustomerWorkSelection
    contextFingerprint: str
    sourceRevision: int
    sourceRevisionSha256: str
    snapshot: CustomerFile
    payloadSha256: str
    summary: str
    counts: dict[str, int]
    changeCounts: dict[Literal["ADDED", "CHANGED", "REMOVED", "UNCHANGED"], int]
    acceptance: list[CustomerAcceptance]
    sha256: str


class CustomerDelivery(CustomerEdition):
    cycleId: str
    workId: str
    workSha256: str
    sourceRevision: int
    requestEditionId: str
    title: str
    coverNote: str
    deliveryNote: str
    files: list[CustomerReportFile]
    sha256: str


class CustomerUpdateOperation(TypedDict):
    schema: Literal["sf88-research-customer-update-operation/v1"]
    id: str
    dossierId: str
    originalRevision: int
    originalRevisionSha256: str
    revision: int
    requestId: str
    requestSha256: str
    action: CustomerAction
    request: CustomerUpdateRequest
    actor: CustomerActor
    createdAt: str
    result: dict[str, Any]
    sha256: str


class CustomerReviewResult(TypedDict):
    dossier: dict[str, Any]
    operation: CustomerUpdateOperation
    duplicate: bool


class CustomerSavedResult(TypedDict):
    schema: Literal["sf88-research-customer-saved-result/v1"]
    workspaceId: str
    dossierId: str
    requestSha256: str
    result: CustomerReviewResult
    completedAt: str
    directory: str
    reused: bool


class CustomerSourceWorkspaceSelection(TypedDict):
    library: str
    actor: str
    requestId: str


class CustomerHandoverSelection(TypedDict):
    workspaceId: str
    dossierId: str
    revision: int
    projectId: str
    delivery: CustomerDelivery
    work: CustomerWork
    sourceWorkspace: CustomerSourceWorkspaceSelection | None


class CustomerHandoverFile(CustomerFile):
    name: str
    kind: Literal["report", "work", "dossier", "europe-pmc"]
    contentType: str


class CustomerFormattedHandoverFile(CustomerHandoverFile, total=False):
    format: CustomerReportFormat


class CustomerHandoverManifest(TypedDict):
    schema: Literal["sf88-research-customer-handover/v1"]
    createdAt: str
    selection: CustomerHandoverSelection
    files: list[CustomerFormattedHandoverFile]


class CustomerReceivingResult(TypedDict):
    schema: Literal["sf88-research-customer-receiving-result/v1"]
    workspaceId: str
    manifestSha256: str
    dossierId: str
    projectId: str
    deliveryId: str
    revision: int
    dossier: dict[str, Any]
    sourceWorkspace: dict[str, Any] | None
    completedAt: str
    directory: str
    reused: bool
