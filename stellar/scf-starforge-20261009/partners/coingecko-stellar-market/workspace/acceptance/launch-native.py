#!/usr/bin/env python3
"""Run the original CoinGecko provider/operator journey on a configured host."""
from __future__ import annotations
import argparse
import hashlib
import json
import os
from pathlib import Path
import re
import shutil
import subprocess
import sys
from urllib.parse import urlparse
import uuid

FEATURE = Path("stellar/scf-starforge-20261009/partners/coingecko-stellar-market")

def retain_json(path, value):
    encoded = (json.dumps(value, indent=2) + "\n").encode()
    path.parent.mkdir(parents=True, exist_ok=True, mode=0o700)
    temporary = path.with_name(path.name + ".writing-" + str(os.getpid()))
    descriptor = os.open(temporary, os.O_WRONLY | os.O_CREAT | os.O_EXCL, 0o600)
    with os.fdopen(descriptor, "wb") as stream:
        stream.write(encoded)
        stream.flush()
        os.fsync(stream.fileno())
    os.replace(temporary, path)
    os.chmod(path, 0o600)

def location(value, base, label):
    if not isinstance(value, str) or not value.strip():
        raise ValueError("Set " + label + " in the native configuration")
    path = Path(os.path.expanduser(value))
    return (path if path.is_absolute() else base / path).resolve()

def find_source():
    for candidate in Path(__file__).resolve().parents:
        if (candidate / FEATURE / "provider.mjs").is_file():
            return candidate
    raise ValueError("Set sourceRoot to the checkout containing the original Starforge source")

def configured_environment(config_file, options):
    original = config_file.read_bytes()
    supplied = json.loads(original)
    if not isinstance(supplied, dict):
        raise ValueError("Native configuration must be an object")
    base = config_file.parent
    source_root = location(supplied["sourceRoot"], base, "sourceRoot") if supplied.get("sourceRoot") else find_source()
    if not (source_root / FEATURE / "workspace" / "acceptance" / "native-environment.mjs").is_file():
        raise ValueError("The selected sourceRoot lacks this complete native acceptance package")
    directory = location(supplied.get("directory", "./coingecko-native-run"), base, "directory")
    directory.mkdir(parents=True, exist_ok=True, mode=0o700)
    environment_file = directory / "environment.json"
    retained = json.loads(environment_file.read_text()) if environment_file.exists() else None
    operation_id = supplied.get("operationId") or (retained or {}).get("operationId") or "coingecko-native-" + str(uuid.uuid4())
    if not isinstance(operation_id, str) or not re.fullmatch(r"[A-Za-z0-9._:-]{1,90}", operation_id):
        raise ValueError("operationId must be a stable identifier of at most 90 ASCII characters")
    source_ref = supplied.get("sourceRef", "")
    if not source_ref:
        try:
            source_ref = subprocess.check_output(["git", "-C", str(source_root), "rev-parse", "HEAD"], text=True, stderr=subprocess.DEVNULL, timeout=5).strip()
        except (OSError, subprocess.SubprocessError):
            source_ref = "source-directory-with-retained-file-hashes"
    node = options.node or supplied.get("node") or os.environ.get("NODE") or shutil.which("node")
    if not node:
        raise ValueError("Node 24 or later must be on PATH, in NODE, or selected with --node")
    node = str(location(node, base, "node")) if "/" in node else shutil.which(node)
    if not node:
        raise ValueError("Configured Node executable is unavailable")
    version = subprocess.check_output([node, "--version"], text=True, timeout=10).strip()
    if not re.fullmatch(r"v\d+\.\d+\.\d+(?:[-+].*)?", version) or int(version.split(".")[0][1:]) < 24:
        raise ValueError("This original workspace requires Node 24 or later")
    for name in ("buyerSecretEnv", "facilitatorSecretEnv"):
        if not isinstance(supplied.get(name), str) or not re.fullmatch(r"[A-Za-z_][A-Za-z0-9_]{0,127}", supplied[name]):
            raise ValueError("Set the existing " + name + " environment-variable name")
    expected = supplied.get("originalPaidResultSha256", "")
    if not isinstance(expected, str) or not re.fullmatch(r"[a-f0-9]{64}", expected):
        raise ValueError("Set the exact SHA-256 of the retained original public payment outcome")
    merchant = supplied.get("merchantOrigin", "https://coingecko-staging.example")
    parsed = urlparse(merchant)
    if parsed.scheme != "https" or not parsed.hostname or parsed.username or parsed.password or parsed.port not in (None, 443) or parsed.path not in ("", "/") or parsed.query or parsed.fragment:
        raise ValueError("merchantOrigin must be the complete HTTPS staging origin on port 443")
    merchant = "https://" + parsed.hostname.lower()
    profile_input = supplied.get("profile", {})
    if not isinstance(profile_input, dict):
        raise ValueError("profile must be an object")
    operator = location(profile_input.get("workspacePath", "operator"), directory, "profile.workspacePath")
    profile = {
        "id": profile_input.get("id", "coingecko-native-testnet"),
        "name": profile_input.get("name", "Existing testnet account / CoinGecko staging"),
        "network": "stellar:testnet",
        "configPath": str(location(profile_input.get("configPath", "operator.json"), operator, "profile.configPath")),
        "workspacePath": str(operator),
    }
    value = {
        "schema": "coingecko.native-environment.v1",
        "directory": str(directory),
        "configurationFile": str(config_file),
        "configurationSha256": hashlib.sha256(original).hexdigest(),
        "stateDirectory": str(location(supplied.get("stateDirectory", "state"), directory, "stateDirectory")),
        "sourceRoot": str(source_root), "sourceRef": source_ref,
        "operationId": operation_id, "node": node, "nodeVersion": version,
        "vendorSourceDirectory": str(location(supplied.get("vendorSourceDirectory"), base, "vendorSourceDirectory")),
        "publicConfigFile": str(location(supplied.get("publicConfigFile"), base, "publicConfigFile")),
        "originalPaidResult": str(location(supplied.get("originalPaidResult"), base, "originalPaidResult")),
        "originalPaidResultSha256": expected,
        "rpcUrl": supplied.get("rpcUrl", "https://soroban-rpc.testnet.stellar.gateway.fm"),
        "signerOwnershipDirectory": str(location(supplied.get("signerOwnershipDirectory"), base, "signerOwnershipDirectory")),
        "buyerSecretEnv": supplied["buyerSecretEnv"],
        "facilitatorSecretEnv": supplied["facilitatorSecretEnv"],
        "merchantOrigin": merchant,
        "ports": {"seller": 0, "tls": 0, "proxy": 0, "workspace": 0},
        "tlsKeyFile": str(directory / "development-tls-key.pem"),
        "tlsCertificateFile": str(directory / "development-tls-certificate.pem"),
        "tlsTrustFile": str(directory / "development-tls-trust.pem"),
        "python": sys.executable, "profile": profile,
        "operatorConfigFile": str(directory / "operator-config.json"),
    }
    if retained:
        # Account and operation identity are preserved when this same run is reopened.
        for key in ("directory", "operationId", "stateDirectory", "vendorSourceDirectory",
                    "publicConfigFile", "originalPaidResult", "originalPaidResultSha256",
                    "signerOwnershipDirectory", "buyerSecretEnv", "facilitatorSecretEnv",
                    "merchantOrigin", "rpcUrl", "profile"):
            if retained.get(key) != value[key]:
                raise ValueError("The retained operation's " + key + " changed; reopen its original configuration")
        value["ports"] = retained["ports"]
    retain_json(environment_file, value)
    browser = supplied.get("browser", {})
    if not isinstance(browser, dict):
        raise ValueError("browser must be an object")
    browser_config = {
        "output": str(location(browser.get("output", "browser-output"), directory, "browser.output")),
        "sourceRoot": value["vendorSourceDirectory"],
        "launch": [sys.executable, str(Path(__file__).resolve()), "--config", str(config_file), "--serve", "--node", node],
        "cwd": str(directory), "buyerProfileId": profile["id"],
    }
    for key in ("chromium", "playwrightModule"):
        if browser.get(key):
            selected = browser[key]
            if key == "chromium" or selected.startswith((".", "/", "~")):
                selected = str(location(selected, base, "browser." + key))
            browser_config[key] = selected
    retain_json(directory / "BROWSER_CONFIG.json", browser_config)
    return value, environment_file

def certificate(config):
    key, cert = Path(config["tlsKeyFile"]), Path(config["tlsCertificateFile"])
    if key.exists() != cert.exists():
        raise ValueError("The retained development TLS pair is incomplete")
    if not key.exists():
        host = urlparse(config["merchantOrigin"]).hostname
        subprocess.run([
            "openssl", "req", "-x509", "-newkey", "rsa:2048", "-nodes",
            "-keyout", str(key), "-out", str(cert), "-days", "3",
            "-subj", "/CN=" + host,
            "-addext", "subjectAltName=DNS:" + host,
            "-addext", "basicConstraints=critical,CA:TRUE",
            "-addext", "keyUsage=critical,digitalSignature,keyEncipherment,keyCertSign",
            "-addext", "extendedKeyUsage=serverAuth",
        ], check=True, stdin=subprocess.DEVNULL, stdout=subprocess.DEVNULL, stderr=subprocess.DEVNULL)
        os.chmod(key, 0o600)
        os.chmod(cert, 0o600)
    trust = Path(config["tlsTrustFile"])
    original = os.environ.get("NODE_EXTRA_CA_CERTS")
    data = b""
    if original and Path(original).resolve() != trust.resolve():
        data = Path(original).read_bytes().rstrip() + b"\n"
    data += cert.read_bytes().rstrip() + b"\n"
    if not trust.exists():
        descriptor = os.open(trust, os.O_WRONLY | os.O_CREAT | os.O_EXCL, 0o600)
        with os.fdopen(descriptor, "wb") as stream:
            stream.write(data)
    elif original and Path(original).resolve() != trust.resolve() and trust.read_bytes() != data:
        raise ValueError("The existing Node TLS trust source changed; preserve the original trust bundle")
    os.environ["NODE_EXTRA_CA_CERTS"] = str(trust)

def main():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--config", required=True, help="Owner-supplied public paths, assignment and signing-environment names")
    parser.add_argument("--node", help="Existing Node 24 or later executable")
    modes = parser.add_mutually_exclusive_group(required=True)
    modes.add_argument("--prepare", action="store_true", help="Retain sources and initialize the original SF88 operator without a payment")
    modes.add_argument("--serve", action="store_true", help="Open the original SF30/facilitator/SF88 workspace for explicit operator actions")
    options = parser.parse_args()
    config, environment_file = configured_environment(Path(options.config).expanduser().resolve(), options)
    certificate(config)
    if options.serve:
        for name in (config["buyerSecretEnv"], config["facilitatorSecretEnv"]):
            if not os.environ.get(name):
                raise ValueError("The existing owner must supply " + name + " in this process environment")
        if not Path(config["signerOwnershipDirectory"]).is_dir():
            raise ValueError("Set the existing shared native signer ownership directory; do not create a parallel signer lease")
    helper = Path(config["sourceRoot"]) / FEATURE / "workspace" / "acceptance" / "native-environment.mjs"
    args = [config["node"], str(helper), str(environment_file)]
    if options.prepare:
        args.append("--prepare")
    os.execvpe(config["node"], args, os.environ.copy())

if __name__ == "__main__":
    main()
