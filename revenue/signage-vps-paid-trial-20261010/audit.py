#!/usr/bin/env python3
"""Read-only, no-dependency Ubuntu/OpenClaw acceptance audit for a buyer-provided trial VPS.

Never prints or reads environment-file contents, private keys, shell histories or tokens.
Never changes host state. Designed to be run on the customer's actual host.
"""
import argparse
import json
from pathlib import Path
import pwd
import re
import stat
import subprocess
import sys


def command(*args):
    try:
        result = subprocess.run(args, capture_output=True, text=True, timeout=6,
                                env={"PATH": "/usr/sbin:/usr/bin:/sbin:/bin", "LC_ALL": "C"})
    except (OSError, subprocess.TimeoutExpired):
        return None
    return result.stdout if result.returncode == 0 else None


def parse_listeners(raw):
    """Return sorted public TCP listener ports, or None if ss was unavailable."""
    if raw is None:
        return None
    ports = []
    for line in raw.splitlines():
        columns = line.split()
        if len(columns) < 4:
            continue
        local = columns[3]
        if ':' not in local:
            continue
        address, port = local.rsplit(':', 1)
        if port.isdigit() and address in ('0.0.0.0', '*', '[::]', '::'):
            ports.append(int(port))
    return sorted(set(ports))


def parse_ufw(raw):
    """True when incoming default-deny and only SSH/22 has public allow rules."""
    if raw is None:
        return None
    if 'Status: active' not in raw:
        return False
    default = re.search(r'^Default:\s*deny\s*\(incoming\)', raw, re.M)
    if not default:
        return False
    for line in raw.splitlines():
        if re.search(r'\bALLOW\s+IN\b', line):
            destination = line.split('ALLOW', 1)[0].strip().split()[0]
            if destination not in ('22', '22/tcp', 'OpenSSH'):
                return False
    return True


def parse_sshd(raw):
    if raw is None:
        return None
    options = dict((parts[0], parts[1]) for line in raw.splitlines()
                   if len(parts := line.split(maxsplit=1)) == 2)
    return (options.get('passwordauthentication') == 'no'
            and options.get('kbdinteractiveauthentication') == 'no'
            and options.get('pubkeyauthentication') == 'yes'
            and options.get('permitrootlogin') == 'no'
            and options.get('port') == '22')


def status_bool(value):
    return 'UNKNOWN' if value is None else ('PASS' if value else 'FAIL')


def audit(args):
    rows = []
    def check(key, value, detail):
        rows.append({'id': key, 'status': status_bool(value), 'detail': detail})

    osrelease = Path('/etc/os-release')
    release = osrelease.read_text(errors='replace') if osrelease.exists() else ''
    check('ubuntu_2404', ('ID=ubuntu' in release and ('VERSION_ID="24.04"' in release or 'VERSION_ID=24.04' in release))
          if release else None, 'Expected Ubuntu 24.04; no machine identity collected')

    try:
        acct = pwd.getpwnam(args.user)
    except KeyError:
        acct = None
    check('dedicated_unprivileged_user', acct.pw_uid > 0 and acct.pw_uid != 65534
          if acct else False, f'Expected dedicated account: {args.user}')
    groupnames = command('id', '-nG', args.user) if acct else None
    check('no_sudo_membership', ('sudo' not in groupnames.split() and 'wheel' not in groupnames.split())
          if groupnames is not None else None, 'No sudo/wheel group membership (other sudoers rules require manual review)')

    svc = command('systemctl', 'show', args.service,
                  '--property=LoadState,ActiveState,User,WorkingDirectory,FragmentPath,DropInPaths,EnvironmentFiles',
                  '--no-pager')
    attrs = dict((x.split('=', 1) for x in svc.splitlines() if '=' in x)) if svc is not None else {}
    check('systemd_running', attrs.get('LoadState') == 'loaded' and attrs.get('ActiveState') == 'active'
          if svc is not None else None, f'Expected active systemd service {args.service}')
    check('service_principal', attrs.get('User') == args.user if svc is not None else None,
          'systemd service must use specified unprivileged account')

    unit_paths = [attrs.get('FragmentPath', '')] + attrs.get('DropInPaths', '').split()
    unit_read = False
    unit_has_inline_env = False
    for filename in unit_paths:
        if filename and Path(filename).is_file():
            try:
                raw = Path(filename).read_text(errors='replace')
                unit_read = True
                unit_has_inline_env |= bool(re.search(r'^\s*Environment\s*=', raw, re.M))
            except OSError:
                pass
    check('no_inline_unit_secrets', not unit_has_inline_env if unit_read else None,
          'No inline Environment= directives in unit/drop-ins; values never printed')

    workdir = args.workdir or attrs.get('WorkingDirectory')
    lock = Path(workdir) / 'package-lock.json' if workdir and Path(workdir).is_absolute() else None
    pin = None
    if lock and lock.is_file():
        try:
            data = json.loads(lock.read_text())
            req = data.get('packages', {}).get('', {}).get('dependencies', {}).get('openclaw')
            ver = data.get('packages', {}).get('node_modules/openclaw', {}).get('version')
            pin = bool(req and re.fullmatch(r'\d+\.\d+\.\d+(?:-[A-Za-z0-9.-]+)?', req)
                       and ver == req and (args.version is None or ver == args.version))
        except (OSError, ValueError, TypeError):
            pin = False
    check('local_exact_version', pin, 'OpenClaw exact semver in local package-lock, matching installed lock entry'
          + (' and expected version' if args.version else ' (pass --version to verify independently)'))

    ssh = command('sshd', '-T')
    check('key_only_ssh', parse_sshd(ssh), 'Effective sshd: key-only, no interactive password/root login, TCP 22')
    fw = command('ufw', 'status', 'verbose')
    check('ufw_ssh_only', parse_ufw(fw), 'UFW enabled; incoming default-deny; public ALLOW only OpenSSH/22')
    binds = parse_listeners(command('ss', '-H', '-lnt'))
    check('public_tcp_only_22', (not (set(binds) - {22})) if binds is not None else None,
          'Detected public TCP ports (do not expose service): ' + (','.join(map(str, binds)) if binds is not None else 'unavailable'))

    for service in ('fail2ban', 'crowdsec', 'netdata'):
        active = command('systemctl', 'is-active', service)
        check(service + '_active', active is not None and active.strip() == 'active'
              if command('systemctl', 'show', service, '--property=LoadState') is not None else None,
              f'{service} service active (monitoring alternative may be documented separately)')

    env_file = Path(args.env_file) if args.env_file else None
    if env_file:
        try:
            mode = stat.S_IMODE(env_file.stat().st_mode)
            check('env_file_0600', mode == 0o600 and env_file.is_file(),
                  'Environment-file mode 0600; file content never read')
        except OSError:
            check('env_file_0600', False, 'Configured env file not found; content never read')
    else:
        check('env_file_0600', None, 'Supply --env-file; file contents never read')

    check('recorded_handoff', None, 'MANUAL: walkthrough video plus working box and owner-friendly runbook')
    check('history_and_sudoers', None, 'MANUAL: verify no secrets in shell history, sudoers or deployment logs')
    totals = {k: sum(c['status'] == k for c in rows) for k in ('PASS', 'FAIL', 'UNKNOWN')}
    return {'schema': 1, 'observed': 'read_only_local_host', 'checks': rows,
            'summary': totals, 'success_requires': 'zero FAIL, resolved UNKNOWN and buyer handoff'}


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument('--user', default='openclaw')
    parser.add_argument('--service', default='openclaw.service')
    parser.add_argument('--workdir', help='Override unit WorkingDirectory for local package-lock')
    parser.add_argument('--version', help='Expected installed exact version, e.g. 2026.10.4')
    parser.add_argument('--env-file', help='Path for mode check; file contents never read')
    parser.add_argument('--format', choices=('json', 'text'), default='text')
    args = parser.parse_args()
    result = audit(args)
    if args.format == 'json':
        print(json.dumps(result, indent=2, sort_keys=True))
    else:
        for item in result['checks']:
            print(f"{item['status']:7s} {item['id']:29s} {item['detail']}")
        print('SUMMARY', result['summary'])
    return 2 if result['summary']['FAIL'] else (3 if result['summary']['UNKNOWN'] else 0)


if __name__ == '__main__':
    sys.exit(main())