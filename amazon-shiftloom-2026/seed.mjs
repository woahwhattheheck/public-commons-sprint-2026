// Fictional event and volunteer profiles for a public, offline-first demonstration.
export function seedEvent() {
  return {
    event: 'Neighborhood Science Day', date: '2026-10-17', revision: 0,
    volunteers: [
      { id: 'maya', name: 'Maya', skills: ['welcome'], available: ['welcome'], preferred: ['welcome'], weeklyLimit: 2 },
      { id: 'leo', name: 'Leo', skills: ['welcome', 'logistics'], available: ['setup', 'welcome'], preferred: ['setup'], weeklyLimit: 2 },
      { id: 'iris', name: 'Iris', skills: ['welcome'], available: ['welcome'], preferred: ['welcome'], weeklyLimit: 2 },
      { id: 'zoe', name: 'Zoe', skills: ['welcome', 'mentor'], available: ['welcome', 'workshop'], preferred: ['welcome'], weeklyLimit: 2 },
      { id: 'nora', name: 'Nora', skills: ['welcome', 'mentor'], available: ['welcome', 'workshop'], preferred: ['workshop'], weeklyLimit: 2 },
      { id: 'priya', name: 'Priya', skills: ['mentor'], available: ['workshop'], preferred: ['workshop'], weeklyLimit: 1 },
      { id: 'omar', name: 'Omar', skills: ['logistics'], available: ['close'], preferred: ['close'], weeklyLimit: 1 },
      { id: 'eve', name: 'Eve', skills: ['logistics'], available: ['setup', 'close'], preferred: ['close'], weeklyLimit: 2 },
    ],
    shifts: [
      { id: 'setup', label: 'Early equipment setup', start: '2026-10-17T08:00:00', end: '2026-10-17T09:30:00', required: ['logistics'], capacity: 1, assigned: ['leo'] },
      { id: 'welcome', label: 'Morning welcome desk', start: '2026-10-17T09:00:00', end: '2026-10-17T11:00:00', required: ['welcome'], capacity: 2, assigned: ['maya'] },
      { id: 'workshop', label: 'Afternoon workshop', start: '2026-10-17T13:00:00', end: '2026-10-17T15:00:00', required: ['mentor'], capacity: 2, assigned: ['nora'] },
      { id: 'close', label: 'Evening cleanup', start: '2026-10-17T16:00:00', end: '2026-10-17T17:00:00', required: ['logistics'], capacity: 2, assigned: ['omar'] },
    ],
    unavailable: {},
  };
}
