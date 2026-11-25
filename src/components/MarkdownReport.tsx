import React from 'react';
import ReactMarkdown from 'react-markdown';
import remarkGfm from 'remark-gfm';

interface MarkdownReportProps {
  content: string;
}

export function MarkdownReport({ content }: MarkdownReportProps) {
  return (
    <div className="space-y-4 text-[15px] sm:text-base leading-relaxed text-slate-800">
      <ReactMarkdown
        remarkPlugins={[remarkGfm]}
        components={{
          h1: ({ children }) => (
            <h2 className="text-xl sm:text-2xl font-bold tracking-tight text-slate-900 pt-4 first:pt-0 pb-1">
              {children}
            </h2>
          ),
          h2: ({ children }) => (
            <h3 className="text-lg sm:text-xl font-bold tracking-tight text-slate-900 pt-6 first:pt-0 pb-2 border-b border-slate-200">
              {children}
            </h3>
          ),
          h3: ({ children }) => (
            <h4 className="text-base font-semibold text-slate-900 pt-4 first:pt-0">
              {children}
            </h4>
          ),
          p: ({ children }) => <p className="text-slate-700 leading-7">{children}</p>,
          ul: ({ children }) => (
            <ul className="list-disc pl-5 space-y-2 text-slate-700">{children}</ul>
          ),
          ol: ({ children }) => (
            <ol className="list-decimal pl-5 space-y-2 text-slate-700">{children}</ol>
          ),
          li: ({ children }) => <li className="leading-7 pl-1">{children}</li>,
          strong: ({ children }) => (
            <strong className="font-semibold text-slate-900">{children}</strong>
          ),
          blockquote: ({ children }) => (
            <blockquote className="p-4 my-3 bg-slate-50 border border-slate-200 rounded-lg text-sm text-slate-700 italic">
              {children}
            </blockquote>
          ),
          a: ({ href, children }) => (
            <a
              href={href}
              target="_blank"
              rel="noopener noreferrer"
              className="text-blue-700 underline underline-offset-2 hover:text-blue-800 break-words"
            >
              {children}
            </a>
          ),
          table: ({ children }) => (
            <div className="overflow-x-auto my-4 border border-slate-200 rounded-lg">
              <table className="w-full text-left border-collapse text-sm">{children}</table>
            </div>
          ),
          thead: ({ children }) => (
            <thead className="bg-slate-50 border-b border-slate-200 text-xs font-semibold text-slate-700">
              {children}
            </thead>
          ),
          th: ({ children }) => <th className="py-2.5 px-4">{children}</th>,
          td: ({ children }) => (
            <td className="py-2.5 px-4 border-t border-slate-100 text-slate-700 tabular-nums">
              {children}
            </td>
          ),
          hr: () => <hr className="my-6 border-slate-200" />,
        }}
      >
        {content}
      </ReactMarkdown>
    </div>
  );
}
