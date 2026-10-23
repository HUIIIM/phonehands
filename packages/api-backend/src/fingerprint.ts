// SPDX-License-Identifier: BUSL-1.1

/**
 * Phone impersonation ("like a phone" HTTP fingerprint).
 *
 * Clean-room reimplementation of the pattern, not of any existing code:
 *   - an app-realistic User-Agent string (platform network-stack fingerprints)
 *   - a device identity triple that is REGENERATED on every login
 *   - app business headers (version, build, model, platform, OS)
 *   - locale (language + region) is a REQUIRED parameter -- it must never be
 *     hardcoded (the IN/en-GB leftover is the textbook anti-pattern).
 */
import { randomUUID } from "node:crypto";

export interface LocaleConfig {
  /** BCP-47-ish accept language, e.g. "en-US". Never hardcoded. */
  language: string;
  /** Region code sent to the server, e.g. "US". Never hardcoded. */
  region: string;
}

export interface DeviceIds {
  deviceId: string;
  installId: string;
  sessionId: string;
}

export interface FingerprintConfig {
  appSlug: string; // e.g. "Hinge"
  appVersion: string; // e.g. "9.91.0"
  buildNumber: string; // e.g. "11639"
  cfNetworkVersion: string; // e.g. "3859.100.1"
  darwinVersion: string; // e.g. "25.0.0"
  deviceModelCode: string; // e.g. "iPhone15,2"
  devicePlatform: string; // e.g. "iOS"
  osVersion: string; // e.g. "26.0"
  /** REQUIRED. Construction refuses an empty locale. */
  locale: LocaleConfig;
}

/** Generate a fresh device identity triple. Call on every (re-)login. */
export function newDeviceIds(): DeviceIds {
  return {
    deviceId: randomUUID(),
    installId: randomUUID(),
    sessionId: randomUUID(),
  };
}

export function validateLocale(locale: LocaleConfig): void {
  if (!locale || !locale.language || !locale.region) {
    throw new Error(
      "phonehands: locale (language + region) is required and must be supplied explicitly; " +
        "hardcoding a region/language is forbidden (IN/en-GB anti-pattern)",
    );
  }
}

export function buildUserAgent(cfg: FingerprintConfig): string {
  return (
    `${cfg.appSlug}/${cfg.buildNumber} ` +
    `CFNetwork/${cfg.cfNetworkVersion} Darwin/${cfg.darwinVersion}`
  );
}

/** Build the per-request impersonation header set. */
export function buildPhoneHeaders(
  cfg: FingerprintConfig,
  ids: DeviceIds,
  authToken?: string,
): Record<string, string> {
  validateLocale(cfg.locale);
  const headers: Record<string, string> = {
    "user-agent": buildUserAgent(cfg),
    "x-device-id": ids.deviceId,
    "x-install-id": ids.installId,
    "x-session-id": ids.sessionId,
    "x-device-model-code": cfg.deviceModelCode,
    "x-device-platform": cfg.devicePlatform,
    "x-app-version": cfg.appVersion,
    "x-build-number": cfg.buildNumber,
    "x-os-version": cfg.osVersion,
    "x-device-region": cfg.locale.region,
    "accept-language": cfg.locale.language,
    accept: "application/json",
  };
  if (authToken) {
    headers["authorization"] = `Bearer ${authToken}`;
  }
  return headers;
}
