import memoizee from "memoizee";

export interface GrafanaClientOptions {
  grafanaUrl: string;
  token: string;
}

export interface CurrentUser {
  id: number;
  email?: string;
  name?: string;
  login: string;
  orgId: number;
  isGrafanaAdmin?: boolean;
  [key: string]: unknown;
}

export interface Datasource {
  id: number;
  uid: string;
  name: string;
  type: string;
  typeName?: string;
  url?: string;
  isDefault?: boolean;
  readOnly?: boolean;
  jsonData?: Record<string, unknown>;
}

export interface DsQuery {
  refId: string;
  datasource: { uid: string; type: string };
  intervalMs?: number;
  maxDataPoints?: number;
  [key: string]: unknown;
}

export interface DsQueryRequest {
  queries: DsQuery[];
  from?: string;
  to?: string;
}

export interface DsQueryResponse {
  results: Record<
    string,
    {
      status?: number;
      error?: string;
      errorSource?: string;
      frames?: unknown[];
    }
  >;
}

export interface WebhookContactPointSettings {
  url: string;
  httpMethod?: "POST" | "PUT";
  maxAlerts?: number;
  authorization_scheme?: string;
  authorization_credentials?: string;
  [key: string]: unknown;
}

export interface ContactPoint {
  uid?: string;
  name: string;
  type: string;
  settings: WebhookContactPointSettings | Record<string, unknown>;
  disableResolveMessage?: boolean;
  provenance?: string;
}

export interface Folder {
  uid: string;
  title: string;
  url?: string;
  parentUid?: string;
}

export interface AlertRuleQuery {
  refId: string;
  queryType?: string;
  relativeTimeRange?: { from: number; to: number };
  datasourceUid: string;
  model: Record<string, unknown>;
}

export interface AlertRuleNotificationSettings {
  receiver: string;
}

export interface AlertRule {
  uid?: string;
  title: string;
  ruleGroup: string;
  folderUID: string;
  condition: string;
  data: AlertRuleQuery[];
  noDataState?: "NoData" | "Alerting" | "OK" | "KeepLast";
  execErrState?: "Error" | "Alerting" | "OK" | "KeepLast";
  for?: string;
  keepFiringFor?: string;
  labels?: Record<string, string>;
  annotations?: Record<string, string>;
  isPaused?: boolean;
  notification_settings?: AlertRuleNotificationSettings;
  provenance?: string;
}

export class GrafanaApiError extends Error {
  readonly status: number;
  readonly body: unknown;
  constructor(status: number, message: string, body: unknown) {
    super(message);
    this.name = "GrafanaApiError";
    this.status = status;
    this.body = body;
  }
}

export class GrafanaClient {
  private readonly baseUrl: string;
  private readonly token: string;

  constructor({ grafanaUrl, token }: GrafanaClientOptions) {
    this.baseUrl = grafanaUrl.replace(/\/+$/, "");
    this.token = token;
  }

  async request<T = unknown>(
    method: string,
    path: string,
    body?: unknown,
    query?: Record<string, string | number | boolean | undefined>,
  ): Promise<T> {
    const url = new URL(
      path.startsWith("/") ? path : `/${path}`,
      `${this.baseUrl}/`,
    );
    if (query) {
      for (const [k, v] of Object.entries(query)) {
        if (v !== undefined) url.searchParams.set(k, String(v));
      }
    }

    const headers: Record<string, string> = {
      Authorization: `Bearer ${this.token}`,
      Accept: "application/json",
    };
    let serializedBody: string | undefined;
    if (body !== undefined) {
      headers["Content-Type"] = "application/json";
      serializedBody = JSON.stringify(body);
    }

    const response = await fetch(url.toString(), {
      method,
      headers,
      body: serializedBody,
    });

    const text = await response.text();
    let parsed: unknown = undefined;
    if (text.length > 0) {
      try {
        parsed = JSON.parse(text);
      } catch {
        parsed = text;
      }
    }

    if (!response.ok) {
      const message = extractErrorMessage(parsed, response.statusText);
      throw new GrafanaApiError(
        response.status,
        `Grafana API ${method} ${path} failed (${response.status}): ${message}`,
        parsed,
      );
    }

    return parsed as T;
  }

  get<T = unknown>(
    path: string,
    query?: Record<string, string | number | boolean | undefined>,
  ) {
    return this.request<T>("GET", path, undefined, query);
  }

  getCurrentUser(): Promise<CurrentUser> {
    return this.get<CurrentUser>("/api/user");
  }

  listDatasources(): Promise<Datasource[]> {
    return this.get<Datasource[]>("/api/datasources");
  }

  query(req: DsQueryRequest): Promise<DsQueryResponse> {
    return this.request<DsQueryResponse>("POST", "/api/ds/query", req);
  }

  createContactPoint(
    payload: Omit<ContactPoint, "uid">,
  ): Promise<ContactPoint & { uid: string }> {
    return this.request<ContactPoint & { uid: string }>(
      "POST",
      "/api/v1/provisioning/contact-points",
      payload,
    );
  }

  updateContactPoint(uid: string, payload: ContactPoint): Promise<void> {
    return this.request<void>(
      "PUT",
      `/api/v1/provisioning/contact-points/${encodeURIComponent(uid)}`,
      { ...payload, uid },
    );
  }

  deleteContactPoint(uid: string): Promise<void> {
    return this.request<void>(
      "DELETE",
      `/api/v1/provisioning/contact-points/${encodeURIComponent(uid)}`,
    );
  }

  listContactPoints(): Promise<ContactPoint[]> {
    return this.get<ContactPoint[]>("/api/v1/provisioning/contact-points");
  }

  listFolders(): Promise<Folder[]> {
    return this.get<Folder[]>("/api/folders", { limit: 1000 });
  }

  createAlertRule(
    rule: Omit<AlertRule, "uid">,
  ): Promise<AlertRule & { uid: string }> {
    return this.request<AlertRule & { uid: string }>(
      "POST",
      "/api/v1/provisioning/alert-rules",
      rule,
    );
  }

  updateAlertRule(uid: string, rule: AlertRule): Promise<AlertRule> {
    return this.request<AlertRule>(
      "PUT",
      `/api/v1/provisioning/alert-rules/${encodeURIComponent(uid)}`,
      { ...rule, uid },
    );
  }

  deleteAlertRule(uid: string): Promise<void> {
    return this.request<void>(
      "DELETE",
      `/api/v1/provisioning/alert-rules/${encodeURIComponent(uid)}`,
    );
  }
}

function extractErrorMessage(body: unknown, fallback: string): string {
  if (body && typeof body === "object") {
    const obj = body as Record<string, unknown>;
    if (typeof obj.message === "string") return obj.message;
    if (typeof obj.error === "string") return obj.error;
  }
  if (typeof body === "string" && body.length > 0) return body;
  return fallback;
}

const cacheOptions = {
  maxAge: 60_000,
  promise: true as const,
};

export const getDatasourcesCached = memoizee(
  async (grafanaUrl: string, token: string): Promise<Datasource[]> =>
    new GrafanaClient({ grafanaUrl, token }).listDatasources(),
  cacheOptions,
);

export const getFoldersCached = memoizee(
  async (grafanaUrl: string, token: string): Promise<Folder[]> =>
    new GrafanaClient({ grafanaUrl, token }).listFolders(),
  cacheOptions,
);

export const getContactPointsCached = memoizee(
  async (grafanaUrl: string, token: string): Promise<ContactPoint[]> =>
    new GrafanaClient({ grafanaUrl, token }).listContactPoints(),
  cacheOptions,
);
