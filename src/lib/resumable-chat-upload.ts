import { apiUrl } from "@/lib/settings";

export type ChatUploadScope = "personal" | "group";

type StartResponse = {
  uploadId: string;
  chunkBytes: number;
  totalChunks: number;
  fileSize: number;
};

type UploadOptions = {
  scope: ChatUploadScope;
  chatId: number;
  file: File;
  message?: string;
  onProgress?: (progress: number) => void;
  signal?: AbortSignal;
};

const authHeaders = () => {
  const token = localStorage.getItem("token");
  if (!token) throw new Error("Нет авторизации");
  return { Authorization: `Bearer ${token}` };
};

const jsonError = async (response: Response, fallback: string) => {
  const body = await response.json().catch(() => null);
  return new Error(body?.message || fallback);
};

export const uploadChatFile = async ({
  scope,
  chatId,
  file,
  message = "",
  onProgress,
  signal,
}: UploadOptions) => {
  if (!file || file.size <= 0) throw new Error("Файл пустой");

  const startResponse = await fetch(apiUrl("/chat-upload/start"), {
    method: "POST",
    headers: {
      ...authHeaders(),
      "Content-Type": "application/json",
    },
    body: JSON.stringify({
      scope,
      chatId,
      fileName: file.name,
      fileSize: file.size,
      mimeType: file.type || "application/octet-stream",
      message,
    }),
    signal,
  });
  if (!startResponse.ok) throw await jsonError(startResponse, "Не удалось начать загрузку файла");

  const session = await startResponse.json() as StartResponse;
  let finished = false;

  try {
    for (let index = 0; index < session.totalChunks; index += 1) {
      const start = index * session.chunkBytes;
      const end = Math.min(file.size, start + session.chunkBytes);
      const chunk = file.slice(start, end);
      const response = await fetch(apiUrl(`/chat-upload/${session.uploadId}/chunks/${index}`), {
        method: "PUT",
        headers: {
          ...authHeaders(),
          "Content-Type": "application/octet-stream",
        },
        body: chunk,
        signal,
      });
      if (!response.ok) throw await jsonError(response, `Не удалось загрузить часть ${index + 1}`);
      onProgress?.(Math.min(99, Math.round((end / file.size) * 100)));
    }

    const finishResponse = await fetch(apiUrl(`/chat-upload/${session.uploadId}/finish`), {
      method: "POST",
      headers: authHeaders(),
      signal,
    });
    if (!finishResponse.ok) throw await jsonError(finishResponse, "Не удалось завершить загрузку файла");
    const messageResult = await finishResponse.json();
    finished = true;
    onProgress?.(100);
    return messageResult;
  } finally {
    if (!finished) {
      void fetch(apiUrl(`/chat-upload/${session.uploadId}`), {
        method: "DELETE",
        headers: authHeaders(),
      }).catch(() => undefined);
    }
  }
};
