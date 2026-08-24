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
  for (let index = 0; index < totalChunks; index += 1) {
    const start = index * chunkSize;
    const end = Math.min(file.size, start + chunkSize);
    const chunk = file.slice(start, end);
    const response = await fetch(`${api}/cinema/uploads/${session.uploadId}/chunks/${index}`, {
      method: "PUT",
      headers: { Authorization: `Bearer ${token}`, "Content-Type": "application/octet-stream" },
      body: chunk,
    });
    const data = await response.json().catch(() => ({}));
    if (!response.ok) throw new Error(data?.message || `Не удалось загрузить часть ${index + 1}`);
    onProgress?.(Math.round(((index + 1) / totalChunks) * 95));
  }

  const complete = await fetch(`${api}/cinema/uploads/${session.uploadId}/complete`, {
    method: "POST",
    headers: { Authorization: `Bearer ${token}` },
  });
  const result = await complete.json().catch(() => ({}));
  if (!complete.ok) throw new Error(result?.message || "Не удалось завершить загрузку");
  onProgress?.(100);
  return result as UploadResult;
};
