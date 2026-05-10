import { defineConfig, loadEnv } from 'vite';
import react from '@vitejs/plugin-react';

// Vite dev proxy:
//   /anthropic-api/*  →  https://api.anthropic.com/*  (with x-api-key + version injected server-side)
//
// The API key stays in .env on the dev machine; it is never bundled into the
// client. Production deployments need their own backend proxy — this dev-only
// pattern is documented at .env.example.
export default defineConfig(({ mode }) => {
  const env = loadEnv(mode, process.cwd(), '');
  const anthropicKey = env.ANTHROPIC_API_KEY || '';
  const anthropicVersion = env.ANTHROPIC_VERSION || '2023-06-01';

  return {
    plugins: [react()],
    server: {
      port: 5173,
      host: '127.0.0.1',
      open: false,
      proxy: {
        '/anthropic-api': {
          target: 'https://api.anthropic.com',
          changeOrigin: true,
          rewrite: (p) => p.replace(/^\/anthropic-api/, ''),
          configure: (proxy) => {
            proxy.on('proxyReq', (proxyReq) => {
              if (anthropicKey) {
                proxyReq.setHeader('x-api-key', anthropicKey);
                proxyReq.setHeader('anthropic-version', anthropicVersion);
              }
              // Strip browser-y headers — this is a server-to-server call now,
              // and Anthropic uses Origin/Referer to detect "direct browser
              // access" (which would otherwise require a special opt-in header).
              proxyReq.removeHeader('origin');
              proxyReq.removeHeader('referer');
              proxyReq.removeHeader('cookie');
            });
            proxy.on('error', (err) => {
              console.error('[anthropic-proxy] error:', err.message);
            });
          },
        },
      },
    },
  };
});
