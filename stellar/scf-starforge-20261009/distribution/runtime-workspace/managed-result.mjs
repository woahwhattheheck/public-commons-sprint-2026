// MIT. Read-only projection of the original managed command and operation receipts.
// Terminal operation status describes the worker/recovery, not the child exit.
export function managedResult(state, commandResult = null) {
  const hasOperationResult = state?.phase === 'SUCCEEDED' && Object.hasOwn(state, 'result');
  const operationResult = hasOperationResult ? state.result : null;
  const result = commandResult ?? operationResult;
  return {
    result,
    commandResult,
    resultSource: commandResult !== null ? 'command-result.json' :
      hasOperationResult ? 'state.json' : null,
  };
}

export function managedResultUncertain(result) {
  return result?.operation === 'original-command' &&
    (result.state === 'RECONCILED' || result.state === 'OUTCOME_UNAVAILABLE');
}
