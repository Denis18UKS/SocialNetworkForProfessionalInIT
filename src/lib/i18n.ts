import { useEffect, useState } from "react";
import { AppLanguage, AppSettings, readSettings, settingsStorageKey } from "./settings";

type Dictionary = Record<string, Record<AppLanguage, string>>;

const dictionary: Dictionary = {
  navigation: { ru: "Навигация", en: "Navigation" },
  home: { ru: "Главная", en: "Home" },
  hackathons: { ru: "IT-Хакатоны", en: "IT Hackathons" },
  myProfile: { ru: "Мой профиль", en: "My profile" },
  chats: { ru: "Чаты", en: "Chats" },
  groupChats: { ru: "Групповые чаты", en: "Group chats" },
  users: { ru: "Пользователи", en: "Users" },
  friendRequests: { ru: "Заявки в друзья", en: "Friend requests" },
  forum: { ru: "Форум", en: "Forum" },
  settings: { ru: "Настройки", en: "Settings" },
  adminUsers: { ru: "Управление пользователями", en: "User management" },
  moderation: { ru: "Модерация контента", en: "Content moderation" },
  administration: { ru: "Администрирование", en: "Administration" },
  register: { ru: "Регистрация", en: "Register" },
  login: { ru: "Вход", en: "Log in" },
  logout: { ru: "Выйти", en: "Log out" },
  settingsDescription: {
    ru: "Тема, язык интерфейса и автоперевод сообщений",
    en: "Theme, interface language and message auto-translation",
  },
  theme: { ru: "Тема", en: "Theme" },
  system: { ru: "Системная", en: "System" },
  light: { ru: "Светлая", en: "Light" },
  dark: { ru: "Темная", en: "Dark" },
  appLanguage: { ru: "Язык приложения", en: "Application language" },
  russian: { ru: "Русский", en: "Russian" },
  english: { ru: "Английский", en: "English" },
  autoTranslate: { ru: "Автоперевод сообщений", en: "Message auto-translation" },
  autoTranslateHint: {
    ru: "Когда выключен, язык перевода выбрать нельзя.",
    en: "When disabled, the translation language cannot be selected.",
  },
  translateLanguage: { ru: "Язык автоперевода", en: "Auto-translation language" },
  answers: { ru: "Ответы", en: "Answers" },
  question: { ru: "Вопрос", en: "Question" },
  addAnswer: { ru: "Добавить ответ", en: "Add answer" },
  solvedQuestionNoAnswers: {
    ru: "Вопрос уже решен, новые ответы закрыты.",
    en: "This question is solved, new answers are closed.",
  },
};

export const translate = (key: keyof typeof dictionary, language: AppLanguage) =>
  dictionary[key]?.[language] ?? dictionary[key]?.ru ?? key;

export const useAppSettings = () => {
  const [settings, setSettings] = useState<AppSettings>(readSettings);

  useEffect(() => {
    const handleSettingsChange = (event: Event) => {
      const customEvent = event as CustomEvent<AppSettings>;
      setSettings(customEvent.detail || readSettings());
    };

    const handleStorage = (event: StorageEvent) => {
      if (event.key === settingsStorageKey) setSettings(readSettings());
    };

    window.addEventListener("itbird-settings-change", handleSettingsChange);
    window.addEventListener("storage", handleStorage);

    return () => {
      window.removeEventListener("itbird-settings-change", handleSettingsChange);
      window.removeEventListener("storage", handleStorage);
    };
  }, []);

  return settings;
};

export const useI18n = () => {
  const settings = useAppSettings();
  return {
    language: settings.appLanguage,
    t: (key: keyof typeof dictionary) => translate(key, settings.appLanguage),
  };
};
