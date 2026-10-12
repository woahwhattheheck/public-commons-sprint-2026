import type {
  SourceChangeKind, SourceChangeCompany, SourceChangeAccount, SourceChangeComparison,
  SourceChangeQboSuccessor, SourceChangeXeroSuccessor
} from '../workspace/source-changes.mjs';
export declare const SOURCE_CHANGE_SCHEMA: "stellar-forge.accounting-source-change.v1";
export declare function changeCanonical(value: unknown): string;
export declare function changeHash(value: unknown): string;
export declare function changeClone<T>(value: T): T;
export declare function changeCheck(ok: unknown, code: string, message: string, status?: number): asserts ok;
export declare function changeId(value: unknown): string;
export declare function changeText(value: unknown, label: string, max?: number): string;
export declare function changeKind(value: unknown): SourceChangeKind;
export declare function sourceEdition(kind: SourceChangeKind, value: unknown): {
  kind: SourceChangeKind; sha256: string; company: SourceChangeCompany; accounts: SourceChangeAccount[];
};
export declare function planIdentity(kind: SourceChangeKind, plan: unknown): string;
export declare function compareSourceEditions(kind: SourceChangeKind, plan: unknown, before: unknown, after: unknown): SourceChangeComparison;
export declare function successorDefaults(kind: SourceChangeKind, plan: unknown, target: unknown):
  Omit<SourceChangeQboSuccessor, "id" | "createdAt" | "actor"> | Omit<SourceChangeXeroSuccessor, "id" | "createdAt" | "actor">;
export declare function assertSameEconomicSource(kind: SourceChangeKind, before: unknown, after: unknown): true;
export declare function successorRequest(kind: SourceChangeKind, previous: unknown, target: unknown,
  input: SourceChangeQboSuccessor | SourceChangeXeroSuccessor,
  options?: { accountantRevisionId?: string | null }): Record<string, unknown>;
