import { runLiveReadiness } from "../../src/live_flow.mjs";
import { InputValidationError, validateReadinessConstraints } from "../../src/readiness.mjs";
import { createPharosMcpClient } from "../../src/pharos_mcp.mjs";

const MAX_REQUEST_BYTES = 16 * 1024;
const DEFAULT_GAS_PRICE_CEILING_WEI = "100000000000";
const DEFAULT_BUFFER_BPS = 2000;

function jsonResponse(body, status = 200) {
  return new Response(JSON.stringify(body), {
    status,
    headers: {
      "Content-Type": "application/json; charset=utf-8",
      "Cache-Control": "no-store",
      "X-Content-Type-Options": "nosniff",
      "Referrer-Policy": "no-referrer"
    }
  });
}

export async function handleFlowPost(
  request,
  {
    createMcpClient = createPharosMcpClient,
    createRunId,
    now
  } = {}
) {
  if (!request.headers.get("content-type")?.toLowerCase().includes("application/json")) {
    return jsonResponse({ ok: false, error: "Content-Type must be application/json" }, 415);
  }

  const contentLength = Number(request.headers.get("content-length"));
  if (Number.isFinite(contentLength) && contentLength > MAX_REQUEST_BYTES) {
    return jsonResponse({ ok: false, error: "Request body is too large" }, 413);
  }

  let requestText;
  try {
    requestText = await request.text();
  } catch {
    return jsonResponse({ ok: false, error: "Request body could not be read" }, 400);
  }
  if (new TextEncoder().encode(requestText).byteLength > MAX_REQUEST_BYTES) {
    return jsonResponse({ ok: false, error: "Request body is too large" }, 413);
  }

  let body;
  try {
    body = JSON.parse(requestText);
  } catch {
    return jsonResponse({ ok: false, error: "Request body must be valid JSON" }, 400);
  }
  if (body === null || typeof body !== "object" || Array.isArray(body) ||
      body.constraints === null || typeof body.constraints !== "object" ||
      Array.isArray(body.constraints)) {
    return jsonResponse({ ok: false, error: "constraints must be an object" }, 400);
  }

  const constraints = {
    gasPriceCeilingWei: DEFAULT_GAS_PRICE_CEILING_WEI,
    bufferBps: DEFAULT_BUFFER_BPS,
    ...body.constraints
  };
  try {
    validateReadinessConstraints(constraints);
  } catch (error) {
    if (error instanceof InputValidationError) {
      return jsonResponse({ ok: false, error: error.message }, 400);
    }
    throw error;
  }

  try {
    const result = await runLiveReadiness(constraints, {
      createClient: createMcpClient,
      createRunId,
      now
    });
    return jsonResponse({ ok: true, result });
  } catch {
    return jsonResponse({
      ok: false,
      error: "Unable to retrieve a valid live observation set from Pharos Chain MCP"
    }, 502);
  }
}

export async function onRequestPost({ request }) {
  return handleFlowPost(request);
}
