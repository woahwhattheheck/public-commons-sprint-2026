#!/usr/bin/env python3
"""Prepare, reopen and start the original joint native operation in one context."""
from __future__ import annotations
import argparse, errno, fcntl, hashlib, json, os, signal, stat, sys
from pathlib import Path

def need(value, code):
    if not value: raise RuntimeError(code)

def terminal_control(fd):
    need(os.isatty(fd), "ORIGINAL_PTY_REQUIRED")
    try: return ("controlling", os.tcgetpgrp(fd))
    except OSError as error:
        if error.errno != errno.ENOTTY: raise
        return ("noncontrolling", None)

def numbered_slave_path(value):
    selected = Path(value)
    need(str(selected) == value and selected.parent == Path("/dev/pts") and
         selected.name and all("0" <= char <= "9" for char in selected.name),
         "ORIGINAL_PTY_SLAVE_PROVENANCE_REQUIRED")
    return str(selected)

def original_slave_path(fd):
    return numbered_slave_path(os.readlink("/proc/self/fd/" + str(fd)))

def slave_identity(fd, path, *, expected_device=None, expected_slave=None):
    selected = Path(path)
    if expected_device is None:
        slave = original_slave_path(fd)
    else:
        need(expected_slave is not None, "ORIGINAL_PTY_SLAVE_PROVENANCE_REQUIRED")
        slave = numbered_slave_path(expected_slave)
    need(str(selected) == path and
         (path == slave or selected == Path("/dev/console")) and
         selected.resolve(strict=True) == selected, "ORIGINAL_PTY_SLAVE_PATH_REQUIRED")
    opened, named = os.fstat(fd), selected.lstat()
    need(stat.S_ISCHR(opened.st_mode) and stat.S_ISCHR(named.st_mode) and
         (opened.st_dev, opened.st_ino, opened.st_rdev) ==
         (named.st_dev, named.st_ino, named.st_rdev), "ORIGINAL_PTY_SLAVE_CHANGED")
    device = [opened.st_dev, opened.st_ino, opened.st_rdev]
    need(expected_device is None or device == expected_device, "ORIGINAL_PTY_SLAVE_CHANGED")
    return device

def digest(data):
    return hashlib.sha256(data).hexdigest()

def save(path, value):
    path=Path(path); data=(json.dumps(value,sort_keys=True,indent=2)+"\n").encode()
    path.parent.mkdir(parents=True,exist_ok=True,mode=0o700)
    if os.path.lexists(path):
        need(stat.S_ISREG(path.lstat().st_mode) and path.read_bytes()==data,"ORIGINAL_LAUNCH_RECORD_CHANGED")
        return
    temporary=path.with_name("."+path.name+".launch-"+str(os.getpid()))
    try:
        with temporary.open("xb") as stream:
            os.chmod(temporary,0o600);stream.write(data);stream.flush();os.fsync(stream.fileno())
        os.link(temporary,path)
    finally:
        if os.path.lexists(temporary):temporary.unlink()

def main():
    parser=argparse.ArgumentParser();parser.add_argument("--config",required=True);args=parser.parse_args()
    selected=Path(args.config).resolve(strict=True);raw=selected.read_bytes();cfg=json.loads(raw)
    project=Path(cfg["project"]);operator=project/"operator";dev=Path(cfg["private_dev_root"])
    need(project.is_absolute() and project.resolve(strict=True)==project,"ORIGINAL_PROJECT_REQUIRED")
    need(dev.parent==Path("/dev") and dev.name.startswith("scf-geocat-d22-33e6-"),"PRIVATE_DEV_CONTEXT_REQUIRED")
    need(not (project/"launch-plan.json").exists(),"ORIGINAL_NATIVE_PLAN_REQUIRES_RECONCILIATION")
    need(not (project/"result"/"state.json").exists(),"ORIGINAL_NATIVE_DISPATCH_ALREADY_RECORDED")
    lock=open(project/"launcher.lock","a+b")
    fcntl.flock(lock.fileno(),fcntl.LOCK_EX|fcntl.LOCK_NB)
    terminal = None
    if cfg.get("source_feed"):
        need(os.isatty(0), "ORIGINAL_SOURCE_FEED_REQUIRES_OWNED_PTY")
        path = os.ttyname(0); mode, foreground = terminal_control(0)
        terminal = {"path": path, "device": slave_identity(0, path),
                    "slavePath": original_slave_path(0),
                    "session": os.getsid(0), "controlMode": mode}
        need(mode == "noncontrolling" or foreground == os.getpgrp(),
             "ORIGINAL_LAUNCHER_MUST_OWN_FOREGROUND_PTY")
    dev.mkdir(mode=0o700)
    save(dev/"context.json",{"operationId":cfg["operation_id"],"configSha256":digest(raw),"launcherPid":os.getpid()})
    worker,temp=dev/"worker",dev/"native-tmp"
    worker.mkdir(mode=0o700);temp.mkdir(mode=0o700)
    sys.path.insert(0,cfg["native_host"])
    import swarm_cloud_job as native
    from cloud_job_workspace import initialize, Workspace
    from native_foreground import ForegroundLaunch
    initialize(operator,peer="33e6-geocat-d22",projects=[str(project)],
        records_root=cfg["records_root"],worker_root=str(worker),temp_root=str(temp),label="GeoCat complete package")
    resources=cfg["resources"]
    request={"operation_id":cfg["operation_id"],"project":str(project),
        "command":[cfg["python"],"-B",cfg["driver"],"--config",str(selected)],
        "artifacts":resources["artifacts"],
        "memory_mib":resources["memory_mib"],"memory_reserve_mib":resources["memory_reserve_mib"],
        "memory_reclaim":"clean-cache","memory_reservations_root":cfg["memory_reservations_root"],
        "disk_space":[str(dev)+"="+str(resources["dev_mib"]),str(project)+"="+str(resources["persistent_mib"])],
        "disk_inodes":[str(dev)+"="+str(resources["dev_inodes"]),str(project)+"="+str(resources["persistent_inodes"])],
        "disk_reserve_mib":resources["disk_reserve_mib"],"disk_reserve_inodes":resources["disk_reserve_inodes"],
        "disk_reservations_root":cfg["disk_reservations_root"],"runtime_paths":cfg["runtime_paths"],
        "runtime_consumers_root":cfg["runtime_consumers_root"]}
    workspace=Workspace(operator)
    with workspace.own(): plan=workspace.prepare(request)
    save(project/"launch-plan.json",plan)
    reopened=Workspace(operator).plan(plan["id"])
    need(reopened["id"]==plan["id"] and reopened["sha256"]==plan["sha256"],"ORIGINAL_REVIEW_REOPEN_CHANGED")
    save(project/"launch-plan-reopened.json",reopened)
    print(json.dumps({"phase":"ORIGINAL_REVIEW_REOPENED","operationId":cfg["operation_id"],
          "planId":plan["id"],"sha256":plan["sha256"],"resources":resources}),flush=True)
    launch=ForegroundLaunch(native)
    try:
        with workspace.own(): acknowledgement=workspace.start(plan["id"],plan["sha256"],launcher=launch)
        save(project/"launch-acknowledgement.json",acknowledgement)
        if terminal is not None:
            need(launch.identity is not None and os.getsid(0) == terminal["session"],
                 "SOURCE_TERMINAL_SESSION_CHANGED")
            need(original_slave_path(0) == terminal["slavePath"] and
                 slave_identity(0, terminal["path"]) == terminal["device"],
                 "SOURCE_TERMINAL_DEVICE_CHANGED")
            mode, _ = terminal_control(0)
            need(mode == terminal["controlMode"], "SOURCE_TERMINAL_CONTROL_MODE_CHANGED")
            if mode == "controlling":
                previous_mask = signal.pthread_sigmask(signal.SIG_BLOCK, {signal.SIGTTOU})
                try:
                    os.tcsetpgrp(0, os.getpgrp())
                finally:
                    signal.pthread_sigmask(signal.SIG_SETMASK, previous_mask)
                need(os.tcgetpgrp(0) == os.getpgrp(), "SOURCE_TERMINAL_HANDOFF_FAILED")
            save(dev/"source-terminal.json", {**terminal, "schema": "starforge.geocat-source-terminal.v1",
                 "operationId": cfg["operation_id"], "configSha256": digest(raw),
                 "processGroup": os.getpgrp(), "supervisor": launch.identity})
        print(json.dumps({"phase":"ORIGINAL_NATIVE_START_RETURNED","operationId":cfg["operation_id"],
              "acknowledgementFile":str(project/"launch-acknowledgement.json")}),flush=True)
    finally:
        # The maintained callback owns accepted-start recovery and foreground handoff.
        # The /dev owner stays alive through the supervisor and original command.
        launch.handoff()

if __name__=="__main__":
    main()
