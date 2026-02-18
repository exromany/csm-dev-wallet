export type PendingApproval = {
  resolve: (approved: boolean) => void;
  windowId: number;
};

export async function requestApproval(
  method: string,
  fromAddress: string,
  pending: Map<string, PendingApproval>,
): Promise<boolean> {
  const id = crypto.randomUUID();
  const params = new URLSearchParams({ id, method, from: fromAddress });
  const url = chrome.runtime.getURL(`approval.html?${params.toString()}`);

  const win = await chrome.windows.create({
    url,
    type: 'popup',
    width: 400,
    height: 280,
    focused: true,
  });

  if (!win?.id) throw new Error('Failed to create approval window');
  const windowId = win.id;

  return new Promise<boolean>((resolve) => {
    pending.set(id, { resolve, windowId });

    // Auto-reject when window is closed without decision
    const onRemoved = (removedId: number) => {
      if (removedId !== windowId) return;
      chrome.windows.onRemoved.removeListener(onRemoved);
      if (pending.has(id)) {
        pending.delete(id);
        resolve(false);
      }
    };
    chrome.windows.onRemoved.addListener(onRemoved);
  });
}
