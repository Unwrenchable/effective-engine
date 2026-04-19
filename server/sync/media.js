'use strict';

/**
 * Media pipeline: download listing photos from the MLS photo server
 * and re-host them on local disk (default), MinIO, Cloudflare R2, or AWS S3.
 *
 * CDN_PROVIDER controls the storage backend:
 *   local  (default) — saves to MEDIA_LOCAL_PATH, served by Fastify static plugin
 *   minio            — self-hosted S3-compatible server (set MINIO_ENDPOINT)
 *   r2               — Cloudflare R2
 *   s3               — AWS S3
 *
 * MinIO quick-start:
 *   docker run -p 9000:9000 -p 9001:9001 \
 *     -e MINIO_ROOT_USER=admin -e MINIO_ROOT_PASSWORD=password \
 *     quay.io/minio/minio server /data --console-address ":9001"
 */

const { createHash }  = require('crypto');
const fs              = require('fs');
const path            = require('path');
const config          = require('../config');

// ─── Local disk storage ───────────────────────────────────────────────────────

/**
 * Save a photo to the local filesystem.
 * Returns the public URL path; falls back to sourceUrl on error.
 */
async function uploadPhotoLocal(sourceUrl, listingId, order = 0) {
  try {
    const resp = await fetch(sourceUrl, { signal: AbortSignal.timeout(15_000) });
    if (!resp.ok) return sourceUrl;

    const contentType = resp.headers.get('content-type') || 'image/jpeg';
    const buffer      = Buffer.from(await resp.arrayBuffer());

    const hash    = createHash('sha256').update(sourceUrl).digest('hex').slice(0, 16);
    const ext     = contentType.includes('png') ? 'png' : 'jpg';
    const relPath = `listings/${listingId}/${order}-${hash}.${ext}`;
    const absDir  = path.join(config.cdn.localPath, 'listings', listingId);
    const absFile = path.join(config.cdn.localPath, relPath);

    fs.mkdirSync(absDir, { recursive: true });
    fs.writeFileSync(absFile, buffer);

    return `${config.cdn.localPublicUrl}/${relPath}`;
  } catch (err) {
    console.warn(`[media] Local save failed for ${sourceUrl}:`, err.message);
    return sourceUrl;
  }
}

// ─── S3-compatible client factory (MinIO, R2, S3) ────────────────────────────

let _s3 = null;

function getS3Client() {
  if (_s3) return _s3;

  try {
    const { S3Client } = require('@aws-sdk/client-s3');
    const provider = config.cdn.provider;

    if (provider === 'minio') {
      _s3 = new S3Client({
        region:   'us-east-1',  // MinIO ignores region but SDK requires it
        endpoint: config.cdn.minio.endpoint,
        forcePathStyle: true,   // required for MinIO
        credentials: {
          accessKeyId:     config.cdn.minio.accessKey,
          secretAccessKey: config.cdn.minio.secretKey,
        },
      });
    } else if (provider === 'r2') {
      _s3 = new S3Client({
        region:   'auto',
        endpoint: `https://${config.cdn.r2.accountId}.r2.cloudflarestorage.com`,
        credentials: {
          accessKeyId:     config.cdn.r2.accessKey,
          secretAccessKey: config.cdn.r2.secretKey,
        },
      });
    } else {
      _s3 = new S3Client({
        region: config.cdn.s3.region,
        credentials: {
          accessKeyId:     config.cdn.s3.accessKey,
          secretAccessKey: config.cdn.s3.secretKey,
        },
      });
    }
    return _s3;
  } catch {
    return null;
  }
}

function getS3Bucket() {
  const provider = config.cdn.provider;
  if (provider === 'minio') return config.cdn.minio.bucket;
  if (provider === 'r2')    return config.cdn.r2.bucket;
  return config.cdn.s3.bucket;
}

function getS3PublicUrl() {
  const provider = config.cdn.provider;
  if (provider === 'minio') return config.cdn.minio.publicUrl || config.cdn.minio.endpoint;
  if (provider === 'r2')    return config.cdn.r2.publicUrl;
  return config.cdn.s3.publicUrl;
}

// ─── S3-compatible upload ─────────────────────────────────────────────────────

async function uploadPhotoS3(sourceUrl, listingId, order = 0) {
  const s3        = getS3Client();
  const publicUrl = getS3PublicUrl();
  if (!s3 || !publicUrl) return sourceUrl;

  try {
    const resp = await fetch(sourceUrl, { signal: AbortSignal.timeout(15_000) });
    if (!resp.ok) return sourceUrl;

    const contentType = resp.headers.get('content-type') || 'image/jpeg';
    const buffer      = Buffer.from(await resp.arrayBuffer());

    const hash = createHash('sha256').update(sourceUrl).digest('hex').slice(0, 16);
    const ext  = contentType.includes('png') ? 'png' : 'jpg';
    const key  = `listings/${listingId}/${order}-${hash}.${ext}`;

    const { PutObjectCommand } = require('@aws-sdk/client-s3');
    await s3.send(new PutObjectCommand({
      Bucket:       getS3Bucket(),
      Key:          key,
      Body:         buffer,
      ContentType:  contentType,
      CacheControl: 'public, max-age=31536000, immutable',
    }));

    return `${publicUrl}/${key}`;
  } catch (err) {
    console.warn(`[media] S3 upload failed for ${sourceUrl}:`, err.message);
    return sourceUrl;
  }
}

// ─── Public API ───────────────────────────────────────────────────────────────

/**
 * Download a photo from sourceUrl and store it in the configured backend.
 * Returns the stored URL; falls back to sourceUrl if storage fails.
 *
 * @param {string} sourceUrl   original MLS photo URL
 * @param {string} listingId   used to organise storage keys
 * @param {number} [order]     photo order index
 * @returns {Promise<string>}  stored URL or original URL
 */
async function uploadPhoto(sourceUrl, listingId, order = 0) {
  const provider = config.cdn.provider;

  if (provider === 'local') {
    return uploadPhotoLocal(sourceUrl, listingId, order);
  }

  // minio / r2 / s3 — all use the S3 client
  return uploadPhotoS3(sourceUrl, listingId, order);
}

/**
 * Upload all photos for a listing, returning an updated media array with stored URLs.
 *
 * @param {string}   listingId
 * @param {object[]} mediaItems  [{url, mediaType, order, caption}]
 * @returns {Promise<object[]>}  same array with cdnUrl set
 */
async function uploadListingMedia(listingId, mediaItems) {
  const results = [];

  for (const item of mediaItems) {
    const cdnUrl = item.mediaType === 'photo'
      ? await uploadPhoto(item.url, listingId, item.order)
      : item.url;  // videos: keep original URL

    results.push({ ...item, cdnUrl });
  }

  return results;
}

module.exports = { uploadPhoto, uploadListingMedia };
