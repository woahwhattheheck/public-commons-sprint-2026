#!/usr/bin/env python3
"""Install and operate the complete Dwellir migration example in one private receiving directory."""
import argparse, fcntl, hashlib, json, os, shutil, subprocess, sys, time
from pathlib import Path

def encoded(value):
    return (json.dumps(value, indent=2, sort_keys=True) + "\n").encode()

def write(path, value):
    path = Path(path)
    path.parent.mkdir(parents=True, exist_ok=True, mode=0o700)
    temporary = path.with_name(path.name + ".writing")
    with open(temporary, "wb") as stream:
        os.chmod(temporary, 0o600)
        stream.write(encoded(value))
        stream.flush()
        os.fsync(stream.fileno())
    os.replace(temporary, path)

def sha(path):
    return hashlib.sha256(Path(path).read_bytes()).hexdigest()

def main():
    parser = argparse.ArgumentParser(description=__doc__, allow_abbrev=False)
    parser.add_argument("--source", required=True)
    parser.add_argument("--directory", required=True)
    parser.add_argument("--node", default="node")
    parser.add_argument("--resume", action="store_true")
    args = parser.parse_args()
    source = Path(args.source).resolve(strict=True)
    root = Path(args.directory).absolute()
    if args.resume:
        if not root.is_dir():
            raise RuntimeError("Select the original receiving directory")
    else:
        root.mkdir(parents=True, mode=0o700, exist_ok=False)
    with open(root / ".receiving.lock", "a+b") as lock:
        os.chmod(root / ".receiving.lock", 0o600)
        fcntl.flock(lock.fileno(), fcntl.LOCK_EX | fcntl.LOCK_NB)
        return operate(source, root, args)

def operate(source, root, args):
    project, operation = root / "application", root / "migration-operation"
    journal_path = root / "receiving.json"
    if journal_path.exists():
        journal = json.loads(journal_path.read_text())
        if journal.get("source") != str(source):
            raise RuntimeError("Resume the same receiving source")
    else:
        journal = {"schema": "dwellir.receiving.v1", "source": str(source),
                   "operation": "DWELLIR-AGENT-MIGRATION-WORKSHARE-0C7A-20261011",
                   "startedAt": time.strftime("%Y-%m-%dT%H:%M:%SZ", time.gmtime()), "stages": {}}
        project.mkdir(mode=0o700)
        (root / "results").mkdir(mode=0o700)
        for name in ("polkadot_reader.py", "polkadot_reader.mjs"):
            shutil.copyfile(source / "apps" / name, project / name)
        before_env = "# Existing application configuration\nSERVICE_LABEL='retained-polkadot-reader'\nAPP_RPC_URL='https://rpc.polkadot.io'\n"
        (project / ".env").write_text(before_env)
        os.chmod(project / ".env", 0o600)
        write(project / "application-config.json", {"name": "retained-polkadot-reader",
                                                    "rpc": {"url": "https://rpc.polkadot.io", "transport": "https"},
                                                    "pollSeconds": 30})
        write(root / "plan.json", json.loads((source / "examples" / "polkadot-plan.json").read_text()))
        journal["before"] = {name: sha(project / name) for name in (".env", "application-config.json")}
        journal["sourceFiles"] = {str(p.relative_to(source)): sha(p) for p in source.rglob("*")
                                  if p.is_file() and p.suffix in (".py", ".mjs", ".json", ".md")}
        write(journal_path, journal)
    for name, expected in journal["sourceFiles"].items():
        if sha(source / name) != expected:
            raise RuntimeError("Receiving source changed: " + name)

    operator = [sys.executable, "-B", str(source / "dwellir_migration.py")]
    def command(stage, argv, expected_file=None):
        previous = journal["stages"].get(stage, {})
        if previous.get("status") == "complete":
            return previous["result"]
        if expected_file and Path(expected_file).is_file():
            value = json.loads(Path(expected_file).read_text())
            expected_genesis = json.loads((root / "plan.json").read_text())["expectedGenesis"]
            if value.get("genesis") != expected_genesis or value.get("endpointHost") != "polkadot-rpc.n.dwellir.com" or len(value.get("responses", [])) != 4:
                raise RuntimeError("Retained application output differs from the selected native request")
            journal["stages"][stage] = {"status": "complete", "result": value, "reconciled": True}
            write(journal_path, journal)
            return value
        journal["stages"][stage] = {"status": "running", "startedAt": time.strftime("%Y-%m-%dT%H:%M:%SZ", time.gmtime())}
        write(journal_path, journal)
        print("START " + stage, flush=True)
        with open(root / "results" / (stage + ".stdout"), "wb") as stdout:
            with open(root / "results" / (stage + ".stderr"), "wb") as stderr:
                result = subprocess.run(argv, stdout=stdout, stderr=stderr, timeout=240)
        if result.returncode != 0:
            journal["stages"][stage].update(status="incomplete", exitCode=result.returncode)
            write(journal_path, journal)
            raise RuntimeError("Receiving stage did not complete: " + stage)
        raw = (root / "results" / (stage + ".stdout")).read_bytes()
        value = json.loads(raw)
        if expected_file:
            value = json.loads(Path(expected_file).read_text())
        journal["stages"][stage].update(status="complete", exitCode=0, result=value)
        write(journal_path, journal)
        print("COMPLETE " + stage, flush=True)
        return value

    prepare = operator + ["prepare", "--plan", str(root / "plan.json"), "--project", str(project),
                          "--operation", str(operation)]
    if operation.exists() and not journal["stages"].get("01-prepare", {}).get("status") == "complete":
        state = json.loads((operation / "operation.json").read_text())
        if state.get("state") in ("PREPARING", "PREPARATION_INCOMPLETE"):
            prepare += ["--resume"]
        elif state.get("state") == "REVIEW_READY":
            journal["stages"]["01-prepare"] = {"status": "complete", "result": {"ok": True, "result":
                                               {"reviewSha256": state["reviewSha256"]}}, "reconciled": True}
            write(journal_path, journal)
        else:
            raise RuntimeError("Reconcile the existing migration state before resuming preparation")
    prepared = command("01-prepare", prepare)["result"]
    command("02-apply", operator + ["apply", "--operation", str(operation),
                                   "--review-sha256", prepared["reviewSha256"]])
    python_result = root / "results" / "python-application.json"
    python = command("03-python-application", [sys.executable, "-B", str(project / "polkadot_reader.py"),
                                              "--env-file", str(project / ".env"), "--output", str(python_result)],
                     python_result)
    node_result = root / "results" / "node-application.json"
    node = shutil.which(args.node) if not Path(args.node).is_absolute() else args.node
    if not node:
        raise RuntimeError("Select the existing Node 24.5+ executable")
    node_flags = ["--use-env-proxy"] if os.getenv("HTTPS_PROXY") or os.getenv("HTTP_PROXY") else []
    javascript = command("04-node-application", [node, *node_flags, str(project / "polkadot_reader.mjs"),
                                                "--env-file", str(project / ".env"), "--output", str(node_result)],
                         node_result)
    expected = json.loads((root / "plan.json").read_text())["expectedGenesis"]
    if any(value["genesis"] != expected or value["endpointHost"] != "polkadot-rpc.n.dwellir.com"
           for value in (python, javascript)):
        raise RuntimeError("The original applications did not use the selected native chain")
    command("05-reopen", operator + ["inspect", "--operation", str(operation)])
    command("06-handoff", operator + ["handoff", "--operation", str(operation), "--output", str(root / "buyer-handoff")])
    command("07-rollback", operator + ["rollback", "--operation", str(operation)])
    reopened = command("08-reopen-original", operator + ["inspect", "--operation", str(operation)])["result"]
    actual = {name: sha(project / name) for name in journal["before"]}
    if actual != journal["before"] or reopened["observed"] != "ORIGINAL":
        raise RuntimeError("Original application configuration did not reopen byte-exact")
    final_observation = json.loads((operation / "review.json").read_text())["observation"]
    journal.update(status="complete", finishedAt=time.strftime("%Y-%m-%dT%H:%M:%SZ", time.gmtime()),
                   reviewSha256=prepared["reviewSha256"], originalConfigurationRestored=True,
                   applicationClients=["python", "node"], sourceProvider="Dwellir public Polkadot mainnet",
                   baselineProvider="rpc.polkadot.io", providerObservations=final_observation["callCount"],
                   providerNetworkCallsOnFinalAttempt=final_observation["networkCallCount"],
                   providerReusedObservations=final_observation["reusedCallCount"], applicationCalls=8, handoff=str(root / "buyer-handoff"),
                   nativeResults=str(root / "results"))
    write(journal_path, journal)
    print(json.dumps({"status": "complete", "receiving": str(root), "reviewSha256": prepared["reviewSha256"],
                      "originalConfigurationRestored": True, "clients": ["python", "node"],
                      "handoff": str(root / "buyer-handoff")}, sort_keys=True))
    return 0

if __name__ == "__main__":
    raise SystemExit(main())
