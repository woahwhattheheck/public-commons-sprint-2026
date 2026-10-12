from os import PathLike
from typing import Any, Literal, Mapping, TypedDict

ChannelAction = Literal[
    "task-template", "task-save", "task-authorize", "task-authority-resume", "task-stop",
    "purchase-prepare", "purchase-execute", "purchase-resume", "purchase-refresh", "purchase-cancel",
    "merchant-save", "merchant-start", "merchant-stop", "delivery-recover",
    "close-prepare", "close-execute", "close-resume", "close-reconcile", "close-cancel",
    "funder-template", "funder-save", "channel-observe", "funding-prepare", "funding-execute", "funding-resume", "funding-reconcile", "funding-cancel", "collection-prepare", "collection-execute", "collection-resume", "collection-reconcile", "collection-cancel",
    "contract-fetch", "export", "receive",
]
RecordKind = Literal["tasks", "purchases", "contracts", "funders", "funding", "settlements", "observations"]
FundingAction = Literal["top_up", "close_start", "refund"]

class _FundingSelection(TypedDict):
    stream: str
    fundingId: str
    action: FundingAction

class FundingInput(_FundingSelection, total=False):
    amountAtomic: str

class CollectionInput(TypedDict):
    stream: str
    settlementId: str

PathInput = str | PathLike[str]

class _RequiredRequest(TypedDict):
    url: str
    method: Literal["GET", "POST"]

class ChannelRequest(_RequiredRequest, total=False):
    json: Any

class WorkItem(TypedDict):
    taskId: str
    purchaseId: str
    request: ChannelRequest

class WorkList(TypedDict):
    schema: Literal["stellar-forge.mpp-channel-work.v1"]
    purchases: list[WorkItem]

class FileIdentity(TypedDict):
    path: str
    bytes: int
    sha256: str

class ReceivedFile(FileIdentity, total=False):
    schema: str
    kind: Literal["response", "handover"]
    recordPath: str
    workspace: str
    workspaceCreatedAt: str
    purchaseId: str
    taskId: str
    profileId: str
    source: dict[str, Any] | None
    channel: dict[str, Any] | None
    amountAtomic: str | None
    receipt: dict[str, Any] | None
    contentType: str
    status: int
    bundleSha256: str
    handoverId: str
    sourceWorkspace: dict[str, Any]
    versions: dict[str, str]
    records: int
    sourceFiles: int
    inputFiles: int

class WorkFileResult(TypedDict, total=False):
    schema: str
    state: str
    completedPurchases: int
    workSha256: str
    file: FileIdentity
    job: dict[str, Any]
    purchaseId: str
    purchase: dict[str, Any]

SCHEMA: str
ACTIONS: frozenset[str]

class ChannelError(RuntimeError):
    code: str
    native: dict[str, Any]
    method: str | None
    request_id: str | None
    operation_ids: dict[str, str]
    job_id: str | None
    uncertain: bool
    original_result: dict[str, Any] | None
    def __init__(
        self, code: str, message: str, *, native: Mapping[str, Any] | None = ...,
        method: str | None = ..., request_id: str | None = ...,
        operation_ids: Mapping[str, str] | None = ..., uncertain: bool = ...,
    ) -> None: ...
    def as_dict(self) -> dict[str, Any]: ...

class ChannelClient:
    product: str
    timeout: float
    connected_identity: dict[str, Any]
    def __init__(
        self, product: PathInput, *, node: str = ...,
        timeout: float = ..., start_timeout: float = ...,
    ) -> None: ...
    @property
    def closed(self) -> bool: ...
    @property
    def stderr_tail(self) -> str: ...
    def call(self, method: str, value: Mapping[str, Any] | None = ..., *, timeout: float | None = ...) -> Any: ...
    def identity(self) -> dict[str, Any]: ...
    def state(self) -> dict[str, Any]: ...
    def record(self, kind: RecordKind, identifier: str) -> dict[str, Any]: ...
    def task(self, task_id: str) -> dict[str, Any]: ...
    def purchase(self, purchase_id: str) -> dict[str, Any]: ...
    def contract(self, profile_id: str) -> dict[str, Any]: ...
    def job(self, job_id: str) -> dict[str, Any]: ...
    def invoke(
        self, action: ChannelAction, arguments: Mapping[str, Any] | None = ..., *,
        wait_ms: int = ..., timeout: float | None = ...,
    ) -> dict[str, Any]: ...
    def prepare_purchase(
        self, task_id: str, purchase_id: str, request: ChannelRequest, *,
        wait_ms: int = ..., timeout: float | None = ...,
    ) -> dict[str, Any]: ...
    def execute_purchase(
        self, purchase_id: str, *, wait_ms: int = ..., timeout: float | None = ...,
    ) -> dict[str, Any]: ...
    def resume_purchase(
        self, purchase_id: str, *, wait_ms: int = ..., timeout: float | None = ...,
    ) -> dict[str, Any]: ...
    def run_purchases(
        self, document: WorkList | Mapping[str, Any], *, result_path: PathInput | None = ...,
        wait_ms: int = ..., timeout: float = ...,
    ) -> dict[str, Any]: ...
    def run_file(
        self, file: PathInput, *, result_path: PathInput,
        wait_ms: int = ..., timeout: float = ...,
    ) -> WorkFileResult: ...
    def receive_response(
        self, purchase_id: str, path: PathInput, *,
        expected_sha256: str | None = ..., timeout: float | None = ...,
    ) -> ReceivedFile: ...
    def receive_handover(
        self, bundle_sha256: str, path: PathInput, *,
        expected_file_sha256: str | None = ..., timeout: float | None = ...,
    ) -> ReceivedFile: ...
    def receive_channel(
        self, file: PathInput, dependency_root: PathInput, *,
        wait_ms: int = ..., timeout: float | None = ...,
    ) -> dict[str, Any]: ...
    def close(self) -> None: ...
    def __enter__(self) -> ChannelClient: ...
    def __exit__(self, exc_type: Any, exc_value: Any, traceback: Any) -> None: ...
