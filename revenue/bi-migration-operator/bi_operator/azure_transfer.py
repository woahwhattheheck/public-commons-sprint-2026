"""Native Azure export transport, manifest interpretation and original-file decoding."""
from __future__ import annotations

import csv
from datetime import date, datetime, timezone
from decimal import Decimal
from email.utils import parsedate_to_datetime
import gzip
import io
import http.client
import json
import os
from pathlib import PurePosixPath
import re
import subprocess
import time
from urllib.parse import parse_qsl, quote, unquote, urlencode, urlsplit, urlunsplit
import urllib.error
import urllib.request
import xml.etree.ElementTree as ET

from .billback import MAX_INPUT, MAX_ROWS
from .providers import environment_name
from .store import encoded

ARM = "https://management.azure.com"
ARM_VERSION = "2025-03-01"
STORAGE_VERSION = "2023-11-03"
CHUNK_BYTES = 4 * 1024 * 1024
MAX_MANIFEST = 4 * 1024 * 1024
MAX_PARTITIONS = 1000
MAX_EXPORT_BYTES = 8 * 1024 * 1024 * 1024


def native_path(value, title="Native blob name"):
    value = str(value or "")
    path = PurePosixPath(value)
    if (not value or len(value) > 2048 or path.is_absolute() or ".." in path.parts
            or "\\" in value or path.as_posix() != value
            or any(ord(c) < 32 for c in value)):
        raise ValueError(title + " must be the exact, relative native path.")
    return value


def scope_path(value):
    value = "/" + str(value or "").strip().strip("/")
    segments = value.split("/")[1:]
    allowed = (value.lower().startswith("/subscriptions/")
        or value.lower().startswith("/providers/microsoft.billing/billingaccounts/")
        or value.lower().startswith("/providers/microsoft.management/managementgroups/"))
    if (not allowed or len(segments) < 2 or any(not s or s in {".", ".."} for s in segments)
            or any(c in value for c in "?#%\\") or any(ord(c) < 32 for c in value)):
        raise ValueError("Select an existing Azure subscription, resource group, billing or management-group scope.")
    return value


def profile_config(request, previous=None):
    old = previous or {}
    value = {key: request.get(key, old.get(key, default)) for key, default in (
        ("label", "Azure monthly cost exports"), ("scope", ""), ("container_url", ""),
        ("prefix", ""), ("credential", "environment"), ("arm_token_env", "AZURE_ARM_ACCESS_TOKEN"),
        ("storage_token_env", "AZURE_STORAGE_ACCESS_TOKEN"), ("storage_sas_env", ""),
        ("subscription", ""), ("api_version", ARM_VERSION), ("local_endpoint", ""))}
    value["label"] = str(value["label"]).strip()[:300] or "Azure monthly cost exports"
    value["scope"] = scope_path(value["scope"])
    if value["credential"] not in {"environment", "azure_cli"}:
        raise ValueError("Use an environment credential reference or the existing Azure CLI login.")
    for key in ("arm_token_env", "storage_token_env"):
        value[key] = environment_name(value[key])
    if value["storage_sas_env"]:
        value["storage_sas_env"] = environment_name(value["storage_sas_env"])
    value["subscription"] = str(value["subscription"]).strip()[:200]
    if not re.fullmatch(r"20\d{2}-\d{2}-\d{2}(?:-preview)?", str(value["api_version"])):
        raise ValueError("Use a published Azure Cost Management API version.")
    endpoint = str(value["local_endpoint"] or "").rstrip("/")
    if endpoint:
        parsed = urlsplit(endpoint)
        if (parsed.scheme != "http" or parsed.hostname not in {"127.0.0.1", "localhost", "::1"}
                or not parsed.port or parsed.path not in {"", "/"} or parsed.query
                or parsed.fragment or parsed.username or parsed.password):
            raise ValueError("A local protocol carrier must be an explicit loopback origin with a port.")
        value["local_endpoint"] = endpoint
    url = urlsplit(str(value["container_url"]).rstrip("/"))
    if endpoint:
        valid = url.scheme + "://" + url.netloc == endpoint and url.path.startswith("/storage/")
    else:
        valid = (url.scheme == "https" and bool(re.fullmatch(r"[a-z0-9]{3,24}\.blob\.core\.windows\.net", url.hostname or ""))
                 and url.port in (None, 443) and len(url.path.strip("/").split("/")) == 1)
    if not valid or url.query or url.fragment or url.username or url.password:
        raise ValueError("Enter the selected HTTPS Azure Blob container URL without a SAS query.")
    native_path(url.path.strip("/"), "Container path")
    value["container_url"] = urlunsplit((url.scheme, url.netloc, url.path.rstrip("/"), "", ""))
    value["prefix"] = str(value["prefix"] or "")
    if value["prefix"]:
        native_path(value["prefix"].rstrip("/"), "Export prefix")
    return value


class AzureError(ValueError):
    def __init__(self, status, code, retry_after=0, request_id=""):
        self.status, self.code = int(status), str(code)[:150]
        self.retry_after, self.request_id = max(0, int(retry_after)), str(request_id)[:200]
        super().__init__("Azure HTTP " + str(status) + ": " + self.code)


class NoRedirect(urllib.request.HTTPRedirectHandler):
    def redirect_request(self, req, fp, code, msg, headers, newurl):
        raise AzureError(code, "UnexpectedRedirect")


def retry_seconds(value):
    if str(value).isdigit():
        return min(86400, int(value))
    try:
        return max(0, min(86400, int(parsedate_to_datetime(value).timestamp() - time.time())))
    except (TypeError, ValueError, OverflowError):
        return 0


class Azure:
    def __init__(self, config):
        self.config = config
        self.arm = config.get("local_endpoint") or ARM
        self.container = config["container_url"]
        self.opener = urllib.request.build_opener(NoRedirect())

    def token(self, audience):
        if self.config.get("local_endpoint"):
            return None
        if self.config["credential"] == "azure_cli":
            resource = ARM + "/" if audience == "arm" else "https://storage.azure.com/"
            command = ["az", "account", "get-access-token", "--resource", resource, "--output", "json"]
            if self.config.get("subscription"):
                command += ["--subscription", self.config["subscription"]]
            try:
                result = subprocess.run(command, check=True, capture_output=True, timeout=30)
                token = json.loads(result.stdout)["accessToken"]
            except (OSError, subprocess.SubprocessError, ValueError, KeyError):
                raise ValueError("The selected Azure CLI login could not return the required audience token.") from None
        else:
            name = self.config["arm_token_env" if audience == "arm" else "storage_token_env"]
            token = os.environ.get(name)
            if not token:
                raise ValueError("Set " + name + " in the operator process environment.")
        if not isinstance(token, str) or "\r" in token or "\n" in token:
            raise ValueError("The configured Azure token is invalid.")
        return token

    def arm_url(self, resource):
        if resource.startswith("https://") or resource.startswith("http://"):
            parsed = urlsplit(resource)
            if parsed.scheme + "://" + parsed.netloc != self.arm or parsed.fragment or parsed.username:
                raise ValueError("The Azure continuation left the selected management endpoint.")
            selected = self.config["scope"].casefold() + "/providers/microsoft.costmanagement/exports"
            path = unquote(parsed.path).casefold()
            if path != selected and not path.startswith(selected + "/"):
                raise ValueError("The Azure continuation left the selected export scope.")
            return resource
        return self.arm + quote(resource, safe="/:-_.()") + "?" + urlencode({"api-version": self.config["api_version"]})

    def blob_url(self, name):
        return self.container + "/" + quote(native_path(name), safe="/")

    def request(self, method, url, audience, body=None, headers=None, maximum=MAX_MANIFEST):
        parsed = urlsplit(url)
        if parsed.username or parsed.password or parsed.fragment:
            raise ValueError("Azure request URLs cannot contain embedded credentials or fragments.")
        if audience == "arm":
            url = self.arm_url(url)
        elif not (url == self.container or url.startswith(self.container + "/") or url.startswith(self.container + "?")):
            raise ValueError("The blob request left the selected container.")
        auth = {}
        if audience == "storage":
            auth["x-ms-version"] = STORAGE_VERSION
            auth["x-ms-date"] = datetime.now(timezone.utc).strftime("%a, %d %b %Y %H:%M:%S GMT")
        sas_name = self.config.get("storage_sas_env") if audience == "storage" else ""
        if sas_name and not self.config.get("local_endpoint"):
            sas = os.environ.get(sas_name, "").lstrip("?")
            if not sas or "#" in sas or any(ord(c) < 32 for c in sas):
                raise ValueError("Set " + sas_name + " to the selected container's SAS query.")
            if not dict(parse_qsl(sas)).get("sig"):
                raise ValueError("The configured storage SAS has no signature.")
            url += ("&" if "?" in url else "?") + sas
        else:
            token = self.token(audience)
            if token:
                auth["Authorization"] = "Bearer " + token
        request = urllib.request.Request(url, method=method,
            data=encoded(body).encode() if body is not None else None,
            headers={"Accept": "application/json" if audience == "arm" else "*/*",
                     "Accept-Encoding": "identity", "Content-Type": "application/json", **auth, **(headers or {})})
        try:
            with self.opener.open(request, timeout=25) as response:
                raw = b"" if method == "HEAD" else response.read(maximum + 1)
                if len(raw) > maximum:
                    raise ValueError("The native response exceeds this operation's complete-file limit.")
                selected = {key.lower(): value for key, value in response.headers.items() if key.lower() in {
                    "etag", "content-length", "content-range", "content-md5", "last-modified",
                    "retry-after", "x-ms-request-id", "x-ms-correlation-request-id", "x-ms-version-id"}}
                return {"status": response.status, "raw": raw, "headers": selected}
        except urllib.error.HTTPError as error:
            raw = error.read(32000)
            code = "RequestFailed"
            try:
                value = json.loads(raw)
                code = value.get("error", value).get("code", code)
            except (ValueError, AttributeError):
                try:
                    code = ET.fromstring(raw).findtext("Code") or code
                except ET.ParseError:
                    pass
            raise AzureError(error.code, code, retry_seconds(error.headers.get("Retry-After", "0")),
                error.headers.get("x-ms-request-id", "")) from None
        except (urllib.error.URLError, TimeoutError, ConnectionError, http.client.HTTPException) as error:
            raise AzureError(0, type(error).__name__) from None

    def json(self, resource, method="GET", body=None):
        result = self.request(method, self.arm_url(resource), "arm", body)
        try:
            result["data"] = json.loads(result["raw"]) if result["raw"] else {}
        except ValueError:
            raise ValueError("Azure returned an invalid JSON document.") from None
        return result

    def list_blobs(self, prefix="", marker=""):
        params = {"restype": "container", "comp": "list", "maxresults": "500", "prefix": prefix}
        if marker:
            params["marker"] = marker
        result = self.request("GET", self.container + "?" + urlencode(params), "storage")
        try:
            root = ET.fromstring(result["raw"])
        except ET.ParseError:
            raise ValueError("Azure returned an invalid blob-list document.") from None
        result["items"] = [{"name": b.findtext("Name"), "bytes": int(b.findtext("Properties/Content-Length", "0")),
            "etag": b.findtext("Properties/Etag"), "modified": b.findtext("Properties/Last-Modified")}
            for b in root.findall("Blobs/Blob")]
        result["next"] = root.findtext("NextMarker") or ""
        return result


def parse_manifest(raw):
    if not raw or len(raw) > MAX_MANIFEST:
        raise ValueError("Select a complete native export manifest of at most 4 MiB.")
    try:
        manifest = json.loads(raw)
    except ValueError:
        raise ValueError("The export manifest is not valid JSON.") from None
    if not isinstance(manifest, dict) or not isinstance(manifest.get("blobs"), list):
        raise ValueError("Select the native Azure partition manifest with its blobs list.")
    if not manifest.get("manifestVersion") or not isinstance(manifest.get("exportConfig"), dict):
        raise ValueError("The native manifest must retain manifestVersion and exportConfig.")
    blobs = manifest["blobs"]
    if len(blobs) > MAX_PARTITIONS:
        raise ValueError("One retained export may contain at most 1000 partitions.")
    names, parts, total = set(), [], 0
    for index, item in enumerate(blobs):
        if not isinstance(item, dict):
            raise ValueError("The manifest contains an invalid partition entry.")
        name = native_path(item.get("blobName"))
        size = item.get("byteCount")
        if name in names or type(size) is not int or not 0 <= size <= MAX_INPUT:
            raise ValueError("Manifest partitions need distinct native names and sizes from 0 through 64 MiB.")
        count = item.get("dataRowCount")
        if count is not None and (type(count) is not int or count < 0):
            raise ValueError("The manifest contains an invalid original row count.")
        names.add(name)
        total += size
        parts.append({"index": index, "name": name, "bytes": size, "rows": count,
                      "received": 0, "chunks": [], "etag": None, "file": None})
    if total > MAX_EXPORT_BYTES or manifest.get("blobCount", len(parts)) != len(parts):
        raise ValueError("The native manifest partition count or export size is invalid.")
    if manifest.get("byteCount", total) != total:
        raise ValueError("The native manifest byte count differs from its complete partition list.")
    if all(part["rows"] is not None for part in parts) and "dataRowCount" in manifest:
        if sum(part["rows"] for part in parts) != manifest["dataRowCount"]:
            raise ValueError("The native manifest's complete row count does not reconcile.")
    delivery = manifest.get("deliveryConfig") or {}
    config = manifest["exportConfig"]
    fmt = str(delivery.get("fileFormat", "Csv")).lower()
    compression = str(delivery.get("compressionMode", "None") or "None").lower()
    if fmt not in {"csv", "parquet"} or compression not in {"none", "gzip", "snappy"}:
        raise ValueError("This export needs native CSV/Parquet and None/Gzip/Snappy format declarations.")
    if (fmt == "csv" and compression == "snappy") or (fmt == "parquet" and compression == "gzip"):
        raise ValueError("The manifest's format and compression declarations do not match Azure exports.")
    return {"manifest_version": manifest["manifestVersion"], "export_config": config,
            "delivery_config": delivery, "run": manifest.get("runInfo") or {}, "parts": parts,
            "bytes": total, "rows": manifest.get("dataRowCount"), "format": fmt, "compression": compression,
            "dataset_type": str(config.get("type", "")), "data_version": str(config.get("dataVersion", ""))}


def scalar(value):
    if value is None:
        return ""
    if isinstance(value, Decimal):
        return format(value, "f")
    if isinstance(value, (date, datetime)):
        return value.isoformat()
    if isinstance(value, (dict, list)):
        return json.dumps(value, ensure_ascii=False, separators=(",", ":"), default=str)
    if isinstance(value, bytes):
        import base64
        return base64.b64encode(value).decode()
    return str(value)


def csv_original(raw, part, source):
    """Return a complete billing-readable CSV while keeping the native file separately."""
    name = part["name"]
    if source["format"] == "csv":
        if source["compression"] == "gzip":
            try:
                with gzip.GzipFile(fileobj=io.BytesIO(raw)) as stream:
                    data = stream.read(MAX_INPUT + 1)
            except (OSError, EOFError):
                raise ValueError("The original Gzip partition is incomplete: " + name) from None
            name = name[:-3] if name.lower().endswith(".gz") else name + ".csv"
        else:
            data = raw
        if not name.lower().endswith(".csv"):
            name += ".csv"
    else:
        try:
            import pyarrow.parquet as pq
        except ImportError:
            raise ValueError("Install pyarrow in this operator environment to decode the selected native Parquet files.") from None
        output = io.StringIO(newline="")
        writer = csv.writer(output, lineterminator="\n")
        parquet = pq.ParquetFile(io.BytesIO(raw))
        if parquet.metadata.num_rows > MAX_ROWS:
            raise ValueError("A decoded partition may contain at most 250000 rows.")
        columns = parquet.schema_arrow.names
        writer.writerow(columns)
        for batch in parquet.iter_batches(batch_size=1000):
            for row in batch.to_pylist():
                writer.writerow([scalar(row.get(column)) for column in columns])
            if output.tell() > MAX_INPUT:
                raise ValueError("The decoded Parquet CSV exceeds 64 MiB.")
        data = output.getvalue().encode("utf-8")
        name = str(PurePosixPath(name).with_suffix(".csv"))
    if len(data) > MAX_INPUT:
        raise ValueError("The complete decoded CSV exceeds 64 MiB: " + name)
    return native_path(name), data


def month_bounds(period):
    year, month = map(int, period.split("-"))
    import calendar
    return {"from": f"{year:04d}-{month:02d}-01T00:00:00Z",
            "to": f"{year:04d}-{month:02d}-{calendar.monthrange(year, month)[1]:02d}T23:59:59Z"}
