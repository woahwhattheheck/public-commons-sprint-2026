# Signage VPS trial — source-aligned OpenClaw acceptance kit

**Prospect, not an order:** original [James_Nation n8n Jobs post](https://community.n8n.io/t/hiring-openclaw-vps-person-paid-trial-task-ongoing-work-remote-any-timezone/299185), June 12, 2026; thread still received activity on October 10, 2026 but original buyer has not been verified to still be selecting a provider. External outreach is UNSENT; no contract, invoice, or funds are asserted.

The original buyer's first paid assignment is a **buyer-supplied disposable Hetzner Ubuntu 24.04 VPS**, with an exact OpenClaw version, local package manager, non-sudo service user/systemd, key-only SSH, inbound UFW limited to port 22, fail2ban, localhost binding for non-SSH services, monitoring (CrowdSec+Netdata or approved alternatives), 0600 environment file, a working handoff/runbook, and a screen recording. n8n/Telegram/monday.com sign-photo routing is the hiring exercise, **not a deployed integration under this trial**.

## Existing original code

`audit.py` is a small dependency-free **read-only check intended to be run on the buyer's actual VPS**. It uses Python3 and local, read-only Linux commands. It does not contact any remote service, elevate itself, install software, modify config, read environment-file content, read shell history, or transmit host data. It returns a redacted JSON or text acceptance report. A nonzero status indicates a failure (2) or unresolved manual/unknown checks (3); zero requires every check to PASS. `test_audit.py` validates three parser decisions, including public TCP 3000, permissive UFW, and SSH passwords.

```
python3 audit.py --user openclaw --service openclaw.service \
  --workdir /opt/openclaw --version 2026.10.4 \
  --env-file /etc/openclaw/openclaw.env --format json
```

Use the actual agreed application version rather than the illustrative `2026.10.4`. Execute it on **the buyer's disposable host after authorization**, ideally as an operator with sufficient read access to effective SSH/UFW/systemd state; inaccessible checks report UNKNOWN rather than a fictitious PASS. `--workdir` points to the local `package-lock.json`; an unpinned range (`^`, `~`) or mismatched locked version fails. A root-owned 0600 environment file is acceptable because systemd loads it, but the script never opens its contents. Manual inspection is necessary for sudoers override rules, shell-history hygiene, alternate monitoring justification, and the recorded walkthrough.

On a host where systemd commands or `sshd -T` cannot be read, UNKNOWN is expected; do not convert that into PASS. Cloud-container smoke output (`cloud-readonly-observation.json`) is not a customer VPS result; it confirms *the script refuses to call this unrelated container an accepted trial host*. No actual OpenClaw installation or signer credentials were requested or used here.

## Exact acceptance gate

A paid delivery requires the customer's approval of a fixed version and monitoring choice, then a working authorized VPS, a real host audit with no unaddressed FAIL/UNKNOWN, a short operator runbook with update/rollback, a screen-recorded walkthrough, and buyer acceptance. No real paid trial can be invoiced or counted without agreement and delivery.

## Original workflow idea — Telegram photo to Monday job

Preserve Telegram message ID, sender, timestamp and file ID; download the image and store it in durable storage. Require a deterministic job key or explicit operator confirmation against actual Monday.com open jobs. Attach the stored object URL with checksum/event metadata only after a unique job match, make the write idempotent on original message ID, and return a receipt. Ambiguous or unmatched inputs queue for review; do not silently attach a photo to a guessed job.