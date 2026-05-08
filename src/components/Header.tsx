
import { SidebarTrigger } from "@/components/ui/sidebar";

const Header = () => {
  return (
    <header className="sticky top-0 z-50 flex h-14 shrink-0 items-center justify-between border-b border-gray-200 bg-background px-3 dark:border-gray-800 dark:bg-gray-950 sm:h-16 sm:px-4">
      <div className="flex min-w-0 items-center gap-3 sm:gap-4">
        <SidebarTrigger />
        <h1 className="truncate text-base font-semibold sm:text-lg">IT-BIRD</h1>
      </div>
    </header>
  );
};

export default Header;
