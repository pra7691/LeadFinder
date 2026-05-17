import { Component, ReactNode, ErrorInfo } from "react";
import { Button } from "./ui/button";
import { AlertTriangle, RefreshCw, Home } from "lucide-react";
import { cn } from "@/lib/utils";

interface Props {
  children: ReactNode;
  fallback?: ReactNode;
  className?: string;
}

interface State {
  hasError: boolean;
  error: Error | null;
}

export class ErrorBoundary extends Component<Props, State> {
  state: State = { hasError: false, error: null };

  static getDerivedStateFromError(error: Error): State {
    return { hasError: true, error };
  }

  componentDidCatch(error: Error, info: ErrorInfo) {
    console.error("[ErrorBoundary]", error.message, info.componentStack);
  }

  reset = () => this.setState({ hasError: false, error: null });

  render() {
    if (this.state.hasError) {
      if (this.props.fallback) return this.props.fallback;

      return (
        <div
          className={cn(
            "flex flex-col items-center justify-center min-h-[60vh] space-y-6 text-center px-6 animate-in fade-in duration-500",
            this.props.className,
          )}
        >
          <div className="w-16 h-16 rounded-2xl bg-destructive/10 flex items-center justify-center shadow-sm">
            <AlertTriangle className="w-8 h-8 text-destructive" />
          </div>
          <div className="space-y-2">
            <h2 className="text-xl font-semibold tracking-tight">Something went wrong</h2>
            <p className="text-sm text-muted-foreground max-w-sm mx-auto leading-relaxed">
              {this.state.error?.message ?? "An unexpected error occurred in this section."}
            </p>
          </div>
          <div className="flex items-center gap-3">
            <Button
              variant="outline"
              className="rounded-xl gap-2"
              onClick={this.reset}
            >
              <RefreshCw className="w-4 h-4" />
              Try Again
            </Button>
            <Button
              variant="ghost"
              className="rounded-xl gap-2"
              onClick={() => (window.location.href = "/")}
            >
              <Home className="w-4 h-4" />
              Go Home
            </Button>
          </div>
          {import.meta.env.DEV && this.state.error && (
            <details className="max-w-lg w-full text-left">
              <summary className="text-xs text-muted-foreground cursor-pointer hover:text-foreground">
                Error details (dev only)
              </summary>
              <pre className="mt-2 text-[11px] bg-muted/50 border border-border/50 rounded-xl p-4 overflow-auto text-destructive whitespace-pre-wrap">
                {this.state.error.stack}
              </pre>
            </details>
          )}
        </div>
      );
    }
    return this.props.children;
  }
}
