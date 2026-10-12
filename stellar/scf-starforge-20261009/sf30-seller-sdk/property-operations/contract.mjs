// MIT. Source-owned metadata for the original Property Operations interfaces.
export const PROPERTY_CLIENT_SCHEMA='stellar-forge.property-client-request.v1';
export const PROPERTY_NATIVE_SCHEMA='tjlabs.property-workspace/v1';
export const PROPERTY_REQUEST_BYTES=512*1024;
export const PROPERTY_JSON_BYTES=128*1024*1024;
export const PROPERTY_FILE_BYTES=512*1024*1024;
export const PROPERTY_GROUPS=Object.freeze(['baselines','selections','contracts','requests','editions','reviews','comparisons','bindings','documents','resources']);
export const PROPERTY_READ_ACTIONS=Object.freeze(['property.get','property.operation','property.candidates','property.resource.publisher']);
export const PROPERTY_WRITE_ACTIONS=Object.freeze(['property.file.import','property.baseline.save','property.selection.save','property.propply.prepare','property.rentcheck.contract','property.rentcheck.prepare','property.inspection.prepare','property.request.run','property.request.recover','property.request.import','property.identity.save','property.comparison.save','property.inspection.bind','property.report.save','property.resource.export']);
export const PROPERTY_PUBLISHER_ACTIONS=Object.freeze(['status','prepare','preview','reviewDraft','publish','activateSnapshot','collect','release.stage','release.inspect','release.activate','release.rollback','release.start','release.stop','buyer.review','buyer.prepare','buyer.session','buyer.run','buyer.recover','buyer.account','buyer.export'].map(name=>'property.publisher.'+name));
export const PROPERTY_FILE_KINDS=Object.freeze(['draft-csv','draft-review','buyer-config','session-manifest','session-csv','session-jsonl','session-review']);
