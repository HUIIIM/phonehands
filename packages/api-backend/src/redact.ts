// SPDX-License-Identifier: BUSL-1.1

/**
 * Secret hygiene: recursive redaction for structured output and log lines.
 *
 * Rule: secrets/tokens must NEVER land in logs or user-visible output.
 * Both layers are covered -- structured objects AND free-text log lines.
 */

const SECRET_KEY_PATTERN =
  /(token|secret|password|passwd|auth|otp|bearer|api[_-]?key|credential|session[_-]?id|case[_-]?id|cookie|jwt|phone)/i;

const BEARER_PATTERN = /Bearer\s+[A-Za-z0-9._~+/=-]+/gi;
const BASIC_PATTERN = /Basic\s+[A-Za-z0-9+/=]{8,}/gi;
const COOKIE_HEADER_PATTERN = /((?:set-)?cookie\s*:\s*)[^\r\n]+/gi;
const QUOTED_SECRET_PATTERN =
  /("?(?:token|secret|password|authToken|refreshToken|sendbirdAuthToken|caseId)"?\s*[:=]\s*["']?)[^"'\s,;}]+/gi;

/**
 * Deep-redact an unknown value: any object key that looks secret-bearing is
 * replaced with "[REDACTED]"; bearer tokens in free text are masked too.
 */
export function redact(value: unknown, depth = 0): unknown {
  if (depth > 10) return "[max-depth]";
  if (Array.isArray(value)) {
    return value.map((item) => redact(item, depth + 1));
  }
  if (value !== null && typeof value === "object") {
    const out: Record<string, unknown> = {};
    for (const [key, val] of Object.entries(value as Record<string, unknown>)) {
      out[key] = SECRET_KEY_PATTERN.test(key) ? "[REDACTED]" : redact(val, depth + 1);
    }
    return out;
  }
  if (typeof value === "string") {
    return value.replace(BEARER_PATTERN, "Bearer [REDACTED]").replace(BASIC_PATTERN, "Basic [REDACTED]");
  }
  return value;
}

/** Sanitize a single free-text log line. */
export function sanitizeLogLine(line: string): string {
  return line
    .replace(BEARER_PATTERN, "Bearer [REDACTED]")
    .replace(BASIC_PATTERN, "Basic [REDACTED]")
    .replace(COOKIE_HEADER_PATTERN, "$1[REDACTED]")
    .replace(QUOTED_SECRET_PATTERN, "$1[REDACTED]");
}

/** Remove credentials embedded in a URL (never happens in our code, but cheap). */
export function sanitizeUrl(url: string): string {
  return url.replace(/(\/\/)[^/@\s]+@/, "$1[REDACTED]@");
}
