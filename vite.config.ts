import { defineConfig } from 'vite';
import basicSsl from '@vitejs/plugin-basic-ssl';

/**
 * The public name this dev server is reached by. nginx runs on another box
 * and reverse-proxies dev.klahr.se to http://<this machine>:8080, so the
 * browser's idea of where it is and Vite's idea of where it is never agree
 * on their own.
 */
const PROXY_HOST = 'dev.klahr.se';

/**
 * How the dev server is being reached, chosen by `--mode`:
 *
 * | mode        | script                | serves                          |
 * |-------------|-----------------------|---------------------------------|
 * | (default)   | `npm run dev`         | http://localhost:5173           |
 * | `proxy`     | `npm run dev:proxy`   | :8080, behind nginx on http     |
 * | `proxy-tls` | `npm run dev:proxy:tls` | :8080, behind nginx on https  |
 * | `lan-tls`   | `npm run dev:tls`     | https://<lan ip>:8443, directly |
 *
 * `proxy-tls` is the one to use: dev.klahr.se now carries a certificate and
 * redirects http to https, so the browser's origin is secure and WebXR is
 * available there. This matters because `navigator.xr` is `[SecureContext]`
 * — on a plain-http origin a headset browser cannot see the headset at all,
 * the API being absent rather than merely unusable. Vite itself still speaks
 * plain http on 8080; nginx terminates the TLS. The only thing the mode
 * changes is where the HMR client dials, and getting that wrong under
 * `proxy` (ws on :80, from an https page) is a blocked mixed-content socket
 * and edits that go unnoticed until a manual reload.
 *
 * Plain `proxy` is therefore only right if that vhost ever loses its
 * certificate. `lan-tls` predates the certificate: it serves TLS straight
 * off this machine with a throwaway cert, which the headset warns about
 * once. It stays useful for working without the nginx box in the path.
 */
export default defineConfig(({ mode }) => {
  const behindProxy = mode === 'proxy' || mode === 'proxy-tls';
  const proxyIsTls = mode === 'proxy-tls';
  const lanTls = mode === 'lan-tls';

  return {
    // Generates a self-signed certificate on first run and caches it. Only
    // ever loaded for the one mode that wants it.
    plugins: lanTls ? [basicSsl()] : [],

    server: {
      port: lanTls ? 8443 : behindProxy ? 8080 : 5173,
      // Behind the proxy, drifting to 8081 is not a recoverable
      // inconvenience: nothing forwards there, so it presents as the site
      // simply being down.
      strictPort: behindProxy || lanTls,
      // The proxy reaches this machine across the LAN, and so does the
      // headset in `lan-tls`; binding loopback would make both unreachable.
      host: behindProxy || lanTls ? '0.0.0.0' : 'localhost',
      open: false,

      /**
       * Vite refuses requests carrying a Host header it does not recognise,
       * which is exactly what a reverse-proxied name looks like to it.
       * Listing the name is what turns its "This host is not allowed" page
       * back into the app. Bare IP addresses are allowed by Vite already, so
       * `lan-tls` needs no entry. Harmless locally, so it is not conditional.
       */
      allowedHosts: [PROXY_HOST],

      ...(behindProxy
        ? {
            /**
             * Through the proxy the browser talks to nginx on a default port
             * while Vite listens on 8080, so the HMR client has to be told
             * where to knock. Left to infer it, it dials the Vite port on the
             * public name — which nginx does not expose — and edits then go
             * unnoticed until someone reloads by hand.
             *
             * This also needs nginx to pass the websocket upgrade through on
             * the same vhost (`proxy_set_header Upgrade $http_upgrade;` and
             * `Connection "upgrade"`). Without it the page still works, but
             * the console fills with reconnect warnings.
             */
            hmr: {
              host: PROXY_HOST,
              protocol: proxyIsTls ? ('wss' as const) : ('ws' as const),
              clientPort: proxyIsTls ? 443 : 80,
            },
          }
        : {}),
      // `lan-tls` needs no HMR override at all: the page and the dev server
      // are the same origin, so the client's own defaults are already right.
    },

    build: { target: 'es2022', sourcemap: true },
  };
});
