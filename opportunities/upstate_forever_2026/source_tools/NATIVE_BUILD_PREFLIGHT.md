# Original native build readiness

Run this additive read-only helper with the owning host's actual interpreter before acquiring missing build dependencies. It installs nothing, uses no network, starts no model, and leaves the original capsule, operator, queue, Workspace and case driver in place.

```sh
ACTUAL_PYTHON -B source_tools/native_build_preflight.py --output /owned/native-build-preflight.json
```

Alternatively, launch from another Python and select `--python /actual/prefix/bin/python`. Keep the interpreter's original venv path. Only `--output` writes a report; prerequisite checks inspect installed distributions and run isolated import/compiler subprocesses. No environment values or credentials are reported. A missing prerequisite is a successful diagnostic operation: inspect `build_ready`, `runtime_ready` and each actionable `omissions` item rather than treating process exit 0 as readiness.

`build_ready.pygeoprocessing_build` and `build_ready.invest_build` are separate. Build PyGeoProcessing first: InVEST's setup imports it and uses its installed extension headers. On Python3.13 the official builds require NumPy>=2 and Cython>=3. InVEST also requires setuptools>=64, setuptools_scm>=8, Babel and the `pybabel` console script. Runtime dependencies and build dependencies are distinct.

Both original Linux setup scripts invoke `gdal-config --cflags/--libs`, compile C++20 and link GDAL. Installed `osgeo` bindings alone do not establish build readiness. The helper records those actual commands and checks C++20/GDAL headers with a stdin `-fsyntax-only` compiler invocation. It produces no compiled output and does not prove link-library or extension ABI compatibility.

The official InVEST dependency file specifies unbounded `pydantic`, but its original `spec.py` imports Pydantic2 APIs (`AfterValidator`, `ConfigDict`, `field_validator`, `model_serializer`, `model_validator`). Pydantic1 can satisfy distribution metadata and still fail this original import. This helper checks the names directly. NDR imports SDR, which imports Urban Nature Access; keep that complete original import closure. Both model imports verify the maintained original 3.20 source blobs and do not call validate or execute.

After resolving only the reported actual omissions, use the existing capsule's `probe` command and the unchanged `model.native.runtime` boundary. The preflight's runtime readiness is limited to imports and model source pins; the maintained capsule adds actual GIS round trips and application loading. A full wheel build, received-environment probe and original retained model operation remain their current owners' work.

## Exact original sources

Verified publisher tag source, not reconstructed requirements:

| Source | Git blob |
| --- | --- |
| [InVEST3.20 pyproject.toml](https://github.com/natcap/invest/blob/3.20.0/pyproject.toml) | `1c43b8ba5cda2709627db35c6ecadb9f74c2ad1f` |
| [InVEST3.20 setup.py](https://github.com/natcap/invest/blob/3.20.0/setup.py) | `37537d87bed939a99bcaf0e9811e96b28bd6eb0b` |
| [InVEST3.20 requirements.txt](https://github.com/natcap/invest/blob/3.20.0/requirements.txt) | `f9ce4edbb33267c3b6ccecea734cc17de4f15dee` |
| [InVEST3.20 spec.py](https://github.com/natcap/invest/blob/3.20.0/src/natcap/invest/spec.py) | `4bd69cc024a671e6b8701b2ddc1aba829c08a9cc` |
| [PyGeoProcessing2.4.11 pyproject.toml](https://github.com/natcap/pygeoprocessing/blob/2.4.11/pyproject.toml) | `15ccb6795fa906625c2ee85ef0480b3f64b0838d` |
| [PyGeoProcessing2.4.11 setup.py](https://github.com/natcap/pygeoprocessing/blob/2.4.11/setup.py) | `56374637ee4d93a1e400adafa926270d5d7ee96b` |
| [Original NDR](https://github.com/natcap/invest/blob/3.20.0/src/natcap/invest/ndr/ndr.py) | `f518b2867d4a327675fcb1c9b4ba56f29b12188d` |
| [Original SDR](https://github.com/natcap/invest/blob/3.20.0/src/natcap/invest/sdr/sdr.py) | `0cac27add172011df367ff8026427dbbdbcda5b2` |
