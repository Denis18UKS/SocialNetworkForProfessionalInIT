import React, { useState, useEffect } from "react";
import { useNavigate } from "react-router-dom";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle, CardDescription } from "@/components/ui/card";
import { useToast } from "@/hooks/use-toast";
import { LiquidButton } from "@/components/ui/liquid-button";
import { Loader2, ChevronUp, GitFork, Star, Download, File, Folder, ChevronLeft } from "lucide-react";
import { Input } from "@/components/ui/input";
import { motion, AnimatePresence } from "framer-motion";
import { format } from "date-fns";
import { ru } from "date-fns/locale";
import { Tabs, TabsList, TabsTrigger } from "@/components/ui/tabs";

interface Repository {
  name: string;
  html_url: string;
  stargazers_count?: number;
  forks_count?: number;
  language?: string | null;
}

interface User {
  username: string;
  skills: string;
  avatar: string | null;
  github_username: string;
  gitlab_username?: string;
}

interface Commit {
  sha: string;
  commit: {
    author: {
      name: string;
      date: string;
    };
    message: string;
  };
}

interface FileInfo {
  name: string;
  type: string;
  sha: string;
  download_url?: string;
  path: string;
  size?: number;
}

const MyProfile = () => {
  const [user, setUser] = useState<User | null>(null);
  const [repositories, setRepositories] = useState<Repository[]>([]);
  const [githubRepositories, setGithubRepositories] = useState<Repository[]>([]);
  const [gitlabRepositories, setGitlabRepositories] = useState<Repository[]>([]);
  const [filteredRepositories, setFilteredRepositories] = useState<Repository[]>([]);
  const [activeProvider, setActiveProvider] = useState<"github" | "gitlab">("github");
  const [repoPage, setRepoPage] = useState(1);
  const [loading, setLoading] = useState(true);
  const [downloadLoading, setDownloadLoading] = useState(false);
  const [searchTerm, setSearchTerm] = useState("");
  const [showScrollButton, setShowScrollButton] = useState(false);

  const navigate = useNavigate();
  const { toast } = useToast();

  useEffect(() => {
    const handleScroll = () => {
      setShowScrollButton(window.scrollY > 300);
    };

    window.addEventListener('scroll', handleScroll);
    return () => window.removeEventListener('scroll', handleScroll);
  }, []);

  useEffect(() => {
    const fetchUserData = async () => {
      const token = localStorage.getItem("token");

      if (!token) {
        setLoading(false);
        toast({
          title: "Ошибка",
          description: "Требуется авторизация",
          variant: "destructive",
        });
        return;
      }

      try {
        const response = await fetch("http://localhost:5000/profile", {
          headers: {
            Authorization: `Bearer ${token}`,
          },
        });

        if (!response.ok) throw new Error("Не удалось загрузить профиль");

        const data = await response.json();
        setUser(data.user);
        const github = data.githubRepositories || data.repositories || [];
        const gitlab = data.gitlabRepositories || [];
        setGithubRepositories(github);
        setGitlabRepositories(gitlab);
        setRepositories(github);
        setFilteredRepositories(github);

        if (!data.repositories || data.repositories.length === 0) {
          const backupResponse = await fetch("http://localhost:5000/profile/repositories", {
            headers: {
              Authorization: `Bearer ${token}`,
            },
          });

          if (backupResponse.ok) {
            const backupData = await backupResponse.json();
            setRepositories(backupData.repositories || []);
            setFilteredRepositories(backupData.repositories || []);
          }
        }
      } catch (error) {
        toast({
          title: "Ошибка",
          description: "Не удалось загрузить данные профиля",
          variant: "destructive",
        });
      } finally {
        setLoading(false);
      }
    };

    fetchUserData();
  }, []);

  const handleSearch = (e: React.ChangeEvent<HTMLInputElement>) => {
    const searchValue = e.target.value.toLowerCase();
    setSearchTerm(searchValue);
    const source = activeProvider === "github" ? githubRepositories : gitlabRepositories;
    setFilteredRepositories(
      source.filter(repo => repo.name.toLowerCase().includes(searchValue))
    )
    setRepoPage(1);
  }

  useEffect(() => {
    const source = activeProvider === "github" ? githubRepositories : gitlabRepositories;
    setRepositories(source);
    setFilteredRepositories(source.filter(repo => repo.name.toLowerCase().includes(searchTerm.toLowerCase())));
    setRepoPage(1);
  }, [activeProvider, githubRepositories, gitlabRepositories]);

  const handleDownload = async (repoName: string) => {
    setDownloadLoading(true);
    try {
      const response = await fetch(
        `http://localhost:5000/github/repos/${user?.github_username}/${repoName}/download`
      );
      const blob = await response.blob();
      const url = window.URL.createObjectURL(blob);
      const a = document.createElement('a');
      a.href = url;
      a.download = `${repoName}.zip`;
      document.body.appendChild(a);
      a.click();
      a.remove();
      toast({
        title: "Успех",
        description: "Репозиторий успешно скачан",
      });
    } catch (error) {
      toast({
        title: "Ошибка",
        description: "Не удалось скачать репозиторий",
        variant: "destructive",
      });
    } finally {
      setDownloadLoading(false);
    }
  };

  const scrollToTop = () => {
    window.scrollTo({
      top: 0,
      behavior: 'smooth'
    });
  };

  if (loading) {
    return (
      <div className="min-h-screen flex items-center justify-center">
        <Loader2 className="h-8 w-8 animate-spin text-[#6E59A5]" />
      </div>
    );
  }

  if (!user) {
    return (
      <div className="min-h-screen flex items-center justify-center">
        <p className="text-lg text-muted-foreground">Ошибка загрузки данных пользователя</p>
      </div>
    );
  }

  return (
    <div className="min-h-screen bg-gray-50 dark:bg-gray-900 py-8 px-4 sm:px-6 lg:px-8">
      <div className="max-w-7xl mx-auto space-y-8">
        {/* User Profile Card */}
        <motion.div
          initial={{ opacity: 0, y: -20 }}
          animate={{ opacity: 1, y: 0 }}
          transition={{ duration: 0.5 }}
        >
          <Card className="w-full">
            <CardHeader className="flex flex-col sm:flex-row items-start sm:items-center justify-between gap-4">
              <div className="flex items-center space-x-4">
                <div className="relative">
                  <img
                    src={user.avatar ? `http://localhost:5000${user.avatar}` : "/placeholder.svg"}
                    alt={`${user.username}'s avatar`}
                    className="w-20 h-20 rounded-full object-cover border-4 border-[#6E59A5]/20"
                  />
                </div>
                <div>
                  <CardTitle className="text-2xl">{user.username}</CardTitle>
                  <CardDescription className="mt-1">
                    {user.skills || "Навыки не указаны"}
                  </CardDescription>
                </div>
              </div>
              <div className="flex flex-wrap gap-3">
                <LiquidButton
                  text="Редактировать профиль"
                  color1="#9b87f5"
                  color2="#6E59A5"
                  color3="#8F17E1"
                  width={200}
                  height={45}
                  onClick={() => navigate("/profile/edit")}
                />
              </div>
            </CardHeader>
          </Card>
        </motion.div>

        {/* Repositories Section */}
        <motion.div
          initial={{ opacity: 0, y: 20 }}
          animate={{ opacity: 1, y: 0 }}
          transition={{ duration: 0.5, delay: 0.1 }}
        >
          <Card>
            <CardHeader>
              <div className="flex flex-col sm:flex-row justify-between items-start sm:items-center gap-4">
                <div>
                  <CardTitle>Мои репозитории</CardTitle>
                  <CardDescription className="mt-1">
                    {repositories.length} репозиториев
                  </CardDescription>
                </div>
                <Tabs value={activeProvider} onValueChange={(value) => setActiveProvider(value as "github" | "gitlab")}>
                  <TabsList>
                    <TabsTrigger value="github">GitHub</TabsTrigger>
                    <TabsTrigger value="gitlab" disabled={!user.gitlab_username && gitlabRepositories.length === 0}>GitLab</TabsTrigger>
                  </TabsList>
                </Tabs>
                <Input
                  type="text"
                  value={searchTerm}
                  onChange={handleSearch}
                  className="w-full sm:w-64"
                  placeholder="Поиск репозиториев..."
                />
              </div>
            </CardHeader>
            <CardContent>
              {filteredRepositories.length === 0 ? (
                <div className="text-center py-12">
                  <div className="bg-gray-100 dark:bg-gray-800 rounded-full w-16 h-16 flex items-center justify-center mx-auto mb-4">
                    <svg xmlns="http://www.w3.org/2000/svg" className="h-8 w-8 text-gray-500" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                      <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={1.5} d="M9.172 16.172a4 4 0 015.656 0M9 10h.01M15 10h.01M21 12a9 9 0 11-18 0 9 9 0 0118 0z" />
                    </svg>
                  </div>
                  <h3 className="text-lg font-medium text-gray-900 dark:text-gray-100">
                    Репозитории не найдены
                  </h3>
                  <p className="text-gray-500 dark:text-gray-400 mt-1">
                    {searchTerm ? "Попробуйте изменить запрос" : "Свяжите ваш GitHub аккаунт"}
                  </p>
                </div>
              ) : (
                <ul className="space-y-6">
                  {filteredRepositories.slice((repoPage - 1) * 10, repoPage * 10).map((repo, index) => (
                    <RepositoryItem
                      key={repo.name + index}
                      repo={repo}
                      user={user}
                      provider={activeProvider}
                      onDownload={handleDownload}
                      downloadLoading={downloadLoading}
                    />
                  ))}
                </ul>
              )}
              {filteredRepositories.length > 10 && (
                <div className="mt-6 flex justify-center gap-2">
                  <Button variant="outline" disabled={repoPage === 1} onClick={() => setRepoPage(page => page - 1)}>Назад</Button>
                  <span className="flex items-center text-sm text-muted-foreground">
                    {repoPage} / {Math.ceil(filteredRepositories.length / 10)}
                  </span>
                  <Button variant="outline" disabled={repoPage >= Math.ceil(filteredRepositories.length / 10)} onClick={() => setRepoPage(page => page + 1)}>Вперед</Button>
                </div>
              )}
            </CardContent>
          </Card>
        </motion.div>

        {/* Scroll to Top Button */}
        <AnimatePresence>
          {showScrollButton && (
            <motion.div
              initial={{ opacity: 0, y: 20 }}
              animate={{ opacity: 1, y: 0 }}
              exit={{ opacity: 0, y: 20 }}
              transition={{ duration: 0.3 }}
              className="fixed bottom-8 right-8"
            >
              <Button
                className="rounded-full w-12 h-12 shadow-lg bg-[#6E59A5] hover:bg-[#5a4a8a]"
                onClick={scrollToTop}
              >
                <ChevronUp className="h-6 w-6" />
              </Button>
            </motion.div>
          )}
        </AnimatePresence>
      </div>
    </div>
  );
};

const RepositoryItem = ({ repo, user, provider, onDownload, downloadLoading }: {
  repo: Repository,
  user: User,
  provider: "github" | "gitlab",
  onDownload: (repoName: string) => void,
  downloadLoading: boolean
}) => {
  const [commits, setCommits] = useState<Commit[]>([]);
  const [files, setFiles] = useState<FileInfo[]>([]);
  const [activeSection, setActiveSection] = useState<"files" | "commits" | null>(null);
  const [branches, setBranches] = useState<string[]>([]);
  const [selectedBranch, setSelectedBranch] = useState<string>("main");
  const [currentPath, setCurrentPath] = useState<string>("");
  const [pathHistory, setPathHistory] = useState<string[]>([]);
  const { toast } = useToast();

  const fetchBranches = async (repoName: string) => {
    try {
      const response = await fetch(
        `https://api.github.com/repos/${user.github_username}/${repoName}/branches`
      );
      const data = await response.json();
      const branchNames = Array.isArray(data) ? data.map(branch => branch.name) : [];
      setBranches(branchNames);
      if (branchNames.length > 0 && !branchNames.includes(selectedBranch)) {
        setSelectedBranch(branchNames[0]);
      }
    } catch (error) {
      toast({
        title: "Ошибка",
        description: "Не удалось загрузить ветки",
        variant: "destructive",
      });
    }
  };

  const fetchCommits = async (repoName: string, branch: string = selectedBranch) => {
    setActiveSection("commits");
    try {
      const response = await fetch(
        `https://api.github.com/repos/${user.github_username}/${repoName}/commits?sha=${branch}`
      );
      const data = await response.json();
      setCommits(Array.isArray(data) ? data : []);
    } catch (error) {
      toast({
        title: "Ошибка",
        description: "Не удалось загрузить коммиты",
        variant: "destructive",
      });
    }
  };

  const fetchFiles = async (repoName: string, path: string = "", branch: string = selectedBranch) => {
    setActiveSection("files");
    try {
      const response = await fetch(
        `https://api.github.com/repos/${user.github_username}/${repoName}/contents/${path}?ref=${branch}`
      );
      const data = await response.json();
      setFiles(Array.isArray(data) ? data : []);
      setCurrentPath(path);
    } catch (error) {
      toast({
        title: "Ошибка",
        description: "Не удалось загрузить файлы",
        variant: "destructive",
      });
    }
  };

  const navigateToFolder = (repoName: string, path: string) => {
    setPathHistory(prev => [...prev, currentPath]);
    fetchFiles(repoName, path);
  };

  const navigateBack = () => {
    if (pathHistory.length > 0) {
      const previousPath = pathHistory[pathHistory.length - 1];
      setPathHistory(prev => prev.slice(0, -1));
      fetchFiles(repo.name, previousPath);
    } else {
      fetchFiles(repo.name, "");
    }
  };

  const handleDownloadFile = async (fileUrl: string, fileName: string) => {
    try {
      const response = await fetch(fileUrl);
      const blob = await response.blob();
      const url = window.URL.createObjectURL(blob);
      const a = document.createElement("a");
      a.href = url;
      a.download = fileName;
      document.body.appendChild(a);
      a.click();
      a.remove();
      toast({
        title: "Успех",
        description: `Файл ${fileName} загружен`,
      });
    } catch (error) {
      toast({
        title: "Ошибка",
        description: "Не удалось скачать файл",
        variant: "destructive",
      });
    }
  };

  return (
    <motion.li
      initial={{ opacity: 0, y: 10 }}
      animate={{ opacity: 1, y: 0 }}
      transition={{ duration: 0.3 }}
      className="space-y-4"
    >
      {/* Repository Header */}
      <div className="flex flex-col sm:flex-row justify-between items-start sm:items-center gap-4 p-4 bg-gray-100 dark:bg-gray-800 rounded-lg">
        <div className="flex-1 min-w-0">
          <a
            href={repo.html_url}
            target="_blank"
            rel="noopener noreferrer"
            className="text-lg font-semibold text-[#6E59A5] hover:underline truncate"
          >
            {repo.name}
          </a>
          <div className="flex items-center mt-1 space-x-4 text-sm text-gray-600 dark:text-gray-400">
            {repo.stargazers_count !== undefined && (
              <span className="flex items-center">
                <Star className="h-4 w-4 mr-1" /> {repo.stargazers_count}
              </span>
            )}
            {repo.forks_count !== undefined && (
              <span className="flex items-center">
                <GitFork className="h-4 w-4 mr-1" /> {repo.forks_count}
              </span>
            )}
            {repo.language && <span className="rounded-full bg-[#6E59A5]/10 px-2 py-0.5 text-[#6E59A5]">{repo.language}</span>}
          </div>
        </div>
        <div className="flex flex-wrap gap-2">
          {provider === "github" && (
            <>
              <Button
                size="sm"
                variant={activeSection === "commits" ? "default" : "outline"}
                className="border-[#6E59A5] text-[#6E59A5] hover:bg-[#6E59A5]/10"
                onClick={() => {
                  if (activeSection === "commits") {
                    setActiveSection(null);
                  } else {
                    if (branches.length === 0) fetchBranches(repo.name);
                    fetchCommits(repo.name);
                  }
                }}
              >
                {activeSection === "commits" ? "Скрыть коммиты" : "Коммиты"}
              </Button>
              <Button
                size="sm"
                variant={activeSection === "files" ? "default" : "outline"}
                className="border-[#6E59A5] text-[#6E59A5] hover:bg-[#6E59A5]/10"
                onClick={() => {
                  if (activeSection === "files") {
                    setActiveSection(null);
                  } else {
                    if (branches.length === 0) fetchBranches(repo.name);
                    fetchFiles(repo.name);
                  }
                }}
              >
                {activeSection === "files" ? "Скрыть файлы" : "Файлы"}
              </Button>
              <Button
                size="sm"
                className="bg-[#6E59A5] hover:bg-[#5a4a8a]"
                onClick={() => onDownload(repo.name)}
                disabled={downloadLoading}
              >
                {downloadLoading ? <Loader2 className="h-4 w-4 animate-spin" /> : (
                  <>
                    <Download className="h-4 w-4 mr-2" /> Скачать
                  </>
                )}
              </Button>
            </>
          )}
        </div>
      </div>

      {/* Commits Section */}
      {activeSection === "commits" && (
        <motion.div
          initial={{ opacity: 0, height: 0 }}
          animate={{ opacity: 1, height: "auto" }}
          exit={{ opacity: 0, height: 0 }}
          transition={{ duration: 0.3 }}
        >
          <Card>
            <CardHeader>
              <div className="flex flex-wrap items-center justify-between gap-4">
                <CardTitle>Коммиты в {repo.name}</CardTitle>
                <div className="flex flex-wrap gap-2">
                  {branches.slice(0, 3).map(branch => (
                    <Button
                      key={branch}
                      size="sm"
                      variant={selectedBranch === branch ? "default" : "outline"}
                      className={selectedBranch === branch ? "bg-[#6E59A5] hover:bg-[#5a4a8a]" : "border-[#6E59A5] text-[#6E59A5] hover:bg-[#6E59A5]/10"}
                      onClick={() => {
                        setSelectedBranch(branch);
                        fetchCommits(repo.name, branch);
                      }}
                    >
                      {branch}
                    </Button>
                  ))}
                  {branches.length > 3 && (
                    <div className="relative">
                      <Button
                        size="sm"
                        variant="outline"
                        className="border-[#6E59A5] text-[#6E59A5] hover:bg-[#6E59A5]/10"
                        onClick={(e) => {
                          e.stopPropagation();
                          const dropdown = document.getElementById(`branch-dropdown-${repo.name}`);
                          dropdown?.classList.toggle('hidden');
                        }}
                      >
                        +{branches.length - 3}
                      </Button>
                      <div
                        id={`branch-dropdown-${repo.name}`}
                        className="hidden absolute z-10 mt-1 right-0 bg-white dark:bg-gray-800 rounded-md shadow-lg border border-gray-200 dark:border-gray-700 max-h-60 overflow-y-auto"
                      >
                        {branches.slice(3).map(branch => (
                          <button
                            key={branch}
                            className={`block w-full text-left px-4 py-2 text-sm hover:bg-[#6E59A5]/10 ${selectedBranch === branch ? 'text-[#6E59A5] font-medium' : 'text-gray-700 dark:text-gray-300'}`}
                            onClick={(e) => {
                              e.stopPropagation();
                              setSelectedBranch(branch);
                              fetchCommits(repo.name, branch);
                              document.getElementById(`branch-dropdown-${repo.name}`)?.classList.add('hidden');
                            }}
                          >
                            {branch}
                          </button>
                        ))}
                      </div>
                    </div>
                  )}
                </div>
              </div>
            </CardHeader>
            <CardContent>
              {commits.length === 0 ? (
                <p className="text-muted-foreground text-center py-4">Коммиты отсутствуют</p>
              ) : (
                <ul className="space-y-4">
                  {commits.map(commit => (
                    <motion.li
                      key={commit.sha}
                      initial={{ opacity: 0 }}
                      animate={{ opacity: 1 }}
                      transition={{ duration: 0.2 }}
                      className="p-4 rounded-lg border border-gray-200 dark:border-gray-700 hover:bg-gray-50 dark:hover:bg-gray-800/50"
                    >
                      <div className="flex justify-between items-start">
                        <div>
                          <p className="font-medium">{commit.commit.message}</p>
                          <p className="text-sm text-gray-600 dark:text-gray-400 mt-1">
                            {commit.commit.author.name}
                          </p>
                        </div>
                        <div className="text-sm text-gray-500 dark:text-gray-400 whitespace-nowrap ml-4">
                          {format(new Date(commit.commit.author.date), "dd MMM yyyy, HH:mm", { locale: ru })}
                        </div>
                      </div>
                    </motion.li>
                  ))}
                </ul>
              )}
            </CardContent>
          </Card>
        </motion.div>
      )}

      {/* Files Section */}
      {activeSection === "files" && (
        <motion.div
          initial={{ opacity: 0, height: 0 }}
          animate={{ opacity: 1, height: "auto" }}
          exit={{ opacity: 0, height: 0 }}
          transition={{ duration: 0.3 }}
        >
          <Card>
            <CardHeader>
              <div className="flex flex-wrap items-center justify-between gap-4">
                <CardTitle>Файлы в {repo.name}</CardTitle>
                <div className="flex flex-wrap gap-2">
                  {branches.slice(0, 3).map(branch => (
                    <Button
                      key={branch}
                      size="sm"
                      variant={selectedBranch === branch ? "default" : "outline"}
                      className={selectedBranch === branch ? "bg-[#6E59A5] hover:bg-[#5a4a8a]" : "border-[#6E59A5] text-[#6E59A5] hover:bg-[#6E59A5]/10"}
                      onClick={() => {
                        setSelectedBranch(branch);
                        fetchFiles(repo.name, currentPath, branch);
                      }}
                    >
                      {branch}
                    </Button>
                  ))}
                  {branches.length > 3 && (
                    <div className="relative">
                      <Button
                        size="sm"
                        variant="outline"
                        className="border-[#6E59A5] text-[#6E59A5] hover:bg-[#6E59A5]/10"
                        onClick={(e) => {
                          e.stopPropagation();
                          const dropdown = document.getElementById(`file-branch-dropdown-${repo.name}`);
                          dropdown?.classList.toggle('hidden');
                        }}
                      >
                        +{branches.length - 3}
                      </Button>
                      <div
                        id={`file-branch-dropdown-${repo.name}`}
                        className="hidden absolute z-10 mt-1 right-0 bg-white dark:bg-gray-800 rounded-md shadow-lg border border-gray-200 dark:border-gray-700 max-h-60 overflow-y-auto"
                      >
                        {branches.slice(3).map(branch => (
                          <button
                            key={branch}
                            className={`block w-full text-left px-4 py-2 text-sm hover:bg-[#6E59A5]/10 ${selectedBranch === branch ? 'text-[#6E59A5] font-medium' : 'text-gray-700 dark:text-gray-300'}`}
                            onClick={(e) => {
                              e.stopPropagation();
                              setSelectedBranch(branch);
                              fetchFiles(repo.name, currentPath, branch);
                              document.getElementById(`file-branch-dropdown-${repo.name}`)?.classList.add('hidden');
                            }}
                          >
                            {branch}
                          </button>
                        ))}
                      </div>
                    </div>
                  )}
                </div>
              </div>
              <div className="flex items-center gap-2 mt-2">
                <Button
                  size="sm"
                  variant="outline"
                  className="border-[#6E59A5] text-[#6E59A5] hover:bg-[#6E59A5]/10"
                  onClick={navigateBack}
                  disabled={pathHistory.length === 0 && !currentPath}
                >
                  <ChevronLeft className="h-4 w-4 mr-1" /> Назад
                </Button>
                <span className="text-sm text-gray-600 dark:text-gray-400 truncate">
                  Путь: {currentPath || '/'}
                </span>
              </div>
            </CardHeader>
            <CardContent>
              {files.length === 0 ? (
                <p className="text-muted-foreground text-center py-4">Файлы отсутствуют</p>
              ) : (
                <ul className="space-y-2">
                  {files.map(file => (
                    <motion.li
                      key={file.sha}
                      initial={{ opacity: 0 }}
                      animate={{ opacity: 1 }}
                      transition={{ duration: 0.2 }}
                      className="flex items-center justify-between p-3 rounded-lg hover:bg-gray-50 dark:hover:bg-gray-800/50"
                    >
                      <div className="flex items-center min-w-0">
                        {file.type === "file" ? (
                          <File className="h-5 w-5 text-[#6E59A5] mr-3" />
                        ) : (
                          <Folder className="h-5 w-5 text-[#6E59A5] mr-3" />
                        )}
                        <span className="truncate">{file.name}</span>
                        {file.size && (
                          <span className="text-xs text-gray-500 dark:text-gray-400 ml-2 whitespace-nowrap">
                            {(file.size / 1024).toFixed(1)} KB
                          </span>
                        )}
                      </div>
                      {file.type === "file" ? (
                        <Button
                          size="sm"
                          variant="outline"
                          className="border-[#6E59A5] text-[#6E59A5] hover:bg-[#6E59A5]/10"
                          onClick={() => handleDownloadFile(file.download_url || "", file.name)}
                        >
                          Скачать
                        </Button>
                      ) : (
                        <Button
                          size="sm"
                          variant="outline"
                          className="border-[#6E59A5] text-[#6E59A5] hover:bg-[#6E59A5]/10"
                          onClick={() => navigateToFolder(repo.name, file.path)}
                        >
                          Открыть
                        </Button>
                      )}
                    </motion.li>
                  ))}
                </ul>
              )}
            </CardContent>
          </Card>
        </motion.div>
      )}
    </motion.li>
  );
};

export default MyProfile;
