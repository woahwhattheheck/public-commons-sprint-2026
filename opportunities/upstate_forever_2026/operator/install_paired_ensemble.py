"""Register the namespaced ensemble feature and preserve concurrent source."""
from __future__ import annotations
import argparse
import ast
import hashlib
import json
from pathlib import Path
import sys
sys.path.insert(0, str(Path(__file__).resolve().parents[1]))
from model.paired_ensemble.ensemble_store import held
from model.paired_ensemble.ensemble_report import text_file

OLD_BLOCK = '\n# ASTRA-ECO12 original-operator ensemble integration\nimport ensemble as _ensemble_extension\n_ensemble_extension.install(sys.modules[__name__])\n\n'
BLOCK = '\n# ASTRA-ECO12-2651 namespaced original-operator integration\nimport paired_ensemble as _paired_ensemble_extension\n_paired_ensemble_extension.install(sys.modules[__name__])\n\n'
OLD_LINK = '<a href="/web/ensemble.html">Paired raster ensembles</a>'
LINK = '<a href="/web/paired_ensemble.html">Paired multi-pollutant ensembles</a>'
LEGACY_SHA256 = {'ENSEMBLES.md': '52a7eb7946cfe355a0b904f4cb26e97ba58c5686897083ed6cefc6dc4c68b9a5', 'checks/ensemble_journey.py': 'f50b842f9472dad5c5a69f731e352247c940ecf2b6cccf6909798c47ff46283b', 'model/ensemble_cli.py': '15cb199b064078a0b3a10c7e2453777a0525a62f057e7c08ae44007fa0058acc', 'model/ensemble_portable.py': '8b5c91b577276702ec212e8ac73c377ab37a53be1de6d2169edf070cb34f1121', 'model/ensemble_rasters.py': 'c8d978bdb493cc6b0e7a51bd668e46fa24b6e2bd24c48c464a72fd2df5709f75', 'model/ensemble_report.py': '6131e80299ddbfc5807527b8ded0f70fbde70be7720aea1586880bcaab278024', 'model/ensemble_store.py': '68b7e3702b376036aa73e146c71904b7de0d97e7460c9781a6c0e65922fe0122', 'model/ensemble_workspace.py': 'e142ea9a8b7f2b545ba982668ceb543aebd23a085995c51ddc67c8a9dee07424', 'operator/ensemble.py': 'd618f6b0272332aa37db9c012abeaf58e7104fe0aeec57fc27942f7fcb28b0b2', 'operator/install_ensemble.py': '87e37a6ec1a0e8be5cde8fb1d080696173eb90cb970713137e798ec4f7268bbc', 'operator/web/ensemble.css': 'b8ac45d687ecd70e5495c2188ad163e1fb8ba7e2d1fea2b477721e3ba96489b3', 'operator/web/ensemble.html': '3dc2df2caeea69d5fe9f026615975e1718011d713ab64d1cb9c71e545f7387c3', 'operator/web/ensemble.mjs': 'e2eed92c2ead0b7fd7f267e2cfde1f3f0d287a47a66e5944a61cfc52d8816ea1', 'requirements-ensemble.txt': '3414c2e9d195e3a76d4bd2c2b17bebfa0053d16f385ee40cd81de7f67de80e66'}


def install(root):
    root = Path(root).resolve(strict=True)
    application = root.parent
    server, page = root / 'server.py', root / 'web' / 'index.html'
    expected_new = [root/'paired_ensemble.py', root/'web'/'paired_ensemble.html',
                    root/'web'/'paired_ensemble.mjs', root/'web'/'paired_ensemble.css']
    expected_new += [application/'model'/'paired_ensemble'/name for name in
                     ('__init__.py', 'ensemble_cli.py', 'ensemble_portable.py',
                      'ensemble_rasters.py', 'ensemble_report.py', 'ensemble_store.py',
                      'ensemble_workspace.py')]
    if any(not p.is_file() for p in expected_new):
        raise ValueError('Receive the complete namespaced source before registration')
    with held(root / '.paired-ensemble-install.lock', blocking=True):
        before = server.read_text(encoding='utf-8')
        html = page.read_text(encoding='utf-8')
        tree = ast.parse(before)
        names = {node.name for node in tree.body if isinstance(node, (ast.FunctionDef, ast.ClassDef))}
        if not {'Operator', 'Handler', 'main'} <= names:
            raise ValueError('Select the maintained original operator/server.py')
        if '/web/paired_ensemble.html' not in html and OLD_LINK not in html and '</nav>' not in html:
            raise ValueError('Current operator navigation has no supported insertion anchor')
        # Only the exact earlier registration owned by PR2651 is migrated.
        after = before.replace(OLD_BLOCK, '\n')
        if '_paired_ensemble_extension.install(sys.modules[__name__])' not in after:
            marker = 'if __name__ == "__main__":'
            if after.count(marker) != 1:
                raise ValueError('Register paired_ensemble.install after current classes and before main()')
            after = after.replace(marker, BLOCK + marker)
        ast.parse(after)
        html_after = html.replace(OLD_LINK, LINK)
        if '/web/paired_ensemble.html' not in html_after:
            html_after = html_after.replace('</nav>', LINK + '</nav>', 1)
        if after != before:
            text_file(server, after)
        if html_after != html:
            text_file(page, html_after)
        removed, preserved = [], []
        # A different peer edition is never removed, even at a former path.
        for name, expected in LEGACY_SHA256.items():
            path = application / name
            if not path.exists():
                continue
            if path.is_symlink() or not path.is_file():
                preserved.append(name)
                continue
            if hashlib.sha256(path.read_bytes()).hexdigest() == expected:
                path.unlink()
                removed.append(name)
            else:
                preserved.append(name)
        return {'server_sha256': hashlib.sha256(after.encode()).hexdigest(),
                'opening_path': '/web/paired_ensemble.html',
                'removed_exact_legacy_files': removed,
                'preserved_differing_peer_files': preserved,
                'preserved_existing_source': True}


if __name__ == '__main__':
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument('--operator', required=True)
    print(json.dumps(install(parser.parse_args().operator), indent=2))
