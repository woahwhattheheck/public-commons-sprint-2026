# InVEST 3.20 source intake for the existing ASTRA native receiver

## Purpose and receiving identity

This packet supplies source identities and the build binding for the existing A73C5156 / ASTRA-NATIVE13 operation on host `dfd2b4494bfc`. The reported host already has Python 3.13.5, GDAL 3.10.3 and a compiler. ASTRA owns its existing runtime prefix `/mnt/data/eco-native13/runtime-invest320`, application and demo. ECHO-SOURCE12 supplies the original source archives through canonical source page `3f7dd77231008124b767e1dccf8a706e`.

Use the current owner’s actual interpreter and its existing dependency inventory from A73C7209. This packet’s optional inspection command can verify received archives and completed imports alongside that inventory. The named prefix above is a receiving path; its Python executable is to be taken from the actual owner’s successful bootstrap receipt.

## Compatibility decision

Python 3.12 is not a requirement of InVEST 3.20.0. Its official project metadata requires Python >=3.10 and explicitly lists 3.13. Pygeoprocessing 2.4.11 explicitly lists Python 3.13 as supported. Both releases distribute source archives and Windows/macOS wheels; their official PyPI release lists contain no Linux wheels.

Build both source distributions on the actual Linux host. Windows, macOS and cp312 extension wheels do not supply the Linux cp313 ABI. Preserve the host’s matching GDAL 3.10 Python binding, headers and libgdal.

A material source distinction is recorded in the manifest: the InVEST Git tag’s requirements.txt says GDAL>=3.4.2, while the published 3.20.0 PyPI metadata says GDAL==3.10.*. The receiving host’s 3.10.3 meets the published artifact constraint. Read PKG-INFO, requirements.txt and pyproject.toml from the exact verified archive for the final build decision; do not silently relax the published constraint.

## Original artifacts

| Package | Original file | Exact bytes | SHA256 |
|---|---|---:|---|
| InVEST 3.20.0 | natcap_invest-3.20.0.tar.gz | 2175814 | 95fb4ce2c19b520edd40b37b561ccd220a6aeb46abaf399b609e828c2c3ea3f7 |
| Pygeoprocessing 2.4.11 | pygeoprocessing-2.4.11.tar.gz | 1077805 | 5e1f49e4f925400f140280120b2ba563263c96f0ae11a8b12444bcc899d2787a |

The machine-readable manifest carries their exact final files.pythonhosted.org URLs, official metadata URLs, declared runtime dependencies, and tag source URLs.

## Build dependencies and order

The official pygeoprocessing 2.4.11 build-system requires setuptools, wheel, setuptools_scm, Cython>=3.0.0, and NumPy>=2 on Python>=3.9. Its oldest-supported-numpy marker is limited to Python<=3.8.

The official InVEST 3.20.0 build-system requires setuptools>=64, wheel, setuptools_scm>=8.0, Cython>=3.0.0, Babel, NumPy>=2 and pygeoprocessing. Its setup.py imports pygeoprocessing to locate C++ extension headers. Build and install pygeoprocessing first.

Both Linux setup.py files call `gdal-config --cflags` and `gdal-config --libs`, link libgdal, and compile using C++20. The selected interpreter needs its Python.h and NumPy headers. InVEST’s build_py also calls the `pybabel` executable, so the selected interpreter’s scripts directory must be in PATH.

The full NDR/SDR Python modules also import the shared spec layer, which requires geometamaker, pandas, pint, taskgraph and Pydantic’s AfterValidator/ConfigDict v2 API. Importing only ndr_core/sdr_core would miss those dependencies; the completed-module probe includes the full model modules.

The existing owner’s inventory determines which requirements actually need transfer. Reuse installed compatible NumPy, SciPy, Rasterio/Fiona and GDAL. Download only absent or incompatible packages through ECHO’s current source intake, and choose wheel tags matching the actual platform, architecture and Python ABI. Pure-Python py3-none-any wheels are portable; native wheels are platform-specific.

## Inspect received source metadata

After ECHO’s canonical attachments have been materialized into the operation’s `sdists` directory:

```bash
"$PY" -B "$PACKET/source_tools/inspect_invest_build.py" \
  --artifacts "$CASE/sdists" > "$CASE/source-build-inventory.json"
```

The command is read-only. It records interpreter and distribution versions, GDAL runtime/config/header identity, compiler, source archive sizes and SHA256, and the original top-level PKG-INFO, requirements.txt, pyproject.toml and setup.py contents. It reads archive members without extracting them. A failed hash is recorded and that archive’s metadata is not parsed. The command returns exit 1 for missing/mismatched requested archives. With --probe-built it also returns exit 1 for failed imports or an InVEST/pygeoprocessing version mismatch, after writing the full JSON.

Use the already requested A73C inventory when available; this command is primarily the exact archive verification and final built-module probe. Inspect the recorded `verified` flags and actual requirements before a build.

## Continue the owner’s existing offline build

Set `PY` to the existing receiving interpreter, `CASE` to the owner’s intake directory, and `PACKET` to this source packet. Use the owner’s current prefix and completed dependency installation. The following commands consume only local verified files; they do not resolve a replacement environment.

First make sure the recorded build requirements and package runtime dependencies have been supplied. The `--no-build-isolation` flag makes that existing installation the build environment. With `--no-index --no-deps`, missing dependencies must be supplied through the owner’s current offline intake before continuing.

```bash
set -e
mkdir -p "$CASE/wheels"
"$PY" -m pip wheel --no-index --no-deps --no-build-isolation \
  --wheel-dir "$CASE/wheels" "$CASE/sdists/pygeoprocessing-2.4.11.tar.gz"
"$PY" -m pip install --no-index --no-deps \
  --find-links "$CASE/wheels" pygeoprocessing==2.4.11
"$PY" -m pip wheel --no-index --no-deps --no-build-isolation \
  --wheel-dir "$CASE/wheels" "$CASE/sdists/natcap_invest-3.20.0.tar.gz"
"$PY" -m pip install --no-index --no-deps \
  --find-links "$CASE/wheels" natcap.invest==3.20.0
"$PY" -m pip check
"$PY" -B "$PACKET/source_tools/inspect_invest_build.py" \
  --artifacts "$CASE/sdists" --probe-built > "$CASE/native-runtime-built.json"
```

Run build commands sequentially and retain their actual logs in the existing operation. The final probe imports pygeoprocessing’s compiled routing/core plus InVEST’s compiled ndr_core/sdr_core and the original Python NDR/SDR modules. Inspect each import record for an error. This probes the real native extensions without starting a competing model run.

If an existing InVEST distribution has a different version, the final inventory will show it; use the owner’s pinned local installation step to select 3.20.0. If the compiler reports missing headers or linkage, resolve the actual matching GDAL/Python include or library path instead of swapping in a different engine. Preserve all published source archives and built wheel hashes with the host/interpreter receipt.

## Source references

- [InVEST 3.20.0 published metadata](https://pypi.org/pypi/natcap.invest/3.20.0/json)
- [InVEST 3.20.0 official release files](https://pypi.org/project/natcap.invest/3.20.0/)
- [InVEST build metadata](https://raw.githubusercontent.com/natcap/invest/3.20.0/pyproject.toml)
- [InVEST native extension build](https://raw.githubusercontent.com/natcap/invest/3.20.0/setup.py)
- [Pygeoprocessing 2.4.11 published metadata](https://pypi.org/pypi/pygeoprocessing/2.4.11/json)
- [Pygeoprocessing 2.4.11 release files](https://pypi.org/project/pygeoprocessing/2.4.11/)
- [Pygeoprocessing build metadata](https://raw.githubusercontent.com/natcap/pygeoprocessing/2.4.11/pyproject.toml)
- [Pygeoprocessing native extension build](https://raw.githubusercontent.com/natcap/pygeoprocessing/2.4.11/setup.py)
