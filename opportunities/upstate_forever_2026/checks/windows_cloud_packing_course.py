"""One manual packing/receiving course using the retained real Windows python.exe.

Metadata fixtures exercise Windows/noarch mapping and relocation mechanisms;
they are not a scientific environment or a model result. The full bootstrap
byte-preservation course is kept separately in the original receiving output.
"""
from __future__ import annotations

import argparse
import ast
import hashlib
import io
import json
import os
from pathlib import Path
import shutil
import sys
import tarfile
import zipfile

sys.path.insert(0, str(Path(__file__).resolve().parents[1]))
from source_tools.native_runtime.prefix_pack import pack_completed, source_snapshot
from source_tools.native_runtime.windows_packing import select_writer
from source_tools.native_runtime.payload_closure import PayloadError


def run(windows_python: Path, output: Path):
    output.mkdir(parents=True, exist_ok=False)
    original, staged, cache = (output / n for n in ('original', 'staging', 'cache'))
    original.mkdir(); (original / 'conda-meta').mkdir()
    shutil.copy2(windows_python, original / 'python.exe')
    (original / 'conda-meta/history').write_text('# Windows writer metadata course\n')
    api, core = select_writer('windows-x86_64')
    import conda_pack.core as native_core
    host = (sys.platform, os.name, native_core.on_win, native_core.BIN_DIR)
    placeholder = r'C:\retained build\environment'
    text = (placeholder + '\\Library\\share\\gdal\n').encode()
    package = cache / 'metadata-course'; (package / 'info').mkdir(parents=True)
    rows = []
    for relative, content, mode in (
            ('site-packages/course/config.txt', text, 'text'),
            ('python-scripts/course-script.py', b'#!' + placeholder.encode() + b'\\python.exe\r\npass\r\n', 'text')):
        p = package / relative; p.parent.mkdir(parents=True, exist_ok=True); p.write_bytes(content)
        rows.append({'_path': relative, 'path_type': 'hardlink',
                     'prefix_placeholder': placeholder, 'file_mode': mode})
        target = relative.replace('site-packages/', 'Lib/site-packages/').replace('python-scripts/', 'Scripts/')
        q = original / target; q.parent.mkdir(parents=True, exist_ok=True); q.write_bytes(content)
    (package / 'info/paths.json').write_text(json.dumps({'paths_version': 1, 'paths': rows}))
    (package / 'info/link.json').write_text(json.dumps({'noarch': {'type': 'python'}}))
    # Explicit fixtures, not claims about the original executable distribution.
    records = [
        {'name': 'python', 'version': '3.12.0', 'build': 'writer_fixture', 'subdir': 'win-64',
         'link': None, 'files': ['python.exe'], 'url': 'fixture:retained-native-executable'},
        {'name': 'metadata-course', 'version': '1', 'build': 'writer_fixture', 'subdir': 'noarch',
         'link': {'source': str(package)}, 'files': ['Lib/site-packages/course/config.txt', 'Scripts/course-script.py'],
         'url': 'fixture:windows-noarch-metadata'}]
    for record in records:
        (original / 'conda-meta' / (record['name'] + '-fixture.json')).write_text(json.dumps(record))
    shutil.copytree(original, staged)
    before = source_snapshot((original, staged))
    archive = output / 'Windows_Metadata_Course.zip'
    first = pack_completed(original, staged, archive, target='windows-x86_64', format='zip')
    resumed = pack_completed(original, staged, archive, target='windows-x86_64', format='zip', resume=True)
    assert resumed['reused'] and resumed['archive'] == first['archive']
    assert source_snapshot((original, staged)) == before
    received = output / 'received'; received.mkdir()
    with zipfile.ZipFile(archive) as z:
        names = z.namelist()
        assert len(names) == len(set(names)), 'duplicate Windows archive member'
        assert 'runtime/Lib/site-packages/course/config.txt' in names
        assert 'runtime/Scripts/course-script.py' in names
        assert 'runtime/bin/conda-unpack' not in names
        assert z.read('runtime/python.exe') == windows_python.read_bytes()
        assert json.loads(z.read('runtime/conda-meta/metadata-course-fixture.json'))['link']['source'] == ''
        assert z.read('runtime/Scripts/activate.bat') == Path(core._scripts[0][0]).read_bytes()
        script = z.read('runtime/Scripts/conda-unpack-script.py')
        assert Path(core._current_dir, 'prefixes.py').read_bytes() in script
        z.extractall(received)
    moved = output / 'physically moved Ω'; received.rename(moved)
    prefix = moved / 'runtime'
    tree = ast.parse(script)
    records = next(ast.literal_eval(n.value) for n in tree.body
                   if isinstance(n, ast.Assign) and any(isinstance(t, ast.Name) and t.id == '_prefix_records' for t in n.targets))
    windows_relocator = sys.modules[core.__package__ + '.prefixes']
    for path, old, mode in records:
        windows_relocator.update_prefix(str(prefix / path), str(prefix), old, mode)
    assert str(prefix).encode() in (prefix / 'Lib/site-packages/course/config.txt').read_bytes()
    assert placeholder.encode() not in (prefix / 'Scripts/course-script.py').read_bytes()
    # Real distlib/setuptools PE launcher plus an entry-point ZIP; only its
    # shebang is replaced by the original upstream Windows binary algorithm.
    launcher = Path(str(core.resource_files('setuptools') / 'cli-64.exe')).read_bytes()
    body = io.BytesIO()
    with zipfile.ZipFile(body, 'w') as z: z.writestr('__main__.py', 'pass\n')
    entry = launcher + b'#!' + placeholder.encode() + b'\\python.exe\r\n' + body.getvalue()
    rewritten = windows_relocator.replace_prefix(entry, 'binary', placeholder, r'D:\moved\native')
    assert rewritten.startswith(launcher) and rewritten.endswith(body.getvalue())
    assert placeholder.encode() not in rewritten
    assert (sys.platform, os.name, native_core.on_win, native_core.BIN_DIR) == host
    rejected = []
    for bad in ('Library/AUX.txt', 'PYTHON.EXE'):
        p = original / bad; p.parent.mkdir(parents=True, exist_ok=True); p.write_bytes(b'bad name')
        try:
            api.CondaEnv.from_prefix(str(original), ignore_missing_files=True, on_missing_cache='ignore')
        except PayloadError:
            rejected.append(bad)
        else:
            raise AssertionError('Windows namespace accepted ' + bad)
        finally:
            p.unlink()
    result = {'schema': 'upstate.windows-cloud-packing-course/v1', 'host': host,
              'archive': first, 'resume_reused': resumed['reused'], 'members': len(names),
              'relocation_records': len(records), 'source_trees_unchanged': True,
              'received_folder': moved.name, 'namespace_rejections': rejected,
              'writer': api.identity}
    (output / 'result.json').write_text(json.dumps(result, indent=2) + '\n')
    return result


if __name__ == '__main__':
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument('windows_python', type=Path)
    parser.add_argument('output', type=Path)
    args = parser.parse_args()
    print(json.dumps(run(args.windows_python, args.output), indent=2))
