// Pure helpers for safe organizing: name cleanup, collision-free destinations,
// duplicate detection, and Windows / Mac apply + undo scripts.
// No React or browser-only code here, so it can be tested with plain Node.

export const ORGANIZED_FOLDER_PREFIX = '_Organized_by_Prospers';
export const OLD_FILE_DAYS = 365;

/** Folder name for one organizing run, e.g. "_Organized_by_Prospers_2026-11-20_0937". */
export function runFolderName(now: Date = new Date()): string {
  const pad = (n: number) => String(n).padStart(2, '0');
  return `${ORGANIZED_FOLDER_PREFIX}_${now.getFullYear()}-${pad(now.getMonth() + 1)}-${pad(
    now.getDate()
  )}_${pad(now.getHours())}${pad(now.getMinutes())}`;
}

const WINDOWS_RESERVED = /^(con|prn|aux|nul|com[1-9]|lpt[1-9])$/i;

/** Make one path segment safe on Windows, Mac and Linux. */
export function cleanSegment(segment: string): string {
  let s = segment
    .replace(/[<>:"/\\|?*\x00-\x1F]/g, '-')
    .replace(/\s+/g, ' ')
    .trim()
    .replace(/^\.+/, '')
    .replace(/[. ]+$/, '');
  if (WINDOWS_RESERVED.test(s.split('.')[0] ?? '')) s = `_${s}`;
  if (s.length > 150) {
    const dot = s.lastIndexOf('.');
    const ext = dot > 0 && s.length - dot <= 10 ? s.slice(dot) : '';
    s = s.slice(0, 150 - ext.length).trim() + ext;
  }
  return s;
}

export function cleanFolderPath(folder: string): string {
  const cleaned = folder
    .replace(/\\/g, '/')
    .split('/')
    .map(cleanSegment)
    .filter((p) => p && p !== '..')
    .join('/');
  return cleaned || 'Uncategorized';
}

/** Clean a (possibly user-edited) filename and always keep the original extension. */
export function cleanFileName(proposed: string, originalName: string): string {
  const dot = originalName.lastIndexOf('.');
  const ext = dot > 0 ? originalName.slice(dot) : '';
  let name = cleanSegment(proposed);
  if (!name) return cleanSegment(originalName) || 'file';
  if (ext && !name.toLowerCase().endsWith(ext.toLowerCase())) {
    const pDot = name.lastIndexOf('.');
    if (pDot > 0 && name.length - pDot <= 6) name = name.slice(0, pDot);
    name = `${name}${ext}`;
  }
  return name;
}

export function splitName(name: string): { stem: string; ext: string } {
  const dot = name.lastIndexOf('.');
  return dot > 0 ? { stem: name.slice(0, dot), ext: name.slice(dot) } : { stem: name, ext: '' };
}

/**
 * Give every operation a unique destination (case-insensitive, like Windows and Mac).
 * `taken` lets callers pre-load names that already exist on disk.
 */
export function makeDestinationsUnique<T extends { targetFolder: string; newFileName: string }>(
  ops: T[],
  taken: Set<string> = new Set()
): T[] {
  const used = new Set([...taken].map((t) => t.toLowerCase()));
  return ops.map((op) => {
    const { stem, ext } = splitName(op.newFileName);
    let candidate = op.newFileName;
    let n = 2;
    while (used.has(`${op.targetFolder}/${candidate}`.toLowerCase())) {
      candidate = `${stem} (${n})${ext}`;
      n++;
    }
    used.add(`${op.targetFolder}/${candidate}`.toLowerCase());
    return { ...op, newFileName: candidate };
  });
}

export function isOldFile(lastModifiedIso: string, now: Date = new Date()): boolean {
  const t = Date.parse(lastModifiedIso);
  if (Number.isNaN(t)) return false;
  return now.getTime() - t > OLD_FILE_DAYS * 24 * 60 * 60 * 1000;
}

export interface DuplicateCandidate {
  id: string;
  sizeBytes: number;
  lastModified: string;
  pathInRoot: string;
}

/**
 * Exact duplicate detection. Only files that share a size with another file are fingerprinted,
 * so big folders stay fast. Returns: file id -> id of the copy we keep.
 * The kept copy is the oldest one (ties: shortest path, then first seen).
 */
export async function findExactDuplicates(
  items: DuplicateCandidate[],
  fingerprint: (id: string) => Promise<string | null>,
  onProgress?: (done: number, total: number) => void
): Promise<Map<string, string>> {
  const bySize = new Map<number, DuplicateCandidate[]>();
  for (const it of items) {
    if (it.sizeBytes === 0) continue; // empty files are all "equal" but not meaningful
    const list = bySize.get(it.sizeBytes) ?? [];
    list.push(it);
    bySize.set(it.sizeBytes, list);
  }
  const toHash = [...bySize.values()].filter((g) => g.length > 1).flat();
  const byHash = new Map<string, DuplicateCandidate[]>();
  let done = 0;
  for (const it of toHash) {
    const h = await fingerprint(it.id);
    done++;
    onProgress?.(done, toHash.length);
    if (!h) continue;
    const key = `${it.sizeBytes}:${h}`;
    const list = byHash.get(key) ?? [];
    list.push(it);
    byHash.set(key, list);
  }
  const extraToKeeper = new Map<string, string>();
  for (const group of byHash.values()) {
    if (group.length < 2) continue;
    const sorted = [...group].sort(
      (a, b) =>
        Date.parse(a.lastModified) - Date.parse(b.lastModified) ||
        a.pathInRoot.length - b.pathInRoot.length
    );
    const keeper = sorted[0];
    for (const extra of sorted.slice(1)) extraToKeeper.set(extra.id, keeper.id);
  }
  return extraToKeeper;
}

// ---------- Apply & Undo scripts ----------

export interface ScriptMove {
  /** Path of the file inside the selected folder, e.g. "Scans/IMG_1.jpg" */
  from: string;
  /** Destination inside the selected folder, e.g. "_Organized_by_Prospers_.../Photos/Beach.jpg" */
  to: string;
}

const psQuote = (s: string) => `'${s.replace(/'/g, "''")}'`;
const shQuote = (s: string) => `'${s.replace(/'/g, `'\\''`)}'`;
const toWin = (p: string) => p.replace(/\//g, '\\');

function psScript(title: string, moves: ScriptMove[], undo: boolean): string {
  const lines = [
    `# ${title}`,
    '# Made by Prospers Solutions. Put this file inside the folder you organized, then',
    '# right-click it and choose "Run with PowerShell".',
    '# It never overwrites a file: if something is already in the way, that file is skipped.',
    '$ErrorActionPreference = "Continue"',
    '$base = $PSScriptRoot',
    "if ((Split-Path -Leaf $base) -eq '_Undo') { $base = Split-Path -Parent $base }",
    `if ((Split-Path -Leaf $base) -like '${ORGANIZED_FOLDER_PREFIX}*') { $base = Split-Path -Parent $base }`,
    'Set-Location -LiteralPath $base',
    '$moved = 0; $skipped = 0',
    'function Move-One([string]$from, [string]$to) {',
    '  if (-not (Test-Path -LiteralPath $from -PathType Leaf)) { Write-Host "Not found, skipped: $from"; $script:skipped++; return }',
    '  if (Test-Path -LiteralPath $to) { Write-Host "Already exists, skipped: $to"; $script:skipped++; return }',
    '  $src = [System.IO.Path]::Combine($base, $from); $dst = [System.IO.Path]::Combine($base, $to)',
    '  [System.IO.Directory]::CreateDirectory([System.IO.Path]::GetDirectoryName($dst)) | Out-Null',
    '  try { [System.IO.File]::Move($src, $dst); $script:moved++ } catch { Write-Host "Could not move: $from ($($_.Exception.Message))"; $script:skipped++ }',
    '}',
  ];
  for (const m of moves) {
    const [a, b] = undo ? [m.to, m.from] : [m.from, m.to];
    lines.push(`Move-One ${psQuote(toWin(a))} ${psQuote(toWin(b))}`);
  }
  lines.push(
    'Write-Host ""',
    'Write-Host "Done. Moved: $moved  Skipped: $skipped"',
    'Read-Host "Press Enter to close"'
  );
  // BOM so Windows PowerShell 5 reads accented / non-English filenames correctly
  return '﻿' + lines.join('\r\n') + '\r\n';
}

function shScript(title: string, moves: ScriptMove[], undo: boolean): string {
  const lines = [
    '#!/bin/sh',
    `# ${title}`,
    '# Made by Prospers Solutions. Put this file inside the folder you organized, then run:',
    '#   sh <this file name>',
    '# It never overwrites a file: if something is already in the way, that file is skipped.',
    'base="$(cd "$(dirname "$0")" && pwd)"',
    'if [ "$(basename "$base")" = "_Undo" ]; then base="$(dirname "$base")"; fi',
    `case "$(basename "$base")" in ${ORGANIZED_FOLDER_PREFIX}*) base="$(dirname "$base")";; esac`,
    'cd "$base" || exit 1',
    'moved=0; skipped=0',
    'move_one() {',
    '  if [ ! -f "$1" ]; then echo "Not found, skipped: $1"; skipped=$((skipped+1)); return; fi',
    '  if [ -e "$2" ]; then echo "Already exists, skipped: $2"; skipped=$((skipped+1)); return; fi',
    '  mkdir -p "$(dirname "$2")" && mv -n "$1" "$2" && moved=$((moved+1))',
    '}',
  ];
  for (const m of moves) {
    const [a, b] = undo ? [m.to, m.from] : [m.from, m.to];
    lines.push(`move_one ${shQuote(a)} ${shQuote(b)}`);
  }
  lines.push('echo ""', 'echo "Done. Moved: $moved  Skipped: $skipped"');
  return lines.join('\n') + '\n';
}

export function buildScripts(moves: ScriptMove[]) {
  return {
    organizeWindows: psScript('Organize my files (Windows)', moves, false),
    organizeMac: shScript('Organize my files (Mac / Linux)', moves, false),
    undoWindows: psScript('Undo: put every file back where it was (Windows)', moves, true),
    undoMac: shScript('Undo: put every file back where it was (Mac / Linux)', moves, true),
  };
}

export const SCRIPTS_README = `How to use these files
======================

Organize-My-Files  = sorts the files in your folder into the new layout.
Undo-Organize      = puts every file back exactly where it was.

Windows: right-click the .ps1 file and choose "Run with PowerShell".
Mac:     open Terminal, type  sh  and a space, drag the .sh file into the window, press Enter.

If these files came in a download, first move them into the folder you organized.
If they are already inside an "_Organized_by_Prospers..." folder, run them right where they are.

Nothing is ever deleted or overwritten. If a file is already in the way, it is skipped and listed.
`;

// ---------- Filing Styles (saved in this browser) ----------

export interface FilingStyle {
  id: string;
  name: string;
  command: string;
  /** Answers in question order (1 to 5). Empty string = use the suggested answer. */
  answers: string[];
  createdAt: string;
  starter?: boolean;
}

export const STARTER_STYLES: FilingStyle[] = [
  {
    id: 'starter-downloads',
    name: 'Downloads Rescue',
    command:
      'Clean up my Downloads: group installers, documents, photos and screenshots, and rename messy file names.',
    answers: ['By Topic & Purpose', 'Yes, rename messy files clearly', '', 'Place inside an Archive subfolder', 'Move extras to a "Review Duplicates" folder'],
    createdAt: '2026-01-01T00:00:00.000Z',
    starter: true,
  },
  {
    id: 'starter-work',
    name: 'Clean Work Folder',
    command: 'Sort my work files by project and type, and put dates at the front of file names.',
    answers: ['By Topic & Purpose', 'Only add date prefixes', 'YYYY-MM-DD - Clean Title', 'Group by Year subfolders', 'Group into a "Drafts & Versions" folder'],
    createdAt: '2026-01-01T00:00:00.000Z',
    starter: true,
  },
  {
    id: 'starter-declutter',
    name: 'Deep Declutter',
    command: 'Find duplicates and old files, move them aside, and tidy everything else into simple folders.',
    answers: ['By File Type (Docs, Images, Sheets)', 'Yes, rename messy files clearly', '', 'Place inside an Archive subfolder', 'Move extras to a "Review Duplicates" folder'],
    createdAt: '2026-01-01T00:00:00.000Z',
    starter: true,
  },
];

const STYLES_KEY = 'prospers.filingStyles.v1';

export function loadSavedStyles(): FilingStyle[] {
  try {
    const raw = localStorage.getItem(STYLES_KEY);
    const parsed = raw ? (JSON.parse(raw) as FilingStyle[]) : [];
    return Array.isArray(parsed) ? parsed.filter((s) => s && s.id && s.name) : [];
  } catch {
    return [];
  }
}

export function storeSavedStyles(styles: FilingStyle[]): boolean {
  try {
    localStorage.setItem(STYLES_KEY, JSON.stringify(styles));
    return true;
  } catch {
    return false;
  }
}
