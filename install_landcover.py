#!/usr/bin/env python3
"""Install the original operator extension; upgrade only this author's known files."""
from __future__ import annotations
import argparse
import fcntl
import hashlib
import json
import os
from pathlib import Path
import tempfile

FILES = (
    'model/landcover_ledger.py', 'model/landcover_exports.py',
    'model/landcover_cli.py', 'model/landcover_report.html',
    'model/landcover_workspace.py', 'model/landcover_source_inputs.py', 'operator/landcover_operator.py',
    'operator/extensions/landcover-ledger.json',
    'operator/web/landcover_ledger.mjs', 'operator/web/landcover_ledger.css',
    'LANDCOVER_LEDGER.md', 'requirements-landcover.txt',
    'integration/component_fragments/landcover-source-inputs.json',
    'model/landcover_report_source.py', 'model/landcover_report_source_cli.py',
    'model/LANDCOVER_REPORT_SOURCE.md', 'model/landcover_study_transfer.py',
    'model/landcover_report_figures.py', 'model/LANDCOVER_REPORT_FIGURES.md',
    'integration/component_fragments/landcover-scientific-report.json',
)
PREVIOUS = {"LANDCOVER_LEDGER.md":["28a3ab97562d7a458a3ce282cd94106be0ba5d1f820d478319ebfed94915903f","9165f370cbd5a1740a664606511bf7812da55c15c5c0fe08cf35122b2e0534ae","27a90e70a1174778db7d40c5813a92b09e6e830d7c983655075655e053fa3aef","116eadd53a399480aeac43568a89fce5db23ad04a7e10b3a152ddc2c5a5f57ab"],"model/landcover_cli.py":["4fc00002e79544af7ab67a33495b4beb9ac62f1699cc89f2367d04ca6fd3fb56"],"model/landcover_exports.py":["30ea2cb7a6f519413c36ba50ac59739ace469657d6e4138a969e63bee1f046a1"],"model/landcover_ledger.py":["9379ffcc02a5f06d6c5821fba0a8f29212016d24353d679e09f3a045571db3af"],"model/landcover_report.html":["aa226597d6602b42dc56d25ec3ebace42d85204281deffcd54c86e12c42f2a7b","30c76c87e101ded466d9f28ddf84ea17fa2ef01861e6b0265db8f57bde38cde7","4f9a2569ced3920bce3a1f4e357118126f1f483ab67cf041eda82cd95023ee73"],"requirements-landcover.txt":["c35ffccd091d801f55a9a28b281bb58ad44882beb5cfd79b57e1e473677a5556","133147dea55de8a73167c74d703f5273766f7aecb0ae1c4458bb21dfe7da5547"],"operator/landcover_operator.py":["654396195c27f25cd8e9910f0cc3f5d593c34f6012bb6899b41ef4e8b34caef8","ef07c80a5a45c3528b165c3a2ac4d06a9caaa86225bd80b83373f5f3e56e3127","d1f8b086a58a90c98d1efbf79d00c49f1bdad04b85746b62f8488f1535a318e2"],"model/landcover_workspace.py":["1ce0eef5826263224b1032a3727d40c777879a24a7dcb0f3c07b25e9bb0ba389"],"operator/web/landcover_ledger.mjs":["6ee795a115b43adf32e77e4cc1fc0aea7d644f13aa4a68caf653c9eb7f446921","23312a76f41bc50e4f5894af11fb84f19d4dee4f637529596d56350d323eb3ab","06a18cf5254f410df6f331d7a70458d709ffba13fe5e89b11e107ce54e2ed0f4"],"operator/web/landcover_ledger.css":["f6670c1788f33df0ee1c9f53d97539f581a25c265cb4dc92220f1c6bacc54453"],"operator/extensions/landcover-ledger.json":["649977914a5eb508e8daf82990065847ef04552a7c64e6b6f23cedffbb48cd5d","29bb8b111624c4247e3fdb14033c5f56ec8f44b759ba931dd447100f01a07e5b","4933380da84181f221708841a52365617d5650a6959038bdc3db84ebcb5859d4"],"model/LANDCOVER_REPORT_SOURCE.md":["f1f6361c8236905d431dc8c34a2ca161ac11be3e985628a282d8b290ae664e00","c02a6d65bd4b649987dd6f02ef2ecf3f1c14f13da399b64f68d02460a7632bcb"],"integration/component_fragments/landcover-scientific-report.json":["010e828e5764353ab2dfb960893025e1c5a65ca0ef60008ee6a62fa318d56f51","c790ee9d2f555ecfa0bcd016fe0cdc7f54058080a49bddad35715b7f4295a6d5"],"model/landcover_report_source.py":["2337bb50d1b66f18b068cc9d7c95e7a25476e3dfa1226fbfadf05aa549d23b51"]}


def install(destination: Path) -> dict:
    root = destination.expanduser().resolve(strict=True)
    if not (root / 'model').is_dir():
        raise ValueError('Destination must be the existing application with a model/ directory')
    bundle = Path(__file__).resolve().parent
    with (root / '.landcover-install.lock').open('a') as lock:
        fcntl.flock(lock.fileno(), fcntl.LOCK_EX)
        pending, existing, inventory = [], [], []
        for name in FILES:
            target = root / name
            if not target.resolve().is_relative_to(root) or target.is_symlink():
                raise ValueError(f'Target escapes the original application: {name}')
            data = (bundle / name).read_bytes()
            previous = None
            if target.exists():
                previous = target.read_bytes()
                if previous == data:
                    existing.append(name)
                elif hashlib.sha256(previous).hexdigest() in PREVIOUS.get(name, ()):
                    pending.append((target, data, previous))
                else:
                    raise ValueError(f'Differing existing source: {name}; reconcile the actual current file')
            else:
                pending.append((target, data, None))
            inventory.append({'path': name, 'bytes': len(data), 'sha256': hashlib.sha256(data).hexdigest()})
        # Extend the current Team policy instead of replacing another desk's routes.
        policy_path = root / 'operator/team_route_policy.json'
        if policy_path.exists():
            if policy_path.is_symlink() or not policy_path.resolve().is_relative_to(root):
                raise ValueError('Team route policy escapes the original application')
            previous = policy_path.read_bytes()
            policy = json.loads(previous)
            routes = policy.get('safeViewerPosts')
            if not isinstance(routes, list) or any(not isinstance(row, str) for row in routes):
                raise ValueError('Retain the original Team safeViewerPosts list')
            route = '/api/landcover-ledger/inputs'
            if route not in routes:
                policy['safeViewerPosts'] = sorted([*routes, route])
                data = (json.dumps(policy, indent=2, ensure_ascii=False) + '\n').encode('utf-8')
                pending.append((policy_path, data, previous))
            else:
                data = previous
                existing.append('operator/team_route_policy.json')
            inventory.append({'path': 'operator/team_route_policy.json', 'bytes': len(data),
                              'sha256': hashlib.sha256(data).hexdigest()})
        for target, data, previous in pending:
            target.parent.mkdir(parents=True, exist_ok=True)
            if not target.parent.resolve().is_relative_to(root) or target.is_symlink():
                raise ValueError('Concurrent target directory changed')
            temporary = None
            try:
                with tempfile.NamedTemporaryFile(dir=target.parent, prefix='.landcover-source-', delete=False) as out:
                    temporary = Path(out.name)
                    out.write(data); out.flush(); os.fsync(out.fileno())
                if previous is None:
                    try:
                        os.link(temporary, target)
                    except FileExistsError:
                        if target.read_bytes() != data:
                            raise ValueError(f'Concurrent differing publication: {target.relative_to(root)}')
                else:
                    if target.read_bytes() != previous:
                        raise ValueError(f'Concurrent differing publication: {target.relative_to(root)}')
                    os.replace(temporary, target)
            finally:
                if temporary is not None:
                    temporary.unlink(missing_ok=True)
        return {'application': str(root), 'version': '1.3.2',
                'added': [str(p.relative_to(root)) for p, _, old in pending if old is None],
                'upgraded': [str(p.relative_to(root)) for p, _, old in pending if old is not None],
                'reused': existing, 'files': inventory}


if __name__ == '__main__':
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument('application', type=Path)
    args = parser.parse_args()
    try:
        print(json.dumps(install(args.application), indent=2))
    except (ValueError, OSError) as exc:
        parser.exit(2, f'Land-cover installation: {exc}\n')
