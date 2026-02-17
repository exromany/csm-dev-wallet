/** Shared low-level JSON-RPC fetch — no result unwrapping, no error throwing */
export async function rawJsonRpc(
  rpcUrl: string,
  method: string,
  params: unknown[] = [],
): Promise<{ result?: unknown; error?: { code: number; message: string; data?: unknown } }> {
  const res = await fetch(rpcUrl, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ jsonrpc: '2.0', id: 1, method, params }),
  });
  const json = await res.json();
  if (json.error) {
    return { error: { code: json.error.code, message: json.error.message, data: json.error.data } };
  }
  return { result: json.result };
}
