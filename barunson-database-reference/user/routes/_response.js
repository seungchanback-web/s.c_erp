// routes/_response.js — 공통 API 응답 래퍼 (3시스템 통일 규격)
// Donald-Duck ApiResponseDto / WMS platformSuccess/platformError 와 동일 형식

/**
 * 성공 응답: { success: true, data, timestamp }
 */
function apiSuccess(res, data, status = 200) {
  const body = JSON.stringify({
    success: true,
    data,
    timestamp: new Date().toISOString(),
  });
  res.writeHead(status, {
    'Content-Type': 'application/json',
    'Access-Control-Allow-Origin': '*',
    'Access-Control-Allow-Methods': 'GET,POST,PUT,PATCH,DELETE,OPTIONS',
    'Access-Control-Allow-Headers': 'Content-Type, Authorization, X-Webhook-Signature, X-Webhook-Timestamp, X-Service-Secret',
  });
  res.end(body);
}

/**
 * 에러 응답: { success: false, error: { code, message }, timestamp }
 *
 * 에러 코드 체계 (3시스템 공통):
 *   AUTH_FAILED (401), FORBIDDEN (403), NOT_FOUND (404),
 *   VALIDATION_ERROR (400), SKU_NOT_FOUND (422), INSUFFICIENT_STOCK (409),
 *   DUPLICATE (200), INVALID_STATE (400), SYSTEM_ERROR (500), NOT_CONFIGURED (503)
 */
function apiError(res, code, message, status = 400) {
  const body = JSON.stringify({
    success: false,
    error: { code, message },
    timestamp: new Date().toISOString(),
  });
  res.writeHead(status, {
    'Content-Type': 'application/json',
    'Access-Control-Allow-Origin': '*',
    'Access-Control-Allow-Methods': 'GET,POST,PUT,PATCH,DELETE,OPTIONS',
    'Access-Control-Allow-Headers': 'Content-Type, Authorization, X-Webhook-Signature, X-Webhook-Timestamp, X-Service-Secret',
  });
  res.end(body);
}

module.exports = { apiSuccess, apiError };
