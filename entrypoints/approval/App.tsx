import React, { useState } from 'react';

export function ApprovalApp() {
  const params = new URLSearchParams(window.location.search);
  const id = params.get('id') ?? '';
  const method = params.get('method') ?? 'Unknown';
  const from = params.get('from') ?? '';
  const [responded, setResponded] = useState(false);

  const respond = (approved: boolean) => {
    if (responded) return;
    setResponded(true);
    chrome.runtime.sendMessage({ type: 'approval-response', id, approved });
  };

  return (
    <div style={{
      padding: 24,
      fontFamily: '-apple-system, BlinkMacSystemFont, "Segoe UI", sans-serif',
      maxWidth: 380,
      background: '#1a1a2e',
      color: '#e8e8e8',
      minHeight: '100vh',
    }}>
      <h2 style={{ marginBottom: 20, fontSize: 15, color: '#00a3ff' }}>
        Signing Request
      </h2>
      <div style={{ marginBottom: 16 }}>
        <div style={{ fontSize: 11, color: '#8892a6', marginBottom: 4 }}>Method</div>
        <code style={{ fontSize: 13 }}>{method}</code>
      </div>
      <div style={{ marginBottom: 28 }}>
        <div style={{ fontSize: 11, color: '#8892a6', marginBottom: 4 }}>From</div>
        <code style={{ fontSize: 12, wordBreak: 'break-all' }}>{from}</code>
      </div>
      {responded ? (
        <div style={{ textAlign: 'center', color: '#8892a6', fontSize: 13 }}>
          Response sent. This window will close.
        </div>
      ) : (
        <div style={{ display: 'flex', gap: 12 }}>
          <button
            onClick={() => respond(true)}
            style={{
              flex: 1, padding: '10px 0', background: '#00d68f', color: '#1a1a2e',
              border: 'none', borderRadius: 6, fontWeight: 600, fontSize: 13, cursor: 'pointer',
            }}
          >
            Approve
          </button>
          <button
            onClick={() => respond(false)}
            style={{
              flex: 1, padding: '10px 0', background: '#ff4d6a', color: 'white',
              border: 'none', borderRadius: 6, fontWeight: 600, fontSize: 13, cursor: 'pointer',
            }}
          >
            Reject
          </button>
        </div>
      )}
    </div>
  );
}
