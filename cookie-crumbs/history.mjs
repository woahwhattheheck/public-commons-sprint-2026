function keyAddress(entry) {
  if (!entry || typeof entry !== 'object' || Array.isArray(entry)) return null;
  return typeof entry.pubkey === 'string' ? entry.pubkey : null;
}

export function transactionHasSigner(transaction, expectedAddress) {
  const expected = String(expectedAddress ?? '');
  if (!expected) return false;

  const accountKeys = transaction?.transaction?.message?.accountKeys;
  if (!Array.isArray(accountKeys)) return false;

  return accountKeys.some((entry) => (
    entry?.signer === true
    && keyAddress(entry) === expected
  ));
}
