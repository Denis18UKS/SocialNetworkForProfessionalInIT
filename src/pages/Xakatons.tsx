import React, { useEffect, useState } from "react";
import axios from "axios";
import { motion, AnimatePresence } from "framer-motion";
import { ArrowRight, RefreshCw } from "lucide-react";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";

interface Hackathon {
  id: number;
  title: string;
  description: string;
  image: string;
  link: string;
}

let cachedHackathons: Hackathon[] = [];
let cachedLoading = true;
let cachedError: string | null = null;
let cachedProgress = 0;

const fallbackImage = "linear-gradient(135deg, rgb(110, 89, 165), rgb(59, 130, 246))";

const HackathonsPage: React.FC = () => {
  const [hackathons, setHackathons] = useState<Hackathon[]>(cachedHackathons);
  const [loading, setLoading] = useState(cachedLoading);
  const [error, setError] = useState<string | null>(cachedError);
  const [progress, setProgress] = useState(cachedProgress);

  useEffect(() => {
    if (cachedHackathons.length > 0) {
      setLoading(false);
      return;
    }

    const interval = window.setInterval(() => {
      setProgress((prev) => {
        const next = prev < 90 ? prev + 2 : prev;
        cachedProgress = next;
        return next;
      });
    }, 500);

    const fetchHackathons = async () => {
      try {
        const response = await axios.get("http://localhost:5000/hackathons");
        const data = response.data;

        if (!Array.isArray(data?.items)) {
          throw new Error("Некорректные данные с сервера");
        }

        setHackathons(data.items);
        cachedHackathons = data.items;
        cachedError = null;
        setError(null);
      } catch (err) {
        const message = "Ошибка при загрузке хакатонов. Попробуйте позже.";
        setError(message);
        cachedError = message;
        console.error("Ошибка парсинга хакатонов:", err);
      } finally {
        window.clearInterval(interval);
        setLoading(false);
        setProgress(100);
        cachedLoading = false;
        cachedProgress = 100;
      }
    };

    fetchHackathons();

    return () => window.clearInterval(interval);
  }, []);

  if (loading) {
    return (
      <div className="flex min-h-full flex-col items-center justify-center bg-gray-50 text-gray-900 dark:bg-gray-950 dark:text-gray-50">
        <motion.div
          initial={{ scale: 0.8 }}
          animate={{ scale: 1 }}
          transition={{ duration: 0.5, repeat: Infinity, repeatType: "reverse" }}
          className="h-20 w-20 animate-spin rounded-full border-4 border-[#6E59A5] border-t-transparent"
        />
        <motion.p
          initial={{ opacity: 0, y: 10 }}
          animate={{ opacity: 1, y: 0 }}
          transition={{ delay: 0.2 }}
          className="mt-6 text-lg font-medium text-gray-700 dark:text-gray-200"
        >
          Загружаем хакатоны... {progress}%
        </motion.p>
        <p className="mt-2 text-sm text-gray-500 dark:text-gray-400">Это может занять несколько секунд</p>
      </div>
    );
  }

  if (error) {
    return (
      <div className="flex min-h-full flex-col items-center justify-center bg-gray-50 p-4 dark:bg-gray-950">
        <div className="max-w-md rounded-xl border border-gray-200 bg-white p-8 text-center shadow-lg dark:border-gray-800 dark:bg-gray-900">
          <div className="mx-auto mb-4 flex h-16 w-16 items-center justify-center rounded-full bg-red-100 dark:bg-red-950/40">
            <RefreshCw className="h-8 w-8 text-red-500" />
          </div>
          <h2 className="mb-2 text-xl font-bold text-gray-800 dark:text-gray-100">Ошибка загрузки</h2>
          <p className="mb-6 text-gray-600 dark:text-gray-300">{error}</p>
          <Button onClick={() => window.location.reload()} className="bg-[#6E59A5] hover:bg-[#5a4a8a]">
            Попробовать снова
          </Button>
        </div>
      </div>
    );
  }

  return (
    <div className="min-h-full bg-gray-50 px-0 py-6 dark:bg-gray-950 sm:px-4 sm:py-8 lg:px-8">
      <div className="mx-auto max-w-7xl">
        <motion.div
          initial={{ opacity: 0, y: -20 }}
          animate={{ opacity: 1, y: 0 }}
          transition={{ duration: 0.5 }}
          className="mb-10 text-center"
        >
          <h1 className="mb-4 text-3xl font-extrabold text-gray-900 dark:text-white sm:text-5xl">
            Актуальные <span className="text-[#6E59A5] dark:text-purple-300">хакатоны</span>
          </h1>
          <p className="mx-auto max-w-2xl text-base text-gray-600 dark:text-gray-300 sm:text-lg">
            Участвуйте в самых интересных IT-соревнованиях этого года
          </p>
        </motion.div>

        <AnimatePresence>
          <div className="grid grid-cols-1 gap-6 md:grid-cols-2 xl:grid-cols-3">
            {hackathons.map((hackathon, index) => (
              <motion.div
                key={`${hackathon.id}-${hackathon.link}`}
                initial={{ opacity: 0, y: 20 }}
                animate={{ opacity: 1, y: 0 }}
                transition={{ delay: index * 0.05 }}
                whileHover={{ y: -5 }}
                className="h-full"
              >
                <Card className="flex h-full flex-col overflow-hidden border border-gray-200 bg-white shadow-lg transition-shadow duration-300 hover:shadow-xl dark:border-gray-800 dark:bg-gray-900">
                  {hackathon.image ? (
                    <div className="relative h-48 overflow-hidden">
                      <img
                        src={hackathon.image}
                        alt={hackathon.title}
                        className="h-full w-full object-cover transition-transform duration-500 hover:scale-105"
                      />
                      <div className="absolute inset-0 bg-gradient-to-t from-black/60 to-transparent" />
                    </div>
                  ) : (
                    <div className="flex h-48 items-center justify-center" style={{ background: fallbackImage }}>
                      <span className="text-xl font-bold text-white">Hackathon</span>
                    </div>
                  )}

                  <CardHeader className="flex-1">
                    <CardTitle className="text-xl font-bold text-gray-900 dark:text-white">
                      {hackathon.title}
                    </CardTitle>
                  </CardHeader>
                  <CardContent className="flex flex-1 flex-col">
                    <p className="mb-6 line-clamp-4 flex-1 text-gray-600 dark:text-gray-300">
                      {hackathon.description}
                    </p>
                    <a href={hackathon.link} target="_blank" rel="noopener noreferrer" className="block">
                      <Button className="w-full bg-[#6E59A5] transition-colors hover:bg-[#5a4a8a]" size="lg">
                        Участвовать
                        <ArrowRight className="ml-2 h-5 w-5" />
                      </Button>
                    </a>
                  </CardContent>
                </Card>
              </motion.div>
            ))}
          </div>
        </AnimatePresence>

        {hackathons.length === 0 && (
          <motion.div initial={{ opacity: 0 }} animate={{ opacity: 1 }} className="py-16 text-center">
            <div className="mx-auto max-w-md">
              <h3 className="mt-4 text-lg font-medium text-gray-900 dark:text-white">Хакатоны не найдены</h3>
              <p className="mt-2 text-gray-500 dark:text-gray-400">
                В данный момент нет доступных хакатонов. Попробуйте проверить позже.
              </p>
            </div>
          </motion.div>
        )}
      </div>
    </div>
  );
};

export default HackathonsPage;
