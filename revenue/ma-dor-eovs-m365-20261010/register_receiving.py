#!/usr/bin/env python3
"""Complete typed-register migration, independent recipient continuation and full return."""
from __future__ import annotations

from case_receiving import Receiving, main
from migration_reports import register_records

SCHEMA = "commons.register-migration-receiving/v1"

class RegisterReceiving(Receiving):
    schema = SCHEMA
    phases = ("01-original-input", "02-original-register-actions", "03-complete-reports",
              "04-producer-delivery", "05-customer-receive", "06-customer-actions",
              "07-older-receiving-replay", "08-customer-return", "09-return-reopen",
              "10-original-request-replay")
    kinds = ("dataset", "plan", "rehearsal", "review", "cutover")
    allowed = {"source.import", "register.dataset.create", "register.plan.create",
               "register.rehearsal.create", "register.review.create",
               "register.cutover.create", "workspace.update"}
    domain = "register"
    catalog_key = "register_entities"
    records = staticmethod(register_records)
    meaning = ("Supplied original register mappings, independent target observations, "
               "exact control totals, reviewed findings and complete customer continuation.")

if __name__ == "__main__":
    raise SystemExit(main(RegisterReceiving))
