export type EngineName = "xtts" | "fish";

export type EngineHealth = {
  status: "loading" | "ready" | "error" | "unavailable";
  message: string;
  device: string;
  url?: string;
};

export type Health = {
  status: "loading" | "ready" | "error";
  message: string;
  device: string;
  engines?: {
    xtts: EngineHealth;
    fish: EngineHealth;
  };
};

export type Clip = {
  id: string;
  duration: number;
  createdAt: string;
  text?: string | null;
};

export type Voice = {
  id: string;
  name: string;
  language: string;
  duration: number;
  createdAt: string;
  clips: Clip[];
  referenceClipId?: string;
};

export type AudioFile = {
  blob: Blob;
  filename: string;
};

export type Selection =
  | { kind: "voice"; id: string }
  | { kind: "speaker"; name: string };

async function errorMessage(response: Response): Promise<string> {
  try {
    const data = (await response.json()) as { detail?: unknown };
    if (typeof data.detail === "string") return data.detail;
    if (data.detail) return JSON.stringify(data.detail);
  } catch {
    /* corps vide */
  }
  return response.statusText || "La requête a échoué.";
}

async function request<T>(path: string, init?: RequestInit): Promise<T> {
  const response = await fetch(path, init);
  if (!response.ok) throw new Error(await errorMessage(response));
  return (await response.json()) as T;
}

export function getHealth(): Promise<Health> {
  return request<Health>("/api/health");
}

export async function getVoices(): Promise<Voice[]> {
  const data = await request<{ voices: Voice[] }>("/api/voices");
  return data.voices;
}

export async function getSpeakers(): Promise<string[]> {
  const data = await request<{ speakers: string[] }>("/api/speakers");
  return data.speakers;
}

function audioForm(files: AudioFile[]): FormData {
  const body = new FormData();
  for (const file of files) body.append("files", file.blob, file.filename);
  return body;
}

export async function createVoice(
  files: AudioFile[],
  name: string,
  language: string,
  texts: string[],
): Promise<{ voice: Voice; warning: string | null }> {
  const body = audioForm(files);
  body.set("name", name);
  body.set("language", language);
  body.set("texts", JSON.stringify(texts));
  return request("/api/voices", { method: "POST", body });
}

export function addClips(
  id: string,
  files: AudioFile[],
  texts: string[],
): Promise<{ voice: Voice; warning: string | null }> {
  const body = audioForm(files);
  body.set("texts", JSON.stringify(texts));
  return request(`/api/voices/${id}/clips`, { method: "POST", body });
}

export async function transcribeAudio(file: Blob, filename: string, language: string): Promise<string> {
  const body = new FormData();
  body.set("file", file, filename);
  body.set("language", language);
  const data = await request<{ text: string }>("/api/transcribe", { method: "POST", body });
  return data.text;
}

export function transcribeClip(
  voiceId: string,
  clipId: string,
): Promise<{ text: string; voice: Voice }> {
  return request(`/api/voices/${voiceId}/clips/${clipId}/transcript`, { method: "POST" });
}

export function deleteClip(
  voiceId: string,
  clipId: string,
): Promise<{ voice: Voice; warning: string | null }> {
  return request(`/api/voices/${voiceId}/clips/${clipId}`, { method: "DELETE" });
}

export function deleteVoice(id: string): Promise<{ ok: boolean }> {
  return request(`/api/voices/${id}`, { method: "DELETE" });
}

export function setReference(voiceId: string, clipId: string): Promise<{ voice: Voice; warning: string | null }> {
  return request(`/api/voices/${voiceId}/reference`, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({ clipId }),
  });
}

export async function synthesize(input: {
  text: string;
  language: string;
  voiceId?: string;
  speaker?: string;
  clipId?: string;
  blend?: boolean;
  engine: "xtts" | "fish";
}): Promise<Blob> {
  const response = await fetch("/api/synthesize", {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify(input),
  });
  if (!response.ok) throw new Error(await errorMessage(response));
  return response.blob();
}
