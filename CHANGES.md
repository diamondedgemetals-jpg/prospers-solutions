# Offline Mode (Nov 25, 2026)

- **Works without internet:** if the server can't be reached (no internet, server asleep, AI busy), the File Organizer switches to built-in rules on the device. It shows a clear note: "Working offline... names will be simpler."
- **Private Mode switch:** users can choose to keep everything on their device. It's remembered for next time.
- **The 5 offline questions:** how to group (by kind / by year / both), tidy names, dates in front, old files aside, installers aside. Typed answers work too.
- **Name tidying:** `IMG_20240312_101500.jpg` becomes `Photo 2024-03-12.jpg`, and `Report_final (1).docx` becomes `Report final.docx`. Clear names are left alone.
- **The website opens without internet** after the first visit, because the app's files are saved on the device. Server answers are never saved.
- **Fixed:** the page title said "Agent Parameter Studio" (left over from a template). It now says Prospers Solutions, with a proper description and icon.
- **Tested in a real browser:** with the internet cut off, the app opened, scanned a folder, asked the 5 questions, and sorted 6 test files correctly, including an exact copy and an old file.

---

# Fix (Nov 25, 2026): "Unexpected token '<' ... is not valid JSON"

**Cause:** the app was opened somewhere with no Prospers server behind it (phone app wrapper or a plain web host). Questions went to a short address like `/api/research/plan`, and the app's own home page came back instead of an answer.

**Fixed:**
- Every call to the server now goes through one helper (`src/lib/api.ts`), which can point at your real server via `VITE_API_BASE`.
- Instead of computer errors, users now see plain-English messages ("The Prospers server didn't answer... try again in 30 seconds").
- The server now accepts calls from the phone app (and any sites you list in `ALLOWED_ORIGINS`) and refuses them from other websites.
- Unknown server addresses now return a clear message instead of the home page.

**To use from the phone app or another host:** build with
`VITE_API_BASE=https://<your-render-address> npm run build`, then copy the `dist` folder into the wrapper.

**Tested:** the phone-style pre-check and real calls work; other websites are refused; an HTML reply now shows the friendly message; typecheck, build and the earlier safety tests all pass.

---

# What changed (Nov 20, 2026)

## Safety (no more lost files)
- "Organize Inside My Folder" now puts everything in ONE new folder: `_Organized_by_Prospers_<date>_<time>`.
- It never replaces an existing file. If a name is taken, it adds (2), (3)...
- Each copy is checked before an original is removed, and removing originals is OFF by default.
- New **Undo Everything** button on the finished screen.
- Undo files for Windows (.ps1) and Mac (.sh) are saved in `<new folder>/_Undo`, so undo still works after the tab is closed.
- New **Get Organize & Undo Files** button lets Safari and Firefox users organize their real folder with one double-click, with a matching undo.
- The ZIP download is now the main button, because it works in every browser.

## New features from the plan
- **Exact copy finder:** byte-for-byte duplicates go to "Review Duplicates". Nothing is deleted. Only files of the same size get checked, so it stays fast.
- **Old file flag:** files not changed in 12+ months are labelled in the review table.
- **Folder Health snapshot:** shows exact copies (and the space they waste), old files, and unclear names right after scanning.
- **Filing Styles:** 3 ready-made styles, and "Save these answers for next time". These are stored in the user's browser, so no sign-up is needed.
- **Big folders:** up to 2,000 files and 8 folders deep (was 400 and 4), with a clear message when a folder is bigger.

## Server and hosting
- Fixed: `npm install` failed on a version clash (esbuild), so Render could not build.
- Fixed: the start command could not run on Render's Node version (`node server.ts` → `tsx server.ts`).
- Added a per-visitor limit (30 AI requests per 10 minutes, change it with `AI_REQUESTS_PER_10_MIN`) so nobody can drain your Gemini key.
- Large folders are planned 100 files at a time, 3 at once. If the AI is busy for one batch, that batch is grouped by file type instead of the whole run failing.
- The privacy note now says plainly what is sent: file names, dates, and the first line of plain-text files.

## Tested
- Typecheck and production build pass.
- A clean install, build and start the way Render does it all work.
- Mac/Linux organize and undo scripts were run for real on awkward names (quotes, accents, brackets, `$`). Nothing was overwritten, and every file came back.
- Windows (.ps1) scripts were **not** run here. Test once on a Windows PC with a throwaway folder before launch.
- Removed the old `bun.lock`, because its versions no longer matched. `package-lock.json` is now included.
