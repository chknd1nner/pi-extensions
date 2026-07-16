import type { PromptPath, PromptPathSegment } from "./types";

export type PathLookupResult =
  | { found: true; value: unknown }
  | { found: false };

export type PathReplacementResult = {
  value: unknown;
  changed: boolean;
};

function isPlainObject(value: unknown): value is Record<string, unknown> {
  if (value === null || typeof value !== "object") {
    return false;
  }

  const prototype = Object.getPrototypeOf(value);
  return prototype === Object.prototype || prototype === null;
}

export function findExactStringPaths(payload: unknown, expected: string): PromptPath[] {
  const paths: PromptPath[] = [];
  const ancestors = new WeakSet<object>();

  function visit(value: unknown, path: PromptPathSegment[]): void {
    if (typeof value === "string") {
      if (value === expected) {
        paths.push([...path]);
      }
      return;
    }

    if (value === null || typeof value !== "object" || ancestors.has(value)) {
      return;
    }

    if (!Array.isArray(value) && !isPlainObject(value)) {
      return;
    }

    ancestors.add(value);
    if (Array.isArray(value)) {
      for (let index = 0; index < value.length; index += 1) {
        if (Object.prototype.hasOwnProperty.call(value, index)) {
          visit(value[index], [...path, index]);
        }
      }
    } else {
      for (const [key, child] of Object.entries(value)) {
        visit(child, [...path, key]);
      }
    }
    ancestors.delete(value);
  }

  visit(payload, []);
  return paths;
}

export function getValueAtPath(payload: unknown, path: PromptPath): PathLookupResult {
  let current = payload;

  for (const segment of path) {
    if (typeof segment === "number") {
      if (
        !Array.isArray(current) ||
        !Number.isInteger(segment) ||
        segment < 0 ||
        !Object.prototype.hasOwnProperty.call(current, segment)
      ) {
        return { found: false };
      }
      current = current[segment];
      continue;
    }

    if (!isPlainObject(current) || !Object.prototype.hasOwnProperty.call(current, segment)) {
      return { found: false };
    }
    current = current[segment];
  }

  return { found: true, value: current };
}

export function replaceValueAtPath(
  payload: unknown,
  path: PromptPath,
  expected: string,
  replacement: string,
): PathReplacementResult {
  function replaceAt(value: unknown, pathIndex: number): PathReplacementResult {
    if (pathIndex === path.length) {
      return value === expected
        ? { value: replacement, changed: true }
        : { value, changed: false };
    }

    const segment = path[pathIndex];
    if (typeof segment === "number") {
      if (
        !Array.isArray(value) ||
        !Number.isInteger(segment) ||
        segment < 0 ||
        !Object.prototype.hasOwnProperty.call(value, segment)
      ) {
        return { value, changed: false };
      }

      const child = replaceAt(value[segment], pathIndex + 1);
      if (!child.changed) {
        return { value, changed: false };
      }

      const next = value.slice();
      next[segment] = child.value;
      return { value: next, changed: true };
    }

    if (!isPlainObject(value) || !Object.prototype.hasOwnProperty.call(value, segment)) {
      return { value, changed: false };
    }

    const child = replaceAt(value[segment], pathIndex + 1);
    if (!child.changed) {
      return { value, changed: false };
    }

    const next = Object.assign(Object.create(Object.getPrototypeOf(value)), value) as Record<string, unknown>;
    next[segment] = child.value;
    return { value: next, changed: true };
  }

  return replaceAt(payload, 0);
}
