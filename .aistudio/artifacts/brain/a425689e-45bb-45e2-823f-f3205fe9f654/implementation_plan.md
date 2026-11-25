# Prospers Solutions: Personal Computer & File Organizer

Prospers Solutions is being refocused around an effortless, drop-in-browser **Personal Computer & File Organizer** designed for non-technical clients. Users select any messy folder from their computer, get an instant plain-English assessment powered by three specialized organizer skills, answer **5 tailored clarifying questions**, grant explicit permission, and safely reorganize and rename their files with full undo protection—while keeping **Deep Web Research** one click away.

---

## User Review & Critical Decisions

> [!IMPORTANT]
> **What "Personal Organizer Profiles" Means (Plain-English Summary)**
> Think of an **Organizer Profile** as a saved **"Filing Style" preset** for your computer—like *"Work Laptop"*, *"Home Downloads"*, or *"Tax Season"*.
> - The first time you organize a folder, you answer the 5 quick questions (how you like folders grouped, whether you want dates on filenames, what to do with duplicates, etc.).
> - You can then click **"Save Filing Style"** right in your browser (no login or account needed).
> - Next month, when your Downloads or Desktop gets cluttered again, you pick your saved Filing Style in one click so your preferred rules are already pre-filled—while still letting you review or adjust any answer before agreeing.
>
> **Recommended Default**: Include optional **local browser Filing Styles** (zero sign-in, 100% private on the user's device, plus 3 ready-made starter styles like *Downloads Rescue*, *Clean Work Folder*, and *Deep Declutter*). Let us know if you'd like to keep this or adjust anything before proceeding.

### Confirmed Decisions from Your Answers
- **Default Home Screen**: **Personal Computer & File Organizer** opens first when clients visit the app (Deep Web Research stays one click away in the top bar and workspace switcher).
- **Selected Organizer Skills**:
  1. **Messy Downloads & Desktop Cleanup** — Recognizes installers, browser duplicates like `file (1).pdf`, screenshots, loose scans, and temporary exports.
  2. **Duplicate File & Old Archive Detection** — Fingerprints files locally in the browser to flag exact duplicates, near-duplicate drafts, and untouched files older than 12 months without ever deleting anything automatically.
  3. **Peek Inside Documents to Name Untitled Files** — Safely inspects readable text excerpts and compact image previews of cryptic files (`IMG_4021.jpg`, `Scan_003.pdf`, `Untitled.txt`) so the organizer gives them clear, meaningful names instead of guessing.
- **Safety & Apply Suite**: **Direct Folder Organize + Undo/Restore & Apply Scripts + Organized ZIP Download** so clients can apply changes directly on disk, run a 1-click Windows/Mac script, download a clean ZIP, and always undo every move or rename.

---

## 1. Overview & Core Concept

- **What It Does**: Turns any cluttered PC folder (Downloads, Desktop, Documents, or a mixed project folder) into cleanly grouped category folders with consistent, human-readable filenames through a calm, guided 3-step workflow: **Scan & Assess → Answer 5 Questions & Agree → Review & Safely Apply**.
- **Target Audience**: Non-technical personal computer users, small business owners, and solo professionals who want a "drop in browser and go" organizer without learning complex folder rules, command lines, or technical jargon.
- **Key Value**:
  - **Zero Assumptions**: Never moves or renames anything until the client sees the initial assessment, answers 5 tailored questions, and checks the explicit agreement box.
  - **Real Content Intelligence**: Actually spots exact duplicates, identifies stale archive candidates, and peeks inside untitled text/PDF/image files to propose accurate names.
  - **Total Peace of Mind**: Every organization run includes an editable Before/After review table, a non-destructive default mode, a downloadable **Undo / Restore Script**, and an organized `.zip` backup.
  - **Complete Suite**: Keeps the **Deep Web Research** workspace intact with the exact requested plain-English guidance (*"Type Your Question or Goal — No special formatting or technical prompts needed. Choose Instant Report for one-click results, or Review Steps First if you want to approve the sub-questions before we search."*) and live sub-question verification progress.

---

## 2. User Experience & Visual Design

### Key User Flows
1. **Landing & Skill Selection (Zero-State)**:
   - Opens directly on the **Personal Computer & File Organizer** workspace.
   - Displays a clean command input, toggleable **Organizer Skills** (*Downloads & Desktop Cleanup*, *Duplicate & Old Archive Detection*, *Peek Inside Untitled Files*), an optional **Saved Filing Style** selector (with ready-made presets + user-saved styles), and a generous File Explorer dropzone (`Select Folder from Device` or `Select Multiple Files`).
2. **Instant Local Pre-Scan & Health Snapshot**:
   - As soon as a folder is selected, the browser scans files locally and displays an immediate, tabular summary: total files, total size, **exact duplicates detected**, **old files (>12 months)**, and **cryptic/untitled files ready for content peeking**—before calling the AI.
3. **Step 1 — First Assessment & 5 Tailored Questions**:
   - Click **Run First Assessment**. The agent evaluates the folder using the enabled skills, summarizes clutter patterns and proposed category folders, and presents **5 plain-English questions** with 1-click suggested choices plus custom text boxes.
   - Includes a 1-click **"Save Answers as a Filing Style"** option and a mandatory **"I agree to these 5 answers and grant permission"** checkbox before unlocking **Agree & Organize My Files**.
4. **Step 2 — Interactive Before → After Blueprint & Safety Controls**:
   - Shows a structured high-density review table grouped by filterable category tabs (*All Folders*, *Review Duplicates*, *Archive*, and custom categories).
   - Highlights why each file was moved or renamed (including *Content Peeked*, *Exact Duplicate*, or *Old Archive* notes in clean unboxed text), lets the user uncheck any file or inline-edit any filename, and presents three safe apply actions:
     - **Apply Directly to Folder** (when granted direct disk access in a standalone browser tab, with non-destructive copy by default and automatic **Download Undo Script** generated right alongside).
     - **Download Organized Folders (.zip)** (works everywhere, including embedded preview frames, bundled with `_Organization_Summary.txt`).
     - **Download PC Apply & Undo Scripts** (generates ready-to-run Windows PowerShell `.ps1` and Mac/Linux `.sh` organize + restore scripts for instant in-place PC organization and 1-click rollback).
5. **Web Research Workspace (Secondary Tab)**:
   - Displays the exact requested onboarding card heading **`Type Your Question or Goal`** and helper copy **`No special formatting or technical prompts needed. Choose Instant Report for one-click results, or Review Steps First if you want to approve the sub-questions before we search.`**
   - Streams live per-sub-question status (`Queued` → `Researching...` → `Verified` → `Synthesizing...`) with automatic free-tier quota resilience.

### Visual Identity & Theme
- **Aesthetic Direction**: Calm, utilitarian productivity workspace—trustworthy, uncluttered, and tailored to non-technical clients (inspired by modern SaaS file and operations workspaces).
- **Color Palette & Mood (60-30-10 Discipline)**:
  - *60% Neutral Canvas*: Soft cool slate canvas (`bg-slate-50`) and crisp white primary work surfaces (`bg-white`).
  - *30% Structural Surfaces*: Hairline 1px neutral borders (`border-slate-200`), restrained slate typography (`text-slate-900` / `text-slate-600`), single-elevation layout with no nested card-in-card clutter.
  - *10% Focused Accents*: Confident cobalt blue (`blue-600`) strictly for primary actions and active states; semantic emerald (`emerald-700`), amber (`amber-700`), and crimson (`red-700`) paired with explicit text labels (never color alone) for duplicate, archive, and verified statuses.
- **Typography & Hierarchy**:
  - *Display & UI*: `Plus Jakarta Sans` (Regular 400, SemiBold 600, Bold 700) with balanced headlines (`text-balance`) and comfortable 15–16px body prose.
  - *Data & Filenames*: `JetBrains Mono` with `tabular-nums` for all file counts, byte sizes, dates, and Before/After paths so columns align cleanly without jitter.
- **Top Bar Contract & Anti-Slop Restraint**:
  - Strict single-row 3-zone top bar: one-line `Prospers Solutions` wordmark, concise single-line navigation links (`File Organizer`, `Web Research`, `Saved Reports`, `How It Works`, `Preferences`), and one primary action button (`New Folder` / `New Task`).
  - Zero static metadata pills (use quiet `·` text separators), zero thick left accent borders, zero decorative pulsing dots, and plain everyday button labels.

---

## 3. Key Product Decisions & Trade-Offs

- **Decision 1: Privacy-First Local Scanning & Content Peeking**
  - *Chosen Approach*: File hashing (for exact duplicate detection), age calculation, text snippet extraction, PDF text-stream peeking, and compact low-res image thumbnails (capped to cryptic/untitled images) all happen inside the user's browser before sending only lightweight metadata and short excerpts to the server.
  - *Why*: Keeps large personal folders fast, avoids uploading gigabytes of private files, and protects client privacy while still letting the AI read what an untitled scan or receipt actually is.
  - *Alternatives Considered*: Uploading entire folders to the server (slow, high memory usage, poor privacy for personal PCs).

- **Decision 2: Local Browser "Filing Styles" Instead of Mandatory Accounts**
  - *Chosen Approach*: Store saved Organizer Profiles (Filing Styles) in browser `localStorage` with instant load/save/delete controls and 3 curated starter presets.
  - *Why*: Preserves the "super easy drop in browser and go" promise for non-technical clients with zero sign-up barriers, while still letting repeat users save their 5-question preferences.
  - *Alternatives Considered*: Requiring login + cloud database (adds friction for one-off non-technical clients).

- **Decision 3: Three-Tier Safe Apply + Guaranteed Undo**
  - *Chosen Approach*: Combine Direct Folder Access (File System Access API), Organized `.zip` export, and downloadable Windows (`.ps1`) / Mac & Linux (`.sh`) Apply + **Undo/Restore** scripts generated directly from the approved Before → After mapping.
  - *Why*: Works seamlessly in every environment (including cross-origin preview frames, Safari/Firefox, and standalone desktop tabs) and guarantees clients can undo every rename/move with confidence.

- **Decision 4: Free-Tier Quota Resilience on Gemini API**
  - *Chosen Approach*: Use `gemini-3.1-flash-lite` as the primary structured model for file assessment, document peeking, and batched organization (with `gemini-4-hydrogen` at `ThinkingLevel.LOW` for deep web synthesis), backed by automatic exponential backoff retry and model/tool fallback.
  - *Why*: Keeps all features responsive and reliable within free-tier quotas without triggering `429 RESOURCE_EXHAUSTED` errors or prompting for paid billing.

---

## 4. Technical Architecture & Data Strategy *(Technical Reference)*

### Architecture & Component Flow

```text
┌──────────────────────────────────────────────────────────────────────────────┐
│                       Prospers Solutions (React SPA)                         │
│                                                                              │
│  ┌────────────────────────────────────────────────────────────────────────┐  │
│  │ Top Bar: Prospers Solutions  |  File Organizer · Web Research · ...    │  │
│  └────────────────────────────────────────────────────────────────────────┘  │
│                                      │                                       │
│          ┌───────────────────────────┴────────────────────────────┐          │
│          ▼ (Default Home)                                         ▼          │
│  ┌─────────────────────────────────────────┐   ┌──────────────────────────┐  │
│  │    Personal PC & File Organizer         │   │    Deep Web Research     │  │
│  │  • Filing Style Presets (localStorage)  │   │  • "Type Your Question   │  │
│  │  • 3 Toggleable Organizer Skills        │   │    or Goal" Card         │  │
│  │  • Local Scanner Engine:                │   │  • Instant / Review Mode │  │
│  │     - SHA-256 Duplicate Hasher          │   │  • Live Sub-Question     │  │
│  │     - Stale/Archive Age Detector        │   │    Progress Streamer     │  │
│  │     - Text/PDF/Image Content Peeker     │   │  • Report + Citations    │  │
│  │  • Step 1: Assessment + 5 Questions     │   └────────────┬─────────────┘  │
│  │  • Step 2: Editable Review Blueprint    │                │                │
│  │  • Step 3: Direct Disk / ZIP / Undo     │                │                │
│  │            (.ps1 & .sh Script Builder)  │                │                │
│  └───────────────────┬─────────────────────┘                │                │
└──────────────────────┼──────────────────────────────────────┼────────────────┘
                       │ JSON / Multimodal Previews           │ NDJSON Stream
                       ▼                                      ▼
┌──────────────────────────────────────────────────────────────────────────────┐
│                     Express Server Proxy (Port 3000 / Render)                │
│  • POST /api/files/assess   -> Skill-aware assessment + exactly 5 questions  │
│  • POST /api/files/peek     -> Multimodal content peeking for untitled files │
│  • POST /api/files/organize -> Batched folder grouping + collision-safe names│
│  • POST /api/research/*     -> Plan, NDJSON progress execute, follow-up      │
│  • Shared Retry & Fallback  -> Exponential backoff + flash-lite fallback     │
└──────────────────────────────────────┬───────────────────────────────────────┘
                                       │ @google/genai (Server-Side Only)
                                       ▼
                     ┌───────────────────────────────────┐
                     │  Gemini API (Free-Tier Friendly)  │
                     │  gemini-3.1-flash-lite &          │
                     │  gemini-4-hydrogen (LOW thinking) │
                     └───────────────────────────────────┘
```

### Data Model & State
- **Scanned File Record**: Stores local file handle/object, relative path, size, last-modified date, `contentHash` (partial SHA-256 for exact duplicate grouping), `duplicateGroupId`, `isOldArchiveCandidate` (>365 days untouched), `isCrypticName` (matches patterns like `IMG_`, `Screenshot`, `Untitled`, `Scan`, `Document (1)`), extracted `previewSnippet` (text/PDF excerpt), and optional compact base64 image thumbnail for untitled image peeking.
- **Organizer Skills Config**: Three independent toggles (`downloadsCleanup`, `duplicateAndArchive`, `contentPeek`) passed into both local scanning and server prompts so every skill directly shapes the assessment, the 5 questions, and the resulting folder layout.
- **Saved Filing Style Profile** (`localStorage`): `{ id, name, description, command, skills, defaultAnswers, createdAt }` — allows saving/loading/deleting personal filing styles in one click.
- **Organization Operation**: `{ fileId, originalPath, targetFolder, newFileName, reason, tag ('normal' | 'duplicate' | 'archive' | 'content-peeked'), wasRenamed, approved }`.

### Interactive Component & State Mapping
- **Folder & File Ingestion**: Selecting a folder via File System Access API (or standard folder/file picker & drag-and-drop fallback) triggers the local async pre-scanner with live progress feedback, computing duplicate groups, old-file counts, and content previews immediately.
- **Content Peeking**: When *Peek Inside Documents* is enabled and cryptic/untitled text, PDF, or image files are detected, the client reads safe text excerpts locally and sends compact thumbnails of cryptic images (capped to keep requests fast) to `/api/files/peek` or alongside assessment so the AI derives real descriptive titles.
- **5-Question & Permission Flow**: Answering or clicking suggested options updates controlled state; clicking **Save as Filing Style** persists the style to `localStorage`; checking the explicit permission box enables **Agree & Organize My Files**.
- **Review, Undo & Export**: Users filter by category/duplicate/archive tabs, toggle individual rows, or edit filenames inline. **Apply Directly to Folder** writes via `FileSystemDirectoryHandle` and automatically offers the paired **Undo Script**; **Download PC Scripts** exports both `Organize-Files.ps1/.sh` and `Undo-Organize.ps1/.sh`; **Download ZIP** packages the exact approved blueprint plus `_Organization_Summary.txt`.
