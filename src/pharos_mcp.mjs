import { Client } from "@modelcontextprotocol/sdk/client/index.js";
import { StreamableHTTPClientTransport } from "@modelcontextprotocol/sdk/client/streamableHttp.js";

export const PHAROS_MCP_URL = "https://mcp.pharos.xyz/mcp";
const MCP_SESSION_TIMEOUT_MS = 20_000;

export async function createPharosMcpClient() {
  const transport = new StreamableHTTPClientTransport(new URL(PHAROS_MCP_URL), {
    requestInit: { signal: AbortSignal.timeout(MCP_SESSION_TIMEOUT_MS) }
  });
  const client = new Client({ name: "chain-flow-dashboard", version: "1.0.0" });

  try {
    await client.connect(transport);
    return client;
  } catch (error) {
    await client.close().catch(() => undefined);
    throw error;
  }
}
