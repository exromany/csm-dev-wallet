export type RpcError = { code: number; message: string; data?: unknown };

export function errorMessage(err: unknown): string {
  return err instanceof Error ? err.message : String(err);
}

export class ProviderRpcError extends Error {
  code: number;
  data?: unknown;
  constructor(code: number, message: string, data?: unknown) {
    super(message);
    this.code = code;
    this.data = data;
  }
}
