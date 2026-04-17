import { defineApp } from "@slflows/sdk/v1";
import { blocks } from "./blocks";
import { getClient } from "./blocks/shared/client";
import { GrafanaApiError } from "./client/grafana";

export const app = defineApp({
  name: "Grafana",
  installationInstructions: `Connect Flows to a Grafana instance — either self-hosted or Grafana Cloud.

### 1. Create a service account token

In Grafana, go to **Administration → Users and access → Service accounts**, create a service account with the roles you need (at minimum **Viewer** for read-only; **Editor** or higher to execute datasource queries that write, or to provision alert contact points), then **Add service account token**. Copy the token — Grafana will only show it once.

### 2. Fill in the config

- **Grafana URL** — the base URL of your instance. For Grafana Cloud this is \`https://<stack>.grafana.net\`; for self-hosted it's whatever host you put Grafana behind (no trailing \`/api\`).
- **Service Account Token** — the token you just created.

The app will call \`GET /api/user\` on install to verify connectivity and authentication.
`,

  blocks,

  config: {
    grafanaUrl: {
      name: "Grafana URL",
      description:
        "Base URL of your Grafana instance (e.g. https://myorg.grafana.net or https://grafana.example.com). No trailing slash or /api path.",
      type: "string",
      required: true,
    },
    serviceAccountToken: {
      name: "Service Account Token",
      description:
        "Token created for a Grafana service account (Administration → Service accounts → Add token).",
      type: "string",
      required: true,
      sensitive: true,
    },
  },

  signals: {
    serviceAccountLogin: {
      name: "Service Account Login",
      description:
        "The login name of the authenticated service account (from /api/user).",
    },
    orgId: {
      name: "Org ID",
      description:
        "The Grafana organization ID the service account belongs to.",
    },
  },

  onSync: async (input) => {
    const grafanaUrl = input.app.config.grafanaUrl as string;

    if (!grafanaUrl || !/^https?:\/\//.test(grafanaUrl)) {
      return {
        newStatus: "failed",
        customStatusDescription:
          "Grafana URL must be an absolute http(s) URL (e.g. https://myorg.grafana.net).",
      };
    }

    try {
      const user = await getClient(input).getCurrentUser();
      return {
        newStatus: "ready",
        customStatusDescription: null,
        signalUpdates: {
          serviceAccountLogin: user.login,
          orgId: user.orgId,
        },
      };
    } catch (err) {
      if (err instanceof GrafanaApiError) {
        const hint =
          err.status === 401 || err.status === 403
            ? "Check the service account token and its role."
            : err.status === 404
              ? "Check the Grafana URL — /api/user was not found at that host."
              : "See Grafana server logs for details.";
        return {
          newStatus: "failed",
          customStatusDescription: `Grafana returned ${err.status}: ${err.message}. ${hint}`,
        };
      }
      const msg = err instanceof Error ? err.message : String(err);
      return {
        newStatus: "failed",
        customStatusDescription: `Could not reach Grafana: ${msg}`,
      };
    }
  },
});
