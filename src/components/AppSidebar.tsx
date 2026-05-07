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

export function AppSidebar() {
  const { isAuthenticated, role, logout } = useAuth();
  const isMobile = useIsMobile();
  const location = useLocation();
  const { t } = useI18n();

  const publicItems = [
    { title: t("home"), url: "/", icon: Home },
    { title: t("hackathons"), url: "/xakatons", icon: Award },
    { title: "Онлайн компилятор", url: "/compiler", icon: Code2 },
    { title: t("settings"), url: "/settings", icon: Settings },
  ];

  const authItems = [
    { title: t("myProfile"), url: "/profile", icon: User },
    { title: t("chats"), url: "/chats", icon: MessageSquare },
    { title: t("groupChats"), url: "/group-chats", icon: MessagesSquare },
    { title: t("users"), url: "/users", icon: Users },
    { title: t("friendRequests"), url: "/friend-requests", icon: UserPlus },
    { title: "Черный список", url: "/blacklist", icon: Ban },
    { title: t("forum"), url: "/forum", icon: MessageCircle },
  ];

  const adminItems = [
    { title: t("adminUsers"), url: "/admin/users", icon: Users },
    { title: t("moderation"), url: "/admin/moderation", icon: Settings },
  ];

  const isActive = (path: string) =>
    path === "/" ? location.pathname === path : location.pathname.startsWith(path);

  const renderItem = (item: { title: string; url: string; icon: ComponentType<{ className?: string }> }) => (
    <SidebarMenuItem key={item.url}>
      <SidebarMenuButton asChild>
        <Link
          to={item.url}
          className={`flex items-center gap-3 px-4 py-2 rounded-md transition-colors text-sm font-medium ${
            isActive(item.url)
              ? "bg-primary/10 text-primary dark:bg-primary/20"
              : "hover:bg-accent hover:text-accent-foreground"
          }`}
        >
          <item.icon className="w-5 h-5" />
          {item.title}
        </Link>
      </SidebarMenuButton>
    </SidebarMenuItem>
  );

  return (
    <Sidebar
      className={`border-r border-border shadow-md bg-white/70 dark:bg-black/30 backdrop-blur-lg ${
        isMobile ? "bg-background" : ""
      }`}
    >
      <SidebarContent>
        <div className="p-6">
          <h1 className="text-3xl font-extrabold text-primary tracking-tight">IT-BIRD</h1>
        </div>

        <SidebarGroup>
          <SidebarGroupLabel className="text-xs uppercase text-muted-foreground px-6 mb-1">
            {t("navigation")}
          </SidebarGroupLabel>

          <SidebarGroupContent>
            <SidebarMenu>
              {[...publicItems, ...(isAuthenticated ? authItems : [])].map(renderItem)}

              {!isAuthenticated ? (
                <>
                  {renderItem({ title: t("register"), url: "/register", icon: User })}
                  {renderItem({ title: t("login"), url: "/login", icon: LogOut })}
                </>
              ) : (
                <>
                  {role === "admin" && (
                    <>
                      <SidebarGroupLabel className="text-xs uppercase text-muted-foreground px-6 mt-4 mb-1">
                        {t("administration")}
                      </SidebarGroupLabel>
                      {adminItems.map(renderItem)}
                    </>
                  )}

                  <SidebarMenuItem>
                    <SidebarMenuButton
                      onClick={logout}
                      className="flex items-center gap-3 px-4 py-2 rounded-md transition-colors text-sm font-medium text-red-500 hover:text-red-600"
                    >
                      <LogOut className="w-5 h-5" />
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
