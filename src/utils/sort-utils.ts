/**
 * Object key sorting utilities for consistent configuration.
 */

/**
 * Sorts object keys alphabetically, case-insensitive.
 * Returns a new object with sorted keys, preserving the original object and original key case.
 *
 * @param obj - Object to sort
 * @returns New object with sorted keys (case-insensitive sort)
 */
export function sortObjectKeysCaseInsensitive<T extends Record<string, unknown>>(obj: T): T {
  if (!obj || typeof obj !== 'object' || Array.isArray(obj)) {
    return obj;
  }

  const sortedObj = {} as T;
  const keys = Object.keys(obj).sort((a, b) =>
    a.localeCompare(b, undefined, { sensitivity: 'base' })
  );
  for (const key of keys) {
    sortedObj[key as keyof T] = obj[key as keyof T];
  }
  return sortedObj;
}

/**
 * Sorts env and headers objects in a server configuration.
 * This is a convenience function for server template/instance configurations.
 *
 * Note: URL fields (including `url` and `proxy.url`) are intentionally left
 * untouched. A trailing slash in a URL can be semantically significant
 * (e.g. some MCP servers require an exact path like `/mcp/`), so URL
 * normalization must never rewrite persisted configuration values.
 *
 * @param config - Server configuration object with optional env and headers
 * @returns New object with sorted env and headers keys
 */
export function sortServerConfigEnvHeaders<
  T extends { env?: Record<string, string>; headers?: Record<string, string> }
>(config: T): T {
  const result = { ...config };

  if (result.env) {
    result.env = sortObjectKeysCaseInsensitive(result.env);
  }

  if (result.headers) {
    result.headers = sortObjectKeysCaseInsensitive(result.headers);
  }

  return result;
}
