console.log(JSON.stringify({
  state: 'HOLD',
  reason: 'The production evaluator requires a branded, non-serializable host capability built only after provider/readback verification. Untrusted JSON cannot mint runtime authority.',
  directPolicyAuthority: false,
  callerRelativeClock: false,
  serializedAuthorityAccepted: false,
  paymentAuthority: false,
}, null, 2));
