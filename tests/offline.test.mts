import assert from 'node:assert/strict';
import { choicesFromAnswers, dateInName, isCryptic, kindOf, offlineAssessment, offlinePlan, tidyStem, OFFLINE_QUESTIONS } from '../src/lib/offlinePlanner.ts';

const f = (id: string, name: string, lastModified = '2024-03-12T10:00:00Z', extra = {}) => {
  const dot = name.lastIndexOf('.');
  return { id, name, relativePath: name, extension: dot > 0 ? name.slice(dot + 1).toLowerCase() : '', sizeBytes: 10, lastModified, ...extra };
};

// kinds
assert.equal(kindOf(f('1', 'Screenshot 2024-03-12 at 9.41.22 AM.png')).folder, 'Screenshots');
assert.equal(kindOf(f('1', 'Scan_003.pdf')).folder, 'Scans');
assert.equal(kindOf(f('1', 'setup.EXE')).folder, 'Installers');
assert.equal(kindOf(f('1', 'weird.xyz')).folder, 'Other Files');
assert.equal(kindOf(f('1', 'noext')).folder, 'Other Files');

// names
for (const n of ['IMG_4021.jpg', 'IMG_20240312_101500.jpg', 'PXL_20240312_101500123.jpg', 'DSC_0012.JPG', 'Scan_003.pdf', 'Untitled.txt', 'Document (1).pdf', 'Screenshot_2024-03-12-09-41-22.png', 'WhatsApp Image 2024-03-12 at 10.15.00.jpeg', 'image.png', 'Screenshot 2024-03-12 at 9.41.22 AM.png'])
  assert.ok(isCryptic(n), `should be unclear: ${n}`);
for (const n of ['Hydro Bill March.pdf', 'Resume Paul.docx', 'Invoice 2024-03.pdf', 'Tax Return 2023.pdf'])
  assert.ok(!isCryptic(n), `should be clear: ${n}`);
assert.equal(dateInName('IMG_20240312_101500'), '2024-03-12');
assert.equal(dateInName('IMG_4021'), null);
assert.equal(tidyStem('Report_final (1)'), 'Report final');
assert.equal(tidyStem('Copy of Budget - Copy (2)'), 'Budget');
assert.equal(tidyStem('Invoice (3)'), 'Invoice');
assert.equal(tidyStem('Clean Name'), 'Clean Name');

// answers: buttons and typed words
assert.deepEqual(choicesFromAnswers(OFFLINE_QUESTIONS.map((q) => q.suggestedOptions[0])), { groupBy: 'kind', tidyNames: true, datePrefix: false, oldFilesAside: true, installersAside: true });
assert.deepEqual(choicesFromAnswers(OFFLINE_QUESTIONS.map((q) => q.suggestedOptions.at(-1))), { groupBy: 'kindYearMonth', tidyNames: false, datePrefix: true, oldFilesAside: false, installersAside: false });
assert.equal(choicesFromAnswers(['by year please']).groupBy, 'year');
assert.equal(choicesFromAnswers([undefined, "don't rename anything"]).tidyNames, false);

// plan
const files = [
  f('a', 'IMG_20240312_101500.JPG'),
  f('b', 'IMG_4021 (1).jpg', '2025-06-01T00:00:00Z'),
  f('c', 'Report_final (1).docx'),
  f('d', 'ZoomInstaller.exe'),
  f('e', 'Old Taxes.pdf', '2019-01-01T00:00:00Z', { isOld: true }),
  f('g', 'Hydro Bill March.pdf'),
];
const plan = offlinePlan(files);
const byId = Object.fromEntries(plan.operations.map((o) => [o.fileId, o]));
assert.equal(byId.a.targetFolder, 'Photos'); assert.equal(byId.a.newFileName, 'Photo 2024-03-12.JPG');
assert.equal(byId.b.newFileName, 'Photo 2025-06-01.jpg');
assert.equal(byId.c.newFileName, 'Report final.docx'); assert.equal(byId.c.targetFolder, 'Documents');
assert.equal(byId.d.targetFolder, 'Installers');
assert.equal(byId.e.targetFolder, 'Old Files/Documents');
assert.equal(byId.g.newFileName, 'Hydro Bill March.pdf'); assert.equal(byId.g.wasRenamed, false);
assert.equal(plan.operations.length, files.length);

const p2 = offlinePlan(files, { groupBy: 'kindThenYear', tidyNames: false, datePrefix: true, oldFilesAside: false, installersAside: false });
const b2 = Object.fromEntries(p2.operations.map((o) => [o.fileId, o]));
assert.equal(b2.g.newFileName, '2024-03-12 - Hydro Bill March.pdf');
assert.equal(b2.g.targetFolder, 'Documents/2024');
assert.equal(b2.d.targetFolder, 'Installers/2024');
assert.equal(b2.e.targetFolder, 'Documents/2019');

const a = offlineAssessment(files as any);
assert.equal(a.questions.length, 5);
assert.ok(a.detectedPatterns.some((p) => /(doesn't say what it is|don't say what they are)/.test(p)));
console.log('OFFLINE TESTS PASSED');
