import { evaluateReadiness, InputValidationError } from "../../src/readiness.mjs";

const MAX_REQUEST_BYTES = 16 * 1024;

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

export async function onRequestPost({ request }) {
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

  try {
    const result = evaluateReadiness(body);
    return jsonResponse({ ok: true, result });
  } catch (error) {
    if (error instanceof InputValidationError) {
      return jsonResponse({ ok: false, error: error.message }, 400);
    }
    throw error;
  }
}
