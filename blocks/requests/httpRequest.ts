import { AppBlock, events } from "@slflows/sdk/v1";
import { GrafanaApiError } from "../../client/grafana";
import { getClient } from "../shared/client";
import { suggestFromList } from "../shared/suggest";

const HTTP_METHOD_OPTIONS = ["GET", "POST", "PUT", "PATCH", "DELETE"].map(
  (m) => ({ label: m, value: m }),
);

function normalizeQuery(
  raw: unknown,
): Record<string, string | number | boolean | undefined> | undefined {
  if (raw === undefined || raw === null) return undefined;
  if (typeof raw !== "object" || Array.isArray(raw)) {
    throw new Error("query must be a JSON object of key/value pairs.");
  }
  const out: Record<string, string | number | boolean | undefined> = {};
  for (const [k, v] of Object.entries(raw as Record<string, unknown>)) {
    if (v === undefined || v === null) continue;
    if (
      typeof v === "string" ||
      typeof v === "number" ||
      typeof v === "boolean"
    ) {
      out[k] = v;
    } else {
      out[k] = JSON.stringify(v);
    }
  }
  return out;
}

export const httpRequestBlock: AppBlock = {
  name: "HTTP Request",
  description:
    "Makes an authenticated request to any Grafana HTTP API endpoint. Useful as an escape hatch for endpoints not covered by a dedicated block.",
  category: "Request",

  inputs: {
    default: {
      name: "Request",
      description: "Perform the HTTP request and emit Grafana's response.",
      config: {
        method: {
          name: "Method",
          description: "HTTP method to use.",
          type: "string",
          required: true,
          default: "GET",
          suggestValues: async (input) =>
            suggestFromList(HTTP_METHOD_OPTIONS, input.searchPhrase),
        },
        path: {
          name: "Path",
          description:
            "API path, including the leading slash. Example: /api/datasources, /api/search?type=dash-db.",
          type: "string",
          required: true,
        },
        body: {
          name: "Body",
          description:
            "Optional JSON body. Ignored for GET/DELETE unless the endpoint accepts one.",
          type: { type: "object", additionalProperties: true },
          required: false,
        },
        query: {
          name: "Query Parameters",
          description:
            "Optional object of query string parameters, merged with any included directly in the path.",
          type: { type: "object", additionalProperties: true },
          required: false,
        },
      },
      onEvent: async (input) => {
        const cfg = input.event.inputConfig;
        const method = (cfg.method as string).toUpperCase();
        const path = cfg.path as string;
        const body = cfg.body;
        const query = normalizeQuery(cfg.query);

        try {
          const responseBody = await getClient(input).request<unknown>(
            method,
            path,
            body,
            query,
          );
          await events.emit({ ok: true, status: 200, body: responseBody });
        } catch (err) {
          if (err instanceof GrafanaApiError) {
            await events.emit({
              ok: false,
              status: err.status,
              body: err.body,
              message: err.message,
            });
            return;
          }
          throw err;
        }
      },
    },
  },

  outputs: {
    default: {
      name: "Response",
      description:
        "Parsed response body, HTTP status, and error details when the request failed with a Grafana error.",
      default: true,
      type: {
        type: "object",
        properties: {
          ok: { type: "boolean" },
          status: { type: "number" },
          body: {},
          message: { type: "string" },
        },
        required: ["ok", "status"],
        additionalProperties: true,
      },
    },
  },
};
