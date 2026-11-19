"""Client for a local Fish Speech server (tools/api_server.py)."""

from __future__ import annotations

import json
import os
import urllib.error
import urllib.request

import msgpack

DEFAULT_URL = "http://127.0.0.1:8080"


def api_base() -> str:
    return os.environ.get("FISH_API_URL", DEFAULT_URL).rstrip("/")


def api_key() -> str | None:
    key = os.environ.get("FISH_API_KEY", "").strip()
    return key or None


def probe() -> dict:
    url = api_base()
    try:
        request = urllib.request.Request(f"{url}/v1/health", method="GET")
        with urllib.request.urlopen(request, timeout=0.6) as response:
            raw = response.read()
        message = "Prêt"
        try:
            payload = json.loads(raw.decode())
            reported = payload.get("status")
            if reported not in (None, "ok"):
                message = str(reported)
        except (UnicodeDecodeError, json.JSONDecodeError):
            pass
        return {"status": "ready", "message": message, "device": "api", "url": url}
    except Exception:
        return {
            "status": "unavailable",
            "message": f"Serveur injoignable sur {url}.",
            "device": "api",
            "url": url,
        }


def build_payload(text: str, references: list[tuple[bytes, str]]) -> dict:
    return {
        "text": text,
        "references": [{"audio": audio, "text": transcript} for audio, transcript in references],
        "format": "wav",
        "streaming": False,
        "chunk_length": 200,
        "normalize": True,
        "use_memory_cache": "off",
        "latency": "normal",
    }


def synthesize(text: str, references: list[tuple[bytes, str]]) -> bytes:
    if not references:
        raise RuntimeError("Fish Speech a besoin d'au moins un extrait et de sa transcription.")
    body = msgpack.packb(build_payload(text, references), use_bin_type=True)
    headers = {"content-type": "application/msgpack"}
    key = api_key()
    if key:
        headers["authorization"] = f"Bearer {key}"
    request = urllib.request.Request(
        f"{api_base()}/v1/tts?format=msgpack",
        data=body,
        headers=headers,
        method="POST",
    )
    try:
        with urllib.request.urlopen(request, timeout=600) as response:
            data = response.read()
    except urllib.error.HTTPError as exc:
        detail = exc.read().decode("utf-8", errors="replace")[:500]
        raise RuntimeError(f"Fish Speech a répondu {exc.code}. {detail}") from exc
    except urllib.error.URLError as exc:
        raise RuntimeError(f"Fish Speech est injoignable ({api_base()}).") from exc
    if not data:
        raise RuntimeError("Fish Speech n'a renvoyé aucun audio.")
    return data
