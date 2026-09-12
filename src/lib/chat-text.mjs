const HTTP_URL_PATTERN = /https?:\/\/[^\s<>"']+/gi;
const TRAILING_URL_PUNCTUATION = /[.,!?;:]+$/;

export const splitChatText = (input = '') => {
  const text = String(input ?? '');
  const parts = [];
  let cursor = 0;

  for (const match of text.matchAll(HTTP_URL_PATTERN)) {
    const start = match.index ?? 0;
    const raw = match[0];
    const trailingMatch = raw.match(TRAILING_URL_PUNCTUATION);
    const trailing = trailingMatch?.[0] || '';
    const url = trailing ? raw.slice(0, -trailing.length) : raw;

    if (start > cursor) {
      parts.push({ type: 'text', value: text.slice(cursor, start) });
    }

    if (url) parts.push({ type: 'link', value: url });
    if (trailing) parts.push({ type: 'text', value: trailing });
    cursor = start + raw.length;
  }

  if (cursor < text.length) {
    parts.push({ type: 'text', value: text.slice(cursor) });
  }

  return parts.length > 0 ? parts : [{ type: 'text', value: text }];
};

export const shouldSendChatOnKeyDown = ({
  key,
  shiftKey = false,
  coarsePointer = false,
  mobileUserAgent = false,
  touchPoints = 0,
  viewportWidth = Number.POSITIVE_INFINITY,
} = {}) => {
  const narrowTouchDevice = Number(touchPoints) > 0 && Number(viewportWidth) <= 1024;
  const mobileInput = Boolean(coarsePointer || mobileUserAgent || narrowTouchDevice);

  return key === 'Enter' && !shiftKey && !mobileInput;
};
