#!/usr/bin/env python3
"""AgentSmith source capture and native Commons buyer preparation. MIT."""
import argparse
import base64
import datetime as dt
import hashlib
import fcntl
from contextlib import contextmanager
import json
import os
from pathlib import Path
import re
import subprocess
import sys
import stat
import uuid
from urllib.error import HTTPError
from urllib.parse import urlsplit
from urllib.request import HTTPRedirectHandler, Request, build_opener

NETWORK = "stellar:testnet"
ASSET = "CBIELTK6YBZJU5UP2WWQEUCYKLPU6AUNZ2BQ4WWFEIE3USCIHMXQDAMA"
SELLER = "https://agentsmith.xyz/metar/v1/metar"
FACILITATOR = "https://agentsmith.xyz/facilitator"
MAX_CAPTURE = 1048576
SCHEMA = "commons.agentsmith.source-capture.v1"
NATIVE = Path("stellar/scf-starforge-20261009/sf88-operator-buyer-cli/cli.mjs")


def sha(data):
    return hashlib.sha256(data).hexdigest()


def encoded(value):
    return (json.dumps(value, indent=2, ensure_ascii=False) + "\n").encode()


def need(value, message):
    if not value:
        raise ValueError(message)


def https(value):
    parsed = urlsplit(value)
    need(parsed.scheme == "https" and parsed.hostname and not parsed.username
         and not parsed.password and not parsed.fragment, "Public HTTPS URL required")
    return value


def write_new(path, data):
    """Publish complete bytes with the original create-only contract."""
    temporary = path.with_name("." + path.name + "." + uuid.uuid4().hex + ".tmp")
    owned = False
    try:
        fd = os.open(temporary, os.O_WRONLY | os.O_CREAT | os.O_EXCL, 0o600)
        owned = True
        with os.fdopen(fd, "wb") as stream:
            stream.write(data)
            stream.flush()
            os.fsync(stream.fileno())
        os.link(temporary, path, follow_symlinks=False)
        directory_fd = os.open(path.parent, os.O_RDONLY | os.O_DIRECTORY)
        try:
            os.fsync(directory_fd)
        finally:
            os.close(directory_fd)
    finally:
        if owned:
            temporary.unlink(missing_ok=True)


def retain_exact(path, data):
    """Reuse completed bytes directly, including on a nearly full filesystem."""
    try:
        fd = os.open(path, os.O_RDONLY | os.O_NOFOLLOW)
    except FileNotFoundError:
        try:
            write_new(path, data)
            return
        except FileExistsError:
            fd = os.open(path, os.O_RDONLY | os.O_NOFOLLOW)
    with os.fdopen(fd, "rb") as stream:
        info = os.fstat(stream.fileno())
        need(stat.S_ISREG(info.st_mode) and not info.st_mode & 0o077
             and info.st_size == len(data), "Retained file differs: " + path.name)
        need(stream.read(len(data) + 1) == data, "Retained bytes differ: " + path.name)


@contextmanager
def output_operation(directory):
    directory.mkdir(mode=0o700, exist_ok=True)
    info = directory.lstat()
    need(stat.S_ISDIR(info.st_mode) and not info.st_mode & 0o077
         and info.st_uid == os.getuid(), "Use the original private output directory")
    fd = os.open(directory / ".receiving.lock",
                 os.O_RDWR | os.O_CREAT | os.O_NOFOLLOW, 0o600)
    try:
        lock_info = os.fstat(fd)
        need(stat.S_ISREG(lock_info.st_mode) and not lock_info.st_mode & 0o077,
             "Original receiving lock must be private")
        try:
            fcntl.flock(fd, fcntl.LOCK_EX | fcntl.LOCK_NB)
        except BlockingIOError:
            raise ValueError("The original receiving operation is already running")
        yield
    finally:
        os.close(fd)


class NoRedirect(HTTPRedirectHandler):
    def redirect_request(self, req, fp, code, msg, headers, newurl):
        return None


def read_http(url, method, body=None):
    req = Request(https(url), data=body, method=method,
                  headers={"Accept": "application/json",
                           "Content-Type": "application/json",
                           "User-Agent": "TokenJunkieLabs-AgentSmith-Integration/1.0"})
    try:
        response = build_opener(NoRedirect()).open(req, timeout=25)
    except HTTPError as error:
        response = error
    with response:
        data = response.read(MAX_CAPTURE + 1)
        need(len(data) <= MAX_CAPTURE, "Response exceeds capture limit")
        return {"url": url, "method": method,
                "retrievedAt": dt.datetime.now(dt.timezone.utc).isoformat(),
                "status": response.status,
                "headers": dict((k.lower(), v) for k, v in response.headers.items()),
                "bodyUtf8": data.decode("utf-8"), "bodySha256": sha(data)}


def select_offer(challenge, url):
    need(challenge.get("x402Version") == 2, "x402 version 2 required")
    need(challenge.get("resource", {}).get("url") == url,
         "Original challenge resource must match the requested URL exactly")
    offers = challenge.get("accepts")
    need(isinstance(offers, list) and 0 < len(offers) <= 32, "Original offers required")
    selected = []
    for index, offer in enumerate(offers):
        if (offer.get("scheme") == "exact" and offer.get("network") == NETWORK
                and offer.get("asset") == ASSET
                and offer.get("extra", {}).get("areFeesSponsored") is True):
            need(re.fullmatch(r"[1-9][0-9]*", str(offer.get("amount", ""))),
                 "Positive atomic amount required")
            need(re.fullmatch(r"[GC][A-Z2-7]{55}", str(offer.get("payTo", ""))),
                 "Stellar recipient required")
            need(type(offer.get("maxTimeoutSeconds")) is int
                 and 1 <= offer["maxTimeoutSeconds"] <= 86400,
                 "Native authorization lifetime required")
            need(offer.get("extra", {}).get("paymentFlow", "authorization") == "authorization",
                 "This receiving recipe selects authorization payment flow")
            selected.append(index)
    need(len(selected) == 1, "Exactly one sponsored exact testnet USDC offer required")
    return selected[0]


def capture(args):
    directory = Path(args.directory).resolve()
    directory.mkdir(mode=0o700)
    body = Path(args.body_file).read_bytes() if args.body_file else encoded({"icao": args.icao})
    need(0 < len(body) <= 16777216, "Native request must contain 1 byte to 16 MiB")
    request_json = json.loads(body)
    need(isinstance(request_json, dict), "The selected JSON request must be an object")
    write_new(directory / "request.json", body)
    supported = read_http(args.facilitator.rstrip("/") + "/supported", "GET")
    write_new(directory / "supported.http.json", encoded(supported))
    response = read_http(args.url, "POST", body)
    response["requestBodySha256"] = sha(body)
    response["requestBodyBytes"] = len(body)
    write_new(directory / "challenge.http.json", encoded(response))
    return complete_capture(directory, body, supported, response, args.url, args.facilitator)


def complete_capture(directory, body, supported, response, url, facilitator, *, resume=False):
    retain = retain_exact if resume else write_new
    need(supported["status"] == 200, "Facilitator supported response must be HTTP 200")
    kinds = json.loads(supported["bodyUtf8"]).get("kinds", [])
    need(any(k.get("x402Version") == 2 and k.get("scheme") == "exact"
             and k.get("network") == NETWORK
             and k.get("extra", {}).get("areFeesSponsored") is True for k in kinds),
         "Facilitator must advertise sponsored exact Stellar testnet")
    need(response["status"] == 402, "Seller must return the actual unpaid HTTP 402")
    header = response["headers"].get("payment-required", "")
    need(0 < len(header) <= 262144, "Original PAYMENT-REQUIRED header required")
    challenge_bytes = base64.b64decode(header, validate=True)
    challenge = json.loads(challenge_bytes)
    index = select_offer(challenge, url)
    retain(directory / "payment-required.json", challenge_bytes)
    # Only the envelope changes. Preserve the entire original challenge as its row.
    retain(directory / "offers.json", encoded({"resources": [challenge]}))
    names = ["request.json", "supported.http.json", "challenge.http.json",
             "payment-required.json", "offers.json"]
    manifest = {"schema": SCHEMA, "seller": url, "method": "POST",
                "facilitator": facilitator, "network": NETWORK,
                "capturedAt": response["retrievedAt"], "rowIndex": 0,
                "acceptIndex": index, "selectedOffer": challenge["accepts"][index],
                "files": {name: {"sha256": sha((directory / name).read_bytes()),
                                 "bytes": (directory / name).stat().st_size} for name in names}}
    retain(directory / "capture.json", encoded(manifest))
    return {"status": "ORIGINAL_HTTP_SOURCE_CAPTURED", "directory": str(directory),
            "manifestSha256": sha((directory / "capture.json").read_bytes()),
            "selectedOffer": manifest["selectedOffer"]}


def restore(args):
    bundle = json.loads(Path(args.source).read_bytes())
    need(bundle.get("schema") == "commons.agentsmith.http-bundle.v1",
         "Original AgentSmith HTTP bundle required")
    supported, response = bundle["supported"], bundle["challenge"]
    body = bundle["requestUtf8"].encode("utf-8")
    need(response["requestBodySha256"] == sha(body)
         and response["requestBodyBytes"] == len(body), "Original request bytes changed")
    need(supported["bodySha256"] == sha(supported["bodyUtf8"].encode("utf-8"))
         and response["bodySha256"] == sha(response["bodyUtf8"].encode("utf-8")),
         "Original HTTP response bytes changed")
    url, facilitator = https(bundle["seller"]), https(bundle["facilitator"])
    need(response["url"] == url and response["method"] == "POST"
         and supported["url"] == facilitator.rstrip("/") + "/supported"
         and supported["method"] == "GET", "Original HTTP sources changed")
    directory = Path(args.directory).absolute()
    need(directory.resolve() == directory, "Use the original unaliased capture path")
    with output_operation(directory):
        retain_exact(directory / "request.json", body)
        retain_exact(directory / "supported.http.json", encoded(supported))
        retain_exact(directory / "challenge.http.json", encoded(response))
        return complete_capture(directory, body, supported, response, url, facilitator, resume=True)


def read_capture(directory):
    root = Path(directory).resolve()
    manifest = json.loads((root / "capture.json").read_bytes())
    need(manifest.get("schema") == SCHEMA, "Original capture schema required")
    for name, expected in manifest["files"].items():
        need(Path(name).name == name, "Capture file must remain inside its directory")
        data = (root / name).read_bytes()
        need(len(data) == expected["bytes"] and sha(data) == expected["sha256"],
             "Retained source bytes changed: " + name)
    response = json.loads((root / "challenge.http.json").read_bytes())
    body = (root / "request.json").read_bytes()
    need(response["status"] == 402 and response["requestBodySha256"] == sha(body)
         and response["requestBodyBytes"] == len(body), "Original HTTP request binding changed")
    challenge = json.loads((root / "payment-required.json").read_bytes())
    need(base64.b64decode(response["headers"]["payment-required"], validate=True)
         == (root / "payment-required.json").read_bytes(), "Original header bytes changed")
    need(json.loads((root / "offers.json").read_bytes()) == {"resources": [challenge]},
         "Native saved offer must carry the complete original challenge")
    index = select_offer(challenge, manifest["seller"])
    need(index == manifest["acceptIndex"]
         and challenge["accepts"][index] == manifest["selectedOffer"],
         "Selected source terms changed")
    return root, manifest


PREPARE_REVIEW_JS = """
import {readFile} from 'node:fs/promises';
import {pathToFileURL} from 'node:url';
const {prepareReview} = await import(pathToFileURL(process.argv[1]).href);
const result = prepareReview(await readFile(process.argv[2]), JSON.parse(process.argv[3]));
process.stdout.write(JSON.stringify({configSha256:result.configSha256,
    dataBase64:result.data.toString('base64')}));
"""


def prepare(args):
    root, manifest = read_capture(args.capture)
    checkout = Path(args.checkout).resolve()
    cli = checkout / NATIVE
    need(cli.is_file(), "Complete Commons checkout and original SF88 CLI required")
    need(re.fullmatch(r"[A-Za-z0-9._:-]{1,128}", args.intent_id), "Stable intent ID required")
    output = Path(args.directory).absolute()
    need(output.resolve() == output, "Use the original unaliased request path")
    body = (root / "request.json").read_bytes()
    review_path = output / "review.json"
    record_path = output / "preparation.json"
    with output_operation(output):
        retain_exact(output / "request.json", body)
        # The original pure preparer binds a pre-existing draft before resuming
        # around the original create-only CLI. Request/output paths stay fixed.
        selection = {"rowIndex": manifest["rowIndex"], "acceptIndex": manifest["acceptIndex"],
                     "intentId": args.intent_id, "url": manifest["seller"], "method": "POST",
                     "bodyFile": str(output / "request.json"), "bodyBytes": len(body),
                     "bodySha256": sha(body), "headers": {"Content-Type": "application/json"},
                     "responseOut": str(output / "metar-result.json")}
        derived = subprocess.run(
            [args.node, "--input-type=module", "-e", PREPARE_REVIEW_JS,
             str(cli.parent / "prepare.mjs"), str(root / "offers.json"),
             json.dumps(selection)], cwd=checkout, check=True, text=True, capture_output=True)
        expected = json.loads(derived.stdout)
        config_bytes = base64.b64decode(expected["dataBase64"], validate=True)
        need(sha(config_bytes) == expected["configSha256"], "Original preparer result changed")
        prior_record = json.loads(record_path.read_bytes()) if record_path.exists() else None
        if prior_record is not None:
            need(prior_record.get("schema") == "commons.agentsmith.native-preparation.v1"
                 and prior_record.get("intentId") == args.intent_id
                 and prior_record.get("sourceDirectory") == str(root)
                 and prior_record.get("captureManifestSha256") == sha((root / "capture.json").read_bytes())
                 and prior_record.get("reviewConfigSha256") == sha(config_bytes),
                 "Reopen the original preparation and its stable intent")
        native_path = output / "native-prepare.json"
        if review_path.exists():
            retain_exact(review_path, config_bytes)
            if native_path.exists():
                native_result = json.loads(native_path.read_bytes())
                need(native_result.get("configPath") == str(review_path)
                     and native_result.get("configSha256") == sha(config_bytes),
                     "Original preparation result differs")
            else:
                # This is the actual original prepareReview result after a
                # completed draft survived interruption before its stdout saved.
                native_result = {"mode": "OFFLINE_CONFIG_REOPENED",
                                 "configPath": str(review_path),
                                 "configSha256": expected["configSha256"],
                                 "intentId": args.intent_id,
                                 "sourceFileSha256": sha((root / "offers.json").read_bytes())}
                retain_exact(native_path, encoded(native_result))
        else:
            need(prior_record is None and not native_path.exists(),
                 "Restore the original reviewed configuration before continuing")
            argv = [args.node, str(cli), "--prepare", "--discovery", str(root / "offers.json"),
                    "--row", str(manifest["rowIndex"]), "--accept", str(manifest["acceptIndex"]),
                    "--intent-id", args.intent_id, "--url", manifest["seller"], "--method", "POST",
                    "--body-file", str(output / "request.json"), "--content-type", "application/json",
                    "--response-out", str(output / "metar-result.json"), "--out", str(review_path)]
            result = subprocess.run(argv, cwd=checkout, check=True, text=True, capture_output=True)
            native_result = json.loads(result.stdout)
            retain_exact(review_path, config_bytes)
            retain_exact(native_path, encoded(native_result))
        reviewed = subprocess.run(
            [args.node, str(cli), "--review", "--config", str(review_path)],
            cwd=checkout, check=True, text=True, capture_output=True)
        review = json.loads(reviewed.stdout)
        review_result = output / "native-review.json"
        if not review_result.exists():
            retain_exact(review_result, encoded(review))
        record = {"schema": "commons.agentsmith.native-preparation.v1",
                  "captureManifestSha256": sha((root / "capture.json").read_bytes()),
                  "checkout": str(checkout), "nativeCliSha256": sha(cli.read_bytes()),
                  "intentId": args.intent_id, "sourceDirectory": str(root),
                  "reviewConfig": str(review_path), "nativeResult": native_result,
                  "reviewConfigSha256": sha(config_bytes)}
        if prior_record is None:
            retain_exact(record_path, encoded(record))
        return {"status": "NATIVE_BUYER_REVIEW_REOPENED" if prior_record else "NATIVE_BUYER_REVIEW_PREPARED",
                "directory": str(output), "config": str(review_path),
                "intentId": args.intent_id, "nativeReview": review}


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    sub = parser.add_subparsers(dest="command", required=True)
    capt = sub.add_parser("capture", help="Retain the actual facilitator and unpaid seller response")
    capt.add_argument("--directory", required=True)
    capt.add_argument("--url", type=https, default=SELLER)
    capt.add_argument("--facilitator", type=https, default=FACILITATOR)
    request = capt.add_mutually_exclusive_group()
    request.add_argument("--body-file")
    request.add_argument("--icao", default="KJFK")
    prep = sub.add_parser("prepare", help="Call the original SF88 prepare and review commands")
    prep.add_argument("--capture", required=True)
    prep.add_argument("--checkout", required=True)
    prep.add_argument("--directory", required=True)
    prep.add_argument("--intent-id", required=True)
    prep.add_argument("--node", default="node")
    rest = sub.add_parser("restore", help="Receive a retained original HTTP bundle offline")
    rest.add_argument("--source", required=True)
    rest.add_argument("--directory", required=True)
    ins = sub.add_parser("inspect", help="Reopen and inspect the same retained source")
    ins.add_argument("--capture", required=True)
    args = parser.parse_args()
    if args.command == "capture":
        result = capture(args)
    elif args.command == "prepare":
        result = prepare(args)
    elif args.command == "restore":
        result = restore(args)
    else:
        root, manifest = read_capture(args.capture)
        result = {"directory": str(root), **manifest}
    print(json.dumps(result, indent=2))


if __name__ == "__main__":
    try:
        main()
    except (OSError, ValueError, subprocess.CalledProcessError) as error:
        if isinstance(error, subprocess.CalledProcessError):
            print(error.stderr.strip(), file=sys.stderr)
        print(json.dumps({"error": type(error).__name__, "message": str(error),
                          "recovery": "Continue from the same retained capture and original intent."}),
              file=sys.stderr)
        raise SystemExit(1)
