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
  voice_setting?: {
    voice_id?: string;
    speed?: number;
    vol?: number;
    pitch?: number;
    // Emotion hint (e.g. 'happy', 'sad', 'calm'); passed through as-is — the
    // API validates the value, so no local enum to keep in sync.
    emotion?: string;
    text_normalization?: boolean;
    latex_read?: boolean;
  };
  audio_setting?: {
    format?: string;
    sample_rate?: number;
    bitrate?: number;
    channel?: number;
  };
  language_boost?: string;
  pronunciation_dict?: { tone: string[] };
  output_format?: 'url' | 'hex';
  stream?: boolean;
  subtitle_enable?: boolean;  // Correct API parameter name (not 'subtitle')
}

export interface SpeechResponse {
  base_resp: BaseResp;
  data: {
    audio?: string; // hex-encoded audio data
    audio_url?: string;
    subtitle_file?: string; // URL to download subtitle JSON file (when subtitle_enable=true)
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
  seed?: number;
  width?: number;
  height?: number;
  prompt_optimizer?: boolean;
  aigc_watermark?: boolean;
  response_format?: 'url' | 'base64';
  subject_reference?: Array<{
    type: string;
    image_url?: string;
    image_file?: string;
  }>;
}

export interface ImageResponse {
  base_resp: BaseResp;
  data: {
    image_urls?: string[];
    image_base64?: string[];
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
  last_frame_image?: string;
  callback_url?: string;
  subject_reference?: Array<{
    type: string;
    image: string[];
  }>;
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

export type VideoV2ImageRole = 'first_frame' | 'last_frame' | 'reference_image';
export type VideoV2Ratio = 'adaptive' | '21:9' | '16:9' | '4:3' | '1:1' | '3:4' | '9:16';
export type VideoV2Duration = 4 | 5 | 6 | 7 | 8 | 9 | 10 | 11 | 12 | 13 | 14 | 15;

export interface VideoV2TextContent {
  type: 'text';
  text: string;
}

export interface VideoV2ImageContent {
  type: 'image_url';
  image_url: { url: string };
  role?: VideoV2ImageRole;
}

export interface VideoV2VideoContent {
  type: 'video_url';
  video_url: { url: string };
  role: 'reference_video';
}

export interface VideoV2AudioContent {
  type: 'audio_url';
  audio_url: { url: string };
  role: 'reference_audio';
}

export type VideoV2ContentItem =
  | VideoV2TextContent
  | VideoV2ImageContent
  | VideoV2VideoContent
  | VideoV2AudioContent;

export interface VideoV2Request {
  model: 'MiniMax-H3';
  content: VideoV2ContentItem[];
  resolution: '2K';
  duration: VideoV2Duration;
  ratio?: VideoV2Ratio;
  callback_url?: string;
}

export interface VideoV2Response {
  task_id: string;
}

export interface VideoV2Task {
  id: string;
  model: string;
  status: 'queued' | 'running' | 'succeeded' | 'failed' | 'cancelled' | 'expired';
  error?: {
    code?: string;
    message?: string;
  };
  created_at?: number;
  updated_at?: number;
  content?: {
    url?: string;
  };
  resolution?: string;
  duration?: number;
  usage?: {
    total_seconds?: number;
    input_seconds?: number;
    output_seconds?: number;
    input_image_count?: number;
  };
  ratio?: string;
  task_type?: string;
}

export interface VideoV2TaskResponse {
  task: VideoV2Task;
}

// ---- Music ----

export interface MusicRequest {
  model: string;
  prompt?: string;
  lyrics?: string;
  is_instrumental?: boolean;
  lyrics_optimizer?: boolean;
  audio_url?: string;
  audio_base64?: string;
  cover_feature_id?: string;
  seed?: number;
  audio_setting?: {
    format?: string;
    sample_rate?: number;
    bitrate?: number;
    channel?: number;
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

export interface CoverPreprocessRequest {
  model: 'music-cover';
  audio_url?: string;
  audio_base64?: string;
}

export interface CoverPreprocessResponse {
  cover_feature_id: string;
  formatted_lyrics?: string;
  structure_result?: string;
  audio_duration?: number;
  trace_id?: string;
  base_resp: BaseResp;
}

// ---- Quota ----

export interface QuotaResponse {
  model_remains: QuotaModelRemain[];
}

export interface AccountBalanceResponse {
  available_amount: string;
  cash_balance: string;
  voucher_balance: string;
  credit_balance: string;
  owed_amount: string;
  balance_alert_switch: boolean;
  balance_alert_threshold: string;
  base_resp: BaseResp;
}

export interface QuotaModelRemain {
  model_name: string;
  start_time: number;
  end_time: number;
  remains_time: number;
  current_interval_total_count: number;
  current_interval_usage_count: number;
  current_interval_remaining_percent?: number;
  current_weekly_total_count: number;
  current_weekly_usage_count: number;
  current_weekly_remaining_percent?: number;
  // Server-side status. 1 = normal (limited), 2 = exhausted, 3 = unlimited.
  current_interval_status?: number;
  current_weekly_status?: number;
  weekly_start_time: number;
  weekly_end_time: number;
  weekly_remains_time: number;
  // Weekly display multiplier in permille (1/1000). The server returns the
  // base weekly remaining percent and a separate boost factor; the rendered
  // weekly value is base × (boost_permille / 1000). 1500 ⇒ display up to 150%.
  weekly_boost_permille?: number;
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
  files: Array<{
    file_id: string;
    bytes: number;
    created_at: number;
    filename: string;
    purpose: string;
  }>;
}

export interface FileDeleteResponse {
  base_resp: BaseResp;
  file_id: number;
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
