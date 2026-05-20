// One-time migration: upload existing PDFs from public/data/documents/ to S3.
// Usage:  node scripts/migrate-pdfs-to-s3.mjs
// Requires .env with AWS_ACCESS_KEY_ID, AWS_SECRET_ACCESS_KEY, AWS_REGION, AWS_S3_BUCKET

import 'dotenv/config';
import { readFileSync, readdirSync, statSync } from 'node:fs';
import path from 'node:path';
import { S3Client, PutObjectCommand, HeadObjectCommand } from '@aws-sdk/client-s3';

const {
  AWS_ACCESS_KEY_ID,
  AWS_SECRET_ACCESS_KEY,
  AWS_REGION,
  AWS_S3_BUCKET,
} = process.env;

for (const [k, v] of Object.entries({ AWS_ACCESS_KEY_ID, AWS_SECRET_ACCESS_KEY, AWS_REGION, AWS_S3_BUCKET })) {
  if (!v) { console.error(`Missing env var: ${k}`); process.exit(1); }
}

const S3_PREFIX = 'pdf-reports/';
const LOCAL_DIR = path.resolve('public/data/documents');

const s3 = new S3Client({
  region: AWS_REGION,
  credentials: { accessKeyId: AWS_ACCESS_KEY_ID, secretAccessKey: AWS_SECRET_ACCESS_KEY },
});

function contentTypeFor(filename) {
  const ext = filename.toLowerCase().split('.').pop();
  if (ext === 'pdf')  return 'application/pdf';
  if (ext === 'doc')  return 'application/msword';
  if (ext === 'docx') return 'application/vnd.openxmlformats-officedocument.wordprocessingml.document';
  return 'application/octet-stream';
}

async function existsInS3(key) {
  try {
    await s3.send(new HeadObjectCommand({ Bucket: AWS_S3_BUCKET, Key: key }));
    return true;
  } catch { return false; }
}

async function main() {
  console.log(`Reading: ${LOCAL_DIR}`);
  const entries = readdirSync(LOCAL_DIR).filter(f => {
    if (f === 'index.json') return false;
    const full = path.join(LOCAL_DIR, f);
    if (!statSync(full).isFile()) return false;
    return /\.(pdf|docx?|)$/i.test(f);
  });

  console.log(`Found ${entries.length} file(s) to migrate.`);
  let uploaded = 0, skipped = 0, failed = 0;

  for (const filename of entries) {
    const key  = S3_PREFIX + filename;
    const full = path.join(LOCAL_DIR, filename);
    process.stdout.write(`  ${filename} ... `);

    if (await existsInS3(key)) {
      console.log('already in S3, skipping');
      skipped++;
      continue;
    }

    try {
      const body = readFileSync(full);
      await s3.send(new PutObjectCommand({
        Bucket: AWS_S3_BUCKET,
        Key: key,
        Body: body,
        ContentType: contentTypeFor(filename),
        ContentDisposition: 'inline',
      }));
      console.log('OK');
      uploaded++;
    } catch (err) {
      console.log(`FAIL: ${err.message}`);
      failed++;
    }
  }

  console.log(`\nDone. uploaded=${uploaded}  skipped=${skipped}  failed=${failed}`);
  console.log(`\nPublic URL pattern:`);
  console.log(`  https://${AWS_S3_BUCKET}.s3.${AWS_REGION}.amazonaws.com/${S3_PREFIX}<filename>`);
}

main().catch(err => { console.error(err); process.exit(1); });
