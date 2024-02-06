import { publishOCIArtifact } from '../src/ghcr-client'
import * as fsHelper from '../src/fs-helper'
import * as ociContainer from '../src/oci-container'

// Mocks
let fsReadFileSyncMock: jest.SpyInstance
let fetchMock: jest.SpyInstance

const token = 'test-token'
const registry = new URL('https://ghcr.io')
const repository = 'test-org/test-repo'
const semver = '1.2.3'
const genericSha = '1234567890' // We should look at using different shas here to catch bug, but that make location validation harder
const zipFile: fsHelper.FileMetadata = {
  path: `test-repo-${semver}.zip`,
  size: 123,
  sha256: genericSha
}
const tarFile: fsHelper.FileMetadata = {
  path: `test-repo-${semver}.tar.gz`,
  size: 456,
  sha256: genericSha
}

const headMockNoExistingBlobs = (url: string, options: any) => {
  // Simulate none of the blobs existing currently
  return {
    status: 404
  }
}

const headMockAllExistingBlobs = (url: string, options: any) => {
  // Simulate all of the blobs existing currently
  return {
    status: 200
  }
}

let count = 0
const headMockSomeExistingBlobs = (url: string, options: any) => {
  count++
  // report one as existing
  if (count === 1) {
    return {
      status: 200
    }
  } else {
    // report all others are missing
    return {
      status: 404
    }
  }
}

const headMockFailure = (url: string, options: any) => {
  return {
    status: 503
  }
}

const postMockSuccessfulIniationForAllBlobs = (url: string, options: any) => {
  // Simulate successful initiation of uploads for all blobs & return location
  return {
    status: 202,
    headers: {
      get: (header: string) => {
        if (header === 'location') {
          return `https://ghcr.io/v2/${repository}/blobs/uploads/${genericSha}`
        }
      }
    }
  }
}

const postMockFailure = (url: string, options: any) => {
  // Simulate failed initiation of uploads
  return {
    status: 503
  }
}

const postMockNoLocationHeader = (url: string, options: any) => {
  return {
    status: 202,
    headers: {
      get: () => {}
    }
  }
}

const putMockSuccessfulBlobUpload = (url: string, options: any) => {
  // Simulate successful upload of all blobs & then the manifest
  if ((url as string).includes('manifest')) {
    return {
      status: 201,
      headers: {
        get: (header: string) => {
          if (header === 'docker-content-digest') {
            return '1234567678'
          }
        }
      }
    }
  }
  return {
    status: 201
  }
}

const putMockFailure = (url: string, options: any) => {
  // Simulate fails upload of all blobs & manifest
  return {
    status: 500
  }
}

const putMockFailureManifestUpload = (url: string, options: any) => {
  // Simulate unsuccessful upload of all blobs & then the manifest
  if (url.includes('manifest')) {
    return {
      status: 500
    };
  }
  return {
    status: 201
  };
}

function configureFetchMock(fetchMock: jest.SpyInstance, methodHandlers: any) {
  fetchMock.mockImplementation(async (url: string, options: any) => {
  validateRequestConfig(url, options)
    switch (options.method) {
      case 'GET':
        return methodHandlers.getMock(url, options)
      case 'HEAD':
        return methodHandlers.headMock(url, options)
      case 'POST':
        return methodHandlers.postMock(url, options)
      case 'PUT':
        return methodHandlers.putMock(url, options)
    }
  });
}

const testManifest: ociContainer.Manifest = {
  schemaVersion: 2,
  mediaType: 'application/vnd.oci.image.manifest.v1+json',
  artifactType: 'application/vnd.oci.image.manifest.v1+json',
  config: {
    mediaType: 'application/vnd.github.actions.package.config.v1+json',
    size: 0,
    digest:
      'sha256:e3b0c44298fc1c149afbf4c8996fb92427ae41e4649b934ca495991b7852b855',
    annotations: {
      'org.opencontainers.image.title': 'config.json'
    }
  },
  layers: [
    {
      mediaType: 'application/vnd.github.actions.package.config.v1+json',
      size: 0,
      digest:
        'sha256:e3b0c44298fc1c149afbf4c8996fb92427ae41e4649b934ca495991b7852b855',
      annotations: {
        'org.opencontainers.image.title': 'config.json'
      }
    },
    {
      mediaType: 'application/vnd.github.actions.package.layer.v1.tar+gzip',
      size: tarFile.size,
      digest: `sha256:${tarFile.sha256}`,
      annotations: {
        'org.opencontainers.image.title': tarFile.path
      }
    },
    {
      mediaType: 'application/vnd.github.actions.package.layer.v1.zip',
      size: zipFile.size,
      digest: `sha256:${zipFile.sha256}`,
      annotations: {
        'org.opencontainers.image.title': zipFile.path
      }
    }
  ],
  annotations: {
    'org.opencontainers.image.created': '2021-01-01T00:00:00.000Z',
    'action.tar.gz.digest': tarFile.sha256,
    'action.zip.digest': zipFile.sha256,
    'com.github.package.type': 'actions_oci_pkg'
  }
}

describe('publishOCIArtifact', () => {
  beforeEach(() => {
    jest.clearAllMocks()

    fsReadFileSyncMock = jest
      .spyOn(fsHelper, 'readFileContents')
      .mockImplementation()

    fetchMock = jest.spyOn(global, 'fetch').mockImplementation()
  })

  it('publishes layer blobs & then a manifest to the provided registry', async () => {
    configureFetchMock(fetchMock, { headMock: headMockNoExistingBlobs, postMock: postMockSuccessfulIniationForAllBlobs, putMock: putMockSuccessfulBlobUpload })

    // Simulate successful reading of all the files
    fsReadFileSyncMock.mockImplementation(() => {
      return Buffer.from('test')
    })

    await publishOCIArtifact(
      token,
      registry,
      repository,
      semver,
      zipFile,
      tarFile,
      testManifest
    )

    expect(fetchMock).toHaveBeenCalledTimes(10)
    expect(
      fetchMock.mock.calls.filter(call => call[1].method === 'HEAD')
    ).toHaveLength(3)
    expect(
      fetchMock.mock.calls.filter(call => call[1].method === 'POST')
    ).toHaveLength(3)
    expect(
      fetchMock.mock.calls.filter(call => call[1].method === 'PUT')
    ).toHaveLength(4)
  })

  it('skips uploading all layer blobs when they all already exist', async () => {
    configureFetchMock(fetchMock, { headMock: headMockAllExistingBlobs, postMock: postMockSuccessfulIniationForAllBlobs, putMock: putMockSuccessfulBlobUpload })

    // Simulate successful reading of all the files
    fsReadFileSyncMock.mockImplementation(() => {
      return Buffer.from('test')
    })

    await publishOCIArtifact(
      token,
      registry,
      repository,
      semver,
      zipFile,
      tarFile,
      testManifest
    )

    // We should only head all the blobs and then upload the manifest
    expect(fetchMock).toHaveBeenCalledTimes(4)
    expect(
      fetchMock.mock.calls.filter(call => call[1].method === 'HEAD')
    ).toHaveLength(3)
    expect(
      fetchMock.mock.calls.filter(call => call[1].method === 'POST')
    ).toHaveLength(0)
    expect(
      fetchMock.mock.calls.filter(call => call[1].method === 'PUT')
    ).toHaveLength(1)
  })

  it('skips uploading layer blobs that already exist', async () => {
    configureFetchMock(fetchMock, { headMock: headMockSomeExistingBlobs, postMock: postMockSuccessfulIniationForAllBlobs, putMock: putMockSuccessfulBlobUpload })
    count = 0;

    // Simulate successful reading of all the files
    fsReadFileSyncMock.mockImplementation(() => {
      return Buffer.from('test')
    })

    await publishOCIArtifact(
      token,
      registry,
      repository,
      semver,
      zipFile,
      tarFile,
      testManifest
    )

    expect(fetchMock).toHaveBeenCalledTimes(8)
    // We should only head all the blobs and then upload the missing blobs and manifest
    expect(
      fetchMock.mock.calls.filter(call => call[1].method === 'HEAD')
    ).toHaveLength(3)
    expect(
      fetchMock.mock.calls.filter(call => call[1].method === 'POST')
    ).toHaveLength(2)
    expect(
      fetchMock.mock.calls.filter(call => call[1].method === 'PUT')
    ).toHaveLength(3)
  })

  it('throws an error if checking for existing blobs fails', async () => {
    configureFetchMock(fetchMock, { headMock: headMockFailure })

    await expect(
      publishOCIArtifact(
        token,
        registry,
        repository,
        semver,
        zipFile,
        tarFile,
        testManifest
      )
    ).rejects.toThrow(/^Unexpected response from blob check for layer/)
  })

  it('throws an error if initiating layer upload fails', async () => {
    configureFetchMock(fetchMock, { headMock: headMockNoExistingBlobs, postMock: postMockFailure })

    await expect(
      publishOCIArtifact(
        token,
        registry,
        repository,
        semver,
        zipFile,
        tarFile,
        testManifest
      )
    ).rejects.toThrow('Unexpected response from POST upload 503')
  })

  it('throws an error if the upload endpoint does not return a location', async () => {
    configureFetchMock(fetchMock, { headMock: headMockNoExistingBlobs, postMock: postMockNoLocationHeader })

    await expect(
      publishOCIArtifact(
        token,
        registry,
        repository,
        semver,
        zipFile,
        tarFile,
        testManifest
      )
    ).rejects.toThrow(/^No location header in response from upload post/)
  })

  it('throws an error if a layer upload fails', async () => {
    configureFetchMock(fetchMock, { headMock: headMockNoExistingBlobs, postMock: postMockSuccessfulIniationForAllBlobs, putMock: putMockFailure })

    // Simulate successful reading of all the files
    fsReadFileSyncMock.mockImplementation(() => {
      return Buffer.from('test')
    })

    await expect(
      publishOCIArtifact(
        token,
        registry,
        repository,
        semver,
        zipFile,
        tarFile,
        testManifest
      )
    ).rejects.toThrow(/^Unexpected response from PUT upload 500/)
  })

  it('throws an error if a manifest upload fails', async () => {
    configureFetchMock(fetchMock, { headMock: headMockNoExistingBlobs, postMock: postMockSuccessfulIniationForAllBlobs, putMock: putMockFailureManifestUpload })

    // Simulate successful reading of all the files
    fsReadFileSyncMock.mockImplementation(() => {
      return Buffer.from('test')
    })

    await expect(
      publishOCIArtifact(
        token,
        registry,
        repository,
        semver,
        zipFile,
        tarFile,
        testManifest
      )
    ).rejects.toThrow(/^Unexpected response from PUT manifest 500/)
  })

  it('throws an error if reading one of the files fails', async () => {
    configureFetchMock(fetchMock, { headMock: headMockNoExistingBlobs, postMock: postMockSuccessfulIniationForAllBlobs, putMock: putMockSuccessfulBlobUpload })

    // Simulate successful reading of all the files
    fsReadFileSyncMock.mockImplementation(() => {
      throw new Error('failed to read a file: test')
    })

    await expect(
      publishOCIArtifact(
        token,
        registry,
        repository,
        semver,
        zipFile,
        tarFile,
        testManifest
      )
    ).rejects.toThrow('failed to read a file: test')
  })

  it('throws an error if one of the layers has the wrong media type', async () => {
    const modifiedTestManifest = { ...testManifest } // This is _NOT_ a deep clone
    modifiedTestManifest.layers = cloneLayers(modifiedTestManifest.layers)
    modifiedTestManifest.layers[0].mediaType = 'application/json'

    // just checking to make sure we are not changing the shared object
    expect(modifiedTestManifest.layers[0].mediaType).not.toEqual(
      testManifest.layers[0].mediaType
    )

    await expect(
      publishOCIArtifact(
        token,
        registry,
        repository,
        semver,
        zipFile,
        tarFile,
        modifiedTestManifest
      )
    ).rejects.toThrow('Unknown media type application/json')
  })
})

// We expect all fetch calls to have auth headers set
// This function verifies that given an request config.
// eslint-disable-next-line @typescript-eslint/no-explicit-any
function validateRequestConfig(url: string, config: any): void {
  // Basic URL checks
  expect(url).toBeDefined()
  if (!url.startsWith(registry.toString())) {
    console.log(`${url} does not start with ${registry}`)
  }
  // if these expect fails, run the test again with `-- --silent=false`
  // the console.log above should give a clue about which URL is failing
  expect(url.startsWith(registry.toString())).toBeTruthy()

  // Config checks
  expect(config).toBeDefined()

  expect(config.headers).toBeDefined()
  if (config.headers) {
    // Check the auth header is set
    expect(config.headers.Authorization).toBeDefined()
    // Check the auth header is the base 64 encoded token
    expect(config.headers.Authorization).toBe(
      `Bearer ${Buffer.from(token).toString('base64')}`
    )
  }
}

function cloneLayers(layers: ociContainer.Layer[]): ociContainer.Layer[] {
  const result: ociContainer.Layer[] = []
  for (const layer of layers) {
    result.push({ ...layer }) // this is _NOT_ a deep clone
  }
  return result
}
