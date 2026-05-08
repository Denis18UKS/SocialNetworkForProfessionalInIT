import { useState } from "react";
import type { FormEvent } from "react";
import { useNavigate } from "react-router-dom";
import { AtSign, CheckCircle2 } from "lucide-react";
import { motion } from "framer-motion";
import { Alert, AlertDescription, AlertTitle } from "@/components/ui/alert";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { useToast } from "@/components/ui/use-toast";

const normalizeUserTag = (value: string) => value.trim().replace(/^@+/, "").toLowerCase();

const Register = () => {
  const [username, setUsername] = useState("");
  const [userTag, setUserTag] = useState("");
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [gitHubUsername, setGitHubUsername] = useState("");
  const [gitLabUsername, setGitLabUsername] = useState("");
  const [showSuccessAlert, setShowSuccessAlert] = useState(false);
  const navigate = useNavigate();
  const { toast } = useToast();

  const validateUserTag = () => {
    const normalized = normalizeUserTag(userTag);
    if (!normalized) return true;
    return /^[a-z0-9_]{3,32}$/.test(normalized);
  };

  const handleRegister = async (event: FormEvent) => {
    event.preventDefault();

    if (!validateUserTag()) {
      toast({
        title: "Ошибка",
        description: "@username должен быть от 3 до 32 символов: латиница, цифры и _.",
        variant: "destructive",
      });
      return;
    }

    try {
      const response = await fetch("http://localhost:5000/register", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          username,
          user_tag: normalizeUserTag(userTag) || null,
          email,
          password,
          github_username: gitHubUsername || null,
          gitlab_username: gitLabUsername || gitHubUsername || null,
        }),
      });

      const data = await response.json();

      if (!response.ok) {
        toast({
          title: "Ошибка",
          description: data.message || "Не удалось зарегистрироваться.",
          variant: "destructive",
        });
        return;
      }

      setShowSuccessAlert(true);
      toast({
        title: "Успешная регистрация",
        description: "Теперь вы можете войти в свой аккаунт.",
      });

      setTimeout(() => {
        setShowSuccessAlert(false);
        navigate("/login");
      }, 2500);
    } catch (error) {
      console.error(error);
      toast({
        title: "Ошибка",
        description: "Ошибка при отправке данных на сервер.",
        variant: "destructive",
      });
    }
  };

  return (
    <div className="flex min-h-screen items-center justify-center bg-gradient-to-br from-gray-50 to-gray-100 p-4 dark:from-gray-900 dark:to-gray-800">
      <motion.div initial={{ opacity: 0, y: 20 }} animate={{ opacity: 1, y: 0 }} transition={{ duration: 0.3 }} className="w-full max-w-md">
        <Card className="border border-gray-200 shadow-lg dark:border-gray-700">
          <CardHeader className="space-y-1">
            <CardTitle className="text-center text-2xl font-bold">Регистрация</CardTitle>
            <CardDescription className="text-center text-gray-600 dark:text-gray-400">
              Создайте новый аккаунт IT-BIRD
            </CardDescription>
          </CardHeader>
          <CardContent>
            <form onSubmit={handleRegister} className="space-y-4">
              <div className="space-y-2">
                <Label htmlFor="username" className="text-gray-700 dark:text-gray-300">Имя пользователя</Label>
                <Input id="username" value={username} onChange={(event) => setUsername(event.target.value)} required />
              </div>

              <div className="space-y-2">
                <Label htmlFor="user-tag" className="flex items-center gap-2 text-gray-700 dark:text-gray-300">
                  <AtSign className="h-4 w-4" />
                  @username
                </Label>
                <Input
                  id="user-tag"
                  value={userTag}
                  onChange={(event) => setUserTag(event.target.value)}
                  placeholder="@itbird_user"
                />
                <p className="text-xs text-muted-foreground">
                  Необязательно. Потом можно указать в редактировании профиля. Используется для упоминаний в групповых чатах.
                </p>
              </div>

              <div className="space-y-2">
                <Label htmlFor="email" className="text-gray-700 dark:text-gray-300">Почта</Label>
                <Input id="email" type="email" value={email} onChange={(event) => setEmail(event.target.value)} required />
              </div>

              <div className="space-y-2">
                <Label htmlFor="github" className="text-gray-700 dark:text-gray-300">GitHub Username</Label>
                <Input id="github" value={gitHubUsername} onChange={(event) => setGitHubUsername(event.target.value)} placeholder="Необязательно" />
              </div>

              <div className="space-y-2">
                <Label htmlFor="gitlab" className="text-gray-700 dark:text-gray-300">GitLab Username</Label>
                <Input id="gitlab" value={gitLabUsername} onChange={(event) => setGitLabUsername(event.target.value)} placeholder="Если пусто, попробуем GitHub username" />
              </div>

              <div className="space-y-2">
                <Label htmlFor="password" className="text-gray-700 dark:text-gray-300">Пароль</Label>
                <Input id="password" type="password" value={password} onChange={(event) => setPassword(event.target.value)} required />
              </div>

              <Button type="submit" className="w-full bg-[#6E59A5] text-white hover:bg-[#5a4a8a]">
                Зарегистрироваться
              </Button>
            </form>
          </CardContent>
        </Card>

        {showSuccessAlert && (
          <Alert className="fixed right-4 top-4 w-96 border border-gray-200 bg-white dark:border-gray-700 dark:bg-gray-800">
            <CheckCircle2 className="h-4 w-4 text-green-500" />
            <AlertTitle>Регистрация успешна</AlertTitle>
            <AlertDescription>Теперь вы можете войти в свой аккаунт.</AlertDescription>
          </Alert>
        )}
      </motion.div>
    </div>
  );
};

export default Register;
