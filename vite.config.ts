import tailwindcss from '@tailwindcss/vite';
import react from '@vitejs/plugin-react';
import path from 'path';
import { fileURLToPath } from 'url';
import { defineConfig } from 'vite';
import { VitePWA } from 'vite-plugin-pwa';

const __dirname = path.dirname(fileURLToPath(import.meta.url));

export default defineConfig(() => {
  return {
    plugins: [
      react(),
      tailwindcss(),
      VitePWA({
        registerType: 'autoUpdate',
        includeAssets: ['favicon.ico', 'apple-touch-icon.png', 'icon.svg'],
        manifest: {
          id: '/',
          name: 'DeltaAI - Institutional Crypto Trading Platform',
          short_name: 'DeltaAI',
          description: 'Personal AI Crypto Trading Platform for Delta Exchange India with Futures Scalping, Options, and Risk Engine.',
          theme_color: '#01041A',
          background_color: '#01041A',
          display: 'standalone',
          orientation: 'any',
          start_url: '/',
          scope: '/',
          categories: ['finance', 'business', 'productivity'],
          shortcuts: [
            {
              name: 'Trading Terminal',
              short_name: 'Terminal',
              description: 'Open Live Terminal and Charts',
              url: '/?tab=dashboard',
              icons: [{ src: '/pwa-192x192.png', sizes: '192x192', type: 'image/png' }],
            },
            {
              name: 'AI Command Centre',
              short_name: 'AI Command',
              description: 'Access Gemini Market Intelligence & Trade Setups',
              url: '/?tab=ai-centre',
              icons: [{ src: '/pwa-192x192.png', sizes: '192x192', type: 'image/png' }],
            },
            {
              name: 'Trading Intelligence',
              short_name: 'Sniper',
              description: 'Intraday Camarilla & CPR Sniper Signals',
              url: '/?tab=strategies',
              icons: [{ src: '/pwa-192x192.png', sizes: '192x192', type: 'image/png' }],
            },
            {
              name: 'Positions & Orders',
              short_name: 'Positions',
              description: 'Monitor Open Derivatives & Realized PnL',
              url: '/?tab=positions',
              icons: [{ src: '/pwa-192x192.png', sizes: '192x192', type: 'image/png' }],
            },
          ],
          icons: [
            {
              src: '/pwa-192x192.png',
              sizes: '192x192',
              type: 'image/png',
              purpose: 'any',
            },
            {
              src: '/pwa-512x512.png',
              sizes: '512x512',
              type: 'image/png',
              purpose: 'any',
            },
            {
              src: '/pwa-maskable-512x512.png',
              sizes: '512x512',
              type: 'image/png',
              purpose: 'maskable',
            },
          ],
        },
        workbox: {
          maximumFileSizeToCacheInBytes: 6 * 1024 * 1024,
          globPatterns: ['**/*.{js,css,html,ico,png,svg,woff,woff2}'],
          runtimeCaching: [
            {
              urlPattern: /^https:\/\/fonts\.googleapis\.com\/.*/i,
              handler: 'CacheFirst',
              options: {
                cacheName: 'google-fonts-cache',
                expiration: {
                  maxEntries: 10,
                  maxAgeSeconds: 60 * 60 * 24 * 365,
                },
                cacheableResponse: {
                  statuses: [0, 200],
                },
              },
            },
            {
              urlPattern: /^https:\/\/fonts\.gstatic\.com\/.*/i,
              handler: 'CacheFirst',
              options: {
                cacheName: 'gstatic-fonts-cache',
                expiration: {
                  maxEntries: 10,
                  maxAgeSeconds: 60 * 60 * 24 * 365,
                },
                cacheableResponse: {
                  statuses: [0, 200],
                },
              },
            },
          ],
        },
        devOptions: {
          enabled: true,
          type: 'module',
        },
      }),
    ],
    resolve: {
      alias: {
        '@': path.resolve(__dirname, '.'),
      },
    },
    server: {
      // HMR is disabled in AI Studio environment
      hmr: false,
      // Disable file watching to save CPU during agent edits
      watch: null,
    },
  };
});
