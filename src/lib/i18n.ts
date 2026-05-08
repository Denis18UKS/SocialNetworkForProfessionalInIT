import { useEffect, useState } from "react";
import { AppLanguage, AppSettings, readSettings, settingsStorageKey } from "./settings";

type Dictionary = Record<string, Record<AppLanguage, string>>;

const dictionary = {
  navigation: { ru: "Навигация", en: "Navigation" },
  home: { ru: "Главная", en: "Home" },
  hackathons: { ru: "IT-Хакатоны", en: "IT Hackathons" },
  onlineCompiler: { ru: "Онлайн компилятор", en: "Online compiler" },
  myProfile: { ru: "Мой профиль", en: "My profile" },
  chats: { ru: "Чаты", en: "Chats" },
  groupChats: { ru: "Групповые чаты", en: "Group chats" },
  users: { ru: "Пользователи", en: "Users" },
  friendRequests: { ru: "Заявки в друзья", en: "Friend requests" },
  blacklist: { ru: "Черный список", en: "Blacklist" },
  forum: { ru: "Форум", en: "Forum" },
  settings: { ru: "Настройки", en: "Settings" },
  adminUsers: { ru: "Управление пользователями", en: "User management" },
  moderation: { ru: "Модерация контента", en: "Content moderation" },
  administration: { ru: "Администрирование", en: "Administration" },
  register: { ru: "Регистрация", en: "Register" },
  login: { ru: "Вход", en: "Log in" },
  logout: { ru: "Выйти", en: "Log out" },

  settingsDescription: {
    ru: "Тема, язык интерфейса, автоперевод и устройства для звонков",
    en: "Theme, interface language, auto-translation and call devices",
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
  transcription: { ru: "Транскрипция", en: "Transcription" },
  transcriptionHint: {
    ru: "Показывает, как читать переведенные сообщения. Работает только при включенном автопереводе.",
    en: "Shows how to read translated messages. Works only when auto-translation is enabled.",
  },
  callDevices: { ru: "Устройства для звонков", en: "Call devices" },
  callDevicesDescription: {
    ru: "Выберите микрофон, наушники и веб-камеру. Камеру можно оставить пустой, если ее нет.",
    en: "Choose microphone, headphones and webcam. The webcam can stay empty if you do not have one.",
  },
  microphone: { ru: "Микрофон", en: "Microphone" },
  headphones: { ru: "Наушники / вывод звука", en: "Headphones / audio output" },
  webcam: { ru: "Веб-камера", en: "Webcam" },
  noCamera: { ru: "Без камеры", en: "No camera" },
  defaultDevice: { ru: "Устройство по умолчанию", en: "Default device" },
  testMicrophone: { ru: "Проверить микрофон", en: "Test microphone" },
  stopTest: { ru: "Остановить тест", en: "Stop test" },
  microphoneLevel: { ru: "Уровень микрофона", en: "Microphone level" },
  microphoneMonitorHint: {
    ru: "Во время теста вы будете слышать себя. Если вы в звонке, микрофон и звук звонка временно отключаются.",
    en: "During the test you will hear yourself. If you are in a call, call microphone and sound are temporarily muted.",
  },
  devicesAccessHint: {
    ru: "Для списка устройств браузер может попросить доступ к микрофону или камере.",
    en: "The browser may ask for microphone or camera access to show device names.",
  },
  secureMediaHint: {
    ru: "На телефоне доступ к микрофону и камере работает только через HTTPS или localhost. Откройте сайт по HTTPS, иначе браузер не покажет запрос разрешения.",
    en: "On phones, microphone and camera access works only over HTTPS or localhost. Open the site via HTTPS, otherwise the browser will not show the permission prompt.",
  },
  noiseSuppression: { ru: "Шумоподавление", en: "Noise suppression" },
  noiseSuppressionOff: { ru: "Без шумоподавления", en: "No noise suppression" },
  noiseSuppressionKrisp: { ru: "Krisp", en: "Krisp" },
  krispHint: {
    ru: "Krisp включает доступное браузерное подавление шума, эха и автоусиление. Полный Krisp SDK можно подключить отдельно.",
    en: "Krisp enables available browser noise suppression, echo cancellation and auto gain. Full Krisp SDK can be integrated separately.",
  },

  answers: { ru: "Ответы", en: "Answers" },
  question: { ru: "Вопрос", en: "Question" },
  addAnswer: { ru: "Добавить ответ", en: "Add answer" },
  solvedQuestionNoAnswers: {
    ru: "Вопрос уже решен, новые ответы закрыты.",
    en: "This question is solved, new answers are closed.",
  },
} satisfies Dictionary;

type TranslationKey = keyof typeof dictionary;

export const translate = (key: TranslationKey, language: AppLanguage) =>
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
    t: (key: TranslationKey) => translate(key, settings.appLanguage),
  };
};
