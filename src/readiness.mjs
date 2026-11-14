const CHAIN_ID = "1672";
const PROS_DECIMALS = 18n;
const DEFAULT_BUFFER_BPS = 2000;
const MAX_NUMERIC_INPUT_LENGTH = 128;
const ADDRESS_PATTERN = /^0x[0-9a-fA-F]{40}$/;
const DECIMAL_PATTERN = /^(0|[1-9]\d*)(?:\.(\d{1,18}))?$/;
const INTEGER_PATTERN = /^\d+$/;
const ISO_DATE_TIME_PATTERN =
  /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}(?:\.\d+)?(?:Z|[+-]\d{2}:\d{2})$/;

export class InputValidationError extends Error {
  constructor(message) {
    super(message);
    this.name = "InputValidationError";
  }
}

function isRecord(value) {
  return value !== null && typeof value === "object" && !Array.isArray(value);
}

function parsePros(value, field, allowZero) {
  if (typeof value !== "string") {
    throw new InputValidationError(`${field} must be a decimal string`);
  }
  if (value.length > MAX_NUMERIC_INPUT_LENGTH) {
    throw new InputValidationError(`${field} is too long`);
  }

  const match = DECIMAL_PATTERN.exec(value);
  if (!match) {
    throw new InputValidationError(`${field} must have at most 18 decimal places`);
  }

  const whole = BigInt(match[1]);
  const fractional = BigInt((match[2] ?? "").padEnd(Number(PROS_DECIMALS), "0") || "0");
  const amountWei = whole * (10n ** PROS_DECIMALS) + fractional;
  if (!allowZero && amountWei === 0n) {
    throw new InputValidationError(`${field} must be greater than zero`);
  }
  return amountWei;
}

function parseUnsignedInteger(value, { allowZero = true } = {}) {
  if (typeof value === "number") {
    if (!Number.isSafeInteger(value) || value < 0) return null;
    value = String(value);
  }
  if (typeof value !== "string" ||
      value.length > MAX_NUMERIC_INPUT_LENGTH ||
      !INTEGER_PATTERN.test(value)) return null;

  const parsed = BigInt(value);
  return !allowZero && parsed === 0n ? null : parsed;
}

export function validateReadinessConstraints(constraints) {
  if (!isRecord(constraints)) {
    throw new InputValidationError("constraints must be an object");
  }
  if (typeof constraints.sender !== "string" || !ADDRESS_PATTERN.test(constraints.sender)) {
    throw new InputValidationError("sender must be a valid EVM address");
  }
  if (typeof constraints.recipient !== "string" || !ADDRESS_PATTERN.test(constraints.recipient)) {
    throw new InputValidationError("recipient must be a valid EVM address");
  }

  const amountWei = parsePros(constraints.amountPros, "amountPros", false);
  const reserveWei = parsePros(constraints.reservePros, "reservePros", true);
  const gasPriceCeilingWei = typeof constraints.gasPriceCeilingWei === "string"
    ? parseUnsignedInteger(constraints.gasPriceCeilingWei)
    : null;
  if (gasPriceCeilingWei === null) {
    throw new InputValidationError("gasPriceCeilingWei must be a non-negative integer string");
  }

  const bufferBps = constraints.bufferBps === undefined
    ? DEFAULT_BUFFER_BPS
    : constraints.bufferBps;
  if (!Number.isSafeInteger(bufferBps) || bufferBps < 0) {
    throw new InputValidationError("bufferBps must be a non-negative safe integer");
  }

  return { amountWei, reserveWei, gasPriceCeilingWei, bufferBps };
}

function getObservationInteger(observations, field, { allowZero = true } = {}) {
  const value = observations?.[field];
  const parsed = parseUnsignedInteger(value, { allowZero });
  return parsed;
}

function isValidTimestamp(value) {
  return typeof value === "string" &&
    ISO_DATE_TIME_PATTERN.test(value) &&
    Number.isFinite(Date.parse(value));
}

function createProvenance(observations, sourceMetadata) {
  const sourceClaim = typeof observations?.source === "string" ? observations.source : null;
  const blockNumber = parseUnsignedInteger(observations?.blockNumber, { allowZero: false });
  const chainId = parseUnsignedInteger(observations?.chainId);
  const observedAt = isValidTimestamp(observations?.observedAt)
    ? observations.observedAt
    : null;

  return {
    kind: sourceMetadata?.kind ?? "user_supplied",
    verified: sourceMetadata?.verified ?? false,
    source: sourceMetadata?.source ?? sourceClaim,
    runId: typeof observations?.runId === "string" ? observations.runId : null,
    chainId: chainId?.toString() ?? null,
    blockNumber: blockNumber?.toString() ?? null,
    observedAt,
    fetchedAt: sourceMetadata?.fetchedAt ?? null
  };
}

export function evaluateReadiness(input, sourceMetadata) {
  if (!isRecord(input)) {
    throw new InputValidationError("request must be an object");
  }

  const { amountWei, reserveWei, gasPriceCeilingWei, bufferBps } =
    validateReadinessConstraints(input.constraints);
  const observations = isRecord(input.observations) ? input.observations : {};
  const provenance = createProvenance(observations, sourceMetadata);
  const missing = [];
  const invalid = [];

  const runId = typeof observations.runId === "string" && observations.runId.trim()
    ? observations.runId
    : null;
  if (!runId) missing.push("runId");

  const chainId = getObservationInteger(observations, "chainId");
  if (chainId === null || chainId.toString() !== CHAIN_ID) missing.push("chainId");

  const blockNumber = getObservationInteger(observations, "blockNumber", { allowZero: false });
  if (blockNumber === null) missing.push("blockNumber");

  const balanceAddress = observations.balanceAddress;
  if (typeof balanceAddress !== "string" || !balanceAddress.trim()) {
    missing.push("balanceAddress");
  } else if (!ADDRESS_PATTERN.test(balanceAddress) ||
      balanceAddress.toLowerCase() !== input.constraints.sender.toLowerCase()) {
    invalid.push("balanceAddress");
  }

  const balanceBlockNumber = getObservationInteger(observations, "balanceBlockNumber", {
    allowZero: false
  });
  if (balanceBlockNumber === null) {
    missing.push("balanceBlockNumber");
  } else if (blockNumber !== null && balanceBlockNumber !== blockNumber) {
    invalid.push("balanceBlockNumber");
  }

  if (!isValidTimestamp(observations.observedAt)) {
    missing.push("observedAt");
  }

  const balanceWei = getObservationInteger(observations, "balanceWei");
  if (balanceWei === null) missing.push("balanceWei");

  const gasPriceWei = getObservationInteger(observations, "gasPriceWei");
  if (gasPriceWei === null) missing.push("gasPriceWei");

  const estimatedGas = getObservationInteger(observations, "estimatedGas", { allowZero: false });
  if (estimatedGas === null) missing.push("estimatedGas");

  const estimateFrom = observations.estimateFrom;
  if (typeof estimateFrom !== "string" || !estimateFrom.trim()) {
    missing.push("estimateFrom");
  } else if (!ADDRESS_PATTERN.test(estimateFrom) ||
      estimateFrom.toLowerCase() !== input.constraints.sender.toLowerCase()) {
    invalid.push("estimateFrom");
  }

  const estimateTo = observations.estimateTo;
  if (typeof estimateTo !== "string" || !estimateTo.trim()) {
    missing.push("estimateTo");
  } else if (!ADDRESS_PATTERN.test(estimateTo) ||
      estimateTo.toLowerCase() !== input.constraints.recipient.toLowerCase()) {
    invalid.push("estimateTo");
  }

  const estimatedValueWei = getObservationInteger(observations, "estimatedValueWei");
  if (estimatedValueWei === null) {
    missing.push("estimatedValueWei");
  } else if (estimatedValueWei !== amountWei) {
    invalid.push("estimatedValueWei");
  }

  const missingOnlyGasEstimate = missing.length === 1 &&
    missing[0] === "estimatedGas" &&
    invalid.length === 0;
  if (missingOnlyGasEstimate) {
    const minimumRequiredWei = amountWei + reserveWei;
    const minimumShortfallWei = minimumRequiredWei > balanceWei
      ? minimumRequiredWei - balanceWei
      : 0n;
    const reasons = [];
    if (minimumShortfallWei > 0n) reasons.push("BALANCE_BELOW_TRANSFER_AND_RESERVE");
    if (gasPriceWei > gasPriceCeilingWei) reasons.push("GAS_PRICE_ABOVE_CEILING");

    if (reasons.length > 0) {
      return {
        status: "NOT_READY",
        reasons,
        missing,
        amountWei: amountWei.toString(),
        reserveWei: reserveWei.toString(),
        balanceWei: balanceWei.toString(),
        gasPriceWei: gasPriceWei.toString(),
        gasPriceCeilingWei: gasPriceCeilingWei.toString(),
        minimumRequiredWei: minimumRequiredWei.toString(),
        minimumShortfallWei: minimumShortfallWei.toString(),
        observationErrors: { estimateGas: "Gas estimate unavailable; no value was substituted." },
        provenance
      };
    }
  }

  if (missing.length > 0 || invalid.length > 0) {
    return {
      status: "INSUFFICIENT_DATA",
      missing: [...new Set(missing)],
      invalid: [...new Set(invalid)],
      ...(missingOnlyGasEstimate
        ? { observationErrors: { estimateGas: "Gas estimate unavailable; no value was substituted." } }
        : {}),
      provenance
    };
  }

  const bufferedGas = (
    estimatedGas * (10000n + BigInt(bufferBps)) + 9999n
  ) / 10000n;
  const modeledGasCostWei = bufferedGas * gasPriceWei;
  const totalRequiredWei = amountWei + modeledGasCostWei + reserveWei;
  const shortfallWei = totalRequiredWei > balanceWei ? totalRequiredWei - balanceWei : 0n;
  const reasons = [];

  if (shortfallWei > 0n) reasons.push("INSUFFICIENT_BALANCE");
  if (gasPriceWei > gasPriceCeilingWei) reasons.push("GAS_PRICE_ABOVE_CEILING");

  return {
    status: reasons.length === 0 ? "READY" : "NOT_READY",
    reasons,
    amountWei: amountWei.toString(),
    reserveWei: reserveWei.toString(),
    balanceWei: balanceWei.toString(),
    gasPriceWei: gasPriceWei.toString(),
    gasPriceCeilingWei: gasPriceCeilingWei.toString(),
    estimatedGas: estimatedGas.toString(),
    bufferBps,
    bufferedGas: bufferedGas.toString(),
    modeledGasCostWei: modeledGasCostWei.toString(),
    totalRequiredWei: totalRequiredWei.toString(),
    shortfallWei: shortfallWei.toString(),
    provenance
  };
}
