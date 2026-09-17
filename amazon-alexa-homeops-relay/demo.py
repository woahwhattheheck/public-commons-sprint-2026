from core import HomeOpsStore

s = HomeOpsStore()
s.create_issue({"issue_id": "sink-1", "title": "Kitchen faucet leak", "description": "Slow drip observed overnight", "priority": "MEDIUM"})
s.add_evidence({"issue_id": "sink-1", "evidence_id": "photo-note-1", "kind": "MANUAL", "summary": "Leak localized near cartridge", "source": "synthetic-demo"})
s.add_quote({"issue_id": "sink-1", "quote_id": "quote-1", "vendor": "Demo Plumbing", "amount_cents": 12500, "currency": "USD", "scope": "diagnostic + cartridge replacement if approved"})
plan = s.propose_plan({"issue_id": "sink-1", "plan_id": "plan-1", "summary": "Confirm cartridge model before any purchase", "steps": ["Verify model", "Compare quote scope", "Ask owner to approve next step"]})
review = s.review_plan({"plan_id": "plan-1", "decision": "APPROVE", "reviewer": "demo-owner", "note": "Approval is only for compiling an appointment request"})
request = s.request_side_effect({"plan_id": "plan-1", "action_id": "action-1", "kind": "SCHEDULE_VISIT", "summary": "Ask a separate executor to request a diagnostic appointment"})
print("plan authority:", plan["authority"])
print("human review:", review["decision"])
print("side-effect execution_authorized:", request["execution_authorized"])
print("event chain:", s.verify_event_chain())
