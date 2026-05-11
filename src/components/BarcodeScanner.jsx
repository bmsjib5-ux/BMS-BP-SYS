// Full-screen barcode/QR scanner modal backed by @zxing/browser.
// Prefers the rear camera (facingMode: environment) and supports manual
// switching when multiple cameras are present.
import React, { useEffect, useRef, useState } from 'react';
import { BrowserMultiFormatReader } from '@zxing/browser';
import { X, Camera as CameraIcon, RefreshCw, Loader2, AlertCircle } from 'lucide-react';

export default function BarcodeScanner({ open, onResult, onClose }) {
  const videoRef = useRef(null);
  const controlsRef = useRef(null);
  const readerRef = useRef(null);
  const [error, setError] = useState(null);
  const [devices, setDevices] = useState([]);
  const [deviceIndex, setDeviceIndex] = useState(0);
  const [isStarting, setIsStarting] = useState(false);

  // Start/stop scanner whenever the modal opens or the chosen device changes.
  useEffect(() => {
    if (!open) return;
    let cancelled = false;
    setError(null);
    setIsStarting(true);

    const reader = new BrowserMultiFormatReader();
    readerRef.current = reader;

    const startScan = async () => {
      try {
        // Discover cameras the first time we open. After that we trust
        // `devices` so user's manual switch sticks.
        let camList = devices;
        if (!camList.length) {
          try {
            camList = await BrowserMultiFormatReader.listVideoInputDevices();
            if (cancelled) return;
            setDevices(camList);
          } catch {
            // Some browsers need an active permission prompt first — fall
            // through to decodeFromConstraints which triggers the prompt.
          }
        }

        const chosen = camList[deviceIndex];
        const target = videoRef.current;
        if (!target) return;

        const onDecode = (result, _err, ctrl) => {
          if (result) {
            const text = result.getText();
            try { ctrl.stop(); } catch {}
            controlsRef.current = null;
            onResult?.(text);
          }
        };

        const controls = chosen
          ? await reader.decodeFromVideoDevice(chosen.deviceId, target, onDecode)
          : await reader.decodeFromConstraints(
              { video: { facingMode: { ideal: 'environment' } } },
              target,
              onDecode,
            );
        if (cancelled) {
          try { controls.stop(); } catch {}
          return;
        }
        controlsRef.current = controls;
        setIsStarting(false);
      } catch (err) {
        if (cancelled) return;
        setError(err?.message || 'เปิดกล้องไม่สำเร็จ');
        setIsStarting(false);
      }
    };

    startScan();

    return () => {
      cancelled = true;
      const c = controlsRef.current;
      if (c) {
        try { c.stop(); } catch {}
        controlsRef.current = null;
      }
    };
  }, [open, deviceIndex]); // eslint-disable-line react-hooks/exhaustive-deps

  if (!open) return null;

  const cycleCamera = () => {
    if (devices.length > 1) {
      setDeviceIndex((i) => (i + 1) % devices.length);
    }
  };

  return (
    <div className="fixed inset-0 z-50 bg-black/90 flex flex-col" style={{ fontFamily: "'Sarabun', 'Inter', sans-serif" }}>
      {/* header */}
      <div className="flex items-center justify-between p-4 text-white">
        <div className="flex items-center gap-2">
          <CameraIcon className="w-5 h-5" />
          <span className="font-medium">สแกน barcode / QR</span>
        </div>
        <div className="flex items-center gap-2">
          {devices.length > 1 && (
            <button
              onClick={cycleCamera}
              title="สลับกล้อง"
              className="p-2 rounded-lg bg-white/10 hover:bg-white/20 transition"
            >
              <RefreshCw className="w-4 h-4" />
            </button>
          )}
          <button
            onClick={onClose}
            title="ปิด"
            className="p-2 rounded-lg bg-white/10 hover:bg-white/20 transition"
          >
            <X className="w-5 h-5" />
          </button>
        </div>
      </div>

      {/* video area */}
      <div className="flex-1 relative flex items-center justify-center overflow-hidden">
        <video
          ref={videoRef}
          className="max-w-full max-h-full object-contain"
          playsInline
          muted
        />
        {/* viewfinder overlay */}
        <div className="absolute inset-0 pointer-events-none flex items-center justify-center">
          <div className="w-72 h-44 border-2 border-emerald-400 rounded-lg shadow-[0_0_0_9999px_rgba(0,0,0,0.4)]" />
        </div>
        {isStarting && (
          <div className="absolute inset-0 flex items-center justify-center text-white">
            <Loader2 className="w-8 h-8 animate-spin" />
          </div>
        )}
        {error && (
          <div className="absolute inset-x-4 bottom-20 bg-red-600/95 text-white p-3 rounded-lg flex items-start gap-2 text-sm">
            <AlertCircle className="w-4 h-4 mt-0.5 flex-shrink-0" />
            <span>{error}</span>
          </div>
        )}
      </div>

      <p className="text-center text-white/80 text-sm p-4">
        ส่อง barcode/QR ของบัตรคนไข้ให้อยู่ในกรอบ
        {devices.length > 1 && <span className="block text-xs opacity-70 mt-1">มีหลายกล้อง — แตะปุ่มสลับ มุมขวาบน</span>}
      </p>
    </div>
  );
}
