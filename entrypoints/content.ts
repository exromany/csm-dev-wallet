import { defineContentScript } from 'wxt/utils/define-content-script';
import { injectScript } from 'wxt/utils/inject-script';
import {
  MSG_CHANNEL,
  type InpageMessage,
  type RpcRequestMessage,
  type RpcResponseMessage,
  type BroadcastMessage,
} from '../lib/shared/messages.js';
import { errorMessage } from '../lib/shared/errors.js';

export default defineContentScript({
  matches: ['<all_urls>'],
  runAt: 'document_start', // critical: inject before dapp scripts

  async main() {
    // Inject the inpage script into MAIN world
    await injectScript('/inpage.js', { keepInDom: true });

    // ── Bridge: Inpage → Content → Service Worker ──

    const SW_TIMEOUT_MS = 30_000;

    function sendWithTimeout(request: RpcRequestMessage): Promise<unknown> {
      return Promise.race([
        chrome.runtime.sendMessage(request),
        new Promise((_, reject) =>
          setTimeout(() => reject(new Error('Service worker timeout')), SW_TIMEOUT_MS),
        ),
      ]);
    }

    window.addEventListener('message', async (event) => {
      if (event.source !== window) return;
      const msg = event.data as InpageMessage;
      if (msg?.channel !== MSG_CHANNEL || msg.direction !== 'to-content') return;

      if (msg.type === 'rpc-request') {
        const request: RpcRequestMessage = {
          type: 'rpc-request',
          method: msg.method,
          params: msg.params,
        };

        try {
          const response = await sendWithTimeout(request) as RpcResponseMessage;

          window.postMessage(
            {
              channel: MSG_CHANNEL,
              direction: 'to-inpage',
              type: 'rpc-response',
              id: msg.id,
              result: response?.result,
              error: response?.error,
            } satisfies InpageMessage,
            window.location.origin,
          );
        } catch (err: unknown) {
          window.postMessage(
            {
              channel: MSG_CHANNEL,
              direction: 'to-inpage',
              type: 'rpc-response',
              id: msg.id,
              error: { code: -32603, message: errorMessage(err) },
            } satisfies InpageMessage,
            window.location.origin,
          );
        }
      }
    });

    // ── Bridge: Service Worker → Content → Inpage (events) ──

    chrome.runtime.onMessage.addListener(
      (message: BroadcastMessage) => {
        if (message.type !== 'state-changed') return;

        window.postMessage(
          {
            channel: MSG_CHANNEL,
            direction: 'to-inpage',
            type: 'event',
            event: message.event,
            data: message.data,
          } satisfies InpageMessage,
          window.location.origin,
        );
      },
    );
  },
});
