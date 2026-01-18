import { useState, useRef, useEffect, useCallback } from "react";
import { createFileRoute, useSearch, useNavigate } from "@tanstack/react-router";
import { Bot, Send, Loader2, ChevronDown, ChevronUp, Wrench, Check, Terminal } from "lucide-react";
import Markdown from "react-markdown";
import remarkGfm from "remark-gfm";

import { AgentTitle } from "@/components/agent-title";
import { Button } from "@/components/ui/button";
import { Textarea } from "@/components/ui/textarea";

// Mode configuration
type AgentMode = "specialized" | "general";

const SERVER_URL = "http://localhost:3000";

const MODE_CONFIG = {
  specialized: {
    label: "Specialized",
    description: "11 Rill-specific tools",
    color: "bg-blue-500",
    icon: Wrench,
  },
  general: {
    label: "General",
    description: "2 tools (bash + SQL)",
    color: "bg-green-500",
    icon: Terminal,
  },
} as const;

// Helper to parse and extract the actual content from tool results
function parseToolOutput(result: unknown): unknown {
  if (typeof result === "object" && result !== null) {
    const r = result as Record<string, unknown>;
    // Handle the { type: "text", content: "..." } wrapper
    if (r.type === "text" && typeof r.content === "string") {
      try {
        return JSON.parse(r.content);
      } catch {
        return r.content;
      }
    }
  }
  return result;
}

// Compact display for common data types
function formatCompactOutput(data: unknown): React.ReactNode {
  if (data === null || data === undefined) return <span className="text-muted-foreground">null</span>;

  if (typeof data === "string") {
    // Preserve newlines in string output (e.g., tabular SQL results)
    return <pre className="whitespace-pre-wrap font-mono text-xs">{data}</pre>;
  }
  if (typeof data === "number" || typeof data === "boolean") return String(data);

  if (Array.isArray(data)) {
    if (data.length === 0) return <span className="text-muted-foreground">[]</span>;

    // Check if it's an array of simple objects (like metrics views, sources, etc.)
    if (data.every(item => typeof item === "object" && item !== null)) {
      const items = data as Record<string, unknown>[];
      const firstItem = items[0];
      if (!firstItem) return <span className="text-muted-foreground">[]</span>;

      // Get keys from first item
      const keys = Object.keys(firstItem);
      const nameKey = keys.find(k => k === "name" || k === "title") || keys[0];

      return (
        <div className="space-y-1">
          {items.slice(0, 10).map((item, i) => (
            <div key={i} className="flex items-center gap-2 text-xs">
              <span className="font-medium">{String(item[nameKey || ""] || `Item ${i + 1}`)}</span>
              {keys.filter(k => k !== nameKey).slice(0, 3).map(k => (
                <span key={k} className="text-muted-foreground">
                  {k}: {String(item[k])}
                </span>
              ))}
            </div>
          ))}
          {items.length > 10 && (
            <span className="text-muted-foreground text-xs">...and {items.length - 10} more</span>
          )}
        </div>
      );
    }
  }

  if (typeof data === "object") {
    const obj = data as Record<string, unknown>;
    const entries = Object.entries(obj);

    // For small objects, show inline
    if (entries.length <= 5) {
      return (
        <div className="space-y-1">
          {entries.map(([key, value]) => (
            <div key={key} className="text-xs">
              <span className="text-muted-foreground">{key}:</span>{" "}
              {typeof value === "string" && value.includes("\n") ? (
                // Multiline string - render with preserved formatting
                <pre className="mt-1 whitespace-pre-wrap font-mono text-xs overflow-x-auto">{value}</pre>
              ) : (
                <span className="font-medium">
                  {typeof value === "object" ? JSON.stringify(value) : String(value)}
                </span>
              )}
            </div>
          ))}
        </div>
      );
    }
  }

  // Fallback: pretty JSON
  return (
    <pre className="text-xs overflow-x-auto whitespace-pre-wrap">
      {JSON.stringify(data, null, 2)}
    </pre>
  );
}

// Clean, minimal tool call display component
function ToolCallItem({
  toolName,
  args,
  result,
  isPending,
}: {
  toolName: string;
  args?: unknown;
  result: unknown;
  isPending: boolean;
}) {
  const [isExpanded, setIsExpanded] = useState(false);

  // Format tool name nicely (rill_list_sources -> List Sources, execute_bash -> Bash)
  const displayName = toolName
    .replace(/^rill_/, "")
    .replace(/^execute_/, "")
    .split("_")
    .map((word) => word.charAt(0).toUpperCase() + word.slice(1))
    .join(" ");

  // Check if args has meaningful content
  const hasArgs =
    args &&
    typeof args === "object" &&
    Object.keys(args as Record<string, unknown>).length > 0;

  return (
    <div className="group">
      <button
        type="button"
        onClick={() => setIsExpanded(!isExpanded)}
        className="flex items-center gap-2 w-full text-left py-1 px-2 -mx-2 rounded hover:bg-muted/50 transition-colors"
      >
        {isPending ? (
          <Loader2 className="h-3 w-3 animate-spin text-primary shrink-0" />
        ) : (
          <Check className="h-3 w-3 text-green-500 shrink-0" />
        )}
        <span className="text-xs font-medium">{displayName}</span>
        {hasArgs ? (
          <span className="text-xs text-muted-foreground truncate">
            {formatArgsPreview(args)}
          </span>
        ) : null}
        <ChevronDown
          className={`h-3 w-3 text-muted-foreground ml-auto shrink-0 transition-transform ${
            isExpanded ? "rotate-180" : ""
          }`}
        />
      </button>

      {isExpanded ? (
        <div className="ml-5 mt-1 mb-2 pl-2 border-l-2 border-muted">
          {hasArgs ? (
            <div className="mb-2">
              <span className="text-[10px] uppercase tracking-wide text-muted-foreground">
                Input
              </span>
              <div className="mt-0.5 text-xs bg-muted/30 rounded p-2">
                {formatCompactOutput(args)}
              </div>
            </div>
          ) : null}
          {result !== null ? (
            <div>
              <span className="text-[10px] uppercase tracking-wide text-muted-foreground">
                Output
              </span>
              <div className="mt-0.5 text-xs bg-muted/30 rounded p-2 max-h-64 overflow-y-auto">
                {formatCompactOutput(result)}
              </div>
            </div>
          ) : null}
        </div>
      ) : null}
    </div>
  );
}

// Format args into a short preview string
function formatArgsPreview(args: unknown): string {
  if (!args || typeof args !== "object") return "";
  const obj = args as Record<string, unknown>;
  const entries = Object.entries(obj);
  if (entries.length === 0) return "";

  const preview = entries
    .slice(0, 2)
    .map(([k, v]) => {
      const valueStr = typeof v === "string" ? v : JSON.stringify(v);
      const truncated = valueStr.length > 30 ? valueStr.slice(0, 30) + "..." : valueStr;
      return `${k}: ${truncated}`;
    })
    .join(", ");

  return entries.length > 2 ? `${preview}, ...` : preview;
}

// Search params type
type AgentSearchParams = {
  mode?: AgentMode;
};

export const Route = createFileRoute("/agent")({
  component: AgentComponent,
  validateSearch: (search: Record<string, unknown>): AgentSearchParams => {
    return {
      mode: search.mode === "specialized" || search.mode === "general"
        ? search.mode
        : undefined,
    };
  },
});

type ToolCall = {
  toolName: string;
  args?: unknown;
  toolCallId?: string;
};

type ToolResult = {
  toolName: string;
  result?: unknown;
  toolCallId?: string;
};

type Message = {
  id: string;
  role: "user" | "assistant";
  content: string;
  timestamp: Date;
  steps?: number;
  toolCalls?: ToolCall[];
  toolResults?: ToolResult[];
  isStreaming?: boolean;
};

// Stream event types from the server
type StreamEvent =
  | { type: "session"; sessionId: string; isNew: boolean }
  | { type: "step_start"; step: number }
  | { type: "tool_call"; toolName: string; args: unknown }
  | { type: "tool_result"; toolName: string; result: { type: string; content: string } }
  | { type: "text_delta"; delta: string }
  | { type: "step_finish"; step: number; finishReason?: string }
  | { type: "step_complete"; stepNumber: number }
  | { type: "finish"; text: string; steps: number }
  | { type: "done"; result: string }
  | { type: "error"; error: string };

function AgentComponent() {
  const search = useSearch({ from: "/agent" });
  const navigate = useNavigate({ from: "/agent" });
  const mode: AgentMode = search.mode || "general";
  const config = MODE_CONFIG[mode];

  const [messages, setMessages] = useState<Message[]>([]);
  const [input, setInput] = useState("");
  const [isStreaming, setIsStreaming] = useState(false);
  const [currentStep, setCurrentStep] = useState(0);
  const [expandedMessages, setExpandedMessages] = useState<Set<string>>(new Set());
  const [sessionId, setSessionId] = useState<string | null>(null);
  const messagesEndRef = useRef<HTMLDivElement>(null);
  const messagesContainerRef = useRef<HTMLDivElement>(null);
  const abortControllerRef = useRef<AbortController | null>(null);
  const userHasScrolledUp = useRef(false);

  const toggleMode = () => {
    const newMode = mode === "general" ? "specialized" : "general";
    void navigate({ search: { mode: newMode } });
    // Clear messages and session when switching modes
    setMessages([]);
    setSessionId(null);
  };

  const toggleExpanded = (messageId: string) => {
    setExpandedMessages((prev) => {
      const next = new Set(prev);
      if (next.has(messageId)) {
        next.delete(messageId);
      } else {
        next.add(messageId);
      }
      return next;
    });
  };

  const isAtBottom = useCallback(() => {
    const container = messagesContainerRef.current;
    if (!container) return true;
    const threshold = 100;
    return container.scrollHeight - container.scrollTop - container.clientHeight < threshold;
  }, []);

  const scrollToBottom = useCallback(() => {
    messagesEndRef.current?.scrollIntoView({ behavior: "smooth" });
  }, []);

  const handleScroll = useCallback(() => {
    // Only mark as scrolled up - never automatically re-enable during streaming
    // Auto-scroll only resets when a new message is sent
    if (!isAtBottom()) {
      userHasScrolledUp.current = true;
    }
  }, [isAtBottom]);

  useEffect(() => {
    // Only auto-scroll if user hasn't manually scrolled up
    if (!userHasScrolledUp.current) {
      scrollToBottom();
    }
  }, [messages, scrollToBottom]);

  const streamChat = useCallback(async (messageText: string) => {
    setIsStreaming(true);
    setCurrentStep(0);
    // Reset scroll behavior for new conversation
    userHasScrolledUp.current = false;

    const assistantMessageId = crypto.randomUUID();

    // Add initial empty assistant message
    setMessages((prev) => [
      ...prev,
      {
        id: assistantMessageId,
        role: "assistant",
        content: "",
        timestamp: new Date(),
        isStreaming: true,
        toolCalls: [],
        toolResults: [],
      },
    ]);

    // Auto-expand the new message to show tool activity
    setExpandedMessages((prev) => new Set(prev).add(assistantMessageId));

    try {
      abortControllerRef.current = new AbortController();

      const response = await fetch(`${SERVER_URL}/api/chat/stream`, {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
        },
        body: JSON.stringify({ message: messageText, mode, sessionId }),
        signal: abortControllerRef.current.signal,
      });

      if (!response.ok) {
        throw new Error(`HTTP error! status: ${response.status}`);
      }

      const reader = response.body?.getReader();
      if (!reader) throw new Error("No response body");

      const decoder = new TextDecoder();
      let buffer = "";

      while (true) {
        const { done, value } = await reader.read();
        if (done) break;

        buffer += decoder.decode(value, { stream: true });
        const lines = buffer.split("\n");
        buffer = lines.pop() || "";

        for (const line of lines) {
          if (line.startsWith("data: ")) {
            try {
              const eventData = JSON.parse(line.slice(6)) as StreamEvent;
              handleStreamEvent(assistantMessageId, eventData);
            } catch {
              // Ignore parse errors for malformed events
            }
          }
        }
      }
    } catch (error) {
      if ((error as Error).name === "AbortError") {
        // Request was cancelled
        return;
      }

      setMessages((prev) =>
        prev.map((msg) =>
          msg.id === assistantMessageId
            ? {
                ...msg,
                content: `Error: ${error instanceof Error ? error.message : "Failed to get response"}`,
                isStreaming: false,
              }
            : msg
        )
      );
    } finally {
      setIsStreaming(false);
      abortControllerRef.current = null;
    }
  }, [mode, sessionId]);

  const handleStreamEvent = (messageId: string, event: StreamEvent) => {
    switch (event.type) {
      case "session":
        // Store the session ID for conversation continuity
        setSessionId(event.sessionId);
        break;

      case "step_start":
        setCurrentStep(event.step);
        break;

      case "step_complete":
        setCurrentStep(event.stepNumber);
        break;

      case "tool_call":
        setMessages((prev) =>
          prev.map((msg) =>
            msg.id === messageId
              ? {
                  ...msg,
                  toolCalls: [
                    ...(msg.toolCalls || []),
                    { toolName: event.toolName, args: event.args },
                  ],
                }
              : msg
          )
        );
        break;

      case "tool_result":
        setMessages((prev) =>
          prev.map((msg) =>
            msg.id === messageId
              ? {
                  ...msg,
                  toolResults: [
                    ...(msg.toolResults || []),
                    { toolName: event.toolName, result: event.result },
                  ],
                }
              : msg
          )
        );
        break;

      case "text_delta":
        setMessages((prev) =>
          prev.map((msg) =>
            msg.id === messageId
              ? { ...msg, content: msg.content + event.delta }
              : msg
          )
        );
        break;

      case "finish":
        setMessages((prev) =>
          prev.map((msg) =>
            msg.id === messageId
              ? {
                  ...msg,
                  content: event.text || msg.content,
                  steps: event.steps,
                  isStreaming: false,
                }
              : msg
          )
        );
        break;

      case "done":
        setMessages((prev) =>
          prev.map((msg) =>
            msg.id === messageId
              ? {
                  ...msg,
                  content: event.result || msg.content,
                  isStreaming: false,
                }
              : msg
          )
        );
        break;

      case "error":
        setMessages((prev) =>
          prev.map((msg) =>
            msg.id === messageId
              ? {
                  ...msg,
                  content: `Error: ${event.error}`,
                  isStreaming: false,
                }
              : msg
          )
        );
        break;
    }
  };

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!input.trim() || isStreaming) return;

    const userMessage: Message = {
      id: crypto.randomUUID(),
      role: "user",
      content: input.trim(),
      timestamp: new Date(),
    };

    setMessages((prev) => [...prev, userMessage]);
    const messageText = input.trim();
    setInput("");

    await streamChat(messageText);
  };

  const handleKeyDown = (e: React.KeyboardEvent<HTMLTextAreaElement>) => {
    if (e.key === "Enter" && !e.shiftKey) {
      e.preventDefault();
      handleSubmit(e);
    }
  };

  const handleCancel = () => {
    abortControllerRef.current?.abort();
    setIsStreaming(false);
  };

  const ModeIcon = config.icon;

  return (
    <div className="flex h-[calc(100vh-6rem)] flex-col">
      <div className="mb-4 border-b pb-4">
        <div className="flex items-center justify-between">
          <div>
            <AgentTitle />
            <p className="mt-2 text-sm text-muted-foreground">
              Chat with the Grok-powered data analyst. Ask questions about your data.
            </p>
          </div>

          {/* Mode Toggle */}
          <button
            type="button"
            onClick={toggleMode}
            disabled={isStreaming}
            className="flex items-center gap-2 px-3 py-2 rounded-lg border bg-card hover:bg-accent transition-colors disabled:opacity-50"
          >
            <div className={`w-2 h-2 rounded-full ${config.color}`} />
            <ModeIcon className="h-4 w-4" />
            <div className="text-left">
              <div className="text-sm font-medium">{config.label}</div>
              <div className="text-[10px] text-muted-foreground">{config.description}</div>
            </div>
          </button>
        </div>
      </div>

      {/* Messages area */}
      <div
        ref={messagesContainerRef}
        onScroll={handleScroll}
        className="flex-1 overflow-y-auto rounded-lg border bg-muted/30 p-4"
      >
        {messages.length === 0 ? (
          <div className="flex h-full items-center justify-center">
            <div className="text-center max-w-md">
              <Bot className="mx-auto mb-4 h-12 w-12 text-muted-foreground" />
              <h3 className="mb-2 text-lg font-medium">Start a conversation</h3>
              <p className="text-sm text-muted-foreground mb-4">
                Ask questions about your data. The agent can explore data sources,
                run SQL queries, and analyze metrics.
              </p>
              <div className="text-xs text-muted-foreground mb-4 p-2 bg-muted/50 rounded">
                Mode: <span className="font-medium">{config.label}</span> ({config.description})
                <br />
                <span className="text-[10px]">Click toggle above to switch • Open another tab for side-by-side</span>
              </div>
              <div className="flex flex-wrap gap-2 justify-center">
                <Button
                  variant="outline"
                  size="sm"
                  onClick={() => setInput("What data sources are available?")}
                >
                  Explore data sources
                </Button>
                <Button
                  variant="outline"
                  size="sm"
                  onClick={() => setInput("Show me total revenue by region")}
                >
                  Revenue by region
                </Button>
                <Button
                  variant="outline"
                  size="sm"
                  onClick={() => setInput("What metrics can I analyze?")}
                >
                  Available metrics
                </Button>
              </div>
            </div>
          </div>
        ) : (
          <div className="space-y-4">
            {messages.map((message) => (
              <div
                key={message.id}
                className={`flex gap-3 ${
                  message.role === "user" ? "justify-end" : "justify-start"
                }`}
              >
                <div
                  className={`max-w-[80%] px-4 py-2 ${
                    message.role === "user"
                      ? "bg-primary text-primary-foreground"
                      : "bg-background border"
                  }`}
                >
                  {message.role === "assistant" && message.isStreaming && !message.content ? (
                    <div className="flex items-center gap-2">
                      <Loader2 className="h-4 w-4 animate-spin" />
                      <span className="text-sm text-muted-foreground">
                        {currentStep > 0 ? `Step ${currentStep}...` : "Thinking..."}
                      </span>
                    </div>
                  ) : message.role === "assistant" ? (
                    <div className="prose prose-sm dark:prose-invert max-w-none prose-p:my-2 prose-headings:my-3 prose-ul:my-2 prose-ol:my-2 prose-li:my-0 prose-pre:my-2 prose-pre:bg-muted prose-pre:text-foreground prose-code:before:content-none prose-code:after:content-none prose-code:bg-muted prose-code:text-foreground prose-code:px-1 prose-code:py-0.5 prose-code:rounded prose-table:w-full prose-table:border-collapse prose-table:my-4 prose-th:border prose-th:border-border prose-th:bg-muted prose-th:px-3 prose-th:py-2 prose-th:text-left prose-th:font-semibold prose-td:border prose-td:border-border prose-td:px-3 prose-td:py-2">
                      <Markdown remarkPlugins={[remarkGfm]}>{message.content}</Markdown>
                    </div>
                  ) : (
                    <p className="whitespace-pre-wrap">{message.content}</p>
                  )}
                  {message.isStreaming && message.content && (
                    <span className="inline-block w-2 h-4 ml-0.5 bg-primary animate-pulse" />
                  )}
                  <div
                    className={`mt-1 flex items-center gap-2 text-xs ${
                      message.role === "user"
                        ? "text-primary-foreground/70"
                        : "text-muted-foreground"
                    }`}
                  >
                    <span>{message.timestamp.toLocaleTimeString()}</span>
                    {message.steps !== undefined && (
                      <span>• {message.steps} steps</span>
                    )}
                    {message.isStreaming && currentStep > 0 && (
                      <span>• Step {currentStep}</span>
                    )}
                    {((message.toolCalls && message.toolCalls.length > 0) ||
                      (message.toolResults && message.toolResults.length > 0)) && (
                      <button
                        type="button"
                        onClick={() => toggleExpanded(message.id)}
                        className="flex items-center gap-1 hover:text-foreground transition-colors"
                      >
                        <Wrench className="h-3 w-3" />
                        <span>
                          {message.toolCalls?.length || 0} tool
                          {(message.toolCalls?.length || 0) !== 1 ? "s" : ""}
                        </span>
                        {expandedMessages.has(message.id) ? (
                          <ChevronUp className="h-3 w-3" />
                        ) : (
                          <ChevronDown className="h-3 w-3" />
                        )}
                      </button>
                    )}
                  </div>

                  {/* Tool calls and results */}
                  {expandedMessages.has(message.id) &&
                    message.toolCalls &&
                    message.toolCalls.length > 0 && (
                      <div className="mt-3 border-t pt-3">
                        <div className="space-y-1.5">
                          {message.toolCalls.map((call, idx) => {
                            const matchingResult = message.toolResults?.[idx];
                            const isLatestAndPending =
                              message.isStreaming &&
                              idx === (message.toolCalls?.length || 0) - 1 &&
                              !matchingResult;
                            const parsedOutput = matchingResult
                              ? parseToolOutput(matchingResult.result)
                              : null;

                            return (
                              <ToolCallItem
                                key={`${call.toolName}-${idx}`}
                                toolName={call.toolName}
                                args={call.args}
                                result={parsedOutput}
                                isPending={isLatestAndPending ?? false}
                              />
                            );
                          })}
                        </div>
                      </div>
                    )}
                </div>
              </div>
            ))}
            <div ref={messagesEndRef} />
          </div>
        )}
      </div>

      {/* Input area */}
      <form onSubmit={handleSubmit} className="mt-4">
        <div className="flex gap-2">
          <Textarea
            value={input}
            onChange={(e) => setInput(e.target.value)}
            onKeyDown={handleKeyDown}
            placeholder="Ask about your data... (Press Enter to send, Shift+Enter for new line)"
            className="min-h-[60px] resize-none"
            disabled={isStreaming}
          />
          {isStreaming ? (
            <Button
              type="button"
              size="icon"
              variant="destructive"
              className="h-[60px] w-[60px]"
              onClick={handleCancel}
            >
              <span className="sr-only">Cancel</span>
              <svg
                xmlns="http://www.w3.org/2000/svg"
                viewBox="0 0 24 24"
                fill="currentColor"
                className="h-4 w-4"
              >
                <rect x="6" y="6" width="12" height="12" rx="1" />
              </svg>
            </Button>
          ) : (
            <Button
              type="submit"
              size="icon"
              className="h-[60px] w-[60px]"
              disabled={!input.trim()}
            >
              <Send className="h-4 w-4" />
            </Button>
          )}
        </div>
      </form>
    </div>
  );
}
