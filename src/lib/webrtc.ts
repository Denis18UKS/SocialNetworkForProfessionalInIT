const splitUrls = (value?: string) =>
  String(value || "")
    .split(",")
    .map((url) => url.trim())
    .filter(Boolean);

export const getIceServers = (): RTCIceServer[] => {
  const stunUrls = splitUrls(import.meta.env.VITE_STUN_URLS);
  const turnUrls = splitUrls(import.meta.env.VITE_TURN_URLS);

  const servers: RTCIceServer[] = [
    {
      urls: stunUrls.length > 0
        ? stunUrls
        : ["stun:stun.l.google.com:19302"],
    },
  ];

  const turnUsername = import.meta.env.VITE_TURN_USERNAME;
  const turnCredential = import.meta.env.VITE_TURN_CREDENTIAL;

  if (turnUrls.length > 0 && turnUsername && turnCredential) {
    servers.push({
      urls: turnUrls,
      username: turnUsername,
      credential: turnCredential,
    });
  }

  return servers;
};
