import {
  Award,
  Ban,
  Code2,
  Home,
  LogOut,
  MessageCircle,
  MessageSquare,
  MessagesSquare,
  Settings,
  User,
  UserPlus,
  Users,
} from "lucide-react";
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
} from "@/components/ui/sidebar";
import { useAuth } from "@/pages/AuthContext";
import { useIsMobile } from "@/hooks/use-mobile";
import { useI18n } from "@/lib/i18n";

type NavItem = {
  title: string;
  url: string;
  icon: ComponentType<{ className?: string }>;
};

export function AppSidebar() {
  const { isAuthenticated, role, logout } = useAuth();
  const isMobile = useIsMobile();
  const location = useLocation();
  const { t } = useI18n();

  const publicItems: NavItem[] = [
    { title: t("home"), url: "/", icon: Home },
    { title: t("hackathons"), url: "/xakatons", icon: Award },
    { title: "Онлайн компилятор", url: "/compiler", icon: Code2 },
  ];

  const authItems: NavItem[] = [
    { title: t("myProfile"), url: "/profile", icon: User },
    { title: t("chats"), url: "/chats", icon: MessageSquare },
    { title: t("groupChats"), url: "/group-chats", icon: MessagesSquare },
    { title: t("users"), url: "/users", icon: Users },
    { title: t("friendRequests"), url: "/friend-requests", icon: UserPlus },
    { title: "Черный список", url: "/blacklist", icon: Ban },
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
          className={`flex items-center gap-3 rounded-md px-4 py-2 text-sm font-medium transition-colors ${
            isActive(item.url)
              ? "bg-primary/10 text-primary dark:bg-primary/20"
              : "hover:bg-accent hover:text-accent-foreground"
          }`}
        >
          <item.icon className="h-5 w-5" />
          {item.title}
        </Link>
      </SidebarMenuButton>
    </SidebarMenuItem>
  );

  return (
    <Sidebar
      className={`border-r border-border bg-white/70 shadow-md backdrop-blur-lg dark:bg-black/30 ${
        isMobile ? "bg-background" : ""
      }`}
    >
      <SidebarContent>
        <div className="p-6">
          <h1 className="text-3xl font-extrabold tracking-tight text-primary">IT-BIRD</h1>
        </div>

        <SidebarGroup>
          <SidebarGroupLabel className="mb-1 px-6 text-xs uppercase text-muted-foreground">
            {t("navigation")}
          </SidebarGroupLabel>

          <SidebarGroupContent>
            <SidebarMenu>
              {[...publicItems, ...(isAuthenticated ? authItems : guestItems)].map(renderItem)}

              {isAuthenticated && (
                <>
                  {role === "admin" && (
                    <>
                      <SidebarGroupLabel className="mb-1 mt-4 px-6 text-xs uppercase text-muted-foreground">
                        {t("administration")}
                      </SidebarGroupLabel>
                      {adminItems.map(renderItem)}
                    </>
                  )}

                  <SidebarMenuItem>
                    <SidebarMenuButton
                      onClick={logout}
                      className="flex items-center gap-3 rounded-md px-4 py-2 text-sm font-medium text-red-500 transition-colors hover:text-red-600"
                    >
                      <LogOut className="h-5 w-5" />
                      {t("logout")}
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
