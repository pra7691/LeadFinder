import { ReactNode } from "react";
import { Link, useLocation } from "wouter";
import { 
  Activity, 
  BarChart, 
  Briefcase, 
  Mail, 
  Send, 
  Settings, 
  Users,
  Moon,
  Sun
} from "lucide-react";
import { cn } from "@/lib/utils";
import { useTheme } from "./theme-provider";
import { Button } from "./ui/button";

const NAV_ITEMS = [
  { href: "/", label: "Overview", icon: BarChart },
  { href: "/campaigns", label: "Campaigns", icon: Briefcase },
  { href: "/leads", label: "Leads", icon: Users },
  { href: "/email-accounts", label: "Accounts", icon: Mail },
  { href: "/outreach", label: "Outreach", icon: Send },
  { href: "/logs", label: "Activity Logs", icon: Activity },
  { href: "/settings", label: "Settings", icon: Settings },
];

export function Layout({ children }: { children: ReactNode }) {
  const [location] = useLocation();
  const { theme, setTheme } = useTheme();

  return (
    <div className="flex min-h-screen w-full bg-background text-foreground selection:bg-primary/30 font-sans relative overflow-hidden">
      
      {/* Decorative background blurs */}
      <div className="fixed -top-40 -right-40 w-96 h-96 bg-primary/10 rounded-full blur-[100px] pointer-events-none" />
      <div className="fixed -bottom-40 -left-40 w-96 h-96 bg-primary/10 rounded-full blur-[100px] pointer-events-none" />

      <aside className="w-64 border-r border-border/50 bg-background/50 backdrop-blur-2xl flex flex-col fixed inset-y-0 left-0 z-10 shadow-[4px_0_24px_-12px_rgba(0,0,0,0.1)]">
        <div className="p-6 flex items-center gap-3">
          <div className="w-8 h-8 rounded-xl bg-primary flex items-center justify-center shadow-sm">
            <span className="text-sm font-semibold text-primary-foreground tracking-tight">LG</span>
          </div>
          <span className="font-semibold tracking-tight text-base">LeadGen</span>
        </div>
        
        <div className="px-4 py-2 flex-1 flex flex-col gap-1 overflow-y-auto">
          <div className="text-xs font-medium text-muted-foreground mb-3 px-2 tracking-wide">Menu</div>
          {NAV_ITEMS.map((item) => {
            const isActive = location === item.href || (item.href !== "/" && location.startsWith(item.href));
            return (
              <Link 
                key={item.href} 
                href={item.href}
                data-testid={`nav-${item.label.toLowerCase()}`}
                className={cn(
                  "flex items-center gap-3 px-3 py-2.5 rounded-xl text-sm font-medium transition-all duration-200",
                  isActive 
                    ? "bg-primary text-primary-foreground shadow-sm shadow-primary/20" 
                    : "text-muted-foreground hover:text-foreground hover:bg-muted/50"
                )}
              >
                <item.icon className={cn("w-4 h-4", isActive ? "text-primary-foreground" : "text-muted-foreground")} />
                {item.label}
              </Link>
            );
          })}
        </div>
        
        <div className="p-4 mt-auto">
          <div className="flex items-center justify-between p-3 rounded-xl bg-muted/30 border border-border/50">
            <div className="flex flex-col">
              <span className="text-xs font-medium">Operator</span>
              <span className="text-[10px] text-muted-foreground font-mono">ID: 0x8A49</span>
            </div>
            <Button
              variant="ghost"
              size="icon"
              data-testid="button-theme-toggle"
              className="rounded-full w-8 h-8 text-muted-foreground hover:text-foreground"
              onClick={() => setTheme(theme === 'dark' ? 'light' : 'dark')}
            >
              {theme === 'dark' ? <Sun className="w-4 h-4" /> : <Moon className="w-4 h-4" />}
            </Button>
          </div>
        </div>
      </aside>
      
      <main className="flex-1 ml-64 flex flex-col min-h-screen relative z-0">
        <div className="flex-1 p-8 md:p-12 max-w-7xl mx-auto w-full">
          {children}
        </div>
      </main>
    </div>
  );
}
