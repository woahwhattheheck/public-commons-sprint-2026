import { fail, sha256 } from './json.mjs';
import { parseRetainedDateMs } from './clock.mjs';
import { editDistanceAtMostOne, safeSignedAdd } from './validation.mjs';

const cmp = (a, b) => a < b ? -1 : a > b ? 1 : 0;

function exactKey(row) { return `${row.canonicalRef}\u001f${row.rowType}`; }
function absSafe(value) {
  const result = value < 0 ? -BigInt(value) : BigInt(value);
  if (result > BigInt(Number.MAX_SAFE_INTEGER)) fail('MONEY_OVERFLOW');
  return Number(result);
}
function retainedDaysBetween(a, b) {
  return Math.abs(parseRetainedDateMs(`${a}T00:00:00Z`) - parseRetainedDateMs(`${b}T00:00:00Z`)) / 86_400_000;
}

function queueSort(a, b) {
  return b.severity - a.severity ||
    cmp(a.kind, b.kind) ||
    cmp(a.documentRef, b.documentRef) ||
    cmp(a.statementRowId ?? '', b.statementRowId ?? '') ||
    cmp(a.ledgerRowId ?? '', b.ledgerRowId ?? '');
}

function exceptionBase(kind, severity, scope, extras = {}) {
  return {
    kind,
    severity,
    supplierRef: scope.supplierRef,
    currency: scope.currency,
    periodEnd: scope.periodEnd,
    ...extras,
  };
}

export function reconcile(normalized) {
  const statementByKey = new Map(normalized.statement.rows.map(row => [exactKey(row), row]));
  const ledgerByKey = new Map(normalized.ledger.rows.map(row => [exactKey(row), row]));
  const scope = {
    supplierRef: normalized.statement.supplierRef,
    currency: normalized.statement.currency,
    periodEnd: normalized.statement.periodEnd,
  };
  const queue = [];
  const missingStatement = [];
  const missingLedger = [];
  let exactMatches = 0;
  let amountVariances = 0;

  for (const [key, statementRow] of statementByKey) {
    const ledgerRow = ledgerByKey.get(key);
    if (!ledgerRow) {
      missingLedger.push(statementRow);
      const kind = statementRow.rowType === 'CREDIT' ? 'SUPPLIER_CREDIT_NOT_IN_LEDGER_REVIEW' : 'SUPPLIER_ITEM_NOT_IN_LEDGER_REVIEW';
      queue.push(exceptionBase(kind, kind === 'SUPPLIER_CREDIT_NOT_IN_LEDGER_REVIEW' ? 100 : 80, scope, {
        documentRef: statementRow.canonicalRef,
        rowType: statementRow.rowType,
        statementRowId: statementRow.statementRowId,
        ledgerRowId: null,
        statementEffectMinor: statementRow.effectMinor,
        ledgerEffectMinor: null,
        reviewMagnitudeMinor: absSafe(statementRow.effectMinor),
        factuality: 'SUPPLIED_STATEMENT_ITEM_ABSENT_FROM_SUPPLIED_LEDGER_GENERATION',
        reason: statementRow.rowType === 'CREDIT'
          ? 'A supplier-statement credit is absent from the supplied complete AP-ledger generation. Owner review is required; this is not an entitlement, refund, receivable, savings, or recovered cash.'
          : 'A supplier-statement item is absent from the supplied complete AP-ledger generation. Owner review is required before any AP action.',
      }));
      continue;
    }
    if (statementRow.effectMinor === ledgerRow.effectMinor) {
      exactMatches += 1;
      continue;
    }
    amountVariances += 1;
    const delta = safeSignedAdd([statementRow.effectMinor, -ledgerRow.effectMinor]);
    queue.push(exceptionBase('AMOUNT_VARIANCE_REVIEW', 90, scope, {
      documentRef: statementRow.canonicalRef,
      rowType: statementRow.rowType,
      statementRowId: statementRow.statementRowId,
      ledgerRowId: ledgerRow.ledgerRowId,
      statementEffectMinor: statementRow.effectMinor,
      ledgerEffectMinor: ledgerRow.effectMinor,
      varianceMinor: delta,
      reviewMagnitudeMinor: absSafe(delta),
      factuality: 'SAME_CANONICAL_DOCUMENT_AND_TYPE_WITH_DIFFERENT_SUPPLIED_EFFECTS',
      reason: 'The supplied complete generations agree on canonical document reference and row type but disagree on signed minor-unit effect. No side is auto-selected as authoritative.',
    }));
  }

  for (const [key, ledgerRow] of ledgerByKey) {
    if (statementByKey.has(key)) continue;
    missingStatement.push(ledgerRow);
    queue.push(exceptionBase('LEDGER_ITEM_NOT_ON_STATEMENT_REVIEW', 70, scope, {
      documentRef: ledgerRow.canonicalRef,
      rowType: ledgerRow.rowType,
      statementRowId: null,
      ledgerRowId: ledgerRow.ledgerRowId,
      statementEffectMinor: null,
      ledgerEffectMinor: ledgerRow.effectMinor,
      reviewMagnitudeMinor: absSafe(ledgerRow.effectMinor),
      factuality: 'SUPPLIED_LEDGER_ITEM_ABSENT_FROM_SUPPLIED_STATEMENT_GENERATION',
      reason: 'An internal AP-ledger item is absent from the supplied complete supplier-statement generation. Owner review is required; this tool does not reverse, write off, or mutate it.',
    }));
  }

  const balanceVarianceMinor = safeSignedAdd([normalized.statement.closingBalanceMinor, -normalized.ledger.closingBalanceMinor]);
  if (balanceVarianceMinor !== 0) {
    queue.push(exceptionBase('BALANCE_VARIANCE_REVIEW', 95, scope, {
      documentRef: 'CLOSING-BALANCE',
      rowType: 'BALANCE',
      statementRowId: null,
      ledgerRowId: null,
      statementEffectMinor: normalized.statement.closingBalanceMinor,
      ledgerEffectMinor: normalized.ledger.closingBalanceMinor,
      varianceMinor: balanceVarianceMinor,
      reviewMagnitudeMinor: absSafe(balanceVarianceMinor),
      factuality: 'SUPPLIED_COMPLETE_GENERATIONS_HAVE_DIFFERENT_CLOSING_BALANCES',
      reason: 'The supplied complete statement and AP-ledger generations have different closing balances for the same supplier/currency/period boundary. This is a reconciliation exception, not cash, savings, profit, or revenue.',
    }));
  }

  let possibleMatches = 0;
  if (normalized.policy.enablePossibleMatchReview) {
    for (const statementRow of missingLedger) {
      for (const ledgerRow of missingStatement) {
        if (statementRow.rowType !== ledgerRow.rowType || statementRow.effectMinor !== ledgerRow.effectMinor) continue;
        if (retainedDaysBetween(statementRow.eventDate, ledgerRow.eventDate) > normalized.policy.possibleMatchDateWindowDays) continue;
        if (!editDistanceAtMostOne(statementRow.canonicalRef, ledgerRow.canonicalRef)) continue;
        possibleMatches += 1;
        queue.push(exceptionBase('POSSIBLE_MATCH_REVIEW', 30, scope, {
          documentRef: `${statementRow.canonicalRef} ~ ${ledgerRow.canonicalRef}`,
          rowType: statementRow.rowType,
          statementRowId: statementRow.statementRowId,
          ledgerRowId: ledgerRow.ledgerRowId,
          statementEffectMinor: statementRow.effectMinor,
          ledgerEffectMinor: ledgerRow.effectMinor,
          reviewMagnitudeMinor: absSafe(statementRow.effectMinor),
          factuality: 'HEURISTIC_REVIEW_ONLY_NOT_AN_EXACT_MATCH',
          reason: `Heuristic only: same row type/effect, event dates within ${normalized.policy.possibleMatchDateWindowDays} day(s), and canonical references within edit distance one. The original missing-item exceptions remain; this row never auto-resolves them.`,
        }));
      }
    }
  }

  queue.sort(queueSort);
  return {
    queue,
    counts: {
      statementRows: normalized.statement.rows.length,
      ledgerRows: normalized.ledger.rows.length,
      exactMatches,
      amountVariances,
      supplierItemsNotInLedger: missingLedger.length,
      ledgerItemsNotOnStatement: missingStatement.length,
      supplierCreditsNotInLedger: missingLedger.filter(row => row.rowType === 'CREDIT').length,
      possibleMatchReviews: possibleMatches,
      reviewItems: queue.length,
    },
    balances: {
      currency: scope.currency,
      statementOpeningBalanceMinor: normalized.statement.openingBalanceMinor,
      statementClosingBalanceMinor: normalized.statement.closingBalanceMinor,
      ledgerOpeningBalanceMinor: normalized.ledger.openingBalanceMinor,
      ledgerClosingBalanceMinor: normalized.ledger.closingBalanceMinor,
      closingBalanceVarianceMinor: balanceVarianceMinor,
      closingBalanceReviewMagnitudeMinor: absSafe(balanceVarianceMinor),
    },
  };
}
