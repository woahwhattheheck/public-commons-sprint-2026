"""Register the namespaced ensemble feature and preserve concurrent source."""
from __future__ import annotations
import argparse
import ast
import hashlib
import json
from pathlib import Path
import sys
sys.path.insert(0, str(Path(__file__).resolve().parents[1]))

OLD_BLOCK = '\n# ASTRA-ECO12 original-operator ensemble integration\nimport ensemble as _ensemble_extension\n_ensemble_extension.install(sys.modules[__name__])\n\n'
BLOCK = '\n# ASTRA-ECO12-2651 namespaced original-operator integration\nimport paired_ensemble as _paired_ensemble_extension\n_paired_ensemble_extension.install(sys.modules[__name__])\n\n'
OLD_LINK = '<a href="/web/ensemble.html">Paired raster ensembles</a>'
LINK = '<a href="/web/paired_ensemble.html">Paired multi-pollutant ensembles</a>'
LEGACY_SHA256 = {'ENSEMBLES.md': '52a7eb7946cfe355a0b904f4cb26e97ba58c5686897083ed6cefc6dc4c68b9a5', 'checks/ensemble_journey.py': 'f50b842f9472dad5c5a69f731e352247c940ecf2b6cccf6909798c47ff46283b', 'model/ensemble_cli.py': '15cb199b064078a0b3a10c7e2453777a0525a62f057e7c08ae44007fa0058acc', 'model/ensemble_portable.py': '8b5c91b577276702ec212e8ac73c377ab37a53be1de6d2169edf070cb34f1121', 'model/ensemble_rasters.py': 'c8d978bdb493cc6b0e7a51bd668e46fa24b6e2bd24c48c464a72fd2df5709f75', 'model/ensemble_report.py': '6131e80299ddbfc5807527b8ded0f70fbde70be7720aea1586880bcaab278024', 'model/ensemble_store.py': '68b7e3702b376036aa73e146c71904b7de0d97e7460c9781a6c0e65922fe0122', 'model/ensemble_workspace.py': 'e142ea9a8b7f2b545ba982668ceb543aebd23a085995c51ddc67c8a9dee07424', 'operator/ensemble.py': 'd618f6b0272332aa37db9c012abeaf58e7104fe0aeec57fc27942f7fcb28b0b2', 'operator/install_ensemble.py': '87e37a6ec1a0e8be5cde8fb1d080696173eb90cb970713137e798ec4f7268bbc', 'operator/web/ensemble.css': 'b8ac45d687ecd70e5495c2188ad163e1fb8ba7e2d1fea2b477721e3ba96489b3', 'operator/web/ensemble.html': '3dc2df2caeea69d5fe9f026615975e1718011d713ab64d1cb9c71e545f7387c3', 'operator/web/ensemble.mjs': 'e2eed92c2ead0b7fd7f267e2cfde1f3f0d287a47a66e5944a61cfc52d8816ea1', 'requirements-ensemble.txt': '3414c2e9d195e3a76d4bd2c2b17bebfa0053d16f385ee40cd81de7f67de80e66'}


def install(root, integration="auto"):
    root = Path(root).resolve(strict=True)
    application = root.parent
    if integration not in ('auto', 'extensions', 'legacy'):
        raise ValueError('Choose auto, extensions or legacy integration')
    host_present = (root/'extension_registry.py').is_file() and (root/'web'/'extension_host.mjs').is_file()
    mode = ('extensions' if host_present else 'legacy') if integration == 'auto' else integration
    if mode == 'extensions' and not host_present:
        raise ValueError('Receive the original shared extension host before choosing extensions integration')
    manifest_path = root / "extensions" / "paired-ensemble.json"
    parked_path = manifest_path.with_suffix(".json.disabled")
    current_path = manifest_path if manifest_path.is_file() else parked_path
    current = json.loads(current_path.read_text(encoding="utf-8")) if current_path.is_file() else {}
    if mode == "extensions" and current.get("backend", {}).get("module") == "paired_ensemble_service":
        import importlib.util
        helper = root / "integrate_paired_ensemble.py"
        if not helper.is_file():
            raise ValueError("Receive the complete current paired shared-host installer.")
        spec = importlib.util.spec_from_file_location("upstate_paired_shared_join", helper)
        module = importlib.util.module_from_spec(spec)
        spec.loader.exec_module(module)
        if not manifest_path.exists():
            module.atomic(manifest_path, parked_path.read_bytes())
        result = module.integrate(application, apply=True)
        if parked_path.exists() and parked_path.read_bytes() == manifest_path.read_bytes():
            parked_path.unlink()
        return result
    from model.common import atomic_bytes, held
    server, page = root / 'server.py', root / 'web' / 'index.html'
    expected_new = [root/'paired_ensemble.py', root/'web'/'paired_ensemble.html',
                    root/'web'/'paired_ensemble.mjs', root/'web'/'paired_ensemble.css']
    expected_new += [application/'model'/'paired_ensemble'/name for name in
                     ('__init__.py', 'ensemble_cli.py', 'ensemble_portable.py',
                      'ensemble_rasters.py', 'ensemble_report.py', 'ensemble_store.py',
                      'ensemble_workspace.py')]
    expected_new += [root/'paired_ensemble_provider.py', root/'web'/'paired_ensemble_host.mjs', root/'web'/'paired_ensemble_host.css']
    manifest = root/'extensions'/'paired-ensemble.json'
    parked_manifest = manifest.with_suffix('.json.disabled')
    if not manifest.is_file() and not parked_manifest.is_file():
        raise ValueError('Receive the complete original paired-ensemble descriptor')
    if any(not p.is_file() for p in expected_new):
        raise ValueError('Receive the complete namespaced source before registration')
    with held(root / '.paired-ensemble-install.lock', blocking=True):
        earlier = root / "extensions" / "paired-ensembles.json"
        if earlier.exists():
            if earlier.is_symlink() or not earlier.is_file():
                raise ValueError("Choose the original regular paired descriptor.")
            body = earlier.read_bytes()
            expected = "596075c23bece6f7c54569206b04df94f65d897fbe9ddea5ae730cfe45d51f71"
            if hashlib.sha256(body).hexdigest() != expected:
                raise ValueError("Compose the changed earlier plural paired descriptor before migration.")
            backup = application / ".paired-ensemble-source-join" / expected / "operator/extensions/paired-ensembles.json"
            backup.parent.mkdir(parents=True, exist_ok=True)
            if backup.exists() and backup.read_bytes() != body:
                raise ValueError("The retained descriptor preimage differs.")
            if not backup.exists():
                atomic_bytes(backup, body)
            earlier.unlink()
        before = server.read_text(encoding='utf-8')
        html = page.read_text(encoding='utf-8')
        tree = ast.parse(before)
        names = {node.name for node in tree.body if isinstance(node, (ast.FunctionDef, ast.ClassDef))}
        if not {'Operator', 'Handler', 'main'} <= names:
            raise ValueError('Select the maintained original operator/server.py')
        if mode == 'legacy' and '/web/paired_ensemble.html' not in html and OLD_LINK not in html and '</nav>' not in html:
            raise ValueError('Current operator navigation has no supported insertion anchor')
        descriptor_text = (manifest if manifest.is_file() else parked_manifest).read_text(encoding='utf-8')
        descriptor = json.loads(descriptor_text)
        if descriptor.get('id') != 'paired-ensemble' or descriptor.get('backend', {}).get('module') not in ('paired_ensemble_provider', 'paired_ensemble_service'):
            raise ValueError('The paired-ensemble registration belongs to a different implementation')
        if manifest.exists() and parked_manifest.exists() and manifest.read_bytes() != parked_manifest.read_bytes():
            raise ValueError('Active and parked paired descriptors differ; reconcile their source before switching integration')
        # Only exact earlier registrations owned by PR2651 are migrated. The
        # extension mode delegates all dispatch to the installed shared host.
        after = before.replace(OLD_BLOCK, '\n')
        if mode == 'extensions':
            after = after.replace(BLOCK, '\n')
            if '_paired_ensemble_extension.install(sys.modules[__name__])' in after:
                raise ValueError('An edited paired startup registration remains; remove that owned call before enabling the common dispatcher')
            html_after = html.replace(OLD_LINK, '').replace(LINK, '')
        else:
            if '_paired_ensemble_extension.install(sys.modules[__name__])' not in after:
                marker = 'if __name__ == "__main__":'
                if after.count(marker) != 1:
                    raise ValueError('Register paired_ensemble.install after current classes and before main()')
                after = after.replace(marker, BLOCK + marker)
            html_after = html.replace(OLD_LINK, LINK)
            if '/web/paired_ensemble.html' not in html_after:
                html_after = html_after.replace('</nav>', LINK + '</nav>', 1)
        ast.parse(after)
        if after != before:
            atomic_bytes(server, after.encode('utf-8'))
        if html_after != html:
            atomic_bytes(page, html_after.encode('utf-8'))
        # A legacy edition parks only this descriptor so a later shared-host
        # install cannot dispatch the same actions through two providers. Run
        # this idempotent installer again after installing the shared host.
        if mode == 'extensions':
            if not manifest.exists():
                atomic_bytes(manifest, descriptor_text.encode('utf-8'))
            parked_manifest.unlink(missing_ok=True)
        else:
            if not parked_manifest.exists():
                atomic_bytes(parked_manifest, descriptor_text.encode('utf-8'))
            manifest.unlink(missing_ok=True)
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
                'integration': mode,
                'opening_path': 'paired-ensemble view in the existing application' if mode == 'extensions' else '/web/paired_ensemble.html',
                'removed_exact_legacy_files': removed,
                'preserved_differing_peer_files': preserved,
                'preserved_existing_source': True}


if __name__ == '__main__':
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument('--operator', required=True)
    parser.add_argument('--integration', choices=('auto', 'extensions', 'legacy'), default='auto')
    args = parser.parse_args()
    print(json.dumps(install(args.operator, args.integration), indent=2))
