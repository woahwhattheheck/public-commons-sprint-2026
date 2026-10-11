import argparse
import fcntl
import getpass
import json
import os
from pathlib import Path
import stat

from .model import Fault, Workspace
from .server import Server


def password(args):
    if args.password_file:
        path = Path(args.password_file)
        info = path.lstat()
        if not stat.S_ISREG(info.st_mode) or info.st_mode & 0o077 or info.st_size > 2001:
            raise Fault('Use a private regular password file, mode0600, under2001 bytes')
        return path.read_text().rstrip('\n')
    return getpass.getpass('Private operator password: ')


def main():
    parser = argparse.ArgumentParser(description='Original Sumter template authoring and implementation workspace')
    parser.add_argument('--data', default='workspace-data', help='Private workspace directory')
    commands = parser.add_subparsers(dest='command', required=True)
    commands.add_parser('init')
    for command in ('bootstrap', 'reset-access'):
        p = commands.add_parser(command)
        p.add_argument('--name', required=True)
        p.add_argument('--password-file')
    serve = commands.add_parser('serve')
    serve.add_argument('--port', type=int, default=8775)
    serve.add_argument('--origin', help='Exact browser origin when using a local TLS reverse proxy')
    restore = commands.add_parser('restore')
    restore.add_argument('--archive', required=True)
    args = parser.parse_args()
    os.umask(0o077)
    if args.command == 'restore':
        print(json.dumps(Workspace.restore(args.archive, args.data)))
        return
    workspace = Workspace(args.data)
    if args.command == 'init':
        print(json.dumps({'workspace': str(workspace.root), 'next': 'Bootstrap a named administrator, then serve.'}))
    elif args.command == 'bootstrap':
        print(json.dumps(workspace.add_user(None, args.name, 'admin', password(args))))
    elif args.command == 'reset-access':
        workspace.reset_access(args.name, password(args))
        print(json.dumps({'operator': args.name, 'access_reset': True}))
    elif args.command == 'serve':
        with (workspace.root / 'server.lock').open('a') as lease:
            try:
                fcntl.flock(lease.fileno(), fcntl.LOCK_EX | fcntl.LOCK_NB)
            except BlockingIOError as exc:
                raise Fault('This workspace already has a running server') from exc
            origin = args.origin or 'http://127.0.0.1:' + str(args.port)
            server = Server(('127.0.0.1', args.port), workspace, origin)
            print('Template workspace: ' + origin, flush=True)
            try:
                server.serve_forever()
            except KeyboardInterrupt:
                pass
            finally:
                server.server_close()


if __name__ == '__main__':
    try:
        main()
    except Fault as exc:
        raise SystemExit(str(exc))
