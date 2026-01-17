import { useState, useRef, useEffect } from "react";
import { createFileRoute } from "@tanstack/react-router";
import { useMutation } from "@tanstack/react-query";
import { Bot, Send, User, Loader2, ChevronDown, ChevronUp, Wrench } from "lucide-react";

import { Button } from "@/components/ui/button";
import { Textarea } from "@/components/ui/textarea";
import { trpc } from "@/utils/trpc";

export const Route = createFileRoute("/agent")({
  component: AgentComponent,
});

type ToolCall = {
  toolName: string;
  args?: unknown;
  toolCallId: string;
};

type ToolResult = {
  toolName: string;
  result?: unknown;
  toolCallId: string;
};

type Message = {
  id: string;
  role: "user" | "assistant";
  content: string;
  timestamp: Date;
  steps?: number;
  toolCalls?: ToolCall[];
  toolResults?: ToolResult[];
};

function AgentComponent() {
  const [messages, setMessages] = useState<Message[]>([]);
  const [input, setInput] = useState("");
  const [expandedMessages, setExpandedMessages] = useState<Set<string>>(new Set());
  const messagesEndRef = useRef<HTMLDivElement>(null);

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

  const chatMutation = useMutation(trpc.agent.chat.mutationOptions());

  const scrollToBottom = () => {
    messagesEndRef.current?.scrollIntoView({ behavior: "smooth" });
  };

  useEffect(() => {
    scrollToBottom();
  }, [messages]);

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!input.trim() || chatMutation.isPending) return;

    const userMessage: Message = {
      id: crypto.randomUUID(),
      role: "user",
      content: input.trim(),
      timestamp: new Date(),
    };

    setMessages((prev) => [...prev, userMessage]);
    const messageText = input.trim();
    setInput("");

    try {
      const response = await chatMutation.mutateAsync({ message: messageText });

      const assistantMessage: Message = {
        id: crypto.randomUUID(),
        role: "assistant",
        content: response.response,
        timestamp: new Date(),
        steps: response.steps,
        toolCalls: response.toolCalls,
        toolResults: response.toolResults,
      };
      setMessages((prev) => [...prev, assistantMessage]);
    } catch (error) {
      const errorMessage: Message = {
        id: crypto.randomUUID(),
        role: "assistant",
        content: `Error: ${error instanceof Error ? error.message : "Failed to get response"}`,
        timestamp: new Date(),
      };
      setMessages((prev) => [...prev, errorMessage]);
    }
  };

  const handleKeyDown = (e: React.KeyboardEvent<HTMLTextAreaElement>) => {
    if (e.key === "Enter" && !e.shiftKey) {
      e.preventDefault();
      handleSubmit(e);
    }
  };

  return (
    <div className="flex h-[calc(100vh-6rem)] flex-col">
      <div className="mb-4 border-b pb-4">
        <h1 className="text-2xl font-bold">AI Agent</h1>
        <p className="text-sm text-muted-foreground">
          Chat with the grok-4-fast-reasoning powered agent
        </p>
      </div>

      {/* Messages area */}
      <div className="flex-1 overflow-y-auto rounded-lg border bg-muted/30 p-4">
        {messages.length === 0 ? (
          <div className="flex h-full items-center justify-center">
            <div className="text-center">
              <Bot className="mx-auto mb-4 h-12 w-12 text-muted-foreground" />
              <h3 className="mb-2 text-lg font-medium">Start a conversation</h3>
              <p className="text-sm text-muted-foreground">
                Ask the agent anything. It has access to weather and calculator
                tools.
              </p>
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
                {message.role === "assistant" && (
                  <div className="flex h-8 w-8 shrink-0 items-center justify-center rounded-full bg-primary text-primary-foreground">
                    <Bot className="h-4 w-4" />
                  </div>
                )}
                <div
                  className={`max-w-[80%] rounded-lg px-4 py-2 ${
                    message.role === "user"
                      ? "bg-primary text-primary-foreground"
                      : "bg-background border"
                  }`}
                >
                  <p className="whitespace-pre-wrap">{message.content}</p>
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
                    {message.toolCalls && message.toolCalls.length > 0 && (
                      <button
                        type="button"
                        onClick={() => toggleExpanded(message.id)}
                        className="flex items-center gap-1 hover:text-foreground transition-colors"
                      >
                        <Wrench className="h-3 w-3" />
                        <span>{message.toolCalls.length} tool calls</span>
                        {expandedMessages.has(message.id) ? (
                          <ChevronUp className="h-3 w-3" />
                        ) : (
                          <ChevronDown className="h-3 w-3" />
                        )}
                      </button>
                    )}
                  </div>

                  {/* Tool calls and results */}
                  {expandedMessages.has(message.id) && message.toolCalls && (
                    <div className="mt-3 space-y-2 border-t pt-3">
                      <h4 className="text-xs font-medium text-muted-foreground">Tool Activity</h4>
                      {message.toolCalls.map((call, idx) => {
                        const matchingResult = message.toolResults?.find(
                          (r) => r.toolCallId === call.toolCallId
                        );
                        return (
                          <div
                            key={call.toolCallId}
                            className="rounded border bg-muted/50 p-2 text-xs"
                          >
                            <div className="flex items-center gap-2">
                              <span className="font-mono font-semibold text-primary">
                                {call.toolName}
                              </span>
                              <span className="text-muted-foreground">#{idx + 1}</span>
                            </div>
                            <div className="mt-1">
                              <span className="text-muted-foreground">Input: </span>
                              <code className="break-all font-mono text-xs">
                                {JSON.stringify(call.args, null, 2)}
                              </code>
                            </div>
                            {matchingResult && (
                              <div className="mt-1">
                                <span className="text-muted-foreground">Output: </span>
                                <code className="break-all font-mono text-xs">
                                  {JSON.stringify(matchingResult.result, null, 2)}
                                </code>
                              </div>
                            )}
                          </div>
                        );
                      })}
                    </div>
                  )}
                </div>
                {message.role === "user" && (
                  <div className="flex h-8 w-8 shrink-0 items-center justify-center rounded-full bg-muted">
                    <User className="h-4 w-4" />
                  </div>
                )}
              </div>
            ))}
            {chatMutation.isPending && (
              <div className="flex gap-3">
                <div className="flex h-8 w-8 shrink-0 items-center justify-center rounded-full bg-primary text-primary-foreground">
                  <Bot className="h-4 w-4" />
                </div>
                <div className="flex items-center gap-2 rounded-lg border bg-background px-4 py-2">
                  <Loader2 className="h-4 w-4 animate-spin" />
                  <span className="text-sm text-muted-foreground">
                    Thinking...
                  </span>
                </div>
              </div>
            )}
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
            placeholder="Type your message... (Press Enter to send, Shift+Enter for new line)"
            className="min-h-[60px] resize-none"
            disabled={chatMutation.isPending}
          />
          <Button
            type="submit"
            size="icon"
            className="h-[60px] w-[60px]"
            disabled={!input.trim() || chatMutation.isPending}
          >
            {chatMutation.isPending ? (
              <Loader2 className="h-4 w-4 animate-spin" />
            ) : (
              <Send className="h-4 w-4" />
            )}
          </Button>
        </div>
      </form>
    </div>
  );
}
