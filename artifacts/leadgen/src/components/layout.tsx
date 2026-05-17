import { ReactNode } from "react";
import { Link, useLocation } from "wouter";
import { 
  Activity, 
  BarChart, 
  Briefcase, 
  Mail, 
  Send, 
  Settings, 
  Users 
} from "lucide-react";
import { cn } from "@/lib/utils";

const NAV_ITEMS = [
  { href: "/", label: "Dashboard", icon: BarChart },
  { href: "/campaigns", label: "Campaigns", icon: Briefcase },
  { href: "/leads", label: "Leads", icon: Users },
  { href: "/email-accounts", label: "Email Accounts", icon: Mail },
  { href: "/outreach", label: "Outreach", icon: Send },
  { href: "/logs", label: "Logs", icon: Activity },
  { href: "/settings", label: "Settings", icon: Settings },
];

export function Layout({ children }: { children: ReactNode }) {
  const [location] = useLocation();

  return (
    <div className="flex min-h-screen w-full bg-background text-foreground selection:bg-primary/30">
      <aside className="w-64 border-r border-border bg-card flex flex-col fixed inset-y-0 left-0">
        <div className="p-4 border-b border-border flex items-center gap-2">
          <div className="w-6 h-6 rounded bg-primary flex items-center justify-center">
            <span className="text-[10px] font-mono text-primary-foreground font-bold">LG</span>
          </div>
          <span className="font-mono text-sm tracking-tight font-bold">LEADGEN_CTRL</span>
        </div>
        
        <div className="p-3 flex-1 flex flex-col gap-1 overflow-y-auto">
          <div className="text-[10px] font-mono uppercase text-muted-foreground mb-2 px-2 tracking-widest">Navigation</div>
          {NAV_ITEMS.map((item) => {
            const isActive = location === item.href || (item.href !== "/" && location.startsWith(item.href));
            return (
              <Link 
                key={item.href} 
                href={item.href}
                className={cn(
                  "flex items-center gap-3 px-3 py-2 rounded-md text-sm font-medium transition-colors",
                  isActive 
                    ? "bg-primary/10 text-primary" 
                    : "text-muted-foreground hover:text-foreground hover:bg-muted/50"
                )}
              >
                <item.icon className={cn("w-4 h-4", isActive ? "text-primary" : "text-muted-foreground")} />
                {item.label}
              </Link>
            );
          })}
        </div>
        
        <div className="p-4 border-t border-border mt-auto">
          <div className="flex items-center gap-3">
            <div className="w-8 h-8 rounded-full bg-muted flex items-center justify-center border border-border">
              <span className="text-xs font-mono">OP</span>
            </div>
            <div className="flex flex-col">
              <span className="text-xs font-medium">Operator</span>
              <span className="text-[10px] text-muted-foreground font-mono">ID: 0x8A49</span>
            </div>
            <div className="ml-auto w-2 h-2 rounded-full bg-primary animate-pulse" />
          </div>
        </div>
      </aside>
      
      <main className="flex-1 ml-64 flex flex-col min-h-screen">
        <div className="flex-1 p-6">
          {children}
        </div>
      </main>
    </div>
  );
}
