import {
  Award,
  Ban,
  Clapperboard,
  Code2,
  Folder,
  Home,
  LogOut,
  MessageCircle,
  MessageSquare,
  MessagesSquare,
  Settings,
  Smartphone,
  User,
  UserPlus,
  Users,
} from "lucide-react";
import { useEffect, useState } from "react";
import type { ComponentType } from "react";
import { Link, useLocation } from "react-router-dom";
import {
  Sidebar,
  SidebarContent,
  SidebarGroup,
  SidebarGroupContent,
  SidebarGroupLabel,
  SidebarMenu,
  SidebarMenuButton,
  SidebarMenuItem,
  useSidebar,
} from "@/components/ui/sidebar";
import { useAuth } from "@/pages/AuthContext";
import { useI18n } from "@/lib/i18n";
import { apiUrl } from "@/lib/settings";
import { isNativeAndroidApp } from "@/lib/screen-share";

type NavItem = {
  title: string;
  url: string;
  icon: ComponentType<{ className?: string }>;
};

type NativeVersionBridge = {
  getVersion?: () => string;
  getVersionCode?: () => number;
};

const versionNameFallbackCode = (versionName: string) => {
  const parts = String(versionName || "").split(".");
  const last = Number(parts.at(-1) || 0);
  return Number.isInteger(last) && last > 0 ? last : 0;
};

const getInstalledAndroidVersionCode = () => {
  if (!isNativeAndroidApp()) return 0;
  try {
    const bridge = (window as typeof window & { ITBirdAndroid?: NativeVersionBridge }).ITBirdAndroid;
    const nativeCode = Number(bridge?.getVersionCode?.() || 0);
    if (Number.isInteger(nativeCode) && nativeCode > 0) return nativeCode;
    return versionNameFallbackCode(String(bridge?.getVersion?.() || ""));
  } catch {
    return 0;
  }
};

export function AppSidebar() {
  const { isAuthenticated, role, logout } = useAuth();
  const { isMobile, setOpenMobile } = useSidebar();
  const location = useLocation();
  const { t, language } = useI18n();
  const [androidUpdateAvailable, setAndroidUpdateAvailable] = useState(false);

  useEffect(() => {
    if (!isNativeAndroidApp()) {
      setAndroidUpdateAvailable(false);
      return;
    }

    let cancelled = false;
    const checkUpdate = async () => {
      const installedVersionCode = getInstalledAndroidVersionCode();
      if (installedVersionCode <= 0) {
        if (!cancelled) setAndroidUpdateAvailable(false);
        return;
      }
      try {
        const response = await fetch(apiUrl("/android/version"), { cache: "no-store" });
        const data = await response.json();
        const latestVersionCode = Number(data?.versionCode || 0);
        if (!cancelled) {
          setAndroidUpdateAvailable(Boolean(response.ok && data?.available && latestVersionCode > installedVersionCode));
        }
      } catch {
        if (!cancelled) setAndroidUpdateAvailable(false);
      }
    };

    void checkUpdate();
    const onVisible = () => {
      if (document.visibilityState === "visible") void checkUpdate();
    };
    document.addEventListener("visibilitychange", onVisible);
    window.addEventListener("focus", onVisible);
    return () => {
      cancelled = true;
      document.removeEventListener("visibilitychange", onVisible);
      window.removeEventListener("focus", onVisible);
    };
  }, []);

  const closeMobile = () => {
    if (isMobile) setOpenMobile(false);
  };

  const androidTitle = androidUpdateAvailable
    ? (language === "ru" ? "Обновление приложения" : "App update")
    : t("androidApp");

  const publicItems: NavItem[] = [
    { title: t("home"), url: "/", icon: Home },
    { title: t("hackathons"), url: "/xakatons", icon: Award },
    { title: t("onlineCompiler"), url: "/compiler", icon: Code2 },
    { title: androidTitle, url: "/android-app", icon: Smartphone },
  ];

  const authItems: NavItem[] = [
    { title: t("myProfile"), url: "/profile", icon: User },
    { title: t("chats"), url: "/chats", icon: MessageSquare },
    { title: t("groupChats"), url: "/group-chats", icon: MessagesSquare },
    { title: language === "ru" ? "Папки чатов" : "Chat folders", url: "/chat-folders", icon: Folder },
    { title: "C-Party", url: "/c-party", icon: Clapperboard },
    { title: t("users"), url: "/users", icon: Users },
    { title: t("friendRequests"), url: "/friend-requests", icon: UserPlus },
    { title: t("blacklist"), url: "/blacklist", icon: Ban },
    { title: t("forum"), url: "/forum", icon: MessageCircle },
    { title: t("settings"), url: "/settings", icon: Settings },
  ];

  const guestItems: NavItem[] = [
    { title: t("settings"), url: "/settings", icon: Settings },
    { title: t("register"), url: "/register", icon: User },
    { title: t("login"), url: "/login", icon: LogOut },
  ];

  const adminItems: NavItem[] = [
    { title: t("adminUsers"), url: "/admin/users", icon: Users },
    { title: t("moderation"), url: "/admin/moderation", icon: Settings },
  ];

  const isActive = (path: string) =>
    path === "/" ? location.pathname === path : location.pathname.startsWith(path);

  const renderItem = (item: NavItem) => (
    <SidebarMenuItem key={item.url}>
      <SidebarMenuButton asChild>
        <Link
          to={item.url}
          onClick={closeMobile}
          className={`flex min-w-0 items-center gap-3 rounded-md px-4 py-2 text-sm font-medium transition-colors ${
            isActive(item.url)
              ? "bg-primary/10 text-primary dark:bg-primary/20"
              : "hover:bg-accent hover:text-accent-foreground"
          }`}
        >
          <item.icon className="h-5 w-5 shrink-0" />
          <span className="truncate">{item.title}</span>
        </Link>
      </SidebarMenuButton>
    </SidebarMenuItem>
  );

  const handleLogout = () => {
    closeMobile();
    logout();
  };

  return (
    <Sidebar className="border-r border-border bg-background shadow-md dark:bg-gray-950">
      <SidebarContent className="mobile-bottom-safe min-w-0 overflow-y-auto">
        <div className="px-5 py-6">
          <h1 className="truncate text-3xl font-extrabold tracking-tight text-primary">IT-BIRD</h1>
        </div>

        <SidebarGroup>
          <SidebarGroupLabel className="mb-1 px-5 text-xs uppercase text-muted-foreground">
            {t("navigation")}
          </SidebarGroupLabel>

          <SidebarGroupContent>
            <SidebarMenu>
              {[...publicItems, ...(isAuthenticated ? authItems : guestItems)].map(renderItem)}

              {isAuthenticated && (
                <>
                  {role === "admin" && (
                    <>
                      <SidebarGroupLabel className="mb-1 mt-4 px-5 text-xs uppercase text-muted-foreground">
                        {t("administration")}
                      </SidebarGroupLabel>
                      {adminItems.map(renderItem)}
                    </>
                  )}

                  <SidebarMenuItem>
                    <SidebarMenuButton
                      onClick={handleLogout}
                      className="flex min-w-0 items-center gap-3 rounded-md px-4 py-2 text-sm font-medium text-red-500 transition-colors hover:text-red-600"
                    >
                      <LogOut className="h-5 w-5 shrink-0" />
                      <span className="truncate">{t("logout")}</span>
                    </SidebarMenuButton>
                  </SidebarMenuItem>
                </>
              )}
            </SidebarMenu>
          </SidebarGroupContent>
        </SidebarGroup>
      </SidebarContent>
    </Sidebar>
  );
}
