import React, { useEffect, useRef, useState } from 'react';
import { openaiRequest } from '../utils/openai';

// Full-screen VIN barcode scanner (phone). Opens the back camera in the page
// and reads the VIN barcode on the door-jamb / windshield sticker — Code 39,
// Code 128, Data Matrix or QR — held either way up: the door-jamb barcode runs
// up and down, so every frame is read as-is AND turned 90°, and the guide box
// follows the phone (tall in portrait, wide in landscape). Only the guide box
// is read, at the camera's full resolution, which is what makes the thin bars
// readable. The browser's own BarcodeDetector is used where there is one
// (Android Chrome), ZXing (CDN, loaded on first use) everywhere — iPhone Safari
// has no BarcodeDetector. A read only counts when it is a 17-character VIN with
// the right check digit, so a half-read barcode never fills in a wrong VIN.
//
// 📸 Snap the sticker: a full-quality photo from the phone camera; the barcode
// is read from that, and if it can't be, the AI reader reads the VIN printed
// under it (still check-digit verified). onScan(vin) then closes the scanner.

const ZXING_SRC = 'https://cdn.jsdelivr.net/npm/@zxing/library@0.21.3/umd/index.min.js';
let zxingPromise = null;
function loadZxing() {
  if (window.ZXing) return Promise.resolve(window.ZXing);
  if (!zxingPromise) {
    zxingPromise = new Promise((resolve, reject) => {
      const s = document.createElement('script');
      s.src = ZXING_SRC;
      s.onload = () => (window.ZXing ? resolve(window.ZXing) : reject(new Error('Scanner did not load.')));
      s.onerror = () => { zxingPromise = null; reject(new Error('Could not load the scanner — check the connection.')); };
      document.head.appendChild(s);
    });
  }
  return zxingPromise;
}

// VIN check digit (position 9) — North American VINs, which every Hyundai here is.
const TRANSLIT = { A: 1, B: 2, C: 3, D: 4, E: 5, F: 6, G: 7, H: 8, J: 1, K: 2, L: 3, M: 4, N: 5, P: 7, R: 9, S: 2, T: 3, U: 4, V: 5, W: 6, X: 7, Y: 8, Z: 9 };
const WEIGHTS = [8, 7, 6, 5, 4, 3, 2, 10, 0, 9, 8, 7, 6, 5, 4, 3, 2];
export function vinCheckOk(vin) {
  if (!/^[A-HJ-NPR-Z0-9]{17}$/.test(vin)) return false;
  let sum = 0;
  for (let i = 0; i < 17; i++) {
    const c = vin[i];
    sum += (/\d/.test(c) ? Number(c) : TRANSLIT[c]) * WEIGHTS[i];
  }
  const r = sum % 11;
  return vin[8] === (r === 10 ? 'X' : String(r));
}
// Barcode text → VIN, or ''. Door-jamb Code 39 often carries a leading "I"
// (import marker); QR stickers can hold more text — take any valid 17-run.
export function vinFromBarcode(text) {
  const t = String(text || '').toUpperCase().replace(/[^A-Z0-9]/g, '');
  for (let i = 0; i + 17 <= t.length; i++) {
    const v = t.slice(i, i + 17);
    if (vinCheckOk(v)) return v;
  }
  return '';
}

// ZXing reader for one canvas → text or ''.
function makeZxDecoder(ZX) {
  const hints = new Map();
  hints.set(ZX.DecodeHintType.POSSIBLE_FORMATS, [ZX.BarcodeFormat.CODE_39, ZX.BarcodeFormat.CODE_128, ZX.BarcodeFormat.DATA_MATRIX, ZX.BarcodeFormat.QR_CODE]);
  hints.set(ZX.DecodeHintType.TRY_HARDER, true);
  const reader = new ZX.MultiFormatReader();
  reader.setHints(hints);
  return (canvas) => {
    try { return reader.decode(new ZX.BinaryBitmap(new ZX.HybridBinarizer(new ZX.HTMLCanvasElementLuminanceSource(canvas)))).getText(); }
    catch { return ''; }
  };
}
// Draw (part of) a video/image onto a canvas, optionally turned 90°, capped at `max` px on the long side.
function drawTo(canvas, src, sx, sy, sw, sh, rotate, max = 2400) {
  const k = Math.min(1, max / Math.max(sw, sh));
  const w = Math.round(sw * k), h = Math.round(sh * k);
  canvas.width = rotate ? h : w; canvas.height = rotate ? w : h;
  const g = canvas.getContext('2d', { willReadFrequently: true });
  g.save();
  if (rotate) { g.translate(h, 0); g.rotate(Math.PI / 2); }
  g.drawImage(src, sx, sy, sw, sh, 0, 0, w, h);
  g.restore();
  return canvas;
}

// A still photo → VIN: barcode first (whole photo and the middle, both ways up),
// then the AI reader on the printed text. Throws when neither finds a valid VIN.
export async function vinFromPhoto(file) {
  const url = URL.createObjectURL(file);
  try {
    const img = new Image();
    await new Promise((resolve, reject) => { img.onload = resolve; img.onerror = () => reject(new Error("Couldn't open that photo.")); img.src = url; });
    const W = img.naturalWidth, H = img.naturalHeight;
    const ZX = await loadZxing().catch(() => null);
    if (ZX) {
      const dec = makeZxDecoder(ZX);
      const c = document.createElement('canvas');
      const regions = [[0, 0, W, H], [W * 0.2, H * 0.1, W * 0.6, H * 0.8], [W * 0.3, H * 0.2, W * 0.4, H * 0.6]];
      for (const [x, y, w, h] of regions) {
        for (const rot of [false, true]) {
          const v = vinFromBarcode(dec(drawTo(c, img, x, y, w, h, rot, 3000)));
          if (v) return v;
        }
      }
    }
    // AI read of the printed VIN (photo shrunk to keep the request small).
    const c = drawTo(document.createElement('canvas'), img, 0, 0, W, H, false, 1600);
    const dataUrl = c.toDataURL('image/jpeg', 0.85);
    const res = await openaiRequest({
      method: 'POST',
      body: JSON.stringify({
        model: 'gpt-4o', temperature: 0, max_tokens: 60,
        messages: [{ role: 'user', content: [
          { type: 'text', text: 'This is a vehicle label (door-jamb or windshield sticker). Read the 17-character VIN printed on it (often after "V.I.N"). The image may be rotated. VINs never contain I, O or Q. Reply with ONLY JSON: {"vin":"..."} — use "" if you cannot read it.' },
          { type: 'image_url', image_url: { url: dataUrl, detail: 'high' } },
        ] }],
      }),
    });
    if (!res.ok) throw new Error("Couldn't read the sticker — type the stock # instead.");
    const data = await res.json();
    const text = String(data.choices?.[0]?.message?.content || '');
    let vin = '';
    try { vin = String(JSON.parse(text.replace(/^```(?:json)?\s*/i, '').replace(/```\s*$/, '')).vin || ''); } catch { vin = text; }
    const ok = vinFromBarcode(vin);
    if (ok) return ok;
    throw new Error("Couldn't read the VIN in that photo — try again closer and straight on, or type the stock #.");
  } finally {
    URL.revokeObjectURL(url);
  }
}

export default function VinScanner({ onScan, onCancel }) {
  const videoRef = useRef(null);
  const streamRef = useRef(null);
  const doneRef = useRef(false);
  const photoRef = useRef(null);
  const [error, setError] = useState('');
  const [ready, setReady] = useState(false);
  const [torch, setTorch] = useState(null);   // null = no torch on this camera
  const [zoom, setZoom] = useState(null);     // null = no zoom; else { min, max, val }
  const [landscape, setLandscape] = useState(() => window.innerWidth > window.innerHeight);
  const [photoBusy, setPhotoBusy] = useState(false);
  const landscapeRef = useRef(landscape);

  useEffect(() => {
    const onTurn = () => { const l = window.innerWidth > window.innerHeight; landscapeRef.current = l; setLandscape(l); };
    window.addEventListener('resize', onTurn);
    window.addEventListener('orientationchange', onTurn);
    return () => { window.removeEventListener('resize', onTurn); window.removeEventListener('orientationchange', onTurn); };
  }, []);

  const finish = (vin) => {
    if (doneRef.current) return;
    doneRef.current = true;
    try { navigator.vibrate && navigator.vibrate(120); } catch {}
    onScan(vin);
  };

  useEffect(() => {
    let cancelled = false;
    let timer = null;
    (async () => {
      try {
        const stream = await navigator.mediaDevices.getUserMedia({
          audio: false, video: { facingMode: { ideal: 'environment' }, width: { ideal: 3840 }, height: { ideal: 2160 } },
        });
        if (cancelled) { stream.getTracks().forEach(t => t.stop()); return; }
        streamRef.current = stream;
        const video = videoRef.current;
        video.srcObject = stream;
        await video.play().catch(() => {});
        const track = stream.getVideoTracks()[0];
        const caps = track?.getCapabilities?.() || {};
        if (caps.torch) setTorch(false);
        if (caps.focusMode && caps.focusMode.includes('continuous')) track.applyConstraints({ advanced: [{ focusMode: 'continuous' }] }).catch(() => {});
        if (caps.zoom && caps.zoom.max > 1) setZoom({ min: caps.zoom.min || 1, max: caps.zoom.max, val: track.getSettings?.().zoom || caps.zoom.min || 1 });
        setReady(true);

        let native = null;
        if ('BarcodeDetector' in window) {
          try {
            const have = await window.BarcodeDetector.getSupportedFormats();
            const want = ['code_39', 'code_128', 'data_matrix', 'qr_code'].filter(f => have.includes(f));
            if (want.length) native = new window.BarcodeDetector({ formats: want });
          } catch {}
        }
        const ZX = await loadZxing().catch(() => null);
        const zx = ZX ? makeZxDecoder(ZX) : null;
        if (!native && !zx) throw new Error('Could not load the scanner — check the connection, or use 📸 Snap the sticker.');
        const canvas = document.createElement('canvas');
        let frame = 0;
        const tick = async () => {
          if (cancelled || doneRef.current) return;
          const vw = video.videoWidth, vh = video.videoHeight;
          if (vw && vh) {
            // The guide box in frame pixels (the video fills the screen, 'cover').
            const ew = video.clientWidth, eh = video.clientHeight;
            const s = Math.max(ew / vw, eh / vh);
            const visW = ew / s, visH = eh / s, offX = (vw - visW) / 2, offY = (vh - visH) / 2;
            const g = landscapeRef.current ? { x: 0.05, y: 0.3, w: 0.9, h: 0.4 } : { x: 0.25, y: 0.08, w: 0.5, h: 0.84 };
            const sx = offX + g.x * visW, sy = offY + g.y * visH, sw = g.w * visW, sh = g.h * visH;
            try {
              if (native) {
                for (const b of await native.detect(drawTo(canvas, video, sx, sy, sw, sh, false))) {
                  const v = vinFromBarcode(b.rawValue);
                  if (v) { finish(v); return; }
                }
              }
              if (zx) {
                // Bars run up and down on the door jamb: alternate as-is / turned 90°.
                const v = vinFromBarcode(zx(drawTo(canvas, video, sx, sy, sw, sh, frame % 2 === 1)));
                if (v) { finish(v); return; }
              }
            } catch {}
            frame++;
          }
          timer = setTimeout(tick, 120);
        };
        tick();
      } catch (err) {
        if (cancelled) return;
        setError(err?.name === 'NotAllowedError'
          ? 'Camera permission is blocked for this site. Allow it in the browser settings, use 📸 Snap the sticker, or type the stock #.'
          : (err?.message && /scanner/i.test(err.message) ? err.message : 'Could not open the camera here. Use 📸 Snap the sticker, or type the stock #.'));
      }
    })();
    return () => {
      cancelled = true;
      clearTimeout(timer);
      streamRef.current?.getTracks().forEach(t => t.stop());
      streamRef.current = null;
    };
  }, []); // eslint-disable-line react-hooks/exhaustive-deps

  async function toggleTorch() {
    const track = streamRef.current?.getVideoTracks()[0];
    if (!track) return;
    try { await track.applyConstraints({ advanced: [{ torch: !torch }] }); setTorch(!torch); } catch {}
  }
  async function cycleZoom() {
    const track = streamRef.current?.getVideoTracks()[0];
    if (!track || !zoom) return;
    const steps = [zoom.min, 2, 3].filter((z, i, a) => z >= zoom.min && z <= zoom.max && a.indexOf(z) === i);
    const next = steps[(steps.findIndex(z => Math.abs(z - zoom.val) < 0.1) + 1) % steps.length] ?? zoom.min;
    try { await track.applyConstraints({ advanced: [{ zoom: next }] }); setZoom(z => ({ ...z, val: next })); } catch {}
  }
  async function onPhoto(e) {
    const file = e.target.files && e.target.files[0];
    e.target.value = '';
    if (!file) return;
    setPhotoBusy(true); setError('');
    try { finish(await vinFromPhoto(file)); }
    catch (err) { setError(err.message || "Couldn't read that photo."); }
    setPhotoBusy(false);
  }

  const box = landscape ? { left: '5%', width: '90%', top: '30%', height: '40%' } : { left: '25%', width: '50%', top: '8%', height: '84%' };
  const btnBase = { padding: '14px 10px', borderRadius: 10, fontSize: 15.5, fontWeight: 800, border: '1px solid rgba(255,255,255,.25)', background: 'rgba(255,255,255,.1)', color: '#fff' };

  return (
    <div style={{ position: 'fixed', inset: 0, zIndex: 2147483000, background: '#000', display: 'flex', flexDirection: landscape ? 'row' : 'column' }}>
      <div style={{ position: 'relative', flex: 1, overflow: 'hidden' }}>
        <video ref={videoRef} muted playsInline style={{ width: '100%', height: '100%', objectFit: 'cover' }} />
        {ready && !error && (
          <div style={{ position: 'absolute', ...box, border: '3px solid #4ade80', borderRadius: 12, boxShadow: '0 0 0 9999px rgba(0,0,0,.35)', pointerEvents: 'none' }} />
        )}
        <div style={{ position: 'absolute', top: 0, left: 0, right: 0, padding: '14px 16px', textAlign: 'center', color: '#fff', fontWeight: 800, fontSize: 15.5, textShadow: '0 1px 4px #000', lineHeight: 1.35 }}>
          {photoBusy ? '⏳ Reading the photo…'
            : error || (ready ? 'Fit the VIN barcode inside the green box — any way up. Hold the phone about 8 inches back so it stays sharp.' : 'Opening the camera…')}
        </div>
        {/* The iPhone's own Allow / Cancel box has no "always" button — a site
            can't add one. Safari remembers it only if it's set per site, so show
            how while the question is up. */}
        {!ready && !error && /iPhone|iPad|iPod/i.test(navigator.userAgent) && (
          <div style={{ position: 'absolute', left: 14, right: 14, bottom: 14, padding: '12px 14px', borderRadius: 12, background: 'rgba(15,23,42,.92)', border: '1px solid rgba(96,165,250,.5)', color: '#e2e8f0', fontSize: 13.5, lineHeight: 1.45 }}>
            <div style={{ fontWeight: 900, color: '#93c5fd', marginBottom: 4 }}>Tired of the camera question?</div>
            {/CriOS/i.test(navigator.userAgent)
              ? <>Chrome on iPhone asks every time. Open this site in <b>Safari</b> instead, then set it to always allow.</>
              : <>In Safari tap <b>≡</b> (or <b>aA</b>) next to the address → <b>Website Settings</b> → <b>Camera</b> → <b>Allow</b>. It won't ask again on this phone.</>}
          </div>
        )}
      </div>
      <input ref={photoRef} type="file" accept="image/*" capture="environment" onChange={onPhoto} style={{ display: 'none' }} />
      <div style={{ display: 'flex', flexDirection: landscape ? 'column' : 'row', flexWrap: 'wrap', gap: 8, padding: landscape ? '12px' : '12px 12px 24px', background: '#0d1627', width: landscape ? 170 : 'auto', boxSizing: 'border-box' }}>
        <button disabled={photoBusy} onClick={() => photoRef.current?.click()} style={{ ...btnBase, flex: landscape ? 'none' : '1 1 100%', background: 'rgba(96,165,250,.2)', borderColor: 'rgba(96,165,250,.6)' }}>
          📸 Snap the sticker
        </button>
        {torch !== null && (
          <button onClick={toggleTorch} style={{ ...btnBase, flex: 1, background: torch ? '#fde68a' : btnBase.background, color: torch ? '#422006' : '#fff' }}>🔦 {torch ? 'Off' : 'Light'}</button>
        )}
        {zoom && <button onClick={cycleZoom} style={{ ...btnBase, flex: 1 }}>🔍 {Math.round(zoom.val * 10) / 10}×</button>}
        <button onClick={onCancel} style={{ ...btnBase, flex: landscape ? 'none' : 2 }}>Cancel</button>
      </div>
    </div>
  );
}
