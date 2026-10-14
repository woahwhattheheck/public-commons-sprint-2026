# Packing after a cloud-to-cloud package-cache transfer

Keep the already-selected extracted package cache with the original prefix and
pass it explicitly to the same packing command. Repeat `--package-cache` for
additional cache roots. Each argument can be a cache directory containing
extracted packages or one extracted package with `info/index.json`. Original
compressed `.conda` or `.tar.bz2` files can remain beside those directories.

```sh
python source_tools/native_runtime/prefix_pack.py \
  /work/original /work/completed /work/release/Runtime.tar.gz \
  --target windows-x86_64 --package-cache /work/received-pkgs \
  --archive-root runtime --json /work/release/runtime-descriptor.json
```

A moved prefix can still name the previous machine in `conda-meta` `link.source`.
The cache join matches the original package name/version/build, native subdir
and available archive hashes, then passes a private copy of that record to the
selected conda-pack writer's own package loader. This preserves raw binary/text
placeholders, noarch Python layout, and generated entry points. The original
metadata and cache files are not rewritten. When present, `info/paths.json`
member sizes and hashes are checked against the raw bytes used for packing.
Windows and Mac member lookup preserves the physical filename while matching
case/Unicode-normalized metadata. The Windows target remains the same isolated
writer described in `WINDOWS_CLOUD_PACKING.md`.

Selected cache directories join the existing transaction's source snapshot.
The original prefix, completed staging tree, donors, selected caches and output
path must remain the same for `--resume`; a changed source belongs to a new
output. Existing calls without `--package-cache` keep their original request
shape and ordinary cached/retained-prefix behavior. This option consumes an
already-selected environment; it does not solve dependencies or download
packages. A cache with a conflicting build/target/archive identity must be
replaced with the original selected package, rather than changing the solve.
