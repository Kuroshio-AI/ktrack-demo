// Tally sheet photos kept in this browser: IndexedDB, since localStorage holds only a few MB. The record keeps the id;
// on the trial the image also goes up to R2 (app/api/photos) through the outbox.
const DATABASE = "ktrack-photos";

function request<T>(mode: IDBTransactionMode, action: (store: IDBObjectStore) => IDBRequest<T>): Promise<T> {
  return new Promise((resolve, reject) => {
    const opening = indexedDB.open(DATABASE, 1);
    opening.onupgradeneeded = () => opening.result.createObjectStore("photos");
    opening.onerror = () => reject(opening.error);
    opening.onsuccess = () => {
      const db = opening.result;
      const pending = action(db.transaction("photos", mode).objectStore("photos"));
      pending.onsuccess = () => { resolve(pending.result); db.close(); };
      pending.onerror = () => { reject(pending.error); db.close(); };
    };
  });
}

export const savePhoto = (id: string, image: Blob) => request("readwrite", (store) => store.put(image, id));
export const loadPhoto = (id: string) => request<Blob | undefined>("readonly", (store) => store.get(id));
export const deletePhoto = (id: string) => request("readwrite", (store) => store.delete(id));
// Signing out, or another account on this laptop, clears them with the rest of the workspace.
export const clearPhotos = () => new Promise<void>((resolve) => { const deleting = indexedDB.deleteDatabase(DATABASE); deleting.onsuccess = deleting.onerror = deleting.onblocked = () => resolve(); });
