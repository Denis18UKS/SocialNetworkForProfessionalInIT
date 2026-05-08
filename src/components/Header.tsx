
import { SidebarTrigger } from "@/components/ui/sidebar";

const Header = () => {
  return (
    <header className="h-16 border-b border-gray-200 bg-background flex items-center justify-between px-4 sticky top-0 z-50 dark:border-gray-800 dark:bg-gray-950">
      <div className="flex items-center gap-4">
        <SidebarTrigger />
        <h1 className="text-lg font-semibold hidden md:block">IT-BIRD</h1>
      </div>
    </header>
  );
};

export default Header;
