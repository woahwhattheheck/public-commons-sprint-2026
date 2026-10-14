"""Select conda-pack's Windows writer without changing the build host's platform.

The installed upstream source is loaded into a private module namespace. Only
its target selector is specialized; original File/Packer/archive algorithms and
serialized conda-unpack source remain upstream code. No Windows executable is
run. This is a packing adapter, not a package solver or a native relocator.
"""
from __future__ import annotations

import ast
import hashlib
import importlib
import importlib.util
import ntpath
import os
from pathlib import Path
import sys
import threading
import types

if __package__:
    from .payload_closure import PayloadError, Prefix, _image, _key
else:
    from payload_closure import PayloadError, Prefix, _image, _key

_LOCK = threading.RLock()
_CACHE = {}
_REQUIRED = ('compat.py', 'core.py', 'prefixes.py', 'formats.py',
             'scripts/windows/activate.bat', 'scripts/windows/deactivate.bat')


class _PathView:
    """Keep host filesystem paths, but compare package names as Windows does."""
    def __getattr__(self, name):
        return getattr(os.path, name)

    @staticmethod
    def normcase(path):
        return ntpath.normcase(path).replace('\\', '/')


class _OSView:
    path = _PathView()

    def __getattr__(self, name):
        return getattr(os, name)


def _target_prefixes(name: str, path: Path):
    """Specialize one upstream compile-time flag, preserving every function."""
    body = path.read_bytes()
    tree = ast.parse(body, filename=str(path))
    assignments = [node for node in tree.body if isinstance(node, ast.Assign)
                   and len(node.targets) == 1 and isinstance(node.targets[0], ast.Name)
                   and node.targets[0].id == 'on_win']
    if len(assignments) != 1:
        raise PayloadError('Unrecognized conda-pack Windows selector in prefixes.py')
    expected = ast.parse("sys.platform == 'win32'", mode='eval').body
    if ast.dump(assignments[0].value) != ast.dump(expected):
        raise PayloadError('Changed conda-pack Windows selector; review this writer version')
    assignments[0].value = ast.copy_location(ast.Constant(True), assignments[0].value)
    ast.fix_missing_locations(tree)
    spec = importlib.util.spec_from_file_location(name, path)
    module = importlib.util.module_from_spec(spec)
    sys.modules[name] = module
    exec(compile(tree, str(path), 'exec'), module.__dict__)
    return module


def _canonical_files(core, prefix, files):
    """Resolve metadata casing using the unchanged physical Windows inventory."""
    for file in files:
        target = file.target.replace('\\', '/')
        actual = prefix.paths.get(_key(target), target)
        source = Path(file.source)
        # Cache sources keep their exact raw placeholder bytes. Only an
        # installed-prefix source with different case needs its physical path.
        try:
            rel = source.relative_to(prefix.root).as_posix().replace('\\', '/')
        except ValueError:
            pass
        else:
            source = prefix.root / prefix.paths.get(_key(rel), rel)
        if not source.exists() and not source.is_symlink():
            raise PayloadError('Missing original Windows packing source: ' + str(source))
        yield core.File(str(source), actual, file.is_conda,
                        file.file_mode, file.prefix_placeholder)


def _validate_prefix(prefix):
    if not (prefix.root / 'conda-meta').is_dir():
        raise PayloadError('Select the acquired conda prefix, including original conda-meta')
    python = prefix.file('python.exe')
    if python is None:
        raise PayloadError('Windows packing needs the selected prefix python.exe')
    _image(python, 'windows-x86_64')
    for package in prefix.packages.values():
        subdir = package.body.get('subdir')
        if subdir and subdir not in ('win-64', 'noarch'):
            raise PayloadError('Foreign conda package in Windows prefix: ' + package.key[0])


def _windows_writer():
    import conda_pack
    origin = Path(conda_pack.__file__).resolve().parent
    tracked = _REQUIRED + (('_progress.py',) if (origin / '_progress.py').is_file() else ())
    sources = {name: hashlib.sha256((origin / name).read_bytes()).hexdigest()
               for name in tracked}
    signature = hashlib.sha256(repr(sorted(sources.items())).encode()).hexdigest()
    with _LOCK:
        if signature in _CACHE:
            return _CACHE[signature]
        namespace = '_upstate_win64_conda_pack_' + signature[:24]
        package = types.ModuleType(namespace)
        package.__path__ = [str(origin)]
        package.__file__ = str(origin / '__init__.py')
        package.__package__ = namespace
        package.__version__ = conda_pack.__version__
        sys.modules[namespace] = package
        try:
            compat = importlib.import_module(namespace + '.compat')
            compat.on_win, compat.on_mac, compat.on_linux = True, False, False
            compat.is_32bit = False
            _target_prefixes(namespace + '.prefixes', origin / 'prefixes.py')
            core = importlib.import_module(namespace + '.core')
            # Only this private core sees case-insensitive metadata keys. Host
            # open/stat/join functions still address the real Linux/macOS paths.
            core.os = _OSView()
            formats = importlib.import_module(namespace + '.formats')
            if core.BIN_DIR != 'Scripts' or not core.on_win or not formats.on_win:
                raise PayloadError('conda-pack target writer did not select Windows')
            if {target.replace('\\', '/') for _, target in core._scripts} != {
                    'Scripts/activate.bat', 'Scripts/deactivate.bat'}:
                raise PayloadError('Changed upstream Windows activation inventory')
            # The same setuptools launcher used by upstream Windows conda-pack
            # must be physically present and PE32+ x86-64, not a host executable.
            launcher = Path(str(core.resource_files('setuptools') / 'cli-64.exe'))
            _image(launcher, 'windows-x86_64')

            class WindowsEnvironment(core.CondaEnv):
                @classmethod
                def from_prefix(cls, prefix, **options):
                    selected = Prefix(prefix, 'windows-x86_64')
                    _validate_prefix(selected)
                    files = core.load_environment(str(selected.root), **options)
                    return cls(str(selected.root), list(_canonical_files(core, selected, files)))

                def pack(self, *args, **options):
                    if args:
                        raise PayloadError('Use named Windows packing arguments')
                    if options.get('dest_prefix') is not None or options.get('parcel_name'):
                        raise PayloadError('Use ordinary relocatable Windows packing')
                    if options.get('format', 'tar.gz') not in ('tar.gz', 'zip'):
                        raise PayloadError('Windows receiving supports tar.gz or zip')
                    # Windows packages normally contain hard links. A retained
                    # internal symlink is materialized using upstream's native
                    # Windows tar/ZIP behavior, avoiding Unix ZIP link entries.
                    options['zip_symlinks'] = False
                    result = super().pack(**options)
                    current = {name: hashlib.sha256((origin / name).read_bytes()).hexdigest()
                               for name in tracked}
                    if current != sources or hashlib.sha256(launcher.read_bytes()).hexdigest() != identity['launcher_sha256']:
                        raise PayloadError('Upstream Windows writer changed during packing')
                    return result

            identity = {'schema': 'upstate.windows-conda-pack-writer/v1',
                        'target': 'windows-x86_64', 'host': sys.platform,
                        'conda_pack_version': conda_pack.__version__,
                        'upstream_sources': sources,
                        'launcher_sha256': hashlib.sha256(launcher.read_bytes()).hexdigest()}
            api = types.SimpleNamespace(CondaEnv=WindowsEnvironment, File=core.File,
                                        __version__=conda_pack.__version__, identity=identity)
            _CACHE[signature] = (api, core)
            return api, core
        except BaseException:
            for name in tuple(sys.modules):
                if name == namespace or name.startswith(namespace + '.'):
                    sys.modules.pop(name, None)
            raise


def select_writer(target: str):
    """Return the target-aware API/core; native and POSIX paths stay unchanged."""
    if target == 'windows-x86_64' and os.name != 'nt':
        return _windows_writer()
    if target.startswith('windows-') != (os.name == 'nt'):
        raise PayloadError('Use a POSIX packing host for Linux/macOS payloads')
    import conda_pack
    from conda_pack import core
    return conda_pack, core
