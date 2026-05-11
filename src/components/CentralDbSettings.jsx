import React, { useState } from 'react';
import {
  Settings as SettingsIcon,
  Save,
  RotateCcw,
  CheckCircle2,
  AlertCircle,
  Loader2,
  KeyRound,
  Link2,
  LogOut,
  Eye,
  EyeOff,
} from 'lucide-react';
import { useBmsSessionContext } from '../contexts/BmsSessionContext';
import {
  loadCentralDbSettings,
  saveCentralDbSettings,
  clearCentralDbSettings,
  testCentralDbConnection,
} from '../utils/centralDbSettings';

export default function CentralDbSettings() {
  const session = useBmsSessionContext();
  const [form, setForm] = useState(() => loadCentralDbSettings());
  const [status, setStatus] = useState(null); // { type, message }
  const [isTesting, setIsTesting] = useState(false);
  const [showKey, setShowKey] = useState(false);

  const update = (field, value) => {
    setForm((prev) => ({ ...prev, [field]: value }));
    setStatus(null);
  };

  const handleSave = () => {
    const saved = saveCentralDbSettings(form);
    setForm(saved);
    setStatus({ type: 'success', message: 'บันทึกค่าเรียบร้อย (เก็บไว้ที่ localStorage ของเครื่องนี้)' });
  };

  const handleReset = () => {
    clearCentralDbSettings();
    setForm(loadCentralDbSettings());
    setStatus({ type: 'success', message: 'รีเซ็ตค่ากลับสู่ค่าเริ่มต้นแล้ว' });
  };

  const handleTest = async () => {
    setIsTesting(true);
    setStatus(null);
    const result = await testCentralDbConnection(form);
    setStatus({
      type: result.ok ? 'success' : 'error',
      message: result.ok
        ? `เชื่อมต่อสำเร็จ (HTTP ${result.status})`
        : `เชื่อมต่อไม่สำเร็จ — ${result.message}`,
    });
    setIsTesting(false);
  };

  return (
    <div className="min-h-screen bg-slate-50" style={{ fontFamily: "'Sarabun', 'Inter', sans-serif" }}>
      <div className="bg-gradient-to-r from-slate-700 to-slate-900 text-white p-6 shadow-lg">
        <div className="max-w-3xl mx-auto flex items-center justify-between">
          <div className="flex items-center gap-3">
            <SettingsIcon className="w-8 h-8" />
            <div>
              <h1 className="text-2xl font-bold">ตั้งค่าฐานกลาง</h1>
              <p className="text-slate-300 text-sm">Central database connection settings</p>
            </div>
          </div>
          <div className="flex items-center gap-2">
            {session.userInfo?.name && (
              <div className="text-right text-xs text-slate-300 hidden md:block mr-2">
                <div className="font-medium">{session.userInfo.name}</div>
                {session.userInfo.location && <div className="opacity-80">{session.userInfo.location}</div>}
              </div>
            )}
            <button
              onClick={session.disconnectSession}
              title="ออกจากระบบ"
              className="bg-white/20 hover:bg-white/30 p-2 rounded-lg transition"
            >
              <LogOut className="w-4 h-4" />
            </button>
          </div>
        </div>
      </div>

      <div className="max-w-3xl mx-auto p-6 space-y-4">
        <div className="bg-white rounded-xl shadow-sm p-5 space-y-5">
          {/* Enabled toggle */}
          <label className="flex items-start gap-3 pb-4 border-b border-slate-100 cursor-pointer">
            <input
              type="checkbox"
              checked={form.enabled}
              onChange={(e) => update('enabled', e.target.checked)}
              className="mt-1 w-4 h-4 rounded text-teal-600 focus:ring-teal-500"
            />
            <div className="flex-1">
              <div className="font-medium text-slate-800">เปิดใช้งานฐานกลาง</div>
              <div className="text-xs text-slate-500 mt-0.5">
                ถ้าเปิด: หน้า "บันทึก vital signs" จะส่งข้อมูลไปฐานกลางก่อน
                และหน้าพยาบาลจะแสดงทั้ง <em>pending</em> (จากฐานกลาง) และ <em>committed</em> (จาก HOSxP)
              </div>
            </div>
          </label>

          {/* Base URL */}
          <div>
            <label className="text-sm font-medium text-slate-700 mb-1 flex items-center gap-2">
              <Link2 className="w-4 h-4 text-slate-500" />
              URL ของฐานกลาง
            </label>
            <input
              type="url"
              value={form.baseUrl}
              onChange={(e) => update('baseUrl', e.target.value)}
              placeholder="https://central.example.com/api"
              className="w-full px-3 py-2 border border-slate-200 rounded-lg focus:outline-none focus:ring-2 focus:ring-teal-500 text-sm font-mono"
              autoComplete="off"
              spellCheck={false}
            />
            <p className="text-xs text-slate-500 mt-1">Base URL ของ API (ระบบจะลบ trailing slash อัตโนมัติ)</p>
          </div>

          {/* Auth Key */}
          <div>
            <label className="text-sm font-medium text-slate-700 mb-1 flex items-center gap-2">
              <KeyRound className="w-4 h-4 text-slate-500" />
              API Key / Bearer Token
            </label>
            <div className="relative">
              <input
                type={showKey ? 'text' : 'password'}
                value={form.authKey}
                onChange={(e) => update('authKey', e.target.value)}
                placeholder="เช่น sk_xxx หรือ JWT"
                className="w-full pl-3 pr-10 py-2 border border-slate-200 rounded-lg focus:outline-none focus:ring-2 focus:ring-teal-500 text-sm font-mono"
                autoComplete="off"
                spellCheck={false}
              />
              <button
                type="button"
                onClick={() => setShowKey((v) => !v)}
                className="absolute right-2 top-1/2 -translate-y-1/2 text-slate-400 hover:text-slate-600"
                title={showKey ? 'ซ่อน' : 'แสดง'}
              >
                {showKey ? <EyeOff className="w-4 h-4" /> : <Eye className="w-4 h-4" />}
              </button>
            </div>
            <p className="text-xs text-slate-500 mt-1">
              เก็บใน localStorage ของเครื่องนี้เท่านั้น — ไม่ผ่าน git, ไม่ผ่าน BMS
            </p>
          </div>

          {/* Timeout */}
          <div>
            <label className="text-sm font-medium text-slate-700 mb-1 block">Timeout (มิลลิวินาที)</label>
            <input
              type="number"
              min="1000"
              step="1000"
              value={form.timeoutMs}
              onChange={(e) => update('timeoutMs', e.target.value)}
              className="w-32 px-3 py-2 border border-slate-200 rounded-lg focus:outline-none focus:ring-2 focus:ring-teal-500 text-sm"
            />
            <p className="text-xs text-slate-500 mt-1">เวลารอ response สูงสุด ก่อน abort</p>
          </div>
        </div>

        {status && (
          <div
            className={`rounded-lg p-3 flex items-start gap-2 text-sm border ${
              status.type === 'success'
                ? 'bg-emerald-50 text-emerald-800 border-emerald-200'
                : 'bg-red-50 text-red-800 border-red-200'
            }`}
          >
            {status.type === 'success' ? (
              <CheckCircle2 className="w-4 h-4 mt-0.5 flex-shrink-0" />
            ) : (
              <AlertCircle className="w-4 h-4 mt-0.5 flex-shrink-0" />
            )}
            <span>{status.message}</span>
          </div>
        )}

        <div className="flex flex-wrap gap-2">
          <button
            onClick={handleSave}
            className="flex items-center gap-2 bg-teal-600 hover:bg-teal-700 text-white font-medium px-4 py-2 rounded-lg shadow transition"
          >
            <Save className="w-4 h-4" />
            บันทึก
          </button>
          <button
            onClick={handleTest}
            disabled={isTesting || !form.baseUrl}
            className="flex items-center gap-2 bg-slate-200 hover:bg-slate-300 disabled:opacity-50 disabled:cursor-not-allowed text-slate-700 font-medium px-4 py-2 rounded-lg transition"
          >
            {isTesting ? <Loader2 className="w-4 h-4 animate-spin" /> : <CheckCircle2 className="w-4 h-4" />}
            ทดสอบเชื่อมต่อ
          </button>
          <button
            onClick={handleReset}
            className="flex items-center gap-2 text-slate-500 hover:text-red-600 font-medium px-4 py-2 rounded-lg transition ml-auto"
          >
            <RotateCcw className="w-4 h-4" />
            รีเซ็ต
          </button>
        </div>

        <div className="text-xs text-slate-500 px-1 pt-2">
          💡 หน้านี้เปิดผ่าน URL <span className="font-mono bg-slate-100 px-1 rounded">/#/settings</span> เท่านั้น — ยังไม่ลิงก์จากหน้าอื่น
        </div>
      </div>
    </div>
  );
}
