import React, { useEffect, useRef, useState } from 'react';

// Full-screen VIN barcode scanner (phone). Opens the back camera in the page
// and reads the VIN barcode on the door jamb / windshield sticker — Code 39,
// Code 128, Data Matrix or QR. Uses the browser's own BarcodeDetector where it
// has one (Android Chrome), with ZXing joining after 3 s without a read; ZXing
// alone everywhere else (iPhone Safari has no BarcodeDetector) — loaded from
// the CDN the first time. A read only counts when it holds a
// 17-character VIN whose check digit is right, so a half-read barcode never
// fills in a wrong VIN. onScan(vin) then closes it.

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

export default function VinScanner({ onScan, onCancel }) {
  const videoRef = useRef(null);
  const streamRef = useRef(null);
  const doneRef = useRef(false);
  const [error, setError] = useState('');
  const [ready, setReady] = useState(false);
  const [torch, setTorch] = useState(null);   // null = no torch on this camera

  useEffect(() => {
    let cancelled = false;
    let timer = null;
    let zxReader = null;
    const hit = (text) => {
      const vin = vinFromBarcode(text);
      if (!vin || doneRef.current) return;
      doneRef.current = true;
      try { navigator.vibrate && navigator.vibrate(120); } catch {}
      onScan(vin);
    };
    (async () => {
      try {
        const stream = await navigator.mediaDevices.getUserMedia({
          audio: false, video: { facingMode: { ideal: 'environment' }, width: { ideal: 1920 }, height: { ideal: 1080 } },
        });
        if (cancelled) { stream.getTracks().forEach(t => t.stop()); return; }
        streamRef.current = stream;
        const video = videoRef.current;
        video.srcObject = stream;
        await video.play().catch(() => {});
        const caps = stream.getVideoTracks()[0]?.getCapabilities?.() || {};
        if (caps.torch) setTorch(false);
        setReady(true);

        let native = null;
        if ('BarcodeDetector' in window) {
          try {
            const have = await window.BarcodeDetector.getSupportedFormats();
            const want = ['code_39', 'code_128', 'data_matrix', 'qr_code'].filter(f => have.includes(f));
            if (want.includes('code_39')) native = new window.BarcodeDetector({ formats: want });
          } catch {}
        }
        if (native) {
          const tick = async () => {
            if (cancelled || doneRef.current) return;
            try { for (const b of await native.detect(video)) hit(b.rawValue); } catch {}
            timer = setTimeout(tick, 150);
          };
          tick();
          // Some built-in detectors list a format but never read it — if
          // nothing has come back in 3 s, ZXing joins in.
          await new Promise(r => setTimeout(r, 3000));
          if (cancelled || doneRef.current) return;
        }
        const ZX = await loadZxing();
        if (cancelled) return;
        const hints = new Map();
        hints.set(ZX.DecodeHintType.POSSIBLE_FORMATS, [ZX.BarcodeFormat.CODE_39, ZX.BarcodeFormat.CODE_128, ZX.BarcodeFormat.DATA_MATRIX, ZX.BarcodeFormat.QR_CODE]);
        hints.set(ZX.DecodeHintType.TRY_HARDER, true);
        zxReader = new ZX.BrowserMultiFormatReader(hints, 150);
        zxReader.decodeFromStream(stream, video, (result) => { if (result && !cancelled) hit(result.getText()); });
      } catch (err) {
        if (cancelled) return;
        setError(err?.name === 'NotAllowedError'
          ? 'Camera permission is blocked for this site. Allow it in the browser settings, or type the stock # instead.'
          : (err?.message && /scanner/i.test(err.message) ? err.message : 'Could not open the camera. Type the stock # instead.'));
      }
    })();
    return () => {
      cancelled = true;
      clearTimeout(timer);
      try { zxReader && zxReader.reset(); } catch {}
      streamRef.current?.getTracks().forEach(t => t.stop());
      streamRef.current = null;
    };
  }, []); // eslint-disable-line react-hooks/exhaustive-deps

  async function toggleTorch() {
    const track = streamRef.current?.getVideoTracks()[0];
    if (!track) return;
    try { await track.applyConstraints({ advanced: [{ torch: !torch }] }); setTorch(!torch); } catch {}
  }

  return (
    <div style={{ position: 'fixed', inset: 0, zIndex: 3000, background: '#000', display: 'flex', flexDirection: 'column' }}>
      <div style={{ position: 'relative', flex: 1, overflow: 'hidden' }}>
        <video ref={videoRef} muted playsInline style={{ width: '100%', height: '100%', objectFit: 'cover' }} />
        {ready && !error && (
          <div style={{ position: 'absolute', left: '6%', right: '6%', top: '40%', height: '20%', border: '3px solid #4ade80', borderRadius: 12, boxShadow: '0 0 0 9999px rgba(0,0,0,.35)' }} />
        )}
        <div style={{ position: 'absolute', top: 0, left: 0, right: 0, padding: '18px 16px', textAlign: 'center', color: '#fff', fontWeight: 800, fontSize: 16, textShadow: '0 1px 4px #000' }}>
          {error || (ready ? 'Point at the VIN barcode — driver door jamb or windshield' : 'Opening the camera…')}
        </div>
      </div>
      <div style={{ display: 'flex', gap: 10, padding: '14px 16px 26px', background: '#0d1627' }}>
        {torch !== null && (
          <button onClick={toggleTorch} style={{ flex: 1, padding: '14px 10px', borderRadius: 10, fontSize: 16, fontWeight: 800, background: torch ? '#fde68a' : 'rgba(255,255,255,.1)', color: torch ? '#422006' : '#fff', border: '1px solid rgba(255,255,255,.25)' }}>
            🔦 {torch ? 'Light off' : 'Light'}
          </button>
        )}
        <button onClick={onCancel} style={{ flex: 2, padding: '14px 10px', borderRadius: 10, fontSize: 16, fontWeight: 800, background: 'rgba(255,255,255,.1)', color: '#fff', border: '1px solid rgba(255,255,255,.25)' }}>
          Cancel
        </button>
      </div>
    </div>
  );
}
