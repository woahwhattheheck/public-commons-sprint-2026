import hashes from './host/connected_sha256.cjs';
import {readMunicipalCsv,writeMunicipalCsv} from './tools/revenue_owner_console_20261010/lead_procurement_waterford_csv.mjs';
import {createDisclosureDesk} from './disclosure_core.mjs';
export const disclosure=createDisclosureDesk({...hashes,readCsv:readMunicipalCsv,writeCsv:writeMunicipalCsv});
