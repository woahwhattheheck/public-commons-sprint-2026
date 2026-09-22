CREATE TABLE lane_locks (
  collision_key TEXT PRIMARY KEY
);

CREATE TABLE lanes (
  collision_key TEXT PRIMARY KEY,
  lane_id TEXT NOT NULL UNIQUE CHECK (lane_id ~ '^[a-z0-9][a-z0-9._:-]{0,119}$'),
  org TEXT NOT NULL,
  domain TEXT NOT NULL,
  purpose TEXT NOT NULL,
  opportunity TEXT NOT NULL,
  state TEXT NOT NULL CHECK (state IN ('CLEAR','LEASED','HARD_DNR','DEAD_ROUTE','HUMAN_EVENT_REOPEN','HOLD')),
  holder TEXT,
  leased_route TEXT,
  lease_until TIMESTAMPTZ,
  reopen_from_state TEXT CHECK (reopen_from_state IS NULL OR reopen_from_state IN ('HARD_DNR','DEAD_ROUTE','HOLD')),
  reopen_from_route TEXT,
  version BIGINT NOT NULL DEFAULT 0 CHECK (version >= 0),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT clock_timestamp(),
  CHECK ((state = 'LEASED') = (holder IS NOT NULL AND lease_until IS NOT NULL)),
  CHECK (reopen_from_state IS NULL OR state IN ('HUMAN_EVENT_REOPEN','LEASED'))
);

CREATE TABLE workspace_identifiers (
  identifier TEXT PRIMARY KEY,
  kind TEXT NOT NULL CHECK (kind IN ('event','provider','human')),
  created_at TIMESTAMPTZ NOT NULL DEFAULT clock_timestamp()
);

CREATE TABLE events (
  seq BIGSERIAL PRIMARY KEY,
  event_id TEXT NOT NULL UNIQUE REFERENCES workspace_identifiers(identifier),
  collision_key TEXT NOT NULL REFERENCES lanes(collision_key),
  occurred_at TIMESTAMPTZ NOT NULL,
  kind TEXT NOT NULL CHECK (kind IN ('CLAIM','SENT','BOUNCE','HUMAN_EVENT','HOLD')),
  actor TEXT NOT NULL,
  event_route TEXT NOT NULL,
  reason TEXT NOT NULL,
  lease_seconds INTEGER CHECK (lease_seconds IS NULL OR lease_seconds BETWEEN 30 AND 1800),
  provider_receipt TEXT REFERENCES workspace_identifiers(identifier),
  human_evidence_id TEXT REFERENCES workspace_identifiers(identifier),
  prior_state TEXT NOT NULL CHECK (prior_state IN ('CLEAR','LEASED','HARD_DNR','DEAD_ROUTE','HUMAN_EVENT_REOPEN','HOLD')),
  decision TEXT NOT NULL,
  new_state TEXT NOT NULL CHECK (new_state IN ('CLEAR','LEASED','HARD_DNR','DEAD_ROUTE','HUMAN_EVENT_REOPEN','HOLD')),
  lane_route_after TEXT,
  reopen_expiry_refenced BOOLEAN NOT NULL DEFAULT FALSE,
  accepted_event JSONB NOT NULL,
  accepted_event_sha256 CHAR(64) NOT NULL CHECK (accepted_event_sha256 ~ '^[0-9a-f]{64}$'),
  receipt JSONB NOT NULL,
  receipt_sha256 CHAR(64) NOT NULL CHECK (receipt_sha256 ~ '^[0-9a-f]{64}$'),
  external_send_authorized BOOLEAN NOT NULL DEFAULT FALSE CHECK (external_send_authorized = FALSE),
  CHECK ((kind IN ('SENT','BOUNCE')) = (provider_receipt IS NOT NULL)),
  CHECK ((kind = 'HUMAN_EVENT') = (human_evidence_id IS NOT NULL)),
  CHECK (provider_receipt IS NULL OR human_evidence_id IS NULL)
);

CREATE INDEX events_collision_time_idx ON events(collision_key, occurred_at, seq);
CREATE INDEX events_decision_idx ON events(decision);
CREATE INDEX lanes_state_idx ON lanes(state, updated_at);
