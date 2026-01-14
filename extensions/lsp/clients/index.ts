/**
 * Linter client implementations.
 */

export { BiomeClient, createBiomeClient } from "./biome-client";
export { createLspLinterClient, LspLinterClient } from "./lsp-linter-client";

import type { LinterClient, ServerConfig } from "../types";
import { createLspLinterClient } from "./lsp-linter-client";

const clientCache = new Map<string, LinterClient>();

export function getLinterClient(
  serverName: string,
  config: ServerConfig,
  cwd: string,
): LinterClient {
  const key = `${serverName}:${cwd}`;

  let client = clientCache.get(key);
  if (client) {
    return client;
  }

  if (config.createClient) {
    client = config.createClient(config, cwd);
  } else {
    client = createLspLinterClient(config, cwd);
  }

  clientCache.set(key, client);
  return client;
}

export function clearLinterClientCache(): void {
  for (const client of clientCache.values()) {
    client.dispose?.();
  }
  clientCache.clear();
}
