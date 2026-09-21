import { defineConfig } from 'vite';

/**
 * The public name this dev server is reached by. nginx runs on another box
 * and reverse-proxies dev.klahr.se to http://<this machine>:8080, so the
 * browser's idea of where it is and Vite's idea of where it is never agree
 * on their own.
 */
const PROXY_HOST = 'dev.klahr.se';

/**
 * `mode === 'proxy'` means we are being served through that proxy rather
 * than straight from localhost. It is selected by `npm run dev:proxy`; plain
 * `npm run dev` is unaffected, so a local session still gets a working HMR
 * socket on the port it is actually listening on.
 *
 * A mode rather than an environment variable because it is the mechanism
 * Vite already has for this, and it needs no `@types/node` for `process`.
 */
export default defineConfig(({ mode }) => {
  const behindProxy = mode === 'proxy';

  return {
    server: {
      port: behindProxy ? 8080 : 5173,
      // Behind the proxy, drifting to 8081 is not a recoverable
      // inconvenience: nothing forwards there, so it presents as the site
      // simply being down.
      strictPort: behindProxy,
      // The proxy reaches this machine across the LAN, so binding loopback
      // would turn every request into a 502.
      host: behindProxy ? '0.0.0.0' : 'localhost',
      open: false,

      /**
       * Vite refuses requests carrying a Host header it does not recognise,
       * which is exactly what a reverse-proxied name looks like to it.
       * Listing the name is what turns its "This host is not allowed" page
       * back into the app. Harmless locally, so it is not conditional.
       */
      allowedHosts: [PROXY_HOST],

      ...(behindProxy
        ? {
            /**
             * TLS is terminated at the proxy: the page arrives over https on
             * 443 while Vite itself listens on plain http on 8080. Left to
             * infer it, the HMR client dials `ws://dev.klahr.se:8080` — a
             * port the proxy does not expose — and every edit then goes
             * unnoticed until someone reloads by hand.
             *
             * This also needs nginx to pass the websocket upgrade through on
             * the same vhost (`proxy_set_header Upgrade $http_upgrade;` and
             * `Connection "upgrade"`). Without it the page still works, but
             * the console fills with reconnect warnings and edits stop
             * arriving.
             */
            hmr: { host: PROXY_HOST, protocol: 'wss', clientPort: 443 },
          }
        : {}),
    },
    build: { target: 'es2022', sourcemap: true },
  };
});
