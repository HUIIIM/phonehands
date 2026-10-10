// SPDX-License-Identifier: BUSL-1.1 (pending GC final review)
import { describe, it } from "node:test";
import assert from "node:assert/strict";
import { AuthTimeoutError, QueueFullError, TimeoutUnknownError } from "../src/errors.ts";
import { SerialOpQueue } from "../src/queue.ts";

function deferred<T>() {
  let resolve!: (v: T) => void;
  let reject!: (e: unknown) => void;
  const promise = new Promise<T>((res, rej) => {
    resolve = res;
    reject = rej;
  });
  return { promise, resolve, reject };
}

describe("queue: per-account serial execution", () => {
  it("runs one account's ops strictly in order", async () => {
    const q = new SerialOpQueue();
    const order: number[] = [];
    const slow = deferred<string>();
    const p1 = q.enqueue("a", async () => {
      order.push(1);
      await slow.promise;
      order.push(2);
      return "first";
    });
    const p2 = q.enqueue("a", async () => {
      order.push(3);
      return "second";
    });
    await new Promise((r) => setTimeout(r, 20));
    assert.deepEqual(order, [1], "second op must not start before the first finishes");
    slow.resolve("go");
    assert.equal(await p1, "first");
    assert.equal(await p2, "second");
    assert.deepEqual(order, [1, 2, 3]);
  });

  it("different accounts run independently", async () => {
    const q = new SerialOpQueue();
    const gate = deferred<void>();
    const started: string[] = [];
    const pa = q.enqueue("a", async () => {
      started.push("a");
      await gate.promise;
      return 1;
    });
    const pb = q.enqueue("b", async () => {
      started.push("b");
      return 2;
    });
    assert.equal(await pb, 2);
    assert.deepEqual(started, ["a", "b"]);
    gate.resolve();
    assert.equal(await pa, 1);
  });

  it("a failing op does not break the tail", async () => {
    const q = new SerialOpQueue();
    await assert.rejects(q.enqueue("a", async () => {
      throw new Error("boom");
    }), /boom/);
    assert.equal(await q.enqueue("a", async () => "recovered"), "recovered");
  });
});

describe("queue: backpressure (32 pending cap)", () => {
  it("rejects with QUEUE_FULL past the cap; the queue keeps working", async () => {
    const q = new SerialOpQueue({ maxPending: 2, defaultDeadlineMs: 5000 });
    const gate = deferred<void>();
    const p1 = q.enqueue("a", async () => {
      await gate.promise;
      return 1;
    });
    const p2 = q.enqueue("a", async () => 2);
    assert.equal(q.pendingCount("a"), 2);
    await assert.rejects(q.enqueue("a", async () => 3), (e: unknown) => e instanceof QueueFullError);
    gate.resolve();
    assert.equal(await p1, 1);
    assert.equal(await p2, 2);
    assert.equal(q.pendingCount("a"), 0);
  });
});

describe("queue: deadline is unknown-state, never auto-replay (MV427)", () => {
  it("a hanging op rejects with TIMEOUT_UNKNOWN", async () => {
    const q = new SerialOpQueue();
    await assert.rejects(
      q.enqueue("a", () => new Promise<string>(() => {}), { deadlineMs: 30 }),
      (e: unknown) => e instanceof TimeoutUnknownError && /unknown/i.test(e.message)
    );
  });

  it("the timed-out op is invoked exactly once (no silent retry)", async () => {
    const q = new SerialOpQueue();
    let invocations = 0;
    const gate = deferred<void>();
    const p = q.enqueue(
      "a",
      async () => {
        invocations += 1;
        await gate.promise; // hangs past the deadline
        return 1;
      },
      { deadlineMs: 30 }
    );
    await assert.rejects(p, TimeoutUnknownError);
    await new Promise((r) => setTimeout(r, 80));
    gate.resolve();
    await new Promise((r) => setTimeout(r, 20));
    assert.equal(invocations, 1);
  });

  it("per-op deadline overrides the default", async () => {
    const q = new SerialOpQueue({ defaultDeadlineMs: 5000 });
    const r = await q.enqueue("a", async () => "fast", { deadlineMs: 50 });
    assert.equal(r, "fast");
  });
});

describe("queue: pause / resume / abandon (auth-handoff driven)", () => {
  it("paused queue holds ops until resume", async () => {
    const q = new SerialOpQueue();
    q.pause("a");
    let ran = false;
    const p = q.enqueue("a", async () => {
      ran = true;
      return "done";
    });
    await new Promise((r) => setTimeout(r, 30));
    assert.equal(ran, false);
    q.resume("a");
    assert.equal(await p, "done");
    assert.equal(ran, true);
  });

  it("abandon rejects waiting ops with abandoned:auth_timeout and releases the queue", async () => {
    const q = new SerialOpQueue();
    q.pause("a");
    const p = q.enqueue("a", async () => "never");
    const assertion = assert.rejects(
      p,
      (e: unknown) => e instanceof AuthTimeoutError && e.code === "abandoned:auth_timeout"
    );
    q.abandon("a", "abandoned:auth_timeout");
    await assertion;
    // queue released: new ops run normally (no deadlock)
    assert.equal(await q.enqueue("a", async () => "alive"), "alive");
  });
});
