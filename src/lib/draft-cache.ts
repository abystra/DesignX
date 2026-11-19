const open = () =>
  new Promise<IDBDatabase>((resolve, reject) => {
    const req = indexedDB.open("designx-pending-documents", 1);
    req.onupgradeneeded = () => req.result.createObjectStore("drafts");
    req.onsuccess = () => resolve(req.result);
    req.onerror = () => reject(req.error);
  });
async function request(
  key: string,
  operation: "get" | "put" | "delete",
  value?: unknown,
) {
  const db = await open();
  try {
    return await new Promise<any>((resolve, reject) => {
      const tx = db.transaction(
        "drafts",
        operation === "get" ? "readonly" : "readwrite",
      );
      const store = tx.objectStore("drafts");
      const req =
        operation === "get"
          ? store.get(key)
          : operation === "put"
            ? store.put(value, key)
            : store.delete(key);
      let result: any;
      req.onsuccess = () => {
        result = req.result;
      };
      tx.oncomplete = () => resolve(result);
      tx.onerror = () => reject(tx.error);
      tx.onabort = () => reject(tx.error);
    });
  } finally {
    db.close();
  }
}
export const draftCache = {
  get: (key: string) => request(key, "get"),
  put: (key: string, value: unknown) => request(key, "put", value),
  remove: (key: string) => request(key, "delete"),
};

export async function projectDrafts(owner: string, projectId: string) {
  const db = await open();
  try {
    return await new Promise<any[]>((resolve, reject) => {
      const tx = db.transaction("drafts"),
        req = tx.objectStore("drafts").getAll();
      req.onsuccess = () =>
        resolve(
          req.result
            .filter((value) =>
              value.scope?.startsWith(`editor:${owner}:${projectId}:`),
            )
            .sort((a, b) => b.updatedAt - a.updatedAt),
        );
      req.onerror = () => reject(req.error);
    });
  } finally {
    db.close();
  }
}

// Each mounted editor owns a separate journal, including duplicated browser tabs.
// Taking over a recovered entry uses compare-and-delete so a live writer's newer
// changes are never removed by another editor's save/restore.
export function createDraftJournal(scope: string, legacyKey: string) {
  let key = `${scope}:${crypto.randomUUID()}`;
  let adopted: { key: IDBValidKey; value: any } | undefined;
  let queue: Promise<unknown> = Promise.resolve();
  const serial = <T>(fn: () => Promise<T>) => {
    const next = queue.then(fn);
    queue = next.catch(() => {});
    return next;
  };
  async function entries() {
    const db = await open();
    try {
      return await new Promise<Array<{ key: IDBValidKey; value: any }>>(
        (resolve, reject) => {
          const tx = db.transaction("drafts");
          const result: Array<{ key: IDBValidKey; value: any }> = [];
          const cursor = tx.objectStore("drafts").openCursor();
          cursor.onsuccess = () => {
            const row = cursor.result;
            if (!row) return;
            if (
              (row.value?.scope === scope && row.key !== key) ||
              row.key === legacyKey
            )
              result.push({ key: row.key, value: row.value });
            row.continue();
          };
          tx.oncomplete = () =>
            resolve(
              result.sort(
                (a, b) => (b.value.updatedAt || 0) - (a.value.updatedAt || 0),
              ),
            );
          tx.onerror = () => reject(tx.error);
          tx.onabort = () => reject(tx.error);
        },
      );
    } finally {
      db.close();
    }
  }
  async function removeAdopted() {
    const entry = adopted;
    if (!entry) return;
    const db = await open();
    try {
      await new Promise<void>((resolve, reject) => {
        const tx = db.transaction("drafts", "readwrite"),
          store = tx.objectStore("drafts");
        const read = store.get(entry.key);
        read.onsuccess = () => {
          if (JSON.stringify(read.result) === JSON.stringify(entry.value))
            store.delete(entry.key);
        };
        tx.oncomplete = () => resolve();
        tx.onerror = () => reject(tx.error);
        tx.onabort = () => reject(tx.error);
      });
      if (adopted === entry) adopted = undefined;
    } finally {
      db.close();
    }
  }
  return {
    list: () => serial(entries),
    adopt: (entry: { key: IDBValidKey; value: any }) =>
      serial(async () => {
        // Keep our current journal available as another recovery choice.
        key = `${scope}:${crypto.randomUUID()}`;
        adopted = entry;
      }),
    put: (value: any) => {
      const snapshot = structuredClone({
        ...value,
        scope,
        updatedAt: Date.now(),
      });
      return serial(async () => {
        await request(key, "put", snapshot);
        await removeAdopted();
      });
    },
    clear: () =>
      serial(async () => {
        await request(key, "delete");
        await removeAdopted();
      }),
  };
}
