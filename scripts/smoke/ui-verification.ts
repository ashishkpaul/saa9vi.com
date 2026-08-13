/**
 * Layer 3: Web & Endpoint Health Verification
 *
 * Verifies that key front-end routes and UI endpoints (Dashboard, Admin UI, APIs)
 * respond with valid HTTP status codes and expected HTML signatures.
 */
import http from 'http';
import https from 'https';

const HOST = process.env.HOST || 'http://localhost:3000';

interface RouteCheck {
  path: string;
  expectedStatus: number;
  expectedBodySubstring?: string;
}

const routesToCheck: RouteCheck[] = [
  { path: '/dashboard', expectedStatus: 200 },
  { path: '/admin-api?query=%7B__typename%7D', expectedStatus: 200 },
  { path: '/shop-api?query=%7B__typename%7D', expectedStatus: 200 },
];

function checkRoute(route: RouteCheck): Promise<void> {
  return new Promise((resolve, reject) => {
    const url = new URL(route.path, HOST);
    const client = url.protocol === 'https:' ? https : http;

    console.log(`[Endpoint Check] Fetching ${url.toString()}...`);
    const req = client.get(url, (res) => {
      let data = '';
      res.on('data', (chunk) => (data += chunk));
      res.on('end', () => {
        if (res.statusCode !== route.expectedStatus) {
          return reject(
            new Error(
              `Expected HTTP ${route.expectedStatus} for ${route.path}, got ${res.statusCode}`
            )
          );
        }
        if (route.expectedBodySubstring && !data.includes(route.expectedBodySubstring)) {
          return reject(
            new Error(
              `Body for ${route.path} missing expected substring "${route.expectedBodySubstring}"`
            )
          );
        }
        console.log(`  ✓ ${route.path} responds with HTTP ${res.statusCode}`);
        resolve();
      });
    });

    req.on('error', (err) => reject(err));
    req.end();
  });
}

async function verifyEndpointHealth() {
  console.log('=== Layer 3: Web & Endpoint Health Verification ===');
  for (const route of routesToCheck) {
    await checkRoute(route);
  }
  console.log('=== Layer 3 Web & Endpoint Health Verification Passed ===');
}

if (require.main === module) {
  verifyEndpointHealth().catch((err) => {
    console.error('❌ Layer 3 Web & Endpoint Check Failed:', err.message);
    process.exit(1);
  });
}
