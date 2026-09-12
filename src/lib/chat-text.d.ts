export type ChatTextPart = {
  type: 'text' | 'link';
  value: string;
};

export type ChatKeyDecisionInput = {
  key?: string;
  shiftKey?: boolean;
  coarsePointer?: boolean;
};

export function splitChatText(input?: string | null): ChatTextPart[];
export function shouldSendChatOnKeyDown(input?: ChatKeyDecisionInput): boolean;
