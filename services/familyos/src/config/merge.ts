type DeepPartial<T> = T extends Array<infer U>
  ? Array<DeepPartial<U>>
  : T extends object
    ? { [K in keyof T]?: DeepPartial<T[K]> }
    : T;

export function deepMerge<T>(base: T, overrides: DeepPartial<T>): T {
  if (Array.isArray(base) || Array.isArray(overrides)) {
    return structuredClone((overrides ?? base) as T);
  }

  if (
    base &&
    overrides &&
    typeof base === "object" &&
    typeof overrides === "object" &&
    !Array.isArray(base) &&
    !Array.isArray(overrides)
  ) {
    const result: Record<string, unknown> = {
      ...(structuredClone(base as Record<string, unknown>) ?? {}),
    };

    for (const [key, value] of Object.entries(overrides as Record<string, unknown>)) {
      if (value === undefined) continue;

      const current = result[key];
      if (
        current &&
        value &&
        typeof current === "object" &&
        typeof value === "object" &&
        !Array.isArray(current) &&
        !Array.isArray(value)
      ) {
        result[key] = deepMerge(
          current as Record<string, unknown>,
          value as Record<string, unknown>,
        );
      } else {
        result[key] = structuredClone(value);
      }
    }

    return result as T;
  }

  return structuredClone((overrides ?? base) as T);
}
