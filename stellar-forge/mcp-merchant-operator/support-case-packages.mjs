// MIT. Installed Support adapter for its existing complete case/source engine.
import {join} from 'node:path';
import {createCaseSourceDelivery} from '../../stellar/scf-starforge-20261009/sf74-merchant-support-console/case-source-delivery.mjs';
import {openCasePackageOperations,defaultCasePackagesDirectory} from '../../stellar/scf-starforge-20261009/sf74-merchant-support-console/case-package-operations.mjs';
import {openHandoffDesk} from '../../stellar/scf-starforge-20261009/sf74-merchant-support-console/handoff-store.mjs';

export async function openMerchantCasePackages({config,store,environment=process.env}) {
  const support=config.support;let sources,handoffs,operations,primary;
  try {
    sources=await createCaseSourceDelivery({store,
      directory:support.sourceDirectory??join(support.casesDirectory,'source-bundles'),
      python:environment.SCF_PYTHON??'python3',environment});
    handoffs=support.packageSourcesFile?await openHandoffDesk({configPath:support.packageSourcesFile,
      casesDir:support.casesDirectory,environment}):null;
    operations=await openCasePackageOperations({store,casesDirectory:support.casesDirectory,
      directory:support.packagesDirectory??defaultCasePackagesDirectory(support.casesDirectory),
      sourceDelivery:sources,handoffDesk:handoffs,python:environment.SCF_PYTHON??'python3',environment});
  } catch(problem) {
    primary=problem;await Promise.allSettled([operations?.close(),sources?.close(),handoffs?.close()]);throw primary;
  }
  let closed=null;
  return Object.freeze({
    summary:()=>operations.catalog(),
    async call(name,args={}) {
      switch(name) {
        case 'merchant_case_package_catalog': return operations.catalog();
        case 'merchant_case_package_operations': return operations.list(args);
        case 'merchant_case_package_inputs': return operations.listInputs(args);
        case 'merchant_case_package_status': return operations.status(args.id);
        case 'merchant_case_package_prepare': return operations.prepare(args);
        case 'merchant_case_package_run': return operations.run(args.id);
        case 'merchant_case_package_pause': return operations.stop(args.id);
        case 'merchant_case_package_inventory': return operations.inventory(args);
        case 'merchant_case_package_remote_inspect': return operations.inspectRemote(args);
        case 'merchant_case_package_open': return operations.receivedCase(args.id);
        case 'merchant_case_package_file': return operations.readFile(args);
        case 'merchant_case_package_original_file': return operations.readOriginal(args);
        case 'merchant_case_package_file_release': return operations.release(args);
        case 'merchant_case_package_export_manifest': return operations.exportManifest(args.exportId);
        case 'merchant_case_package_export_file': return operations.exportFile(args);
        case 'merchant_case_package_export_file_release':
          await operations.release({source:{kind:'operation',id:args.exportId},readId:args.readId});
          return {exportId:args.exportId,readId:args.readId,released:true};
        default: throw Object.assign(new Error('Unknown original package operation.'),{code:'TOOL_NOT_FOUND'});
      }
    },
    close() {
      if(closed)return closed;
      closed=(async()=>{
        await operations.close();
        const outcomes=await Promise.allSettled([sources.close(),handoffs?.close()]);
        const failures=outcomes.filter(value=>value.status==='rejected');
        if(failures.length)throw new AggregateError(failures.map(value=>value.reason),'Original package owners did not finish closing.');
      })().catch(problem=>{closed=null;throw problem;});
      return closed;
    }
  });
}
