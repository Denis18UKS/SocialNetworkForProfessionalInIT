import { splitChatText } from "@/lib/chat-text.mjs";

type ChatMessageTextProps = {
  text?: string | null;
  className?: string;
};

const ChatMessageText = ({ text, className = "" }: ChatMessageTextProps) => {
  const parts = splitChatText(text || "");

  return (
    <span className={`whitespace-pre-wrap break-words [overflow-wrap:anywhere] ${className}`.trim()}>
      {parts.map((part, index) => (
        part.type === "link" ? (
          <a
            key={`${part.value}-${index}`}
            href={part.value}
            target="_blank"
            rel="noopener noreferrer nofollow ugc"
            className="underline decoration-current/60 underline-offset-2 hover:decoration-current"
            onClick={(event) => event.stopPropagation()}
          >
            {part.value}
          </a>
        ) : (
          <span key={`text-${index}`}>{part.value}</span>
        )
      ))}
    </span>
  );
};

export default ChatMessageText;
