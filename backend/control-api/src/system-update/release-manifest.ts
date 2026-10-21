export interface KubernetesReleaseImages {
  frontend: string;
  controlApi: string;
  runtimeGateway: string;
}

export interface KubernetesReleaseManifest {
  version: string;
  repository: string;
  images: Partial<KubernetesReleaseImages>;
}

const MAX_MANIFEST_BYTES = 256 * 1024;
const trustedAssetHosts = new Set([
  'api.github.com',
  'github.com',
  'release-assets.githubusercontent.com',
  'objects.githubusercontent.com',
]);

const components: Array<keyof KubernetesReleaseImages> = ['frontend', 'controlApi', 'runtimeGateway'];

export function validateKubernetesReleaseManifest(
  input: unknown,
  expectedVersion: string,
  expectedRepository: string,
): KubernetesReleaseImages {
  if (!input || typeof input !== 'object' || Array.isArray(input)) throw new Error('release manifest must be an object');
  const manifest = input as Partial<KubernetesReleaseManifest>;
  if (manifest.version !== expectedVersion) throw new Error('release manifest version does not match the selected release');
  if (manifest.repository !== expectedRepository) throw new Error('release manifest repository does not match the configured repository');
  if (!manifest.images || typeof manifest.images !== 'object' || Array.isArray(manifest.images)) throw new Error('release manifest images are missing');

  const prefix = `ghcr.io/${expectedRepository.toLowerCase()}`;
  const expectedPrefixes: Record<keyof KubernetesReleaseImages, string> = {
    frontend: `${prefix}-frontend@sha256:`,
    controlApi: `${prefix}-control-api@sha256:`,
    runtimeGateway: `${prefix}-runtime-gateway@sha256:`,
  };
  const images = {} as KubernetesReleaseImages;
  for (const component of components) {
    const image = manifest.images[component];
    if (typeof image !== 'string') throw new Error(`release manifest ${component} image is missing`);
    if (!/@sha256:[a-f0-9]{64}$/i.test(image))
      throw new Error(`release manifest ${component} image must use an immutable digest`);
    if (!image.toLowerCase().startsWith(expectedPrefixes[component]))
      throw new Error(`release manifest ${component} image is outside the trusted repository`);
    images[component] = image;
  }
  return images;
}

export async function fetchKubernetesReleaseManifest({
  repository,
  releaseVersion,
  assetId,
  token,
  fetcher = fetch,
}: {
  repository: string;
  releaseVersion: string;
  assetId: number;
  token?: string;
  fetcher?: typeof fetch;
}): Promise<KubernetesReleaseImages> {
  if (!/^[A-Za-z0-9_.-]+\/[A-Za-z0-9_.-]+$/.test(repository)) throw new Error('release manifest repository is invalid');
  if (!Number.isSafeInteger(assetId) || assetId <= 0) throw new Error('release manifest asset id is invalid');

  let url = new URL(`https://api.github.com/repos/${repository}/releases/assets/${assetId}`);
  for (let redirects = 0; redirects <= 3; redirects += 1) {
    assertTrustedAssetUrl(url);
    const headers: Record<string, string> = {
      accept: 'application/octet-stream',
      'user-agent': 'kubenova-update-checker',
    };
    if (redirects === 0 && token?.trim()) headers.authorization = `Bearer ${token.trim()}`;
    const response = await fetcher(url, { headers, redirect: 'manual', signal: AbortSignal.timeout(10_000) });
    if ([301, 302, 303, 307, 308].includes(response.status)) {
      if (redirects === 3) throw new Error('release manifest exceeded the redirect limit');
      const location = response.headers.get('location');
      if (!location) throw new Error('release manifest redirect has no location');
      url = new URL(location, url);
      assertTrustedAssetUrl(url);
      continue;
    }
    if (!response.ok) throw new Error(`release manifest download failed (HTTP ${response.status})`);
    const contentLength = Number(response.headers.get('content-length'));
    if (Number.isFinite(contentLength) && contentLength > MAX_MANIFEST_BYTES)
      throw new Error('release manifest exceeds the 256 KiB limit');
    const body = await readBoundedBody(response, MAX_MANIFEST_BYTES);
    let manifest: unknown;
    try { manifest = JSON.parse(body); } catch { throw new Error('release manifest is not valid JSON'); }
    return validateKubernetesReleaseManifest(manifest, releaseVersion, repository);
  }
  throw new Error('release manifest redirect handling failed');
}

function assertTrustedAssetUrl(url: URL): void {
  if (url.protocol !== 'https:' || !trustedAssetHosts.has(url.hostname.toLowerCase()) || url.username || url.password || url.port)
    throw new Error('release manifest redirect host is not trusted');
}

async function readBoundedBody(response: Response, maxBytes: number): Promise<string> {
  if (!response.body) throw new Error('release manifest response is empty');
  const reader = response.body.getReader();
  const chunks: Uint8Array[] = [];
  let size = 0;
  try {
    while (true) {
      const { done, value } = await reader.read();
      if (done) break;
      size += value.byteLength;
      if (size > maxBytes) {
        await reader.cancel();
        throw new Error('release manifest exceeds the 256 KiB limit');
      }
      chunks.push(value);
    }
  } finally {
    reader.releaseLock();
  }
  return Buffer.concat(chunks.map((chunk) => Buffer.from(chunk))).toString('utf8');
}
