import {randomBytes} from 'node:crypto';
import {MatchEngine} from './engine.mjs';

export const SESSION_COOKIE = 'pitchpulse_sid';
const ID_PATTERN = /^[A-Za-z0-9_-]{32}$/;

/** Single-process visitor state. No active visitor is evicted to admit a new one. */
export class SessionStore {
  constructor({maxSessions=64, ttlMs=30*60*1000, now=Date.now}={}) {
    if (!Number.isInteger(maxSessions) || maxSessions < 1 || maxSessions > 256 ||
        !Number.isInteger(ttlMs) || ttlMs < 1 || ttlMs > 24*60*60*1000 || typeof now !== 'function') {
      throw new Error('Invalid session configuration');
    }
    this.sessions = new Map();
    this.maxSessions = maxSessions;
    this.ttlMs = ttlMs;
    this.now = now;
  }

  acquire(cookie='') {
    const time = this.now();
    for (const [id, session] of this.sessions) {
      if (session.expiresAt <= time) this.sessions.delete(id);
    }
    const supplied = cookie.split(';').map(part=>part.trim())
      .find(part=>part.startsWith(`${SESSION_COOKIE}=`))?.slice(SESSION_COOKIE.length+1);
    let session = supplied && ID_PATTERN.test(supplied) ? this.sessions.get(supplied) : undefined;
    if (!session) {
      if (this.sessions.size >= this.maxSessions) {
        throw Object.assign(new Error('Demo is at visitor capacity; retry later'), {status:503});
      }
      const id = randomBytes(24).toString('base64url');
      session = {id, engine:new MatchEngine(), nextIndex:0, expiresAt:time+this.ttlMs};
      this.sessions.set(id, session);
    }
    session.expiresAt = time+this.ttlMs;
    return session;
  }
}

export function sessionCookie(session, secure=false) {
  return `${SESSION_COOKIE}=${session.id}; Path=/; HttpOnly; SameSite=Strict${secure?'; Secure':''}`;
}

/** Conservative process-wide provider budget: failed calls still consume a slot. */
export class FoundryBudget {
  constructor({limit=process.env.FOUNDRY_DEMO_MAX_CALLS_PER_HOUR??'0',now=Date.now}={}) {
    if (!/^(0|[1-9]|1[0-9]|2[0-4])$/.test(String(limit)) || typeof now!=='function') {
      throw new Error('Invalid FOUNDRY_DEMO_MAX_CALLS_PER_HOUR: expected 0..24');
    }
    this.limit=Number(limit);this.now=now;this.calls=[];this.inFlight=false;
  }
  get enabled(){return this.limit>0;}
  async run(action){
    if(!this.enabled)throw Object.assign(new Error('Foundry demo budget is disabled'),{status:503});
    const now=this.now();this.calls=this.calls.filter(start=>start>now-3600000);
    if(this.inFlight)throw Object.assign(new Error('A Foundry request is already in flight'),{status:429,retryAfter:1});
    if(this.calls.length>=this.limit){
      throw Object.assign(new Error('Foundry hourly demo budget exhausted'),{
        status:429,retryAfter:Math.max(1,Math.ceil((this.calls[0]+3600000-now)/1000))});
    }
    this.inFlight=true;this.calls.push(now);
    try{return await action();}finally{this.inFlight=false;}
  }
}
