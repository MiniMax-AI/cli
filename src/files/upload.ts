import { existsSync } from 'node:fs';
import { readFile } from 'node:fs/promises';
import { basename, resolve } from 'node:path';
import { fileUploadEndpoint } from '../client/endpoints';
import type { RequestOpts } from '../client/http';
import type { FileUploadResponse } from '../types/api';

type RequestFileUpload = (opts: RequestOpts) => Promise<FileUploadResponse>;
type CreateFileNotFoundError = (fullPath: string) => Error;

interface UploadFileOptions {
  filePath: string;
  purpose: string;
  baseUrl: string;
  requestJson: RequestFileUpload;
  createFileNotFoundError: CreateFileNotFoundError;
}

export function resolveFileUploadPath(
  filePath: string,
  createFileNotFoundError: CreateFileNotFoundError,
): string {
  const fullPath = resolve(filePath);
  if (!existsSync(fullPath)) {
    throw createFileNotFoundError(fullPath);
  }
  return fullPath;
}

export async function uploadFile({
  filePath,
  purpose,
  baseUrl,
  requestJson,
  createFileNotFoundError,
}: UploadFileOptions): Promise<FileUploadResponse> {
  const fullPath = resolveFileUploadPath(filePath, createFileNotFoundError);
  const fileData = await readFile(fullPath);

  const formData = new FormData();
  formData.append('file', new Blob([fileData]), basename(fullPath));
  formData.append('purpose', purpose);

  return requestJson({
    url: fileUploadEndpoint(baseUrl),
    method: 'POST',
    body: formData,
  });
}
