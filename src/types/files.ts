export interface ScannedFileMeta {
  id: string;
  name: string;
  relativePath: string;
  extension: string;
  sizeBytes: number;
  lastModified: string;
  previewSnippet?: string;
  /** True when the file has not been changed in over 12 months */
  isOld?: boolean;
  /** Set when this file is an exact copy of another file in the scan */
  duplicateOfPath?: string;
  /** Best known date the photo/video was taken, local time "YYYY-MM-DDTHH:mm:ss" (or date only) */
  takenDate?: string;
  /** Where takenDate came from: the camera's info, the file name, or the last-changed date */
  dateSource?: 'camera' | 'name' | 'changed';
  /** Set when this photo looks like another photo (edited, resized, re-sent, burst) */
  similarToPath?: string;
}

export interface ProposedFileCategory {
  name: string;
  description: string;
  estimatedCount: number;
}

export interface ClarifyingQuestion {
  id: string;
  question: string;
  whyItMatters: string;
  suggestedOptions: string[];
}

export interface FileAssessmentResponse {
  overviewSummary: string;
  detectedPatterns: string[];
  proposedCategories: ProposedFileCategory[];
  questions: ClarifyingQuestion[];
}

export interface FileOrganizationOperation {
  fileId: string;
  originalPath: string;
  targetFolder: string;
  newFileName: string;
  reason: string;
  wasRenamed: boolean;
  approved: boolean;
  tag?: 'normal' | 'duplicate' | 'archive' | 'similar';
}

export interface FileOrganizationPlanResponse {
  planSummary: string;
  categoriesCreated: Array<{
    folderPath: string;
    description: string;
  }>;
  operations: Omit<FileOrganizationOperation, 'approved'>[];
}
