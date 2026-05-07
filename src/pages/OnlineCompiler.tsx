import { useMemo, useState } from "react";
import { useLocation } from "react-router-dom";
import { AlertCircle, CheckCircle2, Code2, Loader2, Play } from "lucide-react";
import { Alert, AlertDescription, AlertTitle } from "@/components/ui/alert";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { Textarea } from "@/components/ui/textarea";
import { useAuth } from "@/pages/AuthContext";

type CompilerLanguage =
  | "java"
  | "csharp"
  | "cpp"
  | "lua"
  | "python"
  | "php"
  | "javascript"
  | "nodejs"
  | "react";

type CompilerStep = {
  command: string;
  stdout?: string;
  stderr?: string;
  exitCode?: number | null;
  timedOut?: boolean;
  missingTool?: boolean;
};

type CompilerResult = {
  success: boolean;
  stdout?: string;
  stderr?: string;
  diagnostics?: string[];
  steps?: CompilerStep[];
};

const languages: Array<{ id: CompilerLanguage; title: string; hint: string }> = [
  { id: "java", title: "Java", hint: "Класс должен называться Main" },
  { id: "csharp", title: "C#", hint: "Запускается через csc, если он установлен" },
  { id: "cpp", title: "C++", hint: "Компиляция g++ с C++17" },
  { id: "lua", title: "Lua", hint: "Запуск через lua" },
  { id: "python", title: "Python", hint: "Запуск через python" },
  { id: "php", title: "PHP", hint: "Запуск через php" },
  { id: "javascript", title: "JavaScript", hint: "Запуск через node" },
  { id: "nodejs", title: "Node.js", hint: "Серверный JavaScript через node" },
  { id: "react", title: "React", hint: "Компиляция JSX через esbuild" },
];

const examples: Record<CompilerLanguage, string> = {
  java: `public class Main {
    public static void main(String[] args) {
        System.out.println("Hello from Java");
    }
}`,
  csharp: `using System;

class Program {
    static void Main() {
        Console.WriteLine("Hello from C#");
    }
}`,
  cpp: `#include <iostream>

int main() {
    std::cout << "Hello from C++" << std::endl;
    return 0;
}`,
  lua: `print("Hello from Lua")`,
  python: `print("Hello from Python")`,
  php: `<?php
echo "Hello from PHP" . PHP_EOL;
?>`,
  javascript: `console.log("Hello from JavaScript");`,
  nodejs: `const http = require("http");

const message = {
  runtime: "Node.js",
  status: "ok",
};

console.log(JSON.stringify(message, null, 2));`,
  react: `function App() {
  const skills = ["React", "JSX", "IT-BIRD"];

  return (
    <main className="compiler-preview">
      <h1>Hello from React</h1>
      <ul>
        {skills.map((skill) => (
          <li key={skill}>{skill}</li>
        ))}
      </ul>
    </main>
  );
}

export default App;`,
};

const getLogText = (result: CompilerResult | null) => {
  if (!result) return "Запустите код, чтобы увидеть логи компиляции и выполнения.";

  const parts = [
    result.stdout ? `STDOUT:\n${result.stdout}` : "",
    result.stderr ? `STDERR:\n${result.stderr}` : "",
    ...(result.steps || []).map((step) => {
      const status = step.exitCode === 0 ? "OK" : step.timedOut ? "TIMEOUT" : "ERROR";
      return `$ ${step.command}\nstatus: ${status}${typeof step.exitCode === "number" ? `, exit code: ${step.exitCode}` : ""}`;
    }),
  ].filter(Boolean);

  return parts.length > 0 ? parts.join("\n\n") : "Логи пустые.";
};

const OnlineCompiler = () => {
  const { isAuthenticated } = useAuth();
  const location = useLocation();
  const languageFromState = (location.state as { language?: string } | null)?.language;
  const initialLanguage = languages.some((language) => language.id === languageFromState)
    ? (languageFromState as CompilerLanguage)
    : "javascript";
  const initialCode = (location.state as { code?: string } | null)?.code;
  const [activeLanguage, setActiveLanguage] = useState<CompilerLanguage>(initialLanguage);
  const [codeByLanguage, setCodeByLanguage] = useState<Record<CompilerLanguage, string>>(() => ({
    ...examples,
    [initialLanguage]: initialCode || examples[initialLanguage],
  }));
  const [result, setResult] = useState<CompilerResult | null>(null);
  const [isRunning, setIsRunning] = useState(false);

  const activeMeta = useMemo(
    () => languages.find((language) => language.id === activeLanguage) || languages[0],
    [activeLanguage]
  );

  const runCode = async () => {
    if (!isAuthenticated) {
      setResult({
        success: false,
        diagnostics: ["Для запуска кода нужно войти в аккаунт."],
        stderr: "Авторизация не найдена.",
        steps: [],
      });
      return;
    }

    setIsRunning(true);
    setResult(null);

    try {
      const response = await fetch("http://localhost:5000/compiler/run", {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          Authorization: `Bearer ${localStorage.getItem("token")}`,
        },
        body: JSON.stringify({
          language: activeLanguage,
          code: codeByLanguage[activeLanguage],
        }),
      });

      const data = await response.json();
      setResult(data);
    } catch (error) {
      setResult({
        success: false,
        diagnostics: ["Не удалось связаться с backend-компилятором."],
        stderr: error instanceof Error ? error.message : "Неизвестная ошибка",
        steps: [],
      });
    } finally {
      setIsRunning(false);
    }
  };

  return (
    <div className="min-h-screen bg-gray-50 p-4 text-gray-950 dark:bg-gray-950 dark:text-gray-50">
      <div className="mx-auto flex max-w-7xl flex-col gap-4">
        <div className="flex flex-col gap-3 md:flex-row md:items-center md:justify-between">
          <div className="flex items-center gap-3">
            <div className="flex h-12 w-12 items-center justify-center rounded-md bg-primary text-primary-foreground">
              <Code2 className="h-7 w-7" />
            </div>
            <div>
              <h1 className="text-3xl font-bold">Онлайн Компилятор Кода</h1>
              <p className="text-sm text-muted-foreground">Пишите код, запускайте проверку и смотрите логи ошибок.</p>
            </div>
          </div>

          <Button onClick={runCode} disabled={isRunning} className="gap-2">
            {isRunning ? <Loader2 className="h-4 w-4 animate-spin" /> : <Play className="h-4 w-4" />}
            Запустить
          </Button>
        </div>

        <Tabs
          value={activeLanguage}
          onValueChange={(value) => {
            setActiveLanguage(value as CompilerLanguage);
            setResult(null);
          }}
          className="space-y-4"
        >
          <TabsList className="h-auto w-full flex-wrap justify-start gap-1 p-1">
            {languages.map((language) => (
              <TabsTrigger key={language.id} value={language.id} className="min-w-20">
                {language.title}
              </TabsTrigger>
            ))}
          </TabsList>

          {languages.map((language) => (
            <TabsContent key={language.id} value={language.id} className="m-0">
              <div className="grid gap-4 xl:grid-cols-[minmax(0,1.25fr)_minmax(360px,0.75fr)]">
                <Card className="overflow-hidden">
                  <CardHeader className="border-b">
                    <div className="flex flex-col gap-2 md:flex-row md:items-center md:justify-between">
                      <div>
                        <CardTitle>{language.title}</CardTitle>
                        <CardDescription>{language.hint}</CardDescription>
                      </div>
                      <Badge variant="outline">{activeMeta.title}</Badge>
                    </div>
                  </CardHeader>
                  <CardContent className="p-0">
                    <Textarea
                      value={codeByLanguage[language.id]}
                      onChange={(event) =>
                        setCodeByLanguage((current) => ({
                          ...current,
                          [language.id]: event.target.value,
                        }))
                      }
                      spellCheck={false}
                      className="min-h-[520px] resize-y rounded-none border-0 bg-gray-950 font-mono text-sm leading-6 text-gray-100 focus-visible:ring-0 focus-visible:ring-offset-0"
                    />
                  </CardContent>
                </Card>

                <div className="flex flex-col gap-4">
                  <Alert
                    className={
                      result
                        ? result.success
                          ? "border-emerald-500/40 bg-emerald-500/10"
                          : "border-red-500/40 bg-red-500/10"
                        : ""
                    }
                  >
                    {result?.success ? (
                      <CheckCircle2 className="h-4 w-4 text-emerald-500" />
                    ) : (
                      <AlertCircle className="h-4 w-4" />
                    )}
                    <AlertTitle>{result ? (result.success ? "Код выполнен" : "Есть проблема") : "Диагностика"}</AlertTitle>
                    <AlertDescription>
                      <div className="mt-2 space-y-2">
                        {(result?.diagnostics || ["Здесь появится краткое описание того, что не так в коде."]).map(
                          (item, index) => (
                            <p key={`${item}-${index}`}>{item}</p>
                          )
                        )}
                      </div>
                    </AlertDescription>
                  </Alert>

                  <Card className="min-h-[420px]">
                    <CardHeader>
                      <CardTitle>Логи ошибок</CardTitle>
                      <CardDescription>Команды, stdout, stderr и код завершения.</CardDescription>
                    </CardHeader>
                    <CardContent>
                      <pre className="max-h-[520px] overflow-auto whitespace-pre-wrap rounded-md border bg-gray-950 p-4 text-sm leading-6 text-gray-100">
                        {getLogText(result)}
                      </pre>
                    </CardContent>
                  </Card>
                </div>
              </div>
            </TabsContent>
          ))}
        </Tabs>
      </div>
    </div>
  );
};

export default OnlineCompiler;
