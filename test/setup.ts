import '@testing-library/jest-dom/vitest';

export type MockPort = ReturnType<typeof createMockPort>;

export function createMockPort() {
  const listeners: Array<(event: unknown) => void> = [];
  return {
    postMessage: vi.fn(),
    onMessage: {
      addListener: (fn: (event: unknown) => void) => {
        listeners.push(fn);
      },
      removeListener: (fn: (event: unknown) => void) => {
        const i = listeners.indexOf(fn);
        if (i >= 0) listeners.splice(i, 1);
      },
    },
    disconnect: vi.fn(),
    /** Emit an event to all listeners (test helper) */
    _emit(event: unknown) {
      listeners.forEach((fn) => fn(event));
    },
    _listeners: listeners,
  };
}

// Global Chrome API mock
const defaultPort = createMockPort();

globalThis.chrome = {
  runtime: {
    connect: vi.fn(() => defaultPort),
  },
  storage: {
    local: { get: vi.fn(), set: vi.fn() },
    session: { get: vi.fn(), set: vi.fn() },
  },
} as unknown as typeof chrome;
