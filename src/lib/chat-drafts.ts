export type ChatDraftScope = "personal" | "group";

const fileDrafts = new Map<string, File[]>();
const storagePrefix = "socialbird-chat-draft:";

const keyFor = (scope: ChatDraftScope, chatId: string | number) => `${scope}:${String(chatId)}`;

export const readChatDraftText = (scope: ChatDraftScope, chatId: string | number) => {
  try {
    return localStorage.getItem(`${storagePrefix}${keyFor(scope, chatId)}`) || "";
  } catch {
    return "";
  }
};

export const writeChatDraftText = (scope: ChatDraftScope, chatId: string | number, text: string) => {
  try {
    const storageKey = `${storagePrefix}${keyFor(scope, chatId)}`;
    if (text) localStorage.setItem(storageKey, text);
    else localStorage.removeItem(storageKey);
  } catch {}
};

export const readChatDraftFiles = (scope: ChatDraftScope, chatId: string | number) =>
  [...(fileDrafts.get(keyFor(scope, chatId)) || [])];

export const writeChatDraftFiles = (scope: ChatDraftScope, chatId: string | number, files: File[]) => {
  const key = keyFor(scope, chatId);
  if (files.length > 0) fileDrafts.set(key, [...files]);
  else fileDrafts.delete(key);
};

export const clearChatDraft = (scope: ChatDraftScope, chatId: string | number) => {
  writeChatDraftText(scope, chatId, "");
  fileDrafts.delete(keyFor(scope, chatId));
};
