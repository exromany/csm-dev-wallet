import { defineConfig } from 'wxt';

export default defineConfig({
  modules: ['@wxt-dev/module-react'],
  manifestVersion: 3,
  manifest: {
    name: 'CSM Dev Wallet',
    description: 'QA wallet for Lido CSM widget — connect as any operator address',
    permissions: ['storage', 'activeTab'],
    host_permissions: ['<all_urls>'],
    content_security_policy: {
      extension_pages: "script-src 'self' 'wasm-unsafe-eval'; object-src 'self'",
    },
    web_accessible_resources: [
      {
        resources: ['inpage.js'],
        matches: ['<all_urls>'],
      },
    ],
    browser_specific_settings: {
      gecko: {
        id: 'csm-dev-wallet@lido.fi',
        strict_min_version: '121.0',
      },
    },
  },
});
