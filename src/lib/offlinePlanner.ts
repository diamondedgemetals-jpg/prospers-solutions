// Offline Mode: organizes files with built-in rules, entirely on the user's device.
// Used when the server can't be reached, or when the user turns on Private Mode.
// No AI here, so names are tidy but simple.

import type {
  ClarifyingQuestion,
  FileAssessmentResponse,
  FileOrganizationPlanResponse,
  ScannedFileMeta,
} from '../types/files';
import { cleanFileName } from './organizerSafety';

// ---------- Kinds of files ----------

const KINDS: Array<{ folder: string; label: string; exts: string[] }> = [
  { folder: 'Photos', label: 'Photo', exts: ['jpg', 'jpeg', 'png', 'gif', 'heic', 'heif', 'webp', 'bmp', 'tif', 'tiff', 'raw', 'cr2', 'nef', 'arw', 'dng'] },
  { folder: 'Videos', label: 'Video', exts: ['mp4', 'mov', 'avi', 'mkv', 'wmv', 'm4v', 'webm', '3gp'] },
  { folder: 'Music & Audio', label: 'Audio', exts: ['mp3', 'wav', 'm4a', 'aac', 'flac', 'ogg', 'wma', 'opus'] },
  { folder: 'Documents', label: 'Document', exts: ['pdf', 'doc', 'docx', 'txt', 'rtf', 'odt', 'md', 'pages'] },
  { folder: 'Spreadsheets', label: 'Spreadsheet', exts: ['xls', 'xlsx', 'xlsm', 'csv', 'tsv', 'ods', 'numbers'] },
  { folder: 'Presentations', label: 'Presentation', exts: ['ppt', 'pptx', 'key', 'odp'] },
  { folder: 'Installers', label: 'Installer', exts: ['exe', 'msi', 'dmg', 'pkg', 'apk', 'deb', 'rpm', 'appimage'] },
  { folder: 'Zipped Files', label: 'Archive', exts: ['zip', 'rar', '7z', 'tar', 'gz', 'bz2', 'xz'] },
  { folder: 'Design Files', label: 'Design', exts: ['psd', 'ai', 'sketch', 'fig', 'xd', 'svg', 'indd', 'eps'] },
  { folder: 'E-books', label: 'Book', exts: ['epub', 'mobi', 'azw', 'azw3'] },
  { folder: 'Code & Web', label: 'Code', exts: ['js', 'ts', 'tsx', 'jsx', 'py', 'html', 'htm', 'css', 'json', 'xml', 'java', 'c', 'cpp', 'cs', 'sh', 'ps1', 'yml', 'yaml'] },
];

const SCREENSHOT = /^(screen ?shot|screenshot|screen recording|capture)/i;
const SCAN = /^scan/i;

export function kindOf(file: Pick<ScannedFileMeta, 'name' | 'extension'>): { folder: string; label: string } {
  const ext = file.extension.toLowerCase();
  const kind = KINDS.find((k) => k.exts.includes(ext));
  if (kind?.folder === 'Photos' && SCREENSHOT.test(file.name)) return { folder: 'Screenshots', label: 'Screenshot' };
  if (SCREENSHOT.test(file.name) && kind?.folder === 'Videos') return { folder: 'Screenshots', label: 'Screen Recording' };
  if (SCAN.test(file.name) && (ext === 'pdf' || kind?.folder === 'Photos')) return { folder: 'Scans', label: 'Scan' };
  return kind ? { folder: kind.folder, label: kind.label } : { folder: 'Other Files', label: 'File' };
}

// ---------- Names ----------

/** Names a person can't read: IMG_4021, PXL_2024..., DSC_0012, Scan_003, Untitled, Document (1) */
const CRYPTIC =
  /^(img|image|dsc|dscn|dcim|pxl|mvimg|vid|video|photo|pic|picture|screenshot|screen ?shot|screen recording|scan|scanned|untitled|document|doc|new document|file|download|audio|recording|whatsapp image|whatsapp video)[\s_.\-]*([0-9][0-9_.\-\s]*(at[\s_]*[0-9][0-9_.\s]*)?(am|pm)?)?([\s_-]*(copy|\(\d+\)))*$/i;

/** Find a date written inside a name: 20240312, 2024-03-12, 2024_03_12 */
export function dateInName(stem: string): string | null {
  const m = stem.match(/(20\d{2}|19\d{2})[-_.]?(0[1-9]|1[0-2])[-_.]?(0[1-9]|[12]\d|3[01])/);
  return m ? `${m[1]}-${m[2]}-${m[3]}` : null;
}

function stemOf(name: string): string {
  const dot = name.lastIndexOf('.');
  return dot > 0 ? name.slice(0, dot) : name;
}

/** Remove copy markers and messy separators: "Report_final (1) - Copy" -> "Report final" */
export function tidyStem(stem: string): string {
  let s = stem
    .replace(/^copy of\s+/i, '')
    .replace(/(\s*-\s*copy(\s*\(\d+\))?)+$/i, '')
    .replace(/(\s*\(\d+\))+$/, '')
    .replace(/[_\s]+copy$/i, '')
    .replace(/[_]+/g, ' ')
    .replace(/\s*\.\s*/g, ' ')
    .replace(/\s+-\s+|\s*--+\s*/g, ' - ')
    .replace(/\s+/g, ' ')
    .trim();
  if (!s) s = stem.trim();
  return s;
}

export function isCryptic(name: string): boolean {
  return CRYPTIC.test(stemOf(name).trim());
}

// ---------- The 5 questions ----------

export const OFFLINE_QUESTIONS: ClarifyingQuestion[] = [
  {
    id: 'q1',
    question: 'How should we group your files?',
    whyItMatters: 'This decides the main folders you will see.',
    suggestedOptions: ['By kind (Documents, Photos, Videos...)', 'By year', 'By kind, then by year'],
  },
  {
    id: 'q2',
    question: 'Should we tidy up messy file names?',
    whyItMatters: 'Names like "IMG_4021 (1).jpg" become "Photo 2024-03-12.jpg".',
    suggestedOptions: ['Yes, tidy them up', 'No, keep names as they are'],
  },
  {
    id: 'q3',
    question: 'Add the date to the front of file names?',
    whyItMatters: 'Dates at the front keep files in time order when sorted by name.',
    suggestedOptions: ['No dates', 'Yes, like "2024-03-12 - Name"'],
  },
  {
    id: 'q4',
    question: 'What should we do with files not changed in over a year?',
    whyItMatters: 'Moving old files aside makes the files you use every day easier to find.',
    suggestedOptions: ['Put them in an "Old Files" folder', 'Leave them with the rest'],
  },
  {
    id: 'q5',
    question: 'Where should installers and setup files go?',
    whyItMatters: 'Installers are often only needed once and pile up in Downloads.',
    suggestedOptions: ['Their own "Installers" folder', 'Treat them like other files'],
  },
];

export interface OfflineChoices {
  groupBy: 'kind' | 'year' | 'kindThenYear';
  tidyNames: boolean;
  datePrefix: boolean;
  oldFilesAside: boolean;
  installersAside: boolean;
}

export const DEFAULT_CHOICES: OfflineChoices = {
  groupBy: 'kind',
  tidyNames: true,
  datePrefix: false,
  oldFilesAside: true,
  installersAside: true,
};

const says = (a: string | undefined, re: RegExp) => !!a && re.test(a.toLowerCase());
const saysNo = (a: string | undefined) => says(a, /^\s*(no|don'?t|do not|keep|leave|never|nope|treat)/);

/** Read the 5 answers (in question order). Works with typed answers too, not just the buttons. */
export function choicesFromAnswers(answers: Array<string | undefined>): OfflineChoices {
  const [a1, a2, a3, a4, a5] = answers;
  let groupBy: OfflineChoices['groupBy'] = 'kind';
  if (says(a1, /year|date/)) groupBy = says(a1, /kind|type/) ? 'kindThenYear' : 'year';
  return {
    groupBy,
    tidyNames: a2 ? !saysNo(a2) : DEFAULT_CHOICES.tidyNames,
    datePrefix: a3 ? !saysNo(a3) : DEFAULT_CHOICES.datePrefix,
    oldFilesAside: a4 ? !saysNo(a4) : DEFAULT_CHOICES.oldFilesAside,
    installersAside: a5 ? !saysNo(a5) : DEFAULT_CHOICES.installersAside,
  };
}

// ---------- Assessment ----------

export function offlineAssessment(files: ScannedFileMeta[]): FileAssessmentResponse {
  const counts = new Map<string, number>();
  for (const f of files) {
    const k = kindOf(f).folder;
    counts.set(k, (counts.get(k) ?? 0) + 1);
  }
  const sorted = [...counts.entries()].sort((a, b) => b[1] - a[1]);
  const cryptic = files.filter((f) => isCryptic(f.name)).length;
  const copies = files.filter((f) => /(\(\d+\)|copy)/i.test(stemOf(f.name))).length;
  const old = files.filter((f) => f.isOld).length;
  const exact = files.filter((f) => f.duplicateOfPath).length;

  const n = (count: number, one: string, many: string) => `${count} ${count === 1 ? one : many}`;
  const patterns: string[] = [];
  if (sorted[0]) patterns.push(`Most of your files are ${sorted[0][0].toLowerCase()} (${sorted[0][1]}).`);
  if (cryptic) patterns.push(cryptic === 1 ? "1 file has a name that doesn't say what it is." : `${cryptic} files have names that don't say what they are.`);
  if (copies) patterns.push(`${n(copies, 'file looks like an extra download', 'files look like extra downloads')}, with "(1)" or "Copy" in the name.`);
  if (exact) patterns.push(`${n(exact, 'file is an exact copy', 'files are exact copies')} of another file.`);
  if (old) patterns.push(`${n(old, "file hasn't", "files haven't")} been changed in over a year.`);

  return {
    overviewSummary: `We looked at ${files.length} files and found ${sorted.length} kinds of files. Answer 5 quick questions and we'll sort them for you, right here on your device.`,
    detectedPatterns: patterns,
    proposedCategories: sorted.map(([name, n]) => ({
      name,
      description: `${n} ${n === 1 ? 'file' : 'files'}`,
      estimatedCount: n,
    })),
    questions: OFFLINE_QUESTIONS,
  };
}

// ---------- Plan ----------

export function offlinePlan(files: ScannedFileMeta[], choices: OfflineChoices = DEFAULT_CHOICES): FileOrganizationPlanResponse {
  const operations: FileOrganizationPlanResponse['operations'] = [];
  const folders = new Map<string, number>();

  for (const f of files) {
    const kind = kindOf(f);
    const date = f.lastModified.slice(0, 10);
    const year = /^\d{4}/.test(date) ? date.slice(0, 4) : 'Unknown Year';

    // Folder
    let folder: string;
    let reason: string;
    if (choices.installersAside && kind.folder === 'Installers') {
      folder = 'Installers';
      reason = 'Setup file, kept in one place';
    } else if (choices.oldFilesAside && f.isOld) {
      folder = `Old Files/${choices.groupBy === 'year' ? year : kind.folder}`;
      reason = 'Not changed in over a year';
    } else if (choices.groupBy === 'year') {
      folder = year;
      reason = `Last changed in ${year}`;
    } else if (choices.groupBy === 'kindThenYear') {
      folder = `${kind.folder}/${year}`;
      reason = `${kind.label} from ${year}`;
    } else {
      folder = kind.folder;
      reason = `Grouped with other ${kind.folder.toLowerCase()}`;
    }

    // Name
    const originalStem = stemOf(f.name);
    let stem = originalStem;
    let renameNote = '';
    if (choices.tidyNames) {
      if (isCryptic(f.name)) {
        stem = `${kind.label} ${dateInName(originalStem) ?? date}`;
        renameNote = 'unclear name replaced with type and date';
      } else {
        const tidy = tidyStem(originalStem);
        if (tidy !== originalStem) {
          stem = tidy;
          renameNote = 'messy name tidied';
        }
      }
    }
    if (choices.datePrefix && !/^\d{4}-\d{2}-\d{2}/.test(stem) && !stem.endsWith(date)) {
      stem = `${date} - ${stem}`;
      renameNote = renameNote ? `${renameNote}, date added` : 'date added';
    }
    const newFileName = cleanFileName(stem + f.name.slice(originalStem.length), f.name);

    folders.set(folder, (folders.get(folder) ?? 0) + 1);
    operations.push({
      fileId: f.id,
      originalPath: f.relativePath || f.name,
      targetFolder: folder,
      newFileName,
      reason: renameNote ? `${reason}; ${renameNote}` : reason,
      wasRenamed: newFileName !== f.name,
    });
  }

  return {
    planSummary: `Sorted ${files.length} files into ${folders.size} folders using built-in rules on your device. Nothing was sent over the internet.`,
    categoriesCreated: [...folders.entries()].map(([folderPath, n]) => ({
      folderPath,
      description: `${n} ${n === 1 ? 'file' : 'files'}`,
    })),
    operations,
  };
}
