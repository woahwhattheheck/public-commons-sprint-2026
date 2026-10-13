"""Read-only build/import readiness for the original InVEST 3.20 Linux sources."""
from __future__ import annotations
import argparse
import importlib.metadata
import json
import os
from pathlib import Path
import re
import shlex
import shutil
import subprocess
import sys

PACKAGES = ('setuptools', 'wheel', 'setuptools_scm', 'Cython', 'numpy', 'GDAL',
            'pygeoprocessing', 'natcap.invest', 'babel', 'certifi', 'pydantic',
            'geometamaker', 'pandas', 'pint', 'taskgraph', 'scipy', 'shapely',
            'rtree', 'importlib_metadata')
PINS = {'ndr': 'f518b2867d4a327675fcb1c9b4ba56f29b12188d',
        'sdr': '0cac27add172011df367ff8026427dbbdbcda5b2'}

def command(argv, *, text=None, output_limit=16000, timeout=30):
    try:
        p = subprocess.run(argv, input=text, text=True, capture_output=True, timeout=timeout)
        return {'ok': p.returncode == 0, 'return_code': p.returncode,
                'stdout': p.stdout[-output_limit:], 'stderr': p.stderr[-output_limit:]}
    except (OSError, subprocess.TimeoutExpired) as e:
        return {'ok': False, 'error': {'type': type(e).__name__, 'message': str(e)}}

def at_least(version, wanted):
    if not version:
        return False
    parts = re.match(r'^(\d+)\.(\d+)(?:\.(\d+))?', version)
    return bool(parts and tuple(int(x or 0) for x in parts.groups()) >= wanted)

def report():
    versions = {}
    for name in PACKAGES:
        try:
            versions[name] = importlib.metadata.version(name)
        except importlib.metadata.PackageNotFoundError:
            versions[name] = None
    out = {'schema': 'upstate.native-build-preflight/v1',
           'python': {'executable': sys.executable, 'version': sys.version.split()[0],
                      'prefix': sys.prefix}, 'versions': versions, 'checks': {},
           'omissions': [], 'native_models_executed': False,
           'network_used': False, 'packages_installed': False}
    checks = out['checks']
    def add(name, ok, detail, scopes, action):
        checks[name] = {'ok': bool(ok), 'detail': detail, 'scopes': scopes}
        if not ok:
            out['omissions'].append({'check': name, 'scopes': scopes, 'action': action})
    add('python_supported', sys.version_info >= (3, 10), sys.version.split()[0],
        ['pygeoprocessing_build', 'invest_build', 'runtime'], 'Use Python >=3.10 for InVEST3.20.')
    for name in ['setuptools','setuptools_scm']:
        add('pygeoprocessing_build_'+name, bool(versions[name]), versions[name],
            ['pygeoprocessing_build'], 'Provide '+name+' in the selected build interpreter.')
    for name, minimum in [('setuptools', (64,0,0)), ('setuptools_scm',(8,0,0)),
                          ('Cython',(3,0,0)), ('numpy',(2,0,0))]:
        add('build_version_'+name, at_least(versions[name],minimum), versions[name],
            ['invest_build'] if name in ('setuptools','setuptools_scm') else ['pygeoprocessing_build','invest_build'],
            'Provide '+name+'>='+'.'.join(map(str,minimum))+' in the selected build interpreter.')
    add('build_wheel', bool(versions['wheel']), versions['wheel'],
        ['pygeoprocessing_build','invest_build'], 'Provide wheel in the selected build interpreter.')
    config = shutil.which('gdal-config')
    details = {'executable': config}
    if config:
        for option in ['--version','--cflags','--libs']:
            details[option] = command([config,option])
    config_ok = bool(config and all(details[k]['ok'] and details[k]['stdout'].strip()
                                    for k in ['--version','--cflags','--libs']))
    add('gdal_build_configuration',config_ok,details,['pygeoprocessing_build','invest_build'],
        'Provide gdal-config, GDAL development headers and the matching link library; osgeo alone is insufficient.')
    try:
        compiler_argv = shlex.split(os.environ.get('CXX','c++'))
    except ValueError:
        compiler_argv = []
    compiler = shutil.which(compiler_argv[0]) if compiler_argv else None
    compile_result = {'executable': compiler, 'arguments': compiler_argv[1:]}
    if compiler and config_ok:
        flags = shlex.split(details['--cflags']['stdout'].strip())
        compile_result['syntax'] = command([compiler,*compiler_argv[1:],'-std=c++20','-fsyntax-only','-x','c++',*flags,'-'],
            text='#include <gdal.h>\n#include <concepts>\nstatic_assert(std::same_as<int,int>);\n')
    add('gdal_headers_cpp20', bool(compile_result.get('syntax',{}).get('ok')),compile_result,
        ['pygeoprocessing_build','invest_build'], 'Provide a C++20 compiler and usable gdal.h include flags. This syntax check does not link a library.')
    pybabel = shutil.which('pybabel')
    add('babel_build_command', bool(pybabel and versions['babel']),
        {'executable':pybabel,'version':versions['babel']},['invest_build'],
        'Provide Babel and its pybabel command on PATH for translation compilation.')
    operations = {
        'gdal_runtime': 'from osgeo import gdal,gdal_array,ogr,osr; print(gdal.VersionInfo("RELEASE_NAME"))',
        'pygeoprocessing_headers': 'import pathlib,pygeoprocessing; p=pathlib.Path(pygeoprocessing.__path__[0])/"extensions"; assert p.is_dir() and any(p.glob("*.h")), str(p); print(p)',
        'pygeoprocessing_routing': 'import pygeoprocessing.routing; print(pygeoprocessing.routing.__file__)',
        'pydantic2_apis': 'from pydantic import AfterValidator,ConfigDict,field_validator,model_serializer,model_validator; print("original spec APIs available")',
        'shapely2_api': 'from shapely.errors import GEOSException; import shapely; print(shapely.__version__)',
    }
    for module in ['setuptools','wheel','setuptools_scm','Cython','numpy']:
        operations['build_import_'+module] = 'import '+module+'; print('+module+'.__file__)'
    for module in ['babel','certifi','geometamaker','pandas','pint','taskgraph','scipy','rtree','importlib_metadata']:
        operations['import_'+module] = 'import '+module+'; print('+module+'.__file__)'
    for name, code in operations.items():
        result = command([sys.executable,'-B','-c',code])
        scopes = ['runtime']
        if name.startswith('build_import_'):
            scopes = ['pygeoprocessing_build','invest_build']
        if name in ['gdal_runtime','pygeoprocessing_headers','import_babel']:
            scopes.append('invest_build')
        add(name,result['ok'],result,scopes,'Resolve this exact import/header exception in the selected interpreter; preserve the original publisher sources.')
    add('invest_version',versions['natcap.invest']=='3.20.0',versions['natcap.invest'],
        ['runtime'],'Install the original natcap.invest3.20.0 distribution before the maintained adapter probe.')
    for model, pin in PINS.items():
        code = ('import importlib,inspect,pathlib,hashlib; m=importlib.import_module("natcap.invest.'+model+'.'+model+'"); '
                'b=pathlib.Path(inspect.getsourcefile(m)).read_bytes(); h=hashlib.sha1(b"blob "+str(len(b)).encode()+b"\\0"+b).hexdigest(); '
                'assert h=="'+pin+'",h; print(h)')
        result = command([sys.executable,'-B','-c',code])
        add('original_'+model+'_load',result['ok'],result,['runtime'],
            'Resolve the complete original '+model.upper()+' import closure and source pin; do not replace it with a reduced model stub.')
    out['build_ready'] = {scope: all(c['ok'] for c in checks.values() if scope in c['scopes'])
                          for scope in ['pygeoprocessing_build','invest_build']}
    out['runtime_ready'] = all(c['ok'] for c in checks.values() if 'runtime' in c['scopes'])
    out['limitations'] = ['Build readiness is a prerequisite check, not a wheel build or linker/ABI guarantee.',
                          'Runtime readiness checks original imports/source pins, not raster round trips or model calculations.',
                          'Use the maintained native-runtime capsule probe before accepting a received environment.']
    return out

def main(argv=None):
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument('--python',help='inspect this actual interpreter via a subprocess')
    parser.add_argument('--output',type=Path,help='write only this requested JSON report')
    args = parser.parse_args(argv)
    if args.python:
        # The selected interpreter performs multiple independently bounded checks.
        # Its outer budget must permit their complete report, including timeouts.
        result = command([args.python,'-B',str(Path(__file__).resolve())],
                         output_limit=1024*1024,timeout=900)
        if not result['ok']:
            parser.error('Selected interpreter preflight failed: '+json.dumps(result))
        data = json.loads(result['stdout'])
    else:
        data = report()
    body = json.dumps(data,indent=2,sort_keys=True,allow_nan=False)+'\n'
    if args.output:
        args.output.parent.mkdir(parents=True,exist_ok=True)
        args.output.write_text(body,encoding='utf-8')
    print(body,end='')
    return 0

if __name__ == '__main__':
    raise SystemExit(main())
