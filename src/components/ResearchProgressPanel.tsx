import React, { useEffect, useState } from 'react';
import { CheckCircle2, Clock, Loader2 } from 'lucide-react';
import type { SubQuestionItem } from '../types/research';

export type ResearchPhase = 'searching' | 'researching' | 'synthesizing';

interface ResearchProgressPanelProps {
  reportTitle: string;
  subQuestions: SubQuestionItem[];
  activeIndex: number;
  completedIndices: number[];
  phase: ResearchPhase;
  statusDetail: string;
  sourcesFoundCount: number;
}

function formatElapsed(seconds: number): string {
  const mins = Math.floor(seconds / 60);
  const secs = seconds % 60;
  return `${String(mins).padStart(2, '0')}:${String(secs).padStart(2, '0')}`;
}

export function ResearchProgressPanel({
  reportTitle,
  subQuestions,
  activeIndex,
  completedIndices,
  phase,
  statusDetail,
  sourcesFoundCount,
}: ResearchProgressPanelProps) {
  const [elapsedSeconds, setElapsedSeconds] = useState<number>(0);

  useEffect(() => {
    const interval = window.setInterval(() => {
      setElapsedSeconds((prev) => prev + 1);
    }, 1000);
    return () => window.clearInterval(interval);
  }, []);

  const enabledQuestions = subQuestions.filter((q) => q.enabled);
  const totalSteps = enabledQuestions.length + 1; // +1 for final synthesis & citation check
  const completedStepCount =
    phase === 'synthesizing' ? enabledQuestions.length : completedIndices.length;
  const percent = Math.min(
    96,
    Math.max(8, Math.round(((completedStepCount + 0.45) / Math.max(1, totalSteps)) * 100))
  );

  return (
    <section
      aria-live="polite"
      className="max-w-3xl mx-auto bg-white border border-slate-200 rounded-2xl p-6 sm:p-8 space-y-6"
    >
      {/* Header & Live Metrics */}
      <div className="flex flex-col sm:flex-row sm:items-start justify-between gap-4 pb-5 border-b border-slate-100">
        <div className="space-y-1.5">
          <div className="flex items-center gap-2 text-xs text-blue-700 font-medium">
            <span>Live Web Verification</span>
            <span aria-hidden="true">·</span>
            <span className="tabular-nums">{percent}% complete</span>
          </div>
          <h2 className="text-xl sm:text-2xl font-bold text-slate-900">
            {reportTitle || 'Investigating Sub-Questions...'}
          </h2>
          <p className="text-sm text-slate-600">{statusDetail}</p>
        </div>

        <div className="flex items-center gap-4 text-xs text-slate-500 font-mono tabular-nums shrink-0">
          <div>
            <span className="text-slate-900 font-semibold">{sourcesFoundCount}</span> sources found
          </div>
          <span aria-hidden="true">·</span>
          <div>{formatElapsed(elapsedSeconds)}</div>
        </div>
      </div>

      {/* Segmented Visual Progress Bar (Zero inline styles, compositor-friendly) */}
      <div className="space-y-2">
        <div className="flex items-center justify-between text-xs text-slate-500 tabular-nums">
          <span>
            {completedIndices.length} of {enabledQuestions.length} sub-questions verified
          </span>
          <span>
            {phase === 'synthesizing' ? 'Finalizing citations & summary' : 'Step-by-step search'}
          </span>
        </div>

        <div
          role="progressbar"
          aria-valuenow={percent}
          aria-valuemin={0}
          aria-valuemax={100}
          className="flex items-center gap-1.5 h-2.5 w-full"
        >
          {enabledQuestions.map((sq, idx) => {
            const isDone = completedIndices.includes(idx) || phase === 'synthesizing';
            const isCurrent = !isDone && activeIndex === idx;
            return (
              <div
                key={sq.id}
                className={`h-full flex-1 rounded-full transition-opacity duration-200 ${
                  isDone
                    ? 'bg-emerald-600'
                    : isCurrent
                      ? 'bg-blue-600 animate-pulse'
                      : 'bg-slate-200'
                }`}
              />
            );
          })}
          {/* Final synthesis segment */}
          <div
            className={`h-full flex-1 rounded-full transition-opacity duration-200 ${
              phase === 'synthesizing' ? 'bg-blue-600 animate-pulse' : 'bg-slate-200'
            }`}
          />
        </div>
      </div>

      {/* Real-Time Per-Sub-Question Status Rows */}
      <div className="divide-y divide-slate-100 border border-slate-200 rounded-xl overflow-hidden">
        {enabledQuestions.map((item, idx) => {
          const isCompleted = completedIndices.includes(idx) || phase === 'synthesizing';
          const isActive = !isCompleted && activeIndex === idx;

          return (
            <div
              key={item.id}
              className={`p-4 flex items-start justify-between gap-4 transition-colors duration-150 ${
                isActive ? 'bg-blue-50/50' : isCompleted ? 'bg-emerald-50/20' : 'bg-white'
              }`}
            >
              <div className="flex items-start gap-3 min-w-0">
                <div className="mt-0.5 shrink-0">
                  {isCompleted ? (
                    <CheckCircle2 className="w-4 h-4 text-emerald-600" />
                  ) : isActive ? (
                    <Loader2 className="w-4 h-4 text-blue-600 animate-spin" />
                  ) : (
                    <Clock className="w-4 h-4 text-slate-400" />
                  )}
                </div>
                <div className="space-y-0.5 min-w-0">
                  <div
                    className={`text-sm font-medium ${
                      isCompleted
                        ? 'text-slate-900'
                        : isActive
                          ? 'text-blue-950 font-semibold'
                          : 'text-slate-500'
                    }`}
                  >
                    <span className="font-mono text-xs tabular-nums text-slate-400 mr-2">
                      0{idx + 1}.
                    </span>
                    {item.question}
                  </div>
                  <p className="text-xs text-slate-500 leading-relaxed">{item.stepDescription}</p>
                </div>
              </div>

              <span
                className={`text-xs font-medium whitespace-nowrap shrink-0 tabular-nums ${
                  isCompleted
                    ? 'text-emerald-700'
                    : isActive
                      ? 'text-blue-700'
                      : 'text-slate-400'
                }`}
              >
                {isCompleted ? 'Verified' : isActive ? 'Researching...' : 'Queued'}
              </span>
            </div>
          );
        })}

        {/* Final Synthesis & Citation Audit Step */}
        <div
          className={`p-4 flex items-start justify-between gap-4 transition-colors duration-150 ${
            phase === 'synthesizing' ? 'bg-blue-50/50' : 'bg-white'
          }`}
        >
          <div className="flex items-start gap-3 min-w-0">
            <div className="mt-0.5 shrink-0">
              {phase === 'synthesizing' ? (
                <Loader2 className="w-4 h-4 text-blue-600 animate-spin" />
              ) : (
                <Clock className="w-4 h-4 text-slate-400" />
              )}
            </div>
            <div className="space-y-0.5">
              <div
                className={`text-sm font-medium ${
                  phase === 'synthesizing' ? 'text-blue-950 font-semibold' : 'text-slate-500'
                }`}
              >
                Compile Executive Report, Confidence Gaps &amp; Recommendation
              </div>
              <p className="text-xs text-slate-500">
                Cross-checking primary sources and formatting inline citations.
              </p>
            </div>
          </div>

          <span
            className={`text-xs font-medium whitespace-nowrap shrink-0 ${
              phase === 'synthesizing' ? 'text-blue-700' : 'text-slate-400'
            }`}
          >
            {phase === 'synthesizing' ? 'Synthesizing...' : 'Queued'}
          </span>
        </div>
      </div>
    </section>
  );
}
