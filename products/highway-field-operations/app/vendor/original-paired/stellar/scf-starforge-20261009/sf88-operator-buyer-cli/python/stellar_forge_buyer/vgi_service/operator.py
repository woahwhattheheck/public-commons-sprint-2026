"""Optional result-service routes on the original DuckDB private operator."""
from __future__ import annotations

from importlib import resources
from urllib.parse import unquote

from ..errors import StateError
from .model import VgiService
from .runtime import HTTPRuntime, runtime_info


def _fields(body, required=(), optional=()):
    if (not isinstance(body, dict) or set(body) - set(required) - set(optional)
            or any(name not in body for name in required)):
        raise StateError("VGI_OPERATOR_FIELDS_INVALID")
    return body


class VgiOperator:
    """Compose publication and the vendor listener with the original operator."""

    def __init__(self, operator, *, export_locations=None):
        self.original = operator
        self.service = VgiService(operator.workspace,
                                  export_locations=export_locations or {})
        self.runtime = HTTPRuntime(self.service)
        root = resources.files(__package__).joinpath("public")
        self.installed_runtime = runtime_info()
        self._assets = {
            "/vgi/": (root.joinpath("index.html").read_text(encoding="utf-8"),
                      "text/html;charset=utf-8"),
            "/vgi/app.mjs": (root.joinpath("app.mjs").read_text(encoding="utf-8"),
                            "text/javascript;charset=utf-8"),
            "/vgi/style.css": (root.joinpath("style.css").read_text(encoding="utf-8"),
                              "text/css;charset=utf-8"),
        }

    def assets(self):
        return self._assets

    def state(self):
        with self.original.mutex:
            value = self.service.state()
            return dict(value, runtime=self.runtime.state(),
                        installed_runtime=self.installed_runtime,
                        buyer=self.original.state())

    def read(self, path, parameters):
        with self.original.mutex:
            if path == "/api/vgi/history":
                if set(parameters) - {"before", "limit"}:
                    raise StateError("VGI_OPERATOR_PARAMETERS_INVALID")
                return self.service.history(
                    before=int(parameters["before"][0]) if "before" in parameters else None,
                    limit=int(parameters.get("limit", ["100"])[0]))
            if parameters:
                raise StateError("VGI_OPERATOR_PARAMETERS_INVALID")
            prefix = "/api/vgi/operations/"
            if path.startswith(prefix) and "/" not in path[len(prefix):]:
                return self.service.operation(unquote(path[len(prefix):]))
            if path == "/api/vgi/state":
                return self.state()
            if path == "/api/vgi/runtime":
                return self.runtime.state()
            prefix = "/api/vgi/publications/"
            if path.startswith(prefix) and "/" not in path[len(prefix):]:
                return self.service.publication(unquote(path[len(prefix):]))
            raise StateError("VGI_OPERATOR_ROUTE_NOT_FOUND")

    def perform(self, path, body):
        with self.original.mutex:
            if path == "/api/vgi/review":
                _fields(body, ("export_id",), ("batch_rows",))
                return self.service.review_export(body["export_id"], batch_rows=body.get("batch_rows", 4096))
            if path == "/api/vgi/configure":
                _fields(body, ("request_id", "expected_revision", "configuration"))
                return self.service.configure(body)
            if path == "/api/vgi/publish":
                _fields(body, ("request_id", "table_name", "export_id",
                               "review_sha256", "expected_head_revision"))
                return self.service.publish(body)
            if path == "/api/vgi/activate":
                _fields(body, ("request_id", "table_name", "publication_id",
                               "expected_head_revision", "active"))
                return self.service.activate(body)
            if path == "/api/vgi/start":
                _fields(body, ("request_id", "expected_revision"), ("host", "port"))
                return self.runtime.start(**body)
            if path == "/api/vgi/stop":
                _fields(body, ("request_id",))
                return self.runtime.stop(request_id=body["request_id"])
            raise StateError("VGI_OPERATOR_ROUTE_NOT_FOUND")

    def close(self):
        self.runtime.close()
