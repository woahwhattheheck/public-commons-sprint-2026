// MIT. Retain service-agreement recovery identity in the original MCP error view.
const object = value => value !== null && typeof value === 'object' && !Array.isArray(value);
const uuid = /^[0-9a-f]{8}(?:-[0-9a-f]{4}){3}-[0-9a-f]{12}$/;
const requestId = /^[A-Za-z0-9][A-Za-z0-9._:-]{0,159}$/;
const action = /^[A-Za-z0-9_.:-]{1,160}$/;
export function serviceAgreementToolErrorView(error) {
  const details = object(error?.details) ? error.details : {};
  const prepared = details.agreementBillingPrepared === true;
  const durable = error?.code === 'WORKSPACE_COMMIT_UNKNOWN';
  const assigned = error?.code === 'AGREEMENT_RENEWAL_ALREADY_ASSIGNED';
  if (!prepared && !durable && !assigned) return {};
  const result = {};
  if (assigned) {
    result.details = {};
    for (const name of ['agreementId', 'sourceId', 'editionId'])
      if (typeof details[name] === 'string' && uuid.test(details[name])) result.details[name] = details[name];
  }
  if (prepared) {
    result.details = {agreementBillingPrepared: true};
    if (typeof details.billingId === 'string' && uuid.test(details.billingId))
      result.details.billingId = details.billingId;
    if (typeof details.requestId === 'string' && requestId.test(details.requestId))
      result.details.requestId = details.requestId;
  }
  if (durable || error.reopenRequired === true) result.reopenRequired = true;
  if (durable || error.outcomeUnknown === true) result.outcomeUnknown = true;
  const retained = error.commitUncertainty;
  if (durable && object(retained)) {
    const value = {};
    if (typeof retained.at === 'string' && retained.at.length <= 80 && Number.isFinite(Date.parse(retained.at)))
      value.at = retained.at;
    if (typeof retained.action === 'string' && action.test(retained.action)) value.action = retained.action;
    if (Number.isSafeInteger(retained.revision) && retained.revision >= 1) value.revision = retained.revision;
    if (typeof retained.causeCode === 'string' && /^[A-Za-z0-9_]{1,80}$/.test(retained.causeCode))
      value.causeCode = retained.causeCode;
    if (Object.keys(value).length) result.commitUncertainty = value;
  }
  return result;
}
/** Existing application projections keep their fields and all unrelated outcomes. */
export function withServiceAgreementToolErrors(original) {
  if (original !== undefined && typeof original !== 'function')
    throw new TypeError('Use the original synchronous merchant error projection.');
  return error => {
    const previous = original === undefined ? {} : original(error);
    if (!object(previous)) throw new TypeError('The original merchant error projection must return an object.');
    const next = serviceAgreementToolErrorView(error);
    if (!Object.keys(next).length) return previous;
    return {...previous, ...next, ...(next.details && object(previous.details)
      ? {details: {...previous.details, ...next.details}} : {})};
  };
}
