# Transfer Readiness Flow Design

## Understanding

- Build a genuine Skill + Chain MCP composition for the Pharos Agent Arena task.
- A single user request asks whether a Pacific Mainnet wallet can afford a native PROS transfer and retain a requested reserve.
- The Skill decision consumes Chain MCP observations from the same run.
- A web reviewer companion may use saved observations, but must disclose that they are historical.
- The flow is read-only and must not sign, broadcast, request keys, fund accounts, or deploy contracts.
- A live proof is valid only when captured from an actual composed agent run; reference-repository evidence is not project evidence.

## Assumptions and constraints

- Target chain is Pharos Pacific Mainnet, chain ID `1672`, with native token `PROS` and 18 decimal places.
- Performance and scale target is a low-traffic demonstration, not a production financial service.
- No secrets, private keys, or sensitive account credentials are collected or stored.
- Required observations are validated at the boundary; missing or invalid data fails closed as `INSUFFICIENT_DATA`.
- Failures are visible to the user. No fabricated success, transaction hash, or silent fallback is permitted.
- The hosted companion is not the agent runtime and cannot claim fresh MCP data.
- Publishing and live-proof capture require access to the relevant GitHub, deployment, and agent/MCP environments.

## Final design

### Composed agent flow

For one user request, the agent loads the installed readiness Skill and creates one run ID. The Skill validates the request, follows the installed Pharos Skill Engine instructions, and obtains these observations through official Pharos Chain MCP:

1. Chain information and current block.
2. Sender balance pinned to the observed block.
3. Gas price and a native-transfer gas estimate.
4. The exact observations, normalized constraints, and run ID passed to the readiness evaluator.

The Skill independently validates the evaluator result before returning an explained decision. Observations from different run IDs must never be mixed. A gas estimate is not a guarantee.

### Readiness calculation

Amounts are decimal strings, parsed into integer units without floating-point arithmetic. The gas buffer is an integer number of basis points; use a 20% default (`2000` bps) when the request omits it.

```text
bufferedGas = ceil(estimatedGas * (10000 + bufferBps) / 10000)
modeledGasCostWei = bufferedGas * gasPriceWei
totalRequiredWei = amountWei + modeledGasCostWei + reserveWei
shortfallWei = max(totalRequiredWei - balanceWei, 0)
```

Return `READY` only if the balance covers `totalRequiredWei` and gas price is within the user's ceiling. Return `NOT_READY` when available observations prove either condition false. Return `INSUFFICIENT_DATA` when required observations are missing or invalid.

Validate addresses, positive transfer amount, non-negative reserve, at most 18 PROS decimal places, gas-price ceiling, and integer buffer basis points. Chain ID must match the supported network. Bind the balance to the requested sender and observed block, and bind the gas estimate to the requested sender, recipient, and transfer value. Never substitute zero for missing observations.

### Reviewer companion and evidence

The web companion evaluates user constraints against observations entered by the user. Every result identifies the supplied run, chain, block, and observation time, and marks the source as user-supplied and unverified. It does not invoke the Skill runtime or claim live reads. A genuine proof record can be entered there after one is captured, but the companion does not authenticate that record.

Store genuine proof records separately from illustrative examples. A live proof record should include run ID, capture time, chain/block context, MCP call order and outputs, normalized evaluator input/output, and independent validation result. Do not copy proof records from the reference repository.

The UI and API must expose failures rather than showing a successful result when a request fails. No route accepts signing material or broadcasts transactions.

### Verification

Tests cover exact decimal conversion, gas-buffer rounding, exact balance boundary, insufficient balance, gas-price ceiling, malformed inputs, missing observations, and historical provenance in companion responses. Tests using saved fixtures do not count as live MCP proof.

Before publication, run the project test suite and syntax checks, then verify the local Pages UI/API. Claim a live proof or public deployment only after it has actually been captured or deployed and is accessible to reviewers.

## Decision log

1. **Use a Skill-first, read-only composition.** Chosen over direct RPC in the app or a simulated flow because the task requires Skill + Chain MCP composition and does not require transaction execution.
2. **Use decimal strings and integer arithmetic.** Chosen over floating-point values to preserve exact PROS and gas calculations.
3. **Separate live proof from the reviewer companion.** Chosen so historical, reproducible demos cannot be mistaken for fresh agent-runtime calls.
4. **Fail closed and surface errors.** Chosen over defaults or synthetic success because missing chain data cannot justify a readiness decision.
