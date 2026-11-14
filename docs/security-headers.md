# Static response security headers

`public/_headers` is copied to `dist/_headers` by Astro and interpreted by
Cloudflare Pages. The wildcard rule protects both intake and Activity documents
and their static assets. Pages Functions responses do not inherit this file;
API response policies must be implemented in the Functions handlers.

The content security policy allows scripts, API connections, fonts, and service
workers only from the same origin. Inline script elements and native inline
event handlers are blocked. Object embedding and framing the app are disabled.
Inline styles remain available for Alpine visibility and transition directives.

The standard `alpinejs` build evaluates attribute expressions with the Function
constructor, so `script-src` explicitly retains `'unsafe-eval'`. Removing it
would disable the keypad, settings, and Activity controllers. A future migration
to `@alpinejs/csp` must rewrite unsupported expressions and verify both pages
before removing this exception. This policy limits script sources but does not
provide the protection of a policy that also disallows dynamic evaluation.

The service worker and manifest require revalidation on every HTTP cache reuse.
Only content-hashed `/_astro/` bundles receive year-long immutable caching.
The service worker's own Cache Storage strategy is separate from HTTP caching;
these rules do not change its offline app-shell behavior.

## Verification

Run `node --import ./tests/register-loader.js --test tests/pwa.test.ts`, then
`pnpm build` and compare `public/_headers` with `dist/_headers`.
On a Pages preview, inspect `/`, `/activity`, `/sw.js`, `/manifest.json`, and
a built `/_astro/` bundle. Confirm security headers on both documents and the
correct cache policy on each asset. In a browser, check the keypad, Settings,
Activity, and service-worker registration while watching for CSP violations.

References:

- [Cloudflare Pages headers](https://developers.cloudflare.com/pages/configuration/headers/)
- [Alpine content security policy build](https://alpinejs.dev/advanced/csp)
