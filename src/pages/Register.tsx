import { useState } from "react";
import { useNavigate } from "react-router-dom";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Alert, AlertDescription, AlertTitle } from "@/components/ui/alert";
import { CheckCircle2 } from "lucide-react";
import { useToast } from "@/components/ui/use-toast";
import { motion } from "framer-motion";

const Register = () => {
  const [username, setUsername] = useState("");
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [gitHubUsername, setGitHubUsername] = useState("");
  const [gitLabUsername, setGitLabUsername] = useState("");
  const [showSuccessAlert, setShowSuccessAlert] = useState(false);
  const navigate = useNavigate();
  const { toast } = useToast();

  const handleRegister = async (e: React.FormEvent) => {
    e.preventDefault();

    try {
      const response = await fetch("http://localhost:5000/register", {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
        },
        body: JSON.stringify({
          username,
          email,
          password,
          github_username: gitHubUsername || null,
          gitlab_username: gitLabUsername || gitHubUsername || null,
        }),
      });

      const data = await response.json();

      if (response.ok) {
        setShowSuccessAlert(true);
        toast({
          title: "Успешная регистрация",
          description: "Теперь вы можете войти в свой аккаунт",
        });

        if (gitHubUsername) {
          await fetchAndSaveRepositories(gitHubUsername);
        }

        setTimeout(() => {
          setShowSuccessAlert(false);
          navigate("/login");
        }, 3000);
      } else {
        toast({
          title: "Ошибка",
          description: data.message,
          variant: "destructive",
        });
      }
    } catch (err) {
      console.error(err);
      toast({
        title: "Ошибка",
        description: "Ошибка при отправке данных на сервер",
        variant: "destructive",
      });
    }
  };

  const fetchAndSaveRepositories = async (githubUsername: string) => {
    try {
      const token = localStorage.getItem("token");

      if (!token) {
        console.error("Token not found, authorization required");
        return;
      }

      const response = await fetch(`http://localhost:5000/repositories/${githubUsername}`, {
        headers: {
          Authorization: `Bearer ${token}`,
        },
      });

      if (!response.ok) {
        const data = await response.json();
        console.error("Error fetching repositories:", data.message);
        return;
      }

      const repositories = await response.json();

      const saveResponse = await fetch("http://localhost:5000/repositories", {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          Authorization: `Bearer ${token}`,
        },
        body: JSON.stringify({
          githubUsername,
          repositories,
        }),
      });

      if (!saveResponse.ok) {
        const data = await saveResponse.json();
        console.error("Error saving repositories:", data.message);
      } else {
        console.log("Repositories saved successfully");
      }
    } catch (error) {
      console.error("Error in fetchAndSaveRepositories:", error);
    }
  };

  return (
    <div className="min-h-screen bg-gradient-to-br from-gray-50 to-gray-100 dark:from-gray-900 dark:to-gray-800 flex items-center justify-center p-4">
      <motion.div
        initial={{ opacity: 0, y: 20 }}
        animate={{ opacity: 1, y: 0 }}
        transition={{ duration: 0.3 }}
        className="w-full max-w-md"
      >
        <Card className="border border-gray-200 dark:border-gray-700 shadow-lg">
          <CardHeader className="space-y-1">
            <CardTitle className="text-2xl font-bold text-center">Регистрация</CardTitle>
            <CardDescription className="text-center text-gray-600 dark:text-gray-400">
              Создайте новый аккаунт IT-BIRD
            </CardDescription>
          </CardHeader>
          <CardContent>
            <form onSubmit={handleRegister} className="space-y-4">
              <div className="space-y-2">
                <Label htmlFor="username" className="text-gray-700 dark:text-gray-300">
                  Имя пользователя
                </Label>
                <Input
                  id="username"
                  value={username}
                  onChange={(e) => setUsername(e.target.value)}
                  required
                  className="border-gray-300 dark:border-gray-700 focus:ring-2 focus:ring-[#6E59A5]"
                />
              </div>
              <div className="space-y-2">
                <Label htmlFor="email" className="text-gray-700 dark:text-gray-300">
                  Почта
                </Label>
                <Input
                  id="email"
                  type="email"
                  value={email}
                  onChange={(e) => setEmail(e.target.value)}
                  required
                  className="border-gray-300 dark:border-gray-700 focus:ring-2 focus:ring-[#6E59A5]"
                />
              </div>
              <div className="space-y-2">
                <Label htmlFor="github" className="text-gray-700 dark:text-gray-300">
                  GitHub Username
                </Label>
                <Input
                  id="github"
                  value={gitHubUsername}
                  onChange={(e) => setGitHubUsername(e.target.value)}
                  placeholder="Если есть GitHub (Необязательное поле)"
                  className="border-gray-300 dark:border-gray-700 focus:ring-2 focus:ring-[#6E59A5]"
                />
              </div>
              <div className="space-y-2">
                <Label htmlFor="gitlab" className="text-gray-700 dark:text-gray-300">
                  GitLab Username
                </Label>
                <Input
                  id="gitlab"
                  value={gitLabUsername}
                  onChange={(e) => setGitLabUsername(e.target.value)}
                  placeholder="Если пусто, попробуем GitHub username"
                  className="border-gray-300 dark:border-gray-700 focus:ring-2 focus:ring-[#6E59A5]"
                />
              </div>
              <div className="space-y-2">
                <Label htmlFor="password" className="text-gray-700 dark:text-gray-300">
                  Пароль
                </Label>
                <Input
                  id="password"
                  type="password"
                  value={password}
                  onChange={(e) => setPassword(e.target.value)}
                  required
                  className="border-gray-300 dark:border-gray-700 focus:ring-2 focus:ring-[#6E59A5]"
                />
              </div>
              <Button
                type="submit"
                className="w-full bg-[#6E59A5] hover:bg-[#5a4a8a] text-white"
              >
                Зарегистрироваться
              </Button>
            </form>
          </CardContent>
        </Card>

        {showSuccessAlert && (
          <Alert className="fixed top-4 right-4 w-96 bg-white dark:bg-gray-800 border border-gray-200 dark:border-gray-700">
            <CheckCircle2 className="h-4 w-4 text-green-500" />
            <AlertTitle>Регистрация успешна</AlertTitle>
            <AlertDescription>
              Теперь вы можете войти в свой аккаунт
            </AlertDescription>
          </Alert>
        )}
      </motion.div>
    </div>
  );
};

export default Register;
