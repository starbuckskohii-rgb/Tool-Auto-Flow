

export type ActiveTab = 'generator' | 'tracker';
export type GeneratorTab = 'jesus' | 'trending' | 'seasonal' | 'looping' | 'cafe' | 'starbucks' | 'concert' | 'stage';
export type JobStatus = 'Pending' | 'Processing' | 'Generating' | 'Completed' | 'Failed';

export interface PromptItem {
    id: number;
    prompt_text: string;
    is_subject_lock?: boolean;
}

export interface Scene {
    scene_number: number;
    scene_title: string;
    prompt_text: string;
}

export interface GeneratorInputs {
    basicIdea: string;
    detailedIdea: string;
    style: string;
    market: string;
    duration: number;
    month: string;
    loopType: 'person' | 'nature';
    characterDesc: string;
    characterImage: { base64: string; mimeType: string } | null;
}

export interface UploadedImage {
  base64: string;
  mimeType: string;
}

export interface VideoJob {
    id: string;
    prompt: string;
    imagePath: string;
    imagePath2: string;
    imagePath3: string;
    status: JobStatus;
    videoName: string;
    typeVideo: string;
    videoPath?: string;
}
  
export interface TrackedFile {
  name: string;
  jobs: VideoJob[];
  path?: string;
  targetDurationSeconds?: number;
}

export interface ApiKey {
  id: string;
  name: string;
  value: string;
}

export interface AppConfig {
  machineId?: string;
  licenseKey?: string;
  apiKeysEncrypted?: string;
  activeApiKeyId?: string;
  toolFlowPath?: string;
  trackedFilePaths?: string[];
}

export interface DailyStats {
    date: string;
    count: number;
}

export interface StatsData {
    machineId: string;
    history: DailyStats[];
    total: number;
    promptCount: number;
    totalCredits: number;
}