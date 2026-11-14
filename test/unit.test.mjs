import { spawnSync } from "node:child_process";
import { test, run, assert, equal } from "./harness.mjs";
import { onRequestPost } from "../functions/api/flow.js";

const observations = {
  runId: "run-test-1",
  chainId: 1672,
  blockNumber: 21051707,
  observedAt: "2026-11-14T00:00:00.000Z",
  balanceWei: "2000000000000000000",
  balanceAddress: "0x1111111111111111111111111111111111111111",
  balanceBlockNumber: "21051707",
  gasPriceWei: "1000000000",
  estimatedGas: "21000",
  estimateFrom: "0x1111111111111111111111111111111111111111",
  estimateTo: "0x2222222222222222222222222222222222222222",
  estimatedValueWei: "1000000000000000000",
  source: "historical"
};

const constraints = {
  sender: "0x1111111111111111111111111111111111111111",
  recipient: "0x2222222222222222222222222222222222222222",
  amountPros: "1",
  reservePros: "0.5",
  gasPriceCeilingWei: "2000000000",
  bufferBps: 2000
};

async function postEvaluation(body) {
  const response = await onRequestPost({
    request: new Request("https://example.test/api/flow", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(body)
    })
  });
  return { status: response.status, body: await response.json() };
}

const unitTests = [
  test("reviewer companion reports readiness and exact buffered gas cost", async () => {
    const response = await postEvaluation({ constraints, observations });

    equal(response.status, 200);
    equal(response.body.result.status, "READY");
    equal(response.body.result.bufferedGas, "25200");
    equal(response.body.result.modeledGasCostWei, "25200000000000");
    equal(response.body.result.provenance.kind, "user_supplied");
    equal(response.body.result.provenance.verified, false);
    equal(response.body.result.provenance.blockNumber, "21051707");
  }),

  test("reviewer companion rounds buffered gas up to the next whole unit", async () => {
    const response = await postEvaluation({
      constraints,
      observations: { ...observations, estimatedGas: "21001" }
    });

    equal(response.body.result.bufferedGas, "25202");
  }),

  test("reviewer companion calculates large buffer values without number rounding", async () => {
    const response = await postEvaluation({
      constraints: { ...constraints, bufferBps: Number.MAX_SAFE_INTEGER },
      observations: { ...observations, estimatedGas: "10000" }
    });

    equal(response.body.result.bufferedGas, "9007199254750991");
  }),

  test("reviewer companion accepts an exactly sufficient balance", async () => {
    const response = await postEvaluation({
      constraints,
      observations: { ...observations, balanceWei: "1500025200000000000" }
    });

    equal(response.body.result.status, "READY");
    equal(response.body.result.shortfallWei, "0");
  }),

  test("reviewer companion reports insufficient balance with exact shortfall", async () => {
    const response = await postEvaluation({
      constraints,
      observations: { ...observations, balanceWei: "1500000000000000000" }
    });

    equal(response.body.result.status, "NOT_READY");
    equal(response.body.result.shortfallWei, "25200000000000");
  }),

  test("reviewer companion rejects a balance observation for another sender", async () => {
    const response = await postEvaluation({
      constraints,
      observations: { ...observations, balanceAddress: "0x3333333333333333333333333333333333333333" }
    });

    equal(response.body.result.status, "INSUFFICIENT_DATA");
    assert(response.body.result.invalid.includes("balanceAddress"));
  }),

  test("reviewer companion rejects balance pinned to a different block", async () => {
    const response = await postEvaluation({
      constraints,
      observations: { ...observations, balanceBlockNumber: "21051708" }
    });

    equal(response.body.result.status, "INSUFFICIENT_DATA");
    assert(response.body.result.invalid.includes("balanceBlockNumber"));
  }),

  test("reviewer companion rejects a gas estimate for a different transfer", async () => {
    const response = await postEvaluation({
      constraints,
      observations: { ...observations, estimatedValueWei: "2000000000000000000" }
    });

    equal(response.body.result.status, "INSUFFICIENT_DATA");
    assert(response.body.result.invalid.includes("estimatedValueWei"));
  }),

  test("reviewer companion rejects a gas price above the requested ceiling", async () => {
    const response = await postEvaluation({
      constraints: { ...constraints, gasPriceCeilingWei: "500000000" },
      observations
    });

    equal(response.body.result.status, "NOT_READY");
    assert(response.body.result.reasons.includes("GAS_PRICE_ABOVE_CEILING"));
  }),

  test("reviewer companion fails closed when a required observation is missing", async () => {
    const incomplete = { ...observations };
    delete incomplete.estimatedGas;
    const response = await postEvaluation({ constraints, observations: incomplete });

    equal(response.body.result.status, "INSUFFICIENT_DATA");
    assert(response.body.result.missing.includes("estimatedGas"));
  }),

  test("reviewer companion rejects malformed PROS amounts as client errors", async () => {
    const response = await postEvaluation({
      constraints: { ...constraints, amountPros: "1.0000000000000000001" },
      observations
    });

    equal(response.status, 400);
    equal(response.body.ok, false);
  }),

  test("reviewer companion rejects unreasonably long numeric inputs", async () => {
    const response = await postEvaluation({
      constraints: { ...constraints, amountPros: "9".repeat(129) },
      observations
    });

    equal(response.status, 400);
  }),

  test("reviewer companion rejects an invalid sender address", async () => {
    const response = await postEvaluation({
      constraints: { ...constraints, sender: "not-an-address" },
      observations
    });

    equal(response.status, 400);
  }),

  test("reviewer companion rejects oversized request bodies", async () => {
    const response = await postEvaluation({
      constraints,
      observations,
      padding: "x".repeat(17000)
    });

    equal(response.status, 413);
  }),

  test("reviewer companion requires the gas-price ceiling as a decimal string", async () => {
    const response = await postEvaluation({
      constraints: { ...constraints, gasPriceCeilingWei: 2000000000 },
      observations
    });

    equal(response.status, 400);
  }),

  test("reviewer companion rejects null instead of defaulting the gas buffer", async () => {
    const response = await postEvaluation({
      constraints: { ...constraints, bufferBps: null },
      observations
    });

    equal(response.status, 400);
  }),

  test("reviewer companion marks unsupported-chain observations insufficient", async () => {
    const response = await postEvaluation({
      constraints,
      observations: { ...observations, chainId: 1 }
    });

    equal(response.body.result.status, "INSUFFICIENT_DATA");
    assert(response.body.result.missing.includes("chainId"));
  }),

  test("reviewer companion requires an ISO 8601 observation timestamp", async () => {
    const response = await postEvaluation({
      constraints,
      observations: { ...observations, observedAt: "January 1, 2026" }
    });

    equal(response.body.result.status, "INSUFFICIENT_DATA");
    assert(response.body.result.missing.includes("observedAt"));
  }),

  test("Skill evaluator CLI reads one JSON request from stdin", () => {
    const processResult = spawnSync("node", ["scripts/evaluate-readiness.mjs"], {
      input: JSON.stringify({ constraints, observations }),
      encoding: "utf8"
    });

    equal(processResult.status, 0, processResult.stderr);
    const result = JSON.parse(processResult.stdout);
    equal(result.status, "READY");
    equal(result.provenance.runId, observations.runId);
  })
];

run(unitTests);
