// Browser-side S3 helpers for the document library.
// AWS keys are stored in localStorage (admin enters them once, per device).
// IAM policy is scoped to a single bucket so blast radius is small.

import { S3Client, PutObjectCommand, DeleteObjectCommand } from '@aws-sdk/client-s3';

export const S3_BUCKET = 'rohrman-hyundai-files';
export const S3_REGION = 'us-east-2';
export const S3_DOCS_PREFIX = 'pdf-reports/';

const KEY_ID  = 'rohrmanAwsAccessKeyId';
const KEY_SEC = 'rohrmanAwsSecretAccessKey';

export function getAwsCreds() {
  const accessKeyId     = localStorage.getItem(KEY_ID)  || '';
  const secretAccessKey = localStorage.getItem(KEY_SEC) || '';
  return { accessKeyId, secretAccessKey };
}

export function setAwsCreds(accessKeyId, secretAccessKey) {
  localStorage.setItem(KEY_ID,  accessKeyId.trim());
  localStorage.setItem(KEY_SEC, secretAccessKey.trim());
}

export function clearAwsCreds() {
  localStorage.removeItem(KEY_ID);
  localStorage.removeItem(KEY_SEC);
}

export async function ensureAwsCreds() {
  let { accessKeyId, secretAccessKey } = getAwsCreds();
  if (accessKeyId && secretAccessKey) return true;
  // Try to fetch shared creds from users.json (set by admin in AdminPanel > AWS Settings)
  try {
    const { loadUsers } = await import('./github.js');
    const result = await loadUsers();
    if (result?.awsAccessKeyId && result?.awsSecretAccessKey) {
      setAwsCreds(result.awsAccessKeyId, result.awsSecretAccessKey);
      return true;
    }
  } catch {}
  // Last resort: prompt this device
  const id  = prompt('AWS upload setup (one-time).\n\nEnter the AWS Access Key ID:');
  if (!id) return false;
  const sec = prompt('Enter the AWS Secret Access Key:');
  if (!sec) return false;
  setAwsCreds(id, sec);
  return true;
}

function s3Client() {
  const { accessKeyId, secretAccessKey } = getAwsCreds();
  if (!accessKeyId || !secretAccessKey) throw new Error('Missing AWS credentials');
  return new S3Client({
    region: S3_REGION,
    credentials: { accessKeyId, secretAccessKey },
  });
}

function contentTypeFor(filename) {
  const ext = filename.toLowerCase().split('.').pop();
  if (ext === 'pdf')  return 'application/pdf';
  if (ext === 'doc')  return 'application/msword';
  if (ext === 'docx') return 'application/vnd.openxmlformats-officedocument.wordprocessingml.document';
  return 'application/octet-stream';
}

export async function uploadFileToS3(filename, file) {
  const client = s3Client();
  const body = new Uint8Array(await file.arrayBuffer());
  await client.send(new PutObjectCommand({
    Bucket: S3_BUCKET,
    Key: S3_DOCS_PREFIX + filename,
    Body: body,
    ContentType: contentTypeFor(filename),
    ContentDisposition: 'inline',
  }));
}

// Upload a tire warranty photo. Returns the public URL of the stored object.
export async function uploadTirePhotoToS3(filename, file) {
  const client = s3Client();
  const key = 'tire-photos/' + filename;
  const body = new Uint8Array(await file.arrayBuffer());
  await client.send(new PutObjectCommand({
    Bucket: S3_BUCKET,
    Key: key,
    Body: body,
    ContentType: file.type || contentTypeFor(filename),
    ContentDisposition: 'inline',
  }));
  return `https://${S3_BUCKET}.s3.${S3_REGION}.amazonaws.com/${key}`;
}

export async function deleteFileFromS3(filename) {
  const client = s3Client();
  await client.send(new DeleteObjectCommand({
    Bucket: S3_BUCKET,
    Key: S3_DOCS_PREFIX + filename,
  }));
}
