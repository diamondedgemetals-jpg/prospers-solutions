import assert from 'node:assert/strict';
import fs from 'node:fs';
import { bestDate, dateTimeInName, fingerprintDistance, fingerprintFromGray, groupSimilar, readCameraDate } from '../src/lib/photoTools.ts';
import { monthFolder, photoPlan } from '../src/lib/photoPlanner.ts';
import { choicesFromAnswers, offlinePlan } from '../src/lib/offlinePlanner.ts';

// --- dates from names ---
assert.equal(dateTimeInName('IMG_20240312_143205.jpg'), '2024-03-12T14:32:05');
assert.equal(dateTimeInName('PXL_20240312_143205123.jpg'), '2024-03-12T14:32:05');
assert.equal(dateTimeInName('Screenshot 2024-03-12 at 14.32.05.png'), '2024-03-12T14:32:05');
assert.equal(dateTimeInName('IMG-20080315-WA0007.jpg'), '2008-03-15');
assert.equal(dateTimeInName('IMG_4021.jpg'), null);
assert.equal(dateTimeInName('Invoice 1234-99.pdf'), null);

// --- best date: camera > name > last changed ---
assert.deepEqual(bestDate('IMG_20240101_000000.jpg', '2026-01-01T00:00:00Z', '2023-07-04T18:22:10'), { taken: '2023-07-04T18:22:10', source: 'camera' });
assert.equal(bestDate('IMG_20240101_101010.jpg', '2026-01-01T00:00:00Z', null).source, 'name');
assert.equal(bestDate('IMG_4021.jpg', '2026-01-01T12:00:00Z', null).source, 'changed');

// --- camera date from a real photo file (if the sample set is present) ---
const sample = '/tmp/photos-src/exif-samples/jpg/Canon_40D.jpg';
if (fs.existsSync(sample)) assert.equal(await readCameraDate(new Blob([fs.readFileSync(sample)]), 'jpg'), '2008-05-30T15:56:01');

// --- fingerprints ---
const W = 32, H = 32;
const img = (f: (x: number, y: number) => number) => Array.from({ length: W * H }, (_, i) => f(i % W, Math.floor(i / W)));
const scene = img((x, y) => 128 + 60 * Math.sin(x / 4) + 40 * Math.cos(y / 5));
const brighter = scene.map((v) => Math.min(255, v * 1.15 + 10));
const other = img((x, y) => 128 + 60 * Math.cos(x / 3 + y / 7) - 30 * Math.sin(y / 2));
const a = fingerprintFromGray(scene, W, H)!, b = fingerprintFromGray(brighter, W, H)!, c = fingerprintFromGray(other, W, H)!;
assert.ok(fingerprintDistance(a, b) <= 2, 'brightened copy should match');
assert.ok(fingerprintDistance(a, c) > 12, 'different picture should not match');
assert.equal(fingerprintFromGray(img(() => 200), W, H), null, 'blank picture gets no fingerprint');

// keeper: camera original beats a bigger converted PNG
const keep = groupSimilar([
  { id: 'png', fingerprint: a, sizeBytes: 9_000_000, taken: '2024-01-01' },
  { id: 'orig', fingerprint: b, sizeBytes: 3_000_000, taken: '2024-01-01', hasCameraDate: true },
  { id: 'far', fingerprint: c, sizeBytes: 1, taken: '2024-01-01' },
]);
assert.deepEqual([...keep.entries()], [['png', 'orig']]);

// --- photo plan ---
const m = (id: string, name: string, extra: Record<string, unknown> = {}) => {
  const dot = name.lastIndexOf('.');
  return { id, name, relativePath: name, extension: name.slice(dot + 1).toLowerCase(), sizeBytes: 10, lastModified: '2026-11-26T10:00:00Z', ...extra };
};
const plan = photoPlan([
  m('1', 'IMG_4021.jpg', { takenDate: '2023-07-04T18:22:10', dateSource: 'camera' }),
  m('2', 'Beach Party.jpg', { takenDate: '2023-07-04T19:00:00', dateSource: 'camera' }),
  m('3', 'IMG_4021 (1).jpg', { takenDate: '2023-07-04T18:22:10', dateSource: 'camera', duplicateOfPath: 'IMG_4021.jpg' }),
  m('4', 'IMG-20230704-WA0001.jpg', { takenDate: '2023-07-04', dateSource: 'name', similarToPath: 'IMG_4021.jpg' }),
  m('5', 'VID_20230801_120000.mp4', { takenDate: '2023-08-01T12:00:00', dateSource: 'name' }),
  m('6', 'Screenshot_20240312-101500.png', { takenDate: '2024-03-12T10:15:00', dateSource: 'name' }),
  m('7', 'notes.txt'),
  m('8', 'mystery.jpg'),
] as any);
const op = Object.fromEntries(plan.operations.map((o) => [o.fileId, o]));
assert.equal(op['1'].targetFolder, 'Photos/2023/07 - July');
assert.equal(op['1'].newFileName, '2023-07-04 18.22 Photo.jpg');
assert.equal(op['1'].reason, 'Taken July 4, 2023');
assert.equal(op['2'].newFileName, '2023-07-04 - Beach Party.jpg');
assert.equal(op['3'].targetFolder, 'Review Duplicates');
assert.equal(op['4'].targetFolder, 'Review Similar');
assert.equal(op['5'].targetFolder, 'Videos/2023/08 - August');
assert.equal(op['6'].targetFolder, 'Screenshots/2024/03 - March');
assert.equal(op['7'].targetFolder, 'Other Files'); assert.equal(op['7'].newFileName, 'notes.txt');
assert.equal(op['8'].targetFolder, 'Photos/Date Unknown');
assert.match(plan.planSummary, /1 exact copy was set aside/);
assert.match(plan.planSummary, /Nothing was deleted/);
assert.equal(monthFolder(12), '12 - December');

// --- offline questions: year and month ---
assert.equal(choicesFromAnswers(['By kind, then by year and month']).groupBy, 'kindYearMonth');
const off = offlinePlan([m('a', 'IMG_4021.jpg', { takenDate: '2023-07-04T18:22:10' })] as any, { ...choicesFromAnswers(['month']), oldFilesAside: false });
assert.equal(off.operations[0].targetFolder, 'Photos/2023/07 - July');
console.log('PHOTO TESTS PASSED');
// WhatsApp names count as unclear and get tidied
import { isCryptic } from '../src/lib/offlinePlanner.ts';
assert.ok(isCryptic('IMG-20080315-WA0007.jpg'));
assert.ok(isCryptic('VID-20240101-WA0003.mp4'));
assert.ok(!isCryptic('Beach Party.jpg'));
console.log('WHATSAPP NAME TESTS PASSED');
