/** A deterministic, explainable agent toolchain; no LLM/device integration is implied. */
export function parseIntent(command, state) {
  if (typeof command !== 'string' || command.length > 400 || !command.trim()) {
    return { error: 'Please enter a specific, short staffing request.' };
  }
  const t = command.toLowerCase().replace(/[^a-z0-9\s'-]/g, ' ');
  const shiftTerms = {
    setup: /\b(setup|set up|equipment)\b/,
    welcome: /\b(welcome|check\s*in|check-in|front desk|greeting)\b/,
    workshop: /\b(workshop|science class|teaching|session)\b/,
    close: /\b(cleanup|clean up|closing|pack down)\b/,
  };
  const found = Object.entries(shiftTerms).filter(([, re]) => re.test(t)).map(([id]) => id);
  if (found.length !== 1) return { error: 'Which single shift? Please say setup, welcome desk, workshop, or cleanup.' };
  // A named negative constraint must never be silently discarded as ordinary prose.
  // This deliberately understands one explicitly named exclusion at a time; it
  // clarifies unknown/multiple exclusions instead of guessing who can be booked.
  const exclusions = [];
  for (const re of [
    /\b(?:without|except|exclude|excluding|avoid|skip)\s+([a-z][a-z'-]*)\b/g,
    /\b(?:do not|don't|never)\s+(?:assign|schedule|choose|pick|book)\s+([a-z][a-z'-]*)\b/g,
  ]) {
    for (const match of t.matchAll(re)) {
      exclusions.push({ name: match[1], after: match.index + match[0].length });
    }
  }
  const hasExclusion = /\b(?:without|except|exclude|excluding|avoid|skip)\b/.test(t)
    || /\b(?:do not|don't|never)\s+(?:assign|schedule|choose|pick|book)\b/.test(t);
  let excludedVolunteerId = null;
  if (hasExclusion) {
    if (exclusions.length !== 1) {
      return { error: 'Name exactly one volunteer to exclude (for example, without Iris). I will not guess.' };
    }
    const matched = state.volunteers.filter(v => v.name.toLowerCase() === exclusions[0].name);
    const remainder = t.slice(exclusions[0].after);
    const nextName = remainder.match(/^\s+([a-z][a-z'-]*)\b/);
    if (matched.length !== 1 || /^\s+(?:and|or)\b/.test(remainder)
        || (nextName && state.volunteers.some(v => v.name.toLowerCase() === nextName[1]))) {
      return { error: 'Please name one known volunteer to exclude per request.' };
    }
    excludedVolunteerId = matched[0].id;
  }
  const isAbsence = /\b(absent|unavailable|cannot make|can't make|called out|is out|is sick)\b/.test(t);
  let absentVolunteerId = null;
  if (isAbsence) {
    const names = state.volunteers.filter(v => new RegExp(`\\b${v.name.toLowerCase()}\\b`).test(t));
    if (names.length !== 1) return { error: 'Name exactly one volunteer who is unavailable; I will not guess.' };
    absentVolunteerId = names[0].id;
  }
  return { shiftId: found[0], absentVolunteerId, excludedVolunteerId };
}

export function overlaps(a, b) {
  return Date.parse(a.start) < Date.parse(b.end) && Date.parse(b.start) < Date.parse(a.end);
}

export function proposeCoverage(state, command) {
  const intent = parseIntent(command, state);
  if (intent.error) return { ok: false, message: intent.error, trace: [{ tool: 'intent_reader', result: 'clarification' }] };
  return proposeCoverageIntent(state, intent);
}

function qualificationProblems(volunteer, shift) {
  const missing = shift.required.filter(id => !volunteer.skills.includes(id));
  const invalid = volunteer.qualificationWindows ? shift.required.filter(id =>
    volunteer.skills.includes(id) && !volunteer.qualificationWindows.some(q => q.id === id && q.status === 'active'
      && (!q.from || Date.parse(q.from) <= Date.parse(shift.start))
      && (!q.until || Date.parse(q.until) >= Date.parse(shift.end)))) : [];
  return { missing, invalid };
}

/** Inspect the retained roster with the same constraints used for new candidates. */
export function rosterFindings(state, { shiftId = null, removing = null } = {}) {
  const findings = [];
  for (const shift of state.shifts.filter(s => !shiftId || s.id === shiftId)) {
    const assigned = shift.assigned.filter(id => !(sameshift(shift.id, shiftId) && id === removing));
    if (assigned.length + (shift.reservedSlots || 0) > shift.capacity)
      findings.push({ code: 'OVER_CAPACITY', shiftId: shift.id, message: 'Named assignments and reserved slots exceed capacity.' });
    for (const id of assigned) {
      const v = state.volunteers.find(v => v.id === id);
      if (!v) { findings.push({ code: 'UNKNOWN_VOLUNTEER', shiftId: shift.id, volunteerId: id, message: 'Assigned volunteer is absent from the roster.' }); continue; }
      const add = (code, message) => findings.push({ code, shiftId: shift.id, volunteerId: id, message });
      if (v.active === false) add('INACTIVE_ASSIGNEE', 'An inactive volunteer remains assigned.');
      if (v.eligibility && v.eligibility[shift.id] === false) add('INELIGIBLE_ASSIGNEE', 'A coordinator-ineligible volunteer remains assigned.');
      if ((state.unavailable[id] || []).includes(shift.id)) add('UNAVAILABLE_ASSIGNEE', 'A known unavailable volunteer remains assigned.');
      const q = qualificationProblems(v, shift);
      if (q.missing.length || q.invalid.length) add('ASSIGNEE_QUALIFICATION', 'Assigned qualifications are missing or invalid for the complete shift: ' + [...q.missing, ...q.invalid].join(', ') + '.');
      const bookings = state.shifts.filter(s => s.assigned.includes(id) && !(s.id === shiftId && id === removing));
      if (bookings.some(s => s.id !== shift.id && overlaps(s, shift))) add('ASSIGNEE_OVERLAP', 'The retained assignment overlaps another committed shift.');
      if (shift.countsTowardLimit !== false && bookings.filter(s => s.countsTowardLimit !== false).length > v.weeklyLimit)
        add('ASSIGNEE_LIMIT', 'Retained assignments exceed the declared planning-week limit.');
    }
  }
  return findings;
}

function sameshift(a, b) { return a === b; }

/** Structured source IDs share the original filtering, ranking and approval engine. */
export function proposeCoverageIntent(state, intent) {
  if (!intent || typeof intent.shiftId !== 'string' || !state.shifts.some(s => s.id === intent.shiftId))
    return { ok: false, message: 'Choose a shift from this exact source version.', trace: [{ tool: 'schedule_lookup', result: 'unknown_shift' }] };
  for (const key of ['absentVolunteerId', 'excludedVolunteerId']) if (intent[key] && !state.volunteers.some(v => v.id === intent[key]))
    return { ok: false, message: 'Choose a volunteer from this exact roster.', trace: [{ tool: 'schedule_lookup', result: 'unknown_volunteer' }] };
  const shift = state.shifts.find(s => s.id === intent.shiftId);
  const removing = intent.absentVolunteerId;
  if (removing && !shift.assigned.includes(removing)) {
    return { ok: false, message: 'That volunteer is not booked on this shift; no schedule change was drafted.', trace: [{ tool: 'schedule_lookup', result: 'not_assigned' }] };
  }
  if (intent.excludedVolunteerId && intent.excludedVolunteerId !== removing
      && shift.assigned.includes(intent.excludedVolunteerId)) {
    return { ok: false, message: 'That excluded volunteer is already assigned to this shift. Explicitly report an absence before requesting a replacement.',
      trace: [{ tool: 'schedule_lookup', result: 'assigned_volunteer_exclusion_needs_absence' }] };
  }
  const retained = shift.assigned.filter(id => id !== removing);
  const vacancies = shift.capacity - retained.length - (shift.reservedSlots || 0);
  const trace = [
    { tool: 'intent_reader', result: `Requested ${shift.label}${removing ? ' with a reported absence' : ''}` },
    { tool: 'schedule_lookup', result: `${retained.length} named retained + ${shift.reservedSlots || 0} reserved / ${shift.capacity} required` },
  ];
  const baseline = rosterFindings(state, { shiftId: shift.id, removing });
  if (baseline.length) return { ok: false, message: 'Resolve the retained assignment findings for this shift before accepting revised coverage.', trace, baselineFindings: baseline, candidateReview: [] };
  if (vacancies < 1) return { ok: false, message: 'That shift is already fully covered; no changes proposed.', trace };
  const rejected = { excluded: 0, unavailable: 0, eligibility: 0, skill: 0, clash: 0, limit: 0, booked: 0 };
  const scored = [];
  const candidateReview = [];
  for (const v of state.volunteers) {
    const explain = (status, reason) => candidateReview.push({ id: v.id, name: v.name, status, reason });
    if (v.active === false || (v.eligibility && v.eligibility[shift.id] !== true)) {
      rejected.eligibility++; explain('blocked', v.active === false ? 'Volunteer is not active in the selected source.' : 'Coordinator eligibility is not confirmed for this shift.'); continue;
    }
    if (v.id === intent.excludedVolunteerId) { rejected.excluded++; explain('blocked', 'Excluded in this request.'); continue; }
    if (v.id === removing || (state.unavailable[v.id] || []).includes(shift.id) || !v.available.includes(shift.id)) {
      rejected.unavailable++;
      explain('blocked', v.id === removing ? 'Reported absent in this request.'
        : (state.unavailable[v.id] || []).includes(shift.id) ? 'Previously reported absent for this shift.'
        : 'Not available for this shift.');
      continue;
    }
    if (retained.includes(v.id)) { rejected.booked++; explain('assigned', 'Already assigned to this shift.'); continue; }
    const qualifications = qualificationProblems(v, shift);
    if (qualifications.missing.length || qualifications.invalid.length) {
      rejected.skill++; explain('blocked', qualifications.missing.length ? 'Missing required qualification: ' + qualifications.missing.join(', ') + '.'
        : 'Qualification is not active for the complete shift: ' + qualifications.invalid.join(', ') + '.'); continue;
    }
    const bookings = state.shifts.filter(s => s.assigned.includes(v.id) && !(s.id === shift.id && removing === v.id));
    if (bookings.some(s => overlaps(s, shift))) {
      rejected.clash++; explain('blocked', 'Overlaps an existing assignment: ' + bookings.filter(s => overlaps(s, shift)).map(s => s.label).join(', ') + '.'); continue;
    }
    const counted = bookings.filter(s => s.countsTowardLimit !== false).length;
    if (counted >= v.weeklyLimit) { rejected.limit++; explain('blocked', 'Already at the weekly limit of ' + v.weeklyLimit + ' assignment(s).'); continue; }
    const score = counted * 100 + (v.preferred.includes(shift.id) ? -20 : 0);
    explain('eligible', counted + ' current assignment(s)' + (v.preferred.includes(shift.id) ? '; prefers this shift.' : '; available for this shift.'));
    scored.push({ id: v.id, name: v.name, score, currentAssignments: counted, preference: v.preferred.includes(shift.id) });
  }
  scored.sort((a, b) => a.score - b.score || a.name.localeCompare(b.name));
  const selected = scored.slice(0, vacancies);
  if (selected.length === vacancies) {
    const chosenIds = new Set(selected.map(v => v.id));
    for (const candidate of candidateReview) if (chosenIds.has(candidate.id)) candidate.status = 'chosen';
  }
  trace.push(
    { tool: 'explicit_exclusion', result: intent.excludedVolunteerId
      ? `Honored named exclusion for ${state.volunteers.find(v => v.id === intent.excludedVolunteerId).name}`
      : 'No named exclusions requested' },
    { tool: 'availability_check', result: `${rejected.unavailable} unavailable; ${rejected.booked} already on this shift` },
    { tool: 'coordinator_eligibility', result: `${rejected.eligibility} inactive or without affirmative shift eligibility` },
    { tool: 'skill_match', result: `${rejected.skill} lack required role (${shift.required.join(', ')})` },
    { tool: 'overlap_and_limit', result: `${rejected.clash} time conflicts; ${rejected.limit} weekly-limit conflicts` },
    { tool: 'fairness_rank', result: `${scored.length} eligible; prioritize lighter loads and preferences` },
  );
  if (selected.length !== vacancies) {
    trace.push({ tool: 'approval_gate', result: 'BLOCKED: incomplete coverage' });
    return { ok: false, message: `Only ${selected.length} eligible volunteer(s) for ${vacancies} vacancy/ies. I will not publish an understaffed schedule.`,
      trace, alternatives: selected, rejected, candidateReview };
  }
  const changes = [
    ...(removing ? [{ action: 'remove', shiftId: shift.id, volunteerId: removing, name: state.volunteers.find(v => v.id === removing).name }] : []),
    ...selected.map(x => ({ action: 'add', shiftId: shift.id, volunteerId: x.id, name: x.name })),
  ];
  trace.push({ tool: 'approval_gate', result: 'PAUSED: requires explicit human approval' });
  return {
    ok: true, message: `I drafted complete ${shift.label} coverage: ${selected.map(x => x.name).join(' and ')}. Nothing changes until you approve.`,
    shift: { id: shift.id, label: shift.label, start: shift.start, end: shift.end, required: shift.required },
    chosen: selected, rejected, changes, trace, candidateReview, originalRevision: state.revision,
  };
}

export function applyProposal(state, proposal) {
  if (!proposal?.ok || proposal.originalRevision !== state.revision) throw new Error('Proposal is out of date. Plan again.');
  const next = structuredClone(state);
  for (const c of proposal.changes) {
    const shift = next.shifts.find(s => s.id === c.shiftId);
    if (!shift) throw new Error('Invalid shift in pending plan.');
    if (c.action === 'remove') {
      if (!shift.assigned.includes(c.volunteerId)) throw new Error('Volunteer booking changed.');
      shift.assigned = shift.assigned.filter(id => id !== c.volunteerId);
      next.unavailable[c.volunteerId] ||= [];
      if (!next.unavailable[c.volunteerId].includes(shift.id)) next.unavailable[c.volunteerId].push(shift.id);
    } else if (c.action === 'add') {
      if (shift.assigned.includes(c.volunteerId)) throw new Error('Volunteer already assigned.');
      shift.assigned.push(c.volunteerId);
    } else throw new Error('Unknown proposed action.');
  }
  const target = next.shifts.find(s => s.id === proposal.shift.id);
  if (target.assigned.length + (target.reservedSlots || 0) !== target.capacity) throw new Error('Incomplete coverage cannot be published.');
  next.revision += 1;
  return next;
}
