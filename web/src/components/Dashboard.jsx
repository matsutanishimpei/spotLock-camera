import React, { useState, useEffect, useRef } from 'react';
import { verifySpotLockPhoto, getRelativeTimeString, toHexString } from '../utils/crypto';

// ----------------------------------------------------
// IndexedDB Helpers for File System Access API handles
// ----------------------------------------------------
function openHandlesDB() {
    return new Promise((resolve, reject) => {
        const request = indexedDB.open("SpotLockHandlesDB", 1);
        request.onupgradeneeded = (e) => {
            const db = e.target.result;
            db.createObjectStore("handles");
        };
        request.onsuccess = (e) => resolve(e.target.result);
        request.onerror = (e) => reject(e.target.error);
    });
}

async function saveFileHandle(handle) {
    try {
        const db = await openHandlesDB();
        return new Promise((resolve, reject) => {
            const tx = db.transaction("handles", "readwrite");
            const store = tx.objectStore("handles");
            const req = store.put(handle, "students_json");
            req.onsuccess = () => resolve();
            req.onerror = () => reject(req.error);
        });
    } catch (err) {
        console.error("Failed to save handle in IndexedDB", err);
    }
}

async function getFileHandle() {
    try {
        const db = await openHandlesDB();
        return new Promise((resolve, reject) => {
            const tx = db.transaction("handles", "readonly");
            const store = tx.objectStore("handles");
            const req = store.get("students_json");
            req.onsuccess = () => resolve(req.result);
            req.onerror = () => reject(req.error);
        });
    } catch (err) {
        console.error("Failed to read handle from IndexedDB", err);
        return null;
    }
}

async function clearFileHandle() {
    try {
        const db = await openHandlesDB();
        return new Promise((resolve, reject) => {
            const tx = db.transaction("handles", "readwrite");
            const store = tx.objectStore("handles");
            const req = store.delete("students_json");
            req.onsuccess = () => resolve();
            req.onerror = () => reject(req.error);
        });
    } catch (err) {
        console.error("Failed to clear handle from IndexedDB", err);
    }
}

async function verifyPermission(fileHandle, readWrite) {
    const options = {};
    if (readWrite) {
        options.mode = 'readwrite';
    }
    if ((await fileHandle.queryPermission(options)) === 'granted') {
        return true;
    }
    if ((await fileHandle.requestPermission(options)) === 'granted') {
        return true;
    }
    return false;
}

// ----------------------------------------------------
// CSV Serialization / Deserialization Helpers
// ----------------------------------------------------
function studentsToCsv(students) {
    const headers = [
        "id", "name", "station", "transitTimeA", "transitTimeB", 
        "targetTimeA", "targetTimeB", "selectedRoute", "status", 
        "checkTime", "checkTimeRaw", "signatureValid", "publicKey"
    ];
    
    const escapeCsvValue = (val) => {
        if (val === null || val === undefined) return '';
        let str = String(val);
        if (str.includes(',') || str.includes('"') || str.includes('\n') || str.includes('\r')) {
            str = '"' + str.replace(/"/g, '""') + '"';
        }
        return str;
    };

    const csvRows = [];
    csvRows.push(headers.join(','));

    for (const student of students) {
        const values = headers.map(header => escapeCsvValue(student[header]));
        csvRows.push(values.join(','));
    }

    // Include UTF-8 BOM
    return '\uFEFF' + csvRows.join('\r\n');
}

function csvToStudents(csvText) {
    if (csvText.startsWith('\uFEFF')) {
        csvText = csvText.substring(1);
    }

    const lines = [];
    let row = [""];
    let inQuotes = false;

    for (let i = 0; i < csvText.length; i++) {
        const c = csvText[i];
        const next = csvText[i + 1];
        if (c === '"') {
            if (inQuotes && next === '"') {
                row[row.length - 1] += '"';
                i++;
            } else {
                inQuotes = !inQuotes;
            }
        } else if (c === ',' && !inQuotes) {
            row.push('');
        } else if ((c === '\r' || c === '\n') && !inQuotes) {
            if (c === '\r' && next === '\n') {
                i++;
            }
            lines.push(row);
            row = [""];
        } else {
            row[row.length - 1] += c;
        }
    }
    if (row.length > 1 || row[0] !== '') {
        lines.push(row);
    }

    if (lines.length < 2) return [];

    const headers = lines[0].map(h => h.trim());
    const students = [];

    for (let i = 1; i < lines.length; i++) {
        const line = lines[i];
        if (line.length < headers.length) continue;
        
        const student = {};
        headers.forEach((header, index) => {
            let val = line[index];
            if (val === undefined) {
                student[header] = null;
                return;
            }
            val = val.trim();
            if (header === 'transitTimeA' || header === 'transitTimeB') {
                student[header] = val === '' ? 0 : Number(val);
            } else if (header === 'checkTimeRaw') {
                student[header] = val === '' ? null : Number(val);
            } else if (header === 'signatureValid') {
                student[header] = val === 'true' ? true : (val === 'false' ? false : null);
            } else if (header === 'publicKey') {
                student[header] = val === '' ? null : val;
            } else {
                student[header] = val;
            }
        });
        
        if (student.id && student.name) {
            students.push(student);
        }
    }

    return students;
}

export default function Dashboard() {
    // ----------------------------------------------------
    // State Management
    // ----------------------------------------------------
    const [students, setStudents] = useState([]);
    const [globalStationA, setGlobalStationA] = useState('渋谷駅');
    const [globalWalkTimeA, setGlobalWalkTimeA] = useState(10);
    const [globalStationB, setGlobalStationB] = useState('表参道駅');
    const [globalWalkTimeB, setGlobalWalkTimeB] = useState(10);
    const [globalClassTime, setGlobalClassTime] = useState('09:00');

    // Sync File handle states
    const [syncFileHandle, setSyncFileHandle] = useState(null);
    const [syncFileName, setSyncFileName] = useState('');

    // Form inputs
    const [formId, setFormId] = useState('');
    const [formName, setFormName] = useState('');
    const [formStation, setFormStation] = useState('');
    const [formTransitTimeA, setFormTransitTimeA] = useState('');
    const [formTransitTimeB, setFormTransitTimeB] = useState('');
    const [formTargetTimeA, setFormTargetTimeA] = useState('');
    const [formTargetTimeB, setFormTargetTimeB] = useState('');
    const [formPublicKey, setFormPublicKey] = useState('');
    const [lastLookup, setLastLookup] = useState({ from: '', toA: '', toB: '' });
    const [calcLookupNoteA, setCalcLookupNoteA] = useState('');
    const [calcLookupNoteB, setCalcLookupNoteB] = useState('');

    // Detailed photo verification state (Tab 2)
    const [detailedPhotoInfo, setDetailedPhotoInfo] = useState(null);
    const [detailedLoading, setDetailedLoading] = useState(false);
    const [assignStudentId, setAssignStudentId] = useState('');

    // Object URLs for session thumbnails
    const [sessionPhotoUrls, setSessionPhotoUrls] = useState({});

    // Modal state
    const [selectedStudentModal, setSelectedStudentModal] = useState(null);

    // Toasts
    const [toasts, setToasts] = useState([]);

    // Tab control (Internal component state, App handles desktop/mobile, Dashboard handles nested panels)
    const [activePanel, setActivePanel] = useState('dashboard');

    const fileInputRef = useRef(null);

    // Normalized travel database
    const MOCK_TRANSIT_DATABASE = {
        "新宿": { "渋谷": 7, "池袋": 6, "東京": 14, "品川": 19, "上野": 25, "秋葉原": 18, "吉祥寺": 15, "横浜": 30 },
        "渋谷": { "新宿": 7, "池袋": 11, "東京": 22, "品川": 12, "表参道": 2, "吉祥寺": 16, "横浜": 28 },
        "池袋": { "新宿": 6, "渋谷": 11, "東京": 16, "上野": 16, "秋葉原": 20, "吉祥寺": 22 },
        "東京": { "新宿": 14, "渋谷": 22, "池袋": 16, "品川": 10, "上野": 7, "秋葉原": 4, "横浜": 25 },
        "品川": { "新宿": 19, "渋谷": 12, "東京": 10, "横浜": 20 },
        "上野": { "新宿": 25, "東京": 7, "池袋": 16, "秋葉原": 3 },
        "秋葉原": { "新宿": 18, "池袋": 20, "東京": 4, "上野": 3 },
        "吉祥寺": { "新宿": 15, "渋谷": 16, "東京": 29 },
        "横浜": { "渋谷": 28, "品川": 20, "東京": 25, "新宿": 30 }
    };

    // Helper to normalize older schema datasets
    const normalizeLoadedStudents = (data, defaultStationA, defaultStationB) => {
        if (!Array.isArray(data)) return [];
        return data.map(s => {
            const transitTimeA = s.transitTimeA !== undefined ? s.transitTimeA : (s.transitTime !== undefined ? s.transitTime : '');
            const transitTimeB = s.transitTimeB !== undefined ? s.transitTimeB : (s.transitTime !== undefined ? s.transitTime : '');
            const targetTimeA = s.targetTimeA || s.targetTime || '09:00';
            const targetTimeB = s.targetTimeB || s.targetTime || '09:00';
            const selectedRoute = s.selectedRoute || 'A';
            const schoolStation = s.schoolStation || defaultStationA;
            return {
                ...s,
                transitTimeA,
                transitTimeB,
                targetTimeA,
                targetTimeB,
                selectedRoute,
                schoolStation
            };
        });
    };

    // ----------------------------------------------------
    // Life Cycle & LocalStorage / File Handle loading
    // ----------------------------------------------------
    useEffect(() => {
        // Load settings
        const stationA = localStorage.getItem('spotlock_global_school_station_a') || '渋谷駅';
        const walkA = localStorage.getItem('spotlock_global_walk_time_a') || '10';
        const stationB = localStorage.getItem('spotlock_global_school_station_b') || '表参道駅';
        const walkB = localStorage.getItem('spotlock_global_walk_time_b') || '10';
        const time = localStorage.getItem('spotlock_global_class_time') || '09:00';

        setGlobalStationA(stationA);
        setGlobalWalkTimeA(Number(walkA));
        setGlobalStationB(stationB);
        setGlobalWalkTimeB(Number(walkB));
        setGlobalClassTime(time);

        // Load students (with automatic file restore attempt)
        async function initData() {
            try {
                const handle = await getFileHandle();
                if (handle) {
                    const hasPermission = await verifyPermission(handle, true);
                    if (hasPermission) {
                        const file = await handle.getFile();
                        const text = await file.text();
                        const data = csvToStudents(text);
                        const normalized = normalizeLoadedStudents(data, stationA, stationB);
                        setStudents(normalized);
                        setSyncFileHandle(handle);
                        setSyncFileName(handle.name);
                        showToast(`ファイルから同期しました: ${handle.name}`, 'success');
                        return;
                    }
                }
            } catch (err) {
                console.error("Failed to restore file handle or read file", err);
                showToast("ファイル同期の再開に失敗しました。再設定してください。", "warning");
            }

            // Fallback to localStorage
            const stored = localStorage.getItem('spotlock_students');
            if (stored) {
                try {
                    const data = JSON.parse(stored);
                    setStudents(normalizeLoadedStudents(data, stationA, stationB));
                } catch (e) {
                    console.error("Failed to parse students from localStorage", e);
                }
            } else {
                const initialMock = [
                    { id: 'mock-1', name: '佐藤 優太', station: '新宿駅', transitTimeA: 7, transitTimeB: 15, targetTimeA: '08:43', targetTimeB: '08:40', selectedRoute: 'A', status: 'unverified', checkTime: null, checkTimeRaw: null, signatureValid: null },
                    { id: 'mock-2', name: '鈴木 美咲', station: '渋谷駅', transitTimeA: 0, transitTimeB: 2, targetTimeA: '08:50', targetTimeB: '08:53', selectedRoute: 'A', status: 'unverified', checkTime: null, checkTimeRaw: null, signatureValid: null },
                    { id: 'mock-3', name: '高橋 健太', station: '池袋駅', transitTimeA: 11, transitTimeB: 22, targetTimeA: '08:39', targetTimeB: '08:33', selectedRoute: 'A', status: 'unverified', checkTime: null, checkTimeRaw: null, signatureValid: null }
                ];
                setStudents(initialMock);
                localStorage.setItem('spotlock_students', JSON.stringify(initialMock));
            }
        }
        initData();

        // Clean up object URLs on unmount
        return () => {
            Object.values(sessionPhotoUrls).forEach(url => URL.revokeObjectURL(url));
        };
    }, []);

    // Save students when updated (with automatic CSV file write if synced)
    const updateStudentsState = async (newStudents) => {
        setStudents(newStudents);
        localStorage.setItem('spotlock_students', JSON.stringify(newStudents));

        if (syncFileHandle) {
            try {
                const hasPermission = await verifyPermission(syncFileHandle, true);
                if (hasPermission) {
                    const writable = await syncFileHandle.createWritable();
                    const csvContent = studentsToCsv(newStudents);
                    await writable.write(csvContent);
                    await writable.close();
                } else {
                    showToast("ファイルへの書き込み権限がないため、自動セーブが失敗しました。", "error");
                }
            } catch (err) {
                console.error("Failed to write updated students to file", err);
                showToast(`ファイルへの書き込みエラー: ${err.message}`, "error");
            }
        }
    };

    // Recalculate transit times for both routes when inputs change
    useEffect(() => {
        const from = normalizeStation(formStation);
        const toA = normalizeStation(globalStationA);
        const toB = normalizeStation(globalStationB);

        let detectedA = null;
        let detectedB = null;

        if (from && toA && MOCK_TRANSIT_DATABASE[from] && MOCK_TRANSIT_DATABASE[from][toA]) {
            detectedA = MOCK_TRANSIT_DATABASE[from][toA];
        }
        if (from && toB && MOCK_TRANSIT_DATABASE[from] && MOCK_TRANSIT_DATABASE[from][toB]) {
            detectedB = MOCK_TRANSIT_DATABASE[from][toB];
        }

        if (lastLookup.from !== from || lastLookup.toA !== toA || lastLookup.toB !== toB) {
            if (detectedA !== null) setFormTransitTimeA(detectedA);
            if (detectedB !== null) setFormTransitTimeB(detectedB);
            setLastLookup({ from, toA, toB });
        }

        if (detectedA !== null) {
            setCalcLookupNoteA(`✓ 自動設定: ${from}駅 ➔ 駅A (${detectedA}分)`);
        } else {
            setCalcLookupNoteA('');
        }

        if (detectedB !== null) {
            setCalcLookupNoteB(`✓ 自動設定: ${from}駅 ➔ 駅B (${detectedB}分)`);
        } else {
            setCalcLookupNoteB('');
        }
    }, [formStation, globalStationA, globalStationB]);

    // Recalculate target times when transit times or settings change
    useEffect(() => {
        // Route A Target
        if (formTransitTimeA === '') {
            setFormTargetTimeA('');
        } else {
            const transit = Number(formTransitTimeA) || 0;
            const totalOffset = globalWalkTimeA + transit;
            const [hours, minutes] = globalClassTime.split(':').map(Number);
            let totalMinutes = hours * 60 + minutes - totalOffset;
            if (totalMinutes < 0) totalMinutes += 24 * 60;
            const targetHours = Math.floor(totalMinutes / 60) % 24;
            const targetMinutes = totalMinutes % 60;
            setFormTargetTimeA(`${String(targetHours).padStart(2, '0')}:${String(targetMinutes).padStart(2, '0')}`);
        }

        // Route B Target
        if (formTransitTimeB === '') {
            setFormTargetTimeB('');
        } else {
            const transit = Number(formTransitTimeB) || 0;
            const totalOffset = globalWalkTimeB + transit;
            const [hours, minutes] = globalClassTime.split(':').map(Number);
            let totalMinutes = hours * 60 + minutes - totalOffset;
            if (totalMinutes < 0) totalMinutes += 24 * 60;
            const targetHours = Math.floor(totalMinutes / 60) % 24;
            const targetMinutes = totalMinutes % 60;
            setFormTargetTimeB(`${String(targetHours).padStart(2, '0')}:${String(targetMinutes).padStart(2, '0')}`);
        }
    }, [formTransitTimeA, formTransitTimeB, globalClassTime, globalWalkTimeA, globalWalkTimeB]);

    // ----------------------------------------------------
    // Helper Functions
    // ----------------------------------------------------
    const normalizeStation = (stationName) => {
        if (!stationName) return '';
        return stationName.trim().replace(/駅$/, '');
    };

    const showToast = (message, type = 'info') => {
        const id = Date.now() + Math.random().toString(36).substr(2, 5);
        setToasts(prev => [...prev, { id, message, type }]);
        setTimeout(() => {
            setToasts(prev => prev.filter(t => t.id !== id));
        }, 4000);
    };

    const getStatusLabel = (status) => {
        switch (status) {
            case 'ontime': return '間に合った';
            case 'late': return '遅刻';
            case 'invalid_sig': return '署名不正(改ざん)';
            case 'error': return '検証エラー';
            case 'wrong_date': return '日付違い';
            default: return '未検証';
        }
    };

    const getCaptureTimeInfo = (timestamp, targetTime) => {
        const date = new Date(timestamp);
        const hours = String(date.getHours()).padStart(2, '0');
        const minutes = String(date.getMinutes()).padStart(2, '0');
        const timeStr = `${hours}:${minutes}`;
        const onTime = timeStr <= targetTime;

        const today = new Date();
        const isToday = today.getFullYear() === date.getFullYear() &&
                        today.getMonth() === date.getMonth() &&
                        today.getDate() === date.getDate();

        const dateLabel = isToday ? '本日' : `${date.getMonth() + 1}/${date.getDate()}`;
        const formattedTime = `${hours}:${minutes}:${String(date.getSeconds()).padStart(2, '0')}`;

        return {
            timeStr,
            onTime,
            timeDisplay: `${dateLabel} ${formattedTime}`
        };
    };

    // ----------------------------------------------------
    // Settings & Actions
    // ----------------------------------------------------
    const handleGlobalSettingsChange = (stationA, walkA, stationB, walkB, time) => {
        setGlobalStationA(stationA);
        setGlobalWalkTimeA(Number(walkA));
        setGlobalStationB(stationB);
        setGlobalWalkTimeB(Number(walkB));
        setGlobalClassTime(time);

        localStorage.setItem('spotlock_global_school_station_a', stationA);
        localStorage.setItem('spotlock_global_walk_time_a', walkA);
        localStorage.setItem('spotlock_global_school_station_b', stationB);
        localStorage.setItem('spotlock_global_walk_time_b', walkB);
        localStorage.setItem('spotlock_global_class_time', time);
        showToast('学校の共通設定を保存しました。', 'success');
    };

    // Form Submissions
    const handleSaveStudent = (e) => {
        e.preventDefault();
        if (!formName.trim() || !formStation.trim() || !formTargetTimeA || !formTargetTimeB) return;

        if (formId) {
            // Edit
            const updated = students.map(s => {
                if (s.id === formId) {
                    let nextStatus = s.status;
                    let nextCheckTime = s.checkTime;
                    if ((s.status === 'ontime' || s.status === 'late') && s.checkTimeRaw) {
                        const targetTime = s.selectedRoute === 'B' ? formTargetTimeB : formTargetTimeA;
                        const timeInfo = getCaptureTimeInfo(s.checkTimeRaw, targetTime);
                        nextStatus = timeInfo.onTime ? 'ontime' : 'late';
                        nextCheckTime = timeInfo.timeDisplay;
                    }
                    return {
                        ...s,
                        name: formName,
                        station: formStation,
                        transitTimeA: Number(formTransitTimeA) || 0,
                        transitTimeB: Number(formTransitTimeB) || 0,
                        targetTimeA: formTargetTimeA,
                        targetTimeB: formTargetTimeB,
                        status: nextStatus,
                        checkTime: nextCheckTime,
                        publicKey: formPublicKey.trim() || null
                    };
                }
                return s;
            });
            updateStudentsState(updated);
            showToast(`${formName} さんの情報を更新しました。`, 'success');
            handleCancelEdit();
        } else {
            // Add
            const newStudent = {
                id: 'stud-' + Date.now() + Math.random().toString(36).substr(2, 5),
                name: formName,
                station: formStation,
                transitTimeA: Number(formTransitTimeA) || 0,
                transitTimeB: Number(formTransitTimeB) || 0,
                targetTimeA: formTargetTimeA,
                targetTimeB: formTargetTimeB,
                selectedRoute: 'A',
                status: 'unverified',
                checkTime: null,
                checkTimeRaw: null,
                signatureValid: null,
                publicKey: formPublicKey.trim() || null
            };
            updateStudentsState([...students, newStudent]);
            showToast(`${formName} さんを新規追加しました。`, 'success');
            resetForm();
        }
    };

    const startEditStudent = (student) => {
        setFormId(student.id);
        setFormName(student.name);
        setFormStation(student.station);
        setFormTransitTimeA(student.transitTimeA !== undefined ? student.transitTimeA : '');
        setFormTransitTimeB(student.transitTimeB !== undefined ? student.transitTimeB : '');
        setFormTargetTimeA(student.targetTimeA || '');
        setFormTargetTimeB(student.targetTimeB || '');
        setFormPublicKey(student.publicKey || '');
    };

    const handleCancelEdit = () => {
        resetForm();
    };

    const resetForm = () => {
        setFormId('');
        setFormName('');
        setFormStation('');
        setFormTransitTimeA('');
        setFormTransitTimeB('');
        setFormTargetTimeA('');
        setFormTargetTimeB('');
        setFormPublicKey('');
        setCalcLookupNoteA('');
        setCalcLookupNoteB('');
    };

    const handleDeleteStudent = (student) => {
        if (confirm(`${student.name} さんのデータを削除しますか？`)) {
            const updated = students.filter(s => s.id !== student.id);
            if (sessionPhotoUrls[student.id]) {
                URL.revokeObjectURL(sessionPhotoUrls[student.id]);
                const nextUrls = { ...sessionPhotoUrls };
                delete nextUrls[student.id];
                setSessionPhotoUrls(nextUrls);
            }
            if (formId === student.id) {
                handleCancelEdit();
            }
            updateStudentsState(updated);
            showToast('学生データを削除しました。', 'info');
        }
    };

    const handleResetStatus = (student) => {
        const updated = students.map(s => {
            if (s.id === student.id) {
                return { ...s, status: 'unverified', checkTime: null, checkTimeRaw: null, signatureValid: null };
            }
            return s;
        });
        if (sessionPhotoUrls[student.id]) {
            URL.revokeObjectURL(sessionPhotoUrls[student.id]);
            const nextUrls = { ...sessionPhotoUrls };
            delete nextUrls[student.id];
            setSessionPhotoUrls(nextUrls);
        }
        updateStudentsState(updated);
        showToast(`${student.name} さんの登校状況をリセットしました。`, 'info');
    };

    const handleResetAllStatuses = () => {
        if (confirm('本日のすべての学生の判定状況をリセットして未検証にしますか？')) {
            const updated = students.map(s => ({
                ...s, status: 'unverified', checkTime: null, checkTimeRaw: null, signatureValid: null
            }));
            Object.values(sessionPhotoUrls).forEach(url => URL.revokeObjectURL(url));
            setSessionPhotoUrls({});
            updateStudentsState(updated);
            showToast('全員の判定状況をリセットしました。', 'info');
        }
    };

    const handleClearAllStudents = () => {
        if (confirm('本当にすべての学生データを削除しますか？（この操作は元に戻せません）')) {
            Object.values(sessionPhotoUrls).forEach(url => URL.revokeObjectURL(url));
            setSessionPhotoUrls({});
            updateStudentsState([]);
            resetForm();
            showToast('すべての学生データを削除しました。', 'error');
        }
    };

    const handleLoadMockStudents = () => {
        if (confirm('デモデータ（模擬的な学生3名）を上書きロードしますか？（現在のリストは上書きされます）')) {
            Object.values(sessionPhotoUrls).forEach(url => URL.revokeObjectURL(url));
            setSessionPhotoUrls({});
            const mock = [
                { id: 'mock-yuta', name: '佐藤 優太', station: '新宿駅', transitTimeA: 7, transitTimeB: 15, targetTimeA: '08:43', targetTimeB: '08:40', selectedRoute: 'A', status: 'unverified', checkTime: null, checkTimeRaw: null, signatureValid: null },
                { id: 'mock-misaki', name: '鈴木 美咲', station: '渋谷駅', transitTimeA: 0, transitTimeB: 2, targetTimeA: '08:50', targetTimeB: '08:53', selectedRoute: 'A', status: 'unverified', checkTime: null, checkTimeRaw: null, signatureValid: null },
                { id: 'mock-kenta', name: '高橋 健太', station: '池袋駅', transitTimeA: 11, transitTimeB: 22, targetTimeA: '08:39', targetTimeB: '08:33', selectedRoute: 'A', status: 'unverified', checkTime: null, checkTimeRaw: null, signatureValid: null }
            ];
            updateStudentsState(mock);
            showToast('デモデータをロードしました。', 'success');
        }
    };

    // ----------------------------------------------------
    // CSV Data Sync & Import/Export Actions
    // ----------------------------------------------------
    const handleConnectSyncFile = async () => {
        try {
            if (!window.showOpenFilePicker) {
                showToast("お使いのブラウザは File System API に対応していません。インポート/エクスポート機能をご利用ください。", "error");
                return;
            }

            const [handle] = await window.showOpenFilePicker({
                types: [{
                    description: 'CSV Files',
                    accept: {
                        'text/csv': ['.csv']
                    }
                }],
                excludeAcceptAllOption: true,
                multiple: false
            });

            const hasPermission = await verifyPermission(handle, true);
            if (hasPermission) {
                await saveFileHandle(handle);
                setSyncFileHandle(handle);
                setSyncFileName(handle.name);

                // Load initial data from the file
                const file = await handle.getFile();
                const text = await file.text();
                const data = csvToStudents(text);
                const normalized = normalizeLoadedStudents(data, globalStationA, globalStationB);
                setStudents(normalized);
                
                showToast(`ファイル同期を設定しました: ${handle.name}`, 'success');
            }
        } catch (err) {
            console.error("Failed to connect sync file", err);
            if (err.name !== 'AbortError') {
                showToast(`接続エラー: ${err.message}`, 'error');
            }
        }
    };

    const handleDisconnectSync = async () => {
        if (confirm("ファイルの自動同期設定を解除しますか？（学生データはローカルに残ります）")) {
            await clearFileHandle();
            setSyncFileHandle(null);
            setSyncFileName('');
            showToast("ファイル同期設定を解除しました。", "info");
        }
    };

    const handleSyncFile = async () => {
        if (!syncFileHandle) return;
        try {
            const hasPermission = await verifyPermission(syncFileHandle, true);
            if (hasPermission) {
                const file = await syncFileHandle.getFile();
                const text = await file.text();
                const data = csvToStudents(text);
                const normalized = normalizeLoadedStudents(data, globalStationA, globalStationB);
                setStudents(normalized);
                showToast(`最新データに再同期しました。`, 'success');
            }
        } catch (err) {
            console.error("Failed to sync file", err);
            showToast(`再同期エラー: ${err.message}`, 'error');
        }
    };

    const handleExportCsv = () => {
        try {
            const csvContent = studentsToCsv(students);
            const blob = new Blob([csvContent], { type: 'text/csv;charset=utf-8;' });
            const url = URL.createObjectURL(blob);
            const downloadAnchor = document.createElement('a');
            downloadAnchor.setAttribute("href", url);
            downloadAnchor.setAttribute("download", "students.csv");
            document.body.appendChild(downloadAnchor);
            downloadAnchor.click();
            downloadAnchor.remove();
            URL.revokeObjectURL(url);
            showToast("CSVファイルをエクスポートしました。", "success");
        } catch (err) {
            console.error(err);
            showToast("エクスポートに失敗しました。", "error");
        }
    };

    const handleImportCsv = (e) => {
        const file = e.target.files[0];
        if (!file) return;

        const reader = new FileReader();
        reader.onload = (event) => {
            try {
                const text = event.target.result;
                const parsed = csvToStudents(text);
                if (Array.isArray(parsed)) {
                    const normalized = normalizeLoadedStudents(parsed, globalStationA, globalStationB);
                    updateStudentsState(normalized);
                    showToast("CSVファイルからデータをインポートしました。", "success");
                } else {
                    showToast("不正なデータ形式です。正しい CSV フォーマットである必要があります。", "error");
                }
            } catch (err) {
                console.error(err);
                showToast("CSVの解析に失敗しました。", "error");
            }
        };
        reader.readAsText(file);
        e.target.value = '';
    };

    // Route toggler with automatic status re-evaluation
    const handleToggleRoute = (studentId, route) => {
        const updated = students.map(s => {
            if (s.id === studentId) {
                let nextStatus = s.status;
                let nextCheckTime = s.checkTime;
                
                if ((s.status === 'ontime' || s.status === 'late') && s.checkTimeRaw) {
                    const targetTime = route === 'B' ? s.targetTimeB : s.targetTimeA;
                    const timeInfo = getCaptureTimeInfo(s.checkTimeRaw, targetTime);
                    nextStatus = timeInfo.onTime ? 'ontime' : 'late';
                    nextCheckTime = timeInfo.timeDisplay;
                }
                return { ...s, selectedRoute: route, status: nextStatus, checkTime: nextCheckTime };
            }
            return s;
        });
        updateStudentsState(updated);
        showToast("登校ルートを切り替え、判定を再評価しました。", "success");
    };

    // Redirect Links
    const openYahooTransit = (routeType) => {
        const activeSchoolStation = routeType === 'B' ? globalStationB : globalStationA;
        if (!formStation.trim() || !activeSchoolStation.trim()) {
            showToast('最寄り駅を設定してください。', 'warning');
            return;
        }
        const activeWalkTime = routeType === 'B' ? globalWalkTimeB : globalWalkTimeA;
        const [hours, minutes] = globalClassTime.split(':').map(Number);
        let totalMinutes = hours * 60 + minutes - activeWalkTime;
        if (totalMinutes < 0) totalMinutes += 24 * 60;

        const arrHour = Math.floor(totalMinutes / 60) % 24;
        const arrMin = totalMinutes % 60;
        const today = new Date();
        const year = today.getFullYear();
        const month = String(today.getMonth() + 1).padStart(2, '0');
        const day = String(today.getDate()).padStart(2, '0');

        const hh = String(arrHour).padStart(2, '0');
        const m1 = Math.floor(arrMin / 10);
        const m2 = arrMin % 10;

        const url = `https://transit.yahoo.co.jp/search/result?from=${encodeURIComponent(formStation)}&to=${encodeURIComponent(activeSchoolStation)}&y=${year}&m=${month}&d=${day}&hh=${hh}&m1=${m1}&m2=${m2}&type=4`;
        window.open(url, '_blank');
    };

    const openGoogleMaps = (routeType) => {
        const activeSchoolStation = routeType === 'B' ? globalStationB : globalStationA;
        if (!formStation.trim() || !activeSchoolStation.trim()) {
            showToast('最寄り駅を設定してください。', 'warning');
            return;
        }
        const url = `https://www.google.com/maps/dir/?api=1&origin=${encodeURIComponent(formStation)}&destination=${encodeURIComponent(activeSchoolStation)}&travelmode=transit`;
        window.open(url, '_blank');
    };

    // ----------------------------------------------------
    // Verification Process
    // ----------------------------------------------------
    const processVerification = async (file, studentId) => {
        const studentIndex = students.findIndex(s => s.id === studentId);
        if (studentIndex === -1) return;
        const student = students[studentIndex];

        showToast(`${student.name} さんの写真検証を開始します...`, 'info');

        try {
            const verif = await verifySpotLockPhoto(file);
            
            // Create image thumbnail
            const imgBlob = new Blob([verif.originalBytes], { type: "image/jpeg" });
            if (sessionPhotoUrls[studentId]) {
                URL.revokeObjectURL(sessionPhotoUrls[studentId]);
            }
            const newUrl = URL.createObjectURL(imgBlob);
            setSessionPhotoUrls(prev => ({ ...prev, [studentId]: newUrl }));

            const targetTime = student.selectedRoute === 'B' ? student.targetTimeB : student.targetTimeA;
            const timeInfo = getCaptureTimeInfo(verif.timestamp, targetTime);
            
            // Check date
            const date = new Date(verif.timestamp);
            const today = new Date();
            const isToday = today.getFullYear() === date.getFullYear() &&
                            today.getMonth() === date.getMonth() &&
                            today.getDate() === date.getDate();

            // Check public key matching
            let isKeyMatch = true;
            let keyUpdated = false;
            let registeredKey = student.publicKey;

            if (verif.cryptoSupported && verif.isValid) {
                if (!student.publicKey) {
                    const approve = confirm(`新規端末を検出しました。この端末の公開鍵を ${student.name} さんに紐づけますか？\n\n公開鍵: ${verif.publicKeyHex.substring(0, 16)}...\n（以降は、この端末で撮影された写真のみ有効となります）`);
                    if (!approve) {
                        showToast('公開鍵の紐づけがキャンセルされました。', 'info');
                        return;
                    }
                    registeredKey = verif.publicKeyHex;
                    keyUpdated = true;
                } else if (student.publicKey !== verif.publicKeyHex) {
                    isKeyMatch = false;
                }
            }

            const updated = [...students];
            if (!isToday) {
                updated[studentIndex] = {
                    ...student,
                    status: 'wrong_date',
                    checkTime: timeInfo.timeDisplay,
                    checkTimeRaw: verif.timestamp,
                    signatureValid: verif.cryptoSupported ? (verif.isValid && isKeyMatch) : null,
                    publicKey: registeredKey
                };
                showToast(`警告: ${student.name} さんは本日の写真ではありません（日付違い）`, 'warning');
            } else if (verif.cryptoSupported && (!verif.isValid || !isKeyMatch)) {
                updated[studentIndex] = {
                    ...student,
                    status: 'invalid_sig',
                    checkTime: timeInfo.timeDisplay,
                    checkTimeRaw: verif.timestamp,
                    signatureValid: false
                };
                if (!verif.isValid) {
                    showToast(`警告: ${student.name} さんの署名データが一致しません！写真が改ざんされた可能性があります。`, 'warning');
                } else {
                    showToast(`警告: ${student.name} さんの提出写真の署名端末が、登録済みの端末と異なります！`, 'error');
                }
            } else {
                updated[studentIndex] = {
                    ...student,
                    status: timeInfo.onTime ? 'ontime' : 'late',
                    checkTime: timeInfo.timeDisplay,
                    checkTimeRaw: verif.timestamp,
                    signatureValid: true,
                    publicKey: registeredKey
                };

                if (keyUpdated) {
                    showToast(`${student.name} さんの端末公開鍵を初回登録しました！`, 'success');
                } else {
                    if (!verif.cryptoSupported) {
                        showToast(`${student.name} さんの写真タイムスタンプを解析（署名はローカル制限によりスキップ）。結果: ${timeInfo.onTime ? '間に合いました' : '遅刻です'}`, 'warning');
                    } else {
                        showToast(`${student.name} さんの写真を検証完了！ 結果: ${timeInfo.onTime ? '時間内登校（クリア）' : '遅刻検知'}`, timeInfo.onTime ? 'success' : 'error');
                    }
                }
            }
            updateStudentsState(updated);
        } catch (error) {
            console.error(error);
            showToast(`エラー: ${student.name} さんの画像解析に失敗しました。(${error.message})`, 'error');
            const updated = [...students];
            updated[studentIndex] = {
                ...student,
                status: 'error',
                checkTime: '検証エラー',
                checkTimeRaw: null,
                signatureValid: false
            };
            updateStudentsState(updated);
        }
    };

    // Detailed Verification Handler (Tab 2)
    const handleDetailedFile = async (file) => {
        setDetailedLoading(true);
        setDetailedPhotoInfo(null);

        try {
            const verif = await verifySpotLockPhoto(file);
            const imgBlob = new Blob([verif.originalBytes], { type: "image/jpeg" });
            const previewUrl = URL.createObjectURL(imgBlob);

            setDetailedPhotoInfo({
                file,
                verif,
                previewUrl,
                formattedDate: new Date(verif.timestamp).toLocaleString('ja-JP', {
                    year: 'numeric', month: '2-digit', day: '2-digit',
                    hour: '2-digit', minute: '2-digit', second: '2-digit',
                    fractionalSecondDigits: 3
                })
            });
        } catch (error) {
            console.error(error);
            setDetailedPhotoInfo({
                error: error.message || error
            });
        } finally {
            setDetailedLoading(false);
        }
    };

    const handleAssignDetailedPhoto = () => {
        if (!detailedPhotoInfo || detailedPhotoInfo.error) {
            showToast('検証済みの写真データがありません。先に写真を検証してください。', 'error');
            return;
        }
        if (!assignStudentId) {
            showToast('判定を反映する学生を選択してください。', 'error');
            return;
        }

        const studentIndex = students.findIndex(s => s.id === assignStudentId);
        if (studentIndex === -1) return;
        const student = students[studentIndex];
        const { verif } = detailedPhotoInfo;

        const imgBlob = new Blob([verif.originalBytes], { type: "image/jpeg" });
        if (sessionPhotoUrls[student.id]) {
            URL.revokeObjectURL(sessionPhotoUrls[student.id]);
        }
        const newUrl = URL.createObjectURL(imgBlob);
        setSessionPhotoUrls(prev => ({ ...prev, [student.id]: newUrl }));

        const targetTime = student.selectedRoute === 'B' ? student.targetTimeB : student.targetTimeA;
        const timeInfo = getCaptureTimeInfo(verif.timestamp, targetTime);
        const date = new Date(verif.timestamp);
        const today = new Date();
        const isToday = today.getFullYear() === date.getFullYear() &&
                        today.getMonth() === date.getMonth() &&
                        today.getDate() === date.getDate();

        let isKeyMatch = true;
        let keyUpdated = false;
        let registeredKey = student.publicKey;

        if (verif.cryptoSupported && verif.isValid) {
            if (!student.publicKey) {
                const approve = confirm(`新規端末を検出しました。この端末の公開鍵を ${student.name} さんに紐づけますか？\n\n公開鍵: ${verif.publicKeyHex.substring(0, 16)}...\n（以降は、この端末で撮影された写真のみ有効となります）`);
                if (!approve) {
                    showToast('公開鍵の紐づけがキャンセルされました。', 'info');
                    return;
                }
                registeredKey = verif.publicKeyHex;
                keyUpdated = true;
            } else if (student.publicKey !== verif.publicKeyHex) {
                isKeyMatch = false;
            }
        }

        const updated = [...students];
        if (!isToday) {
            updated[studentIndex] = {
                ...student,
                status: 'wrong_date',
                checkTime: timeInfo.timeDisplay,
                checkTimeRaw: verif.timestamp,
                signatureValid: verif.cryptoSupported ? (verif.isValid && isKeyMatch) : null,
                publicKey: registeredKey
            };
            showToast(`警告: ${student.name} さんは本日の写真ではありません（日付違い）`, 'warning');
        } else if (verif.cryptoSupported && (!verif.isValid || !isKeyMatch)) {
            updated[studentIndex] = {
                ...student,
                status: 'invalid_sig',
                checkTime: timeInfo.timeDisplay,
                checkTimeRaw: verif.timestamp,
                signatureValid: false
            };
            if (!verif.isValid) {
                showToast(`警告: ${student.name} さんの署名データが一致しません！`, 'warning');
            } else {
                showToast(`警告: ${student.name} さんの提出写真の署名端末が、登録済みの端末と異なります！`, 'error');
            }
        } else {
            updated[studentIndex] = {
                ...student,
                status: timeInfo.onTime ? 'ontime' : 'late',
                checkTime: timeInfo.timeDisplay,
                checkTimeRaw: verif.timestamp,
                signatureValid: true,
                publicKey: registeredKey
            };

            if (keyUpdated) {
                showToast(`${student.name} さんの端末公開鍵を初回登録しました！`, 'success');
            } else {
                showToast(`${student.name} さんの写真を登校判定に反映しました！`, 'success');
            }
        }

        updateStudentsState(updated);
        setActivePanel('dashboard');
    };

    // Drag over highlights
    const [dragOverStudentId, setDragOverStudentId] = useState(null);

    return (
        <div className="container">
            <header>
                <div className="header-title">
                    <h1>SpotLock Photo Verifier</h1>
                    <p className="subtitle">改ざん防止署名付き写真による登校・登園時間検証システム</p>
                </div>
                <div className="tab-container">
                    <button className={`tab-btn ${activePanel === 'dashboard' ? 'active' : ''}`} onClick={() => setActivePanel('dashboard')}>登校判定</button>
                    <button className={`tab-btn ${activePanel === 'verifier' ? 'active' : ''}`} onClick={() => setActivePanel('verifier')}>詳細検証</button>
                </div>
            </header>

            {/* TAB 1: DASHBOARD PANEL */}
            <div className={`tab-panel ${activePanel === 'dashboard' ? 'active' : ''}`}>
                <div className="dashboard-layout">
                    {/* Sidebar */}
                    <div className="sidebar">
                        {/* School global settings */}
                        <div className="card card-settings">
                            <h3>
                                <svg viewBox="0 0 24 24" width="18" height="18" fill="none" stroke="var(--accent-primary)" stroke-width="2"><circle cx="12" cy="12" r="3"/><path d="M19.4 15a1.65 1.65 0 0 0 .33 1.82l.06.06a2 2 0 1 1-2.83 2.83l-.06-.06a1.65 1.65 0 0 0-1.82-.33 1.65 1.65 0 0 0-1 1.51V21a2 2 0 0 1-4 0v-.09A1.65 1.65 0 0 0 9 19.4a1.65 1.65 0 0 0-1.82.33l-.06.06a2 2 0 1 1-2.83-2.83l.06-.06a1.65 1.65 0 0 0 .33-1.82 1.65 1.65 0 0 0-1.51-1H3a2 2 0 0 1 0-4h.09A1.65 1.65 0 0 0 4.6 9a1.65 1.65 0 0 0-.33-1.82l-.06-.06a2 2 0 1 1 2.83-2.83l.06.06a1.65 1.65 0 0 0 1.82.33H9a1.65 1.65 0 0 0 1-1.51V3a2 2 0 0 1 4 0v.09a1.65 1.65 0 0 0 1 1.51 1.65 1.65 0 0 0 1.82-.33l.06-.06a2 2 0 1 1 2.83 2.83l-.06.06a1.65 1.65 0 0 0-.33 1.82V9a1.65 1.65 0 0 0 1.51 1H21a2 2 0 0 1 0 4h-.09a1.65 1.65 0 0 0-1.51 1z"/></svg>
                                学校の共通設定
                            </h3>
                            <div style={{ display: 'flex', flexDirection: 'column', gap: '0.75rem' }}>
                                <div className="form-group" style={{ marginBottom: 0 }}>
                                    <label>授業開始時間</label>
                                    <input type="time" className="form-control" value={globalClassTime} onChange={(e) => handleGlobalSettingsChange(globalStationA, globalWalkTimeA, globalStationB, globalWalkTimeB, e.target.value)} />
                                </div>
                                <div style={{ borderTop: '1px solid #e2e8f0', margin: '0.25rem 0' }}></div>
                                <div style={{ display: 'flex', gap: '0.5rem' }}>
                                    <div className="form-group" style={{ marginBottom: 0, flex: 1 }}>
                                        <label>学校の最寄り駅 A</label>
                                        <input type="text" className="form-control" value={globalStationA} onChange={(e) => handleGlobalSettingsChange(e.target.value, globalWalkTimeA, globalStationB, globalWalkTimeB, globalClassTime)} />
                                    </div>
                                    <div className="form-group" style={{ marginBottom: 0, width: '90px' }}>
                                        <label>徒歩時間 A (分)</label>
                                        <input type="number" className="form-control" value={globalWalkTimeA} min="0" onChange={(e) => handleGlobalSettingsChange(globalStationA, e.target.value, globalStationB, globalWalkTimeB, globalClassTime)} />
                                    </div>
                                </div>
                                <div style={{ display: 'flex', gap: '0.5rem' }}>
                                    <div className="form-group" style={{ marginBottom: 0, flex: 1 }}>
                                        <label>学校の最寄り駅 B</label>
                                        <input type="text" className="form-control" value={globalStationB} onChange={(e) => handleGlobalSettingsChange(globalStationA, globalWalkTimeA, e.target.value, globalWalkTimeB, globalClassTime)} />
                                    </div>
                                    <div className="form-group" style={{ marginBottom: 0, width: '90px' }}>
                                        <label>徒歩時間 B (分)</label>
                                        <input type="number" className="form-control" value={globalWalkTimeB} min="0" onChange={(e) => handleGlobalSettingsChange(globalStationA, globalWalkTimeA, globalStationB, e.target.value, globalClassTime)} />
                                    </div>
                                </div>
                            </div>
                        </div>

                        {/* Student Form */}
                        <div className="card">
                            <h3 id="form-title">
                                <svg viewBox="0 0 24 24" width="18" height="18" fill="none" stroke="#2563eb" stroke-width="2"><path d="M16 21v-2a4 4 0 0 0-4-4H5a4 4 0 0 0-4 4v2"/><circle cx="9" cy="7" r="4"/><line x1="19" y1="8" x2="19" y2="14"/><line x1="22" y1="11" x2="16" y2="11"/></svg>
                                {formId ? '学生情報の編集' : '学生の登録'}
                            </h3>
                            <form onSubmit={handleSaveStudent}>
                                <div className="form-group">
                                    <label>氏名</label>
                                    <input type="text" className="form-control" placeholder="例: 佐藤 優太" required value={formName} onChange={(e) => setFormName(e.target.value)} />
                                </div>
                                <div className="form-group">
                                    <label>自宅の最寄り駅</label>
                                    <input type="text" className="form-control" placeholder="例: 新宿駅" required value={formStation} onChange={(e) => setFormStation(e.target.value)} />
                                </div>
                                <div style={{ borderTop: '1px solid #f1f5f9', margin: '0.75rem 0', paddingTop: '0.75rem' }}></div>
                                
                                {/* Route A settings */}
                                <div style={{ background: '#f8fafc', padding: '0.75rem', borderRadius: '8px', border: '1px solid #e2e8f0', marginBottom: '0.75rem' }}>
                                    <h4 style={{ fontSize: '0.8rem', fontWeight: 600, color: 'var(--text-color)', marginBottom: '0.5rem', display: 'flex', alignItems: 'center', gap: '0.25rem' }}>
                                        <span style={{ display: 'inline-block', width: '8px', height: '8px', borderRadius: '50%', backgroundColor: '#3b82f6' }}></span>
                                        {`駅Aルート (${globalStationA})`}
                                    </h4>
                                    <div className="form-group" style={{ marginBottom: '0.5rem' }}>
                                        <label>乗車時間（分）</label>
                                        <div style={{ display: 'flex', gap: '0.5rem', alignItems: 'center' }}>
                                            <input type="number" className="form-control" style={{ maxWidth: '80px' }} placeholder="分" required min="0" value={formTransitTimeA} onChange={(e) => setFormTransitTimeA(e.target.value)} />
                                            <div style={{ display: 'flex', gap: '0.25rem', width: '100%' }}>
                                                <button type="button" className="btn btn-secondary" style={{ padding: '0.4rem 0.5rem', fontSize: '0.7rem', flex: 1 }} onClick={() => openYahooTransit('A')}>Yahoo!路線</button>
                                                <button type="button" className="btn btn-secondary" style={{ padding: '0.4rem 0.5rem', fontSize: '0.7rem', flex: 1 }} onClick={() => openGoogleMaps('A')}>Gマップ</button>
                                            </div>
                                        </div>
                                        {calcLookupNoteA && <span style={{ fontSize: '0.65rem', fontWeight: 500, marginTop: '0.15rem', display: 'block', color: 'var(--success-color)' }}>{calcLookupNoteA}</span>}
                                    </div>
                                    <div className="form-group" style={{ marginBottom: 0 }}>
                                        <label>到着目標時間 (自動算出)</label>
                                        <input type="time" className="form-control" required value={formTargetTimeA} onChange={(e) => setFormTargetTimeA(e.target.value)} />
                                    </div>
                                </div>

                                {/* Route B settings */}
                                <div style={{ background: '#f8fafc', padding: '0.75rem', borderRadius: '8px', border: '1px solid #e2e8f0', marginBottom: '0.75rem' }}>
                                    <h4 style={{ fontSize: '0.8rem', fontWeight: 600, color: 'var(--text-color)', marginBottom: '0.5rem', display: 'flex', alignItems: 'center', gap: '0.25rem' }}>
                                        <span style={{ display: 'inline-block', width: '8px', height: '8px', borderRadius: '50%', backgroundColor: '#10b981' }}></span>
                                        {`駅Bルート (${globalStationB})`}
                                    </h4>
                                    <div className="form-group" style={{ marginBottom: '0.5rem' }}>
                                        <label>乗車時間（分）</label>
                                        <div style={{ display: 'flex', gap: '0.5rem', alignItems: 'center' }}>
                                            <input type="number" className="form-control" style={{ maxWidth: '80px' }} placeholder="分" required min="0" value={formTransitTimeB} onChange={(e) => setFormTransitTimeB(e.target.value)} />
                                            <div style={{ display: 'flex', gap: '0.25rem', width: '100%' }}>
                                                <button type="button" className="btn btn-secondary" style={{ padding: '0.4rem 0.5rem', fontSize: '0.7rem', flex: 1 }} onClick={() => openYahooTransit('B')}>Yahoo!路線</button>
                                                <button type="button" className="btn btn-secondary" style={{ padding: '0.4rem 0.5rem', fontSize: '0.7rem', flex: 1 }} onClick={() => openGoogleMaps('B')}>Gマップ</button>
                                            </div>
                                        </div>
                                        {calcLookupNoteB && <span style={{ fontSize: '0.65rem', fontWeight: 500, marginTop: '0.15rem', display: 'block', color: 'var(--success-color)' }}>{calcLookupNoteB}</span>}
                                    </div>
                                    <div className="form-group" style={{ marginBottom: 0 }}>
                                        <label>到着目標時間 (自動算出)</label>
                                        <input type="time" className="form-control" required value={formTargetTimeB} onChange={(e) => setFormTargetTimeB(e.target.value)} />
                                    </div>
                                </div>
                                <div className="form-group">
                                    <label>登録端末公開鍵 (Hex) [任意]</label>
                                    <input type="text" className="form-control" placeholder="空欄の場合、初回写真アップ時に自動登録されます" value={formPublicKey} onChange={(e) => setFormPublicKey(e.target.value)} />
                                </div>
                                <div className="btn-group">
                                    <button type="submit" className="btn btn-primary">{formId ? '更新する' : '追加する'}</button>
                                    {formId && <button type="button" className="btn btn-secondary" onClick={handleCancelEdit}>キャンセル</button>}
                                </div>
                            </form>
                        </div>

                        {/* Bulk actions */}
                        <div className="card">
                            <h3>
                                <svg viewBox="0 0 24 24" width="18" height="18" fill="none" stroke="currentColor" stroke-width="2"><path d="M12 2v20M17 5H9.5a3.5 3.5 0 0 0 0 7h5a3.5 3.5 0 0 1 0 7H6"/></svg>
                                一括管理メニュー
                            </h3>
                            <div style={{ display: 'flex', flexDirection: 'column', gap: '0.75rem' }}>
                                <button className="btn btn-secondary" onClick={handleResetAllStatuses}>本日の登校判定をリセット</button>
                                <button className="btn btn-secondary" style={{ color: 'var(--accent-primary)', borderColor: 'rgba(37,99,235,0.15)' }} onClick={handleLoadMockStudents}>デモデータをロード</button>
                                <button className="btn btn-danger-outline" onClick={handleClearAllStudents}>すべての学生を削除</button>
                            </div>
                        </div>

                        {/* CSV Data Sync */}
                        <div className="card">
                            <h3>
                                <svg viewBox="0 0 24 24" width="18" height="18" fill="none" stroke="currentColor" stroke-width="2"><path d="M21.5 2v6h-6M21.34 15.57a10 10 0 1 1-.57-8.38l5.67-5.67"/></svg>
                                データ同期 (CSV)
                            </h3>
                            <div style={{ display: 'flex', flexDirection: 'column', gap: '0.75rem' }}>
                                {syncFileHandle ? (
                                    <>
                                        <div style={{ fontSize: '0.75rem', padding: '0.5rem', backgroundColor: '#ecfdf5', border: '1px solid #a7f3d0', borderRadius: '4px', color: '#065f46', fontWeight: 500 }}>
                                            🟢 ファイル同期中: <br />
                                            <span style={{ fontFamily: 'monospace', wordBreak: 'break-all' }}>{syncFileName}</span>
                                        </div>
                                        <button className="btn btn-secondary" onClick={handleSyncFile}>手動で今すぐ再同期</button>
                                        <button className="btn btn-danger-outline" onClick={handleDisconnectSync}>同期を解除</button>
                                    </>
                                ) : (
                                    <>
                                        <button className="btn btn-secondary" style={{ color: 'var(--accent-primary)', fontWeight: 600 }} onClick={handleConnectSyncFile}>
                                            📂 共有CSVファイルを設定
                                        </button>
                                        <div style={{ display: 'flex', gap: '0.5rem' }}>
                                            <button className="btn btn-secondary" style={{ flex: 1, fontSize: '0.75rem', padding: '0.5rem' }} onClick={handleExportCsv}>
                                                📥 エクスポート
                                            </button>
                                            <button className="btn btn-secondary" style={{ flex: 1, fontSize: '0.75rem', padding: '0.5rem' }} onClick={() => document.getElementById('csv-import-input').click()}>
                                                📤 インポート
                                            </button>
                                        </div>
                                        <input type="file" id="csv-import-input" accept=".csv" style={{ display: 'none' }} onChange={handleImportCsv} />
                                    </>
                                )}
                            </div>
                        </div>
                    </div>

                    {/* Main Table */}
                    <div className="card" style={{ padding: '1.5rem 0.5rem 1.5rem 1.5rem' }}>
                        <h3>
                            <svg viewBox="0 0 24 24" width="18" height="18" fill="none" stroke="currentColor" stroke-width="2"><path d="M8 6h13M8 12h13M8 18h13M3 6h.01M3 12h.01M3 18h.01"/></svg>
                            学生一覧と判定リスト
                        </h3>
                        <div className="table-container" style={{ paddingRight: '1rem', maxHeight: '600px', overflowY: 'auto' }}>
                            <table className="student-table">
                                <thead>
                                    <tr>
                                        <th>学生名 / 最寄り駅</th>
                                        <th>目標時間</th>
                                        <th>本日の登校判定</th>
                                        <th>撮影証明写真</th>
                                        <th style={{ width: '80px' }}>操作</th>
                                    </tr>
                                </thead>
                                <tbody>
                                    {students.length === 0 ? (
                                        <tr>
                                            <td colSpan="5" style={{ textAlign: 'center', color: 'var(--text-muted)', padding: '3rem 1rem' }}>
                                                <svg viewBox="0 0 24 24" width="36" height="36" fill="none" stroke="currentColor" stroke-width="1.5" style={{ marginBottom: '0.5rem', opacity: 0.5 }}><path d="M17 21v-2a4 4 0 0 0-4-4H5a4 4 0 0 0-4 4v2"/><circle cx="9" cy="7" r="4"/></svg>
                                                <p style={{ fontSize: '0.95rem' }}>登録されている学生はいません。</p>
                                                <p style={{ fontSize: '0.8rem', marginTop: '0.25rem' }}>左側のフォームから追加するか、「デモデータをロード」してください。</p>
                                            </td>
                                        </tr>
                                    ) : (
                                        students.map(student => {
                                            const isDragOver = dragOverStudentId === student.id;
                                            return (
                                                <tr
                                                    key={student.id}
                                                    className={`student-row ${isDragOver ? 'dragover' : ''}`}
                                                    onDragEnter={(e) => { e.preventDefault(); setDragOverStudentId(student.id); }}
                                                    onDragOver={(e) => e.preventDefault()}
                                                    onDragLeave={() => setDragOverStudentId(null)}
                                                    onDrop={(e) => {
                                                        e.preventDefault();
                                                        setDragOverStudentId(null);
                                                        if (e.dataTransfer.files.length > 0) {
                                                            processVerification(e.dataTransfer.files[0], student.id);
                                                        }
                                                    }}
                                                >
                                                    <td>
                                                        <div className="profile-cell">
                                                            <div className="avatar" style={{ backgroundColor: getAvatarColor(student.name) }}>
                                                                {student.name.trim().charAt(0)}
                                                            </div>
                                                            <div className="name-info" onClick={() => setSelectedStudentModal(student)} style={{ cursor: 'pointer' }} title="詳細・鍵管理を開く">
                                                                <span className="student-name" style={{ fontWeight: 600 }}>{student.name}</span>
                                                                <div style={{ display: 'flex', gap: '0.35rem', flexWrap: 'wrap', marginTop: '0.25rem' }}>
                                                                    <span className="station-badge" title="登校ルート">
                                                                        <svg viewBox="0 0 24 24" width="11" height="11" fill="none" stroke="currentColor" stroke-width="2"><path d="M21 10c0 7-9 13-9 13s-9-6-9-13a9 9 0 0 1 18 0z"/><circle cx="12" cy="10" r="3"/></svg>
                                                                        {student.station} ➔ {student.selectedRoute === 'B' ? globalStationB : globalStationA}
                                                                    </span>
                                                                    {student.publicKey ? (
                                                                        <span className="key-badge" title={student.publicKey} style={{ fontSize: '0.65rem', color: '#10b981', backgroundColor: '#ecfdf5', padding: '0.1rem 0.35rem', borderRadius: '4px', border: '1px solid #a7f3d0', fontWeight: 500 }}>
                                                                            🔑 {student.publicKey.substring(0, 6)}...
                                                                        </span>
                                                                    ) : (
                                                                        <span className="key-badge-empty" style={{ fontSize: '0.65rem', color: '#6b7280', backgroundColor: '#f3f4f6', padding: '0.1rem 0.35rem', borderRadius: '4px', border: '1px solid #e5e7eb', fontWeight: 500 }}>
                                                                            🔑 未登録 (自動登録)
                                                                        </span>
                                                                    )}
                                                                </div>
                                                            </div>
                                                        </div>
                                                    </td>
                                                    <td>
                                                        <div style={{ display: 'flex', flexDirection: 'column', gap: '0.25rem', alignItems: 'center' }}>
                                                            <div style={{ display: 'flex', gap: '0.2rem' }}>
                                                                <button 
                                                                    type="button"
                                                                    className={`btn-route-toggle ${student.selectedRoute === 'A' ? 'active-a' : ''}`}
                                                                    onClick={() => handleToggleRoute(student.id, 'A')}
                                                                    style={{ 
                                                                        fontSize: '0.65rem', 
                                                                        padding: '0.1rem 0.3rem', 
                                                                        borderRadius: '3px', 
                                                                        cursor: 'pointer', 
                                                                        border: '1px solid #d1d5db', 
                                                                        backgroundColor: student.selectedRoute === 'A' ? '#3b82f6' : '#fff', 
                                                                        color: student.selectedRoute === 'A' ? '#fff' : '#4b5563',
                                                                        fontWeight: 600,
                                                                        lineHeight: 1
                                                                    }}
                                                                >
                                                                    A
                                                                </button>
                                                                <button 
                                                                    type="button"
                                                                    className={`btn-route-toggle ${student.selectedRoute === 'B' ? 'active-b' : ''}`}
                                                                    onClick={() => handleToggleRoute(student.id, 'B')}
                                                                    style={{ 
                                                                        fontSize: '0.65rem', 
                                                                        padding: '0.1rem 0.3rem', 
                                                                        borderRadius: '3px', 
                                                                        cursor: 'pointer', 
                                                                        border: '1px solid #d1d5db', 
                                                                        backgroundColor: student.selectedRoute === 'B' ? '#10b981' : '#fff', 
                                                                        color: student.selectedRoute === 'B' ? '#fff' : '#4b5563',
                                                                        fontWeight: 600,
                                                                        lineHeight: 1
                                                                    }}
                                                                >
                                                                    B
                                                                </button>
                                                            </div>
                                                            <span className="time-badge" style={{ margin: 0 }}>
                                                                {student.selectedRoute === 'B' ? student.targetTimeB : student.targetTimeA}
                                                            </span>
                                                        </div>
                                                    </td>
                                                    <td>
                                                        <div>
                                                            <span className={`status-badge ${student.status}`}>
                                                                <span style={{ display: 'inline-block', width: '6px', height: '6px', borderRadius: '50%', backgroundColor: 'currentColor', marginRight: '4px' }}></span>
                                                                {getStatusLabel(student.status)}
                                                            </span>
                                                            {student.checkTime && <span className="verified-time">{student.checkTime}</span>}
                                                        </div>
                                                    </td>
                                                    <td>
                                                        {sessionPhotoUrls[student.id] ? (
                                                            <div className="thumbnail-preview" onClick={() => setSelectedStudentModal(student)} title="写真を見る">
                                                                <img src={sessionPhotoUrls[student.id]} alt="検証写真" />
                                                                <div className="thumbnail-overlay">拡大</div>
                                                            </div>
                                                        ) : student.status !== 'unverified' ? (
                                                            <div className={`thumbnail-placeholder ${student.status === 'invalid_sig' || student.status === 'error' ? 'invalid' : ''}`} onClick={() => setSelectedStudentModal(student)} title="メタデータ詳細を見る">
                                                                <svg viewBox="0 0 24 24" width="14" height="14" fill="none" stroke="currentColor" stroke-width="2"><path d="M23 19a2 2 0 0 1-2 2H3a2 2 0 0 1-2-2V8a2 2 0 0 1 2-2h4l2-3h6l2 3h4a2 2 0 0 1 2 2z"/><circle cx="12" cy="13" r="4"/></svg>
                                                                <span>メタデータ</span>
                                                            </div>
                                                        ) : (
                                                            <div className="drop-cell-zone" onClick={() => document.getElementById(`file-${student.id}`).click()}>
                                                                <input
                                                                    type="file"
                                                                    id={`file-${student.id}`}
                                                                    accept="image/jpeg,image/jpg"
                                                                    onChange={(e) => {
                                                                        if (e.target.files.length > 0) {
                                                                            processVerification(e.target.files[0], student.id);
                                                                        }
                                                                        e.target.value = '';
                                                                    }}
                                                                    style={{ display: 'none' }}
                                                                />
                                                                <svg viewBox="0 0 24 24" width="14" height="14" fill="none" stroke="currentColor" stroke-width="2"><path d="M21 15v4a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2v-4M17 8l-5-5-5 5M12 3v12"/></svg>
                                                                <span>ドロップ/選択</span>
                                                            </div>
                                                        )}
                                                    </td>
                                                    <td>
                                                        <div className="row-actions">
                                                            {student.status !== 'unverified' && (
                                                                <button className="icon-btn reset" onClick={() => handleResetStatus(student)} title="未検証にリセット">
                                                                    <svg viewBox="0 0 24 24" width="14" height="14" fill="none" stroke="currentColor" stroke-width="2"><path d="M23 4v6h-6M1 20v-6h6M3.51 9a9 9 0 0 1 14.85-3.36L23 10M1 14l4.64 4.36A9 9 0 0 0 20.49 15"/></svg>
                                                                </button>
                                                            )}
                                                            <button className="icon-btn" onClick={() => startEditStudent(student)} title="編集">
                                                                <svg viewBox="0 0 24 24" width="14" height="14" fill="none" stroke="currentColor" stroke-width="2"><path d="M11 4H4a2 2 0 0 0-2 2v14a2 2 0 0 0 2 2h14a2 2 0 0 0 2-2v-7M18.5 2.5a2.121 2.121 0 1 1 3 3L12 15l-4 1 1-4z"/></svg>
                                                            </button>
                                                            <button className="icon-btn delete" onClick={() => handleDeleteStudent(student)} title="削除">
                                                                <svg viewBox="0 0 24 24" width="14" height="14" fill="none" stroke="currentColor" stroke-width="2"><polyline points="3 6 5 6 21 6"/><path d="M19 6v14a2 2 0 0 1-2 2H7a2 2 0 0 1-2-2V6m3 0V4a2 2 0 0 1 2-2h4a2 2 0 0 1 2 2v2"/><line x1="10" y1="11" x2="10" y2="17"/><line x1="14" y1="11" x2="14" y2="17"/></svg>
                                                            </button>
                                                        </div>
                                                    </td>
                                                </tr>
                                            );
                                        })
                                    )}
                                </tbody>
                            </table>
                        </div>
                    </div>
                </div>
            </div>

            {/* TAB 2: DETAILED PHOTO VERIFIER PANEL */}
            <div className={`tab-panel ${activePanel === 'verifier' ? 'active' : ''}`}>
                <main className="card" style={{ padding: '2rem' }}>
                    <h2 style={{ marginBottom: '1.5rem' }}>
                        <svg viewBox="0 0 24 24" width="20" height="20" fill="none" stroke="currentColor" stroke-width="2"><path d="M12 22s8-4 8-10V5l-8-3-8 3v7c0 6 8 10 8 10z"/></svg>
                        単一の SpotLock 写真検証
                    </h2>

                    {/* Drag & Drop Main Zone */}
                    {!detailedPhotoInfo && !detailedLoading && (
                        <div
                            className="drop-zone"
                            onClick={() => fileInputRef.current.click()}
                            onDragOver={(e) => { e.preventDefault(); e.currentTarget.classList.add('dragover'); }}
                            onDragLeave={(e) => e.currentTarget.classList.remove('dragover')}
                            onDrop={(e) => {
                                e.preventDefault();
                                e.currentTarget.classList.remove('dragover');
                                if (e.dataTransfer.files.length > 0) {
                                    handleDetailedFile(e.dataTransfer.files[0]);
                                }
                            }}
                        >
                            <input
                                type="file"
                                ref={fileInputRef}
                                accept="image/jpeg,image/jpg"
                                onChange={(e) => {
                                    if (e.target.files.length > 0) {
                                        handleDetailedFile(e.target.files[0]);
                                    }
                                }}
                                style={{ display: 'none' }}
                            />
                            <svg className="upload-icon" fill="none" stroke="currentColor" viewBox="0 0 24 24" xmlns="http://www.w3.org/2000/svg">
                                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth="1.5" d="M4 16l4.586-4.586a2 2 0 012.828 0L16 16m-2-2l1.586-1.586a2 2 0 012.828 0L20 14m-6-6h.01M6 20h12a2 2 0 002-2V6a2 2 0 00-2-2H6a2 2 0 00-2 2v12a2 2 0 002 2z"></path>
                            </svg>
                            <div>
                                <p className="upload-text">画像をここにドラッグ＆ドロップ</p>
                                <p className="upload-hint">またはクリックしてファイルを選択 (JPEGのみ)</p>
                            </div>
                        </div>
                    )}

                    {detailedLoading && <div className="spinner" style={{ display: 'block' }}></div>}

                    {/* Detailed verification results display */}
                    {detailedPhotoInfo && (
                        <div className="result-container" style={{ display: 'block' }}>
                            {detailedPhotoInfo.error ? (
                                <div className="result-header">
                                    <div className="status-badge error">
                                        <span style={{ display: 'inline-block', width: '8px', height: '8px', borderRadius: '50%', backgroundColor: 'currentColor' }}></span>
                                        エラー
                                    </div>
                                    <h2 style={{ fontSize: '1.2rem', fontWeight: 600, color: 'var(--error-color)' }}>ファイルの読み込み・検証中にエラーが発生しました</h2>
                                </div>
                            ) : (
                                <div className="result-header">
                                    <div className={`status-badge ${!detailedPhotoInfo.verif.cryptoSupported ? 'error' : detailedPhotoInfo.verif.isValid ? 'success' : 'error'}`}>
                                        <span style={{ display: 'inline-block', width: '8px', height: '8px', borderRadius: '50%', backgroundColor: 'currentColor', marginRight: '4px' }}></span>
                                        {!detailedPhotoInfo.verif.cryptoSupported ? '検証不可' : detailedPhotoInfo.verif.isValid ? '有効な署名' : '検証失敗'}
                                    </div>
                                    <h2 style={{ fontSize: '1.2rem', fontWeight: 600, color: !detailedPhotoInfo.verif.cryptoSupported ? '#f59e0b' : detailedPhotoInfo.verif.isValid ? 'var(--success-color)' : 'var(--error-color)' }}>
                                        {!detailedPhotoInfo.verif.cryptoSupported ? '暗号署名の検証をスキップしました' : detailedPhotoInfo.verif.isValid ? '写真の真正性が検証されました' : '署名の検証に失敗しました'}
                                    </h2>
                                </div>
                            )}

                            {/* Assign results form */}
                            {!detailedPhotoInfo.error && (
                                <div id="assign-container" style={{ marginBottom: '1.5rem', background: 'rgba(37,99,235,0.06)', border: '1px solid rgba(37,99,235,0.15)', borderRadius: '12px', padding: '1rem' }}>
                                    <div style={{ display: 'flex', flexDirection: 'column', gap: '0.5rem' }}>
                                        <span style={{ fontSize: '0.8rem', color: 'var(--text-muted)', fontWeight: 600, textTransform: 'uppercase', letterSpacing: '0.05em' }}>検証された登校状況を反映する</span>
                                        <div style={{ display: 'flex', gap: '0.5rem', alignItems: 'center', marginTop: '0.25rem' }}>
                                            <select className="form-control" style={{ background: 'rgba(255, 255, 255, 0.8)', maxWidth: '250px' }} value={assignStudentId} onChange={(e) => setAssignStudentId(e.target.value)}>
                                                <option value="" disabled>選択してください...</option>
                                                {students.map(s => {
                                                    const targetTime = s.selectedRoute === 'B' ? s.targetTimeB : s.targetTimeA;
                                                    const routeName = s.selectedRoute === 'B' ? '駅B' : '駅A';
                                                    return (
                                                        <option key={s.id} value={s.id}>
                                                            {s.name} (自宅: {s.station}, 目標: {targetTime} [{routeName}])
                                                        </option>
                                                    );
                                                })}
                                            </select>
                                            <button className="btn btn-primary" style={{ maxWidth: '130px', padding: '0.65rem 1rem' }} onClick={handleAssignDetailedPhoto}>登校判定を反映</button>
                                        </div>
                                    </div>
                                </div>
                            )}

                            <div className="result-content">
                                <div className="preview-box">
                                    {detailedPhotoInfo.error ? (
                                        <svg xmlns="http://www.w3.org/2000/svg" width="100" height="100" viewBox="0 0 24 24" fill="none" stroke="#ef4444" strokeWidth="1"><circle cx="12" cy="12" r="10"/><line x1="12" y1="8" x2="12" y2="12"/><line x1="12" y1="16" x2="12.01" y2="16"/></svg>
                                    ) : (
                                        <img src={detailedPhotoInfo.previewUrl} className="preview-image" alt="Preview" />
                                    )}
                                </div>

                                <div className="details-box">
                                    {detailedPhotoInfo.error ? (
                                        <div className="detail-item" style={{ borderLeft: '3px solid var(--error-color)' }}>
                                            <div className="detail-label">エラーメッセージ</div>
                                            <div style={{ color: 'var(--error-color)' }}>{detailedPhotoInfo.error}</div>
                                        </div>
                                    ) : (
                                        <>
                                            <div className="detail-item">
                                                <div className="detail-label">撮影時間 (デジタル署名証明)</div>
                                                <div className="detail-value time">{detailedPhotoInfo.formattedDate}</div>
                                                <div style={{ fontSize: '0.85rem', color: 'var(--text-muted)', marginTop: '0.25rem' }}>
                                                    {getRelativeTimeString(detailedPhotoInfo.verif.timestamp)}
                                                    {!detailedPhotoInfo.verif.cryptoSupported ? '' : detailedPhotoInfo.verif.isValid ? '' : ' (データが書き換えられている可能性があります)'}
                                                </div>
                                            </div>

                                            <div className="detail-item" style={{ borderLeft: `3px solid ${!detailedPhotoInfo.verif.cryptoSupported ? '#f59e0b' : detailedPhotoInfo.verif.isValid ? 'var(--success-color)' : 'var(--error-color)'}` }}>
                                                <div className="detail-label">暗号署名検証</div>
                                                {!detailedPhotoInfo.verif.cryptoSupported ? (
                                                    <div style={{ fontSize: '0.9rem' }}>
                                                        <span style={{ color: '#f59e0b', fontWeight: 600 }}>⚠ 検証不可（非セキュア環境）</span> ブラウザの制限により、ローカルファイル(file://)やHTTP接続では署名検証APIが動作しません。localhostで実行するか、HTTPS環境をご利用ください。タイムスタンプ等のコードの読み込み自体には成功しています。
                                                    </div>
                                                ) : detailedPhotoInfo.verif.isValid ? (
                                                    <div style={{ fontSize: '0.9rem' }}>
                                                        <span style={{ color: 'var(--success-color)', fontWeight: 600 }}>✓ 署名が一致します</span> タイムスタンプと画像データは改ざんされておらず本物です。
                                                    </div>
                                                ) : (
                                                    <div style={{ fontSize: '0.9rem' }}>
                                                        <span style={{ color: 'var(--error-color)', fontWeight: 600 }}>✗ 署名が一致しません</span> 画像データまたはタイムスタンプが改ざんされています。
                                                    </div>
                                                )}
                                                <div style={{ marginTop: '0.5rem' }}>
                                                    <span className="detail-label" style={{ fontSize: '0.7rem' }}>埋め込み署名</span>
                                                    <div className="code-box">{toHexString(detailedPhotoInfo.verif.embeddedSigBytes)}</div>
                                                </div>
                                            </div>

                                            <div className="detail-item" style={{ opacity: 0.85 }}>
                                                <div className="detail-label">セグメント詳細</div>
                                                <div style={{ fontSize: '0.85rem', display: 'grid', gridTemplateColumns: 'auto 1fr', gap: '0.25rem 0.75rem' }}>
                                                    <span style={{ color: 'var(--text-muted)' }}>メタデータバージョン:</span>
                                                    <span>v{detailedPhotoInfo.verif.version}</span>
                                                    <span style={{ color: 'var(--text-muted)' }}>タイムスタンプ値:</span>
                                                    <span>{detailedPhotoInfo.verif.timestamp} ms</span>
                                                </div>
                                            </div>
                                        </>
                                    )}

                                    <div className="btn-group" style={{ width: 'auto' }}>
                                        <button className="btn btn-secondary" style={{ maxWidth: '180px' }} onClick={() => setDetailedPhotoInfo(null)}>別の写真を検証</button>
                                    </div>
                                </div>
                            </div>
                        </div>
                    )}
                </main>
            </div>

            <footer>
                <p>&copy; 2026 SpotLock Camera. All rights reserved.</p>
            </footer>

            {/* Modal: Student Verification Details */}
            {selectedStudentModal && (
                <div className="modal-overlay show" onClick={() => setSelectedStudentModal(null)}>
                    <div className="modal-content" onClick={(e) => e.stopPropagation()}>
                        <button className="modal-close" onClick={() => setSelectedStudentModal(null)}>&times;</button>
                        <div className="modal-header">
                            <h3>{selectedStudentModal.name} さんの登校検証メタデータ</h3>
                        </div>
                        <div className="modal-body">
                            {sessionPhotoUrls[selectedStudentModal.id] && (
                                <div className="modal-image-container">
                                    <img src={sessionPhotoUrls[selectedStudentModal.id]} alt="検証写真" />
                                </div>
                            )}
                            <div className="modal-info-grid">
                                <div className="detail-item" style={{ borderLeft: '4px solid var(--accent-primary)', borderLeftColor: selectedStudentModal.status === 'ontime' ? 'var(--success-color)' : selectedStudentModal.status === 'late' ? 'var(--error-color)' : selectedStudentModal.status === 'unverified' ? 'rgba(0,0,0,0.1)' : 'var(--warning-color)' }}>
                                    <div className="detail-label">本日の判定結果</div>
                                    <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginTop: '0.25rem' }}>
                                        <span className={`status-badge ${selectedStudentModal.status}`}>{getStatusLabel(selectedStudentModal.status)}</span>
                                        <span style={{ fontSize: '1.05rem', fontWeight: 600 }}>{selectedStudentModal.checkTime ? `${selectedStudentModal.checkTime.split(' ')[1] || selectedStudentModal.checkTime} 撮影` : '--:-- 撮影'}</span>
                                    </div>
                                    <div style={{ fontSize: '0.8rem', color: 'var(--text-muted)', marginTop: '0.5rem' }}>
                                        {selectedStudentModal.status === 'ontime' && `目標時刻 ${selectedStudentModal.targetTime} より前に、最寄り駅 ${selectedStudentModal.station} に到着していることを証明しました。`}
                                        {selectedStudentModal.status === 'late' && `撮影時刻が目標時刻 ${selectedStudentModal.targetTime} を過ぎています。遅刻と判定されました。`}
                                        {selectedStudentModal.status === 'invalid_sig' && '警告: 写真に含まれる暗号署名とタイムスタンプ/画像バイナリが一致しません。撮影時刻が改ざんされたか、別のアプリで保存された疑いがあります。'}
                                        {selectedStudentModal.status === 'wrong_date' && '警告: 提出された写真の撮影日付が本日ではありません。本日のデータのみ登校判定の対象となります。'}
                                        {selectedStudentModal.status === 'error' && '写真に含まれる署名セグメントのデコードに失敗しました。一般的なJPEG画像か、破損ファイルの可能性があります。'}
                                        {selectedStudentModal.status === 'unverified' && '本日の登校確認写真はまだ登録されていません。一覧の「ドロップ/選択」から写真を登録してください。'}
                                    </div>
                                </div>

                                <div className="detail-item">
                                    <div className="detail-label">デジタル真正性署名 (ECDSA P-256)</div>
                                    <div style={{ display: 'flex', alignItems: 'center', gap: '0.35rem', marginTop: '0.25rem' }}>
                                        {selectedStudentModal.status === 'unverified' ? (
                                            <span className="status-badge unverified">未確認</span>
                                        ) : selectedStudentModal.signatureValid === true ? (
                                            <span className="status-badge success">有効</span>
                                        ) : selectedStudentModal.signatureValid === false ? (
                                            <span className="status-badge error">無効/改ざん</span>
                                        ) : (
                                            <span className="status-badge warning">未検証</span>
                                        )}
                                        <span style={{ color: 'var(--text-muted)', fontSize: '0.85rem' }}>
                                            {selectedStudentModal.status === 'unverified' && '写真がまだ提供されていません。'}
                                            {selectedStudentModal.signatureValid === true && '暗号署名は本物のカメラアプリで生成され、画像・時間は改ざんされていません。'}
                                            {selectedStudentModal.signatureValid === false && '画像のピクセルデータ、または撮影タイムスタンプの変更を検出しました。'}
                                            {selectedStudentModal.signatureValid === null && selectedStudentModal.status !== 'unverified' && 'ブラウザのセキュリティ制限(HTTP/file://)により暗号検証をスキップしました。'}
                                        </span>
                                    </div>
                                </div>

                                <div className="detail-item" style={{ fontSize: '0.8rem', opacity: 0.9 }}>
                                    <div className="detail-label">最寄り駅情報 / 期限時間</div>
                                    <div style={{ display: 'grid', gridTemplateColumns: 'auto 1fr', gap: '0.25rem 0.5rem', marginTop: '0.25rem' }}>
                                        <span style={{ color: 'var(--text-muted)' }}>登校ルート:</span>
                                        <span>{selectedStudentModal.station} ➔ {selectedStudentModal.schoolStation || globalStationA}</span>
                                        <span style={{ color: 'var(--text-muted)' }}>目標到着時刻:</span>
                                        <span>{selectedStudentModal.targetTime} まで</span>
                                    </div>
                                </div>

                                <div className="detail-item" style={{ fontSize: '0.8rem', opacity: 0.9 }}>
                                    <div className="detail-label">登録端末公開鍵</div>
                                    {selectedStudentModal.publicKey ? (
                                        <div style={{ marginTop: '0.25rem' }}>
                                            <div style={{ fontSize: '0.7rem', wordBreak: 'break-all', backgroundColor: '#f8fafc', border: '1px solid #e2e8f0', padding: '0.5rem', borderRadius: '4px', fontFamily: 'monospace' }}>
                                                {selectedStudentModal.publicKey}
                                            </div>
                                            <button 
                                                className="btn btn-danger-outline" 
                                                style={{ marginTop: '0.5rem', padding: '0.25rem 0.5rem', fontSize: '0.7rem', display: 'block', width: 'auto' }} 
                                                onClick={() => {
                                                    if (confirm(`${selectedStudentModal.name} さんの登録端末鍵を消去しますか？（次回の写真アップロード時に自動で新規登録されます）`)) {
                                                        const updated = students.map(s => {
                                                            if (s.id === selectedStudentModal.id) {
                                                                return { ...s, publicKey: null };
                                                            }
                                                            return s;
                                                        });
                                                        updateStudentsState(updated);
                                                        setSelectedStudentModal(prev => ({ ...prev, publicKey: null }));
                                                        showToast(`${selectedStudentModal.name} さんの登録端末鍵を消去しました。`, 'info');
                                                    }
                                                }}
                                            >
                                                登録鍵を消去 (再登録を許可)
                                            </button>
                                        </div>
                                    ) : (
                                        <div style={{ color: 'var(--text-muted)', fontStyle: 'italic', marginTop: '0.25rem' }}>
                                            未登録（写真アップロード時に自動登録されます）
                                        </div>
                                    )}
                                </div>
                            </div>
                        </div>
                    </div>
                </div>
            )}

            {/* Toast Notifications */}
            <div id="toast-container">
                {toasts.map(toast => (
                    <div key={toast.id} className={`toast ${toast.type} show`}>
                        <span>
                            {toast.type === 'success' && '✓ '}
                            {toast.type === 'error' && '✗ '}
                            {toast.type === 'warning' && '⚠ '}
                            {toast.message}
                        </span>
                        <button className="toast-close" onClick={() => setToasts(prev => prev.filter(t => t.id !== toast.id))}>&times;</button>
                    </div>
                ))}
            </div>
        </div>
    );
}

// Helper: Generates hashed colors for avatars
function getAvatarColor(name) {
    const colors = [
        '#3b82f6', '#10b981', '#8b5cf6', '#ec4899', 
        '#f59e0b', '#06b6d4', '#14b8a6', '#f43f5e'
    ];
    let hash = 0;
    for (let i = 0; i < name.length; i++) {
        hash = name.charCodeAt(i) + ((hash << 5) - hash);
    }
    const index = Math.abs(hash) % colors.length;
    return colors[index];
}
