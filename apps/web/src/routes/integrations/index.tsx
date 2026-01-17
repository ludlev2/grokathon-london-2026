import { createFileRoute } from "@tanstack/react-router";
import { useMutation, useQuery } from "@tanstack/react-query";
import {
  CheckCircle,
  Clock,
  XCircle,
  Plus,
  Trash2,
  Snowflake,
  Loader2,
} from "lucide-react";
import { toast } from "sonner";

import { Button, buttonVariants } from "@/components/ui/button";
import {
  Card,
  CardHeader,
  CardTitle,
  CardDescription,
  CardContent,
  CardFooter,
  CardAction,
} from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Skeleton } from "@/components/ui/skeleton";
import { queryClient, trpc } from "@/utils/trpc";
import { cn } from "@/lib/utils";

export const Route = createFileRoute("/integrations/")({
  component: IntegrationsPage,
});

const statusConfig = {
  active: { icon: CheckCircle, variant: "default" as const, label: "Active" },
  pending: { icon: Clock, variant: "secondary" as const, label: "Pending" },
  error: { icon: XCircle, variant: "destructive" as const, label: "Error" },
} as const;

function IntegrationsPage() {
  const connectionsQuery = useQuery(trpc.snowflake.list.queryOptions());

  const testConnectionMutation = useMutation(
    trpc.snowflake.testConnection.mutationOptions({
      onSuccess: (data) => {
        if (data.success) {
          toast.success(`Connection successful (${data.latencyMs}ms)`);
        } else {
          toast.error(`Connection failed: ${data.message}`);
        }
        void queryClient.invalidateQueries({ queryKey: ["snowflake", "list"] });
      },
      onError: (error) => {
        toast.error(`Test failed: ${error.message}`);
      },
    })
  );

  const deleteConnectionMutation = useMutation(
    trpc.snowflake.delete.mutationOptions({
      onSuccess: () => {
        toast.success("Connection deleted");
        void queryClient.invalidateQueries({ queryKey: ["snowflake", "list"] });
      },
      onError: (error) => {
        toast.error(`Delete failed: ${error.message}`);
      },
    })
  );

  const handleTestConnection = (id: string) => {
    testConnectionMutation.mutate({ id });
  };

  const handleDeleteConnection = (id: string, name: string) => {
    if (confirm(`Are you sure you want to delete "${name}"?`)) {
      deleteConnectionMutation.mutate({ id });
    }
  };

  return (
    <div className="flex flex-col gap-6 p-6">
      <div className="flex items-center justify-between">
        <div>
          <h1 className="text-lg font-semibold">Integrations</h1>
          <p className="text-sm text-muted-foreground">
            Manage your data warehouse connections
          </p>
        </div>
        <a href="/integrations/create" className={cn(buttonVariants())}>
          <Plus data-icon="inline-start" />
          New Connection
        </a>
      </div>

      {connectionsQuery.isLoading ? (
        <div className="grid gap-4 md:grid-cols-2 lg:grid-cols-3">
          {[1, 2, 3].map((i) => (
            <Card key={i}>
              <CardHeader>
                <Skeleton className="h-5 w-32" />
                <Skeleton className="h-4 w-48" />
              </CardHeader>
              <CardContent>
                <Skeleton className="h-4 w-full" />
                <Skeleton className="mt-2 h-4 w-24" />
              </CardContent>
              <CardFooter>
                <Skeleton className="h-8 w-24" />
              </CardFooter>
            </Card>
          ))}
        </div>
      ) : connectionsQuery.data?.length === 0 ? (
        <Card className="py-12">
          <CardContent className="flex flex-col items-center justify-center gap-4 text-center">
            <Snowflake className="size-12 text-muted-foreground" />
            <div>
              <h3 className="text-sm font-medium">No connections</h3>
              <p className="text-sm text-muted-foreground">
                Get started by creating your first Snowflake connection.
              </p>
            </div>
            <a href="/integrations/create" className={cn(buttonVariants())}>
              <Plus data-icon="inline-start" />
              New Connection
            </a>
          </CardContent>
        </Card>
      ) : (
        <div className="grid gap-4 md:grid-cols-2 lg:grid-cols-3">
          {connectionsQuery.data?.map((connection) => {
            const status = statusConfig[connection.status] ?? statusConfig.pending;
            const StatusIcon = status.icon;
            const isTestingThis =
              testConnectionMutation.isPending &&
              testConnectionMutation.variables?.id === connection.id;

            return (
              <Card key={connection.id}>
                <CardHeader>
                  <div className="flex items-center gap-2">
                    <Snowflake className="size-5 text-blue-500" />
                    <CardTitle>{connection.name}</CardTitle>
                  </div>
                  <CardAction>
                    <Badge variant={status.variant}>
                      <StatusIcon className="size-3" data-icon="inline-start" />
                      {status.label}
                    </Badge>
                  </CardAction>
                  <CardDescription>
                    {connection.database}.{connection.schema}
                  </CardDescription>
                </CardHeader>
                <CardContent className="space-y-2 text-sm">
                  <div className="flex justify-between">
                    <span className="text-muted-foreground">Account</span>
                    <span className="font-mono">{connection.account}</span>
                  </div>
                  <div className="flex justify-between">
                    <span className="text-muted-foreground">Warehouse</span>
                    <span className="font-mono">{connection.warehouse}</span>
                  </div>
                  <div className="flex justify-between">
                    <span className="text-muted-foreground">Auth</span>
                    <span>
                      {connection.authMethod === "key_pair"
                        ? "Key Pair"
                        : "Password"}
                    </span>
                  </div>
                  {connection.lastTestedAt && (
                    <div className="flex justify-between">
                      <span className="text-muted-foreground">Last Tested</span>
                      <span>
                        {new Date(connection.lastTestedAt).toLocaleDateString()}
                      </span>
                    </div>
                  )}
                </CardContent>
                <CardFooter className="gap-2">
                  <Button
                    variant="outline"
                    size="sm"
                    onClick={() => handleTestConnection(connection.id)}
                    disabled={isTestingThis}
                  >
                    {isTestingThis ? (
                      <>
                        <Loader2
                          className="animate-spin"
                          data-icon="inline-start"
                        />
                        Testing...
                      </>
                    ) : (
                      "Test Connection"
                    )}
                  </Button>
                  <Button
                    variant="ghost"
                    size="icon-sm"
                    onClick={() =>
                      handleDeleteConnection(connection.id, connection.name)
                    }
                    disabled={deleteConnectionMutation.isPending}
                  >
                    <Trash2 className="size-4 text-destructive" />
                  </Button>
                </CardFooter>
              </Card>
            );
          })}
        </div>
      )}
    </div>
  );
}
