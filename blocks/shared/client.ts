import { AppInput } from "@slflows/sdk/v1";
import { GrafanaClient } from "../../client/grafana";

export interface GrafanaCreds {
  grafanaUrl: string;
  token: string;
}

export function getCreds(input: AppInput): GrafanaCreds {
  return {
    grafanaUrl: input.app.config.grafanaUrl as string,
    token: input.app.config.serviceAccountToken as string,
  };
}

export function getClient(input: AppInput): GrafanaClient {
  return new GrafanaClient(getCreds(input));
}
