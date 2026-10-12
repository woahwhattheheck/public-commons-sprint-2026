// MIT. Static Prescient routes of the original STAC host; no runtime or SDK imports.
const action = (path, fields, required = fields, delivery = false) =>
  Object.freeze({ path, fields: Object.freeze(fields), required: Object.freeze(required), delivery });
export const STAC_PRESCIENT_ACTIONS = Object.freeze({
  'profile-save': action('/profiles', ['profile']),
  'profile-import': action('/profiles/import', ['profile', 'bindingId']),
  'profile-review': action('/profiles/review', ['profileSha256']),
  'profile-approve': action('/profiles/approve', ['reviewId', 'reviewSha256']),
  connect: action('/connect', ['refresh'], []),
  session: action('/session', ['refresh'], []),
  'delivery-review': action('/deliveries/review', ['directory'], ['directory'], true),
  'delivery-export': action('/deliveries/export', ['reviewId', 'reviewSha256']),
  'delivery-open': action('/deliveries/open', ['directory', 'manifestSha256'], ['directory', 'manifestSha256'], true)
});
export const STAC_PRESCIENT_RECORDS = Object.freeze([
  'profiles', 'reviews', 'approvals', 'deliveryReviews', 'deliveries', 'operations'
]);
