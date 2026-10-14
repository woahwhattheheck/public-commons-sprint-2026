"""Reconnect transported conda package caches without editing prefix metadata.

A moved prefix's conda-meta link.source still names the old machine. Select the
same package builds from explicitly supplied extracted caches, then use the
installed conda-pack's own metadata/noarch loader for their original File records.
The selected cache roots join the existing pack transaction's source snapshot.
"""
from __future__ import annotations

from dataclasses import dataclass
import hashlib
import json
from pathlib import Path
import unicodedata
from urllib.parse import unquote, urlsplit


class PackageSourceError(ValueError):
    """The supplied package cache differs from the selected runtime's source."""


def path_key(path: str, target: str) -> str:
    value = path.replace('\\', '/')
    return value if target.startswith('linux-') else unicodedata.normalize('NFC', value).casefold()


def _read(path: Path) -> dict:
    value = json.loads(path.read_text(encoding='utf-8'))
    if not isinstance(value, dict):
        raise PackageSourceError('Expected conda metadata object: ' + str(path))
    return value


def _key(body: dict) -> tuple[str, str, str]:
    values = tuple(body.get(k) for k in ('name', 'version', 'build'))
    if not all(isinstance(v, str) and v for v in values):
        raise PackageSourceError('Conda package must have name, version and build')
    return values


def _hash(path: Path, algorithm='sha256') -> str:
    state = hashlib.new(algorithm)
    with path.open('rb') as stream:
        for block in iter(lambda: stream.read(1024 * 1024), b''):
            state.update(block)
    return state.hexdigest()


def _subdir(body: dict) -> str | None:
    if isinstance(body.get('subdir'), str):
        return body['subdir']
    if body.get('noarch'):
        return 'noarch'
    if isinstance(body.get('url'), str):
        value = urlsplit(body['url']).path.rsplit('/', 2)
        if len(value) > 1 and value[-2] in ('noarch', 'win-64', 'osx-64', 'osx-arm64', 'linux-64', 'linux-aarch64'):
            return value[-2]
    system = body.get('platform')
    arch = body.get('arch')
    return {('win', 'x86_64'): 'win-64', ('osx', 'x86_64'): 'osx-64',
            ('osx', 'arm64'): 'osx-arm64', ('linux', 'x86_64'): 'linux-64',
            ('linux', 'aarch64'): 'linux-aarch64'}.get((system, arch))


def _contained_name(value: str) -> str:
    value = value.replace('\\', '/')
    if (not value or value.startswith('/') or ':' in value or '\0' in value
            or any(p in ('', '.', '..') for p in value.split('/'))):
        raise PackageSourceError('Invalid raw package member: ' + value)
    return value


@dataclass(frozen=True)
class _Candidate:
    root: Path
    index: dict
    repodata: dict

    @property
    def key(self):
        return _key(self.index)


def _candidates(caches) -> dict:
    result = {}
    visited = set()
    for value in caches:
        root = Path(value).resolve(strict=True)
        if not root.is_dir():
            raise PackageSourceError('Package cache must be an extracted directory: ' + str(root))
        roots = [root] if (root / 'info/index.json').is_file() else sorted(
            p for p in root.iterdir() if p.is_dir() and (p / 'info/index.json').is_file())
        for path in roots:
            path = path.resolve(strict=True)
            if path in visited:
                continue
            visited.add(path)
            index = _read(path / 'info/index.json')
            record = path / 'info/repodata_record.json'
            repodata = _read(record) if record.is_file() else index
            if _key(repodata) != _key(index):
                raise PackageSourceError('Cache index and repodata disagree: ' + str(path))
            item = _Candidate(path, index, repodata)
            result.setdefault(item.key, []).append(item)
    return result


def _matches(candidate: _Candidate, body: dict, target: str) -> bool:
    if candidate.key != _key(body):
        return False
    actual = _subdir(candidate.repodata) or _subdir(candidate.index)
    expected = _subdir(body)
    target_subdir = {'windows-x86_64': 'win-64', 'macos-x86_64': 'osx-64',
                     'macos-arm64': 'osx-arm64', 'linux-x86_64': 'linux-64',
                     'linux-arm64': 'linux-aarch64'}[target]
    if ((expected and expected not in (target_subdir, 'noarch'))
            or (actual and actual not in (target_subdir, 'noarch'))):
        return False
    if expected and actual and expected != actual:
        return False
    # Prefer selected archive identity over a location, allowing byte-identical
    # mirrors while rejecting another channel's different build with this name.
    for algorithm in ('sha256', 'md5'):
        wanted = body.get(algorithm)
        offered = candidate.repodata.get(algorithm)
        if wanted and offered and wanted != offered:
            return False
        if wanted and not offered:
            filenames = []
            if isinstance(body.get('fn'), str):
                filenames.append(body['fn'])
            if isinstance(body.get('url'), str):
                filenames.append(unquote(urlsplit(body['url']).path.rsplit('/', 1)[-1]))
            filenames += [candidate.root.name + '.conda', candidate.root.name + '.tar.bz2']
            archives = [candidate.root.parent / name for name in dict.fromkeys(filenames)
                        if name and Path(name).name == name]
            found = [path for path in archives if path.is_file()]
            if found and not any(_hash(path, algorithm) == wanted for path in found):
                return False
    return True


@dataclass(frozen=True)
class _Binding:
    prefix: Path
    record: Path
    record_sha256: str
    candidate: _Candidate


class CacheSources:
    """Read-only raw-package selections for one existing packing operation."""
    def __init__(self, prefixes, caches, *, target: str):
        self.target = target
        self.bindings = []
        index = _candidates(caches)
        for value in prefixes:
            prefix = Path(value).resolve(strict=True)
            for record in sorted((prefix / 'conda-meta').glob('*.json')):
                body = _read(record)
                key = _key(body)
                original = (body.get('link') or {}).get('source')
                # Preserve still-accessible original package caches. An explicit
                # cache is a recovery source, not an override of existing data.
                if original and Path(original).is_dir():
                    continue
                matches = [candidate for candidate in index.get(key, [])
                           if _matches(candidate, body, target)]
                if not matches:
                    if key in index:
                        raise PackageSourceError('Supplied cache differs from selected package: ' + '-'.join(key))
                    continue
                if len(matches) > 1:
                    raise PackageSourceError('Multiple raw cache sources for ' + '-'.join(key)
                                             + '; select its original extracted package directory')
                self.bindings.append(_Binding(prefix, record, _hash(record), matches[0]))
        self.roots = tuple(sorted({binding.candidate.root for binding in self.bindings}))
        self.receipt = [{'prefix': str(b.prefix), 'record': b.record.name,
                         'record_sha256': b.record_sha256, 'package': list(b.candidate.key),
                         'cache': str(b.candidate.root)} for b in self.bindings]

    def augment(self, prefix, conda_pack, descriptions: dict, *, core=None) -> dict:
        """Overlay recovered official File records on the original loader result."""
        prefix = Path(prefix).resolve(strict=True)
        core = core if core is not None else conda_pack.core
        physical = {}
        for path in core.load_files(str(prefix)):
            key = path_key(path, self.target)
            if key in physical and physical[key] != path:
                raise PackageSourceError('Case/Unicode collision in prefix: ' + path)
            physical[key] = path
        normal = {core.os.path.normcase(path): path for path in physical.values()}
        site_packages = core.find_site_packages(str(prefix))
        result = {path_key(path, self.target): item for path, item in descriptions.items()}
        for binding in self.bindings:
            if binding.prefix != prefix:
                continue
            if _hash(binding.record) != binding.record_sha256:
                raise PackageSourceError('Original package metadata changed: ' + binding.record.name)
            body = _read(binding.record)
            body['link'] = {**(body.get('link') or {}), 'source': str(binding.candidate.root)}
            files = core.load_managed_package(body, str(prefix), site_packages, normal)
            metadata_path = binding.candidate.root / 'info/paths.json'
            paths = _read(metadata_path).get('paths', []) if metadata_path.is_file() else []
            raw = {_contained_name(row['_path']): row for row in paths}
            for file in files:
                key = path_key(file.target, self.target)
                actual = physical.get(key)
                if actual is None:
                    continue  # Preserve the maintained ignore_missing_files selection.
                source = Path(file.source)
                try:
                    relative = source.relative_to(binding.candidate.root).as_posix()
                except ValueError:
                    # Official noarch-generated entry points live in the prefix.
                    source = prefix / actual
                else:
                    description = raw.get(relative, {})
                    source.lstat()
                    if not source.resolve(strict=True).is_relative_to(binding.candidate.root):
                        raise PackageSourceError('Raw cache member leaves its package: ' + relative)
                    if source.is_file() and not source.is_symlink():
                        wanted = description.get('sha256')
                        if wanted and _hash(source) != wanted:
                            raise PackageSourceError('Raw package member was modified: ' + relative)
                        size = description.get('size_in_bytes')
                        if size is not None and source.stat().st_size != size:
                            raise PackageSourceError('Raw package member size changed: ' + relative)
                result[key] = conda_pack.File(str(source), actual, file.is_conda,
                                              file.file_mode, file.prefix_placeholder)
        return result
