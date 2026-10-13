"""Install or update source editions and land-cover changes in the retained application."""
from __future__ import annotations
import argparse
import ast
import fcntl
import hashlib
import json
import os
from pathlib import Path
import tempfile

START = "# BEGIN UPPER SAVANNAH SOURCE REFRESH"
END = "# END UPPER SAVANNAH SOURCE REFRESH"
BOOT = '''
# BEGIN UPPER SAVANNAH SOURCE REFRESH
import importlib.util as _upstate_refresh_import
_upstate_refresh_spec = _upstate_refresh_import.spec_from_file_location(
    "upstate_operator_source_refresh", Path(__file__).resolve().parent / "source_refresh.py")
_upstate_refresh_module = _upstate_refresh_import.module_from_spec(_upstate_refresh_spec)
_upstate_refresh_spec.loader.exec_module(_upstate_refresh_module)
_upstate_refresh_module.install(globals())
# END UPPER SAVANNAH SOURCE REFRESH

'''
NAV = '<script type="module" src="/web/source-refresh-nav.mjs"></script>'
FILES = (
    "model/source_refresh_report_source.py",
    "model/source_refresh_report_transfer.py",
    "model/source_refresh_comparison.py",
    "source_tools/receive_source_refresh_report.py",
    "docs/source-refresh-scientific-report.md",
    "source/source-refresh-report-integration.json",
    "model/source_refresh.py",
    "model/source_refresh_cli.py",
    "model/source_refresh_compat.py",
    "model/source_refresh_legacy.py",
    "model/source_refresh_legacy_cli.py",
    "model/source_refresh_receiving.py",
    "source/run_source_updates_browser.mjs",
    "source_tools/landcover_change.py",
    "operator/source_refresh.py",
    "operator/source_refresh_legacy.py",
    "operator/source_refresh_native.py",
    "operator/source_refresh_server.py",
    "operator/web/source-refresh.html",
    "operator/web/source-refresh.mjs",
    "operator/web/source-refresh-nav.mjs",
    "operator/web/source-refresh.css",
    "operator/web/source-refresh-legacy/source-refresh.html",
    "operator/web/source-refresh-legacy/source-refresh.mjs",
    "operator/web/source-refresh-legacy/source-refresh.css",
    "operator/web/source-refresh-legacy/source-refresh-nav.css",
    "operator/SOURCE_UPDATES.md",
    "source/landcover-change/METHOD.md",
    "docs/source-refresh.md",
    "docs/source-refresh-compatibility.md",
    "SOURCE_REFRESH.md",
    "install_source_refresh.py",
    "operator/install_source_refresh.py",
    "operator/extensions/source-updates.json",
)
# Exact byte identities from the complete source banks already delivered.
KNOWN_RELEASES = {
    "model/source_refresh.py": [
        "3e6c89916d90faa7d9a1d2b584ebb8559b3c80cc6dd1834c18cdeb9b16807690",
        "45ffa005526147e9b7d82de695724697d93fa044fe718c5f18f8195f09fdc893",
        "0d5c82011c23a6ddd0f2e1b2560d938a10babda51f8a48eb3b21203e01d1f12b",
        "57c45e6d341370109e154bfe382844316d75f29f1c13535062d5a67c025dd559",
        "5c2fae7ab68c48ae8108efbd0735133070815654e494981a9496d8c9c25e5862",
        "eddb911a423838aa2b91db159af773f29f7fdb4f63ca1dc42b1b4f33b7f310ef",
        "492e943128f78f5789f0e21ec1e31ead5c31190dd1db0291a89c88fe8b12754e",
        "31e9450d6170a3099f5df6d543a72be3a87ca29aed7c130aba6e2ad1cff60cf9"
    ],
    "model/source_refresh_cli.py": [
        "96118eaaa41b9f213746024d6d13035b95ccd1a24a0af1bbe88c8b1a796e37d3",
        "59084a5a125313fd3b892eef58630ca298d1d8a95193c977e76e691fbc8196d5",
        "3972e333aa9b7943d2e24b9ef392d1987c3c2f76d5eabeec00271f8b78213936"
    ],
    "source_tools/landcover_change.py": [
        "bed7e6bea0279590f588602ec48c22433647e4dd79d89dba23ad34c614e844ce"
    ],
    "operator/source_refresh.py": [
        "e5cd190efb4d4cd0d0ae58d3b7aebbf979de1252ef81fb189932e491cc4ec088",
        "d193a9b58f0a3fefc2d1c44265e2a88dee0ba58650926fe830a2824d2089d22f",
        "71901ef2b72892a2407d74c4db2a44dc15e82f42f07a0824156d8c47149fb958",
        "10c286cb8d859ee608d44a62ae81552cc4c624c4dd3aca2b1c7117366ec94f78",
        "803ec50452ae0e91cd57c01aac09e10ea5ef6a0dec90f783e00e3930c95030d4",
        "f9c08a33ce9d08f596baaa55cf909d6c58014123b5f6b7717adcedd5a3800d13",
        "f7d6be944852ba2e617a55128bfb59b743094fec7e557ad364224c1f5c0fe185"
    ],
    "operator/web/source-refresh.html": [
        "dd609cbd1a5e9a6ad8bcf4180aaa4714d93936e3f42cc7aa7e4f5da361537e3f",
        "9de35568bb92a9fe93519e93b92faa01b6fd0ed821d6d9e31c717aa7bf31ab7c",
        "8f0a8720078f313872b03f20353d9f74e095ca4940a2504e1735b1c3abb26f0e",
        "ab79d4564f94af8ce583e426b56b17ac19a5e35462da7fa60a5180eaf01a171e",
        "4974ebe5fefe218fa90149e05b0c4489d30d1b450c997558a5b54e688554fff2",
        "c08f6119a48daee6d8789d3b95fa436584f18af02d39a6b9399d887ee910646e"
    ],
    "operator/web/source-refresh.mjs": [
        "e323aaa2fc0f1f486365e2adc12944f21852577656a3d09fb28d4dd8be5074bd",
        "365be8d3fc138cd8d811e0cf8fcdcb95c9f9c996cb5c25d9b891c5adc81f568e",
        "85dd8178ba2727cc69ef6c8a5bc0271783c30ce37966a5f0f87fe7583e2d6d94",
        "58dcacb2ad0d5aa24beea7afd9cee9b7835fc8c11a32dad479614335300a27a7",
        "881fd5317b1fb556461af1484704540c2ef0116294031e47006ad6657a483cb1",
        "74c939685ae1d6abb32918932345101bb878c01dab44be1eed98940c6532781c",
        "956a8fd908495b37915674713f7c1f88fdecfacc3dd0b9388041ae688e168275",
        "70a3965275d657bb214efdadf50437ce2d28f9018dccdfbd8009c52cd6109602",
        "0b48617a0f116749427dbac229db25bd347090af0f62ebbb32621b4d33c91d14",
        "9f0cdc095be184390a145ab92654e08194925c2e4e92e73d9cefe8d5af443c15"
    ],
    "operator/web/source-refresh-nav.mjs": [
        "5b5413232748ed4aeb70bb0b31d6b8e3f0308ed92eec642b5199f67c177c3f70",
        "867978365d539c45228deea9710c999ae9704044254583c900699ae8a73f9b7a"
    ],
    "operator/web/source-refresh.css": [
        "29a58735f106345e81ff9b34a5e0967ee3966ef9fd56ca63348be20571dec1f1",
        "0de91406a57c6efb8d4ba40c36f6ac7d91356c1cc01bf9e3c79ce57b9d84a5ea",
        "7f60d9e886ae06382d0e518c54734c24c4e30430656517c30d62f5715919eb3e"
    ],
    "operator/SOURCE_UPDATES.md": [
        "aaf32d8b96304e644f787d18f386a0814875fb29730abd70da12ca864e72ef2d",
        "170a91e1a909d0304069dd9a719ef08c58f38f32ad93d60eb736367fbb42639b",
        "d5638a7ea89219c4465e19f18fdf54e393557ccaed96471720e62bca3d4c4d78",
        "3320a1abddc882ac10534c7139430f52e98e5cbab11132b3a82fa7d05af0e19e",
        "a601dda094dd0841016cf5d4835a055e7da3b910583deb61361ebec21d942cfc",
        "1054da9af879eb2f75f0886dd11524f15022c024bff5ef9eac5406124676894c",
        "915587db87612a08b9a7c72e61c0c23b8f6e74f47a4f5d9dd00ddfa86a5bc7e2",
        "68de10652357116be30f68648666b0dace95c57d748cc48c03d9a4d5eafa836d",
        "4eb5077fc8d2f3ff2ac7c03ddee80b6a7cd430067dfd402ac00824e0c3527632",
        "332c27845dcaab3d33057f32a59db0beafbe2e1307de380e51e2987447439635",
        "496f51a9ae16c9baccd10f3158c4936b55ac5969b9283043aec00550ffa19757"
    ],
    "source/landcover-change/METHOD.md": [
        "38939f8077422e6210b8d2f31739962fc3160a9a65cbfe031f0e3c914d17931c"
    ],
    "docs/source-refresh.md": [
        "8194acdc5268a6d4c9c1a6c0e3ce589a8921301546b07d1167282624a98f5bea",
        "4a1ae982564d6c9f86a2863f310e18137898b68666a5d76308323b5596c22444",
        "924fe97b8a187b5099d7e4289874ae89b83fdf33f84009ade26dc56a08d85a02",
        "f7acd72e10b3986682c3dbb4617d629cb7586eaaacc159b6134ca4763f4ced1a"
    ],
    "operator/install_source_refresh.py": [
        "5aad31dd33de34ff99157f0f484554005873dc23d07f41721050663aaf24dd13",
        "5253c8230ade1a76d4722cfc3fe945b361624e333bf35ecc26f0b560f290ca39",
        "048f71a23119e5b8852bc1fb4c674ad771f8ff9198c08e9414c583b1facef841",
        "57fb0ee006ee3e718bd17feb3de0613aebc8d2734dc4f98c76c7e71879747545",
        "05b9e89c91a03435b166bd1cbcb296221d4792b37d41f941f269a6cf7310417f",
        "0d52c8a0dc0993e454ea50264e399b7dc1aebbabde938e9715bc8d1553714385",
        "167ac16828dfad3609fc4e9b51c55a85076d2748db67f591ab83e462974b8b61",
        "0d48e7a3946e4ea46e7d7c2e490f878990ca6bf0adf90b49096ff43dcf7231db",
        "d7ae653f0cabeb5d158d8b53d6f709208bf61f4a8fdca56f2cfebfe0d61a64c9",
        "9869caa49556e1c834a7d82cbefaffcaeded17bad4291b616858a79a9ddf6579",
        "f1d0039af54c066eabc57103efd55e7eea9c6444bce443569d2e7e3b01ab893c"
    ],
    "operator/extensions/source-updates.json": [
        "c849509ff20f8c6959fc8b9687dcd99a8f5f782a61e7cc306342e412fbf955c5",
        "4e92f023a4a6b6de1710186a4bd8bab62e06701c35fe3c5f2fdd208c0558c669",
        "952bdc1e7a021678ab8db367c19ef755b47c7a40f4a430a93d68f862f6a83285"
    ],
    "operator/source_refresh_native.py": [
        "7c619c771fa584568ecf9ea68a9227bd7594ab9fa90f65bb3f753cb0f9acb6da"
    ],
    "operator/source_refresh_server.py": [
        "c0b853e75cc9e858d00d3352e1121619441493485adfea8b84f3c3a3714f0a48"
    ],
    "SOURCE_REFRESH.md": [
        "6cfded328d17b8684ea3c9bbb7bc6f40c014c36b08580d244f0b0506126c6c77"
    ],
    "install_source_refresh.py": [
        "5aad31dd33de34ff99157f0f484554005873dc23d07f41721050663aaf24dd13",
        "5253c8230ade1a76d4722cfc3fe945b361624e333bf35ecc26f0b560f290ca39",
        "689226ec18f615ee4ada207b59dd2b1c9f05975be6a2ca0286b213adfac9126c",
        "048f71a23119e5b8852bc1fb4c674ad771f8ff9198c08e9414c583b1facef841",
        "57fb0ee006ee3e718bd17feb3de0613aebc8d2734dc4f98c76c7e71879747545",
        "05b9e89c91a03435b166bd1cbcb296221d4792b37d41f941f269a6cf7310417f",
        "0d52c8a0dc0993e454ea50264e399b7dc1aebbabde938e9715bc8d1553714385",
        "167ac16828dfad3609fc4e9b51c55a85076d2748db67f591ab83e462974b8b61",
        "0d48e7a3946e4ea46e7d7c2e490f878990ca6bf0adf90b49096ff43dcf7231db",
        "d7ae653f0cabeb5d158d8b53d6f709208bf61f4a8fdca56f2cfebfe0d61a64c9",
        "9869caa49556e1c834a7d82cbefaffcaeded17bad4291b616858a79a9ddf6579",
        "f1d0039af54c066eabc57103efd55e7eea9c6444bce443569d2e7e3b01ab893c"
    ],
    "model/source_refresh_compat.py": [
        "cf775aa3c318ab2f9ae7b1432faa932f57303f754f44d0cc6cc50ce939932de4"
    ],
    "model/source_refresh_legacy.py": [
        "eddb911a423838aa2b91db159af773f29f7fdb4f63ca1dc42b1b4f33b7f310ef"
    ],
    "model/source_refresh_legacy_cli.py": [
        "59084a5a125313fd3b892eef58630ca298d1d8a95193c977e76e691fbc8196d5"
    ],
    "operator/source_refresh_legacy.py": [
        "9060fa2d033c88f59b6674c2cdc08ab6d99895530ac32f7a508b3d355556e056",
        "8c1d10c96566752ddde72c11e64bc09df8ceaa5d10d18805c4ef65ce0e861ddf",
        "63daebbd8deb6faa4b0f219e4949fbd437b85e4de377d625da5558e58f928b5f"
    ],
    "operator/web/source-refresh-legacy/source-refresh.html": [
        "ab79d4564f94af8ce583e426b56b17ac19a5e35462da7fa60a5180eaf01a171e"
    ],
    "operator/web/source-refresh-legacy/source-refresh.mjs": [
        "74c939685ae1d6abb32918932345101bb878c01dab44be1eed98940c6532781c",
        "b7559b98370916d7b638b99f5b7b2982fc438af714c1f3d2a43da35d4eb48099"
    ],
    "operator/web/source-refresh-legacy/source-refresh.css": [
        "7f60d9e886ae06382d0e518c54734c24c4e30430656517c30d62f5715919eb3e"
    ],
    "operator/web/source-refresh-legacy/source-refresh-nav.css": [
        "08d39dd1b5165733005ae946cc895e81ed7ca461e126c4c4d80673ecac39a540"
    ],
    "docs/source-refresh-compatibility.md": [
        "e7add31bcf296b06a80fe1fa936b37c62cc7bce3ed5449be9357997900137547",
        "4698277a21b8bf0044bc5335964d94e6d8847e6627f0133e5668012cfedaf705"
    ],
    "source/run_source_updates_browser.mjs": [
        "6ffef03aa727a72914bf9675dc901c672c21c90e3ecf1250b3268dee27a27ea8",
        "c7539ecd51d357ebbce9b644c4f036267538fcefc804de3a8572db294a56f728",
        "b02a987d3fe10b223c5f16dc4992aca7dd4660a4d517e3e7f943bc9ed70d12b5",
        "7075a3f001ab280bffed8be5cc4822029856f25136c4d5c631f98d47ecdca9a1"
    ],
    "model/source_refresh_receiving.py": [
        "83e88d5c6ca62843716a4cba3cfa3272060b9a815f98b10396ba7ed5ab575d8c"
    ],
    "docs/source-refresh-scientific-report.md": [
        "cb9b2a9388dc6bb3dd5bd00a8644e2e140709cd140149fb9045c5f218057a345"
    ]
}
STATE_SCHEMA = "upstate.source-refresh-install/v2"

# Retain the class-based source-refresh transport for existing links and clients.
REGISTRATION = ('# Native source-refresh registration. Preserve the original server and queue.\n'
                'from source_refresh_native import install as _install_source_refresh\n'
                '_install_source_refresh(globals())\n\n')
LEGACY_LINK = '    <a class="source-refresh-navigation" href="/source-refresh">Source refresh</a>\n'
LEGACY_STYLE = '<link rel="stylesheet" href="/source-refresh/source-refresh-nav.css">\n'

def compose_server(text):
    """Cumulative install hook; preserve both source-refresh client contracts."""
    registry = ("from extension_registry import ExtensionRegistry" in text
                and "self.extensions = ExtensionRegistry(" in text)
    if START in text:
        if text.count(START) != 1 or text.count(END) != 1:
            raise ValueError("The source-update launcher occurs more than once")
        begin, end = text.index(START), text.index(END) + len(END)
        if text[begin:end] != BOOT.strip():
            raise ValueError("Compose the independently edited source-update launcher first")
        if registry:
            text = text[:begin] + text[end:]
    elif not registry:
        marker = 'if __name__ == "__main__":'
        if END in text or text.count(marker) != 1:
            raise ValueError("Select the current original operator entrypoint")
        text = text.replace(marker, BOOT + marker)
    if '_install_source_refresh(globals())' not in text:
        marker = 'if __name__ == "__main__":'
        if text.count(marker) != 1:
            raise ValueError("Select the current original operator entrypoint")
        text = text.replace(marker, REGISTRATION + marker)
    elif 'from source_refresh_native import install as _install_source_refresh' not in text:
        raise ValueError("The existing source-refresh registration uses another binding")
    ast.parse(text, filename="operator/server.py")
    return text

def compose_index(text, registry=True):
    """One main desk; saved external /source-refresh links remain available."""
    text = text.replace(LEGACY_LINK, "").replace(LEGACY_STYLE, "")
    if registry:
        return text.replace(NAV + "\n", "").replace(NAV, "")
    if NAV not in text:
        if text.count("</head>") != 1:
            raise ValueError("The operator page needs its current head")
        text = text.replace("</head>", NAV + "\n</head>")
    return text


def sha(body):
    return hashlib.sha256(body).hexdigest()

def json_bytes(value):
    return (json.dumps(value, indent=2, sort_keys=True) + "\n").encode("utf-8")

def target_path(application, relative):
    path = application / relative
    if not path.parent.resolve().is_relative_to(application) or path.is_symlink():
        raise ValueError("Source-update path must remain in the retained application: " + relative)
    if path.exists() and not path.is_file():
        raise ValueError("Select a regular application file: " + relative)
    return path

def atomic(path, body, expected):
    path.parent.mkdir(parents=True, exist_ok=True)
    if path.is_symlink():
        raise ValueError("Select a regular application file: " + str(path))
    observed = path.read_bytes() if path.exists() else None
    if observed != expected:
        raise ValueError("A colleague changed this file during installation: " + str(path))
    if observed == body:
        return
    fd, name = tempfile.mkstemp(prefix=".source-update-", dir=path.parent)
    try:
        with os.fdopen(fd, "wb") as stream:
            stream.write(body)
            stream.flush()
            os.fsync(stream.fileno())
        os.chmod(name, 0o644)
        observed = path.read_bytes() if path.exists() else None
        if observed != expected or path.is_symlink():
            raise ValueError("Application source changed before replacement: " + str(path))
        os.replace(name, path)
    finally:
        if os.path.exists(name):
            os.unlink(name)

def state(path):
    raw = path.read_bytes() if path.exists() else None
    if raw is None:
        return None, {}
    value = json.loads(raw)
    if not isinstance(value, dict) or value.get("schema") != STATE_SCHEMA:
        raise ValueError("The existing source-update installation journal has a different format")
    hashes = {}
    for item in value.get("files", []):
        if not isinstance(item, dict):
            raise ValueError("The source-update installation journal has an invalid file row")
        relative, digest = item.get("path"), item.get("sha256")
        if relative in FILES:
            if not isinstance(digest, str) or len(digest) != 64 or any(c not in "0123456789abcdef" for c in digest):
                raise ValueError("The source-update installation journal has an invalid content identity")
            hashes[relative] = digest
    return raw, hashes

REPORT_CONSUMER_JOINS = [
    {
        "path": "model/native_versions.py",
        "before": "    from .model_selection import common_comparison_outputs\n    if (comparison.get(\"schema\")",
        "after": "    from .model_selection import common_comparison_outputs\n    if \"source_refresh_context\" in comparison:\n        from .source_refresh_comparison import validate\n        return validate(workspace, comparison, expected_id=expected_id)\n    if (comparison.get(\"schema\")"
    },
    {
        "path": "model/scientific_report_study_transfer.py",
        "before": "    from . import chemistry_study_transfer\n    chemistry_study_transfer.include_source(closure, collection_id, entry)\n",
        "after": "    from . import chemistry_study_transfer\n    chemistry_study_transfer.include_source(closure, collection_id, entry)\n    from . import source_refresh_report_transfer\n    source_refresh_report_transfer.include_source(closure, collection_id, entry)\n"
    },
    {
        "path": "model/study_transfer.py",
        "before": "    for relative in chemistry_transfer.lock_paths(closure):\n",
        "after": "    from . import source_refresh_report_transfer\n    for relative in (*chemistry_transfer.lock_paths(closure),\n                     *source_refresh_report_transfer.lock_paths(closure)):\n"
    }
]


def compose_report_consumer(text, row):
    before, after = row["before"], row["after"]
    if text.count(after) == 1:
        return text
    if text.count(before) != 1:
        raise ValueError("Compose the advancing report consumer's exact source-update join: " + row["path"])
    result = text.replace(before, after)
    ast.parse(result, filename=row["path"])
    return result


def _install(application, source, integration, dry_run=False):
    server = target_path(application, "operator/server.py")
    index = target_path(application, "operator/web/index.html")
    if not (application / "model/workspace.py").is_file() or not server.is_file() or not index.is_file():
        raise ValueError("Select the original Upper Savannah scientific application root")
    current_path = target_path(application, "source/source-refresh-install/current.json")
    intent_path = target_path(application, "source/source-refresh-install/pending.json")
    current_bytes, previous = state(current_path)
    old_intent, interrupted = state(intent_path)

    pre_server, pre_index = server.read_bytes(), index.read_bytes()
    text = pre_server.decode("utf-8")
    marker = 'if __name__ == "__main__":'
    registry_available = ("from extension_registry import ExtensionRegistry" in text
                          and "self.extensions = ExtensionRegistry(" in text)
    if integration == "registry" and not registry_available:
        raise ValueError("Install the current cumulative extension host before selecting registry integration")
    if integration == "standalone" and registry_available:
        raise ValueError("The current application uses the extension registry; select auto or registry integration")
    registry = registry_available
    patched_server = compose_server(text).encode("utf-8")
    html = compose_index(pre_index.decode("utf-8"), registry)

    pending = []
    for relative in FILES:
        member = source / relative
        if relative == "operator/install_source_refresh.py" and (source / "install_source_refresh.py").is_file():
            member = source / "install_source_refresh.py"
        body = member.read_bytes()
        target = target_path(application, relative)
        expected = target.read_bytes() if target.exists() else None
        permitted = set(KNOWN_RELEASES.get(relative, ()))
        permitted.update(x for x in (previous.get(relative), interrupted.get(relative)) if x)
        if expected is not None and expected != body and sha(expected) not in permitted:
            raise ValueError("This source-update file contains independent edits; compose them with the received source before installation: " + relative)
        if relative.endswith(".py"):
            ast.parse(body.decode("utf-8"), filename=relative)
        pending.append((target, body, expected))
    # Compose only the declared source-update hooks in advancing shared owners.
    for row in REPORT_CONSUMER_JOINS:
        target = target_path(application, row["path"])
        expected = target.read_bytes()
        body = compose_report_consumer(expected.decode("utf-8"), row).encode("utf-8")
        pending.append((target, body, expected))
    pending.extend(((server, patched_server, pre_server), (index, html.encode("utf-8"), pre_index)))
    # Implementation modules precede entrypoints; the descriptor is published last.
    def publication_order(item):
        relative = item[0].relative_to(application).as_posix()
        if relative == "operator/extensions/source-updates.json":
            return 100
        if relative in {"operator/server.py", "operator/web/index.html"}:
            return 90
        return 10 if relative.startswith("model/") else 20
    pending.sort(key=publication_order)
    if current_bytes is not None and old_intent is None and all(expected == body for _, body, expected in pending):
        receipt = json.loads(current_bytes)
        print(json.dumps(receipt, indent=2))
        return receipt
    predecessors = [{"path":str(path.relative_to(application)),
                     "sha256":sha(expected) if expected is not None else None}
                    for path, body, expected in pending if expected != body]
    preimage_id = sha(json_bytes(predecessors))
    receipt = {"schema":STATE_SCHEMA, "application":str(application),
               "preimage_id":preimage_id, "predecessors":predecessors,
               "opening_route":"/web/source-refresh.html",
               "integration":"registry" if registry else "standalone",
               "view_id":"source-updates" if registry else None,
               "files":[{"path":str(path.relative_to(application)), "bytes":len(body), "sha256":sha(body)}
                        for path, body, _ in pending]}
    if dry_run:
        return {**receipt, "state":"preview", "dry_run":True}
    for path, body, expected in pending:
        if expected is None or expected == body:
            continue
        relative = str(path.relative_to(application))
        saved = target_path(application, "source/source-refresh-install/preimages/" + preimage_id + "/" + relative)
        existing = saved.read_bytes() if saved.exists() else None
        if existing is not None and existing != expected:
            raise ValueError("The retained installation predecessor differs: " + relative)
        atomic(saved, expected, existing)

    # This intent makes every partially installed version recognizable on resume.
    intent_bytes = json_bytes({**receipt, "state":"installing"})
    atomic(intent_path, intent_bytes, old_intent)
    for path, body, expected in pending:
        atomic(path, body, expected)
    atomic(current_path, json_bytes({**receipt, "state":"complete"}), current_bytes)
    if intent_path.read_bytes() != intent_bytes:
        raise ValueError("The installation intent changed before completion")
    intent_path.unlink()
    print(json.dumps(receipt, indent=2))
    return receipt

def install(application, source=None, integration="auto", *, source_root=None, dry_run=False):
    application = Path(application).resolve(strict=True)
    if source is not None and source_root is not None and Path(source).resolve() != Path(source_root).resolve():
        raise ValueError("Choose one source-update source root")
    source = Path(source or source_root or __file__).resolve()
    source = source if source.is_dir() else source.parent
    if not (source / "model/source_refresh.py").is_file() and (source.parent / "model/source_refresh.py").is_file():
        source = source.parent
    if dry_run:
        return _install(application, source, integration, dry_run=True)
    shared = target_path(application, ".locks/extension-install.lock")
    shared.parent.mkdir(parents=True, exist_ok=True)
    shared_fd = os.open(shared, os.O_CREAT | os.O_RDWR | os.O_NOFOLLOW, 0o600)
    try:
        fcntl.flock(shared_fd, fcntl.LOCK_EX)
        lock = target_path(application, "source/source-refresh-install/.install.lock")
        lock.parent.mkdir(parents=True, exist_ok=True)
        fd = os.open(lock, os.O_CREAT | os.O_RDWR | os.O_NOFOLLOW, 0o600)
        try:
            fcntl.flock(fd, fcntl.LOCK_EX)
            return _install(application, source, integration)
        finally:
            os.close(fd)
    finally:
        os.close(shared_fd)

def main():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--application", required=True, help="Original scientific application root")
    parser.add_argument("--source", "--source-root", dest="source", help="Directory containing the received source-update files")
    parser.add_argument("--dry-run", action="store_true", help="Show the complete installation without changing files")
    parser.add_argument("--integration", choices=("auto", "registry", "standalone"), default="auto",
                        help="Use the current cumulative registry when present")
    args = parser.parse_args()
    result = install(args.application, args.source, args.integration, dry_run=args.dry_run)
    if args.dry_run:
        print(json.dumps(result, indent=2))

if __name__ == "__main__":
    main()
