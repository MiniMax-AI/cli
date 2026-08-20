export interface TextChatFlags {
  model?: string;
  message?: string[];
  messagesFile?: string;
  system?: string;
  maxTokens?: number;
  temperature?: number;
  topP?: number;
  stream?: boolean;
  tool?: string[];
}

export interface SpeechSynthesizeFlags {
  model?: string;
  text?: string;
  textFile?: string;
  voice?: string;
  speed?: number;
  volume?: number;
  pitch?: number;
  format?: string;
  sampleRate?: number;
  bitrate?: number;
  channels?: number;
  language?: string;
  subtitles?: boolean;
  out?: string;
  outFormat?: string;
  stream?: boolean;
  pronunciation?: string[];
  soundEffect?: string;
}

export interface ImageGenerateFlags {
  prompt?: string;
  aspectRatio?: string;
  n?: number;
  subjectRef?: string;
  outDir?: string;
  outPrefix?: string;
}

export interface VideoGenerateFlags {
  model?: string;
  prompt?: string;
  image?: string;
  firstFrame?: string;
  lastFrame?: string;
  subjectImage?: string;
  referenceImage?: string[];
  referenceVideo?: string[];
  referenceAudio?: string[];
  duration?: number;
  ratio?: string;
  callbackUrl?: string;
  wait?: boolean;
  pollInterval?: number;
  download?: string;
}

export interface VideoTaskGetFlags {
  taskId?: string;
  model?: string;
}

export interface VideoDownloadFlags {
  fileId?: string;
  out?: string;
}

export interface AuthLoginFlags {
  method?: string;
  apiKey?: string;
  noBrowser?: boolean;
}

export interface ConfigSetFlags {
  key?: string;
  value?: string;
}
