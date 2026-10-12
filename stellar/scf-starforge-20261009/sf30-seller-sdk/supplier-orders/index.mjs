// MIT. Original supplier-order product modules.
export { openSupplierOrderWorkspace, SupplierOrderWorkspace, MAX_SOURCE_BYTES, MAX_PACKAGE_BYTES } from './workspace.mjs';
export { serveSupplierOrderWorkspace } from './server.mjs';
export { parseOpenTransDocument, renderOpenTransDocument } from './opentrans.mjs';
export { PROFILE_ID, DOCUMENT_SCHEMA, ORDER_SCHEMA, DRAFT_SCHEMA, KINDS, RULES,
  reviewDocument, projectOrder, createDocumentDraft, normalizedDocument } from './core.mjs';
export { writeSupplierOrderPackage, readSupplierOrderPackage, PACKAGE_SCHEMA } from './portable.mjs';
export * as orderNumbers from './numbers.mjs';

export { SupplierOrderTransport, TRANSMISSION_SCHEMA, validateSupplierOrderTransmission } from './transport.mjs';
export { SUPPLIER_HTTPS_CONFIG_SCHEMA, normalizeSupplierOrderTransportConfig, loadSupplierOrderTransportConfig } from './transport-config.mjs';
export { serveSupplierOrderHttpsIntake } from './https-intake.mjs';
