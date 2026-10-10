// SPDX-License-Identifier: BUSL-1.1 (pending GC final review)

import { test } from "node:test";
import assert from "node:assert/strict";
import { EventEmitter } from "node:events";
import { promptSecret, NoTtyError, type PromptStreams } from "../src/secure-prompt.ts";

class FakeInput extends EventEmitter {
  isTTY = true;
}
class FakeOutput extends EventEmitter {
  isTTY = true;
  chunks: string[] = [];
  write(chunk: string): boolean {
    this.chunks.push(String(chunk));
    return true;
  }
  get text(): string {
    return this.chunks.join("");
  }
}

function fakeStreams(): { streams: PromptStreams; input: FakeInput; output: FakeOutput } {
  const input = new FakeInput();
  const output = new FakeOutput();
  return {
    streams: { input: input as unknown as PromptStreams["input"], output: output as unknown as PromptStreams["output"] },
    input,
    output,
  };
}

test("typed secret is NEVER echoed to the output stream", async () => {
  const { streams, input, output } = fakeStreams();
  const pending = promptSecret("Enter code: ", streams);
  input.emit("data", Buffer.from("4"));
  input.emit("data", Buffer.from("2"));
  input.emit("data", Buffer.from("8"));
  input.emit("data", Buffer.from("\n"));
  const secret = await pending;
  assert.equal(secret, "428");
  assert.ok(output.text.includes("Enter code: "));
  assert.ok(!output.text.includes("428"), `secret leaked into output: ${JSON.stringify(output.text)}`);
});

test("backspace edits the secret locally without echo", async () => {
  const { streams, input, output } = fakeStreams();
  const pending = promptSecret("Code: ", streams);
  for (const ch of ["1", "9", "\u007f", "3", "\r"]) {
    input.emit("data", Buffer.from(ch));
  }
  const secret = await pending;
  assert.equal(secret, "13");
  assert.ok(!output.text.includes("193") && !output.text.includes("13"));
});

test("Ctrl-C rejects the prompt", async () => {
  const { streams, input } = fakeStreams();
  const pending = promptSecret("Code: ", streams);
  input.emit("data", Buffer.from("\u0003"));
  await assert.rejects(() => pending, /cancelled/);
});

test("non-TTY input refuses instead of falling back to echo", async () => {
  const { streams, input } = fakeStreams();
  (input as { isTTY: boolean }).isTTY = false;
  await assert.rejects(() => promptSecret("Code: ", streams), NoTtyError);
});

test("non-TTY output refuses as well", async () => {
  const { streams, output } = fakeStreams();
  (output as { isTTY: boolean }).isTTY = false;
  await assert.rejects(() => promptSecret("Code: ", streams), NoTtyError);
});
