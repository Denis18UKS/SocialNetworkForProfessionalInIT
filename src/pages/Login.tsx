import { useState, useEffect, useRef } from "react";
import { useNavigate } from "react-router-dom";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Alert, AlertDescription, AlertTitle } from "@/components/ui/alert";
import { AlertCircle, CheckCircle2 } from "lucide-react";
import { useToast } from "@/components/ui/use-toast";
import { useAuth } from "@/pages/AuthContext";
import { motion } from "framer-motion";
import PasswordRecovery from "@/components/PasswordRecovery";

const ITBirdRules = () => (
  <div className="space-y-4 text-sm max-h-64 overflow-y-auto pr-2 text-gray-700 dark:text-gray-200">
    <p>
      Перед использованием сервиса IT-BIRD внимательно ознакомьтесь с правилами ниже. Использование сервиса означает ваше полное согласие с этими правилами и обязательство их соблюдать.
    </p>
    <ol className="list-decimal pl-5 space-y-3">
      <li>
        <strong className="text-gray-900 dark:text-white">Обязанности пользователей.</strong>
        <p>
          Пользователи обязуются использовать сервис добросовестно, уважительно относиться к другим пользователям и воздерживаться от действий, нарушающих права и законные интересы третьих лиц.
        </p>
      </li>
      <li>
        <strong className="text-gray-900 dark:text-white">Запрет на противоправные действия.</strong>
        <p>
          Запрещается использовать сервис для распространения незаконного контента, рекламы без согласия администрации, спама, вредоносных программ, а также для любых действий, нарушающих законодательство страны.
        </p>
      </li>
      <li>
        <strong className="text-gray-900 dark:text-white">Защита персональных данных.</strong>
        <p>
          Пользователи не имеют права публиковать или распространять личные данные других лиц без их письменного согласия. Администрация соблюдает политику конфиденциальности и не передает ваши данные третьим лицам без вашего согласия, кроме случаев, предусмотренных законом.
        </p>
      </li>
      <li>
        <strong className="text-gray-900 dark:text-white">Ответственность за размещаемый контент.</strong>
        <p>
          Пользователи несут полную ответственность за информацию, размещаемую ими на платформе. Администрация не несет ответственности за действия пользователей и не гарантирует точность, полноту или законность размещённого контента.
        </p>
      </li>
      <li>
        <strong className="text-gray-900 dark:text-white">Блокировка и удаление аккаунтов.</strong>
        <p>
          Администрация вправе без предварительного уведомления блокировать или удалять аккаунты пользователей, нарушающих данные правила или законодательство.
        </p>
      </li>
      <li>
        <strong className="text-gray-900 dark:text-white">Отказ от гарантий и ограничение ответственности.</strong>
        <p>
          Сервис предоставляется "как есть" без каких-либо гарантий. Администрация не несет ответственности за возможные убытки или ущерб, возникшие в результате использования или невозможности использования сервиса.
        </p>
      </li>
      <li>
        <strong className="text-gray-900 dark:text-white">Изменение правил.</strong>
        <p>
          Администрация оставляет за собой право изменять данные правила без предварительного уведомления. Продолжение использования сервиса после изменений считается согласием с новыми правилами.
        </p>
      </li>
      <li>
        <strong className="text-gray-900 dark:text-white">Обращение в службу поддержки.</strong>
        <p>
          По всем вопросам и жалобам обращайтесь в службу поддержки по указанным контактам. Мы стремимся оперативно решать возникающие проблемы.
        </p>
      </li>
    </ol>
    <p>Используя сервис IT-BIRD, вы подтверждаете, что ознакомились с правилами, понимаете и принимаете их.</p>
  </div>
);

const Login = () => {
  const { setIsAuthenticated, login } = useAuth();
  const [emailOrUsername, setEmailOrUsername] = useState("");
  const [password, setPassword] = useState("");
  const [resetEmail, setResetEmail] = useState("");
  const [showPasswordReset, setShowPasswordReset] = useState(false);
  const [isResetLoading, setIsResetLoading] = useState(false);
  const [showBlockedAlert, setShowBlockedAlert] = useState(false);
  const [showSuccessAlert, setShowSuccessAlert] = useState(false);

  // Новые состояния для модального окна с анимацией
  const [renderModal, setRenderModal] = useState(false);
  const [isModalVisible, setIsModalVisible] = useState(false);

  // Проверка, приняли ли правила
  const [rulesAccepted, setRulesAccepted] = useState(() => {
    return localStorage.getItem("itbirdRulesAccepted") === "true";
  });

  const navigate = useNavigate();
  const { toast } = useToast();

  const acceptButtonRef = useRef<HTMLButtonElement>(null);

  // Автофокус на кнопку при появлении модалки
  useEffect(() => {
    if (renderModal && acceptButtonRef.current) {
      acceptButtonRef.current.focus();
    }
  }, [renderModal]);

  // Закрытие модалки по Escape
  useEffect(() => {
    const onKeyDown = (e: KeyboardEvent) => {
      if (e.key === "Escape" && renderModal) {
        closeModal();
      }
    };
    window.addEventListener("keydown", onKeyDown);
    return () => window.removeEventListener("keydown", onKeyDown);
  }, [renderModal]);

  // Открыть модальное окно
  const openModal = () => {
    setRenderModal(true);
    setTimeout(() => {
      setIsModalVisible(true);
    }, 10);
  };

  // Закрыть модальное окно
  const closeModal = () => {
    setIsModalVisible(false);
    setTimeout(() => {
      setRenderModal(false);
    }, 300);
  };

  const handleLogin = async (e: React.FormEvent) => {
    e.preventDefault();

    if (!rulesAccepted) {
      openModal();
      toast({
        title: "Внимание",
        description: "Перед входом необходимо ознакомиться с правилами IT-BIRD.",
        variant: "destructive",
      });
      return;
    }

    try {
      const response = await fetch("http://localhost:5000/login", {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
        },
        body: JSON.stringify({ emailOrUsername, password }),
      });

      const data = await response.json();

      if (response.ok) {
        login(data.token, data.user.role);

        await fetch(`http://localhost:5000/repositories/${data.user.github_username}`, {
          method: "GET",
        });

        setShowSuccessAlert(true);
        toast({
          title: "Успешный вход",
          description: "Добро пожаловать!",
        });

        setIsAuthenticated(true);

        if (data.user.role === "admin") {
          navigate("/admin/users");
        } else {
          navigate("/profile");
        }
      } else {
        if (data.message === "Ваш аккаунт заблокирован!") {
          setShowBlockedAlert(true);
        } else {
          toast({
            title: "Ошибка",
            description: data.message,
            variant: "destructive",
          });
        }
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

  const handleAcceptRules = () => {
    localStorage.setItem("itbirdRulesAccepted", "true");
    setRulesAccepted(true);
    closeModal();
    toast({
      title: "Спасибо",
      description: "Вы ознакомились с правилами IT-BIRD",
    });
  };

  const handlePasswordReset = async (e: React.FormEvent) => {
    e.preventDefault();

    if (!resetEmail.trim()) {
      toast({
        title: "Ошибка",
        description: "Укажите почту аккаунта",
        variant: "destructive",
      });
      return;
    }

    setIsResetLoading(true);

    try {
      const response = await fetch("http://localhost:5000/password-reset/request", {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
        },
        body: JSON.stringify({ email: resetEmail.trim() }),
      });

      const data = await response.json();

      if (!response.ok) {
        throw new Error(data.message || "Не удалось отправить временный пароль");
      }

      toast({
        title: "Письмо отправлено",
        description: "Проверьте почту и войдите с временным цифровым паролем.",
      });
      setEmailOrUsername(resetEmail.trim());
      setPassword("");
      setResetEmail("");
      setShowPasswordReset(false);
    } catch (error) {
      toast({
        title: "Ошибка",
        description: error instanceof Error ? error.message : "Не удалось отправить временный пароль",
        variant: "destructive",
      });
    } finally {
      setIsResetLoading(false);
    }
  };

  const handleContactSupport = () => {
    window.location.href = "https://vk.com/dkarpov2003";
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
            <CardTitle className="text-2xl font-bold text-center">Вход</CardTitle>
            <CardDescription className="text-center text-gray-600 dark:text-gray-400">
              Войдите в свой аккаунт IT-BIRD
            </CardDescription>
          </CardHeader>
          <CardContent>
            <form onSubmit={handleLogin} className="space-y-4">
              <div className="space-y-2">
                <Label htmlFor="emailOrUsername" className="text-gray-700 dark:text-gray-300">
                  Почта или Логин
                </Label>
                <Input
                  id="emailOrUsername"
                  type="text"
                  value={emailOrUsername}
                  onChange={(e) => setEmailOrUsername(e.target.value)}
                  required
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
                disabled={renderModal}
              >
                Войти
              </Button>
            </form>
            <div className="mt-4 text-center">
              <Button
                type="button"
                variant="link"
                onClick={() => setShowPasswordReset((current) => !current)}
                className="mb-2 text-[#6E59A5]"
              >
                {showPasswordReset ? "Вернуться ко входу" : "Забыли пароль?"}
              </Button>

              {showPasswordReset && (
                <div data-mail-recovery="two-step" className="MAIL_RECOVERY: two-step-ui">
                  <PasswordRecovery />
                </div>
              )}

              <Button
                variant="outline"
                size="sm"
                onClick={openModal}
                disabled={renderModal}
                className="border-[#6E59A5] text-[#6E59A5] hover:bg-[#6E59A5]/10"
              >
                Правила IT-BIRD
              </Button>
            </div>
          </CardContent>
        </Card>

        {showBlockedAlert && (
          <Alert variant="destructive" className="fixed top-4 right-4 w-96">
            <AlertCircle className="h-4 w-4" />
            <AlertTitle>Аккаунт заблокирован</AlertTitle>
            <AlertDescription className="mt-2">
              <p>Обратитесь в техподдержку для решения проблемы.</p>
              <div className="mt-4 flex space-x-4">
                <Button onClick={handleContactSupport} variant="secondary">
                  Обратиться
                </Button>
                <Button onClick={() => setShowBlockedAlert(false)} variant="outline">
                  Закрыть
                </Button>
              </div>
            </AlertDescription>
          </Alert>
        )}

        {showSuccessAlert && (
          <Alert className="fixed top-4 right-4 w-96">
            <CheckCircle2 className="h-4 w-4" />
            <AlertTitle>Вход успешен</AlertTitle>
            <AlertDescription>Перенаправление в ваш профиль...</AlertDescription>
          </Alert>
        )}

        {/* Модальное окно с правилами */}
        {renderModal && (
          <div
            className={`fixed inset-0 bg-black bg-opacity-50 flex items-center justify-center z-50
            transition-opacity duration-300
            ${isModalVisible ? "opacity-100" : "opacity-0 pointer-events-none"}`}
            onClick={closeModal}
            role="dialog"
            aria-modal="true"
            aria-labelledby="rules-title"
          >
            <div
              className="bg-white text-gray-900 dark:bg-gray-900 dark:text-gray-100 rounded p-6 w-full max-w-lg max-h-[80vh] overflow-y-auto
              border border-gray-200 dark:border-gray-700 shadow-xl transform transition-transform duration-300"
              style={{
                transform: isModalVisible ? "translateY(0)" : "translateY(-20px)",
              }}
              onClick={(e) => e.stopPropagation()}
            >
              <h2 id="rules-title" className="text-xl font-bold mb-4 text-gray-900 dark:text-white">
                Правила IT-BIRD
              </h2>
              <ITBirdRules />
              <div className="flex justify-end mt-6 space-x-2">
                <Button variant="outline" onClick={closeModal} aria-label="Закрыть окно правил">
                  Закрыть
                </Button>
                <Button variant="default" onClick={handleAcceptRules} ref={acceptButtonRef} aria-label="Я ознакомлен с правилами" >
                  Я ознакомлен
                </Button>
              </div>
            </div>
          </div>
        )}
      </motion.div>
    </div>
  );
};

export default Login;
