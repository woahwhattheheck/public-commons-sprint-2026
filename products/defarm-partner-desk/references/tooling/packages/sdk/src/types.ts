export type WorkspaceType = "partner" | "producer" | "processor" | "certifier";

export type HttpMethod = "GET" | "POST" | "PUT" | "PATCH" | "DELETE";

export interface SdkConfig {
  gatewayBaseUrl: string;
  timeoutMs?: number;
  apiKey?: string;
}

export interface AuthTokens {
  access_token: string;
  refresh_token?: string;
  token_type?: string;
  expires_in?: number;
}

export interface AuthUser {
  id: string;
  email: string;
  full_name?: string;
  workspace: {
    id: string;
    name: string;
    slug: string;
    workspace_type: WorkspaceType;
    role: string;
  };
}

export interface AuthResponse extends AuthTokens {
  user: AuthUser;
}

export interface Circuit {
  id: string;
  name: string;
  description?: string;
  visibility?: string;
  circuit_type?: string;
  status?: string;
}

export interface Item {
  id: string;
  dfid: string;
  value_chain: string;
  country: string;
  year: number;
  status: string;
  metadata?: Record<string, unknown>;
}

export interface Event {
  id: string;
  event_type: string;
  status?: string;
  item_id?: string;
  circuit_id?: string;
  payload?: Record<string, unknown>;
}

export interface DisclosureRequest {
  item_id: string;
  preset: "finance_basic" | "audit_basic" | "public_basic" | string;
  audience?: string;
  expires_in_days?: number;
}

export interface DisclosureResponse {
  receipt_id: string;
  preset: string;
  audience?: string;
  proof_hash: string;
  expires_at?: string;
  disclosed_payload: Record<string, unknown>;
}

export interface ReceiptSummary {
  receipt_id: string;
  receipt_type: "ingestion" | "disclosure" | string;
  status: string;
  created_at: string;
  completed_at?: string;
  circuit_id?: string;
  item_id?: string;
  preset?: string;
  audience?: string;
  proof_hash?: string;
  rows_total?: number;
  items_created?: number;
  items_updated?: number;
  events_created?: number;
}

export interface PartnerItemRoute {
  route_type: string;
  route_value: string;
  circuit_id?: string | null;
}

export interface PartnerAssetReference {
  identifier_type: string;
  value: string;
}

export interface PartnerInputReference {
  field: string;
  value: string;
}

export interface PartnerItemOutput {
  dfid?: string | null;
  url?: string | null;
  partner_reference?: string | null;
  asset_reference?: PartnerAssetReference | null;
  matched_existing_item?: boolean | null;
  resolution_result?: "created" | "enriched" | string | null;
  merged_fields?: string[];
  url_refs?: Record<string, string> | null;
  routes: PartnerItemRoute[];
}

export interface PartnerIntakeSummary {
  status: string;
  total_rows: number;
  processed_rows: number;
  unresolved_rows: number;
  routes: number;
  items: number;
  created_circuits: number;
  impacted_circuits: number;
  items_created: number;
  items_enriched: number;
  warnings?: string[];
}

export interface PartnerIntakeErrorOutput {
  row_index?: number | null;
  partner_reference?: string | null;
  reason_code: string;
  message: string;
  value_chain?: string | null;
  identifier_type?: string | null;
  identifier_value?: string | null;
}

export interface PartnerIntakeResponse {
  dry_run?: boolean | null;
  ingestion_id?: string | null;
  summary: PartnerIntakeSummary;
  items: PartnerItemOutput[];
  errors: PartnerIntakeErrorOutput[];
  routes: Array<{
    route_type: string;
    route_value: string;
    circuit_id?: string | null;
    rows: number;
    status: string;
    items: number;
  }>;
}

export class DefarmApiError extends Error {
  status: number;
  details?: unknown;

  constructor(message: string, status: number, details?: unknown) {
    super(message);
    this.status = status;
    this.details = details;
  }
}
