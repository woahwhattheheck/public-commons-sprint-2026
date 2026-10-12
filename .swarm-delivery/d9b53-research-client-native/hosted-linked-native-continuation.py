#!/usr/bin/env python3
"""Continue the original NCC case from its saved, undispatched source checkpoint."""
from __future__ import annotations
import base64, datetime, fcntl, gc, hashlib, importlib.util, json, os, shutil, stat, subprocess, uuid
import sys, tarfile, termios, time, urllib.parse, urllib.request, errno
from pathlib import Path, PurePosixPath

BUSINESS = "SCF-RESEARCH-CLIENT-NCC-D9B53-20261012"
NATIVE_ID = BUSINESS + "-CONTINUATION-01"
ROOT = Path("/dev/research-original-d9b53-20261012")
OLD_RECORD = "afcbd27354ac49caef9d4bd81b64256b55bbbe1892b04dd08265929708ffba9d"
CHECKPOINT = {"bytes": 13190478, "sha256": "0fb2bef1bcbbec1a9717df8f27539e4c2015431088b6f37a27684a60b7134b20"}
KEEPER_SHA = "f8f57631eb579b4f887b2762203ca7c63c3ddd44bc3fb83e7b62aadf3d20e758"
SOURCE_SHA = "32a883db529f16e83cf863ee2dd6ca2118a2d2e7a59157fb24e1b5c40fcfb6b7"
OLD_POINTER_SHA = "fe3603f09b3c85be56ccb9f58fb82439af080b4eaa18c803b29a2e4cef15982e"
HELPER = Path("/dev/shm/crossref-workspace-d9b5/library-save-jj3jcjwu")
os.umask(0o077)
if sys.stdin.isatty():
    mode = termios.tcgetattr(sys.stdin.fileno())
    mode[3] &= ~(termios.ECHO | termios.ICANON)
    termios.tcsetattr(sys.stdin.fileno(), termios.TCSANOW, mode)

def now():
    return datetime.datetime.now(datetime.timezone.utc).isoformat()

def emit(value):
    print(json.dumps(value, ensure_ascii=False, separators=(",", ":")), flush=True)

def need(value, message):
    if not value:
        raise RuntimeError(message)

def digest(data):
    return hashlib.sha256(data).hexdigest()

def fingerprint(path):
    fd = os.open(path, os.O_RDONLY | os.O_NOFOLLOW)
    h = hashlib.sha256()
    with os.fdopen(fd, "rb") as stream:
        before = os.fstat(stream.fileno())
        need(stat.S_ISREG(before.st_mode), "Selected source must be an ordinary file")
        for block in iter(lambda: stream.read(1024 * 1024), b""):
            h.update(block)
        after = os.fstat(stream.fileno())
    fields = ("st_dev", "st_ino", "st_size", "st_mtime_ns", "st_ctime_ns")
    need(all(getattr(before, k) == getattr(after, k) for k in fields),
         "Selected source changed during observation")
    return {"bytes": after.st_size, "sha256": h.hexdigest()}

def write(path, data):
    path = Path(path)
    path.parent.mkdir(parents=True, exist_ok=True, mode=0o700)
    fd = os.open(path, os.O_WRONLY | os.O_CREAT | os.O_EXCL | os.O_NOFOLLOW, 0o600)
    with os.fdopen(fd, "wb") as stream:
        stream.write(data)
        stream.flush()
        os.fsync(stream.fileno())

def write_json(path, value):
    write(path, (json.dumps(value, ensure_ascii=False, sort_keys=True, indent=2) + "\n").encode())


def mirror(path, data):
    """Keep optional cross-owner observations without risking the original result."""
    path = Path(path)
    pending = None
    try:
        available = os.statvfs(shared).f_bavail * os.statvfs(shared).f_frsize
        if available < len(data) + 4096:
            emit({"state": "original-observation-retained-private", "path": str(path),
                  "bytes": len(data), "sha256": digest(data), "sharedAvailableBytes": available})
            return False
        path.parent.mkdir(parents=True, exist_ok=True, mode=0o700)
        if path.exists():
            need(ordinary(path) == data, "An immutable shared observation changed")
            return True
        pending = path.with_name(path.name + ".pending-" + uuid.uuid4().hex)
        write(pending, data)
        os.link(pending, path, follow_symlinks=False)
        return True
    except OSError as error:
        if error.errno not in (errno.ENOSPC, errno.EDQUOT):
            raise
        emit({"state": "original-observation-retained-private", "path": str(path),
              "bytes": len(data), "sha256": digest(data), "reason": "shared-space"})
        return False
    finally:
        if pending is not None:
            pending.unlink(missing_ok=True)

def mirror_json(path, value):
    return mirror(path, (json.dumps(value, ensure_ascii=False, sort_keys=True, indent=2) + "\n").encode())

def ordinary(path):
    fd = os.open(path, os.O_RDONLY | os.O_NOFOLLOW)
    with os.fdopen(fd, "rb") as stream:
        need(stat.S_ISREG(os.fstat(stream.fileno()).st_mode), "Selected input is not ordinary")
        return stream.read()

def relative(name):
    p = PurePosixPath(name)
    need(isinstance(name, str) and name and str(p) == name
         and not p.is_absolute() and "\\" not in name
         and all(part not in ("", ".", "..") for part in p.parts), "Unsafe checkpoint member")
    return p

emit({"state": "awaiting-linked-continuation-input", "operationId": BUSINESS,
      "nativeOperationId": NATIVE_ID, "directory": str(ROOT), "pid": os.getpid()})
payload = globals().get("INPUT_PAYLOAD")
if payload is None:
    payload = json.loads(sys.stdin.readline())
need(payload.get("schema") == "sf88.research-client.linked-native-continuation-input.v1",
     "Use the selected complete linked continuation input")
need(payload.get("operationId") == BUSINESS and payload.get("nativeOperationId") == NATIVE_ID,
     "Preserve the original case and selected native continuation")
need(payload.get("checkpoint") == CHECKPOINT, "The original saved checkpoint differs")

def selected_directory(value, label, *, allow_new=False):
    need(isinstance(value, str) and value and Path(value).is_absolute(),
         label + " must be an absolute directory selected on the receiving host")
    path = Path(value)
    if path.exists():
        resolved = path.resolve(strict=True)
        need(stat.S_ISDIR(resolved.lstat().st_mode), label + " is not a directory")
        return resolved
    need(allow_new and path.name not in ("", ".", ".."),
         label + " does not exist on the receiving host")
    parent = path.parent.resolve(strict=True)
    need(stat.S_ISDIR(parent.lstat().st_mode), label + " parent is not a directory")
    return parent / path.name

host_binding = payload.get("hostBinding")
selected_observation_root = Path("/dev/shm/d9b53-research-original-continuation-01")
if host_binding is not None:
    required = {"schema", "node", "sharedControl", "helperDirectory"}
    allowed = required | {"observationDirectory"}
    need(isinstance(host_binding, dict) and required <= set(host_binding)
         and set(host_binding) <= allowed
         and host_binding["schema"] == "sf88.research-client.native-host-binding.v1",
         "Use the complete original native host-binding selection")
    selected_node = host_binding["node"]
    need(isinstance(selected_node, str) and Path(selected_node).is_absolute(),
         "Select the actual absolute Node executable")
    selected_node = Path(selected_node).resolve(strict=True)
    need(stat.S_ISREG(selected_node.lstat().st_mode) and os.access(selected_node, os.X_OK),
         "The selected Node executable is unavailable")
    selected_control = selected_directory(host_binding["sharedControl"], "Existing shared control")
    HELPER = selected_directory(host_binding["helperDirectory"], "Existing Library helper")
    need((HELPER / "library_upload.py").is_file(), "The original Library helper is unavailable")
    selected_observation_root = selected_directory(
        host_binding.get("observationDirectory", str(selected_observation_root)),
        "Original continuation observations", allow_new=True)
    host_binding = {
        "schema": "sf88.research-client.native-host-binding.v1",
        "node": str(selected_node), "sharedControl": str(selected_control),
        "helperDirectory": str(HELPER), "observationDirectory": str(selected_observation_root)}
keeper = payload["keeper"].encode("utf-8")
need(len(keeper) == 38913 and digest(keeper) == KEEPER_SHA, "Select the merged complete keeper")
selected_url = urllib.parse.urlsplit(payload["checkpointUrl"])
need(selected_url.scheme == "https" and selected_url.netloc and not selected_url.username
     and not selected_url.password and not selected_url.fragment,
     "Use the original checkpoint's current HTTPS materialization URL")
shared_keeper_dir = (selected_observation_root / "source" if host_binding is not None
                     else Path("/dev/shm/d9b53-native-retention-source"))
shared_keeper_dir.mkdir(parents=True, mode=0o700, exist_ok=True)
need(stat.S_ISDIR(shared_keeper_dir.lstat().st_mode), "Use the original ordinary source sharing directory")
shared_keeper = shared_keeper_dir / "hosted-artifact-retention-f8f57631.py"
if shared_keeper.exists():
    need(fingerprint(shared_keeper) == {"bytes": 38913, "sha256": KEEPER_SHA}, "Shared keeper source differs")
else:
    write(shared_keeper, keeper)
emit({"state": "shared-keeper-source-retained", "path": str(shared_keeper),
      "bytes": 38913, "sha256": KEEPER_SHA})
# Retain the owner control and observed record outside the per-execution /dev
# namespace. This lock owns only this case's continuation, not shared admission.
shared = selected_observation_root
shared.mkdir(mode=0o700, exist_ok=True)
need(stat.S_ISDIR(shared.lstat().st_mode), "Use the original ordinary continuation directory")
owner_lock = os.open(shared / "owner.lock", os.O_RDWR | os.O_CREAT | os.O_NOFOLLOW, 0o600)
fcntl.flock(owner_lock, fcntl.LOCK_EX | fcntl.LOCK_NB)
attempt_id = datetime.datetime.now(datetime.timezone.utc).strftime("%Y%m%dT%H%M%SZ") + "-" + uuid.uuid4().hex[:8]
shared_attempt = shared / "owners" / attempt_id
root_existed = ROOT.exists()
ROOT.mkdir(mode=0o700, exist_ok=True)
need(stat.S_ISDIR(ROOT.lstat().st_mode), "Preserve the original ordinary case directory")
out = ROOT / "continuations/native-01/owners" / attempt_id
out.mkdir(parents=True, mode=0o700)
owner_source = payload["ownerSource"].encode("utf-8")
need({"bytes": len(owner_source), "sha256": digest(owner_source)} == payload["ownerSourceIdentity"],
     "The selected continuation owner source changed")
write(out / "hosted-linked-native-continuation.py", owner_source)
write(out / "hosted-artifact-retention.py", keeper)
# The preceding owner was read back with an unheld original owner lock and
# no record/process. Its exact source remains in Git and the original source
# Canvas; preserve its bytes inside this owner before releasing that closed copy.
previous_source = shared / "owners/20261012T145601Z-2350fb99/hosted-linked-native-continuation.py"
previous_identity = {"bytes": 35929, "sha256": "7970a2532c503a934cca826c7adf9db0caf5bd87e49d50650ec21ba0a4e75d1d"}
previous_custody = {"sessionId": 23266, "source": previous_identity,
                    "repository": "woahwhattheheck/public-commons-sprint-2026",
                    "gitBlob": "2a952df2342886f1d5af082ead2d2a743991102d",
                    "ownerLockHeldBeforeContinuation": False}
if previous_source.is_file() and fingerprint(previous_source) == previous_identity:
    old_stat = previous_source.lstat()
    previous_bytes = ordinary(previous_source)
    need({"bytes": len(previous_bytes), "sha256": digest(previous_bytes)} == previous_identity,
         "The closed previous source changed")
    write(out / "prior-owner-23266.py", previous_bytes)
    current_stat = previous_source.lstat()
    need((old_stat.st_dev, old_stat.st_ino, old_stat.st_mtime_ns, old_stat.st_ctime_ns) ==
         (current_stat.st_dev, current_stat.st_ino, current_stat.st_mtime_ns, current_stat.st_ctime_ns),
         "The closed previous source changed before release")
    previous_source.unlink()
    previous_custody["releasedSharedDuplicate"] = True
else:
    previous_custody["releasedSharedDuplicate"] = False
write_json(out / "prior-owner-23266-source-custody.json", previous_custody)
mirror_json(shared_attempt / "owner-selection.json", {
    "schema": "sf88.research-client.same-native-owner.v1", "operationId": BUSINESS,
    "nativeOperationId": NATIVE_ID, "directory": str(ROOT), "ownerAttemptId": attempt_id,
    "ownerSource": payload["ownerSourceIdentity"], "checkpoint": CHECKPOINT,
    "observedAt": now(), "pid": os.getpid()})
prior = payload.get("priorAttempt")
need(isinstance(prior, dict) and prior.get("sessionId") == 7703
     and prior.get("ownerSourceIdentity") == {
         "bytes": 21703, "sha256": "1fabf4c03f5339f2935d95608a57b89208d5ea273bc6e35b6140c9c6ed2e9b07"},
     "Retain the actual original continuation attempt")
prior_source = prior["ownerSource"].encode("utf-8")
need({"bytes": len(prior_source), "sha256": digest(prior_source)} == prior["ownerSourceIdentity"],
     "The previous continuation source changed")
prior_output = prior["nativeOutput"].encode("utf-8")
need({"bytes": len(prior_output), "sha256": digest(prior_output)} == prior["nativeOutputIdentity"],
     "The observed previous continuation return changed")
write(out / "prior-owner-7703.py", prior_source)
write(out / "prior-owner-7703.stdout", prior_output)
write_json(out / "prior-owner-7703.json", {k: v for k, v in prior.items()
           if k not in ("ownerSource", "nativeOutput")})
mirror(shared_attempt / "prior-owner-7703.stdout", prior_output)
namespace = {"__name__": "hosted_artifact_retention", "__file__": str(out / "hosted-artifact-retention.py")}
exec(compile(keeper, namespace["__file__"], "exec"), namespace)
retain_artifact = namespace["retain_artifact"]
archive_path = out / "original-checkpoint.tar.gz"
request = urllib.request.Request(payload["checkpointUrl"],
                                 headers={"User-Agent": "Commons-Research-Original-Continuation/1"})
with urllib.request.urlopen(request, timeout=30) as response:
    need(urllib.parse.urlsplit(response.geturl()).scheme == "https", "Checkpoint left HTTPS")
    fd = os.open(archive_path, os.O_WRONLY | os.O_CREAT | os.O_EXCL | os.O_NOFOLLOW, 0o600)
    count = 0
    with os.fdopen(fd, "wb") as stream:
        for block in iter(lambda: response.read(1024 * 1024), b""):
            count += len(block)
            need(count <= CHECKPOINT["bytes"], "Checkpoint exceeds its original length")
            stream.write(block)
        stream.flush()
        os.fsync(stream.fileno())
need(fingerprint(archive_path) == CHECKPOINT, "The original saved checkpoint changed")
with tarfile.open(archive_path, "r:gz") as carrier:
    members = carrier.getmembers()
    by_name = {}
    for member in members:
        name = str(relative(member.name))
        need(member.isfile() and not member.issym() and not member.islnk(),
             "Checkpoint requires only ordinary retained files")
        need(name not in by_name and member.size <= 256 * 1024 * 1024, "Duplicate or oversized checkpoint member")
        by_name[name] = member
    need("owner-return.json" in by_name, "Original owner return is absent")
    old_raw = carrier.extractfile(by_name["owner-return.json"]).read()
    original = json.loads(old_raw)
    need(original["schema"] == "sf88.research-client.original-operation-owner-return.v1"
         and original["operationId"] == BUSINESS and original["directory"] == str(ROOT)
         and original["state"] == "attention" and original["nativeExitCode"] == 1
         and original["nativeResult"] is None and original["nativeArtifacts"] is None,
         "Continue only the retained pre-dispatch failure, preserving any later product result")
    need(original["sourceMerge"] == "496ef23a7442f96240af0f5a5ccfa7b3954a2920"
         and original["sourceFiles"] == 162, "The original selected source changed")
    wanted = {}
    for row in original["files"]:
        name = str(relative(row["path"]))
        need(name not in wanted and name in by_name, "Original return member differs")
        need(type(row["bytes"]) is int and row["bytes"] == by_name[name].size, "Original member length differs")
        wanted[name] = row
    need(set(by_name) == set(wanted) | {"owner-return.json"}, "Checkpoint has unbound members")
    runtime_member = "records/" + OLD_RECORD + "/runtime-use.json"
    need(runtime_member not in wanted, "The original runtime-use journal exists; recover that same record")
    for name, row in wanted.items():
        target = ROOT / name
        data = carrier.extractfile(by_name[name]).read()
        need(len(data) == row["bytes"] and digest(data) == row["sha256"], "Original member changed: " + name)
        if target.exists():
            current = fingerprint(target)
            if current != {"bytes": row["bytes"], "sha256": row["sha256"]}:
                # Native journals may have advanced in the retained original
                # namespace; never restore an older observation over them.
                need(name.startswith("records/"), "The original retained input changed: " + name)
        else:
            write(target, data)
    if (ROOT / "owner-return.json").exists():
        need(ordinary(ROOT / "owner-return.json") == old_raw,
             "The original checkpoint return changed; preserve the later receiving owner")
    else:
        write(ROOT / "owner-return.json", old_raw)
del members, by_name, wanted, old_raw
# The original compressed carrier is already durably retained. Release only
# this verified download after all selected members are checked and placed.
archive_path.unlink()
gc.collect()
original_config_bytes = ordinary(ROOT / "case-input.json")
original_config = json.loads(original_config_bytes)
config = dict(original_config)
host_binding_receipt = None
if host_binding is not None:
    # The original case input remains byte-exact. Only native runtime selectors
    # differ in this stable companion input; every customer/source field is copied.
    config["node"] = host_binding["node"]
    config["sharedControl"] = host_binding["sharedControl"]
    host_config_bytes = (json.dumps(config, ensure_ascii=False, sort_keys=True, indent=2) + "\n").encode("utf-8")
    host_config_path = ROOT / "case-input-host.json"
    if host_config_path.exists():
        need(ordinary(host_config_path) == host_config_bytes,
             "The same native continuation already has another host configuration")
    else:
        write(host_config_path, host_config_bytes)
    host_binding_receipt = {
        **host_binding, "operationId": BUSINESS, "nativeOperationId": NATIVE_ID,
        "originalCaseInput": {"path": str(ROOT / "case-input.json"),
                             "bytes": len(original_config_bytes), "sha256": digest(original_config_bytes)},
        "selectedCaseInput": {"path": str(host_config_path),
                             "bytes": len(host_config_bytes), "sha256": digest(host_config_bytes)},
        "originalNode": original_config["node"], "originalSharedControl": original_config["sharedControl"]}
    binding_bytes = (json.dumps(host_binding_receipt, ensure_ascii=False, sort_keys=True, indent=2) + "\n").encode("utf-8")
    binding_path = ROOT / "native-host-binding.json"
    if binding_path.exists():
        need(ordinary(binding_path) == binding_bytes, "The same native host binding changed")
    else:
        write(binding_path, binding_bytes)
setup = json.loads(ordinary(ROOT / "setup-result.json"))
need(config["operationId"] == BUSINESS and config["directory"] == str(ROOT)
     and setup["operationId"] == BUSINESS and setup["sourceFiles"] == 162
     and setup["sourceSha256"] == SOURCE_SHA, "Restored case/source identity differs")
need(fingerprint(ROOT / "inbox/source-envelope.json") == {"bytes": 2044685, "sha256": SOURCE_SHA},
     "The complete selected source envelope changed")
placement = json.loads(ordinary(ROOT / "native-placement.json"))
need(placement["memoryMiB"] == 384 and placement["reserveMiB"] == 128
     and placement["sourceFiles"] == 162 and placement["sourceSha256"] == SOURCE_SHA,
     "Use the actual source-profile resource selection")
version = subprocess.check_output([config["node"], "--version"], text=True, timeout=10).strip()
need(version.startswith("v") and int(version[1:].split(".")[0]) >= 22, "Use the original supported Node runtime")
need(Path(config["sharedControl"]).resolve(strict=True) ==
     (Path(host_binding["sharedControl"]) if host_binding is not None else Path("/workspace/shared/swarm")),
     "Use the selected existing native shared-control root")
for name in ("capacity/memory", "capacity/disk"):
    need(stat.S_ISDIR((Path(config["sharedControl"]) / name).lstat().st_mode),
         "The original shared capacity registry is absent")
for name in ("workspace", "source-state", "worker", "tmp", "project/results"):
    (ROOT / name).mkdir(parents=True, exist_ok=True, mode=0o700)


# These selected files belong to our completed AF recovery. Each retained
# counterpart above was checked against the actual saved 39550 member manifest.
# Preserve changed/unmatched files and the separate AF wrapper and guide.
closed_root = Path("/workspace/scratch/d9b53a575d9a/af-estate-recovery/host")
closed_rows = json.loads("[[\"capacity_fairness.py\",11706,\"08e26f0b799b75b93f78be5d03cade476631fafd4271d3472d9e31f342196fd3\"],[\"capacity_recovery.py\",11297,\"c449a9e3ff949dbc94239330caab1b6c23e2108598c3479d83b4d2131115d1c6\"],[\"cloud_disk.py\",33181,\"18d15401bb61e6086b82010ed971e32524fe5b1c0820822fc62ad03f7fa7246f\"],[\"cloud_memory.py\",44671,\"9e0dac4fb4ce0128d3b4cf91a3d5cb42ec92a49b79d39b7d227b60af767fd72f\"],[\"cloud_residency.py\",6959,\"a0c15ddb67e94e3854ebcd5d9159c8185ec5a36189dc4d3c5cfe76ad2f4601b6\"],[\"native_artifact_retention.py\",15749,\"2714b9035f33c84a9b89b6257f288fb81b1dc82bb1c6746e71d64eabe24da7c9\"],[\"native_artifact_selection.py\",12095,\"ef862e964f5c4a29ed50c41206ad46aa3ffabdc8a6eaf83ba2bf11aed707f3ba\"],[\"native_capacity.py\",25341,\"e8d9560fa20358df08cf1ae501190d6be8cf109cdd0131b24f23b2e08544e83e\"],[\"native_completion.py\",11719,\"f16148c69a5fd04a3a5b3f43b90c1e55a72064198787fc4fa9af3e2100fe3055\"],[\"native_foreground.py\",11600,\"442102b4adf4dd9f0d879fbdbc6e17c68281251e0fac72a4dc06534c7317cb7c\"],[\"native_handoff_capacity.py\",16486,\"5cb18ec1c53bc0c480a3294e5788ba2cff847210ce8dccb2c465d96a311adbe8\"],[\"native_reservation.py\",10173,\"ade24a488b00bf7c7502712284d6a19e07e1fc0eb289c82b146e75a2eab4f612\"],[\"native_result_view.py\",3472,\"b380e13c3affcfae44012fad82d160c11389d753d0413c7467d701b1e994160a\"],[\"native_runtime_handoff.py\",22092,\"bfc07fd56a1859256d28aedf400297029b513d1acfe87eed65bc3e497a4c8a98\"],[\"node_dependency_borrow.py\",12052,\"998f8e7068c97b3ed17fe9f68360c7ed4801cb828e2f1177f41ad6abe1ca7000\"],[\"node_lockfile_cache.py\",22472,\"0a3fec3104494d95232009351dc9eda281bd6871d1b70d1d6979e5266307da1c\"],[\"node_package_cache.py\",16433,\"b3a009e936c8200bcc8e7a9fd15685cba51f9b15de5c0707bbd98386a5532325\"],[\"offload_build.py\",47779,\"7055b156ee2d872061721680f3de05cacefa9ecfb5191db05a5315ec38c1229f\"],[\"run_bounded.py\",22862,\"dea964d5da240ce2c63358d18fdfa4e1e2733a617c9e69534aefca57f3e28b02\"],[\"runtime_catalog.py\",6314,\"7a2eb69ad2c3ee6b360a5a175d069b41e5783ae04d651112a404bb97eca451d3\"],[\"runtime_consumers.py\",62536,\"5d57dd5e0d3416cdf4d81a209b2ef3af8de6a4b29e2e59bacd720ae0dc91e44b\"],[\"runtime_source.py\",9944,\"65ae7c9dbf2d70ec01e2fb482a688bac4d280dde4ab91be3671005024d29c254\"],[\"swarm_cloud_browser.py\",36011,\"155a61d84f97363a6953ffec1c16f70f2d7da1bd12ef27b2fb5f56e039410c41\"],[\"swarm_cloud_cache.py\",93329,\"b2887be1ca1e5d0ff099496668f3fad08d7aa39f0a44a2e3426a20eeeee9bb3d\"],[\"swarm_cloud_dependencies.py\",12242,\"b733c706e817c828926ab545d73311655bde900f51e150013e5446e872cbcc63\"],[\"swarm_cloud_job.py\",72194,\"8ac96adc72e13082a08b6d1090684eec10aeacb8e20feb01ed40493ab9778375\"],[\"swarm_cloud_worker.py\",8944,\"f3070827dfe064bfa38ac3500de5453cd0c53adb597d10338abe0add869d566a\"],[\"worker_capacity.py\",29692,\"4a0827b95127cbdcaaff04dd40ae763e1ce9695f045fac5226acd67b5d7ec786\"],[\"worker_storage.py\",11733,\"c0f34f1df226b1b5c04a1faafcb28fb2b530c63ad3221ddbd4a7dadcf305e31b\"]]")
release = {"schema": "commons.closed-source-exact-copy-release.v1",
           "operationId": BUSINESS, "nativeOperationId": NATIVE_ID,
           "closedRoot": str(closed_root), "retainedRoot": str(ROOT / "controller/host"),
           "retainedCheckpoint": CHECKPOINT, "startedAt": now(), "removed": [], "preserved": []}
overlay = Path(config["sharedControl"])
space_before = os.statvfs(overlay)
release["availableBytesBefore"] = space_before.f_bavail * space_before.f_frsize
if (host_binding is None and closed_root.exists() and stat.S_ISDIR(closed_root.parent.lstat().st_mode)
        and stat.S_ISDIR(closed_root.lstat().st_mode)):
    for name, length, sha in closed_rows:
        source = closed_root / name
        retained = ROOT / "controller/host" / name
        expected = {"bytes": length, "sha256": sha}
        if not source.exists():
            release["preserved"].append({"name": name, "reason": "already-absent"})
            continue
        if (not stat.S_ISREG(source.lstat().st_mode) or not retained.is_file()
                or fingerprint(source) != expected or fingerprint(retained) != expected):
            release["preserved"].append({"name": name, "reason": "different-or-unmatched"})
            continue
        before = source.lstat()
        need(ordinary(source) == ordinary(retained), "Closed and retained source bytes differ")
        after = source.lstat()
        need((before.st_dev, before.st_ino, before.st_size, before.st_mtime_ns, before.st_ctime_ns) ==
             (after.st_dev, after.st_ino, after.st_size, after.st_mtime_ns, after.st_ctime_ns),
             "The closed source changed before its selected release")
        source.unlink()
        release["removed"].append({"name": name, **expected,
                                   "allocatedBytes": before.st_blocks * 512})
else:
    release["closedRootAbsentOrRedirected"] = True
space_after = os.statvfs(overlay)
release["availableBytesAfter"] = space_after.f_bavail * space_after.f_frsize
release["removedLogicalBytes"] = sum(row["bytes"] for row in release["removed"])
release["removedAllocatedBytes"] = sum(row["allocatedBytes"] for row in release["removed"])
release["completedAt"] = now()
write_json(out / "closed-source-release.json", release)
emit({"state": "closed-source-exact-copy-release", "operationId": BUSINESS,
      "removedFiles": len(release["removed"]), "preservedFiles": len(release["preserved"]),
      "removedLogicalBytes": release["removedLogicalBytes"],
      "removedAllocatedBytes": release["removedAllocatedBytes"],
      "availableBytesBefore": release["availableBytesBefore"],
      "availableBytesAfter": release["availableBytesAfter"],
      "receipt": str(out / "closed-source-release.json")})

pointer_path = Path("/workspace/shared/swarm/jobs/runtime-consumers/38f2dbec9aa66e70016b207797e8733076ee7e12703a2fba05d6999cdb9ae394.json")
pointer = {"path": str(pointer_path), "observedBy": "root AF native owner 65054",
           "bytes": 2021, "sha256": OLD_POINTER_SHA}
if pointer_path.exists():
    body = ordinary(pointer_path)
    need(len(body) == 2021 and digest(body) == OLD_POINTER_SHA,
         "The original pointer advanced after its retained observation; reconcile that owner")
    parsed = json.loads(body)
    need(parsed.get("record") == str(ROOT / "records" / OLD_RECORD)
         and parsed.get("operation_id") == BUSINESS, "The original runtime pointer changed identity")
    write(out / "observed-original-runtime-pointer.json", body)
    pointer.update(currentBytes=len(body), currentSha256=digest(body),
                   currentRevision=parsed.get("revision"), currentIntentSha256=parsed.get("intent_sha256"))
elif payload.get("originalPointerText") is not None:
    body = payload["originalPointerText"].encode("utf-8")
    need(len(body) == 2021 and digest(body) == OLD_POINTER_SHA, "Original pointer observation differs")
    write(out / "observed-original-runtime-pointer.json", body)
    pointer["retainedFromOriginalOwner"] = True

original_launcher = ordinary(ROOT / "inbox/worker-research-launch.py")
need(len(original_launcher) == 1872
     and digest(original_launcher) == "61e0f22376edb2f9a40b606a2a7414e9c3556b77a18bf32106d7cdb5dc3786a2",
     "Original native launcher changed")
launch_text = original_launcher.decode("utf-8")
if host_binding is not None:
    # The original runner derives ROOT from its input's parent. Keep this
    # companion at ROOT and include it in the original native runtime selection.
    need(launch_text.count('"case-input.json"') == 3, "Original case-input selectors changed")
    launch_text = launch_text.replace('"case-input.json"', '"case-input-host.json"')
old = 'operation_id=config["operationId"]'
need(launch_text.count(old) == 1, "Native operation selection seam changed")
launch_text = launch_text.replace(old, "operation_id=" + repr(NATIVE_ID))
old_memory = 'memory_mib=768,memory_reserve_mib=256,memory_reclaim="clean-cache"'
need(launch_text.count(old_memory) == 1, "Original measured resource seam changed")
launch_text = launch_text.replace(old_memory, 'memory_mib=384,memory_reserve_mib=128,memory_reclaim="clean-cache"')
launcher = out / "worker-research-launch-continuation.py"
write(launcher, launch_text.encode("utf-8"))
lineage = {
    "schema": "sf88.research-client.linked-native-continuation.v1",
    "operationId": BUSINESS, "nativeOperationId": NATIVE_ID, "directory": str(ROOT),
    "checkpoint": {**CHECKPOINT, "libraryFileId": "libfile_7c37e4e4f2688191be83dda72f8c9549",
                   "fileId": "file_000000003a2c81f7b31db5c3cfe6f128"},
    "originalRecord": str(ROOT / "records" / OLD_RECORD),
    "originalOwner": {"sessionId": 26032, "sourceSha256": "0507320ebf0fbba555f3dd18ba53ff8fbe008ff0fc54c75f13bd5b94d13c324a",
                      "returnedOutcome": "unavailable"},
    "checkpointOwner": {"sessionId": 39550, "nativeExitCode": 1,
                        "failure": "shared runtime pointer newer than the missing original runtime-use journal"},
    "originalPointer": pointer, "sourceMerge": config["sourceMerge"],
    "dossierId": config["dossierId"], "questionId": config["questionId"],
    "originalRevision": config["originalRevision"], "sourceFiles": setup["sourceFiles"],
    "sourceSha256": SOURCE_SHA, "node": config["node"], "nodeVersion": version,
    "placement": placement, "hostBinding": host_binding_receipt,
    "originalLauncherSha256": digest(original_launcher),
    "continuationLauncherSha256": digest(launch_text.encode("utf-8")),
    "keeperSha256": KEEPER_SHA, "ownerSource": payload["ownerSourceIdentity"],
    "ownerAttemptId": attempt_id, "priorContinuationAttempt": {
        "sessionId": 7703, "source": prior["ownerSourceIdentity"],
        "nativeOutput": prior["nativeOutputIdentity"], "observedFailure": "ENOSPC during runtime registration",
        "sealedReturn": prior["sealedReturn"], "returnCustody": "original owner unavailable; no save receipt recovered"},
    "rootPreviouslyPresent": root_existed, "preparedAt": now()
}
write_json(out / "recovery-lineage.json", lineage)
# This checkpoint contains no dispatched product state; its historical record is
# preserved verbatim. A distinct native continuation registers the same retained
# case command through the existing controller without rewriting that old pointer.
old_record = ROOT / "records" / OLD_RECORD
need(not (old_record / "runtime-use.json").exists(), "The original runtime journal became available")
os.environ["SWARM_STATE_ROOT"] = config["sharedControl"]
sys.path.insert(0, str(ROOT / "controller/host"))
from native_foreground import load_native
native = load_native(ROOT / "controller/host")
old_request = json.loads(ordinary(old_record / "request.json")) if (old_record / "request.json").exists() else None
for name in ("process.json", "supervisor-launch.json", "state.json"):
    selected = old_record / name
    if not selected.exists():
        continue
    row = json.loads(ordinary(selected))
    identities = [row.get("process"), row.get("supervisor")]
    if name == "process.json":
        identities.append(row)
    need(not any(identity and native.alive(identity) for identity in identities),
         "The original native child or supervisor is still live; continue that owner")
new_record = ROOT / "records" / hashlib.sha256(NATIVE_ID.encode("utf-8")).hexdigest()
# An absent original namespace is reconstructed only before command dispatch.
# Never overwrite a surviving shared registration or a live original supervisor.
from runtime_consumers import pointer_path, registry_path
new_pointer = pointer_path(registry_path(), new_record)
if not new_record.exists():
    need(not new_pointer.exists(), "The same continuation has a surviving registration; recover its original record")
    need(not native.live_supervisors(new_record), "The same native supervisor is live")
    mirror_json(shared_attempt / "original-record-observation.json", {
        "nativeOperationId": NATIVE_ID, "record": str(new_record), "recordPresent": False,
        "sharedPointer": str(new_pointer), "sharedPointerPresent": False,
        "observedAt": now(), "priorAttemptSource": prior["ownerSourceIdentity"]})
else:
    need((new_record / "request.json").is_file(), "Preserve the existing incomplete native record")
    mirror_json(shared_attempt / "original-record-observation.json", {
        "nativeOperationId": NATIVE_ID, "record": str(new_record), "recordPresent": True,
        "sharedPointer": str(new_pointer), "sharedPointerPresent": new_pointer.exists(), "observedAt": now()})

def retain_record_observation(label):
    selected = {}
    target = out / "record-observations" / label
    target.mkdir(parents=True, exist_ok=True, mode=0o700)
    for name in ("request.json", "state.json", "runtime-use.json", "result.json",
                 "process.json", "supervisor-launch.json", "capacity-recovery.json",
                 "capacity-resume.json", "artifacts.json"):
        path = new_record / name
        if path.is_file():
            body = ordinary(path)
            try:
                json.loads(body)
            except (json.JSONDecodeError, UnicodeDecodeError):
                continue
            destination = target / name
            if destination.exists():
                need(ordinary(destination) == body, "An observed native journal changed within one snapshot")
            else:
                write(destination, body)
            selected[name] = {"bytes": len(body), "sha256": digest(body)}
    write_json(target / "observation.json", {
        "schema": "sf88.research-client.native-record-observation.v1",
        "operationId": BUSINESS, "nativeOperationId": NATIVE_ID,
        "record": str(new_record), "observedAt": now(), "files": selected})
    mirror_json(shared_attempt / "record-observations" / label / "observation.json", {
        "operationId": BUSINESS, "nativeOperationId": NATIVE_ID, "record": str(new_record),
        "privatePath": str(target), "observedAt": now(), "files": selected})
    return selected

def capacity_observation():
    import capacity_recovery
    selected_request = native.read_json(new_record / "request.json")
    if selected_request is None:
        return None
    need(selected_request.get("intent", {}).get("operation_id") == NATIVE_ID,
         "Preserve the original native request identity")
    return capacity_recovery.observe(native, new_record, selected_request)

def observe_journal_space():
    # statvfs is context, not native admission. The original controller performs
    # the actual atomic journal write and retains its exact recovery outcome.
    registry = Path(registry_path())
    observation_path = registry
    while not observation_path.exists():
        need(observation_path.parent != observation_path, "No existing native journal filesystem")
        observation_path = observation_path.parent
    statv = os.statvfs(observation_path)
    observation = {"state": "original-native-journal-observation", "operationId": BUSINESS,
                   "nativeOperationId": NATIVE_ID, "record": str(new_record),
                   "registry": str(registry), "filesystemPath": str(observation_path),
                   "availableBytes": statv.f_bavail * statv.f_frsize,
                   "freeBytes": statv.f_bfree * statv.f_frsize,
                   "sharedControl": config["sharedControl"], "observedAt": now()}
    emit(observation)
    return observation

def resume_command(observation):
    value = [sys.executable, "-B", str(ROOT / "controller/host/native_foreground.py"),
             "resume-capacity", NATIVE_ID, "--records-root", str(ROOT / "records"),
             "--host-root", str(ROOT / "controller/host"), "--report-format", "summary"]
    if observation and observation.get("can_recover") is True:
        value += ["--recover-failure", observation["failure_sha256"]]
    return value

emit({"state": "linked-native-continuation-prepared", "operationId": BUSINESS,
      "nativeOperationId": NATIVE_ID, "record": str(new_record), "directory": str(ROOT),
      "sourceMerge": config["sourceMerge"], "sourceFiles": 162,
      "memoryMiB": 384, "reserveMiB": 128, "checkpoint": CHECKPOINT})
status, failure, launch_state, process = 125, None, None, None
write_json(out / "native-launch-intent.json", {"operationId": BUSINESS, "nativeOperationId": NATIVE_ID,
           "record": str(new_record), "launcher": str(launcher), "launcherSha256": lineage["continuationLauncherSha256"],
           "ownerAttemptId": attempt_id, "preparedAt": now()})

def run_original_command(command, ordinal):
    global launch_state, process
    attempt = out / ("native-attempt-" + str(ordinal).zfill(3))
    attempt.mkdir(mode=0o700)
    write_json(attempt / "intent.json", {"command": command, "preparedAt": now(),
               "operationId": BUSINESS, "nativeOperationId": NATIVE_ID, "record": str(new_record)})
    with (attempt / "output.log").open("xb") as log:
        process = subprocess.Popen(command, stdout=subprocess.PIPE, stderr=subprocess.STDOUT)
        write_json(attempt / "process.json", {"pid": process.pid, "observedAt": now()})
        event = 0
        for line in iter(process.stdout.readline, b""):
            log.write(line)
            log.flush()
            try:
                value = json.loads(line)
            except (json.JSONDecodeError, UnicodeDecodeError):
                emit({"state": "linked-native-output", "text": line.decode("utf-8", "replace")[-4000:]})
                continue
            if isinstance(value, dict):
                emit({"state": "linked-native-progress", "value": value})
                if value.get("record"):
                    need(value["record"] == str(new_record), "The original native engine selected another record")
                    launch_state = value
                    retain_record_observation("attempt-" + str(ordinal) + "-event-" + str(event))
                    event += 1
            else:
                emit({"state": "linked-native-output", "text": line.decode("utf-8", "replace")[-4000:]})
        code = process.wait()
        log.flush()
        os.fsync(log.fileno())
    write_json(attempt / "wait.json", {"exitCode": code, "exitObserved": True, "observedAt": now()})
    retain_record_observation("attempt-" + str(ordinal) + "-returned")
    return code

try:
    ordinal = 0
    # start() compares the complete supplied intent against an existing original
    # request before returning its observation. On a retained record it does not
    # dispatch another command; the explicit resume below owns that transition.
    command = [sys.executable, "-B", str(launcher), str(ROOT)]
    prior_recovery_failure = None
    while command is not None:
        observe_journal_space()
        ordinal += 1
        status = run_original_command(command, ordinal)
        selected_result = native.read_json(new_record / "result.json")
        observation = capacity_observation()
        if observation and observation.get("can_recover") is True:
            # If recovery returned the identical failure without advancing, keep
            # its exact diagnostics for source correction. Do not spin another
            # registration attempt or consume shared disk with repeated logs.
            if observation["failure_sha256"] == prior_recovery_failure:
                failure = {"type": "OriginalCapacityRecoveryUnchanged",
                           "message": "The same selected failure remains after its original recovery",
                           "failureSha256": observation["failure_sha256"]}
                break
            prior_recovery_failure = observation["failure_sha256"]
            write_json(out / ("capacity-observation-" + str(ordinal) + ".json"), observation)
            emit({"state": "original-native-failure-selected", "operationId": BUSINESS,
                  "nativeOperationId": NATIVE_ID, "record": str(new_record), "recovery": observation})
            command = resume_command(observation)
            # A successful original resume may wait for capacity inside its
            # unchanged foreground supervisor. No new native operation is made.
            continue
        if (selected_result is None and status != 0
                and len(command) > 2 and Path(command[2]).name == "native_foreground.py"):
            failure = {"type": "OriginalNativeResumeFailed",
                       "message": "The original resume returned before command dispatch; preserve its exact output",
                       "exitCode": status}
            break
        if selected_result is None:
            state_now = native.read_json(new_record / "state.json") or {}
            supervisor = state_now.get("supervisor")
            if (not supervisor and not state_now.get("process")
                    and state_now.get("state") in native.CAPACITY_RESUMABLE_STATES
                    and not (new_record / "process.json").exists()
                    and not (new_record / "output.log").exists()
                    and not (new_record / "command-completion.dat").exists()):
                command = resume_command(observation)
                continue
            while supervisor and native.alive(supervisor):
                time.sleep(2)
                selected_result = native.read_json(new_record / "result.json")
                if selected_result is not None:
                    break
                state_now = native.read_json(new_record / "state.json") or {}
                supervisor = state_now.get("supervisor")
            if selected_result is not None and type(selected_result.get("exit_code")) is int:
                status = selected_result["exit_code"]
        if selected_result is not None and type(selected_result.get("exit_code")) is int:
            status = selected_result["exit_code"]
        command = None
    write_json(out / "native-launch-result.json", {"operationId": BUSINESS, "nativeOperationId": NATIVE_ID,
               "record": str(new_record), "exitCode": status, "exitObserved": True,
               "launchState": launch_state, "observedAt": now()})
except BaseException as error:
    failure = {"type": type(error).__name__, "message": str(error)}
    emit({"state": "linked-native-attention", "operationId": BUSINESS, "error": failure})
    if process is not None and process.poll() is None:
        status = process.wait()
        write_json(out / "native-launch-recovered-wait.json", {"operationId": BUSINESS,
                   "nativeOperationId": NATIVE_ID, "exitCode": status,
                   "exitObserved": True, "observedAt": now()})
    if new_record.is_dir():
        retain_record_observation("owner-attention")

def snapshot(path):
    if not path.is_file():
        return None
    body = ordinary(path)
    return {"bytes": len(body), "sha256": digest(body), "value": json.loads(body)}

native_result = snapshot(ROOT / "project/results/run-result.json")
native_artifacts = snapshot(ROOT / "project/results/run-artifacts.json")
native_report = snapshot(ROOT / "project/results/native-report.json")
native_record_result = snapshot(new_record / "result.json")
state = "complete" if (status == 0 and native_result and native_artifacts and native_report
          and native_result["value"].get("state") == "complete"
          and native_artifacts["value"].get("state") == "complete"
          and native_report["value"].get("state") == "complete") else "attention"
selected = {}
def add(path):
    name = str(path.relative_to(ROOT))
    need(name not in selected, "Duplicate selected return member")
    selected[name] = {"path": path, **fingerprint(path)}

for directory in ("workspace", "source-state", "private-inputs", "project", "controller/host", "records", "inbox"):
    base = ROOT / directory
    if not base.is_dir():
        continue
    for path in sorted(base.rglob("*")):
        if path.is_dir():
            continue
        if "__pycache__" in path.parts or path.suffix in (".pyc", ".pyo"):
            continue
        add(path)
for name in ("original-prepared-input.json", "case-input.json", "case-input-host.json", "native-host-binding.json",
             "setup-result.json", "setup.stdout", "setup.stderr",
             "source-memory-observation.mjs", "source-memory-observation.json", "native-placement.json",
             "native-launch-intent.json", "native-launch-result.json", "original-receiving-input.json",
             "original-operating-input.json", "owner-return.json"):
    path = ROOT / name
    if path.is_file():
        add(path)
for path in sorted((ROOT / "continuations/native-01").rglob("*")):
    if path.is_dir() or path.suffix in (".gz", ".tgz") or "hosted-return-retention" in path.parts:
        continue
    add(path)
result = {"schema": "sf88.research-client.linked-operation-owner-return.v1",
          "operationId": BUSINESS, "nativeOperationId": NATIVE_ID, "directory": str(ROOT),
          "record": str(new_record), "state": state, "nativeExitCode": status, "failure": failure,
          "checkpoint": lineage["checkpoint"], "sourceMerge": config["sourceMerge"], "sourceFiles": 162,
          "hostBinding": host_binding_receipt,
          "dossierId": config["dossierId"], "questionId": config["questionId"],
          "nativeResult": native_result, "nativeArtifacts": native_artifacts,
          "nativeReport": native_report, "nativeRecordResult": native_record_result,
          "files": [{"path": name, "bytes": row["bytes"], "sha256": row["sha256"]}
                    for name, row in selected.items()]}
write_json(out / "owner-return.json", result)
mirror_json(shared_attempt / "owner-return.json", result)
add(out / "owner-return.json")
for name, value in (("native-result.json", native_result), ("native-artifacts.json", native_artifacts),
                    ("native-report.json", native_report), ("native-record-result.json", native_record_result)):
    if value is not None:
        mirror(shared_attempt / name, ordinary(
            new_record / "result.json" if name == "native-record-result.json" else
            ROOT / "project/results" / {"native-result.json": "run-result.json",
                "native-artifacts.json": "run-artifacts.json", "native-report.json": "native-report.json"}[name]))
destination = out / "NCC_Research_Original_Operation_Continuation_01_Recovered_20261012.tar.gz"
with tarfile.open(destination, "x:gz", compresslevel=6) as carrier:
    for name, row in selected.items():
        need(fingerprint(row["path"]) == {"bytes": row["bytes"], "sha256": row["sha256"]},
             "Selected native return changed before preservation")
        carrier.add(row["path"], arcname=name, recursive=False)
os.chmod(destination, 0o600)
with destination.open("rb") as stream:
    os.fsync(stream.fileno())
artifact = {"path": str(destination), **fingerprint(destination)}
# Preserve the same sealed bytes on the shared private filesystem before any
# upload. A disconnected process must not make its completed result unreachable.
space = os.statvfs(shared)
shared_available = space.f_bavail * space.f_frsize
retention_root = out
if shared_available >= artifact["bytes"] + 1024 * 1024:
    shared_attempt.mkdir(parents=True, exist_ok=True, mode=0o700)
    shared_destination = shared_attempt / destination.name
    with destination.open("rb") as source_stream:
        fd = os.open(shared_destination, os.O_WRONLY | os.O_CREAT | os.O_EXCL | os.O_NOFOLLOW, 0o600)
        with os.fdopen(fd, "wb") as destination_stream:
            shutil.copyfileobj(source_stream, destination_stream, 1024 * 1024)
            destination_stream.flush()
            os.fsync(destination_stream.fileno())
    need(fingerprint(shared_destination) == {"bytes": artifact["bytes"], "sha256": artifact["sha256"]},
         "The sealed original return changed while preserving shared custody")
    mirror_json(shared_attempt / "artifact-placement.json", {
        "schema": "sf88.research-client.same-byte-return-placement.v1",
        "operationId": BUSINESS, "nativeOperationId": NATIVE_ID,
        "originalPath": artifact["path"], "sharedPath": str(shared_destination),
        "bytes": artifact["bytes"], "sha256": artifact["sha256"], "observedAt": now()})
    artifact["path"] = str(shared_destination)
    retention_root = shared_attempt
else:
    mirror_json(shared_attempt / "artifact-placement.json", {
        "schema": "sf88.research-client.same-byte-return-placement.v1",
        "operationId": BUSINESS, "nativeOperationId": NATIVE_ID,
        "originalPath": artifact["path"], "sharedPath": None, "availableBytes": shared_available,
        "bytes": artifact["bytes"], "sha256": artifact["sha256"], "observedAt": now()})
emit({"state": "linked-original-return-ready", "operationId": BUSINESS, "nativeOperationId": NATIVE_ID,
      "outcome": state, "nativeExitCode": status, "artifact": artifact,
      "nativeResult": native_result, "nativeArtifacts": native_artifacts, "nativeReport": native_report})
# The same producing owner retains the closed artifact through save or an
# explicit same-state receipt/transfer recovery. The operated case is never rerun
# merely to recover its file.
saved = retain_artifact(retention_root, artifact, BUSINESS, HELPER, input_stream=sys.stdin,
                        emit=lambda line: print(line, flush=True), artifact_type="report")
write_json(out / "library-upload-result.json", saved)
emit({"state": "linked-original-library-return", "operationId": BUSINESS,
      "nativeOperationId": NATIVE_ID, "outcome": state, "artifact": artifact, "receipt": saved})
raise SystemExit(status)
