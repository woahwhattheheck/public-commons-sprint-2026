# SPDX-License-Identifier: MIT
"""Complete retained QGIS to QWC publication, native generation and recovery."""
from __future__ import annotations

from contextlib import contextmanager, ExitStack
import copy
import json
import os
from pathlib import Path
import stat
import sys
import uuid
import zipfile

from contract import (SCHEMA, WORKSPACE_SCHEMA, HERE, MAX_JSON, need, QwcError,
                      identifier, directory, member, read_json, json_bytes, digest,
                      value_hash, atomic, keep_json, measure, inventory, copy_file,
                      copy_inventory, writer, now, normalize_profile, normalize_request,
                      derive_theme, public_service, original_gis, sync_directory)
from generator import GENERATION_SCHEMA, native_source_inventory
from host import (NativeContext, ensure_namespace, read_pointer, set_pointer,
                  expose_release, target_root, file_state, same_file, plan_changes,
                  apply_change, verify_changes, check_baseline)

OP_SCHEMA = "starforge.stac-qwc-operation.v1"
REVIEW_SCHEMA = "starforge.stac-qwc-review.v1"
INTENT_SCHEMA = "starforge.stac-qwc-intent.v1"
DEPLOYMENT_SCHEMA = "starforge.stac-qwc-deployment.v1"
PROJECTION_SCHEMA = "starforge.stac-qwc-native-project.v1"


def source_inventory(root):
    root = directory(root)
    rows = []
    for parent, dirs, files in os.walk(root, followlinks=False):
        dirs[:] = sorted(x for x in dirs if x != "__pycache__")
        for name in sorted(files):
            if name.endswith((".pyc", ".pyo")):
                continue
            path = Path(parent) / name
            rows.append({"path": path.relative_to(root).as_posix(), **measure(path)})
    return rows


def host_inventory(profile, progress=None):
    result = {}
    for family in ("input", "viewer", "generated"):
        root = target_root(profile, family)
        rows = inventory(root, progress)
        for row in rows:
            selected = member(root, row["path"]).stat()
            row["mode"], row["gid"] = stat.S_IMODE(selected.st_mode), selected.st_gid
        result[family] = rows
    return result


def _inside(path, root):
    return path == root or path.is_relative_to(root)


def _descriptor(root, path):
    path = Path(path)
    return {"path": path.relative_to(root).as_posix(), **measure(path)}


def _read_archive_input(path, snapshot, project_id):
    """Inspect original selection; the original GIS receiver owns archive validation."""
    with zipfile.ZipFile(path) as archive:
        for name in ("qgis-package.json", "workspace-snapshot.json"):
            info = archive.getinfo(name)
            need(info.file_size <= MAX_JSON, "QGIS_PACKAGE_METADATA_LIMIT",
                 "Retain the complete original project metadata within its native limit.")
        manifest = json.loads(archive.read("qgis-package.json").decode("utf-8"))
        selected = json.loads(archive.read("workspace-snapshot.json").decode("utf-8"))
    need(manifest.get("schema") == "starforge.stac-qgis-project-package.v1" and
         manifest.get("workspaceId") == snapshot["state"]["id"] and
         manifest.get("revision") == snapshot["state"]["revision"] and selected == snapshot,
         "QGIS_PACKAGE_SELECTION_CHANGED", "The archive belongs to a different original workspace edition.")
    need(any(x["id"] == project_id for x in selected["state"]["projects"]),
         "QGIS_PACKAGE_PROJECT_MISSING", "The complete archive does not contain the selected original map.")
    return manifest


class QwcWorkspace:
    def __init__(self, root):
        self.root = directory(root)
        self.marker, self.marker_body = read_json(self.root / "workspace.json")
        need(self.marker.get("schema") == WORKSPACE_SCHEMA,
             "QWC_WORKSPACE_REQUIRED", "Open an original QWC publication workspace.")
        identifier(self.marker.get("id"), "workspaceId")
        self.profile = self.marker["profile"]
        need(value_hash(self.profile) == self.marker.get("profileSha256"),
             "HOST_PROFILE_CHANGED", "The original host profile has changed in this workspace.")

    @classmethod
    def create(cls, root, profile):
        selected = normalize_profile(profile)
        root = Path(root).expanduser().absolute()
        if root.exists() and (root / "workspace.json").is_file():
            current = cls(root)
            need(current.profile == selected, "WORKSPACE_HOST_CHANGED",
                 "Reopen this original host profile or create a different publication workspace.")
            return current
        root = directory(root, True)
        need(not any(root.iterdir()), "NEW_PUBLICATION_DIRECTORY",
             "Choose an empty directory for the original publication workspace.")
        for key in ("inputRoot", "viewerRoot", "qgisResourcesRoot", "generatedConfigRoot",
                    "generatorSource", "generatorCwd"):
            need(not _inside(root, Path(selected[key])), "PUBLICATION_DIRECTORY_OVERLAP",
                 "Keep publication state outside the selected host and native software trees.", field=key)
        data_roots = [Path(selected[x]) for x in ("inputRoot", "viewerRoot", "qgisResourcesRoot", "generatedConfigRoot")]
        need(all(not _inside(a, b) and not _inside(b, a)
                 for i, a in enumerate(data_roots) for b in data_roots[i + 1:]),
             "HOST_ROOTS_OVERLAP", "Select the original distinct input, viewer, QGIS resource and generated-config trees.")
        marker = {"schema": WORKSPACE_SCHEMA, "id": "qwc-" + uuid.uuid4().hex,
                  "profile": selected, "profileSha256": value_hash(selected), "createdAt": now()}
        keep_json(root / "workspace.json", marker)
        sync_directory(root)
        return cls(root)

    @contextmanager
    def _owned(self, context=None, *, host=False):
        context = context or NativeContext()
        added = []
        with ExitStack() as stack:
            try:
                fd = stack.enter_context(writer(self.root))
                context.fds.add(fd)
                added.append(fd)
                if host:
                    profile = normalize_profile(self.profile)
                    need(profile == self.profile, "HOST_PROFILE_RESOLUTION_CHANGED",
                         "The selected original host paths changed after workspace creation.")
                    fd = stack.enter_context(writer(profile["generatedConfigRoot"],
                                                    ".starforge-qwc-" + profile["tenant"] + ".lock"))
                    context.fds.add(fd)
                    added.append(fd)
                    namespace = ensure_namespace(profile, self.marker["id"])
                    fd = stack.enter_context(writer(namespace))
                    context.fds.add(fd)
                    added.append(fd)
                else:
                    namespace = None
                context.checkpoint()
                yield context, namespace
            finally:
                for fd in added:
                    context.fds.discard(fd)
                # All native calls wait for their actual child close before this stack releases.

    def _operation(self, request_id, *, create=False):
        identifier(request_id, "requestId")
        parent = directory(self.root / "operations", create)
        target = parent / request_id
        return directory(target, create)

    def _state(self, op):
        path = op / "operation.json"
        if path.exists():
            return read_json(path)[0]
        return {"schema": OP_SCHEMA, "requestId": op.name, "phase": "RETAINING", "createdAt": now()}

    def _save_state(self, op, state, phase=None, **fields):
        if phase is not None:
            state["phase"] = phase
        state.update(fields)
        state["updatedAt"] = now()
        atomic(op / "operation.json", json_bytes(state))
        return state

    def _remember_error(self, op, state, error):
        self._save_state(op, state, lastError={
            "code": getattr(error, "code", type(error).__name__),
            "message": str(error), "details": getattr(error, "details", {}), "at": now()
        })

    def _complete_terminal(self, op):
        """Finish a retained terminal receipt after a lost state-file publication."""
        state = self._state(op)
        if (op / "rollback.json").exists():
            result, _ = read_json(op / "rollback.json")
            need(result.get("requestId") == op.name and result.get("phase") == "ROLLED_BACK",
                 "ROLLBACK_RESULT_CHANGED", "The original terminal rollback receipt is invalid.")
            path = op / "deployment.json"
            if path.exists():
                previous, body = read_json(path)
                if previous.get("phase") == "PUBLISHED":
                    keep_json(op / "published-deployment.json", previous)
                    atomic(path, json_bytes(result), expected=digest(body))
                else:
                    need(previous == result, "DEPLOYMENT_RESULT_CHANGED",
                         "The current deployment receipt differs from the original rollback.")
            else:
                keep_json(path, result)
            self._save_state(op, state, "ROLLED_BACK", completedAt=result["completedAt"], lastError=None)
            return result
        if (op / "deployment.json").exists():
            result, _ = read_json(op / "deployment.json")
            need(result.get("requestId") == op.name and result.get("phase") == "PUBLISHED",
                 "DEPLOYMENT_RESULT_CHANGED", "The original terminal publication receipt is invalid.")
            self._save_state(op, state, "PUBLISHED", completedAt=result["completedAt"], lastError=None)
            return result
        return None

    def _other_active_deployment(self, request_id):
        parent = self.root / "operations"
        if not parent.exists():
            return
        for op in parent.iterdir():
            if not op.is_dir() or op.is_symlink() or op.name == request_id:
                continue
            self._complete_terminal(op)
            need(not (op / "deployment-plan.json").exists() or (op / "deployment.json").exists(),
                 "HOST_OPERATION_ACTIVE", "Complete or restore the original host publication before selecting another edition.",
                 requestId=op.name)

    def _native_environment(self):
        for name in self.profile["environmentNames"]:
            need(name in os.environ, "NATIVE_ENVIRONMENT_MISSING",
                 "The existing native host environment is required.", name=name)
        return os.environ.copy()

    def _source_bindings(self):
        qgis = HERE.parent / "qgis"
        return {"publisher": source_inventory(HERE),
                "qgis": source_inventory(qgis),
                "configGenerator": native_source_inventory(self.profile["generatorSource"])}

    def _verify_sources(self, selected):
        need(self._source_bindings() == selected, "NATIVE_SOFTWARE_CHANGED",
             "Run this retained operation with its original selected publisher, GIS and ConfigGenerator source.")

    def _copy_sources(self, op, sources, context):
        for family, original in (("publisher", HERE), ("qgis", HERE.parent / "qgis"),
                                 ("configGenerator", Path(self.profile["generatorSource"]))):
            copy_inventory(original, op / "software" / family, sources[family], context.checkpoint)

    def _retained_intent(self, op):
        intent, body = read_json(op / "intent.json")
        need(intent.get("schema") == INTENT_SCHEMA and
             intent.get("workspaceId") == self.marker["id"] and intent.get("requestId") == op.name and
             intent.get("profile") == self.profile and
             value_hash(intent["identity"]) == intent.get("publicationId"),
             "PUBLICATION_INTENT_CHANGED", "The original publication identity no longer matches its retained inputs.")
        return intent, body

    def prepare(self, raw, *, context=None):
        need(isinstance(raw, dict), "PUBLICATION_REQUEST_REQUIRED", "Open the complete publication request.")
        request_id = identifier(raw.get("requestId"), "requestId")
        with self._owned(context, host=True) as (ctx, namespace):
            self._other_active_deployment(request_id)
            op = self._operation(request_id, create=True)
            self._complete_terminal(op)
            state = self._state(op)
            self._save_state(op, state)
            try:
                existing = (op / "intent.json").exists()
                request = normalize_request(raw, self.profile, source_required=not existing)
                for key in ("inputRoot", "viewerRoot", "qgisResourcesRoot", "generatedConfigRoot"):
                    need(not _inside(Path(request["qgis"]["directory"]), Path(self.profile[key])) and
                         not _inside(op, Path(request["qgis"]["directory"])),
                         "QGIS_INPUT_OVERLAP", "Keep the original GIS workspace separate from publication state and host trees.")
                if existing:
                    intent, intent_body = self._retained_intent(op)
                    need(intent["request"] == request, "PUBLICATION_REQUEST_CHANGED",
                         "This edition request already retains different original input.")
                    self._verify_sources(intent["sources"])
                    if (op / "review.json").exists():
                        retained = self.review(request_id)
                        self._verify_retained(op, intent, retained["review"], ctx)
                        return retained
                else:
                    original = original_gis().QgisWorkspace(request["qgis"]["directory"])
                    snapshot = original.snapshot()
                    need(snapshot["state"]["revision"] == request["qgis"]["revision"],
                         "QGIS_REVISION_CHANGED", "Select the original workspace's displayed revision.")
                    projects = [x for x in snapshot["state"]["projects"] if x["id"] == request["qgis"]["projectId"]]
                    need(len(projects) == 1, "QGIS_PROJECT_REQUIRED", "Select one exact retained native map.")
                    original_files = original.project_files(snapshot)
                    baseline = host_inventory(self.profile, ctx.checkpoint)
                    sources = self._source_bindings()
                    pointer = read_pointer(namespace)
                    identity = {"workspaceId": self.marker["id"], "profile": self.profile,
                                "request": request, "qgisSnapshotSha256": value_hash(snapshot),
                                "qgisFiles": original_files, "baseline": baseline,
                                "nativeSourceBindings": sources, "previousProject": pointer}
                    publication_id = value_hash(identity)
                    intent = {"schema": INTENT_SCHEMA, "workspaceId": self.marker["id"],
                              "operationId": request["operationId"], "requestId": request_id,
                              "publicationId": publication_id, "profile": self.profile,
                              "request": request, "identity": identity, "sources": sources,
                              "snapshot": snapshot, "selectedProject": projects[0],
                              "baseline": baseline, "previousProject": pointer, "createdAt": state["createdAt"]}
                    keep_json(op / "intent.json", intent)
                    intent_body = json_bytes(intent)
                publication_id = intent["publicationId"]
                self._save_state(op, state, operationId=request["operationId"],
                                 publicationId=publication_id, intentSha256=digest(intent_body), lastError=None)

                # Freeze the complete selected host inputs and original software before native calls.
                for family in ("input", "viewer", "generated"):
                    copy_inventory(target_root(self.profile, family), op / "baseline" / family,
                                   intent["baseline"][family], ctx.checkpoint)
                self._copy_sources(op, intent["sources"], ctx)
                keep_json(op / "source" / "workspace-snapshot.json", intent["snapshot"])
                archive_path = op / "source" / "qgis-project.zip"
                if not archive_path.exists():
                    original = original_gis().QgisWorkspace(request["qgis"]["directory"])
                    need(original.snapshot() == intent["snapshot"], "QGIS_SOURCE_EDITION_CHANGED",
                         "The original workspace changed before its complete archive was retained.")
                    original.export_package(archive_path, expected_revision=request["qgis"]["revision"],
                                            progress=ctx.checkpoint)
                    sync_directory(archive_path.parent)
                measured = measure(archive_path, progress=ctx.checkpoint)
                manifest = _read_archive_input(archive_path, intent["snapshot"], request["qgis"]["projectId"])
                package = {"path": "source/qgis-project.zip", **measured,
                           "manifestSha256": value_hash(manifest),
                           "workspaceId": manifest["workspaceId"], "revision": manifest["revision"],
                           "fileCount": len(manifest["files"]) + 1, "totalDecodedBytes": manifest["totalBytes"]}
                # Keep the native manifest's exact raw hash, independent of JSON formatting.
                with zipfile.ZipFile(archive_path) as archive:
                    package["manifestSha256"] = digest(archive.read("qgis-package.json"))
                keep_json(op / "source" / "package.json", package)
                self._save_state(op, state, "SOURCE_RETAINED")
                received = original_gis().receive_package(archive_path, op / "project" / "gis",
                                                         expected_sha256=measured["sha256"], progress=ctx.checkpoint)
                need(received["workspace"].snapshot() == intent["snapshot"],
                     "QGIS_RECEIVING_CHANGED", "The original receiver reopened a different source edition.")
                keep_json(op / "source" / "receiving.json", received["receipt"])
                original_theme, _ = read_json(member(op / "baseline" / "input", self.profile["themeInput"]))
                theme_document, previous_theme, theme = derive_theme(original_theme, self.profile, request["theme"])
                keep_json(op / "planned-theme.json", theme_document)
                keep_json(op / "theme-selection.json", {"previous": previous_theme, "selected": theme,
                                                       "pointer": self.profile["themePointer"]})
                projection = {
                    "schema": PROJECTION_SCHEMA, "gisDirectory": str(op / "project" / "gis"),
                    "outputDirectory": str(op / "project"), "workspaceId": manifest["workspaceId"],
                    "revision": manifest["revision"], "projectId": request["qgis"]["projectId"],
                    "publicationId": publication_id, "title": theme["title"], "rootName": self.profile["themeId"],
                    "print": request.get("print")
                }
                keep_json(op / "projection-request.json", projection)
                native_path = op / "project" / "native-project.json"
                if not native_path.exists():
                    self._save_state(op, state, "PROJECT_PREPARING")
                    ctx.run([self.profile["qgisPython"], "-B", str(HERE / "project.py"),
                             "--input", str(op / "projection-request.json")],
                            op / "jobs", "qgis-project", environment=self._native_environment())
                native, _ = read_json(native_path)
                need(native.get("publicationId") == publication_id and
                     native.get("workspaceId") == manifest["workspaceId"] and
                     native.get("revision") == manifest["revision"] and
                     native.get("projectId") == request["qgis"]["projectId"],
                     "NATIVE_PROJECT_IDENTITY", "The native projection returned a different original source or publication.")
                measure(op / "project" / "project.qgz", native["file"], ctx.checkpoint)
                project_files = inventory(op / "project", ctx.checkpoint)
                candidate = directory(op / "candidate", True)
                keep_json(candidate / "candidate.json", {"schema": "starforge.stac-qwc-candidate.v1",
                                                        "publicationId": publication_id})
                review = {
                    "schema": REVIEW_SCHEMA, "workspaceId": self.marker["id"],
                    "operationId": request["operationId"], "requestId": request_id, "publicationId": publication_id,
                    "intentSha256": digest(intent_body), "preparedAt": state["createdAt"],
                    "qgis": {"workspaceId": manifest["workspaceId"], "revision": manifest["revision"],
                             "projectId": request["qgis"]["projectId"], "sourceIds": native["sourceIds"],
                             "package": package, "projectFile": {"path": "project/project.qgz", **measure(op / "project" / "project.qgz")}},
                    "projectFiles": project_files,
                    "theme": {"id": self.profile["themeId"], "title": theme["title"],
                              "mapName": self.profile["mapPrefix"] + "/current/project",
                              "layers": native["layers"], "layouts": native["layouts"]},
                    "service": public_service(self.profile), "roleViews": request["roleViews"],
                    "host": {"id": self.profile["id"], "tenant": self.profile["tenant"],
                             "previousProject": intent["previousProject"],
                             "nextProject": "releases/" + publication_id,
                             "beforeFiles": intent["baseline"],
                             "reloadCommand": self.profile.get("reloadCommand"),
                             "permissionsDefaultAllow": self.profile["permissionsDefaultAllow"]},
                    "nativeSourceBindings": intent["sources"],
                    "generation": {"method": "ConfigGenerator.write_configs + write_permissions",
                                   "sourceSha256": value_hash(intent["sources"]["configGenerator"]),
                                   "selectedTheme": theme,
                                   "viewerPathDerivation": {"jsonPointer": "/config/qwc2_path",
                                                           "to": self.profile["viewerRoot"]}},
                    "sequence": ["verify original host and selected source", "select complete native QGIS release",
                                 "generate complete native QWC configuration and permissions",
                                 "publish retained file postimages", "invoke selected existing reload",
                                 "reopen host files and current project"]
                }
                review_path = op / "review.json"
                keep_json(review_path, review)
                self._save_state(op, state, "PREPARED", reviewSha256=measure(review_path)["sha256"], lastError=None)
                return {"review": review, "reviewSha256": measure(review_path)["sha256"],
                        "operation": copy.deepcopy(state)}
            except BaseException as error:
                self._remember_error(op, state, error)
                raise

    def review(self, request_id):
        op = self._operation(request_id)
        review, body = read_json(op / "review.json")
        intent, intent_body = self._retained_intent(op)
        need(review.get("intentSha256") == digest(intent_body) and
             review.get("publicationId") == intent["publicationId"], "REVIEW_INPUT_CHANGED",
             "The publication review no longer belongs to its retained original input.")
        return {"review": review, "reviewSha256": digest(body), "operation": self._state(op)}

    def _verify_retained(self, op, intent, review, ctx):
        self._verify_sources(intent["sources"])
        measure(member(op, review["qgis"]["package"]["path"]), review["qgis"]["package"], ctx.checkpoint)
        for row in review["projectFiles"]:
            measure(member(op / "project", row["path"]), row, ctx.checkpoint)
        for family in ("input", "viewer", "generated"):
            for row in intent["baseline"][family]:
                measure(member(op / "baseline" / family, row["path"]), row, ctx.checkpoint)
        for family in ("publisher", "qgis", "configGenerator"):
            for row in intent["sources"][family]:
                measure(member(op / "software" / family, row["path"]), row, ctx.checkpoint)

    def _generation_request(self, op, intent, review):
        return {
            "schema": GENERATION_SCHEMA, "directory": str(op / "generation"),
            "publicationId": intent["publicationId"], "profile": self.profile,
            "generatorSourceFiles": intent["sources"]["configGenerator"],
            "candidateDirectory": str(op / "candidate"),
            "inputDirectory": str(op / "candidate" / "input"),
            "viewerDirectory": str(op / "candidate" / "viewer"),
            "inputBaselineDirectory": str(op / "baseline" / "input"),
            "viewerBaselineDirectory": str(op / "baseline" / "viewer"),
            "inputFiles": intent["baseline"]["input"], "viewerFiles": intent["baseline"]["viewer"],
            "themeDocumentFile": str(op / "planned-theme.json"), "themeDocument": measure(op / "planned-theme.json"),
            "theme": read_json(op / "theme-selection.json")[0]["selected"],
            "projectFile": review["qgis"]["projectFile"], "layers": review["theme"]["layers"],
            "roleViews": intent["request"]["roleViews"]
        }

    def _publish_manifest(self, op, intent, review, generation):
        path = op / "publication.json"
        if path.exists():
            value, body = read_json(path)
            need(value.get("publicationId") == intent["publicationId"], "PUBLICATION_ID_CHANGED",
                 "The completed publication belongs to another input.")
            for row in value["files"]:
                measure(member(op, row["path"]), row)
            return value, digest(body)
        paths = ["intent.json", "review.json", "projection-request.json", "generation-request.json",
                 "planned-theme.json", "theme-selection.json"]
        files = [_descriptor(op, op / name) for name in paths]
        for family in ("source", "project", "baseline", "software", "candidate", "generation"):
            for row in inventory(op / family):
                files.append({"path": family + "/" + row["path"], "bytes": row["bytes"], "sha256": row["sha256"]})
        files.sort(key=lambda x: x["path"])
        need(len({x["path"] for x in files}) == len(files), "PUBLICATION_FILE_COLLISION",
             "The complete publication has a duplicate original file.")
        value = {
            "schema": SCHEMA, "operationId": intent["operationId"], "requestId": intent["requestId"],
            "publicationId": intent["publicationId"], "preparedAt": review["preparedAt"],
            "generatedAt": generation["completedAt"], "qgis": copy.deepcopy(review["qgis"]),
            "theme": copy.deepcopy(review["theme"]), "service": review["service"],
            "qwc": {"tenant": self.profile["tenant"], "version": self.profile["qwcVersion"],
                    "permissionsDefaultAllow": generation["permissionsDefaultAllow"],
                    "nativeSourceBinding": {"files": intent["sources"]["configGenerator"],
                                            "sha256": generation["nativeSourceSha256"],
                                            "python": generation["python"], "packages": generation["packages"]},
                    "nativeFiles": [{"path": "generation/native/" + x["path"], "bytes": x["bytes"], "sha256": x["sha256"]}
                                    for x in generation["nativeFiles"]],
                    "deploymentFiles": [{"path": "generation/deployment/" + x["path"], "bytes": x["bytes"], "sha256": x["sha256"]}
                                        for x in generation["deploymentFiles"]],
                    "derivations": generation["derivations"]},
            "roleViews": intent["request"]["roleViews"], "files": files
        }
        keep_json(path, value)
        return value, measure(path)["sha256"]

    def _reload(self, op, phase, ctx):
        command = self.profile.get("reloadCommand")
        if command is None:
            return {"configured": False}
        name = "reload-" + phase
        path = op / "jobs" / (name + ".json")
        if path.exists():
            prior, _ = read_json(path)
            if prior.get("phase") == "CLOSED" and prior.get("exitCode") == 0 and prior.get("command") == command:
                return prior
        return ctx.run(command, op / "jobs", name, cwd=self.profile["generatorCwd"],
                       environment=self._native_environment())

    def publish(self, request_id, expected_review_sha256, *, context=None):
        with self._owned(context, host=True) as (ctx, namespace):
            self._other_active_deployment(request_id)
            op = self._operation(request_id)
            self._complete_terminal(op)
            selected = self.review(request_id)
            need(selected["reviewSha256"] == expected_review_sha256, "REVIEW_REVISION_CHANGED",
                 "Publish the exact displayed review and its original input.")
            review, state = selected["review"], self._state(op)
            intent, _ = self._retained_intent(op)
            next_pointer = "releases/" + intent["publicationId"]
            previous_pointer = intent["previousProject"]
            deployment_path = op / "deployment.json"
            if deployment_path.exists():
                completed, _ = read_json(deployment_path)
                need(completed.get("publicationId") == intent["publicationId"] and
                     completed.get("phase") in ("PUBLISHED", "ROLLED_BACK"),
                     "DEPLOYMENT_RESULT_CHANGED", "The completed original deployment result is invalid.")
                publication, body = read_json(op / "publication.json")
                for row in publication["files"]:
                    measure(member(op, row["path"]), row, ctx.checkpoint)
                return {"publication": publication, "publicationSha256": digest(body), "deployment": completed,
                        "active": read_pointer(namespace) == next_pointer, "replayed": True}
            files_started = (op / "deployment-plan.json").exists()
            try:
                self._verify_retained(op, intent, review, ctx)
                if not files_started:
                    check_baseline(self.profile, intent["baseline"])
                release = directory(namespace / "releases" / intent["publicationId"], True)
                copy_inventory(op / "project", release, review["projectFiles"], ctx.checkpoint)
                expose_release(namespace, release, self.profile)
                # Retain the intent before switching any live pointer.
                self._save_state(op, state, "PROJECT_SELECTING", previousProject=previous_pointer,
                                 nextProject=next_pointer, lastError=None)
                set_pointer(namespace, previous_pointer, next_pointer)
                self._save_state(op, state, "PROJECT_SELECTED")
                generation_request = self._generation_request(op, intent, review)
                keep_json(op / "generation-request.json", generation_request)
                generation_result = op / "generation" / "native-generation.json"
                if not generation_result.exists():
                    self._save_state(op, state, "GENERATING")
                    ctx.run([self.profile["generatorPython"], "-B", str(HERE / "generator.py"),
                             "--input", str(op / "generation-request.json")],
                            op / "jobs", "qwc-generation", cwd=self.profile["generatorCwd"],
                            environment=self._native_environment())
                generation, _ = read_json(generation_result)
                need(generation.get("requestSha256") == value_hash(generation_request) and
                     generation.get("publicationId") == intent["publicationId"],
                     "GENERATION_IDENTITY_CHANGED", "The original native generator returned a different publication.")
                for row in generation["nativeFiles"]:
                    measure(member(op / "generation" / "native", row["path"]), row, ctx.checkpoint)
                for row in generation["deploymentFiles"]:
                    measure(member(op / "generation" / "deployment", row["path"]), row, ctx.checkpoint)
                for row in generation["viewerFiles"]:
                    measure(member(op / "candidate" / "viewer", row["path"]), row, ctx.checkpoint)
                publication, publication_sha = self._publish_manifest(op, intent, review, generation)
                changes = plan_changes(op, self.profile, intent["baseline"], generation)
                plan = {"schema": "starforge.stac-qwc-deployment-plan.v1",
                        "publicationId": intent["publicationId"], "publicationSha256": publication_sha,
                        "reviewSha256": expected_review_sha256,
                        "previousProject": previous_pointer, "nextProject": next_pointer, "files": changes}
                keep_json(op / "deployment-plan.json", plan)
                files_started = True
                self._save_state(op, state, "FILES_APPLYING", publicationSha256=publication_sha)
                for change in changes:
                    ctx.checkpoint({"phase": "publish", "family": change["family"], "path": change["path"]})
                    apply_change(op, self.profile, change)
                self._save_state(op, state, "FILES_APPLIED")
                reload_result = self._reload(op, "publish", ctx)
                verify_changes(self.profile, changes)
                need(read_pointer(namespace) == next_pointer, "HOST_POINTER_CHANGED",
                     "The published project pointer changed before completion.")
                for row in review["projectFiles"]:
                    measure(member(release, row["path"]), row, ctx.checkpoint)
                result = {"schema": DEPLOYMENT_SCHEMA, "operationId": intent["operationId"],
                          "requestId": request_id, "publicationId": intent["publicationId"],
                          "publicationSha256": publication_sha, "reviewSha256": expected_review_sha256,
                          "phase": "PUBLISHED", "completedAt": now(), "previousProject": previous_pointer,
                          "currentProject": next_pointer, "files": changes,
                          "nativeGeneration": {"path": "generation/native-generation.json", **measure(generation_result)},
                          "reload": reload_result}
                keep_json(deployment_path, result)
                self._save_state(op, state, "PUBLISHED", completedAt=result["completedAt"], lastError=None)
                return {"publication": publication, "publicationSha256": publication_sha,
                        "deployment": result, "active": True, "replayed": False}
            except BaseException as error:
                # Before file application, restoring the pointer restores the original host
                # selection. During file application the retained plan owns full rollback.
                if not files_started and read_pointer(namespace) == next_pointer:
                    try:
                        set_pointer(namespace, next_pointer, previous_pointer)
                    except BaseException as restore_error:
                        state["pointerRecoveryError"] = {"code": getattr(restore_error, "code", type(restore_error).__name__),
                                                         "message": str(restore_error)}
                self._remember_error(op, state, error)
                raise

    def rollback(self, request_id, expected_publication_sha256, *, context=None):
        with self._owned(context, host=True) as (ctx, namespace):
            op = self._operation(request_id)
            intent, _ = self._retained_intent(op)
            publication, body = read_json(op / "publication.json")
            need(digest(body) == expected_publication_sha256 and
                 publication.get("publicationId") == intent["publicationId"],
                 "ROLLBACK_PUBLICATION_CHANGED", "Restore the exact selected original publication.")
            rollback_path = op / "rollback.json"
            if rollback_path.exists():
                prior = self._complete_terminal(op)
                need(prior["publicationSha256"] == expected_publication_sha256,
                     "ROLLBACK_PUBLICATION_CHANGED", "Continue the same original rollback receipt.")
                return {"rollback": prior, "replayed": True}
            plan, plan_body = read_json(op / "deployment-plan.json")
            need(plan.get("publicationSha256") == expected_publication_sha256 and
                 plan.get("publicationId") == intent["publicationId"],
                 "ROLLBACK_PLAN_CHANGED", "The rollback plan belongs to a different original publication.")
            state = self._state(op)
            try:
                current = read_pointer(namespace)
                need(current in (plan["nextProject"], plan["previousProject"]),
                     "ROLLBACK_NEWER_PROJECT", "A later publication now owns this host. Select its original rollback first.")
                self._save_state(op, state, "ROLLING_BACK", rollbackPlanSha256=digest(plan_body), lastError=None)
                for change in reversed(plan["files"]):
                    ctx.checkpoint({"phase": "rollback", "family": change["family"], "path": change["path"]})
                    apply_change(op, self.profile, change, rollback=True)
                set_pointer(namespace, plan["nextProject"], plan["previousProject"])
                reload_result = self._reload(op, "rollback", ctx)
                verify_changes(self.profile, plan["files"], rollback=True)
                need(read_pointer(namespace) == plan["previousProject"], "ROLLBACK_POINTER_CHANGED",
                     "The restored project pointer changed before completion.")
                result = {"schema": DEPLOYMENT_SCHEMA, "operationId": intent["operationId"],
                          "requestId": request_id, "publicationId": intent["publicationId"],
                          "publicationSha256": expected_publication_sha256, "phase": "ROLLED_BACK",
                          "completedAt": now(), "previousProject": plan["nextProject"],
                          "currentProject": plan["previousProject"], "files": plan["files"], "reload": reload_result}
                keep_json(rollback_path, result)
                self._complete_terminal(op)
                return {"rollback": result, "replayed": False}
            except BaseException as error:
                self._remember_error(op, state, error)
                raise

    def inspect(self, request_id=None, *, verify=False, offset=0, limit=50):
        rows = []
        parent = self.root / "operations"
        if request_id is not None:
            operations = [self._operation(request_id)]
        else:
            operations = sorted(x for x in parent.iterdir() if x.is_dir() and not x.is_symlink()) if parent.exists() else []
        need(type(offset) is int and offset >= 0 and type(limit) is int and 1 <= limit <= 100,
             "PAGE_SELECTION_INVALID", "Choose an original page of up to 100 retained editions.")
        total = len(operations)
        if request_id is None:
            operations = operations[offset:offset + limit]
        for op in operations:
            state = self._state(op)
            item = {"requestId": op.name, "operation": state}
            if request_id is None:
                if (op / "review.json").exists():
                    review, body = read_json(op / "review.json")
                    item.update({"title": review["theme"]["title"], "layerCount": len(review["theme"]["layers"]),
                                 "sourceRevision": review["qgis"]["revision"], "reviewSha256": digest(body)})
                rows.append(item)
                continue
            for name in ("review.json", "publication.json", "deployment.json", "rollback.json"):
                path = op / name
                if path.exists():
                    value, body = read_json(path)
                    item[name[:-5]] = value
                    item[name[:-5] + "Sha256"] = digest(body)
            if verify and "publication" in item:
                for row in item["publication"]["files"]:
                    measure(member(op, row["path"]), row)
                item["filesVerified"] = len(item["publication"]["files"])
            rows.append(item)
        return {"schema": WORKSPACE_SCHEMA, "workspaceId": self.marker["id"],
                "host": {"id": self.profile["id"], "tenant": self.profile["tenant"],
                         "themeId": self.profile["themeId"], "version": self.profile["qwcVersion"],
                         "service": public_service(self.profile)},
                "operations": rows, "total": total,
                "nextOffset": offset + len(rows) if request_id is None and offset + len(rows) < total else None}
