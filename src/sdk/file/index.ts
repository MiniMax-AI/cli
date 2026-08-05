import { existsSync } from 'node:fs';
import { readFile } from 'node:fs/promises';
import { resolve, basename } from 'node:path';
import { Client } from '../client';
import {
  fileUploadEndpoint,
  fileListEndpoint,
  fileDeleteEndpoint,
  fileRetrieveEndpoint,
} from '../../client/endpoints';
import type {
  FileUploadResponse,
  FileListResponse,
  FileDeleteResponse,
  FileRetrieveResponse,
} from '../../types/api';
import { SDKError } from '../../errors/base';
import { ExitCode } from '../../errors/codes';
import { normalizeFileId } from '../../files/file-id';

export class FileSDK extends Client {
  /**
   * Upload a file to MiniMax storage.
   *
   * @param filePath - Absolute or relative path to the file on disk.
   * @param purpose  - File purpose, defaults to `"retrieval"`.
   */
  async upload(filePath: string, purpose = 'retrieval'): Promise<FileUploadResponse> {
    const fullPath = resolve(filePath);
    if (!existsSync(fullPath)) {
      throw new SDKError(`File not found: ${fullPath}`, ExitCode.USAGE);
    }

    const fileData = await readFile(fullPath);
    const fileName = basename(fullPath);

    const formData = new FormData();
    formData.append('file', new Blob([fileData]), fileName);
    formData.append('purpose', purpose);

    const url = fileUploadEndpoint(this.config.baseUrl);
    return this.requestJson<FileUploadResponse>({
      url,
      method: 'POST',
      body: formData,
    });
  }

  /** List all files in MiniMax storage. */
  async list(): Promise<FileListResponse> {
    const url = fileListEndpoint(this.config.baseUrl);
    return this.requestJson<FileListResponse>({ url, method: 'GET' });
  }

  /**
   * Delete a file from MiniMax storage by its file ID.
   *
   * Decimal strings are sent unchanged to preserve the full int64 range.
   * Safe integer numbers remain supported for backwards compatibility.
   *
   * @param fileId - The positive int64 ID of the file to delete.
   */
  async delete(fileId: string | number | bigint): Promise<FileDeleteResponse> {
    const normalizedFileId = normalizeFileId(fileId);
    if (!normalizedFileId) {
      throw new SDKError(
        'fileId must be a positive decimal integer within the int64 range.',
        ExitCode.USAGE,
      );
    }

    const url = fileDeleteEndpoint(this.config.baseUrl);
    return this.requestJson<FileDeleteResponse>({
      url,
      method: 'POST',
      body: { file_id: normalizedFileId },
    });
  }

  /**
   * Retrieve metadata (and optional download URL) for a file.
   *
   * @param fileId - The ID of the file to retrieve.
   */
  async retrieve(fileId: string): Promise<FileRetrieveResponse> {
    const url = fileRetrieveEndpoint(this.config.baseUrl, fileId);
    return this.requestJson<FileRetrieveResponse>({ url, method: 'GET' });
  }
}
