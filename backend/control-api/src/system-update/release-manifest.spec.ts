import { fetchKubernetesReleaseManifest, validateKubernetesReleaseManifest } from './release-manifest';

const repository = 'feize666/kubenova';
const images = {
  frontend: `ghcr.io/${repository}-frontend@sha256:${'a'.repeat(64)}`,
  controlApi: `ghcr.io/${repository}-control-api@sha256:${'b'.repeat(64)}`,
  runtimeGateway: `ghcr.io/${repository}-runtime-gateway@sha256:${'c'.repeat(64)}`,
};

describe('Kubernetes release manifest validation', () => {
  it('accepts matching release identity and immutable images from the configured repository', () => {
    expect(validateKubernetesReleaseManifest({ version: 'v1.9', repository, images }, 'v1.9', repository)).toEqual(images);
  });

  it('rejects a manifest for another release or repository', () => {
    expect(() => validateKubernetesReleaseManifest({ version: 'v1.8', repository, images }, 'v1.9', repository)).toThrow(/version/);
    expect(() => validateKubernetesReleaseManifest({ version: 'v1.9', repository: 'attacker/kubenova', images }, 'v1.9', repository)).toThrow(/repository/);
  });

  it('rejects mutable tags, wrong image repositories, and incomplete image sets', () => {
    expect(() => validateKubernetesReleaseManifest({ version: 'v1.9', repository, images: { ...images, frontend: `ghcr.io/${repository}-frontend:v1.9` } }, 'v1.9', repository)).toThrow(/immutable digest/);
    expect(() => validateKubernetesReleaseManifest({ version: 'v1.9', repository, images: { ...images, frontend: `ghcr.io/attacker/frontend@sha256:${'a'.repeat(64)}` } }, 'v1.9', repository)).toThrow(/trusted repository/);
    expect(() => validateKubernetesReleaseManifest({ version: 'v1.9', repository, images: { frontend: images.frontend } }, 'v1.9', repository)).toThrow(/image is missing/);
  });

  it('downloads only from GitHub release asset hosts and validates the response manifest', async () => {
    const manifest = { version: 'v1.9', repository, images };
    const fetcher = jest.fn()
      .mockResolvedValueOnce(new Response(null, { status: 302, headers: { location: 'https://release-assets.githubusercontent.com/release-manifest.json' } }))
      .mockResolvedValueOnce(new Response(JSON.stringify(manifest), { status: 200 }));

    await expect(fetchKubernetesReleaseManifest({ repository, releaseVersion: 'v1.9', assetId: 42, fetcher }))
      .resolves.toEqual(images);
    const firstCall = fetcher.mock.calls[0] as unknown as [URL, RequestInit];
    const secondCall = fetcher.mock.calls[1] as unknown as [URL, RequestInit];
    expect(firstCall[0].href).toBe(`https://api.github.com/repos/${repository}/releases/assets/42`);
    expect(firstCall[1]).toMatchObject({ redirect: 'manual', headers: expect.objectContaining({ accept: 'application/octet-stream' }) });
    expect(secondCall[0].href).toBe('https://release-assets.githubusercontent.com/release-manifest.json');
    expect(secondCall[1]).toMatchObject({ redirect: 'manual', headers: expect.not.objectContaining({ authorization: expect.any(String) }) });
  });

  it('rejects untrusted redirects, oversized assets, and invalid release asset identifiers', async () => {
    const untrusted = jest.fn().mockResolvedValue(new Response(null, { status: 302, headers: { location: 'https://evil.example/manifest.json' } }));
    await expect(fetchKubernetesReleaseManifest({ repository, releaseVersion: 'v1.9', assetId: 42, fetcher: untrusted })).rejects.toThrow(/redirect host/);

    const oversized = jest.fn().mockResolvedValue(new Response(' '.repeat(256 * 1024 + 1), { status: 200 }));
    await expect(fetchKubernetesReleaseManifest({ repository, releaseVersion: 'v1.9', assetId: 42, fetcher: oversized })).rejects.toThrow(/exceeds/);
    await expect(fetchKubernetesReleaseManifest({ repository, releaseVersion: 'v1.9', assetId: 0, fetcher: oversized })).rejects.toThrow(/asset id/);
  });
});
