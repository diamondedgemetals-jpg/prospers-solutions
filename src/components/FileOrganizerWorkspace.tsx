import { apiFetch, readJson } from "../lib/api";
import {
  choicesFromAnswers,
  offlineAssessment,
  offlinePlan,
} from "../lib/offlinePlanner";
import React, { useEffect, useMemo, useRef, useState } from "react";
import JSZip from "jszip";
import {
  ArrowRight,
  Check,
  CheckCircle2,
  Download,
  ExternalLink,
  FileText,
  FolderInput,
  FolderOpen,
  FolderSync,
  Loader2,
  RotateCcw,
  Save,
  Trash2,
  Undo2,
  Upload,
} from "lucide-react";
import type {
  ClarifyingQuestion,
  FileAssessmentResponse,
  FileOrganizationOperation,
  FileOrganizationPlanResponse,
  ProposedFileCategory,
  ScannedFileMeta,
} from "../types/files";
import {
  ORGANIZED_FOLDER_PREFIX,
  SCRIPTS_README,
  STARTER_STYLES,
  buildScripts,
  cleanFileName,
  cleanFolderPath,
  findExactDuplicates,
  isOldFile,
  loadSavedStyles,
  makeDestinationsUnique,
  runFolderName,
  storeSavedStyles,
  type FilingStyle,
  type ScriptMove,
} from "../lib/organizerSafety";

// Minimal Web File System Access API type declarations for modern Chromium browsers
interface DirectoryPickerWindow extends Window {
  showDirectoryPicker?: (options?: {
    mode?: "read" | "readwrite";
  }) => Promise<FileSystemDirectoryHandle>;
}

interface LocalFileRecord {
  meta: ScannedFileMeta;
  file: File;
  /** Path inside the folder the user picked (no top folder name) */
  pathInRoot: string;
  parentHandle?: FileSystemDirectoryHandle;
}

/** One file the app actually wrote to disk, so it can be undone. */
interface AppliedEntry {
  fileId: string;
  from: string;
  to: string;
  moved: boolean;
  destDir: FileSystemDirectoryHandle;
  destName: string;
}

type OrganizerStage =
  | "select"
  | "assessing"
  | "questions"
  | "organizing"
  | "review"
  | "applying"
  | "done";

const MAX_FILES = 2000;
const MAX_DEPTH = 8;
const MAX_SNIPPETS = 150;
const MAX_HASH_BYTES = 200 * 1024 * 1024;
const DUPLICATES_FOLDER = "Review Duplicates";
const SKIP_NAMES = new Set([
  ".DS_Store",
  "Thumbs.db",
  "desktop.ini",
  "node_modules",
]);
const CRYPTIC_NAME =
  /^(img|dsc|pxl|scan|screenshot|screen shot|untitled|document|image|photo|file|download|new )[\s_-]*\(?\d*/i;

const TEXT_PREVIEW_EXTENSIONS = new Set([
  "txt",
  "md",
  "csv",
  "json",
  "tsv",
  "log",
  "html",
  "xml",
  "yml",
  "yaml",
]);

function formatBytes(bytes: number): string {
  if (bytes < 1024) return `${bytes} B`;
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)} KB`;
  if (bytes < 1024 * 1024 * 1024)
    return `${(bytes / (1024 * 1024)).toFixed(1)} MB`;
  return `${(bytes / (1024 * 1024 * 1024)).toFixed(2)} GB`;
}

function getFileExtension(name: string): string {
  const idx = name.lastIndexOf(".");
  return idx > 0 ? name.slice(idx + 1).toLowerCase() : "";
}

function isSkippedPath(path: string): boolean {
  return path
    .split("/")
    .some(
      (seg) =>
        SKIP_NAMES.has(seg) ||
        seg.startsWith(ORGANIZED_FOLDER_PREFIX) ||
        seg.startsWith("."),
    );
}

async function readSafeSnippet(
  file: File,
  ext: string,
): Promise<string | undefined> {
  if (!TEXT_PREVIEW_EXTENSIONS.has(ext) || file.size > 256 * 1024) {
    return undefined;
  }
  try {
    const slice = file.slice(0, 200);
    const text = await slice.text();
    return text.replace(/\s+/g, " ").trim().slice(0, 120);
  } catch {
    return undefined;
  }
}

async function fingerprintFile(file: File): Promise<string | null> {
  if (file.size > MAX_HASH_BYTES || !globalThis.crypto?.subtle) return null;
  try {
    const digest = await crypto.subtle.digest(
      "SHA-256",
      await file.arrayBuffer(),
    );
    return Array.from(new Uint8Array(digest), (b) =>
      b.toString(16).padStart(2, "0"),
    ).join("");
  } catch {
    return null;
  }
}

async function fileExists(
  dir: FileSystemDirectoryHandle,
  name: string,
): Promise<boolean> {
  try {
    await dir.getFileHandle(name);
    return true;
  } catch {
    return false;
  }
}

async function ensureSubfolder(
  base: FileSystemDirectoryHandle,
  folderPath: string,
): Promise<FileSystemDirectoryHandle> {
  let curr = base;
  for (const part of folderPath.split("/").filter(Boolean)) {
    curr = await curr.getDirectoryHandle(part, { create: true });
  }
  return curr;
}

async function writeTextFile(
  dir: FileSystemDirectoryHandle,
  name: string,
  text: string,
) {
  const handle = await dir.getFileHandle(name, { create: true });
  const w = await handle.createWritable();
  await w.write(text);
  await w.close();
}

/** Copy a file into a folder under a name that is guaranteed not to replace anything. */
async function writeWithoutOverwrite(
  dir: FileSystemDirectoryHandle,
  wantedName: string,
  data: Blob,
): Promise<string> {
  const dot = wantedName.lastIndexOf(".");
  const stem = dot > 0 ? wantedName.slice(0, dot) : wantedName;
  const ext = dot > 0 ? wantedName.slice(dot) : "";
  let name = wantedName;
  let n = 2;
  while (await fileExists(dir, name)) {
    name = `${stem} (${n})${ext}`;
    n++;
  }
  const handle = await dir.getFileHandle(name, { create: true });
  const w = await handle.createWritable();
  await w.write(data);
  await w.close();
  const written = await handle.getFile();
  if (written.size !== data.size) {
    throw new Error(`Copy check failed for ${name}`);
  }
  return name;
}

function triggerDownload(blob: Blob, fileName: string) {
  const url = URL.createObjectURL(blob);
  const link = document.createElement("a");
  link.href = url;
  link.download = fileName;
  document.body.appendChild(link);
  link.click();
  document.body.removeChild(link);
  setTimeout(() => URL.revokeObjectURL(url), 1000);
}

export function FileOrganizerWorkspace() {
  const [stage, setStage] = useState<OrganizerStage>("select");
  const [command, setCommand] = useState<string>(
    "Organize my files into categories of similar items and clean up messy filenames.",
  );
  const [records, setRecords] = useState<LocalFileRecord[]>([]);
  const [rootDirHandle, setRootDirHandle] =
    useState<FileSystemDirectoryHandle | null>(null);
  const [folderLabel, setFolderLabel] = useState<string>("");
  const [errorMessage, setErrorMessage] = useState<string>("");
  const [iframePickerFallbackNote, setIframePickerFallbackNote] =
    useState<boolean>(false);
  const [scanLimitNote, setScanLimitNote] = useState<string>("");
  const [scanProgress, setScanProgress] = useState<string>("");

  // Offline Mode: 'private' = user chose to keep everything on this device,
  // 'auto' = the server could not be reached, '' = using the AI server
  const [privateMode, setPrivateMode] = useState<boolean>(() => {
    try {
      return localStorage.getItem("prospers.privateMode") === "1";
    } catch {
      return false;
    }
  });
  const [offlineReason, setOfflineReason] = useState<"" | "private" | "auto">(
    "",
  );

  // Filing Styles (saved in this browser only)
  const [savedStyles, setSavedStyles] = useState<FilingStyle[]>([]);
  const [activeStyleId, setActiveStyleId] = useState<string>("");
  const [styleNameDraft, setStyleNameDraft] = useState<string>("");
  const [styleSavedNote, setStyleSavedNote] = useState<string>("");

  // Step 1 Assessment & 5 Questions state
  const [overviewSummary, setOverviewSummary] = useState<string>("");
  const [detectedPatterns, setDetectedPatterns] = useState<string[]>([]);
  const [proposedCategories, setProposedCategories] = useState<
    ProposedFileCategory[]
  >([]);
  const [questions, setQuestions] = useState<ClarifyingQuestion[]>([]);
  const [answers, setAnswers] = useState<Record<string, string>>({});
  const [userAgreedToOrganize, setUserAgreedToOrganize] =
    useState<boolean>(false);

  // Step 2 Organization Blueprint & Execution state
  const [planSummary, setPlanSummary] = useState<string>("");
  const [operations, setOperations] = useState<FileOrganizationOperation[]>([]);
  const [selectedFolderFilter, setSelectedFolderFilter] =
    useState<string>("ALL");
  const [removeOriginalsOnApply, setRemoveOriginalsOnApply] =
    useState<boolean>(false);
  const [applyProgressCount, setApplyProgressCount] = useState<number>(0);
  const [appliedSummaryMessage, setAppliedSummaryMessage] =
    useState<string>("");
  const [isBuildingZip, setIsBuildingZip] = useState<boolean>(false);
  const [appliedEntries, setAppliedEntries] = useState<AppliedEntry[]>([]);
  const [appliedRunFolder, setAppliedRunFolder] = useState<string>("");
  const [undoState, setUndoState] = useState<"idle" | "working" | "done">(
    "idle",
  );

  const folderInputRef = useRef<HTMLInputElement | null>(null);
  const filesInputRef = useRef<HTMLInputElement | null>(null);

  useEffect(() => {
    setSavedStyles(loadSavedStyles());
  }, []);

  const allStyles = useMemo(
    () => [...savedStyles, ...STARTER_STYLES],
    [savedStyles],
  );
  const activeStyle = allStyles.find((s) => s.id === activeStyleId);

  const totalSizeBytes = useMemo(
    () => records.reduce((acc, r) => acc + r.meta.sizeBytes, 0),
    [records],
  );

  const health = useMemo(() => {
    const dupes = records.filter((r) => r.meta.duplicateOfPath);
    return {
      duplicateCount: dupes.length,
      duplicateBytes: dupes.reduce((acc, r) => acc + r.meta.sizeBytes, 0),
      oldCount: records.filter((r) => r.meta.isOld).length,
      crypticCount: records.filter((r) => CRYPTIC_NAME.test(r.meta.name))
        .length,
    };
  }, [records]);

  const categoryCounts = useMemo(() => {
    const counts = new Map<string, number>();
    for (const op of operations) {
      if (!op.approved) continue;
      counts.set(op.targetFolder, (counts.get(op.targetFolder) ?? 0) + 1);
    }
    return Array.from(counts.entries()).sort((a, b) => b[1] - a[1]);
  }, [operations]);

  const filteredOperations = useMemo(() => {
    if (selectedFolderFilter === "ALL") return operations;
    return operations.filter((op) => op.targetFolder === selectedFolderFilter);
  }, [operations, selectedFolderFilter]);

  const approvedCount = operations.filter((o) => o.approved).length;
  const renamedCount = operations.filter(
    (o) => o.approved && o.wasRenamed,
  ).length;

  const resetOrganizer = () => {
    setStage("select");
    setRecords([]);
    setRootDirHandle(null);
    setFolderLabel("");
    setErrorMessage("");
    setScanLimitNote("");
    setScanProgress("");
    setOverviewSummary("");
    setDetectedPatterns([]);
    setProposedCategories([]);
    setQuestions([]);
    setAnswers({});
    setUserAgreedToOrganize(false);
    setPlanSummary("");
    setOperations([]);
    setSelectedFolderFilter("ALL");
    setApplyProgressCount(0);
    setAppliedSummaryMessage("");
    setAppliedEntries([]);
    setAppliedRunFolder("");
    setUndoState("idle");
    setStyleSavedNote("");
    setOfflineReason("");
  };

  const togglePrivateMode = (on: boolean) => {
    setPrivateMode(on);
    try {
      localStorage.setItem("prospers.privateMode", on ? "1" : "0");
    } catch {
      // private windows may block saving; the switch still works for this visit
    }
  };

  /** Show the 5 questions and pre-fill answers (saved Filing Style first, then suggestions). */
  const showQuestions = (data: FileAssessmentResponse, offline: boolean) => {
    setOverviewSummary(data.overviewSummary);
    setDetectedPatterns(data.detectedPatterns ?? []);
    setProposedCategories(data.proposedCategories ?? []);
    setQuestions(data.questions ?? []);
    const initialAnswers: Record<string, string> = {};
    (data.questions ?? []).forEach((q, idx) => {
      // Filing Style answers were written for the AI questions, so they only apply online
      const fromStyle = offline ? "" : activeStyle?.answers[idx]?.trim();
      initialAnswers[q.id] = fromStyle || q.suggestedOptions?.[0] || "";
    });
    setAnswers(initialAnswers);
    setUserAgreedToOrganize(false);
    setStyleSavedNote("");
    setStage("questions");
  };

  /** Flags old files and exact copies, then shows the scan. */
  const finishScan = async (scanned: LocalFileRecord[], hitLimit: boolean) => {
    setScanLimitNote(
      hitLimit
        ? `This folder is big, so we scanned the first ${MAX_FILES.toLocaleString()} files. Organize this batch, then run it again for the rest.`
        : "",
    );
    const now = new Date();
    for (const r of scanned) r.meta.isOld = isOldFile(r.meta.lastModified, now);

    const byId = new Map(scanned.map((r) => [r.meta.id, r]));
    setScanProgress("Checking for exact copies...");
    const extraToKeeper = await findExactDuplicates(
      scanned.map((r) => ({
        id: r.meta.id,
        sizeBytes: r.meta.sizeBytes,
        lastModified: r.meta.lastModified,
        pathInRoot: r.pathInRoot,
      })),
      (id) => fingerprintFile(byId.get(id)!.file),
      (done, total) =>
        setScanProgress(`Checking for exact copies... ${done} of ${total}`),
    );
    for (const [extraId, keeperId] of extraToKeeper) {
      const extra = byId.get(extraId);
      const keeper = byId.get(keeperId);
      if (extra && keeper) extra.meta.duplicateOfPath = keeper.pathInRoot;
    }
    setScanProgress("");
    setRecords([...scanned]);
  };

  const buildRecord = async (
    file: File,
    index: number,
    pathInRoot: string,
    relativePath: string,
    snippetsSoFar: number,
    parentHandle?: FileSystemDirectoryHandle,
  ): Promise<LocalFileRecord> => {
    const ext = getFileExtension(file.name);
    const snippet =
      snippetsSoFar < MAX_SNIPPETS
        ? await readSafeSnippet(file, ext)
        : undefined;
    return {
      file,
      pathInRoot,
      parentHandle,
      meta: {
        id: `file_${index}`,
        name: file.name,
        relativePath,
        extension: ext,
        sizeBytes: file.size,
        lastModified: new Date(file.lastModified || Date.now()).toISOString(),
        previewSnippet: snippet,
      },
    };
  };

  // Scan via standard <input type="file"> (works in every browser & iframe!)
  const ingestFileList = async (
    fileList: FileList | File[],
    sourceName?: string,
  ) => {
    const all = Array.from(fileList).filter((f) => {
      const rel =
        (f as File & { webkitRelativePath?: string }).webkitRelativePath ||
        f.name;
      return !isSkippedPath(rel);
    });
    if (all.length === 0) {
      setErrorMessage("We could not find any files to organize there.");
      return;
    }
    const arr = all.slice(0, MAX_FILES);

    setErrorMessage("");
    setScanProgress(`Reading ${arr.length} files...`);
    const nextRecords: LocalFileRecord[] = [];
    let snippets = 0;

    for (let i = 0; i < arr.length; i++) {
      const file = arr[i];
      const relPath =
        (file as File & { webkitRelativePath?: string }).webkitRelativePath ||
        file.name;
      // Folder picker paths start with the picked folder's own name; scripts need the path inside it
      const pathInRoot = relPath.includes("/")
        ? relPath.split("/").slice(1).join("/")
        : relPath;
      const rec = await buildRecord(file, i + 1, pathInRoot, relPath, snippets);
      if (rec.meta.previewSnippet) snippets++;
      nextRecords.push(rec);
    }

    const inferredFolder =
      sourceName ||
      (nextRecords[0]?.meta.relativePath.includes("/")
        ? nextRecords[0].meta.relativePath.split("/")[0]
        : `${nextRecords.length} selected files`);

    setRootDirHandle(null);
    setFolderLabel(inferredFolder);
    await finishScan(nextRecords, all.length > MAX_FILES);
  };

  // Scan recursively via File System Access API (enables direct in-place folder & file changes!)
  const handlePickDeviceFolder = async () => {
    setErrorMessage("");
    const win = window as DirectoryPickerWindow;

    if (typeof win.showDirectoryPicker === "function") {
      try {
        const dirHandle = await win.showDirectoryPicker({ mode: "readwrite" });
        const scanned: LocalFileRecord[] = [];
        let hitLimit = false;
        let snippets = 0;
        setScanProgress("Reading your folder...");

        const walkDirectory = async (
          currentHandle: FileSystemDirectoryHandle,
          prefix: string,
          depth: number,
        ) => {
          if (depth > MAX_DEPTH) return;
          const iterable = currentHandle as unknown as {
            values: () => AsyncIterable<
              FileSystemFileHandle | FileSystemDirectoryHandle
            >;
          };
          for await (const entry of iterable.values()) {
            if (isSkippedPath(entry.name)) continue;
            if (scanned.length >= MAX_FILES) {
              hitLimit = true;
              return;
            }
            const relPath = prefix ? `${prefix}/${entry.name}` : entry.name;
            if (entry.kind === "file") {
              const file = await (entry as FileSystemFileHandle).getFile();
              const rec = await buildRecord(
                file,
                scanned.length + 1,
                relPath,
                relPath,
                snippets,
                currentHandle,
              );
              if (rec.meta.previewSnippet) snippets++;
              scanned.push(rec);
              if (scanned.length % 100 === 0)
                setScanProgress(
                  `Reading your folder... ${scanned.length} files`,
                );
            } else if (entry.kind === "directory") {
              await walkDirectory(
                entry as FileSystemDirectoryHandle,
                relPath,
                depth + 1,
              );
            }
          }
        };

        await walkDirectory(dirHandle, "", 0);
        if (scanned.length === 0) {
          setScanProgress("");
          setErrorMessage(
            "That folder did not contain any visible files to organize.",
          );
          return;
        }

        setRootDirHandle(dirHandle);
        setFolderLabel(dirHandle.name);
        await finishScan(scanned, hitLimit);
        return;
      } catch (err) {
        setScanProgress("");
        const msg = err instanceof Error ? err.message : String(err);
        if (
          msg.toLowerCase().includes("aborted") ||
          msg.toLowerCase().includes("user gesture")
        ) {
          return;
        }
        // Cross-origin preview iframe blocks showDirectoryPicker -> open the standard folder picker
        setIframePickerFallbackNote(true);
        folderInputRef.current?.click();
        return;
      }
    }

    // Fallback for Safari / Firefox / mobile browsers
    folderInputRef.current?.click();
  };

  // Filing Styles
  const chooseStyle = (id: string) => {
    setActiveStyleId(id);
    const style = allStyles.find((s) => s.id === id);
    if (style) setCommand(style.command);
  };

  const deleteStyle = (id: string) => {
    const next = savedStyles.filter((s) => s.id !== id);
    setSavedStyles(next);
    storeSavedStyles(next);
    if (activeStyleId === id) setActiveStyleId("");
  };

  const saveCurrentAsStyle = () => {
    const name = styleNameDraft.trim();
    if (!name) return;
    const style: FilingStyle = {
      id: `style-${Date.now()}`,
      name,
      command,
      answers: questions.map((q) => (answers[q.id] ?? "").trim()),
      createdAt: new Date().toISOString(),
    };
    const next = [
      style,
      ...savedStyles.filter((s) => s.name.toLowerCase() !== name.toLowerCase()),
    ];
    setSavedStyles(next);
    const ok = storeSavedStyles(next);
    setActiveStyleId(style.id);
    setStyleNameDraft("");
    setStyleSavedNote(
      ok
        ? `Saved "${name}". Next time, pick it at the start and your answers fill in for you.`
        : "This browser would not let us save. Private windows often block saving.",
    );
  };

  // STEP 1: Run First Assessment -> Returns 5 Tailored Questions
  const handleRunFirstAssessment = async () => {
    if (records.length === 0) return;
    setErrorMessage("");
    setStage("assessing");

    const metas = records.map((r) => r.meta);
    const noInternet =
      typeof navigator !== "undefined" && navigator.onLine === false;
    if (privateMode || noInternet) {
      setOfflineReason(privateMode ? "private" : "auto");
      showQuestions(offlineAssessment(metas), true);
      return;
    }

    try {
      const response = await apiFetch("/api/files/assess", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ command, files: metas }),
      });
      const data = (await readJson(
        response,
      )) as unknown as FileAssessmentResponse & { error?: string };
      if (!response.ok) {
        throw new Error(data.error || "Could not assess the selected files.");
      }
      setOfflineReason("");
      showQuestions(data, false);
    } catch (err) {
      // Server asleep, offline, or out of AI quota: keep going with the built-in rules
      console.warn("Switching to Offline Mode:", err);
      setOfflineReason("auto");
      showQuestions(offlineAssessment(metas), true);
    }
  };

  // STEP 2: User Answers the 5 Questions + Agrees -> Agent Organizes & Renames
  const handleAgreeAndOrganize = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!userAgreedToOrganize) return;

    setErrorMessage("");
    setStage("organizing");

    try {
      const formattedAnswers = questions.map((q) => ({
        question: q.question,
        answer:
          (answers[q.id] ?? "").trim() ||
          q.suggestedOptions[0] ||
          "Use best judgment",
      }));

      // Exact copies never need the AI: they always go to "Review Duplicates"
      const toAi = records
        .filter((r) => !r.meta.duplicateOfPath)
        .map((r) => r.meta);
      const aiOps: FileOrganizationPlanResponse["operations"] = [];
      let summary = "";

      if (toAi.length > 0 && offlineReason) {
        const plan = offlinePlan(
          toAi,
          choicesFromAnswers(questions.map((q) => answers[q.id])),
        );
        aiOps.push(...plan.operations);
        summary = plan.planSummary;
      } else if (toAi.length > 0) {
        try {
          const response = await apiFetch("/api/files/organize", {
            method: "POST",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify({
              command,
              files: toAi,
              proposedCategories,
              answers: formattedAnswers,
            }),
          });

          const data = (await readJson(
            response,
          )) as unknown as FileOrganizationPlanResponse & { error?: string };
          if (!response.ok) {
            throw new Error(
              data.error || "Unable to generate the organization blueprint.",
            );
          }
          aiOps.push(...(data.operations ?? []));
          summary = data.planSummary;
        } catch (err) {
          // Lost the server partway: finish with the built-in rules (simple defaults, since the
          // questions answered were the AI's)
          console.warn("Switching to Offline Mode for organizing:", err);
          setOfflineReason("auto");
          const plan = offlinePlan(toAi);
          aiOps.push(...plan.operations);
          summary = `We couldn't reach the server, so we sorted your files by kind with built-in rules. ${plan.planSummary}`;
        }
      }

      const byId = new Map(records.map((r) => [r.meta.id, r]));
      const merged: FileOrganizationOperation[] = [];
      for (const op of aiOps) {
        const rec = byId.get(op.fileId);
        if (!rec) continue;
        merged.push({
          ...op,
          approved: true,
          tag: rec.meta.isOld ? "archive" : "normal",
        });
      }
      for (const rec of records) {
        if (!rec.meta.duplicateOfPath) continue;
        merged.push({
          fileId: rec.meta.id,
          originalPath: rec.meta.relativePath,
          targetFolder: DUPLICATES_FOLDER,
          newFileName: rec.meta.name,
          reason: `Exact copy of ${rec.meta.duplicateOfPath}`,
          wasRenamed: false,
          approved: true,
          tag: "duplicate",
        });
      }

      const dupNote =
        health.duplicateCount > 0
          ? ` ${health.duplicateCount} exact copies (${formatBytes(health.duplicateBytes)}) were set aside in "${DUPLICATES_FOLDER}" so you can decide what to delete.`
          : "";
      setPlanSummary(
        (summary || `Organized ${merged.length} files into clean folders.`) +
          dupNote,
      );
      setOperations(makeDestinationsUnique(merged));
      setSelectedFolderFilter("ALL");
      setStage("review");
    } catch (err) {
      setErrorMessage(
        err instanceof Error
          ? err.message
          : "Unable to organize files right now. Please try again.",
      );
      setStage("questions");
    }
  };

  /** Approved operations with clean names and no two files landing on the same spot. */
  const finalApprovedOps = () => {
    const byId = new Map(records.map((r) => [r.meta.id, r]));
    const cleaned = operations
      .filter((o) => o.approved && byId.has(o.fileId))
      .map((o) => {
        const rec = byId.get(o.fileId)!;
        return {
          ...o,
          targetFolder: cleanFolderPath(o.targetFolder),
          newFileName: cleanFileName(o.newFileName, rec.meta.name),
        };
      });
    return { ops: makeDestinationsUnique(cleaned), byId };
  };

  // Apply directly to the user's folder. Everything goes into ONE new folder, nothing is overwritten,
  // and originals are only removed (if the user asked) after the copy is checked.
  const handleApplyDirectlyToDisk = async () => {
    if (!rootDirHandle) return;
    const { ops, byId } = finalApprovedOps();
    if (ops.length === 0) return;

    setErrorMessage("");
    setApplyProgressCount(0);
    setStage("applying");

    const runFolder = runFolderName();
    const entries: AppliedEntry[] = [];
    let failed = 0;

    try {
      const runDir = await rootDirHandle.getDirectoryHandle(runFolder, {
        create: true,
      });

      for (const op of ops) {
        const rec = byId.get(op.fileId)!;
        try {
          const targetDir = await ensureSubfolder(runDir, op.targetFolder);
          const writtenName = await writeWithoutOverwrite(
            targetDir,
            op.newFileName,
            rec.file,
          );
          let moved = false;
          if (removeOriginalsOnApply && rec.parentHandle) {
            try {
              await rec.parentHandle.removeEntry(rec.meta.name);
              moved = true;
            } catch {
              // Original is locked or in use: keep it, the organized copy is still there
            }
          }
          entries.push({
            fileId: op.fileId,
            from: rec.pathInRoot,
            to: `${runFolder}/${op.targetFolder}/${writtenName}`,
            moved,
            destDir: targetDir,
            destName: writtenName,
          });
        } catch {
          failed++;
        }
        setApplyProgressCount(entries.length + failed);
      }

      // Leave undo instructions inside the new folder, so undo works even after the tab is closed
      const moves: ScriptMove[] = entries
        .filter((e) => e.moved)
        .map((e) => ({ from: e.from, to: e.to }));
      const undoDir = await runDir.getDirectoryHandle("_Undo", {
        create: true,
      });
      if (moves.length > 0) {
        const scripts = buildScripts(moves);
        await writeTextFile(undoDir, "Undo-Organize.ps1", scripts.undoWindows);
        await writeTextFile(undoDir, "Undo-Organize.sh", scripts.undoMac);
        await writeTextFile(undoDir, "README.txt", SCRIPTS_README);
      } else {
        await writeTextFile(
          undoDir,
          "README.txt",
          `Your original files were not touched.\nTo undo, simply delete the folder "${runFolder}".\n`,
        );
      }
      await writeTextFile(
        undoDir,
        "file-list.json",
        JSON.stringify(
          entries.map(({ from, to, moved }) => ({ from, to, moved })),
          null,
          2,
        ),
      );

      setAppliedEntries(entries);
      setAppliedRunFolder(runFolder);
      setUndoState("idle");
      const movedCount = moves.length;
      setAppliedSummaryMessage(
        `Organized ${entries.length} files into the new folder "${runFolder}" inside "${folderLabel}". ` +
          (movedCount > 0
            ? `${movedCount} originals were moved. You can undo below, or later with the file in "${runFolder}/_Undo".`
            : "Your original files were not touched.") +
          (failed > 0
            ? ` ${failed} files could not be copied and were left exactly where they were.`
            : ""),
      );
      setStage("done");
    } catch (err) {
      setErrorMessage(
        err instanceof Error
          ? `${err.message} Your original files were not changed.`
          : "Your browser blocked writing to that folder. Use Download Organized Folders (.zip) instead.",
      );
      setStage("review");
    }
  };

  // In-app undo: puts moved files back and removes the new folder
  const handleUndoApply = async () => {
    if (!rootDirHandle || !appliedRunFolder) return;
    setUndoState("working");
    setErrorMessage("");
    const byId = new Map(records.map((r) => [r.meta.id, r]));
    let problems = 0;

    for (const entry of appliedEntries) {
      if (!entry.moved) continue;
      const rec = byId.get(entry.fileId);
      if (!rec?.parentHandle) {
        problems++;
        continue;
      }
      try {
        if (await fileExists(rec.parentHandle, rec.meta.name)) {
          problems++; // something new is already there; leave both alone
          continue;
        }
        const copy = await (
          await entry.destDir.getFileHandle(entry.destName)
        ).getFile();
        const back = await rec.parentHandle.getFileHandle(rec.meta.name, {
          create: true,
        });
        const w = await back.createWritable();
        await w.write(copy);
        await w.close();
        if ((await back.getFile()).size !== copy.size)
          throw new Error("size mismatch");
      } catch {
        problems++;
      }
    }

    if (problems === 0) {
      try {
        await rootDirHandle.removeEntry(appliedRunFolder, { recursive: true });
      } catch {
        problems++;
      }
    }

    setUndoState("done");
    setAppliedSummaryMessage(
      problems === 0
        ? `Undone. Every file is back where it was, and "${appliedRunFolder}" was removed.`
        : `Mostly undone. ${problems} files need a manual check, so "${appliedRunFolder}" was kept. Nothing was deleted.`,
    );
  };

  // Universal Download Organized Folders (.zip) — works in every browser & iframe!
  const handleDownloadOrganizedZip = async () => {
    const { ops, byId } = finalApprovedOps();
    if (ops.length === 0 || isBuildingZip) return;

    setIsBuildingZip(true);
    setErrorMessage("");

    try {
      const zip = new JSZip();
      for (const op of ops) {
        zip.file(
          `${op.targetFolder}/${op.newFileName}`,
          byId.get(op.fileId)!.file,
        );
      }

      const manifestLines = [
        `Prospers Solutions — Organized Folder Summary`,
        `Date: ${new Date().toLocaleString()}`,
        `Total Files Organized: ${ops.length}`,
        `Folders Created: ${new Set(ops.map((o) => o.targetFolder)).size}`,
        `Your original files were not changed.`,
        ``,
        `File Mapping (Before -> After):`,
        ...ops.map(
          (o) =>
            `- ${o.originalPath}  -->  ${o.targetFolder}/${o.newFileName} (${o.reason})`,
        ),
      ];
      zip.file("_Organization_Summary.txt", manifestLines.join("\n"));

      const blob = await zip.generateAsync({ type: "blob" });
      const safeName =
        (folderLabel || "Organized-Files")
          .replace(/[^a-zA-Z0-9_-]+/g, "-")
          .replace(/^-|-$/g, "") || "Organized-Files";
      triggerDownload(blob, `${safeName}-Prospers.zip`);

      setAppliedEntries([]);
      setAppliedRunFolder("");
      setAppliedSummaryMessage(
        `Downloaded "${safeName}-Prospers.zip" with ${ops.length} organized files. Your original files were not changed.`,
      );
      setStage("done");
    } catch (err) {
      setErrorMessage(
        err instanceof Error
          ? err.message
          : "Unable to package the organized ZIP archive.",
      );
    } finally {
      setIsBuildingZip(false);
    }
  };

  // Organize in place with a double-click script (any browser), plus a matching undo script
  const handleDownloadScripts = async () => {
    const { ops, byId } = finalApprovedOps();
    if (ops.length === 0) return;
    const runFolder = runFolderName();
    const moves: ScriptMove[] = ops.map((op) => ({
      from: byId.get(op.fileId)!.pathInRoot,
      to: `${runFolder}/${op.targetFolder}/${op.newFileName}`,
    }));
    const scripts = buildScripts(moves);
    const zip = new JSZip();
    zip.file("Organize-My-Files.ps1", scripts.organizeWindows);
    zip.file("Organize-My-Files.sh", scripts.organizeMac);
    zip.file("Undo-Organize.ps1", scripts.undoWindows);
    zip.file("Undo-Organize.sh", scripts.undoMac);
    zip.file("README.txt", SCRIPTS_README);
    triggerDownload(
      await zip.generateAsync({ type: "blob" }),
      "Prospers-Organize-and-Undo.zip",
    );
  };

  const allFiveAnswered = questions.every(
    (q) => (answers[q.id] ?? "").trim().length > 0,
  );

  return (
    <div className="space-y-8">
      {/* Hidden native file inputs for universal browser & iframe support */}
      <input
        ref={folderInputRef}
        type="file"
        multiple
        // @ts-expect-error webkitdirectory is standard across desktop browsers for folder selection
        webkitdirectory=""
        directory=""
        className="hidden"
        onChange={(e) => {
          if (e.target.files && e.target.files.length > 0) {
            ingestFileList(e.target.files);
          }
          e.target.value = "";
        }}
      />
      <input
        ref={filesInputRef}
        type="file"
        multiple
        className="hidden"
        onChange={(e) => {
          if (e.target.files && e.target.files.length > 0) {
            ingestFileList(e.target.files);
          }
          e.target.value = "";
        }}
      />

      {errorMessage && (
        <div
          role="alert"
          className="p-4 bg-red-50 border border-red-200 rounded-xl flex items-center justify-between gap-3 text-sm text-red-900"
        >
          <span>{errorMessage}</span>
          <button
            type="button"
            onClick={() => setErrorMessage("")}
            className="px-3 py-1 text-xs font-semibold bg-white border border-red-300 rounded-lg hover:bg-red-100 cursor-pointer"
          >
            Dismiss
          </button>
        </div>
      )}

      {/* STAGE 1: SELECT DEVICE FOLDER / FILES & ENTER COMMAND */}
      {stage === "select" && (
        <div className="max-w-3xl mx-auto space-y-8">
          <section className="text-center space-y-3 pt-2">
            <div className="flex items-center justify-center gap-2 text-xs text-slate-500">
              <span>Smart Folder Grouping</span>
              <span aria-hidden="true">·</span>
              <span>5-Question Guided Check</span>
              <span aria-hidden="true">·</span>
              <span>Clean Filename Renaming</span>
            </div>
            <h1 className="text-3xl sm:text-4xl font-bold tracking-tight text-slate-900 text-balance">
              Organize messy folders &amp; files into clean categories
            </h1>
            <p className="text-base text-slate-600 max-w-2xl mx-auto leading-relaxed">
              Select any folder or batch of files from your computer. Prospers
              Solutions inspects them, asks <strong>5 quick questions</strong>{" "}
              to confirm your preferences, and organizes similar files into
              tidy, clearly named folders.
            </p>
          </section>

          <section className="bg-white border border-slate-200 rounded-2xl p-6 sm:p-8 space-y-6">
            {/* Saved Filing Styles */}
            <div className="space-y-2">
              <div className="text-xs font-semibold text-slate-800">
                Start from a Filing Style{" "}
                <span className="font-normal text-slate-500">(optional)</span>
              </div>
              <div className="flex flex-wrap gap-2">
                {allStyles.map((s) => (
                  <span key={s.id} className="inline-flex items-center">
                    <button
                      type="button"
                      onClick={() =>
                        chooseStyle(activeStyleId === s.id ? "" : s.id)
                      }
                      className={`px-3 py-1.5 text-xs font-medium border transition-colors cursor-pointer ${
                        s.starter ? "rounded-lg" : "rounded-l-lg"
                      } ${
                        activeStyleId === s.id
                          ? "bg-blue-600 text-white border-blue-600"
                          : "bg-slate-50 text-slate-700 border-slate-200 hover:bg-slate-100"
                      }`}
                    >
                      {s.name}
                    </button>
                    {!s.starter && (
                      <button
                        type="button"
                        onClick={() => deleteStyle(s.id)}
                        aria-label={`Delete ${s.name}`}
                        title="Delete this Filing Style"
                        className="px-2 py-1.5 text-xs border border-l-0 border-slate-200 rounded-r-lg bg-white text-slate-400 hover:text-red-700 cursor-pointer"
                      >
                        <Trash2 className="w-3.5 h-3.5" />
                      </button>
                    )}
                  </span>
                ))}
              </div>
            </div>

            {/* Plain-English Command Input */}
            <div className="space-y-1.5">
              <label
                htmlFor="organizer-command"
                className="text-xs font-semibold text-slate-800"
              >
                Tell the organizer what you want done
              </label>
              <textarea
                id="organizer-command"
                rows={2}
                value={command}
                onChange={(e) => setCommand(e.target.value)}
                placeholder="e.g., Sort my downloads into similar categories, separate invoices by year, and rename cryptic photo or scan filenames..."
                className="w-full p-3.5 text-sm sm:text-base bg-slate-50/70 border border-slate-200 rounded-xl text-slate-900 placeholder:text-slate-400 focus:bg-white focus:outline-none focus:border-blue-600 resize-y"
              />
            </div>

            {/* File Explorer Dropzone & Picker Buttons */}
            <div
              onDragOver={(e) => e.preventDefault()}
              onDrop={(e) => {
                e.preventDefault();
                if (e.dataTransfer.files && e.dataTransfer.files.length > 0) {
                  ingestFileList(e.dataTransfer.files, "Dropped Files");
                }
              }}
              className="border-2 border-dashed border-slate-300 hover:border-blue-500 rounded-xl p-8 text-center space-y-4 bg-slate-50/50 transition-colors"
            >
              <div className="w-11 h-11 rounded-xl bg-blue-50 text-blue-600 flex items-center justify-center mx-auto">
                <FolderOpen className="w-5 h-5" />
              </div>
              <div className="space-y-1">
                <h2 className="text-base font-semibold text-slate-900">
                  Choose a folder or drop files from your File Explorer
                </h2>
                <p className="text-xs text-slate-500 max-w-md mx-auto">
                  {privateMode
                    ? 'Private Mode is on: nothing is sent anywhere. Everything is sorted right here on your device.'
                    : 'Your files never leave your computer. Only file names, dates, and the first line of plain-text files are sent to plan your folders.'}
                </p>
              </div>

              <label className="inline-flex items-center gap-2 text-xs text-slate-700 cursor-pointer select-none">
                <input
                  type="checkbox"
                  checked={privateMode}
                  onChange={(e) => togglePrivateMode(e.target.checked)}
                  className="w-4 h-4 accent-blue-600"
                />
                <span>
                  <span className="font-semibold">Private Mode:</span> keep everything on this
                  device (works without internet, simpler names)
                </span>
              </label>

              <div className="flex flex-wrap items-center justify-center gap-3 pt-1">
                <button
                  type="button"
                  onClick={handlePickDeviceFolder}
                  className="inline-flex items-center gap-2 px-5 py-2.5 text-sm font-semibold text-white bg-blue-600 rounded-xl hover:bg-blue-700 transition-colors whitespace-nowrap shrink-0 cursor-pointer"
                >
                  <FolderInput className="w-4 h-4" />
                  <span>Select Folder from Device</span>
                </button>
                <button
                  type="button"
                  onClick={() => filesInputRef.current?.click()}
                  className="inline-flex items-center gap-2 px-4 py-2.5 text-sm font-semibold text-slate-800 bg-white border border-slate-300 rounded-xl hover:bg-slate-50 transition-colors whitespace-nowrap shrink-0 cursor-pointer"
                >
                  <Upload className="w-4 h-4" />
                  <span>Select Multiple Files</span>
                </button>
              </div>

              {iframePickerFallbackNote && (
                <p className="text-xs text-slate-500 pt-2">
                  Tip: Open the{" "}
                  <a
                    href={window.location.href}
                    target="_blank"
                    rel="noopener noreferrer"
                    className="text-blue-700 underline inline-flex items-center gap-1"
                  >
                    app in its own browser tab{" "}
                    <ExternalLink className="w-3 h-3" />
                  </a>{" "}
                  if you want direct in-place folder editing on disk, or
                  continue right here to download your organized folder ZIP.
                </p>
              )}
            </div>

            {scanProgress && (
              <div
                className="flex items-center gap-2 text-sm text-slate-700"
                role="status"
              >
                <Loader2 className="w-4 h-4 animate-spin text-blue-600" />
                <span className="tabular-nums">{scanProgress}</span>
              </div>
            )}

            {scanLimitNote && !scanProgress && (
              <div className="p-3.5 rounded-xl bg-amber-50 border border-amber-200 text-xs sm:text-sm text-amber-900">
                {scanLimitNote}
              </div>
            )}

            {/* Scanned Files Summary */}
            {records.length > 0 && !scanProgress && (
              <div className="pt-4 border-t border-slate-200 space-y-4">
                <div className="flex flex-wrap items-center justify-between gap-3">
                  <div className="space-y-0.5">
                    <div className="text-sm font-semibold text-slate-900">
                      Ready to Assess: {folderLabel}
                    </div>
                    <div className="flex items-center gap-2 text-xs text-slate-500 tabular-nums">
                      <span>{records.length} files detected</span>
                      <span aria-hidden="true">·</span>
                      <span>{formatBytes(totalSizeBytes)} total</span>
                      <span aria-hidden="true">·</span>
                      <span>
                        {rootDirHandle
                          ? "Direct Folder Write Enabled"
                          : "Safe ZIP Folder Export"}
                      </span>
                    </div>
                  </div>

                  <div className="flex items-center gap-2.5">
                    <button
                      type="button"
                      onClick={resetOrganizer}
                      className="px-3.5 py-2 text-xs font-semibold text-slate-600 hover:text-slate-900 cursor-pointer"
                    >
                      Clear
                    </button>
                    <button
                      type="button"
                      onClick={handleRunFirstAssessment}
                      className="inline-flex items-center gap-2 px-5 py-2.5 text-sm font-semibold text-white bg-slate-900 rounded-xl hover:bg-slate-800 transition-colors whitespace-nowrap shrink-0 cursor-pointer"
                    >
                      <span>Run First Assessment</span>
                      <ArrowRight className="w-4 h-4" />
                    </button>
                  </div>
                </div>

                {/* Folder Health snapshot */}
                <div className="grid grid-cols-3 gap-2 text-center">
                  <div className="p-3 rounded-xl border border-slate-200">
                    <div className="text-lg font-bold text-slate-900 tabular-nums">
                      {health.duplicateCount}
                    </div>
                    <div className="text-xs text-slate-600">
                      Exact copies
                      {health.duplicateCount > 0 && (
                        <span className="block text-slate-500 tabular-nums">
                          {formatBytes(health.duplicateBytes)} wasted
                        </span>
                      )}
                    </div>
                  </div>
                  <div className="p-3 rounded-xl border border-slate-200">
                    <div className="text-lg font-bold text-slate-900 tabular-nums">
                      {health.oldCount}
                    </div>
                    <div className="text-xs text-slate-600">
                      Not changed in 1+ year
                    </div>
                  </div>
                  <div className="p-3 rounded-xl border border-slate-200">
                    <div className="text-lg font-bold text-slate-900 tabular-nums">
                      {health.crypticCount}
                    </div>
                    <div className="text-xs text-slate-600">Unclear names</div>
                  </div>
                </div>

                {/* Preview first few scanned files */}
                <div className="border border-slate-200 rounded-xl divide-y divide-slate-100 max-h-48 overflow-y-auto text-xs">
                  {records.slice(0, 25).map((rec) => (
                    <div
                      key={rec.meta.id}
                      className="px-3.5 py-2 flex items-center justify-between gap-4"
                    >
                      <div className="flex items-center gap-2 min-w-0">
                        <FileText className="w-3.5 h-3.5 text-slate-400 shrink-0" />
                        <span className="truncate text-slate-800">
                          {rec.meta.relativePath}
                        </span>
                      </div>
                      <span className="text-slate-400 font-mono tabular-nums shrink-0">
                        {formatBytes(rec.meta.sizeBytes)}
                      </span>
                    </div>
                  ))}
                  {records.length > 25 && (
                    <div className="px-3.5 py-2 text-slate-500 text-center tabular-nums">
                      + {records.length - 25} more files included in scan
                    </div>
                  )}
                </div>
              </div>
            )}
          </section>
        </div>
      )}

      {/* STAGE: RUNNING FIRST ASSESSMENT */}
      {stage === "assessing" && (
        <section className="max-w-3xl mx-auto bg-white border border-slate-200 rounded-2xl p-8 space-y-5">
          <div className="flex items-center gap-3">
            <Loader2 className="w-5 h-5 text-blue-600 animate-spin shrink-0" />
            <div>
              <div className="text-xs font-medium text-blue-700">
                Step 1 of 3 · First Assessment
              </div>
              <h2 className="text-xl font-bold text-slate-900">
                Inspecting {records.length} files in &ldquo;{folderLabel}
                &rdquo;...
              </h2>
            </div>
          </div>
          <p className="text-sm text-slate-600">
            Identifying groups of similar files, messy filenames, and preparing
            5 quick questions for your approval.
          </p>
          <div className="space-y-2.5">
            {[1, 2, 3].map((n) => (
              <div
                key={n}
                className="h-12 bg-slate-100 rounded-xl animate-pulse"
              />
            ))}
          </div>
        </section>
      )}

      {/* STAGE 2: FIRST ASSESSMENT + 5 CLARIFYING QUESTIONS + EXPLICIT PERMISSION */}
      {stage === "questions" && (
        <form
          onSubmit={handleAgreeAndOrganize}
          className="max-w-4xl mx-auto space-y-8"
        >
          {/* First Assessment Card */}
          <section className="bg-white border border-slate-200 rounded-2xl p-6 sm:p-8 space-y-6">
            <div className="space-y-2 pb-5 border-b border-slate-200">
              <div className="flex items-center gap-2 text-xs text-slate-500 tabular-nums">
                <span>First Assessment Complete</span>
                <span aria-hidden="true">·</span>
                <span>{records.length} files analyzed</span>
                <span aria-hidden="true">·</span>
                <span>{proposedCategories.length} similar groups found</span>
              </div>
              <h2 className="text-2xl font-bold text-slate-900">
                Here is what we found in &ldquo;{folderLabel}&rdquo;
              </h2>
              <p className="text-sm sm:text-base text-slate-700 leading-relaxed">
                {overviewSummary}
              </p>
            </div>

            {offlineReason && (
              <div
                role="status"
                className="p-3.5 rounded-xl bg-slate-50 border border-slate-200 text-xs sm:text-sm text-slate-700"
              >
                {offlineReason === 'private'
                  ? 'Private Mode: everything is being sorted on your device. Nothing is sent over the internet.'
                  : "Working offline: we couldn't reach the server, so we're using built-in rules on your device. Names will be simpler, and nothing is sent over the internet."}
              </div>
            )}

            {detectedPatterns.length > 0 && (
              <div className="space-y-2">
                <h3 className="text-xs font-semibold text-slate-700">
                  Patterns Detected
                </h3>
                <ul className="grid grid-cols-1 sm:grid-cols-2 gap-2 text-xs sm:text-sm text-slate-700">
                  {detectedPatterns.map((pat, i) => (
                    <li key={i} className="flex items-start gap-2">
                      <span className="text-blue-600 font-bold">·</span>
                      <span>{pat}</span>
                    </li>
                  ))}
                </ul>
              </div>
            )}

            {proposedCategories.length > 0 && (
              <div className="space-y-2.5">
                <h3 className="text-xs font-semibold text-slate-700">
                  Proposed Category Folders of Similar Files
                </h3>
                <div className="divide-y divide-slate-100 border border-slate-200 rounded-xl">
                  {proposedCategories.map((cat) => (
                    <div
                      key={cat.name}
                      className="px-4 py-3 flex items-center justify-between gap-4"
                    >
                      <div className="min-w-0">
                        <div className="text-sm font-semibold text-slate-900">
                          {cat.name}
                        </div>
                        <div className="text-xs text-slate-600">
                          {cat.description}
                        </div>
                      </div>
                      <span className="text-xs font-mono tabular-nums text-slate-500 whitespace-nowrap shrink-0">
                        ~{cat.estimatedCount} files
                      </span>
                    </div>
                  ))}
                </div>
              </div>
            )}
          </section>

          {/* 5 Clarifying Questions */}
          <section className="bg-white border border-slate-200 rounded-2xl p-6 sm:p-8 space-y-6">
            <div className="space-y-1 pb-4 border-b border-slate-200">
              <div className="text-xs font-medium text-blue-700">
                Step 2 of 3 · Your Preferences
              </div>
              <h2 className="text-xl font-bold text-slate-900">
                Answer 5 Quick Questions Before We Organize
              </h2>
              <p className="text-sm text-slate-600">
                Click any suggested option or type your own preference so the
                agent organizes and renames your files the exact way you want.
              </p>
            </div>

            <div className="divide-y divide-slate-200">
              {questions.map((q, idx) => (
                <div key={q.id} className="py-5 first:pt-1 last:pb-1 space-y-3">
                  <div className="space-y-0.5">
                    <label
                      htmlFor={`question-${q.id}`}
                      className="text-sm sm:text-base font-semibold text-slate-900 block"
                    >
                      <span className="font-mono text-xs tabular-nums text-blue-700 mr-2">
                        0{idx + 1}.
                      </span>
                      {q.question}
                    </label>
                    <p className="text-xs text-slate-500">{q.whyItMatters}</p>
                  </div>

                  {/* Quick-choice option buttons */}
                  <div className="flex flex-wrap gap-2">
                    {q.suggestedOptions.map((opt) => {
                      const isSelected = answers[q.id] === opt;
                      return (
                        <button
                          key={opt}
                          type="button"
                          onClick={() =>
                            setAnswers((prev) => ({ ...prev, [q.id]: opt }))
                          }
                          className={`px-3 py-1.5 text-xs font-medium rounded-lg border transition-colors cursor-pointer ${
                            isSelected
                              ? "bg-blue-600 text-white border-blue-600"
                              : "bg-slate-50 text-slate-700 border-slate-200 hover:bg-slate-100"
                          }`}
                        >
                          {opt}
                        </button>
                      );
                    })}
                  </div>

                  {/* Custom answer input */}
                  <input
                    id={`question-${q.id}`}
                    type="text"
                    value={answers[q.id] ?? ""}
                    onChange={(e) =>
                      setAnswers((prev) => ({
                        ...prev,
                        [q.id]: e.target.value,
                      }))
                    }
                    placeholder="Or type your own answer here..."
                    className="w-full px-3.5 py-2 text-sm bg-white border border-slate-200 rounded-lg text-slate-900 placeholder:text-slate-400 focus:outline-none focus:border-blue-600"
                  />
                </div>
              ))}
            </div>

            {/* Save answers as a reusable Filing Style */}
            <div className="pt-5 border-t border-slate-200 space-y-2">
              <label
                htmlFor="style-name"
                className="text-xs font-semibold text-slate-800 block"
              >
                Save these answers for next time{" "}
                <span className="font-normal text-slate-500">(optional)</span>
              </label>
              <div className="flex flex-wrap gap-2">
                <input
                  id="style-name"
                  type="text"
                  value={styleNameDraft}
                  onChange={(e) => setStyleNameDraft(e.target.value)}
                  placeholder='Name it, e.g. "Home Downloads"'
                  className="flex-1 min-w-[200px] px-3.5 py-2 text-sm bg-white border border-slate-200 rounded-lg text-slate-900 placeholder:text-slate-400 focus:outline-none focus:border-blue-600"
                />
                <button
                  type="button"
                  onClick={saveCurrentAsStyle}
                  disabled={!styleNameDraft.trim()}
                  className="inline-flex items-center gap-1.5 px-4 py-2 text-xs font-semibold text-slate-800 bg-white border border-slate-300 rounded-lg hover:bg-slate-50 disabled:opacity-45 cursor-pointer"
                >
                  <Save className="w-3.5 h-3.5" />
                  <span>Save Filing Style</span>
                </button>
              </div>
              {styleSavedNote && (
                <p className="text-xs text-emerald-700">{styleSavedNote}</p>
              )}
            </div>

            {/* Explicit Agreement & Permission Gate */}
            <div className="pt-5 border-t border-slate-200 space-y-4">
              <label className="flex items-start gap-3 p-4 rounded-xl bg-slate-50 border border-slate-200 cursor-pointer">
                <input
                  type="checkbox"
                  checked={userAgreedToOrganize}
                  onChange={(e) => setUserAgreedToOrganize(e.target.checked)}
                  className="mt-0.5 w-4 h-4 rounded border-slate-300 text-blue-600 focus:ring-blue-600"
                />
                <span className="text-xs sm:text-sm text-slate-800 leading-relaxed">
                  <strong>
                    I agree to these 5 answers and grant permission
                  </strong>{" "}
                  for Prospers Solutions to search through my selected file
                  list, group similar items into category folders, and prepare
                  clean filenames.
                </span>
              </label>

              <div className="flex flex-wrap items-center justify-between gap-3">
                <button
                  type="button"
                  onClick={() => setStage("select")}
                  className="px-4 py-2.5 text-xs font-semibold text-slate-700 bg-white border border-slate-300 rounded-xl hover:bg-slate-50 cursor-pointer"
                >
                  Change Selected Files
                </button>
                <button
                  type="submit"
                  disabled={!userAgreedToOrganize || !allFiveAnswered}
                  className="inline-flex items-center gap-2 px-6 py-2.5 text-sm font-semibold text-white bg-blue-600 rounded-xl hover:bg-blue-700 disabled:opacity-45 disabled:cursor-not-allowed transition-colors whitespace-nowrap shrink-0 cursor-pointer"
                >
                  <span>Agree &amp; Organize My Files</span>
                  <ArrowRight className="w-4 h-4" />
                </button>
              </div>
            </div>
          </section>
        </form>
      )}

      {/* STAGE: AGENT WORKING ON CATEGORIZATION & RENAMING */}
      {stage === "organizing" && (
        <section className="max-w-3xl mx-auto bg-white border border-slate-200 rounded-2xl p-8 space-y-5">
          <div className="flex items-center gap-3">
            <Loader2 className="w-5 h-5 text-blue-600 animate-spin shrink-0" />
            <div>
              <div className="text-xs font-medium text-blue-700">
                Step 3 of 3 · Agent Organizing &amp; Renaming
              </div>
              <h2 className="text-xl font-bold text-slate-900">
                Sorting {records.length} files into similar folders &amp;
                cleaning filenames...
              </h2>
            </div>
          </div>
          <p className="text-sm text-slate-600">
            Applying your 5 answers, verifying file extensions stay intact, and
            checking for duplicate naming collisions.
          </p>
          <div className="space-y-2.5">
            {[1, 2, 3, 4].map((n) => (
              <div
                key={n}
                className="h-12 bg-slate-100 rounded-xl animate-pulse"
              />
            ))}
          </div>
        </section>
      )}

      {/* STAGE 3: REVIEW & APPLY ORGANIZED FOLDERS */}
      {stage === "review" && (
        <div className="space-y-6">
          <section className="bg-white border border-slate-200 rounded-2xl p-6 sm:p-8 space-y-6">
            <div className="flex flex-col lg:flex-row lg:items-end justify-between gap-6 pb-6 border-b border-slate-200">
              <div className="space-y-2 max-w-2xl">
                <div className="flex items-center gap-2 text-xs text-emerald-700 font-medium tabular-nums">
                  <span>Organization Blueprint Ready</span>
                  <span aria-hidden="true">·</span>
                  <span>{approvedCount} files selected</span>
                  <span aria-hidden="true">·</span>
                  <span>{categoryCounts.length} folders</span>
                  <span aria-hidden="true">·</span>
                  <span>{renamedCount} renamed</span>
                </div>
                <h2 className="text-2xl font-bold text-slate-900">
                  Review &amp; Save Your Organized Folders
                </h2>
                <p className="text-sm text-slate-600 leading-relaxed">
                  {planSummary}
                </p>
              </div>

              <div className="flex flex-wrap items-center gap-3 shrink-0">
                <button
                  type="button"
                  onClick={handleDownloadOrganizedZip}
                  disabled={approvedCount === 0 || isBuildingZip}
                  className="inline-flex items-center gap-2 px-5 py-2.5 text-sm font-semibold text-white bg-blue-600 rounded-xl hover:bg-blue-700 disabled:opacity-45 transition-colors whitespace-nowrap shrink-0 cursor-pointer"
                >
                  {isBuildingZip ? (
                    <Loader2 className="w-4 h-4 animate-spin" />
                  ) : (
                    <Download className="w-4 h-4" />
                  )}
                  <span>
                    {isBuildingZip
                      ? "Packaging ZIP..."
                      : "Download Organized Folders (.zip)"}
                  </span>
                </button>

                {rootDirHandle && (
                  <button
                    type="button"
                    onClick={handleApplyDirectlyToDisk}
                    disabled={approvedCount === 0}
                    className="inline-flex items-center gap-2 px-5 py-2.5 text-sm font-semibold text-emerald-800 bg-white border border-emerald-600 rounded-xl hover:bg-emerald-50 disabled:opacity-45 transition-colors whitespace-nowrap shrink-0 cursor-pointer"
                  >
                    <FolderSync className="w-4 h-4" />
                    <span>Organize Inside My Folder</span>
                  </button>
                )}

                <button
                  type="button"
                  onClick={handleDownloadScripts}
                  disabled={approvedCount === 0}
                  title="A double-click file for Windows or Mac that organizes your folder in place, plus one that undoes it"
                  className="inline-flex items-center gap-2 px-4 py-2.5 text-sm font-semibold text-slate-800 bg-white border border-slate-300 rounded-xl hover:bg-slate-50 disabled:opacity-45 transition-colors whitespace-nowrap shrink-0 cursor-pointer"
                >
                  <Download className="w-4 h-4" />
                  <span>Get Organize &amp; Undo Files</span>
                </button>
              </div>
            </div>

            {rootDirHandle && (
              <label className="flex items-center gap-2.5 text-xs text-slate-700 cursor-pointer">
                <input
                  type="checkbox"
                  checked={removeOriginalsOnApply}
                  onChange={(e) => setRemoveOriginalsOnApply(e.target.checked)}
                  className="w-4 h-4 rounded border-slate-300 text-blue-600"
                />
                <span>
                  Also remove the old copies after organizing. Off by default.
                  Each file is checked first, and you can undo everything
                  afterward.
                </span>
              </label>
            )}

            {/* Category Folder Filter Bar */}
            <div className="flex flex-wrap items-center gap-1.5">
              <button
                type="button"
                onClick={() => setSelectedFolderFilter("ALL")}
                className={`px-3 py-1.5 text-xs font-medium rounded-lg border transition-colors tabular-nums cursor-pointer ${
                  selectedFolderFilter === "ALL"
                    ? "bg-slate-900 text-white border-slate-900"
                    : "bg-slate-50 text-slate-700 border-slate-200 hover:bg-slate-100"
                }`}
              >
                All Folders ({approvedCount})
              </button>
              {categoryCounts.map(([folder, count]) => (
                <button
                  key={folder}
                  type="button"
                  onClick={() => setSelectedFolderFilter(folder)}
                  className={`px-3 py-1.5 text-xs font-medium rounded-lg border transition-colors tabular-nums cursor-pointer ${
                    selectedFolderFilter === folder
                      ? "bg-slate-900 text-white border-slate-900"
                      : "bg-slate-50 text-slate-700 border-slate-200 hover:bg-slate-100"
                  }`}
                >
                  {folder} ({count})
                </button>
              ))}
            </div>

            {/* Interactive Before -> After Operations Table */}
            <div className="overflow-x-auto border border-slate-200 rounded-xl">
              <table className="w-full text-left border-collapse text-xs sm:text-sm">
                <thead>
                  <tr className="bg-slate-50 border-b border-slate-200 text-xs font-semibold text-slate-600">
                    <th className="py-3 px-4 w-10">Include</th>
                    <th className="py-3 px-4">Original File</th>
                    <th className="py-3 px-4">New Category Folder</th>
                    <th className="py-3 px-4">New Filename (Editable)</th>
                    <th className="py-3 px-4">Reason</th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-slate-100">
                  {filteredOperations.map((op) => (
                    <tr key={op.fileId} className="hover:bg-slate-50/70">
                      <td className="py-3 px-4">
                        <input
                          type="checkbox"
                          checked={op.approved}
                          onChange={(e) => {
                            const checked = e.target.checked;
                            setOperations((prev) =>
                              prev.map((item) =>
                                item.fileId === op.fileId
                                  ? { ...item, approved: checked }
                                  : item,
                              ),
                            );
                          }}
                          className="w-4 h-4 rounded border-slate-300 text-blue-600"
                        />
                      </td>
                      <td className="py-3 px-4 font-mono text-xs text-slate-600 max-w-[220px] truncate">
                        {op.originalPath}
                      </td>
                      <td className="py-3 px-4 font-medium text-slate-900 whitespace-nowrap">
                        {op.targetFolder}
                      </td>
                      <td className="py-3 px-4">
                        <input
                          type="text"
                          value={op.newFileName}
                          onChange={(e) => {
                            const val = e.target.value;
                            setOperations((prev) =>
                              prev.map((item) =>
                                item.fileId === op.fileId
                                  ? {
                                      ...item,
                                      newFileName: val,
                                      wasRenamed: true,
                                    }
                                  : item,
                              ),
                            );
                          }}
                          className="w-full min-w-[180px] px-2.5 py-1 text-xs font-mono bg-white border border-slate-200 rounded-md text-slate-900 focus:outline-none focus:border-blue-600"
                        />
                      </td>
                      <td className="py-3 px-4 text-xs text-slate-500">
                        {op.tag === "duplicate" && (
                          <span className="block font-semibold text-amber-700">
                            Exact copy
                          </span>
                        )}
                        {op.tag === "archive" && (
                          <span className="block font-semibold text-slate-700">
                            Not changed in 1+ year
                          </span>
                        )}
                        {op.reason}
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>

            <div className="flex items-center justify-between pt-2">
              <button
                type="button"
                onClick={() => setStage("questions")}
                className="text-xs font-semibold text-slate-600 hover:text-slate-900 cursor-pointer"
              >
                ← Adjust My 5 Answers
              </button>
              <button
                type="button"
                onClick={resetOrganizer}
                className="inline-flex items-center gap-1.5 text-xs font-semibold text-slate-600 hover:text-slate-900 cursor-pointer"
              >
                <RotateCcw className="w-3.5 h-3.5" />
                <span>Start Over With Another Folder</span>
              </button>
            </div>
          </section>
        </div>
      )}

      {/* STAGE: APPLYING TO DISK */}
      {stage === "applying" && (
        <section className="max-w-2xl mx-auto bg-white border border-slate-200 rounded-2xl p-8 text-center space-y-4">
          <Loader2 className="w-7 h-7 text-emerald-600 animate-spin mx-auto" />
          <h2 className="text-xl font-bold text-slate-900">
            Organizing Your Device Folders...
          </h2>
          <p className="text-sm text-slate-600 tabular-nums">
            Processed {applyProgressCount} of {approvedCount} files
          </p>
        </section>
      )}

      {/* STAGE: DONE */}
      {stage === "done" && (
        <section className="max-w-2xl mx-auto bg-white border border-slate-200 rounded-2xl p-8 text-center space-y-5">
          <div className="w-12 h-12 rounded-2xl bg-emerald-50 text-emerald-600 flex items-center justify-center mx-auto">
            <CheckCircle2 className="w-6 h-6" />
          </div>
          <div className="space-y-2">
            <h2 className="text-2xl font-bold text-slate-900">
              Folders Organized &amp; Ready
            </h2>
            <p className="text-sm sm:text-base text-slate-600 leading-relaxed">
              {appliedSummaryMessage}
            </p>
          </div>
          <div className="flex flex-wrap items-center justify-center gap-3 pt-2">
            {appliedRunFolder && undoState !== "done" && (
              <button
                type="button"
                onClick={handleUndoApply}
                disabled={undoState === "working"}
                className="inline-flex items-center gap-2 px-4 py-2.5 text-xs font-semibold text-red-700 bg-white border border-red-300 rounded-xl hover:bg-red-50 disabled:opacity-45 cursor-pointer"
              >
                {undoState === "working" ? (
                  <Loader2 className="w-4 h-4 animate-spin" />
                ) : (
                  <Undo2 className="w-4 h-4" />
                )}
                <span>
                  {undoState === "working" ? "Undoing..." : "Undo Everything"}
                </span>
              </button>
            )}
            <button
              type="button"
              onClick={() => setStage("review")}
              className="px-4 py-2.5 text-xs font-semibold text-slate-700 bg-white border border-slate-300 rounded-xl hover:bg-slate-50 cursor-pointer"
            >
              Back to File List
            </button>
            <button
              type="button"
              onClick={resetOrganizer}
              className="inline-flex items-center gap-2 px-5 py-2.5 text-xs font-semibold text-white bg-blue-600 rounded-xl hover:bg-blue-700 cursor-pointer"
            >
              <Check className="w-4 h-4" />
              <span>Organize Another Folder</span>
            </button>
          </div>
        </section>
      )}
    </div>
  );
}
