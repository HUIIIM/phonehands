// SPDX-License-Identifier: BUSL-1.1 (pending GC final review)

/** Thrown when a non-loopback device address is configured. */
export class DeviceSecurityError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "DeviceSecurityError";
  }
}
