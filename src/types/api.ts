// ---- Text / Chat (Anthropic Messages API) ----

export type ContentBlock =
  | { type: 'text'; text: string }
  | { type: 'thinking'; thinking: string }
  | { type: 'tool_use'; id: string; name: string; input: Record<string, unknown> }
  | { type: 'tool_result'; tool_use_id: string; content: string };

export interface ChatMessage {
  role: 'user' | 'assistant';
  content: string | ContentBlock[];
}

export interface ChatTool {
  name: string;
  description?: string;
  input_schema: Record<string, unknown>;
}

export interface ChatRequest {
  model: string;
  messages: ChatMessage[];
  max_tokens: number;
  system?: string;
  temperature?: number;
  top_p?: number;
  stream?: boolean;
  tools?: ChatTool[];
  tool_choice?: { type: 'auto' | 'any' | 'tool'; name?: string };
}

export interface ChatResponse {
  id: string;
  type: 'message';
  role: 'assistant';
  content: ContentBlock[];
  model: string;
  stop_reason: string;
  usage: {
    input_tokens: number;
    output_tokens: number;
  };
}

// ---- Anthropic Streaming Events ----

export interface StreamMessageStart {
  type: 'message_start';
  message: ChatResponse;
}

export interface StreamContentBlockStart {
  type: 'content_block_start';
  index: number;
  content_block: ContentBlock;
}

export interface StreamContentBlockDelta {
  type: 'content_block_delta';
  index: number;
  delta:
    | { type: 'text_delta'; text: string }
    | { type: 'thinking_delta'; thinking: string }
    | { type: 'input_json_delta'; partial_json: string };
}

export interface StreamContentBlockStop {
  type: 'content_block_stop';
  index: number;
}

export interface StreamMessageDelta {
  type: 'message_delta';
  delta: { stop_reason: string };
  usage: { output_tokens: number };
}

export interface StreamMessageStop {
  type: 'message_stop';
}

export type StreamEvent =
  | StreamMessageStart
  | StreamContentBlockStart
  | StreamContentBlockDelta
  | StreamContentBlockStop
  | StreamMessageDelta
  | StreamMessageStop;

// ---- Speech / TTS ----

export interface SpeechRequest {
  model: string;
  text: string;
  voice_setting: {
    voice_id: string;
    speed?: number;
    vol?: number;
    pitch?: number;
  };
  audio_setting: {
    format?: string;
    sample_rate?: number;
    bitrate?: number;
    channel?: number;
  };
  language_boost?: string;
  pronunciation_dict?: Array<{ tone: string; text: string }>;
  output_format?: 'url' | 'hex';
  stream?: boolean;
  subtitle?: boolean;
}

export interface SpeechResponse {
  base_resp: BaseResp;
  data: {
    audio?: string; // hex-encoded audio data
    audio_url?: string;
    subtitle_info?: SubtitleInfo;
    status: number;
  };
  extra_info?: {
    audio_length?: number;
    audio_sample_rate?: number;
    audio_size?: number;
    bitrate?: number;
    word_count?: number;
    invisible_character_ratio?: number;
  };
}

export interface SubtitleInfo {
  subtitles: Array<{
    text: string;
    start_time: number;
    end_time: number;
  }>;
}

// ---- Voice List ----

export interface SystemVoiceInfo {
  voice_id: string;
  voice_name: string;
  description: string[];
}

export interface VoiceListResponse {
  system_voice?: SystemVoiceInfo[];
  base_resp: BaseResp;
}

// ---- Image ----

export interface ImageRequest {
  model: string;
  prompt: string;
  aspect_ratio?: string;
  n?: number;
  subject_reference?: Array<{
    type: string;
    image_url?: string;
    image_file?: string;
  }>;
}

export interface ImageResponse {
  base_resp: BaseResp;
  data: {
    image_urls: string[];
    task_id: string;
    success_count: number;
    failed_count: number;
  };
}

// ---- Video ----

export interface VideoRequest {
  model: string;
  prompt: string;
  first_frame_image?: string;
  callback_url?: string;
}

export interface VideoResponse {
  base_resp: BaseResp;
  task_id: string;
  status: string;
}

export interface VideoTaskResponse {
  base_resp: BaseResp;
  task_id: string;
  status: 'Queueing' | 'Processing' | 'Success' | 'Failed' | 'Unknown';
  file_id?: string;
  video_width?: number;
  video_height?: number;
}

// ---- Music ----

export interface MusicRequest {
  model: string;
  prompt?: string;
  lyrics?: string;
  audio_setting?: {
    format?: string;
    sample_rate?: number;
    bitrate?: number;
  };
  output_format?: 'url' | 'hex';
  stream?: boolean;
  aigc_watermark?: boolean;
}

export interface MusicResponse {
  base_resp: BaseResp;
  data: {
    audio?: string;
    audio_url?: string;
    status: number;
  };
  extra_info?: {
    audio_length?: number;
    audio_sample_rate?: number;
    audio_size?: number;
    bitrate?: number;
  };
}

// ---- Quota ----

export interface QuotaResponse {
  model_remains: QuotaModelRemain[];
}

export interface QuotaModelRemain {
  model_name: string;
  start_time: number;
  end_time: number;
  remains_time: number;
  current_interval_total_count: number;
  current_interval_usage_count: number;
  current_weekly_total_count: number;
  current_weekly_usage_count: number;
  weekly_start_time: number;
  weekly_end_time: number;
  weekly_remains_time: number;
}

// ---- File ----

export interface FileUploadResponse {
  base_resp: BaseResp;
  file: {
    file_id: string;
    bytes: number;
    created_at: number;
    filename: string;
    purpose: string;
  };
}

export interface FileListResponse {
  base_resp: BaseResp;
  data: Array<{
    file_id: string;
    bytes: number;
    created_at: number;
    filename: string;
    purpose: string;
  }>;
}

export interface FileDeleteResponse {
  base_resp: BaseResp;
  id: string;
  object: string;
  deleted: boolean;
}

export interface FileRetrieveResponse {
  base_resp: BaseResp;
  file: {
    file_id: string;
    bytes: number;
    created_at: number;
    filename: string;
    purpose: string;
    download_url?: string;
  };
}

// ---- Common ----

export interface BaseResp {
  status_code: number;
  status_msg: string;
}
