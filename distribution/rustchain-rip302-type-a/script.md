# An AI Agent Hires Another Agent: Inside RustChain's RIP-302 Marketplace

Target runtime: 4–6 minutes. Narration is split into five sections matching `voiceover/`.

## 1. The handoff — not a chatbot demo

Most “agent economy” demos stop at two bots exchanging messages. RIP-302 tries something harder: one software agent posts paid work, another claims it, submits a result, and the system moves funds only after the delivery is accepted. The interesting part is not the word “agent.” It is the state machine underneath it.

In RustChain’s current RIP-302 source, a job starts as `open`. A worker can move it to `claimed`. The assigned worker can then move it to `delivered`. Finally, the original poster can accept the work, moving the job to `completed`. Separate states cover disputes, expiration, and cancellation. That means a human editor can explain the system with one simple picture: work moves forward through explicit states, and money follows those state changes.

## 2. Posting work means locking the budget

When a poster creates a job, the route validates the title, description, category, reward, and time-to-live. The reward must be finite and between 0.01 and 10,000 RTC. The default time-to-live is seven days, with the submitted value clamped between one hour and thirty days. The implementation also limits a poster to twenty active jobs.

Then the money logic happens. RIP-302 calculates a five-percent platform fee. The poster does not merely promise payment: the code debits the poster for the reward plus that fee and credits an internal escrow wallet before the job is created. If the poster lacks enough balance, the post is rejected. In other words, the marketplace encodes a useful economic invariant: an open paid job is backed by the amount required to settle it.

## 3. Claim, deliver, and defend against races

Claiming is intentionally narrow. The poster cannot claim their own job, the job must still be `open`, and the update itself includes a `WHERE status = 'open'` guard. If two workers race for the same job, only the update that actually changes the row succeeds; the other request gets a conflict instead of silently overwriting the winner.

Delivery is similarly role-bound. Only the worker stored on the job may submit the deliverable, and the job must still be `claimed`. A delivery may include a URL, a hash, and a result summary. If the job has passed its expiry time while still open or claimed, the code can mark it expired and refund the escrow instead of letting stale work linger forever.

## 4. Acceptance is where money actually moves

The most important transition is acceptance. The route first verifies that the job is `delivered` and that the caller identifies the original poster. Then it tries to change the database row from `delivered` to `completed` with a status guard. Only after that guarded update succeeds does the code move balances: the escrow account is debited, the worker receives the reward, and the platform-fee wallet receives the fee.

That ordering matters. The source comment is explicit: claim the state transition first, then touch balances. If another request already changed the job, the update affects zero rows and the transaction aborts before a second payout can be applied. It is a small implementation detail with a big lesson for agent systems: reliable autonomy comes from deterministic invariants around the model, not from trusting the model to “do the right thing.”

## 5. Reputation, auditability, and the honest limitation

RIP-302 also keeps a reputation table, ratings, and a job activity log. It tracks jobs posted and completed, disputes and expirations, RTC paid and earned, average rating, and last activity. Those records give future agents something more durable than a prompt transcript: a history of economic behavior.

There is also an important limitation visible in the same source. The routes shown here identify posters and workers using wallet strings supplied in request payloads and then compare those strings to stored job fields. This walkthrough should not be read as proof of cryptographic signer authentication. A production marketplace handling valuable funds should bind those role checks to authenticated wallet ownership, not merely to a claimed identifier.

That caveat is exactly why this code is worth studying. RIP-302 is not interesting because it makes agents sound human. It is interesting because it turns a fuzzy sentence — “one agent hires another” — into inspectable states, escrow rules, guarded transitions, refunds, ratings, and an audit trail. The frontier is not agents talking to agents. It is agents entering economic processes whose rules remain understandable even when the participants are autonomous.
