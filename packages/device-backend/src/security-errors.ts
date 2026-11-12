// SPDX-License-Identifier: MIT

/** Thrown when a non-loopback device address is configured. */
export class DeviceSecurityError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "DeviceSecurityError";
  }
}
