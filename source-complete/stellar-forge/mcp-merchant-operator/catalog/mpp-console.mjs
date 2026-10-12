// MIT. Original tool metadata; provider runtimes load only when selected.
import { mppFileTools } from './mpp-files.mjs';
import { MAX_MPP_CHUNK_BYTES } from '../mpp-contracts.mjs';

const consoleSchema={type:'string',pattern:'^[a-z][a-z0-9_-]{0,63}$'};

const digestSchema={type:'string',pattern:'^[a-f0-9]{64}$'};

const purchaseSchema={type:'string',pattern:'^[A-Za-z0-9][A-Za-z0-9_.:-]{0,95}$'};

const querySchema={type:'object',additionalProperties:{oneOf:[{type:'string'},{type:'array',items:{type:'string'}}]}};

const inputSchema={type:'object',additionalProperties:false,properties:{query:querySchema,json:{}}};

const rangeSchema={offset:{type:'integer',minimum:0},limit:{type:'integer',minimum:1,maximum:MAX_MPP_CHUNK_BYTES}};

const read={readOnly:true,idempotent:true,openWorld:false};

const change={destructive:false,idempotent:false,openWorld:false};

const worldRead={...read,openWorld:true};

const worldChange={...change,openWorld:true};

const selected={console:consoleSchema};

function mppTools(tool) {
  return [
    ...mppFileTools(tool),
    tool('merchant_mpp_export','Retain exact original paid response or merchant handoff bytes for the maintained resumable MCP downloader. Reopen the same exportId after an interrupted reply.',
      {...selected,exportId:{type:'string',pattern:'^[a-z0-9][a-z0-9_-]{0,63}$'},
        kind:{type:'string',enum:['response','contract','openapi','package']},purchaseId:purchaseSchema,
        profileId:digestSchema,expectedSha256:digestSchema},
      ['console','exportId','kind','expectedSha256'],change),
    tool('merchant_mpp_consoles','List host-declared native MPP consoles and customer configuration aliases. Credentials and executable paths stay on the host.',{},[],read),
    tool('merchant_mpp_status','Read current native customer selection and original paged purchase history while preparation or terminal approval continues.',
      {...selected,offset:{type:'integer',minimum:0},limit:{type:'integer',minimum:1,maximum:100}},['console'],read),
    tool('merchant_mpp_contract','Read a public merchant contract through the original console and this host-selected customer transport. Return its terms and changes for a retained customer review.',
      {...selected,customer:consoleSchema,origin:{type:'string'}},['console','customer','origin'],worldRead),
    tool('merchant_mpp_customer_review','Retain an exact original customer review from a contract or complete customer bundle, using a host-declared customer configuration and the current native revision. Reopen the same reviewId after an interrupted reply.',
      {...selected,customer:consoleSchema,reviewId:purchaseSchema,document:{type:'object'}},
      ['console','customer','reviewId','document'],change),
    tool('merchant_mpp_customer_review_status','Reopen the original customer review and compare its exact profile/revision with the current console. The private original review survives MCP restart.',
      {...selected,reviewId:purchaseSchema},['console','reviewId'],read),
    tool('merchant_mpp_customer_configure','Apply the exact retained customer review and revision. Inspect review_status after interruption; an already selected identical original profile is recovered without another write.',
      {...selected,reviewId:purchaseSchema,expectedReviewSha256:digestSchema},
      ['console','reviewId','expectedReviewSha256'],change),
    tool('merchant_mpp_preview','Preview the exact offer, atomic price, cap, HTTP method, full URL and JSON body under the current native customer profile.',
      {...selected,profileId:digestSchema,offerId:purchaseSchema,inputs:inputSchema},
      ['console','profileId','offerId'],read),
    tool('merchant_mpp_prepare','Queue one original native 402 preparation using a stable purchaseId. The console retains the original profile and request before network preparation. Read the job or original purchase after interruption.',
      {...selected,profileId:digestSchema,offerId:purchaseSchema,purchaseId:purchaseSchema,
        query:querySchema,json:{},challengeId:{type:'string',minLength:1,maxLength:512}},
      ['console','profileId','offerId','purchaseId'],worldChange),
    tool('merchant_mpp_retry_prepare','Retry the same retained original preparation after transport loss, including after the active customer profile changes.',
      {...selected,purchaseId:purchaseSchema},['console','purchaseId'],worldChange),
    tool('merchant_mpp_execute','Queue the original purchase through the console host: exact SF36 terminal approval and reservation, official MPP pull credential, original delivery and SF86 finality accounting. Read the original job and purchase ID.',
      {...selected,purchaseId:purchaseSchema},['console','purchaseId'],worldChange),
    tool('merchant_mpp_resume','Recover the original retained purchase and signed credential after an interrupted payment or response. Uses the original contract, request and accounting record.',
      {...selected,purchaseId:purchaseSchema},['console','purchaseId'],worldChange),
    tool('merchant_mpp_finalize','Reconcile the original transaction through SF86 and the original SF36 reservation. Returns a native background job ID.',
      {...selected,purchaseId:purchaseSchema},['console','purchaseId'],worldChange),
    tool('merchant_mpp_job','Read one original console job. Supply purchaseId to reopen its retained purchase when the console has restarted and the transient job is no longer present.',
      {...selected,jobId:{type:'string',pattern:'^[a-f0-9-]{36}$'},purchaseId:purchaseSchema},
      ['console','jobId'],read),
    tool('merchant_mpp_purchase','Read one retained original purchase or interrupted preparation directly, including its original contract and current response/finality state.',
      {...selected,purchaseId:purchaseSchema},['console','purchaseId'],read),
    tool('merchant_mpp_response_preview','Inspect a retained paid response, its original receipt, transaction, accounting result and SHA256 before downloading its exact bytes.',
      {...selected,purchaseId:purchaseSchema},['console','purchaseId'],read),
    tool('merchant_mpp_response_file','Read SHA-pinned chunks of the original retained paid response. Continue with its exact expectedSha256 and nextOffset; retrieval uses no payment operation.',
      {...selected,purchaseId:purchaseSchema,expectedSha256:digestSchema,...rangeSchema},
      ['console','purchaseId','expectedSha256'],read),
    tool('merchant_mpp_catalog','Read the original active or saved native merchant contract and profile identity for customer handoff.',
      selected,['console'],read),
    tool('merchant_mpp_handoff_file','Read original contract, OpenAPI or complete Node/TypeScript/Python customer bundle bytes for an exact merchant profile. Retain the first SHA256 for every following chunk.',
      {...selected,kind:{type:'string',enum:['contract','openapi','package']},profileId:digestSchema,
        expectedSha256:digestSchema,...rangeSchema},['console','kind','profileId'],read)
  ];
}

export { mppTools, selected, purchaseSchema, digestSchema, change, read, consoleSchema, worldRead, inputSchema, querySchema, worldChange, rangeSchema };
