import { execFileSync } from 'node:child_process';
import { mkdtempSync, readFileSync, rmSync } from 'node:fs';
import { createServer, type Server } from 'node:https';
import type { AddressInfo } from 'node:net';
import { tmpdir } from 'node:os';
import path from 'node:path';

/** The flag that lets Chromium trust the self-signed certificate of {@link startFileHost}. */
export const TRUST_TEST_CERTIFICATE = '--ignore-certificate-errors';

export interface FileHost {
  /** The origin of the host, such as `https://127.0.0.1:41233`. It is another origin than Canvas. */
  readonly origin: string;
  /** The paths (with the query) that reached the host, in order. */
  readonly requests: readonly string[];
  /** The `cookie` header of each request that reached the host. */
  readonly cookies: readonly (string | undefined)[];
  close(): Promise<void>;
}

/**
 * Starts a real HTTPS server on the loopback address that serves a small file. Playwright does
 * not route the hops of a redirect, so a redirect from the fake Canvas needs a real host to land
 * on, the way Canvas redirects to its file storage. Run Chromium with {@link TRUST_TEST_CERTIFICATE}.
 */
export async function startFileHost(
  files: Readonly<Record<string, { body: string; contentType: string }>>,
): Promise<FileHost> {
  const dir = mkdtempSync(path.join(tmpdir(), 'weekrow-file-host-'));
  const key = path.join(dir, 'key.pem');
  const cert = path.join(dir, 'cert.pem');
  execFileSync(
    'openssl',
    [
      ...['req', '-x509', '-newkey', 'rsa:2048', '-nodes', '-days', '2', '-subj', '/CN=127.0.0.1'],
      ...['-addext', 'subjectAltName=IP:127.0.0.1', '-keyout', key, '-out', cert],
    ],
    { stdio: 'ignore' },
  );
  const requests: string[] = [];
  const cookies: (string | undefined)[] = [];
  const server: Server = createServer(
    { key: readFileSync(key), cert: readFileSync(cert) },
    (request, response) => {
      requests.push(request.url ?? '');
      cookies.push(request.headers.cookie);
      const url = new URL(request.url ?? '/', 'https://127.0.0.1');
      const file = files[url.pathname];
      if (file === undefined) {
        response.writeHead(404, { 'content-type': 'text/plain' }).end('not found');
        return;
      }
      response.writeHead(200, { 'content-type': file.contentType }).end(file.body);
    },
  );
  await new Promise<void>((resolve) => server.listen(0, '127.0.0.1', resolve));
  const { port } = server.address() as AddressInfo;
  return {
    origin: `https://127.0.0.1:${port}`,
    requests,
    cookies,
    close: () =>
      new Promise<void>((resolve) => {
        server.close(() => {
          rmSync(dir, { recursive: true, force: true });
          resolve();
        });
        server.closeAllConnections();
      }),
  };
}
