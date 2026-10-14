r"""Open, render, save and reopen a complete package using the installed QGIS.

Windows (PowerShell):
  python tools/model/gis_project_native.py "Original GIS" "Received GIS" --qgis-python "C:\Program Files\QGIS\bin\python-qgis.bat"
macOS: use the QGIS application's Python, or let this helper find QGIS*.app.
Linux: use QGIS-enabled Python, or let this helper try system Python.
  python3 tools/model/gis_project_native.py "Original GIS" "Received GIS"

Use --runtime to inspect the selected executable/version. ECO_QGIS_PYTHON is
an optional single-executable override. --qgis-prefix supplies a nonstandard
resource prefix. Existing Qt configuration is preserved; offscreen is the
headless default, set only in the receiving child. --open ORIGINAL_DIRECTORY
opens project.qgz in QGIS Desktop via the normal file association instead.

Keep the entire extracted folder together when moving, editing or sharing it.
The sender stays unchanged. Native saves retain relative project paths, original
layer identities, CRS, units, styles and the complete accompanying datasets.
"""
from __future__ import annotations
import argparse
import contextlib
import json
import os
from pathlib import Path
import shutil
import subprocess
import sys
import tempfile
import time
import zipfile

# The shipped tools are themselves inventoried source members. Merely importing
# them must not add untracked bytecode to the original sender or receiving copy.
sys.dont_write_bytecode = True


def inspect_atlas_styles(layer, expected, *, require_original):
    """Exercise every retained native style, then restore the actual current one."""
    variants = expected.get("atlas_styles", [])
    if not variants:
        return []
    manager = layer.styleManager()
    current = manager.currentStyle()
    observed = []
    try:
        for variant in variants:
            if variant["name"] not in manager.styles():
                if require_original:
                    raise ValueError("A saved atlas style did not load in QGIS: " + variant["name"])
                continue
            if not manager.setCurrentStyle(variant["name"]):
                raise ValueError("QGIS could not select its retained atlas style")
            renderer = layer.renderer()
            style = variant["style"]
            if renderer.type() != "singlebandpseudocolor":
                if require_original:
                    raise ValueError("QGIS did not retain the atlas color ramp")
                continue
            ramp = renderer.shader().rasterShaderFunction()
            entries = ramp.colorRampItemList()
            transparency = renderer.rasterTransparency()
            matches = (ramp.colorRampTypeAsQString() == "INTERPOLATED"
                       and renderer.band() == expected["data"]["band"]
                       and renderer.opacity() == 1 and renderer.alphaBand() == -1
                       and (transparency is None or transparency.isEmpty())
                       and renderer.classificationMin() == style["minimum"]
                       and renderer.classificationMax() == style["maximum"]
                       and not ramp.clip() and len(entries) == len(style["entries"])
                       and all(a.value == b["value"] and a.color.name().lower() == b["color"]
                               and a.color.alpha() == b["alpha"]
                               for a, b in zip(entries, style["entries"])))
            if require_original and not matches:
                raise ValueError("QGIS changed a retained atlas range or palette")
            observed.append({"style_id": variant["id"], "name": variant["name"],
                             "original_legend_matches": matches, "stops": len(entries)})
    finally:
        if not manager.setCurrentStyle(current):
            raise ValueError("Could not restore the selected native QGIS style")
    return observed


def _native_roundtrip(output, manifest):
    """Release all providers before QGIS shutdown and filesystem publication."""
    from qgis.core import (QgsProject, QgsMapSettings, QgsMapRendererParallelJob,
                           QgsRectangle, Qgis)
    from qgis.PyQt.QtCore import QSize
    from qgis.PyQt.QtGui import QColor
    project = check = settings = job = layer = None
    loaded = {}
    try:
        project = QgsProject()
        if not project.read(str(output / "project.qgs")):
            raise ValueError("QGIS could not open the editable project")
        expected = {row["key"]: row for row in manifest["layers"]}
        loaded = project.mapLayers()
        if set(loaded) != set(expected):
            raise ValueError("Native QGIS layer identities differ")
        rows = []
        for key, layer in loaded.items():
            if not layer.isValid():
                raise ValueError("Native QGIS layer failed: " + layer.name())
            item = {"id": key, "name": layer.name(), "provider": layer.providerType(),
                    "crs": layer.crs().authid(), "valid": True}
            if expected[key]["data"]["kind"] == "vector":
                item["feature_count"] = layer.featureCount()
                if item["feature_count"] != expected[key]["data"]["feature_count"]:
                    raise ValueError("Native QGIS feature population differs")
            else:
                item.update(width=layer.width(), height=layer.height())
                if (item["width"], item["height"]) != (expected[key]["data"]["width"], expected[key]["data"]["height"]):
                    raise ValueError("Native QGIS raster dimensions differ")
            item["atlas_styles"] = inspect_atlas_styles(layer, expected[key],
                                                        require_original=not manifest.get("history"))
            rows.append(item)
        settings = QgsMapSettings()
        settings.setDestinationCrs(project.crs())
        settings.setBackgroundColor(QColor("white"))
        settings.setOutputSize(QSize(1400, 950))
        settings.setLayers([node.layer() for node in project.layerTreeRoot().findLayers() if node.isVisible()])
        settings.setExtent(QgsRectangle(*manifest["extent"]))
        job = QgsMapRendererParallelJob(settings)
        job.start()
        job.waitForFinished()
        errors = [{"layer_id": item.layerID, "message": item.message} for item in job.errors()]
        if errors:
            raise ValueError("Native QGIS rendering: " + json.dumps(errors))
        if not job.renderedImage().save(str(output / "qgis-native.png")):
            raise OSError("Could not save the native rendering")
        project.setFilePathStorage(Qgis.FilePathType.Relative)
        native_file = output / "project.qgz"
        if not project.write(str(native_file)):
            raise OSError("Native QGIS save failed")
        # Cold provider reopening must not borrow open layers or GeoPackage
        # descriptions from the first project. Windows also needs these closed
        # before the complete receiving directory can be published.
        job = None
        settings.setLayers([])
        settings = None
        loaded.clear()
        layer = None
        project.clear()
        project = None
        check = QgsProject()
        if not check.read(str(native_file)) or set(check.mapLayers()) != set(expected):
            raise ValueError("The native saved project did not reopen")
        for key, layer in check.mapLayers().items():
            if not layer.isValid():
                raise ValueError("A layer did not reopen from the native saved edition")
            inspect_atlas_styles(layer, expected[key], require_original=not manifest.get("history"))
        return {"version": Qgis.QGIS_VERSION, "layer_count": len(rows),
                "layers": rows, "render_errors": errors, "native_save_reopened": True}
    finally:
        if job is not None:
            with contextlib.suppress(RuntimeError):
                job.cancel()
        job = None
        if settings is not None:
            settings.setLayers([])
        settings = None
        loaded.clear()
        layer = None
        if check is not None:
            check.clear()
        check = None
        if project is not None:
            project.clear()
        project = None


def _copy_member(source, destination):
    fs = _filesystem()
    incoming = fs.open_file(source, os.O_RDONLY)
    with os.fdopen(incoming, "rb") as reader:
        outgoing = fs.open_file(destination, os.O_WRONLY | os.O_CREAT | os.O_EXCL)
        with os.fdopen(outgoing, "wb") as writer:
            shutil.copyfileobj(reader, writer, 1024 * 1024)
            writer.flush()
            os.fsync(writer.fileno())
    return destination


def run(directory, output):
    gis, fs = _gis_module(), _filesystem()
    os.environ.setdefault("QT_QPA_PLATFORM", "offscreen")
    from qgis.core import QgsApplication
    directory = fs.native_path(Path(directory).resolve(strict=True))
    output = fs.native_path(Path(output).resolve())
    before = gis.verify(directory, native=False)
    if output.exists() or output.is_relative_to(directory):
        raise FileExistsError("Choose a new receiving directory outside the sender")
    output.parent.mkdir(parents=True, exist_ok=True)
    staging = Path(tempfile.mkdtemp(prefix=".gis-native-receiving-", dir=output.parent))
    started = time.monotonic()
    try:
        shutil.copytree(directory, staging, copy_function=_copy_member, dirs_exist_ok=True)
        manifest = gis.load(staging / "project.json")
        if os.environ.get("QGIS_PREFIX_PATH"):
            QgsApplication.setPrefixPath(os.environ["QGIS_PREFIX_PATH"], True)
        app = QgsApplication([], False)
        try:
            app.initQgis()
            native = _native_roundtrip(staging, manifest)
        finally:
            app.exitQgis()
        # No QGIS project, renderer or provider is alive beyond this point.
        with zipfile.ZipFile(staging / "project.qgz") as archive:
            qgs = [n for n in archive.namelist() if n.endswith(".qgs")]
            if len(qgs) != 1:
                raise ValueError("Expected one native project XML")
            with (staging / "project.qgs").open("wb") as writer:
                writer.write(archive.read(qgs[0]))
                writer.flush()
                os.fsync(writer.fileno())
        result = {"schema": "upstate.gis-native-receiving/v1", **native,
                  "seconds": round(time.monotonic()-started, 6)}
        gis.save(staging / "native-receiving.json", result)
        manifest["native_qgis"] = {"status": "opened, rendered, saved and reopened", **result}
        gis.save(staging / "project.json", manifest)
        # HTML does not depend on QGIS Python's Fiona/Rasterio installation.
        gis.catalogue(staging, manifest)
        gis.inventory(staging)
        gis.verify(staging, native=False)
        if gis.verify(directory, native=False) != before:
            raise ValueError("Sender changed during native receiving")
        # Flush native-created files through writable handles on Windows.
        for path in staging.rglob("*"):
            if path.is_file():
                descriptor = fs.open_file(path, os.O_RDWR)
                try:
                    os.fsync(descriptor)
                finally:
                    os.close(descriptor)
        for path in sorted((p for p in staging.rglob("*") if p.is_dir()),
                           key=lambda p: len(p.parts), reverse=True):
            fs.sync_directory(path)
        fs.sync_directory(staging)
        fs.publish_directory(staging, output)
        return {**result, "directory": str(output), "sender_unchanged": True}
    except Exception as error:
        # The final destination only appears after a complete successful receive.
        # Keep a failed staging copy for diagnosis, never overwrite an old edition.
        raise RuntimeError("Native GIS receiving did not publish; working copy retained at "
                           + str(staging) + ": " + str(error)) from error


# QGIS installation bootstrap stays in this shipped helper, not the workbench runtime.
# QGIS application setup: docs.qgis.org/3.44/en/docs/pyqgis_developer_cookbook/intro.html
_RUNTIME_MARKER = "ECO_QGIS_RUNTIME="
_RESULT_MARKER = "ECO_QGIS_RESULT="
_ENV_KEYS = ("PATH", "PYTHONHOME", "PYTHONPATH", "QGIS_PREFIX_PATH", "OSGEO4W_ROOT",
             "QT_PLUGIN_PATH", "QT_QPA_PLATFORM_PLUGIN_PATH", "QT_QPA_PLATFORM",
             "GDAL_DATA", "GDAL_DRIVER_PATH", "PROJ_LIB", "PROJ_DATA",
             "LD_LIBRARY_PATH", "DYLD_LIBRARY_PATH", "DYLD_FRAMEWORK_PATH")
_PROBE_CODE = (
    "import json,os,sys;sys.dont_write_bytecode=True;from qgis.core import Qgis;"
    "print('ECO_QGIS_RUNTIME='+json.dumps({'executable':sys.executable,"
    "'version':Qgis.QGIS_VERSION,'environment':{k:os.environ[k] for k in "
    + repr(_ENV_KEYS) + " if k in os.environ}}))"
)


def _gis_module():
    if __package__:
        from . import gis_project
    else:
        import importlib
        parent = str(Path(__file__).resolve().parent.parent)
        if parent not in sys.path:
            sys.path.insert(0, parent)
        gis_project = importlib.import_module("model.gis_project")
    return gis_project


def _filesystem():
    if __package__:
        from . import portable_fs
    else:
        import importlib
        parent = str(Path(__file__).resolve().parent.parent)
        if parent not in sys.path:
            sys.path.insert(0, parent)
        portable_fs = importlib.import_module("model.portable_fs")
    return portable_fs


def _executable(value):
    """One executable or installer wrapper, never a shell command string."""
    value = os.fspath(value)
    found = shutil.which(value)
    path = Path(found or value).expanduser()
    if not path.is_file():
        raise FileNotFoundError("QGIS Python executable or installer wrapper not found: " + value)
    return path.absolute()


def _prepend(environment, key, paths):
    values = [str(path) for path in paths if path.is_dir()]
    if environment.get(key):
        values.append(environment[key])
    if values:
        environment[key] = os.pathsep.join(values)


def _candidates(python=None, prefix=None):
    environment = os.environ.copy()
    environment["PYTHONIOENCODING"] = "utf-8"
    environment["PYTHONUTF8"] = "1"
    environment["PYTHONDONTWRITEBYTECODE"] = "1"
    environment.setdefault("QT_QPA_PLATFORM", "offscreen")
    if prefix:
        path = Path(prefix).expanduser().resolve(strict=True)
        if not path.is_dir():
            raise NotADirectoryError("Select the installed QGIS resource directory")
        environment["QGIS_PREFIX_PATH"] = str(path)
    explicit = python or environment.get("ECO_QGIS_PYTHON")
    if explicit:
        yield _executable(explicit), environment
        return
    # The current interpreter wins only after its actual PyQGIS binding imports.
    if sys.executable:
        yield Path(sys.executable).absolute(), environment.copy()
    if sys.platform == "win32":
        roots = []
        if environment.get("OSGEO4W_ROOT"):
            roots.append(Path(environment["OSGEO4W_ROOT"]))
        drive = Path(environment.get("SystemDrive", "C:") + "\\")
        roots.extend((drive / "OSGeo4W", drive / "OSGeo4W64"))
        for key in ("ProgramFiles", "ProgramW6432"):
            if environment.get(key):
                roots.extend(sorted(Path(environment[key]).glob("QGIS*"), reverse=True))
        for root in roots:
            for name in ("python-qgis-ltr.bat", "python-qgis.bat"):
                launcher = root / "bin" / name
                if launcher.is_file():
                    yield launcher.absolute(), environment.copy()
    elif sys.platform == "darwin":
        for parent in (Path("/Applications"), Path.home() / "Applications"):
            for bundle in sorted(parent.glob("QGIS*.app"), reverse=True):
                contents = bundle / "Contents"
                child = environment.copy()
                child.pop("PYTHONHOME", None)
                child["QGIS_PREFIX_PATH"] = environment["QGIS_PREFIX_PATH"] if prefix else str(contents / "MacOS")
                _prepend(child, "PYTHONPATH", [contents / "Resources" / "python",
                                              contents / "Resources" / "python" / "plugins"])
                _prepend(child, "DYLD_LIBRARY_PATH", [contents / "MacOS" / "lib"])
                _prepend(child, "DYLD_FRAMEWORK_PATH", [contents / "Frameworks"])
                for relative in ("MacOS/bin/python3", "MacOS/bin/python"):
                    executable = contents / relative
                    if executable.is_file():
                        yield executable.absolute(), child.copy()
    else:
        # Distribution QGIS commonly belongs to system Python, not a venv.
        for value in (shutil.which("python3"), "/usr/bin/python3"):
            if value and Path(value).is_file():
                child = environment.copy()
                if Path(value).absolute() != Path(sys.executable).absolute():
                    child.pop("PYTHONHOME", None)
                yield Path(value).absolute(), child


def _windows_command(environment, expression):
    # cmd parses its /c remainder itself, not by the C-runtime argv rules.
    # Only the executable prefix uses list2cmdline; fixed shell text stays intact.
    prefix = subprocess.list2cmdline([environment.get("COMSPEC", "cmd.exe")])
    return prefix + ' /d /v:off /s /c "' + expression + '"'


def _probe_command(executable, environment):
    child = environment.copy()
    child["PYTHONDONTWRITEBYTECODE"] = "1"
    if executable.suffix.lower() in {".bat", ".cmd"}:
        if sys.platform != "win32":
            raise ValueError("A QGIS Windows installer wrapper requires Windows")
        # Only fixed code reaches cmd parsing. Project paths are never shell text.
        child["ECO_QGIS_WRAPPER"] = str(executable)
        child["ECO_QGIS_PROBE_CODE"] = _PROBE_CODE
        command = _windows_command(child, '"%ECO_QGIS_WRAPPER%" -B -c "%ECO_QGIS_PROBE_CODE%"')
    else:
        command = [str(executable), "-B", "-c", _PROBE_CODE]
    return command, child


def select_runtime(python=None, prefix=None):
    """Resolve real bindings without importing an incompatible Qt into the host."""
    seen, failures = set(), []
    for executable, environment in _candidates(python, prefix):
        key = (os.path.normcase(str(executable)), environment.get("QGIS_PREFIX_PATH"))
        if key in seen:
            continue
        seen.add(key)
        command, child = _probe_command(executable, environment)
        try:
            completed = subprocess.run(command, env=child, stdin=subprocess.DEVNULL,
                                       stdout=subprocess.PIPE, stderr=subprocess.PIPE,
                                       text=True, encoding="utf-8", errors="replace", timeout=12)
            records = [line[len(_RUNTIME_MARKER):] for line in completed.stdout.splitlines()
                       if line.startswith(_RUNTIME_MARKER)]
            if completed.returncode or len(records) != 1:
                detail = completed.stderr.strip().splitlines()
                failures.append(str(executable) + ": " + (detail[-1][:240] if detail else
                                                         "PyQGIS did not return its runtime"))
                continue
            runtime = json.loads(records[0])
            actual = _executable(runtime["executable"])
            if actual.suffix.lower() in {".bat", ".cmd"} or not isinstance(runtime["version"], str):
                raise ValueError("QGIS must identify its actual Python executable and version")
            configured = runtime["environment"]
            if not isinstance(configured, dict) or any(
                    key not in _ENV_KEYS or not isinstance(value, str)
                    for key, value in configured.items()):
                raise ValueError("Unexpected QGIS runtime environment")
            # Reuse the installer's environment, but launch Python directly for
            # the real operation so cancellation owns the actual worker process.
            child = environment.copy()
            for key in _ENV_KEYS:
                child.pop(key, None)
            child.update(configured)
            child["PYTHONDONTWRITEBYTECODE"] = "1"
            if prefix:
                child["QGIS_PREFIX_PATH"] = str(Path(prefix).expanduser().resolve(strict=True))
            return {"executable": str(actual), "version": runtime["version"], "environment": child}
        except (OSError, ValueError, KeyError, TypeError, subprocess.TimeoutExpired) as error:
            failures.append(str(executable) + ": " + str(error)[:240])
    detail = "\n".join(failures)
    raise RuntimeError("No usable QGIS Python was found. Use --qgis-python with the installed "
                       "QGIS Python executable or Windows bin/python-qgis*.bat wrapper. "
                       "The workbench's scientific Python is separate from PyQGIS.\n" + detail)


def receive(directory, output, *, python=None, prefix=None):
    """Run the native receiving workflow in its compatible QGIS Python."""
    directory = Path(directory).expanduser().resolve(strict=True)
    output = Path(output).expanduser().resolve()
    if not directory.is_dir():
        raise NotADirectoryError("Select the complete extracted GIS directory")
    if output.exists() or output.is_relative_to(directory):
        raise FileExistsError("Choose a new receiving directory outside the sender")
    runtime = select_runtime(python, prefix)
    request = json.dumps({"directory": str(directory), "output": str(output)}, ensure_ascii=False)
    command = [runtime["executable"], "-B", str(Path(__file__).resolve()), "--_worker"]
    process = subprocess.Popen(command, env=runtime["environment"], cwd=directory,
                               stdin=subprocess.PIPE, stdout=subprocess.PIPE, stderr=subprocess.PIPE,
                               text=True, encoding="utf-8", errors="replace")
    try:
        stdout, stderr = process.communicate(request)
    except BaseException:
        if process.poll() is None:
            process.terminate()
            try:
                process.communicate(timeout=5)
            except subprocess.TimeoutExpired:
                process.kill()
                process.communicate()
        raise
    if stderr:
        print(stderr, file=sys.stderr, end="" if stderr.endswith("\n") else "\n")
    records = [line[len(_RESULT_MARKER):] for line in stdout.splitlines()
               if line.startswith(_RESULT_MARKER)]
    if process.returncode or len(records) != 1:
        raise RuntimeError("QGIS receiving exited " + str(process.returncode) +
                           "; review the native error above and the retained receiving folder.")
    result = json.loads(records[0])
    if result.get("schema") != "upstate.gis-native-receiving/v1":
        raise ValueError("Unexpected native QGIS receiving result")
    return result


def open_project(directory):
    """Open an editable working project; sealing belongs to the handoff operation."""
    root = Path(directory).expanduser().resolve(strict=True)
    gis = _gis_module()
    manifest = gis.load(gis.local(root, "project.json"))
    if manifest.get("schema") != gis.SCHEMA:
        raise ValueError("Select the complete extracted editable GIS directory")
    project = gis.local(root, "project.qgz")
    # A scientist may save ordinary QGIS edits between opening and sealing.
    # Hash verification here would prevent reopening that legitimate working
    # copy. Receive/verify/pack still require the full original inventory.
    child = os.environ.copy()
    child["PYTHONDONTWRITEBYTECODE"] = "1"
    if child.get("QT_QPA_PLATFORM", "").split(":", 1)[0] in {"offscreen", "minimal"}:
        child.pop("QT_QPA_PLATFORM", None)
    if sys.platform == "win32":
        child["ECO_QGIS_PROJECT"] = str(project)
        command = _windows_command(child, 'start "" "%ECO_QGIS_PROJECT%"')
        subprocess.run(command, cwd=root, env=child, stdin=subprocess.DEVNULL, check=True, timeout=15)
    elif sys.platform == "darwin":
        subprocess.run(["/usr/bin/open", str(project)], cwd=root, env=child,
                       stdin=subprocess.DEVNULL, check=True, timeout=15)
    else:
        executable = shutil.which("qgis") or shutil.which("xdg-open")
        if not executable:
            raise FileNotFoundError("Install QGIS Desktop, then open project.qgz from the extracted GIS folder")
        subprocess.Popen([executable, str(project)], cwd=root, env=child, stdin=subprocess.DEVNULL,
                         stdout=subprocess.DEVNULL, stderr=subprocess.DEVNULL, start_new_session=True)
    return {"state": "desktop_open_requested", "project": str(project),
            "instruction": "Keep the extracted folder together. Edit and save in QGIS; close QGIS and seal intentional edits before packing a new edition."}


def main(argv=None):
    parser = argparse.ArgumentParser(description=__doc__, formatter_class=argparse.RawDescriptionHelpFormatter)
    parser.add_argument("directory", nargs="?")
    parser.add_argument("output", nargs="?")
    parser.add_argument("--qgis-python", help="Actual QGIS Python executable, or Windows python-qgis*.bat wrapper")
    parser.add_argument("--qgis-prefix", help="Installed QGIS resource prefix; kept only in the receiving process")
    parser.add_argument("--runtime", action="store_true", help="Show the selected actual QGIS Python and version")
    parser.add_argument("--open", action="store_true", help="Open project.qgz in the desktop file association")
    parser.add_argument("--_worker", action="store_true", help=argparse.SUPPRESS)
    args = parser.parse_args(argv)
    try:
        if args._worker:
            request = json.load(sys.stdin)
            result = run(request["directory"], request["output"])
            print(_RESULT_MARKER + json.dumps(result, ensure_ascii=False, allow_nan=False))
            return 0
        if args.runtime:
            runtime = select_runtime(args.qgis_python, args.qgis_prefix)
            result = {key: runtime[key] for key in ("executable", "version")}
        elif args.open:
            if not args.directory or args.output:
                parser.error("--open needs the extracted GIS directory and no output directory")
            result = open_project(args.directory)
        else:
            if not args.directory or not args.output:
                parser.error("native receiving needs ORIGINAL_DIRECTORY NEW_RECEIVING_DIRECTORY")
            result = receive(args.directory, args.output, python=args.qgis_python, prefix=args.qgis_prefix)
        print(json.dumps(result, ensure_ascii=False, indent=2, allow_nan=False))
        return 0
    except (OSError, RuntimeError, ValueError, KeyError, TypeError, subprocess.SubprocessError) as error:
        print(json.dumps({"error": {"type": type(error).__name__, "message": str(error)}},
                         ensure_ascii=False), file=sys.stderr)
        return 2
    except KeyboardInterrupt:
        print("GIS operation interrupted.", file=sys.stderr)
        return 130


if __name__ == "__main__":
    raise SystemExit(main())
