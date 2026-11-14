import { test, run, assert, equal } from "./harness.mjs";
import { handleFlowPost } from "../functions/api/flow.js";
import { evaluateReadiness } from "../src/readiness.mjs";

const requestConstraints = {
  sender: "0x4117b9737f64d816be36f6c18c72409c98e4737c",
  recipient: "0x15ddce897d76ac39c188ade4d353711a60395315",
  amountPros: "0.0001",
  reservePros: "0.0001",
  gasPriceCeilingWei: "100000000000",
  bufferBps: 2000
};

const blockTimestamp = "2026-11-15T00:00:00.000Z";
const blockTimestampHex = `0x${Math.floor(Date.parse(blockTimestamp) / 1000).toString(16)}`;

function createMcpClient(overrides = {}) {
  const calls = [];
  let closed = false;
  const results = {
    get_chain_info: { chainId: 1672, latestBlock: "21051707", nativeSymbol: "PROS" },
    get_block: {
      number: "0x141393b",
      timestamp: blockTimestampHex,
      hash: `0x${"a".repeat(64)}`
    },
    get_balance: {
      address: requestConstraints.sender,
      balanceWei: "988631830399322430",
      symbol: "PROS"
    },
    get_gas_price: { gasPriceWei: "10000000000" },
    estimate_gas: { gas: "21000" },
    ...overrides
  };

  return {
    calls,
    get closed() {
      return closed;
    },
    async close() {
      closed = true;
    },
    async callTool({ name, arguments: args }) {
      calls.push({ name, args });
      const result = results[name];
      if (result instanceof Error) throw result;
      if (result?.isError) return { isError: true, content: [{ type: "text", text: result.message }] };
      return {
        content: [{ type: "text", text: JSON.stringify(result) }]
      };
    }
  };
}

async function postFlow(constraints = requestConstraints, overrides = {}) {
  const client = createMcpClient(overrides.results);
  const response = await handleFlowPost(
    new Request("https://example.test/api/flow", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ constraints })
    }),
    {
      createMcpClient: overrides.createMcpClient ?? (async () => client),
      createRunId: () => "chain-flow-test-run",
      now: () => new Date("2026-11-15T00:00:05.000Z")
    }
  );
  return { status: response.status, body: await response.json(), client };
}

const unitTests = [
  test("live evaluator reads required Chain MCP tools and assesses the current transfer", async () => {
    const response = await postFlow();

    equal(response.status, 200);
    equal(response.body.result.status, "READY");
    equal(response.body.result.provenance.runId, "chain-flow-test-run");
    equal(response.body.result.provenance.kind, "live_chain_mcp");
    equal(response.body.result.provenance.source, "https://mcp.pharos.xyz/mcp");
    equal(response.body.result.provenance.verified, true);
    equal(response.body.result.provenance.blockNumber, "21051707");
    equal(response.body.result.provenance.observedAt, blockTimestamp);
    equal(response.body.result.provenance.fetchedAt, "2026-11-15T00:00:05.000Z");
    equal(response.body.result.modeledGasCostWei, "252000000000000");
    equal(response.body.result.totalRequiredWei, "452000000000000");
    equal(response.client.closed, true);
    equal(response.client.calls.map(({ name }) => name).join(","),
      "get_chain_info,get_block,get_balance,get_gas_price,estimate_gas");
  }),

  test("live evaluator pins balance to the observed block and estimates the requested transfer", async () => {
    const response = await postFlow();
    const getBlock = response.client.calls[1];
    const getBalance = response.client.calls[2];
    const estimateGas = response.client.calls[4];

    equal(getBlock.args.block, "21051707");
    equal(getBlock.args.includeTransactions, false);
    equal(getBalance.args.address, requestConstraints.sender);
    equal(getBalance.args.block, "21051707");
    equal(estimateGas.args.transaction.from, requestConstraints.sender);
    equal(estimateGas.args.transaction.to, requestConstraints.recipient);
    equal(estimateGas.args.transaction.value, "0x5af3107a4000");
  }),

  test("live evaluator rejects an unsupported chain and closes its MCP session", async () => {
    const response = await postFlow(requestConstraints, {
      results: {
        get_chain_info: { chainId: 1, latestBlock: "100", nativeSymbol: "ETH" }
      }
    });

    equal(response.status, 502);
    equal(response.body.ok, false);
    equal(response.client.calls.length, 1);
    equal(response.client.closed, true);
  }),

  test("live evaluator rejects malformed constraints without calling Chain MCP", async () => {
    const response = await postFlow({ ...requestConstraints, sender: "invalid" });

    equal(response.status, 400);
    equal(response.body.ok, false);
    equal(response.client.calls.length, 0);
    equal(response.client.closed, false);
  }),

  test("live evaluator surfaces MCP tool errors instead of fabricating a decision", async () => {
    const response = await postFlow(requestConstraints, {
      results: { get_gas_price: { isError: true, message: "upstream unavailable" } }
    });

    equal(response.status, 502);
    equal(response.body.ok, false);
    equal(response.body.result, undefined);
    equal(response.client.closed, true);
  }),

  test("live evaluator can conclude not ready when transfer plus reserve already exceed balance", async () => {
    const response = await postFlow(requestConstraints, {
      results: {
        get_balance: {
          address: requestConstraints.sender,
          balanceWei: "100000000000000",
          symbol: "PROS"
        },
        estimate_gas: { isError: true, message: "insufficient funds" }
      }
    });

    equal(response.status, 200);
    equal(response.body.result.status, "NOT_READY");
    assert(response.body.result.reasons.includes("BALANCE_BELOW_TRANSFER_AND_RESERVE"));
    equal(response.body.result.missing.includes("estimatedGas"), true);
    equal(response.body.result.provenance.runId, "chain-flow-test-run");
  }),

  test("live evaluator reports insufficient data when failed gas estimation cannot determine readiness", async () => {
    const response = await postFlow(requestConstraints, {
      results: { estimate_gas: { isError: true, message: "temporary RPC error" } }
    });

    equal(response.status, 200);
    equal(response.body.result.status, "INSUFFICIENT_DATA");
    assert(response.body.result.missing.includes("estimatedGas"));
    equal(response.body.result.observationErrors.estimateGas, "Gas estimate unavailable; no value was substituted.");
  }),

  test("live evaluator rejects oversized request bodies", async () => {
    const response = await handleFlowPost(
      new Request("https://example.test/api/flow", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ constraints: requestConstraints, extra: "x".repeat(17000) })
      }),
      { createMcpClient: async () => { throw new Error("should not be called"); } }
    );

    equal(response.status, 413);
  }),

  test("live evaluator requires a JSON content type", async () => {
    const response = await handleFlowPost(
      new Request("https://example.test/api/flow", {
        method: "POST",
        headers: { "Content-Type": "text/plain" },
        body: JSON.stringify({ constraints: requestConstraints })
      }),
      { createMcpClient: async () => { throw new Error("should not be called"); } }
    );

    equal(response.status, 415);
  }),

  test("readiness evaluator still uses exact integer arithmetic", () => {
    const result = evaluateReadiness({
      constraints: requestConstraints,
      observations: {
        runId: "chain-flow-test-run",
        chainId: "1672",
        blockNumber: "21051707",
        observedAt: blockTimestamp,
        fetchedAt: "2026-11-15T00:00:05.000Z",
        balanceWei: "988631830399322430",
        balanceAddress: requestConstraints.sender,
        balanceBlockNumber: "21051707",
        gasPriceWei: "10000000000",
        estimatedGas: "21000",
        estimateFrom: requestConstraints.sender,
        estimateTo: requestConstraints.recipient,
        estimatedValueWei: "100000000000000",
        source: "pharos_mcp"
      }
    });

    equal(result.status, "READY");
    equal(result.bufferedGas, "25200");
    equal(result.modeledGasCostWei, "252000000000000");
  })
];

run(unitTests);
