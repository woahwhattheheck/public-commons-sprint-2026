# Datasette upload: complete native receiving

The retained operation completed on 2026-10-12 at 16:33:37 UTC. Node 24.19.0 returned exit 0 after all 19 executable source syntax checks and 24 operation checks passed. The complete result is in [upload-operation.json](./upload-operation.json).

The run used the original retained file authority, native Datasette client, authenticated Merchant HTTP handler, Datasette MCP provider, full-file SDK and actual command-line client. It exercised an interrupted prefix, a completed file whose final receipt was interrupted, cold file-authority reopen, a deliberately lost HTTP response, explicit same-UUID continuation, a completed zero-byte replay and complete original file reads. The exact original WRI archive was 59,792 bytes, SHA256 53f2486406d61f18c9e1c9ceaac659c265bbad7afe2fe54b1a17f43307cb0ca0.

This is the completed upload integration. The native source workspace, provider acquisition and publisher lifecycle remain in the original DSCEB3 programme. This receiving opens a local route fixture over the original file authority; its result labels that boundary explicitly. All file authorities and loopback listeners closed.

## Exact source and input

[upload-native-input.json](./upload-native-input.json) retains every complete body used by the run: 24 original source files, the complete executable programme and the original archive in base64. [upload-source-manifest.json](./upload-source-manifest.json) records every source member, the programme and result identities. The native upload/client source is b61d0fe4b15fee6497c288b662c9215151d991b3; the shared HTTP/client dependency is merged 83a6915e33a0043a6559d958c842a2e1100866a1.

The programme imports exactly those retained bodies. It advertises the 17 Merchant tools and checks the original 31-operation native catalog used by this upload run. The later request-history join adds two native operations in the original DSCEB3 workspace; the full customer callback separately accepts the exact original 31 or joined 33 names.

To reproduce this particular completed integration, use a new private directory and the exact retained source capsule. The following materialization only creates files below the new directory. Keep the final operation result before retiring that directory.

```sh
python3 - ./upload-native-input.json /absolute/private/datasette-upload-receiving <<'PY'
import base64, hashlib, json, pathlib, sys
packet = json.loads(pathlib.Path(sys.argv[1]).read_text())
root = pathlib.Path(sys.argv[2])
if not root.is_absolute():
    raise ValueError("Use an absolute receiving directory")
root.mkdir(mode=0o700)
for item in packet["files"]:
    body = item["content"].encode("utf-8")
    if len(body) != item["bytes"] or hashlib.sha256(body).hexdigest() != item["sha256"]:
        raise ValueError("Source identity mismatch: " + item["path"])
    target = root / "source" / item["path"]
    target.parent.mkdir(mode=0o700, parents=True, exist_ok=True)
    target.write_bytes(body)
    target.chmod(0o600)
archive = packet["archive"]
body = base64.b64decode(archive["content"])
if len(body) != archive["bytes"] or hashlib.sha256(body).hexdigest() != archive["sha256"]:
    raise ValueError("Original archive identity mismatch")
target = root / "wri-geothermal.sfds.gz"
target.write_bytes(body)
target.chmod(0o600)
programme = root / "verify.mjs"
programme.write_text(packet["program"], encoding="utf-8")
programme.chmod(0o600)
PY
node --max-old-space-size=128 /absolute/private/datasette-upload-receiving/verify.mjs /absolute/private/datasette-upload-receiving
```

The programme writes the full result to `operation.json` and stdout. Completion requires `passed: true`, every declared check passed, `fileAuthorityClosed: true` and `merchantUpload.closed: true`. These fixtures use their own file-authority identifiers. They are not the identifiers of the original customer source workspace.

## Continue the original customer workflow

Use [README.md](./README.md) and the full [run-receiving.mjs](./run-receiving.mjs) callback for the existing DSCEB3 owner. Pass its actual completed `originalUpload` declaration and private original connection descriptor. The callback reads that completed upload, uses only its zero-byte completion replay, receives every declared original file and reopens its own Merchant borrower. The source owner and publisher retain their original lease, action, review and customer identities.
