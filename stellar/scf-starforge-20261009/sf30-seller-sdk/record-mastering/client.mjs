// MIT. Native client: no subprocess, remote provider or separate decision engine.
import { readFileSync } from 'node:fs';
import { MasteringWorkspace, ensure, sha256 } from './core.mjs';
import { workspacePacket, deliveryPacket, createFile, receiveWorkspace, receiveDelivery, workspaceFile, receiveWorkspaceFile } from './portable.mjs';
export class RecordMasteringClient {
    constructor({ directory, create = false, title } = {}) { this.workspace = new MasteringWorkspace(directory, { create, title }); }
    invoke(action, input = {}) { return this.workspace.invoke(action, input); }
    inspect(file) { return this.workspace.inspectCSV(readFileSync(file)); }
    import(file, input) { const bytes = readFileSync(file); return this.workspace.importSource({ ...input, base64: bytes.toString('base64'), sha256: input.sha256 ?? sha256(bytes) }); }
    export(output) { return workspaceFile(this.workspace,output); }
    deliver(deliveryId, output) { return createFile(output, deliveryPacket(this.workspace, deliveryId)); }
    close() { this.workspace.close(); }
    static receiveFile(file,directory,options={}) { return receiveWorkspaceFile(file,directory,options); }
    static receive(file, directory, expectedSha256) { return receiveWorkspace(readFileSync(file), directory, { expectedSha256 }); }
    static unpackDelivery(file, directory, expectedSha256) { return receiveDelivery(readFileSync(file), directory, { expectedSha256 }); }
}
export { MasteringWorkspace, workspacePacket, deliveryPacket, receiveWorkspace, receiveDelivery, workspaceFile, receiveWorkspaceFile };
