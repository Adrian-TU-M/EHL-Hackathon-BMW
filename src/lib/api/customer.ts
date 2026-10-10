/** Typed client for the Customer Agent backend (backend/customer_agent).
 * Types mirror backend/customer_agent/schemas.py. Counts are unique feedback records
 * (IDs), never classification rows, and never "customers": the data has no customer ID. */

export interface QuantitativeClaim {
  numerator: number;
  denominator: number | null;
  unit: string;
  sourceId: string;
  filters: string[];
  market: string;
  period: string;
  method: string;
  limitations: string;
}

export type Polarity = "Complaint" | "Request" | "Positive" | "Unclassified";

export interface CustomerEvidence {
  id: string;
  domain: "customer";
  source: string;
  location: string;
  publishedAt: string;
  provenance: "bmw-supplied" | "synthetic";
  vehicle: string;
  market: string;
  country: string;
  powertrain: string;
  category: string;
  theme: string;
  topic: string | null;
  subcategories: string[];
  type: Polarity;
  feedbackTypes: string[];
  passage: string;
  classificationRows: number;
  channel: string;
  severity: string | null;
  quantitative: QuantitativeClaim | null;
}

export interface StudyRef {
  id: string;
  source: string;
  market: string;
  vehicle: string;
  attribute: string;
  metric: string;
  value: number | null;
  bottomBox: number | null;
  comparison: Record<string, number>;
  quantitative: QuantitativeClaim;
}

export interface Coverage {
  feedbackRows: number;
  uniqueRecords: number;
  uniqueCustomers: number | null;
  customersIdentifiable: boolean;
  byPolarity: Record<string, number>;
  byPowertrain: Record<string, number>;
  byChannel: Record<string, number>;
  studies: { source: string; metric: string; attributes: number }[];
  available: { vehicle: string; market: string; powertrain: string; records: number }[];
  warnings: string[];
}

export interface CustomerFilters {
  vehicle: string;
  market: string; // "All" | market name
  powertrain: string; // "All" | Combustion | Electric | Plug-in hybrid
  source: string; // "All" | Source A…
  category: string; // "All" | source category (VFC level 2)
}

export interface QuotePage {
  total: number;
  offset: number;
  items: CustomerEvidence[];
}

export interface Drilldown {
  category: string | null;
  theme: string | null;
  type: string | null;
  claim: QuantitativeClaim;
  subcategories: [string, number][];
  studyRefs: StudyRef[];
  quotes: QuotePage;
}

export interface FeatureRow {
  category: string;
  theme: string;
  records: number;
  byType: Record<string, number>;
}

/** Every category ranked by unique feedback records, most mentioned first. */
export interface FeatureRanking {
  filters: CustomerFilters;
  records: number;
  dislikes: FeatureRow[]; // Defect + Difficult to Use
  likes: FeatureRow[]; // Likes + Wants
  coverage: Coverage;
  dataSource?: "live" | "demo";
}

export interface CustomerDataSource {
  mode: "live" | "demo";
  features(f: CustomerFilters, signal?: AbortSignal): Promise<FeatureRanking>;
  drilldown(f: CustomerFilters, opts: { type?: string; theme?: string }, signal?: AbortSignal): Promise<Drilldown>;
}

/** UI vocabularies → backend values. Labels are what the PM sees. */
export const MARKET_OPTIONS: { value: string; label: string }[] = [
  { value: "All", label: "All markets" },
  { value: "Europe", label: "Europe" },
  { value: "United States", label: "US" },
  { value: "China", label: "China" },
  { value: "South Korea", label: "Korea" },
  { value: "Japan", label: "Japan" },
];
export const POWERTRAIN_OPTIONS: { value: string; label: string }[] = [
  { value: "All", label: "All powertrains" },
  { value: "Combustion", label: "ICE" },
  { value: "Electric", label: "BEV" },
  { value: "Plug-in hybrid", label: "PHEV" },
];

export const CUSTOMER_API_URL: string =
  import.meta.env?.VITE_CUSTOMER_API_URL ?? "/customer-api";

export class CustomerApiError extends Error {
  constructor(
    message: string,
    readonly status: number,
  ) {
    super(message);
  }
}

function params(f: CustomerFilters, extra: Record<string, string | number | undefined> = {}) {
  const p = new URLSearchParams();
  Object.entries({ ...f, ...extra }).forEach(([k, v]) => {
    if (v !== undefined && v !== "") p.set(k, String(v));
  });
  return p.toString();
}

async function request<T>(path: string, init: RequestInit & { timeoutMs?: number } = {}): Promise<T> {
  const timeout = new AbortController();
  const timer = setTimeout(() => timeout.abort(), init.timeoutMs ?? 10000);
  init.signal?.addEventListener("abort", () => timeout.abort());
  try {
    const res = await fetch(`${CUSTOMER_API_URL}${path}`, { ...init, signal: timeout.signal });
    if (!res.ok) {
      let message = `${res.status} ${res.statusText}`;
      try {
        const body = await res.json();
        message = body?.detail?.message ?? JSON.stringify(body.detail ?? body);
      } catch {
        /* keep status text */
      }
      throw new CustomerApiError(message, res.status);
    }
    return (await res.json()) as T;
  } finally {
    clearTimeout(timer);
  }
}

export const liveCustomerSource: CustomerDataSource = {
  mode: "live",
  async features(f, signal) {
    const d = await request<FeatureRanking>(`/customer/features?${params(f)}`, { signal });
    return { ...d, dataSource: "live" };
  },
  drilldown(f, opts, signal) {
    return request<Drilldown>(`/customer/drilldown?${params(f, opts)}`, { signal });
  },
};

/** Health probe used to choose between live data and the demo fallback. */
export async function customerBackendAvailable(signal?: AbortSignal): Promise<boolean> {
  try {
    await request<unknown>("/health", { signal, timeoutMs: 4000 });
    return true;
  } catch {
    return false;
  }
}
