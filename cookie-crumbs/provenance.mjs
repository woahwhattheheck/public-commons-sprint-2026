function publicKeyText(value) {
  if (typeof value === 'string') return value;
  if (value && typeof value.toBase58 === 'function') return value.toBase58();
  if (value && typeof value.toString === 'function') return value.toString();
  return '';
}

export function transactionSignedBy(parsedTransaction, expectedSigner) {
  const expected = publicKeyText(expectedSigner);
  if (!expected) return false;
  const keys = parsedTransaction?.transaction?.message?.accountKeys;
  if (!Array.isArray(keys)) return false;

  return keys.some((entry) => {
    if (!entry || typeof entry !== 'object' || entry.signer !== true) return false;
    return publicKeyText(entry.pubkey) === expected;
  });
}

export const __test = Object.freeze({ publicKeyText });
