// MIT — programmatic node on the original customer inbox.
'use strict';

const { NodeOperationError } = require('n8n-workflow');
const { executeOperation, errorItem } = require('../../lib/native.cjs');

const intentOperations = ['show', 'enqueuePrepared', 'review', 'recover', 'cancel', 'finalize', 'response'];
const packetOperations = ['inspectHandoff', 'enqueueHandoff'];
const operations = [
  ['List Requests', 'list', 'Read the original saved inbox'],
  ['Show Request', 'show', 'Reopen one original intent and its attempt/result'],
  ['Inspect Merchant Handoff', 'inspectHandoff', 'Read native request identity and offered payment choices'],
  ['Retain Merchant Handoff', 'enqueueHandoff', 'Import and enqueue the selected original merchant request'],
  ['Enqueue Prepared Intent', 'enqueuePrepared', 'Complete intake of an existing native Node operation'],
  ['Enqueue Original Configuration', 'enqueueConfig', 'Retain an existing original configuration and its operator settings'],
  ['Review and Prepare Operator Handoff', 'review', 'Review exact request pins and obtain the original terminal command'],
  ['Recover Saved Evidence', 'recover', 'Read original attempt evidence without another purchase'],
  ['Cancel Unattempted Request', 'cancel', 'Cancel through the original inbox'],
  ['Finalize Original Reservation', 'finalize', 'Continue original financial reconciliation for one intent'],
  ['Read Verified Response', 'response', 'Return original verified bytes or decoded data'],
  ['Export Native History', 'report', 'Download the original private HTML inbox report'],
].map(([name, value, description]) => ({ name, value, description, action: description }));

class StarforgeBuyer {
  constructor() {
    this.description = {
      displayName: 'Starforge Buyer',
      name: 'starforgeBuyer',
      icon: 'file:starforge.svg',
      group: ['transform'],
      version: 1,
      description: 'Retain, review and consume requests through the original Starforge buyer inbox',
      defaults: { name: 'Starforge Buyer' },
      inputs: ['main'], outputs: ['main'],
      usableAsTool: false,
      credentials: [{ name: 'starforgeBuyerWorkspace', required: true }],
      properties: [
        { displayName: 'Operation', name: 'operation', type: 'options', noDataExpression: true,
          options: operations, default: 'list' },
        { displayName: 'Original Intent ID', name: 'intentId', type: 'string', required: true,
          default: '', placeholder: 'The intent returned by native intake',
          displayOptions: { show: { operation: intentOperations } } },
        { displayName: 'Packet Source', name: 'packetSource', type: 'options', default: 'json',
          options: [{ name: 'JSON Value or Text', value: 'json' }, { name: 'Binary Input', value: 'binary' },
            { name: 'Existing Private File', value: 'file' }],
          displayOptions: { show: { operation: packetOperations } } },
        { displayName: 'Merchant Handoff JSON', name: 'packetJson', type: 'json', default: '',
          required: true, description: 'The actual native operation-handoff packet; embedded body and ticket stay bound to its original hashes',
          displayOptions: { show: { operation: packetOperations, packetSource: ['json'] } } },
        { displayName: 'Input Binary Field', name: 'inputBinaryField', type: 'string', default: 'data',
          required: true, displayOptions: { show: { operation: packetOperations, packetSource: ['binary'] } } },
        { displayName: 'Private Handoff File', name: 'packetFile', type: 'string', default: '',
          required: true, displayOptions: { show: { operation: packetOperations, packetSource: ['file'] } } },
        { displayName: 'Selected Payment Option Index', name: 'acceptIndex', type: 'number', default: 0,
          required: true, typeOptions: { minValue: 0, maxValue: 31 },
          description: 'Explicit index from Inspect Merchant Handoff; retains the original offered terms',
          displayOptions: { show: { operation: ['enqueueHandoff'] } } },
        { displayName: 'Original Configuration File', name: 'configFile', type: 'string', default: '',
          required: true, description: 'Absolute private native configuration path; the profile credential does not replace its operator settings',
          displayOptions: { show: { operation: ['enqueueConfig'] } } },
        { displayName: 'Response Format', name: 'responseFormat', type: 'options', default: 'binary',
          options: [{ name: 'Binary File', value: 'binary' }, { name: 'JSON Value', value: 'json' },
            { name: 'CSV Records', value: 'csv' }, { name: 'NDJSON Records', value: 'ndjson' },
            { name: 'SSE Events', value: 'sse' }],
          displayOptions: { show: { operation: ['response'] } } },
        { displayName: 'Merchant Route', name: 'merchantRoute', type: 'string', default: '',
          description: 'Use only when the workspace credential selects the matching original merchant outbox',
          displayOptions: { show: { operation: ['finalize'] } } },
        { displayName: 'Options', name: 'options', type: 'collection', placeholder: 'Add Option', default: {},
          options: [
            { displayName: 'Output Binary Field', name: 'outputBinaryField', type: 'string', default: 'data' },
            { displayName: 'Download Filename', name: 'filename', type: 'string', default: '',
              description: 'Optional basename for a verified binary response' },
            { displayName: 'Read Limit (Bytes)', name: 'readLimit', type: 'number', default: 8388608,
              typeOptions: { minValue: 0, maxValue: 67108864 },
              description: 'Maximum retained response/report bytes loaded into n8n; does not change native capture or spend' },
            { displayName: 'CSV Has Header Row', name: 'csvHeaders', type: 'boolean', default: true },
            { displayName: 'Maximum Records', name: 'maxRecords', type: 'number', default: 10000,
              typeOptions: { minValue: 1, maxValue: 1000000 } },
            { displayName: 'Maximum Stream Record Bytes', name: 'maxRecordBytes', type: 'number', default: 1048576,
              typeOptions: { minValue: 1, maxValue: 67108864 } },
            { displayName: 'Read Retained Partial Stream', name: 'allowPartial', type: 'boolean', default: false,
              description: 'Whether to consume only native verified complete records from a retained partial NDJSON/SSE response' },
            { displayName: 'Response Capture Limit at Intake (Bytes)', name: 'responseMaxBytes', type: 'number',
              default: 67108864, typeOptions: { minValue: 0, maxValue: 1073741824 },
              description: 'Optional original native capture option for a new handoff; immutable after intake' },
            { displayName: 'History Report Filename', name: 'reportFilename', type: 'string', default: '',
              description: 'New HTML basename; empty uses this execution ID and an existing name is never replaced' },
          ] },
      ],
    };
  }

  async execute() {
    const items = this.getInputData();
    const output = [];
    const credentials = await this.getCredentials('starforgeBuyerWorkspace');
    for (let index = 0; index < items.length; index++) {
      const operation = this.getNodeParameter('operation', index);
      let intentId;
      try {
        const options = this.getNodeParameter('options', index, {});
        const params = { ...options };
        const outputBinaryField = options.outputBinaryField || 'data';
        if (typeof outputBinaryField !== 'string' || !/^[A-Za-z_][A-Za-z0-9_]{0,63}$/.test(outputBinaryField)) {
          const error = new Error('OUTPUT_BINARY_FIELD_INVALID'); error.code = error.message; throw error;
        }
        if (intentOperations.includes(operation)) {
          intentId = this.getNodeParameter('intentId', index);
          params.intentId = intentId;
        }
        if (packetOperations.includes(operation)) {
          params.packetSource = this.getNodeParameter('packetSource', index);
          if (params.packetSource === 'binary') {
            const field = this.getNodeParameter('inputBinaryField', index);
            params.packetBytes = await this.helpers.getBinaryDataBuffer(index, field);
          } else if (params.packetSource === 'file') {
            params.packetFile = this.getNodeParameter('packetFile', index);
          } else {
            params.packetJson = this.getNodeParameter('packetJson', index);
          }
        }
        if (operation === 'enqueueHandoff') params.acceptIndex = this.getNodeParameter('acceptIndex', index);
        if (operation === 'enqueueConfig') params.configFile = this.getNodeParameter('configFile', index);
        if (operation === 'response') params.responseFormat = this.getNodeParameter('responseFormat', index);
        if (operation === 'finalize') params.merchantRoute = this.getNodeParameter('merchantRoute', index, '');
        const result = await executeOperation(credentials, operation, params, {
          executionId: typeof this.getExecutionId === 'function' ? this.getExecutionId() : undefined,
          signal: typeof this.getExecutionCancelSignal === 'function'
            ? this.getExecutionCancelSignal() : undefined,
        });
        const item = { json: result.json, pairedItem: { item: index } };
        if (result.binary) {
          item.binary = {
            [outputBinaryField]: await this.helpers.prepareBinaryData(result.binary.data,
              result.binary.fileName, result.binary.mimeType),
          };
        }
        output.push(item);
      } catch (error) {
        const saved = errorItem(error, operation, intentId);
        if (this.continueOnFail()) {
          output.push({ json: saved, pairedItem: { item: index } });
          continue;
        }
        const description = saved.intentId
          ? 'Original intent ' + saved.intentId + ' is retained. Use Show Request to inspect its state before choosing a continuation.'
          : 'Inspect the configured original workspace and input. Native private logs are not included in this message.';
        const failure = new NodeOperationError(this.getNode(), saved.error.code, {
          itemIndex: index, description,
        });
        failure.context = { ...(failure.context || {}), ...saved };
        throw failure;
      }
    }
    return [output];
  }
}
module.exports = { StarforgeBuyer };
