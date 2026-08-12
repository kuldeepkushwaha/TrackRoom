"use client";

import { useState, useEffect, useRef, useCallback } from "react";
import {
  CheckCircle, XCircle, Flame, Clock, ShieldAlert, Trophy,
  TrendingUp, Calendar, Zap, BookOpen, Code2, RotateCcw,
  ChevronsLeft, ChevronsRight, Keyboard, X, ChevronUp,
  Download, Upload,
  RefreshCw,
  Cloud,
  CloudOff,
  Link,
} from "lucide-react";

// ─── Types ────────────────────────────────────────────────────────────────────
interface DayData {
  status: "succeed" | "wasted";
  learned: string;
  did: string;
  timeLeak: string;
}
type MonthData = Record<number, DayData>;
type YearData = Record<string, MonthData>;
type Toast = { id: number; message: string; type: "success" | "error" | "info" };
type SyncStatus = "idle" | "syncing" | "synced" | "error";


// ─── Constants ────────────────────────────────────────────────────────────────
const MONTHS = [
  "January", "February", "March", "April", "May", "June",
  "July", "August", "September", "October", "November", "December",
];
const STORAGE_KEY = "dsa-war-room-v5";
const YEAR = new Date().getFullYear();
const TODAY = new Date();
const TODAY_MONTH = MONTHS[TODAY.getMonth()];
const TODAY_DAY = TODAY.getDate();
const TODAY_M_IDX = TODAY.getMonth();
const MIN_LEFT_PX = 420;
const MAX_LEFT_PX = 1200;
const DEFAULT_LEFT = 68; // percent

// ─── Helpers ──────────────────────────────────────────────────────────────────
const getDaysInMonth = (mi: number) => new Date(YEAR, mi + 1, 0).getDate();
const getFirstDayOffset = (mi: number) => { const d = new Date(YEAR, mi, 1).getDay(); return d === 0 ? 6 : d - 1; };
const getDayOfYear = () => Math.floor((TODAY.getTime() - new Date(YEAR, 0, 0).getTime()) / 86_400_000);

function getCurrentStreak(yd: YearData): number {
  let streak = 0;
  const d = new Date(YEAR, TODAY_M_IDX, TODAY_DAY);
  while (true) {
    const m = MONTHS[d.getMonth()]; const day = d.getDate();
    if (yd[m]?.[day]?.status === "succeed") { streak++; d.setDate(d.getDate() - 1); } else break;
  }
  return streak;
}
function getBestStreak(yd: YearData): number {
  let best = 0, cur = 0;
  for (let m = 0; m < 12; m++) for (let d = 1; d <= getDaysInMonth(m); d++) {
    const s = yd[MONTHS[m]]?.[d]?.status;
    if (s === "succeed") { cur++; best = Math.max(best, cur); } else if (s === "wasted") cur = 0;
  }
  return best;
}
function getMonthStats(yd: YearData, month: string) {
  const data = Object.values(yd[month] || {});
  const wins = data.filter(d => d.status === "succeed").length;
  const losses = data.filter(d => d.status === "wasted").length;
  return { wins, losses, rate: wins + losses > 0 ? Math.round((wins / (wins + losses)) * 100) : null };
}
function getReality(wins: number, losses: number, streak: number, winRate: number, todayStatus?: string) {
  const total = wins + losses;
  if (!todayStatus) return { text: "⚠ TODAY UNMARKED — mark it before midnight. No blank days ever.", color: "text-orange-400" };
  if (streak >= 30) return { text: `🔥 ${streak}-DAY STREAK. You are not the same person. Don't stop.`, color: "text-emerald-300" };
  if (streak >= 14) return { text: `🔥 ${streak} days straight. This is identity now. Protect it.`, color: "text-emerald-400" };
  if (streak >= 7) return { text: `${streak}-day streak. ONE skip resets everything. Every. Single. Day.`, color: "text-emerald-400" };
  if (streak >= 3) return { text: `${streak} days building. Don't romanticise it — just keep going.`, color: "text-yellow-400" };
  if (winRate < 30 && total > 10) return { text: `Win rate: ${winRate}%. Brain is winning. Fight harder today.`, color: "text-rose-400" };
  if (todayStatus === "wasted") return { text: "Today: WASTED. Reclaim 1 hour tonight. Don't write off the day.", color: "text-rose-400" };
  return { text: "Today: WIN ✓  Chain alive. Log what you learned before sleep.", color: "text-emerald-400" };
}

// ─── Component ────────────────────────────────────────────────────────────────
export default function Home() {
  const [yearData, setYearData] = useState<YearData>({});
  const [selectedMonth, setSelectedMonth] = useState(TODAY_MONTH);
  const [selectedDay, setSelectedDay] = useState(TODAY_DAY);
  const [learnedInput, setLearnedInput] = useState("");
  const [didInput, setDidInput] = useState("");
  const [leakInput, setLeakInput] = useState("");
  const [saveState, setSaveState] = useState<"idle" | "saved">("idle");
  const [mounted, setMounted] = useState(false);
  const [confirmReset, setConfirmReset] = useState(false);
  const [toasts, setToasts] = useState<Toast[]>([]);
  const [showShortcuts, setShowShortcuts] = useState(false);
  const [mobileView, setMobileView] = useState<"calendar" | "log">("calendar");
  const [showScrollTop, setShowScrollTop] = useState(false);
  const [leftPct, setLeftPct] = useState(DEFAULT_LEFT);
  const [isDragging, setIsDragging] = useState(false);

  const [syncKey, setSyncKey] = useState("");
  const [syncKeyInput, setSyncKeyInput] = useState("");
  const [syncStatus, setSyncStatus] = useState<SyncStatus>("idle");
  const [showSyncPanel, setShowSyncPanel] = useState(false);
  const [isSyncEnabled, setIsSyncEnabled] = useState(false);

  // Sync health
const [isSyncBlocked,   setIsSyncBlocked]   = useState(false);
const [syncBlockReason, setSyncBlockReason] = useState("");
const [isInitialSync,   setIsInitialSync]   = useState(false); // blocks all writes during boot pull
const [isLocalOnly,     setIsLocalOnly]     = useState(false); // true when cloud is unreachable

  const [appPasscode, setAppPasscode] = useState("");
  const [appPasscodeInput, setAppPasscodeInput] = useState("");
  const [passcodeVerified, setPasscodeVerified] = useState(false);
  const [passcodeError, setPasscodeError] = useState("");

  // Refs
  const todayRef = useRef<HTMLDivElement>(null);
  const containerRef = useRef<HTMLDivElement>(null);
  const dragRef = useRef<{ startX: number; startPct: number } | null>(null);
  const calScrollRef = useRef<HTMLDivElement>(null);
  const toastCounter = useRef(0);
  const fileInputRef = useRef<HTMLInputElement>(null);

  // ── Bootstrap ──────────────────────────────────────────────────────────────
useEffect(() => {
  const boot = async () => {
    let localData: YearData = {};

    // ── Step 1: load local ─────────────────────────────────────────────
    try {
      const raw = localStorage.getItem(STORAGE_KEY);
      localData = raw ? JSON.parse(raw) : {};
    } catch {
      localStorage.removeItem(STORAGE_KEY);
    }

    // ── Step 2: check saved credentials ────────────────────────────────
    const savedKey      = localStorage.getItem("dsa-sync-key");
    const savedPasscode = localStorage.getItem("dsa-app-passcode");

    if (savedKey && savedPasscode) {
      setSyncKey(savedKey);
      setSyncKeyInput(savedKey);
      setAppPasscode(savedPasscode);
      setAppPasscodeInput(savedPasscode);
      setPasscodeVerified(true);
      setIsSyncEnabled(true);
      setIsInitialSync(true); // 🔒 block all auto-pushes during boot

      // ── Step 3: pull cloud FIRST — before setting any state ──────────
      try {
        setSyncStatus("syncing");
        const res = await fetch(
          `/api/sync?key=${encodeURIComponent(savedKey)}`,
          { headers: { "x-app-passcode": savedPasscode } }
        );
        const json = await res.json().catch(() => ({}));

        if (res.ok && json.data) {
          // Cloud data exists — merge: cloud wins on conflict
          const cloudData: YearData =
            typeof json.data === "string"
              ? JSON.parse(json.data)
              : json.data;

          const merged: YearData = { ...localData };
          MONTHS.forEach((m) => {
            if (!cloudData[m]) return;
            merged[m] = { ...(merged[m] || {}), ...cloudData[m] };
          });

          // Persist merged locally but DO NOT push (skipPush=true)
          setYearData(merged);
          localStorage.setItem(STORAGE_KEY, JSON.stringify(merged));
          localData = merged; // use merged for field init below

          const totalDays = Object.values(cloudData).reduce(
            (sum, m) => sum + Object.keys(m).length, 0
          );
          addToast(`Boot sync: ${totalDays} day(s) loaded from cloud ✓`, "success");
          setSyncStatus("synced");
          setIsLocalOnly(false);
        } else if (res.ok && !json.data) {
          // Key exists on server but no data yet — push local up
          if (Object.keys(localData).length > 0) {
            await fetch("/api/sync", {
              method:  "POST",
              headers: {
                "Content-Type":   "application/json",
                "x-app-passcode": savedPasscode,
              },
              body: JSON.stringify({ syncKey: savedKey, yearData: localData }),
            });
            addToast("Boot sync: local data pushed to cloud ✓", "success");
          } else {
            addToast("Sync ready. Start marking days!", "info");
          }
          setSyncStatus("synced");
          setIsLocalOnly(false);
        } else if (res.status === 401) {
          setPasscodeVerified(false);
          setIsSyncEnabled(false);
          setSyncStatus("error");
          setIsLocalOnly(true);
          addToast("Saved passcode rejected — re-enter in Sync panel.", "error");
        } else if (res.status === 403) {
          setIsSyncBlocked(true);
          setSyncBlockReason(json?.error || "Max sync keys reached.");
          setIsLocalOnly(true);
          setSyncStatus("error");
          addToast(`Sync blocked: ${json?.error}`, "error");
        } else {
          // Network or server error — go offline
          setIsLocalOnly(true);
          setSyncStatus("idle");
          addToast("Cloud unreachable — working offline. Data safe locally.", "info");
        }
      } catch {
        setIsLocalOnly(true);
        setSyncStatus("idle");
        addToast("No network — working offline. Data safe locally.", "info");
      } finally {
        setIsInitialSync(false); // 🔓 unlock writes
        setTimeout(() => setSyncStatus("idle"), 3000);
      }
    } else {
      // No saved sync — just use local
      setYearData(localData);
    }

    // ── Step 4: init audit fields for today ──────────────────────────────
    const d = localData[TODAY_MONTH]?.[TODAY_DAY];
    setLearnedInput(d?.learned  || "");
    setDidInput    (d?.did      || "");
    setLeakInput   (d?.timeLeak || "");

    setMounted(true);
  };

  boot();
}, []); // eslint-disable-line react-hooks/exhaustive-deps

  // ── Auto-scroll to today's month ───────────────────────────────────────────
  useEffect(() => {
    if (!mounted) return;
    // Small delay so layout has settled
    const t = setTimeout(() => {
      todayRef.current?.scrollIntoView({ behavior: "smooth", block: "center" });
    }, 300);
    return () => clearTimeout(t);
  }, [mounted]);

  // ── Scroll-to-top button visibility ───────────────────────────────────────
  useEffect(() => {
    const el = calScrollRef.current;
    if (!el) return;
    const onScroll = () => setShowScrollTop(el.scrollTop > 400);
    el.addEventListener("scroll", onScroll);
    return () => el.removeEventListener("scroll", onScroll);
  }, [mounted]);

  // ── Resizable divider (mouse) ──────────────────────────────────────────────
  const onDividerMouseDown = (e: React.MouseEvent) => {
    e.preventDefault();
    dragRef.current = { startX: e.clientX, startPct: leftPct };
    setIsDragging(true);
  };
  useEffect(() => {
    if (!isDragging) return;
    const onMove = (e: MouseEvent) => {
      if (!dragRef.current || !containerRef.current) return;
      const containerW = containerRef.current.getBoundingClientRect().width;
      const delta = e.clientX - dragRef.current.startX;
      const deltaPct = (delta / containerW) * 100;
      const newPct = Math.min(
        Math.max(dragRef.current.startPct + deltaPct, (MIN_LEFT_PX / containerW) * 100),
        (MAX_LEFT_PX / containerW) * 100,
      );
      setLeftPct(newPct);
    };
    const onUp = () => { setIsDragging(false); dragRef.current = null; };
    window.addEventListener("mousemove", onMove);
    window.addEventListener("mouseup", onUp);
    return () => { window.removeEventListener("mousemove", onMove); window.removeEventListener("mouseup", onUp); };
  }, [isDragging]);

  // ── Toast system ───────────────────────────────────────────────────────────
  const addToast = useCallback((message: string, type: Toast["type"] = "success") => {
    const id = ++toastCounter.current;
    setToasts(t => [...t, { id, message, type }]);
    setTimeout(() => setToasts(t => t.filter(x => x.id !== id)), 3000);
  }, []);


  // ── Push to cloud ──────────────────────────────────────────────────────────
const pushToCloud = async (data: YearData, key?: string) => {
  const k  = (key || syncKey).trim();
  if (!k || k.length < 4) return;

  // Hard block — don't even try if we know it's blocked
  if (isSyncBlocked) {
    setIsLocalOnly(true);
    return;
  }

  const pc = localStorage.getItem("dsa-app-passcode") || appPasscode;
  if (!pc) {
    addToast("Enter app passcode first via Sync panel.", "error");
    return;
  }

  setSyncStatus("syncing");
  try {
    const res  = await fetch("/api/sync", {
      method:  "POST",
      headers: {
        "Content-Type":   "application/json",
        "x-app-passcode": pc,
      },
      body: JSON.stringify({ syncKey: k, yearData: data }),
    });

    const json = await res.json().catch(() => ({}));

    if (res.status === 401) {
      setPasscodeVerified(false);
      setIsLocalOnly(true);
      addToast("Wrong passcode — data saved locally only.", "error");
      setSyncStatus("error");
      setTimeout(() => setSyncStatus("idle"), 4000);
      return;
    }

    if (res.status === 403) {
      // ── Max keys hit — hard block forever until key changes ───────────
      setIsSyncBlocked(true);
      setIsLocalOnly(true);
      setSyncStatus("error");
      const reason = json?.error || "Max sync keys reached.";
      setSyncBlockReason(reason);
      addToast(`🔒 Sync blocked — ${reason} Data is LOCAL ONLY.`, "error");
      setTimeout(() => setSyncStatus("idle"), 5000);
      return;
    }

    if (res.status === 429) {
      addToast("Too many requests — wait a minute.", "error");
      setSyncStatus("error");
      setTimeout(() => setSyncStatus("idle"), 4000);
      return;
    }

    if (!res.ok) {
      setIsLocalOnly(true);
      addToast(`Push failed (${res.status}): ${json?.error || "unknown"}`, "error");
      setSyncStatus("error");
      setTimeout(() => setSyncStatus("idle"), 4000);
      return;
    }

    // Success
    setIsLocalOnly(false);
    setSyncStatus("synced");
    setTimeout(() => setSyncStatus("idle"), 3000);
  } catch {
    setIsLocalOnly(true);
    setSyncStatus("error");
    addToast("Network error — data saved locally.", "error");
    setTimeout(() => setSyncStatus("idle"), 4000);
  }
};
  // ── Persistence ────────────────────────────────────────────────────────────
const persist = useCallback((next: YearData, skipPush = false) => {
  setYearData(next);
  localStorage.setItem(STORAGE_KEY, JSON.stringify(next));

  // Never auto-push during boot pull or when sync is blocked
  if (!skipPush && !isInitialSync && !isSyncBlocked) {
    const k  = localStorage.getItem("dsa-sync-key");
    const pc = localStorage.getItem("dsa-app-passcode");
    if (k && pc) pushToCloud(next, k);
  }
}, [isInitialSync, isSyncBlocked]); // eslint-disable-line react-hooks/exhaustive-deps
  const updateStatus = useCallback((month: string, day: number, status: "succeed" | "wasted") => {
    setYearData(prev => {
      const existing = prev[month]?.[day] ?? { learned: "", did: "", timeLeak: "" };
      const next = { ...prev, [month]: { ...(prev[month] || {}), [day]: { ...existing, status } } };
      localStorage.setItem(STORAGE_KEY, JSON.stringify(next));
      return next;
    });
    addToast(status === "succeed" ? `${month} ${day} → WIN ✓` : `${month} ${day} → Wasted logged`, status === "succeed" ? "success" : "error");
  }, [addToast]);

  const saveAudit = useCallback(() => {
    if (!selectedMonth || selectedDay === null) return;
    setYearData(prev => {
      const existing = prev[selectedMonth]?.[selectedDay] ?? { status: "wasted" as const };
      const next = {
        ...prev,
        [selectedMonth]: {
          ...(prev[selectedMonth] || {}),
          [selectedDay]: { ...existing, learned: learnedInput, did: didInput, timeLeak: leakInput },
        },
      };
      localStorage.setItem(STORAGE_KEY, JSON.stringify(next));
      return next;
    });
    setSaveState("saved");
    addToast("Audit committed to disk ✓", "success");
    setTimeout(() => setSaveState("idle"), 2500);
  }, [selectedMonth, selectedDay, learnedInput, didInput, leakInput, addToast]);

  const selectDay = useCallback((month: string, day: number, yd?: YearData) => {
    const data = yd || yearData;
    setSelectedMonth(month);
    setSelectedDay(day);
    const d = data[month]?.[day];
    setLearnedInput(d?.learned || "");
    setDidInput(d?.did || "");
    setLeakInput(d?.timeLeak || "");
    setMobileView("log");
  }, [yearData]);

  const jumpToToday = () => {
    selectDay(TODAY_MONTH, TODAY_DAY);
    setTimeout(() => todayRef.current?.scrollIntoView({ behavior: "smooth", block: "center" }), 50);
    setMobileView("calendar");
  };
  // ── Reset only the selected day ────────────────────────────────────────────
  const resetCurrentDay = () => {
    if (!confirmReset) {
      setConfirmReset(true);
      setTimeout(() => setConfirmReset(false), 3000);
      return;
    }

    // Remove this day's entry completely from yearData
    const updatedMonth = { ...(yearData[selectedMonth] || {}) };
    delete updatedMonth[selectedDay];

    const updated = { ...yearData, [selectedMonth]: updatedMonth };

    // Clean up empty month key
    if (Object.keys(updatedMonth).length === 0) {
      delete updated[selectedMonth];
    }

    persist(updated);

    // Clear audit fields
    setLearnedInput("");
    setDidInput("");
    setLeakInput("");
    setConfirmReset(false);

    addToast(`${selectedMonth} ${selectedDay} cleared.`, "info");
  };
  // ── Export JSON backup ─────────────────────────────────────────────────────
  const downloadBackup = () => {
    if (Object.keys(yearData).length === 0) {
      addToast("Nothing to backup yet — mark some days first.", "info");
      return;
    }

    const payload = {
      version: "dsa-war-room-v5",
      exportedAt: new Date().toISOString(),
      year: YEAR,
      data: yearData,
    };

    const blob = new Blob([JSON.stringify(payload, null, 2)], {
      type: "application/json",
    });

    const url = URL.createObjectURL(blob);
    const a = document.createElement("a");
    const date = new Date().toISOString().slice(0, 10); // 2026-01-25

    a.href = url;
    a.download = `dsa-warroom-backup-${YEAR}-${date}.json`;
    a.click();
    URL.revokeObjectURL(url);

    addToast("Backup downloaded ✓", "success");
  };

  // ── Import JSON backup ─────────────────────────────────────────────────────
  const loadBackup = (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (!file) return;

    // Reset input so same file can be re-selected if needed
    e.target.value = "";

    const reader = new FileReader();

    reader.onload = (ev) => {
      try {
        const raw = ev.target?.result as string;
        const parsed = JSON.parse(raw);

        // ── Validate shape ────────────────────────────────────────────────────
        // Accept both raw YearData and our wrapped payload format
        let imported: YearData;

        if (parsed?.version === "dsa-war-room-v5" && parsed?.data) {
          // Our own export format
          imported = parsed.data as YearData;
        } else if (typeof parsed === "object" && !Array.isArray(parsed)) {
          // Maybe a raw YearData dump — do a quick sanity check
          const keys = Object.keys(parsed);
          const looksValid = keys.length === 0 || keys.some(k => MONTHS.includes(k));
          if (!looksValid) throw new Error("Unrecognised file format.");
          imported = parsed as YearData;
        } else {
          throw new Error("Unrecognised file format.");
        }

        // ── Merge strategy: imported data wins for any conflicting day ────────
        const merged: YearData = { ...yearData };

        MONTHS.forEach((m) => {
          if (!imported[m]) return;
          merged[m] = { ...(merged[m] || {}), ...imported[m] };
        });

        persist(merged);

        // Refresh audit panel fields for currently selected day
        const d = merged[selectedMonth]?.[selectedDay];
        setLearnedInput(d?.learned || "");
        setDidInput(d?.did || "");
        setLeakInput(d?.timeLeak || "");

        const totalDays = Object.values(imported)
          .reduce((sum, m) => sum + Object.keys(m).length, 0);

        addToast(`Loaded ${totalDays} day(s) from backup ✓`, "success");
      } catch (err) {
        addToast(
          err instanceof Error ? `Import failed: ${err.message}` : "Import failed — invalid file.",
          "error",
        );
      }
    };

    reader.onerror = () => addToast("Could not read file.", "error");
    reader.readAsText(file);
  };


  // ── Pull from cloud ────────────────────────────────────────────────────────
const pullFromCloud = async (key?: string, localData?: YearData) => {
  const k  = (key || syncKey).trim();
  if (!k || k.length < 4) return;

  if (isSyncBlocked) {
    addToast("Sync is blocked — change your sync key.", "error");
    return;
  }

  const pc = localStorage.getItem("dsa-app-passcode") || appPasscode;
  if (!pc) {
    addToast("Enter app passcode first via Sync panel.", "error");
    return;
  }

  setSyncStatus("syncing");
  try {
    const res  = await fetch(
      `/api/sync?key=${encodeURIComponent(k)}`,
      { headers: { "x-app-passcode": pc } }
    );

    const json = await res.json().catch(() => ({}));

    if (res.status === 401) {
      setPasscodeVerified(false);
      setIsLocalOnly(true);
      addToast("Wrong passcode — re-enter in Sync panel.", "error");
      setSyncStatus("error");
      setTimeout(() => setSyncStatus("idle"), 4000);
      return;
    }

    if (res.status === 403) {
      setIsSyncBlocked(true);
      setIsLocalOnly(true);
      setSyncBlockReason(json?.error || "Max sync keys reached.");
      addToast(`🔒 Sync blocked — ${json?.error}`, "error");
      setSyncStatus("error");
      setTimeout(() => setSyncStatus("idle"), 5000);
      return;
    }

    if (res.status === 400) {
      addToast(`Bad sync key: ${json?.error}`, "error");
      setSyncStatus("error");
      setTimeout(() => setSyncStatus("idle"), 4000);
      return;
    }

    if (res.status === 429) {
      addToast("Too many requests — wait a minute.", "error");
      setSyncStatus("error");
      setTimeout(() => setSyncStatus("idle"), 4000);
      return;
    }

    if (!res.ok) {
      setIsLocalOnly(true);
      addToast(`Server error (${res.status}): ${json?.error}`, "error");
      setSyncStatus("error");
      setTimeout(() => setSyncStatus("idle"), 4000);
      return;
    }

    const { data } = json;

    if (!data) {
      // Nothing in cloud — push local up only if we have local data
      const existing = localData || yearData;
      if (Object.keys(existing).length > 0) {
        await pushToCloud(existing, k);
        addToast("First sync — local data pushed to cloud ✓", "success");
      } else {
        addToast("Sync key ready. No data yet — start marking days!", "info");
      }
      setIsLocalOnly(false);
      setSyncStatus("synced");
      setTimeout(() => setSyncStatus("idle"), 3000);
      return;
    }

    // ── Merge: cloud wins on any conflicting day ───────────────────────
    const cloudData: YearData =
      typeof data === "string" ? JSON.parse(data) : data;

    // Start from local, overwrite with cloud
    const merged: YearData = { ...(localData || yearData) };
    MONTHS.forEach((m) => {
      if (!cloudData[m]) return;
      // Cloud days override local days
      merged[m] = { ...(merged[m] || {}), ...cloudData[m] };
    });

    // Save merged locally — skip push (we just pulled, no need to push back)
    setYearData(merged);
    localStorage.setItem(STORAGE_KEY, JSON.stringify(merged));

    // Refresh audit panel
    const d = merged[selectedMonth]?.[selectedDay];
    setLearnedInput(d?.learned  || "");
    setDidInput    (d?.did      || "");
    setLeakInput   (d?.timeLeak || "");

    setIsLocalOnly(false);
    setIsSyncBlocked(false);

    const totalDays = Object.values(cloudData).reduce(
      (sum, m) => sum + Object.keys(m).length, 0
    );
    addToast(`Pulled ${totalDays} day(s) from cloud ✓`, "success");
    setSyncStatus("synced");
    setTimeout(() => setSyncStatus("idle"), 3000);
  } catch {
    setIsLocalOnly(true);
    setSyncStatus("error");
    addToast("Network error — working offline.", "error");
    setTimeout(() => setSyncStatus("idle"), 4000);
  }
};
  // ── Verify app passcode against server ─────────────────────────────────────
const verifyPasscode = async () => {
  const pc = appPasscodeInput.trim();
  if (!pc) {
    setPasscodeError("Enter a passcode first.");
    return;
  }

  setPasscodeError("");
  setSyncStatus("syncing");

  try {
    // Hit the dedicated probe endpoint — no key validation involved
    const res = await fetch("/api/sync?key=__probe__", {
      headers: { "x-app-passcode": pc },
    });

    if (res.status === 401) {
      setPasscodeError("Wrong passcode. Ask your group admin.");
      setSyncStatus("error");
      setTimeout(() => setSyncStatus("idle"), 3000);
      return;
    }

    if (res.ok) {
      setAppPasscode(pc);
      setPasscodeVerified(true);
      localStorage.setItem("dsa-app-passcode", pc);
      setSyncStatus("idle");
      addToast("App passcode verified ✓", "success");
      setPasscodeError("");
      return;
    }

    // Any other error
    const body = await res.json().catch(() => ({}));
    setPasscodeError(body?.error || `Unexpected error (${res.status})`);
    setSyncStatus("error");
    setTimeout(() => setSyncStatus("idle"), 3000);
  } catch {
    setPasscodeError("Network error — check connection.");
    setSyncStatus("idle");
  }
};

  // ── Clear app passcode ──────────────────────────────────────────────────────
  const clearPasscode = () => {
    setAppPasscode("");
    setAppPasscodeInput("");
    setPasscodeVerified(false);
    setPasscodeError("");
    localStorage.removeItem("dsa-app-passcode");
    disconnectSync(); // also disconnect sync key since passcode is gone
    addToast("Passcode cleared.", "info");
  };
  // ── Activate sync key ──────────────────────────────────────────────────────
const activateSyncKey = async () => {
  // Sanitize: lowercase, spaces → hyphens, strip invalid chars
  const k = syncKeyInput
    .trim()
    .toLowerCase()
    .replace(/\s+/g, "-")
    .replace(/[^a-z0-9._-]/g, "");

  if (k.length < 4) {
    addToast("Sync key must be at least 4 characters.", "error");
    return;
  }

  // Update input to show sanitized version
  setSyncKeyInput(k);
  setSyncKey(k);
  setIsSyncEnabled(true);
  localStorage.setItem("dsa-sync-key", k);
  await pullFromCloud(k);
  setShowSyncPanel(false);
};

  // ── Disconnect sync ────────────────────────────────────────────────────────
const disconnectSync = () => {
  setSyncKey("");
  setSyncKeyInput("");
  setIsSyncEnabled(false);
  setIsSyncBlocked(false);
  setSyncBlockReason("");
  setIsLocalOnly(false);
  setSyncStatus("idle");
  localStorage.removeItem("dsa-sync-key");
  addToast("Cloud sync disconnected. Data still saved locally.", "info");
};

  // ── Keyboard shortcuts ─────────────────────────────────────────────────────
  useEffect(() => {
    if (!mounted) return;
    const onKey = (e: KeyboardEvent) => {
      const tag = (e.target as HTMLElement).tagName.toLowerCase();
      if (tag === "textarea" || tag === "input") return; // don't hijack typing

      switch (e.key.toLowerCase()) {
        case "w": updateStatus(selectedMonth, selectedDay, "succeed"); break;
        case "l": updateStatus(selectedMonth, selectedDay, "wasted"); break;
        case "s": if (e.ctrlKey || e.metaKey) { e.preventDefault(); saveAudit(); } break;
        case "t": jumpToToday(); break;
        case "?": setShowShortcuts(v => !v); break;
        case "escape": setShowShortcuts(false); break;
        case "arrowleft": {
          // previous day
          const d = new Date(YEAR, MONTHS.indexOf(selectedMonth), selectedDay - 1);
          if (d.getFullYear() === YEAR) selectDay(MONTHS[d.getMonth()], d.getDate());
          break;
        }
        case "arrowright": {
          // next day (not future)
          const d = new Date(YEAR, MONTHS.indexOf(selectedMonth), selectedDay + 1);
          const isFuture = d > TODAY;
          if (d.getFullYear() === YEAR && !isFuture) selectDay(MONTHS[d.getMonth()], d.getDate());
          break;
        }
      }
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [mounted, selectedMonth, selectedDay, updateStatus, saveAudit, selectDay]);

  if (!mounted) return (
  <div className="min-h-screen bg-slate-950 flex items-center justify-center">
    <div className="flex flex-col items-center gap-4">
      <div className="w-8 h-8 border-2 border-blue-500 border-t-transparent rounded-full animate-spin" />
      <div className="text-center space-y-1">
        <p className="text-slate-300 text-xs font-black uppercase tracking-widest">
          Loading War Room...
        </p>
        <p className="text-slate-600 text-[10px]">
          Syncing your data...
        </p>
      </div>
    </div>
  </div>
);
  // ── Computed stats ─────────────────────────────────────────────────────────
  let globalWins = 0, globalLosses = 0;
  Object.values(yearData).forEach(m => Object.values(m).forEach(d => {
    if (d.status === "succeed") globalWins++;
    if (d.status === "wasted") globalLosses++;
  }));
  const currentStreak = getCurrentStreak(yearData);
  const bestStreak = getBestStreak(yearData);
  const daysLeft = 365 - getDayOfYear();
  const totalMarked = globalWins + globalLosses;
  const winRate = totalMarked > 0 ? Math.round((globalWins / totalMarked) * 100) : 0;
  const todayStatus = yearData[TODAY_MONTH]?.[TODAY_DAY]?.status;
  const reality = getReality(globalWins, globalLosses, currentStreak, winRate, todayStatus);
  const selectedDayData = yearData[selectedMonth]?.[selectedDay];
  const isSelectedToday = selectedMonth === TODAY_MONTH && selectedDay === TODAY_DAY;

  // ─────────────────────────────────────────────────────────────────────────
  return (
    <div className="h-screen flex flex-col bg-slate-950 text-slate-100 overflow-hidden">
      <input
        ref={fileInputRef}
        type="file"
        accept=".json,application/json"
        className="hidden"
        onChange={loadBackup}
      />
      {/* ── TOAST STACK ────────────────────────────────────────────────────── */}
      <div className="fixed bottom-6 right-6 z-[100] flex flex-col gap-2 pointer-events-none">
        {toasts.map(t => (
          <div
            key={t.id}
            className={`flex items-center gap-2.5 px-4 py-2.5 rounded-xl text-xs font-black border shadow-2xl backdrop-blur-md animate-in slide-in-from-bottom-2 fade-in duration-200 pointer-events-auto ${t.type === "success" ? "bg-emerald-950/90 border-emerald-600/50 text-emerald-300" :
              t.type === "error" ? "bg-rose-950/90    border-rose-600/50    text-rose-300" :
                "bg-slate-800/90   border-slate-600/50   text-slate-300"
              }`}
          >
            {t.type === "success" ? <CheckCircle size={12} /> : t.type === "error" ? <XCircle size={12} /> : <Zap size={12} />}
            {t.message}
          </div>
        ))}
      </div>

      {/* ── KEYBOARD SHORTCUTS MODAL ────────────────────────────────────────── */}
      {showShortcuts && (
        <div className="fixed inset-0 z-[90] bg-slate-950/80 backdrop-blur-sm flex items-center justify-center p-4"
          onClick={() => setShowShortcuts(false)}>
          <div className="bg-slate-900 border border-slate-700 rounded-2xl p-6 w-full max-w-sm shadow-2xl"
            onClick={e => e.stopPropagation()}>
            <div className="flex items-center justify-between mb-5">
              <h3 className="text-sm font-black uppercase tracking-widest text-white flex items-center gap-2">
                <Keyboard size={14} className="text-blue-400" /> Shortcuts
              </h3>
              <button onClick={() => setShowShortcuts(false)}
                className="text-slate-600 hover:text-slate-300 transition-colors">
                <X size={16} />
              </button>
            </div>
            <div className="space-y-2">
              {[
                ["W", "Mark today → WIN"],
                ["L", "Mark today → WASTED"],
                ["Ctrl + S", "Save audit log"],
                ["T", "Jump to Today"],
                ["← →", "Previous / Next day"],
                ["?", "Toggle this panel"],
                ["Esc", "Close modal"],
              ].map(([key, desc]) => (
                <div key={key} className="flex items-center justify-between">
                  <span className="text-[11px] text-slate-400">{desc}</span>
                  <kbd className="text-[10px] font-black bg-slate-800 border border-slate-700 text-slate-300 px-2 py-0.5 rounded-lg">
                    {key}
                  </kbd>
                </div>
              ))}
            </div>
          </div>
        </div>
      )}

      {/* ── SYNC PANEL MODAL ──────────────────────────────────────────────────── */}
      {showSyncPanel && (
        <div
          className="fixed inset-0 z-[90] bg-slate-950/80 backdrop-blur-sm
      flex items-center justify-center p-4"
          onClick={() => setShowSyncPanel(false)}
        >
          <div
            className="bg-slate-900 border border-slate-700 rounded-2xl p-6
        w-full max-w-md shadow-2xl space-y-5"
            onClick={e => e.stopPropagation()}
          >
            {/* Header */}
            <div className="flex items-center justify-between">
              <h3 className="text-sm font-black uppercase tracking-widest text-white
          flex items-center gap-2">
                <Cloud size={14} className="text-blue-400" /> Cloud Sync
              </h3>
              <button
                onClick={() => setShowSyncPanel(false)}
                className="text-slate-600 hover:text-slate-300 transition-colors"
              >
                <X size={16} />
              </button>
            </div>

            {/* ── STEP 1: App Passcode ────────────────────────────────────────── */}
            <div className={`rounded-xl border p-4 space-y-3 transition-all ${passcodeVerified
                ? "border-emerald-600/30 bg-emerald-950/30"
                : "border-slate-700 bg-slate-800/30"
              }`}>
              {/* Step label */}
              <div className="flex items-center justify-between">
                <p className={`text-[9px] font-black uppercase tracking-widest flex items-center gap-1.5 ${passcodeVerified ? "text-emerald-400" : "text-slate-400"
                  }`}>
                  <span className={`w-4 h-4 rounded-full flex items-center justify-center text-[8px] font-black border ${passcodeVerified
                      ? "bg-emerald-500 border-emerald-400 text-white"
                      : "bg-slate-800 border-slate-600 text-slate-400"
                    }`}>1</span>
                  App Passcode
                </p>
                {passcodeVerified && (
                  <button
                    onClick={clearPasscode}
                    className="text-[8px] font-black text-slate-600 hover:text-rose-400
                transition-colors uppercase tracking-wider"
                  >
                    Clear
                  </button>
                )}
              </div>

              {passcodeVerified ? (
                /* Verified state */
                <div className="flex items-center gap-2">
                  <CheckCircle size={14} className="text-emerald-400 shrink-0" />
                  <div>
                    <p className="text-xs font-black text-emerald-400">Passcode verified</p>
                    <p className="text-[10px] text-slate-500">
                      Stored locally — won&apos;t ask again on this device.
                    </p>
                  </div>
                </div>
              ) : (
                /* Input state */
                <>
                  <p className="text-[10px] text-slate-500 leading-relaxed">
                    Enter the group passcode shared by your admin.
                    This protects the API from public access.
                  </p>
                  <div className="flex gap-2">
                    <input
                      type="password"
                      value={appPasscodeInput}
                      onChange={e => {
                        setAppPasscodeInput(e.target.value);
                        setPasscodeError("");
                      }}
                      onKeyDown={e => e.key === "Enter" && verifyPasscode()}
                      placeholder="Group passcode..."
                      className="flex-1 bg-slate-950 border border-slate-800
                  focus:border-blue-500/60 rounded-xl px-3 py-2.5
                  text-sm font-black text-white focus:outline-none
                  placeholder:text-slate-700"
                      autoFocus
                    />
                    <button
                      onClick={verifyPasscode}
                      disabled={syncStatus === "syncing"}
                      className="px-4 py-2.5 rounded-xl bg-blue-600 hover:bg-blue-500
                  text-white text-[10px] font-black uppercase tracking-wider
                  transition-all disabled:opacity-50 shrink-0"
                    >
                      {syncStatus === "syncing" ? (
                        <RefreshCw size={12} className="animate-spin" />
                      ) : "Verify"}
                    </button>
                  </div>
                  {passcodeError && (
                    <p className="text-[10px] font-bold text-rose-400 flex items-center gap-1">
                      <XCircle size={10} /> {passcodeError}
                    </p>
                  )}
                </>
              )}
            </div>

            {/* ── STEP 2: Sync Key ────────────────────────────────────────────── */}
            <div className={`rounded-xl border p-4 space-y-3 transition-all ${!passcodeVerified
                ? "opacity-40 pointer-events-none border-slate-800 bg-slate-900/30"
                : isSyncEnabled
                  ? "border-emerald-600/30 bg-emerald-950/30"
                  : "border-slate-700 bg-slate-800/30"
              }`}>
              {/* Step label */}
              <p className={`text-[9px] font-black uppercase tracking-widest flex items-center gap-1.5 ${isSyncEnabled ? "text-emerald-400" : "text-slate-400"
                }`}>
                <span className={`w-4 h-4 rounded-full flex items-center justify-center text-[8px] font-black border ${isSyncEnabled
                    ? "bg-emerald-500 border-emerald-400 text-white"
                    : "bg-slate-800 border-slate-600 text-slate-400"
                  }`}>2</span>
                Your Personal Sync Key
              </p>

              {!passcodeVerified && (
                <p className="text-[10px] text-slate-600">
                  Complete step 1 first.
                </p>
              )}

              {passcodeVerified && (
                <>
                  {isSyncEnabled ? (
                    /* Connected state */
                    <>
                      <div className="flex items-center justify-between">
                        <div>
                          <p className="text-[9px] text-slate-500 uppercase tracking-widest font-bold">
                            Active Key
                          </p>
                          <p className="text-lg font-black text-white mt-0.5 tracking-widest">
                            {syncKey}
                          </p>
                        </div>
                        <CheckCircle size={18} className="text-emerald-400" />
                      </div>

                      <p className="text-[10px] text-slate-500 leading-relaxed">
                        Use this exact key on your other devices to access the same data.
                        Each person in your group should have a <span className="text-white">different</span> key.
                      </p>

                      {/* Action buttons */}
                      <div className="flex gap-2">
                        <button
                          onClick={() => pullFromCloud()}
                          disabled={syncStatus === "syncing"}
                          className="flex-1 flex items-center justify-center gap-1.5
                      py-2 rounded-xl bg-blue-600 hover:bg-blue-500
                      text-white text-[10px] font-black uppercase tracking-wider
                      transition-all disabled:opacity-50"
                        >
                          {syncStatus === "syncing"
                            ? <RefreshCw size={10} className="animate-spin" />
                            : <RefreshCw size={10} />
                          }
                          Pull from Cloud
                        </button>
                        <button
                          onClick={disconnectSync}
                          className="flex items-center justify-center gap-1.5 px-3
                      py-2 rounded-xl bg-rose-500/10 border border-rose-500/25
                      text-rose-400 hover:bg-rose-500/20 text-[10px] font-black
                      uppercase tracking-wider transition-all"
                        >
                          <CloudOff size={10} /> Disconnect
                        </button>
                      </div>
                    </>
                  ) : (
                    /* Input state */
                    <>
                      <p className="text-[10px] text-slate-500 leading-relaxed">
                        Pick a personal key. Anyone with the same key sees the same data —
                        make it unique to you.
                      </p>
                      <div className="flex gap-2">
                        <input
                          type="text"
                          value={syncKeyInput}
                          onChange={e => setSyncKeyInput(
                            e.target.value.toLowerCase().replace(/\s+/g, "-")
                          )}
                          onKeyDown={e => e.key === "Enter" && activateSyncKey()}
                          placeholder="e.g. ravi-dsa-2026"
                          className="flex-1 bg-slate-950 border border-slate-800
                      focus:border-blue-500/60 rounded-xl px-3 py-2.5
                      text-sm font-black text-white focus:outline-none
                      placeholder:text-slate-700 tracking-wider"
                        />
                        <button
                          onClick={activateSyncKey}
                          disabled={syncStatus === "syncing"}
                          className="px-4 py-2.5 rounded-xl bg-blue-600 hover:bg-blue-500
                      text-white text-[10px] font-black uppercase tracking-wider
                      transition-all disabled:opacity-50 shrink-0 flex items-center gap-1"
                        >
                          {syncStatus === "syncing"
                            ? <RefreshCw size={10} className="animate-spin" />
                            : <Link size={10} />
                          }
                          Connect
                        </button>
                      </div>
                      <p className="text-[9px] text-slate-700">
                        4–40 chars · lowercase · hyphens/underscores ok · spaces auto-converted
                      </p>
                    </>
                  )}
                </>
              )}
            </div>

            {/* Info box */}
            <div className="bg-slate-800/40 border border-slate-700/50 rounded-xl p-3">
              <p className="text-[9px] text-slate-600 leading-relaxed">
                <span className="text-slate-400 font-bold">How to share with group:</span>
                {" "}Share the App Passcode with your 2–3 friends.
                Each person picks their own sync key.
                Data is isolated per key — no one sees each other&apos;s data.
              </p>
            </div>

          </div>
        </div>
      )}

      {/* ── STICKY HEADER ────────────────────────────────────────────────────── */}
      <header className="shrink-0 bg-slate-950/95 backdrop-blur-md border-b border-slate-800/80 px-4 py-3 z-40">
        <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-2">
          {/* Title + reality */}
          <div className="min-w-0">
            <div className="flex items-center gap-2 flex-wrap">
              <h1 className="text-base font-black uppercase tracking-tight text-white">
                DSA War Room <span className="text-blue-500">{YEAR}</span>
              </h1>
              {/* Cloud Sync button */}
              <button
                onClick={() => setShowSyncPanel(v => !v)}
                className={`text-[9px] font-black uppercase tracking-widest px-2 py-1 rounded-lg border transition-all flex items-center gap-1 ${syncStatus === "syncing" ? "bg-blue-500/20 border-blue-500/50 text-blue-400 animate-pulse" :
                    syncStatus === "synced" ? "bg-emerald-500/20 border-emerald-500/40 text-emerald-400" :
                      syncStatus === "error" ? "bg-rose-500/20 border-rose-500/40 text-rose-400" :
                        isSyncEnabled ? "bg-emerald-500/10 border-emerald-500/25 text-emerald-400 hover:bg-emerald-500/20" :
                          "bg-slate-800 border-slate-700 text-slate-500 hover:text-slate-300"
                  }`}
              >
                {syncStatus === "syncing" ? <RefreshCw size={9} className="animate-spin" /> :
                  isSyncEnabled ? <Cloud size={9} /> :
                    <CloudOff size={9} />}
                {syncStatus === "syncing" ? "Syncing..." :
                  syncStatus === "synced" ? "Synced ✓" :
                    syncStatus === "error" ? "Sync Error" :
                      isSyncEnabled ? "Cloud On" : "Sync"}
              </button>
              {/* Download backup */}
              <button
                onClick={downloadBackup}
                className="text-[9px] font-black uppercase tracking-widest px-2 py-1 rounded-lg border
                  bg-emerald-500/10 border-emerald-500/25 text-emerald-400
                  hover:bg-emerald-500/20 transition-all flex items-center gap-1"
              >
                <Download size={9} /> Backup
              </button>

              {/* Load backup */}
              <button
                onClick={() => fileInputRef.current?.click()}
                className="text-[9px] font-black uppercase tracking-widest px-2 py-1 rounded-lg border
                  bg-slate-800 border-slate-700 text-slate-400
                  hover:text-white hover:border-slate-500 transition-all flex items-center gap-1"
              >
                <Upload size={9} /> Load
              </button>
              {/* Jump to today */}
              <button onClick={jumpToToday}
                className="text-[9px] font-black uppercase tracking-widest px-2 py-1 rounded-lg border bg-blue-500/10 border-blue-500/25 text-blue-400 hover:bg-blue-500/20 transition-all flex items-center gap-1">
                <Calendar size={9} /> Today
              </button>
              {/* Shortcuts */}
              <button onClick={() => setShowShortcuts(v => !v)}
                className="text-[9px] font-black uppercase tracking-widest px-2 py-1 rounded-lg border bg-slate-800 border-slate-700 text-slate-500 hover:text-slate-300 transition-all flex items-center gap-1">
                <Keyboard size={9} /> ?
              </button>
            </div>
            <p className={`text-[11px] font-bold mt-0.5 truncate ${reality.color}`}>{reality.text}</p>
          </div>

          {/* Stat pills */}
          <div className="flex flex-wrap gap-1.5 shrink-0">
            <StatPill icon={<Flame size={11} className="text-orange-400 fill-orange-400/50" />} label="Streak" value={`${currentStreak}d`} bg="bg-orange-500/10 border-orange-500/25" color="text-orange-400" />
            <StatPill icon={<Trophy size={11} className="text-yellow-400" />} label="Best" value={`${bestStreak}d`} bg="bg-yellow-500/10 border-yellow-500/25" color="text-yellow-400" />
            <StatPill icon={<CheckCircle size={11} className="text-emerald-400" />} label="Wins" value={String(globalWins)} bg="bg-emerald-500/10 border-emerald-500/25" color="text-emerald-400" />
            <StatPill icon={<ShieldAlert size={11} className="text-rose-400" />} label="Wasted" value={String(globalLosses)} bg="bg-rose-500/10 border-rose-500/25" color="text-rose-400" />
            <StatPill icon={<TrendingUp size={11} className="text-blue-400" />} label="Rate" value={`${winRate}%`} bg="bg-blue-500/10 border-blue-500/25" color="text-blue-400" />
            <StatPill icon={<Calendar size={11} className="text-slate-400" />} label="Left" value={`${daysLeft}d`} bg="bg-slate-700/30 border-slate-700/50" color="text-slate-300" />
          </div>
        </div>
      </header>
      {/* ── LOCAL ONLY WARNING BANNER ──────────────────────────────────────── */}
{(isLocalOnly || isSyncBlocked) && mounted && (
  <div className={`shrink-0 px-4 py-2 flex items-center justify-between gap-3 text-xs font-black ${
    isSyncBlocked
      ? "bg-rose-950/80 border-b border-rose-600/40 text-rose-300"
      : "bg-orange-950/80 border-b border-orange-600/40 text-orange-300"
  }`}>
    <div className="flex items-center gap-2">
      <CloudOff size={13} className="shrink-0" />
      <span>
        {isSyncBlocked
          ? `🔒 SYNC BLOCKED — ${syncBlockReason} Your data is saved locally only.`
          : "⚠ OFFLINE MODE — Changes saved locally. Cloud unreachable."}
      </span>
    </div>
    {isSyncBlocked ? (
      <button
        onClick={() => setShowSyncPanel(true)}
        className="shrink-0 px-2 py-1 rounded-lg bg-rose-600/30
          border border-rose-500/40 hover:bg-rose-600/50
          transition-all text-[9px] uppercase tracking-wider"
      >
        Change Key
      </button>
    ) : (
      <button
        onClick={() => pullFromCloud()}
        className="shrink-0 px-2 py-1 rounded-lg bg-orange-600/30
          border border-orange-500/40 hover:bg-orange-600/50
          transition-all text-[9px] uppercase tracking-wider"
      >
        Retry Sync
      </button>
    )}
  </div>
)}

      {/* ── MOBILE TAB BAR ────────────────────────────────────────────────────── */}
      <div className="xl:hidden shrink-0 border-b border-slate-800/80 bg-slate-950/95 z-30">
        <div className="flex">
          {(["calendar", "log"] as const).map(v => (
            <button key={v} onClick={() => setMobileView(v)}
              className={`flex-1 py-2.5 text-[10px] font-black uppercase tracking-widest transition-all border-b-2 ${mobileView === v ? "border-blue-500 text-blue-400" : "border-transparent text-slate-600 hover:text-slate-400"
                }`}>
              {v === "calendar" ? "📅 Calendar" : `📝 ${selectedMonth} ${selectedDay}`}
            </button>
          ))}
        </div>
      </div>

      {/* ── MAIN RESIZABLE BODY ───────────────────────────────────────────────── */}
      <div
        ref={containerRef}
        className={`flex-1 flex overflow-hidden ${isDragging ? "select-none cursor-col-resize" : ""}`}
      >

        {/* ── LEFT CALENDAR PANEL ─────────────────────────────────────────────── */}
        <div
          ref={calScrollRef}
          className={`relative flex flex-col overflow-y-auto overflow-x-hidden ${mobileView === "log" ? "hidden xl:flex" : "flex"}`}
          style={{ width: `${leftPct}%` }}
        >
          {/* Month quick-jump pills */}
          <div className="sticky top-0 z-20 bg-slate-950/95 backdrop-blur-md border-b border-slate-800/50 px-4 py-2">
            <div className="flex gap-1.5 overflow-x-auto scrollbar-none">
              {MONTHS.map((m, i) => {
                const s = getMonthStats(yearData, m);
                const isNow = m === TODAY_MONTH;
                const hasSel = selectedMonth === m;
                return (
                  <button
                    key={m}
                    onClick={() => {
                      // scroll the month card into view
                      const el = document.getElementById(`month-${m}`);
                      el?.scrollIntoView({ behavior: "smooth", block: "start" });
                    }}
                    className={`shrink-0 flex items-center gap-1 px-2.5 py-1 rounded-lg text-[9px] font-black uppercase tracking-wider border transition-all ${isNow ? "bg-blue-500/20 border-blue-500/50 text-blue-400" :
                      hasSel ? "bg-slate-700/50 border-slate-600 text-slate-300" :
                        "bg-slate-900 border-slate-800 text-slate-600 hover:text-slate-400 hover:border-slate-700"
                      }`}
                  >
                    {m.slice(0, 3)}
                    {s.rate !== null && (
                      <span className={`${s.rate >= 70 ? "text-emerald-400" : s.rate >= 50 ? "text-yellow-400" : "text-rose-400"}`}>
                        {s.rate}%
                      </span>
                    )}
                  </button>
                );
              })}
            </div>
          </div>

          {/* 12-month grid */}
          <div className="p-4 grid grid-cols-1 sm:grid-cols-2 2xl:grid-cols-3 gap-4 content-start">
            {MONTHS.map((month, mIdx) => {
              const daysInMonth = getDaysInMonth(mIdx);
              const offset = getFirstDayOffset(mIdx);
              const isNowMonth = month === TODAY_MONTH;
              const isFutureMonth = mIdx > TODAY_M_IDX;
              const stats = getMonthStats(yearData, month);

              return (
                <div
                  key={month}
                  id={`month-${month}`}
                  ref={isNowMonth ? todayRef : null}
                  className={`bg-slate-900 rounded-2xl border p-4 transition-all scroll-mt-16 ${isNowMonth ? "border-blue-500/50 shadow-xl shadow-blue-500/5" : "border-slate-800 hover:border-slate-700"
                    }`}
                >
                  {/* Month header */}
                  <div className="flex items-center justify-between mb-2">
                    <div className="flex items-center gap-2">
                      <h3 className={`text-[11px] font-black uppercase tracking-widest ${isNowMonth ? "text-blue-400" : "text-slate-400"}`}>
                        {month}
                      </h3>
                      {isNowMonth && <span className="text-[7px] bg-blue-500 text-white font-black px-1.5 py-0.5 rounded-full">NOW</span>}
                      {isFutureMonth && <span className="text-[7px] text-slate-700 font-bold">future</span>}
                    </div>
                    <div className="flex items-center gap-1 text-[9px] font-black">
                      {stats.wins > 0 && <span className="text-emerald-400">{stats.wins}W</span>}
                      {stats.wins > 0 && stats.losses > 0 && <span className="text-slate-700">·</span>}
                      {stats.losses > 0 && <span className="text-rose-400">{stats.losses}L</span>}
                      {stats.rate !== null && (
                        <span className={`ml-1 ${stats.rate >= 70 ? "text-emerald-400" : stats.rate >= 50 ? "text-yellow-400" : "text-rose-400"}`}>
                          {stats.rate}%
                        </span>
                      )}
                    </div>
                  </div>

                  {/* Progress bar */}
                  {stats.wins + stats.losses > 0 && (
                    <div className="mb-2 h-0.5 bg-slate-800 rounded-full overflow-hidden">
                      <div className="h-full bg-emerald-500/60 rounded-full transition-all duration-500"
                        style={{ width: `${stats.rate ?? 0}%` }} />
                    </div>
                  )}

                  {/* Day-of-week labels */}
                  <div className="grid grid-cols-7 gap-1 mb-1">
                    {["M", "T", "W", "T", "F", "S", "S"].map((d, i) => (
                      <div key={i} className="text-center text-[7px] text-slate-700 font-black">{d}</div>
                    ))}
                  </div>

                  {/* Day cells */}
                  <div className="grid grid-cols-7 gap-1">
                    {Array.from({ length: offset }).map((_, i) => <div key={`b${i}`} />)}

                    {Array.from({ length: daysInMonth }, (_, i) => i + 1).map((day) => {
                      const dayObj = yearData[month]?.[day];
                      const status = dayObj?.status;
                      const isToday = isNowMonth && day === TODAY_DAY;
                      const isSelected = selectedMonth === month && selectedDay === day;
                      const isFuture = isFutureMonth || (isNowMonth && day > TODAY_DAY);
                      const hasAudit = !!(dayObj?.learned || dayObj?.did || dayObj?.timeLeak);

                      let cell = "bg-slate-800/50 border-slate-700/40 text-slate-600 hover:bg-slate-700/50 hover:text-slate-300 cursor-pointer";
                      if (status === "succeed") cell = "bg-emerald-950/70 border-emerald-600/50 text-emerald-300 cursor-pointer hover:brightness-110";
                      if (status === "wasted") cell = "bg-rose-950/70    border-rose-600/50    text-rose-300    cursor-pointer hover:brightness-110";
                      if (isFuture && !status) cell = "bg-slate-900/20 border-slate-800/20 text-slate-800 cursor-default opacity-40";

                      // Make today's cell slightly bigger / more prominent
                      const todayCls = isToday
                        ? "ring-2 ring-blue-500 ring-offset-1 ring-offset-slate-900 scale-110 z-10"
                        : "";

                      return (
                        <div
                          key={day}
                          onClick={() => !isFuture && selectDay(month, day)}
                          title={`${month} ${day}${status ? ` — ${status}` : ""}${hasAudit ? " ✎" : ""}`}
                          className={`
                            group relative aspect-square rounded-md border
                            flex flex-col items-center justify-center
                            text-[9px] font-black transition-all duration-150 select-none
                            ${cell} ${todayCls}
                            ${isSelected && !isToday ? "ring-1 ring-white/30 ring-offset-1 ring-offset-slate-900" : ""}
                          `}
                        >
                          <span>{day}</span>

                          {/* Audit dot */}
                          {hasAudit && <span className="absolute bottom-[2px] w-[3px] h-[3px] rounded-full bg-blue-400" />}

                          {/* Hover quick-mark overlay */}
                          {!isFuture && (
                            <div className="absolute inset-0 bg-slate-900/95 rounded-md flex items-center justify-center gap-0.5
                              opacity-0 group-hover:opacity-100 transition-opacity z-20">
                              <button
                                onClick={e => { e.stopPropagation(); updateStatus(month, day, "succeed"); }}
                                className="text-emerald-400 hover:scale-125 transition-transform p-0.5"
                              ><CheckCircle size={10} /></button>
                              <button
                                onClick={e => { e.stopPropagation(); updateStatus(month, day, "wasted"); }}
                                className="text-rose-400 hover:scale-125 transition-transform p-0.5"
                              ><XCircle size={10} /></button>
                            </div>
                          )}
                        </div>
                      );
                    })}
                  </div>
                </div>
              );
            })}
          </div>

          {/* ── Scroll-to-top FAB ──────────────────────────────────────────────── */}
          {showScrollTop && (
            <button
              onClick={() => calScrollRef.current?.scrollTo({ top: 0, behavior: "smooth" })}
              className="fixed bottom-6 left-6 z-50 w-9 h-9 flex items-center justify-center rounded-full
                bg-slate-800 border border-slate-700 text-slate-400 hover:text-white
                hover:border-slate-500 shadow-xl transition-all hover:scale-110"
            >
              <ChevronUp size={16} />
            </button>
          )}
        </div>

        {/* ── DRAG DIVIDER ─────────────────────────────────────────────────────── */}
        <div
          onMouseDown={onDividerMouseDown}
          className={`hidden xl:flex shrink-0 w-1 relative items-center justify-center cursor-col-resize group z-30 ${isDragging ? "bg-blue-500/50" : "bg-slate-800 hover:bg-blue-500/40"
            } transition-colors`}
        >
          <div className={`absolute flex flex-col gap-1 ${isDragging ? "opacity-100" : "opacity-0 group-hover:opacity-100"} transition-opacity`}>
            <div className="w-1 h-6 rounded-full bg-blue-500/70" />
          </div>
          {/* Wider invisible hit area */}
          <div className="absolute inset-y-0 -inset-x-2" />
        </div>

        {/* ── RIGHT AUDIT PANEL ────────────────────────────────────────────────── */}
        <div
          className={`flex-1 overflow-y-auto flex flex-col gap-4 p-4 ${mobileView === "calendar" ? "hidden xl:flex" : "flex"}`}
        >

          {/* ── Audit form ──────────────────────────────────────────────────────── */}
          <div className="bg-slate-900 border border-slate-800 rounded-2xl p-5 shadow-2xl shrink-0">

            {/* Header */}
            <div className="flex items-start justify-between gap-3 mb-4">
              <div>
                <div className="flex items-center gap-2 flex-wrap">
                  <span className="text-[9px] font-black text-blue-400 bg-blue-500/10 border border-blue-500/20 px-2.5 py-1 rounded-full uppercase tracking-widest">
                    Audit Log
                  </span>
                  {isSelectedToday && (
                    <span className="text-[9px] font-black text-orange-400 bg-orange-500/10 border border-orange-500/20 px-2 py-1 rounded-full uppercase tracking-widest">
                      Today
                    </span>
                  )}
                </div>
                <h2 className="text-2xl font-black text-white mt-2 leading-none">
                  {selectedMonth} {selectedDay}
                </h2>
                {/* Day nav arrows */}
                <div className="flex items-center gap-1 mt-1.5">
                  <button
                    onClick={() => {
                      const d = new Date(YEAR, MONTHS.indexOf(selectedMonth), selectedDay - 1);
                      if (d.getFullYear() === YEAR) selectDay(MONTHS[d.getMonth()], d.getDate());
                    }}
                    className="p-1 rounded-lg bg-slate-800 border border-slate-700 text-slate-500 hover:text-white hover:border-slate-600 transition-all"
                  ><ChevronsLeft size={10} /></button>
                  <button
                    onClick={jumpToToday}
                    className="px-2 py-0.5 rounded-lg bg-slate-800 border border-slate-700 text-[8px] font-black text-slate-500 hover:text-white hover:border-slate-600 transition-all uppercase tracking-wider"
                  >Today</button>
                  <button
                    onClick={() => {
                      const d = new Date(YEAR, MONTHS.indexOf(selectedMonth), selectedDay + 1);
                      if (d.getFullYear() === YEAR && d <= TODAY) selectDay(MONTHS[d.getMonth()], d.getDate());
                    }}
                    className="p-1 rounded-lg bg-slate-800 border border-slate-700 text-slate-500 hover:text-white hover:border-slate-600 transition-all"
                  ><ChevronsRight size={10} /></button>
                  {/* ── Reset current day only ──────────────────────────────────────────── */}
                  {selectedDayData && (
                    <button
                      onClick={resetCurrentDay}
                      title={confirmReset ? "Click again to confirm clear" : `Clear ${selectedMonth} ${selectedDay}`}
                      className={`ml-auto flex items-center gap-1 px-2 py-0.5 rounded-lg border text-[8px] font-black uppercase tracking-wider transition-all ${confirmReset
                        ? "bg-rose-600 border-rose-500 text-white animate-pulse"
                        : "bg-slate-800 border-slate-700 text-slate-600 hover:text-rose-400 hover:border-rose-500/40"
                        }`}
                    >
                      <RotateCcw size={8} />
                      {confirmReset ? "Sure?" : "Clear Day"}
                    </button>
                  )}
                </div>
              </div>

              {/* Status buttons */}
              <div className="flex flex-col gap-1.5 shrink-0">
                <button
                  onClick={() => updateStatus(selectedMonth, selectedDay, "succeed")}
                  className={`flex items-center gap-1.5 px-3 py-2 rounded-xl text-[10px] font-black border transition-all ${selectedDayData?.status === "succeed"
                    ? "bg-emerald-500 border-emerald-400 text-white shadow-lg shadow-emerald-500/20"
                    : "bg-emerald-500/10 border-emerald-500/25 text-emerald-400 hover:bg-emerald-500/20"
                    }`}
                >
                  <CheckCircle size={10} /> Win <kbd className="text-[7px] opacity-50 ml-1">W</kbd>
                </button>
                <button
                  onClick={() => updateStatus(selectedMonth, selectedDay, "wasted")}
                  className={`flex items-center gap-1.5 px-3 py-2 rounded-xl text-[10px] font-black border transition-all ${selectedDayData?.status === "wasted"
                    ? "bg-rose-500 border-rose-400 text-white shadow-lg shadow-rose-500/20"
                    : "bg-rose-500/10 border-rose-500/25 text-rose-400 hover:bg-rose-500/20"
                    }`}
                >
                  <XCircle size={10} /> Wasted <kbd className="text-[7px] opacity-50 ml-1">L</kbd>
                </button>
              </div>
            </div>

            {/* Status banner */}
            {selectedDayData?.status && (
              <div className={`text-center py-2 rounded-xl text-[10px] font-black uppercase tracking-widest border mb-4 ${selectedDayData.status === "succeed"
                ? "bg-emerald-950/50 border-emerald-600/30 text-emerald-400"
                : "bg-rose-950/50 border-rose-600/30 text-rose-400"
                }`}>
                {selectedDayData.status === "succeed" ? "✓ WIN — keep the chain alive" : "✗ WASTED — log it, learn, bounce back"}
              </div>
            )}

            {/* Three audit fields */}
            <div className="space-y-3">
              <AuditField
                icon={<BookOpen size={10} />} label="What did I actually learn?" labelColor="text-emerald-400"
                borderFocus="focus:border-emerald-500/50" value={learnedInput} onChange={setLearnedInput}
                placeholder="Concept, pattern, algorithm. Not 'studied graphs' — write the actual insight."
              />
              <AuditField
                icon={<Code2 size={10} />} label="What did I actually do?" labelColor="text-blue-400"
                borderFocus="focus:border-blue-500/50" value={didInput} onChange={setDidInput}
                placeholder="LC problem #, CF problem, rating change, submissions. Zero is valid — write it."
              />
              <AuditField
                icon={<Clock size={10} />} label="Where did my 24 hours go?" labelColor="text-rose-400"
                borderFocus="focus:border-rose-500/50" value={leakInput} onChange={setLeakInput}
                placeholder="YouTube? Daydreaming? Roadmap tabs? Another tracker? Name the exact leak."
              />
            </div>

            {/* Save */}
            <button
              onClick={saveAudit}
              className={`mt-4 w-full font-black py-3 rounded-xl text-xs transition-all uppercase tracking-widest ${saveState === "saved"
                ? "bg-emerald-600 text-white cursor-default"
                : "bg-blue-600 hover:bg-blue-500 text-white active:scale-95"
                }`}
            >
              {saveState === "saved" ? "✓ Committed" : "Commit to Disk →"}
              {saveState === "idle" && <kbd className="ml-2 text-[8px] opacity-50">Ctrl+S</kbd>}
            </button>
          </div>

          {/* ── Saved preview ───────────────────────────────────────────────────── */}
          {(selectedDayData?.learned || selectedDayData?.did || selectedDayData?.timeLeak) && (
            <div className="bg-slate-900/50 border border-slate-800 rounded-2xl p-4 space-y-3 shrink-0">
              <p className="text-[9px] font-black text-slate-700 uppercase tracking-widest">
                Saved Entry — {selectedMonth} {selectedDay}
              </p>
              {selectedDayData.learned && <LogEntry icon={<BookOpen size={9} />} color="text-emerald-400" label="Learned" text={selectedDayData.learned} />}
              {selectedDayData.did && <LogEntry icon={<Code2 size={9} />} color="text-blue-400" label="Did" text={selectedDayData.did} />}
              {selectedDayData.timeLeak && <LogEntry icon={<Clock size={9} />} color="text-rose-400" label="Time Leak" text={selectedDayData.timeLeak} />}
            </div>
          )}

          {/* ── Brain Override ──────────────────────────────────────────────────── */}
          <div className="bg-slate-900 border border-orange-500/20 rounded-2xl p-4 shrink-0">
            <div className="flex items-center gap-2 mb-3">
              <Zap size={12} className="text-orange-400" />
              <h4 className="text-[9px] font-black text-orange-400 uppercase tracking-widest">Brain Override Protocol</h4>
            </div>
            <ul className="space-y-2 text-[10px] text-slate-500 leading-relaxed">
              <li><span className="text-orange-400 font-bold">→</span> Open LeetCode. Click <span className="text-white">one</span> problem. Just read it. That&apos;s your only task.</li>
              <li><span className="text-orange-400 font-bold">→</span> 25-min timer. Not for solving — just to <span className="text-white font-bold">sit still with it.</span></li>
              <li><span className="text-orange-400 font-bold">→</span> The urge to switch tabs IS the resistance. Staying is the rep.</li>
              <li><span className="text-orange-400 font-bold">→</span> Roadmaps = procrastination dressed up. Problem #1 is the roadmap.</li>
              <li><span className="text-orange-400 font-bold">→</span> Daydreaming about being rich ≠ the work. This app ≠ the work. LC = the work.</li>
              <li className="text-orange-300 font-black pt-1 border-t border-orange-500/20">→ Close this. Open LeetCode. Right now.</li>
            </ul>
          </div>

          {/* ── Legend ──────────────────────────────────────────────────────────── */}
          <div className="bg-slate-900 border border-slate-800 rounded-2xl p-4 shrink-0">
            <p className="text-[9px] font-black text-slate-700 uppercase tracking-widest mb-3">Legend</p>
            <div className="space-y-2">
              <LegendItem color="bg-emerald-950/70 border-emerald-600/50" label="Grinded — problem attempted or concept learned" />
              <LegendItem color="bg-rose-950/70 border-rose-600/50" label="Wasted — brain won, you didn&apos;t grind" />
              <LegendItem color="bg-slate-800/50 border-slate-700/40" label="Unmarked — log before bed. No blank days." />
              <div className="flex items-center gap-2.5">
                <div className="w-5 h-5 rounded-md border-2 border-blue-500 bg-slate-900 shrink-0" />
                <span className="text-[10px] text-slate-500">Blue ring + scale = today</span>
              </div>
              <div className="flex items-center gap-2.5">
                <div className="w-5 h-5 rounded-md bg-slate-800/50 border border-slate-700/40 relative shrink-0">
                  <span className="absolute bottom-[2px] left-1/2 -translate-x-1/2 w-[3px] h-[3px] rounded-full bg-blue-400" />
                </div>
                <span className="text-[10px] text-slate-500">Blue dot = audit written</span>
              </div>
            </div>
          </div>

        </div>{/* end right panel */}
      </div>{/* end body */}
    </div>
  );
}

// ─── Sub-components ───────────────────────────────────────────────────────────

function StatPill({ icon, label, value, bg, color }: {
  icon: React.ReactNode; label: string; value: string; bg: string; color: string;
}) {
  return (
    <div className={`flex items-center gap-1.5 border px-2.5 py-1.5 rounded-xl ${bg}`}>
      {icon}
      <div>
        <p className="text-[7px] text-slate-700 uppercase leading-none font-black">{label}</p>
        <p className={`text-xs font-black leading-tight ${color}`}>{value}</p>
      </div>
    </div>
  );
}

function AuditField({ icon, label, labelColor, borderFocus, value, onChange, placeholder }: {
  icon: React.ReactNode; label: string; labelColor: string; borderFocus: string;
  value: string; onChange: (v: string) => void; placeholder: string;
}) {
  return (
    <div>
      <label className={`flex items-center gap-1.5 text-[9px] font-black uppercase tracking-widest mb-1.5 ${labelColor}`}>
        {icon} {label}
      </label>
      <textarea
        value={value} onChange={e => onChange(e.target.value)} placeholder={placeholder} rows={3}
        className={`w-full bg-slate-950 border border-slate-800 ${borderFocus} rounded-xl p-3 text-[11px]
          text-slate-300 focus:outline-none resize-none placeholder:text-slate-700 transition-colors leading-relaxed`}
      />
    </div>
  );
}

function LogEntry({ icon, color, label, text }: {
  icon: React.ReactNode; color: string; label: string; text: string;
}) {
  return (
    <div>
      <p className={`flex items-center gap-1 text-[9px] font-black uppercase tracking-widest mb-1 ${color}`}>
        {icon} {label}
      </p>
      <p className="text-[11px] text-slate-400 leading-relaxed whitespace-pre-wrap break-words">{text}</p>
    </div>
  );
}

function LegendItem({ color, label }: { color: string; label: string }) {
  return (
    <div className="flex items-center gap-2.5">
      <div className={`w-5 h-5 rounded-md border shrink-0 ${color}`} />
      <span className="text-[10px] text-slate-500">{label}</span>
    </div>
  );
}