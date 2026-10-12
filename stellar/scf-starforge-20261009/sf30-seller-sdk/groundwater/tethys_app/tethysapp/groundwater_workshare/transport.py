"""Bounded Django transport over the original groundwater Workbench API."""
from functools import wraps
import hashlib
import json
import logging
import os
from pathlib import Path
import re
import stat

from django.http import FileResponse, HttpResponse
from django.views.decorators.csrf import csrf_protect
from django.utils.cache import patch_vary_headers

from groundwater_workspace import Workbench
from groundwater_workspace.common import Problem, json_text

from .policy import (
    PortalProblem, bind_workspace, context_for_request, require_permission,
    require_user, require_portal_binding,
)

LOGGER = logging.getLogger(__name__)
SHA256 = re.compile(r"[0-9a-f]{64}\Z")


def secure_response(response):
    response["Cache-Control"] = "private, no-store"
    response["Pragma"] = "no-cache"
    response["X-Content-Type-Options"] = "nosniff"
    response["Referrer-Policy"] = "same-origin"
    response["Cross-Origin-Resource-Policy"] = "same-origin"
    patch_vary_headers(response, ("Cookie",))
    return response


def json_response(value, status=200):
    return secure_response(HttpResponse(json_text(value), status=status, content_type="application/json; charset=utf-8"))


def problem_response(problem):
    return json_response({"error": problem.as_dict()}, status=problem.status)


def _pairs(items):
    result = {}
    for key, value in items:
        if key in result:
            raise PortalProblem("portal_duplicate_json_key", "A JSON object contains a repeated key.", key=key)
        result[key] = value
    return result


def _constant(value):
    raise PortalProblem("portal_nonfinite_json", "JSON must not contain NaN or Infinity.")


def read_json(request, max_bytes):
    if request.content_type != "application/json":
        raise PortalProblem("portal_json_required", "Send this action as application/json.", 415)
    content_length = request.META.get("CONTENT_LENGTH", "")
    if content_length:
        try:
            length = int(content_length)
        except ValueError:
            raise PortalProblem("portal_content_length_invalid", "Content-Length is invalid.")
        if length < 0 or length > max_bytes:
            raise PortalProblem("portal_request_too_large", "The action exceeds this portal's configured request limit.", 413, max_bytes=max_bytes)
    chunks, total = [], 0
    # Read the request stream with our explicit bound. Never save source uploads in
    # a second portal file store or in a Django model.
    while True:
        chunk = request.read(min(65536, max_bytes + 1 - total))
        if not chunk:
            break
        total += len(chunk)
        if total > max_bytes:
            raise PortalProblem("portal_request_too_large", "The action exceeds this portal's configured request limit.", 413, max_bytes=max_bytes)
        chunks.append(chunk)
    try:
        value = json.loads(
            b"".join(chunks).decode("utf-8"), object_pairs_hook=_pairs,
            parse_constant=_constant,
        )
    except (UnicodeError, json.JSONDecodeError, RecursionError):
        raise PortalProblem("portal_json_invalid", "The action must contain one valid UTF-8 JSON object.")
    if not isinstance(value, dict):
        raise PortalProblem("portal_json_invalid", "The action must contain one JSON object.")
    return value


def query_value(request, name, *, required=False, maximum=8192):
    values = request.GET.getlist(name)
    if len(values) > 1:
        raise PortalProblem("portal_query_repeated", "A query field is repeated.", field=name)
    value = values[0] if values else None
    if value is None or value == "":
        if required:
            raise PortalProblem("portal_query_required", "A required query field is missing.", field=name)
        return None
    if len(value) > maximum:
        raise PortalProblem("portal_query_too_long", "A query field is too long.", field=name)
    return value


def endpoint(*, methods=("GET", "HEAD"), permission="view_workspace", bound=True):
    """Use existing portal identity/permissions; native methods retain operations."""
    def decorate(function):
        @wraps(function)
        def wrapped(request, *args, **kwargs):
            try:
                require_user(request)  # Also enforced if Tethys OPEN_PORTAL_MODE is enabled.
                require_permission(request, "view_workspace")
                if permission != "view_workspace":
                    require_permission(request, permission)
                if request.method not in methods:
                    response = problem_response(PortalProblem(
                        "portal_method_not_allowed", "This endpoint does not accept that HTTP method.", 405,
                    ))
                    response["Allow"] = ", ".join(methods)
                    return response
                if not bound:
                    return secure_response(function(request, *args, **kwargs))
                context = context_for_request(request, kwargs["slot"])
                require_portal_binding(context, request.user, kwargs["portal_id"])
                context.require_existing()  # Never initialize a replacement for a broken bound URL.
                with Workbench(context.workspace, existing_only=True) as workbench:
                    bind_workspace(workbench, kwargs["workspace_id"])
                    return secure_response(function(request, workbench, context, *args, **kwargs))
            except (PortalProblem, Problem) as error:
                return problem_response(error)
            except Exception:
                LOGGER.exception("Groundwater portal request failed")
                return problem_response(PortalProblem(
                    "portal_request_failed",
                    "The portal request failed. Read the same original operation ID before resubmitting an action.",
                    500,
                ))
        return csrf_protect(wrapped) if "POST" in methods else wrapped
    return decorate


def _file_identity(info):
    return (info.st_dev, info.st_ino, info.st_size, info.st_mtime_ns, info.st_ctime_ns)


def verified_open(descriptor):
    """Bind the verified domain descriptor to the held original file descriptor."""
    try:
        path = Path(descriptor["path"])
        size, expected = descriptor["bytes"], descriptor["sha256"]
        if not path.is_absolute() or type(size) is not int or size < 0 or not SHA256.fullmatch(expected):
            raise ValueError("invalid native descriptor")
    except (KeyError, TypeError, ValueError):
        raise PortalProblem("portal_file_descriptor_invalid", "The native file descriptor is invalid.", 500)
    flags = os.O_RDONLY | getattr(os, "O_CLOEXEC", 0) | getattr(os, "O_NOFOLLOW", 0)
    try:
        fd = os.open(path, flags)
    except OSError:
        raise PortalProblem("portal_file_unavailable", "The original native file is unavailable.", 409)
    held = None
    try:
        before = os.fstat(fd)
        if not stat.S_ISREG(before.st_mode) or before.st_size != size:
            raise PortalProblem("portal_file_changed", "The original native file's size or type changed.", 409)
        held = os.fdopen(fd, "rb")
        fd = None
        digest = hashlib.sha256()
        total = 0
        while True:
            chunk = held.read(1024 * 1024)
            if not chunk:
                break
            total += len(chunk)
            if total > size:
                raise PortalProblem("portal_file_changed", "The original native file grew during verification.", 409)
            digest.update(chunk)
        after = os.fstat(held.fileno())
        if (
            total != size or digest.hexdigest() != expected
            or _file_identity(before) != _file_identity(after)
        ):
            raise PortalProblem("portal_file_changed", "The original native file no longer matches its retained identity.", 409)
        held.seek(0)
        return held
    except BaseException:
        if held is not None:
            held.close()
        elif fd is not None:
            os.close(fd)
        raise


def file_response(request, descriptor, *, attachment=True):
    held = verified_open(descriptor)
    try:
        filename = descriptor["filename"]
        mime = descriptor["mime"]
        if not isinstance(filename, str) or any(c in filename for c in ("\r", "\n", "\x00")):
            raise PortalProblem("portal_file_descriptor_invalid", "The native filename is invalid.", 500)
        if not isinstance(mime, str) or any(c in mime for c in ("\r", "\n")):
            raise PortalProblem("portal_file_descriptor_invalid", "The native content type is invalid.", 500)
        response = FileResponse(
            held, as_attachment=attachment, filename=filename, content_type=mime,
        )
        response["Content-Length"] = str(descriptor["bytes"])
        response["ETag"] = '"' + descriptor["sha256"] + '"'
        response["X-Content-SHA256"] = descriptor["sha256"]
        if attachment and mime.split(";", 1)[0] in ("text/html", "image/svg+xml"):
            response["Content-Security-Policy"] = "default-src 'none'; sandbox"
        if request.method == "HEAD":
            headers = dict(response.items())
            response.close()
            response = HttpResponse(status=200)
            for key, value in headers.items():
                response[key] = value
        return secure_response(response)
    except BaseException:
        held.close()
        raise
