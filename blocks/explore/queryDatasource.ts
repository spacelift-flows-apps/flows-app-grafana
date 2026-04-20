import { AppBlock, events } from "@slflows/sdk/v1";
import { DsQuery } from "../../client/grafana";
import { getClient } from "../shared/client";
import {
  suggestDatasourceType,
  suggestDatasourceUid,
  suggestFromList,
} from "../shared/suggest";
import { asObject } from "../shared/validators";

const TIME_RANGE_SUGGESTIONS = [
  { label: "Last 5 minutes", value: "now-5m" },
  { label: "Last 15 minutes", value: "now-15m" },
  { label: "Last 30 minutes", value: "now-30m" },
  { label: "Last 1 hour", value: "now-1h" },
  { label: "Last 3 hours", value: "now-3h" },
  { label: "Last 6 hours", value: "now-6h" },
  { label: "Last 12 hours", value: "now-12h" },
  { label: "Last 24 hours", value: "now-24h" },
  { label: "Last 7 days", value: "now-7d" },
  { label: "Last 30 days", value: "now-30d" },
];

const NOW_SUGGESTION = [{ label: "Now", value: "now" }];

export const queryDatasourceBlock: AppBlock = {
  name: "Query Datasource",
  description:
    "Executes a query against a Grafana datasource via POST /api/ds/query. Accepts any datasource (Prometheus, Loki, SQL, etc.) — the query shape is datasource-specific.",
  category: "Explore",

  inputs: {
    default: {
      name: "Query",
      description: "Run the configured query and emit the Grafana response.",
      config: {
        datasourceUid: {
          name: "Datasource UID",
          description:
            "The UID of the datasource to query. Visible in Grafana at Connections → Data sources, or in the URL when editing a datasource.",
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
        queryPayload: {
          name: "Query Payload",
          description:
            'The datasource-specific query fields, merged into the query object. Example for Prometheus: {"expr": "up", "range": true}. Example for Loki: {"expr": "{job=\\"varlogs\\"}"}. The datasource, intervalMs and maxDataPoints are set from the other fields.',
          type: { type: "object", additionalProperties: true },
          required: true,
          default: {},
        },
        from: {
          name: "From",
          description:
            "Start of the query time range. Accepts Grafana relative syntax (e.g. now-1h) or an absolute epoch millisecond timestamp as a string.",
          type: "string",
          required: false,
          default: "now-1h",
          suggestValues: async (input) =>
            suggestFromList(TIME_RANGE_SUGGESTIONS, input.searchPhrase),
        },
        to: {
          name: "To",
          description:
            "End of the query time range. Accepts Grafana relative syntax (e.g. now) or an absolute epoch millisecond timestamp as a string.",
          type: "string",
          required: false,
          default: "now",
          suggestValues: async (input) =>
            suggestFromList(NOW_SUGGESTION, input.searchPhrase),
        },
        maxDataPoints: {
          name: "Max Data Points",
          description:
            "Upper bound on the number of points returned. Grafana uses this to pick a sensible step/bucket size.",
          type: "number",
          required: false,
          default: 1000,
        },
        intervalMs: {
          name: "Interval (ms)",
          description:
            "Suggested resolution in milliseconds. Ignored by some datasources.",
          type: "number",
          required: false,
          default: 1000,
        },
      },
      onEvent: async (input) => {
        const cfg = input.event.inputConfig;
        const payload = asObject(cfg.queryPayload, "queryPayload");

        const query: DsQuery = {
          ...payload,
          refId: "A",
          datasource: {
            uid: cfg.datasourceUid as string,
            type: cfg.datasourceType as string,
          },
          intervalMs: cfg.intervalMs as number,
          maxDataPoints: cfg.maxDataPoints as number,
        };

        const response = await getClient(input).query({
          queries: [query],
          from: cfg.from as string,
          to: cfg.to as string,
        });

        await events.emit(response.results.A);
      },
    },
  },

  outputs: {
    default: {
      name: "Result",
      description:
        "The query result: frames in Grafana's dataframe format, plus status and error details from Grafana.",
      default: true,
      type: {
        type: "object",
        properties: {
          frames: { type: "array", items: {} },
          status: { type: "number" },
          error: { type: "string" },
          errorSource: { type: "string" },
        },
        additionalProperties: true,
      },
    },
  },
};
