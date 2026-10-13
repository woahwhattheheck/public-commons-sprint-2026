// MIT. Use the existing managed curriculum owner and original workbench.
import {defineMerchantProvider,MERCHANT_PROVIDER_SCHEMA} from '../../stellar-forge/mcp-merchant-operator/provider-contract.mjs';
import {curriculumMigrationTools} from './catalog.mjs';
export default defineMerchantProvider({
 schema:MERCHANT_PROVIDER_SCHEMA,id:'curriculum-migration-workspaces',family:'curriculumMigration',title:'Curriculum migration workbench',
 order:1200,catalogOrder:1200,configKey:'curriculumMigration',summary:true,dependencies:[],concurrency:'provider',maxRequestBytes:8*1024*1024,
 configuration:{input:'curriculumMigrationConnection',privateExports:true,read:(value,{hostPath})=>import('./merchant.mjs').then(m=>m.readCurriculumMigrationConfiguration(hostPath(value)))},
 tools:curriculumMigrationTools,
 instructions:[{order:1200,prefix:'merchant_curriculum_migration_',text:'Select the configured physical store ID/directory, physical branch and expected portable workspaceId/revision/snapshotSha256. These tools apply only the original workbench model and curriculum operations. Preserve complete source editions, original/candidate provenance, field/occurrence mapping reasons and actual decisions; no external API acquisition is implicit. Keep generated32-operation Oak API files separate from this managed workspace client. GraphQL relation names do not establish absent field/relationship metadata. Reconcile an uncertain mutation through its original request UUID before exact replay, preserving every original argument. Page complete records/history and read every retained-file chunk. Receiving creates a new physical branch; original repeated requests do not replace later receiver edits.'}],
 load:()=>import('./merchant.mjs'),create:(module,config)=>new module.MerchantCurriculumMigration(config)
});
