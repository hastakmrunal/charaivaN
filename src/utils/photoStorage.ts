// Internal App Data Storage for Captured & Uploaded Sight Photos
// Uses IndexedDB for reliable client-side internal memory storage in the app's dedicated sandbox

export interface SavedPhotoRecord {
  id: string;
  dataUrl: string;
  title: string;
  category?: string;
  locationName?: string;
  timestamp: string;
  sizeBytes: number;
}

const DB_NAME = 'CharaivaPhotoStorage';
const DB_VERSION = 1;
const STORE_NAME = 'app_saved_photos';

function openDB(): Promise<IDBDatabase> {
  return new Promise((resolve, reject) => {
    if (typeof window === 'undefined' || !window.indexedDB) {
      reject(new Error('IndexedDB is not supported in this environment'));
      return;
    }

    const request = indexedDB.open(DB_NAME, DB_VERSION);

    request.onupgradeneeded = (event) => {
      const db = (event.target as IDBOpenDBRequest).result;
      if (!db.objectStoreNames.contains(STORE_NAME)) {
        const store = db.createObjectStore(STORE_NAME, { keyPath: 'id' });
        store.createIndex('timestamp', 'timestamp', { unique: false });
      }
    };

    request.onsuccess = () => {
      resolve(request.result);
    };

    request.onerror = () => {
      reject(request.error);
    };
  });
}

/**
 * Save a clicked or uploaded photo into the phone/browser's internal app data storage
 */
export async function savePhotoToAppStorage(photo: {
  id?: string;
  dataUrl: string;
  title?: string;
  category?: string;
  locationName?: string;
}): Promise<{ success: boolean; id: string; sizeBytes: number }> {
  try {
    const db = await openDB();
    const id = photo.id || `photo_${Date.now()}_${Math.random().toString(36).substring(2, 7)}`;
    const sizeBytes = Math.round((photo.dataUrl.length * 3) / 4);

    const record: SavedPhotoRecord = {
      id,
      dataUrl: photo.dataUrl,
      title: photo.title || 'Captured Sight',
      category: photo.category || 'Sight',
      locationName: photo.locationName || '',
      timestamp: new Date().toISOString(),
      sizeBytes,
    };

    return new Promise((resolve, reject) => {
      const transaction = db.transaction(STORE_NAME, 'readwrite');
      const store = transaction.objectStore(STORE_NAME);
      const putRequest = store.put(record);

      putRequest.onsuccess = () => {
        resolve({ success: true, id, sizeBytes });
      };

      putRequest.onerror = () => {
        reject(putRequest.error);
      };
    });
  } catch (err) {
    console.error('Failed to save photo to app storage:', err);
    return { success: false, id: '', sizeBytes: 0 };
  }
}

/**
 * Retrieve all saved photos from the app's internal data storage
 */
export async function getSavedPhotosFromAppStorage(): Promise<SavedPhotoRecord[]> {
  try {
    const db = await openDB();
    return new Promise((resolve, reject) => {
      const transaction = db.transaction(STORE_NAME, 'readonly');
      const store = transaction.objectStore(STORE_NAME);
      const request = store.getAll();

      request.onsuccess = () => {
        const results = (request.result as SavedPhotoRecord[]) || [];
        // Sort descending by timestamp
        results.sort((a, b) => new Date(b.timestamp).getTime() - new Date(a.timestamp).getTime());
        resolve(results);
      };

      request.onerror = () => {
        reject(request.error);
      };
    });
  } catch (err) {
    console.warn('Failed to read saved photos from app storage:', err);
    return [];
  }
}

/**
 * Delete a specific photo from app storage
 */
export async function deletePhotoFromAppStorage(id: string): Promise<boolean> {
  try {
    const db = await openDB();
    return new Promise((resolve, reject) => {
      const transaction = db.transaction(STORE_NAME, 'readwrite');
      const store = transaction.objectStore(STORE_NAME);
      const request = store.delete(id);

      request.onsuccess = () => {
        resolve(true);
      };

      request.onerror = () => {
        reject(request.error);
      };
    });
  } catch (err) {
    console.warn('Failed to delete photo from app storage:', err);
    return false;
  }
}

/**
 * Clear all saved photos from the app's internal data storage
 */
export async function clearAllSavedPhotosFromAppStorage(): Promise<boolean> {
  try {
    const db = await openDB();
    return new Promise((resolve, reject) => {
      const transaction = db.transaction(STORE_NAME, 'readwrite');
      const store = transaction.objectStore(STORE_NAME);
      const request = store.clear();

      request.onsuccess = () => {
        resolve(true);
      };

      request.onerror = () => {
        reject(request.error);
      };
    });
  } catch (err) {
    console.warn('Failed to clear app photo storage:', err);
    return false;
  }
}

/**
 * Get internal storage statistics (total photos, bytes, formatted MB/KB)
 */
export async function getAppStorageStats(): Promise<{
  count: number;
  totalSizeBytes: number;
  formattedSize: string;
}> {
  try {
    const photos = await getSavedPhotosFromAppStorage();
    const count = photos.length;
    const totalSizeBytes = photos.reduce((acc, p) => acc + (p.sizeBytes || 0), 0);

    let formattedSize = '0 KB';
    if (totalSizeBytes > 1024 * 1024) {
      formattedSize = `${(totalSizeBytes / (1024 * 1024)).toFixed(2)} MB`;
    } else if (totalSizeBytes > 0) {
      formattedSize = `${(totalSizeBytes / 1024).toFixed(1)} KB`;
    }

    return { count, totalSizeBytes, formattedSize };
  } catch {
    return { count: 0, totalSizeBytes: 0, formattedSize: '0 KB' };
  }
}

/**
 * Retrieve a single stored photo by record ID from IndexedDB.
 */
export async function getPhotoByIdFromAppStorage(id: string): Promise<SavedPhotoRecord | null> {
  if (!id) return null;
  try {
    const db = await openDB();
    return new Promise((resolve) => {
      const transaction = db.transaction(STORE_NAME, 'readonly');
      const store = transaction.objectStore(STORE_NAME);
      const request = store.get(id);
      request.onsuccess = () => {
        resolve((request.result as SavedPhotoRecord) || null);
      };
      request.onerror = () => resolve(null);
    });
  } catch {
    return null;
  }
}

async function decodeImageSource(source: File | string): Promise<{ width: number; height: number; draw: (ctx: CanvasRenderingContext2D, w: number, h: number) => void } | null> {
  if (typeof source !== 'string') {
    const fileSource: File = source;
    if (typeof createImageBitmap === 'function') {
      try {
        const bitmap = await createImageBitmap(fileSource);
        return {
          width: bitmap.width,
          height: bitmap.height,
          draw: (ctx, w, h) => {
            ctx.drawImage(bitmap, 0, 0, w, h);
            bitmap.close?.();
          },
        };
      } catch {
        // fallback to FileReader + Image
      }
    }
    const rawDataUrl = await new Promise<string>((resolve) => {
      const r = new FileReader();
      r.onload = () => resolve(typeof r.result === 'string' ? r.result : '');
      r.onerror = () => resolve('');
      r.readAsDataURL(fileSource);
    });
    if (!rawDataUrl) return null;
    source = rawDataUrl;
  }

  return new Promise((resolve) => {
    const img = new Image();
    img.crossOrigin = 'anonymous';
    img.onload = () => {
      const w = img.naturalWidth || img.width;
      const h = img.naturalHeight || img.height;
      if (!w || !h) {
        resolve(null);
        return;
      }
      resolve({
        width: w,
        height: h,
        draw: (ctx, tw, th) => ctx.drawImage(img, 0, 0, tw, th),
      });
    };
    img.onerror = () => resolve(null);
    img.src = source;
  });
}

/**
 * Compresses any File or data URL into a clean JPEG data URI strictly within maxDataUrlChars (default 82 KB)
 * so user-attached journal photos persist reliably in Firestore and across reloads/devices.
 */
export async function compressImageToJournalDataUrl(
  source: File | string,
  maxDim: number = 560,
  maxDataUrlChars: number = 82000
): Promise<string> {
  if (typeof source === 'string' && source.startsWith('data:image/') && source.length <= maxDataUrlChars) {
    return source;
  }
  const decoded = await decodeImageSource(source);
  if (!decoded) {
    return typeof source === 'string' && source.startsWith('data:image/') && source.length <= 95000
      ? source
      : '';
  }

  const qualities = [0.74, 0.58, 0.44, 0.32];
  const scales = [1, 0.78, 0.58];

  for (const scale of scales) {
    const limit = Math.round(maxDim * scale);
    let w = decoded.width;
    let h = decoded.height;
    if (w > limit || h > limit) {
      if (w > h) {
        h = Math.max(1, Math.round((h * limit) / w));
        w = limit;
      } else {
        w = Math.max(1, Math.round((w * limit) / h));
        h = limit;
      }
    }
    const canvas = document.createElement('canvas');
    canvas.width = w;
    canvas.height = h;
    const ctx = canvas.getContext('2d');
    if (!ctx) return '';
    decoded.draw(ctx, w, h);

    for (const q of qualities) {
      const attempt = canvas.toDataURL('image/jpeg', q);
      if (attempt && attempt.length <= maxDataUrlChars) {
        return attempt;
      }
    }
  }
  return '';
}

