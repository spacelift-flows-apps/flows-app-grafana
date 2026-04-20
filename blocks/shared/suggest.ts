import { SuggestValuesInput, SuggestValuesOutput } from "@slflows/sdk/v1";
import {
  getContactPointsCached,
  getDatasourcesCached,
  getFoldersCached,
} from "../../client/grafana";
import { getCreds } from "./client";

interface Option {
  label: string;
  value: unknown;
}

export function filterBySearch<T extends { label: string }>(
  items: T[],
  searchPhrase?: string,
): T[] {
  if (!searchPhrase) return items;
  const q = searchPhrase.toLowerCase();
  return items.filter((it) => it.label.toLowerCase().includes(q));
}

export function suggestFromList(
  items: readonly Option[],
  searchPhrase?: string,
  limit = 50,
): SuggestValuesOutput {
  return {
    suggestedValues: filterBySearch([...items], searchPhrase).slice(0, limit),
  };
}

export async function suggestDatasourceUid(
  input: SuggestValuesInput,
): Promise<SuggestValuesOutput> {
  const { grafanaUrl, token } = getCreds(input);
  const datasources = await getDatasourcesCached(grafanaUrl, token);
  return suggestFromList(
    datasources.map((ds) => ({
      label: `${ds.name} (${ds.type})`,
      value: ds.uid,
    })),
    input.searchPhrase,
  );
}

const COMMON_DATASOURCE_TYPES = [
  "prometheus",
  "loki",
  "tempo",
  "mysql",
  "postgres",
  "mssql",
  "influxdb",
  "elasticsearch",
  "opensearch",
  "cloudwatch",
  "graphite",
  "testdata",
] as const;

export async function suggestDatasourceType(
  input: SuggestValuesInput,
): Promise<SuggestValuesOutput> {
  const { grafanaUrl, token } = getCreds(input);
  const selectedUid =
    (input.staticInputConfig?.datasourceUid as string | undefined) ??
    (input.block.config?.datasourceUid as string | undefined);

  if (selectedUid) {
    const datasources = await getDatasourcesCached(grafanaUrl, token);
    const match = datasources.find((ds) => ds.uid === selectedUid);
    if (match) {
      return {
        suggestedValues: [{ label: match.type, value: match.type }],
        message: `Derived from datasource "${match.name}".`,
      };
    }
  }

  const options = COMMON_DATASOURCE_TYPES.map((t) => ({ label: t, value: t }));
  return {
    suggestedValues: filterBySearch(options, input.searchPhrase),
    message: selectedUid
      ? "Datasource UID did not match a known datasource — pick a type manually."
      : "Set a static Datasource UID to auto-derive its type.",
  };
}

export async function suggestFolder(
  input: SuggestValuesInput,
): Promise<SuggestValuesOutput> {
  const { grafanaUrl, token } = getCreds(input);
  const folders = await getFoldersCached(grafanaUrl, token);
  return suggestFromList(
    folders.map((f) => ({ label: f.title, value: f.uid })),
    input.searchPhrase,
  );
}

export async function suggestContactPoint(
  input: SuggestValuesInput,
): Promise<SuggestValuesOutput> {
  const { grafanaUrl, token } = getCreds(input);
  const points = await getContactPointsCached(grafanaUrl, token);
  return suggestFromList(
    points.map((cp) => ({
      label: cp.provenance
        ? `${cp.name} (${cp.type}, flows-managed)`
        : `${cp.name} (${cp.type})`,
      value: cp.name,
    })),
    input.searchPhrase,
  );
}
