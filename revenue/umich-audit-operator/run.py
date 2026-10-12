#!/usr/bin/env python3
"""Start the complete audit operator or recover an encrypted workspace."""
import argparse
import getpass
import json
import os
from pathlib import Path

def main():
    parser = argparse.ArgumentParser(description="Commons Audit Operator")
    commands = parser.add_subparsers(dest="command", required=True)
    host = commands.add_parser("serve", help="Open the loopback operator interface")
    host.add_argument("--workspace", required=True)
    host.add_argument("--port", type=int, default=0)
    host.add_argument("--listen", default="127.0.0.1", help="IPv4 listener; network binding requires direct TLS")
    host.add_argument("--public-origin", help="Registered HTTPS origin; a reverse proxy must preserve this Host")
    host.add_argument("--tls-cert", help="Direct HTTPS certificate chain")
    host.add_argument("--tls-key", help="Owned private TLS key file")
    host.add_argument("--ready-file")
    host.add_argument("--open", action="store_true")
    recover = commands.add_parser("restore", help="Restore into a new private workspace")
    recover.add_argument("backup")
    recover.add_argument("--destination", required=True)
    recover.add_argument("--passphrase-file", help="An owned private file; otherwise prompt securely")
    args = parser.parse_args()
    os.umask(0o077)
    if args.command == "serve":
        from audit_operator.host import serve
        serve(args.workspace, args.port, args.ready_file, args.open,
              listen=args.listen, public_origin=args.public_origin, tls_cert=args.tls_cert, tls_key=args.tls_key)
    else:
        from audit_operator.archive import restore_backup
        from audit_operator.store import private_bytes
        phrase = (private_bytes(Path(args.passphrase_file), 4096).decode().rstrip("\r\n")
                  if args.passphrase_file else getpass.getpass("Backup passphrase: "))
        result = restore_backup(Path(args.backup).read_bytes(), phrase, args.destination)
        print(json.dumps(result, indent=2))

if __name__ == "__main__":
    main()
