"use client";

import { useEffect, useRef, useState } from "react";

type Mode = "focus" | "break";
type Theme = "dark" | "light";

type Settings = {
  focus: number;
  break: number;
  autoStart: boolean;
  sound: boolean;
  notify: boolean;
};

const DEFAULT_SETTINGS: Settings = {
  focus: 25,
  break: 5,
  autoStart: false,
  sound: true,
  notify: true,
};

const MODE_LABEL: Record<Mode, string> = {
  focus: "집중",
  break: "휴식",
};

const MODE_COLOR: Record<Mode, string> = {
  focus: "var(--focus)",
  break: "var(--short)",
};

const APP_TITLE = "PomoTube";

const KEY_SETTINGS = "pomotube:settings";
const KEY_URL = "pomotube:url";
const KEY_THEME = "pomotube:theme";
const keyDone = () => `pomotube:done:${new Date().toLocaleDateString("sv-SE")}`;

/** 유튜브 링크(영상/플레이리스트/shorts/youtu.be)를 embed 주소로 변환 */
function toEmbedSrc(input: string): string | null {
  const raw = input.trim();
  if (!raw) return null;

  let url: URL;
  try {
    url = new URL(/^https?:\/\//i.test(raw) ? raw : `https://${raw}`);
  } catch {
    return null;
  }

  const host = url.hostname.replace(/^www\.|^m\./, "");
  const list = url.searchParams.get("list");
  let videoId: string | null = null;

  if (host === "youtu.be") {
    videoId = url.pathname.split("/")[1] || null;
  } else if (host === "youtube.com" || host === "music.youtube.com") {
    videoId = url.searchParams.get("v");
    if (!videoId) {
      const m = url.pathname.match(/^\/(shorts|live|embed)\/([\w-]{6,})/);
      if (m) videoId = m[2];
    }
  } else {
    return null;
  }

  if (videoId && !/^[\w-]{6,}$/.test(videoId)) return null;

  if (videoId && list) {
    return `https://www.youtube.com/embed/${videoId}?list=${encodeURIComponent(list)}&rel=0`;
  }
  if (videoId) {
    return `https://www.youtube.com/embed/${videoId}?rel=0`;
  }
  if (list) {
    return `https://www.youtube.com/embed/videoseries?list=${encodeURIComponent(list)}&rel=0`;
  }
  return null;
}

type AudioCtor = typeof AudioContext;

function createAudioContext(): AudioContext | null {
  try {
    const Ctx: AudioCtor | undefined =
      window.AudioContext ||
      (window as unknown as { webkitAudioContext?: AudioCtor }).webkitAudioContext;
    return Ctx ? new Ctx() : null;
  } catch {
    return null;
  }
}

/** 알람: 높은음과 낮은음을 번갈아 4번 울려요 (부드럽지만 영상 소리에 묻히지 않는 정도) */
function playAlarm(ctx: AudioContext | null) {
  try {
    const audio = ctx ?? createAudioContext();
    if (!audio) return;
    void audio.resume();
    const notes = [988, 784, 988, 784];
    notes.forEach((freq, i) => {
      const t = audio.currentTime + i * 0.45;
      const osc = audio.createOscillator();
      const gain = audio.createGain();
      osc.type = "triangle";
      osc.frequency.value = freq;
      gain.gain.setValueAtTime(0.0001, t);
      gain.gain.exponentialRampToValueAtTime(0.5, t + 0.02);
      gain.gain.setValueAtTime(0.5, t + 0.28);
      gain.gain.exponentialRampToValueAtTime(0.0001, t + 0.4);
      osc.connect(gain).connect(audio.destination);
      osc.start(t);
      osc.stop(t + 0.42);
    });
  } catch {
    /* 오디오를 쓸 수 없는 환경이면 무시 */
  }
}

function askNotificationPermission() {
  try {
    if ("Notification" in window && Notification.permission === "default") {
      void Notification.requestPermission();
    }
  } catch {}
}

function sendNotification(title: string, body: string) {
  try {
    if ("Notification" in window && Notification.permission === "granted") {
      new Notification(title, { body });
    }
  } catch {}
}

const pad = (n: number) => String(n).padStart(2, "0");

function formatFocusTime(minutes: number) {
  const h = Math.floor(minutes / 60);
  const m = minutes % 60;
  if (h === 0) return `${m}분`;
  return m === 0 ? `${h}시간` : `${h}시간 ${m}분`;
}

export default function Home() {
  const [ready, setReady] = useState(false);
  const [theme, setTheme] = useState<Theme>("dark");
  const [settings, setSettings] = useState<Settings>(DEFAULT_SETTINGS);
  const [mode, setMode] = useState<Mode>("focus");
  const [remaining, setRemaining] = useState(DEFAULT_SETTINGS.focus * 60);
  const [running, setRunning] = useState(false);
  const [doneToday, setDoneToday] = useState(0);
  const [urlInput, setUrlInput] = useState("");
  const [embedSrc, setEmbedSrc] = useState<string | null>(null);
  const [error, setError] = useState("");
  const [editing, setEditing] = useState(false);
  const [draft, setDraft] = useState("");
  const [notifyBlocked, setNotifyBlocked] = useState(false);

  const endAt = useRef(0);
  const audioRef = useRef<AudioContext | null>(null);
  const finishRef = useRef<() => void>(() => {});

  // 저장된 값 불러오기
  useEffect(() => {
    if (document.documentElement.dataset.theme === "light") setTheme("light");
    try {
      const s = localStorage.getItem(KEY_SETTINGS);
      if (s) {
        // 예전 저장값(short)이 있으면 휴식 시간으로 이어받아요
        const raw = JSON.parse(s) as Partial<Settings> & { short?: number };
        const parsed: Settings = {
          focus: raw.focus ?? DEFAULT_SETTINGS.focus,
          break: raw.break ?? raw.short ?? DEFAULT_SETTINGS.break,
          autoStart: !!raw.autoStart,
          sound: raw.sound ?? true,
          notify: raw.notify ?? true,
        };
        setSettings(parsed);
        setRemaining(parsed.focus * 60);
      }
      const u = localStorage.getItem(KEY_URL);
      if (u) {
        setUrlInput(u);
        setEmbedSrc(toEmbedSrc(u));
      }
      const d = localStorage.getItem(keyDone());
      if (d) setDoneToday(Number(d) || 0);
    } catch {
      /* localStorage 접근 불가 시 기본값 사용 */
    }
    try {
      setNotifyBlocked(
        "Notification" in window && Notification.permission === "denied",
      );
    } catch {}
    setReady(true);
  }, []);

  useEffect(() => {
    if (!ready) return;
    try {
      localStorage.setItem(KEY_SETTINGS, JSON.stringify(settings));
    } catch {}
  }, [settings, ready]);

  // 타이머 틱 (탭이 백그라운드여도 정확하도록 종료 시각 기준으로 계산)
  useEffect(() => {
    if (!running) return;
    const id = setInterval(() => {
      const left = Math.max(0, Math.ceil((endAt.current - Date.now()) / 1000));
      setRemaining(left);
      if (left <= 0) finishRef.current();
    }, 250);
    return () => clearInterval(id);
  }, [running]);

  // 탭 제목에 남은 시간 표시
  useEffect(() => {
    const m = Math.floor(remaining / 60);
    const s = remaining % 60;
    document.title = running
      ? `${pad(m)}:${pad(s)} · ${MODE_LABEL[mode]}`
      : APP_TITLE;
  }, [remaining, running, mode]);

  const total = settings[mode] * 60;

  function toggleTheme() {
    const next: Theme = theme === "dark" ? "light" : "dark";
    setTheme(next);
    document.documentElement.dataset.theme = next;
    try {
      localStorage.setItem(KEY_THEME, next);
    } catch {}
  }

  function begin(seconds: number) {
    endAt.current = Date.now() + seconds * 1000;
    setRemaining(seconds);
    setRunning(true);
  }

  function switchMode(next: Mode, autoStart = false) {
    setMode(next);
    const seconds = settings[next] * 60;
    if (autoStart) {
      begin(seconds);
    } else {
      setRunning(false);
      setRemaining(seconds);
    }
  }

  finishRef.current = () => {
    setRunning(false);
    if (settings.sound) playAlarm(audioRef.current);
    if (mode === "focus") {
      const nextDone = doneToday + 1;
      setDoneToday(nextDone);
      try {
        localStorage.setItem(keyDone(), String(nextDone));
      } catch {}
      if (settings.notify) sendNotification(
        "집중 끝!",
        `${settings.break}분 쉬어요. 오늘 ${nextDone}번 집중했어요.`,
      );
      switchMode("break", settings.autoStart);
    } else {
      if (settings.notify) sendNotification("휴식 끝!", "다시 집중할 시간이에요.");
      switchMode("focus", settings.autoStart);
    }
  };

  function toggle() {
    if (running) {
      setRunning(false);
      return;
    }
    // 시작 버튼을 누르는 순간에 알람 소리와 알림 권한을 준비해요
    if (!audioRef.current) audioRef.current = createAudioContext();
    void audioRef.current?.resume();
    if (settings.notify) askNotificationPermission();
    begin(remaining > 0 ? remaining : total);
  }

  function reset() {
    setRunning(false);
    setRemaining(total);
  }

  function toggleSound() {
    const next = !settings.sound;
    setSettings((p) => ({ ...p, sound: next }));
    if (next) {
      // 켤 때 한 번 들려줘서 어느 정도 소리인지 알 수 있게 해요
      if (!audioRef.current) audioRef.current = createAudioContext();
      playAlarm(audioRef.current);
    }
  }

  function toggleNotify() {
    const next = !settings.notify;
    setSettings((p) => ({ ...p, notify: next }));
    if (!next) return;
    try {
      if (!("Notification" in window)) return;
      if (Notification.permission === "default") {
        void Notification.requestPermission().then((r) =>
          setNotifyBlocked(r === "denied"),
        );
      } else {
        setNotifyBlocked(Notification.permission === "denied");
      }
    } catch {}
  }

  function startEdit() {
    if (running) return;
    setDraft(String(settings[mode]));
    setEditing(true);
  }

  function commitEdit() {
    const n = Math.floor(Number(draft));
    if (draft.trim() !== "" && Number.isFinite(n)) updateSetting(mode, String(n));
    setEditing(false);
  }

  function stepMinutes(delta: number) {
    if (running) return;
    updateSetting(mode, String(settings[mode] + delta));
  }

  function loadVideo(e?: React.FormEvent) {
    e?.preventDefault();
    const src = toEmbedSrc(urlInput);
    if (!src) {
      setEmbedSrc(null);
      setError(
        urlInput.trim()
          ? "유튜브 영상 또는 플레이리스트 링크를 확인해 주세요."
          : "",
      );
      return;
    }
    setError("");
    setEmbedSrc(src);
    try {
      localStorage.setItem(KEY_URL, urlInput.trim());
    } catch {}
  }

  function updateSetting(key: Mode, value: string) {
    const n = Math.min(180, Math.max(1, Math.floor(Number(value)) || 1));
    setSettings((prev) => ({ ...prev, [key]: n }));
    if (key === mode && !running) setRemaining(n * 60);
  }

  const m = Math.floor(remaining / 60);
  const s = remaining % 60;
  const percent = total > 0 ? ((total - remaining) / total) * 100 : 0;
  const toggleLabel =
    theme === "dark" ? "라이트 모드로 전환" : "다크 모드로 전환";

  return (
    <main className="app" style={{ ["--accent" as string]: MODE_COLOR[mode] }}>
      <header className="header">
        <div className="brand">
          <svg width="28" height="28" viewBox="0 0 28 28" fill="none" aria-hidden="true">
            <circle cx="14" cy="14" r="11" stroke="var(--border)" strokeWidth="3" />
            <path
              d="M14 3a11 11 0 0 1 11 11"
              stroke="var(--accent)"
              strokeWidth="3"
              strokeLinecap="round"
            />
          </svg>
          <span>{APP_TITLE}</span>
        </div>
        <div className="header-right">
          <span className="today">
            오늘 집중 {formatFocusTime(doneToday * settings.focus)}
          </span>
          <button
            type="button"
            className="icon-btn"
            onClick={toggleTheme}
            aria-label={toggleLabel}
            title={toggleLabel}
          >
            {theme === "dark" ? (
              <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" aria-hidden="true">
                <circle cx="12" cy="12" r="4" />
                <path d="M12 2v2M12 20v2M4.93 4.93l1.41 1.41M17.66 17.66l1.41 1.41M2 12h2M20 12h2M4.93 19.07l1.41-1.41M17.66 6.34l1.41-1.41" />
              </svg>
            ) : (
              <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
                <path d="M21 12.8A9 9 0 1 1 11.2 3a7 7 0 0 0 9.8 9.8z" />
              </svg>
            )}
          </button>
        </div>
      </header>

      <div className="layout">
        <section className="card video-card">
          <form className="url-row" onSubmit={loadVideo}>
            <label htmlFor="yt-url" className="sr-only">
              유튜브 링크
            </label>
            <input
              id="yt-url"
              type="text"
              value={urlInput}
              onChange={(e) => setUrlInput(e.target.value)}
              placeholder="유튜브 영상 또는 플레이리스트 링크 붙여넣기"
            />
            <button type="submit" className="btn primary">
              불러오기
            </button>
          </form>
          {error && <p className="error">{error}</p>}

          <div className="video-wrap">
            {embedSrc ? (
              <iframe
                src={embedSrc}
                title="YouTube video player"
                allow="accelerometer; autoplay; clipboard-write; encrypted-media; gyroscope; picture-in-picture"
                allowFullScreen
              />
            ) : (
              <div className="placeholder">
                <div className="placeholder-inner">
                  <div className="play-circle">
                    <svg width="26" height="26" viewBox="0 0 24 24" fill="#8e94a4" aria-hidden="true">
                      <path d="M8 5.5v13a1 1 0 0 0 1.5.86l10.5-6.5a1 1 0 0 0 0-1.72L9.5 4.64A1 1 0 0 0 8 5.5z" />
                    </svg>
                  </div>
                  <span>링크를 불러오면 여기에서 영상이 재생돼요</span>
                </div>
              </div>
            )}
          </div>

          <span className="hint">
            영상 링크와 플레이리스트 링크 모두 사용할 수 있어요. 마지막으로 불러온
            링크는 다음에 열 때도 남아 있어요.
          </span>
        </section>

        <aside className="card timer-card">
          <div className="tabs" role="tablist">
            {(Object.keys(MODE_LABEL) as Mode[]).map((k) => (
              <button
                key={k}
                type="button"
                role="tab"
                aria-selected={mode === k}
                className={`tab ${mode === k ? "active" : ""}`}
                onClick={() => switchMode(k)}
              >
                {MODE_LABEL[k]}
              </button>
            ))}
          </div>

          <div className="time-block">
            <div className="time-row">
              <span className="time-spacer" aria-hidden="true" />
              {editing ? (
                <span className="time-edit">
                  <input
                    className="time-input"
                    type="text"
                    inputMode="numeric"
                    autoFocus
                    aria-label="분 단위로 시간 입력"
                    value={draft}
                    onChange={(e) =>
                      setDraft(e.target.value.replace(/\D/g, "").slice(0, 3))
                    }
                    onBlur={commitEdit}
                    onKeyDown={(e) => {
                      if (e.key === "Enter") commitEdit();
                      if (e.key === "Escape") {
                        setDraft(String(settings[mode]));
                        setEditing(false);
                      }
                    }}
                  />
                  <span className="time-unit">분</span>
                </span>
              ) : (
                <button
                  type="button"
                  className="time"
                  onClick={startEdit}
                  disabled={running}
                  title={running ? undefined : "클릭해서 시간을 직접 입력"}
                >
                  {pad(m)}:{pad(s)}
                </button>
              )}
              <div className="stepper">
                <button
                  type="button"
                  aria-label="1분 늘리기"
                  disabled={running || settings[mode] >= 180}
                  onClick={() => stepMinutes(1)}
                >
                  <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
                    <path d="M6 15l6-6 6 6" />
                  </svg>
                </button>
                <button
                  type="button"
                  aria-label="1분 줄이기"
                  disabled={running || settings[mode] <= 1}
                  onClick={() => stepMinutes(-1)}
                >
                  <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
                    <path d="M6 9l6 6 6-6" />
                  </svg>
                </button>
              </div>
            </div>
            <span className="sub">
              {mode === "focus"
                ? `집중${running ? " 중" : ""} · 오늘 ${doneToday + 1}번째`
                : `휴식${running ? " 중" : ""} · 오늘 ${doneToday}번 집중했어요`}
            </span>
          </div>

          <div className="progress">
            <div style={{ width: `${percent}%` }} />
          </div>

          <div className="controls">
            <button type="button" className="btn primary" onClick={toggle}>
              {running ? "일시정지" : remaining < total ? "계속" : "시작"}
            </button>
            <button type="button" className="btn" onClick={reset}>
              리셋
            </button>
          </div>

          <div className="stats">
            <span>
              오늘 완료 <b>{doneToday}</b>회
            </span>
            <div className="stats-actions">
              <button
                type="button"
                className="icon-btn"
                onClick={toggleSound}
                aria-pressed={settings.sound}
                aria-label={settings.sound ? "알람 소리 끄기" : "알람 소리 켜기"}
                title={settings.sound ? "알람 소리 끄기" : "알람 소리 켜기"}
              >
                <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
                  <path d="M11 5L6 9H2v6h4l5 4V5z" />
                  {settings.sound ? (
                    <path d="M15.5 8.5a5 5 0 0 1 0 7M18.5 5.5a9 9 0 0 1 0 13" />
                  ) : (
                    <path d="M23 9l-6 6M17 9l6 6" />
                  )}
                </svg>
              </button>
              <button
                type="button"
                className="icon-btn"
                onClick={toggleNotify}
                aria-pressed={settings.notify}
                aria-label={settings.notify ? "브라우저 알림 끄기" : "브라우저 알림 켜기"}
                title={settings.notify ? "브라우저 알림 끄기" : "브라우저 알림 켜기"}
              >
                <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
                  <path d="M18 8a6 6 0 0 0-12 0c0 7-3 9-3 9h18s-3-2-3-9M13.7 21a2 2 0 0 1-3.4 0" />
                  {!settings.notify && <path d="M3 3l18 18" />}
                </svg>
              </button>
            </div>
          </div>
          {settings.notify && notifyBlocked && (
            <p className="auto-hint">
              브라우저에서 알림이 차단돼 있어요. 주소창 왼쪽 아이콘에서 알림을
              허용해 주세요.
            </p>
          )}

          <div className="auto-start">
            <label htmlFor="s-auto" className="auto-label">
              <input
                id="s-auto"
                type="checkbox"
                checked={settings.autoStart}
                onChange={(e) =>
                  setSettings((p) => ({ ...p, autoStart: e.target.checked }))
                }
              />
              다음 단계 자동 시작
            </label>
            <p className="auto-hint">
              켜면 집중이 끝난 뒤 휴식이, 휴식이 끝난 뒤 집중이 버튼을 누르지 않아도
              바로 이어져요. 끄면 알람이 울린 뒤 멈춰요.
            </p>
          </div>
        </aside>
      </div>
    </main>
  );
}
