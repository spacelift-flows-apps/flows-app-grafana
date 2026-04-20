import { AppBlock, kv } from "@slflows/sdk/v1";
import {
  AlertRule,
  AlertRuleQuery,
  GrafanaApiError,
} from "../../client/grafana";
import { getClient, getCreds } from "../shared/client";
import {
  suggestContactPoint,
  suggestDatasourceType,
  suggestDatasourceUid,
  suggestFolder,
  suggestFromList,
} from "../shared/suggest";
import { asObject, asStringMap } from "../shared/validators";

const KV_UID = "ruleUid";
const PRIMARY_REF_ID = "A";

const NO_DATA_STATE_OPTIONS = ["NoData", "Alerting", "OK", "KeepLast"].map(
  (s) => ({ label: s, value: s }),
);
const EXEC_ERR_STATE_OPTIONS = ["Error", "Alerting", "OK", "KeepLast"].map(
  (s) => ({ label: s, value: s }),
);

function buildPrimaryQuery(
  datasourceUid: string,
  datasourceType: string,
  queryPayload: Record<string, unknown>,
  fromSeconds: number,
  toSeconds: number,
): AlertRuleQuery {
  return {
    refId: PRIMARY_REF_ID,
    queryType: "",
    relativeTimeRange: { from: fromSeconds, to: toSeconds },
    datasourceUid,
    model: {
      ...queryPayload,
      refId: PRIMARY_REF_ID,
      datasource: { uid: datasourceUid, type: datasourceType },
    },
  };
}

function validateAdditionalQueries(raw: unknown): AlertRuleQuery[] {
  if (raw === undefined || raw === null) return [];
  if (!Array.isArray(raw)) {
    throw new Error("query.additional must be an array.");
  }
  for (const q of raw as unknown[]) {
    if (
      typeof q !== "object" ||
      q === null ||
      typeof (q as { refId?: unknown }).refId !== "string" ||
      typeof (q as { model?: unknown }).model !== "object"
    ) {
      throw new Error(
        "Each query.additional entry must include a string refId and a model object.",
      );
    }
    if ((q as { refId: string }).refId === PRIMARY_REF_ID) {
      throw new Error(
        `query.additional cannot use refId "${PRIMARY_REF_ID}" — that is reserved for the primary query.`,
      );
    }
  }
  return raw as AlertRuleQuery[];
}

function ruleUrl(grafanaUrl: string, uid: string): string {
  return `${grafanaUrl.replace(/\/+$/, "")}/alerting/grafana/${encodeURIComponent(uid)}/view`;
}

export const alertRuleBlock: AppBlock = {
  name: "Alert Rule",
  description:
    "Provisions a Grafana alert rule. Define the primary query the same way you would in the Query Datasource block; for non-Prometheus stacks you can chain reducer/threshold queries via Additional Queries. On Grafana 10+, you can route directly to a contact point.",
  category: "Alerts",

  config: {
    title: {
      name: "Title",
      description: "Display name for the rule in Grafana.",
      type: "string",
      required: true,
    },
    folderUid: {
      name: "Folder",
      description:
        "UID of the folder to create the rule in. Folders are managed in Dashboards → Folders.",
      type: "string",
      required: true,
      suggestValues: suggestFolder,
    },
    ruleGroup: {
      name: "Rule Group",
      description:
        "Name of the rule group. Rules in the same group evaluate together. Created implicitly if it doesn't exist.",
      type: "string",
      required: true,
    },
    datasourceUid: {
      name: "Datasource UID",
      description:
        "The UID of the datasource to query. Visible in Grafana at Connections → Data sources.",
      type: "string",
      required: true,
      suggestValues: suggestDatasourceUid,
    },
    datasourceType: {
      name: "Datasource Type",
      description:
        "The type of datasource (e.g. prometheus, loki, mysql). Must match the datasource identified by the UID.",
      type: "string",
      required: true,
      suggestValues: suggestDatasourceType,
    },
    query: {
      name: "Query",
      description:
        'The rule\'s query definition. The primary query (refId "A") is built from the datasource fields above plus "payload" and "timeRange". The last query in the chain (primary by default, or the final entry in "additional") acts as the firing condition — its value being non-zero means the rule fires. For single-query Prometheus-style rules, just set "payload" and leave "additional" empty.',
      type: {
        type: "object",
        properties: {
          payload: {
            type: "object",
            description:
              'Datasource-specific query fields for refId "A". Example (Prometheus): {"expr": "up == 0", "instant": true}.',
            additionalProperties: true,
          },
          timeRange: {
            type: "object",
            description:
              "Query time range relative to evaluation time, in seconds.",
            properties: {
              from: {
                type: "number",
                description:
                  "Start of range (seconds before evaluation). E.g. 600 = last 10 minutes.",
              },
              to: {
                type: "number",
                description:
                  "End of range (seconds before evaluation). Usually 0.",
              },
            },
            required: ["from", "to"],
            additionalProperties: false,
          },
          additional: {
            type: "array",
            description:
              'Extra Grafana alert rule queries (reducers, thresholds, math) chained onto the primary query. Each entry must have a refId other than "A" and a model object. The last entry becomes the firing condition. Example: [{"refId":"C","datasourceUid":"__expr__","model":{"type":"threshold","expression":"A","conditions":[{"evaluator":{"params":[5],"type":"gt"}}]}}].',
            items: { type: "object", additionalProperties: true },
          },
        },
        required: ["payload"],
        additionalProperties: false,
      },
      required: true,
      default: {
        payload: {},
        timeRange: { from: 600, to: 0 },
      },
    },
    for: {
      name: "For",
      description:
        "Pending duration before firing (e.g. 5m, 30s). An alert must satisfy the condition for this long before notifications are sent.",
      type: "string",
      required: false,
      default: "5m",
    },
    keepFiringFor: {
      name: "Keep Firing For",
      description:
        "How long to keep firing after the condition stops being true (e.g. 10m). Leave empty to resolve immediately.",
      type: "string",
      required: false,
    },
    noDataState: {
      name: "No Data State",
      description: "What state the rule enters when its query returns no data.",
      type: "string",
      required: false,
      default: "NoData",
      suggestValues: async (input) =>
        suggestFromList(NO_DATA_STATE_OPTIONS, input.searchPhrase),
    },
    execErrState: {
      name: "Execution Error State",
      description:
        "What state the rule enters when its query errors during evaluation.",
      type: "string",
      required: false,
      default: "Error",
      suggestValues: async (input) =>
        suggestFromList(EXEC_ERR_STATE_OPTIONS, input.searchPhrase),
    },
    isPaused: {
      name: "Paused",
      description: "If enabled, Grafana will not evaluate this rule.",
      type: "boolean",
      required: false,
      default: false,
    },
    labels: {
      name: "Labels",
      description:
        'Object of label key/value pairs attached to the rule and used by notification policies (e.g. {"severity":"critical","team":"platform"}).',
      type: { type: "object", additionalProperties: true },
      required: false,
    },
    annotations: {
      name: "Annotations",
      description:
        "Object of annotation key/value pairs for rendering the alert. Common keys: summary, description, runbook_url.",
      type: { type: "object", additionalProperties: true },
      required: false,
    },
    contactPoint: {
      name: "Contact Point",
      description:
        "Route notifications directly to a specific contact point by name, bypassing the notification policy tree. Requires Grafana 10+.",
      type: "string",
      required: false,
      suggestValues: suggestContactPoint,
    },
  },

  signals: {
    ruleUid: {
      name: "Rule UID",
      description: "The UID Grafana assigned to this alert rule.",
    },
    ruleUrl: {
      name: "Rule URL",
      description: "Direct link to view the rule in the Grafana UI.",
    },
  },

  onSync: async (input) => {
    const { grafanaUrl } = getCreds(input);
    const cfg = input.block.config;

    try {
      const query = asObject(cfg.query, "query") as {
        payload?: unknown;
        timeRange?: { from?: number; to?: number };
        additional?: unknown;
      };
      const payload = asObject(query.payload, "query.payload");
      const primary = buildPrimaryQuery(
        cfg.datasourceUid as string,
        cfg.datasourceType as string,
        payload,
        query.timeRange?.from ?? 600,
        query.timeRange?.to ?? 0,
      );
      const additional = validateAdditionalQueries(query.additional);
      const data = [primary, ...additional];
      const condition = data[data.length - 1].refId;

      const desired: Omit<AlertRule, "uid"> = {
        title: cfg.title as string,
        ruleGroup: cfg.ruleGroup as string,
        folderUID: cfg.folderUid as string,
        condition,
        data,
        noDataState: cfg.noDataState as AlertRule["noDataState"],
        execErrState: cfg.execErrState as AlertRule["execErrState"],
        for: cfg.for as string,
        isPaused: cfg.isPaused as boolean,
      };

      const keepFiringFor = cfg.keepFiringFor as string | undefined;
      if (keepFiringFor) desired.keepFiringFor = keepFiringFor;

      const labels = asStringMap(cfg.labels, "labels");
      if (labels) desired.labels = labels;

      const annotations = asStringMap(cfg.annotations, "annotations");
      if (annotations) desired.annotations = annotations;

      const contactPoint = cfg.contactPoint as string | undefined;
      if (contactPoint) {
        desired.notification_settings = { receiver: contactPoint };
      }

      const client = getClient(input);
      const storedUid = await kv.block.get(KV_UID);
      let uid =
        typeof storedUid.value === "string" ? storedUid.value : undefined;

      if (uid) {
        try {
          await client.updateAlertRule(uid, { ...desired, uid });
        } catch (err) {
          if (err instanceof GrafanaApiError && err.status === 404) {
            uid = undefined;
          } else {
            throw err;
          }
        }
      }

      if (!uid) {
        const created = await client.createAlertRule(desired);
        uid = created.uid;
        await kv.block.set({ key: KV_UID, value: uid });
      }

      return {
        newStatus: "ready",
        customStatusDescription: null,
        signalUpdates: {
          ruleUid: uid,
          ruleUrl: ruleUrl(grafanaUrl, uid),
        },
      };
    } catch (err) {
      if (err instanceof GrafanaApiError) {
        return {
          newStatus: "failed",
          customStatusDescription: `Grafana returned ${err.status}: ${err.message}`,
        };
      }
      const msg = err instanceof Error ? err.message : String(err);
      return {
        newStatus: "failed",
        customStatusDescription: msg,
      };
    }
  },

  onDrain: async (input) => {
    const storedUid = await kv.block.get(KV_UID);
    const uid =
      typeof storedUid.value === "string" ? storedUid.value : undefined;

    if (uid) {
      try {
        await getClient(input).deleteAlertRule(uid);
      } catch (err) {
        if (!(err instanceof GrafanaApiError && err.status === 404)) {
          throw err;
        }
      }
      await kv.block.delete([KV_UID]);
    }

    return {
      newStatus: "drained",
      signalUpdates: { ruleUid: null, ruleUrl: null },
    };
  },
};
