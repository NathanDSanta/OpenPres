import { useCallback, useEffect, useState } from "react";
import { setHttpTransportPort, systemApi } from "@/api";
import type { ConfigResponse, GroupStyle, HealthResponse } from "@/types";

export function useSettings() {
  const [config, setConfig] = useState<ConfigResponse | null>(null);
  const [health, setHealth] = useState<HealthResponse | null>(null);
  const [groupStyles, setGroupStyles] = useState<GroupStyle[]>([]);
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
      setGroupStyles(configResult.value.group_styles ?? []);

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
      port < 1024 ||
      port > 65535
    ) {
      setError("Enter a valid port between 1024 and 65535.");
      setSuccess(null);
      return;
    }

    const names = groupStyles.map((style) => style.name.trim());
    if (names.some((name) => !name)) {
      setError("Group names cannot be empty.");
      setSuccess(null);
      return;
    }

    if (new Set(names.map((name) => name.toLowerCase())).size !== names.length) {
      setError("Group names must be unique.");
      setSuccess(null);
      return;
    }

    setSaving(true);
    setError(null);
    setSuccess(null);

    try {
      const updated = await systemApi.updateConfig({
        api_port: port,
        group_styles: groupStyles.map((style) => ({
          ...style,
          name: style.name.trim(),
        })),
      });

      setConfig(updated);
      setApiPort(String(updated.api_port));
      setGroupStyles(updated.group_styles ?? []);

      const transportUpdated = setHttpTransportPort(updated.api_port);
      const portChanged = config?.api_port !== updated.api_port;

      setSuccess(
        portChanged && !transportUpdated
          ? "Group styles saved. Tauri uses its native transport, so no HTTP port was changed."
          : "Settings saved successfully.",
      );
    } catch (err) {
      setError(
        err instanceof Error ? err.message : "Could not save settings.",
      );
    } finally {
      setSaving(false);
    }
  }, [apiPort, config?.api_port, groupStyles]);

  const addGroupStyle = () => {
    setGroupStyles((current) => {
      let name = "New group";
      let suffix = 2;

      while (current.some((style) => style.name.toLowerCase() === name.toLowerCase())) {
        name = `New group ${suffix}`;
        suffix += 1;
      }

      return [...current, { name, color: "#a78bfa" }];
    });
  };

  const updateGroupStyle = (index: number, updates: Partial<GroupStyle>) => {
    setGroupStyles((current) =>
      current.map((style, i) =>
        i === index ? { ...style, ...updates } : style,
      ),
    );
  };

  const duplicateGroupStyle = (index: number) => {
    setGroupStyles((current) => {
      const original = current[index];
      if (!original) return current;

      const baseName = `${original.name.trim() || "Group"} copy`;
      let name = baseName;
      let suffix = 2;
      while (current.some((style) => style.name.toLowerCase() === name.toLowerCase())) {
        name = `${baseName} ${suffix}`;
        suffix += 1;
      }

      const next = [...current];
      next.splice(index + 1, 0, { ...original, name });
      return next;
    });
  };

  const reorderGroupStyle = (fromIndex: number, toIndex: number) => {
    setGroupStyles((current) => {
      if (
        fromIndex < 0 ||
        toIndex < 0 ||
        fromIndex >= current.length ||
        toIndex >= current.length ||
        fromIndex === toIndex
      ) {
        return current;
      }

      const next = [...current];
      const [moved] = next.splice(fromIndex, 1);
      next.splice(toIndex, 0, moved);
      return next;
    });
  };

  const deleteGroupStyle = (index: number) => {
    setGroupStyles((current) => current.filter((_, i) => i !== index));
  };

  return {
    config,
    health,
    apiPort,
    groupStyles,
    addGroupStyle,
    duplicateGroupStyle,
    reorderGroupStyle,
    updateGroupStyle,
    deleteGroupStyle,
    setApiPort,
    loading,
    saving,
    error,
    success,
    save,
    refresh,
  };
}
