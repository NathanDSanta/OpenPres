import { useCallback, useEffect, useMemo, useState } from "react";
import { libraryApi, systemApi } from "@/api";
import type {
  Arrangement,
  FlatSlide,
  GroupStyle,
  Presentation,
  SlidesResponse,
} from "@/types";

export type DragPayload =
  { type: "available"; group: string } | { type: "ordered"; index: number };

export function useArrangementEditor(presentation: Presentation) {
  const [arrangements, setArrangements] = useState<Arrangement[]>([]);
  const [presentationData, setPresentationData] = useState(presentation);
  const [groupStyles, setGroupStyles] = useState<GroupStyle[]>([]);
  const [selectedArrangement, setSelectedArrangement] = useState("");
  const [slidesResponse, setSlidesResponse] = useState<SlidesResponse | null>(
    null,
  );

  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const currentArrangement = arrangements.find(
    (item) => item.name === selectedArrangement,
  );

  const order = currentArrangement?.order ?? [];

  const availableGroups = useMemo(
    () => presentationData.groups.map((group) => group.name),
    [presentationData.groups],
  );

  const loadArrangements = useCallback(async () => {
    try {
      setLoading(true);
      setError(null);

      const result = await libraryApi.listArrangements(presentation.id);

      setArrangements(result);

      setSelectedArrangement((current) =>
        result.some((item) => item.name === current)
          ? current
          : (result[0]?.name ?? ""),
      );
    } catch (err) {
      setError(
        err instanceof Error ? err.message : "Could not load arrangements.",
      );
    } finally {
      setLoading(false);
    }
  }, [presentation.id]);

  useEffect(() => {
    void loadArrangements();
  }, [loadArrangements]);

  const loadSlides = useCallback(async () => {
    if (!selectedArrangement) {
      setSlidesResponse(null);
      return;
    }

    try {
      setLoading(true);

      const result = await libraryApi.getSlides(
        presentation.id,
        selectedArrangement,
      );

      setSlidesResponse(result);
    } catch (err) {
      setError(err instanceof Error ? err.message : "Could not load slides.");
      setSlidesResponse(null);
    } finally {
      setLoading(false);
    }
  }, [presentation.id, selectedArrangement]);

  useEffect(() => {
    void loadSlides();
  }, [loadSlides]);

  const saveOrder = useCallback(
    async (nextOrder: string[]) => {
      if (!selectedArrangement || saving) return;

      try {
        setSaving(true);
        setError(null);

        await libraryApi.setArrangement(presentation.id, selectedArrangement, {
          order: nextOrder,
        });

        setArrangements((current) =>
          current.map((item) =>
            item.name === selectedArrangement
              ? { ...item, order: nextOrder }
              : item,
          ),
        );

        const result = await libraryApi.getSlides(
          presentation.id,
          selectedArrangement,
        );

        setSlidesResponse(result);
      } catch (err) {
        setError(
          err instanceof Error ? err.message : "Could not save arrangement.",
        );
      } finally {
        setSaving(false);
      }
    },
    [presentation.id, selectedArrangement, saving],
  );

  const addGroup = useCallback(
    (group: string, targetIndex: number) => {
      const nextOrder = [...order];
      nextOrder.splice(targetIndex, 0, group);
      void saveOrder(nextOrder);
    },
    [order, saveOrder],
  );

  const reorderGroup = useCallback(
    (from: number, to: number) => {
      if (from === to) return;

      const nextOrder = [...order];
      const [moved] = nextOrder.splice(from, 1);

      if (moved === undefined) return;

      const adjustedIndex = from < to ? to - 1 : to;
      nextOrder.splice(adjustedIndex, 0, moved);

      void saveOrder(nextOrder);
    },
    [order, saveOrder],
  );

  const removeGroup = useCallback(
    (index: number) => {
      const nextOrder = [...order];
      nextOrder.splice(index, 1);
      void saveOrder(nextOrder);
    },
    [order, saveOrder],
  );

  const createArrangement = async () => {
    try {
      setError(null);
      setSaving(true);

      await libraryApi.createArrangement(presentation.id, {
        order: [...availableGroups],
      });

      const refreshed = await libraryApi.listArrangements(presentation.id);

      const created = refreshed.find(
        (item) => !arrangements.some((old) => old.name === item.name),
      );

      setArrangements(refreshed);

      if (created) setSelectedArrangement(created.name);
    } catch (err) {
      setError(
        err instanceof Error ? err.message : "Could not create arrangement.",
      );
    } finally {
      setSaving(false);
    }
  };

  const deleteArrangement = async () => {
    if (!selectedArrangement || arrangements.length <= 1 || saving) return;

    try {
      setError(null);
      setSaving(true);

      await libraryApi.deleteArrangement(presentation.id, selectedArrangement);

      const refreshed = await libraryApi.listArrangements(presentation.id);

      setArrangements(refreshed);
      setSelectedArrangement(refreshed[0]?.name ?? "");
    } catch (err) {
      setError(
        err instanceof Error ? err.message : "Could not delete arrangement.",
      );
    } finally {
      setSaving(false);
    }
  };

  useEffect(() => {
    setPresentationData(presentation);
  }, [presentation]);

  const changeSlideGroup = useCallback(
    async (slideIndex: number, group: string | null) => {
      if (!selectedArrangement || saving) return;

      try {
        setSaving(true);
        setError(null);

        const updated = await libraryApi.setSlideGroup(
          presentation.id,
          slideIndex,
          {
            arrangement: selectedArrangement,
            group,
          },
        );

        setPresentationData(updated);

        const [updatedArrangements, updatedSlides] = await Promise.all([
          libraryApi.listArrangements(presentation.id),
          libraryApi.getSlides(presentation.id, selectedArrangement),
        ]);

        setArrangements(updatedArrangements);
        setSlidesResponse(updatedSlides);
      } catch (err) {
        setError(
          err instanceof Error
            ? err.message
            : "Could not change the slide group.",
        );
      } finally {
        setSaving(false);
      }
    },
    [presentation.id, selectedArrangement, saving],
  );

  useEffect(() => {
    systemApi.getConfig().then((config) => {
      setGroupStyles(config.group_styles ?? []);
    });
  }, []);

  const slides: FlatSlide[] = slidesResponse?.slides ?? [];

  return {
    presentation: presentationData,
    arrangements,
    selectedArrangement,
    setSelectedArrangement,
    availableGroups,
    order,
    slides,
    slidesResponse,
    loading,
    saving,
    error,
    addGroup,
    reorderGroup,
    removeGroup,
    groupStyles,
    changeSlideGroup,
    createArrangement,
    deleteArrangement,
  };
}
