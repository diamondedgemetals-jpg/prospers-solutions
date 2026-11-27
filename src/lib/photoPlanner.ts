// "Sort My Photos": the one-tap photo plan. Runs on the device, no internet needed.
//
//   Photos/2024/03 - March/2024-03-12 14.32 Photo.jpg
//   Videos/2024/07 - July/...
//   Screenshots/2024/03 - March/...
//   Review Duplicates/   exact copies (byte-for-byte)
//   Review Similar/      edited, resized, re-sent copies and burst shots (best one kept in place)
//   Other Files/         anything that isn't a photo or video
//
// Names start with the date, so sorting by name = sorting by when the photo was taken.

import type { FileOrganizationPlanResponse, ScannedFileMeta } from '../types/files';
import { cleanFileName } from './organizerSafety';
import { isCryptic, kindOf, tidyStem } from './offlinePlanner';

export const DUPLICATES_FOLDER = 'Review Duplicates';
export const SIMILAR_FOLDER = 'Review Similar';

const MONTHS = [
  'January', 'February', 'March', 'April', 'May', 'June',
  'July', 'August', 'September', 'October', 'November', 'December',
];

/** "03 - March": the number keeps months in order, the word makes it easy to read */
export function monthFolder(month: number): string {
  return `${String(month).padStart(2, '0')} - ${MONTHS[month - 1]}`;
}

export function readableDate(stamp: string): string {
  const [y, m, d] = stamp.slice(0, 10).split('-').map(Number);
  return y && m && d ? `${MONTHS[m - 1]} ${d}, ${y}` : stamp;
}

function parts(stamp: string | undefined) {
  const m = (stamp ?? '').match(/^(\d{4})-(\d{2})-(\d{2})(?:T(\d{2}):(\d{2}))?/);
  if (!m) return null;
  return { y: m[1], mo: Number(m[2]), date: `${m[1]}-${m[2]}-${m[3]}`, time: m[4] ? `${m[4]}.${m[5]}` : '' };
}

function stemOf(name: string): string {
  const dot = name.lastIndexOf('.');
  return dot > 0 ? name.slice(0, dot) : name;
}

function photoName(f: ScannedFileMeta, label: string): string {
  const p = parts(f.takenDate);
  const originalStem = stemOf(f.name);
  const ext = f.name.slice(originalStem.length);
  if (!p) return f.name;
  let stem: string;
  if (isCryptic(f.name)) {
    // "IMG_4021" says nothing: use date + time + kind, e.g. "2024-03-12 14.32 Photo"
    stem = [p.date, p.time, label].filter(Boolean).join(' ');
  } else {
    const tidy = tidyStem(originalStem);
    stem = tidy.startsWith(p.date) ? tidy : `${p.date} - ${tidy}`;
  }
  return cleanFileName(stem + ext, f.name);
}

function dateReason(f: ScannedFileMeta): string {
  if (!f.takenDate) return 'No date found';
  const when = readableDate(f.takenDate);
  if (f.dateSource === 'camera') return `Taken ${when}`;
  if (f.dateSource === 'name') return `Taken ${when} (date from the file name)`;
  return `Dated ${when} (last changed; no photo date found)`;
}

export function photoPlan(files: ScannedFileMeta[]): FileOrganizationPlanResponse {
  const operations: FileOrganizationPlanResponse['operations'] = [];
  const counts = { photos: 0, videos: 0, screenshots: 0, exact: 0, similar: 0, other: 0, noDate: 0 };
  const months = new Set<string>();

  for (const f of files) {
    const kind = kindOf(f);
    const isMedia = ['Photos', 'Videos', 'Screenshots', 'Scans'].includes(kind.folder);
    const p = parts(f.takenDate);
    let folder: string;
    let reason: string;

    if (f.duplicateOfPath) {
      folder = DUPLICATES_FOLDER;
      reason = `Exact copy of ${f.duplicateOfPath}`;
      counts.exact++;
    } else if (f.similarToPath) {
      folder = SIMILAR_FOLDER;
      reason = `Looks like ${f.similarToPath}, which was kept as the best copy`;
      counts.similar++;
    } else if (!isMedia) {
      folder = 'Other Files';
      reason = 'Not a photo or video';
      counts.other++;
    } else if (!p) {
      folder = `${kind.folder}/Date Unknown`;
      reason = 'No date found';
      counts.noDate++;
    } else {
      folder = `${kind.folder}/${p.y}/${monthFolder(p.mo)}`;
      reason = dateReason(f);
      months.add(`${p.y}-${p.mo}`);
      if (kind.folder === 'Videos') counts.videos++;
      else if (kind.folder === 'Screenshots') counts.screenshots++;
      else counts.photos++;
    }

    const newFileName = isMedia ? photoName(f, kind.label) : f.name;
    operations.push({
      fileId: f.id,
      originalPath: f.relativePath || f.name,
      targetFolder: folder,
      newFileName,
      reason,
      wasRenamed: newFileName !== f.name,
    });
  }

  const bits = [
    `Sorted ${counts.photos + counts.videos + counts.screenshots + counts.noDate} photos and videos into ${months.size} ${months.size === 1 ? 'month' : 'months'}, by the date they were taken.`,
  ];
  if (counts.exact) bits.push(`${counts.exact} exact ${counts.exact === 1 ? 'copy was' : 'copies were'} set aside in "${DUPLICATES_FOLDER}".`);
  if (counts.similar) bits.push(`${counts.similar} look-alike ${counts.similar === 1 ? 'photo was' : 'photos were'} set aside in "${SIMILAR_FOLDER}" (the best copy stays in its month).`);
  if (counts.noDate) bits.push(`${counts.noDate} had no date and went to "Date Unknown".`);
  bits.push('Nothing was deleted, and your photos never left this device.');

  return {
    planSummary: bits.join(' '),
    categoriesCreated: [],
    operations,
  };
}
