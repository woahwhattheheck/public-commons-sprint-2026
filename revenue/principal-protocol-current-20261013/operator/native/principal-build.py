#!/usr/bin/env python3
"""MIT. Source-bound Principal reference/current build courses using the original native process owner.

No deployment, transaction submission, shell command or replacement controller.
The same programme directory and operation lease retain source, attempts,
compiler streams, the selected full Wasm set and complete host snapshots.
"""
from __future__ import annotations
import argparse
import base64
import contextlib
import hashlib
import json
import os
from pathlib import Path
import re
import stat
import sys
import time

SCHEMA = "principal.reference-build-input.v1"
CURRENT_SCHEMA = "principal.current-build-input.v3"
MARKET_SCHEMA = "principal.market-build-input.v1"
MARKET_PACKET_BYTES = 7677275
MARKET_PACKET_SHA = "bf8edadbbd4d1d114c6c372fbdcf44485abd737504250f84e4e5e8e7a57de472"
MARKET_MEMBERS = 240
PAIRED_SCHEMA = "principal.paired-exit-build-input.v1"
PAIRED_PACKET_BYTES = 7832685
PAIRED_PACKET_SHA = "2ae37235ada234bb17f3ebe5e8240c2ba556d5363e03c55f53592db5c98deb31"
PAIRED_MEMBERS = 244
CURRENT_PACKET_BYTES = 7509894
CURRENT_PACKET_SHA = "71d7d5b9b1adaf6fb4c9a2bb6b49f614cd9c5c101a0454c75985e54f9de9eb04"
OWNER_SHA = "506634371a87cbdc005b65d4e9c75a480bef18e0f0a762c3de463c859018903c"
OWNER_BYTES = 29581
MEMBERS = [{"path":"Cargo.toml","bytes":357,"sha256":"8ddf0f4357c13de0e749c1f3278df9fdc310fda95784278a50fdde53f00d9cd4"},{"path":"Cargo.lock","bytes":45699,"sha256":"93498c4282584371a5042b277cfd182ff1cc07a8e3f69a5c74c70fb74354fe1e"},{"path":"rust-toolchain.toml","bytes":114,"sha256":"434ff6439d1896b5558fb1077c8169c68f1ee596cbb4b7948de2bef68b9688cd"},{"path":"PRINCIPAL_API.json","bytes":13901,"sha256":"ad7d0fc7b58f005fd4f39f450ae5980c878501593cf7554137450e68c2b5531a"},{"path":"contracts/common.rs","bytes":7220,"sha256":"f30e5b831573e7f878169ee4d682784893ca8417f50fcf4b7f39438d7a2443bb"},{"path":"contracts/oracle_adapter/Cargo.toml","bytes":330,"sha256":"62d92060a9c18bee6d5755ed3c6dff940b37a6d62d88be1714adb6005502ddff"},{"path":"contracts/oracle_adapter/src/lib.rs","bytes":3073,"sha256":"c807f877764f6cc1049ae3c62f40bf95262ac20c3ec7ae7adcfcc88d81c6f55c"},{"path":"contracts/permissioning/Cargo.toml","bytes":329,"sha256":"2d479709e9ccde9f86da61a1e4b878694af61d2fa4ea5a123701c54d7e128c6b"},{"path":"contracts/permissioning/src/lib.rs","bytes":2323,"sha256":"842422d798a5e043914e80a1980e8f54448b909f45ccf5f8d3c4b8a5c1b74f3b"},{"path":"contracts/sy_wrapper/Cargo.toml","bytes":326,"sha256":"2e1fa3c2fb6dd4c0e8e0c1bff8a09fbf82e79422d263b1516d6fb6be48e3e3d6"},{"path":"contracts/sy_wrapper/src/lib.rs","bytes":6806,"sha256":"23465d794f38d865759316ec5f399f02fbf8d3ca6bba4e75bf0c59e995470888"},{"path":"contracts/principal_manager/Cargo.toml","bytes":645,"sha256":"fa8a98359c3f13b05603a1ddaf2412d68b3ad51fb8265a6f83e083f725533ae8"},{"path":"contracts/principal_manager/src/lib.rs","bytes":15429,"sha256":"0dab2f71478d22ca232c464afee8d7d08ff9e1c40b5b00d95cee95a267ceb316"},{"path":"contracts/risk_control/Cargo.toml","bytes":328,"sha256":"7b9b05f8327c3d4a9d9f91c768a7335375b3496f4b288698e3e7a265d8500631"},{"path":"contracts/risk_control/src/lib.rs","bytes":3741,"sha256":"ecc8db989983c85c1bac033da6be9b1b5d4e7cd50be5df68c630c34cefdc494a"},{"path":"contracts/principal_manager/tests/lifecycle.rs","bytes":11887,"sha256":"e8bfbebaa583a929a795baacfdedd6af2eb87c8baf2771ca678d8e0010419fa9"},{"path":"CONTRACT_INTEGRATION.md","bytes":16916,"sha256":"ec9fa21d6e0c8fff479d5a9373b5fba62d8d066242d09ad2ea5af30e9cc992b0"}]
REFERENCE_WASM = ["principal_oracle_adapter", "principal_permissioning", "principal_risk_control",
        "principal_sy_wrapper", "principal_manager"]
REFERENCE_SNAPSHOTS = ["01-fixed-settlement", "02-cold-return-and-complete-redemption",
             "03-exact-paired-recombination", "04-actual-token-loss",
             "05-extreme-price-0", "05-extreme-price-1", "06-original-authorization-and-risk"]
PHASES = ["01-cargo-version", "02-rustc-version", "03-locked-wasm-build", "04-whole-lifecycle"]
LIMIT = 512 * 1024 * 1024

def need(value, message):
    if not value:
        raise RuntimeError(message)

def encode(value):
    return (json.dumps(value, ensure_ascii=False, sort_keys=True, indent=2) + "\n").encode("utf-8")

def sha(data):
    return hashlib.sha256(data).hexdigest()

def strict_json(data):
    def pairs(items):
        out = {}
        for key, value in items:
            need(key not in out, "Duplicate original JSON field")
            out[key] = value
        return out
    return json.loads(data, object_pairs_hook=pairs,
                      parse_constant=lambda unused: (_ for _ in ()).throw(ValueError("Nonfinite JSON")))

def ordinary(path, exists=True):
    path = Path(path)
    need(path.is_absolute() and ".." not in path.parts, "Select an absolute ordinary path")
    for parent in reversed([path, *path.parents]):
        try:
            mode = parent.lstat().st_mode
        except FileNotFoundError:
            need(not exists, "Original path is missing")
            continue
        need(not stat.S_ISLNK(mode), "Symbolic links are not selected source/runtime files")
    return path

def read(path, maximum=LIMIT, durable=False):
    path = ordinary(path)
    fd = os.open(path, os.O_RDONLY | getattr(os, "O_NOFOLLOW", 0))
    with os.fdopen(fd, "rb") as stream:
        before = os.fstat(stream.fileno())
        need(stat.S_ISREG(before.st_mode) and before.st_size <= maximum, "Complete ordinary file required")
        data = stream.read(maximum + 1)
        if durable:
            os.fsync(stream.fileno())
        after = os.fstat(stream.fileno())
        need(len(data) <= maximum and
             (before.st_dev,before.st_ino,before.st_size,before.st_mtime_ns,before.st_ctime_ns) ==
             (after.st_dev,after.st_ino,after.st_size,after.st_mtime_ns,after.st_ctime_ns),
             "Original file changed during read")
        if durable:
            sync_dir(path.parent)
        return data

def sync_dir(path):
    fd = os.open(ordinary(path), os.O_RDONLY | getattr(os, "O_DIRECTORY", 0))
    try:
        os.fsync(fd)
    finally:
        os.close(fd)

def mkdir(path):
    path = ordinary(path, False)
    if not path.exists():
        mkdir(path.parent)
        path.mkdir(mode=0o700)
        sync_dir(path.parent)
    need(path.is_dir(), "Select an ordinary directory")
    # Adoption retries any earlier directory publication whose parent sync failed.
    for ancestor in [path, *path.parents]:
        sync_dir(ancestor.parent)
    return path

def put(path, data, mode=0o600):
    path = ordinary(path, False)
    mkdir(path.parent)
    if path.exists():
        need(read(path) == data, "The original immutable artifact differs")
        sync_dir(path.parent)
        return
    temporary = path.with_name(path.name + ".pending-" + str(os.getpid()) + "-" + str(time.time_ns()))
    fd = os.open(temporary, os.O_WRONLY | os.O_CREAT | os.O_EXCL | getattr(os, "O_NOFOLLOW", 0), mode)
    with os.fdopen(fd, "wb") as stream:
        stream.write(data)
        stream.flush()
        os.fsync(stream.fileno())
    try:
        os.link(temporary, path)
    except FileExistsError:
        need(read(path) == data, "The original immutable artifact differs")
    finally:
        temporary.unlink()
    sync_dir(path.parent)

@contextlib.contextmanager
def lease(root):
    import fcntl
    file = ordinary(root / "principal-build.lock", False)
    fd = os.open(file, os.O_RDWR | os.O_CREAT | getattr(os, "O_NOFOLLOW", 0), 0o600)
    try:
        need(stat.S_ISREG(os.fstat(fd).st_mode), "Original regular lease required")
        fcntl.flock(fd, fcntl.LOCK_EX | fcntl.LOCK_NB)
    except BaseException:
        os.close(fd)
        raise
    try:
        yield fd
    finally:
        fcntl.flock(fd, fcntl.LOCK_UN)
        os.close(fd)

def describe(root, path):
    data = read(path, durable=True)
    return {"path": str(path.relative_to(root)), "bytes": len(data), "sha256": sha(data)}

def verify(root, item):
    relative = Path(item["path"])
    need(not relative.is_absolute() and ".." not in relative.parts, "Original relative artifact required")
    data = read(root / relative, durable=True)
    actual = {"path":str(relative),"bytes":len(data),"sha256":sha(data)}
    need(actual == item, "Retained artifact identity changed")
    return data

def validate_input(spec):
    common = {"schema","operationId","directory","sourceSha256","cargo","rustc",
              "cargoHome","searchPath","timeoutSeconds"}
    need(isinstance(spec,dict),"Complete original build input required")
    current=spec.get("schema") in (CURRENT_SCHEMA,MARKET_SCHEMA,PAIRED_SCHEMA)
    need(spec.get("schema") in (SCHEMA,CURRENT_SCHEMA,MARKET_SCHEMA,PAIRED_SCHEMA) and
         set(spec)==common|({"sourcePacket"} if current else {"sourceRoot"}),
         "Complete original build input required")
    need(isinstance(spec["operationId"],str) and 0<len(spec["operationId"])<=200, "Original programme identity required")
    for key in ("directory","cargoHome"):
        ordinary(spec[key], key!="directory")
    ordinary(spec["sourcePacket"] if current else spec["sourceRoot"])
    if not current:
        need(spec["directory"]!=spec["sourceRoot"], "Retain separate source and operation directories")
    need(isinstance(spec["timeoutSeconds"],int) and not isinstance(spec["timeoutSeconds"],bool)
         and 1<=spec["timeoutSeconds"]<=7200, "Select a bounded native phase timeout")
    need(isinstance(spec["searchPath"],str) and spec["searchPath"] and chr(0) not in spec["searchPath"],
         "Select the actual runtime executable search path")
    need(re.fullmatch("[0-9a-f]{64}",spec["sourceSha256"]) is not None, "Complete source digest required")
    for kind in ("cargo","rustc"):
        value=spec[kind]
        need(isinstance(value,dict) and set(value)=={"path","sha256","version"}, "Complete native executable identity required")
        ordinary(value["path"])
        need(re.fullmatch("[0-9a-f]{64}",value["sha256"]) is not None and
             isinstance(value["version"],str) and value["version"].startswith(kind+" 1.91.0 "),
             "Select the actual Rust/Cargo 1.91.0 toolchain and exact version")
    return spec

def selected_source(spec):
    current=spec["schema"] in (CURRENT_SCHEMA,MARKET_SCHEMA,PAIRED_SCHEMA)
    paired=spec["schema"]==PAIRED_SCHEMA
    market=spec["schema"] in (MARKET_SCHEMA,PAIRED_SCHEMA)
    selected=[]
    if current:
        original=read(spec["sourcePacket"],32*1024*1024)
        need(len(original)==(PAIRED_PACKET_BYTES if paired else (MARKET_PACKET_BYTES if market else CURRENT_PACKET_BYTES)) and sha(original)==(PAIRED_PACKET_SHA if paired else (MARKET_PACKET_SHA if market else CURRENT_PACKET_SHA)),
             "Select the exact complete source packet for the authored edition")
        packet=strict_json(original)
        need(packet["schema"]==("principal.paired-exit-complete.v1" if paired else ("principal.market-complete.v1" if market else "principal.current-accounting-complete.v3")) and
             packet["accountingEdition"]==3 and (not market or packet.get("marketEdition")==1) and
             (not paired or (packet.get("recombinationEdition")==1 and packet.get("routerEdition")==2)) and
             len(packet["files"])==(PAIRED_MEMBERS if paired else (MARKET_MEMBERS if market else 231)),
             "Complete current accounting source edition required")
        names=set()
        for member in packet["files"]:
            name=member["path"]
            need(isinstance(name,str) and name and not Path(name).is_absolute() and
                 ".." not in Path(name).parts and name not in names, "Unique original relative source path required")
            names.add(name)
            data=member["content"].encode("utf-8")
            need(len(data)==member["bytes"] and sha(data)==member["sha256"],"Current original member differs")
            selected.append({"path":name,"bytes":len(data),"sha256":sha(data),
                             "contentBase64":base64.b64encode(data).decode("ascii")})
        manifest_name="CURRENT_PAIRED_EXIT_SOURCE.json" if paired else ("CURRENT_MARKET_SOURCE.json" if market else "CURRENT_ACCOUNTING_SOURCE.json")
        manifest=strict_json(next(m["content"] for m in packet["files"] if m["path"]==manifest_name))
        actual={m["path"]:{key:m[key] for key in ("path","bytes","sha256")} for m in selected}
        need(len(manifest["files"])==len(selected)-1 and len({m["path"] for m in manifest["files"]})==len(selected)-1 and
             {m["path"] for m in manifest["files"]}==names-{manifest_name},
             "Complete current source roster required")
        for member in manifest["files"]:
            need(actual[member["path"]]==member,"Current roster member differs")
        return {"schema":"principal.paired-exit-build-source.v1" if paired else ("principal.market-build-source.v1" if market else "principal.current-accounting-build-source.v3"),"files":selected}, original
    for member in MEMBERS:
        data=read(Path(spec["sourceRoot"])/member["path"])
        need(len(data)==member["bytes"] and sha(data)==member["sha256"], "Original complete reference source differs: "+member["path"])
        selected.append({**member,"contentBase64":base64.b64encode(data).decode("ascii")})
    return {"schema":"principal.reference-build-source.v1","files":selected},None

def runtime_bytes(spec):
    result={}
    for kind in ("cargo","rustc"):
        selected=spec[kind]
        data=read(selected["path"],256*1024*1024)
        need(sha(data)==selected["sha256"], "Selected "+kind+" executable changed")
        need(os.access(selected["path"],os.X_OK), "Selected native tool is not executable")
        result[kind]={"path":selected["path"],"bytes":len(data),"sha256":sha(data),"version":selected["version"]}
    # Cargo's retained user configuration is relevant source, not an invisible resume input.
    configs=[]
    for name in ("config","config.toml"):
        path=Path(spec["cargoHome"])/name
        if path.exists():
            data=read(path,4*1024*1024)
            configs.append({"path":str(path),"bytes":len(data),"sha256":sha(data),
                            "contentBase64":base64.b64encode(data).decode("ascii")})
    result["cargoConfigurations"]=configs
    return result

def main(argv=None):
    parser=argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--input",required=True)
    args=parser.parse_args(argv)
    need(sys.platform.startswith("linux"), "This original operator course uses its maintained Linux lease")
    spec=validate_input(strict_json(read(Path(args.input).absolute(),4*1024*1024)))
    root=mkdir(Path(spec["directory"]))
    binding=sha(encode(spec))
    current=spec["schema"] in (CURRENT_SCHEMA,MARKET_SCHEMA,PAIRED_SCHEMA)
    paired=spec["schema"]==PAIRED_SCHEMA
    market=spec["schema"] in (MARKET_SCHEMA,PAIRED_SCHEMA)
    profile="paired-exit-v1-market-v1-accounting-v3" if paired else ("market-v1-accounting-v3" if market else ("current-accounting-v3" if current else "reference"))
    wasm=REFERENCE_WASM+["principal_pt_token","principal_yt_token","principal_recovery_escrow"] if current else REFERENCE_WASM
    if market:
        wasm=wasm+["principal_market_pool","principal_router"]
    market_snapshots=["market-01-original-ten-contracts","market-02-trades-fees-authentication",
                      "market-03-original-escrow-recovery","market-04-mature-withdrawal","market-05-cold-source-reopen"]
    paired_snapshots=["paired-01-owned-principal-and-earned-yield","paired-02-partial-fraction-preserved",
                      "paired-03-cold-complete-exit","paired-04-rejected-authorization-rates-and-limits",
                      "paired-05-loss-rejection-and-original-maturity"]
    def snapshot_names(kind):
        return paired_snapshots if kind=="paired" else (market_snapshots if kind=="market" else snapshots)
    snapshots=["current-01-live-repeated-claims","current-02-frozen-final",
               "current-03-explicit-pending-recovery","current-04-recovered-final",
               "current-05-complete-maturity-proof","current-06-three-atom-conservation",
               "current-07-full-unit-conservation"] if current else REFERENCE_SNAPSHOTS
    here=ordinary(Path(__file__).absolute())
    helper_path=ordinary(here.parent/"watershed_process.py")
    helper=read(helper_path)
    need(len(helper)==OWNER_BYTES and sha(helper)==OWNER_SHA, "The original native owner differs")
    driver=read(here)
    with lease(root) as lease_fd:
        put(root/"input.json",encode(spec))
        put(root/"executing-driver.py",driver)
        put(root/"executing-owner.py",helper)
        source,original_packet=selected_source(spec)
        selected=source["files"]
        if original_packet is not None:
            put(root/"original-current-packet.json",original_packet)
        need(sha(encode(source))==spec["sourceSha256"], "Selected whole source digest differs")
        put(root/"source-selection.json",encode(source))
        runtime=runtime_bytes(spec)
        put(root/"runtime-selection.json",encode(runtime))
        source_root=mkdir(root/"source")
        for member in selected:
            put(source_root/member["path"],base64.b64decode(member["contentBase64"],validate=True))
        namespace={"__name__":"principal_original_process_owner","__file__":str(helper_path)}
        exec(compile(helper,str(helper_path),"exec"),namespace)
        run_owned=namespace["run_owned"]
        base_env={"PATH":spec["searchPath"],"CARGO_HOME":spec["cargoHome"],
                  "RUSTC":spec["rustc"]["path"],"CARGO_TARGET_DIR":str(source_root/"target"),
                  "RUST_BACKTRACE":"1","LANG":"C.UTF-8"}
        if current:
            base_env["PRINCIPAL_CURRENT_WASM"]=str(source_root/"target"/"wasm32v1-none"/"release")
        put(root/"environment.json",encode(base_env))

        definitions=[
            (PHASES[0],[spec["cargo"]["path"],"--version"],"cargo"),
            (PHASES[1],[spec["rustc"]["path"],"--version"],"rustc"),
            (PHASES[2],[spec["cargo"]["path"],"build","--locked","--release","--target","wasm32v1-none","--workspace"]+
                        (["--exclude","principal_integration_tests"] if current else []),"build"),
            (PHASES[3],[spec["cargo"]["path"],"test","--locked","-p",
                        "principal_integration_tests" if current else "principal_manager",
                        "--test","accounting_lifecycle" if current else "lifecycle",
                        "--","--nocapture","--test-threads=1"],"lifecycle")]
        if market:
            definitions.append(("05-market-lifecycle",[spec["cargo"]["path"],"test","--locked","-p",
                 "principal_integration_tests","--test","market_lifecycle","--","--nocapture","--test-threads=1"],"market"))
        if paired:
            definitions.append(("06-paired-exit-lifecycle",[spec["cargo"]["path"],"test","--locked","-p",
                 "principal_integration_tests","--test","paired_exit_lifecycle","--","--nocapture","--test-threads=1"],"paired"))
        def signature_for(label,argv):
            return {"operationId":spec["operationId"],"inputSha256":binding,"name":label,"profile":profile,
                    "argv":argv,"sourceSha256":spec["sourceSha256"],"runtimeSha256":sha(encode(runtime))}

        def validate_phase(accepted,label,argv,kind):
            signature=signature_for(label,argv)
            need(accepted["schema"]=="principal.contract-build-phase.v1" and
                 accepted["signature"]==signature and accepted["state"]=="COMPLETE"
                 and accepted["failure"] is None and accepted["outcome"]["lifetimes"]=="CLOSED"
                 and accepted["outcome"]["returncode"]==0, "Original accepted build phase differs")
            items=accepted["artifacts"]
            need(len({item["path"] for item in items})==len(items),"Duplicate phase artifact")
            bodies={item["path"]:verify(root,item) for item in items}
            requests=[name for name in bodies if name.endswith("/request.json")]
            need(len(requests)==1,"One complete original phase request required")
            attempt=Path(requests[0]).parent
            need(attempt.parent==Path("phases")/label/"attempts" and
                 re.fullmatch("[0-9]{6}",attempt.name),"Original phase attempt path differs")
            output_names=[name+".wasm" for name in wasm] if kind=="build" else (
                         [name+".json" for name in snapshot_names(kind)] if kind in ("lifecycle","market","paired") else [])
            required={str(attempt/name) for name in ("request.json","process.json","stdout","stderr","result.json")}
            required.update(str(attempt/"outputs"/name) for name in output_names)
            need(set(bodies)==required,"Complete selected phase artifact set required")
            request=strict_json(bodies[str(attempt/"request.json")])
            need(request=={**signature,"environment":{**base_env,"PRINCIPAL_COURSE_ARTIFACTS":str(root/attempt/"outputs")},
                           "kind":kind},"Original phase command/environment changed")
            need(strict_json(bodies[str(attempt/"process.json")])==accepted["outcome"]["process"],
                 "Original process identity changed")
            result=strict_json(bodies[str(attempt/"result.json")])
            expected={**accepted,"artifacts":[item for item in items if item["path"]!=str(attempt/"result.json")]}
            need(result==expected,"Original closed attempt result changed")
            if kind in ("cargo","rustc"):
                need(bodies[str(attempt/"stdout")].decode("utf-8","strict").strip()==spec[kind]["version"],
                     "Actual original compiler version changed")
            for name in output_names:
                data=bodies[str(attempt/"outputs"/name)]
                if kind=="build":
                    need(data[:4]==bytes([0])+b"asm","Original Wasm artifact required")
                else:
                    value=strict_json(data)
                    need(isinstance(value,dict) and "ledger" in value,"Whole original host snapshot required")
            return accepted

        def command(label,argv,kind):
            phase_root=mkdir(root/"phases"/label)
            accepted_path=phase_root/"accepted.json"
            signature=signature_for(label,argv)
            if accepted_path.exists():
                accepted=strict_json(read(accepted_path))
                validate_phase(accepted,label,argv,kind)
                sync_dir(phase_root)
                return accepted
            if kind in ("lifecycle","market","paired"):
                build=strict_json(read(root/"phases"/PHASES[2]/"accepted.json"))
                validate_phase(build,*definitions[2])
                for name in wasm:
                    descriptor=next(item for item in build["artifacts"] if item["path"].endswith("/outputs/"+name+".wasm"))
                    put(source_root/"target"/"wasm32v1-none"/"release"/(name+".wasm"),verify(root,descriptor))
            attempts=mkdir(phase_root/"attempts")
            indices=[]
            for child in attempts.iterdir():
                need(child.is_dir() and re.fullmatch("[0-9]{6}",child.name), "Preserve the original attempt directory")
                indices.append(int(child.name))
            # A successful original process/result may precede accepted-file publication.
            # Adopt that full closed result before considering another compiler attempt.
            for prior_index in sorted(indices):
                prior=attempts/("%06d"%prior_index)/"result.json"
                if prior.exists():
                    retained=strict_json(read(prior,durable=True))
                    if retained.get("state")=="COMPLETE":
                        adopted={**retained,"artifacts":[*retained["artifacts"],describe(root,prior)]}
                        validate_phase(adopted,label,argv,kind)
                        put(accepted_path,encode(adopted))
                        return adopted
            index=max(indices,default=0)+1
            need(index<1000000,"Original attempt capacity exhausted")
            attempt=mkdir(attempts/("%06d"%index))
            outputs=mkdir(attempt/"outputs")
            env={**base_env,"PRINCIPAL_COURSE_ARTIFACTS":str(outputs)}
            put(attempt/"request.json",encode({**signature,"environment":env,"kind":kind}))
            outcome=None
            error=None
            try:
                # The exact executable bytes are checked immediately before every native call.
                need(runtime_bytes(spec)==runtime,"Selected compiler/runtime changed")
                with open(attempt/"stdout","xb",buffering=0) as stdout, open(attempt/"stderr","xb",buffering=0) as stderr:
                    outcome=run_owned(argv,stdout,stderr_stream=stderr,cwd=str(source_root),env=env,
                                      lease_fd=lease_fd,timeout=spec["timeoutSeconds"],
                                      on_started=lambda value:put(attempt/"process.json",encode(value)))
                need(outcome["lifetimes"]=="CLOSED","Native process ownership is unresolved")
                need(outcome["returncode"]==0,"Original native phase returned nonzero status")
                if kind in ("cargo","rustc"):
                    actual=read(attempt/"stdout").decode("utf-8","strict").strip()
                    need(actual==spec[kind]["version"],"Actual native version differs from selection")
                elif kind=="build":
                    for name in wasm:
                        data=read(source_root/"target"/"wasm32v1-none"/"release"/(name+".wasm"))
                        need(data[:4]==bytes([0])+b"asm","Complete actual Wasm required")
                        put(outputs/(name+".wasm"),data)
                elif kind in ("lifecycle","market","paired"):
                    need(sorted(p.name for p in outputs.iterdir())==sorted(n+".json" for n in snapshot_names(kind)),
                         "The complete selected lifecycle snapshot set did not finish")
                    for name in snapshot_names(kind):
                        value=strict_json(read(outputs/(name+".json")))
                        need(isinstance(value,dict) and "ledger" in value,"Complete Soroban snapshot required")
                # Locked Cargo must preserve every selected original source body.
                for member in selected:
                    need(read(source_root/member["path"])==base64.b64decode(member["contentBase64"],validate=True),
                         "A native phase changed the pinned original source")
            except BaseException as failure:
                error={"type":type(failure).__name__,"message":str(failure)}
            artifacts=[]
            for file in sorted(attempt.rglob("*")):
                if file.is_file():
                    artifacts.append(describe(root,file))
            result={"schema":"principal.contract-build-phase.v1","signature":signature,
                    "state":"FAILED" if error else "COMPLETE","outcome":outcome,
                    "failure":error,"artifacts":artifacts,"completedAt":time.time()}
            # run_owned has returned or raised only after original child-tree closure.
            put(attempt/"result.json",encode(result))
            if error:
                raise RuntimeError("Original phase retained at "+str(attempt)+": "+error["message"])
            result["artifacts"].append(describe(root,attempt/"result.json"))
            put(accepted_path,encode(result))
            return result

        def complete_basis():
            phases=[]
            for label,argv,kind in definitions:
                accepted=strict_json(read(root/"phases"/label/"accepted.json"))
                validate_phase(accepted,label,argv,kind)
                phases.append(describe(root,root/"phases"/label/"accepted.json"))
            source_files=[describe(root,root/name) for name in
                          ("input.json","executing-driver.py","executing-owner.py","source-selection.json",
                           "runtime-selection.json","environment.json")]
            if current:
                source_files.append(describe(root,root/"original-current-packet.json"))
            return {"schema":"principal.contract-build-result.v1","state":"COMPLETE","lifetimes":"CLOSED","profile":profile,
                    "operationId":spec["operationId"],"inputSha256":binding,"sourceSha256":spec["sourceSha256"],
                    "phaseNames":[item[0] for item in definitions],"phases":phases,"files":source_files}
        complete=root/"complete.json"
        if complete.exists():
            selected_complete=strict_json(read(complete))
            need(selected_complete==complete_basis(),"Original complete build proof changed")
            sync_dir(root)
            print(json.dumps(selected_complete))
            return 0
        for definition in definitions:
            command(*definition)
        result=complete_basis()
        put(complete,encode(result))
        print(json.dumps(result))
        return 0

if __name__=="__main__":
    raise SystemExit(main())
