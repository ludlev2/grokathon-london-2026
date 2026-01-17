import { createFileRoute, useNavigate } from "@tanstack/react-router";
import { useMutation } from "@tanstack/react-query";
import { useState } from "react";
import { ArrowLeft, Loader2, Key, Lock } from "lucide-react";
import { toast } from "sonner";

import { Button, buttonVariants } from "@/components/ui/button";
import { cn } from "@/lib/utils";
import { Input } from "@/components/ui/input";
import { Textarea } from "@/components/ui/textarea";
import { Label } from "@/components/ui/label";
import {
  Card,
  CardHeader,
  CardTitle,
  CardDescription,
  CardContent,
} from "@/components/ui/card";
import { queryClient, trpc } from "@/utils/trpc";

export const Route = createFileRoute("/integrations/create")({
  component: CreateConnectionPage,
});

type AuthMethod = "key_pair" | "password";

function CreateConnectionPage() {
  const navigate = useNavigate();

  // Form state
  const [name, setName] = useState("");
  const [account, setAccount] = useState("");
  const [username, setUsername] = useState("");
  const [warehouse, setWarehouse] = useState("");
  const [database, setDatabase] = useState("");
  const [schema, setSchema] = useState("");
  const [role, setRole] = useState("");
  const [authMethod, setAuthMethod] = useState<AuthMethod>("key_pair");
  const [privateKey, setPrivateKey] = useState("");
  const [privateKeyPassphrase, setPrivateKeyPassphrase] = useState("");
  const [password, setPassword] = useState("");

  const createMutation = useMutation(
    trpc.snowflake.create.mutationOptions({
      onSuccess: (data) => {
        toast.success(`Connection "${data.name}" created`);
        void queryClient.invalidateQueries({ queryKey: ["snowflake", "list"] });
        void navigate({ to: "/integrations" });
      },
      onError: (error) => {
        toast.error(`Failed to create connection: ${error.message}`);
      },
    })
  );

  const handleSubmit = (e: React.FormEvent) => {
    e.preventDefault();

    // Basic validation
    if (!name.trim()) {
      toast.error("Name is required");
      return;
    }
    if (!account.trim()) {
      toast.error("Account is required");
      return;
    }
    if (!username.trim()) {
      toast.error("Username is required");
      return;
    }
    if (!warehouse.trim()) {
      toast.error("Warehouse is required");
      return;
    }
    if (!database.trim()) {
      toast.error("Database is required");
      return;
    }
    if (!schema.trim()) {
      toast.error("Schema is required");
      return;
    }

    if (authMethod === "key_pair" && !privateKey.trim()) {
      toast.error("Private key is required for key pair authentication");
      return;
    }

    if (authMethod === "password" && !password.trim()) {
      toast.error("Password is required for password authentication");
      return;
    }

    const credential =
      authMethod === "key_pair"
        ? {
            authMethod: "key_pair" as const,
            privateKey: privateKey.trim(),
            ...(privateKeyPassphrase.trim()
              ? { privateKeyPassphrase: privateKeyPassphrase.trim() }
              : {}),
          }
        : {
            authMethod: "password" as const,
            password: password.trim(),
          };

    createMutation.mutate({
      name: name.trim(),
      config: {
        account: account.trim(),
        username: username.trim(),
        warehouse: warehouse.trim(),
        database: database.trim(),
        schema: schema.trim(),
        ...(role.trim() ? { role: role.trim() } : {}),
      },
      credential,
    });
  };

  return (
    <div className="flex flex-col gap-6 p-6">
      <div className="flex items-center gap-4">
        <a
          href="/integrations"
          className={cn(buttonVariants({ variant: "ghost", size: "icon-sm" }))}
        >
          <ArrowLeft />
        </a>
        <div>
          <h1 className="text-lg font-semibold">New Snowflake Connection</h1>
          <p className="text-sm text-muted-foreground">
            Configure your Snowflake data warehouse connection
          </p>
        </div>
      </div>

      <form onSubmit={handleSubmit} className="grid gap-6 max-w-2xl">
        <Card>
          <CardHeader>
            <CardTitle>Connection Details</CardTitle>
            <CardDescription>
              Give your connection a name to identify it
            </CardDescription>
          </CardHeader>
          <CardContent className="space-y-4">
            <div className="space-y-2">
              <Label htmlFor="name">Connection Name</Label>
              <Input
                id="name"
                placeholder="e.g., Production Snowflake"
                value={name}
                onChange={(e) => setName(e.target.value)}
                required
              />
            </div>
          </CardContent>
        </Card>

        <Card>
          <CardHeader>
            <CardTitle>Snowflake Configuration</CardTitle>
            <CardDescription>
              Enter your Snowflake account details
            </CardDescription>
          </CardHeader>
          <CardContent className="space-y-4">
            <div className="grid gap-4 sm:grid-cols-2">
              <div className="space-y-2">
                <Label htmlFor="account">Account</Label>
                <Input
                  id="account"
                  placeholder="e.g., abc12345.us-east-1"
                  value={account}
                  onChange={(e) => setAccount(e.target.value)}
                  required
                />
              </div>
              <div className="space-y-2">
                <Label htmlFor="username">Username</Label>
                <Input
                  id="username"
                  placeholder="e.g., ADMIN"
                  value={username}
                  onChange={(e) => setUsername(e.target.value)}
                  required
                />
              </div>
            </div>
            <div className="grid gap-4 sm:grid-cols-2">
              <div className="space-y-2">
                <Label htmlFor="warehouse">Warehouse</Label>
                <Input
                  id="warehouse"
                  placeholder="e.g., COMPUTE_WH"
                  value={warehouse}
                  onChange={(e) => setWarehouse(e.target.value)}
                  required
                />
              </div>
              <div className="space-y-2">
                <Label htmlFor="role">Role (optional)</Label>
                <Input
                  id="role"
                  placeholder="e.g., ACCOUNTADMIN"
                  value={role}
                  onChange={(e) => setRole(e.target.value)}
                />
              </div>
            </div>
            <div className="grid gap-4 sm:grid-cols-2">
              <div className="space-y-2">
                <Label htmlFor="database">Database</Label>
                <Input
                  id="database"
                  placeholder="e.g., ANALYTICS"
                  value={database}
                  onChange={(e) => setDatabase(e.target.value)}
                  required
                />
              </div>
              <div className="space-y-2">
                <Label htmlFor="schema">Schema</Label>
                <Input
                  id="schema"
                  placeholder="e.g., PUBLIC"
                  value={schema}
                  onChange={(e) => setSchema(e.target.value)}
                  required
                />
              </div>
            </div>
          </CardContent>
        </Card>

        <Card>
          <CardHeader>
            <CardTitle>Authentication</CardTitle>
            <CardDescription>
              Choose how to authenticate with Snowflake
            </CardDescription>
          </CardHeader>
          <CardContent className="space-y-4">
            <div className="flex gap-2">
              <Button
                type="button"
                variant={authMethod === "key_pair" ? "default" : "outline"}
                onClick={() => setAuthMethod("key_pair")}
              >
                <Key data-icon="inline-start" />
                Key Pair
              </Button>
              <Button
                type="button"
                variant={authMethod === "password" ? "default" : "outline"}
                onClick={() => setAuthMethod("password")}
              >
                <Lock data-icon="inline-start" />
                Password
              </Button>
            </div>

            {authMethod === "key_pair" ? (
              <div className="space-y-4">
                <div className="space-y-2">
                  <Label htmlFor="privateKey">Private Key (PEM format)</Label>
                  <Textarea
                    id="privateKey"
                    placeholder="-----BEGIN PRIVATE KEY-----
...
-----END PRIVATE KEY-----"
                    value={privateKey}
                    onChange={(e) => setPrivateKey(e.target.value)}
                    rows={8}
                    className="font-mono text-xs"
                    required
                  />
                </div>
                <div className="space-y-2">
                  <Label htmlFor="passphrase">
                    Private Key Passphrase (optional)
                  </Label>
                  <Input
                    id="passphrase"
                    type="password"
                    placeholder="Enter if your key is encrypted"
                    value={privateKeyPassphrase}
                    onChange={(e) => setPrivateKeyPassphrase(e.target.value)}
                  />
                </div>
              </div>
            ) : (
              <div className="space-y-2">
                <Label htmlFor="password">Password</Label>
                <Input
                  id="password"
                  type="password"
                  placeholder="Enter your Snowflake password"
                  value={password}
                  onChange={(e) => setPassword(e.target.value)}
                  required
                />
              </div>
            )}
          </CardContent>
        </Card>

        <div className="flex gap-2">
          <Button type="submit" disabled={createMutation.isPending}>
            {createMutation.isPending ? (
              <>
                <Loader2 className="animate-spin" data-icon="inline-start" />
                Creating...
              </>
            ) : (
              "Create Connection"
            )}
          </Button>
          <a
            href="/integrations"
            className={cn(buttonVariants({ variant: "outline" }))}
          >
            Cancel
          </a>
        </div>
      </form>
    </div>
  );
}
