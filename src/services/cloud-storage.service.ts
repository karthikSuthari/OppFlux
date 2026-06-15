// ===========================================
// Cloud Storage Service (Google Drive)
// ===========================================

import { JWT } from 'google-auth-library';
import { config } from '../config/env.js';
import { createServiceLogger } from '../utils/logger.js';
import { withRetry } from '../utils/retry.js';
import fs from 'fs';
import path from 'path';

const log = createServiceLogger('cloud-storage');

let authClient: JWT | null = null;
let folderId: string | null = null;

const FOLDER_NAME = 'ContentEngineImages';

/**
 * Get authenticated JWT client for Google Drive API
 */
async function getAuth(): Promise<JWT> {
  if (authClient) return authClient;

  authClient = new JWT({
    email: config.googleServiceAccountEmail,
    key: config.googlePrivateKey,
    scopes: ['https://www.googleapis.com/auth/drive.file'],
  });

  await authClient.authorize();
  return authClient;
}

/**
 * Get or create the images folder in Google Drive
 */
async function getOrCreateFolder(): Promise<string> {
  if (folderId) return folderId;

  const auth = await getAuth();
  const token = (await auth.getAccessToken()).token;

  // Search for existing folder
  const searchUrl = `https://www.googleapis.com/drive/v3/files?q=name='${FOLDER_NAME}' and mimeType='application/vnd.google-apps.folder' and trashed=false&fields=files(id,name)`;

  const searchRes = await fetch(searchUrl, {
    headers: { 'Authorization': `Bearer ${token}` },
  });

  const searchData = await searchRes.json() as { files: Array<{ id: string; name: string }> };

  if (searchData.files && searchData.files.length > 0) {
    folderId = searchData.files[0].id;
    log.info(`Using existing Drive folder: ${FOLDER_NAME} (${folderId})`);
    return folderId;
  }

  // Create new folder
  const createRes = await fetch('https://www.googleapis.com/drive/v3/files', {
    method: 'POST',
    headers: {
      'Authorization': `Bearer ${token}`,
      'Content-Type': 'application/json',
    },
    body: JSON.stringify({
      name: FOLDER_NAME,
      mimeType: 'application/vnd.google-apps.folder',
    }),
  });

  const createData = await createRes.json() as { id: string };
  folderId = createData.id;
  log.info(`Created Drive folder: ${FOLDER_NAME} (${folderId})`);

  return folderId;
}

/**
 * Upload a local image file to Google Drive and make it publicly accessible.
 *
 * @param localFilePath - Path to the local image file
 * @param fileName - Desired file name in Drive
 * @returns Public URL to the uploaded image
 */
export async function uploadImage(
  localFilePath: string,
  fileName: string
): Promise<string> {
  log.info(`Uploading image to Google Drive: ${fileName}`);

  try {
    const auth = await getAuth();
    const token = (await auth.getAccessToken()).token;
    const parentFolderId = await getOrCreateFolder();

    // Read the file
    const fileBuffer = fs.readFileSync(localFilePath);
    const fileBlob = new Blob([fileBuffer], { type: 'image/png' });

    // Create multipart upload body
    const metadata = JSON.stringify({
      name: fileName,
      parents: [parentFolderId],
    });
    const metadataBlob = new Blob([metadata], { type: 'application/json' });

    const formData = new FormData();
    formData.append('metadata', metadataBlob);
    formData.append('file', fileBlob, fileName);

    const uploadRes = await withRetry(
      async () => {
        const res = await fetch(
          'https://www.googleapis.com/upload/drive/v3/files?uploadType=multipart&fields=id,webViewLink,webContentLink',
          {
            method: 'POST',
            headers: { 'Authorization': `Bearer ${token}` },
            body: formData,
          }
        );

        if (!res.ok) {
          const errorText = await res.text();
          throw new Error(`Drive upload failed (${res.status}): ${errorText}`);
        }

        return res.json() as Promise<{ id: string; webViewLink?: string; webContentLink?: string }>;
      },
      { operationName: 'drive.uploadImage', maxRetries: 2 }
    );

    const fileId = uploadRes.id;

    // Make the file publicly accessible
    await fetch(`https://www.googleapis.com/drive/v3/files/${fileId}/permissions`, {
      method: 'POST',
      headers: {
        'Authorization': `Bearer ${token}`,
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({
        type: 'anyone',
        role: 'reader',
      }),
    });

    // Construct the direct download URL
    const publicUrl = `https://drive.google.com/uc?export=view&id=${fileId}`;

    log.info(`Image uploaded: ${publicUrl} (file ID: ${fileId})`);

    // Clean up local temp file
    try {
      fs.unlinkSync(localFilePath);
      log.debug(`Cleaned up local temp file: ${localFilePath}`);
    } catch {
      // Non-critical — ignore cleanup errors
    }

    return publicUrl;
  } catch (error) {
    const errMsg = error instanceof Error ? error.message : String(error);
    log.error('Cloud storage upload failed', { fileName, error: errMsg });
    // Return the local path as fallback
    return localFilePath;
  }
}

/**
 * Get the local file path for a temporarily saved image
 */
export function getTempImagePath(opportunityId: string): string {
  const imageDir = path.resolve(config.imageOutputDir);
  if (!fs.existsSync(imageDir)) {
    fs.mkdirSync(imageDir, { recursive: true });
  }
  return path.join(imageDir, `opp_${opportunityId}_${Date.now()}.png`);
}
