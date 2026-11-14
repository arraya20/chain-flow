import { evaluateReadiness, validateReadinessConstraints } from "./readiness.mjs";
import { PHAROS_MCP_URL } from "./pharos_mcp.mjs";

const CHAIN_ID = 1672;

function parseToolResult(response, toolName) {
  if (response?.isError) {
    throw new Error(`Pharos MCP ${toolName} call failed`);
  }

  const text = response?.content?.find((item) => item.type === "text")?.text;
  if (typeof text !== "string") {
    throw new Error(`Pharos MCP ${toolName} returned no result`);
  }

  let result;
  try {
    result = JSON.parse(text);
  } catch {
    throw new Error(`Pharos MCP ${toolName} returned invalid JSON`);
  }
  if (result?.error) {
    throw new Error(`Pharos MCP ${toolName} call failed`);
  }
  return result;
}

function parseQuantity(value, field) {
  if (typeof value !== "string" ||
      (!/^0x[0-9a-fA-F]+$/.test(value) && !/^\d+$/.test(value))) {
    throw new Error(`Pharos MCP returned an invalid ${field}`);
  }
  return BigInt(value);
}

function toHexQuantity(value) {
  return `0x${value.toString(16)}`;
}

function toIsoTimestamp(value) {
  const seconds = parseQuantity(value, "block timestamp");
  const timestamp = new Date(Number(seconds * 1000n));
  if (!Number.isFinite(timestamp.getTime())) {
    throw new Error("Pharos MCP returned an invalid block timestamp");
  }
  return timestamp.toISOString();
}

async function callTool(client, name, args) {
  return parseToolResult(
    await client.callTool({ name, arguments: args }),
    name
  );
}

export async function runLiveReadiness(
  constraints,
  {
    createClient,
    createRunId = () => `chain-flow-${crypto.randomUUID()}`,
    now = () => new Date()
  } = {}
) {
  const { amountWei } = validateReadinessConstraints(constraints);
  if (typeof createClient !== "function") {
    throw new Error("A Pharos MCP client factory is required");
  }

  const client = await createClient();
  try {
    const chain = await callTool(client, "get_chain_info", {});
    if (chain.chainId !== CHAIN_ID || chain.nativeSymbol !== "PROS") {
      throw new Error("Pharos MCP is connected to an unsupported network");
    }

    const latestBlock = parseQuantity(chain.latestBlock, "latest block");
    const blockTag = latestBlock.toString();
    const block = await callTool(client, "get_block", {
      block: blockTag,
      includeTransactions: false
    });
    const blockNumber = parseQuantity(block.number, "block number");
    if (blockNumber !== latestBlock) {
      throw new Error("Pharos MCP returned a different block than requested");
    }

    const balance = await callTool(client, "get_balance", {
      address: constraints.sender,
      block: blockTag
    });
    const gasPrice = await callTool(client, "get_gas_price", {});
    let estimate;
    let estimateUnavailable = false;
    try {
      estimate = await callTool(client, "estimate_gas", {
        transaction: {
          from: constraints.sender,
          to: constraints.recipient,
          value: toHexQuantity(amountWei)
        }
      });
    } catch {
      estimateUnavailable = true;
    }
    const fetchedAt = now().toISOString();
    const observations = {
      runId: createRunId(),
      chainId: String(chain.chainId),
      blockNumber: blockNumber.toString(),
      observedAt: toIsoTimestamp(block.timestamp),
      fetchedAt,
      balanceWei: balance.balanceWei,
      balanceAddress: balance.address,
      balanceBlockNumber: blockNumber.toString(),
      gasPriceWei: gasPrice.gasPriceWei,
      estimatedGas: estimate?.gas,
      estimateFrom: constraints.sender,
      estimateTo: constraints.recipient,
      estimatedValueWei: amountWei.toString()
    };

    const result = evaluateReadiness({ constraints, observations }, {
      kind: "live_chain_mcp",
      verified: true,
      source: PHAROS_MCP_URL,
      fetchedAt
    });
    if (estimateUnavailable && result.status !== "INSUFFICIENT_DATA") {
      result.observationErrors = {
        estimateGas: "Gas estimate unavailable; no value was substituted."
      };
    }
    return result;
  } finally {
    await client.close();
  }
}
