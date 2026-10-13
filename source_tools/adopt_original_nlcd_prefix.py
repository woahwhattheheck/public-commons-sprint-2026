"""Continue the original NLCD entity and its retained regional receiving programme."""
from __future__ import annotations
import argparse, base64, hashlib, json, os, runpy, shutil, subprocess, sys
from pathlib import Path, PurePosixPath

SCHEMA = "upstate.original-nlcd-prefix-handoff/v1"
TOTAL = 1457983950
ETAG = '"56e711ce-64fec1a6cfdae"'
URL = "https://www.mrlc.gov/downloads/sciweb1/shared/mrlc/data-bundles/Annual_NLCD_LndCov_2025_CU_C1V2.zip"
ARCHIVE = "Annual_NLCD_LndCov_2025_CU_C1V2.zip"

def file_sha(path):
    h = hashlib.sha256()
    with Path(path).open("rb") as source:
        for block in iter(lambda: source.read(1024 * 1024), b""):
            h.update(block)
    return h.hexdigest()

def prefix_sha(path, length):
    h = hashlib.sha256()
    with Path(path).open("rb") as source:
        remaining = length
        while remaining:
            block = source.read(min(1024 * 1024, remaining))
            if not block:
                raise ValueError("The retained prefix is incomplete.")
            h.update(block)
            remaining -= len(block)
    return h.hexdigest()

def regular(path):
    path = Path(path).absolute()
    for part in (path, *path.parents):
        if part.is_symlink():
            raise ValueError("Use the original regular receiving path: " + str(part))
    if path.exists() and not path.is_file():
        raise ValueError("Expected a regular receiving file: " + str(path))
    return path

def main():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("handoff", type=Path)
    parser.add_argument("--prefix", type=Path, required=True)
    parser.add_argument("--root", type=Path, required=True)
    parser.add_argument("--execute", action="store_true")
    parser.add_argument("--domain-archive", type=Path)
    parser.add_argument("--save-library", action="store_true")
    args = parser.parse_args()
    if args.execute and not args.domain_archive:
        parser.error("--execute requires the original --domain-archive")
    handoff_path = regular(args.handoff)
    prefix = regular(args.prefix)
    body = handoff_path.read_bytes()
    handoff = json.loads(body)
    source = handoff["source"]
    if (handoff.get("schema") != SCHEMA or handoff.get("operation_id") != "UPSTATE-ORIGINAL-SOURCES-DBC61"
            or source.get("url") != URL or source.get("etag") != ETAG
            or source.get("total_bytes") != TOTAL or source.get("archive_name") != ARCHIVE):
        raise ValueError("Select the retained original national entity.")
    root = args.root.absolute()
    regular(root / "adoption.lock")
    root.mkdir(parents=True, exist_ok=True)
    import fcntl
    with (root / "adoption.lock").open("a+b") as locked:
        fcntl.flock(locked.fileno(), fcntl.LOCK_EX | fcntl.LOCK_NB)
        selected = root / "PREFIX_ADOPTION.json"
        receipt = {"schema": SCHEMA, "operation_id": handoff["operation_id"],
                   "handoff_sha256": hashlib.sha256(body).hexdigest(), "source": source}
        receipt_body = (json.dumps(receipt, sort_keys=True, indent=2) + "\n").encode()
        if selected.exists() and selected.read_bytes() != receipt_body:
            raise ValueError("This receiving root already selects a different original handoff.")
        adopted = selected.exists()
        # The original in-place partial grows during capture and is renamed at
        # completion. An adopted operation is verified below against its retained
        # archive/current partial; only first adoption needs the external seed.
        if not adopted and (not prefix.is_file() or prefix.stat().st_size != source["prefix_bytes"]
                            or file_sha(prefix) != source["prefix_sha256"]):
            raise ValueError("The complete retained prefix differs from its handoff.")
        files = {}
        for item in handoff["files"]:
            name = item["path"]
            relative = PurePosixPath(name)
            if relative.is_absolute() or str(relative) != name or ".." in relative.parts or "\\" in name:
                raise ValueError("The handoff contains a nonportable source path.")
            data = base64.b64decode(item["content_base64"], validate=True)
            if name in files or len(data) != item["bytes"] or hashlib.sha256(data).hexdigest() != item["sha256"]:
                raise ValueError("The retained handoff source differs: " + name)
            files[name] = data
        program_name = "receive-nlcd-national.py"
        if hashlib.sha256(files[program_name]).hexdigest() != "d207e7fa9a06fcbb9500eb105f053eaf562cea0424d3a6f1ff1151a2939a40ca":
            raise ValueError("Use the complete original receiving programme.")
        program = regular(root / program_name)
        if program.exists() and program.read_bytes() != files[program_name]:
            raise ValueError("A different original receiver occupies this path.")
        program.write_bytes(files[program_name])
        native = runpy.run_path(str(program), run_name="upstate_original_receiver")
        retain = native["retain"]
        # Later original recovery receipts stay with an already-adopted operation.
        mutable = {"inputs/" + ARCHIVE + ".capture.json", "inputs/" + ARCHIVE + ".range-recovery/state.json"}
        for name, data in files.items():
            target = regular(root / name)
            if adopted and name in mutable:
                if not target.is_file():
                    raise ValueError("The original adopted recovery state is missing: " + name)
            elif target.exists() and target.read_bytes() != data:
                raise ValueError("Preserve the existing receiving postimage: " + name)
        packet_path = root / "upstate-nlcd-operation.json"
        for name, data in files.items():
            if not (adopted and name in mutable):
                retain(root / name, data)
        packet, packet_bytes = native["load_packet"](packet_path)
        native["install_sources"](packet, root)
        retain(root / "operation-source.json", packet_bytes)
        archive = regular(root / "inputs" / ARCHIVE)
        partial = regular(archive.with_name(archive.name + ".partial"))
        if adopted:
            target = archive if archive.exists() else partial
            if (not target.is_file() or target.stat().st_size < source["prefix_bytes"]
                    or prefix_sha(target, source["prefix_bytes"]) != source["prefix_sha256"]):
                raise ValueError("The adopted operation no longer has its original prefix.")
        elif archive.exists():
            raise ValueError("An existing complete archive occupies this unadopted receiving root.")
        elif partial.exists():
            if partial.stat().st_size != source["prefix_bytes"] or file_sha(partial) != source["prefix_sha256"]:
                raise ValueError("A different prefix occupies this unadopted receiving root.")
        else:
            pending = regular(partial.with_name(partial.name + ".adopting"))
            received = pending.stat().st_size if pending.exists() else 0
            if received > source["prefix_bytes"]:
                raise ValueError("The interrupted receiving copy exceeds its selected source.")
            if received and prefix_sha(pending, received) != prefix_sha(prefix, received):
                raise ValueError("The interrupted receiving copy differs from its original source.")
            available = shutil.disk_usage(root).free
            if available < source["prefix_bytes"] - received + 64 * 1024 * 1024:
                raise OSError("Provide capacity for the remaining original prefix copy.")
            partial.parent.mkdir(parents=True, exist_ok=True)
            with prefix.open("rb") as src, pending.open("r+b" if pending.exists() else "xb") as out:
                src.seek(received)
                out.seek(received)
                shutil.copyfileobj(src, out, 1024 * 1024)
                out.flush()
                os.fsync(out.fileno())
            if pending.stat().st_size != source["prefix_bytes"] or file_sha(pending) != source["prefix_sha256"]:
                raise ValueError("The received prefix copy differs.")
            os.link(pending, partial)
            pending.unlink()
            native["sync_dir"](partial.parent)
        retain(selected, receipt_body)
        print(json.dumps({"stage": "ORIGINAL_PREFIX_ADOPTED", "root": str(root),
                          "prefix_bytes": source["prefix_bytes"], "prefix_sha256": source["prefix_sha256"],
                          "host": os.uname().nodename, "python": sys.executable}), flush=True)
    if args.execute:
        domain = regular(args.domain_archive)
        if domain.stat().st_size != 8800689 or file_sha(domain) != "1fc35e5d0986e42d93922527d46e38bc5132653db75863934349dbbfaa352c04":
            raise ValueError("Select the authenticated original 217-feature domain ZIP.")
        # These are the unchanged original capture continuation and native receiving programme.
        subprocess.run([sys.executable, "-B", str(root / "continue_original_capture.py"),
                        "--root", str(root)], check=True)
        command = [sys.executable, "-B", str(program), str(packet_path), str(root),
                   "--domain-archive", str(domain), "--archive", str(archive),
                   "--capture", str(archive.with_name(archive.name + ".capture.json")),
                   "--capture-directory", str(root / "capture"),
                   "--prepared-directory", str(root / "prepared"),
                   "--work-directory", str(root / "native-member-records")]
        if args.save_library:
            command.append("--save-library")
        subprocess.run(command, check=True)

if __name__ == "__main__":
    main()
