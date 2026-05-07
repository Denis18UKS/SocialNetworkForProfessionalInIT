import React, { useEffect, useState } from "react";
import { useNavigate } from "react-router-dom";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Avatar, AvatarFallback, AvatarImage } from "@/components/ui/avatar";
import { Badge } from "@/components/ui/badge";
import { useToast } from "@/hooks/use-toast";
import { ArrowLeft, Code, Github, Gitlab, Loader2, Lock, Mail, User } from "lucide-react";
import { motion } from "framer-motion";

const EditProfile = () => {
  const [avatar, setAvatar] = useState<File | null>(null);
  const [email, setEmail] = useState("");
  const [username, setUsername] = useState("");
  const [githubUsername, setGithubUsername] = useState("");
  const [gitlabUsername, setGitlabUsername] = useState("");
  const [skills, setSkills] = useState("");
  const [currentPassword, setCurrentPassword] = useState("");
  const [newPassword, setNewPassword] = useState("");
  const [confirmPassword, setConfirmPassword] = useState("");
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const { toast } = useToast();
  const navigate = useNavigate();

  useEffect(() => {
    const fetchProfile = async () => {
      const token = localStorage.getItem("token");
      if (!token) {
        setError("Пользователь не авторизован");
        setLoading(false);
        return;
      }

      try {
        const response = await fetch("http://localhost:5000/profile", {
          headers: { Authorization: `Bearer ${token}` },
        });

        if (!response.ok) throw new Error("Ошибка при загрузке профиля");

        const data = await response.json();
        const user = data.user;
        setEmail(user.email || "");
        setUsername(user.username || "");
        setGithubUsername(user.github_username || "");
        setGitlabUsername(user.gitlab_username || "");
        setSkills(user.skills || "");
      } catch (err) {
        setError(err instanceof Error ? err.message : "Ошибка при загрузке профиля");
      } finally {
        setLoading(false);
      }
    };

    fetchProfile();
  }, []);

  const handleSave = async () => {
    const token = localStorage.getItem("token");
    if (!token) {
      toast({
        title: "Ошибка",
        description: "Не удалось сохранить профиль: пользователь не авторизован",
        variant: "destructive",
      });
      return;
    }

    const wantsPasswordChange = Boolean(currentPassword || newPassword || confirmPassword);
    if (wantsPasswordChange) {
      if (!currentPassword || !newPassword || !confirmPassword) {
        toast({
          title: "Ошибка",
          description: "Заполните текущий пароль, новый пароль и подтверждение",
          variant: "destructive",
        });
        return;
      }
      if (newPassword.length < 6) {
        toast({
          title: "Ошибка",
          description: "Новый пароль должен быть не короче 6 символов",
          variant: "destructive",
        });
        return;
      }
      if (newPassword !== confirmPassword) {
        toast({
          title: "Ошибка",
          description: "Новый пароль и подтверждение не совпадают",
          variant: "destructive",
        });
        return;
      }
    }

    const formData = new FormData();
    if (avatar) formData.append("avatar", avatar);
    formData.append("username", username);
    formData.append("github_username", githubUsername);
    formData.append("gitlab_username", gitlabUsername);
    formData.append("skills", skills);
    formData.append("email", email);
    if (wantsPasswordChange) {
      formData.append("currentPassword", currentPassword);
      formData.append("newPassword", newPassword);
    }

    try {
      const response = await fetch("http://localhost:5000/profile/update", {
        method: "PUT",
        headers: { Authorization: `Bearer ${token}` },
        body: formData,
      });

      if (!response.ok) {
        const errorData = await response.json().catch(() => null);
        throw new Error(errorData?.message || "Ошибка при сохранении профиля");
      }

      setCurrentPassword("");
      setNewPassword("");
      setConfirmPassword("");
      toast({
        title: "Успех",
        description: wantsPasswordChange ? "Профиль и пароль обновлены" : "Профиль обновлен",
      });
      navigate("/profile");
    } catch (err) {
      toast({
        title: "Ошибка",
        description: err instanceof Error ? err.message : "Ошибка при сохранении профиля",
        variant: "destructive",
      });
    }
  };

  const handleAvatarChange = (event: React.ChangeEvent<HTMLInputElement>) => {
    const file = event.target.files?.[0];
    if (!file) return;

    if (!file.type.startsWith("image/")) {
      toast({
        title: "Ошибка",
        description: "Пожалуйста, выберите изображение",
        variant: "destructive",
      });
      return;
    }

    setAvatar(file);
  };

  if (loading) {
    return (
      <div className="flex min-h-screen items-center justify-center bg-gray-50 dark:bg-gray-900">
        <Loader2 className="h-8 w-8 animate-spin text-[#6E59A5]" />
      </div>
    );
  }

  return (
    <div className="min-h-screen bg-gray-50 px-4 py-8 dark:bg-gray-900 sm:px-6 lg:px-8">
      <div className="mx-auto max-w-3xl space-y-6">
        <motion.div initial={{ opacity: 0, y: -20 }} animate={{ opacity: 1, y: 0 }} transition={{ duration: 0.3 }}>
          <Button
            variant="ghost"
            onClick={() => navigate(-1)}
            className="flex items-center gap-2 text-[#6E59A5] hover:bg-[#6E59A5]/10"
          >
            <ArrowLeft className="h-5 w-5" />
            Назад к профилю
          </Button>
        </motion.div>

        <motion.div initial={{ opacity: 0, scale: 0.98 }} animate={{ opacity: 1, scale: 1 }} transition={{ duration: 0.3 }}>
          <Card className="w-full border border-gray-200 dark:border-gray-700">
            <CardHeader>
              <CardTitle className="text-2xl text-[#6E59A5]">Редактирование профиля</CardTitle>
              <CardDescription className="text-gray-600 dark:text-gray-400">
                Обновите личные данные и пароль аккаунта
              </CardDescription>
            </CardHeader>
            <CardContent>
              <div className="space-y-6">
                <div className="flex flex-col items-center space-y-4">
                  <div className="group relative">
                    <Avatar className="h-32 w-32 border-4 border-[#6E59A5]/20 shadow-lg">
                      {avatar ? (
                        <AvatarImage src={URL.createObjectURL(avatar)} />
                      ) : (
                        <AvatarFallback className="bg-[#6E59A5] text-4xl text-white">
                          {username.charAt(0).toUpperCase() || "U"}
                        </AvatarFallback>
                      )}
                    </Avatar>
                    <label
                      htmlFor="avatar-upload"
                      className="absolute inset-0 flex cursor-pointer items-center justify-center rounded-full bg-black/50 opacity-0 transition-opacity group-hover:opacity-100"
                    >
                      <span className="text-sm font-medium text-white">Изменить</span>
                    </label>
                  </div>
                  <input id="avatar-upload" type="file" onChange={handleAvatarChange} accept="image/*" className="hidden" />
                </div>

                <div className="space-y-4">
                  <div className="space-y-2">
                    <Label className="flex items-center gap-2 text-gray-700 dark:text-gray-300">
                      <Mail className="h-5 w-5 text-[#6E59A5]" />
                      Email
                    </Label>
                    <Input value={email} disabled className="cursor-not-allowed bg-gray-100 dark:bg-gray-800" />
                  </div>

                  <div className="space-y-2">
                    <Label className="flex items-center gap-2 text-gray-700 dark:text-gray-300">
                      <User className="h-5 w-5 text-[#6E59A5]" />
                      Имя пользователя
                    </Label>
                    <Input value={username} onChange={(event) => setUsername(event.target.value)} placeholder="Введите имя пользователя" />
                  </div>

                  <div className="space-y-2">
                    <Label className="flex items-center gap-2 text-gray-700 dark:text-gray-300">
                      <Github className="h-5 w-5 text-[#6E59A5]" />
                      GitHub Username
                    </Label>
                    <Input value={githubUsername} onChange={(event) => setGithubUsername(event.target.value)} placeholder="Введите GitHub Username" />
                  </div>

                  <div className="space-y-2">
                    <Label className="flex items-center gap-2 text-gray-700 dark:text-gray-300">
                      <Gitlab className="h-5 w-5 text-[#6E59A5]" />
                      GitLab Username
                    </Label>
                    <Input value={gitlabUsername} onChange={(event) => setGitlabUsername(event.target.value)} placeholder="Введите GitLab Username" />
                  </div>

                  <div className="space-y-2">
                    <Label className="flex items-center gap-2 text-gray-700 dark:text-gray-300">
                      <Code className="h-5 w-5 text-[#6E59A5]" />
                      Навыки
                    </Label>
                    <Input value={skills} onChange={(event) => setSkills(event.target.value)} placeholder="Введите навыки через запятую" />
                    <div className="mt-2 flex flex-wrap gap-2">
                      {skills
                        .split(",")
                        .filter((skill) => skill.trim())
                        .map((skill, index) => (
                          <Badge key={`${skill}-${index}`} variant="secondary" className="bg-[#6E59A5]/10 px-3 py-1 text-[#6E59A5]">
                            {skill.trim()}
                          </Badge>
                        ))}
                    </div>
                  </div>

                  <div className="space-y-4 rounded-lg border border-gray-200 p-4 dark:border-gray-700">
                    <div>
                      <h3 className="flex items-center gap-2 text-lg font-semibold text-gray-900 dark:text-white">
                        <Lock className="h-5 w-5 text-[#6E59A5]" />
                        Изменение пароля
                      </h3>
                      <p className="mt-1 text-sm text-gray-500 dark:text-gray-400">
                        Оставьте поля пустыми, если не хотите менять пароль.
                      </p>
                    </div>

                    <div className="space-y-2">
                      <Label className="text-gray-700 dark:text-gray-300">Текущий пароль</Label>
                      <Input
                        type="password"
                        value={currentPassword}
                        onChange={(event) => setCurrentPassword(event.target.value)}
                        placeholder="Введите текущий пароль"
                        autoComplete="current-password"
                      />
                    </div>

                    <div className="grid gap-4 sm:grid-cols-2">
                      <div className="space-y-2">
                        <Label className="text-gray-700 dark:text-gray-300">Новый пароль</Label>
                        <Input
                          type="password"
                          value={newPassword}
                          onChange={(event) => setNewPassword(event.target.value)}
                          placeholder="Минимум 6 символов"
                          autoComplete="new-password"
                        />
                      </div>

                      <div className="space-y-2">
                        <Label className="text-gray-700 dark:text-gray-300">Повторите новый пароль</Label>
                        <Input
                          type="password"
                          value={confirmPassword}
                          onChange={(event) => setConfirmPassword(event.target.value)}
                          placeholder="Повторите новый пароль"
                          autoComplete="new-password"
                        />
                      </div>
                    </div>
                  </div>

                  {error && (
                    <div className="rounded-lg bg-red-50 p-4 text-red-600 dark:bg-red-900/20 dark:text-red-400">
                      {error}
                    </div>
                  )}
                </div>

                <div className="flex flex-col gap-4 pt-4 sm:flex-row">
                  <Button onClick={handleSave} className="bg-[#6E59A5] text-white shadow-lg hover:bg-[#5a4a8a]" size="lg">
                    Сохранить изменения
                  </Button>
                  <Button
                    variant="outline"
                    onClick={() => navigate("/profile")}
                    className="border-[#6E59A5] text-[#6E59A5] hover:bg-[#6E59A5]/10"
                    size="lg"
                  >
                    Отменить
                  </Button>
                </div>
              </div>
            </CardContent>
          </Card>
        </motion.div>
      </div>
    </div>
  );
};

export default EditProfile;
