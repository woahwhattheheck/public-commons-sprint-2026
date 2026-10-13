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
    "operator/intelligence.py",
    "operator/intelligence_collections.py",
    "operator/web/investigations.mjs",
    "operator/web/investigations.css",
    "operator/extensions/investigations.json",
    "operator/INTELLIGENCE.md",
    "install_intelligence_operator.py",
    "operator/intelligence_diagnostics.py",
    "operator/intelligence_diagnostic_entry.py",
    "operator/install_diagnostic_investigations.py",
    "operator/diagnostic_investigations_patch.json",
    "eco_intelligence/study_transfer.py",
    "operator/INTELLIGENCE_DIAGNOSTICS.md",
    "operator/science_catalog.py",
    "science_catalog_delivery.py",
    "SCIENTIFIC_CATALOG.md",
    "requirements-intelligence.txt",
)
KNOWN_PREDECESSORS = {
    "eco_intelligence/study_transfer.py": [
        "78e1b69a6cdb0cab5142e36c4990954e091b3919471f6ec5ffaeee355ebe9d79",
        "d982ef3dd57768ec5bcda0e8e712816fb6b4693d49f003fcb2d659a02fd7ac7a",
        "71d850483ef4be2f905fd68f88c62a22b507b380162287a9f259dbcc5cf85b54",
        "248485dd4f4bcac3e7b803714da6783bd176c47a2ebc653e8d8064b9f68985e3",
        "62d88703212ebc52aaa9c8bec332d6f6d142f9fce9bcc76ababdf0ca7ae04dfd"
    ],
    "requirements-intelligence.txt": [
        "561df37cbe5658556c987ba39479a843aeda129541fc80200adc67762ac7e8e5"
    ],
    "operator/intelligence.py": [
        "7b22c7a13ddd557ea63435f4cbc5ea1da5671e707fd52917946b0744aa7859eb",
        "63b34781240cc69ccdf39f053e544b8d5e6ffc72faf3ed673118f96c24dd4be8",
        "367f3f8a7f2fff276909ef8d62115f5e02322e33abf44d273ba1d956e57dc418",
        "13a62bb1467352c5dcb1a61a0bd3d8dea0a2bc478be910383fdf0c3f2c845748"
    ],
    "operator/web/investigations.mjs": [
        "30813b0c7056d9add3866af9eed493049d6c4bbb0ac794d510c43f98aba77099",
        "d0d34115dd81ea652f1bb2e48301058c2a8b7a82b51dfeb9d7253248b2b66e80",
        "9c1bfda688a78652b32dd5e490374471c438f0c02d01aefe45195c161f9b8827"
    ],
    "operator/web/investigations.css": [
        "d65d94a33a0733dfe1ac1d5ebfb1379a5f9f25da3a621e6c7a17bbc7fa97dd9c",
        "2e0435b852797292c156bebd6d5b9beb5ac786b09c382246cc46b97341284e76"
    ],
    "operator/extensions/investigations.json": [
        "21454e5a8cc1cc54d63e78ea41436bc5773bcd581af1e417df197cdd2f56ba5a",
        "156e78e3c71b3434b46d8a643025bdf63184f7a73fbc4516c90daaa618436de9",
        "52dab3e0958fb17403710d53148e8234be7d060dddff5ce90566301c0938f4ab"
    ],
    "operator/INTELLIGENCE.md": [
        "238437c67b2b54631fe5f2da5cbbff167a61f22cd7e30b2da6d12365d1896ff9",
        "287f1761b24c327f6a382aa891f0783a3036bf0bb0d0c43b0e825ecc0cad36aa",
        "1e382d47d272997664dab55cd0feaee146a558ed9cff285a01c51487d5e11ae6",
        "03e04aa86afa9565b54469a6ac0601952e395bfb263d8fcc3cb80cec4a5decf2"
    ],
    "install_intelligence_operator.py": [
        "3aac5a756c793f9e53d0ceabf9ee88d7060e341c2fe07ebcd0810ae7c602ddae",
        "1db81965622ea7d852f69dda6cbcf5a18e4c8b27a3c05e67b3c805ed901d2e57",
        "17b174dd42cdd4e8f9076139ea7c474099c4e2e991b492fd195aceaded443b0d"
    ],
    "operator/intelligence_diagnostics.py": [
        "13dbf42ad2ec912d43b24ce560ce0181923ed3c94e58f1543c52187bcc89c30d"
    ],
    "operator/INTELLIGENCE_DIAGNOSTICS.md": [
        "c66f353d08b32ed5656e12733bcb88697f8848600c938911c1265433396f2b41"
    ],
    "science_catalog_delivery.py": [
        "44fcbc8f067959d21921cc47ed2e22934d73c33e4c9ddf62f3fcff7a79d5da35"
    ],
    "SCIENTIFIC_CATALOG.md": [
        "ef8b5634e9afce9c175096d46137eba9273b95018dfa95c2b278f67a05d58068"
    ],
    "operator/science_catalog.py": [
        "a365baa72d963f0d28757b35e0435daed6aa56e20200015cf41044414860a097"
    ],
    "operator/intelligence_collections.py": [
        "47ef83d10f960b9ec0cb514bad6ad02fdc3a634ae9c9a014a21768a9f22e4078",
        "874642385ea5f57ed38544c3f3d86f23f8045c1138c887cd9f169dced97e4c97"
    ]
}
# Retain the current source-collection owner's exact predecessor when composing.
for _path, _digest in {
    "operator/intelligence.py": "42ad271c4afff90a30e2c67ad9dec05caa0aaee866418dae0ff3b6c3dbd38bfc",
    "operator/extensions/investigations.json": "74418650a88e51dcfed7ec959c83846e504d6b468f6ef20cd0a68669aa36d3fd",
    "install_intelligence_operator.py": "7894b94a6d54c511aac075e105b67875c25143b30a0c8e9f138ec3a28e24fb01",
    "operator/INTELLIGENCE_DIAGNOSTICS.md": "3c9ebd9cbd15a3cbb7b34a464bb1e294eff0340dcbe7590308015658aa793d16",
    "operator/intelligence_diagnostics.py": "b436293365b35083a8b5fadeae4874d9b55d1695ed3b2f143c3a3dfc77f89e5a"
}.items():
    KNOWN_PREDECESSORS.setdefault(_path, []).append(_digest)
KNOWN_PREDECESSORS.setdefault("operator/INTELLIGENCE_DIAGNOSTICS.md", []).append(
    "f58ac423e35b977cfc66d3b9d5bbaabf855fe5b8508b86a4e3eef62c22289363")

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
           'APPLICATION_DIRECTORIES = tuple(dict.fromkeys((*APPLICATION_DIRECTORIES, "eco_intelligence", "ecsa_runs", "integration", "integrations", "tools", "receiving")))\n'
           'APPLICATION_FILES = tuple(dict.fromkeys((*APPLICATION_FILES, "install_intelligence_operator.py", "requirements-intelligence.txt", "science_catalog_delivery.py", "SCIENTIFIC_CATALOG.md")))\n')
    if block in text:
        return body
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
        if (before[name] is not None and before[name]!=content
                and sha(before[name]) not in KNOWN_PREDECESSORS.get(name,())):
            raise ValueError("Compose the current owner source before replacing "+name+".")
    portable_name="model/portable.py"
    original_portable=read(application/portable_name)
    if original_portable is None:
        raise ValueError("Receive the original complete Workspace archive implementation.")
    before[portable_name]=original_portable
    after[portable_name]=compose_portable_source(original_portable)
    node=shutil.which("node")
    if node:
        with tempfile.TemporaryDirectory(prefix="investigations-source-") as folder:
            script=Path(folder)/"investigations.mjs"
            script.write_bytes(after["operator/web/investigations.mjs"])
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
