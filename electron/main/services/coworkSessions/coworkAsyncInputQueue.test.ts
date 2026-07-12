import { expect, it } from "vitest";
import { CoworkAsyncInputQueue } from "./coworkAsyncInputQueue";

type TestMessage = {
  text: string;
  uuid: string;
};

it("delivers an enqueued item to the oldest waiter before buffering", async () => {
  const queue = new CoworkAsyncInputQueue<TestMessage>();
  const iterator = queue[Symbol.asyncIterator]();
  const pending = iterator.next();

  queue.enqueue({ text: "hello", uuid: "message-1" });

  await expect(pending).resolves.toEqual({
    done: false,
    value: { text: "hello", uuid: "message-1" },
  });
  expect(queue.hasPending()).toBe(false);
});

it("buffers in order and removes a queued message by uuid", async () => {
  const queue = new CoworkAsyncInputQueue<TestMessage>();
  const iterator = queue[Symbol.asyncIterator]();
  queue.enqueue({ text: "first", uuid: "message-1" });
  queue.enqueue({ text: "second", uuid: "message-2" });

  expect(queue.remove("message-1")).toBe(true);
  expect(queue.remove("missing")).toBe(false);
  expect(queue.hasPending()).toBe(true);
  await expect(iterator.next()).resolves.toEqual({
    done: false,
    value: { text: "second", uuid: "message-2" },
  });
});

it("finishes every waiter and ignores later enqueue calls", async () => {
  const queue = new CoworkAsyncInputQueue<TestMessage>();
  const iterator = queue[Symbol.asyncIterator]();
  const first = iterator.next();
  const second = iterator.next();

  queue.done();
  queue.enqueue({ text: "ignored", uuid: "message-3" });

  await expect(first).resolves.toEqual({ done: true, value: undefined });
  await expect(second).resolves.toEqual({ done: true, value: undefined });
  await expect(iterator.next()).resolves.toEqual({
    done: true,
    value: undefined,
  });
  expect(queue.hasPending()).toBe(false);
});

it("drains already-buffered messages before reporting completion", async () => {
  const queue = new CoworkAsyncInputQueue<TestMessage>();
  const iterator = queue[Symbol.asyncIterator]();
  queue.enqueue({ text: "buffered", uuid: "message-4" });
  queue.done();

  await expect(iterator.next()).resolves.toEqual({
    done: false,
    value: { text: "buffered", uuid: "message-4" },
  });
  await expect(iterator.next()).resolves.toEqual({
    done: true,
    value: undefined,
  });
});
