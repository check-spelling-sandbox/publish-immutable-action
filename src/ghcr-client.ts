import * as core from '@actions/core'
import { FileMetadata } from './fs-helper'
import * as ociContainer from './oci-container'
import axios from 'axios'
import { fieldEnds } from 'tar'
import * as fs from 'fs'
import { promiseHooks } from 'v8'
import * as fsHelper from './fs-helper'
import axiosDebugLog from 'axios-debug-log'

// Publish the OCI artifact and return the URL where it can be downloaded
export async function publishOCIArtifact(
  token: string,
  registry: URL,
  repository: string,
  releaseId: string,
  semver: string,
  zipFile: FileMetadata,
  tarFile: FileMetadata,
  manifest: ociContainer.Manifest,
  debugRequests: boolean = false
): Promise<URL> {
  if (debugRequests) {
    configureRequestDebugLogging()
  }

  const b64Token = Buffer.from(token).toString('base64')

  const checkBlobEndpoint = new URL(
    `v2/${repository}/blobs/`,
    registry
  ).toString()
  const uploadBlobEndpoint = new URL(
    `v2/${repository}/blobs/uploads/`,
    registry
  ).toString()
  const manifestEndpoint = new URL(
    `v2/${repository}/manifests/${semver}`,
    registry
  ).toString()

  core.info(
    `Creating GHCR package for release with semver:${semver} with path:"${zipFile.path}" and "${tarFile.path}".`
  )

  let layerUploads: Promise<void>[] = manifest.layers.map(layer => {
    switch (layer.mediaType) {
      case 'application/vnd.github.actions.package.layer.v1.tar+gzip':
        return uploadLayer(
          layer,
          tarFile,
          registry,
          checkBlobEndpoint,
          uploadBlobEndpoint,
          b64Token
        )
      case 'application/vnd.github.actions.package.layer.v1.zip':
        return uploadLayer(
          layer,
          zipFile,
          registry,
          checkBlobEndpoint,
          uploadBlobEndpoint,
          b64Token
        )
      case 'application/vnd.github.actions.package.config.v1+json':
        return uploadLayer(
          layer,
          { path: '', size: 0, sha256: layer.digest },
          registry,
          checkBlobEndpoint,
          uploadBlobEndpoint,
          b64Token
        )
      default:
        throw new Error(`Unknown media type ${layer.mediaType}`)
    }
  })

  await Promise.all(layerUploads)

  await uploadManifest(JSON.stringify(manifest), manifestEndpoint, b64Token)

  return new URL(`${repository}:${semver}`, registry)
}

async function uploadLayer(
  layer: ociContainer.Layer,
  file: FileMetadata,
  registryURL: URL,
  checkBlobEndpoint: string,
  uploadBlobEndpoint: string,
  b64Token: string
): Promise<void> {
  const checkExistsResponse = await axios.head(
    checkBlobEndpoint + layer.digest,
    {
      headers: {
        Authorization: `Bearer ${b64Token}`
      },
      validateStatus: function (status: number) {
        return true // Allow non 2xx responses
      }
    }
  )

  if (
    checkExistsResponse.status === 200 ||
    checkExistsResponse.status === 202
  ) {
    core.info(`Layer ${layer.digest} already exists. Skipping upload.`)
    return
  }

  if (checkExistsResponse.status !== 404) {
    throw new Error(
      `Unexpected response from blob check for layer ${layer.digest}: ${checkExistsResponse.status} ${checkExistsResponse.statusText}`
    )
  }

  core.info(`Uploading layer ${layer.digest}.`)

  const initiateUploadResponse = await axios.post(uploadBlobEndpoint, layer, {
    headers: {
      Authorization: `Bearer ${b64Token}`
    },
    validateStatus: function (status: number) {
      return true // Allow non 2xx responses
    }
  })

  if (initiateUploadResponse.status != 202) {
    core.error(
      `Unexpected response from upload post ${uploadBlobEndpoint}: ${initiateUploadResponse.status}`
    )
    throw new Error(
      `Unexpected response from POST upload ${initiateUploadResponse.status}`
    )
  }

  const locationResponseHeader = initiateUploadResponse.headers['location']
  if (locationResponseHeader == undefined) {
    throw new Error(
      `No location header in response from upload post ${uploadBlobEndpoint} for layer ${layer.digest}`
    )
  }

  let pathname = (locationResponseHeader as string) + '?digest=' + layer.digest
  const uploadBlobUrl = new URL(pathname, registryURL).toString()

  // TODO: must we handle the empty config layer? Maybe we can just skip calling this at all
  var data: Buffer
  if (file.size === 0) {
    data = Buffer.alloc(0)
  } else {
    data = fsHelper.readFileContents(file.path)
  }

  const putResponse = await axios.put(uploadBlobUrl, data, {
    headers: {
      Authorization: `Bearer ${b64Token}`,
      'Content-Type': 'application/octet-stream',
      'Accept-Encoding': 'gzip', // TODO: What about for the config layer?
      'Content-Length': layer.size.toString()
    },
    validateStatus: function (status: number) {
      return true // Allow non 2xx responses
    }
  })

  if (putResponse.status != 201) {
    throw new Error(
      `Unexpected response from PUT upload ${putResponse.status} for layer ${layer.digest}`
    )
  }
}

async function uploadManifest(
  manifestJSON: string,
  manifestEndpoint: string,
  b64Token: string
): Promise<void> {
  core.info(`Uploading manifest to ${manifestEndpoint}.`)

  const putResponse = await axios.put(manifestEndpoint, manifestJSON, {
    headers: {
      Authorization: `Bearer ${b64Token}`,
      'Content-Type': 'application/vnd.oci.image.manifest.v1+json'
    },
    validateStatus: function (status: number) {
      return true // Allow non 2xx responses
    }
  })

  if (putResponse.status != 201) {
    throw new Error(
      `Unexpected response from PUT manifest ${putResponse.status}`
    )
  }
}

function configureRequestDebugLogging() {
  axiosDebugLog({
    request: function (debug, config) {
      core.debug(`Request with ${config}`)
    },
    response: function (debug, response) {
      core.debug(`Response with ${response}`)
    },
    error: function (debug, error) {
      core.debug(`Error with ${error}`)
    }
  })
}
