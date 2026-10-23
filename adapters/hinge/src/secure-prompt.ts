// SPDX-License-Identifier: BUSL-1.1

/**
 * Secure terminal prompt for secrets (OTP / verification codes).
 *
 * Pattern learned from T2 (vanxh/instagram-personal-mcp) -- MODE ONLY, no
 * code copied; license compatibility of T2 is pending GC ruling.
 *
 * Rules:
 *   - Secrets are read from a TTY with echo disabled (getpass idea).
 *   - The secret NEVER appears in the output stream, NEVER in logs, and is
 *     never taken as a CLI argument or chat/function parameter by the
 *     interactive flow -- it travels TTY -> local variable -> the single
 *     submit call, and is never persisted.
 *   - Without a TTY on both input and output, this REFUSES to run instead
 *     of falling back to an echoing prompt.
 *
 * Streams are injectable so tests can assert the no-echo property without
 * a real terminal.
 */
import type { Readable } from "node:stream";

export interface PromptStreams {
  input: Readable & { isTTY?: boolean; setRawMode?: (mode: boolean) => void };
  output: NodeJS.WritableStream & { isTTY?: boolean };
}

export class NoTtyError extends Error {
  constructor() {
    super("phonehands: secure prompt requires a TTY on stdin and stdout; refusing to read a secret without one");
    this.name = "NoTtyError";
  }
}

/**
 * Prompt for a secret without echoing it. Resolves with the typed secret.
 * Ctrl-C rejects. Backspace edits locally. The secret is never written to
 * the output stream.
 */
export function promptSecret(question: string, streams?: PromptStreams): Promise<string> {
  const input = streams?.input ?? (process.stdin as PromptStreams["input"]);
  const output = streams?.output ?? (process.stdout as PromptStreams["output"]);

  if (input.isTTY !== true || output.isTTY !== true) {
    return Promise.reject(new NoTtyError());
  }

  return new Promise<string>((resolve, reject) => {
    output.write(question);
    let secret = "";
    let done = false;
    const hadRawMode = typeof input.setRawMode === "function" ? true : false;
    if (hadRawMode) {
      input.setRawMode?.(true);
    }

    const cleanup = () => {
      if (done) return;
      done = true;
      input.removeListener("data", onData);
      if (hadRawMode) {
        try {
          input.setRawMode?.(false);
        } catch {
          /* best effort */
        }
      }
      output.write("\n");
    };

    const onData = (chunk: Buffer) => {
      const text = chunk.toString("utf8");
      for (const ch of text) {
        if (ch === "\r" || ch === "\n" || ch === "\u0004") {
          cleanup();
          resolve(secret);
          return;
        }
        if (ch === "\u0003") {
          cleanup();
          reject(new Error("phonehands: secret prompt cancelled"));
          return;
        }
        if (ch === "\u007f" || ch === "\b") {
          secret = secret.slice(0, -1);
          continue;
        }
        secret += ch;
      }
    };

    input.on("data", onData);
  });
}
