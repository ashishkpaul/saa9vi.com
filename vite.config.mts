import { vendureDashboardPlugin } from '@vendure/dashboard/vite';
import { join, resolve } from 'path';
import { pathToFileURL } from 'url';
import { defineConfig, type Plugin } from 'vite';

/**
 * Saa9vi dashboard branding.
 *
 * The document title is set at runtime by the Dashboard SPA
 * (`@vendure/dashboard@3.7.4`: `src/app/common/use-page-title.ts` holds
 * `const DEFAULT_TITLE = 'Vendure'`, applied as `document.title` from the
 * root route `src/app/routes/__root.tsx`). There is no config option for it,
 * and `index.html` has no `<title>` tag to edit, so a MutationObserver-style
 * runtime patch would fight React's own assignment and clobber the page-name
 * prefix (`Administrators • Vendure` -> page name would be lost).
 *
 * Instead we rewrite the hardcoded constant at build time, preserving the
 * `breadcrumb • brand` format (`Administrators • Saa9vi Admin`, plain
 * `Saa9vi Admin` on pages without a breadcrumb such as login).
 *
 * The guard throws loudly on a Vendure upgrade instead of silently reverting
 * to "Vendure" if the upstream file changes.
 */
function saa9viBranding(): Plugin {
    const BRAND = 'Saa9vi Admin';
    return {
        name: 'saa9vi-branding',
        enforce: 'pre',
        // Rewrites the hardcoded default in the Dashboard's page-title hook.
        transform(code, id) {
            if (!id.includes('use-page-title')) return;
            const needle = "const DEFAULT_TITLE = 'Vendure';";
            // Fail loudly on a Vendure upgrade instead of silently reverting to "Vendure".
            if (!code.includes(needle)) {
                throw new Error(
                    'saa9viBranding: DEFAULT_TITLE not found; update the plugin for this Vendure version',
                );
            }
            return { code: code.replace(needle, `const DEFAULT_TITLE = '${BRAND}';`), map: null };
        },
        // Meta tags in the generated index.html.
        transformIndexHtml(html) {
            return html
                .replace('content="Vendure Admin Dashboard"', 'content="Saa9vi Admin Dashboard"')
                .replace('<meta name="author" content="Vendure" />', '<meta name="author" content="Saa9vi" />');
        },
    };
}

export default defineConfig({
    base: '/dashboard',
    build: {
        outDir: join(__dirname, 'dist/dashboard'),
    },
    // ─── SERVER BLOCK ────────────────────────────────────────────────────
    server: {
        host: true, // Allows Nginx to reach the Vite server internally
        allowedHosts: ['.meeting.lan', 'localhost'], // Permits incoming proxy traffic
    },
    // ─────────────────────────────────────────────────────────────────────
    plugins: [
        saa9viBranding(),
        vendureDashboardPlugin({
            // The vendureDashboardPlugin will scan your configuration in order
            // to find any plugins which have dashboard extensions, as well as
            // to introspect the GraphQL schema based on any API extensions
            // and custom fields that are configured.
            vendureConfigPath: pathToFileURL('./src/vendure-config.ts'),
            // Points to the location of your Vendure server.
            // In production, 'auto' lets the dashboard derive the API URL from the
            // server that serves it. In development, we use explicit defaults so that
            // the Vite dev server can reach the Vendure backend.
            api: process.env.NODE_ENV === 'production'
                ? { host: 'auto', port: 'auto' }
                : { host: 'https://core.meeting.lan', port: 'auto' }, // <── Fixed: Added quotes around 'auto'
            // When you start the Vite server, your Admin API schema will
            // be introspected and the types will be generated in this location.
            // These types can be used in your dashboard extensions to provide
            // type safety when writing queries and mutations.
            gqlOutputPath: './src/gql',
        }),
    ],
    resolve: {
        alias: {
            // This allows all plugins to reference a shared set of
            // GraphQL types.
            '@/gql': resolve(__dirname, './src/gql/graphql.ts'),
        },
    },
});
