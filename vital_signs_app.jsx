import React, { useState, useEffect, useRef, useMemo } from 'react';
import { Camera, Upload, Send, Activity, Heart, Thermometer, Wind, Droplet, User, ClipboardList, Loader2, CheckCircle2, AlertCircle, Sparkles, Scale, Ruler, LogOut, Search, LayoutGrid, List as ListIcon, X, Clock, ArrowUpToLine, Ban, ScanBarcode } from 'lucide-react';
import Tesseract from 'tesseract.js';
import { BmsSessionProvider, useBmsSessionContext } from './src/contexts/BmsSessionContext';
import SessionValidator from './src/components/SessionValidator';
import CentralDbSettings from './src/components/CentralDbSettings';
import BarcodeScanner from './src/components/BarcodeScanner';
import { saveOpdscreen, listTodaysOpdscreen } from './src/services/opdscreen';
import {
  isCentralEnabled,
  submitVitalToCentral,
  listPendingFromCentral,
  commitOnCentral,
  rejectOnCentral,
} from './src/services/centralDb';

// Hash-based routing — no router library. Patient and nurse pages are gated by
// URL only (per requirement); anyone with a session can hit either by typing
// the URL, but the UI never cross-links the two.
function parseHashRoute() {
  if (typeof window === 'undefined') return 'patient';
  const h = window.location.hash.replace(/^#\/?/, '');
  if (h.startsWith('nurse')) return 'nurse';
  if (h.startsWith('settings')) return 'settings';
  return 'patient';
}

function useHashRoute() {
  const [route, setRoute] = useState(parseHashRoute);
  useEffect(() => {
    const onChange = () => setRoute(parseHashRoute());
    window.addEventListener('hashchange', onChange);
    return () => window.removeEventListener('hashchange', onChange);
  }, []);
  return route;
}

function VitalSignsAppInner() {
  const session = useBmsSessionContext();
  const view = useHashRoute(); // 'patient' (default) or 'nurse'
  const [patientId, setPatientId] = useState('');
  const [imagePreview, setImagePreview] = useState(null);
  const [imageBase64, setImageBase64] = useState(null);
  const [imageMediaType, setImageMediaType] = useState(null);
  const [isProcessing, setIsProcessing] = useState(false);
  const [vitals, setVitals] = useState({
    bpSystolic: '',
    bpDiastolic: '',
    hr: '',
    temp: '',
    rr: '',
    spo2: '',
    weight: '',
    height: ''
  });
  const [submitStatus, setSubmitStatus] = useState(null); // 'success' | 'error' | null
  const [measuredAt, setMeasuredAt] = useState(null); // "YYYY-MM-DD HH:mm"
  const [measuredAtSource, setMeasuredAtSource] = useState(null); // 'slip' | 'now' | null
  const [records, setRecords] = useState([]);
  const [pendingRecords, setPendingRecords] = useState([]); // จากฐานกลาง
  const [actingOnId, setActingOnId] = useState(null);       // กำลัง commit/reject อันไหน
  const [scannerOpen, setScannerOpen] = useState(false);
  const [loadingRecords, setLoadingRecords] = useState(false);
  const [nurseSearch, setNurseSearch] = useState('');
  const [nurseDepFilter, setNurseDepFilter] = useState(''); // depcode or ''
  const [nurseViewMode, setNurseViewMode] = useState('card'); // 'card' | 'list'
  const centralEnabled = isCentralEnabled();
  const fileInputRef = useRef(null);
  const cameraInputRef = useRef(null);

  // โหลด records เมื่อเข้าหน้าพยาบาล
  useEffect(() => {
    if (view === 'nurse') {
      loadRecords();
    }
  }, [view]);

  const loadRecords = async () => {
    setLoadingRecords(true);
    try {
      // Run HOSxP + central in parallel (central optional).
      const [opdResult, centralResult] = await Promise.all([
        listTodaysOpdscreen(session),
        centralEnabled ? listPendingFromCentral() : Promise.resolve({ ok: true, rows: [] }),
      ]);

      if (!opdResult.ok) {
        console.error('Load opdscreen failed:', opdResult.message);
        setRecords([]);
      } else {
        const mapped = opdResult.rows.map((r) => ({
          id: `vn_${r.vn}`,
          vn: r.vn,
          patientId: r.hn,
          patientName: r.patient_name || '',
          mainDep: (r.main_dep || '').trim(),
          depName: r.dep_name || '',
          vitals: {
            bpSystolic: r.bps ?? '',
            bpDiastolic: r.bpd ?? '',
            hr: r.pulse ?? '',
            temp: r.temperature ?? '',
            rr: r.rr ?? '',
            spo2: r.spo2 ?? '',
            weight: r.bw ?? '',
            height: r.height ?? '',
          },
          dateTime: `${r.vstdate || ''} ${r.vsttime || ''}`.trim(),
          measuredAt: null,
        }));
        setRecords(mapped);
      }

      if (!centralResult.ok) {
        console.error('Load central pending failed:', centralResult.message);
        setPendingRecords([]);
      } else {
        const mappedPending = (centralResult.rows || []).map((r) => ({
          id: `central_${r.id}`,
          centralId: r.id,
          patientId: r.hn,
          patientName: r.patient_name || '',
          mainDep: (r.dep_code || '').trim(),
          depName: r.dep_name || '',
          vitals: {
            bpSystolic: r.bps ?? '',
            bpDiastolic: r.bpd ?? '',
            hr: r.pulse ?? '',
            temp: r.temperature ?? '',
            rr: r.rr ?? '',
            spo2: r.spo2 ?? '',
            weight: r.bw ?? '',
            height: r.height ?? '',
          },
          measuredAt: r.measured_at || null,
          createdAt: r.created_at,
          createdBy: r.created_by || '',
        }));
        setPendingRecords(mappedPending);
      }
    } catch (error) {
      console.error('Load records error:', error);
    }
    setLoadingRecords(false);
  };

  const handleImageUpload = (event) => {
    const file = event.target.files?.[0];
    if (!file) return;

    const reader = new FileReader();
    reader.onload = (e) => {
      const dataUrl = e.target.result;
      // resize ก่อนเพื่อลดขนาด (มือถือถ่ายมักได้รูป 3-5MB)
      resizeImage(dataUrl, 1600).then(resized => {
        setImagePreview(resized.dataUrl);
        setImageBase64(resized.base64);
        setImageMediaType(resized.mediaType);
        processImageWithAI(resized.base64, resized.mediaType);
      });
    };
    reader.readAsDataURL(file);
  };

  // resize รูปให้ด้านยาวสุดไม่เกิน maxSize px และ output เป็น JPEG quality 0.85
  const resizeImage = (dataUrl, maxSize) => {
    return new Promise((resolve) => {
      const img = new Image();
      img.onload = () => {
        let { width, height } = img;
        if (width > maxSize || height > maxSize) {
          if (width > height) {
            height = Math.round(height * (maxSize / width));
            width = maxSize;
          } else {
            width = Math.round(width * (maxSize / height));
            height = maxSize;
          }
        }
        const canvas = document.createElement('canvas');
        canvas.width = width;
        canvas.height = height;
        const ctx = canvas.getContext('2d');
        ctx.drawImage(img, 0, 0, width, height);
        const newDataUrl = canvas.toDataURL('image/jpeg', 0.85);
        const base64 = newDataUrl.split(',')[1];
        resolve({ dataUrl: newDataUrl, base64, mediaType: 'image/jpeg' });
      };
      img.onerror = () => {
        // ถ้า resize ไม่ได้ ใช้ของเดิม
        const base64 = dataUrl.split(',')[1];
        const mediaType = dataUrl.match(/data:(.+);base64/)?.[1] || 'image/jpeg';
        resolve({ dataUrl, base64, mediaType });
      };
      img.src = dataUrl;
    });
  };

  const processImageWithAI = async (base64, mediaType) => {
    setIsProcessing(true);
    setSubmitStatus(null);
    try {
      // OCR runs entirely in the browser via tesseract.js — no API/key needed.
      // First call downloads the worker + English language model (~10 MB)
      // and is therefore slower; subsequent calls are cached.
      const dataUrl = `data:${mediaType};base64,${base64}`;
      const { data } = await Tesseract.recognize(dataUrl, 'eng');
      const text = data?.text || '';
      console.log('[OCR] raw text:\n' + text);

      const parsed = parseVitalsFromOcrText(text);
      console.log('[OCR] parsed:', parsed);

      setVitals({
        bpSystolic: parsed.bpSystolic ?? '',
        bpDiastolic: parsed.bpDiastolic ?? '',
        hr: parsed.hr ?? '',
        temp: parsed.temp ?? '',
        rr: parsed.rr ?? '',
        spo2: parsed.spo2 ?? '',
        weight: parsed.weight ?? '',
        height: parsed.height ?? '',
      });
      if (parsed.measuredAt) {
        setMeasuredAt(parsed.measuredAt);
        setMeasuredAtSource('slip');
      } else {
        setMeasuredAt(formatNowAsMeasuredAt());
        setMeasuredAtSource('now');
      }

      const filledCount = Object.entries(parsed).filter(([k, v]) =>
        k !== 'measuredAt' && v !== null && v !== undefined
      ).length;
      if (filledCount === 0) {
        setSubmitStatus({ type: 'error', message: 'OCR อ่านค่าจากรูปไม่ออก กรุณากรอกด้วยตนเอง' });
      }
    } catch (error) {
      console.error('OCR error:', error);
      setSubmitStatus({
        type: 'error',
        message: 'อ่านรูปไม่สำเร็จ: ' + (error.message || 'unknown error') + ' — กรุณากรอกค่าด้วยตนเอง'
      });
    }
    setIsProcessing(false);
  };

  const handleVitalChange = (field, value) => {
    setVitals(prev => ({ ...prev, [field]: value }));
  };

  const handleSubmit = async () => {
    if (!patientId.trim()) {
      setSubmitStatus({ type: 'error', message: 'กรุณากรอก HN / รหัสคนไข้' });
      return;
    }
    const hasAnyVital = Object.values(vitals).some(v => v !== '' && v !== null);
    if (!hasAnyVital) {
      setSubmitStatus({ type: 'error', message: 'กรุณากรอกค่า vital signs อย่างน้อย 1 ค่า' });
      return;
    }

    try {
      let result;
      let successMessage;
      if (isCentralEnabled()) {
        // Staging path: nurse will commit to HOSxP later.
        result = await submitVitalToCentral({
          hn: patientId.trim(),
          vitals,
          measuredAt,
          session,
        });
        if (!result.ok) {
          setSubmitStatus({ type: 'error', message: 'ส่งฐานกลางไม่สำเร็จ: ' + (result.message || 'unknown') });
          return;
        }
        successMessage = `ส่งฐานกลางสำเร็จ (ID: ${result.id}) — รอพยาบาลตรวจสอบและส่งเข้า HOSxP`;
      } else {
        // Direct path: write straight to opdscreen.
        result = await saveOpdscreen(patientId.trim(), vitals, session);
        if (!result.ok) {
          setSubmitStatus({ type: 'error', message: 'บันทึกไม่สำเร็จ: ' + (result.message || 'unknown') });
          return;
        }
        const verb = result.mode === 'insert' ? 'สร้างใหม่' : 'อัปเดต';
        successMessage = `บันทึกลง opdscreen สำเร็จ (VN: ${result.vn}, ${verb})`;
      }
      setSubmitStatus({ type: 'success', message: successMessage });
      setTimeout(() => {
        setPatientId('');
        setImagePreview(null);
        setImageBase64(null);
        setVitals({ bpSystolic: '', bpDiastolic: '', hr: '', temp: '', rr: '', spo2: '', weight: '', height: '' });
        setMeasuredAt(null);
        setMeasuredAtSource(null);
        setSubmitStatus(null);
      }, 2000);
    } catch (error) {
      console.error('Save error:', error);
      setSubmitStatus({ type: 'error', message: 'บันทึกไม่สำเร็จ กรุณาลองใหม่' });
    }
  };

  // Distinct departments seen in today's records — feeds the filter dropdown.
  const nurseDepartments = useMemo(() => {
    const map = new Map();
    for (const r of records) {
      if (r.mainDep) map.set(r.mainDep, r.depName || r.mainDep);
    }
    return Array.from(map.entries()).sort((a, b) => String(a[1]).localeCompare(String(b[1]), 'th'));
  }, [records]);

  // Filtered list based on department + search box (HN or name).
  const filteredRecords = useMemo(() => {
    const q = nurseSearch.trim().toLowerCase();
    return records.filter((r) => {
      if (nurseDepFilter && r.mainDep !== nurseDepFilter) return false;
      if (q) {
        const hay = `${r.patientId || ''} ${r.patientName || ''}`.toLowerCase();
        if (!hay.includes(q)) return false;
      }
      return true;
    });
  }, [records, nurseSearch, nurseDepFilter]);

  // Same filter applied to pending records from central.
  const filteredPending = useMemo(() => {
    const q = nurseSearch.trim().toLowerCase();
    return pendingRecords.filter((r) => {
      if (nurseDepFilter && r.mainDep !== nurseDepFilter) return false;
      if (q) {
        const hay = `${r.patientId || ''} ${r.patientName || ''}`.toLowerCase();
        if (!hay.includes(q)) return false;
      }
      return true;
    });
  }, [pendingRecords, nurseSearch, nurseDepFilter]);

  // Commit a pending record into HOSxP opdscreen, then mark it committed
  // on the central server. HOSxP write goes FIRST — if it fails we never
  // touch central, so the record stays pending and can be retried safely.
  const handleCommitPending = async (record) => {
    setActingOnId(record.centralId);
    try {
      const opd = await saveOpdscreen(record.patientId, record.vitals, session);
      if (!opd.ok) {
        alert('บันทึกเข้า HOSxP ไม่สำเร็จ: ' + (opd.message || 'unknown'));
        return;
      }
      const c = await commitOnCentral(record.centralId, opd.vn);
      if (!c.ok) {
        alert(`บันทึกเข้า HOSxP สำเร็จ (VN: ${opd.vn}) แต่ update ฐานกลางไม่ได้: ${c.message}. ลองรีเฟรช`);
      }
      await loadRecords();
    } catch (err) {
      alert('Commit ผิดพลาด: ' + (err?.message || 'unknown'));
    } finally {
      setActingOnId(null);
    }
  };

  const handleRejectPending = async (record) => {
    if (!confirm(`ปฏิเสธรายการของ HN ${record.patientId}?`)) return;
    setActingOnId(record.centralId);
    try {
      const c = await rejectOnCentral(record.centralId);
      if (!c.ok) {
        alert('Reject ไม่สำเร็จ: ' + c.message);
        return;
      }
      await loadRecords();
    } finally {
      setActingOnId(null);
    }
  };

  // ฟังก์ชันประเมินค่าผิดปกติ
  const getVitalStatus = (vitals) => {
    const issues = [];
    if (vitals.bpSystolic && (vitals.bpSystolic >= 140 || vitals.bpSystolic <= 90)) issues.push('BP');
    if (vitals.bpDiastolic && (vitals.bpDiastolic >= 90 || vitals.bpDiastolic <= 60)) issues.push('BP');
    if (vitals.hr && (vitals.hr >= 100 || vitals.hr <= 60)) issues.push('HR');
    if (vitals.temp && (vitals.temp >= 37.5 || vitals.temp <= 36.0)) issues.push('Temp');
    if (vitals.rr && (vitals.rr >= 20 || vitals.rr <= 12)) issues.push('RR');
    if (vitals.spo2 && vitals.spo2 < 95) issues.push('SpO₂');
    return [...new Set(issues)];
  };

  // หน้าตั้งค่าฐานกลาง
  if (view === 'settings') {
    return <CentralDbSettings />;
  }

  // หน้าพยาบาล
  if (view === 'nurse') {
    return (
      <div className="min-h-screen bg-slate-50" style={{ fontFamily: "'Sarabun', 'Inter', sans-serif" }}>
        <div className="bg-gradient-to-r from-teal-700 to-emerald-600 text-white p-6 shadow-lg">
          <div className="max-w-4xl mx-auto flex items-center justify-between">
            <div className="flex items-center gap-3">
              <ClipboardList className="w-8 h-8" />
              <div>
                <h1 className="text-2xl font-bold">หน้าพยาบาล</h1>
                <p className="text-teal-100 text-sm">รายการบันทึก Vital Signs</p>
              </div>
            </div>
            <div className="flex items-center gap-2">
              {session.userInfo?.name && (
                <div className="text-right text-xs text-teal-50 hidden md:block mr-2">
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

        <div className="max-w-6xl mx-auto p-6 space-y-4">
          {/* Filter / search / view-mode toolbar */}
          <div className="bg-white rounded-xl shadow-sm p-4 flex flex-wrap gap-3 items-center">
            <div className="relative flex-1 min-w-[200px]">
              <Search className="w-4 h-4 absolute left-3 top-1/2 -translate-y-1/2 text-slate-400" />
              <input
                type="text"
                value={nurseSearch}
                onChange={(e) => setNurseSearch(e.target.value)}
                placeholder="ค้นหา HN หรือ ชื่อ-สกุล"
                className="w-full pl-9 pr-9 py-2 border border-slate-200 rounded-lg focus:outline-none focus:ring-2 focus:ring-teal-500 text-sm"
              />
              {nurseSearch && (
                <button
                  onClick={() => setNurseSearch('')}
                  className="absolute right-2 top-1/2 -translate-y-1/2 text-slate-400 hover:text-slate-600"
                >
                  <X className="w-4 h-4" />
                </button>
              )}
            </div>

            <select
              value={nurseDepFilter}
              onChange={(e) => setNurseDepFilter(e.target.value)}
              className="px-3 py-2 border border-slate-200 rounded-lg focus:outline-none focus:ring-2 focus:ring-teal-500 text-sm bg-white min-w-[160px]"
            >
              <option value="">ทุกห้องตรวจ</option>
              {nurseDepartments.map(([code, name]) => (
                <option key={code} value={code}>{name}</option>
              ))}
            </select>

            <div className="flex border border-slate-200 rounded-lg overflow-hidden">
              <button
                onClick={() => setNurseViewMode('card')}
                title="Card view"
                className={`p-2 transition ${nurseViewMode === 'card' ? 'bg-teal-600 text-white' : 'bg-white text-slate-600 hover:bg-slate-50'}`}
              >
                <LayoutGrid className="w-4 h-4" />
              </button>
              <button
                onClick={() => setNurseViewMode('list')}
                title="List view"
                className={`p-2 transition ${nurseViewMode === 'list' ? 'bg-teal-600 text-white' : 'bg-white text-slate-600 hover:bg-slate-50'}`}
              >
                <ListIcon className="w-4 h-4" />
              </button>
            </div>

            <button
              onClick={loadRecords}
              className="text-sm text-teal-600 hover:text-teal-800 px-2"
            >
              ↻ รีเฟรช
            </button>
          </div>

          <p className="text-slate-600 text-sm px-1">
            {centralEnabled ? (
              <>
                รอตรวจ <span className="font-bold text-amber-600">{filteredPending.length}</span>
                <span className="text-slate-400"> · </span>
                บันทึกแล้ว <span className="font-bold text-teal-700">{filteredRecords.length}</span>
                {filteredRecords.length !== records.length && <span className="text-slate-500"> / {records.length}</span>} รายการ
              </>
            ) : (
              <>
                แสดง <span className="font-bold text-teal-700">{filteredRecords.length}</span>
                {filteredRecords.length !== records.length && <span className="text-slate-500"> / {records.length}</span>} รายการ
              </>
            )}
          </p>

          {loadingRecords && (
            <div className="flex items-center justify-center py-20">
              <Loader2 className="w-8 h-8 animate-spin text-teal-600" />
            </div>
          )}

          {/* ── Section A: pending จากฐานกลาง (เฉพาะตอนเปิดใช้งาน) ── */}
          {!loadingRecords && centralEnabled && (
            <div className="space-y-3">
              <div className="flex items-center gap-2 pt-2">
                <Clock className="w-5 h-5 text-amber-500" />
                <h2 className="text-lg font-bold text-slate-800">
                  รอตรวจ (ฐานกลาง) — <span className="text-amber-600">{filteredPending.length}</span>
                </h2>
              </div>
              {filteredPending.length === 0 ? (
                <div className="bg-amber-50/40 border border-amber-100 rounded-xl p-4 text-sm text-amber-700 text-center">
                  ไม่มีรายการรอตรวจในฐานกลาง
                </div>
              ) : (
                filteredPending.map((record) => {
                  const issues = getVitalStatus(record.vitals);
                  const isAbnormal = issues.length > 0;
                  const acting = actingOnId === record.centralId;
                  return (
                    <div
                      key={record.id}
                      className={`bg-white rounded-xl shadow-sm border-l-4 ${isAbnormal ? 'border-red-500' : 'border-amber-400'} p-5`}
                    >
                      <div className="flex items-start justify-between gap-3 mb-3 flex-wrap">
                        <div className="flex items-center gap-3 min-w-0 flex-1">
                          <div className={`w-10 h-10 rounded-full flex items-center justify-center flex-shrink-0 ${isAbnormal ? 'bg-red-100' : 'bg-amber-100'}`}>
                            <Clock className={`w-5 h-5 ${isAbnormal ? 'text-red-600' : 'text-amber-600'}`} />
                          </div>
                          <div className="min-w-0">
                            <h3 className="font-bold text-slate-800">
                              HN: {record.patientId}
                              {record.patientName && (
                                <span className="font-normal text-slate-600 ml-2">— {record.patientName}</span>
                              )}
                            </h3>
                            <p className="text-xs text-slate-500">
                              {record.measuredAt && <span>วัดเมื่อ {record.measuredAt}</span>}
                              {record.createdBy && <span className="ml-2">· โดย {record.createdBy}</span>}
                              {!record.measuredAt && record.createdAt && <span>ส่งเมื่อ {record.createdAt}</span>}
                            </p>
                          </div>
                        </div>
                        <div className="flex gap-2 flex-shrink-0">
                          <button
                            onClick={() => handleCommitPending(record)}
                            disabled={acting}
                            className="flex items-center gap-1.5 bg-emerald-600 hover:bg-emerald-700 disabled:opacity-50 disabled:cursor-not-allowed text-white text-xs font-medium px-3 py-1.5 rounded-lg shadow transition"
                          >
                            {acting ? <Loader2 className="w-3.5 h-3.5 animate-spin" /> : <ArrowUpToLine className="w-3.5 h-3.5" />}
                            ส่งเข้า HOSxP
                          </button>
                          <button
                            onClick={() => handleRejectPending(record)}
                            disabled={acting}
                            className="flex items-center gap-1.5 bg-white border border-red-200 text-red-700 hover:bg-red-50 disabled:opacity-50 text-xs font-medium px-3 py-1.5 rounded-lg transition"
                          >
                            <Ban className="w-3.5 h-3.5" />
                            ปฏิเสธ
                          </button>
                        </div>
                      </div>
                      {isAbnormal && (
                        <div className="mb-3">
                          <span className="bg-red-100 text-red-700 text-xs font-semibold px-2 py-1 rounded-full inline-flex items-center gap-1">
                            <AlertCircle className="w-3 h-3" />
                            ผิดปกติ: {issues.join(', ')}
                          </span>
                        </div>
                      )}
                      <div className="grid grid-cols-2 md:grid-cols-5 gap-3 text-sm">
                        <VitalBox label="BP" value={record.vitals.bpSystolic && record.vitals.bpDiastolic ? `${record.vitals.bpSystolic}/${record.vitals.bpDiastolic}` : '-'} unit="mmHg" />
                        <VitalBox label="HR" value={record.vitals.hr || '-'} unit="bpm" />
                        <VitalBox label="Temp" value={record.vitals.temp || '-'} unit="°C" />
                        <VitalBox label="RR" value={record.vitals.rr || '-'} unit="/min" />
                        <VitalBox label="SpO₂" value={record.vitals.spo2 || '-'} unit="%" />
                      </div>
                    </div>
                  );
                })
              )}
            </div>
          )}

          {/* ── Section B: บันทึกแล้ว (HOSxP วันนี้) — header เฉพาะตอน central enabled ── */}
          {!loadingRecords && centralEnabled && (
            <div className="flex items-center gap-2 pt-4">
              <ClipboardList className="w-5 h-5 text-emerald-600" />
              <h2 className="text-lg font-bold text-slate-800">
                บันทึกแล้ว (HOSxP วันนี้) — <span className="text-emerald-600">{filteredRecords.length}</span>
              </h2>
            </div>
          )}

          {!loadingRecords && filteredRecords.length === 0 && (
            <div className="text-center py-12 bg-white rounded-xl shadow-sm">
              <ClipboardList className="w-12 h-12 mx-auto text-slate-300 mb-3" />
              <p className="text-slate-500">
                {records.length === 0 ? 'ยังไม่มีข้อมูลใน opdscreen วันนี้' : 'ไม่พบรายการที่ตรงกับตัวกรอง'}
              </p>
            </div>
          )}

          {!loadingRecords && filteredRecords.length > 0 && nurseViewMode === 'list' && (
            // ── List view ──
            <div className="bg-white rounded-xl shadow-sm overflow-x-auto">
              <div className="min-w-[860px]">
                <div className="grid grid-cols-12 gap-2 px-4 py-2 bg-slate-100 text-xs font-semibold text-slate-600 sticky top-0">
                  <div className="col-span-1">เวลา</div>
                  <div className="col-span-2">HN</div>
                  <div className="col-span-3">ชื่อ-สกุล</div>
                  <div className="col-span-2">ห้องตรวจ</div>
                  <div className="col-span-1 text-center">BP</div>
                  <div className="col-span-1 text-center">HR</div>
                  <div className="col-span-1 text-center">SpO₂</div>
                  <div className="col-span-1 text-center">สถานะ</div>
                </div>
                {filteredRecords.map((record) => {
                  const issues = getVitalStatus(record.vitals);
                  const isAbnormal = issues.length > 0;
                  const time = (record.dateTime || '').split(' ')[1] || '-';
                  return (
                    <div
                      key={record.id}
                      className={`grid grid-cols-12 gap-2 px-4 py-3 border-t border-slate-100 hover:bg-slate-50 text-sm ${isAbnormal ? 'bg-red-50/30' : ''}`}
                    >
                      <div className="col-span-1 text-slate-600 font-mono text-xs">{time.slice(0, 5)}</div>
                      <div className="col-span-2 font-mono text-xs text-slate-700">{record.patientId}</div>
                      <div className="col-span-3 truncate">{record.patientName || '-'}</div>
                      <div className="col-span-2 text-slate-600 truncate">{record.depName || '-'}</div>
                      <div className="col-span-1 text-center">
                        {record.vitals.bpSystolic && record.vitals.bpDiastolic
                          ? `${record.vitals.bpSystolic}/${record.vitals.bpDiastolic}`
                          : '-'}
                      </div>
                      <div className="col-span-1 text-center">{record.vitals.hr || '-'}</div>
                      <div className="col-span-1 text-center">{record.vitals.spo2 || '-'}</div>
                      <div className="col-span-1 text-center">
                        {isAbnormal ? (
                          <span className="bg-red-100 text-red-700 text-xs font-semibold px-2 py-0.5 rounded-full whitespace-nowrap">
                            {issues.join(',')}
                          </span>
                        ) : (
                          <span className="text-emerald-600 text-xs">ปกติ</span>
                        )}
                      </div>
                    </div>
                  );
                })}
              </div>
            </div>
          )}

          {!loadingRecords && filteredRecords.length > 0 && nurseViewMode !== 'list' && (
            // ── Card view ──
            <div className="space-y-4">
              {filteredRecords.map((record) => {
                const issues = getVitalStatus(record.vitals);
                const isAbnormal = issues.length > 0;
                return (
                  <div
                    key={record.id}
                    className={`bg-white rounded-xl shadow-sm border-l-4 ${isAbnormal ? 'border-red-500' : 'border-emerald-500'} p-5`}
                  >
                    <div className="flex items-start justify-between mb-3">
                      <div className="flex items-center gap-3">
                        <div className={`w-10 h-10 rounded-full flex items-center justify-center ${isAbnormal ? 'bg-red-100' : 'bg-emerald-100'}`}>
                          <User className={`w-5 h-5 ${isAbnormal ? 'text-red-600' : 'text-emerald-600'}`} />
                        </div>
                        <div>
                          <h3 className="font-bold text-slate-800">
                            HN: {record.patientId}
                            {record.patientName && (
                              <span className="font-normal text-slate-600 ml-2">— {record.patientName}</span>
                            )}
                          </h3>
                          <p className="text-xs text-slate-500">
                            visit: {record.dateTime}
                            {record.depName && <span className="ml-2">· ห้อง: <span className="text-slate-700">{record.depName}</span></span>}
                          </p>
                        </div>
                      </div>
                      <div className="flex items-center gap-2">
                        {record.vn && (
                          <span className="bg-slate-100 text-slate-600 text-xs font-mono px-2 py-1 rounded-full">
                            VN {record.vn}
                          </span>
                        )}
                        {isAbnormal && (
                          <span className="bg-red-100 text-red-700 text-xs font-semibold px-2 py-1 rounded-full flex items-center gap-1">
                            <AlertCircle className="w-3 h-3" />
                            ผิดปกติ: {issues.join(', ')}
                          </span>
                        )}
                      </div>
                    </div>
                    <div className="grid grid-cols-2 md:grid-cols-5 gap-3 text-sm">
                      <VitalBox label="BP" value={record.vitals.bpSystolic && record.vitals.bpDiastolic ? `${record.vitals.bpSystolic}/${record.vitals.bpDiastolic}` : '-'} unit="mmHg" />
                      <VitalBox label="HR" value={record.vitals.hr || '-'} unit="bpm" />
                      <VitalBox label="Temp" value={record.vitals.temp || '-'} unit="°C" />
                      <VitalBox label="RR" value={record.vitals.rr || '-'} unit="/min" />
                      <VitalBox label="SpO₂" value={record.vitals.spo2 || '-'} unit="%" />
                    </div>
                    {(record.vitals.weight || record.vitals.height) && (
                      <div className="grid grid-cols-3 gap-3 text-sm mt-3">
                        <VitalBox label="น้ำหนัก" value={record.vitals.weight || '-'} unit="kg" />
                        <VitalBox label="ส่วนสูง" value={record.vitals.height || '-'} unit="cm" />
                        <VitalBox
                          label="BMI"
                          value={record.vitals.weight && record.vitals.height ? (parseFloat(record.vitals.weight) / Math.pow(parseFloat(record.vitals.height) / 100, 2)).toFixed(1) : '-'}
                          unit="kg/m²"
                        />
                      </div>
                    )}
                  </div>
                );
              })}
            </div>
          )}
        </div>
      </div>
    );
  }

  // หน้าคนไข้
  return (
    <div className="min-h-screen bg-gradient-to-br from-slate-50 to-teal-50" style={{ fontFamily: "'Sarabun', 'Inter', sans-serif" }}>
      <div className="bg-gradient-to-r from-teal-700 to-emerald-600 text-white p-6 shadow-lg">
        <div className="max-w-2xl mx-auto flex items-center justify-between">
          <div className="flex items-center gap-3">
            <Activity className="w-8 h-8" />
            <div>
              <h1 className="text-2xl font-bold">บันทึก Vital Signs</h1>
              <p className="text-teal-100 text-sm">ถ่ายรูป slip → ระบบอ่านให้อัตโนมัติ</p>
            </div>
          </div>
          <div className="flex items-center gap-2">
            {session.userInfo?.name && (
              <div className="text-right text-xs text-teal-50 hidden md:block mr-1">
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

      <div className="max-w-2xl mx-auto p-6 space-y-6">
        {/* ข้อมูลคนไข้ */}
        <div className="bg-white rounded-xl shadow-sm p-5 space-y-3">
          <div className="flex items-center gap-2 mb-2">
            <User className="w-5 h-5 text-teal-600" />
            <h2 className="font-bold text-slate-800">ข้อมูลคนไข้</h2>
          </div>
          <div>
            <label className="text-xs text-slate-600 mb-1 block">HN / รหัสคนไข้ <span className="text-red-500">*</span></label>
            <div className="flex gap-2">
              <input
                type="text"
                value={patientId}
                onChange={(e) => setPatientId(e.target.value)}
                placeholder="เช่น HN12345"
                className="flex-1 px-3 py-2 border border-slate-200 rounded-lg focus:outline-none focus:ring-2 focus:ring-teal-500"
              />
              <button
                type="button"
                onClick={() => setScannerOpen(true)}
                title="สแกน barcode / QR"
                className="flex items-center gap-1 bg-teal-600 hover:bg-teal-700 text-white px-3 py-2 rounded-lg shadow transition"
              >
                <ScanBarcode className="w-4 h-4" />
                <span className="text-sm hidden sm:inline">สแกน</span>
              </button>
            </div>
          </div>
        </div>

        {/* อัปโหลดรูป */}
        <div className="bg-white rounded-xl shadow-sm p-5">
          <div className="flex items-center gap-2 mb-3">
            <Sparkles className="w-5 h-5 text-amber-500" />
            <h2 className="font-bold text-slate-800">ถ่ายรูป Slip (AI อ่านอัตโนมัติ)</h2>
          </div>

          {imagePreview ? (
            <div className="space-y-3">
              <div className="relative">
                <img src={imagePreview} alt="slip" className="w-full rounded-lg border border-slate-200" />
                {isProcessing && (
                  <div className="absolute inset-0 bg-white/80 rounded-lg flex flex-col items-center justify-center gap-2">
                    <Loader2 className="w-8 h-8 animate-spin text-teal-600" />
                    <p className="text-sm font-medium text-slate-700">OCR กำลังอ่านค่า...</p>
                  </div>
                )}
              </div>
              <button
                onClick={() => {
                  setImagePreview(null);
                  setImageBase64(null);
                  setMeasuredAt(null);
                  setMeasuredAtSource(null);
                  fileInputRef.current && (fileInputRef.current.value = '');
                  cameraInputRef.current && (cameraInputRef.current.value = '');
                }}
                className="text-sm text-slate-500 hover:text-red-600"
              >
                ลบรูปและถ่ายใหม่
              </button>
            </div>
          ) : (
            <div className="grid grid-cols-2 gap-3">
              <button
                onClick={() => cameraInputRef.current?.click()}
                className="flex flex-col items-center justify-center gap-2 p-6 border-2 border-dashed border-teal-300 rounded-lg hover:bg-teal-50 transition"
              >
                <Camera className="w-8 h-8 text-teal-600" />
                <span className="text-sm font-medium text-slate-700">ถ่ายรูป</span>
              </button>
              <button
                onClick={() => fileInputRef.current?.click()}
                className="flex flex-col items-center justify-center gap-2 p-6 border-2 border-dashed border-slate-300 rounded-lg hover:bg-slate-50 transition"
              >
                <Upload className="w-8 h-8 text-slate-600" />
                <span className="text-sm font-medium text-slate-700">เลือกรูป</span>
              </button>
            </div>
          )}

          <input
            ref={cameraInputRef}
            type="file"
            accept="image/*"
            capture="environment"
            onChange={handleImageUpload}
            className="hidden"
          />
          <input
            ref={fileInputRef}
            type="file"
            accept="image/*"
            onChange={handleImageUpload}
            className="hidden"
          />

          <p className="text-xs text-slate-500 mt-3">
            💡 ระบบใช้ OCR ในเบราว์เซอร์อ่านค่า BP, HR, Temp ฯลฯ จากรูปอัตโนมัติ — ครั้งแรกจะช้าหน่อย (โหลด engine ~10MB) คุณสามารถแก้ไขได้ก่อนส่ง
          </p>

          {measuredAt && (
            <div className="mt-3 bg-amber-50 border border-amber-200 rounded-lg p-3 flex items-center gap-2">
              <Sparkles className="w-4 h-4 text-amber-600 flex-shrink-0" />
              <div className="text-sm">
                <span className="text-slate-600">
                  วัดเมื่อ {measuredAtSource === 'slip' ? '(จาก slip)' : '(เวลาปัจจุบัน — slip ไม่มีวันเวลา)'}:{' '}
                </span>
                <span className="font-bold text-amber-800">{measuredAt}</span>
              </div>
            </div>
          )}
        </div>

        {/* ฟอร์ม vital signs */}
        <div className="bg-white rounded-xl shadow-sm p-5 space-y-4">
          <div className="flex items-center gap-2">
            <Activity className="w-5 h-5 text-teal-600" />
            <h2 className="font-bold text-slate-800">Vital Signs</h2>
          </div>

          {/* BP */}
          <div>
            <label className="flex items-center gap-2 text-sm font-medium text-slate-700 mb-1">
              <Heart className="w-4 h-4 text-red-500" />
              ความดันโลหิต (BP) <span className="text-xs text-slate-400">mmHg</span>
            </label>
            <div className="flex items-center gap-2">
              <input
                type="number"
                value={vitals.bpSystolic}
                onChange={(e) => handleVitalChange('bpSystolic', e.target.value)}
                placeholder="120"
                className="flex-1 px-3 py-2 border border-slate-200 rounded-lg focus:outline-none focus:ring-2 focus:ring-teal-500"
              />
              <span className="text-slate-400 font-bold">/</span>
              <input
                type="number"
                value={vitals.bpDiastolic}
                onChange={(e) => handleVitalChange('bpDiastolic', e.target.value)}
                placeholder="80"
                className="flex-1 px-3 py-2 border border-slate-200 rounded-lg focus:outline-none focus:ring-2 focus:ring-teal-500"
              />
            </div>
          </div>

          <div className="grid grid-cols-2 gap-3">
            {/* HR */}
            <div>
              <label className="flex items-center gap-2 text-sm font-medium text-slate-700 mb-1">
                <Activity className="w-4 h-4 text-pink-500" />
                ชีพจร (HR) <span className="text-xs text-slate-400">bpm</span>
              </label>
              <input
                type="number"
                value={vitals.hr}
                onChange={(e) => handleVitalChange('hr', e.target.value)}
                placeholder="72"
                className="w-full px-3 py-2 border border-slate-200 rounded-lg focus:outline-none focus:ring-2 focus:ring-teal-500"
              />
            </div>
            {/* Temp */}
            <div>
              <label className="flex items-center gap-2 text-sm font-medium text-slate-700 mb-1">
                <Thermometer className="w-4 h-4 text-orange-500" />
                อุณหภูมิ <span className="text-xs text-slate-400">°C</span>
              </label>
              <input
                type="number"
                step="0.1"
                value={vitals.temp}
                onChange={(e) => handleVitalChange('temp', e.target.value)}
                placeholder="36.8"
                className="w-full px-3 py-2 border border-slate-200 rounded-lg focus:outline-none focus:ring-2 focus:ring-teal-500"
              />
            </div>
            {/* RR */}
            <div>
              <label className="flex items-center gap-2 text-sm font-medium text-slate-700 mb-1">
                <Wind className="w-4 h-4 text-sky-500" />
                อัตราการหายใจ (RR) <span className="text-xs text-slate-400">/นาที</span>
              </label>
              <input
                type="number"
                value={vitals.rr}
                onChange={(e) => handleVitalChange('rr', e.target.value)}
                placeholder="18"
                className="w-full px-3 py-2 border border-slate-200 rounded-lg focus:outline-none focus:ring-2 focus:ring-teal-500"
              />
            </div>
            {/* SpO2 */}
            <div>
              <label className="flex items-center gap-2 text-sm font-medium text-slate-700 mb-1">
                <Droplet className="w-4 h-4 text-blue-500" />
                SpO₂ <span className="text-xs text-slate-400">%</span>
              </label>
              <input
                type="number"
                value={vitals.spo2}
                onChange={(e) => handleVitalChange('spo2', e.target.value)}
                placeholder="98"
                className="w-full px-3 py-2 border border-slate-200 rounded-lg focus:outline-none focus:ring-2 focus:ring-teal-500"
              />
            </div>
            {/* Weight */}
            <div>
              <label className="flex items-center gap-2 text-sm font-medium text-slate-700 mb-1">
                <Scale className="w-4 h-4 text-violet-500" />
                น้ำหนัก <span className="text-xs text-slate-400">kg</span>
              </label>
              <input
                type="number"
                step="0.1"
                value={vitals.weight}
                onChange={(e) => handleVitalChange('weight', e.target.value)}
                placeholder="65"
                className="w-full px-3 py-2 border border-slate-200 rounded-lg focus:outline-none focus:ring-2 focus:ring-teal-500"
              />
            </div>
            {/* Height */}
            <div>
              <label className="flex items-center gap-2 text-sm font-medium text-slate-700 mb-1">
                <Ruler className="w-4 h-4 text-lime-600" />
                ส่วนสูง <span className="text-xs text-slate-400">cm</span>
              </label>
              <input
                type="number"
                step="0.1"
                value={vitals.height}
                onChange={(e) => handleVitalChange('height', e.target.value)}
                placeholder="170"
                className="w-full px-3 py-2 border border-slate-200 rounded-lg focus:outline-none focus:ring-2 focus:ring-teal-500"
              />
            </div>
          </div>

          {/* BMI auto */}
          {vitals.weight && vitals.height && (() => {
            const h = parseFloat(vitals.height) / 100;
            const w = parseFloat(vitals.weight);
            if (h > 0 && w > 0) {
              const bmi = (w / (h * h)).toFixed(1);
              let label = '', color = '';
              if (bmi < 18.5) { label = 'น้ำหนักน้อย'; color = 'bg-sky-50 text-sky-700'; }
              else if (bmi < 23) { label = 'ปกติ'; color = 'bg-emerald-50 text-emerald-700'; }
              else if (bmi < 25) { label = 'ท้วม'; color = 'bg-amber-50 text-amber-700'; }
              else if (bmi < 30) { label = 'อ้วน'; color = 'bg-orange-50 text-orange-700'; }
              else { label = 'อ้วนมาก'; color = 'bg-red-50 text-red-700'; }
              return (
                <div className={`mt-3 rounded-lg p-3 flex items-center justify-between ${color}`}>
                  <span className="text-sm font-medium">BMI</span>
                  <span className="font-bold">{bmi} <span className="text-xs font-normal">({label})</span></span>
                </div>
              );
            }
            return null;
          })()}
        </div>

        {/* แจ้งสถานะ */}
        {submitStatus && (
          <div className={`rounded-lg p-4 flex items-center gap-3 ${submitStatus.type === 'success' ? 'bg-emerald-50 text-emerald-800' : 'bg-red-50 text-red-800'}`}>
            {submitStatus.type === 'success' ? <CheckCircle2 className="w-5 h-5" /> : <AlertCircle className="w-5 h-5" />}
            <span className="text-sm font-medium">{submitStatus.message}</span>
          </div>
        )}

        {/* ปุ่มส่ง */}
        <button
          onClick={handleSubmit}
          disabled={isProcessing}
          className="w-full bg-gradient-to-r from-teal-600 to-emerald-600 hover:from-teal-700 hover:to-emerald-700 disabled:opacity-50 text-white font-bold py-4 rounded-xl shadow-lg flex items-center justify-center gap-2 transition"
        >
          <Send className="w-5 h-5" />
          ส่งให้พยาบาล
        </button>
      </div>

      <BarcodeScanner
        open={scannerOpen}
        onResult={(text) => {
          setPatientId(String(text || '').trim());
          setScannerOpen(false);
        }}
        onClose={() => setScannerOpen(false)}
      />
    </div>
  );
}

function VitalBox({ label, value, unit }) {
  return (
    <div className="bg-slate-50 rounded-lg p-2 text-center">
      <div className="text-xs text-slate-500 font-medium">{label}</div>
      <div className="font-bold text-slate-800">{value}</div>
      <div className="text-xs text-slate-400">{unit}</div>
    </div>
  );
}

// Local "now" formatted to match the slip-extracted shape ("YYYY-MM-DD HH:mm").
function formatNowAsMeasuredAt() {
  const d = new Date();
  const pad = (n) => String(n).padStart(2, '0');
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())} ${pad(d.getHours())}:${pad(d.getMinutes())}`;
}

// Extract vital signs from OCR text. Tesseract emits the slip as a single
// blob of newline-separated text; we look for label tokens (SYS/DIA/PR/etc.)
// followed by a number, allowing the number to land on the next line.
function parseVitalsFromOcrText(text) {
  const T = (text || '').replace(/ /g, ' ');
  const result = {};

  const patterns = {
    bpSystolic:  /\b(?:SYS|SYSTOLIC)\b\s*[:=]?\s*(\d{2,3})/i,
    bpDiastolic: /\b(?:DIA|DIASTOLIC)\b\s*[:=]?\s*(\d{2,3})/i,
    // Trailing `\b` was wrong for dotted prefixes like "P.R." — there's no
    // word boundary between two non-word chars (".", " "). Use [\s.:=]+ instead.
    hr:          /\b(?:P\.?\s*R\.?|PULSE|HR|HEART\s*RATE|BPM)[\s.:=]+(\d{2,3})/i,
    temp:        /\b(?:TEMP|TEMPERATURE)\b\s*[:=]?\s*(\d{2,3}(?:\.\d{1,2})?)/i,
    rr:          /\b(?:RR|RESP|RESPIRATION)\b\s*[:=]?\s*(\d{1,3})/i,
    spo2:        /\b(?:SpO2|SPO2|O2\s*SAT|OXYGEN)\b\s*[:=]?\s*(\d{2,3})/i,
    weight:      /\b(?:WEIGHT|WT|BW)\b\s*[:=]?\s*(\d{2,3}(?:\.\d{1,2})?)/i,
    height:      /\b(?:HEIGHT|HT)\b\s*[:=]?\s*(\d{2,3}(?:\.\d{1,2})?)/i,
  };

  for (const [key, re] of Object.entries(patterns)) {
    const m = T.match(re);
    if (m) {
      const v = parseFloat(m[1]);
      if (Number.isFinite(v)) result[key] = v;
    }
  }

  // Date+time. Be tolerant of OCR quirks:
  //   * date separators: "/" "-" "." " " (Tesseract sometimes drops slashes)
  //   * time separator: ":" "." " " (the colon is often misread as a dot or
  //     swallowed entirely)
  //   * date and time may land on different lines — \s+ covers newlines
  const dt =
    T.match(/(\d{4})[-/.\s](\d{1,2})[-/.\s](\d{1,2})\s+(\d{1,2})[:.\s](\d{2})/) ||
    // Fallback for compact times like "0830" with no separator
    T.match(/(\d{4})[-/.\s](\d{1,2})[-/.\s](\d{1,2})\s+(\d{2})(\d{2})\b/);
  if (dt) {
    const [, y, mo, d, h, mi] = dt;
    const hh = parseInt(h, 10);
    const mm = parseInt(mi, 10);
    if (hh >= 0 && hh <= 23 && mm >= 0 && mm <= 59) {
      result.measuredAt = `${y}-${String(mo).padStart(2, '0')}-${String(d).padStart(2, '0')} ${String(hh).padStart(2, '0')}:${String(mm).padStart(2, '0')}`;
    }
  }

  return result;
}

export default function VitalSignsApp() {
  return (
    <BmsSessionProvider>
      <SessionValidator>
        <VitalSignsAppInner />
      </SessionValidator>
    </BmsSessionProvider>
  );
}
