// Downscale a phone camera photo before upload. Modern Android cameras hand
// back 10–25 MB images, which are slow to push over shop Wi-Fi and can run past
// the worker's upload cap. Anything already small, or anything the browser
// can't decode (e.g. HEIC on some devices), is returned untouched.
const MAX_DIM = 2560;
const SKIP_BELOW = 1.5 * 1024 * 1024;

async function decode(file) {
  if (typeof createImageBitmap === 'function') {
    try { return await createImageBitmap(file, { imageOrientation: 'from-image' }); } catch { /* fall through */ }
  }
  const url = URL.createObjectURL(file);
  try {
    const img = new Image();
    img.src = url;
    await img.decode();
    return img;
  } finally {
    URL.revokeObjectURL(url);
  }
}

export async function shrinkImage(file) {
  if (!file || file.size < SKIP_BELOW) return file;
  try {
    const src = await decode(file);
    const w = src.width, h = src.height;
    const scale = Math.min(1, MAX_DIM / Math.max(w, h));
    const canvas = document.createElement('canvas');
    canvas.width = Math.round(w * scale);
    canvas.height = Math.round(h * scale);
    canvas.getContext('2d').drawImage(src, 0, 0, canvas.width, canvas.height);
    if (src.close) src.close();
    const blob = await new Promise(r => canvas.toBlob(r, 'image/jpeg', 0.85));
    canvas.width = canvas.height = 0; // release the bitmap memory right away
    if (!blob || blob.size >= file.size) return file;
    const name = (file.name || 'photo').replace(/\.[^.]+$/, '') + '.jpg';
    return new File([blob], name, { type: 'image/jpeg' });
  } catch {
    return file;
  }
}
