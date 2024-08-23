import {
  uploadOCIImageManifest
  // uploadOCIIndexManifest
} from '../src/ghcr-client'
import * as ociContainer from '../src/oci-container'
import * as crypto from 'crypto'

// Mocks
let fetchMock: jest.SpyInstance

const token = 'test-token'
const registry = new URL('https://ghcr.io')
const repository = 'test-org/test-repo'
const semver = '1.2.3'
const genericSha = '1234567890' // We should look at using different shas here to catch bug, but that make location validation harder

const checkBlobNoExistingBlobs = (): object => {
  // Simulate none of the blobs existing currently
  return {
    text() {
      return '{"errors": [{"code": "NOT_FOUND", "message": "blob not found."}]}'
    },
    status: 404,
    statusText: 'Not Found'
  }
}

const checkBlobAllExistingBlobs = (): object => {
  // Simulate all of the blobs existing currently
  return {
    status: 200,
    statusText: 'OK'
  }
}

let count = 0
const checkBlobSomeExistingBlobs = (): object => {
  count++
  // report one as existing
  if (count === 1) {
    return {
      status: 200,
      statusText: 'OK'
    }
  } else {
    // report all others are missing
    return {
      text() {
        return '{"errors": [{"code": "NOT_FOUND", "message": "blob not found."}]}'
      },
      status: 404,
      statusText: 'Not Found'
    }
  }
}

const checkBlobFailure = (): object => {
  return {
    text() {
      // In this case we'll simulate a response which does not use the expected error format
      return '503 Service Unavailable'
    },
    status: 503,
    statusText: 'Service Unavailable'
  }
}

const initiateBlobUploadSuccessForAllBlobs = (): object => {
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

const initiateBlobUploadFailureForAllBlobs = (): object => {
  // Simulate failed initiation of uploads
  return {
    text() {
      // In this case we'll simulate a response which does not use the expected error format
      return '503 Service Unavailable'
    },
    status: 503,
    statusText: 'Service Unavailable'
  }
}

const initiateBlobUploadNoLocationHeader = (): object => {
  return {
    status: 202,
    headers: {
      get: () => {}
    }
  }
}

const putManifestSuccessful = (
  digestToReturn: string,
  expectedVersion: string
): ((url: string) => object) => {
  return (url: string): object => {
    expect(url.endsWith(`manifests/${expectedVersion}`)).toBeTruthy()

    return {
      status: 201,
      headers: {
        get: (header: string) => {
          if (header === 'docker-content-digest') {
            return digestToReturn
          }
        }
      }
    }
  }
}

const putBlobSuccess = (): object => {
  return {
    status: 201
  }
}

const putManifestFailure = (): object => {
  // Simulate fails upload of all blobs & manifest
  return {
    text() {
      return '{"errors": [{"code": "BAD_REQUEST", "message": "tag already exists."}]}'
    },
    status: 400,
    statusText: 'Bad Request'
  }
}

const putBlobFailure = (): object => {
  // Simulate fails upload of all blobs & manifest
  return {
    text() {
      return '{"errors": [{"code": "BAD_REQUEST", "message": "digest issue."}]}'
    },
    status: 400,
    statusText: 'Bad Request'
  }
}

type MethodHandlers = {
  checkBlobMock?: (url: string, options: { method: string }) => object
  initiateBlobUploadMock?: (url: string, options: { method: string }) => object
  putManifestMock?: (url: string, options: { method: string }) => object
  putBlobMock?: (url: string, options: { method: string }) => object
}

function configureFetchMock(
  fetchMockInstance: jest.SpyInstance,
  methodHandlers: MethodHandlers
): void {
  fetchMockInstance.mockImplementation(
    async (url: string, options: { method: string }) => {
      validateRequestConfig(url, options)
      switch (options.method) {
        case 'HEAD':
          return methodHandlers.checkBlobMock?.(url, options)
        case 'POST':
          return methodHandlers.initiateBlobUploadMock?.(url, options)
        case 'PUT':
          if (url.includes('manifest')) {
            return methodHandlers.putManifestMock?.(url, options)
          } else {
            return methodHandlers.putBlobMock?.(url, options)
          }
      }
    }
  )
}

describe('uploadOCIImageManifest', () => {
  beforeEach(() => {
    jest.clearAllMocks()
    fetchMock = jest.spyOn(global, 'fetch').mockImplementation()
  })

  it('uploads blobs then untagged manifest to the provided registry', async () => {
    const { manifest, sha, blobs } = testImageManifest()

    configureFetchMock(fetchMock, {
      checkBlobMock: checkBlobNoExistingBlobs,
      initiateBlobUploadMock: initiateBlobUploadSuccessForAllBlobs,
      putBlobMock: putBlobSuccess,
      putManifestMock: putManifestSuccessful(sha, sha)
    })

    await uploadOCIImageManifest(token, registry, repository, manifest, blobs)

    // TODO: See what calls there are
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

  it('uploads blobs then tagged manifest to the provided registry', async () => {
    const { manifest, sha, blobs } = testImageManifest()

    configureFetchMock(fetchMock, {
      checkBlobMock: checkBlobNoExistingBlobs,
      initiateBlobUploadMock: initiateBlobUploadSuccessForAllBlobs,
      putBlobMock: putBlobSuccess,
      putManifestMock: putManifestSuccessful(sha, semver)
    })

    await uploadOCIImageManifest(
      token,
      registry,
      repository,
      manifest,
      blobs,
      semver
    )

    // TODO: See what calls there are
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

  it('skips blob uploads if all blobs already exist', async () => {
    const { manifest, sha, blobs } = testImageManifest()

    configureFetchMock(fetchMock, {
      checkBlobMock: checkBlobAllExistingBlobs,
      initiateBlobUploadMock: initiateBlobUploadSuccessForAllBlobs,
      putBlobMock: putBlobSuccess,
      putManifestMock: putManifestSuccessful(sha, sha)
    })

    await uploadOCIImageManifest(token, registry, repository, manifest, blobs)

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

  it('skips blob uploads if some blobs already exist', async () => {
    const { manifest, sha, blobs } = testImageManifest()

    configureFetchMock(fetchMock, {
      checkBlobMock: checkBlobSomeExistingBlobs,
      initiateBlobUploadMock: initiateBlobUploadSuccessForAllBlobs,
      putBlobMock: putBlobSuccess,
      putManifestMock: putManifestSuccessful(sha, sha)
    })

    await uploadOCIImageManifest(token, registry, repository, manifest, blobs)

    expect(fetchMock).toHaveBeenCalledTimes(8)
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
    const { manifest, sha, blobs } = testImageManifest()

    configureFetchMock(fetchMock, {
      checkBlobMock: checkBlobFailure,
      initiateBlobUploadMock: initiateBlobUploadSuccessForAllBlobs,
      putBlobMock: putBlobSuccess,
      putManifestMock: putManifestSuccessful(sha, sha)
    })

    await expect(
      uploadOCIImageManifest(token, registry, repository, manifest, blobs)
    ).rejects.toThrow(
      /^Unexpected 503 Service Unavailable response from check blob/
    )
  })

  it('throws an error if initiating layer upload fails', async () => {
    const { manifest, sha, blobs } = testImageManifest()

    configureFetchMock(fetchMock, {
      checkBlobMock: checkBlobNoExistingBlobs,
      initiateBlobUploadMock: initiateBlobUploadFailureForAllBlobs,
      putBlobMock: putBlobSuccess,
      putManifestMock: putManifestSuccessful(sha, sha)
    })

    await expect(
      uploadOCIImageManifest(token, registry, repository, manifest, blobs)
    ).rejects.toThrow(
      'Unexpected 503 Service Unavailable response from initiate layer upload. Response Body: 503 Service Unavailable.'
    )
  })

  it('throws an error if the upload endpoint does not return a location', async () => {
    const { manifest, sha, blobs } = testImageManifest()

    configureFetchMock(fetchMock, {
      checkBlobMock: checkBlobNoExistingBlobs,
      initiateBlobUploadMock: initiateBlobUploadNoLocationHeader,
      putBlobMock: putBlobSuccess,
      putManifestMock: putManifestSuccessful(sha, sha)
    })

    await expect(
      uploadOCIImageManifest(token, registry, repository, manifest, blobs)
    ).rejects.toThrow(/^No location header in response from upload post/)
  })

  it('throws an error if a layer upload fails', async () => {
    const { manifest, sha, blobs } = testImageManifest()

    configureFetchMock(fetchMock, {
      checkBlobMock: checkBlobNoExistingBlobs,
      initiateBlobUploadMock: initiateBlobUploadSuccessForAllBlobs,
      putBlobMock: putBlobFailure,
      putManifestMock: putManifestSuccessful(sha, sha)
    })

    await expect(
      uploadOCIImageManifest(token, registry, repository, manifest, blobs)
    ).rejects.toThrow(/^Unexpected 400 Bad Request response from layer/)
  })

  it('throws an error if a manifest upload fails', async () => {
    const { manifest, blobs } = testImageManifest()

    configureFetchMock(fetchMock, {
      checkBlobMock: checkBlobAllExistingBlobs,
      initiateBlobUploadMock: initiateBlobUploadSuccessForAllBlobs,
      putBlobMock: putBlobSuccess,
      putManifestMock: putManifestFailure
    })

    await expect(
      uploadOCIImageManifest(token, registry, repository, manifest, blobs)
    ).rejects.toThrow(
      'Unexpected 400 Bad Request response from manifest upload. Errors: BAD_REQUEST - tag already exists.'
    )
  })

  it('throws an error if the returned digest does not match the precalculated one', async () => {
    const { manifest, sha, blobs } = testImageManifest()

    configureFetchMock(fetchMock, {
      checkBlobMock: checkBlobAllExistingBlobs,
      initiateBlobUploadMock: initiateBlobUploadSuccessForAllBlobs,
      putBlobMock: putBlobSuccess,
      putManifestMock: putManifestSuccessful('some-garbage-digest', sha)
    })

    await expect(
      uploadOCIImageManifest(token, registry, repository, manifest, blobs)
    ).rejects.toThrow(
      `Digest mismatch. Expected ${sha}, got some-garbage-digest.`
    )
  })
})

describe('uploadOCIIndexManifest', () => {
  beforeEach(() => {
    jest.clearAllMocks()
    fetchMock = jest.spyOn(global, 'fetch').mockImplementation()
  })

  it('uploads the tagged manifest with the appropriate tag', async () => {})

  it('throws an error if a manifest upload fails', async () => {})

  it('throws an error if the returned digest does not match the precalculated one', async () => {})
})

function testImageManifest(): {
  manifest: ociContainer.OCIImageManifest
  sha: string
  blobs: Map<string, Buffer>
} {
  const blobs = new Map<string, Buffer>()
  blobs.set(ociContainer.emptyConfigSha, Buffer.from('{}'))

  const firstFile = Buffer.from('test1')
  const secondFile = Buffer.from('test2')

  const firstFileDigest = `sha256:${crypto
    .createHash('sha256')
    .update(firstFile)
    .digest('hex')}`

  const secondFileDigest = `sha256:${crypto
    .createHash('sha256')
    .update(secondFile)
    .digest('hex')}`

  blobs.set(firstFileDigest, firstFile)
  blobs.set(secondFileDigest, secondFile)

  const manifest: ociContainer.OCIImageManifest = {
    schemaVersion: 2,
    mediaType: ociContainer.imageManifestMediaType,
    artifactType: ociContainer.imageManifestMediaType,
    config: ociContainer.createEmptyConfigLayer(),
    layers: [
      {
        mediaType: 'application/octet-stream',
        size: firstFile.length,
        digest: firstFileDigest
      },
      {
        mediaType: 'application/octet-stream',
        size: secondFile.length,
        digest: secondFileDigest
      }
    ],
    annotations: {
      'org.opencontainers.image.created': new Date().toISOString()
    }
  }

  const sha = ociContainer.sha256Digest(manifest)

  return { manifest, sha, blobs }
}

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
