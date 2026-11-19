import { useEffect, useRef, useState } from "react";
import {
  addClips,
  createVoice,
  deleteClip,
  deleteVoice,
  getHealth,
  getSpeakers,
  getVoices,
  setReference,
  synthesize,
  transcribeAudio,
  transcribeClip,
  type Clip,
  type EngineHealth,
  type EngineName,
  type Health,
  type Selection,
  type Voice,
} from "./api";
import { SNIPPETS } from "./snippets";

const LANGUAGES: { id: string; label: string }[] = [
  { id: "fr", label: "Français" },
  { id: "en", label: "Anglais" },
  { id: "es", label: "Espagnol" },
  { id: "de", label: "Allemand" },
  { id: "it", label: "Italien" },
  { id: "pt", label: "Portugais" },
  { id: "pl", label: "Polonais" },
  { id: "tr", label: "Turc" },
  { id: "ru", label: "Russe" },
  { id: "nl", label: "Néerlandais" },
  { id: "cs", label: "Tchèque" },
  { id: "ar", label: "Arabe" },
  { id: "zh-cn", label: "Chinois" },
  { id: "hu", label: "Hongrois" },
  { id: "ko", label: "Coréen" },
  { id: "ja", label: "Japonais" },
  { id: "hi", label: "Hindi" },
];

function clock(seconds: number): string {
  const total = Math.max(0, Math.floor(seconds));
  const minutes = Math.floor(total / 60);
  const rest = total % 60;
  return `${minutes}:${rest.toString().padStart(2, "0")}`;
}

function pickMime(): string {
  const types = ["audio/webm;codecs=opus", "audio/webm", "audio/mp4"];
  return types.find((type) => MediaRecorder.isTypeSupported(type)) ?? "";
}

function filenameFor(blob: Blob): string {
  if (blob.type.includes("mp4")) return "prise.mp4";
  if (blob.type.includes("wav")) return "prise.wav";
  if (blob.type.includes("mpeg")) return "prise.mp3";
  return "prise.webm";
}

type DraftClip = {
  key: string;
  blob: Blob;
  filename: string;
  url: string;
  seconds: number | null;
  text: string | null;
  spokenId: number | null;
};

type CompareSource = {
  label: string;
  url: string;
  text: string;
};

function pendingTranscripts(voices: Voice[], selected: Selection | null): string {
  if (selected?.kind !== "voice") return "";
  const voice = voices.find((item) => item.id === selected.id);
  if (!voice) return "";
  return voice.clips.filter((clip) => clip.text == null).map((clip) => clip.id).join(",");
}

const MAX_CLIPS = 8;

export function App() {
  const [health, setHealth] = useState<Health | null>(null);
  const [engine, setEngine] = useState<EngineName>("xtts");
  const [voices, setVoices] = useState<Voice[]>([]);
  const [speakers, setSpeakers] = useState<string[]>([]);
  const [name, setName] = useState("Ma voix");
  const [language, setLanguage] = useState("fr");
  const [textLanguage, setTextLanguage] = useState("fr");
  const [recording, setRecording] = useState(false);
  const [seconds, setSeconds] = useState(0);
  const [take, setTake] = useState<{ blob: Blob; url: string; seconds: number | null } | null>(null);
  const [takeText, setTakeText] = useState<string | null>(null);
  const [takeBusy, setTakeBusy] = useState(false);
  const [drafts, setDrafts] = useState<DraftClip[]>([]);
  const [compare, setCompare] = useState<CompareSource | null>(null);
  const [blend, setBlend] = useState(false);
  const [saving, setSaving] = useState(false);
  const [selected, setSelected] = useState<Selection | null>(null);
  const [text, setText] = useState(SNIPPETS[0].text);
  const [generating, setGenerating] = useState(false);
  const [resultUrl, setResultUrl] = useState<string | null>(null);
  const [elapsed, setElapsed] = useState<number | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [notice, setNotice] = useState<string | null>(null);
  const recorderRef = useRef<MediaRecorder | null>(null);
  const timerRef = useRef<number | null>(null);
  const startedRef = useRef(0);
  const chunksRef = useRef<Blob[]>([]);
  const takeUrlRef = useRef<string | null>(null);
  const resultUrlRef = useRef<string | null>(null);
  const draftsRef = useRef<DraftClip[]>([]);
  draftsRef.current = drafts;
  const languageRef = useRef(language);
  languageRef.current = language;
  const spokenRef = useRef(0);
  const takeSpokenRef = useRef<number | null>(null);
  const compareRef = useRef<CompareSource | null>(null);
  compareRef.current = compare;
  const triedTranscripts = useRef(new Set<string>());
  const engineRef = useRef(engine);
  engineRef.current = engine;

  useEffect(() => {
    let alive = true;
    async function tick() {
      try {
        const next = await getHealth();
        if (!alive) return;
        setHealth(next);
        const xttsStatus = next.engines?.xtts.status ?? next.status;
        if (engineRef.current === "xtts" && xttsStatus === "error") {
          setError(next.engines?.xtts.message ?? next.message);
        }
      } catch {
        if (!alive) return;
        setHealth({ status: "error", message: "Le serveur Python ne répond pas sur le port 8765.", device: "" });
      }
    }
    void tick();
    const id = window.setInterval(() => void tick(), 2000);
    return () => {
      alive = false;
      window.clearInterval(id);
    };
  }, []);

  const xttsReady = (health?.engines?.xtts.status ?? health?.status) === "ready";
  const serverUp = Boolean(health && (health.engines || health.status !== "error"));

  useEffect(() => {
    if (!serverUp) return;
    let alive = true;
    void (async () => {
      try {
        const nextVoices = await getVoices();
        if (!alive) return;
        setVoices(nextVoices);
        if (xttsReady) {
          const nextSpeakers = await getSpeakers();
          if (alive) setSpeakers(nextSpeakers);
        }
      } catch (err) {
        if (alive) setError(err instanceof Error ? err.message : "Chargement impossible.");
      }
    })();
    return () => {
      alive = false;
    };
  }, [serverUp, xttsReady]);

  useEffect(() => {
    if (selected) return;
    if (voices[0]) setSelected({ kind: "voice", id: voices[0].id });
    else if (speakers[0]) setSelected({ kind: "speaker", name: speakers[0] });
  }, [voices, speakers, selected]);

  const missingTranscripts = pendingTranscripts(voices, selected);
  useEffect(() => {
    if (!serverUp || selected?.kind !== "voice" || !missingTranscripts) return;
    const voiceId = selected.id;
    const ids = missingTranscripts.split(",");
    let alive = true;
    void (async () => {
      for (const clipId of ids) {
        const token = `${voiceId}:${clipId}`;
        if (triedTranscripts.current.has(token)) continue;
        triedTranscripts.current.add(token);
        try {
          const result = await transcribeClip(voiceId, clipId);
          setVoices((current) => current.map((voice) => (voice.id === result.voice.id ? result.voice : voice)));
          if (!alive) return;
        } catch (err) {
          triedTranscripts.current.delete(token);
          if (alive) setError(err instanceof Error ? err.message : "Transcription impossible.");
          return;
        }
      }
    })();
    return () => {
      alive = false;
    };
  }, [serverUp, selected, missingTranscripts]);

  useEffect(() => {
    return () => {
      if (takeUrlRef.current) URL.revokeObjectURL(takeUrlRef.current);
      if (resultUrlRef.current) URL.revokeObjectURL(resultUrlRef.current);
      for (const clip of draftsRef.current) URL.revokeObjectURL(clip.url);
      if (timerRef.current) window.clearInterval(timerRef.current);
      recorderRef.current?.stream.getTracks().forEach((track) => track.stop());
    };
  }, []);

  function replaceTake(next: { blob: Blob; url: string; seconds: number | null } | null) {
    const previous = takeUrlRef.current;
    if (previous && previous !== compareRef.current?.url) URL.revokeObjectURL(previous);
    takeUrlRef.current = next?.url ?? null;
    setTake(next);
  }

  function patchDrafts(update: (clips: DraftClip[]) => DraftClip[]) {
    const next = update(draftsRef.current);
    draftsRef.current = next;
    setDrafts(next);
  }

  function keepUrl(url: string) {
    return compareRef.current?.url === url;
  }

  function stopRecording() {
    if (timerRef.current) window.clearInterval(timerRef.current);
    timerRef.current = null;
    const recorder = recorderRef.current;
    if (recorder && recorder.state !== "inactive") recorder.stop();
    setRecording(false);
  }

  async function startRecording() {
    setError(null);
    setNotice(null);
    try {
      const stream = await navigator.mediaDevices.getUserMedia({
        audio: { channelCount: 1, echoCancellation: true, noiseSuppression: true },
      });
      const mime = pickMime();
      const recorder = new MediaRecorder(stream, mime ? { mimeType: mime } : undefined);
      chunksRef.current = [];
      recorder.ondataavailable = (event) => {
        if (event.data.size) chunksRef.current.push(event.data);
      };
      recorder.onstop = () => {
        stream.getTracks().forEach((track) => track.stop());
        const blob = new Blob(chunksRef.current, { type: recorder.mimeType || mime || "audio/webm" });
        const elapsedSeconds = (Date.now() - startedRef.current) / 1000;
        const spokenId = ++spokenRef.current;
        takeSpokenRef.current = spokenId;
        setTakeText(null);
        setTakeBusy(true);
        replaceTake({ blob, url: URL.createObjectURL(blob), seconds: elapsedSeconds });
        setSeconds(elapsedSeconds);
        void (async () => {
          try {
            const transcript = await transcribeAudio(blob, filenameFor(blob), languageRef.current);
            if (takeSpokenRef.current === spokenId) {
              setTakeText(transcript);
              setTakeBusy(false);
            }
            patchDrafts((clips) => clips.map((clip) => (clip.spokenId === spokenId ? { ...clip, text: transcript } : clip)));
          } catch (err) {
            if (takeSpokenRef.current === spokenId) {
              setTakeBusy(false);
              setError(err instanceof Error ? err.message : "Transcription impossible.");
            }
          }
        })();
      };
      recorder.start();
      recorderRef.current = recorder;
      startedRef.current = Date.now();
      setRecording(true);
      setSeconds(0);
      timerRef.current = window.setInterval(() => {
        const elapsedSeconds = (Date.now() - startedRef.current) / 1000;
        setSeconds(elapsedSeconds);
        if (elapsedSeconds >= 30) stopRecording();
      }, 200);
    } catch {
      setError("Le micro est inaccessible. Autorise-le pour localhost, ou importe un fichier.");
    }
  }

  function rememberDraft(
    blob: Blob,
    filename: string,
    seconds: number | null,
    text: string | null,
    spokenId: number | null,
  ): DraftClip | null {
    if (draftsRef.current.length >= MAX_CLIPS) return null;
    const clip: DraftClip = {
      key: crypto.randomUUID(),
      blob,
      filename,
      url: URL.createObjectURL(blob),
      seconds,
      text,
      spokenId,
    };
    draftsRef.current = [...draftsRef.current, clip];
    setDrafts(draftsRef.current);
    return clip;
  }

  function addTakeToDrafts() {
    if (!take) return;
    if (draftsRef.current.length >= MAX_CLIPS) {
      setError(`Une voix garde au plus ${MAX_CLIPS} extraits.`);
      return;
    }
    setError(null);
    const clip = rememberDraft(take.blob, filenameFor(take.blob), take.seconds, takeText, takeSpokenRef.current);
    if (clip && take.seconds == null) fillDuration(clip.key, clip.url);
    replaceTake(null);
    setTakeText(null);
    setTakeBusy(false);
    setSeconds(0);
  }

  function fillDuration(key: string, url: string) {
    const audio = document.createElement("audio");
    audio.preload = "metadata";
    audio.src = url;
    audio.onloadedmetadata = () => {
      if (!Number.isFinite(audio.duration)) return;
      patchDrafts((clips) => clips.map((clip) => (clip.key === key ? { ...clip, seconds: audio.duration } : clip)));
    };
  }

  function onUpload(files: FileList | null) {
    if (!files?.length) return;
    setError(null);
    const room = MAX_CLIPS - draftsRef.current.length;
    if (room <= 0) {
      setError(`Une voix garde au plus ${MAX_CLIPS} extraits.`);
      return;
    }
    const chosen = Array.from(files).slice(0, room);
    if (files.length > room) setNotice(`Seuls ${room} extraits ont été ajoutés. Le maximum est ${MAX_CLIPS}.`);
    for (const file of chosen) {
      const clip = rememberDraft(file, file.name, null, null, null);
      if (clip) void transcribeDraft(clip);
      if (!clip) break;
      fillDuration(clip.key, clip.url);
    }
  }

  async function transcribeDraft(clip: DraftClip) {
    try {
      const transcript = await transcribeAudio(clip.blob, clip.filename, languageRef.current);
      patchDrafts((clips) => clips.map((item) => (item.key === clip.key ? { ...item, text: transcript } : item)));
    } catch (err) {
      setError(err instanceof Error ? err.message : "Transcription impossible.");
    }
  }

  function dropDraft(key: string) {
    const clip = draftsRef.current.find((item) => item.key === key);
    if (clip && !keepUrl(clip.url)) URL.revokeObjectURL(clip.url);
    draftsRef.current = draftsRef.current.filter((item) => item.key !== key);
    setDrafts(draftsRef.current);
  }

  function clearDrafts() {
    for (const clip of draftsRef.current) {
      if (!keepUrl(clip.url)) URL.revokeObjectURL(clip.url);
    }
    draftsRef.current = [];
    setDrafts([]);
  }

  function chooseText(source: CompareSource, lang: string) {
    compareRef.current = source;
    setCompare(source);
    setText(source.text);
    setTextLanguage(lang);
  }

  function applyVoice(voice: Voice, warning: string | null, created: boolean) {
    setVoices((current) => {
      const rest = current.filter((item) => item.id !== voice.id);
      return created ? [voice, ...rest] : current.map((item) => (item.id === voice.id ? voice : item));
    });
    setSelected({ kind: "voice", id: voice.id });
    setTextLanguage(voice.language);
    const count = voice.clips.length;
    const readyText = `Voix « ${voice.name} » prête, ${count} extrait${count > 1 ? "s" : ""}, ${voice.duration.toFixed(1)} s.`;
    setNotice(warning ? `${readyText} ${warning}` : readyText);
    clearDrafts();
  }

  async function saveVoice() {
    if (drafts.length === 0) return;
    setSaving(true);
    setError(null);
    setNotice(null);
    try {
      const result = await createVoice(
        drafts.map((clip) => ({ blob: clip.blob, filename: clip.filename })),
        name,
        language,
        drafts.map((clip) => clip.text ?? ""),
      );
      applyVoice(result.voice, result.warning, true);
    } catch (err) {
      setError(err instanceof Error ? err.message : "Enregistrement impossible.");
    } finally {
      setSaving(false);
    }
  }

  async function appendToSelected() {
    if (selected?.kind !== "voice" || drafts.length === 0) return;
    const voice = voices.find((item) => item.id === selected.id);
    if (voice && voice.clips.length + drafts.length > MAX_CLIPS) {
      setError(`Une voix garde au plus ${MAX_CLIPS} extraits. Il en reste ${MAX_CLIPS - voice.clips.length}.`);
      return;
    }
    setSaving(true);
    setError(null);
    setNotice(null);
    try {
      const result = await addClips(
        selected.id,
        drafts.map((clip) => ({ blob: clip.blob, filename: clip.filename })),
        drafts.map((clip) => clip.text ?? ""),
      );
      applyVoice(result.voice, result.warning, false);
    } catch (err) {
      setError(err instanceof Error ? err.message : "Ajout impossible.");
    } finally {
      setSaving(false);
    }
  }

  async function removeOneClip(voiceId: string, clipId: string) {
    setError(null);
    try {
      const result = await deleteClip(voiceId, clipId);
      setVoices((current) => current.map((item) => (item.id === voiceId ? result.voice : item)));
      setNotice(result.warning);
    } catch (err) {
      setError(err instanceof Error ? err.message : "Suppression impossible.");
    }
  }

  async function remove(id: string) {
    setError(null);
    try {
      await deleteVoice(id);
      const next = voices.filter((voice) => voice.id !== id);
      setVoices(next);
      if (selected?.kind === "voice" && selected.id === id) {
        setSelected(next[0] ? { kind: "voice", id: next[0].id } : speakers[0] ? { kind: "speaker", name: speakers[0] } : null);
      }
    } catch (err) {
      setError(err instanceof Error ? err.message : "Suppression impossible.");
    }
  }

  async function generate(override?: {
    text: string;
    language: string;
    voiceId?: string;
    speaker?: string;
    clipId?: string;
  }) {
    const spoken = (override?.text ?? text).trim();
    const lang = override?.language ?? textLanguage;
    const voiceId = override ? override.voiceId : selected?.kind === "voice" ? selected.id : undefined;
    const speaker = engine === "fish" ? undefined : override ? override.speaker : selected?.kind === "speaker" ? selected.name : undefined;
    const voice = voices.find((item) => item.id === voiceId);
    const clipId = override?.clipId ?? (blend ? undefined : voice?.referenceClipId);
    if (!spoken || (!voiceId && !speaker)) {
      setError(engine === "fish" ? "Choisis une voix enregistrée et un texte." : "Choisis une voix et un texte.");
      return;
    }
    setGenerating(true);
    setError(null);
    const started = performance.now();
    try {
      const blob = await synthesize({
        text: spoken,
        language: lang,
        voiceId,
        speaker,
        clipId,
        blend: override?.clipId ? false : blend,
        engine,
      });
      if (resultUrlRef.current) URL.revokeObjectURL(resultUrlRef.current);
      const url = URL.createObjectURL(blob);
      resultUrlRef.current = url;
      setResultUrl(url);
      setElapsed((performance.now() - started) / 1000);
    } catch (err) {
      setError(err instanceof Error ? err.message : "Synthèse impossible.");
    } finally {
      setGenerating(false);
    }
  }

  async function compareWith(source: CompareSource, lang: string, voiceId: string, clipId?: string) {
    chooseText(source, lang);
    setSelected({ kind: "voice", id: voiceId });
    await generate({ text: source.text, language: lang, voiceId, clipId });
  }

  async function markReference(voiceId: string, clipId: string) {
    setError(null);
    try {
      const result = await setReference(voiceId, clipId);
      setVoices((current) => current.map((item) => (item.id === voiceId ? result.voice : item)));
      setBlend(false);
      setNotice("Le clone suit maintenant cette prise, sans mélanger les autres.");
    } catch (err) {
      setError(err instanceof Error ? err.message : "Impossible de choisir cette prise.");
    }
  }

  async function compareSaved(voice: Voice, clip: Clip) {
    setError(null);
    let transcript = clip.text?.trim() ?? "";
    if (!transcript) {
      setNotice("Transcription…");
      try {
        const result = await transcribeClip(voice.id, clip.id);
        setVoices((current) => current.map((item) => (item.id === result.voice.id ? result.voice : item)));
        transcript = result.text.trim();
      } catch (err) {
        setError(err instanceof Error ? err.message : "Transcription impossible.");
        return;
      }
    }
    if (!transcript) {
      setError("Aucun mot n'a été reconnu dans cet extrait.");
      return;
    }
    await compareWith(
      { label: voice.name, url: `/api/voices/${voice.id}/clips/${clip.id}`, text: transcript },
      voice.language,
      voice.id,
      clip.id,
    );
  }

  const xttsHealth: EngineHealth | undefined = health?.engines?.xtts ?? (health
    ? { status: health.status, message: health.message, device: health.device }
    : undefined);
  const fishHealth = health?.engines?.fish;
  const activeHealth = engine === "fish" ? fishHealth : xttsHealth;
  const ready = activeHealth?.status === "ready";
  const selectedVoice = selected?.kind === "voice" ? voices.find((voice) => voice.id === selected.id) : undefined;

  function engineLabel(state: EngineHealth | undefined, idle = "Chargement"): string {
    if (!state) return idle;
    if (state.status === "ready") return "Prêt";
    if (state.status === "error") return "Erreur";
    if (state.status === "unavailable") return "Arrêté";
    return "Chargement";
  }

  function chooseEngine(next: EngineName) {
    setEngine(next);
    setError(null);
    if (next === "fish" && selected?.kind === "speaker") {
      setSelected(voices[0] ? { kind: "voice", id: voices[0].id } : null);
    }
  }

  return (
    <div className="app">
      <header>
        <div>
          <h1>Studio voix</h1>
          <p>Clone local avec XTTS v2 ou Fish Speech. L'enregistrement reste sur cette machine.</p>
          <div className="engines" role="group" aria-label="Moteur de synthèse">
            <button type="button" data-on={engine === "xtts"} onClick={() => chooseEngine("xtts")}>XTTS</button>
            <button type="button" data-on={engine === "fish"} onClick={() => chooseEngine("fish")}>Fish Speech</button>
          </div>
        </div>
        <div className="status">
          <div className="pills">
            <div className="pill">
              <span className="dot" data-state={xttsHealth?.status ?? "loading"} />
              XTTS · {engineLabel(xttsHealth)}
              {xttsHealth?.device ? ` · ${xttsHealth.device}` : ""}
            </div>
            <div className="pill">
              <span className="dot" data-state={fishHealth?.status ?? "unavailable"} />
              Fish · {engineLabel(fishHealth, "Arrêté")}
            </div>
          </div>
          <span>{activeHealth?.message ?? health?.message ?? "Connexion au serveur…"}</span>
        </div>
      </header>

      {error ? <div className="banner" data-kind="error">{error}</div> : null}
      {notice ? <div className="banner">{notice}</div> : null}

      <div className="layout">
        <section className="panel">
          <h2>Enregistrer</h2>
          <p className="hint">Deux à quatre phrases différentes, une dizaine de secondes chacune, dans la même pièce. Le modèle moyenne les extraits. Huit au maximum. L'enregistrement s'arrête à 30 secondes.</p>
          <div className="recorder">
            <button
              type="button"
              className="record"
              data-on={recording}
              onClick={() => (recording ? stopRecording() : void startRecording())}
              aria-pressed={recording}
              aria-label={recording ? "Arrêter l'enregistrement" : "Démarrer l'enregistrement"}
            >
              <span className="mark" />
            </button>
            <div>
              <p className="timer">{clock(seconds)}</p>
              <p className="hint">{recording ? "En cours" : take ? "Prise prête" : "Micro en attente"}</p>
            </div>
          </div>
          <div className="actions">
            <button type="button" className="primary" disabled={!take || drafts.length >= MAX_CLIPS} onClick={addTakeToDrafts}>
              Ajouter cet extrait
            </button>
            <label className="file">
              Importer des fichiers
              <input
                type="file"
                accept="audio/*,.wav,.mp3,.m4a,.webm,.ogg"
                multiple
                onChange={(event) => {
                  onUpload(event.target.files);
                  event.target.value = "";
                }}
              />
            </label>
          </div>
          {take ? (
            <>
              <audio src={take.url} controls />
              {takeBusy ? <p className="hint">Transcription…</p> : null}
              {takeText ? <p className="transcript">{takeText}</p> : null}
              {takeText ? (
                <div className="actions">
                  <button type="button" className="ghost" onClick={() => chooseText({ label: "Cette prise", url: take.url, text: takeText }, language)}>
                    Choisir ce texte
                  </button>
                  <button
                    type="button"
                    className="ghost"
                    disabled={!selectedVoice || generating}
                    onClick={() => void compareWith({ label: selectedVoice?.name ?? "Cette prise", url: take.url, text: takeText }, language, selectedVoice?.id ?? "")}
                  >
                    Comparer
                  </button>
                </div>
              ) : null}
            </>
          ) : null}
          {drafts.length > 0 ? (
            <div className="voices">
              {drafts.map((clip, index) => (
                <div key={clip.key} className="voice clip">
                  <div style={{ flex: 1 }}>
                    <strong>Extrait {index + 1}</strong>
                    <br />
                    <small>{clip.seconds == null ? "durée au moment de l'envoi" : `${clip.seconds.toFixed(1)} s`}</small>
                    <audio src={clip.url} controls />
                    {clip.text ? <p className="transcript">{clip.text}</p> : <p className="hint">Transcription…</p>}
                    {clip.text ? (
                      <div className="actions">
                        <button type="button" className="ghost" onClick={() => chooseText({ label: `Extrait ${index + 1}`, url: clip.url, text: clip.text ?? "" }, language)}>
                          Choisir ce texte
                        </button>
                        <button
                          type="button"
                          className="ghost"
                          disabled={!selectedVoice || generating}
                          onClick={() => void compareWith({ label: selectedVoice?.name ?? `Extrait ${index + 1}`, url: clip.url, text: clip.text ?? "" }, language, selectedVoice?.id ?? "")}
                        >
                          Comparer
                        </button>
                      </div>
                    ) : null}
                  </div>
                  <button type="button" className="ghost" onClick={() => dropDraft(clip.key)}>Retirer</button>
                </div>
              ))}
            </div>
          ) : (
            <p className="hint">Aucun extrait en attente.</p>
          )}
          <label className="field">
            <span>Nom de la voix</span>
            <input value={name} maxLength={80} onChange={(event) => setName(event.target.value)} />
          </label>
          <label className="field">
            <span>Langue parlée</span>
            <select value={language} onChange={(event) => setLanguage(event.target.value)}>
              {LANGUAGES.map((item) => (
                <option key={item.id} value={item.id}>{item.label}</option>
              ))}
            </select>
          </label>
          <div className="actions" style={{ marginTop: 14 }}>
            <button type="button" className="primary" disabled={drafts.length === 0 || saving || !name.trim()} onClick={() => void saveVoice()}>
              {saving ? "Enregistrement…" : `Créer la voix (${drafts.length})`}
            </button>
            <button
              type="button"
              className="ghost"
              disabled={!selectedVoice || drafts.length === 0 || saving}
              onClick={() => void appendToSelected()}
            >
              Ajouter à {selectedVoice ? `« ${selectedVoice.name} »` : "la voix choisie"}
            </button>
          </div>

          <div className="voices">
            {voices.length === 0 ? <p className="hint">Aucune voix enregistrée pour l'instant.</p> : null}
            {voices.map((voice) => (
              <div key={voice.id} className="voice" data-on={selectedVoice?.id === voice.id}>
                <button
                  type="button"
                  className="pick"
                  onClick={() => {
                    setSelected({ kind: "voice", id: voice.id });
                    setTextLanguage(voice.language);
                  }}
                >
                  <strong>{voice.name}</strong>
                  <br />
                  <small>
                    {voice.language} · {voice.clips.length} extrait{voice.clips.length > 1 ? "s" : ""} · {voice.duration.toFixed(1)} s
                  </small>
                </button>
                <button type="button" className="ghost" onClick={() => void remove(voice.id)}>Retirer</button>
              </div>
            ))}
          </div>
          {selectedVoice ? (
            <div className="voices">
              <p className="hint">Le clone suit la prise marquée Modèle. En mélanger plusieurs lisse le timbre et l'éloigne de ta voix.</p>
              {selectedVoice.clips.map((clip, index) => (
                <div key={clip.id} className="voice clip">
                  <div style={{ flex: 1 }}>
                    <strong>Extrait {index + 1}</strong>
                    <br />
                    <small>{clip.duration.toFixed(1)} s</small>
                    <audio src={`/api/voices/${selectedVoice.id}/clips/${clip.id}`} controls />
                    {clip.text == null ? <p className="hint">Transcription…</p> : clip.text ? <p className="transcript">{clip.text}</p> : <p className="hint">Aucun mot reconnu.</p>}
                    {clip.text ? (
                      <div className="actions">
                        <button
                          type="button"
                          className="ghost"
                          onClick={() => chooseText(
                            { label: selectedVoice.name, url: `/api/voices/${selectedVoice.id}/clips/${clip.id}`, text: clip.text ?? "" },
                            selectedVoice.language,
                          )}
                        >
                          Choisir ce texte
                        </button>
                        <button
                          type="button"
                          className="ghost"
                          data-on={(selectedVoice.referenceClipId ?? selectedVoice.clips[0]?.id) === clip.id}
                          onClick={() => void markReference(selectedVoice.id, clip.id)}
                        >
                          Modèle
                        </button>
                        <button type="button" className="ghost" disabled={generating} onClick={() => void compareSaved(selectedVoice, clip)}>
                          Comparer
                        </button>
                      </div>
                    ) : null}
                  </div>
                  {selectedVoice.clips.length > 1 ? (
                    <button type="button" className="ghost" onClick={() => void removeOneClip(selectedVoice.id, clip.id)}>Retirer</button>
                  ) : null}
                </div>
              ))}
            </div>
          ) : null}
        </section>

        <section className="panel">
          <h2>Tester une phrase</h2>
          <p className="hint">
            {engine === "fish"
              ? "Fish Speech reprend ta voix enregistrée et la transcription de l'extrait. Les voix intégrées à XTTS restent sur l'autre moteur."
              : "XTTS parle la langue du texte, avec le timbre choisi. Une phrase courte met quelques secondes, un texte long un peu plus."}
          </p>
          <label className="field">
            <span>Voix</span>
            <select
              value={selected ? (selected.kind === "voice" ? `voice:${selected.id}` : `speaker:${selected.name}`) : ""}
              onChange={(event) => {
                const value = event.target.value;
                if (value.startsWith("voice:")) {
                  const id = value.slice(6);
                  const voice = voices.find((item) => item.id === id);
                  setSelected({ kind: "voice", id });
                  if (voice) setTextLanguage(voice.language);
                } else if (value.startsWith("speaker:")) {
                  setSelected({ kind: "speaker", name: value.slice(8) });
                }
              }}
            >
              {voices.length === 0 && (engine === "fish" || speakers.length === 0) ? <option value="">
                {engine === "fish" ? "Enregistre une voix" : "En attente du modèle…"}
              </option> : null}
              {voices.length > 0 ? <optgroup label="Mes voix">
                {voices.map((voice) => (
                  <option key={voice.id} value={`voice:${voice.id}`}>{voice.name} ({voice.clips.length})</option>
                ))}
              </optgroup> : null}
              {engine === "xtts" && speakers.length > 0 ? <optgroup label="Voix du modèle">
                {speakers.map((speaker) => (
                  <option key={speaker} value={`speaker:${speaker}`}>{speaker}</option>
                ))}
              </optgroup> : null}
            </select>
          </label>
          <label className="field">
            <span>Langue du texte</span>
            <select value={textLanguage} onChange={(event) => setTextLanguage(event.target.value)}>
              {LANGUAGES.map((item) => (
                <option key={item.id} value={item.id}>{item.label}</option>
              ))}
            </select>
          </label>
          <div className="snippets">
            {SNIPPETS.map((snippet) => (
              <button
                key={snippet.title}
                type="button"
                className="ghost"
                data-on={text === snippet.text}
                onClick={() => {
                  setText(snippet.text);
                  setTextLanguage("fr");
                  compareRef.current = null;
                  setCompare(null);
                }}
              >
                {snippet.title}
              </button>
            ))}
          </div>
          <label className="field">
            <span>Texte</span>
            <textarea value={text} maxLength={4000} onChange={(event) => setText(event.target.value)} />
          </label>
          <label className="mix">
            <input type="checkbox" checked={blend} onChange={(event) => setBlend(event.target.checked)} />
            Mélanger toutes les prises
          </label>
          <div className="actions" style={{ marginTop: 14 }}>
            <button type="button" className="primary" disabled={!ready || generating || !text.trim() || !selected} onClick={() => void generate()}>
              {generating ? "Génération…" : "Générer"}
            </button>
            {elapsed != null && !generating ? <span className="meta">Généré en {elapsed.toFixed(0)} s</span> : null}
          </div>
          {resultUrl && !compare ? (
            <>
              <audio src={resultUrl} controls autoPlay />
              <div className="actions" style={{ marginTop: 8 }}>
                <a className="ghost" href={resultUrl} download="extrait.wav">Télécharger le wav</a>
              </div>
            </>
          ) : null}
        </section>
      </div>
      {compare ? (
        <section className="panel compare-panel">
          <h2>Côte à côte</h2>
          <p className="transcript">{compare.text}</p>
          <div className="compare">
            <div>
              <h3>Enregistrement</h3>
              <audio src={compare.url} controls />
            </div>
            <div>
              <h3>Clone</h3>
              {resultUrl ? <audio src={resultUrl} controls /> : <p className="hint">{generating ? "Génération…" : "Le clone apparaît ici."}</p>}
              {resultUrl ? (
                <div className="actions">
                  <a className="ghost" href={resultUrl} download="clone.wav">Télécharger le clone</a>
                </div>
              ) : null}
            </div>
          </div>
        </section>
      ) : null}
      <footer>
        {engine === "fish"
          ? "Fish Speech, licence du modèle Fish Audio, usage non commercial. Réservé à ta propre voix."
          : "XTTS v2, licence CPML, usage non commercial. Réservé à ta propre voix."}
        {engine === "xtts" && xttsHealth?.device === "cpu" ? " Le calcul tourne sur le CPU : le premier essai charge le modèle, les suivants restent sur la machine." : ""}
      </footer>
    </div>
  );
}
