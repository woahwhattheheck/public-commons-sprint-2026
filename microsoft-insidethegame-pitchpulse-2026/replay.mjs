import {MatchEngine, normalizeEvent, SYNTHETIC_EVENTS} from './engine.mjs';

export const REPLAY_SCHEMA = 'pitchpulse-replay/v1';
export const MAX_REPLAY_BYTES = 2*1024*1024;
const reject = message => { throw new Error(`Invalid replay: ${message}`); };

export function exportReplay(session) {
  return {schema:REPLAY_SCHEMA, fixture:'synthetic', nextIndex:session.nextIndex,
    events:session.engine.events.map(event=>({...event}))};
}

/** Build a replacement without touching the live session; callers commit only on success. */
export function validateReplay(source) {
  if (!source || typeof source!=='object' || Array.isArray(source) ||
      source.schema!==REPLAY_SCHEMA || source.fixture!=='synthetic') reject('unknown format or fixture');
  if (!Array.isArray(source.events) || source.events.length>3000) reject('expected at most 3000 events');
  const {nextIndex} = source;
  if (nextIndex!==null && (!Number.isInteger(nextIndex) || nextIndex<0 || nextIndex>SYNTHETIC_EVENTS.length)) {
    reject('nextIndex must be a valid built-in cursor or null for a custom ledger');
  }
  const engine = new MatchEngine();
  for (const event of source.events) {
    if (engine.ingest(event).duplicate) reject('duplicate event IDs');
  }
  // A cursor is meaningful only for the exact fixture prefix, not an arbitrary imported ledger.
  if (nextIndex!==null) {
    if (engine.events.length!==nextIndex) reject('cursor does not match event count');
    for (let index=0; index<nextIndex; index++) {
      if (JSON.stringify(engine.events[index])!==JSON.stringify(normalizeEvent(SYNTHETIC_EVENTS[index]))) {
        reject('cursor does not match the built-in fixture prefix');
      }
    }
  }
  return {engine, nextIndex};
}
