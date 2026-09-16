# Security / data questionnaire (pilot carrier)

- Customer data: none. Fixture identities are synthetic and buyer-neutral.
- Network: compiler performs no HTTP. Live Firecrawl/OpenAI/AgentMail/Convex are stop conditions.
- Secrets: none stored. Contact strings and payment links are rejected.
- Retention: caller-supplied integer days on the intake; this carrier does not persist outside create-exclusive local artifacts.
- Access: owner-review files only. No production tenant, no inbound mailbox, no webhook.
- Legal/compliance: explicitly false on the acceptance contract.
