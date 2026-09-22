// S3 uploads for the document library, tire photos, registrations, resumes…
// The browser never holds AWS keys: it hands the file to the worker (see
// worker/), which signs the request with keys kept as Worker secrets and puts
// the object in the bucket. Public URLs are unchanged.

import { apiFetch, hasSession } from './api.js';

export const S3_BUCKET = 'rohrman-hyundai-files';
export const S3_REGION = 'us-east-2';
export const S3_DOCS_PREFIX = 'pdf-reports/';

const publicUrl = (key) => `https://${S3_BUCKET}.s3.${S3_REGION}.amazonaws.com/${key}`;

// "Can this device upload?" — it can whenever it is signed in.
export async function ensureAwsCreds() {
  return hasSession();
}

function contentTypeFor(filename) {
  const ext = filename.toLowerCase().split('.').pop();
  if (ext === 'pdf')  return 'application/pdf';
  if (ext === 'doc')  return 'application/msword';
  if (ext === 'docx') return 'application/vnd.openxmlformats-officedocument.wordprocessingml.document';
  return 'application/octet-stream';
}

async function putObject(key, file, contentType) {
  const res = await apiFetch(`/s3/object?key=${encodeURIComponent(key)}`, {
    method: 'PUT',
    headers: { 'Content-Type': contentType || 'application/octet-stream', 'X-Content-Disposition': 'inline' },
    body: file,
  });
  if (!res.ok) {
    let msg = `Upload failed (${res.status})`;
    try { const j = await res.json(); if (j && j.error) msg = j.error; } catch {}
    throw new Error(msg);
  }
  return publicUrl(key);
}

async function deleteObject(key) {
  const res = await apiFetch(`/s3/object?key=${encodeURIComponent(key)}`, { method: 'DELETE' });
  if (!res.ok) {
    let msg = `Delete failed (${res.status})`;
    try { const j = await res.json(); if (j && j.error) msg = j.error; } catch {}
    throw new Error(msg);
  }
}

export async function uploadFileToS3(filename, file) {
  await putObject(S3_DOCS_PREFIX + filename, file, contentTypeFor(filename));
}

// Upload a tire warranty photo. Returns the public URL of the stored object.
export function uploadTirePhotoToS3(filename, file) {
  return putObject('tire-photos/' + filename, file, file.type || contentTypeFor(filename));
}

// Upload a warranty additional-time screenshot (the tech's Techline call).
// Returns the public URL of the stored object.
export function uploadAdditionalTimePhotoToS3(filename, file) {
  return putObject('additional-time/' + filename, file, file.type || contentTypeFor(filename));
}

// Upload a vehicle registration photo. Returns the public URL of the stored
// object. The submitter never sees it again — only the Warranty Hub reads
// these back — so the key is opaque rather than named after the RO.
export function uploadRegistrationPhotoToS3(filename, file) {
  return putObject('registrations/' + filename, file, file.type || contentTypeFor(filename));
}

// Upload a tire promotion image. Returns the public URL of the stored object —
// the promo index stores that URL and the page renders it directly.
export function uploadTirePromoToS3(filename, file) {
  return putObject('tire-promos/' + filename, file, file.type || contentTypeFor(filename));
}

// Upload an applicant's resume. The key is deliberately opaque — an applicant's
// name has no business being guessable in a URL.
export function uploadResumeToS3(filename, file) {
  return putObject('applicant-resumes/' + filename, file, file.type || contentTypeFor(filename));
}

// Delete by full public URL — the registration index stores URLs, not keys.
export async function deleteS3ObjectByUrl(url) {
  const prefix = publicUrl('');
  if (!url || !url.startsWith(prefix)) return false;
  await deleteObject(url.slice(prefix.length));
  return true;
}

export async function deleteFileFromS3(filename) {
  await deleteObject(S3_DOCS_PREFIX + filename);
}
