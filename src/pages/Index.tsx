import { useEffect, useState } from "react";
import { useNavigate } from "react-router-dom";
import { Download, FileText } from "lucide-react";
import { format, formatDistance } from "date-fns";
import { ru } from "date-fns/locale";
import { motion } from "framer-motion";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardDescription, CardFooter, CardHeader, CardTitle } from "@/components/ui/card";
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle, DialogTrigger } from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Textarea } from "@/components/ui/textarea";
import { useToast } from "@/components/ui/use-toast";
import { LiquidButton } from "@/components/ui/liquid-button";
import CodeSnippet, { CodeLanguage } from "@/components/CodeSnippet";

interface Post {
  id: number;
  title: string;
  description: string;
  image_url: string | null;
  attachment_url?: string | null;
  attachment_name?: string | null;
  attachment_size?: number | string | null;
  attachment_type?: string | null;
  code_content?: string | null;
  code_language?: CodeLanguage | null;
  user: string;
  created_at: string;
  link?: string;
}

const codeLanguages: Array<{ value: CodeLanguage; label: string }> = [
  { value: "java", label: "Java" },
  { value: "csharp", label: "C#" },
  { value: "cpp", label: "C++" },
  { value: "lua", label: "Lua" },
  { value: "python", label: "Python" },
  { value: "php", label: "PHP" },
  { value: "javascript", label: "JavaScript" },
  { value: "nodejs", label: "Node.js" },
  { value: "react", label: "React" },
];

const formatFileSize = (size?: number | string | null) => {
  const bytes = Number(size);
  if (!Number.isFinite(bytes) || bytes <= 0) return "";
  if (bytes < 1024) return `${bytes} Б`;
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)} КБ`;
  return `${(bytes / 1024 / 1024).toFixed(1)} МБ`;
};

const getAbsoluteUrl = (url?: string | null) => {
  if (!url) return "";
  return url.startsWith("http") ? url : `http://localhost:5000${url}`;
};

const Index = () => {
  const [news, setNews] = useState<Post[]>([]);
  const [posts, setPosts] = useState<Post[]>([]);
  const [showMoreNews, setShowMoreNews] = useState(false);
  const [showMorePosts, setShowMorePosts] = useState(false);
  const [loading, setLoading] = useState(false);
  const [isDialogOpen, setIsDialogOpen] = useState(false);
  const navigate = useNavigate();
  const { toast } = useToast();

  const [postForm, setPostForm] = useState({
    title: "",
    description: "",
    file: null as File | null,
    codeContent: "",
    codeLanguage: "javascript" as CodeLanguage,
  });

  const loadPosts = async () => {
    const postsData = await fetch("http://localhost:5000/posts").then((res) => res.json());
    setPosts(Array.isArray(postsData) ? postsData : []);
  };

  useEffect(() => {
    fetch("http://localhost:5000/news")
      .then((response) => response.json())
      .then((data) => setNews(Array.isArray(data) ? data : []))
      .catch((error) => {
        console.error("Error loading news:", error);
        toast({
          title: "Ошибка",
          description: "Не удалось загрузить новости. Попробуйте позже.",
          variant: "destructive",
        });
      });

    loadPosts().catch((error) => {
      console.error("Error loading posts:", error);
      toast({
        title: "Ошибка",
        description: "Не удалось загрузить посты. Попробуйте позже.",
        variant: "destructive",
      });
    });
  }, []);

  const submitPostForm = async () => {
    if (!postForm.title.trim() || !postForm.description.trim()) {
      toast({
        title: "Ошибка",
        description: "Пожалуйста, заполните название и описание поста.",
        variant: "destructive",
      });
      return;
    }

    setLoading(true);
    const formData = new FormData();
    formData.append("title", postForm.title);
    formData.append("description", postForm.description);
    formData.append("code_language", postForm.codeLanguage);
    formData.append("code_content", postForm.codeContent);
    if (postForm.file) formData.append("file", postForm.file);

    try {
      const token = localStorage.getItem("token");
      const response = await fetch("http://localhost:5000/posts", {
        method: "POST",
        body: formData,
        headers: { Authorization: `Bearer ${token}` },
      });

      if (!response.ok) throw new Error("Ошибка при добавлении поста");

      toast({
        title: "Успех",
        description: "Пост отправлен на модерацию.",
      });
      setPostForm({ title: "", description: "", file: null, codeContent: "", codeLanguage: "javascript" });
      setIsDialogOpen(false);
      await loadPosts();
    } catch (error) {
      console.error("Error submitting post:", error);
      toast({
        title: "Ошибка",
        description: "Не удалось добавить пост.",
        variant: "destructive",
      });
    } finally {
      setLoading(false);
    }
  };

  const renderEmptyState = (type: "news" | "posts") => (
    <motion.div initial={{ opacity: 0 }} animate={{ opacity: 1 }} className="col-span-full py-12 text-center">
      <div className="mx-auto mb-4 flex h-16 w-16 items-center justify-center rounded-full bg-gray-100 dark:bg-gray-800">
        <FileText className="h-8 w-8 text-gray-500" />
      </div>
      <h3 className="text-lg font-medium text-gray-900 dark:text-gray-100">
        {type === "news" ? "Новостей пока нет" : "Постов пока нет"}
      </h3>
      <p className="mt-1 text-gray-500 dark:text-gray-400">
        {type === "news" ? "Свежие новости появятся здесь автоматически." : "Создайте первый пост."}
      </p>
    </motion.div>
  );

  const renderCards = (items: Post[], showMore: boolean, type: "news" | "posts") => {
    if (items.length === 0) return renderEmptyState(type);

    return (showMore ? items : items.slice(0, 3)).map((item, index) => {
      const attachmentUrl = getAbsoluteUrl(item.attachment_url);
      const imageUrl = getAbsoluteUrl(item.image_url);
      const fileSize = formatFileSize(item.attachment_size);
      const codeLanguage = codeLanguages.find((language) => language.value === item.code_language)?.label || item.code_language;

      return (
        <motion.div
          key={item.id}
          initial={{ opacity: 0, y: 20 }}
          animate={{ opacity: 1, y: 0 }}
          transition={{ delay: index * 0.08 }}
          whileHover={{ y: -4 }}
        >
          <Card className="flex h-full w-full flex-col overflow-hidden border border-gray-200 shadow-sm transition-shadow duration-300 hover:shadow-md dark:border-gray-700">
            <CardHeader className="p-0">
              {imageUrl ? (
                <div className="relative h-48 overflow-hidden">
                  <img src={imageUrl} alt={item.title} className="h-full w-full object-cover transition-transform duration-500 hover:scale-105" />
                  <div className="absolute inset-0 bg-gradient-to-t from-black/30 to-transparent" />
                </div>
              ) : (
                <div className="flex h-48 items-center justify-center bg-gray-100 dark:bg-gray-800">
                  <span className="text-sm italic text-gray-500 dark:text-gray-400">Нет изображения</span>
                </div>
              )}
            </CardHeader>

            <div className="flex flex-1 flex-col p-6">
              <CardTitle className="mb-3 text-xl font-bold text-gray-900 dark:text-gray-100">{item.title}</CardTitle>
              <CardContent className="mb-4 flex-1 p-0">
                <CardDescription className="whitespace-pre-wrap text-gray-600 dark:text-gray-300">{item.description}</CardDescription>

                {item.code_content && (
                  <CodeSnippet
                    code={item.code_content}
                    language={codeLanguage || item.code_language || "javascript"}
                    source={`post-${item.id}`}
                    className="mt-4"
                  />
                )}

                {attachmentUrl && (
                  <a
                    href={attachmentUrl}
                    download={item.attachment_name || true}
                    className="mt-4 flex items-center justify-between gap-3 rounded-md border bg-background p-3 text-sm transition-colors hover:bg-accent"
                  >
                    <span className="flex min-w-0 items-center gap-2">
                      <Download className="h-4 w-4 shrink-0 text-primary" />
                      <span className="truncate">{item.attachment_name || "Скачать файл"}</span>
                    </span>
                    {fileSize && <span className="shrink-0 text-muted-foreground">{fileSize}</span>}
                  </a>
                )}
              </CardContent>

              <CardFooter className="flex flex-col items-start gap-2 p-0">
                <div className="text-sm text-gray-500 dark:text-gray-400">
                  <span className="font-medium">@{item.user}</span>
                </div>
                <div className="flex flex-wrap items-center gap-x-2 gap-y-1 text-sm text-gray-500 dark:text-gray-400">
                  <span>{format(new Date(item.created_at), "dd MMMM yyyy, HH:mm", { locale: ru })}</span>
                  <span className="text-gray-400 dark:text-gray-500">•</span>
                  <span>{formatDistance(new Date(item.created_at), new Date(), { addSuffix: true, locale: ru })}</span>
                </div>
                {item.link && (
                  <Button variant="outline" className="mt-2" asChild>
                    <a href={item.link} target="_blank" rel="noopener noreferrer">Подробнее</a>
                  </Button>
                )}
              </CardFooter>
            </div>
          </Card>
        </motion.div>
      );
    });
  };

  return (
    <div className="min-h-full bg-gray-50 px-0 py-4 dark:bg-gray-900 sm:px-2 sm:py-6 lg:px-4 lg:py-8">
      <div className="mx-auto max-w-7xl space-y-8 sm:space-y-10 lg:space-y-12">
        <motion.section initial={{ opacity: 0, y: 20 }} animate={{ opacity: 1, y: 0 }} transition={{ duration: 0.5 }}>
          <div className="mb-8 flex flex-col items-start justify-between gap-4 sm:flex-row sm:items-center">
            <div>
              <h2 className="text-3xl font-bold text-gray-900 dark:text-white">Новости</h2>
              <p className="mt-1 text-gray-500 dark:text-gray-400">Свежие новости и анонсы мероприятий</p>
            </div>
          </div>
          <div className="grid gap-6 md:grid-cols-2 lg:grid-cols-3">{renderCards(news, showMoreNews, "news")}</div>
          {news.length > 3 && (
            <div className="mt-8 text-center">
              <LiquidButton
                text={showMoreNews ? "Скрыть" : "Показать больше новостей"}
                color1="#9b87f5"
                color2="#6E59A5"
                color3="#8F17E1"
                width={240}
                height={45}
                onClick={() => setShowMoreNews(!showMoreNews)}
              />
            </div>
          )}
        </motion.section>

        <motion.section initial={{ opacity: 0, y: 20 }} animate={{ opacity: 1, y: 0 }} transition={{ duration: 0.5, delay: 0.1 }}>
          <div className="mb-8 flex flex-col items-start justify-between gap-4 sm:flex-row sm:items-center">
            <div>
              <h2 className="text-3xl font-bold text-gray-900 dark:text-white">Посты</h2>
              <p className="mt-1 text-gray-500 dark:text-gray-400">Публикации участников с файлами и фрагментами кода</p>
            </div>
            <Dialog open={isDialogOpen} onOpenChange={setIsDialogOpen}>
              <DialogTrigger asChild>
                <LiquidButton text="+ Добавить пост" color1="#9b87f5" color2="#6E59A5" color3="#8F17E1" width={200} height={50} />
              </DialogTrigger>
              <DialogContent className="max-h-[90vh] overflow-y-auto sm:max-w-[760px]">
                <DialogHeader>
                  <DialogTitle className="text-2xl">Добавить пост</DialogTitle>
                  <DialogDescription>Можно прикрепить файл и добавить код с сохранением форматирования.</DialogDescription>
                </DialogHeader>
                <div className="space-y-4 py-4">
                  <div>
                    <Label htmlFor="post-title" className="mb-2 block">Название *</Label>
                    <Input
                      id="post-title"
                      value={postForm.title}
                      onChange={(event) => setPostForm({ ...postForm, title: event.target.value })}
                      placeholder="Введите заголовок поста"
                    />
                  </div>
                  <div>
                    <Label htmlFor="post-description" className="mb-2 block">Описание *</Label>
                    <Textarea
                      id="post-description"
                      value={postForm.description}
                      onChange={(event) => setPostForm({ ...postForm, description: event.target.value })}
                      placeholder="Содержание вашего поста"
                      rows={5}
                    />
                  </div>
                  <div>
                    <Label htmlFor="post-file" className="mb-2 block">Файл или изображение</Label>
                    <Input id="post-file" type="file" onChange={(event) => setPostForm({ ...postForm, file: event.target.files?.[0] || null })} />
                  </div>
                  <div className="grid gap-4 md:grid-cols-[220px_1fr]">
                    <div>
                      <Label className="mb-2 block">Язык кода</Label>
                      <Select value={postForm.codeLanguage} onValueChange={(value) => setPostForm({ ...postForm, codeLanguage: value as CodeLanguage })}>
                        <SelectTrigger>
                          <SelectValue />
                        </SelectTrigger>
                        <SelectContent>
                          {codeLanguages.map((language) => (
                            <SelectItem key={language.value} value={language.value}>{language.label}</SelectItem>
                          ))}
                        </SelectContent>
                      </Select>
                    </div>
                    <div>
                      <Label htmlFor="post-code" className="mb-2 block">Код</Label>
                      <Textarea
                        id="post-code"
                        value={postForm.codeContent}
                        onChange={(event) => setPostForm({ ...postForm, codeContent: event.target.value })}
                        placeholder="Вставьте код. Отступы и переносы сохранятся."
                        className="min-h-[220px] font-mono"
                        spellCheck={false}
                      />
                    </div>
                  </div>
                </div>
                <DialogFooter>
                  <Button onClick={submitPostForm} disabled={loading} className="w-full bg-[#6E59A5] transition-colors hover:bg-[#5a4a8a] sm:w-auto">
                    {loading ? "Сохранение..." : "Сохранить"}
                  </Button>
                </DialogFooter>
              </DialogContent>
            </Dialog>
          </div>
          <div className="grid gap-6 md:grid-cols-2 lg:grid-cols-3">{renderCards(posts, showMorePosts, "posts")}</div>
          {posts.length > 3 && (
            <div className="mt-8 text-center">
              <LiquidButton
                text={showMorePosts ? "Скрыть" : "Показать больше постов"}
                color1="#9b87f5"
                color2="#6E59A5"
                color3="#8F17E1"
                width={230}
                height={45}
                onClick={() => setShowMorePosts(!showMorePosts)}
              />
            </div>
          )}
        </motion.section>
      </div>
    </div>
  );
};

export default Index;
