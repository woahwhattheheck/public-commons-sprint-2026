"use strict";
/**
 * Complete repeatable local operator portfolio for Leap DEVICE interval delivery.
 * No credential, provider request, actual partner account, or customer telemetry.
 * The caller supplies the original UTF-8 hasher; generation is pure and portable.
 */
function buildFunctionalInput({directory, hashUtf8}) {
  if (typeof directory !== "string" || !directory.startsWith("/") || directory.includes("\0") ||
      directory.split("/").includes("..")) throw TypeError("Use one absolute private input directory.");
  if (typeof hashUtf8 !== "function") throw TypeError("Supply the original UTF-8 SHA-256 function.");
  const root = directory.replace(/\/+$/, "");
  const files = {};
  const account = "FUNCTIONAL-RECEIVING-ACCOUNT";
  const referenceUuid = "5be80922-2345-4ed8-ae70-e7d8114cd2a3";
  const meterUuid = device => "00000000-0000-4000-8000-" + String(device).padStart(12, "0");
  const sourceMeter = device => "functional-device-" + String(device).padStart(2, "0");
  const field = value => {
    const text = String(value);
    return /[",\r\n]/.test(text) ? '"' + text.replace(/"/g, '""') + '"' : text;
  };
  const csv = rows => rows.map(row => row.map(field).join(",")).join("\n") + "\n";
  const money = n => (n < 0 ? "-" : "") + Math.floor(Math.abs(n) / 100) + "." +
    String(Math.abs(n) % 100).padStart(2, "0");
  const iso = value => new Date(value).toISOString().replace(".000Z", "Z");
  const asJson = value => JSON.stringify(value, null, 2) + "\n";
  const columns = ["meter_id","series_id","channel","start_utc","end_utc",
    "duration_seconds","energy_kwh","source_row_id"];
  const roles = [
    {series:"consumed-kwh",channel:"forward",target:"energy_consumed_kwh"},
    {series:"generated-kwh",channel:"reverse",target:"energy_generated_kwh"},
    {series:"net-kwh",channel:"net",target:"energy_net_kwh"}
  ];
  const original = [["meter_id","interval_start_time_utc","interval_end_time_utc",
    "energy_net_kwh","energy_consumed_kwh","energy_generated_kwh"],
    [referenceUuid,"2024-04-01T11:00:00Z","2024-04-01T11:15:00Z","","5.01","0"]];
  files["Leap_Published_2024_Load_Example.csv"] = csv(original);
  const good = [columns], bad = [columns];
  const start = Date.parse("2026-10-05T00:00:00Z");
  let negativeNet = 0, zeroGenerated = 0;
  for (let device = 1; device <= 8; device++) {
    for (let slot = 0; slot < 4 * 96; slot++) {
      const consumed = 180 + device * 7 + slot % 37;
      const generated = slot % 12 === 0 ? consumed + 45 : slot % 9 === 0 ? 0 : 35 + slot % 19;
      const net = consumed - generated;
      if (net < 0) negativeNet++;
      if (generated === 0) zeroGenerated++;
      for (let role = 0; role < roles.length; role++) {
        const spec = roles[role];
        const row = [sourceMeter(device),spec.series,spec.channel,
          iso(start + slot * 900000),iso(start + (slot + 1) * 900000),900,
          money([consumed,generated,net][role]),
          "functional-device-" + device + "-slot-" + slot + "-" + spec.series];
        good.push(row);
        const incorrect = row.slice();
        if (device === 3 && slot === 17 && role === 1) incorrect[6] = money(generated + 1);
        bad.push(incorrect);
      }
    }
  }
  bad.push(good[1].slice());
  files["TJL_Functional_Device_Profile_Original_With_Issues.csv"] = csv(bad);
  files["TJL_Functional_Device_Profile_Complete_Correction.csv"] = csv(good);
  const evidence = {
    schema:"tjl.leap-functional-input-evidence.v1",
    operationId:"LEAP-DEVICE-INTERVAL-DELIVERY-20261012",
    purpose:"Local application receiving and complete correction/export/restore demonstration.",
    authoredBy:"TokenJunkieLabs",
    partnerAccount:{value:account,kind:"Explicit local functional label"},
    deviceIdentity:{
      reference:{uuid:referenceUuid,origin:"Literal UUID in the public Leap SFTP guide example"},
      functional:{range:"00000000-0000-4000-8000-000000000001 through 00000000-0000-4000-8000-000000000008",
        kind:"TJL-authored local example identifiers"}
    },
    sourceReference:{
      url:"https://developer.leap.energy/docs/upload-interval-data-sftp",
      retrievedAt:"2026-10-12",
      publishedDataString:{
        meter_id:referenceUuid,interval_start_time_utc:"2024-04-01T11:00:00Z",
        interval_end_time_utc:"2024-04-01T11:15:00Z",energy_net_kwh:"",
        energy_consumed_kwh:"5.01",energy_generated_kwh:"0"
      },
      extraction:"The CSV contains the published data_string fields with UTF-8/LF encoding and presentation indentation removed; it is an extraction from documentation.",
      retainedHistoricalDate:"The April 2024 timestamps remain unchanged and receive the current application's two-calendar-year age validation."
    },
    ownershipAssumptions:{
      reference:{start_utc:"2024-01-01T00:00:00Z",end_utc:"2027-01-01T00:00:00Z"},
      functional:{start_utc:"2026-01-01T00:00:00Z",end_utc:"2027-01-01T00:00:00Z"},
      kind:"Local functional assumptions attached to the mapping; these represent no actual account custody or creation-channel evidence."
    },
    portfolio:{
      firstStartUtc:"2026-10-05T00:00:00Z",lastEndUtc:"2026-10-09T00:00:00Z",
      devices:8,days:4,intervalSeconds:900,intervals:3072,energyChannels:3,
      completeSourceRows:9216,originalSourceRowsWithIssues:9217,
      mappingEntries:24,negativeNetIntervals:negativeNet,zeroGeneratedIntervals:zeroGenerated,
      exactGeneration:"Integer hundredths: consumed=180+device*7+slot%37; generated=consumed+45 when slot%12=0, otherwise zero when slot%9=0, otherwise 35+slot%19; net=consumed-generated.",
      originalIssues:[
        {kind:"Exact energy balance",sourceMeter:"functional-device-03",slot:17,
          change:"Generated channel increased by 0.01 kWh with original net retained"},
        {kind:"Duplicate complete device/interval/channel",change:"First consumed source row appended unchanged"}
      ],
      correction:"The complete corrected edition contains all 9,216 source rows and retains the rejected edition through correctionOfKey."
    },
    providerActions:[],
    receivingExpectation:{
      historicalExample:{status:"VALIDATION_FAILED",row_count:1,issue_count:2,meter_count:1},
      originalFunctional:{status:"VALIDATION_FAILED",row_count:3072,issue_count:2,meter_count:8},
      correctedFunctional:{status:"PREPARED",row_count:3072,issue_count:0,meter_count:8},
      dateBasis:"Expectations are for the actual October 12, 2026 receiving date. The program uses the actual application clock. Future receivers review time eligibility against that clock."
    }
  };
  files["TJL_Functional_Input_Evidence.json"] = asJson(evidence);
  const metadata = (name,format,purpose) => {
    const hash = hashUtf8(files[name]);
    if (!hash || !Number.isSafeInteger(hash.bytes) || !/^[a-f0-9]{64}$/.test(hash.sha256))
      throw TypeError("Hasher did not return complete UTF-8 byte length and SHA-256.");
    return {path:root + "/" + name,name,format,bytes:hash.bytes,sha256:hash.sha256,purpose};
  };
  const reference = metadata("Leap_Published_2024_Load_Example.csv","leap-load",
    "Exact fields extracted from the historical published example, retained with original dates.");
  const invalid = metadata("TJL_Functional_Device_Profile_Original_With_Issues.csv","utility-profile",
    "TJL-authored functional portfolio: complete original edition with a balance error and duplicate.");
  const corrected = metadata("TJL_Functional_Device_Profile_Complete_Correction.csv","utility-profile",
    "TJL-authored complete correction of the original functional portfolio.");
  const retainedEvidence = metadata("TJL_Functional_Input_Evidence.json","evidence",
    "Public example provenance and explicit local functional identity/custody assumptions.");
  const mapping = (name,ownership,entries) => ({
    schema:"stellar-forge.leap-interval-mapping.v1",name,environment:"staging",
    partner_account_id:account,reviewer:"TJL internal functional receiving",
    ownership_evidence_source_id:retainedEvidence.sha256,ownership,entries
  });
  const ownership = [], entries = [];
  for (let device = 1; device <= 8; device++) {
    ownership.push({meter_id:meterUuid(device),...evidence.ownershipAssumptions.functional});
    for (const role of roles) entries.push({
      source_meter_id:sourceMeter(device),source_series_id:role.series,source_channel:role.channel,
      leap_meter_id:meterUuid(device),target_column:role.target
    });
  }
  const input = {
    configuration:{environment:"staging",partner_account_id:account,token_env:"LEAP_API_TOKEN"},
    sources:[reference,invalid,corrected,retainedEvidence],
    mappings:[
      {key:"published-historical",value:mapping("Published historical Leap example",
        [{meter_id:referenceUuid,...evidence.ownershipAssumptions.reference}],[])},
      {key:"functional-eight-device",value:mapping("TJL functional eight-device mapping",ownership,entries)}
    ],
    batches:[
      {key:"published-historical",mappingKey:"published-historical",
        prepare:{name:"Published April 2024 example, original dates",source_ids:[reference.sha256]},
        expected:evidence.receivingExpectation.historicalExample,providerActions:[]},
      {key:"functional-original",mappingKey:"functional-eight-device",
        prepare:{name:"TJL functional portfolio, complete original edition",source_ids:[invalid.sha256]},
        expected:evidence.receivingExpectation.originalFunctional,providerActions:[]},
      {key:"functional-corrected",mappingKey:"functional-eight-device",
        prepare:{name:"TJL functional portfolio, complete corrected edition",source_ids:[corrected.sha256]},
        correctionOfKey:"functional-original",
        expected:evidence.receivingExpectation.correctedFunctional,providerActions:[]}
    ],
    deliveryBatchKey:"functional-corrected"
  };
  files["leap-functional-input.json"] = asJson(input);
  const manifest = {
    schema:"tjl.leap-functional-input-manifest.v1",
    operationId:evidence.operationId,directory:root,
    files:Object.entries(files).map(([name,value])=>({name,...hashUtf8(value)})),
    portfolio:evidence.portfolio
  };
  files["leap-functional-manifest.json"] = asJson(manifest);
  return {files,input,manifest};
}
module.exports = {buildFunctionalInput};
