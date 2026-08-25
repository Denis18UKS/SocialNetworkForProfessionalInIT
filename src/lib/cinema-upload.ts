type UploadResult = {
  mediaUrl: string;
  fileName: string;
  fileSize: number;
  mimeType: string;
  recompressed: boolean;
};

type UploadOptions = {
  file: File;
  onProgress?: (percent: number) => void;
};

const api = "http://localhost:5000";
const MAX_PARALLEL_CHUNKS = 4;
const CHUNK_RETRIES = 3;

const sleep = (ms: number) => new Promise((resolve) => window.setTimeout(resolve, ms));

export const uploadCinemaVideo = async ({ file, onProgress }: UploadOptions): Promise<UploadResult> => {
  const token = localStorage.getItem("token");
  if (!token) throw new Error("Требуется авторизация");

  const init = await fetch(`${api}/cinema/uploads`, {
    method: "POST",
    headers: { Authorization: `Bearer ${token}`, "Content-Type": "application/json" },
    body: JSON.stringify({ fileName: file.name, fileSize: file.size, mimeType: file.type || "application/octet-stream" }),
  });
  const session = await init.json().catch(() => ({}));
  if (!init.ok) throw new Error(session?.message || "Не удалось начать загрузку");

  const chunkSize = Number(session.chunkSize);
  const totalChunks = Number(session.totalChunks);
  if (!Number.isFinite(chunkSize) || chunkSize <= 0 || !Number.isInteger(totalChunks) || totalChunks <= 0) {
    throw new Error("Сервер вернул некорректные параметры загрузки");
  }

  let nextIndex = 0;
  let completedBytes = 0;

  const uploadChunk = async (index: number) => {
    const start = index * chunkSize;
    const end = Math.min(file.size, start + chunkSize);
    const chunk = file.slice(start, end);
    let lastError: Error | null = null;

    for (let attempt = 1; attempt <= CHUNK_RETRIES; attempt += 1) {
      try {
        const response = await fetch(`${api}/cinema/uploads/${session.uploadId}/chunks/${index}`, {
          method: "PUT",
          headers: { Authorization: `Bearer ${token}`, "Content-Type": "application/octet-stream" },
          body: chunk,
        });
        const data = await response.json().catch(() => ({}));
        if (!response.ok) throw new Error(data?.message || `Не удалось загрузить часть ${index + 1}`);
        completedBytes += end - start;
        onProgress?.(Math.min(95, Math.max(1, Math.round((completedBytes / file.size) * 95))));
        return;
      } catch (error) {
        lastError = error instanceof Error ? error : new Error(`Не удалось загрузить часть ${index + 1}`);
        if (attempt < CHUNK_RETRIES) await sleep(350 * attempt);
      }
    }

    throw lastError || new Error(`Не удалось загрузить часть ${index + 1}`);
  };

  const worker = async () => {
    while (true) {
      const index = nextIndex;
      nextIndex += 1;
      if (index >= totalChunks) return;
      await uploadChunk(index);
    }
  };

  const concurrency = Math.max(1, Math.min(MAX_PARALLEL_CHUNKS, totalChunks));
  await Promise.all(Array.from({ length: concurrency }, () => worker()));

  const complete = await fetch(`${api}/cinema/uploads/${session.uploadId}/complete`, {
    method: "POST",
    headers: { Authorization: `Bearer ${token}` },
  });
  const result = await complete.json().catch(() => ({}));
  if (!complete.ok) throw new Error(result?.message || "Не удалось завершить загрузку");
  onProgress?.(100);
  return result as UploadResult;
};
