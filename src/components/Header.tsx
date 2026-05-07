
import React from "react";
import { SidebarTrigger } from "@/components/ui/sidebar";
import { useIsMobile } from "@/hooks/use-mobile";

const Header = () => {
  const isMobile = useIsMobile();

  return (
    <header className="h-16 border-b border-gray-200 flex items-center justify-between px-4 sticky top-0 bg-background z-50">
      <div className="flex items-center gap-4">
        <SidebarTrigger />
        <h1 className="text-lg font-semibold hidden md:block">IT-BIRD</h1>
      </div>
    </header>
  );
};

export default Header;
