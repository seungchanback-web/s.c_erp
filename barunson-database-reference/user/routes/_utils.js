// routes/_utils.js — 공통 유틸리티 (camelCase 변환 등)

/**
 * snake_case → camelCase 변환
 * @param {string} str
 */
function toCamel(str) {
  return str.replace(/_([a-z])/g, (_, c) => c.toUpperCase());
}

/**
 * 객체/배열의 키를 재귀적으로 camelCase로 변환
 * DB 컬럼(snake_case) → API 응답(camelCase) 변환에 사용
 * @param {*} obj
 */
function keysToCamel(obj) {
  if (Array.isArray(obj)) return obj.map(keysToCamel);
  if (obj && typeof obj === 'object' && !(obj instanceof Date)) {
    return Object.fromEntries(
      Object.entries(obj).map(([k, v]) => [toCamel(k), keysToCamel(v)])
    );
  }
  return obj;
}

/**
 * camelCase → snake_case 변환
 * @param {string} str
 */
function toSnake(str) {
  return str.replace(/([A-Z])/g, '_$1').toLowerCase();
}

/**
 * 객체/배열의 키를 재귀적으로 snake_case로 변환
 * API 요청(camelCase) → DB 저장(snake_case) 변환에 사용
 * @param {*} obj
 */
function keysToSnake(obj) {
  if (Array.isArray(obj)) return obj.map(keysToSnake);
  if (obj && typeof obj === 'object' && !(obj instanceof Date)) {
    return Object.fromEntries(
      Object.entries(obj).map(([k, v]) => [toSnake(k), keysToSnake(v)])
    );
  }
  return obj;
}

module.exports = { toCamel, keysToCamel, toSnake, keysToSnake };
