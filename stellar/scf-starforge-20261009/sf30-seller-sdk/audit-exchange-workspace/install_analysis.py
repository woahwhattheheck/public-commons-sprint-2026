#!/usr/bin/env python3
"""Install and retain the exact original nmecr package in an owned R library."""
from __future__ import annotations
import argparse
import hashlib
import json
import os
from pathlib import Path, PurePosixPath
import subprocess
import tarfile
import urllib.request

COMMIT = "343146d7a1e20d027e6ca48bd7ca2b38c646592a"
URL = "https://codeload.github.com/kW-Labs/nmecr/tar.gz/" + COMMIT
REQUIRED = ("dplyr", "lubridate", "segmented", "magrittr", "xts", "zoo", "purrr", "jsonlite")


def digest(body):
    return hashlib.sha256(body).hexdigest()


def save(path, body):
    path = Path(path)
    if path.exists():
        if path.is_symlink() or path.read_bytes() != body:
            raise ValueError("The retained original differs: " + str(path))
        return
    path.parent.mkdir(mode=0o700, parents=True, exist_ok=True)
    if path.parent.resolve() != path.parent.absolute():
        raise ValueError("Choose an ordinary owned source directory")
    candidate = path.with_suffix(path.suffix + ".pending")
    if candidate.exists():
        if candidate.read_bytes() != body:
            candidate.unlink()
    with candidate.open("wb") as output:
        output.write(body)
        output.flush()
        os.fsync(output.fileno())
    candidate.chmod(0o600)
    os.replace(candidate, path)


def install(root, library, rscript, archive=None, install_dependencies=False, *, lease_fd=None):
    root, library = Path(root).absolute(), Path(library).absolute()
    if root.resolve() != root or library.resolve() != library:
        raise ValueError("Keep the runtime in ordinary owned directories")
    root.mkdir(mode=0o700, parents=True, exist_ok=True)
    library.mkdir(mode=0o700, parents=True, exist_ok=True)
    index_bytes = Path(__file__).with_name("nmecr-source-index.json").read_bytes()
    index = json.loads(index_bytes)
    if index["commit"] != COMMIT or index["repository"] != "kW-Labs/nmecr":
        raise ValueError("Use the reviewed original source index")
    save(root / "nmecr-source-index.json", index_bytes)
    source_archive = root / ("nmecr-" + COMMIT + ".tar.gz")
    if archive:
        save(source_archive, Path(archive).read_bytes())
    elif not source_archive.exists():
        with urllib.request.urlopen(urllib.request.Request(URL, headers={
                "User-Agent": "Commons Audit Exchange original source installer/1.0"}), timeout=180) as response:
            save(source_archive, response.read())
    original = source_archive.read_bytes()
    expected = {entry["path"]: entry for entry in index["files"]}
    bodies = {}
    with tarfile.open(source_archive, "r:gz") as bundle:
        for member in bundle:
            if member.isdir():
                continue
            if not member.isfile():
                raise ValueError("The original archive contains a non-regular source entry")
            parts = PurePosixPath(member.name).parts
            if len(parts) < 2 or any(part in (".", "..") for part in parts) or member.name.startswith("/"):
                raise ValueError("The original source archive has an escaping path")
            name = "/".join(parts[1:])
            if name in bodies or name not in expected:
                raise ValueError("Unexpected or duplicate original source: " + name)
            body = bundle.extractfile(member).read()
            entry = expected[name]
            git = hashlib.sha1(b"blob " + str(len(body)).encode() + b"\0" + body).hexdigest()
            if len(body) != entry["bytes"] or git != entry["gitBlob"]:
                raise ValueError("Original Git source identity differs: " + name)
            bodies[name] = body
    if set(bodies) != set(expected):
        raise ValueError("The original source archive is incomplete")
    source = root / "source"
    source.mkdir(mode=0o700, exist_ok=True)
    for name, body in bodies.items():
        save(source / name, body)
    source_record = {"schema": "commons.nmecr.original-source.v1", "repository": index["repository"],
                     "commit": COMMIT, "url": URL, "archiveBytes": len(original),
                     "archiveSha256": digest(original), "files": index["files"]}
    save(root / "source-received.json", json.dumps(source_record, sort_keys=True, indent=2).encode() + b"\n")
    environment = dict(os.environ, R_LIBS_USER=str(library))
    pass_fds = () if lease_fd is None else (lease_fd,)
    commands = []
    def run(argv, name):
        commands.append(argv)
        with (root / name).open("ab", buffering=0) as output:
            completed = subprocess.run(argv, stdout=output, stderr=subprocess.STDOUT,
                                       env=environment, pass_fds=pass_fds)
        if completed.returncode:
            raise RuntimeError("Native runtime step failed; complete original log: " + str(root / name))
    packages = "c(" + ",".join(json.dumps(name) for name in REQUIRED) + ")"
    if install_dependencies:
        run([rscript, "--vanilla", "-e",
             "wanted<-" + packages + "; missing<-wanted[!vapply(wanted,requireNamespace,logical(1),quietly=TRUE)];"
             "if(requireNamespace('dplyr',quietly=TRUE)&&packageVersion('dplyr')<'1.1.0') missing<-union(missing,'dplyr');"
             "if(length(missing))install.packages(missing,lib=Sys.getenv('R_LIBS_USER'),repos='https://cloud.r-project.org');"],
            "dependency-install.log")
    run([rscript, "--vanilla", "-e",
         "wanted<-" + packages + "; missing<-wanted[!vapply(wanted,requireNamespace,logical(1),quietly=TRUE)];"
         "if(length(missing))stop(paste('Missing native packages:',paste(missing,collapse=', ')));"
         "if(packageVersion('dplyr')<'1.1.0')stop('dplyr >=1.1.0 is required');"
         "cat(R.version.string,'\\n');for(p in wanted)cat(p,as.character(packageVersion(p)),'\\n')"],
        "dependencies.log")
    installed = library / "nmecr"
    origin_path = installed / "commons-source-origin.json"
    if not origin_path.exists():
        # R's source-package installer is invoked as an original R operation,
        # retaining its complete transcript and avoiding shell interpolation.
        run([rscript, "--vanilla", "-e",
             "utils::install.packages(" + json.dumps(str(source)) +
             ",repos=NULL,type='source',lib=Sys.getenv('R_LIBS_USER'),INSTALL_opts=c('--no-docs','--no-multiarch'))"],
            "nmecr-install.log")
    if not installed.is_dir():
        raise RuntimeError("The native installer did not create the original nmecr package")
    files = []
    for path in sorted(installed.rglob("*")):
        if path.is_symlink():
            raise ValueError("The installed original package contains a symlink")
        if not path.is_file() or path.name == "commons-source-origin.json":
            continue
        body = path.read_bytes()
        files.append({"name": path.relative_to(installed).as_posix(), "bytes": len(body),
                      "sha256": digest(body), "md5": hashlib.md5(body).hexdigest()})
    provenance = {"schema": "commons.nmecr.installed-source.v1", "repository": index["repository"],
                  "commit": COMMIT, "version": index["version"],
                  "originalArchiveSha256": digest(original), "originalFiles": index["files"],
                  "installedFiles": files}
    save(origin_path, json.dumps(provenance, sort_keys=True, indent=2).encode() + b"\n")
    run([rscript, "--vanilla", "-e",
         "library(nmecr);stopifnot(as.character(packageVersion('nmecr'))=='1.0.18');"
         "cat('Original native nmecr ',as.character(packageVersion('nmecr')),' loaded\\n',sep='');"
         "print(sessionInfo());"],
        "installed-runtime.log")
    record = {"schema": "commons.audit.analysis-runtime.v1", "commit": COMMIT,
              "source": str(source), "library": str(library), "rscript": rscript,
              "environment": {"R_LIBS_USER": str(library)}, "commands": commands,
              "originalArchiveSha256": digest(original), "installedFiles": files,
              "status": "installed"}
    if (root / "installed.json").exists():
        return json.loads((root / "installed.json").read_bytes())
    save(root / "installed.json", json.dumps(record, sort_keys=True, indent=2).encode() + b"\n")
    return record


def main():
    parser = argparse.ArgumentParser()
    parser.add_argument("--directory", required=True)
    parser.add_argument("--library", required=True)
    parser.add_argument("--rscript", default=os.environ.get("AUDIT_RSCRIPT", "Rscript"))
    parser.add_argument("--archive")
    parser.add_argument("--install-dependencies", action="store_true")
    args = parser.parse_args()
    print(json.dumps(install(args.directory, args.library, args.rscript, args.archive,
                             args.install_dependencies), sort_keys=True))


if __name__ == "__main__":
    main()
