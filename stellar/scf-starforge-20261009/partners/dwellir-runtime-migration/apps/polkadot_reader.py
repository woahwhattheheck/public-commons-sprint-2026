#!/usr/bin/env python3
"""Read the selected Polkadot application endpoint using Python's native HTTPS client."""
import argparse, hashlib, json, os, re, shlex, urllib.parse, urllib.request
from pathlib import Path

class NoRedirect(urllib.request.HTTPRedirectHandler):
    def redirect_request(self, req, fp, code, msg, headers, newurl):
        return None

def main():
    parser = argparse.ArgumentParser(description=__doc__, allow_abbrev=False)
    parser.add_argument("--env-file", required=True)
    parser.add_argument("--env-name", default="APP_RPC_URL")
    parser.add_argument("--output", required=True)
    args = parser.parse_args()
    matches = []
    for line in Path(args.env_file).read_text().splitlines():
        match = re.match(r"^\s*(?:export\s+)?([A-Za-z_][A-Za-z0-9_]*)\s*=(.*)$", line)
        if match and match[1] == args.env_name:
            parts = shlex.split(match[2], comments=True)
            if len(parts) != 1:
                raise ValueError("Select one literal endpoint assignment")
            matches.append(parts[0])
    if len(matches) != 1:
        raise ValueError("Select one existing endpoint binding")
    url = matches[0]
    parsed = urllib.parse.urlsplit(url)
    if parsed.scheme != "https" or parsed.username or parsed.password or parsed.fragment:
        raise ValueError("Use the selected HTTPS endpoint")
    responses = []
    def rpc(method, params):
        request = {"jsonrpc": "2.0", "id": "application-" + str(len(responses) + 1),
                   "method": method, "params": params}
        data = json.dumps(request).encode()
        req = urllib.request.Request(url, data=data, headers={"Content-Type": "application/json"})
        with urllib.request.build_opener(NoRedirect()).open(req, timeout=15) as response:
            raw = response.read(1048577)
            if response.status != 200 or len(raw) > 1048576:
                raise ValueError("Application response exceeded the selected HTTP contract")
        envelope = json.loads(raw)
        if envelope.get("jsonrpc") != "2.0" or envelope.get("id") != request["id"] or "error" in envelope:
            raise ValueError("Application RPC did not return its matching result")
        responses.append({"request": request, "responseUtf8": raw.decode(),
                          "responseSha256": hashlib.sha256(raw).hexdigest()})
        return envelope["result"]
    genesis = rpc("chain_getBlockHash", [0])
    head = rpc("chain_getFinalizedHead", [])
    header = rpc("chain_getHeader", [head])
    runtime = rpc("state_getRuntimeVersion", [head])
    result = {"client": "python", "endpointHost": parsed.hostname, "genesis": genesis,
              "finalizedHash": head, "header": header, "runtimeVersion": runtime, "responses": responses}
    output = Path(args.output)
    output.parent.mkdir(parents=True, exist_ok=True, mode=0o700)
    with os.fdopen(os.open(output, os.O_WRONLY | os.O_CREAT | os.O_EXCL, 0o600), "w") as stream:
        json.dump(result, stream, indent=2)
        stream.write("\n")
    print(json.dumps({"client": "python", "endpointHost": parsed.hostname,
                      "genesis": genesis, "finalizedHash": head, "height": int(header["number"], 16)}))

if __name__ == "__main__":
    main()
