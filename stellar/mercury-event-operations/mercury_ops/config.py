"""Private, explicit configuration for the Mercury customer event service."""
from __future__ import annotations

import base64
import json
import math
import os
from pathlib import Path
import re
import secrets
import stat
from dataclasses import dataclass, field
from typing import Any
from urllib.parse import urlsplit


ENV_NAME = re.compile(r"^[A-Za-z_][A-Za-z0-9_]*$")
CONTRACT_ID = re.compile(r"^C[A-Z2-7]{55}$")
SCOPE = re.compile(r"^[A-Za-z0-9][A-Za-z0-9._-]{0,99}$")
DEFAULT_API_BASE = "https://mainnet.mercurydata.app/rest"
DEFAULT_API_BASES = {"mainnet": DEFAULT_API_BASE, "testnet": "https://testnet.mercurydata.app/rest"}


def checked_url(value: str, *, allow_local_http: bool = False) -> str:
    """Configuration accepts HTTPS, or an explicitly selected loopback service."""
    if not isinstance(value, str) or not value:
        raise ValueError("A service URL is required")
    parsed = urlsplit(value)
    try:
        parsed.port
    except ValueError as exc:
        raise ValueError("Service URL has an invalid port") from exc
    if not parsed.hostname or parsed.username or parsed.password or parsed.fragment or parsed.query:
        raise ValueError("Service URL must have a host and no credentials, query or fragment")
    if parsed.scheme != "https":
        if not (allow_local_http and parsed.scheme == "http" and parsed.hostname in {"127.0.0.1", "::1", "localhost"}):
            raise ValueError("Use HTTPS; local HTTP requires allow_local_http and a loopback host")
    if any(ord(c) < 33 for c in value):
        raise ValueError("Service URL contains whitespace or control characters")
    return value.rstrip("/")


def _env_name(value: Any, label: str) -> str:
    if not isinstance(value, str) or not ENV_NAME.fullmatch(value):
        raise ValueError(f"{label} must name an environment variable")
    return value


def _number(data: dict, key: str, default: float, low: float, high: float) -> float:
    value = data.get(key, default)
    if isinstance(value, bool) or not isinstance(value, (int, float)) or not math.isfinite(value) or not low <= value <= high:
        raise ValueError(f"{key} must be between {low:g} and {high:g}")
    return float(value)


def _integer(data: dict, key: str, default: int, low: int, high: int) -> int:
    value = data.get(key, default)
    if isinstance(value, bool) or not isinstance(value, int) or not low <= value <= high:
        raise ValueError(f"{key} must be an integer between {low} and {high}")
    return value


def load_private_env(path: str | Path) -> None:
    """Read a deliberately selected private NAME=value file without shell evaluation."""
    path = Path(path)
    fd = os.open(path, os.O_RDONLY | getattr(os, "O_NOFOLLOW", 0))
    try:
        info = os.fstat(fd)
        if not stat.S_ISREG(info.st_mode) or info.st_mode & 0o077:
            raise ValueError("The environment file must be a regular private file (chmod 600)")
        if info.st_size > 65536:
            raise ValueError("Environment file is too large")
        with os.fdopen(fd, "r", encoding="utf-8") as stream:
            fd = -1
            text = stream.read(65537)
        additions: dict[str, str] = {}
        for line in text.splitlines():
            if not line.strip() or line.lstrip().startswith("#"):
                continue
            name, sep, value = line.partition("=")
            if not sep or not ENV_NAME.fullmatch(name):
                raise ValueError("Environment entries must use NAME=value without shell syntax")
            if name in additions:
                raise ValueError("Environment file repeats a variable")
            if any(ord(c) < 32 for c in value):
                raise ValueError("Environment values contain a control character")
            additions[name] = value
        for name, value in additions.items():
            os.environ.setdefault(name, value)
    finally:
        if fd >= 0:
            os.close(fd)


@dataclass(frozen=True)
class Config:
    workspace: Path
    network: str
    provider_scope: str
    api_base: str
    contracts: tuple[str, ...]
    destination: dict[str, Any]
    provider_token_env: str = "MERCURY_JWT"
    webhook_secret_env: str = "MERCURY_WEBHOOK_SECRET"
    operator_token_env: str = "MERCURY_OPS_TOKEN"
    page_size: int = 100
    request_timeout_seconds: float = 10
    retry_base_seconds: float = 5
    retry_max_seconds: float = 300
    max_attempts: int = 10
    worker_poll_seconds: float = 1
    max_body_bytes: int = 1048576
    allow_local_http: bool = False
    topic_filters: dict[str, str] = field(default_factory=dict)

    def provider_token(self) -> str:
        return os.environ.get(self.provider_token_env, "")

    def webhook_secret(self) -> str:
        return os.environ.get(self.webhook_secret_env, "")

    def operator_token(self) -> str:
        return os.environ.get(self.operator_token_env, "")

    def public_dict(self) -> dict[str, Any]:
        destination = {key: self.destination[key] for key in ("kind", "url", "path", "schema", "table", "idempotency_supported") if key in self.destination}
        return {
            "network": self.network, "provider_scope": self.provider_scope,
            "api_base": self.api_base, "contracts": list(self.contracts), "topic_filters": dict(self.topic_filters),
            "destination": destination, "page_size": self.page_size,
            "provider_ready": bool(self.provider_token() and self.contracts),
            "webhook_ready": bool(self.webhook_secret() and self.contracts),
            "operator_ready": bool(self.operator_token()),
            "credential_variables": {"provider": self.provider_token_env,
                "webhook": self.webhook_secret_env, "operator": self.operator_token_env},
            "request_timeout_seconds": self.request_timeout_seconds,
            "max_attempts": self.max_attempts,
        }


def load_config(path: str | Path, env_file: str | Path | None = None) -> Config:
    path = Path(path).resolve()
    if env_file is not None:
        load_private_env(env_file)
    if path.stat().st_size > 262144:
        raise ValueError("Configuration file is too large")
    data = json.loads(path.read_text(encoding="utf-8"))
    if not isinstance(data, dict) or data.get("schema", "mercury-event-operations/v1") != "mercury-event-operations/v1":
        raise ValueError("Unsupported configuration schema")
    allowed = {field for field in Config.__dataclass_fields__} | {"schema"}
    unknown = set(data) - allowed
    if unknown:
        raise ValueError("Unknown configuration keys: " + ", ".join(sorted(unknown)))
    workspace_value = data.get("workspace", ".")
    if not isinstance(workspace_value, str) or not workspace_value:
        raise ValueError("workspace must be a path")
    workspace = (path.parent / workspace_value).resolve()
    workspace.mkdir(parents=True, exist_ok=True, mode=0o700)
    network = data.get("network", "mainnet")
    scope = data.get("provider_scope", "customer-primary")
    if not isinstance(network, str) or not SCOPE.fullmatch(network) or not isinstance(scope, str) or not SCOPE.fullmatch(scope):
        raise ValueError("network and provider_scope must be stable nonsecret labels")
    local_http = data.get("allow_local_http", False)
    if not isinstance(local_http, bool):
        raise ValueError("allow_local_http must be a boolean")
    base = checked_url(data.get("api_base", DEFAULT_API_BASES.get(network)), allow_local_http=local_http)
    contracts = data.get("contracts", [])
    if not isinstance(contracts, list) or len(contracts) > 1000 or any(not isinstance(c, str) or not CONTRACT_ID.fullmatch(c) for c in contracts):
        raise ValueError("contracts must contain Stellar contract C-addresses")
    if len(set(contracts)) != len(contracts):
        raise ValueError("contracts contains duplicate addresses")
    topic_filters = data.get("topic_filters", {})
    if not isinstance(topic_filters, dict) or len(topic_filters) > 10:
        raise ValueError("topic_filters must map topic1 through topic10 to exact XDR-base64 values")
    for key, value in topic_filters.items():
        if not re.fullmatch(r"topic(?:[1-9]|10)", key) or not isinstance(value, str):
            raise ValueError("topic_filters must map topic1 through topic10 to exact XDR-base64 values")
        try:
            decoded = base64.b64decode(value, validate=True)
        except ValueError:
            raise ValueError("Topic filter is not valid XDR-base64") from None
        if len(decoded) < 4 or len(decoded) % 4:
            raise ValueError("Topic filter must contain an aligned XDR value")
    destination = data.get("destination", {"kind": "sqlite", "path": "customer-events.sqlite", "table": "mercury_events"})
    if not isinstance(destination, dict):
        raise ValueError("destination must be an object")
    destination = dict(destination)
    kind = destination.get("kind")
    if kind == "sqlite":
        if set(destination) - {"kind", "path", "table"}:
            raise ValueError("Unsupported SQLite destination options")
        if not isinstance(destination.get("path"), str) or not destination["path"]:
            raise ValueError("SQLite destination requires a path")
        if (workspace / destination["path"]).resolve() == workspace / "mercury_ops.sqlite3":
            raise ValueError("The customer destination must be separate from the provider operations database")
        table = destination.setdefault("table", "mercury_events")
        if not isinstance(table, str) or not re.fullmatch(r"[A-Za-z][A-Za-z0-9_]{0,62}", table):
            raise ValueError("SQLite table must be a simple identifier")
    elif kind == "http":
        if set(destination) - {"kind", "url", "token_env", "hmac_secret_env", "idempotency_supported"}:
            raise ValueError("Unsupported HTTP destination options")
        destination["url"] = checked_url(destination.get("url"), allow_local_http=local_http)
        for key in ("token_env", "hmac_secret_env"):
            if key in destination:
                _env_name(destination[key], key)
        if not isinstance(destination.get("idempotency_supported", False), bool):
            raise ValueError("idempotency_supported must be a boolean")
        destination.setdefault("idempotency_supported", False)
    elif kind == "postgres":
        if set(destination) - {"kind", "dsn_env", "schema", "table"}:
            raise ValueError("Unsupported PostgreSQL destination options")
        destination["dsn_env"] = _env_name(destination.get("dsn_env", "MERCURY_CUSTOMER_DATABASE_URL"), "dsn_env")
        for key, default in (("schema", "public"), ("table", "mercury_events")):
            value = destination.setdefault(key, default)
            if not isinstance(value, str) or not re.fullmatch(r"[A-Za-z][A-Za-z0-9_]{0,62}", value):
                raise ValueError("PostgreSQL schema and table must be simple identifiers")
    else:
        raise ValueError("destination.kind must be sqlite, http or postgres")
    kwargs = {
        "workspace": workspace, "network": network, "provider_scope": scope,
        "api_base": base, "contracts": tuple(contracts), "destination": destination,
        "allow_local_http": local_http, "topic_filters": dict(topic_filters),
    }
    for key, default in (("provider_token_env", "MERCURY_JWT"), ("webhook_secret_env", "MERCURY_WEBHOOK_SECRET"), ("operator_token_env", "MERCURY_OPS_TOKEN")):
        kwargs[key] = _env_name(data.get(key, default), key)
    for key, default, low, high in (("page_size", 100, 1, 1000), ("max_attempts", 10, 1, 100), ("max_body_bytes", 1048576, 1024, 16777216)):
        kwargs[key] = _integer(data, key, default, low, high)
    for key, default, low, high in (("request_timeout_seconds", 10, 1, 120), ("retry_base_seconds", 5, 0.1, 3600), ("retry_max_seconds", 300, 1, 86400), ("worker_poll_seconds", 1, 0.1, 60)):
        kwargs[key] = _number(data, key, default, low, high)
    if kwargs["retry_base_seconds"] > kwargs["retry_max_seconds"]:
        raise ValueError("retry_base_seconds must not exceed retry_max_seconds")
    return Config(**kwargs)


def _new_private_file(path: Path, data: bytes) -> None:
    fd = os.open(path, os.O_WRONLY | os.O_CREAT | os.O_EXCL | getattr(os, "O_NOFOLLOW", 0), 0o600)
    try:
        with os.fdopen(fd, "wb") as stream:
            fd = -1
            stream.write(data)
            stream.flush()
            os.fsync(stream.fileno())
    finally:
        if fd >= 0:
            os.close(fd)


def initialize_workspace(path: str | Path, network: str = "mainnet") -> dict[str, str]:
    workspace = Path(path).resolve()
    workspace.mkdir(parents=True, exist_ok=True, mode=0o700)
    config_path = workspace / "config.json"
    env_path = workspace / "secrets.env"
    if config_path.exists() or env_path.exists():
        raise FileExistsError("Workspace already contains configuration; reopen it with serve")
    if network not in DEFAULT_API_BASES:
        raise ValueError("Initialize mainnet or testnet; custom provider networks can be configured explicitly afterward")
    token = secrets.token_urlsafe(32)
    data = {"schema": "mercury-event-operations/v1", "workspace": ".",
        "network": network, "provider_scope": "customer-primary", "api_base": DEFAULT_API_BASES[network],
        "contracts": [], "destination": {"kind": "sqlite", "path": "customer-events.sqlite", "table": "mercury_events"}}
    _new_private_file(env_path, ("# Values are literal; do not add shell quotes.\nMERCURY_OPS_TOKEN=" + token + "\nMERCURY_JWT=\nMERCURY_WEBHOOK_SECRET=\n").encode())
    try:
        _new_private_file(config_path, (json.dumps(data, indent=2) + "\n").encode())
    except BaseException:
        env_path.unlink(missing_ok=True)
        raise
    return {"config_path": str(config_path), "env_path": str(env_path), "operator_token": token}
