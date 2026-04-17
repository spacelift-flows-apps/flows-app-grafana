export function asObject(
  raw: unknown,
  fieldName: string,
): Record<string, unknown> {
  if (raw === undefined || raw === null) return {};
  if (typeof raw !== "object" || Array.isArray(raw)) {
    throw new Error(`${fieldName} must be a JSON object.`);
  }
  return raw as Record<string, unknown>;
}

export function asStringMap(
  raw: unknown,
  fieldName: string,
): Record<string, string> | undefined {
  if (raw === undefined || raw === null) return undefined;
  if (typeof raw !== "object" || Array.isArray(raw)) {
    throw new Error(`${fieldName} must be a JSON object.`);
  }
  const out: Record<string, string> = {};
  for (const [k, v] of Object.entries(raw as Record<string, unknown>)) {
    if (v === undefined || v === null) continue;
    out[k] = typeof v === "string" ? v : JSON.stringify(v);
  }
  return Object.keys(out).length > 0 ? out : undefined;
}
