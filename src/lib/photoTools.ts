// Photo tools that run entirely on the user's device:
//  1. The real "taken" date (from the camera's info inside the photo, then the file name,
//     then the date the file was last changed).
//  2. A picture fingerprint, so edited / resized / re-sent copies and burst shots can be found.
// The math parts are plain functions (tested in Node); only fingerprintPicture needs a browser.

import exifr from 'exifr';

export const PHOTO_EXTS = new Set(['jpg', 'jpeg', 'png', 'heic', 'heif', 'webp', 'gif', 'bmp', 'tif', 'tiff', 'avif', 'dng']);
export const VIDEO_EXTS = new Set(['mp4', 'mov', 'm4v', 'avi', 'mkv', 'webm', '3gp', 'wmv']);
/** Formats that carry the camera's date inside them */
const CAMERA_DATE_EXTS = new Set(['jpg', 'jpeg', 'heic', 'heif', 'tif', 'tiff', 'png', 'webp', 'avif', 'dng']);
/** Formats the browser can usually draw, for fingerprinting */
const DRAWABLE_EXTS = new Set(['jpg', 'jpeg', 'png', 'webp', 'gif', 'bmp', 'avif', 'heic', 'heif']);

export type DateSource = 'camera' | 'name' | 'changed';

const pad = (n: number) => String(n).padStart(2, '0');

/** Local date-time text without a time zone, e.g. "2024-03-12T14:32:05" */
export function toLocalStamp(d: Date): string {
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}T${pad(d.getHours())}:${pad(
    d.getMinutes()
  )}:${pad(d.getSeconds())}`;
}

function plausibleYear(y: number): boolean {
  return y >= 1990 && y <= new Date().getFullYear() + 1;
}

/** Date (and time if present) written in a file name: IMG_20240312_143205, 2024-03-12 14.32.05, PXL_20240312... */
export function dateTimeInName(name: string): string | null {
  const m = name.match(
    /(19\d{2}|20\d{2})[-_.]?(0[1-9]|1[0-2])[-_.]?(0[1-9]|[12]\d|3[01])(?:[\s_T-]*(?:at\s*)?([01]\d|2[0-3])[-_.:h]?([0-5]\d)[-_.:m]?([0-5]\d)?)?/i
  );
  if (!m || !plausibleYear(Number(m[1]))) return null;
  const date = `${m[1]}-${m[2]}-${m[3]}`;
  return m[4] ? `${date}T${m[4]}:${m[5]}:${m[6] ?? '00'}` : date;
}

/** The camera's "taken" date from inside the photo. Reads only the start of the file. */
export async function readCameraDate(file: Blob, ext: string): Promise<string | null> {
  if (!CAMERA_DATE_EXTS.has(ext)) return null;
  try {
    // Only these tags are read; exifr finds them through the photo's main info block.
    // The camera info sits near the start of the file: read only that part (fast for big photos)
    const head = await file.slice(0, Math.min(file.size, 1024 * 1024)).arrayBuffer();
    const tags = await exifr.parse(head, ['DateTimeOriginal', 'CreateDate', 'DateTimeDigitized']);
    const value = tags?.DateTimeOriginal ?? tags?.CreateDate ?? tags?.DateTimeDigitized;
    const d = value instanceof Date ? value : value ? new Date(value) : null;
    if (!d || Number.isNaN(d.getTime()) || !plausibleYear(d.getFullYear())) return null;
    return toLocalStamp(d);
  } catch {
    return null;
  }
}

/** Best date for a photo: camera → file name → last changed. */
export function bestDate(
  name: string,
  lastModifiedIso: string,
  cameraDate: string | null
): { taken: string; source: DateSource } {
  if (cameraDate) return { taken: cameraDate, source: 'camera' };
  const fromName = dateTimeInName(name);
  if (fromName) return { taken: fromName, source: 'name' };
  const d = new Date(lastModifiedIso);
  return { taken: Number.isNaN(d.getTime()) ? lastModifiedIso.slice(0, 10) : toLocalStamp(d), source: 'changed' };
}

// ---------- Picture fingerprint (difference hash) ----------

export type Fingerprint = [number, number]; // 64 bits as two 32-bit halves

/**
 * Turn a small grayscale picture into a 64-bit fingerprint. It compares neighbouring brightness,
 * so the same photo resized, recompressed or brightened gives (almost) the same fingerprint.
 * Returns null for nearly blank pictures, which would all look alike.
 */
export function fingerprintFromGray(gray: ArrayLike<number>, w: number, h: number): Fingerprint | null {
  const W = 9;
  const H = 8;
  const cells = new Float64Array(W * H);
  for (let cy = 0; cy < H; cy++) {
    const y0 = Math.floor((cy * h) / H);
    const y1 = Math.max(y0 + 1, Math.floor(((cy + 1) * h) / H));
    for (let cx = 0; cx < W; cx++) {
      const x0 = Math.floor((cx * w) / W);
      const x1 = Math.max(x0 + 1, Math.floor(((cx + 1) * w) / W));
      let sum = 0;
      let n = 0;
      for (let y = y0; y < y1; y++) for (let x = x0; x < x1; x++) {
        sum += gray[y * w + x];
        n++;
      }
      cells[cy * W + cx] = sum / n;
    }
  }
  let mean = 0;
  for (const v of cells) mean += v;
  mean /= cells.length;
  let variance = 0;
  for (const v of cells) variance += (v - mean) ** 2;
  if (Math.sqrt(variance / cells.length) < 4) return null;

  let hi = 0;
  let lo = 0;
  let bit = 0;
  for (let y = 0; y < H; y++) {
    for (let x = 0; x < W - 1; x++) {
      const on = cells[y * W + x] > cells[y * W + x + 1] ? 1 : 0;
      if (bit < 32) hi = (hi << 1) | on;
      else lo = (lo << 1) | on;
      bit++;
    }
  }
  return [hi >>> 0, lo >>> 0];
}

function popcount(n: number): number {
  n = n - ((n >>> 1) & 0x55555555);
  n = (n & 0x33333333) + ((n >>> 2) & 0x33333333);
  return (((n + (n >>> 4)) & 0x0f0f0f0f) * 0x01010101) >>> 24;
}

export function fingerprintDistance(a: Fingerprint, b: Fingerprint): number {
  return popcount((a[0] ^ b[0]) >>> 0) + popcount((a[1] ^ b[1]) >>> 0);
}

/** How close two fingerprints must be (out of 64) to count as "the same photo" */
export const SIMILAR_LIMIT = 8; // tested: real copies 0-4, different photos 19+

export interface SimilarCandidate {
  id: string;
  fingerprint: Fingerprint;
  sizeBytes: number;
  taken: string;
  /** True when the photo still has the camera's info, which means it's the original */
  hasCameraDate?: boolean;
}

/**
 * Group look-alike photos. Returns: photo id -> id of the copy we keep.
 * We keep the original: the one with the camera's info, then the biggest file, then the oldest.
 */
export function groupSimilar(items: SimilarCandidate[], limit = SIMILAR_LIMIT): Map<string, string> {
  const parent = items.map((_, i) => i);
  const find = (i: number): number => (parent[i] === i ? i : (parent[i] = find(parent[i])));
  for (let i = 0; i < items.length; i++) {
    for (let j = i + 1; j < items.length; j++) {
      if (fingerprintDistance(items[i].fingerprint, items[j].fingerprint) <= limit) {
        parent[find(i)] = find(j);
      }
    }
  }
  const groups = new Map<number, SimilarCandidate[]>();
  items.forEach((it, i) => {
    const root = find(i);
    groups.set(root, [...(groups.get(root) ?? []), it]);
  });
  const extraToKeeper = new Map<string, string>();
  for (const group of groups.values()) {
    if (group.length < 2) continue;
    const [keeper, ...extras] = [...group].sort(
      (a, b) =>
        Number(!!b.hasCameraDate) - Number(!!a.hasCameraDate) ||
        b.sizeBytes - a.sizeBytes ||
        a.taken.localeCompare(b.taken)
    );
    for (const e of extras) extraToKeeper.set(e.id, keeper.id);
  }
  return extraToKeeper;
}

/** Browser only: draw the photo tiny and fingerprint it. Returns null if the browser can't draw it. */
export async function fingerprintPicture(file: Blob, ext: string): Promise<Fingerprint | null> {
  if (!DRAWABLE_EXTS.has(ext) || file.size > 60 * 1024 * 1024 || typeof createImageBitmap !== 'function') {
    return null;
  }
  const S = 32;
  let bitmap: ImageBitmap | null = null;
  try {
    try {
      bitmap = await createImageBitmap(file, { resizeWidth: S, resizeHeight: S, resizeQuality: 'high' });
    } catch {
      bitmap = await createImageBitmap(file); // older browsers: no resize option
    }
    const canvas: OffscreenCanvas | HTMLCanvasElement =
      typeof OffscreenCanvas !== 'undefined'
        ? new OffscreenCanvas(S, S)
        : Object.assign(document.createElement('canvas'), { width: S, height: S });
    const ctx = canvas.getContext('2d') as CanvasRenderingContext2D | OffscreenCanvasRenderingContext2D | null;
    if (!ctx) return null;
    ctx.imageSmoothingEnabled = true;
    ctx.imageSmoothingQuality = 'high';
    ctx.drawImage(bitmap, 0, 0, S, S);
    const { data } = ctx.getImageData(0, 0, S, S);
    const gray = new Float64Array(S * S);
    for (let i = 0; i < S * S; i++) {
      gray[i] = 0.299 * data[i * 4] + 0.587 * data[i * 4 + 1] + 0.114 * data[i * 4 + 2];
    }
    return fingerprintFromGray(gray, S, S);
  } catch {
    return null; // e.g. HEIC in Chrome: skip, never guess
  } finally {
    bitmap?.close();
  }
}
