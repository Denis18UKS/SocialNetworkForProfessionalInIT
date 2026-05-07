const onlineUsersStorageKey = "itbird-online-users";
const onlineUsersEventName = "itbird-online-users-change";

export const readOnlineUserIds = (): number[] => {
  try {
    const raw = localStorage.getItem(onlineUsersStorageKey);
    return raw ? JSON.parse(raw) : [];
  } catch {
    return [];
  }
};

export const writeOnlineUserIds = (userIds: number[]) => {
  const uniqueIds = Array.from(new Set(userIds.map(Number)));
  localStorage.setItem(onlineUsersStorageKey, JSON.stringify(uniqueIds));
  window.dispatchEvent(new CustomEvent<number[]>(onlineUsersEventName, { detail: uniqueIds }));
};

export const subscribeOnlineUserIds = (callback: (userIds: number[]) => void) => {
  const handler = (event: Event) => {
    callback((event as CustomEvent<number[]>).detail || []);
  };

  window.addEventListener(onlineUsersEventName, handler);

  return () => window.removeEventListener(onlineUsersEventName, handler);
};

