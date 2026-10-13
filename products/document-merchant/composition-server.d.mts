import type {DocumentProviderId} from './index.mjs';
import type {DocumentCompositionRequest} from './composition.mjs';
import type {DocumentCompositionWorkspace,DocumentUploadedSource} from './composition-workspace.mjs';
import type {JobWorkspaceExtension} from '../../stellar/scf-starforge-20261009/sf88-operator-buyer-cli/job-workspace/index.mjs';
export function documentCompositionExample(kind?:'orders'|'grouped'|'reports',provider?:DocumentProviderId,
  options?:{merchantOrigin?:string|null}):Promise<{
    example:true;request:DocumentCompositionRequest;dataset:DocumentUploadedSource;
    templates:Record<string,DocumentUploadedSource>;
  }>;
export function documentCompositionExtension(controller:DocumentCompositionWorkspace):Promise<JobWorkspaceExtension>;
