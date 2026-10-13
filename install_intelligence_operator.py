#!/usr/bin/env python3
"""Install the owned Investigations operator files into the current shared app."""
from __future__ import annotations
import argparse
import ast
from datetime import datetime, timezone
import fcntl
import hashlib
import json
import os
from pathlib import Path
import shutil
import subprocess
import tempfile

FILES = (
    "SCIENTIFIC_CATALOG.md",
    "install_intelligence.py",
    "install_intelligence_operator.py",
    "model/diagnostics_cli.py",
    "model/experiment_diagnostics.py",
    "operator/DIAGNOSTICS.md",
    "operator/DIAGNOSTICS_RECEIVING.md",
    "operator/DIAGNOSTIC_INVESTIGATION_INTAKE.md",
    "operator/INTELLIGENCE.md",
    "operator/INTELLIGENCE_DIAGNOSTICS.md",
    "operator/diagnostic_investigations_patch.json",
    "operator/experiment_diagnostics.py",
    "operator/extensions/investigations.json",
    "operator/install_diagnostic_investigations.py",
    "operator/install_diagnostics.py",
    "operator/intelligence.py",
    "operator/intelligence_binding.py",
    "operator/intelligence_collections.py",
    "operator/intelligence_diagnostic_entry.py",
    "operator/intelligence_diagnostics.py",
    "operator/requirements-intelligence.txt",
    "operator/science_catalog.py",
    "operator/web/experiment_diagnostics.css",
    "operator/web/experiment_diagnostics.mjs",
    "operator/web/experiments.mjs",
    "operator/web/extension_host.mjs",
    "operator/web/investigations.css",
    "operator/web/investigations.mjs",
    "receiving/eco_intelligence/receive_original_collection.py",
    "requirements-intelligence.txt",
    "science_catalog_delivery.py",
    "source_tools/investigations_composition.py",
)
KNOWN_PREDECESSORS = {
    "SCIENTIFIC_CATALOG.md": [
        "6c27c740eb204a92451369ab440aa91012cef06753df6928005db62b0badc8cf",
        "ef8b5634e9afce9c175096d46137eba9273b95018dfa95c2b278f67a05d58068"
    ],
    "install_intelligence.py": [
        "bab8bfcd3c8e3fde60f7ff66f7108c6bf1dafeadfdd3c64c9b6217ebf58273e8"
    ],
    "install_intelligence_operator.py": [
        "07452e2eb484c2ec76ceebe5a38c1702679e96d06761c07aa58fff0a68f0dd52",
        "17b174dd42cdd4e8f9076139ea7c474099c4e2e991b492fd195aceaded443b0d",
        "1db81965622ea7d852f69dda6cbcf5a18e4c8b27a3c05e67b3c805ed901d2e57",
        "2743529860978faedb87a9d501e0282d21a735df7d33485049d01e428bb7ac04",
        "3aac5a756c793f9e53d0ceabf9ee88d7060e341c2fe07ebcd0810ae7c602ddae",
        "6b027cfaf7ed3a562d3fbbb3736dc8ed0a20c316f8daee38be7fbd5116bd3682",
        "6ed284536d1db9604e7cd41cd2338635fca841c05d552951a6c633c342a9aae1",
        "7894b94a6d54c511aac075e105b67875c25143b30a0c8e9f138ec3a28e24fb01",
        "7bd885c6c978535bec3db7b9b15e6677cd7967db5839ade8e5fc54ef51eb438d",
        "81d65dfe2e8b77492b0453be2baf9cd6a0dc1aa70ad687c372cc1346b13162dc",
        "9876a1e06070591cf0c60d27e98c5cc83ca14cb311ae6901f8204177debb478e",
        "b9d7b44b241fa8ffcdc4cc2f0fd9600581e073c98a46c5f9615b869773dc9a01",
        "bbef76e5db89a991f8bf3a1a5a8741bb67b4a1516f844642aafa1398c3d5aec5",
        "bc50c1aec1a77507abe235a369e94593f97205882b8b11694472dd3b5610e1d8",
        "dc4027036e3143979acc4713cdce3a37e38bbf3c5840adbc5b0d0e2a3b818dff",
        "ed52ceccba5044ccfaf023ec2a47b2f32cb55b511ca2749bf2e9a42255ea9f4b"
    ],
    "model/diagnostics_cli.py": [
        "2e3494a27e0c5ae948ad5075c2c9925fe70ef177e109314245673710c0a6bd56"
    ],
    "model/experiment_diagnostics.py": [
        "8d9a8e56277e7dd8239ffd830fa42c4c65410d9f1a2c31cd6846506205690ccf"
    ],
    "operator/DIAGNOSTICS.md": [
        "ecfbc5e7c2cee90deaaeee1bb306ef532fae9b120b3028aa6932b4fba7443f3b"
    ],
    "operator/DIAGNOSTICS_RECEIVING.md": [
        "a941bf51150caebb1418e918722c18ed66a18a9b9975de9e015f9a894f000dcd"
    ],
    "operator/DIAGNOSTIC_INVESTIGATION_INTAKE.md": [
        "1435e576b32eb2c66eef26b1e434881fc09117063112c3359a64c4a4a3c62b85",
        "8e8bc03649c84aac4656d197170db43d587c589fdd8351665c7abe3afb630130"
    ],
    "operator/INTELLIGENCE.md": [
        "03e04aa86afa9565b54469a6ac0601952e395bfb263d8fcc3cb80cec4a5decf2",
        "1d84d9cfec3dff4153970da02be5acb19f26829d1ef6697cd21e0fbe76c5b4fe",
        "1e382d47d272997664dab55cd0feaee146a558ed9cff285a01c51487d5e11ae6",
        "20b5756eb6aa1ec75137ef3e4f8531726f92d6b838cc70b2d3bf302b9b14a94e",
        "238437c67b2b54631fe5f2da5cbbff167a61f22cd7e30b2da6d12365d1896ff9",
        "287f1761b24c327f6a382aa891f0783a3036bf0bb0d0c43b0e825ecc0cad36aa",
        "2ee26bcf9cde06b04a01430c51d73c04e10d1cf9e536a2147bab8563429d41bc",
        "6b2319ea86c6a58458051f8587dc1a62e876ab80dcf7707dc177109cf3f10584",
        "742b93ae163b313567ae1c84fa669d4252e048ba91792456545a00698145edb7",
        "7f7108911c73abf97e3841d9914aced1867231798300c2853c3677e1702a69e8",
        "994432772d508cc7b7aae0e0d57d667ea53ac563aa0ab62d86359c0b833fd348",
        "ca961a51f141cf75f8bcfb1cfd9ce2c739a233f537a0acbeceddcfe1345e885a",
        "e71e48e3a09505dda5862b217305d13f266b65a96ee44fff5ead9145bffb19fb"
    ],
    "operator/INTELLIGENCE_DIAGNOSTICS.md": [
        "3c9ebd9cbd15a3cbb7b34a464bb1e294eff0340dcbe7590308015658aa793d16",
        "4e3ff6b746f4170e373827dfb508cccb68992ecc0572b19b82290a765b834fb8",
        "7ceb0dc18e19849da9cdaaffe848a1f8ec272b2f458484e87797c8af3b96259f",
        "c2927af494d5c215845ea9306aa197f69f115499fde3889b677585098898f4fc",
        "c66f353d08b32ed5656e12733bcb88697f8848600c938911c1265433396f2b41",
        "f58ac423e35b977cfc66d3b9d5bbaabf855fe5b8508b86a4e3eef62c22289363",
        "fc8721519b77d40fb7020364fb5a77f1d8e5de66bf1a022ceefbdc9fcf03af96"
    ],
    "operator/diagnostic_investigations_patch.json": [
        "1d00639d493fa4463a280d5424ad6bf45eec51d9f8f14adca8b1c87c7bb63ef0",
        "813d099e384821fec074088ece49c3a6d7f26c91fbd9fd590fd50429cc92a82e",
        "fc96878501ee065e6c8b287c21a50c0f2414ad405cf6dee08ce39ce84ae18a6d"
    ],
    "operator/experiment_diagnostics.py": [
        "fd86e59a6223fb0671a5cff79c49a3ee945d4e5b19d3ce934d8b7c2458651d9b"
    ],
    "operator/extensions/investigations.json": [
        "13e05713869e3bf075a943fb337bbc4c789dc33dc113a7be09c9255b3f3c4485",
        "156e78e3c71b3434b46d8a643025bdf63184f7a73fbc4516c90daaa618436de9",
        "21454e5a8cc1cc54d63e78ea41436bc5773bcd581af1e417df197cdd2f56ba5a",
        "21a42c79ab94a5214c2fbe679bb5142218465167d9aefdf2eee47e76c88a14ea",
        "4409ba89d3ba1e3613792b03451567257f27145c0ca1de6aa74b3bcf32eba4c8",
        "52dab3e0958fb17403710d53148e8234be7d060dddff5ce90566301c0938f4ab",
        "74418650a88e51dcfed7ec959c83846e504d6b468f6ef20cd0a68669aa36d3fd"
    ],
    "operator/install_diagnostic_investigations.py": [
        "8a195af996241eebf3ae2130c505676874efb4a5e044cb7936bb6b6532b85e15",
        "e081f35d771681fe3e6c99e9f1f49bbdfb688330ef327552e918969e276c97c5"
    ],
    "operator/install_diagnostics.py": [
        "3a2a458e9e3fd9bc20d8222a8c6fbfcf00b18bade91ceb6b136d3d8be598021f"
    ],
    "operator/intelligence.py": [
        "13a62bb1467352c5dcb1a61a0bd3d8dea0a2bc478be910383fdf0c3f2c845748",
        "1b99431e21436c4e2c2e7b31aa10a0420749079e4a1c0c25a24321b8e51ab914",
        "26a3775a65df019ee6b6123ec6396154446987ba4e58aafba27459464d8b56d4",
        "367f3f8a7f2fff276909ef8d62115f5e02322e33abf44d273ba1d956e57dc418",
        "42ad271c4afff90a30e2c67ad9dec05caa0aaee866418dae0ff3b6c3dbd38bfc",
        "63b34781240cc69ccdf39f053e544b8d5e6ffc72faf3ed673118f96c24dd4be8",
        "6f63aa6ec306d0a0cec1e239b5e8991ef5c43e7ee3f626af210ccbc3892d82cd",
        "7b22c7a13ddd557ea63435f4cbc5ea1da5671e707fd52917946b0744aa7859eb",
        "7df7471c549310483fb5bf9e6a0fcc51dbd53e235e44e490905fea70c9864a85",
        "b7cf75d6fada1774cda5585d585a864e96ec6f19c6d67fad8819456e38057f14",
        "f627ec6c56a5bb3e9b25a6a42c43332940fdfb2853b9e9c71f5b4e80a63d5212",
        "fe8d630d53b0bda2b669d601d443b2a4a29943c9f9c1cfa32429829c3d8663a3"
    ],
    "operator/intelligence_binding.py": [
        "8836235f0562b220d9dc75819557a3dcbaaaeb068b5fb0dd5314fa5f4ac6a208",
        "aeb5db66a6afdcaeec0b3dc6b849d534d5c60d2ee761963de1d4945e87c715a9"
    ],
    "operator/intelligence_collections.py": [
        "47ef83d10f960b9ec0cb514bad6ad02fdc3a634ae9c9a014a21768a9f22e4078",
        "874642385ea5f57ed38544c3f3d86f23f8045c1138c887cd9f169dced97e4c97"
    ],
    "operator/intelligence_diagnostic_entry.py": [
        "7eaa340c76f56f3a0b65dd3fd78d23ec00fffc6aa3a468c5c8314ff074117c80"
    ],
    "operator/intelligence_diagnostics.py": [
        "13dbf42ad2ec912d43b24ce560ce0181923ed3c94e58f1543c52187bcc89c30d",
        "43f147436e36bbd3e3b402e3a7a70a7dc7a8f94c91c7ae9b7392a07e8fdf6c30",
        "b436293365b35083a8b5fadeae4874d9b55d1695ed3b2f143c3a3dfc77f89e5a",
        "eccf406ddd619bd558428806180140b18d8c9d3714dc18af9817139d7e255e41"
    ],
    "operator/requirements-intelligence.txt": [
        "561df37cbe5658556c987ba39479a843aeda129541fc80200adc67762ac7e8e5"
    ],
    "operator/science_catalog.py": [
        "a365baa72d963f0d28757b35e0435daed6aa56e20200015cf41044414860a097"
    ],
    "operator/web/experiment_diagnostics.css": [
        "48de908e717eadcba15942f320ef175d45b02a373870c3fcb885a9aa82184fdf"
    ],
    "operator/web/experiment_diagnostics.mjs": [
        "189771256447919b2ce3b373e09621a16cac62c64d926a298290545275dfb8ec",
        "35551d7953b7abff19f1d6a4dd8a1da5598d13db1bbd5b7ae198d9e669167e85",
        "41d8de2d22e489621c190b8367f30c566ec9e5724f8f53826fea540f1103f78f"
    ],
    "operator/web/experiments.mjs": [
        "04bade7104d2abe1955826729408fbd78c02057e94ed60341e7882465c46b701",
        "7f016b54db84c8575871decf8d27a612cc3b199ae90015ce639f4d1345d477b3",
        "944e4bfaa7e5ca8bd21735219b5d7d7b6885802eebc77bf91458bd075399ba4a"
    ],
    "operator/web/extension_host.mjs": [
        "7a7e0be92b7ec2d44113a0e31febedd3ec39705a5493f951e9ed6dc982bad90c",
        "b439739ad37d5530852421216793947ddff76f04604424e642f05b83cc8af5a4",
        "f3e288e2e7d5137fb617f814b841d8a62a605ae6c2ee62b8d6fe46c9dac6b0bf"
    ],
    "operator/web/investigations.css": [
        "2e0435b852797292c156bebd6d5b9beb5ac786b09c382246cc46b97341284e76",
        "d65d94a33a0733dfe1ac1d5ebfb1379a5f9f25da3a621e6c7a17bbc7fa97dd9c"
    ],
    "operator/web/investigations.mjs": [
        "161d4ad63f80abfbcba08c44eab3f2113e078d1958015d193ae88672a36ef838",
        "30813b0c7056d9add3866af9eed493049d6c4bbb0ac794d510c43f98aba77099",
        "552f04414f38897cd18de20edfef52db273b26c4b9f146c04c3a7e01c276bf01",
        "5c8b8ca56ea078221c9e055e19ff367d666dbfee1807e756f53a0a7918f5d5e4",
        "61f42d7fa3ad630d694c5eaa76ae5a565646ac467c2132c9dbcd5c4d3f595de6",
        "69809eb1615cf5d80751e36796fc28cbfc5da74684b5b267608f2d391d36e76e",
        "7663c32b7137f591a198b7da7546d0577fe379ee67d560ba6c8b04fc8037f507",
        "9c1bfda688a78652b32dd5e490374471c438f0c02d01aefe45195c161f9b8827",
        "b59216b8e9d45425b0600765fcb0b16c23ff37e4ad0f93cbd6c7153513958e34",
        "d0d34115dd81ea652f1bb2e48301058c2a8b7a82b51dfeb9d7253248b2b66e80",
        "f3185bbb01d121c3a0ca2cddade2c9c398631630c407462314f96ad843058364"
    ],
    "receiving/eco_intelligence/receive_original_collection.py": [
        "1a09feb60341acec44079e85908d2335a6c5dc34a99badbcf46fe7b019a9e665",
        "6b55693ad4183a9cae1b14aa3113ad0cef084adff8073b558d45f4a274354c08"
    ],
    "requirements-intelligence.txt": [
        "561df37cbe5658556c987ba39479a843aeda129541fc80200adc67762ac7e8e5"
    ],
    "science_catalog_delivery.py": [
        "44fcbc8f067959d21921cc47ed2e22934d73c33e4c9ddf62f3fcff7a79d5da35",
        "99949cc983eeec8ef13d00f81b8e7eaee4ec18fd3adaa826228e069644a63ab2"
    ],
    "source_tools/investigations_composition.py": [
        "206b958ef5b3a2e07ff29e3164b1c5cec21fa5878548ebd17eb3c5ff5e6c76cf",
        "2db164b250307345fdc296f43af68f15154daa8b936acaf50357077a0daeff7f",
        "35208f70924dd943eb81199310ef26dca8e681892856fc54735cdd31000124a4"
    ]
}
PORTABLE_MARKER = "# A66A complete Investigations and scientific catalog source"

def sha(body):
    return hashlib.sha256(body).hexdigest()

def read(path):
    if path.is_symlink():
        raise ValueError("Choose an original regular source path: " + str(path))
    return path.read_bytes() if path.is_file() else None

def compose_portable_source(body):
    text=body.decode("utf-8")
    block=(PORTABLE_MARKER+"\n"
           'APPLICATION_DIRECTORIES = tuple(dict.fromkeys((*APPLICATION_DIRECTORIES, "eco_intelligence", "ecsa_runs", "integration", "integrations", "tools", "source_tools", "receiving")))\n'
           'APPLICATION_FILES = tuple(dict.fromkeys((*APPLICATION_FILES, "install_intelligence.py", "install_intelligence_operator.py", "requirements-intelligence.txt", "science_catalog_delivery.py", "SCIENTIFIC_CATALOG.md")))\n')
    if block in text:
        return body
    legacy_blocks = (
        block.replace(', "source_tools"', '', 1),
        block.replace('"install_intelligence.py", ', '', 1),
        block.replace(', "source_tools"', '', 1).replace('"install_intelligence.py", ', '', 1),
    )
    for legacy_block in legacy_blocks:
        if legacy_block in text:
            if text.count(legacy_block) != 1:
                raise ValueError("Compose the repeated Investigations archive inventory source.")
            result=text.replace(legacy_block,block,1).encode("utf-8")
            ast.parse(result.decode("utf-8"),filename="model/portable.py")
            return result
    if PORTABLE_MARKER in text:
        raise ValueError("Compose the current Investigations archive inventory source.")
    tree=ast.parse(text,filename="model/portable.py")
    assignments=[node for node in tree.body if isinstance(node,ast.Assign)
                 and any(isinstance(target,ast.Name)
                         and target.id in {"APPLICATION_FILES","APPLICATION_DIRECTORIES"}
                         for target in node.targets)]
    names={target.id for node in assignments for target in node.targets
           if isinstance(target,ast.Name)}
    if not {"APPLICATION_FILES","APPLICATION_DIRECTORIES"} <= names:
        raise ValueError("The original portable application inventory is required.")
    lines=text.splitlines(keepends=True)
    at=max(node.end_lineno for node in assignments)
    lines[at:at]=[block]
    result="".join(lines).encode("utf-8")
    ast.parse(result.decode("utf-8"),filename="model/portable.py")
    return result

def install(application, source_root, dry_run=False):
    application=Path(application).resolve(strict=True)
    source_root=Path(source_root).resolve(strict=True)
    if not (application/"model/workspace.py").is_file() or not (application/"operator/server.py").is_file():
        raise ValueError("Choose the current original scientific application.")
    if not (application/"operator/extension_registry.py").is_file():
        raise ValueError("Receive the current ECSA shared registry with install_extensions.py.")
    if not (application/"eco_intelligence/upstate.py").is_file():
        raise ValueError("Install the complete native component with eco_intelligence/install_upstate.py first.")
    before={};after={}
    for name in FILES:
        content=(source_root/name).read_bytes()
        if name.endswith(".py"):ast.parse(content.decode("utf-8"),filename=name)
        if name.endswith(".json"):json.loads(content)
        before[name]=read(application/name);after[name]=content
        if (name == "operator/web/experiments.mjs" and before[name] is not None
                and before[name] != content
                and sha(before[name]) not in KNOWN_PREDECESSORS.get(name, ())):
            # Preserve a newer original designer through its authored exact joins.
            patch_data = json.loads((source_root / "operator" /
                                     "diagnostic_investigations_patch.json").read_text("utf-8"))
            text = before[name].decode("utf-8")
            for change in patch_data["patches"][name]:
                old, new = change["old"], change["replacement"]
                if new in text:
                    continue
                if text.count(old) != 1:
                    raise ValueError("Compose the current original programme designer before receiving Investigations.")
                text = text.replace(old, new, 1)
            after[name] = text.encode("utf-8")
            continue
        if (before[name] is not None and before[name]!=content
                and sha(before[name]) not in KNOWN_PREDECESSORS.get(name,())):
            raise ValueError("Compose the current owner source before replacing "+name+".")
    portable_name="model/portable.py"
    original_portable=read(application/portable_name)
    if original_portable is None:
        raise ValueError("Receive the original complete Workspace archive implementation.")
    before[portable_name]=original_portable
    after[portable_name]=compose_portable_source(original_portable)
    # Join the original diagnostic button and built-in programme controller in
    # the same source transaction as this complete component.
    import runpy
    composition = runpy.run_path(str(source_root / "source_tools" / "investigations_composition.py"))
    app_name = "operator/web/app.mjs"
    original_app = read(application / app_name)
    if original_app is None:
        raise ValueError("Receive the original authenticated browser application.")
    before[app_name] = original_app
    after[app_name] = composition["patch_app"](
        original_app.decode("utf-8"),
        diagnostics_registered=composition["registered_diagnostics"](application),
    ).encode("utf-8")
    node=shutil.which("node")
    if node:
        with tempfile.TemporaryDirectory(prefix="investigations-source-") as folder:
            script=Path(folder)/"investigations.mjs"
            script.write_bytes(after["operator/web/investigations.mjs"])
            check=subprocess.run([node,"--check",str(script)],capture_output=True,text=True,timeout=45)
            if check.returncode:raise ValueError(check.stderr)
            script=Path(folder)/"experiments.mjs"
            script.write_bytes(after["operator/web/experiments.mjs"])
            check=subprocess.run([node,"--check",str(script)],capture_output=True,text=True,timeout=45)
            if check.returncode:raise ValueError(check.stderr)
            script=Path(folder)/"app.mjs"
            script.write_bytes(after[app_name])
            check=subprocess.run([node,"--check",str(script)],capture_output=True,text=True,timeout=45)
            if check.returncode:raise ValueError(check.stderr)
    changed=[name for name in after if before[name]!=after[name]]
    receipt={"component":"ECO-INTELLIGENCE-HOST-A66A-20261013",
             "application":str(application),"state":"prepared" if dry_run else "current",
             "files":{name:{"bytes":len(after[name]),"sha256":sha(after[name]),
                     "previous_sha256":sha(before[name]) if before[name] is not None else None}
                     for name in changed},
             "javascript":"parsed" if node else "available through original browser receiver",
             "python":"parsed"}
    if dry_run or not changed:return receipt
    lock_path=application/".intelligence-source-install.lock"
    with lock_path.open("a+b") as lock:
        fcntl.flock(lock.fileno(),fcntl.LOCK_EX)
        for name in changed:
            if read(application/name)!=before[name]:
                raise RuntimeError(name+" changed during integration; compose its current owner source.")
        stamp=datetime.now(timezone.utc).strftime("%Y%m%dT%H%M%S.%fZ")
        history=application.parent/(application.name+"-source-history")/("A66A-intelligence-"+stamp)
        history.mkdir(parents=True,exist_ok=False)
        for name in changed:
            if before[name] is not None:
                target=history/name;target.parent.mkdir(parents=True,exist_ok=True);target.write_bytes(before[name])
        (history/"integration.json").write_text(json.dumps(receipt,indent=2)+"\n",encoding="utf-8")
        ordered=[name for name in changed if name!="operator/extensions/investigations.json"]
        if "operator/extensions/investigations.json" in changed:ordered.append("operator/extensions/investigations.json")
        for name in ordered:
            target=application/name;target.parent.mkdir(parents=True,exist_ok=True)
            if read(target)!=before[name]:raise RuntimeError(name+" changed; previous source retained at "+str(history))
            handle,temporary=tempfile.mkstemp(prefix=".investigations-",dir=target.parent)
            pending=Path(temporary)
            try:
                with os.fdopen(handle,"wb") as output:
                    output.write(after[name]);output.flush();os.fsync(output.fileno())
                os.chmod(pending,target.stat().st_mode&0o777 if target.exists() else 0o644)
                os.replace(pending,target)
                fd=os.open(target.parent,os.O_RDONLY|os.O_DIRECTORY)
                try:os.fsync(fd)
                finally:os.close(fd)
            finally:pending.unlink(missing_ok=True)
        receipt.update(state="installed",previous_source=str(history))
        return receipt

def main():
    parser=argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--application",required=True,type=Path)
    parser.add_argument("--source-root",type=Path,default=Path(__file__).resolve().parent)
    parser.add_argument("--dry-run",action="store_true")
    args=parser.parse_args()
    print(json.dumps(install(args.application,args.source_root,args.dry_run),indent=2,allow_nan=False))

if __name__=="__main__":
    main()
