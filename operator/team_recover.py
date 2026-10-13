"""Rotate named access after a stopped installation is recovered or transferred."""
from __future__ import annotations
import argparse
from pathlib import Path
import secrets
import sys
sys.path.insert(0, str(Path(__file__).resolve().parents[1]))
from model.common import held, now, read_json
from team_access import TeamAccess, secret_hash

def main():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--operator-state", required=True)
    args = parser.parse_args()
    root = Path(args.operator_state).resolve(strict=True)
    if not (root / "team-access.json").is_file():
        parser.error("Choose the existing installation team registry.")
    class RecoveryFault(Exception):
        def __init__(self, code, message, status=422):
            super().__init__(message)
    with held(root / ".operator.lock", blocking=False):
        registry = read_json(root / "workspaces.json")
        team = TeamAccess(root, RecoveryFault, lambda: registry.keys())
        current = team.data
        people = {}
        for key, row in current["staff"].items():
            people[key] = {**row, "credential_hash": secret_hash(secrets.token_urlsafe(36)),
                           "credential_version": row["credential_version"] + 1,
                           "updated_at": now()}
        team.data = {**current, "installation_id": secrets.token_hex(16),
                     "revision": current["revision"] + 1, "staff": people}
        team._save(team.path, team.data)
        team.record("installation.recovered", principal=team.owner(),
                    detail={"retained_people": len(people)})
        print("Retained named people, project grants and activity. All prior named access links are invalid.")
        print("Start the original operator, open its new local startup link, and replace each person's access link.")

if __name__ == "__main__":
    main()
