#!/usr/bin/env python3
"""Materialize the complete three-study delivery from its original Canvas parts."""
import argparse, base64, gzip, hashlib, json, pathlib, re
IDENTITY = {"schema":"upstate.complete-flow-study-delivery-transport/v1","encoding":"base64+gzip","bytes":23987772,"sha256":"af0cb39b97b29b1395b8e72a86e8de9f8d081b84bba7c791c7f1b4ec8ef4816d","gzip_bytes":788897,"gzip_sha256":"652344991b41d86ef0f2697ceb17ea6435632e32879a91b66fda2eb3c9df4826"}
def read_part(path):
    text = pathlib.Path(path).read_text(encoding="utf-8")
    if text.lstrip().startswith("{"):
        value = json.loads(text)
        if "markdown_content" not in value:
            return value
        text = value["markdown_content"]
    match = re.search(r"```json\s*\n([\s\S]*?)\n```", text)
    if not match:
        raise ValueError("Expected the original JSON frame or full Canvas markdown")
    return json.loads(re.sub(r"^[ \t\u00a0]+", lambda m: m[0].replace("\u00a0", " "), match[1], flags=re.M))
def main():
    p = argparse.ArgumentParser(description=__doc__)
    p.add_argument("--parts", nargs="+", required=True)
    p.add_argument("--output", required=True)
    a = p.parse_args()
    parts = sorted((read_part(x) for x in a.parts), key=lambda x: x["part"])
    if [x["part"] for x in parts] != [1, 2] or any(x["parts"] != 2 for x in parts):
        raise ValueError("Provide both original parts once")
    for part in parts:
        if any(part.get(k) != v for k, v in IDENTITY.items()):
            raise ValueError("Original delivery identity differs")
    packed = base64.b64decode("".join(x["content"] for x in parts), validate=True)
    if len(packed) != IDENTITY["gzip_bytes"] or hashlib.sha256(packed).hexdigest() != IDENTITY["gzip_sha256"]:
        raise ValueError("Complete compressed body differs")
    raw = gzip.decompress(packed)
    if len(raw) != IDENTITY["bytes"] or hashlib.sha256(raw).hexdigest() != IDENTITY["sha256"]:
        raise ValueError("Complete source/calculation body differs")
    value = json.loads(raw)
    if value["schema"] != "upstate.complete-flow-study-delivery/v1" or len(value["studies"]) != 3:
        raise ValueError("Unexpected original delivery")
    root = pathlib.Path(a.output)
    root.mkdir(parents=True, exist_ok=True)
    def write(name, body):
        destination = root / name
        if destination.exists():
            if destination.read_bytes() != body:
                raise ValueError("Output differs: " + str(destination))
            return
        with destination.open("xb") as f:
            f.write(body)
    write("complete-flow-delivery.json", raw)
    for label, study in zip(("historical", "2026", "extended"), value["studies"]):
        write(label + "-flow-study.json", (json.dumps(study, ensure_ascii=False, indent=2) + "\n").encode())
    print(json.dumps({"output": str(root.resolve()), "studies": [x["id"] for x in value["studies"]]}, indent=2))
if __name__ == "__main__":
    main()
