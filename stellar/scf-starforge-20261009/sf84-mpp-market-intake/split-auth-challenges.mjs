/**
 * Split RFC 9110 WWW-Authenticate #challenge values without confusing
 * comma-separated auth-params (or quoted commas) with challenge boundaries.
 * Returned strings preserve the per-challenge wire spelling.
 * No interpretation of amounts or issuer authority occurs.
 * SPDX-License-Identifier: MIT
 */
const TOKEN = /^[!#$%&'*+.^_`|~0-9A-Za-z-]+/;

function startsChallenge(segment) {
  const value = segment.trimStart();
  const token = TOKEN.exec(value)?.[0];
  if (!token) return false;
  const suffix = value.slice(token.length);
  if (suffix && !/^\s/.test(suffix)) return false;
  // A parameter can include optional BWS before '=': realm = "example".
  // Such a segment belongs to the current challenge, not a new scheme.
  return suffix.trimStart()[0] !== '=';
}

export function splitAuthenticateChallenges(value) {
  if (typeof value !== 'string') throw new TypeError('INVALID_AUTHENTICATE_HEADER');
  const members = [];
  let beginning = 0;
  let quoted = false;
  let escaped = false;
  for (let i = 0; i < value.length; ++i) {
    const ch = value[i];
    if (escaped) { escaped = false; continue; }
    if (quoted && ch === '\\') { escaped = true; continue; }
    if (ch === '"') { quoted = !quoted; continue; }
    if (ch === ',' && !quoted) {
      members.push(value.slice(beginning, i));
      beginning = i + 1;
    }
  }
  members.push(value.slice(beginning));
  const challenges = [];
  let active = '';
  for (const member of members) {
    if (startsChallenge(member) && active !== '') {
      challenges.push(active.trim());
      active = member;
    } else {
      active = active === '' ? member : `${active},${member}`;
    }
  }
  if (active.trim()) challenges.push(active.trim());
  return challenges;
}
