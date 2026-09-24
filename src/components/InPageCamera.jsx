import React, { useEffect, useRef, useState } from 'react';

// Full-screen camera that runs inside the page (getUserMedia) instead of
// handing off to the phone's camera app. On Android, handing off to the camera
// app lets the OS kill or reload the browser tab, so the photo never comes back
// — keeping the camera in the page means there's nothing to come back to.
//
// onCapture(file) gets a JPEG File. onFallback() is called when the camera
// can't be opened here, so the caller can use its regular file input instead.
const MAX_DIM = 2560;

export function inPageCameraSupported() {
  return typeof navigator !== 'undefined' && !!navigator.mediaDevices?.getUserMedia;
}

export default function InPageCamera({ label, onCapture, onCancel, onFallback }) {
  const videoRef = useRef(null);
  const streamRef = useRef(null);
  const [ready, setReady] = useState(false);
  const [error, setError] = useState('');
  const [torch, setTorch] = useState(null); // null = not supported, else on/off
  const [busy, setBusy] = useState(false);

  useEffect(() => {
    let cancelled = false;
    (async () => {
      try {
        const stream = await navigator.mediaDevices.getUserMedia({
          audio: false,
          video: { facingMode: { ideal: 'environment' }, width: { ideal: 3840 }, height: { ideal: 2160 } },
        });
        if (cancelled) { stream.getTracks().forEach(t => t.stop()); return; }
        streamRef.current = stream;
        const video = videoRef.current;
        video.srcObject = stream;
        await video.play().catch(() => {});
        const track = stream.getVideoTracks()[0];
        const caps = track?.getCapabilities?.() || {};
        if (caps.torch) setTorch(false);
        setReady(true);
      } catch (err) {
        if (cancelled) return;
        setError(err?.name === 'NotAllowedError'
          ? 'Camera permission is blocked for this site. Allow it in the browser settings, or use the phone camera below.'
          : 'Could not open the camera here. Use the phone camera below.');
      }
    })();
    return () => {
      cancelled = true;
      streamRef.current?.getTracks().forEach(t => t.stop());
      streamRef.current = null;
    };
  }, []);

  async function toggleTorch() {
    const track = streamRef.current?.getVideoTracks()[0];
    if (!track) return;
    try {
      await track.applyConstraints({ advanced: [{ torch: !torch }] });
      setTorch(!torch);
    } catch { setTorch(null); }
  }

  async function snap() {
    const video = videoRef.current;
    if (!video || !video.videoWidth || busy) return;
    setBusy(true);
    const scale = Math.min(1, MAX_DIM / Math.max(video.videoWidth, video.videoHeight));
    const canvas = document.createElement('canvas');
    canvas.width = Math.round(video.videoWidth * scale);
    canvas.height = Math.round(video.videoHeight * scale);
    canvas.getContext('2d').drawImage(video, 0, 0, canvas.width, canvas.height);
    const blob = await new Promise(r => canvas.toBlob(r, 'image/jpeg', 0.9));
    canvas.width = canvas.height = 0;
    if (!blob) { setBusy(false); setError('Could not capture the photo. Try again.'); return; }
    onCapture(new File([blob], `photo-${Date.now()}.jpg`, { type: 'image/jpeg' }));
  }

  const btn = {
    background: 'rgba(255,255,255,0.12)', border: '1px solid rgba(255,255,255,0.25)', color: '#e2e8f0',
    borderRadius: 10, padding: '10px 14px', fontSize: 14, fontWeight: 700, cursor: 'pointer',
  };

  return (
    <div style={{ position: 'fixed', inset: 0, zIndex: 1000, background: '#000', display: 'flex', flexDirection: 'column' }}>
      <div style={{ display: 'flex', alignItems: 'center', gap: 10, padding: '12px 14px', color: '#e2e8f0' }}>
        <button type="button" onClick={onCancel} style={btn}>✕ Cancel</button>
        <div style={{ flex: 1, fontWeight: 700, fontSize: 15, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>{label}</div>
        {torch !== null && (
          <button type="button" onClick={toggleTorch} style={{ ...btn, color: torch ? '#fbbf24' : '#e2e8f0' }}>
            {torch ? '🔦 On' : '🔦 Off'}
          </button>
        )}
      </div>

      <div style={{ flex: 1, minHeight: 0, position: 'relative', display: 'flex', alignItems: 'center', justifyContent: 'center' }}>
        <video ref={videoRef} playsInline muted autoPlay
          style={{ width: '100%', height: '100%', objectFit: 'contain', display: error ? 'none' : 'block' }} />
        {!ready && !error && <div style={{ position: 'absolute', color: '#94a3b8' }}>Opening camera…</div>}
        {error && <div style={{ color: '#f87171', padding: 24, textAlign: 'center', fontSize: 15 }}>{error}</div>}
      </div>

      <div style={{ padding: '16px 14px 28px', display: 'flex', flexDirection: 'column', alignItems: 'center', gap: 14 }}>
        {!error && (
          <button type="button" onClick={snap} disabled={!ready || busy} aria-label="Take photo"
            style={{ width: 76, height: 76, borderRadius: '50%', border: '5px solid #fff',
              background: ready && !busy ? '#fbbf24' : '#475569', cursor: ready ? 'pointer' : 'wait' }} />
        )}
        <button type="button" onClick={onFallback} style={{ ...btn, background: 'transparent', border: 'none', color: '#94a3b8', fontWeight: 600, textDecoration: 'underline' }}>
          Use phone camera / gallery instead
        </button>
      </div>
    </div>
  );
}
