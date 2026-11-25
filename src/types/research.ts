export interface SubQuestionItem {
  id: string;
  question: string;
  stepDescription: string;
  enabled: boolean;
}

export interface ResearchPlanResponse {
  reportTitle: string;
  welcomeMessage: string;
  subQuestions: Array<{
    id: string;
    question: string;
    stepDescription: string;
  }>;
  permissionPrompt: string;
}

export interface GroundingSource {
  title: string;
  uri: string;
}

export interface FollowUpEntry {
  id: string;
  question: string;
  answerMarkdown: string;
  sources: GroundingSource[];
  completedAt: string;
}

export interface SavedResearchReport {
  id: string;
  title: string;
  topic: string;
  context: string;
  depth: 'concise' | 'detailed';
  subQuestions: SubQuestionItem[];
  reportMarkdown: string;
  sources: GroundingSource[];
  followUps: FollowUpEntry[];
  createdAt: string;
}

export interface WorkspacePreferences {
  defaultMode: 'instant' | 'guided';
  defaultDepth: 'concise' | 'detailed';
  customInstructions: string;
}
