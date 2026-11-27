// Save a file the user asked for (organized ZIP, undo files, research report).
// In a browser: a normal download. In the Android app: phones can't "download" from inside
// an app, so we save it to the app's storage and open the Share sheet, where the user can
// pick Files / Drive / Gmail / etc.

import { Capacitor } from '@capacitor/core';
import { Directory, Filesystem } from '@capacitor/filesystem';
import { Share } from '@capacitor/share';

function blobToBase64(blob: Blob): Promise<string> {
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onload = () => {
      const result = String(reader.result ?? '');
      resolve(result.slice(result.indexOf(',') + 1));
    };
    reader.onerror = () => reject(reader.error ?? new Error('Could not read the file'));
    reader.readAsDataURL(blob);
  });
}

export function isPhoneApp(): boolean {
  try {
    return Capacitor.isNativePlatform();
  } catch {
    return false;
  }
}

export async function saveFile(blob: Blob, fileName: string): Promise<void> {
  if (isPhoneApp()) {
    const written = await Filesystem.writeFile({
      path: fileName,
      data: await blobToBase64(blob),
      directory: Directory.Cache,
    });
    try {
      await Share.share({ title: fileName, files: [written.uri], dialogTitle: `Save ${fileName}` });
    } catch (err) {
      // Closing the Share sheet without picking anything is not an error
      const msg = err instanceof Error ? err.message : String(err);
      if (!/cancel/i.test(msg)) throw new Error(`Could not open the Save menu: ${msg}`);
    }
    return;
  }

  const url = URL.createObjectURL(blob);
  const link = document.createElement('a');
  link.href = url;
  link.download = fileName;
  document.body.appendChild(link);
  link.click();
  document.body.removeChild(link);
  setTimeout(() => URL.revokeObjectURL(url), 1000);
}
