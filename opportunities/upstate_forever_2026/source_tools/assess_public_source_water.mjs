// Reproduce the retained original SCDES point/footprint relationship using Node.js standard libraries.

function assert(condition, message) { if (!condition) throw new Error(message); }
function number(value, label) {
  assert(typeof value === 'number' && Number.isFinite(value), 'Nonfinite coordinate: ' + label);
  return value;
}
function round(value) { return Math.round(value * 1e6) / 1e6; }
function segmentDistance(point, left, right) {
  const dx = right[0] - left[0], dy = right[1] - left[1];
  const denom = dx * dx + dy * dy;
  const ratio = denom === 0 ? 0 : Math.max(0, Math.min(1,
    ((point[0] - left[0]) * dx + (point[1] - left[1]) * dy) / denom));
  return Math.hypot(point[0] - left[0] - ratio * dx, point[1] - left[1] - ratio * dy);
}
function analyseGeometry(rings, point) {
  assert(Array.isArray(rings) && rings.length > 0, 'Polygon has no rings');
  let inside = false, signedTwiceArea = 0, nearest = Infinity, vertices = 0;
  const bounds = [Infinity, Infinity, -Infinity, -Infinity];
  for (const ring of rings) {
    assert(Array.isArray(ring) && ring.length >= 4, 'Invalid polygon ring');
    assert(ring[0][0] === ring[ring.length - 1][0] &&
           ring[0][1] === ring[ring.length - 1][1], 'Unclosed published ring');
    const origin = ring[0];
    vertices += ring.length;
    for (let i = 0; i < ring.length - 1; i++) {
      const a = ring[i], b = ring[i + 1];
      number(a[0], 'x'); number(a[1], 'y'); number(b[0], 'x'); number(b[1], 'y');
      bounds[0] = Math.min(bounds[0], a[0]); bounds[1] = Math.min(bounds[1], a[1]);
      bounds[2] = Math.max(bounds[2], a[0]); bounds[3] = Math.max(bounds[3], a[1]);
      // Translating each ring to its first vertex limits cancellation at UTM magnitudes.
      signedTwiceArea += (a[0] - origin[0]) * (b[1] - origin[1]) -
                         (b[0] - origin[0]) * (a[1] - origin[1]);
      nearest = Math.min(nearest, segmentDistance(point, a, b));
      if ((a[1] > point[1]) !== (b[1] > point[1]) &&
          point[0] < (b[0] - a[0]) * (point[1] - a[1]) / (b[1] - a[1]) + a[0]) {
        inside = !inside;
      }
    }
  }
  // Esri exterior/hole winding determines signed area; even/odd crossing includes all holes.
  return {inside, on_boundary: nearest <= 1e-7, nearest,
          area: Math.abs(signedTwiceArea) / 2, bounds, rings: rings.length, vertices};
}
function assess(polygon, intakes, manifest, identities, calculationIdentity) {
  for (const [label, value] of [['polygon', polygon], ['intakes', intakes]]) {
    assert(value.spatialReference &&
           (value.spatialReference.latestWkid || value.spatialReference.wkid) === 26917,
           label + ' must preserve original EPSG:26917 coordinates');
    assert(Array.isArray(value.features), label + ' has no features');
  }
  assert(polygon.geometryType === 'esriGeometryPolygon', 'Expected original Esri polygon');
  assert(intakes.geometryType === 'esriGeometryPoint', 'Expected original Esri point');
  assert(polygon.features.length === 4, 'Expected exactly four original protection polygons');
  assert(intakes.features.length === 71, 'Expected complete 71-point original response');
  const selectors = [
    {receptor_id:'arjws-swpa-1500', OBJECTID:11, INTAKE:'S04101', BUFFER_FT:1500, intake_object_id:6},
    {receptor_id:'arjws-swpa-200', OBJECTID:12, INTAKE:'S04101', BUFFER_FT:200, intake_object_id:6},
    {receptor_id:'prwd-swpa-1500', OBJECTID:131, INTAKE:'S37109', BUFFER_FT:1500, intake_object_id:50},
    {receptor_id:'prwd-swpa-200', OBJECTID:132, INTAKE:'S37109', BUFFER_FT:200, intake_object_id:50}
  ];
  const rows = selectors.map(selector => {
    const matches = polygon.features.filter(feature => Object.entries(selector)
      .filter(([key]) => ['OBJECTID','INTAKE','BUFFER_FT'].includes(key))
      .every(([key,value]) => feature.attributes[key] === value));
    assert(matches.length === 1, 'Typed polygon selector is not unique: ' + selector.receptor_id);
    const points = intakes.features.filter(feature =>
      feature.attributes.OBJECTID === selector.intake_object_id &&
      feature.attributes.INTAKE === selector.INTAKE);
    assert(points.length === 1, 'Typed intake selector is not unique: ' + selector.receptor_id);
    const feature = matches[0], intake = points[0], attributes = feature.attributes;
    assert(intake.attributes.PWSNO === 'SC' + attributes.SYSTEM, 'Intake/system identity mismatch');
    const point = [number(intake.geometry.x,'intake x'), number(intake.geometry.y,'intake y')];
    const measured = analyseGeometry(feature.geometry.rings, point);
    const sourceArea = number(attributes['Shape.STArea()'], 'published area');
    return {
      receptor_id:selector.receptor_id,
      polygon_selector:{OBJECTID:selector.OBJECTID,INTAKE:selector.INTAKE,BUFFER_FT:selector.BUFFER_FT},
      intake_selector:{OBJECTID:selector.intake_object_id,INTAKE:selector.INTAKE},
      published_polygon_attributes:attributes,
      published_intake_attributes:intake.attributes,
      intake_xy_m:point,
      relationship:measured.on_boundary ? 'boundary' : measured.inside ? 'inside' : 'outside',
      minimum_distance_to_boundary_m:round(measured.nearest),
      minimum_distance_to_footprint_m:measured.inside || measured.on_boundary ? 0 : round(measured.nearest),
      published_area_ha:sourceArea/10000,
      calculated_area_m2:round(measured.area),
      calculated_area_ha:round(measured.area/10000),
      calculated_minus_published_area_m2:round(measured.area-sourceArea),
      bounds_m:measured.bounds.map(round),rings:measured.rings,vertices:measured.vertices
    };
  });
  return {
    schema:'upstate.source-water-geometry-assessment/v1',
    title:'Original SCDES source-water protection footprints and published intake locations',
    captured_at:manifest.captured_at,
    capture_precision:'day; underlying publisher edition and original response time unstated',
    analysis_crs:'EPSG:26917',
    distance_units:'metres',
    sources:manifest.entries.map(entry => ({
      id:entry.id,path:entry.path,uri:entry.uri,vintage:entry.vintage,source_crs:entry.source_crs,
      bytes:entry.bytes,sha256:entry.sha256,git_blob:identities[entry.id].git_blob
    })),
    calculation_source:calculationIdentity,
    method:{
      point_relationship:'Even-odd ray crossing across every original ring; boundary tolerance 1e-7 m.',
      distance:'Minimum Euclidean point-to-segment distance over every exterior and hole ring.',
      area:'Absolute sum of signed ring areas with translated coordinates; original Esri hole winding retained.',
      precision:'Computed distances and areas rounded to 6 decimal places for reproducible serialization.',
      input_treatment:'Original point and polygon coordinates are used directly without reprojection, buffering, simplification or geometry repair.'
    },
    findings:rows,
    interpretation:[
      'ARJWS intake S04101 is within both corresponding published protection footprints.',
      'Pioneer intake S37109 is outside both corresponding published protection footprints; the original geometries retain their distinct locations.',
      'Published protection footprints and intake-based upstream catchments are separate analysis criteria. Use these footprints for protection-area scoring and the original intake point for catchment routing.',
      'The 200-foot and 1500-foot source areas are alternative published scopes. Union overlapping source areas before totals; do not add overlapping footprints as independent area.',
      'A published BUFFER_FT attribute is retained as source metadata, not applied as an additional buffer.'
    ]
  };
}

const sourceDir = process.argv[2];
if (!sourceDir) throw new Error('Usage: node source_tools/assess_public_source_water.mjs SOURCE_DIR [OUTPUT_JSON]');
const [{readFile,writeFile}, {resolve,join}, {createHash}, {fileURLToPath}] = await Promise.all([
  import('node:fs/promises'),import('node:path'),import('node:crypto'),import('node:url')
]);
const base = resolve(sourceDir), digest = value => createHash('sha256').update(value).digest('hex');
const manifestBytes = await readFile(join(base,'sources.public-native.json'));
const manifest = JSON.parse(manifestBytes);
const expected = {
  'scdes-public-surface-intakes-20261012': {bytes:25984,sha256:'29532afb9da03c4d45cf194748618daaace622be455c65881b98bdbe97fc97c2',git_blob:'4299e1afd868f6fa703538ef15f0db7654ae2b46'},
  'scdes-arjws-prwd-swpa-20261012': {bytes:2389556,sha256:'ddac0feb1c704ca5e95336e21961e08beede1f83b6b820423dffa5a63bd8e285',git_blob:'cf9f5bf3a8e2808d2416f8b302d3fc19b7529ada'}
};
const decoded = {};
for (const [id,identity] of Object.entries(expected)) {
  const entries = manifest.entries.filter(entry => entry.id === id);
  assert(entries.length === 1, 'Source manifest identity is not unique: '+id);
  const entry = entries[0], path = resolve(base,entry.path);
  assert(path.startsWith(base + '/'), 'Source path escapes its retained directory');
  assert(entry.bytes === identity.bytes && entry.sha256 === identity.sha256,
         'This assessment requires the preserved 2026-10-12 source edition: '+id);
  const bytes = await readFile(path);
  assert(bytes.length === identity.bytes && digest(bytes) === identity.sha256,
         'Source bytes differ from the retained original: '+id);
  decoded[id] = JSON.parse(bytes);
}
const ownBytes = await readFile(fileURLToPath(import.meta.url));
const result = assess(decoded['scdes-arjws-prwd-swpa-20261012'],
  decoded['scdes-public-surface-intakes-20261012'],manifest,expected,{
    path:'source_tools/assess_public_source_water.mjs',bytes:ownBytes.length,sha256:digest(ownBytes)
  });
const output = JSON.stringify(result,null,2)+'\n';
if (process.argv[3]) await writeFile(process.argv[3],output,{flag:'wx'});
else process.stdout.write(output);
