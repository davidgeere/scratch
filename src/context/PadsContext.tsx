import {
  createContext,
  useContext,
  useState,
  useCallback,
  useEffect,
  useMemo,
  type ReactNode,
} from "react";
import type { PadConfig } from "../types/note";
import * as padsService from "../services/pads";

interface PadsContextValue {
  pads: PadConfig[];
  activePadId: string | null;
  activePad: PadConfig | null;
  isLoading: boolean;
  padVersion: number;
  addPad: (name: string, path: string, extensions?: string[]) => Promise<void>;
  removePad: (id: string) => Promise<void>;
  switchPad: (id: string) => Promise<void>;
  updatePad: (id: string, name?: string, fileExtensions?: string[]) => Promise<void>;
}

const PadsContext = createContext<PadsContextValue | null>(null);

export function PadsProvider({ children }: { children: ReactNode }) {
  const [pads, setPads] = useState<PadConfig[]>([]);
  const [activePadId, setActivePadId] = useState<string | null>(null);
  const [isLoading, setIsLoading] = useState(true);
  const [padVersion, setPadVersion] = useState(0);

  useEffect(() => {
    async function init() {
      try {
        const info = await padsService.listPads();
        setPads(info.pads);
        setActivePadId(info.activePadId);
      } catch (err) {
        console.error("Failed to load pads:", err);
      } finally {
        setIsLoading(false);
      }
    }
    init();
  }, []);

  const activePad = useMemo(
    () => pads.find((p) => p.id === activePadId) ?? null,
    [pads, activePadId],
  );

  const addPad = useCallback(
    async (name: string, path: string, extensions?: string[]) => {
      const pad = await padsService.addPad(name, path, extensions);
      const info = await padsService.listPads();
      setPads(info.pads);
      setActivePadId(info.activePadId);
      if (info.activePadId === pad.id) {
        setPadVersion((v) => v + 1);
      }
    },
    [],
  );

  const removePad = useCallback(async (id: string) => {
    await padsService.removePad(id);
    const info = await padsService.listPads();
    setPads(info.pads);
    setActivePadId(info.activePadId);
    setPadVersion((v) => v + 1);
  }, []);

  const switchPad = useCallback(async (id: string) => {
    await padsService.switchPad(id);
    setActivePadId(id);
    setPadVersion((v) => v + 1);
  }, []);

  const updatePad = useCallback(
    async (id: string, name?: string, fileExtensions?: string[]) => {
      await padsService.updatePad(id, name, fileExtensions);
      const info = await padsService.listPads();
      setPads(info.pads);
      setPadVersion((v) => v + 1);
    },
    [],
  );

  const value = useMemo<PadsContextValue>(
    () => ({
      pads,
      activePadId,
      activePad,
      isLoading,
      padVersion,
      addPad,
      removePad,
      switchPad,
      updatePad,
    }),
    [pads, activePadId, activePad, isLoading, padVersion, addPad, removePad, switchPad, updatePad],
  );

  return <PadsContext.Provider value={value}>{children}</PadsContext.Provider>;
}

export function usePads() {
  const context = useContext(PadsContext);
  if (!context) {
    throw new Error("usePads must be used within a PadsProvider");
  }
  return context;
}
