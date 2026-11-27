import 'dotenv/config';
import express from 'express';
import type { Request, Response } from 'express';
import path from 'path';
import { fileURLToPath } from 'url';
import { GoogleGenAI, ThinkingLevel, Type } from '@google/genai';
import type { GenerateContentParameters, GenerateContentResponse } from '@google/genai';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

const PORT = Number(process.env.PORT) || 3000;
const RESEARCH_PRIMARY_MODEL = 'gemini-4-hydrogen';
const FAST_STRUCTURED_MODEL = 'gemini-3.1-flash-lite';

const getAiClient = () => {
  return new GoogleGenAI({
    apiKey: process.env.GEMINI_API_KEY,
    httpOptions: {
      headers: {
        'User-Agent': 'aistudio-build',
      },
    },
  });
};

const sleep = (ms: number) => new Promise((resolve) => setTimeout(resolve, ms));

function isQuotaOrTransientError(err: unknown): boolean {
  const raw = err instanceof Error ? err.message : String(err);
  return (
    raw.includes('RESOURCE_EXHAUSTED') ||
    raw.includes('429') ||
    raw.includes('503') ||
    raw.includes('UNAVAILABLE')
  );
}

async function generateWithRetryAndFallback(
  ai: GoogleGenAI,
  primaryParams: GenerateContentParameters,
  fallbackModel?: string
): Promise<GenerateContentResponse> {
  const delays = [1000, 2200];
  let lastErr: unknown;

  for (let attempt = 0; attempt <= delays.length; attempt++) {
    try {
      return await ai.models.generateContent(primaryParams);
    } catch (err) {
      lastErr = err;
      if (!isQuotaOrTransientError(err)) {
        throw err;
      }
      if (attempt < delays.length) {
        await sleep(delays[attempt]);
      }
    }
  }

  if (fallbackModel && fallbackModel !== primaryParams.model) {
    const fallbackConfig = { ...(primaryParams.config ?? {}) };
    delete fallbackConfig.thinkingConfig;

    try {
      return await ai.models.generateContent({
        ...primaryParams,
        model: fallbackModel,
        config: fallbackConfig,
      });
    } catch (fallbackErr) {
      lastErr = fallbackErr;
      // If search tool quota itself triggered 429, attempt clean model synthesis without tools
      if (isQuotaOrTransientError(fallbackErr) && fallbackConfig.tools) {
        const noToolsConfig = { ...fallbackConfig };
        delete noToolsConfig.tools;
        return await ai.models.generateContent({
          ...primaryParams,
          model: fallbackModel,
          config: noToolsConfig,
        });
      }
    }
  }

  throw lastErr;
}

const BASE_PROSPERS_SYSTEM_PROMPT = `You are Prospers Solutions, an upbeat, confident, and rigorous research assistant with the keys to unlock clear answers to any question or task.

Follow these core operating principles on every engagement:
1. Decompose any topic or task into 3-5 concrete sub-questions that, answered together, cover the topic completely.
2. Run targeted deep web searches across official documentation, institutional archives, standards bodies, and primary sources. Always prefer primary sources, official filings, and peer-reviewed work over blog posts, opinion pieces, or aggregators.
3. Read and evaluate sources thoroughly. Extract concrete facts, figures, dates, and direct attributions in clear, plain language suitable for non-technical decision-makers.
4. Structure reports clearly:
   - Start with an Executive Summary answering the client's main question directly.
   - Present findings organized by each Sub-Question, briefly stating the verification step taken and citing every non-obvious claim inline (e.g., [Source Name]).
   - Include a "Confidence & Gaps" section noting any areas where sources conflicted (explaining which source is more credible and why) or where primary coverage was limited.
   - Always close with a "Recommended Next Step" section containing 1 concrete, actionable recommendation, followed by "Questions to Consider" asking the client if any helpful details or context were overlooked.
5. Be skeptical and transparent. Never paper over uncertainty with vague or overconfident phrasing.`;

interface GroundingSource {
  title: string;
  uri: string;
}

function extractGroundingSources(response: unknown): GroundingSource[] {
  const seen = new Set<string>();
  const sources: GroundingSource[] = [];

  const candidates = (
    response as {
      candidates?: Array<{
        groundingMetadata?: {
          groundingChunks?: Array<{
            web?: { uri?: string; title?: string };
          }>;
        };
      }>;
    }
  )?.candidates;

  const chunks = candidates?.[0]?.groundingMetadata?.groundingChunks ?? [];
  for (const chunk of chunks) {
    const uri = chunk?.web?.uri?.trim();
    if (!uri || seen.has(uri)) continue;
    seen.add(uri);
    sources.push({
      title: chunk?.web?.title?.trim() || uri,
      uri,
    });
  }

  return sources;
}

function formatApiError(err: unknown): { status: number; message: string } {
  const raw = err instanceof Error ? err.message : String(err);
  if (raw.includes('PERMISSION_DENIED') || raw.includes('API_KEY_INVALID') || raw.includes('403')) {
    return {
      status: 403,
      message:
        'The service could not authenticate with the Gemini API. Please check your API key in the Settings > Secrets panel.',
    };
  }
  if (raw.includes('RESOURCE_EXHAUSTED') || raw.includes('429')) {
    return {
      status: 429,
      message:
        'Free-tier rate limit temporarily reached. Please wait ~30 seconds and try again, or select a billing-enabled API key in Settings > Secrets to increase your quota.',
    };
  }
  return {
    status: 500,
    message: 'Unable to complete the request right now. Please try again in a moment.',
  };
}

function sanitizeFolderPath(folder: string): string {
  const cleaned = folder
    .replace(/\\/g, '/')
    .split('/')
    .map((segment) =>
      segment
        .replace(/[<>:"|?*\x00-\x1F]/g, '')
        .trim()
        .replace(/^\.+|\.+$/g, '')
    )
    .filter(Boolean)
    .join('/');
  return cleaned || 'Uncategorized';
}

function sanitizeFileNamePreservingExt(proposedName: string, originalName: string): string {
  const origDotIdx = originalName.lastIndexOf('.');
  const origExt = origDotIdx > 0 ? originalName.slice(origDotIdx) : '';

  let cleaned = proposedName
    .replace(/[/\\<>:"|?*\x00-\x1F]/g, '-')
    .replace(/\s+/g, ' ')
    .trim();

  if (!cleaned) {
    return originalName;
  }

  if (origExt && !cleaned.toLowerCase().endsWith(origExt.toLowerCase())) {
    // Strip any hallucinated trailing extension if present and re-append exact original extension
    const propDotIdx = cleaned.lastIndexOf('.');
    if (propDotIdx > 0 && cleaned.length - propDotIdx <= 6) {
      cleaned = cleaned.slice(0, propDotIdx);
    }
    cleaned = `${cleaned}${origExt}`;
  }

  return cleaned;
}

// Simple per-visitor limit so nobody can drain the Gemini key. No extra packages needed.
const AI_REQUESTS_PER_WINDOW = Number(process.env.AI_REQUESTS_PER_10_MIN) || 30;
const WINDOW_MS = 10 * 60 * 1000;
const hitsByVisitor = new Map<string, number[]>();

function aiRateLimit(req: Request, res: Response, next: () => void) {
  const key = req.ip || 'unknown';
  const now = Date.now();
  const recent = (hitsByVisitor.get(key) ?? []).filter((t) => now - t < WINDOW_MS);
  if (recent.length >= AI_REQUESTS_PER_WINDOW) {
    res.status(429).json({
      error: 'You have made a lot of requests in a short time. Please wait a few minutes and try again.',
    });
    return;
  }
  recent.push(now);
  hitsByVisitor.set(key, recent);
  if (hitsByVisitor.size > 5000) {
    for (const [k, times] of hitsByVisitor) {
      if (times.every((t) => now - t >= WINDOW_MS)) hitsByVisitor.delete(k);
    }
  }
  next();
}

/** Run async jobs a few at a time, keeping results in order. */
async function runInPool<T, R>(items: T[], limit: number, worker: (item: T, index: number) => Promise<R>) {
  const results: R[] = new Array(items.length);
  let next = 0;
  const runners = Array.from({ length: Math.min(limit, items.length) }, async () => {
    while (next < items.length) {
      const i = next++;
      results[i] = await worker(items[i], i);
    }
  });
  await Promise.all(runners);
  return results;
}

async function startServer() {
  const app = express();
  // Render (and most hosts) sit behind one proxy: trust it so req.ip is the real visitor
  app.set('trust proxy', 1);
  app.use(express.json({ limit: '4mb' }));

  // Let the phone app (Capacitor) and any sites listed in ALLOWED_ORIGINS call the API.
  const allowedOrigins = new Set(
    [
      'capacitor://localhost',
      'ionic://localhost',
      'https://localhost',
      'http://localhost',
      ...(process.env.ALLOWED_ORIGINS ?? '').split(','),
    ]
      .map((o) => o.trim().replace(/\/+$/, ''))
      .filter(Boolean)
  );
  app.use('/api', (req: Request, res: Response, next: () => void) => {
    const origin = req.headers.origin;
    if (origin && allowedOrigins.has(origin)) {
      res.setHeader('Access-Control-Allow-Origin', origin);
      res.setHeader('Vary', 'Origin');
      res.setHeader('Access-Control-Allow-Methods', 'POST, GET, OPTIONS');
      res.setHeader('Access-Control-Allow-Headers', 'Content-Type');
      res.setHeader('Access-Control-Max-Age', '86400');
    }
    if (req.method === 'OPTIONS') {
      res.sendStatus(204);
      return;
    }
    next();
  });

  app.use('/api', aiRateLimit);

  // 1. RESEARCH PLAN ENDPOINT
  app.post('/api/research/plan', async (req: Request, res: Response) => {
    try {
      const { topic, context, customInstructions } = req.body as {
        topic?: string;
        context?: string;
        customInstructions?: string;
      };

      if (!topic || !topic.trim()) {
        res.status(400).json({ error: 'Please enter a topic or question to research.' });
        return;
      }

      const ai = getAiClient();
      const systemInstruction = customInstructions?.trim()
        ? `${BASE_PROSPERS_SYSTEM_PROMPT}\n\nAdditional Workspace Preferences:\n${customInstructions.trim()}`
        : BASE_PROSPERS_SYSTEM_PROMPT;

      const userPrompt = `Client Request: "${topic.trim()}"${
        context?.trim() ? `\nAdditional Client Context: "${context.trim()}"` : ''
      }

Break this request into 3 to 5 clear, concrete sub-questions for a non-technical client. Provide an upbeat greeting explaining your planned approach and ask for permission to proceed with the deep web search.`;

      const response = await generateWithRetryAndFallback(
        ai,
        {
          model: FAST_STRUCTURED_MODEL,
          contents: userPrompt,
          config: {
            systemInstruction,
            responseMimeType: 'application/json',
            responseSchema: {
              type: Type.OBJECT,
              properties: {
                reportTitle: {
                  type: Type.STRING,
                  description: 'A concise, clear title for this research brief (4-8 words).',
                },
                welcomeMessage: {
                  type: Type.STRING,
                  description:
                    'An upbeat, confident 1-2 sentence explanation of how you will tackle this request.',
                },
                subQuestions: {
                  type: Type.ARRAY,
                  description: '3 to 5 concrete sub-questions covering the topic.',
                  items: {
                    type: Type.OBJECT,
                    properties: {
                      id: { type: Type.STRING },
                      question: {
                        type: Type.STRING,
                        description: 'Plain-English sub-question to investigate.',
                      },
                      stepDescription: {
                        type: Type.STRING,
                        description:
                          'One short sentence explaining what authoritative sources will be checked.',
                      },
                    },
                    required: ['id', 'question', 'stepDescription'],
                  },
                },
                permissionPrompt: {
                  type: Type.STRING,
                  description:
                    'A polite 1-sentence prompt asking the client if they approve proceeding with these steps.',
                },
              },
              required: ['reportTitle', 'welcomeMessage', 'subQuestions', 'permissionPrompt'],
            },
          },
        },
        RESEARCH_PRIMARY_MODEL
      );

      const parsed = JSON.parse((response.text ?? '{}').trim());
      res.json(parsed);
    } catch (err) {
      console.error('Error in /api/research/plan:', err);
      const formatted = formatApiError(err);
      res.status(formatted.status).json({ error: formatted.message });
    }
  });

  // 2. RESEARCH EXECUTE ENDPOINT (Supports real-time NDJSON streaming for sub-question status!)
  app.post('/api/research/execute', async (req: Request, res: Response) => {
    const {
      topic,
      context,
      subQuestions,
      clientNote,
      depth,
      customInstructions,
      stream: wantStream,
    } = req.body as {
      topic?: string;
      context?: string;
      subQuestions?: Array<{ question: string; stepDescription?: string }>;
      clientNote?: string;
      depth?: 'concise' | 'detailed';
      customInstructions?: string;
      stream?: boolean;
    };

    if (!topic || !topic.trim()) {
      res.status(400).json({ error: 'Research topic is required.' });
      return;
    }

    const ai = getAiClient();
    const sqList = subQuestions && subQuestions.length > 0 ? subQuestions : [
      { question: topic.trim(), stepDescription: 'Verify authoritative primary sources.' },
    ];

    const activeSubQuestions = sqList
      .map(
        (sq, index) =>
          `${index + 1}. ${sq.question}${sq.stepDescription ? ` (${sq.stepDescription})` : ''}`
      )
      .join('\n');

    const depthGuidance =
      depth === 'concise'
        ? 'Keep the report crisp and scannable (roughly 500-800 words total) with bulleted key takeaways for busy executives.'
        : 'Provide a thorough, comprehensive research report with detailed evidence, specific figures, and nuanced source comparisons.';

    const markerInstructions = wantStream
      ? `\nProgress Marker Formatting Rule (CRITICAL):
- Immediately before starting your findings for Sub-Question 1, output the exact token [[SUBQ:1]] on its own line.
- Immediately before starting Sub-Question 2, output [[SUBQ:2]] on its own line (and so on for each numbered sub-question up to [[SUBQ:${sqList.length}]]).
- Immediately before the "Confidence & Coverage Gaps" section, output [[SYNTHESIS]] on its own line.`
      : '';

    const systemInstruction = `${BASE_PROSPERS_SYSTEM_PROMPT}\n\nReport Formatting Instructions:\n- Write in clear, polished Markdown suitable for non-technical clients (no code jargon).\n- ${depthGuidance}${
      customInstructions?.trim() ? `\n- Workspace Preferences: ${customInstructions.trim()}` : ''
    }${markerInstructions}`;

    const prompt = `The client has granted permission to proceed with the research task.

Main Topic / Question:
${topic.trim()}
${context?.trim() ? `\nBackground Context:\n${context.trim()}` : ''}
${clientNote?.trim() ? `\nClient Approval Note / Adjustments:\n${clientNote.trim()}` : ''}

Approved Sub-Questions to Investigate & Synthesize:
${activeSubQuestions}

Please run targeted web searches across authoritative primary sources and compile the complete report now. Structure your Markdown response with:
1. **Executive Summary** — Direct, clear synthesis of the overall answer.
2. **Step-by-Step Findings** — A dedicated subsection for each approved sub-question (in order 1 to ${sqList.length}), starting with a brief 1-line note on the sources checked, followed by specific facts, data points, and inline source citations.
3. **Confidence & Coverage Gaps** — Honest assessment of where sources agreed, conflicted, or had limited primary data.
4. **Recommended Next Step** — Exactly 1 concrete, high-value recommendation tailored to the client's goal, plus a friendly closing question asking if any helpful details or constraints were overlooked.`;

    const cleanMarkers = (rawText: string) =>
      rawText
        .replace(/\[\[SUBQ:\d+\]\]\s*/g, '')
        .replace(/\[\[SYNTHESIS\]\]\s*/g, '')
        .trim();

    if (!wantStream) {
      try {
        const response = await generateWithRetryAndFallback(
          ai,
          {
            model: RESEARCH_PRIMARY_MODEL,
            contents: prompt,
            config: {
              systemInstruction,
              tools: [{ googleSearch: {} }],
              thinkingConfig: { thinkingLevel: ThinkingLevel.LOW },
            },
          },
          FAST_STRUCTURED_MODEL
        );

        res.json({
          reportMarkdown: cleanMarkers(response.text ?? ''),
          sources: extractGroundingSources(response),
          completedAt: new Date().toISOString(),
        });
      } catch (err) {
        console.error('Error in /api/research/execute:', err);
        const formatted = formatApiError(err);
        res.status(formatted.status).json({ error: formatted.message });
      }
      return;
    }

    // Real-time NDJSON streaming mode
    res.setHeader('Content-Type', 'application/x-ndjson; charset=utf-8');
    res.setHeader('Cache-Control', 'no-cache, no-transform');
    res.setHeader('Connection', 'keep-alive');

    const sendEvent = (payload: Record<string, unknown>) => {
      res.write(`${JSON.stringify(payload)}\n`);
    };

    try {
      sendEvent({
        type: 'progress',
        activeIndex: 0,
        completedIndices: [],
        phase: 'searching',
        detail: `Searching primary sources for sub-question 1 of ${sqList.length}...`,
      });

      const runStreamWithModel = async (
        modelName: string,
        useSearchTool: boolean
      ): Promise<{ fullText: string; sources: GroundingSource[] }> => {
        const streamResp = await ai.models.generateContentStream({
          model: modelName,
          contents: prompt,
          config: {
            systemInstruction,
            ...(useSearchTool ? { tools: [{ googleSearch: {} }] } : {}),
            ...(modelName === RESEARCH_PRIMARY_MODEL
              ? { thinkingConfig: { thinkingLevel: ThinkingLevel.LOW } }
              : {}),
          },
        });

        let accumulated = '';
        const collectedSources: GroundingSource[] = [];
        const seenUris = new Set<string>();
        let highestDetectedSubQ = 0;
        let synthesisEmitted = false;

        for await (const chunk of streamResp) {
          const textPiece = chunk.text ?? '';
          if (textPiece) {
            accumulated += textPiece;

            // Detect [[SUBQ:k]] markers in real time
            const matches = [...accumulated.matchAll(/\[\[SUBQ:(\d+)\]\]/g)];
            if (matches.length > 0) {
              const latestNum = parseInt(matches[matches.length - 1][1], 10);
              if (!Number.isNaN(latestNum) && latestNum > highestDetectedSubQ) {
                highestDetectedSubQ = latestNum;
                const activeIdx = Math.min(latestNum - 1, sqList.length - 1);
                const completed = Array.from({ length: activeIdx }, (_, i) => i);
                sendEvent({
                  type: 'progress',
                  activeIndex: activeIdx,
                  completedIndices: completed,
                  phase: 'researching',
                  detail: `Investigating sub-question ${activeIdx + 1} of ${sqList.length}...`,
                });
              }
            }

            if (!synthesisEmitted && accumulated.includes('[[SYNTHESIS]]')) {
              synthesisEmitted = true;
              const allCompleted = Array.from({ length: sqList.length }, (_, i) => i);
              sendEvent({
                type: 'progress',
                activeIndex: -1,
                completedIndices: allCompleted,
                phase: 'synthesizing',
                detail: 'Cross-checking citations, confidence gaps, and final recommendation...',
              });
            }
          }

          const chunkSources = extractGroundingSources(chunk);
          for (const src of chunkSources) {
            if (!seenUris.has(src.uri)) {
              seenUris.add(src.uri);
              collectedSources.push(src);
              sendEvent({
                type: 'sources_count',
                count: collectedSources.length,
              });
            }
          }
        }

        return { fullText: accumulated, sources: collectedSources };
      };

      let result: { fullText: string; sources: GroundingSource[] };
      try {
        result = await runStreamWithModel(RESEARCH_PRIMARY_MODEL, true);
      } catch (primaryErr) {
        if (!isQuotaOrTransientError(primaryErr)) {
          throw primaryErr;
        }
        await sleep(900);
        try {
          result = await runStreamWithModel(FAST_STRUCTURED_MODEL, true);
        } catch (secondaryErr) {
          if (!isQuotaOrTransientError(secondaryErr)) {
            throw secondaryErr;
          }
          await sleep(900);
          result = await runStreamWithModel(FAST_STRUCTURED_MODEL, false);
        }
      }

      const allCompleted = Array.from({ length: sqList.length }, (_, i) => i);
      sendEvent({
        type: 'complete',
        completedIndices: allCompleted,
        reportMarkdown: cleanMarkers(result.fullText),
        sources: result.sources,
        completedAt: new Date().toISOString(),
      });
      res.end();
    } catch (err) {
      console.error('Error in streaming /api/research/execute:', err);
      const formatted = formatApiError(err);
      sendEvent({
        type: 'error',
        error: formatted.message,
      });
      res.end();
    }
  });

  // 3. RESEARCH FOLLOW-UP ENDPOINT
  app.post('/api/research/followup', async (req: Request, res: Response) => {
    try {
      const { topic, previousReport, followUpQuestion, customInstructions } = req.body as {
        topic?: string;
        previousReport?: string;
        followUpQuestion?: string;
        customInstructions?: string;
      };

      if (!followUpQuestion || !followUpQuestion.trim()) {
        res.status(400).json({ error: 'Please enter a follow-up question or detail.' });
        return;
      }

      const ai = getAiClient();
      const systemInstruction = customInstructions?.trim()
        ? `${BASE_PROSPERS_SYSTEM_PROMPT}\n\nAdditional Workspace Preferences:\n${customInstructions.trim()}`
        : BASE_PROSPERS_SYSTEM_PROMPT;

      const prompt = `Original Research Topic: ${topic ?? 'Client Research Task'}

Previous Compiled Report:
${(previousReport ?? '').slice(0, 14000)}

Client Follow-Up / Additional Context Provided:
"${followUpQuestion.trim()}"

Conduct targeted web verification on this new detail or follow-up question using primary sources. Provide a clear, upbeat, well-cited Markdown response that integrates seamlessly with the earlier findings, notes any uncertainties, and includes 1 updated recommendation.`;

      const response = await generateWithRetryAndFallback(
        ai,
        {
          model: RESEARCH_PRIMARY_MODEL,
          contents: prompt,
          config: {
            systemInstruction,
            tools: [{ googleSearch: {} }],
            thinkingConfig: { thinkingLevel: ThinkingLevel.LOW },
          },
        },
        FAST_STRUCTURED_MODEL
      );

      res.json({
        answerMarkdown: response.text ?? '',
        sources: extractGroundingSources(response),
        completedAt: new Date().toISOString(),
      });
    } catch (err) {
      console.error('Error in /api/research/followup:', err);
      const formatted = formatApiError(err);
      res.status(formatted.status).json({ error: formatted.message });
    }
  });

  // 4. FILE ORGANIZER — STEP 1: INITIAL ASSESSMENT + 5 CLARIFYING QUESTIONS
  app.post('/api/files/assess', async (req: Request, res: Response) => {
    try {
      const { command, files } = req.body as {
        command?: string;
        files?: Array<{
          id: string;
          name: string;
          relativePath: string;
          extension: string;
          sizeBytes: number;
          lastModified: string;
          previewSnippet?: string;
          isOld?: boolean;
          duplicateOfPath?: string;
          takenDate?: string;
          dateSource?: string;
        }>;
      };

      if (!files || files.length === 0) {
        res.status(400).json({ error: 'Please select a folder or files from your device first.' });
        return;
      }

      const ai = getAiClient();
      const sampleFiles = files.slice(0, 160).map((f) => ({
        path: f.relativePath || f.name,
        ext: f.extension || 'none',
        sizeKB: Math.max(1, Math.round(f.sizeBytes / 1024)),
        modified: f.lastModified.slice(0, 10),
        ...(f.previewSnippet ? { snippet: f.previewSnippet.slice(0, 120) } : {}),
        ...(f.isOld ? { notChangedIn12Months: true } : {}),
        ...(f.duplicateOfPath ? { exactCopyOf: f.duplicateOfPath } : {}),
        ...(f.takenDate ? { photoTakenDate: f.takenDate.slice(0, 10) } : {}),
      }));
      const oldCount = files.filter((f) => f.isOld).length;
      const copyCount = files.filter((f) => f.duplicateOfPath).length;

      const prompt = `You are Prospers Solutions File Organizer, an intelligent, friendly assistant helping a non-technical user organize files and folders from their device into clean categories of similar items and clear filenames.

User Command / Goal:
"${command?.trim() || 'Organize my files into logical categories of similar items and clean up messy filenames.'}"

Total Files Scanned: ${files.length}
Exact copies found on the user's device (byte-for-byte identical): ${copyCount}
Files not changed in over 12 months: ${oldCount}
(Exact copies will automatically be set aside in a "Review Duplicates" folder; mention them in plain words if there are any.)
Scanned File Inventory (up to 160 representative entries):
${JSON.stringify(sampleFiles, null, 2)}

Perform your First Assessment now:
1. Summarize what kinds of files and clutter patterns you found in plain, friendly English.
2. Propose logical category folders that group similar files together cleanly.
3. Formulate EXACTLY 5 concise, helpful clarifying questions for the user before you begin moving and renaming their files (for example: how they want dates/years grouped, preferred filename style, whether to separate old archives, how to group specific similar file types you noticed, and whether messy camera/download names should be renamed descriptively). Provide 2 to 4 short suggested clickable answer options for each question.`;

      const response = await generateWithRetryAndFallback(
        ai,
        {
          model: FAST_STRUCTURED_MODEL,
          contents: prompt,
          config: {
            responseMimeType: 'application/json',
            responseSchema: {
              type: Type.OBJECT,
              properties: {
                overviewSummary: {
                  type: Type.STRING,
                  description:
                    'Upbeat 2-3 sentence summary of what was found in the selected folder/files.',
                },
                detectedPatterns: {
                  type: Type.ARRAY,
                  description: '3 to 5 specific clutter or file-type patterns noticed.',
                  items: { type: Type.STRING },
                },
                proposedCategories: {
                  type: Type.ARRAY,
                  description: 'Proposed folders grouping similar files.',
                  items: {
                    type: Type.OBJECT,
                    properties: {
                      name: { type: Type.STRING },
                      description: { type: Type.STRING },
                      estimatedCount: { type: Type.INTEGER },
                    },
                    required: ['name', 'description', 'estimatedCount'],
                  },
                },
                questions: {
                  type: Type.ARRAY,
                  description: 'EXACTLY 5 clarifying questions for the user to answer.',
                  items: {
                    type: Type.OBJECT,
                    properties: {
                      id: { type: Type.STRING },
                      question: { type: Type.STRING },
                      whyItMatters: { type: Type.STRING },
                      suggestedOptions: {
                        type: Type.ARRAY,
                        items: { type: Type.STRING },
                      },
                    },
                    required: ['id', 'question', 'whyItMatters', 'suggestedOptions'],
                  },
                },
              },
              required: [
                'overviewSummary',
                'detectedPatterns',
                'proposedCategories',
                'questions',
              ],
            },
          },
        },
        RESEARCH_PRIMARY_MODEL
      );

      const parsed = JSON.parse((response.text ?? '{}').trim()) as {
        overviewSummary?: string;
        detectedPatterns?: string[];
        proposedCategories?: Array<{ name: string; description: string; estimatedCount: number }>;
        questions?: Array<{
          id: string;
          question: string;
          whyItMatters: string;
          suggestedOptions: string[];
        }>;
      };

      const fallbackQuestions = [
        {
          id: 'q1',
          question: 'How would you like similar files grouped into folders?',
          whyItMatters: 'Determines your top-level folder structure.',
          suggestedOptions: ['By Topic & Purpose', 'By File Type (Docs, Images, Sheets)', 'By Year, then Category'],
        },
        {
          id: 'q2',
          question: 'Should we rename cryptic filenames (like IMG_4021 or final_v2) into clean, readable titles?',
          whyItMatters: 'Makes files easy to find at a glance.',
          suggestedOptions: ['Yes, rename messy files clearly', 'Only add date prefixes', 'Keep original filenames'],
        },
        {
          id: 'q3',
          question: 'What naming format do you prefer when files are renamed?',
          whyItMatters: 'Keeps every renamed file consistent.',
          suggestedOptions: ['YYYY-MM-DD - Clean Title', 'Clean Title With Spaces', 'clean-kebab-case-title'],
        },
        {
          id: 'q4',
          question: 'How should older files (over 1 year old) be handled?',
          whyItMatters: 'Separates active work from older records.',
          suggestedOptions: ['Keep in main category folders', 'Place inside an Archive subfolder', 'Group by Year subfolders'],
        },
        {
          id: 'q5',
          question: 'If duplicate-looking drafts or copies appear, where should they go?',
          whyItMatters: 'Prevents accidental loss while decluttering.',
          suggestedOptions: ['Move extras to a "Review Duplicates" folder', 'Keep alongside main files', 'Group into a "Drafts & Versions" folder'],
        },
      ];

      const normalizedQuestions = [...(parsed.questions ?? [])].slice(0, 5);
      while (normalizedQuestions.length < 5) {
        normalizedQuestions.push(fallbackQuestions[normalizedQuestions.length]);
      }

      res.json({
        overviewSummary:
          parsed.overviewSummary ||
          `Scanned ${files.length} files and identified clear groupings to streamline your folder structure.`,
        detectedPatterns: parsed.detectedPatterns ?? [],
        proposedCategories: parsed.proposedCategories ?? [],
        questions: normalizedQuestions.map((q, idx) => ({
          id: q.id || `q_${idx + 1}`,
          question: q.question,
          whyItMatters: q.whyItMatters || 'Helps tailor your folder layout.',
          suggestedOptions:
            q.suggestedOptions && q.suggestedOptions.length >= 2
              ? q.suggestedOptions.slice(0, 4)
              : ['Yes, recommended', 'Keep simple', 'Skip this rule'],
        })),
      });
    } catch (err) {
      console.error('Error in /api/files/assess:', err);
      const formatted = formatApiError(err);
      res.status(formatted.status).json({ error: formatted.message });
    }
  });

  // 5. FILE ORGANIZER — STEP 2: GENERATE COMPLETE ORGANIZATION & RENAME BLUEPRINT
  app.post('/api/files/organize', async (req: Request, res: Response) => {
    try {
      const { command, files, proposedCategories, answers } = req.body as {
        command?: string;
        files?: Array<{
          id: string;
          name: string;
          relativePath: string;
          extension: string;
          sizeBytes: number;
          lastModified: string;
          previewSnippet?: string;
          takenDate?: string;
        }>;
        proposedCategories?: Array<{ name: string; description: string }>;
        answers?: Array<{ question: string; answer: string }>;
      };

      if (!files || files.length === 0) {
        res.status(400).json({ error: 'No files provided to organize.' });
        return;
      }

      const ai = getAiClient();
      const CHUNK_SIZE = 100;
      const PARALLEL_BATCHES = 3;
      type PlannedOp = {
        fileId: string;
        originalPath: string;
        targetFolder: string;
        newFileName: string;
        reason: string;
        wasRenamed: boolean;
      };
      const allOperations: PlannedOp[] = [];
      const categoryDescriptions = new Map<string, string>();
      let overallSummary = '';
      let batchesWithoutAi = 0;

      const batches: Array<typeof files> = [];
      for (let offset = 0; offset < files.length; offset += CHUNK_SIZE) {
        batches.push(files.slice(offset, offset + CHUNK_SIZE));
      }

      const planBatch = async (batch: typeof files) => {
        const compactBatch = batch.map((f) => ({
          fileId: f.id,
          name: f.name,
          currentPath: f.relativePath || f.name,
          ext: f.extension,
          modifiedDate: f.lastModified.slice(0, 10),
          ...(f.takenDate ? { photoTakenDate: f.takenDate.slice(0, 10) } : {}),
          ...(f.previewSnippet ? { snippet: f.previewSnippet.slice(0, 100) } : {}),
        }));

        const prompt = `You are Prospers Solutions File Organizer. The user has reviewed your first assessment, answered all 5 questions, and granted permission to organize and rename their files.

User Command:
"${command?.trim() || 'Organize similar files into clean category folders and improve messy filenames.'}"

Proposed Category Guide:
${JSON.stringify(proposedCategories ?? [], null, 2)}

User's Answers to the 5 Clarifying Questions:
${(answers ?? []).map((a, i) => `${i + 1}. Q: ${a.question}\n   User Answer: ${a.answer}`).join('\n')}

Files in This Batch (${batch.length} files):
${JSON.stringify(compactBatch, null, 2)}

Instructions:
1. Assign EVERY file in this batch (matching exact \`fileId\`) to a clean, well-named \`targetFolder\` (e.g. "Financial & Invoices/2026" or "Photos & Media") grouping similar files together according to the user's answers. Reuse the same folder names across files; do not invent near-duplicate folder names.
2. Provide a clean \`newFileName\` that strictly follows the user's renaming preference while keeping the original file extension intact. If the user asked NOT to rename files or the filename is already clean, keep \`newFileName\` identical to \`name\`.
3. Provide a brief 4-10 word \`reason\` explaining the grouping or rename.
4. When a file has \`photoTakenDate\`, that is the real date the photo or video was taken: use it (not modifiedDate) for any date-based folders or date-prefixed names. Month folders should look like "03 - March" so they sort in order.`;

        try {
          const response = await generateWithRetryAndFallback(
            ai,
            {
              model: FAST_STRUCTURED_MODEL,
              contents: prompt,
              config: {
                responseMimeType: 'application/json',
                responseSchema: {
                  type: Type.OBJECT,
                  properties: {
                    batchSummary: { type: Type.STRING },
                    categories: {
                      type: Type.ARRAY,
                      items: {
                        type: Type.OBJECT,
                        properties: {
                          folderPath: { type: Type.STRING },
                          description: { type: Type.STRING },
                        },
                        required: ['folderPath', 'description'],
                      },
                    },
                    operations: {
                      type: Type.ARRAY,
                      items: {
                        type: Type.OBJECT,
                        properties: {
                          fileId: { type: Type.STRING },
                          targetFolder: { type: Type.STRING },
                          newFileName: { type: Type.STRING },
                          reason: { type: Type.STRING },
                        },
                        required: ['fileId', 'targetFolder', 'newFileName', 'reason'],
                      },
                    },
                  },
                  required: ['batchSummary', 'categories', 'operations'],
                },
              },
            },
            RESEARCH_PRIMARY_MODEL
          );
          return JSON.parse((response.text ?? '{}').trim()) as {
            batchSummary?: string;
            categories?: Array<{ folderPath: string; description: string }>;
            operations?: Array<{ fileId: string; targetFolder: string; newFileName: string; reason: string }>;
          };
        } catch (err) {
          // Bad key: stop the whole run. Anything else: this batch gets simple by-type folders instead.
          if (formatApiError(err).status === 403) throw err;
          console.error('Organize batch failed, using simple grouping for it:', err);
          batchesWithoutAi++;
          return null;
        }
      };

      const planned = await runInPool(batches, PARALLEL_BATCHES, planBatch);

      batches.forEach((batch, b) => {
        const parsed = planned[b];
        if (!overallSummary && parsed?.batchSummary) {
          overallSummary = parsed.batchSummary;
        }

        for (const cat of parsed?.categories ?? []) {
          const safeFolder = sanitizeFolderPath(cat.folderPath);
          if (!categoryDescriptions.has(safeFolder)) {
            categoryDescriptions.set(safeFolder, cat.description);
          }
        }

        const opById = new Map((parsed?.operations ?? []).map((op) => [op.fileId, op]));
        for (const file of batch) {
          const matched = opById.get(file.id);
          const safeFolder = sanitizeFolderPath(
            matched?.targetFolder || (file.extension ? `${file.extension.toUpperCase()} Files` : 'Other Files')
          );
          const safeNewName = sanitizeFileNamePreservingExt(
            matched?.newFileName || file.name,
            file.name
          );
          if (!categoryDescriptions.has(safeFolder)) {
            categoryDescriptions.set(safeFolder, `Grouped similar items in ${safeFolder}`);
          }
          allOperations.push({
            fileId: file.id,
            originalPath: file.relativePath || file.name,
            targetFolder: safeFolder,
            newFileName: safeNewName,
            reason: matched?.reason || 'Grouped with files of the same type',
            wasRenamed: safeNewName !== file.name,
          });
        }
      });

      if (batchesWithoutAi === batches.length) {
        res.status(503).json({
          error: 'The AI is busy right now. Please wait about 30 seconds and try again. Nothing was changed.',
        });
        return;
      }

      // Deduplicate any filename collisions inside the same targetFolder
      const usedDestinationPaths = new Set<string>();
      for (const op of allOperations) {
        let candidateName = op.newFileName;
        let destKey = `${op.targetFolder}/${candidateName}`.toLowerCase();
        let counter = 2;
        while (usedDestinationPaths.has(destKey)) {
          const dotIdx = op.newFileName.lastIndexOf('.');
          const stem = dotIdx > 0 ? op.newFileName.slice(0, dotIdx) : op.newFileName;
          const ext = dotIdx > 0 ? op.newFileName.slice(dotIdx) : '';
          candidateName = `${stem} (${counter})${ext}`;
          destKey = `${op.targetFolder}/${candidateName}`.toLowerCase();
          counter++;
        }
        usedDestinationPaths.add(destKey);
        op.newFileName = candidateName;
      }

      res.json({
        planSummary:
          (overallSummary ||
            `Organized ${allOperations.length} files across ${categoryDescriptions.size} clean category folders.`) +
          (batchesWithoutAi > 0
            ? ` Note: the AI was busy for part of this folder, so some files were simply grouped by file type. Check those before saving.`
            : ''),
        categoriesCreated: Array.from(categoryDescriptions.entries()).map(
          ([folderPath, description]) => ({
            folderPath,
            description,
          })
        ),
        operations: allOperations,
      });
    } catch (err) {
      console.error('Error in /api/files/organize:', err);
      const formatted = formatApiError(err);
      res.status(formatted.status).json({ error: formatted.message });
    }
  });

  // Any unknown /api address gets a clear JSON answer, never the app's home page
  app.use('/api', (_req: Request, res: Response) => {
    res.status(404).json({ error: 'That feature is not available on this server version. Please refresh the app.' });
  });

  if (process.env.NODE_ENV !== 'production') {
    const { createServer: createViteServer } = await import('vite');
    const vite = await createViteServer({
      server: { middlewareMode: true },
      appType: 'spa',
    });
    app.use(vite.middlewares);
  } else {
    const distPath = path.join(__dirname, 'dist');
    app.use(express.static(distPath));
    app.get('*', (_req: Request, res: Response) => {
      res.sendFile(path.join(distPath, 'index.html'));
    });
  }

  app.listen(PORT, '0.0.0.0', () => {
    console.log(`Prospers Solutions server running on http://0.0.0.0:${PORT}`);
  });
}

startServer();
