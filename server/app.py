"""API locale pour cloner une voix avec XTTS v2 et tester des phrases."""

from __future__ import annotations

import asyncio
import json
import os
import re
import shutil
import subprocess
import tempfile
import threading
import uuid
import wave
from contextlib import asynccontextmanager
from datetime import datetime, timezone
from pathlib import Path

# La licence CPML du modèle est non commerciale. Cette variable évite le prompt
# interactif au premier téléchargement : https://huggingface.co/coqui/XTTS-v2
os.environ.setdefault("COQUI_TOS_AGREED", "1")

from fastapi import FastAPI, File, Form, HTTPException, UploadFile
from fastapi.middleware.cors import CORSMiddleware
from fastapi.responses import FileResponse, Response
from pydantic import BaseModel, Field

from . import fish as fish_speech

ROOT = Path(__file__).resolve().parent.parent
VOICES = ROOT / "data" / "voices"
VOICES.mkdir(parents=True, exist_ok=True)

LANGUAGES = [
    "fr",
    "en",
    "es",
    "de",
    "it",
    "pt",
    "pl",
    "tr",
    "ru",
    "nl",
    "cs",
    "ar",
    "zh-cn",
    "hu",
    "ko",
    "ja",
    "hi",
]
AUDIO_SUFFIXES = {".wav", ".mp3", ".m4a", ".webm", ".ogg", ".mp4", ".aac", ".flac", ".mpeg"}
MAX_CLIPS = 8
WHISPER_REPO = os.environ.get("WHISPER_MODEL", "mlx-community/whisper-large-v3-turbo")

state_lock = threading.Lock()
synth_lock = threading.Lock()
STATE: dict = {
    "status": "loading",
    "message": "Chargement de XTTS v2. Au premier lancement, le modèle (environ 2 Go) se télécharge.",
    "device": os.environ.get("XTTS_DEVICE", "cpu"),
    "speakers": [],
}
TTS_MODEL = None


def pick_device() -> str:
    requested = os.environ.get("XTTS_DEVICE", "cpu").strip().lower()
    if requested == "cpu":
        return "cpu"
    import torch

    if requested == "mps" and torch.backends.mps.is_available():
        return "mps"
    if requested == "cuda" and torch.cuda.is_available():
        return "cuda"
    return "cpu"


def load_model() -> None:
    global TTS_MODEL
    try:
        import torch
        from TTS.api import TTS

        threads = max(1, (os.cpu_count() or 4) - 2)
        torch.set_num_threads(threads)
        device = pick_device()
        with state_lock:
            STATE["device"] = device
            STATE["message"] = f"Chargement du modèle sur {device}. Le premier téléchargement prend quelques minutes."
        print(f"[xtts] chargement sur {device}", flush=True)
        model = TTS("tts_models/multilingual/multi-dataset/xtts_v2").to(device)
        raw = getattr(model, "speakers", None) or []
        if isinstance(raw, dict):
            speakers = list(raw.keys())
        else:
            speakers = [str(name) for name in raw]
        speakers = sorted(speakers, key=str.lower)
        TTS_MODEL = model
        with state_lock:
            STATE["status"] = "ready"
            STATE["message"] = "Prêt"
            STATE["speakers"] = speakers
            STATE["device"] = device
        print(f"[xtts] prêt, {len(speakers)} voix du modèle", flush=True)
    except Exception as exc:
        with state_lock:
            STATE["status"] = "error"
            STATE["message"] = str(exc)
        print(f"[xtts] échec du chargement : {exc}", flush=True)


@asynccontextmanager
async def lifespan(_app: FastAPI):
    threading.Thread(target=load_model, daemon=True).start()
    yield


app = FastAPI(title="XTTS Studio", lifespan=lifespan)
app.add_middleware(
    CORSMiddleware,
    allow_origins=["http://127.0.0.1:5173", "http://localhost:5173"],
    allow_methods=["*"],
    allow_headers=["*"],
)


@app.get("/")
def root() -> dict:
    return {"ui": "http://127.0.0.1:5173", "health": "/api/health"}


@app.get("/api/health")
def health() -> dict:
    fish_state = fish_speech.probe()
    with state_lock:
        xtts_state = {
            "status": STATE["status"],
            "message": STATE["message"],
            "device": STATE["device"],
        }
    return {
        "status": xtts_state["status"],
        "message": xtts_state["message"],
        "device": xtts_state["device"],
        "engines": {"xtts": xtts_state, "fish": fish_state},
    }


@app.get("/api/languages")
def languages() -> dict:
    return {"languages": LANGUAGES}


@app.get("/api/speakers")
def speakers() -> dict:
    with state_lock:
        if STATE["status"] != "ready":
            raise HTTPException(503, STATE["message"])
        return {"speakers": STATE["speakers"]}


def voice_folder(voice_id: str) -> Path:
    if not re.fullmatch(r"[a-f0-9]{8}", voice_id):
        raise HTTPException(400, "Identifiant de voix invalide.")
    path = VOICES / voice_id
    if not path.is_dir():
        raise HTTPException(404, "Voix introuvable.")
    return path


def load_meta(folder: Path) -> dict:
    return json.loads((folder / "meta.json").read_text())


def save_meta(folder: Path, meta: dict) -> None:
    (folder / "meta.json").write_text(json.dumps(meta, ensure_ascii=False, indent=2))


def wav_duration(path: Path) -> float:
    with wave.open(str(path), "rb") as handle:
        rate = handle.getframerate() or 1
        return handle.getnframes() / rate


def total_duration(clips: list[dict]) -> float:
    return round(sum(float(clip["duration"]) for clip in clips), 2)


def clips_warning(clips: list[dict]) -> str | None:
    notes: list[str] = []
    if len(clips) < 2:
        notes.append("Un seul extrait pour l'instant. Une deuxième phrase, dite à part, stabilise le timbre.")
    if any(float(clip["duration"]) < 6 for clip in clips):
        notes.append("Un extrait dure moins de 6 secondes. Dix à vingt secondes, c'est le bon créneau.")
    return " ".join(notes) or None


def ensure_clips(folder: Path, meta: dict) -> dict:
    if meta.get("clips"):
        return meta
    legacy = folder / "reference.wav"
    if not legacy.is_file():
        meta["clips"] = []
        meta["duration"] = 0
        save_meta(folder, meta)
        return meta
    clip_id = uuid.uuid4().hex[:8]
    dest_dir = folder / "clips"
    dest_dir.mkdir(exist_ok=True)
    dest = dest_dir / f"{clip_id}.wav"
    legacy.rename(dest)
    duration = round(wav_duration(dest), 2)
    meta["clips"] = [{"id": clip_id, "duration": duration, "createdAt": meta.get("createdAt")}]
    meta["duration"] = duration
    save_meta(folder, meta)
    return meta


def ensure_reference(folder: Path, meta: dict) -> dict:
    meta = ensure_clips(folder, meta)
    ids = [clip["id"] for clip in meta.get("clips") or []]
    if ids and meta.get("referenceClipId") not in ids:
        meta["referenceClipId"] = ids[0]
        save_meta(folder, meta)
    return meta


def list_voices() -> list[dict]:
    items = []
    for path in sorted(VOICES.iterdir()):
        meta_path = path / "meta.json"
        if meta_path.is_file():
            items.append(ensure_reference(path, load_meta(path)))
    items.sort(key=lambda item: item.get("createdAt", ""), reverse=True)
    return items


def clip_path(folder: Path, clip_id: str) -> Path:
    if not re.fullmatch(r"[a-f0-9]{8}", clip_id):
        raise HTTPException(400, "Identifiant d'extrait invalide.")
    path = folder / "clips" / f"{clip_id}.wav"
    if not path.is_file():
        raise HTTPException(404, "Extrait introuvable.")
    return path


def ffmpeg_to_wav(src: Path, dst: Path) -> float:
    ffmpeg = shutil.which("ffmpeg")
    if not ffmpeg:
        raise HTTPException(500, "ffmpeg est introuvable.")
    proc = subprocess.run(
        [ffmpeg, "-y", "-i", str(src), "-ac", "1", "-ar", "24000", "-c:a", "pcm_s16le", str(dst)],
        capture_output=True,
        text=True,
    )
    if proc.returncode != 0 or not dst.is_file():
        tail = (proc.stderr or "").strip()[-400:]
        raise HTTPException(400, f"Impossible de lire cet audio. {tail}")
    with wave.open(str(dst), "rb") as handle:
        rate = handle.getframerate() or 1
        return handle.getnframes() / rate


@app.get("/api/voices")
def voices() -> dict:
    return {"voices": list_voices()}


def upload_label(upload: UploadFile) -> str:
    name = Path(upload.filename or "extrait").name.strip() or "extrait"
    return name[:80]


async def store_clip(folder: Path, upload: UploadFile, language: str, known_text: str | None = None) -> dict:
    label = upload_label(upload)
    raw = await upload.read()
    if not raw:
        raise HTTPException(400, f"« {label} » est vide.")
    if len(raw) > 25 * 1024 * 1024:
        raise HTTPException(400, f"« {label} » est trop lourd, 25 Mo maximum.")
    suffix = Path(label).suffix.lower()
    if suffix not in AUDIO_SUFFIXES:
        suffix = ".bin"
    with tempfile.TemporaryDirectory() as tmp:
        src = Path(tmp) / f"upload{suffix}"
        dst = Path(tmp) / "clip.wav"
        src.write_bytes(raw)
        duration = ffmpeg_to_wav(src, dst)
        if duration < 3:
            raise HTTPException(400, f"« {label} » est trop court. Vise 10 à 20 secondes.")
        if duration > 35:
            raise HTTPException(
                400,
                f"« {label} » dépasse 30 secondes. Découpe-le en phrases d'une dizaine de secondes.",
            )
        wav = dst.read_bytes()
    clip_id = uuid.uuid4().hex[:8]
    dest_dir = folder / "clips"
    dest_dir.mkdir(exist_ok=True)
    wav_path = dest_dir / f"{clip_id}.wav"
    wav_path.write_bytes(wav)
    text = clean_transcript(known_text or "")
    if not text:
        text = await asyncio.to_thread(transcribe_wav, wav_path, language)
    return {
        "id": clip_id,
        "duration": round(duration, 2),
        "createdAt": datetime.now(timezone.utc).isoformat(),
        "text": text,
    }


def voice_payload(meta: dict) -> dict:
    return {"voice": meta, "warning": clips_warning(meta.get("clips") or [])}


def clean_transcript(value: str) -> str:
    text = " ".join(value.split())
    if len(text) <= 4000:
        return text
    shortened = text[:4000].rsplit(" ", 1)[0]
    return shortened or text[:4000]


def whisper_language(language: str) -> str:
    if language == "zh-cn":
        return "zh"
    return language


def transcribe_wav(path: Path, language: str) -> str:
    import mlx_whisper

    print(f"[xtts] transcription {language} {path.name}", flush=True)
    with synth_lock:
        result = mlx_whisper.transcribe(
            str(path),
            path_or_hf_repo=WHISPER_REPO,
            language=whisper_language(language),
            verbose=False,
            condition_on_previous_text=False,
        )
    return clean_transcript(str(result.get("text") or ""))


def parse_texts(raw: str) -> list[str]:
    if not raw.strip():
        return []
    try:
        parsed = json.loads(raw)
    except json.JSONDecodeError as exc:
        raise HTTPException(400, "Le texte joint aux extraits est illisible.") from exc
    if not isinstance(parsed, list) or not all(isinstance(item, str) for item in parsed):
        raise HTTPException(400, "Le texte joint aux extraits est illisible.")
    return parsed


@app.post("/api/voices", status_code=201)
async def create_voice(
    name: str = Form(...),
    language: str = Form("fr"),
    texts: str = Form(""),
    files: list[UploadFile] = File(...),
) -> dict:
    clean_name = name.strip()
    if not clean_name or len(clean_name) > 80:
        raise HTTPException(400, "Donne un nom de voix, 80 caractères maximum.")
    if language not in LANGUAGES:
        raise HTTPException(400, "Langue inconnue.")
    if not files:
        raise HTTPException(400, "Ajoute au moins un extrait.")
    if len(files) > MAX_CLIPS:
        raise HTTPException(400, f"{MAX_CLIPS} extraits maximum pour une voix.")

    supplied = parse_texts(texts)
    voice_id = uuid.uuid4().hex[:8]
    folder = VOICES / voice_id
    folder.mkdir(parents=True, exist_ok=False)
    try:
        clips = [
            await store_clip(folder, upload, language, supplied[index] if index < len(supplied) else None)
            for index, upload in enumerate(files)
        ]
    except Exception:
        shutil.rmtree(folder, ignore_errors=True)
        raise

    meta = {
        "id": voice_id,
        "name": clean_name,
        "language": language,
        "duration": total_duration(clips),
        "clips": clips,
        "createdAt": datetime.now(timezone.utc).isoformat(),
    }
    save_meta(folder, meta)
    print(f"[xtts] voix {voice_id} enregistrée ({len(clips)} extraits, {meta['duration']:.1f}s)", flush=True)
    return voice_payload(meta)


@app.post("/api/voices/{voice_id}/clips")
async def add_clips(
    voice_id: str,
    texts: str = Form(""),
    files: list[UploadFile] = File(...),
) -> dict:
    if not files:
        raise HTTPException(400, "Ajoute au moins un extrait.")
    folder = voice_folder(voice_id)
    meta = ensure_clips(folder, load_meta(folder))
    if len(meta["clips"]) + len(files) > MAX_CLIPS:
        raise HTTPException(400, f"{MAX_CLIPS} extraits maximum pour une voix.")
    supplied = parse_texts(texts)
    created: list[dict] = []
    try:
        for index, upload in enumerate(files):
            created.append(
                await store_clip(folder, upload, meta.get("language") or "fr", supplied[index] if index < len(supplied) else None)
            )
    except Exception:
        for clip in created:
            (folder / "clips" / f"{clip['id']}.wav").unlink(missing_ok=True)
        raise
    meta["clips"].extend(created)
    meta["duration"] = total_duration(meta["clips"])
    save_meta(folder, meta)
    print(f"[xtts] voix {voice_id} : {len(meta['clips'])} extraits", flush=True)
    return voice_payload(meta)


@app.delete("/api/voices/{voice_id}/clips/{clip_id}")
def remove_clip(voice_id: str, clip_id: str) -> dict:
    folder = voice_folder(voice_id)
    meta = ensure_clips(folder, load_meta(folder))
    if len(meta["clips"]) <= 1:
        raise HTTPException(400, "Garde au moins un extrait, ou retire la voix entière.")
    clip_path(folder, clip_id).unlink()
    meta["clips"] = [clip for clip in meta["clips"] if clip["id"] != clip_id]
    meta["duration"] = total_duration(meta["clips"])
    if meta.get("referenceClipId") not in [clip["id"] for clip in meta["clips"]]:
        meta["referenceClipId"] = meta["clips"][0]["id"]
    save_meta(folder, meta)
    return voice_payload(meta)


@app.post("/api/transcribe")
async def transcribe_upload(language: str = Form("fr"), file: UploadFile = File(...)) -> dict:
    if language not in LANGUAGES:
        raise HTTPException(400, "Langue inconnue.")
    label = upload_label(file)
    raw = await file.read()
    if not raw:
        raise HTTPException(400, "Le fichier audio est vide.")
    if len(raw) > 25 * 1024 * 1024:
        raise HTTPException(400, "Fichier trop lourd, 25 Mo maximum.")
    suffix = Path(label).suffix.lower()
    if suffix not in AUDIO_SUFFIXES:
        suffix = ".bin"
    with tempfile.TemporaryDirectory() as tmp:
        src = Path(tmp) / f"upload{suffix}"
        dst = Path(tmp) / "speech.wav"
        src.write_bytes(raw)
        ffmpeg_to_wav(src, dst)
        try:
            text = await asyncio.to_thread(transcribe_wav, dst, language)
        except HTTPException:
            raise
        except Exception as exc:
            raise HTTPException(500, f"La transcription a échoué. {exc}") from exc
    return {"text": text}


@app.post("/api/voices/{voice_id}/clips/{clip_id}/transcript")
async def transcript_clip(voice_id: str, clip_id: str) -> dict:
    folder = voice_folder(voice_id)
    meta = ensure_clips(folder, load_meta(folder))
    path = clip_path(folder, clip_id)
    try:
        text = await asyncio.to_thread(transcribe_wav, path, meta.get("language") or "fr")
    except HTTPException:
        raise
    except Exception as exc:
        raise HTTPException(500, f"La transcription a échoué. {exc}") from exc
    for clip in meta["clips"]:
        if clip["id"] == clip_id:
            clip["text"] = text
    save_meta(folder, meta)
    return {"text": text, "voice": meta}


@app.get("/api/voices/{voice_id}/clips/{clip_id}")
def clip_audio(voice_id: str, clip_id: str) -> FileResponse:
    folder = voice_folder(voice_id)
    ensure_clips(folder, load_meta(folder))
    return FileResponse(clip_path(folder, clip_id), media_type="audio/wav", filename=f"{clip_id}.wav")


@app.get("/api/voices/{voice_id}/reference")
def reference(voice_id: str) -> FileResponse:
    folder = voice_folder(voice_id)
    meta = ensure_clips(folder, load_meta(folder))
    if not meta["clips"]:
        raise HTTPException(404, "Référence introuvable.")
    return FileResponse(
        clip_path(folder, meta["clips"][0]["id"]),
        media_type="audio/wav",
        filename="reference.wav",
    )


@app.post("/api/voices/{voice_id}/reference")
def set_reference(voice_id: str, body: ReferenceBody) -> dict:
    folder = voice_folder(voice_id)
    meta = ensure_reference(folder, load_meta(folder))
    if not any(clip["id"] == body.clipId for clip in meta["clips"]):
        raise HTTPException(400, "Cet extrait ne fait pas partie de la voix.")
    meta["referenceClipId"] = body.clipId
    save_meta(folder, meta)
    return voice_payload(meta)


@app.delete("/api/voices/{voice_id}")
def remove_voice(voice_id: str) -> dict:
    shutil.rmtree(voice_folder(voice_id))
    return {"ok": True}


class SynthBody(BaseModel):
    text: str = Field(min_length=1, max_length=4000)
    language: str = "fr"
    voiceId: str | None = None
    speaker: str | None = None
    clipId: str | None = None
    blend: bool = False
    engine: str = "xtts"


class ReferenceBody(BaseModel):
    clipId: str


def chosen_clips(meta: dict, clip_id: str | None, blend: bool) -> list[dict]:
    clips = meta.get("clips") or []
    if not clips:
        raise HTTPException(400, "Cette voix n'a aucun extrait.")
    if blend:
        return clips
    chosen = clip_id or meta.get("referenceClipId") or clips[0]["id"]
    match = [clip for clip in clips if clip["id"] == chosen]
    if not match:
        raise HTTPException(400, "Cet extrait ne fait pas partie de la voix.")
    return match


def clone_paths(folder: Path, meta: dict, clip_id: str | None, blend: bool) -> list[str]:
    return [str(clip_path(folder, clip["id"])) for clip in chosen_clips(meta, clip_id, blend)]


def reference_items(folder: Path, meta: dict, clip_id: str | None, blend: bool) -> list[tuple[Path, str]]:
    items: list[tuple[Path, str]] = []
    for clip in chosen_clips(meta, clip_id, blend):
        transcript = str(clip.get("text") or "").strip()
        if not transcript:
            raise HTTPException(400, "Fish Speech a besoin de la transcription de chaque extrait utilisé.")
        items.append((clip_path(folder, clip["id"]), transcript))
    return items


def run_fish(text: str, voice_id: str | None, clip_id: str | None, blend: bool) -> bytes:
    if not voice_id:
        raise HTTPException(400, "Choisis une voix enregistrée pour Fish Speech.")
    folder = voice_folder(voice_id)
    meta = ensure_reference(folder, load_meta(folder))
    references = [(path.read_bytes(), transcript) for path, transcript in reference_items(folder, meta, clip_id, blend)]
    print(
        f"[fish] synthèse {len(text)} car. voix={voice_id} extraits={len(references)} mélange={blend}",
        flush=True,
    )
    return fish_speech.synthesize(text, references)


def run_tts(
    text: str,
    language: str,
    voice_id: str | None,
    speaker: str | None,
    clip_id: str | None,
    blend: bool,
) -> bytes:
    model = TTS_MODEL
    if model is None:
        raise HTTPException(503, "Le modèle est encore en chargement.")
    kwargs: dict = {"text": text, "language": language, "split_sentences": True}
    if voice_id:
        folder = voice_folder(voice_id)
        meta = ensure_reference(folder, load_meta(folder))
        kwargs["speaker_wav"] = clone_paths(folder, meta, clip_id, blend)
        # Plus bas que le 0,75 du modèle : moins de variation, timbre plus proche de la prise.
        kwargs["temperature"] = 0.55
    elif speaker:
        kwargs["speaker"] = speaker
    else:
        raise HTTPException(400, "Choisis une voix clonée ou une voix du modèle.")

    with tempfile.NamedTemporaryFile(suffix=".wav", delete=False) as handle:
        out_path = handle.name
    try:
        count = len(kwargs["speaker_wav"]) if voice_id else 1
        print(
            f"[xtts] synthèse {language} {len(text)} car. voix={voice_id or speaker} extraits={count} mélange={blend}",
            flush=True,
        )
        with synth_lock:
            model.tts_to_file(file_path=out_path, **kwargs)
        return Path(out_path).read_bytes()
    finally:
        Path(out_path).unlink(missing_ok=True)


@app.post("/api/synthesize")
async def synthesize(body: SynthBody) -> Response:
    text = " ".join(body.text.split())
    if not text:
        raise HTTPException(400, "Écris une phrase.")
    if body.language not in LANGUAGES:
        raise HTTPException(400, "Langue inconnue.")
    if body.engine not in {"xtts", "fish"}:
        raise HTTPException(400, "Moteur inconnu.")
    if body.voiceId and body.speaker:
        raise HTTPException(400, "Choisis une seule voix.")
    if body.engine == "fish":
        fish_state = fish_speech.probe()
        if fish_state["status"] != "ready":
            raise HTTPException(503, fish_state["message"])
        if body.speaker:
            raise HTTPException(400, "Fish Speech clone une voix enregistrée.")
        try:
            data = await asyncio.to_thread(run_fish, text, body.voiceId, body.clipId, body.blend)
        except HTTPException:
            raise
        except Exception as exc:
            raise HTTPException(502, f"La synthèse Fish Speech a échoué. {exc}") from exc
        return Response(content=data, media_type="audio/wav")
    with state_lock:
        if STATE["status"] != "ready":
            raise HTTPException(503, STATE["message"])
        known = set(STATE["speakers"])
    if body.speaker and body.speaker not in known:
        raise HTTPException(400, "Cette voix du modèle n'existe pas.")
    try:
        data = await asyncio.to_thread(
            run_tts, text, body.language, body.voiceId, body.speaker, body.clipId, body.blend
        )
    except HTTPException:
        raise
    except Exception as exc:
        raise HTTPException(500, f"La synthèse a échoué. {exc}") from exc
    return Response(content=data, media_type="audio/wav")
