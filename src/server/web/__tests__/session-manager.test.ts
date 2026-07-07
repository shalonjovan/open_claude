import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { EventEmitter } from "node:events";
import { SessionManager } from "../session-manager.js";
import type { IPty } from "node-pty";
import type { WebSocket } from "ws";

// --- Mock helpers (Bun's node:test doesn't have mock.fn()) ---

interface MockFn {
  (...args: unknown[]): unknown;
  mock: { calls: { arguments: unknown[] }[]; callCount(): number };
}

function createMockFn(): MockFn {
  const calls: { arguments: unknown[] }[] = [];
  const fn = ((...args: unknown[]) => {
    calls.push({ arguments: args });
  }) as MockFn;
  fn.mock = {
    calls,
    callCount() { return calls.length; },
  };
  return fn;
}

// --- Mock factories ---

function createMockPty(): IPty & { _dataHandler?: (d: string) => void; _exitHandler?: (e: { exitCode: number; signal: number }) => void } {
  const mockPty = {
    onData(handler: (data: string) => void) {
      mockPty._dataHandler = handler;
      return { dispose() {} };
    },
    onExit(handler: (e: { exitCode: number; signal: number }) => void) {
      mockPty._exitHandler = handler;
      return { dispose() {} };
    },
    write: createMockFn(),
    resize: createMockFn(),
    kill: createMockFn(),
    pid: 12345,
    cols: 80,
    rows: 24,
    process: "claude",
    handleFlowControl: false,
    pause: createMockFn(),
    resume: createMockFn(),
    clear: createMockFn(),
    _dataHandler: undefined as ((d: string) => void) | undefined,
    _exitHandler: undefined as ((e: { exitCode: number; signal: number }) => void) | undefined,
  };
  return mockPty as unknown as IPty & { _dataHandler?: (d: string) => void; _exitHandler?: (e: { exitCode: number; signal: number }) => void };
}

function createMockWs(): WebSocket & EventEmitter {
  const emitter = new EventEmitter();
  const ws = Object.assign(emitter, {
    OPEN: 1,
    CONNECTING: 0,
    readyState: 1,
    send: createMockFn(),
    close: createMockFn(),
  });
  return ws as unknown as WebSocket & EventEmitter;
}

describe("SessionManager", () => {
  it("creates a session and returns a token", () => {
    const mockPty = createMockPty();
    const manager = new SessionManager(5, () => mockPty);
    const ws = createMockWs();

    const token = manager.create(ws);
    assert.ok(token);
    assert.equal(typeof token, "string");
    assert.equal(manager.activeCount, 1);
  });

  it("enforces max sessions limit", () => {
    const manager = new SessionManager(1, () => createMockPty());

    const token1 = manager.create(createMockWs());
    assert.ok(token1);

    const ws2 = createMockWs();
    const token2 = manager.create(ws2);
    assert.equal(token2, null);
    assert.equal(manager.activeCount, 1);
  });

  it("forwards PTY data to WebSocket", () => {
    const mockPty = createMockPty();
    const manager = new SessionManager(5, () => mockPty);
    const ws = createMockWs();

    manager.create(ws);

    // Simulate PTY output
    mockPty._dataHandler?.("hello world");
    assert.equal((ws.send as MockFn).mock.callCount(), 1);
  });

  it("forwards WebSocket input to PTY", () => {
    const mockPty = createMockPty();
    const manager = new SessionManager(5, () => mockPty);
    const ws = createMockWs();

    manager.create(ws);

    // Simulate WebSocket input
    ws.emit("message", Buffer.from("ls\n"));
    assert.equal((mockPty.write as MockFn).mock.callCount(), 1);
  });

  it("handles resize messages", () => {
    const mockPty = createMockPty();
    const manager = new SessionManager(5, () => mockPty);
    const ws = createMockWs();

    manager.create(ws);

    ws.emit("message", JSON.stringify({ type: "resize", cols: 120, rows: 40 }));
    assert.equal((mockPty.resize as MockFn).mock.callCount(), 1);
  });

  it("handles ping messages with pong response", () => {
    const mockPty = createMockPty();
    const manager = new SessionManager(5, () => mockPty);
    const ws = createMockWs();

    manager.create(ws);

    ws.emit("message", JSON.stringify({ type: "ping" }));
    // Should have sent connected + pong
    const calls = (ws.send as MockFn).mock.calls;
    const lastCall = calls[calls.length - 1];
    assert.ok(lastCall);
    const parsed = JSON.parse(lastCall.arguments[0] as string);
    assert.equal(parsed.type, "pong");
  });

  it("starts grace period on WebSocket close (not immediate cleanup)", () => {
    const mockPty = createMockPty();
    const manager = new SessionManager(5, () => mockPty);
    const ws = createMockWs();

    manager.create(ws);
    assert.equal(manager.activeCount, 1);

    // Close triggers a grace period — session is not immediately destroyed
    ws.emit("close");
    assert.equal(manager.activeCount, 1);
  });

  it("handles PTY spawn failure gracefully", () => {
    const manager = new SessionManager(5, () => {
      throw new Error("no pty available");
    });
    const ws = createMockWs();

    const token = manager.create(ws);
    assert.equal(token, null);
    assert.equal((ws.close as MockFn).mock.callCount(), 1);
  });

  it("destroyAll cleans up all sessions", () => {
    const manager = new SessionManager(5, () => createMockPty());

    manager.create(createMockWs());
    manager.create(createMockWs());
    assert.equal(manager.activeCount, 2);

    manager.destroyAll();
    assert.equal(manager.activeCount, 0);
  });
});
