"""MIT. Native Stellar MPP customer; the installed Node buyer owns payment and recovery."""
from __future__ import annotations

import base64
import hashlib
import json
import os
from pathlib import Path
import shutil
import subprocess
from typing import Any, Mapping

_ROOT = Path(__file__).resolve().parent
_MAX_INPUT = 4 * 1024 * 1024
_MAX_OUTPUT = 6 * 1024 * 1024


class CustomerError(RuntimeError):
    def __init__(self, code: str, purchase_id: str | None = None):
        self.code = code
        self.purchase_id = purchase_id
        super().__init__(code)


class Result:
    def __init__(self, value: Mapping[str, Any]):
        self._value = dict(value)
        self.status = value["status"]
        self.headers = dict(value["headers"])
        self.receipt = dict(value["receipt"])
        self.transaction = value["transaction"]
        self.accounting = dict(value["accounting"])
        self.contract_sha256 = value["contractSha256"]
        self.offer_id = value["offerId"]
        try:
            self._body = base64.b64decode(value["bodyBase64"], validate=True)
        except (ValueError, TypeError) as exc:
            raise CustomerError("MPP_CUSTOMER_RESPONSE_CHANGED") from exc
        if len(self._body) != value["bytes"] or hashlib.sha256(self._body).hexdigest() != value["sha256"]:
            raise CustomerError("MPP_CUSTOMER_RESPONSE_CHANGED")
        self.sha256 = value["sha256"]

    def bytes(self) -> bytes:
        return bytes(self._body)

    def text(self, encoding: str = "utf-8") -> str:
        return self._body.decode(encoding)

    def json(self) -> Any:
        return json.loads(self.text())


class Purchase:
    def __init__(self, customer: "Customer", purchase_id: str):
        self.customer = customer
        self.id = purchase_id

    def inspect(self) -> dict[str, Any]:
        return self.customer._call("inspect", purchaseId=self.id)

    def execute(self) -> dict[str, Any]:
        return self.customer._call("execute", purchaseId=self.id)

    def resume(self) -> dict[str, Any]:
        return self.customer._call("resume", purchaseId=self.id)

    def finalize(self) -> dict[str, Any]:
        return self.customer._call("finalize", purchaseId=self.id)

    def result(self) -> Result:
        return Result(self.customer._call("result", purchaseId=self.id))

    def save(self, destination: str | os.PathLike[str]) -> dict[str, Any]:
        return self.customer._call("save", purchaseId=self.id, destination=str(Path(destination).absolute()))


class Customer:
    def __init__(self, configuration: Mapping[str, Any] | str | os.PathLike[str], *,
                 node: str | os.PathLike[str] | None = None, timeout_seconds: int = 900):
        if isinstance(configuration, (str, os.PathLike)):
            configuration = json.loads(Path(configuration).read_text(encoding="utf-8"))
        self.configuration = json.loads(json.dumps(dict(configuration)))
        self.contract = json.loads((_ROOT / "merchant-contract.json").read_text(encoding="utf-8"))
        self.contract_sha256 = self.contract["sha256"]
        if not isinstance(self.contract_sha256, str) or len(self.contract_sha256) != 64:
            raise CustomerError("MPP_CUSTOMER_CONTRACT_INVALID")
        executable = str(node) if node is not None else shutil.which("node")
        if not executable or not Path(executable).is_absolute():
            raise CustomerError("MPP_CUSTOMER_NODE_REQUIRED")
        self.node = executable
        if type(timeout_seconds) is not int or not 1 <= timeout_seconds <= 1200:
            raise CustomerError("MPP_CUSTOMER_TIMEOUT_INVALID")
        self.timeout_seconds = timeout_seconds

    def _call(self, operation: str, **values: Any) -> Any:
        options = values.get("options")
        retained_id = values.get("purchaseId") or (options.get("purchaseId") if isinstance(options, dict) else None)
        payload = json.dumps({
            "operation": operation, "configuration": self.configuration,
            "contractSha256": self.contract_sha256, **values,
        }, separators=(",", ":")).encode("utf-8")
        if len(payload) > _MAX_INPUT:
            raise CustomerError("MPP_CUSTOMER_INPUT_TOO_LARGE", retained_id)
        try:
            result = subprocess.run(
                [self.node, str(_ROOT / "merchant-client-bridge.mjs")],
                input=payload, stdout=subprocess.PIPE, stderr=subprocess.PIPE,
                cwd=_ROOT, timeout=self.timeout_seconds, check=False,
            )
        except subprocess.TimeoutExpired as exc:
            raise CustomerError("MPP_CUSTOMER_OPERATION_INTERRUPTED", retained_id) from exc
        if result.returncode:
            try:
                failure = json.loads(result.stderr.decode("utf-8"))
                code = failure["code"]
                if not isinstance(code, str):
                    raise ValueError("Invalid code")
            except (ValueError, KeyError, UnicodeError):
                code = "MPP_CUSTOMER_CALL_FAILED"
            raise CustomerError(code, retained_id)
        if len(result.stdout) > _MAX_OUTPUT:
            raise CustomerError("MPP_CUSTOMER_OUTPUT_TOO_LARGE", retained_id)
        try:
            reply = json.loads(result.stdout.decode("utf-8"))
        except (ValueError, UnicodeError) as exc:
            raise CustomerError("MPP_CUSTOMER_REPLY_INVALID", retained_id) from exc
        if (reply.get("schema") != "stellar-forge.mpp-customer-bridge.v1"
                or reply.get("contractSha256") != self.contract_sha256
                or reply.get("operation") != operation):
            raise CustomerError("MPP_CUSTOMER_REPLY_CHANGED", retained_id)
        return reply["value"]

    def initialize(self) -> dict[str, Any]:
        return self._call("init")

    def prepare(self, offer_id: str, *, purchase_id: str,
                query: Mapping[str, str | list[str]] | None = None,
                json_body: Any = ..., challenge_id: str | None = None) -> Purchase:
        options: dict[str, Any] = {"purchaseId": purchase_id}
        if query is not None:
            options["query"] = dict(query)
        if json_body is not ...:
            options["json"] = json_body
        if challenge_id is not None:
            options["challengeId"] = challenge_id
        self._call("prepare", offerId=offer_id, options=options)
        return Purchase(self, purchase_id)

    def purchase(self, purchase_id: str) -> Purchase:
        return Purchase(self, purchase_id)

    def list(self, *, offset: int = 0, limit: int = 50) -> dict[str, Any]:
        return self._call("list", options={"offset": offset, "limit": limit})

    def refresh(self) -> dict[str, Any]:
        return self._call("refresh")
