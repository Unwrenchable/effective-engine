'use strict';

/**
 * Media pipeline: download listing photos from the MLS photo server
 * and re-host them on Cloudflare R2 or AWS S3.
 *
 * Benefits:
 *  - Eliminates dependency on MLS photo CDN (no broken images if they change URLs)
 *  - Enables AI photo analysis at ingest time
 *  - Reduces browser latency via your own CDN
 *
 * Set CDN_PROVIDER=r2 (default) or CDN_PROVIDER=s3 in environment.
 */

const { createHash }  = require('crypto');
const config          = require('../config');

// ─── S3-compatible client factory (R2 and S3 use same API) ───────────────────

let _s3 = null;

function getS3Client() {
  if (_s3) return _s3;

  // Use the AWS SDK v3 S3Client — works for both R2 and S3
  // (The AWS SDK is NOT in package.json by default; install with: npm i @aws-sdk/client-s3)
  // This is optional — if unavailable the pipeline will skip CDN upload and use original URLs.
  try {
    const { S3Client } = require('@aws-sdk/client-s3');

    const isR2 = config.cdn.provider === 'r2';

    if (isR2) {
      _s3 = new S3Client({
        region: 'auto',
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
    return null;  // SDK not installed — skip CDN upload
  }
}

// ─── Upload a single photo ────────────────────────────────────────────────────

/**
 * Download a photo from sourceUrl and upload it to your CDN.
 * Returns the CDN URL; falls back to sourceUrl if upload fails.
 *
 * @param {string} sourceUrl   original MLS photo URL
 * @param {string} listingId   used to organise keys in the bucket
 * @param {number} [order]     photo order index
 * @returns {Promise<string>}  CDN URL or original URL
 */
async function uploadPhoto(sourceUrl, listingId, order = 0) {
  const s3 = getS3Client();
  if (!s3 || !config.cdn.publicUrl) {
    return sourceUrl;  // CDN not configured — use original URL
  }

  try {
    // Download the photo
    const resp = await fetch(sourceUrl, { signal: AbortSignal.timeout(15_000) });
    if (!resp.ok) return sourceUrl;

    const contentType = resp.headers.get('content-type') || 'image/jpeg';
    const buffer      = Buffer.from(await resp.arrayBuffer());

    // Deterministic key: hash of the source URL so the same photo isn't re-uploaded
    const hash = createHash('sha256').update(sourceUrl).digest('hex').slice(0, 16);
    const ext  = contentType.includes('png') ? 'png' : 'jpg';
    const key  = `listings/${listingId}/${order}-${hash}.${ext}`;

    const { PutObjectCommand } = require('@aws-sdk/client-s3');
    await s3.send(new PutObjectCommand({
      Bucket:      config.cdn.provider === 'r2' ? config.cdn.r2.bucket : config.cdn.s3.bucket,
      Key:         key,
      Body:        buffer,
      ContentType: contentType,
      CacheControl: 'public, max-age=31536000, immutable',
    }));

    return `${config.cdn.publicUrl}/${key}`;
  } catch (err) {
    console.warn(`[media] Upload failed for ${sourceUrl}:`, err.message);
    return sourceUrl;
  }
}

/**
 * Upload all photos for a listing, returning an updated media array with CDN URLs.
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
      : item.url;  // videos: keep original URL for now

    results.push({ ...item, cdnUrl });
  }

  return results;
}

module.exports = { uploadPhoto, uploadListingMedia };
