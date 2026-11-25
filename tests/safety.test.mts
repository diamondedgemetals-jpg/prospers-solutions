import assert from 'node:assert/strict';
import { execSync } from 'node:child_process';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import {
  buildScripts, cleanFileName, cleanFolderPath, findExactDuplicates, isOldFile,
  makeDestinationsUnique, runFolderName, ORGANIZED_FOLDER_PREFIX,
} from '../src/lib/organizerSafety.ts';

// names & folders
assert.equal(cleanFileName('Beach Trip', 'IMG_1.JPG'), 'Beach Trip.JPG');
assert.ok(cleanFileName('Invoice.pdf.exe', 'scan.pdf').endsWith('.pdf'));
assert.equal(cleanFileName('a/b:c', 'x.txt'), 'a-b-c.txt');
assert.equal(cleanFileName('', 'keep.txt'), 'keep.txt');
assert.equal(cleanFileName('CON', 'x.txt'), '_CON.txt');
assert.equal(cleanFolderPath('../../etc/Photos'), 'etc/Photos');
assert.equal(cleanFolderPath('  '), 'Uncategorized');

// collisions, case-insensitive
const u = makeDestinationsUnique([
  { targetFolder: 'Photos', newFileName: 'Beach.jpg' },
  { targetFolder: 'photos', newFileName: 'beach.JPG' },
  { targetFolder: 'Photos', newFileName: 'Beach.jpg' },
]);
assert.deepEqual(u.map((o) => o.newFileName), ['Beach.jpg', 'beach (2).JPG', 'Beach (3).jpg']);

// old files
assert.equal(isOldFile('2020-01-01T00:00:00Z', new Date('2026-11-20')), true);
assert.equal(isOldFile('2026-10-01T00:00:00Z', new Date('2026-11-20')), false);

// duplicates: only same-size files hashed, oldest kept
const hashed: string[] = [];
const content: Record<string, string> = { a: 'X', b: 'X', c: 'Y', d: 'Z' };
const dup = await findExactDuplicates(
  [
    { id: 'a', sizeBytes: 5, lastModified: '2024-01-01', pathInRoot: 'new/a' },
    { id: 'b', sizeBytes: 5, lastModified: '2020-01-01', pathInRoot: 'old/b' },
    { id: 'c', sizeBytes: 5, lastModified: '2021-01-01', pathInRoot: 'c' },
    { id: 'd', sizeBytes: 9, lastModified: '2021-01-01', pathInRoot: 'd' },
  ],
  async (id) => { hashed.push(id); return content[id]; }
);
assert.deepEqual([...dup.entries()], [['a', 'b']]);
assert.ok(!hashed.includes('d'), 'unique-size file should not be hashed');

assert.match(runFolderName(new Date(2026, 10, 20, 9, 7)), /^_Organized_by_Prospers_2026-11-20_0907$/);

// Real run of the Mac/Linux scripts on awkward names
const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'org-'));
const awkward = ["it's a test.txt", 'café résumé.pdf', 'brackets [1] $HOME `x`.txt', 'sub dir/IMG_4021.jpg', 'blocked.txt'];
for (const f of awkward) {
  fs.mkdirSync(path.join(dir, path.dirname(f)), { recursive: true });
  fs.writeFileSync(path.join(dir, f), 'data:' + f);
}
const run = runFolderName();
const moves = awkward.map((f, i) => ({ from: f, to: `${run}/Folder ${i % 2}/${path.basename(f)}` }));
moves.push({ from: 'missing.txt', to: `${run}/x/missing.txt` });
// pre-place something where "blocked.txt" would go: must NOT be overwritten
fs.mkdirSync(path.join(dir, run, 'Folder 0'), { recursive: true });
fs.writeFileSync(path.join(dir, run, 'Folder 0', 'blocked.txt'), 'DO NOT OVERWRITE');

const s = buildScripts(moves);
fs.writeFileSync(path.join(dir, 'Organize-My-Files.sh'), s.organizeMac);
const out1 = execSync('sh Organize-My-Files.sh', { cwd: dir }).toString();
assert.match(out1, /Moved: 4\s+Skipped: 2/, out1);
assert.equal(fs.readFileSync(path.join(dir, run, 'Folder 0', 'blocked.txt'), 'utf8'), 'DO NOT OVERWRITE');
assert.ok(fs.existsSync(path.join(dir, 'blocked.txt')), 'blocked original left in place');
assert.ok(fs.existsSync(path.join(dir, run, 'Folder 0', 'brackets [1] $HOME `x`.txt')));

// Undo, run from INSIDE the organized folder's _Undo subfolder? Script supports living in the run folder.
// exactly where the app saves it: <run folder>/_Undo/Undo-Organize.sh
fs.mkdirSync(path.join(dir, run, '_Undo'), { recursive: true });
fs.writeFileSync(path.join(dir, run, '_Undo', 'Undo-Organize.sh'), s.undoMac);
const out2 = execSync(`sh "${path.join(dir, run, '_Undo', 'Undo-Organize.sh')}"`, { cwd: '/' }).toString();
assert.match(out2, /Moved: 4/, out2);
for (const f of awkward) assert.equal(fs.readFileSync(path.join(dir, f), 'utf8'), 'data:' + f, f);
console.log('ALL SAFETY TESTS PASSED');
