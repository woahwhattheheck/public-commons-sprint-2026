import type { Buffer } from 'node:buffer';
export type Mutation = {
    expectedRevision: number;
    requestId: string;
};
export type Revision = {
    revision: number;
    replayed?: boolean;
};
export type Values = Record<string, string>;
export type Normalization = 'exact' | 'fold' | 'digits' | 'email' | 'domain';
export type MatchRule = {
    field: string;
    normalize: Normalization;
};
export type RecordStatus = 'ready' | 'review' | 'inactive';
export type Page<T> = {
    items: T[];
    total: number;
    offset: number;
    limit: number;
    nextOffset: number | null;
    revision?: number;
};
export type PageInput = {
    offset?: number;
    limit?: number;
};
export type Candidate = {
    value: string;
    recordId: string;
    editionId: string;
    sourceName: string;
    rowNumber: number;
};
export type Decision = {
    mode: 'source';
    recordId: string;
    editionId: string;
    value: string;
    note: string;
    selectedAt: string;
} | {
    mode: 'custom';
    value: string;
    note: string;
    selectedAt: string;
} | {
    mode: 'review';
    priorDecisions: Decision[];
    note: string;
};
export type Field = {
    value: string;
    status: 'empty' | 'agreed' | 'chosen' | 'changed' | 'review' | 'conflict';
    candidates: Candidate[];
    choice: Decision | null;
    retainedValue?: string;
};
export type OriginalRecord = {
    id: string;
    sourceKey: string[];
    feedId: string;
    sourceName: string;
    editionId: string | null;
    rowNumber: number | null;
    excluded: boolean;
    reason: string;
    missing: boolean;
    values: Values;
    raw: Values;
};
export type MasterRecord = {
    id: string;
    title: string;
    number: number;
    status: RecordStatus;
    recordCount: number;
    activeRecords: number;
    conflicts: string[];
    missingRecords: number;
    excludedRecords: number;
    values: Values;
};
export type Entity = Omit<MasterRecord, 'recordCount' | 'values'> & Revision & {
    label: string;
    note: string;
    created: string;
    records: OriginalRecord[];
    fields: Record<string, Field>;
};
export type Edition = {
    id: string;
    label: string;
    created: string;
    sha256: string;
    row_count: number;
};
export type Feed = {
    id: string;
    name: string;
    mapping: Values;
    keyColumns: string[];
    active_edition: string | null;
    created: string;
    editions: Edition[];
};
export type Counts = Record<'sources' | 'originalEditions' | 'masterRecords' | 'ready' | 'review' | 'inactive' | 'sourceRecords' | 'deliveries', number>;
export type Status = {
    schema: string;
    id: string;
    title: string;
    revision: number;
    created: string;
    format: number;
    feeds: Feed[];
    counts: Counts;
    rules: MatchRule[];
};
export type Binding = {
    schema: string;
    workspaceId: string;
    directory: string;
    sha256: string;
};
export type Group = {
    id: string;
    field: string;
    normalize: Normalization;
    value: string;
    entityCount: number;
};
export type RefreshCounts = Record<'added' | 'changed' | 'missing' | 'unchanged', number>;
export type RefreshChange = {
    recordId: string;
    kind: 'added' | 'changed' | 'missing';
    rowNumber: number;
    before?: Values;
    after?: Values;
    fields?: string[];
};
export type Refresh = Page<RefreshChange> & Revision & {
    editionId: string;
    feedId: string;
    feedName: string;
    label: string;
    activeEdition: string | null;
    planSha256: string;
    counts: RefreshCounts;
};
export type DeliverySummary = {
    id: string;
    title: string;
    created: string;
    source_revision: number;
    mode: 'all' | 'ready';
    row_count: number;
    conflict_count: number;
};
export type DeliveryDocument = {
    schema: string;
    title: string;
    created: string;
    sourceRevision: number;
    mode: 'all' | 'ready';
    rowCount: number;
    omittedRecords: number;
    conflictCount: number;
    columns: string[];
    sourceEditions: {
        name: string;
        editionId: string | null;
        sha256: string | null;
    }[];
    csvSha256: string;
};
export type Activity = {
    id: string;
    kind: string;
    created: string;
    revision: number;
    result: Record<string, unknown>;
};
export type SourceImport = Mutation & {
    feedId: string;
    label: string;
    sha256?: string;
};
export type FieldChoice = Mutation & {
    entityId: string;
    field: string;
    note?: string;
} & ({
    mode: 'auto';
} | {
    mode: 'source';
    recordId: string;
} | {
    mode: 'custom';
    value: string;
});
export type FileResult = {
    path: string;
    bytes: number;
    sha256: string;
};
export type ReceiveResult = {
    directory: string;
    workspaceId: string;
    revision: number;
    counts: Counts;
    sha256: string;
};
export type DeliveryReceiveResult = {
    directory: string;
    deliveryId: string;
    files: {
        name: string;
        bytes: number;
        sha256: string;
    }[];
    rowCount: number;
};
export interface OperationInputs {
    status: {};
    binding: {};
    feeds: {};
    rules: {};
    deliveries: {};
    entities: PageInput & {
        query?: string;
        status?: RecordStatus;
    };
    entity: {
        entityId: string;
    };
    groups: PageInput;
    group: PageInput & {
        groupId: string;
    };
    refresh: PageInput & {
        editionId: string;
    };
    delivery: {
        deliveryId: string;
    };
    history: PageInput;
    operation: {
        requestId: string;
    };
    'feed.create': Mutation & {
        name: string;
        mapping: Values;
        keyColumns: string[];
    };
    'source.import': SourceImport & {
        base64: string;
    };
    'source.activate': Mutation & {
        editionId: string;
        planSha256: string;
    };
    'rules.save': Mutation & {
        rules: MatchRule[];
    };
    'match.dismiss': Mutation & {
        groupId: string;
        reason: string;
    };
    'entity.merge': Mutation & {
        entityIds: string[];
        groupId?: string;
        label?: string;
    };
    'entity.split': Mutation & {
        entityId: string;
        recordIds: string[];
        label?: string;
        note?: string;
    };
    'field.choose': FieldChoice;
    'entity.annotate': Mutation & {
        entityId: string;
        label: string;
        note: string;
    };
    'record.exclude': Mutation & {
        recordId: string;
        excluded: boolean;
        reason?: string;
    };
    'delivery.create': Mutation & {
        title: string;
        columns: string[];
        mode: 'all' | 'ready';
    };
}
export interface OperationOutputs {
    status: Status;
    binding: Binding;
    feeds: Feed[];
    rules: MatchRule[];
    deliveries: DeliverySummary[];
    entities: Page<MasterRecord>;
    entity: Entity;
    groups: Page<Group>;
    group: Group & Page<{
        id: string;
        title: string;
        status: RecordStatus;
    }>;
    refresh: Refresh;
    delivery: DeliverySummary & {
        files: Record<string, string>;
    };
    history: Page<Activity>;
    operation: {
        found: false;
    } | {
        found: true;
        id: string;
        kind: string;
        revision: number;
        result: Record<string, unknown>;
    };
    'feed.create': Revision & {
        feedId: string;
        name: string;
    };
    'source.import': Revision & {
        editionId: string;
        feedId: string;
        rowCount: number;
        sha256: string;
    };
    'source.activate': Revision & {
        editionId: string;
        feedId: string;
        newEntities: number;
        counts: RefreshCounts;
    };
    'rules.save': Revision & {
        rules: MatchRule[];
    };
    'match.dismiss': Revision & {
        groupId: string;
    };
    'entity.merge': Revision & {
        entityId: string;
        merged: {
            id: string;
            title: string;
        }[];
        fieldsToReview: string[];
    };
    'entity.split': Revision & {
        entityId: string;
        originalEntityId: string;
        recordCount: number;
    };
    'field.choose': Revision & {
        entityId: string;
        field: string;
        decision?: Decision;
    };
    'entity.annotate': Revision & {
        entityId: string;
    };
    'record.exclude': Revision & {
        recordId: string;
        excluded: boolean;
    };
    'delivery.create': Revision & DeliveryDocument & {
        deliveryId: string;
    };
}
export class RecordMasteringClient {
    constructor(options: {
        directory: string;
        create?: boolean;
        title?: string;
    });
    workspace: MasteringWorkspace;
    invoke<A extends keyof OperationInputs>(action: A, ...args: {} extends OperationInputs[A] ? [
        input?: OperationInputs[A]
    ] : [
        input: OperationInputs[A]
    ]): OperationOutputs[A];
    inspect(file: string): {
        headers: string[];
        rowCount: number;
        preview: string[][];
        bytes: number;
        sha256: string;
    };
    import(file: string, input: SourceImport): OperationOutputs['source.import'];
    export(output: string): FileResult;
    deliver(deliveryId: string, output: string): FileResult;
    close(): void;
    /** Complete streaming file receive. Keeps the original v1 gzip/JSON format. */
    static receiveFile(file: string, directory: string, options?: {
        expectedSha256?: string;
        signal?: AbortSignal;
    }): Promise<ReceiveResult>;
    /** Compatibility Buffer receiver; use receiveFile for large saved projects. */
    static receive(file: string, directory: string, expectedSha256?: string): ReceiveResult;
    static unpackDelivery(file: string, directory: string, expectedSha256?: string): DeliveryReceiveResult;
}
export class MasteringWorkspace {
    constructor(directory: string, options?: {
        create?: boolean;
        title?: string;
    });
    directory: string;
    invoke<A extends keyof OperationInputs>(action: A, ...args: {} extends OperationInputs[A] ? [
        input?: OperationInputs[A]
    ] : [
        input: OperationInputs[A]
    ]): OperationOutputs[A];
    meta(): Pick<Status, 'id' | 'title' | 'revision' | 'schema' | 'created' | 'format'>;
    status(): Status;
    binding(): Binding;
    close(): void;
}
export function workspacePacket(workspace: MasteringWorkspace, options?: {
    expectedRevision?: number;
}): Buffer;
export function deliveryPacket(workspace: MasteringWorkspace, deliveryId: string): Buffer;
export function receiveWorkspace(bytes: Buffer, destination: string, options?: {
    expectedSha256?: string;
}): ReceiveResult;
export function receiveDelivery(bytes: Buffer, destination: string, options?: {
    expectedSha256?: string;
}): DeliveryReceiveResult;
export function workspaceFile(workspace: MasteringWorkspace, output: string, options?: {
    expectedRevision?: number;
}): FileResult;
export function receiveWorkspaceFile(file: string, destination: string, options?: {
    expectedSha256?: string;
    signal?: AbortSignal;
}): Promise<ReceiveResult>;
