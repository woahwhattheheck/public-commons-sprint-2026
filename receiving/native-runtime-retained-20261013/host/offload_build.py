#!/usr/bin/env python3
"""Adapt an immutable heavy-work envelope to the existing Linux cloud worker.

Runs in an already authorized cloud environment. No provider, queue, model,
daemon, credential retrieval, or automatic command retry is introduced.
"""
from __future__ import annotations

import argparse
import hashlib
import json
import os
from pathlib import Path
import re
import shutil
import stat
import subprocess
import sys
import tempfile
from types import SimpleNamespace
from urllib.parse import urlsplit
import zipfile

if __package__:
    from .run_bounded import cloud_spec
    from . import swarm_cloud_job as native
else:
    from run_bounded import cloud_spec
    import swarm_cloud_job as native

SCHEMA = "commons.offload-native-adapter/v1"
RUNTIME_ENV = ("JAVA17_HOME", "JAVA21_HOME", "SWARM_NODE18_ROOT",
               "SWARM_NODE24_BIN", "SWARM_CARGO_HOME", "RUSTUP_HOME", "GOROOT",
               "COMMONS_PEER", "SWARM_WORKER_ROOT", "SWARM_WORKER_TMP_ROOT",
               "SWARM_NATIVE_JOBS_ROOT", "SWARM_MEMORY_RESERVATIONS_ROOT",
               "SWARM_DISK_RESERVATIONS_ROOT", "SWARM_RUNTIME_CONSUMERS_ROOT")


def require_memory_admission(reclaim_mode="none", storage_mode="included"):
    if (getattr(native, "MEMORY_ADMISSION_SCHEMA", None) != "commons.native-cloud-memory/v1" or
            (reclaim_mode != "none" and reclaim_mode not in
             getattr(native, "MEMORY_ADMISSION_RECLAIM_MODES", ())) or
            (storage_mode != "included" and storage_mode not in
             getattr(native, "MEMORY_ADMISSION_STORAGE_MODES", ()))):
        raise ValueError("Install the original native memory-admission capability before submitting this memory request")


def memory_profile(memory_mib, reserve_mib=256, reservations_root=None, reclaim_mode="none",
                   storage_mode="included"):
    """Use the original supervisor's explicit memory capability and schema."""
    if memory_mib is None:
        if (reserve_mib != 256 or reservations_root is not None or reclaim_mode != "none"
                or storage_mode != "included"):
            raise ValueError("Memory reserve/root options require an explicit memory_mib peak.")
        return None
    try:
        if __package__:
            from . import cloud_memory
        else:
            import cloud_memory
    except ImportError as exc:
        raise ValueError("Install the original cloud_memory module and matching native supervisor before requesting memory admission.") from exc
    require_memory_admission(reclaim_mode, storage_mode)
    if storage_mode != "included":
        return cloud_memory.specification(memory_mib, reserve_mib, reservations_root,
                                          reclaim_mode, storage_mode)
    if reclaim_mode == "none":
        return cloud_memory.specification(memory_mib, reserve_mib, reservations_root)
    return cloud_memory.specification(memory_mib, reserve_mib, reservations_root, reclaim_mode)


def require_disk_admission():
    if getattr(native, "DISK_ADMISSION_SCHEMA", None) != "commons.native-cloud-disk/v1":
        raise ValueError("Install the original native disk-admission capability before submitting this disk request")


def disk_profile(spaces=(), inodes=(), reserve_mib=64, reserve_inodes=128,
                 reservations_root=None, *, project=None):
    """Bind relative output locations to the original materialized project."""
    if not (spaces or inodes):
        if reserve_mib != 64 or reserve_inodes != 128 or reservations_root is not None:
            raise ValueError("Disk reserve/root options require a declared disk-space or disk-inodes path.")
        return None
    try:
        if __package__:
            from . import cloud_disk
        else:
            import cloud_disk
    except ImportError as exc:
        raise ValueError("Install the original cloud_disk module and matching native supervisor before requesting disk admission.") from exc
    require_disk_admission()

    def locations(values):
        selected = []
        for value in values or ():
            if not isinstance(value, str):
                raise ValueError("Disk requirements use PATH=MIB or PATH=COUNT")
            path, separator, amount = value.rpartition("=")
            if not separator or not path:
                raise ValueError("Disk requirements use PATH=MIB or PATH=COUNT")
            expanded = Path(path).expanduser()
            if not expanded.is_absolute():
                if project is None:
                    raise ValueError("Retained disk paths must identify their absolute original location")
                expanded = Path(project) if path == "." else Path(project) / portable_path(path)
            selected.append(str(expanded) + "=" + amount)
        return selected

    return cloud_disk.specification(locations(spaces), locations(inodes),
                                    reserve_mib, reserve_inodes, reservations_root)


def portable_path(value):
    if (not isinstance(value, str) or not value or value.startswith("/")
            or any(ord(c) < 32 for c in value) or "\\" in value or ":" in value
            or any(p in ("", ".", "..", ".git") for p in value.split("/"))):
        raise ValueError("Use explicit repository-relative paths without traversal or .git.")
    return value


def clean_environment():
    # Build processes inherit only this explicit runtime profile. Never copy
    # tokens, credential helpers, proxy settings, PYTHONPATH, or shell startup.
    if __package__:
        from .swarm_cloud_worker import python_cache_environment
    else:
        from swarm_cloud_worker import python_cache_environment
    values = {"PATH": os.environ.get("PATH", os.defpath), "LANG": "C.UTF-8",
              "LC_ALL": "C.UTF-8", "TZ": "UTC", "PYTHONNOUSERSITE": "1",
              "GIT_TERMINAL_PROMPT": "0",
              "GIT_CONFIG_NOSYSTEM": "1", "GIT_CONFIG_GLOBAL": os.devnull,
              "SWARM_STATE_ROOT": os.environ.get("SWARM_STATE_ROOT", "/workspace/shared/swarm")}
    values.update(python_cache_environment())
    for key in RUNTIME_ENV:
        if os.environ.get(key):
            values[key] = os.environ[key]
    return values


def git_read(checkout, argv):
    result = subprocess.run(["git", "-C", str(checkout), *argv],
        stdout=subprocess.PIPE, stderr=subprocess.DEVNULL, check=False,
        timeout=30, env=clean_environment())
    if result.returncode:
        raise ValueError("Source Git read failed; supply the existing checkout and pinned commit objects.")
    return result.stdout


def verify_checkout(checkout, spec):
    actual = git_read(checkout, ["rev-parse", "--verify", spec["head"] + "^{commit}"]).decode().strip()
    if actual != spec["head"]:
        raise ValueError("Source commit differs from the immutable job head.")
    raw = git_read(checkout, ["config", "--get", "remote.origin.url"]).decode().strip()
    if raw.startswith("git@github.com:"):
        repo = raw[len("git@github.com:"):]
    else:
        url = urlsplit(raw)
        if url.hostname not in ("github.com", "git.chatgpt-team.site") or url.query or url.fragment:
            raise ValueError("Source origin must identify this job's GitHub repository.")
        repo = url.path.lstrip("/")
    if repo.endswith(".git"):
        repo = repo[:-4]
    if repo.lower() != spec["repo"].lower():
        raise ValueError("Source origin differs from this job's repository.")


def copy_source(checkout, spec, selections, root, *, git_metadata=False):
    """Copy fixed Git objects, not the mutable checkout or its credentials."""
    verify_checkout(checkout, spec)
    data = git_read(checkout, ["ls-tree", "-r", "-z", "--full-tree", spec["head"], "--", *selections])
    entries = []
    for raw in data.split(b"\0"):
        if not raw:
            continue
        header, path = raw.split(b"\t", 1)
        mode, kind, oid = header.decode("ascii").split()
        name = portable_path(path.decode("utf-8"))
        if kind != "blob" or mode not in ("100644", "100755") or not re.fullmatch(r"[0-9a-f]{40}", oid):
            raise ValueError("Source export supports regular committed files; select explicit dependency paths without submodules or links.")
        entries.append((name, mode, oid))
    if not entries:
        raise ValueError("The selected commit paths contain no source files.")
    stage = Path(tempfile.mkdtemp(prefix=".source-", dir=root))
    records = []
    process = None
    try:
        with tempfile.TemporaryFile() as errors:
            process = subprocess.Popen(["git", "-C", str(checkout), "cat-file", "--batch"],
                stdin=subprocess.PIPE, stdout=subprocess.PIPE, stderr=errors,
                env=clean_environment(), close_fds=True)
            for name, mode, oid in entries:
                process.stdin.write((oid + "\n").encode("ascii"))
                process.stdin.flush()
                reply = process.stdout.readline().decode("ascii").strip().split()
                if len(reply) != 3 or reply[:2] != [oid, "blob"]:
                    raise ValueError("A selected source blob is unavailable in the checkout.")
                size = remaining = int(reply[2])
                path = stage / name
                path.parent.mkdir(parents=True, exist_ok=True, mode=0o700)
                digest = hashlib.sha1(b"blob " + str(size).encode("ascii") + b"\0")
                descriptor = os.open(path, os.O_WRONLY | os.O_CREAT | os.O_EXCL,
                                     0o755 if mode == "100755" else 0o644)
                with os.fdopen(descriptor, "wb") as output:
                    while remaining:
                        block = process.stdout.read(min(remaining, 256 * 1024))
                        if not block:
                            raise ValueError("Source blob stream ended early.")
                        output.write(block)
                        digest.update(block)
                        remaining -= len(block)
                if process.stdout.read(1) != b"\n" or digest.hexdigest() != oid:
                    raise ValueError("Source bytes do not match the pinned Git object.")
                records.append({"path": name, "mode": mode, "blob_sha": oid, "bytes": size})
            process.stdin.close()
            if process.wait(timeout=30):
                raise ValueError("Source object stream did not complete.")
        if git_metadata:
            # Some original builders read git objects. Import only the pinned
            # object graph into fresh metadata, with no origin, hooks, config,
            # alternates, credentials or hard links from the source checkout.
            for command in (["init", "-q"],
                    ["fetch", "--no-tags", "--depth=1", "--no-write-fetch-head", str(checkout), spec["head"]],
                    ["update-ref", "--no-deref", "HEAD", spec["head"]],
                    ["read-tree", spec["head"]]):
                git_read(stage, command)
        source = {"repo": spec["repo"], "head": spec["head"], "git_metadata": git_metadata,
                  "selection": selections, "files": records, "created_at": native.now()}
        native.save_json(root / "offload-source.json", source)
        stage.rename(root / "project")
        return source
    finally:
        if process is not None and process.poll() is None:
            process.kill()
            process.wait()
        if stage.exists():
            shutil.rmtree(stage)


def load_binding(operation_id):
    root = native.run_path(operation_id)
    binding = native.read_json(root / "offload.json")
    if not binding or binding.get("schema") != SCHEMA:
        raise ValueError("No retained offload binding for this operation ID.")
    return root, binding


def prepare(spec, *, checkout, peer, selections=(), java=None, node=None, git_metadata=False,
            memory_mib=None, memory_reserve_mib=256, memory_reservations_root=None,
            memory_reclaim="none", memory_storage="included", disk_space=(), disk_inodes=(), disk_reserve_mib=64,
            disk_reserve_inodes=128, disk_reservations_root=None,
            runtime_paths=(), runtime_consumers_root=None):
    portable = cloud_spec(spec)
    if (any(portable.get(field) for field in ("artifact_success_paths", "artifact_failure_paths")) and
            getattr(native, "NATIVE_ARTIFACT_SELECTION_SCHEMA", None) != "commons.native-artifact-selection/v1"):
        raise ValueError("Install the original outcome-aware native artifact selection capability")
    memory = memory_profile(memory_mib, memory_reserve_mib, memory_reservations_root,
                            memory_reclaim, memory_storage)
    runtime = runtime_profile(runtime_paths, runtime_consumers_root)
    output_paths = [path for field in ("artifact_paths", "artifact_success_paths", "artifact_failure_paths")
                    for path in portable.get(field, [])]
    if not output_paths:
        raise ValueError("Offloaded delivery requires explicit output artifact paths.")
    for name in output_paths:
        portable_path(name)
    selected = sorted(set(portable_path(p) for p in selections))
    if git_metadata and selected:
        raise ValueError("Git-aware builders require the complete source tree; omit source selections.")
    if any(any(c in p for c in "*?[") for p in selected):
        raise ValueError("Source selections must be literal committed paths.")
    if not re.fullmatch(r"[A-Za-z0-9][A-Za-z0-9_.-]{0,79}", peer):
        raise ValueError("Supply the original worker's portable peer identifier.")
    checkout = Path(checkout).resolve(strict=True)
    root = native.run_path(portable["operation_id"])
    disk = disk_profile(disk_space, disk_inodes, disk_reserve_mib, disk_reserve_inodes,
                        disk_reservations_root, project=root / "project")
    intent = {"portable": portable, "peer": peer, "selection": selected,
              "java": java, "node": node, "git_metadata": bool(git_metadata)}
    if memory is not None:
        intent["memory"] = memory
    if disk is not None:
        intent["disk"] = disk
    intent.update(runtime)
    with native.run_lock(root):
        existing = native.read_json(root / "offload.json")
        if existing:
            if existing.get("intent") != intent:
                original = existing.get("intent", {})
                same_source = ({key: value for key, value in original.items() if key not in ("memory", "disk")} ==
                               {key: value for key, value in intent.items() if key not in ("memory", "disk")})
                effective = capacity_for_native_start(existing, native.read_json(root / "request.json")) if same_source else None
                if not same_source or any(intent.get(key) not in (original.get(key), value)
                        for key, value in zip(("memory", "disk"), effective)):
                    raise ValueError("This operation ID already records a different immutable job or worker profile.")
        elif native.read_json(root / "request.json"):
            raise ValueError("The native worker already owns this operation; preserve its original caller.")
        else:
            native.save_json(root / "offload.json", {"schema": SCHEMA, "intent": intent,
                             "created_at": native.now(), "preparer": native.process_identity(os.getpid())})
        if not (root / "project").exists():
            if native.read_json(root / "request.json"):
                raise ValueError("The native execution lost its source; reconcile the original operation before new work.")
            binding = native.read_json(root / "offload.json")
            native.save_json(root / "offload.json", {**binding, "preparer": native.process_identity(os.getpid())})
            copy_source(checkout, portable, selected, root, git_metadata=git_metadata)
        source = native.read_json(root / "offload-source.json")
        if not source or source["head"] != portable["head"] or source["repo"] != portable["repo"]:
            raise ValueError("Retained source identity differs from its offload operation.")
    return root


def runtime_profile(paths=(), registry_root=None):
    if isinstance(paths, (list, tuple)) and not paths and registry_root is None:
        return {}
    if getattr(native, "RUNTIME_CONSUMERS_SCHEMA", None) != "commons.native-runtime-use/v1":
        raise ValueError("Install the original worker's shared runtime consumer capability")
    if __package__:
        from .runtime_consumers import declaration_options
    else:
        from runtime_consumers import declaration_options
    return declaration_options(paths, registry_root)


def retained_runtime(binding):
    selected = {key: binding[key] for key in ("runtime_paths", "runtime_consumers_root") if key in binding}
    canonical = runtime_profile(selected.get("runtime_paths", ()), selected.get("runtime_consumers_root"))
    if selected != canonical:
        raise ValueError("The retained shared runtime declaration changed")
    return canonical


def retained_memory(binding):
    memory = binding.get("memory")
    if memory is not None and memory_profile(memory["peak_bytes"] // (1024 * 1024),
            memory["reserve_bytes"] // (1024 * 1024), memory["ledger_root"],
            memory.get("reclaim_mode", "none"), memory.get("storage_mode", "included")) != memory:
        raise ValueError("The original memory binding differs from its canonical native specification.")
    return memory


def capacity_for_native_start(binding, request):
    """Join original memory and disk histories without replacing the binding.

    Only continuous explicit amendment histories change effective capacity.
    Source, command and worker profile remain the bound originals.
    This pure join is also used before publishing an offload-backed amendment.
    """
    if not isinstance(binding, dict) or binding.get("schema") != SCHEMA:
        raise ValueError("Select the complete original offload binding")
    original = binding["intent"]
    memory = retained_memory(original)
    disk = retained_disk(original)
    if request is None:
        return memory, disk
    portable = original["portable"]
    command = portable["argv"]
    if command and command[0] == "--":
        command = command[1:]
    expected = {"operation_id": portable["operation_id"], "command": command,
                "peer": original["peer"], "java": original["java"], "node": original["node"],
                "artifacts": sorted(set(Path(value).as_posix() for value in portable["artifact_paths"]))}
    expected.update(retained_runtime(original))
    current = request.get("intent", {})
    checked = current
    if request.get("placement_amendments"):
        if __package__:
            from .native_handoff_placement import original_intent
        else:
            from native_handoff_placement import original_intent
        checked = original_intent(request)
    if request.get("schema") != native.SCHEMA or any(checked.get(key) != value for key, value in expected.items()):
        raise ValueError("The native request differs from its original offload command or profile")
    history = request.get("memory_amendments", [])
    if not isinstance(history, list):
        raise ValueError("Preserve the original native memory amendment history")
    seen = set()
    for event in history:
        if not isinstance(event, dict) or not isinstance(memory, dict):
            raise ValueError("The original offload has no coherent memory amendment chain")
        identity = event.get("amendment_id")
        changes = event.get("changes")
        if (not isinstance(identity, str) or not re.fullmatch(r"[A-Za-z0-9_.-]{1,128}", identity)
                or identity in seen or event.get("command_previously_started") is not False
                or not isinstance(changes, dict) or set(changes) not in (
                    {"memory_mib", "reserve_mib", "reclaim_mode"},
                    {"memory_mib", "reserve_mib", "reclaim_mode", "storage_mode"})):
            raise ValueError("The native memory amendment identity or declaration is invalid")
        seen.add(identity)
        reserve = changes["reserve_mib"]
        reclaim = changes["reclaim_mode"]
        storage = changes.get("storage_mode")
        updated = memory_profile(changes["memory_mib"],
            memory["reserve_bytes"] // (1024 * 1024) if reserve is None else reserve,
            memory["ledger_root"], memory.get("reclaim_mode", "none") if reclaim is None else reclaim,
            memory.get("storage_mode", "included") if storage is None else storage)
        if __package__:
            from .cloud_memory import memory_intent_sha256
        else:
            from cloud_memory import memory_intent_sha256
        if (event.get("previous") != memory or event.get("previous_sha256") != memory_intent_sha256(memory)
                or event.get("next") != updated or event.get("next_sha256") != memory_intent_sha256(updated)
                or updated == memory):
            raise ValueError("The original offload memory amendment chain is discontinuous")
        memory = updated
    if current.get("memory") != memory:
        raise ValueError("The native memory request is not the original offload declaration or its recorded amendment")
    history = request.get("disk_amendments", [])
    if not isinstance(history, list):
        raise ValueError("Preserve the original native disk amendment history")
    seen = set()
    for event in history:
        if not isinstance(event, dict) or not isinstance(disk, dict):
            raise ValueError("The original offload has no coherent disk amendment chain")
        identity = event.get("amendment_id")
        changes = event.get("changes")
        if (not isinstance(identity, str) or not re.fullmatch(r"[A-Za-z0-9_.-]{1,128}", identity)
                or identity in seen or event.get("command_previously_started") is not False
                or not isinstance(changes, dict)
                or set(changes) != {"disk_space", "disk_inodes", "reserve_mib", "reserve_inodes"}):
            raise ValueError("The native disk amendment identity or declaration is invalid")
        seen.add(identity)
        if __package__:
            from .cloud_disk import amended_specification, disk_intent_sha256
        else:
            from cloud_disk import amended_specification, disk_intent_sha256
        updated = amended_specification(disk, **changes)
        if (event.get("previous") != disk or event.get("previous_sha256") != disk_intent_sha256(disk)
                or event.get("next") != updated or event.get("next_sha256") != disk_intent_sha256(updated)
                or updated == disk):
            raise ValueError("The original offload disk amendment chain is discontinuous")
        disk = updated
    if current.get("disk") != disk:
        raise ValueError("The native disk request is not the original offload declaration or its recorded amendment")
    return memory, disk


def memory_for_native_start(binding, request):
    """Keep the original memory reader compatible with both amendment chains."""
    return capacity_for_native_start(binding, request)[0]


def disk_for_native_start(binding, request):
    """Read the effective disk declaration for the same prepared native job."""
    return capacity_for_native_start(binding, request)[1]


def retained_disk(binding):
    disk = binding.get("disk")
    if disk is not None:
        spaces = [row["path"] + "=" + str(row["bytes"] // (1024 * 1024))
                  for row in disk["paths"] if row["bytes"]]
        inodes = [row["path"] + "=" + str(row["inodes"])
                  for row in disk["paths"] if row["inodes"]]
        if disk_profile(spaces, inodes, disk["reserve_bytes"] // (1024 * 1024),
                        disk["reserve_inodes"], disk["ledger_root"]) != disk:
            raise ValueError("The original disk binding differs from its canonical native specification.")
    return disk


def native_start(root, *, launcher=None):
    original = native.read_json(root / "offload.json")
    binding = original["intent"]
    spec = binding["portable"]
    args = SimpleNamespace(operation_id=spec["operation_id"], peer=binding["peer"],
        project=str(root / "project"), command=spec["argv"], artifact=spec["artifact_paths"],
        java=binding["java"], node=binding["node"])
    conditions = {group: spec.get("artifact_" + group + "_paths", []) for group in ("success", "failure")}
    if any(conditions.values()):
        if getattr(native, "NATIVE_ARTIFACT_SELECTION_SCHEMA", None) != "commons.native-artifact-selection/v1":
            raise ValueError("Install the original outcome-aware native artifact selection capability")
        args.artifact_on_success = conditions["success"]
        args.artifact_on_failure = conditions["failure"]
    runtime = retained_runtime(binding)
    if "runtime_paths" in runtime:
        args.runtime_path = runtime["runtime_paths"]
    if "runtime_consumers_root" in runtime:
        args.runtime_consumers_root = runtime["runtime_consumers_root"]
    request = native.read_json(root / "request.json")
    memory, disk = capacity_for_native_start(original, request)
    if request and request.get("placement_amendments"):
        current = request["intent"]
        args.project, args.command = current["project"], current["command"]
        args.worker_root = current.get("worker_root")
        args.temp_root = current.get("temp_root")
        args.runtime_path = current.get("runtime_paths", [])
        args.retain_artifacts = current.get("retain_artifacts", False)
    if memory is not None:
        args.memory_mib = memory["peak_bytes"] // (1024 * 1024)
        args.memory_reserve_mib = memory["reserve_bytes"] // (1024 * 1024)
        args.memory_reservations_root = memory["ledger_root"]
        args.memory_reclaim = memory.get("reclaim_mode", "none")
        args.memory_storage = memory.get("storage_mode", "included")
    if disk is not None:
        args.disk_space = [row["path"] + "=" + str(row["bytes"] // (1024 * 1024))
                           for row in disk["paths"] if row["bytes"]]
        args.disk_inodes = [row["path"] + "=" + str(row["inodes"])
                            for row in disk["paths"] if row["inodes"]]
        args.disk_reserve_mib = disk["reserve_bytes"] // (1024 * 1024)
        args.disk_reserve_inodes = disk["reserve_inodes"]
        args.disk_reservations_root = disk["ledger_root"]
    return native.start(args) if launcher is None else native.start(args, launcher=launcher)


def native_resume_memory(root, *, launcher=None, recover_failure=None):
    original = native.read_json(root / "offload.json")
    if memory_for_native_start(original, native.read_json(root / "request.json")) is None:
        raise ValueError("This original offload operation has no memory admission request.")
    resume = getattr(native, "resume_memory", None)
    if not callable(resume):
        raise ValueError("Install the original supervisor's queued-memory recovery before resuming this operation.")
    options = {} if launcher is None else {"launcher": launcher}
    if recover_failure is not None:
        if getattr(native, "CAPACITY_FAILURE_RECOVERY_SCHEMA", None) != "commons.native-capacity-failure-recovery/v1":
            raise ValueError("Install the original explicit pre-dispatch failure recovery capability")
        options["recover_failure"] = recover_failure
    return resume(root, **options)


def native_resume_capacity(root, *, launcher=None, recover_failure=None):
    original = native.read_json(root / "offload.json")
    memory, disk = capacity_for_native_start(original, native.read_json(root / "request.json"))
    if memory is None and disk is None:
        raise ValueError("This original offload operation has no capacity admission request.")
    resume = getattr(native, "resume_capacity", None)
    if not callable(resume):
        raise ValueError("Install the original supervisor's capacity recovery before resuming this operation.")
    options = {} if launcher is None else {"launcher": launcher}
    if recover_failure is not None:
        if getattr(native, "CAPACITY_FAILURE_RECOVERY_SCHEMA", None) != "commons.native-capacity-failure-recovery/v1":
            raise ValueError("Install the original explicit pre-dispatch failure recovery capability")
        options["recover_failure"] = recover_failure
    return resume(root, **options)


def native_acknowledgement(root, action, *, recover_failure=None):
    # Both initial launch and explicit queued recovery use the original runtime
    # profile; reconnecting callers cannot add credentials to the command env.
    command = [sys.executable, "-B", str(Path(__file__).resolve()), action, str(root)]
    if recover_failure is not None:
        command.extend(["--recover-failure", recover_failure])
    worker = subprocess.run(command, stdout=subprocess.PIPE, stderr=subprocess.PIPE,
        env=clean_environment(), timeout=30, check=False)
    if worker.returncode or len(worker.stdout) > 32768:
        raise RuntimeError("Native acknowledgement unavailable; inspect this operation ID, do not create another job.")
    return json.loads(worker.stdout)


def resume_memory(operation_id, *, launcher=None, recover_failure=None):
    root, _ = load_binding(operation_id)
    acknowledgement = (native_acknowledgement(root, "_native-resume-memory", recover_failure=recover_failure) if launcher is None
                       else native_resume_memory(root, launcher=launcher, recover_failure=recover_failure))
    return {**describe(operation_id, reused=True),
            "resumed": acknowledgement.get("resumed", False)}


def resume_capacity(operation_id, *, launcher=None, recover_failure=None):
    root, _ = load_binding(operation_id)
    acknowledgement = (native_acknowledgement(root, "_native-resume-capacity", recover_failure=recover_failure) if launcher is None
                       else native_resume_capacity(root, launcher=launcher, recover_failure=recover_failure))
    return {**describe(operation_id, reused=True),
            "resumed": acknowledgement.get("resumed", False)}


def submit(spec, *, checkout, peer, selections=(), java=None, node=None, git_metadata=False,
           memory_mib=None, memory_reserve_mib=256, memory_reservations_root=None,
           memory_reclaim="none", memory_storage="included", disk_space=(), disk_inodes=(), disk_reserve_mib=64,
           disk_reserve_inodes=128, disk_reservations_root=None, launcher=None,
           runtime_paths=(), runtime_consumers_root=None):
    root = prepare(spec, checkout=checkout, peer=peer, selections=selections, java=java, node=node,
                   git_metadata=git_metadata, memory_mib=memory_mib,
                   memory_reserve_mib=memory_reserve_mib,
                   memory_reservations_root=memory_reservations_root,
                   memory_reclaim=memory_reclaim, memory_storage=memory_storage,
                   disk_space=disk_space, disk_inodes=disk_inodes,
                   disk_reserve_mib=disk_reserve_mib, disk_reserve_inodes=disk_reserve_inodes,
                   disk_reservations_root=disk_reservations_root,
                   runtime_paths=runtime_paths, runtime_consumers_root=runtime_consumers_root)
    # An already isolated foreground driver retains its own original process;
    # ordinary callers keep the existing clean-environment acknowledgement.
    acknowledgement = (native_acknowledgement(root, "_native-start") if launcher is None
                       else native_start(root, launcher=launcher))
    return describe(cloud_spec(spec)["operation_id"],
                    reused=acknowledgement.get("reused", False))


def hash_file(path):
    digest = hashlib.sha256()
    size = 0
    with path.open("rb") as stream:
        for block in iter(lambda: stream.read(256 * 1024), b""):
            digest.update(block)
            size += len(block)
    return size, digest.hexdigest()


def finish_artifacts(root, binding):
    """Package only the original worker's selected, hash-matched outputs."""
    with native.run_lock(root):
        from native_artifact_selection import current_revision
        revision = current_revision(root)
        retained = native.read_json(root / "offload-delivery.json")
        if retained and retained.get("artifact_selection_revision", 0) == revision:
            size, digest = hash_file(root / "delivery.zip")
            if size != retained["bytes"] or digest != retained["sha256"]:
                raise ValueError("Retained delivery was changed; preserve the original operation record.")
            return retained
        manifest = native.read_json(root / "artifacts.json")
        if not manifest or manifest["errors"] or not manifest["files"]:
            raise ValueError("The command's selected output artifacts are incomplete.")
        if (manifest.get("artifact_selection") or {}).get("revision", 0) != revision:
            raise ValueError("Finalize the retained artifact selection before requesting its delivery")
        result = native.read_json(root / "result.json") or {}
        if result.get("state") not in ("completed", "failed") or type(result.get("exit_code")) is not int:
            raise ValueError("The original command outcome is not finalized")
        request = native.read_json(root / "request.json")
        capacity_for_native_start(binding, request)
        project = Path(request["intent"]["project"])
        descriptor, name = tempfile.mkstemp(prefix=".delivery-", dir=root)
        os.close(descriptor)
        pending = Path(name)
        spec = binding["intent"]["portable"]
        try:
            with zipfile.ZipFile(pending, "w", compression=zipfile.ZIP_DEFLATED) as archive:
                for entry in manifest["files"]:
                    relative = portable_path(entry["path"])
                    if relative == ".commons/offload-manifest.json":
                        raise ValueError("Artifact name collides with the delivery manifest.")
                    if entry.get("retained") is True:
                        from native_artifact_retention import open_retained
                        fd = open_retained(root, request, manifest, entry)
                    else:
                        native.artifact_paths(project, [relative])
                        source = project / relative
                        fd = os.open(source, os.O_RDONLY | getattr(os, "O_NOFOLLOW", 0) | os.O_NONBLOCK)
                    digest, size = hashlib.sha256(), 0
                    with os.fdopen(fd, "rb") as stream:
                        before = os.fstat(stream.fileno())
                        if not stat.S_ISREG(before.st_mode):
                            raise ValueError("Selected artifact is no longer a regular file.")
                        info = zipfile.ZipInfo(relative)
                        info.compress_type = zipfile.ZIP_DEFLATED
                        info.external_attr = (stat.S_IFREG | (0o755 if entry.get("mode", before.st_mode) & 0o111 else 0o644)) << 16
                        with archive.open(info, "w", force_zip64=True) as output:
                            for block in iter(lambda: stream.read(256 * 1024), b""):
                                output.write(block)
                                digest.update(block)
                                size += len(block)
                        after = os.fstat(stream.fileno())
                        if ((before.st_size, before.st_mtime_ns, before.st_ino) !=
                                (after.st_size, after.st_mtime_ns, after.st_ino) or
                                size != entry["bytes"] or digest.hexdigest() != entry["sha256"]):
                            raise ValueError("Artifact changed after its original native result; no delivery was published.")
                archive.writestr(".commons/offload-manifest.json", json.dumps({
                    "schema": SCHEMA, "operation_id": spec["operation_id"], "repo": spec["repo"],
                    "head": spec["head"], "source_selection": binding["intent"]["selection"],
                    "exit_code": result["exit_code"], "files": manifest["files"],
                    **({"artifact_selection": manifest["artifact_selection"]}
                       if manifest.get("artifact_selection") is not None else {})}, indent=2) + "\n")
            with pending.open("rb") as stream:
                os.fsync(stream.fileno())
            size, digest = hash_file(pending)
            pending.replace(root / "delivery.zip")
            retained = {"artifact_handle": str(root / "delivery.zip"), "bytes": size,
                        "sha256": digest, "files": len(manifest["files"]), "created_at": native.now(),
                        "artifact_selection_revision": revision, "exit_code": result["exit_code"]}
            native.save_json(root / "offload-delivery.json", retained)
            return retained
        finally:
            pending.unlink(missing_ok=True)


def describe(operation_id, *, reused=None):
    root, binding = load_binding(operation_id)
    if not native.read_json(root / "request.json"):
        preparing = native.alive(binding.get("preparer"))
        return {"schema": SCHEMA, "operation_id": operation_id, "job_id": root.name,
                "status": "queued" if preparing else "failed", "record": str(root),
                "native_state": "preparing" if preparing else "preparation_interrupted",
                "command_started": False}
    report = native.inspect(root)
    result = {"schema": SCHEMA, "operation_id": operation_id, "job_id": root.name,
              "native_state": report["state"], "record": str(root), "log": report["log"],
              "repo": binding["intent"]["portable"]["repo"],
              "head": binding["intent"]["portable"]["head"],
              "command_started": native.read_json(root / "process.json") is not None}
    if report.get("memory_admission") is not None:
        result["memory_admission"] = report["memory_admission"]
    if report.get("disk_admission") is not None:
        result["disk_admission"] = report["disk_admission"]
    if report.get("runtime_use") is not None:
        result["runtime_use"] = report["runtime_use"]
    if report.get("completion") is not None:
        result["completion"] = report["completion"]
    if reused is not None:
        result["reused"] = reused
    state = report["state"]
    if state in ("launch_pending", "starting", "queued_memory", "queued_disk"):
        result["status"] = "queued"
    elif state in ("running", "orphaned_running", "finalizing"):
        result["status"] = "running"
    elif ((state == "completed" and report.get("exit_code") == 0) or
          (state == "failed" and type(report.get("exit_code")) is int and
           (report.get("artifacts") or {}).get("files") and not report["artifacts"].get("errors"))):
        try:
            delivery = finish_artifacts(root, binding)
        except (OSError, ValueError) as exc:
            result.update(status="failed", exit_code=report["exit_code"], delivery_error=type(exc).__name__)
            if isinstance(exc, ValueError):
                result["delivery_detail"] = str(exc)
        else:
            result.update(status="completed" if report["exit_code"] == 0 else "failed",
                          **{**delivery, "exit_code": report["exit_code"]})
    else:
        result["status"] = "failed"
        if type(report.get("exit_code")) is int:
            result["exit_code"] = report["exit_code"]
        result["error"] = report.get("error", state)
    return result


def main(argv=None):
    argv = list(sys.argv[1:] if argv is None else argv)
    if argv and argv[0] in ("_native-start", "_native-resume-memory", "_native-resume-capacity"):
        if len(argv) not in (2, 4) or (len(argv) == 4 and (argv[2] != "--recover-failure" or argv[0] == "_native-start")):
            raise ValueError("Select the original native action and optional failed-result SHA-256")
        options = {} if len(argv) == 2 else {"recover_failure": argv[3]}
        action = {"_native-start": native_start, "_native-resume-memory": native_resume_memory,
                  "_native-resume-capacity": native_resume_capacity}[argv[0]]
        print(json.dumps(action(Path(argv[1]).resolve(), **options)))
        return 0
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--state-root", type=Path,
                        help="Existing native-worker state root, outside source checkouts")
    subs = parser.add_subparsers(dest="action", required=True)
    for action in ("submit", "run"):
        launch = subs.add_parser(action)
        launch.add_argument("--checkout", required=True, type=Path)
        launch.add_argument("--peer", required=True)
        launch.add_argument("--source-path", action="append", default=[])
        launch.add_argument("--java", choices=("17", "21"))
        launch.add_argument("--node", choices=("18", "24"))
        launch.add_argument("--git-metadata", action="store_true",
                            help="Retain only the pinned Git object graph for original Git-aware builders")
        launch.add_argument("--memory-mib", type=int,
                            help="declared peak MiB; original supervisor waits for memory before dispatch")
        launch.add_argument("--memory-reserve-mib", type=int, default=256,
                            help="shared control-plane headroom retained by native memory admission")
        launch.add_argument("--memory-reservations-root",
                            help="same shared VM memory reservation directory used by other jobs")
        launch.add_argument("--memory-reclaim", choices=("none", "clean-cache"), default="none")
        launch.add_argument("--memory-storage", choices=("included", "additional"), default="included",
                            help="whole-operation envelope by default; explicit process-only peak adds declared tmpfs growth")
        launch.add_argument("--runtime-path", action="append", default=[],
                            help="explicit shared runtime file or directory on this equipped cloud host; repeat as needed")
        launch.add_argument("--runtime-consumers-root",
                            help="existing shared runtime-consumer registry used by other jobs and cache retirement")
        launch.add_argument("--disk-space", action="append", default=[], metavar="PATH=MIB",
                            help="additional command output MiB; relative paths belong to the materialized project")
        launch.add_argument("--disk-inodes", action="append", default=[], metavar="PATH=COUNT",
                            help="additional output inodes; relative paths belong to the materialized project")
        launch.add_argument("--disk-reserve-mib", type=int, default=64)
        launch.add_argument("--disk-reserve-inodes", type=int, default=128)
        launch.add_argument("--disk-reservations-root", "--disk-ledger-root", dest="disk_reservations_root",
                            help="same shared VM disk reservation directory used by other jobs")
    for action in ("status", "logs", "stop", "resume-memory", "resume-capacity"):
        command = subs.add_parser(action)
        command.add_argument("operation_id")
        if action == "logs":
            command.add_argument("--offset", type=int, default=0)
            command.add_argument("--follow", action="store_true")
        if action in ("resume-memory", "resume-capacity"):
            command.add_argument("--follow", action="store_true",
                                 help="retain the foreground owner while this original queued operation continues")
            command.add_argument("--recover-failure", metavar="SHA256",
                                 help="explicitly recover the exact retained pre-dispatch failed result")
    args = parser.parse_args(argv)
    if args.state_root:
        os.environ["SWARM_STATE_ROOT"] = str(args.state_root.expanduser().resolve())
    try:
        if args.action in ("submit", "run"):
            raw = sys.stdin.buffer.read(65537)
            if len(raw) > 65536:
                raise ValueError("Job envelope exceeds 64 KiB.")
            result = submit(json.loads(raw), checkout=args.checkout, peer=args.peer,
                            selections=args.source_path, java=args.java, node=args.node,
                            git_metadata=args.git_metadata, memory_mib=args.memory_mib,
                            memory_reserve_mib=args.memory_reserve_mib,
                            memory_reservations_root=args.memory_reservations_root,
                            memory_reclaim=args.memory_reclaim, memory_storage=args.memory_storage,
                            disk_space=args.disk_space,
                            disk_inodes=args.disk_inodes, disk_reserve_mib=args.disk_reserve_mib,
                            disk_reserve_inodes=args.disk_reserve_inodes,
                            disk_reservations_root=args.disk_reservations_root,
                            runtime_paths=args.runtime_path, runtime_consumers_root=args.runtime_consumers_root)
            if args.action == "run":
                print(json.dumps(result), file=sys.stderr, flush=True)
                root, _ = load_binding(result["operation_id"])
                report, offset = native.stream_log(root, follow=True)
                result = {**describe(result["operation_id"]), "next_log_offset": offset}
                print(json.dumps(result), file=sys.stderr, flush=True)
                return 0 if result["status"] == "completed" else native.exit_status(report) or 1
        else:
            root, _ = load_binding(args.operation_id)
            if args.action in ("resume-memory", "resume-capacity"):
                if args.follow and args.recover_failure is not None:
                    from native_foreground import resume_foreground
                    memory_for_native_start(native.read_json(root / "offload.json"), native.read_json(root / "request.json"))
                    acknowledgement = resume_foreground(native, args.operation_id, str(root.parent),
                        action=args.action, recover_failure=args.recover_failure)
                    result = {**describe(args.operation_id, reused=True), "resumed": acknowledgement.get("resumed", False)}
                else:
                    resume = resume_memory if args.action == "resume-memory" else resume_capacity
                    result = resume(args.operation_id, recover_failure=args.recover_failure)
                if args.follow:
                    print(json.dumps(result), file=sys.stderr, flush=True)
                    report, offset = native.stream_log(root, follow=True)
                    result = {**describe(args.operation_id), "next_log_offset": offset,
                              "reused": True, "resumed": result["resumed"]}
                    print(json.dumps(result), file=sys.stderr, flush=True)
                    return 0 if result["status"] == "completed" else native.exit_status(report) or 1
                print(json.dumps(result, sort_keys=True))
                return 0
            if args.action == "logs":
                if args.offset < 0:
                    raise ValueError("Log offset must be nonnegative.")
                report, offset = native.stream_log(root, offset=args.offset, follow=args.follow)
                result = {**describe(args.operation_id), "next_log_offset": offset}
                print(json.dumps(result), file=sys.stderr)
                return native.exit_status(report) if args.follow else 0
            if args.action == "stop":
                stopped = native.stop(root)
                result = {**describe(args.operation_id), "stop_requested": stopped.get("stop_requested", False)}
            else:
                result = describe(args.operation_id)
        print(json.dumps(result, sort_keys=True))
        # A valid failed acknowledgement is still an acknowledgement. The
        # original run_bounded caller interprets status without resubmission.
        return 0
    except (OSError, ValueError, KeyError, RuntimeError, subprocess.TimeoutExpired) as exc:
        print(json.dumps({"ok": False, "error": type(exc).__name__,
                          "message": str(exc) if isinstance(exc, ValueError) else
                          "Operation incomplete; inspect its retained native record."}), file=sys.stderr)
        return 2


if __name__ == "__main__":
    raise SystemExit(main())
