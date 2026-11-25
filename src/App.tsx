/**
 * @license
 * SPDX-License-Identifier: Apache-2.0
 */

import { apiFetch, readJson } from './lib/api';
import React, { useEffect, useMemo, useRef, useState } from 'react';
import {
  ArrowRight,
  Check,
  Copy,
  Download,
  ExternalLink,
  FolderOpen,
  Plus,
  Printer,
  RotateCcw,
  Search,
  Trash2,
} from 'lucide-react';
import { FileOrganizerWorkspace } from './components/FileOrganizerWorkspace';
import { MarkdownReport } from './components/MarkdownReport';
import { ResearchProgressPanel } from './components/ResearchProgressPanel';
import type { ResearchPhase } from './components/ResearchProgressPanel';
import type {
  FollowUpEntry,
  GroundingSource,
  ResearchPlanResponse,
  SavedResearchReport,
  SubQuestionItem,
  WorkspacePreferences,
} from './types/research';

type ActiveView = 'research' | 'organizer' | 'history' | 'how-it-works' | 'preferences';
type WorkflowStage = 'idle' | 'planning' | 'awaiting-approval' | 'researching' | 'completed';

const STORAGE_REPORTS_KEY = 'prospers_saved_reports_v1';
const STORAGE_PREFS_KEY = 'prospers_workspace_prefs_v1';

const DEFAULT_PREFS: WorkspacePreferences = {
  defaultMode: 'instant',
  defaultDepth: 'detailed',
  customInstructions: '',
};

interface StarterPrompt {
  category: string;
  title: string;
  prompt: string;
}

const STARTER_PROMPTS: StarterPrompt[] = [
  {
    category: 'Vendor & Product Due Diligence',
    title: 'Compare suppliers, warranties, and recall history',
    prompt:
      'Compare the top commercial solar panel manufacturers in North America by official efficiency ratings, warranty terms, and documented safety recalls.',
  },
  {
    category: 'Compliance & Regulations',
    title: 'Verify current federal & industry rules',
    prompt:
      'What are the current US federal labeling, testing, and safety compliance requirements for importing food-contact stainless steel containers?',
  },
  {
    category: 'Market & Pricing Benchmarks',
    title: 'Analyze commodity drivers and pricing trends',
    prompt:
      'Research current North American industrial copper and aluminum recycling price benchmarks, primary demand drivers, and supply chain bottlenecks.',
  },
  {
    category: 'Operational ROI Brief',
    title: 'Evaluate total cost of ownership with real data',
    prompt:
      'Evaluate the documented 5-year total cost of ownership, maintenance schedules, and payload trade-offs of electric vs. diesel light-duty delivery vans.',
  },
];

function getDomainFromUri(uri: string): string {
  try {
    return new URL(uri).hostname.replace(/^www\./, '');
  } catch {
    return uri;
  }
}

function formatReadableDate(iso: string): string {
  try {
    return new Intl.DateTimeFormat('en-US', {
      month: 'short',
      day: 'numeric',
      year: 'numeric',
      hour: 'numeric',
      minute: '2-digit',
    }).format(new Date(iso));
  } catch {
    return iso;
  }
}

export default function App() {
  const [activeView, setActiveView] = useState<ActiveView>('research');
  const [organizerResetKey, setOrganizerResetKey] = useState<number>(0);

  // Workspace preferences
  const [prefs, setPrefs] = useState<WorkspacePreferences>(() => {
    try {
      const raw = localStorage.getItem(STORAGE_PREFS_KEY);
      if (raw) {
        return { ...DEFAULT_PREFS, ...JSON.parse(raw) };
      }
    } catch {
      // ignore storage errors
    }
    return DEFAULT_PREFS;
  });
  const [prefsSavedToast, setPrefsSavedToast] = useState<boolean>(false);

  // Saved reports library
  const [savedReports, setSavedReports] = useState<SavedResearchReport[]>(() => {
    try {
      const raw = localStorage.getItem(STORAGE_REPORTS_KEY);
      if (raw) return JSON.parse(raw);
    } catch {
      // ignore storage errors
    }
    return [];
  });
  const [historySearch, setHistorySearch] = useState<string>('');

  // Current task inputs
  const [topic, setTopic] = useState<string>('');
  const [context, setContext] = useState<string>('');
  const [showContextField, setShowContextField] = useState<boolean>(false);
  const [workflowMode, setWorkflowMode] = useState<'instant' | 'guided'>(prefs.defaultMode);
  const [depth, setDepth] = useState<'concise' | 'detailed'>(prefs.defaultDepth);

  // Active workflow state
  const [stage, setStage] = useState<WorkflowStage>('idle');
  const [errorMessage, setErrorMessage] = useState<string>('');
  const [reportTitle, setReportTitle] = useState<string>('');
  const [welcomeMessage, setWelcomeMessage] = useState<string>('');
  const [permissionPrompt, setPermissionPrompt] = useState<string>('');
  const [subQuestions, setSubQuestions] = useState<SubQuestionItem[]>([]);
  const [newSubQuestionText, setNewSubQuestionText] = useState<string>('');
  const [clientNote, setClientNote] = useState<string>('');

  // Real-time streaming sub-question progress state
  const [activeSubQIndex, setActiveSubQIndex] = useState<number>(0);
  const [completedSubQIndices, setCompletedSubQIndices] = useState<number[]>([]);
  const [researchPhase, setResearchPhase] = useState<ResearchPhase>('searching');
  const [researchStatusDetail, setResearchStatusDetail] = useState<string>(
    'Searching authoritative primary sources...'
  );
  const [liveSourcesCount, setLiveSourcesCount] = useState<number>(0);

  // Compiled report state
  const [activeReportId, setActiveReportId] = useState<string>('');
  const [reportMarkdown, setReportMarkdown] = useState<string>('');
  const [sources, setSources] = useState<GroundingSource[]>([]);
  const [completedAt, setCompletedAt] = useState<string>('');
  const [followUps, setFollowUps] = useState<FollowUpEntry[]>([]);
  const [followUpInput, setFollowUpInput] = useState<string>('');
  const [isSendingFollowUp, setIsSendingFollowUp] = useState<boolean>(false);
  const [copiedReport, setCopiedReport] = useState<boolean>(false);

  const topicInputRef = useRef<HTMLTextAreaElement | null>(null);

  useEffect(() => {
    try {
      localStorage.setItem(STORAGE_REPORTS_KEY, JSON.stringify(savedReports));
    } catch {
      // ignore quota errors
    }
  }, [savedReports]);

  const filteredReports = useMemo(() => {
    const q = historySearch.trim().toLowerCase();
    if (!q) return savedReports;
    return savedReports.filter(
      (item) =>
        item.title.toLowerCase().includes(q) ||
        item.topic.toLowerCase().includes(q) ||
        item.reportMarkdown.toLowerCase().includes(q)
    );
  }, [savedReports, historySearch]);

  const saveReportToLibrary = (entry: SavedResearchReport) => {
    setSavedReports((prev) => {
      const existingIndex = prev.findIndex((r) => r.id === entry.id);
      if (existingIndex !== -1) {
        const updated = [...prev];
        updated[existingIndex] = entry;
        return updated;
      }
      return [entry, ...prev];
    });
  };

  const resetForNewTask = () => {
    if (activeView === 'organizer') {
      setOrganizerResetKey((k) => k + 1);
      return;
    }
    setActiveView('research');
    setStage('idle');
    setErrorMessage('');
    setTopic('');
    setContext('');
    setShowContextField(false);
    setReportTitle('');
    setWelcomeMessage('');
    setPermissionPrompt('');
    setSubQuestions([]);
    setNewSubQuestionText('');
    setClientNote('');
    setActiveReportId('');
    setReportMarkdown('');
    setSources([]);
    setCompletedAt('');
    setFollowUps([]);
    setFollowUpInput('');
    window.setTimeout(() => {
      topicInputRef.current?.focus();
    }, 50);
  };

  // Real-time NDJSON streaming execution for live per-sub-question status updates
  const runDeepSynthesis = async (
    targetTopic: string,
    targetContext: string,
    targetTitle: string,
    approvedItems: SubQuestionItem[],
    note: string,
    selectedDepth: 'concise' | 'detailed'
  ) => {
    const enabledItems = approvedItems.filter((item) => item.enabled);
    setStage('researching');
    setErrorMessage('');
    setActiveSubQIndex(0);
    setCompletedSubQIndices([]);
    setResearchPhase('searching');
    setResearchStatusDetail(
      `Searching primary sources for sub-question 1 of ${Math.max(1, enabledItems.length)}...`
    );
    setLiveSourcesCount(0);

    // Gentle pacing fallback timer so long searches before the first marker still advance smoothly if needed
    let currentPacedIdx = 0;
    const fallbackTimer = window.setInterval(() => {
      setActiveSubQIndex((prev) => {
        if (prev < 0) return prev; // already in synthesis
        if (currentPacedIdx < enabledItems.length - 1) {
          currentPacedIdx = Math.max(prev, currentPacedIdx) + 1;
          setCompletedSubQIndices((done) =>
            done.includes(currentPacedIdx - 1) ? done : [...done, currentPacedIdx - 1]
          );
          setResearchStatusDetail(
            `Investigating sub-question ${currentPacedIdx + 1} of ${enabledItems.length}...`
          );
          return currentPacedIdx;
        }
        return prev;
      });
    }, 6500);

    try {
      const response = await apiFetch('/api/research/execute', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          topic: targetTopic,
          context: targetContext,
          subQuestions: enabledItems.map((item) => ({
            question: item.question,
            stepDescription: item.stepDescription,
          })),
          clientNote: note,
          depth: selectedDepth,
          customInstructions: prefs.customInstructions,
          stream: true,
        }),
      });

      const isStream = (response.headers.get('content-type') ?? '').includes('ndjson');
      if (!response.ok || !response.body || !isStream) {
        // readJson turns a web page or outage into a plain-English message
        const errJson = await readJson<{ error?: string }>(response);
        throw new Error(errJson.error || 'Unable to compile the research report.');
      }

      const reader = response.body.getReader();
      const decoder = new TextDecoder();
      let buffer = '';
      let finalPayload: {
        reportMarkdown: string;
        sources: GroundingSource[];
        completedAt: string;
      } | null = null;

      while (true) {
        const { value, done } = await reader.read();
        if (done) break;
        buffer += decoder.decode(value, { stream: true });
        const lines = buffer.split('\n');
        buffer = lines.pop() ?? '';

        for (const rawLine of lines) {
          const trimmed = rawLine.trim();
          if (!trimmed) continue;
          const event = JSON.parse(trimmed) as {
            type: 'progress' | 'sources_count' | 'complete' | 'error';
            activeIndex?: number;
            completedIndices?: number[];
            phase?: ResearchPhase;
            detail?: string;
            count?: number;
            reportMarkdown?: string;
            sources?: GroundingSource[];
            completedAt?: string;
            error?: string;
          };

          if (event.type === 'error') {
            throw new Error(event.error || 'Unable to complete the research report.');
          }

          if (event.type === 'progress') {
            if (typeof event.activeIndex === 'number') {
              currentPacedIdx = Math.max(currentPacedIdx, event.activeIndex);
              setActiveSubQIndex(event.activeIndex);
            }
            if (Array.isArray(event.completedIndices)) {
              setCompletedSubQIndices(event.completedIndices);
            }
            if (event.phase) {
              setResearchPhase(event.phase);
            }
            if (event.detail) {
              setResearchStatusDetail(event.detail);
            }
          } else if (event.type === 'sources_count' && typeof event.count === 'number') {
            setLiveSourcesCount(event.count);
          } else if (event.type === 'complete') {
            finalPayload = {
              reportMarkdown: event.reportMarkdown ?? '',
              sources: Array.isArray(event.sources) ? event.sources : [],
              completedAt: event.completedAt || new Date().toISOString(),
            };
          }
        }
      }

      if (!finalPayload) {
        throw new Error('The research stream closed before completing. Please try again.');
      }

      const id = `report_${Date.now()}`;
      setActiveReportId(id);
      setReportMarkdown(finalPayload.reportMarkdown);
      setSources(finalPayload.sources);
      setCompletedAt(finalPayload.completedAt);
      setFollowUps([]);
      setStage('completed');

      saveReportToLibrary({
        id,
        title: targetTitle || targetTopic.slice(0, 70),
        topic: targetTopic,
        context: targetContext,
        depth: selectedDepth,
        subQuestions: approvedItems,
        reportMarkdown: finalPayload.reportMarkdown,
        sources: finalPayload.sources,
        followUps: [],
        createdAt: finalPayload.completedAt,
      });
    } catch (err) {
      setErrorMessage(
        err instanceof Error ? err.message : 'Something went wrong during web verification.'
      );
      setStage(approvedItems.length > 0 ? 'awaiting-approval' : 'idle');
    } finally {
      window.clearInterval(fallbackTimer);
    }
  };

  const handleStartResearch = async (overrideTopic?: string) => {
    const chosenTopic = (overrideTopic ?? topic).trim();
    if (!chosenTopic) {
      topicInputRef.current?.focus();
      return;
    }
    if (overrideTopic) {
      setTopic(overrideTopic);
    }

    setErrorMessage('');
    setStage('planning');
    setSubQuestions([]);
    setReportMarkdown('');
    setSources([]);
    setFollowUps([]);

    try {
      const response = await apiFetch('/api/research/plan', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          topic: chosenTopic,
          context: context.trim(),
          customInstructions: prefs.customInstructions,
        }),
      });

      const data = (await readJson(response)) as unknown as ResearchPlanResponse & { error?: string };
      if (!response.ok) {
        throw new Error(data.error || 'Unable to build the research plan.');
      }

      const mappedSubQuestions: SubQuestionItem[] = (data.subQuestions ?? []).map((sq, idx) => ({
        id: sq.id || `sq_${idx + 1}`,
        question: sq.question,
        stepDescription: sq.stepDescription,
        enabled: true,
      }));

      const resolvedTitle = data.reportTitle || chosenTopic;
      setReportTitle(resolvedTitle);
      setWelcomeMessage(data.welcomeMessage || '');
      setPermissionPrompt(
        data.permissionPrompt || 'Would you like me to proceed with researching these questions?'
      );
      setSubQuestions(mappedSubQuestions);

      if (workflowMode === 'instant') {
        await runDeepSynthesis(
          chosenTopic,
          context.trim(),
          resolvedTitle,
          mappedSubQuestions,
          '',
          depth
        );
      } else {
        setStage('awaiting-approval');
      }
    } catch (err) {
      setErrorMessage(
        err instanceof Error ? err.message : 'Unable to start research right now. Please try again.'
      );
      setStage('idle');
    }
  };

  const handleAddSubQuestion = () => {
    const trimmed = newSubQuestionText.trim();
    if (!trimmed) return;
    setSubQuestions((prev) => [
      ...prev,
      {
        id: `custom_${Date.now()}`,
        question: trimmed,
        stepDescription: 'Custom question added by client for primary-source verification.',
        enabled: true,
      },
    ]);
    setNewSubQuestionText('');
  };

  const handleFollowUpSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    const trimmed = followUpInput.trim();
    if (!trimmed || isSendingFollowUp) return;

    setIsSendingFollowUp(true);
    setErrorMessage('');

    try {
      const combinedPriorContext = [
        reportMarkdown,
        ...followUps.map((f) => `Follow-up Q: ${f.question}\n\nAnswer:\n${f.answerMarkdown}`),
      ].join('\n\n---\n\n');

      const response = await apiFetch('/api/research/followup', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          topic,
          previousReport: combinedPriorContext,
          followUpQuestion: trimmed,
          customInstructions: prefs.customInstructions,
        }),
      });

      const data = await readJson<{ error?: string } & Record<string, any>>(response);
      if (!response.ok) {
        throw new Error(data.error || 'Unable to complete follow-up check.');
      }

      const newEntry: FollowUpEntry = {
        id: `fu_${Date.now()}`,
        question: trimmed,
        answerMarkdown: data.answerMarkdown || '',
        sources: Array.isArray(data.sources) ? data.sources : [],
        completedAt: data.completedAt || new Date().toISOString(),
      };

      const nextFollowUps = [...followUps, newEntry];
      setFollowUps(nextFollowUps);
      setFollowUpInput('');

      const existingUris = new Set(sources.map((s) => s.uri));
      const mergedSources = [...sources];
      for (const s of newEntry.sources) {
        if (!existingUris.has(s.uri)) {
          existingUris.add(s.uri);
          mergedSources.push(s);
        }
      }
      setSources(mergedSources);

      if (activeReportId) {
        saveReportToLibrary({
          id: activeReportId,
          title: reportTitle || topic.slice(0, 70),
          topic,
          context,
          depth,
          subQuestions,
          reportMarkdown,
          sources: mergedSources,
          followUps: nextFollowUps,
          createdAt: completedAt || new Date().toISOString(),
        });
      }
    } catch (err) {
      setErrorMessage(
        err instanceof Error ? err.message : 'Unable to answer follow-up right now.'
      );
    } finally {
      setIsSendingFollowUp(false);
    }
  };

  const buildPlainExportText = () => {
    const lines: string[] = [
      `# ${reportTitle || topic}`,
      `Prepared by Prospers Solutions · ${completedAt ? formatReadableDate(completedAt) : ''}`,
      '',
      `Original Request: ${topic}`,
      '',
      reportMarkdown,
    ];

    if (followUps.length > 0) {
      lines.push('', '---', '## Follow-Up Clarifications');
      for (const item of followUps) {
        lines.push('', `### Question: ${item.question}`, '', item.answerMarkdown);
      }
    }

    if (sources.length > 0) {
      lines.push('', '---', '## Verified Web Sources');
      sources.forEach((src, index) => {
        lines.push(`${index + 1}. ${src.title} — ${src.uri}`);
      });
    }

    return lines.join('\n');
  };

  const handleCopyFullReport = async () => {
    const text = buildPlainExportText();
    try {
      await navigator.clipboard.writeText(text);
    } catch {
      const textarea = document.createElement('textarea');
      textarea.value = text;
      document.body.appendChild(textarea);
      textarea.select();
      document.execCommand('copy');
      document.body.removeChild(textarea);
    }
    setCopiedReport(true);
    window.setTimeout(() => setCopiedReport(false), 1800);
  };

  const handleDownloadReport = () => {
    const text = buildPlainExportText();
    const safeSlug = (reportTitle || topic || 'research-report')
      .toLowerCase()
      .replace(/[^a-z0-9]+/g, '-')
      .replace(/^-|-$/g, '')
      .slice(0, 50);
    const blob = new Blob([text], { type: 'text/markdown;charset=utf-8' });
    const url = URL.createObjectURL(blob);
    const link = document.createElement('a');
    link.href = url;
    link.download = `${safeSlug || 'prospers-report'}.md`;
    document.body.appendChild(link);
    link.click();
    document.body.removeChild(link);
    URL.revokeObjectURL(url);
  };

  const openSavedReport = (saved: SavedResearchReport) => {
    setTopic(saved.topic);
    setContext(saved.context);
    setDepth(saved.depth);
    setReportTitle(saved.title);
    setSubQuestions(saved.subQuestions);
    setActiveReportId(saved.id);
    setReportMarkdown(saved.reportMarkdown);
    setSources(saved.sources);
    setFollowUps(saved.followUps ?? []);
    setCompletedAt(saved.createdAt);
    setErrorMessage('');
    setStage('completed');
    setActiveView('research');
  };

  const deleteSavedReport = (id: string) => {
    setSavedReports((prev) => prev.filter((r) => r.id !== id));
    if (activeReportId === id) {
      resetForNewTask();
    }
  };

  const handleSavePreferences = (e: React.FormEvent) => {
    e.preventDefault();
    try {
      localStorage.setItem(STORAGE_PREFS_KEY, JSON.stringify(prefs));
    } catch {
      // ignore storage error
    }
    setWorkflowMode(prefs.defaultMode);
    setDepth(prefs.defaultDepth);
    setPrefsSavedToast(true);
    window.setTimeout(() => setPrefsSavedToast(false), 2000);
  };

  const enabledQuestionCount = subQuestions.filter((q) => q.enabled).length;

  return (
    <div className="min-h-screen flex flex-col bg-slate-50 text-slate-900">
      {/* Strict 3-Zone Top Bar Contract (hidden when printing PDF) */}
      <header className="sticky top-0 z-20 bg-white border-b border-slate-200 px-6 py-3.5 print:hidden">
        <div className="max-w-[1200px] mx-auto flex items-center justify-between gap-8">
          <button
            type="button"
            onClick={() => setActiveView('research')}
            className="text-base sm:text-lg font-bold tracking-tight text-slate-900 whitespace-nowrap shrink-0 cursor-pointer"
          >
            Prospers Solutions
          </button>

          <nav className="hidden md:flex items-center gap-6 text-sm font-medium text-slate-600">
            <button
              type="button"
              onClick={() => setActiveView('research')}
              className={`hover:text-slate-900 hover:underline underline-offset-4 transition-colors whitespace-nowrap shrink-0 cursor-pointer ${
                activeView === 'research' ? 'text-slate-900 font-semibold' : ''
              }`}
            >
              Web Research
            </button>
            <button
              type="button"
              onClick={() => setActiveView('organizer')}
              className={`hover:text-slate-900 hover:underline underline-offset-4 transition-colors whitespace-nowrap shrink-0 cursor-pointer ${
                activeView === 'organizer' ? 'text-slate-900 font-semibold' : ''
              }`}
            >
              File Organizer
            </button>
            <button
              type="button"
              onClick={() => setActiveView('history')}
              className={`hover:text-slate-900 hover:underline underline-offset-4 transition-colors whitespace-nowrap shrink-0 cursor-pointer tabular-nums ${
                activeView === 'history' ? 'text-slate-900 font-semibold' : ''
              }`}
            >
              Saved Reports ({savedReports.length})
            </button>
            <button
              type="button"
              onClick={() => setActiveView('how-it-works')}
              className={`hover:text-slate-900 hover:underline underline-offset-4 transition-colors whitespace-nowrap shrink-0 cursor-pointer ${
                activeView === 'how-it-works' ? 'text-slate-900 font-semibold' : ''
              }`}
            >
              How It Works
            </button>
            <button
              type="button"
              onClick={() => setActiveView('preferences')}
              className={`hover:text-slate-900 hover:underline underline-offset-4 transition-colors whitespace-nowrap shrink-0 cursor-pointer ${
                activeView === 'preferences' ? 'text-slate-900 font-semibold' : ''
              }`}
            >
              Preferences
            </button>
          </nav>

          <div className="flex items-center shrink-0">
            <button
              type="button"
              onClick={resetForNewTask}
              className="inline-flex items-center gap-2 px-4 py-2 text-xs font-semibold text-white bg-blue-600 rounded-lg hover:bg-blue-700 focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-blue-600 transition-colors whitespace-nowrap shrink-0 cursor-pointer"
            >
              <Plus className="w-3.5 h-3.5" />
              <span>{activeView === 'organizer' ? 'New Folder' : 'New Task'}</span>
            </button>
          </div>
        </div>

        {/* Compact mobile navigation row */}
        <div className="flex md:hidden items-center gap-4 pt-3 mt-3 border-t border-slate-100 text-xs font-medium text-slate-600 overflow-x-auto">
          <button
            type="button"
            onClick={() => setActiveView('research')}
            className={`whitespace-nowrap shrink-0 ${
              activeView === 'research' ? 'text-blue-700 font-semibold' : ''
            }`}
          >
            Web Research
          </button>
          <button
            type="button"
            onClick={() => setActiveView('organizer')}
            className={`whitespace-nowrap shrink-0 ${
              activeView === 'organizer' ? 'text-blue-700 font-semibold' : ''
            }`}
          >
            File Organizer
          </button>
          <button
            type="button"
            onClick={() => setActiveView('history')}
            className={`whitespace-nowrap shrink-0 tabular-nums ${
              activeView === 'history' ? 'text-blue-700 font-semibold' : ''
            }`}
          >
            Saved Reports ({savedReports.length})
          </button>
          <button
            type="button"
            onClick={() => setActiveView('how-it-works')}
            className={`whitespace-nowrap shrink-0 ${
              activeView === 'how-it-works' ? 'text-blue-700 font-semibold' : ''
            }`}
          >
            How It Works
          </button>
          <button
            type="button"
            onClick={() => setActiveView('preferences')}
            className={`whitespace-nowrap shrink-0 ${
              activeView === 'preferences' ? 'text-blue-700 font-semibold' : ''
            }`}
          >
            Preferences
          </button>
        </div>
      </header>

      <main className="flex-1 max-w-[1200px] w-full mx-auto px-6 py-8 sm:py-10">
        {/* Quick Workspace Switcher on Main Views */}
        {(activeView === 'research' || activeView === 'organizer') && (
          <div className="flex justify-center mb-8 print:hidden">
            <div className="inline-flex items-center gap-1 p-1 bg-slate-200/70 rounded-xl">
              <button
                type="button"
                onClick={() => setActiveView('research')}
                className={`inline-flex items-center gap-2 px-4 py-2 text-xs sm:text-sm font-semibold rounded-lg transition-colors whitespace-nowrap shrink-0 cursor-pointer ${
                  activeView === 'research'
                    ? 'bg-white text-slate-900 shadow-xs'
                    : 'text-slate-600 hover:text-slate-900'
                }`}
              >
                <Search className="w-4 h-4" />
                <span>Deep Web Research</span>
              </button>
              <button
                type="button"
                onClick={() => setActiveView('organizer')}
                className={`inline-flex items-center gap-2 px-4 py-2 text-xs sm:text-sm font-semibold rounded-lg transition-colors whitespace-nowrap shrink-0 cursor-pointer ${
                  activeView === 'organizer'
                    ? 'bg-white text-slate-900 shadow-xs'
                    : 'text-slate-600 hover:text-slate-900'
                }`}
              >
                <FolderOpen className="w-4 h-4" />
                <span>Device File Organizer</span>
              </button>
            </div>
          </div>
        )}

        {/* VIEW 1: PRIMARY RESEARCH WORKSPACE */}
        {activeView === 'research' && (
          <div className="space-y-8">
            {errorMessage && (
              <div
                role="alert"
                className="max-w-3xl mx-auto p-4 bg-red-50 border border-red-200 rounded-xl flex flex-col sm:flex-row sm:items-center justify-between gap-3 text-sm text-red-900 print:hidden"
              >
                <span>{errorMessage}</span>
                <div className="flex items-center gap-2 shrink-0">
                  {topic.trim() && (
                    <button
                      type="button"
                      onClick={() => {
                        setErrorMessage('');
                        if (stage === 'awaiting-approval' && subQuestions.length > 0) {
                          runDeepSynthesis(
                            topic,
                            context,
                            reportTitle,
                            subQuestions,
                            clientNote,
                            depth
                          );
                        } else {
                          handleStartResearch();
                        }
                      }}
                      className="px-3.5 py-1.5 text-xs font-semibold text-white bg-red-700 rounded-lg hover:bg-red-800 transition-colors whitespace-nowrap shrink-0 cursor-pointer"
                    >
                      Retry Now
                    </button>
                  )}
                  <button
                    type="button"
                    onClick={() => setErrorMessage('')}
                    className="px-3.5 py-1.5 text-xs font-semibold bg-white border border-red-300 rounded-lg hover:bg-red-100 transition-colors whitespace-nowrap shrink-0 cursor-pointer"
                  >
                    Dismiss
                  </button>
                </div>
              </div>
            )}

            {/* STAGE: IDLE */}
            {stage === 'idle' && (
              <div className="space-y-10">
                <section className="max-w-3xl mx-auto text-center space-y-3">
                  <div className="flex items-center justify-center gap-2 text-xs text-slate-500">
                    <span>Multi-Step Web Verification</span>
                    <span aria-hidden="true">·</span>
                    <span>Primary Source Citations</span>
                    <span aria-hidden="true">·</span>
                    <span>Clear Actionable Advice</span>
                  </div>
                  <h1 className="text-3xl sm:text-4xl font-bold tracking-tight text-slate-900 text-balance">
                    What can we research and verify for you today?
                  </h1>
                  <p className="text-base text-slate-600 max-w-2xl mx-auto leading-relaxed">
                    Type any question, decision, or topic in plain English. Prospers Solutions
                    breaks it into focused sub-questions, checks authoritative sources in real time,
                    and compiles a clear report with verified links.
                  </p>
                </section>

                {/* Main Drop-in Input Box */}
                <section className="max-w-3xl mx-auto bg-white border border-slate-200 rounded-2xl p-5 sm:p-6 shadow-xs space-y-4">
                  <div>
                    <label htmlFor="research-topic-input" className="sr-only">
                      Research question or task
                    </label>
                    <textarea
                      ref={topicInputRef}
                      id="research-topic-input"
                      rows={4}
                      value={topic}
                      onChange={(e) => setTopic(e.target.value)}
                      onKeyDown={(e) => {
                        if ((e.metaKey || e.ctrlKey) && e.key === 'Enter') {
                          e.preventDefault();
                          handleStartResearch();
                        }
                      }}
                      placeholder="Example: Compare the warranty coverage, safety certifications, and real-world operating costs of..."
                      className="w-full p-3.5 text-base bg-slate-50/60 border border-slate-200 rounded-xl text-slate-900 placeholder:text-slate-400 focus:bg-white focus:outline-none focus:ring-2 focus:ring-blue-600/20 focus:border-blue-600 transition-colors resize-y"
                    />
                  </div>

                  {showContextField ? (
                    <div className="space-y-1.5">
                      <div className="flex items-center justify-between">
                        <label
                          htmlFor="extra-context-input"
                          className="text-xs font-semibold text-slate-700"
                        >
                          Optional Details (Region, budget, industry, or specific requirements)
                        </label>
                        <button
                          type="button"
                          onClick={() => {
                            setContext('');
                            setShowContextField(false);
                          }}
                          className="text-xs text-slate-500 hover:text-slate-800 cursor-pointer"
                        >
                          Remove
                        </button>
                      </div>
                      <input
                        id="extra-context-input"
                        type="text"
                        value={context}
                        onChange={(e) => setContext(e.target.value)}
                        placeholder="e.g., Focus on US regulations for a small distributor in Ohio"
                        className="w-full px-3.5 py-2 text-sm bg-white border border-slate-200 rounded-lg text-slate-900 placeholder:text-slate-400 focus:outline-none focus:ring-2 focus:ring-blue-600/20 focus:border-blue-600"
                      />
                    </div>
                  ) : (
                    <div>
                      <button
                        type="button"
                        onClick={() => setShowContextField(true)}
                        className="text-xs font-medium text-slate-600 hover:text-slate-900 underline underline-offset-4 cursor-pointer"
                      >
                        + Add specific region, industry, or budget details (optional)
                      </button>
                    </div>
                  )}

                  <div className="pt-3 border-t border-slate-100 flex flex-col sm:flex-row sm:items-center justify-between gap-4">
                    <div className="flex flex-wrap items-center gap-3">
                      <div className="flex items-center gap-1 p-1 bg-slate-100 rounded-lg">
                        <button
                          type="button"
                          onClick={() => setWorkflowMode('instant')}
                          className={`px-3 py-1.5 text-xs font-medium rounded-md transition-colors whitespace-nowrap shrink-0 cursor-pointer ${
                            workflowMode === 'instant'
                              ? 'bg-white text-slate-900 shadow-xs'
                              : 'text-slate-600 hover:text-slate-900'
                          }`}
                        >
                          Instant Report
                        </button>
                        <button
                          type="button"
                          onClick={() => setWorkflowMode('guided')}
                          className={`px-3 py-1.5 text-xs font-medium rounded-md transition-colors whitespace-nowrap shrink-0 cursor-pointer ${
                            workflowMode === 'guided'
                              ? 'bg-white text-slate-900 shadow-xs'
                              : 'text-slate-600 hover:text-slate-900'
                          }`}
                        >
                          Review Steps First
                        </button>
                      </div>

                      <div className="flex items-center gap-1 p-1 bg-slate-100 rounded-lg">
                        <button
                          type="button"
                          onClick={() => setDepth('detailed')}
                          className={`px-3 py-1.5 text-xs font-medium rounded-md transition-colors whitespace-nowrap shrink-0 cursor-pointer ${
                            depth === 'detailed'
                              ? 'bg-white text-slate-900 shadow-xs'
                              : 'text-slate-600 hover:text-slate-900'
                          }`}
                        >
                          Detailed
                        </button>
                        <button
                          type="button"
                          onClick={() => setDepth('concise')}
                          className={`px-3 py-1.5 text-xs font-medium rounded-md transition-colors whitespace-nowrap shrink-0 cursor-pointer ${
                            depth === 'concise'
                              ? 'bg-white text-slate-900 shadow-xs'
                              : 'text-slate-600 hover:text-slate-900'
                          }`}
                        >
                          Quick Brief
                        </button>
                      </div>
                    </div>

                    <button
                      type="button"
                      onClick={() => handleStartResearch()}
                      disabled={!topic.trim()}
                      className="inline-flex items-center justify-center gap-2 px-6 py-2.5 text-sm font-semibold text-white bg-blue-600 rounded-xl hover:bg-blue-700 disabled:opacity-45 disabled:cursor-not-allowed transition-colors whitespace-nowrap shrink-0 cursor-pointer"
                    >
                      <span>Start Research</span>
                      <ArrowRight className="w-4 h-4" />
                    </button>
                  </div>
                </section>

                {/* One-Click Starter Examples */}
                <section className="max-w-3xl mx-auto space-y-3">
                  <div className="flex items-center justify-between">
                    <h2 className="text-xs font-semibold text-slate-500">
                      Or try a one-click example
                    </h2>
                  </div>
                  <div className="grid grid-cols-1 sm:grid-cols-2 gap-3.5">
                    {STARTER_PROMPTS.map((item) => (
                      <button
                        key={item.title}
                        type="button"
                        onClick={() => handleStartResearch(item.prompt)}
                        className="text-left p-4 bg-white border border-slate-200 rounded-xl hover:border-blue-400 hover:bg-blue-50/20 transition-colors space-y-1.5 cursor-pointer group"
                      >
                        <div className="text-xs text-slate-500">{item.category}</div>
                        <div className="text-sm font-semibold text-slate-900 group-hover:text-blue-700 transition-colors">
                          {item.title}
                        </div>
                        <p className="text-xs text-slate-600 line-clamp-2 leading-relaxed">
                          {item.prompt}
                        </p>
                      </button>
                    ))}
                  </div>
                </section>
              </div>
            )}

            {/* STAGE: PLANNING SKELETON */}
            {stage === 'planning' && (
              <section className="max-w-3xl mx-auto bg-white border border-slate-200 rounded-2xl p-6 sm:p-8 space-y-6">
                <div className="space-y-2">
                  <div className="text-xs font-medium text-blue-700">Step 1 of 2 · Planning</div>
                  <h2 className="text-xl font-bold text-slate-900">
                    Breaking your question into focused research steps...
                  </h2>
                  <p className="text-sm text-slate-600">{topic}</p>
                </div>
                <div className="space-y-3 pt-2">
                  {[1, 2, 3, 4].map((num) => (
                    <div key={num} className="h-14 bg-slate-100 rounded-xl animate-pulse" />
                  ))}
                </div>
              </section>
            )}

            {/* STAGE: AWAITING CLIENT APPROVAL */}
            {stage === 'awaiting-approval' && (
              <section className="max-w-3xl mx-auto bg-white border border-slate-200 rounded-2xl p-6 sm:p-8 space-y-6">
                <div className="space-y-2 pb-5 border-b border-slate-200">
                  <div className="flex items-center gap-2 text-xs text-slate-500">
                    <span>Step 1 Complete</span>
                    <span aria-hidden="true">·</span>
                    <span>Ready for Your Approval</span>
                  </div>
                  <h2 className="text-xl sm:text-2xl font-bold text-slate-900">
                    {reportTitle || 'Proposed Research Plan'}
                  </h2>
                  {welcomeMessage && (
                    <p className="text-sm sm:text-base text-slate-700 leading-relaxed">
                      {welcomeMessage}
                    </p>
                  )}
                </div>

                <div className="space-y-3">
                  <div className="flex items-center justify-between text-xs text-slate-500">
                    <span className="font-semibold text-slate-800">
                      Planned Sub-Questions to Verify
                    </span>
                    <span className="tabular-nums">
                      {enabledQuestionCount} of {subQuestions.length} selected
                    </span>
                  </div>

                  <div className="divide-y divide-slate-200 border border-slate-200 rounded-xl">
                    {subQuestions.map((item, idx) => (
                      <label
                        key={item.id}
                        className="flex items-start gap-3.5 p-4 hover:bg-slate-50/80 transition-colors cursor-pointer"
                      >
                        <input
                          type="checkbox"
                          checked={item.enabled}
                          onChange={(e) => {
                            const checked = e.target.checked;
                            setSubQuestions((prev) =>
                              prev.map((q) => (q.id === item.id ? { ...q, enabled: checked } : q))
                            );
                          }}
                          className="mt-1 w-4 h-4 rounded border-slate-300 text-blue-600 focus:ring-blue-600"
                        />
                        <div className="space-y-1 min-w-0 flex-1">
                          <div className="text-sm font-semibold text-slate-900">
                            <span className="font-mono text-xs text-slate-400 mr-2 tabular-nums">
                              0{idx + 1}.
                            </span>
                            {item.question}
                          </div>
                          <p className="text-xs text-slate-600 leading-relaxed">
                            {item.stepDescription}
                          </p>
                        </div>
                      </label>
                    ))}
                  </div>

                  <div className="flex items-center gap-2 pt-1">
                    <input
                      type="text"
                      value={newSubQuestionText}
                      onChange={(e) => setNewSubQuestionText(e.target.value)}
                      onKeyDown={(e) => {
                        if (e.key === 'Enter') {
                          e.preventDefault();
                          handleAddSubQuestion();
                        }
                      }}
                      placeholder="Want us to check another specific angle? Add it here..."
                      className="flex-1 px-3.5 py-2 text-sm bg-white border border-slate-200 rounded-lg text-slate-900 placeholder:text-slate-400 focus:outline-none focus:border-blue-600"
                    />
                    <button
                      type="button"
                      onClick={handleAddSubQuestion}
                      disabled={!newSubQuestionText.trim()}
                      className="px-3.5 py-2 text-xs font-semibold text-slate-700 bg-slate-100 rounded-lg hover:bg-slate-200 disabled:opacity-45 transition-colors whitespace-nowrap shrink-0 cursor-pointer"
                    >
                      Add Step
                    </button>
                  </div>
                </div>

                <div className="space-y-2 pt-2">
                  <label htmlFor="approval-note" className="text-xs font-semibold text-slate-700">
                    Optional Note Before Continuing
                  </label>
                  <input
                    id="approval-note"
                    type="text"
                    value={clientNote}
                    onChange={(e) => setClientNote(e.target.value)}
                    placeholder="Any extra instructions before we search primary sources?"
                    className="w-full px-3.5 py-2 text-sm bg-white border border-slate-200 rounded-lg text-slate-900 placeholder:text-slate-400 focus:outline-none focus:border-blue-600"
                  />
                </div>

                <div className="pt-4 border-t border-slate-200 flex flex-col sm:flex-row sm:items-center justify-between gap-4">
                  <p className="text-xs text-slate-600">{permissionPrompt}</p>
                  <div className="flex items-center gap-3 shrink-0">
                    <button
                      type="button"
                      onClick={resetForNewTask}
                      className="px-4 py-2.5 text-xs font-semibold text-slate-700 bg-white border border-slate-300 rounded-xl hover:bg-slate-50 transition-colors whitespace-nowrap shrink-0 cursor-pointer"
                    >
                      Edit Question
                    </button>
                    <button
                      type="button"
                      onClick={() =>
                        runDeepSynthesis(
                          topic,
                          context,
                          reportTitle,
                          subQuestions,
                          clientNote,
                          depth
                        )
                      }
                      disabled={enabledQuestionCount === 0}
                      className="inline-flex items-center gap-2 px-5 py-2.5 text-sm font-semibold text-white bg-blue-600 rounded-xl hover:bg-blue-700 disabled:opacity-45 transition-colors whitespace-nowrap shrink-0 cursor-pointer"
                    >
                      <span>Approve &amp; Build Report</span>
                      <ArrowRight className="w-4 h-4" />
                    </button>
                  </div>
                </div>
              </section>
            )}

            {/* STAGE: REAL-TIME SUB-QUESTION PROGRESS INDICATOR */}
            {stage === 'researching' && (
              <ResearchProgressPanel
                reportTitle={reportTitle}
                subQuestions={subQuestions}
                activeIndex={activeSubQIndex}
                completedIndices={completedSubQIndices}
                phase={researchPhase}
                statusDetail={researchStatusDetail}
                sourcesFoundCount={liveSourcesCount}
              />
            )}

            {/* STAGE: COMPLETED REPORT */}
            {stage === 'completed' && (
              <div className="grid grid-cols-1 lg:grid-cols-12 gap-8 items-start">
                <div className="lg:col-span-8 space-y-6">
                  <div className="bg-white border border-slate-200 rounded-xl px-5 py-3.5 flex flex-wrap items-center justify-between gap-3 print:hidden">
                    <div className="flex items-center gap-2 text-xs text-slate-500 tabular-nums">
                      <span>Verified Report</span>
                      {completedAt && (
                        <>
                          <span aria-hidden="true">·</span>
                          <span>{formatReadableDate(completedAt)}</span>
                        </>
                      )}
                      <span aria-hidden="true">·</span>
                      <span>{sources.length} web sources</span>
                    </div>

                    <div className="flex flex-wrap items-center gap-2">
                      <button
                        type="button"
                        onClick={handleCopyFullReport}
                        className="inline-flex items-center gap-1.5 px-3 py-1.5 text-xs font-semibold text-slate-700 bg-white border border-slate-300 rounded-lg hover:bg-slate-50 transition-colors whitespace-nowrap shrink-0 cursor-pointer"
                      >
                        {copiedReport ? (
                          <Check className="w-3.5 h-3.5 text-emerald-600" />
                        ) : (
                          <Copy className="w-3.5 h-3.5" />
                        )}
                        <span>{copiedReport ? 'Copied' : 'Copy Report'}</span>
                      </button>
                      <button
                        type="button"
                        onClick={handleDownloadReport}
                        className="inline-flex items-center gap-1.5 px-3 py-1.5 text-xs font-semibold text-slate-700 bg-white border border-slate-300 rounded-lg hover:bg-slate-50 transition-colors whitespace-nowrap shrink-0 cursor-pointer"
                      >
                        <Download className="w-3.5 h-3.5" />
                        <span>Download</span>
                      </button>
                      <button
                        type="button"
                        onClick={() => window.print()}
                        className="inline-flex items-center gap-1.5 px-3 py-1.5 text-xs font-semibold text-slate-900 bg-slate-100 rounded-lg hover:bg-slate-200 transition-colors whitespace-nowrap shrink-0 cursor-pointer"
                      >
                        <Printer className="w-3.5 h-3.5" />
                        <span>Print / Save PDF</span>
                      </button>
                    </div>
                  </div>

                  <article className="bg-white border border-slate-200 rounded-2xl p-6 sm:p-10 print:border-none print:p-0 space-y-6">
                    <header className="pb-6 border-b border-slate-200 space-y-2">
                      <div className="text-xs text-slate-500">
                        Prospers Solutions Research Brief
                      </div>
                      <h1 className="text-2xl sm:text-3xl font-bold tracking-tight text-slate-900 text-balance">
                        {reportTitle || topic}
                      </h1>
                      <p className="text-sm text-slate-600">
                        <strong className="font-semibold text-slate-800">Client Request:</strong>{' '}
                        {topic}
                      </p>
                    </header>

                    <MarkdownReport content={reportMarkdown} />

                    {followUps.length > 0 && (
                      <div className="pt-6 border-t border-slate-200 space-y-6">
                        <h2 className="text-lg font-bold text-slate-900">
                          Follow-Up Verification &amp; Additional Details
                        </h2>
                        {followUps.map((entry) => (
                          <div
                            key={entry.id}
                            className="pt-4 first:pt-0 border-t first:border-t-0 border-slate-100 space-y-3"
                          >
                            <div className="text-sm font-semibold text-blue-800">
                              Follow-Up Question: {entry.question}
                            </div>
                            <MarkdownReport content={entry.answerMarkdown} />
                          </div>
                        ))}
                      </div>
                    )}
                  </article>

                  <form
                    onSubmit={handleFollowUpSubmit}
                    className="bg-white border border-slate-200 rounded-2xl p-5 sm:p-6 space-y-3 print:hidden"
                  >
                    <div>
                      <label
                        htmlFor="followup-input"
                        className="text-sm font-semibold text-slate-900"
                      >
                        Have additional details or a follow-up question?
                      </label>
                      <p className="text-xs text-slate-500 mt-0.5">
                        Reply to the closing question above or ask us to dig deeper into any finding.
                      </p>
                    </div>
                    <div className="flex flex-col sm:flex-row gap-3">
                      <input
                        id="followup-input"
                        type="text"
                        value={followUpInput}
                        onChange={(e) => setFollowUpInput(e.target.value)}
                        disabled={isSendingFollowUp}
                        placeholder="e.g., Focus specifically on suppliers that ship to Texas within 2 weeks..."
                        className="flex-1 px-4 py-2.5 text-sm bg-slate-50 border border-slate-200 rounded-xl text-slate-900 placeholder:text-slate-400 focus:bg-white focus:outline-none focus:border-blue-600"
                      />
                      <button
                        type="submit"
                        disabled={!followUpInput.trim() || isSendingFollowUp}
                        className="inline-flex items-center justify-center gap-2 px-5 py-2.5 text-xs font-semibold text-white bg-blue-600 rounded-xl hover:bg-blue-700 disabled:opacity-45 transition-colors whitespace-nowrap shrink-0 cursor-pointer"
                      >
                        <span>{isSendingFollowUp ? 'Verifying...' : 'Ask Follow-Up'}</span>
                        <ArrowRight className="w-3.5 h-3.5" />
                      </button>
                    </div>
                  </form>
                </div>

                <aside className="lg:col-span-4 space-y-6 print:mt-8">
                  <div className="bg-white border border-slate-200 rounded-2xl p-5 sm:p-6 space-y-4">
                    <div className="flex items-center justify-between">
                      <h2 className="text-sm font-semibold text-slate-900">
                        Verified Web Sources
                      </h2>
                      <span className="text-xs font-mono tabular-nums text-slate-500">
                        {sources.length} links
                      </span>
                    </div>

                    {sources.length === 0 ? (
                      <p className="text-xs text-slate-500 leading-relaxed">
                        Inline citations are embedded directly within the report sections.
                      </p>
                    ) : (
                      <div className="divide-y divide-slate-100 max-h-[420px] overflow-y-auto pr-1">
                        {sources.map((src, idx) => (
                          <a
                            key={src.uri}
                            href={src.uri}
                            target="_blank"
                            rel="noopener noreferrer"
                            className="py-3 first:pt-0 last:pb-0 flex items-start justify-between gap-3 group"
                          >
                            <div className="min-w-0 space-y-0.5">
                              <div className="text-xs font-medium text-slate-900 group-hover:text-blue-700 transition-colors line-clamp-2">
                                <span className="font-mono text-slate-400 mr-1.5 tabular-nums">
                                  [{idx + 1}]
                                </span>
                                {src.title}
                              </div>
                              <div className="text-[11px] text-slate-500 truncate">
                                {getDomainFromUri(src.uri)}
                              </div>
                            </div>
                            <ExternalLink className="w-3.5 h-3.5 text-slate-400 group-hover:text-blue-600 shrink-0 mt-0.5" />
                          </a>
                        ))}
                      </div>
                    )}
                  </div>

                  {subQuestions.filter((q) => q.enabled).length > 0 && (
                    <div className="bg-white border border-slate-200 rounded-2xl p-5 sm:p-6 space-y-3 print:hidden">
                      <h2 className="text-sm font-semibold text-slate-900">
                        Questions Investigated
                      </h2>
                      <ol className="space-y-2.5 text-xs text-slate-600 leading-relaxed">
                        {subQuestions
                          .filter((q) => q.enabled)
                          .map((item, idx) => (
                            <li key={item.id} className="flex items-start gap-2">
                              <span className="font-mono tabular-nums text-slate-400 shrink-0">
                                0{idx + 1}.
                              </span>
                              <span>{item.question}</span>
                            </li>
                          ))}
                      </ol>
                    </div>
                  )}
                </aside>
              </div>
            )}
          </div>
        )}

        {/* VIEW 2: DEVICE FILE & FOLDER ORGANIZER */}
        {activeView === 'organizer' && <FileOrganizerWorkspace key={organizerResetKey} />}

        {/* VIEW 3: SAVED REPORTS LIBRARY */}
        {activeView === 'history' && (
          <section className="space-y-6">
            <div className="flex flex-col sm:flex-row sm:items-end justify-between gap-4 pb-5 border-b border-slate-200">
              <div className="space-y-1">
                <h1 className="text-2xl font-bold tracking-tight text-slate-900">Saved Reports</h1>
                <p className="text-sm text-slate-600">
                  Every completed research brief is saved automatically in your browser for instant
                  access.
                </p>
              </div>

              {savedReports.length > 0 && (
                <div className="relative w-full sm:w-72">
                  <Search className="w-4 h-4 text-slate-400 absolute left-3.5 top-1/2 -translate-y-1/2 pointer-events-none" />
                  <input
                    type="search"
                    value={historySearch}
                    onChange={(e) => setHistorySearch(e.target.value)}
                    placeholder="Filter saved reports..."
                    className="w-full pl-9 pr-3.5 py-2 text-sm bg-white border border-slate-300 rounded-lg text-slate-900 placeholder:text-slate-400 focus:outline-none focus:border-blue-600"
                  />
                </div>
              )}
            </div>

            {savedReports.length === 0 ? (
              <div className="bg-white border border-slate-200 rounded-2xl p-10 text-center space-y-4 max-w-xl mx-auto">
                <h2 className="text-base font-semibold text-slate-900">No saved reports yet</h2>
                <p className="text-sm text-slate-600 leading-relaxed">
                  Once you run your first research request, the full report and all verified source
                  links will appear right here.
                </p>
                <button
                  type="button"
                  onClick={() => {
                    setActiveView('research');
                    resetForNewTask();
                  }}
                  className="inline-flex items-center gap-2 px-5 py-2.5 text-xs font-semibold text-white bg-blue-600 rounded-xl hover:bg-blue-700 transition-colors cursor-pointer"
                >
                  <span>Start Your First Research Task</span>
                  <ArrowRight className="w-3.5 h-3.5" />
                </button>
              </div>
            ) : filteredReports.length === 0 ? (
              <div className="bg-white border border-slate-200 rounded-2xl p-8 text-center space-y-2">
                <p className="text-sm font-medium text-slate-800">
                  No saved reports match &ldquo;{historySearch}&rdquo;
                </p>
                <button
                  type="button"
                  onClick={() => setHistorySearch('')}
                  className="text-xs font-semibold text-blue-700 hover:underline cursor-pointer"
                >
                  Clear search filter
                </button>
              </div>
            ) : (
              <div className="bg-white border border-slate-200 rounded-2xl divide-y divide-slate-200 overflow-hidden">
                {filteredReports.map((item) => (
                  <div
                    key={item.id}
                    className="p-5 hover:bg-slate-50/70 transition-colors flex flex-col sm:flex-row sm:items-center justify-between gap-4"
                  >
                    <div className="space-y-1 min-w-0 flex-1">
                      <div className="flex items-center gap-2 text-xs text-slate-500 tabular-nums">
                        <span>{formatReadableDate(item.createdAt)}</span>
                        <span aria-hidden="true">·</span>
                        <span>{item.sources.length} sources</span>
                        <span aria-hidden="true">·</span>
                        <span>{item.depth === 'concise' ? 'Quick Brief' : 'Detailed Report'}</span>
                      </div>
                      <button
                        type="button"
                        onClick={() => openSavedReport(item)}
                        className="text-left text-base font-semibold text-slate-900 hover:text-blue-700 transition-colors block truncate w-full cursor-pointer"
                      >
                        {item.title}
                      </button>
                      <p className="text-xs text-slate-600 line-clamp-1">{item.topic}</p>
                    </div>

                    <div className="flex items-center gap-2 shrink-0">
                      <button
                        type="button"
                        onClick={() => openSavedReport(item)}
                        className="px-3.5 py-1.5 text-xs font-semibold text-slate-800 bg-white border border-slate-300 rounded-lg hover:bg-slate-50 transition-colors whitespace-nowrap shrink-0 cursor-pointer"
                      >
                        Open Report
                      </button>
                      <button
                        type="button"
                        onClick={() => deleteSavedReport(item.id)}
                        aria-label={`Delete report ${item.title}`}
                        className="p-2 text-slate-400 hover:text-red-600 rounded-lg hover:bg-red-50 transition-colors cursor-pointer"
                      >
                        <Trash2 className="w-4 h-4" />
                      </button>
                    </div>
                  </div>
                ))}
              </div>
            )}
          </section>
        )}

        {/* VIEW 4: HOW IT WORKS */}
        {activeView === 'how-it-works' && (
          <section className="max-w-4xl mx-auto space-y-8">
            <div className="space-y-2 pb-6 border-b border-slate-200">
              <div className="text-xs text-slate-500">Client Guide · Zero Setup Required</div>
              <h1 className="text-2xl sm:text-3xl font-bold tracking-tight text-slate-900">
                How Prospers Solutions Works
              </h1>
              <p className="text-sm sm:text-base text-slate-600 leading-relaxed">
                Two browser-ready assistants in one workspace: verify complex questions across
                authoritative web sources, or declutter and organize folders from your computer.
              </p>
            </div>

            <div className="grid grid-cols-1 md:grid-cols-2 gap-6">
              <div className="bg-white border border-slate-200 rounded-2xl p-6 space-y-3">
                <div className="text-xs font-mono tabular-nums font-semibold text-blue-700">
                  01. Deep Web Research
                </div>
                <h2 className="text-lg font-semibold text-slate-900">
                  Real-Time Sub-Question Verification
                </h2>
                <p className="text-sm text-slate-600 leading-relaxed">
                  Type any question in plain English. Prospers Solutions breaks it into 3–5 concrete
                  sub-questions, shows live progress as each sub-question is verified against
                  official docs and primary sources, and delivers a printable report with a{' '}
                  <strong>Confidence &amp; Gaps</strong> audit and <strong>1 Next-Step Recommendation</strong>.
                </p>
                <button
                  type="button"
                  onClick={() => setActiveView('research')}
                  className="inline-flex items-center gap-1.5 text-xs font-semibold text-blue-700 hover:underline pt-1 cursor-pointer"
                >
                  <span>Open Web Research</span>
                  <ArrowRight className="w-3.5 h-3.5" />
                </button>
              </div>

              <div className="bg-white border border-slate-200 rounded-2xl p-6 space-y-3">
                <div className="text-xs font-mono tabular-nums font-semibold text-blue-700">
                  02. Device File Organizer
                </div>
                <h2 className="text-lg font-semibold text-slate-900">
                  First Assessment + 5 Questions + Clean Folders
                </h2>
                <p className="text-sm text-slate-600 leading-relaxed">
                  Select any messy folder or batch of files from your computer. The agent runs an
                  initial assessment, asks <strong>5 quick questions</strong> about how you want
                  similar items grouped and renamed, waits for your agreement, and either applies
                  changes directly to your folder or packages a clean organized ZIP.
                </p>
                <button
                  type="button"
                  onClick={() => setActiveView('organizer')}
                  className="inline-flex items-center gap-1.5 text-xs font-semibold text-blue-700 hover:underline pt-1 cursor-pointer"
                >
                  <span>Open File Organizer</span>
                  <ArrowRight className="w-3.5 h-3.5" />
                </button>
              </div>
            </div>
          </section>
        )}

        {/* VIEW 5: WORKSPACE PREFERENCES */}
        {activeView === 'preferences' && (
          <section className="max-w-2xl mx-auto space-y-6">
            <div className="space-y-1 pb-5 border-b border-slate-200">
              <h1 className="text-2xl font-bold tracking-tight text-slate-900">
                Workspace Preferences
              </h1>
              <p className="text-sm text-slate-600">
                Tailor default report behavior and standing business context for this browser.
              </p>
            </div>

            <form
              onSubmit={handleSavePreferences}
              className="bg-white border border-slate-200 rounded-2xl p-6 space-y-6"
            >
              <div className="space-y-2">
                <span className="text-xs font-semibold text-slate-800 block">
                  Default Research Workflow
                </span>
                <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
                  <button
                    type="button"
                    onClick={() => setPrefs((p) => ({ ...p, defaultMode: 'instant' }))}
                    className={`p-3.5 text-left rounded-xl border transition-colors cursor-pointer ${
                      prefs.defaultMode === 'instant'
                        ? 'border-blue-600 bg-blue-50/40'
                        : 'border-slate-200 hover:bg-slate-50'
                    }`}
                  >
                    <div className="text-sm font-semibold text-slate-900">Instant Report</div>
                    <div className="text-xs text-slate-600 mt-0.5">
                      One click from question to full cited report.
                    </div>
                  </button>
                  <button
                    type="button"
                    onClick={() => setPrefs((p) => ({ ...p, defaultMode: 'guided' }))}
                    className={`p-3.5 text-left rounded-xl border transition-colors cursor-pointer ${
                      prefs.defaultMode === 'guided'
                        ? 'border-blue-600 bg-blue-50/40'
                        : 'border-slate-200 hover:bg-slate-50'
                    }`}
                  >
                    <div className="text-sm font-semibold text-slate-900">Review Steps First</div>
                    <div className="text-xs text-slate-600 mt-0.5">
                      Pause to approve or edit sub-questions before searching.
                    </div>
                  </button>
                </div>
              </div>

              <div className="space-y-2">
                <span className="text-xs font-semibold text-slate-800 block">
                  Default Report Length
                </span>
                <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
                  <button
                    type="button"
                    onClick={() => setPrefs((p) => ({ ...p, defaultDepth: 'detailed' }))}
                    className={`p-3.5 text-left rounded-xl border transition-colors cursor-pointer ${
                      prefs.defaultDepth === 'detailed'
                        ? 'border-blue-600 bg-blue-50/40'
                        : 'border-slate-200 hover:bg-slate-50'
                    }`}
                  >
                    <div className="text-sm font-semibold text-slate-900">Detailed Report</div>
                    <div className="text-xs text-slate-600 mt-0.5">
                      Comprehensive findings, comparisons, and full evidence breakdown.
                    </div>
                  </button>
                  <button
                    type="button"
                    onClick={() => setPrefs((p) => ({ ...p, defaultDepth: 'concise' }))}
                    className={`p-3.5 text-left rounded-xl border transition-colors cursor-pointer ${
                      prefs.defaultDepth === 'concise'
                        ? 'border-blue-600 bg-blue-50/40'
                        : 'border-slate-200 hover:bg-slate-50'
                    }`}
                  >
                    <div className="text-sm font-semibold text-slate-900">Quick Brief</div>
                    <div className="text-xs text-slate-600 mt-0.5">
                      Short, bulleted executive summary for rapid reading.
                    </div>
                  </button>
                </div>
              </div>

              <div className="space-y-1.5">
                <label
                  htmlFor="standing-instructions"
                  className="text-xs font-semibold text-slate-800 block"
                >
                  Standing Business Context or Industry Focus (Optional)
                </label>
                <textarea
                  id="standing-instructions"
                  rows={4}
                  value={prefs.customInstructions}
                  onChange={(e) => setPrefs((p) => ({ ...p, customInstructions: e.target.value }))}
                  placeholder="Example: Our clients operate in North American metals & industrial supply. Always highlight ASTM/ISO standards, lead times, and US regulatory compliance where relevant."
                  className="w-full p-3.5 text-sm bg-white border border-slate-300 rounded-xl text-slate-900 placeholder:text-slate-400 focus:outline-none focus:border-blue-600 resize-y"
                />
                <p className="text-xs text-slate-500">
                  Automatically applied to every research report without needing to re-type it.
                </p>
              </div>

              <div className="pt-4 border-t border-slate-100 flex items-center justify-between gap-4">
                <button
                  type="button"
                  onClick={() => setPrefs(DEFAULT_PREFS)}
                  className="inline-flex items-center gap-1.5 text-xs font-medium text-slate-600 hover:text-slate-900 cursor-pointer"
                >
                  <RotateCcw className="w-3.5 h-3.5" />
                  <span>Reset to Defaults</span>
                </button>

                <button
                  type="submit"
                  className="inline-flex items-center gap-2 px-5 py-2.5 text-xs font-semibold text-white bg-blue-600 rounded-xl hover:bg-blue-700 transition-colors cursor-pointer"
                >
                  {prefsSavedToast ? <Check className="w-3.5 h-3.5" /> : null}
                  <span>{prefsSavedToast ? 'Preferences Saved' : 'Save Preferences'}</span>
                </button>
              </div>
            </form>
          </section>
        )}
      </main>

      <footer className="border-t border-slate-200 bg-white px-6 py-4 mt-auto print:hidden">
        <div className="max-w-[1200px] mx-auto flex flex-col sm:flex-row items-center justify-between gap-3 text-xs text-slate-500">
          <span>Prospers Solutions · Web Research &amp; Smart File Organization</span>
          <div className="flex items-center gap-4">
            <button
              type="button"
              onClick={() => setActiveView('organizer')}
              className="hover:text-slate-900 transition-colors cursor-pointer"
            >
              File Organizer
            </button>
            <span aria-hidden="true">·</span>
            <button
              type="button"
              onClick={() => setActiveView('how-it-works')}
              className="hover:text-slate-900 transition-colors cursor-pointer"
            >
              How It Works
            </button>
            <span aria-hidden="true">·</span>
            <button
              type="button"
              onClick={() => setActiveView('history')}
              className="hover:text-slate-900 transition-colors cursor-pointer tabular-nums"
            >
              Saved Reports ({savedReports.length})
            </button>
          </div>
        </div>
      </footer>
    </div>
  );
}
