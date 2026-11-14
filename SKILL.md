---
name: pharos-transfer-readiness
description: Assess whether a Pharos Pacific Mainnet wallet can make a native PROS transfer and retain a requested reserve, using observations fetched through official Chain MCP in the same agent run.
---

# Pharos Transfer Readiness

This is a read-only Skill. For each request, create one run ID and assess whether the sender can transfer the requested native PROS amount, pay modeled gas, and retain the requested reserve.

## Required sequence

1. Validate sender and recipient as EVM addresses. Require a positive decimal-string `amountPros`, a non-negative decimal-string `reservePros`, and a non-negative integer-string `gasPriceCeilingWei`. PROS supports at most 18 decimal places. Accept optional non-negative integer `bufferBps`; default to `2000`.
   If the natural-language request and structured values disagree, or a required value cannot be determined, ask for clarification before making chain calls.
2. Load and follow the installed official `pharos-skill-engine` instructions. If it is unavailable, state that the Skill Engine was not loaded; do not claim a composed run.
3. Use official Pharos Chain MCP in this same run. Call `get_chain_info` and require chain ID `1672` (Pacific Mainnet). Obtain a block with `get_block`, then call `get_balance` for the sender at that block. Call `get_gas_price` and `estimate_gas` for the native transfer. Record the exact tool outputs and their run ID. If an observation cannot be pinned to the same block, disclose that limitation.
4. Normalize those exact outputs and the request to this shape. Include the addresses and value used in the balance/estimate calls so the evaluator can reject observations for a different sender, block, or transfer:

   ```json
   {
     "constraints": {
       "sender": "0x...",
       "recipient": "0x...",
       "amountPros": "0.0001",
       "reservePros": "0.0001",
       "gasPriceCeilingWei": "100000000000",
       "bufferBps": 2000
     },
     "observations": {
       "runId": "one-run-id",
       "chainId": "1672",
       "blockNumber": "123",
       "observedAt": "2026-11-14T12:00:00.000Z",
       "balanceWei": "1000000000000000000",
       "balanceAddress": "0x...",
       "balanceBlockNumber": "123",
       "gasPriceWei": "10000000000",
       "estimatedGas": "21000",
       "estimateFrom": "0x...",
       "estimateTo": "0x...",
       "estimatedValueWei": "100000000000000",
       "source": "live_chain_mcp"
     }
   }
   ```

5. Pass that JSON to `node scripts/evaluate-readiness.mjs` on stdin. Do not replace missing MCP values with zero, fixtures, or values from another run.
6. Independently check the evaluator's arithmetic and status against the exact MCP observations before responding. If anything differs, report a validation failure rather than `COMPLETE`.

## Decision rules

```text
bufferedGas = ceil(estimatedGas * (10000 + bufferBps) / 10000)
modeledGasCostWei = bufferedGas * gasPriceWei
totalRequiredWei = amountWei + modeledGasCostWei + reserveWei
shortfallWei = max(totalRequiredWei - balanceWei, 0)
```

Return `READY` only when the balance covers `totalRequiredWei` and the observed gas price is within the user's ceiling. Return `NOT_READY` when valid observations prove either condition false. Return `INSUFFICIENT_DATA` when required observations are missing, malformed, or from the wrong chain.

Gas estimates are not guarantees. Never request keys, sign, broadcast, fund an account, deploy a contract, or call `send_raw_transaction`.

The web page is a deterministic evaluator for user-supplied values. It does not invoke this Skill or fetch Chain MCP data, and it marks supplied observations as unverified.
