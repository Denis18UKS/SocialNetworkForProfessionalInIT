import { useEffect } from "react";
import { Toaster } from "@/components/ui/toaster";
import { Toaster as Sonner } from "@/components/ui/sonner";
import { TooltipProvider } from "@/components/ui/tooltip";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { BrowserRouter, Routes, Route, useLocation } from "react-router-dom";
import { SidebarProvider } from "@/components/ui/sidebar";
import { AppSidebar } from "./components/AppSidebar";
import Header from "./components/Header";
import Index from "./pages/Index";
import NotFound from "./pages/NotFound";
import Register from "./pages/Register";
import Login from "./pages/Login";
import MyProfile from "./pages/MyProfile";
import EditProfile from "./pages/EditProfile";
import Chats from "./pages/Chats";
import Users from "./pages/Users";
import UserProfilePage from "./pages/UsersProfiles";
import Xakatons from "./pages/Xakatons";
import FriendRequests from "./pages/FriendRequests";
import FriendQrLanding from "./pages/FriendQrLanding";
import Blacklist from "./pages/Blacklist";
import Forum from "./pages/Forum";
import Answers from './pages/Answers';
import AdminUsers from './pages/admin/AdminUsers';
import Moderation from './pages/admin/Moderation';
import GroupChats from './pages/GroupChats';
import Settings from './pages/Settings';
import OnlineCompiler from './pages/OnlineCompiler';
import AndroidApp from './pages/AndroidApp';
import RealtimeNotifications from './components/RealtimeNotifications';
import PushCallRegistration from './components/PushCallRegistration';
import { AuthProvider } from "@/pages/AuthContext";

const queryClient = new QueryClient();

const useMobileVisualViewport = () => {
  useEffect(() => {
    const updateViewport = () => {
      const viewport = window.visualViewport;
      const visibleHeight = Math.max(320, Math.round(viewport?.height || window.innerHeight));
      const visibleTop = Math.max(0, Math.round(viewport?.offsetTop || 0));
      const layoutHeight = Math.max(window.innerHeight, document.documentElement.clientHeight || 0);
      const visibleBottom = Math.max(
        0,
        Math.min(140, Math.round(layoutHeight - visibleTop - (viewport?.height || layoutHeight))),
      );

      document.documentElement.style.setProperty("--app-viewport-height", `${visibleHeight}px`);
      document.documentElement.style.setProperty("--app-viewport-top", `${visibleTop}px`);
      document.documentElement.style.setProperty("--app-viewport-bottom", `${visibleBottom}px`);
    };

    updateViewport();
    window.addEventListener("resize", updateViewport);
    window.addEventListener("orientationchange", updateViewport);
    window.visualViewport?.addEventListener("resize", updateViewport);
    window.visualViewport?.addEventListener("scroll", updateViewport);

    return () => {
      window.removeEventListener("resize", updateViewport);
      window.removeEventListener("orientationchange", updateViewport);
      window.visualViewport?.removeEventListener("resize", updateViewport);
      window.visualViewport?.removeEventListener("scroll", updateViewport);
    };
  }, []);
};

const AppLayout = () => {
  const location = useLocation();
  const isChatWorkspace = location.pathname === "/chats"
    || location.pathname.startsWith("/chats/")
    || location.pathname === "/group-chats"
    || location.pathname.startsWith("/group-chats/");

  return (
    <>
      <RealtimeNotifications />
      <PushCallRegistration />
      <SidebarProvider>
        <div className="app-visual-viewport flex w-full overflow-hidden bg-background dark:bg-gray-950">
          <AppSidebar />
          <div className="flex min-w-0 flex-1 flex-col">
            <Header />
            <main
              className={isChatWorkspace
                ? "min-h-0 flex-1 overflow-hidden p-0 sm:p-2 lg:p-3"
                : "min-h-0 flex-1 overflow-y-auto overflow-x-hidden p-3 sm:p-4 lg:p-6"}
            >
              <Routes>
                <Route path="/" element={<Index />} />
                <Route path="/register" element={<Register />} />
                <Route path="/login" element={<Login />} />
                <Route path="/profile" element={<MyProfile />} />
                <Route path="/profile/edit" element={<EditProfile />} />
                <Route path="/chats/:chatId" element={<Chats />} />
                <Route path="/chats" element={<Chats />} />
                <Route path="/users" element={<Users />} />
                <Route path="/users-profiles/:username" element={<UserProfilePage />} />
                <Route path="/xakatons" element={<Xakatons />} />
                <Route path="/friend-requests" element={<FriendRequests />} />
                <Route path="/friend-qr/:token" element={<FriendQrLanding />} />
                <Route path="/blacklist" element={<Blacklist />} />
                <Route path="/forum" element={<Forum />} />
                <Route path="/forums/:id/answers" element={<Answers />} />
                <Route path="/group-chats/:chatId" element={<GroupChats />} />
                <Route path="/group-chats" element={<GroupChats />} />
                <Route path="/settings" element={<Settings />} />
                <Route path="/compiler" element={<OnlineCompiler />} />
                <Route path="/android-app" element={<AndroidApp />} />
                <Route path="/admin/users" element={<AdminUsers />} />
                <Route path="/admin/moderation" element={<Moderation />} />
                <Route path="*" element={<NotFound />} />
              </Routes>
            </main>
          </div>
        </div>
      </SidebarProvider>
    </>
  );
};

const App = () => {
  useMobileVisualViewport();

  return (
    <QueryClientProvider client={queryClient}>
      <TooltipProvider>
        <Toaster />
        <Sonner />
        <AuthProvider>
          <BrowserRouter>
            <AppLayout />
          </BrowserRouter>
        </AuthProvider>
      </TooltipProvider>
    </QueryClientProvider>
  );
};

export default App;
