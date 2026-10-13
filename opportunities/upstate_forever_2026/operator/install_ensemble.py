"""Register the ensemble extension in the original operator, preserving all edits."""
from __future__ import annotations
import ast
import hashlib
from pathlib import Path
import argparse
import sys
sys.path.insert(0, str(Path(__file__).resolve().parents[1]))
from model.ensemble_store import held
from model.ensemble_report import text_file

BLOCK = '\n# ASTRA-ECO12 original-operator ensemble integration\nimport ensemble as _ensemble_extension\n_ensemble_extension.install(sys.modules[__name__])\n\n'
LINK = '<a href="/web/ensemble.html">Paired raster ensembles</a>'


def install(root):
    root = Path(root).resolve(strict=True)
    server = root / 'server.py'
    page = root / 'web' / 'index.html'
    with held(root / '.ensemble-install.lock', blocking=True):
        html = page.read_text(encoding='utf-8')
        if '/web/ensemble.html' not in html and '</nav>' not in html:
            raise ValueError('Add the ensemble link to the current navigation; the installer could not locate it')
        before = server.read_text(encoding='utf-8')
        tree = ast.parse(before)
        names = {node.name for node in tree.body if isinstance(node, (ast.FunctionDef, ast.ClassDef))}
        if not {'Operator', 'Handler', 'main'} <= names:
            raise ValueError('Select the maintained original operator/server.py')
        marker = 'if __name__ == "__main__":'
        if '_ensemble_extension.install(sys.modules[__name__])' not in before:
            if before.count(marker) != 1:
                raise ValueError('The startup marker changed; register ensemble.install after the current classes and before main()')
            after = before.replace(marker, BLOCK + marker)
            ast.parse(after)
            text_file(server, after)
        else:
            after = before
        html = page.read_text(encoding='utf-8')
        if '/web/ensemble.html' not in html:
            if '</nav>' not in html:
                raise ValueError('Add the ensemble link to the current navigation; the installer could not locate it')
            text_file(page, html.replace('</nav>', LINK + '</nav>', 1))
        return {'server_sha256': hashlib.sha256(after.encode()).hexdigest(),
                'opening_path': '/web/ensemble.html', 'preserved_existing_source': True}


if __name__ == '__main__':
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument('--operator', required=True)
    print(install(parser.parse_args().operator))
