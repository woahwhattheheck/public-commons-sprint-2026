"""Compose source refresh into the current complete scientific application."""
from __future__ import annotations
import argparse
import contextlib
import fcntl
import hashlib
import json
import os
from pathlib import Path
import tempfile

FILES = ('model/source_refresh.py', 'model/source_refresh_cli.py',
         'operator/source_refresh.py', 'operator/source_refresh_native.py',
         'operator/source_refresh_server.py', 'operator/web/source-refresh.html',
         'operator/web/source-refresh.mjs', 'operator/web/source-refresh.css',
         'operator/web/source-refresh-nav.css', 'SOURCE_REFRESH.md')
REGISTRATION = ('# Native source-refresh registration. Preserve the original server and queue.\n'
                'from source_refresh_native import install as _install_source_refresh\n'
                '_install_source_refresh(globals())\n\n')
LINK = '    <a class="source-refresh-navigation" href="/source-refresh">Source refresh</a>\n'
STYLE = '<link rel="stylesheet" href="/source-refresh/source-refresh-nav.css">\n'


def compose_server(text):
    if '_install_source_refresh(globals())' in text:
        if 'from source_refresh_native import install as _install_source_refresh' not in text:
            raise ValueError('The existing source-refresh registration uses another binding')
        return text
    anchor = 'if __name__ == "__main__":\n    main()'
    if text.count(anchor) != 1:
        raise ValueError('The current operator entrypoint needs its exact main registration anchor')
    return text.replace(anchor, REGISTRATION + anchor)


def compose_index(text):
    if 'href="/source-refresh"' not in text:
        anchor = '    <button data-view="sources">Original sources</button>\n'
        if text.count(anchor) != 1:
            raise ValueError('The current original-source navigation needs its current composition anchor')
        text = text.replace(anchor, anchor + LINK)
    if STYLE.strip() not in text:
        if text.count('</head>') != 1:
            raise ValueError('The original operator shell needs one head closing tag')
        text = text.replace('</head>', STYLE + '</head>')
    return text


def install(application, source_root=None, *, dry_run=False):
    destination = Path(application).resolve(strict=True)
    source = Path(source_root or Path(__file__).parent).resolve(strict=True)
    pending = []
    for name in FILES:
        incoming = source / name
        body = incoming.read_bytes()
        target = destination / name
        if target.is_symlink(): raise ValueError('Refusing a symbolic link source target: ' + name)
        before = target.read_bytes() if target.exists() else None
        if before != body: pending.append((name, target, before, body))
    for name, compose in (('operator/server.py', compose_server), ('operator/web/index.html', compose_index)):
        target = destination / name
        if target.is_symlink(): raise ValueError('Refusing a symbolic link registration target')
        before = target.read_bytes()
        after = compose(before.decode('utf-8')).encode('utf-8')
        if before != after: pending.append((name, target, before, after))
    # Preflight all source, imports and composition before changing any original file.
    import ast
    for name, target, before, body in pending:
        if name.endswith('.py'): ast.parse(body.decode('utf-8'), filename=name)
        if not target.parent.resolve().is_relative_to(destination):
            raise ValueError('Source target escapes the original application: ' + name)
    changes = [{'path': name, 'bytes':len(body), 'sha256':hashlib.sha256(body).hexdigest()}
               for name, _, _, body in pending]
    if not dry_run:
        fd = os.open(destination / '.source-refresh-install.lock', os.O_CREAT|os.O_RDWR|os.O_NOFOLLOW, 0o600)
        try:
            fcntl.flock(fd, fcntl.LOCK_EX)
            for name, target, before, body in pending:
                actual = target.read_bytes() if target.exists() else None
                if actual != before: raise RuntimeError('Concurrent source changed: ' + name + '; recompose from the current source')
            for name, target, before, body in pending:
                target.parent.mkdir(parents=True, exist_ok=True)
                with tempfile.NamedTemporaryFile(dir=target.parent, prefix='.refresh-install-', delete=False) as out:
                    temp = Path(out.name)
                    out.write(body);out.flush();os.fsync(out.fileno())
                try:
                    os.chmod(temp, target.stat().st_mode & 0o777 if target.exists() else 0o644)
                    actual = target.read_bytes() if target.exists() else None
                    if actual != before: raise RuntimeError('Concurrent source changed before publication: ' + name)
                    os.replace(temp, target)
                finally: temp.unlink(missing_ok=True)
        finally: os.close(fd)
    return {'application':str(destination), 'dry_run':dry_run, 'changed':changes,
            'entrypoint':'operator/server.py', 'page':'/source-refresh'}


def main(argv=None):
    parser=argparse.ArgumentParser(description=__doc__)
    parser.add_argument('--application', required=True)
    parser.add_argument('--source-root')
    parser.add_argument('--dry-run', action='store_true')
    args=parser.parse_args(argv)
    try: result=install(args.application,args.source_root,dry_run=args.dry_run)
    except (OSError,ValueError,RuntimeError) as error:
        parser.exit(1, str(error)+'\n')
    print(json.dumps(result,indent=2))

if __name__ == '__main__':
    main()
