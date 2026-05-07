import React, { useEffect, useState } from "react";
import axios from "axios";
import { Card, CardHeader, CardTitle, CardContent } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Skeleton } from "@/components/ui/skeleton";
import { motion, AnimatePresence } from "framer-motion";

interface Hackathon {
    id: number;
    title: string;
    description: string;
    image: string;
    link: string;
}

// --- Глобальный кэш данных ---
let cachedHackathons: Hackathon[] = [];
let cachedLoading = true;
let cachedError: string | null = null;
let cachedProgress = 0;

const HackathonsPage: React.FC = () => {
    const [hackathons, setHackathons] = useState<Hackathon[]>(cachedHackathons);
    const [loading, setLoading] = useState(cachedLoading);
    const [error, setError] = useState<string | null>(cachedError);
    const [progress, setProgress] = useState(cachedProgress);

    useEffect(() => {
        if (cachedHackathons.length > 0) return; // данные уже загружены

        const interval = setInterval(() => {
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

                if (!data || !data.html) {
                    throw new Error("Некорректные данные с сервера");
                }

                const parser = new DOMParser();
                const doc = parser.parseFromString(data.html, 'text/html');

                const hackathonElements = doc.querySelectorAll('.js-feed-post');
                const hackathonsArray: Hackathon[] = Array.from(hackathonElements).map((el) => {
                    const titleEl = el.querySelector('.js-feed-post-title') as HTMLElement;
                    const descEl = el.querySelector('.js-feed-post-descr') as HTMLElement;
                    const imageEl = el.querySelector('.t-feed__post-bgimg') as HTMLElement;
                    const linkEl = el.querySelector('.js-feed-post-title a') as HTMLAnchorElement;

                    return {
                        id: Number(el.getAttribute('data-post-uid')) || 0,
                        title: titleEl?.innerText || "Без названия",
                        description: descEl?.innerText || "Описание отсутствует",
                        image: imageEl?.style.backgroundImage
                            ? imageEl.style.backgroundImage.slice(5, -2)
                            : "",
                        link: linkEl?.href || "#"
                    };
                });

                setHackathons(hackathonsArray);
                cachedHackathons = hackathonsArray;
            } catch (err) {
                const message = "Ошибка при загрузке хакатонов. Попробуйте позже.";
                setError(message);
                cachedError = message;
                console.error("Ошибка парсинга:", err);
            } finally {
                setLoading(false);
                setProgress(100);
                cachedLoading = false;
                cachedProgress = 100;
            }
        };

        fetchHackathons();

        return () => clearInterval(interval);
    }, []);

    if (loading) {
        return (
            <div className="flex flex-col justify-center items-center min-h-screen bg-gradient-to-br from-gray-50 to-gray-100">
                <motion.div
                    initial={{ scale: 0.8 }}
                    animate={{ scale: 1 }}
                    transition={{ duration: 0.5, repeat: Infinity, repeatType: "reverse" }}
                    className="w-20 h-20 border-4 border-blue-500 border-t-transparent rounded-full animate-spin"
                />
                <motion.p 
                    initial={{ opacity: 0, y: 10 }}
                    animate={{ opacity: 1, y: 0 }}
                    transition={{ delay: 0.2 }}
                    className="mt-6 text-lg font-medium text-gray-700"
                >
                    Загружаем хакатоны... {progress}%
                </motion.p>
                <motion.p 
                    initial={{ opacity: 0 }}
                    animate={{ opacity: 0.6 }}
                    transition={{ delay: 0.4 }}
                    className="mt-2 text-sm text-gray-500"
                >
                    Это может занять несколько секунд
                </motion.p>
            </div>
        );
    }

    if (error) {
        return (
            <div className="flex flex-col items-center justify-center min-h-screen bg-gradient-to-br from-gray-50 to-gray-100 p-4">
                <div className="max-w-md text-center bg-white p-8 rounded-xl shadow-lg">
                    <div className="w-16 h-16 bg-red-100 rounded-full flex items-center justify-center mx-auto mb-4">
                        <svg xmlns="http://www.w3.org/2000/svg" className="h-8 w-8 text-red-500" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                            <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M12 8v4m0 4h.01M21 12a9 9 0 11-18 0 9 9 0 0118 0z" />
                        </svg>
                    </div>
                    <h2 className="text-xl font-bold text-gray-800 mb-2">Ошибка загрузки</h2>
                    <p className="text-gray-600 mb-6">{error}</p>
                    <Button 
                        onClick={() => window.location.reload()} 
                        className="bg-blue-600 hover:bg-blue-700 transition-colors"
                    >
                        Попробовать снова
                    </Button>
                </div>
            </div>
        );
    }

    return (
        <div className="min-h-screen bg-gradient-to-br from-gray-50 to-gray-100 py-12 px-4 sm:px-6 lg:px-8">
            <div className="max-w-7xl mx-auto">
                <motion.div
                    initial={{ opacity: 0, y: -20 }}
                    animate={{ opacity: 1, y: 0 }}
                    transition={{ duration: 0.5 }}
                    className="text-center mb-12"
                >
                    <h1 className="text-4xl font-extrabold text-gray-900 sm:text-5xl mb-4">
                        Актуальные <span style={{ color: 'rgb(110, 89, 165)' }}>хакатоны</span>
                    </h1>
                    <p className="text-lg text-gray-600 max-w-2xl mx-auto">
                        Участвуйте в самых интересных IT-соревнованиях этого года
                    </p>
                </motion.div>

                <AnimatePresence>
                    <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-8">
                        {hackathons.map((hackathon, index) => (
                            <motion.div
                                key={hackathon.id}
                                initial={{ opacity: 0, y: 20 }}
                                animate={{ opacity: 1, y: 0 }}
                                transition={{ delay: index * 0.1 }}
                                whileHover={{ y: -5 }}
                                className="h-full"
                            >
                                <Card className="h-full flex flex-col overflow-hidden shadow-lg hover:shadow-xl transition-shadow duration-300">
                                    {hackathon.image ? (
                                        <div className="relative h-48 overflow-hidden">
                                            <img
                                                src={hackathon.image}
                                                alt={hackathon.title}
                                                className="w-full h-full object-cover transition-transform duration-500 hover:scale-105"
                                            />
                                            <div className="absolute inset-0 bg-gradient-to-t from-black/60 to-transparent" />
                                        </div>
                                    ) : (
                                        <div className="h-48" style={{ background: 'linear-gradient(to right, rgb(110, 89, 165), rgb(149, 125, 205))' }}>
                                            <span className="text-white text-xl font-bold">Hackathon</span>
                                        </div>
                                    )}
                                    <CardHeader className="flex-1">
                                        <CardTitle className="text-xl font-bold text-gray-900">
                                            {hackathon.title}
                                        </CardTitle>
                                    </CardHeader>
                                    <CardContent className="flex-1">
                                        <p className="text-gray-600 mb-4 line-clamp-3">
                                            {hackathon.description}
                                        </p>
                                    </CardContent>
                                    <div className="px-6 pb-6">
                                        <a 
                                            href={hackathon.link} 
                                            target="_blank" 
                                            rel="noopener noreferrer"
                                            className="block"
                                        >
                                            <Button 
                                                className="w-full transition-colors"
                                                style={{ backgroundColor: 'rgb(110, 89, 165)' }}
                                                size="lg"
                                            >
                                                Участвовать
                                                <svg xmlns="http://www.w3.org/2000/svg" className="h-5 w-5 ml-2" viewBox="0 0 20 20" fill="currentColor">
                                                    <path fillRule="evenodd" d="M10.293 5.293a1 1 0 011.414 0l4 4a1 1 0 010 1.414l-4 4a1 1 0 01-1.414-1.414L12.586 11H5a1 1 0 110-2h7.586l-2.293-2.293a1 1 0 010-1.414z" clipRule="evenodd" />
                                                </svg>
                                            </Button>
                                        </a>
                                    </div>
                                </Card>
                            </motion.div>
                        ))}
                    </div>
                </AnimatePresence>

                {hackathons.length === 0 && !loading && (
                    <motion.div
                        initial={{ opacity: 0 }}
                        animate={{ opacity: 1 }}
                        className="text-center py-16"
                    >
                        <div className="mx-auto max-w-md">
                            <svg xmlns="http://www.w3.org/2000/svg" className="h-16 w-16 mx-auto text-gray-400" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={1.5} d="M9.172 16.172a4 4 0 015.656 0M9 10h.01M15 10h.01M21 12a9 9 0 11-18 0 9 9 0 0118 0z" />
                            </svg>
                            <h3 className="mt-4 text-lg font-medium text-gray-900">Хакатоны не найдены</h3>
                            <p className="mt-2 text-gray-500">В данный момент нет доступных хакатонов. Попробуйте проверить позже.</p>
                        </div>
                    </motion.div>
                )}
            </div>
        </div>
    );
};

export default HackathonsPage;