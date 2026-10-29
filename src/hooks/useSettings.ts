import { useCallback, useEffect, useState } from "react";
import { setHttpTransportPort, systemApi } from "@/api";
import type { ConfigResponse, HealthResponse } from "@/types";

export function useSettings() {
  const [config, setConfig] = useState<ConfigResponse | null>(null);
  const [health, setHealth] = useState<HealthResponse | null>(null);
  const [apiPort, setApiPort] = useState("");

  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [success, setSuccess] = useState<string | null>(null);

  const refresh = useCallback(async () => {
    const [configResult, healthResult] = await Promise.allSettled([
      systemApi.getConfig(),
      systemApi.health(),
    ]);

    setError(null);
    if (configResult.status === "fulfilled") {
      setConfig(configResult.value);
      setApiPort(String(configResult.value.api_port));

      setHttpTransportPort(configResult.value.api_port);
    } else {
      setError("Could not load application configuration.");
    }

    setHealth(healthResult.status === "fulfilled" ? healthResult.value : null);

    setLoading(false);
  }, []);

  useEffect(() => {
    void refresh();
  }, [refresh]);

  const save = useCallback(async () => {
    const port = Number(apiPort);

    if (
      apiPort.trim() === "" ||
      !Number.isInteger(port) ||
      port < 1 ||
      port > 65535
    ) {
      setError("Enter a valid port between 1 and 65535.");
      setSuccess(null);
      return;
    }

    if (config?.api_port === port) {
      setError(null);
      setSuccess("No changes to save.");
      return;
    }

    setSaving(true);
    setError(null);
    setSuccess(null);

    try {
      const updated = await systemApi.updateConfig({
        api_port: port,
      });

      setConfig(updated);
      setApiPort(String(updated.api_port));

      const transportUpdated = setHttpTransportPort(updated.api_port);

      setSuccess(
        transportUpdated
          ? "Configuration and HTTP transport port updated."
          : "Backend configuration saved. Tauri uses its native transport, so no HTTP port was changed.",
      );
    } catch (err) {
      setError(
        err instanceof Error ? err.message : "Could not save configuration.",
      );
    } finally {
      setSaving(false);
    }
  }, [apiPort, config]);

  return {
    config,
    health,
    apiPort,
    setApiPort,
    loading,
    saving,
    error,
    success,
    save,
    refresh,
  };
}
