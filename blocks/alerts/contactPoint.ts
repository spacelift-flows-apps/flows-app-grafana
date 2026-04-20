import { randomBytes, timingSafeEqual } from "node:crypto";
import { AppBlock, events, http, kv } from "@slflows/sdk/v1";
import { ContactPoint, GrafanaApiError } from "../../client/grafana";
import { getClient } from "../shared/client";

const KV_SECRET = "webhookSecret";
const KV_UID = "contactPointUid";

function buildDesiredContactPoint(
  name: string,
  webhookUrl: string,
  secret: string,
  maxAlerts: number,
  disableResolveMessage: boolean,
): Omit<ContactPoint, "uid"> {
  return {
    name,
    type: "webhook",
    settings: {
      url: webhookUrl,
      httpMethod: "POST",
      authorization_scheme: "Bearer",
      authorization_credentials: secret,
      maxAlerts,
    },
    disableResolveMessage,
  };
}

async function getOrCreateSecret(): Promise<string> {
  const existing = await kv.block.get(KV_SECRET);
  if (typeof existing.value === "string" && existing.value.length > 0) {
    return existing.value;
  }
  const secret = randomBytes(32).toString("hex");
  await kv.block.set({ key: KV_SECRET, value: secret });
  return secret;
}

function safeCompare(a: string, b: string): boolean {
  if (a.length !== b.length) return false;
  return timingSafeEqual(Buffer.from(a), Buffer.from(b));
}

function extractBearer(headers: Record<string, string>): string | undefined {
  for (const [k, v] of Object.entries(headers)) {
    if (k.toLowerCase() === "authorization") {
      const match = /^Bearer\s+(.+)$/i.exec(v);
      return match?.[1]?.trim();
    }
  }
  return undefined;
}

export const contactPointBlock: AppBlock = {
  name: "Contact Point",
  description:
    "Provisions a Grafana webhook contact point and emits an event for each alert routed to it. Attach it to a notification policy in Grafana to start receiving alerts.",
  category: "Alerts",
  entrypoint: true,

  config: {
    contactPointName: {
      name: "Contact Point Name",
      description:
        "Name of the contact point created in Grafana (Alerting → Contact points). Must be unique across your Grafana instance.",
      type: "string",
      required: true,
    },
    disableResolveMessage: {
      name: "Disable Resolve Messages",
      description:
        'If enabled, Grafana will not send a notification when an alert stops firing. Maps to Grafana\'s "Disable resolved message" setting.',
      type: "boolean",
      required: false,
      default: false,
    },
    maxAlerts: {
      name: "Max Alerts",
      description:
        "Maximum number of alerts to include in a single notification. 0 means no limit.",
      type: "number",
      required: false,
      default: 0,
    },
  },

  signals: {
    webhookUrl: {
      name: "Webhook URL",
      description: "The URL Grafana posts alerts to for this receiver.",
    },
    contactPointUid: {
      name: "Contact Point UID",
      description: "The UID of the contact point provisioned in Grafana.",
    },
    contactPointName: {
      name: "Contact Point Name",
      description: "The name of the provisioned contact point.",
    },
  },

  onSync: async (input) => {
    const contactPointName = input.block.config.contactPointName as string;
    const disableResolveMessage = input.block.config
      .disableResolveMessage as boolean;
    const maxAlerts = input.block.config.maxAlerts as number;

    const webhookUrl = input.block.http?.url;
    if (!webhookUrl) {
      return {
        newStatus: "failed",
        customStatusDescription:
          "Block has no HTTP endpoint — cannot provision webhook.",
      };
    }

    try {
      const client = getClient(input);
      const secret = await getOrCreateSecret();
      const desired = buildDesiredContactPoint(
        contactPointName,
        webhookUrl,
        secret,
        maxAlerts,
        disableResolveMessage,
      );

      const storedUid = await kv.block.get(KV_UID);
      let uid =
        typeof storedUid.value === "string" ? storedUid.value : undefined;

      if (uid) {
        try {
          await client.updateContactPoint(uid, { ...desired, uid });
        } catch (err) {
          if (err instanceof GrafanaApiError && err.status === 404) {
            uid = undefined;
          } else {
            throw err;
          }
        }
      }

      if (!uid) {
        const created = await client.createContactPoint(desired);
        uid = created.uid;
        await kv.block.set({ key: KV_UID, value: uid });
      }

      return {
        newStatus: "ready",
        customStatusDescription: null,
        signalUpdates: {
          webhookUrl,
          contactPointUid: uid,
          contactPointName,
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
        await getClient(input).deleteContactPoint(uid);
      } catch (err) {
        if (!(err instanceof GrafanaApiError && err.status === 404)) {
          throw err;
        }
      }
      await kv.block.delete([KV_UID]);
    }
    await kv.block.delete([KV_SECRET]);

    return {
      newStatus: "drained",
      signalUpdates: {
        webhookUrl: null,
        contactPointUid: null,
        contactPointName: null,
      },
    };
  },

  http: {
    onRequest: async (input) => {
      const { requestId, method, headers, body } = input.request;

      if (method !== "POST") {
        await http.respond(requestId, {
          statusCode: 405,
          headers: { Allow: "POST" },
          body: { error: "Method not allowed" },
        });
        return;
      }

      const provided = extractBearer(headers);
      const stored = await kv.block.get(KV_SECRET);
      const expected =
        typeof stored.value === "string" ? stored.value : undefined;

      if (!provided || !expected || !safeCompare(provided, expected)) {
        await http.respond(requestId, {
          statusCode: 401,
          body: { error: "Unauthorized" },
        });
        return;
      }

      await events.emit(body ?? {});
      await http.respond(requestId, { statusCode: 200, body: { ok: true } });
    },
  },

  outputs: {
    default: {
      name: "Alert",
      description:
        "A Grafana alert notification payload. Shape follows Grafana's webhook format.",
      default: true,
      type: {
        type: "object",
        properties: {
          receiver: { type: "string" },
          status: { type: "string" },
          alerts: {
            type: "array",
            items: {
              type: "object",
              additionalProperties: true,
            },
          },
          groupLabels: { type: "object", additionalProperties: true },
          commonLabels: { type: "object", additionalProperties: true },
          commonAnnotations: { type: "object", additionalProperties: true },
          externalURL: { type: "string" },
          version: { type: "string" },
          groupKey: { type: "string" },
          truncatedAlerts: { type: "number" },
          orgId: { type: "number" },
          title: { type: "string" },
          state: { type: "string" },
          message: { type: "string" },
        },
        additionalProperties: true,
      },
    },
  },
};
