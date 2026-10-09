/** Fictional fixture for local demo/functional checks only. Never public taste evidence. */
const names = {
  artist: ['Sample Artist Amber', 'Sample Artist Cypress', 'Sample Artist Lake', 'Sample Artist Echo', 'Sample Artist River', 'Sample Artist Slate'],
  movie: ['Sample Film Horizon', 'Sample Film Lantern', 'Sample Film Wildwood', 'Sample Film Transit', 'Sample Film Greenroom', 'Sample Film Soundscape'],
  book: ['Sample Book Atlas', 'Sample Book Redthread', 'Sample Book Streetlights', 'Sample Book Orchard', 'Sample Book Maproom', 'Sample Book Fieldnotes'],
  place: ['Sample Community Hall', 'Sample Reading Room', 'Sample Arts Collective', 'Sample Story Studio', 'Sample Neighborhood Space', 'Sample Learning Center'],
};
export function fixtureResponses(input) {
  return {
    signals: input.tastes.map((query, index) => ({query, id: `sample-seed-${index + 1}`, name: `Sample signal ${index + 1}`, type: 'synthetic'})),
    raw: Object.fromEntries(Object.entries(names).map(([kind, group]) => [kind, {
      results: { entities: group.map((name, i) => ({ id: `sample-${kind}-${i+1}`, name, query: { affinity: +(0.83 - i * 0.09).toFixed(2) } })) },
    }])),
  };
}
