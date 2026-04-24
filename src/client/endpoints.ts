export function chatEndpoint(baseUrl: string): string {
  return `${baseUrl}/anthropic/v1/messages`;
}

export function speechEndpoint(baseUrl: string): string {
  return `${baseUrl}/v1/t2a_v2`;
}

export function voicesEndpoint(baseUrl: string): string {
  return `${baseUrl}/v1/get_voice`;
}

export function imageEndpoint(baseUrl: string): string {
  return `${baseUrl}/v1/image_generation`;
}

export function videoGenerateEndpoint(baseUrl: string): string {
  return `${baseUrl}/v1/video_generation`;
}

export function videoTaskEndpoint(baseUrl: string, taskId: string): string {
  return `${baseUrl}/v1/query/video_generation?task_id=${taskId}`;
}

export function fileRetrieveEndpoint(baseUrl: string, fileId: string): string {
  return `${baseUrl}/v1/files/retrieve?file_id=${fileId}`;
}

export function musicEndpoint(baseUrl: string): string {
  return `${baseUrl}/v1/music_generation`;
}

export function searchEndpoint(baseUrl: string): string {
  return `${baseUrl}/v1/coding_plan/search`;
}

export function vlmEndpoint(baseUrl: string): string {
  return `${baseUrl}/v1/coding_plan/vlm`;
}

export function quotaEndpoint(baseUrl: string): string {
  // Quota endpoint uses api subdomain
  const host = baseUrl.includes('minimaxi.com') ? 'https://api.minimaxi.com' : 'https://api.minimax.io';
  return `${host}/v1/token_plan/remains`;
}

export function fileUploadEndpoint(baseUrl: string): string {
  return `${baseUrl}/v1/files`;
}

export function fileListEndpoint(baseUrl: string): string {
  return `${baseUrl}/v1/files`;
}

export function fileDeleteEndpoint(baseUrl: string, fileId: string): string {
  return `${baseUrl}/v1/files?file_id=${encodeURIComponent(fileId)}`;
}
