export function chatEndpoint(baseUrl: string): string {
  return `${baseUrl}/anthropic/v1/messages`;
}

export function speechEndpoint(baseUrl: string): string {
  return `${baseUrl}/v1/t2a_v2`;
}

export function voicesEndpoint(baseUrl: string): string {
  return `${baseUrl}/v1/get_voice`;
}

export function voiceCloneEndpoint(baseUrl: string): string {
  return `${baseUrl}/v1/voice_clone`;
}

export function voiceDesignEndpoint(baseUrl: string): string {
  return `${baseUrl}/v1/voice_design`;
}

export function imageEndpoint(baseUrl: string): string {
  return `${baseUrl}/v1/image_generation`;
}

export function videoGenerateEndpoint(baseUrl: string): string {
  return `${baseUrl}/v1/video_generation`;
}

export function videoGenerateV2Endpoint(baseUrl: string): string {
  return `${baseUrl}/v2/video_generation`;
}

export function videoTaskEndpoint(baseUrl: string, taskId: string): string {
  return `${baseUrl}/v1/query/video_generation?task_id=${taskId}`;
}

export function videoTaskV2Endpoint(baseUrl: string, taskId: string): string {
  return `${baseUrl}/v2/query/video_generation/${taskId}`;
}

export function fileRetrieveEndpoint(baseUrl: string, fileId: string): string {
  return `${baseUrl}/v1/files/retrieve?file_id=${fileId}`;
}

export function searchEndpoint(baseUrl: string): string {
  return `${baseUrl}/v1/coding_plan/search`;
}

export function vlmEndpoint(baseUrl: string): string {
  return `${baseUrl}/v1/coding_plan/vlm`;
}

export function quotaEndpoint(baseUrl: string): string {
  return `${baseUrl}/v1/token_plan/remains`;
}

export function accountBalanceEndpoint(baseUrl: string): string {
  return `${baseUrl}/account/query_balance`;
}

export function isSecretApiKey(apiKey: string): boolean {
  return apiKey.startsWith('sk-api-');
}

export type UsageEndpointKind = 'quota' | 'account-balance';

export interface UsageCredential {
  token: string;
  method: 'api-key' | 'oauth';
}

export interface UsageEndpointSelection {
  url: string;
  kind: UsageEndpointKind;
}

export function selectUsageEndpoint(
  baseUrl: string,
  credential: UsageCredential,
): UsageEndpointSelection {
  if (credential.method === 'api-key' && isSecretApiKey(credential.token)) {
    return {
      url: accountBalanceEndpoint(baseUrl),
      kind: 'account-balance',
    };
  }

  return {
    url: quotaEndpoint(baseUrl),
    kind: 'quota',
  };
}

export function usageEndpoint(baseUrl: string, apiKey: string): string {
  return selectUsageEndpoint(baseUrl, { token: apiKey, method: 'api-key' }).url;
}

export function fileUploadEndpoint(baseUrl: string): string {
  return `${baseUrl}/v1/files/upload`;
}

export function fileListEndpoint(baseUrl: string): string {
  return `${baseUrl}/v1/files/list`;
}

export function fileDeleteEndpoint(baseUrl: string): string {
  return `${baseUrl}/v1/files/delete`;
}
