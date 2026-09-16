# Standalone transport / deployment handoff

This directory is staged inside `woahwhattheheck/public-commons-sprint-2026` because the current GitHub action surface can write existing repositories but cannot create the intended standalone repository.

For the qualified hackathon carrier:

1. Create public repo `woahwhattheheck/permitpulse-all-gas` using an authenticated repo-create path.
2. Copy the contents of this directory to **repository root** without semantic edits. In particular `hackathon.md` must become root `hackathon.md`.
3. Run `npm install` then `npm run verify`.
4. Run `npx convex dev`, set Firecrawl / AgentMail / OpenAI environment variables, and exercise one real source refresh plus one AgentMail inbound event. Record provider receipts; do not relabel fixtures as live proof.
5. Deploy to a judge-open `convex.site` or `chatgpt.site` URL and verify the public UI against the exact source generation.
6. Separately satisfy Luma registration, public build post, <3 minute video and vibeapps submission. Outbound/social actions require single-writer coordination before sending.

No step above is marked complete merely because source exists in this staging repository.
