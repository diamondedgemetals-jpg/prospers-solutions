// One place for every call to the Prospers server.
//
// When the app is opened from the same address as the server (Render, AI Studio), leave
// VITE_API_BASE empty. When it runs somewhere else (phone app wrapper, static host),
// set VITE_API_BASE to the server's address, e.g. https://prospers-solutions.onrender.com

const API_BASE = (((import.meta as { env?: Record<string, string | undefined> }).env?.VITE_API_BASE) ?? '').replace(/\/+$/, '');

const CANT_REACH =
  "We can't reach the Prospers server right now. Check your internet connection and try again in a minute.";

export async function apiFetch(path: string, init?: RequestInit): Promise<Response> {
  try {
    return await fetch(`${API_BASE}${path}`, init);
  } catch {
    throw new Error(CANT_REACH);
  }
}

/** Read a JSON answer from the server, with a plain-English message if something else came back. */
export async function readJson<T = Record<string, unknown>>(response: Response): Promise<T> {
  const text = await response.text();
  try {
    return JSON.parse(text) as T;
  } catch {
    if (response.status === 429) {
      throw new Error('Too many requests in a short time. Please wait a few minutes and try again.');
    }
    if (response.status >= 500 || /^\s*</.test(text)) {
      // A web page came back instead of an answer: the server is missing, asleep, or restarting
      throw new Error(
        "The Prospers server didn't answer. If the app was idle, it may be waking up. Please try again in 30 seconds."
      );
    }
    throw new Error(CANT_REACH);
  }
}
