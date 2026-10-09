/** SYNTHETIC provider. This dataset is NOT licensed/queried Qloo information. */
const titles = [
  'Glass Cinema', 'The Quiet Atlas', 'Blue Orchard', 'Signal Bloom', 'Paper Harbor',
  'Comet Lantern', 'Afterlight Avenue', 'Letters to Rain', 'Hidden Auditorium',
  'Orchid Mirror', 'Falling Satellites', 'Magnetic July', 'The River Archive',
  'Northern Eclipse', 'Late Spring Radio', 'Small Hours', 'Brass Skyline',
  'Echo Reservoir', 'Map of Dawn', 'Hollow Moon', 'Red Frequency', 'Ghost Library',
];
const popularity = [.94,.86,.72,.68,.42,.24,.88,.81,.77,.61,.56,.48,.38,.21,.18,.12,.71,.65,.32,.26,.53,.41];
const items = titles.map((name, index) => ({
  entity_id: `synthetic-${index + 1}`,
  name,
  subtype: 'urn:entity:movie',
  popularity: popularity[index],
  properties: { description: 'Invented demonstration title; not a real Qloo recommendation.' },
}));
export function createDemoProvider() {
  return {
    async search(query, types) {
      return { results: { entities: [{ entity_id: 'synthetic-seed', name: query, subtype: types }] } };
    },
    async insights({ target, maxPopularity, minPopularity, take = 15 }) {
      let rows = items;
      if (maxPopularity !== undefined) rows = rows.filter(x => x.popularity <= maxPopularity);
      if (minPopularity !== undefined) rows = rows.filter(x => x.popularity >= minPopularity);
      rows = rows.slice(0, Math.max(0, Math.min(30, take)));
      return { results: { entities: rows.map(x => ({ ...x, subtype: target })) } };
    },
  };
}
