// SessionValidator.jsx — entry-point gate that establishes a BMS session.
// Flow: URL param ?bms-session-id=XXX → cookie → manual login form.
import React, { useEffect, useRef, useState } from 'react';
import { Loader2, AlertCircle, KeyRound, LogIn } from 'lucide-react';
import { useBmsSessionContext } from '../contexts/BmsSessionContext';
import { handleUrlSession } from '../utils/sessionStorage';

export default function SessionValidator({ children, onSessionReady }) {
  const session = useBmsSessionContext();
  const { isConnected, isConnecting, error, connectSession } = session;

  const [bootstrapped, setBootstrapped] = useState(false);
  const [manualId, setManualId] = useState('');
  const triggeredRef = useRef(false);

  // On first mount: read URL/cookie and try to connect once.
  useEffect(() => {
    if (triggeredRef.current) return;
    triggeredRef.current = true;
    const id = handleUrlSession();
    if (id) {
      connectSession(id).finally(() => setBootstrapped(true));
    } else {
      setBootstrapped(true);
    }
  }, [connectSession]);

  // Notify parent once we go from disconnected → connected.
  const wasConnected = useRef(false);
  useEffect(() => {
    if (isConnected && !wasConnected.current) {
      wasConnected.current = true;
      onSessionReady?.(session);
    } else if (!isConnected) {
      wasConnected.current = false;
    }
  }, [isConnected, onSessionReady, session]);

  if (isConnected) {
    return <>{children}</>;
  }

  // Bootstrapping or actively connecting — show spinner.
  if (!bootstrapped || isConnecting) {
    return (
      <div className="min-h-screen flex items-center justify-center bg-slate-50">
        <div className="flex flex-col items-center gap-3 text-slate-700">
          <Loader2 className="w-8 h-8 animate-spin text-teal-600" />
          <p className="text-sm font-medium">กำลังตรวจสอบ session…</p>
        </div>
      </div>
    );
  }

  // Manual login fallback.
  const handleSubmit = async (e) => {
    e.preventDefault();
    const id = manualId.trim();
    if (!id) return;
    await connectSession(id);
  };

  return (
    <div className="min-h-screen flex items-center justify-center bg-gradient-to-br from-slate-50 to-teal-50 p-6"
         style={{ fontFamily: "'Sarabun', 'Inter', sans-serif" }}>
      <div className="w-full max-w-md bg-white rounded-2xl shadow-xl p-8 space-y-5">
        <div className="flex items-center gap-3">
          <div className="w-12 h-12 rounded-full bg-teal-100 flex items-center justify-center">
            <KeyRound className="w-6 h-6 text-teal-700" />
          </div>
          <div>
            <h1 className="text-xl font-bold text-slate-800">เชื่อมต่อ BMS Session</h1>
            <p className="text-xs text-slate-500">กรอก session ID เพื่อเริ่มใช้งาน</p>
          </div>
        </div>

        <form onSubmit={handleSubmit} className="space-y-3">
          <div>
            <label className="text-xs font-medium text-slate-600 mb-1 block">BMS Session ID</label>
            <input
              type="text"
              value={manualId}
              onChange={(e) => setManualId(e.target.value)}
              placeholder="เช่น ABC123…"
              autoFocus
              className="w-full px-3 py-2 border border-slate-200 rounded-lg focus:outline-none focus:ring-2 focus:ring-teal-500 font-mono text-sm"
            />
          </div>

          {error && (
            <div className="flex items-start gap-2 bg-red-50 border border-red-200 text-red-700 rounded-lg p-3 text-sm">
              <AlertCircle className="w-4 h-4 flex-shrink-0 mt-0.5" />
              <span>{error}</span>
            </div>
          )}

          <button
            type="submit"
            disabled={isConnecting || !manualId.trim()}
            className="w-full bg-gradient-to-r from-teal-600 to-emerald-600 hover:from-teal-700 hover:to-emerald-700 disabled:opacity-50 text-white font-bold py-3 rounded-xl shadow flex items-center justify-center gap-2 transition"
          >
            {isConnecting ? <Loader2 className="w-4 h-4 animate-spin" /> : <LogIn className="w-4 h-4" />}
            เชื่อมต่อ
          </button>
        </form>

        <p className="text-xs text-slate-400 text-center">
          เคล็ดลับ: เปิดด้วย URL <span className="font-mono">?bms-session-id=…</span> เพื่อ login อัตโนมัติ
        </p>
      </div>
    </div>
  );
}
