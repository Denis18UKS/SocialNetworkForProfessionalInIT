import { Code2, ExternalLink, Play } from "lucide-react";
import { useNavigate } from "react-router-dom";
import { Button } from "@/components/ui/button";
import { useToast } from "@/components/ui/use-toast";

export type CodeLanguage = "java" | "csharp" | "cpp" | "lua" | "python" | "php" | "javascript" | "nodejs" | "react";

const supportedLanguages: CodeLanguage[] = ["java", "csharp", "cpp", "lua", "python", "php", "javascript", "nodejs", "react"];

export const normalizeCodeLanguage = (language?: string | null): CodeLanguage => {
  const normalized = (language || "javascript").toLowerCase();
  return supportedLanguages.includes(normalized as CodeLanguage) ? (normalized as CodeLanguage) : "javascript";
};

export const openCodeInVSCode = async (code: string, language?: string | null, source = "itbird-code") => {
  const token = localStorage.getItem("token");
  if (!token) throw new Error("Для открытия в VS Code нужно войти в аккаунт.");

  const response = await fetch("http://localhost:5000/code/open-vscode", {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      Authorization: `Bearer ${token}`,
    },
    body: JSON.stringify({
      code,
      language: normalizeCodeLanguage(language),
      source,
    }),
  });

  const data = await response.json().catch(() => null);
  if (!response.ok) throw new Error(data?.message || "Не удалось открыть код в VS Code.");

  window.location.href = data.vscodeUrl;
};

export const extractCodeBlocks = (text = "") => {
  const blocks: Array<{ language: string; code: string; index: number }> = [];
  const regex = /```([a-zA-Z0-9+#-]*)\n([\s\S]*?)```/g;
  let match;
  let index = 0;

  while ((match = regex.exec(text))) {
    blocks.push({
      language: match[1] || "javascript",
      code: match[2].replace(/\n$/, ""),
      index,
    });
    index += 1;
  }

  return blocks;
};

export const textWithoutCodeBlocks = (text = "") => text.replace(/```([a-zA-Z0-9+#-]*)\n([\s\S]*?)```/g, "").trim();

interface CodeSnippetProps {
  code: string;
  language?: string | null;
  source?: string;
  runnable?: boolean;
  className?: string;
}

const CodeSnippet = ({ code, language, source = "itbird-code", runnable = true, className = "" }: CodeSnippetProps) => {
  const navigate = useNavigate();
  const { toast } = useToast();
  const normalizedLanguage = normalizeCodeLanguage(language);
  const lines = code.split("\n");

  const runCode = () => {
    navigate("/compiler", {
      state: {
        language: normalizedLanguage,
        code,
      },
    });
  };

  const openVSCode = async () => {
    try {
      await openCodeInVSCode(code, normalizedLanguage, source);
    } catch (error) {
      toast({
        title: "Ошибка",
        description: error instanceof Error ? error.message : "Не удалось открыть VS Code.",
        variant: "destructive",
      });
    }
  };

  return (
    <div className={`overflow-hidden rounded-md border bg-gray-950 ${className}`}>
      <div className="flex items-center justify-between gap-2 border-b border-gray-800 px-3 py-2 text-xs text-gray-300">
        <span className="flex min-w-0 items-center gap-2">
          <Code2 className="h-4 w-4 shrink-0" />
          <span className="truncate">{language || normalizedLanguage}</span>
        </span>
        <div className="flex shrink-0 items-center gap-2">
          {runnable && (
            <Button size="sm" variant="secondary" className="h-8 gap-2" onClick={runCode}>
              <Play className="h-4 w-4" />
              Запустить
            </Button>
          )}
          <Button size="sm" variant="secondary" className="h-8 gap-2" onClick={openVSCode}>
            <ExternalLink className="h-4 w-4" />
            VS Code
          </Button>
        </div>
      </div>
      <div className="max-h-72 overflow-auto">
        <pre className="grid min-w-full grid-cols-[auto_1fr] text-sm leading-6">
          <code className="select-none border-r border-gray-800 bg-gray-900 px-3 py-3 text-right text-gray-500">
            {lines.map((_, index) => (
              <span key={index} className="block">
                {index + 1}
              </span>
            ))}
          </code>
          <code className="px-3 py-3 font-mono text-gray-100">
            {lines.map((line, index) => (
              <span key={index} className="block whitespace-pre">
                {line || " "}
              </span>
            ))}
          </code>
        </pre>
      </div>
    </div>
  );
};

export default CodeSnippet;
