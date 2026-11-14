# Transfer Readiness Flow Design

## Understanding

- Build a genuine Skill + Chain MCP composition for the Pharos Agent Arena task.
- A single user request asks whether a Pacific Mainnet wallet can afford a native PROS transfer and retain a requested reserve.
- The Skill decision consumes Chain MCP observations from the same run.
- The web dashboard fetches a fresh observation set from the official Pharos Chain MCP endpoint for each submitted request.
- The dashboard is not an LLM agent and does not invoke the Skill Engine; agent-composition proof must be captured separately.
- The flow is read-only and must not sign, broadcast, request keys, fund accounts, or deploy contracts.
- A live proof is valid only when captured from an actual composed agent run; reference-repository evidence is not project evidence.

## Assumptions and constraints

- Target chain is Pharos Pacific Mainnet, chain ID `1672`, with native token `PROS` and 18 decimal places.
- Performance and scale target is a low-traffic demonstration, not a production financial service.
- No secrets, private keys, or sensitive account credentials are collected or stored.
- Required observations are validated at the boundary; missing or invalid data fails closed as `INSUFFICIENT_DATA`.
- Failures are visible to the user. No fabricated success, transaction hash, or silent fallback is permitted.
- The dashboard uses a public Streamable HTTP MCP endpoint and makes no signing or broadcast calls.
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

### Live dashboard and evidence

The Cloudflare Pages Function opens a Streamable HTTP client session to the official public `https://mcp.pharos.xyz/mcp` endpoint. It fetches chain info, latest block, sender balance pinned to that block, gas price, and a gas estimate for the exact requested transfer. It generates a `chain-flow-<uuid>` run ID and records the actual latest-block timestamp separately from the wall-clock fetch timestamp. The function only calls read-only MCP tools.

The dashboard performs live MCP reads and deterministic evaluation, but it does not run an LLM or invoke the Skill Engine. Genuine Skill composition evidence must come from an agent run following `SKILL.md`. Do not copy proof records from the reference repository.

The UI and API expose failures rather than showing a successful result when a request fails. No route accepts signing material or broadcasts transactions.

### Verification

Tests cover exact decimal conversion, gas-buffer rounding, exact balance boundary, insufficient balance, gas-price ceiling, malformed inputs, missing observations, MCP call order, exact call parameters, failure handling, and provenance. Tests use a fake MCP client; a separate preview request verifies the live endpoint. Dashboard requests do not count as agent-loaded Skill proof.

Before publication, run the project test suite and syntax checks, then verify the local Pages UI/API. Claim a live proof or public deployment only after it has actually been captured or deployed and is accessible to reviewers.

## Decision log

1. **Use Skill-first read-only agent composition and direct MCP for dashboard checks.** Chosen over direct RPC or a simulated flow because Chain MCP is an explicit task requirement.
2. **Use decimal strings and integer arithmetic.** Chosen over floating-point values to preserve exact PROS and gas calculations.
3. **Separate dashboard MCP observations from agent-run proof.** Chosen so a live dashboard check is not misrepresented as a Skill Engine agent invocation.
4. **Fail closed and surface errors.** Chosen over defaults or synthetic success because missing chain data cannot justify a readiness decision.
