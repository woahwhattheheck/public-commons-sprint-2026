"""Target layouts and loader activation for original received native runtimes.

No downloads, model adapters or scientific calculations live here. Prefixes are
chosen by the verified receiver; this module never falls back to a global GIS.
"""
from __future__ import annotations

import os
from pathlib import Path
import platform
import sys

_DLL_HANDLES = {}


def system_name(value=None):
    value = (value or platform.system()).lower()
    return {"win32": "Windows", "windows": "Windows", "darwin": "Darwin",
            "macos": "Darwin", "mac": "Darwin", "linux": "Linux"}.get(value, value)


def machine_name(value):
    value = str(value).lower()
    return {"amd64": "x86_64", "x64": "x86_64", "x86-64": "x86_64",
            "aarch64": "arm64"}.get(value, value)


def archive_layout(names):
    """Recognize conda-pack's real entry points, without executing the payload."""
    names = set(names)
    layouts = []
    if {"bin/python", "bin/conda-unpack"} <= names:
        layouts.append({"family": "posix", "python": "bin/python",
                        "relocation": "bin/conda-unpack"})
    if {"python.exe", "Scripts/conda-unpack-script.py"} <= names:
        layouts.append({"family": "windows", "python": "python.exe",
                        "relocation": "Scripts/conda-unpack-script.py"})
    if len(layouts) > 1:
        raise ValueError("A native runtime contains both Windows and POSIX entry points")
    return layouts[0] if layouts else None


def require_layout(names, system=None):
    layout = archive_layout(names)
    if layout is None:
        raise ValueError("Select a complete conda-pack: bin/python + bin/conda-unpack "
                         "or python.exe + Scripts/conda-unpack-script.py")
    if system is not None:
        expected = "windows" if system_name(system) == "Windows" else "posix"
        if layout["family"] != expected:
            raise ValueError("Conda archive entry points do not match its selected platform")
    return layout


def interpreter(prefix, *, kind="conda-pack", system=None):
    """Return the selected prefix's Python, never a PATH/system substitute."""
    prefix = Path(prefix)
    if system_name(system) == "Windows":
        return prefix / ("Scripts/python.exe" if kind == "wheelhouse" else "python.exe")
    return prefix / "bin/python"


def prefix_environment(prefix=None, offline=False, *, base=None, system=None):
    """Prepare an explicit native prefix including Node, GIS data and trust roots.

    `system` permits target-package inspection in a cloud builder. Actual launch
    callers omit it, so inspecting a Windows layout on Linux never executes it.
    """
    source = os.environ if base is None else base
    env = {key: value for key, value in source.items()
           if not key.upper().startswith(("PYTHON", "PIP_", "CONDA_"))
           and key.upper() not in ("VIRTUAL_ENV", "GDAL_DATA", "GDAL_DRIVER_PATH",
                                    "PROJ_LIB", "PROJ_DATA")}
    selected = system_name(system)
    if selected == "Darwin":
        # Select the packaged Mach-O dependencies before the interpreter starts,
        # not a caller's development-time loader overrides.
        env = {key: value for key, value in env.items() if not key.startswith("DYLD_")}
    # Case-insensitive Windows environment names can otherwise leave PATH/Path
    # or SSL_CERT_FILE/ssl_cert_file competing in the CreateProcess block.
    if selected == "Windows":
        env = {key.upper(): value for key, value in env.items()}
    env.update(PYTHONDONTWRITEBYTECODE="1", PYTHONNOUSERSITE="1",
               PIP_CONFIG_FILE="nul" if selected == "Windows" else os.devnull,
               PIP_DISABLE_PIP_VERSION_CHECK="1", PIP_NO_INPUT="1")
    if offline:
        env["PIP_NO_INDEX"] = "1"
    if prefix is None:
        return env
    prefix = Path(prefix).absolute()
    separator = ";" if selected == "Windows" else ":"
    relatives = ((".", "Library/mingw-w64/bin", "Library/usr/bin", "Library/bin", "Scripts", "bin")
                 if selected == "Windows" else ("bin",))
    locations = [str(prefix / name) for name in relatives if (prefix / name).is_dir()]
    prior = env.get("PATH", "")
    env["PATH"] = separator.join(locations + ([prior] if prior else []))
    env["CONDA_PREFIX"] = str(prefix)
    shares = ("Library/share", "share") if selected == "Windows" else ("share",)
    for share in shares:
        proj = prefix / share / "proj"
        if "PROJ_DATA" not in env and (proj / "proj.db").is_file():
            env["PROJ_DATA"] = env["PROJ_LIB"] = str(proj)
        gdal = prefix / share / "gdal"
        if "GDAL_DATA" not in env and gdal.is_dir():
            env["GDAL_DATA"] = str(gdal)
    # Preserve the received Node's original qualified C++ runtime on Linux.
    if selected == "Linux" and (prefix / "bin/node").is_file() and (prefix / "lib").is_dir():
        prior = env.get("LD_LIBRARY_PATH", "")
        env["LD_LIBRARY_PATH"] = str(prefix / "lib") + (":" + prior if prior else "")
    # Conda-pack relocates Mach-O load commands; do not inject a global DYLD path.
    certificates = ("Library/ssl/cert.pem", "ssl/cert.pem") if selected == "Windows" else ("ssl/cert.pem",)
    if "SSL_CERT_FILE" not in env:
        for relative in certificates:
            path = prefix / relative
            if path.is_file():
                # Load this interpreter's SSL, not a different target's DLLs.
                # conda Windows keeps OpenSSL under Library/bin.
                activate_libraries()
                import ssl
                context = ssl.SSLContext(ssl.PROTOCOL_TLS_CLIENT)
                context.load_verify_locations(cafile=str(path))
                if not context.cert_store_stats()["x509_ca"]:
                    raise ValueError("The supplied relocated trust store contains no certificate authorities.")
                env["SSL_CERT_FILE"] = str(path)
                break
    return env


def activate_libraries(prefix=None):
    """Keep Windows DLL search handles alive before any native extension import.

    Python 3.8+ extension/ctypes dependency resolution uses add_dll_directory,
    not merely PATH. Returned handles stay in this module for process lifetime.
    """
    if os.name != "nt":
        return ()
    prefix = Path(prefix or sys.prefix).resolve(strict=True)
    for relative in (".", "Library/bin", "DLLs", "Library/usr/bin", "Library/mingw-w64/bin"):
        path = prefix / relative
        if not path.is_dir():
            continue
        resolved = path.resolve(strict=True)
        if not resolved.is_relative_to(prefix):
            raise ValueError("Native DLL directory leaves its received prefix: " + relative)
        key = os.path.normcase(str(resolved))
        if key not in _DLL_HANDLES:
            _DLL_HANDLES[key] = os.add_dll_directory(str(resolved))
    return tuple(_DLL_HANDLES)
