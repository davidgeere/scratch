import {
  useState,
  useEffect,
  useCallback,
  useMemo,
  useRef,
  type PointerEvent as ReactPointerEvent,
} from "react";
import { toast } from "sonner";
import { NotesProvider, useNotes } from "./context/NotesContext";
import { PadsProvider, usePads } from "./context/PadsContext";
import { ThemeProvider } from "./context/ThemeContext";
import { GitProvider } from "./context/GitContext";
import { TooltipProvider, Toaster } from "./components/ui";
import { PadNav } from "./components/layout/PadNav";
import { Sidebar } from "./components/layout/Sidebar";
import { Editor } from "./components/editor/Editor";
import type { Editor as TiptapEditor } from "@tiptap/react";
import { FolderPicker } from "./components/layout/FolderPicker";
import { CommandPalette } from "./components/command-palette/CommandPalette";
import { SettingsPage } from "./components/settings";
import { SpinnerIcon, ClaudeIcon, CodexIcon } from "./components/icons";
import { AiEditModal } from "./components/ai/AiEditModal";
import { AiResponseToast } from "./components/ai/AiResponseToast";
import { PreviewApp } from "./components/preview/PreviewApp";
import {
  check as checkForUpdate,
  type Update,
} from "@tauri-apps/plugin-updater";
import * as aiService from "./services/ai";
import type { AiProvider } from "./services/ai";

// Detect preview mode from URL search params
function getWindowMode(): {
  isPreview: boolean;
  previewFile: string | null;
} {
  const params = new URLSearchParams(window.location.search);
  const mode = params.get("mode");
  const file = params.get("file");
  return {
    isPreview: mode === "preview" && !!file,
    previewFile: file,
  };
}

const PAD_NAV_MIN = 200;
const PAD_NAV_MAX = 360;
const PAD_NAV_DEFAULT = 240;
const SIDEBAR_MIN = 200;
const SIDEBAR_MAX = 400;
const SIDEBAR_DEFAULT = 240;

function loadColumnWidths(): { padNav: number; sidebar: number } {
  try {
    const raw = localStorage.getItem("scratch-column-widths");
    if (raw) {
      const parsed = JSON.parse(raw);
      return {
        padNav: Math.max(PAD_NAV_MIN, Math.min(PAD_NAV_MAX, parsed.padNav ?? PAD_NAV_DEFAULT)),
        sidebar: Math.max(SIDEBAR_MIN, Math.min(SIDEBAR_MAX, parsed.sidebar ?? SIDEBAR_DEFAULT)),
      };
    }
  } catch { /* */ }
  return { padNav: PAD_NAV_DEFAULT, sidebar: SIDEBAR_DEFAULT };
}

function ColumnDragHandle({
  onDrag,
  onDragStart,
  onDragEnd,
}: {
  onDrag: (deltaX: number) => void;
  onDragStart?: () => void;
  onDragEnd?: () => void;
}) {
  const startXRef = useRef(0);
  const [dragging, setDragging] = useState(false);

  const handlePointerDown = useCallback(
    (e: ReactPointerEvent) => {
      e.preventDefault();
      startXRef.current = e.clientX;
      const el = e.currentTarget as HTMLElement;
      el.setPointerCapture(e.pointerId);
      document.body.style.cursor = "col-resize";
      document.body.style.userSelect = "none";
      setDragging(true);
      onDragStart?.();

      const handleMove = (ev: globalThis.PointerEvent) => {
        const delta = ev.clientX - startXRef.current;
        startXRef.current = ev.clientX;
        onDrag(delta);
      };

      const handleUp = () => {
        document.body.style.cursor = "";
        document.body.style.userSelect = "";
        setDragging(false);
        onDragEnd?.();
        document.removeEventListener("pointermove", handleMove);
        document.removeEventListener("pointerup", handleUp);
      };

      document.addEventListener("pointermove", handleMove);
      document.addEventListener("pointerup", handleUp);
    },
    [onDrag, onDragStart, onDragEnd],
  );

  return (
    <div
      className="shrink-0 w-3 cursor-col-resize group relative z-10 flex items-center justify-center"
      onPointerDown={handlePointerDown}
    >
      <div
        className={`w-1 rounded-full transition-opacity duration-150 bg-bg-tertiary ${
          dragging ? "opacity-100" : "opacity-0 group-hover:opacity-100"
        }`}
        style={{ position: "absolute", top: 48, bottom: 48 }}
      />
    </div>
  );
}

type ViewState = "notes" | "settings";

interface AppContentProps {
  columnWidths: { padNav: number; sidebar: number };
  padNavOpen: boolean;
  padNavVisible: boolean;
  padNavPeeking: boolean;
  sidebarVisible: boolean;
  isDragging: boolean;
  togglePadNav: () => void;
  toggleSidebar: () => void;
  setSidebarVisible: (visible: boolean) => void;
  dismissPeek: () => void;
  onPadNavPeekEnter: () => void;
  onPadNavPeekLeave: () => void;
  onPadNavDrag: (delta: number) => void;
  onSidebarDrag: (delta: number) => void;
  onDragStart: () => void;
  onDragEnd: () => void;
}

function AppContent({
  columnWidths,
  padNavOpen,
  padNavVisible,
  padNavPeeking,
  sidebarVisible,
  isDragging,
  togglePadNav,
  toggleSidebar,
  setSidebarVisible,
  dismissPeek,
  onPadNavPeekEnter,
  onPadNavPeekLeave,
  onPadNavDrag,
  onSidebarDrag,
  onDragStart,
  onDragEnd,
}: AppContentProps) {
  const {
    isLoading,
    createNote,
    notes,
    selectedNoteId,
    selectNote,
    searchQuery,
    searchResults,
    reloadCurrentNote,
    currentNote,
  } = useNotes();
  const [paletteOpen, setPaletteOpen] = useState(false);
  const [view, setView] = useState<ViewState>("notes");
  const [aiModalOpen, setAiModalOpen] = useState(false);
  const [aiEditing, setAiEditing] = useState(false);
  const [focusMode, setFocusMode] = useState(false);
  const [aiProvider, setAiProvider] = useState<AiProvider>("claude");
  const [selectedFolder, setSelectedFolder] = useState<string | null>(null);
  const editorRef = useRef<TiptapEditor | null>(null);

  const toggleFocusMode = useCallback(() => {
    setFocusMode((prev) => {
      if (!prev && !selectedNoteId) return prev;
      if (prev) {
        setSidebarVisible(true);
      }
      return !prev;
    });
  }, [selectedNoteId, setSidebarVisible]);

  const toggleSettings = useCallback(() => {
    setView((prev) => (prev === "settings" ? "notes" : "settings"));
  }, []);

  const closeSettings = useCallback(() => {
    setView("notes");
  }, []);

  // Go back to command palette from AI modal
  const handleBackToPalette = useCallback(() => {
    setAiModalOpen(false);
    setPaletteOpen(true);
  }, []);

  // AI Edit handler
  const handleAiEdit = useCallback(
    async (prompt: string) => {
      if (!currentNote) {
        toast.error("No note selected");
        return;
      }

      setAiEditing(true);

      try {
        const result =
          aiProvider === "codex"
            ? await aiService.executeCodexEdit(currentNote.path, prompt)
            : await aiService.executeClaudeEdit(currentNote.path, prompt);

        // Reload the current note from disk
        await reloadCurrentNote();

        // Show results
        if (result.success) {
          // Close modal after success
          setAiModalOpen(false);

          // Show success toast with provider response
          toast(
            <AiResponseToast output={result.output} provider={aiProvider} />,
            {
              duration: Infinity,
              closeButton: true,
              className: "!min-w-[450px] !max-w-[600px]",
            },
          );
        } else {
          toast.error(
            <div className="space-y-1">
              <div className="font-medium">AI Edit Failed</div>
              <div className="text-xs">{result.error || "Unknown error"}</div>
            </div>,
            { duration: Infinity, closeButton: true },
          );
        }
      } catch (error) {
        console.error("[AI] Error:", error);
        toast.error(
          `Error: ${error instanceof Error ? error.message : "Unknown error"}`,
        );
      } finally {
        setAiEditing(false);
      }
    },
    [aiProvider, currentNote, reloadCurrentNote],
  );

  // Memoize display items to prevent unnecessary recalculations
  const displayItems = useMemo(() => {
    return searchQuery.trim() ? searchResults : notes;
  }, [searchQuery, searchResults, notes]);

  // Global keyboard shortcuts
  useEffect(() => {
    const handleKeyDown = (e: KeyboardEvent) => {
      const target = e.target as HTMLElement;
      const isInEditor = target.closest(".ProseMirror");
      const isInInput =
        target.tagName === "INPUT" || target.tagName === "TEXTAREA";

      // Cmd+, - Toggle settings (always works, even in settings)
      if ((e.metaKey || e.ctrlKey) && e.key === ",") {
        e.preventDefault();
        toggleSettings();
        return;
      }

      // Block all other shortcuts when in settings view
      if (view === "settings") {
        return;
      }

      // Cmd+Shift+Enter - Toggle focus mode
      if ((e.metaKey || e.ctrlKey) && e.shiftKey && e.key === "Enter") {
        e.preventDefault();
        toggleFocusMode();
        return;
      }

      // Cmd+Shift+M - Toggle markdown source mode
      if (
        (e.metaKey || e.ctrlKey) &&
        e.shiftKey &&
        e.key.toLowerCase() === "m"
      ) {
        e.preventDefault();
        window.dispatchEvent(new CustomEvent("toggle-source-mode"));
        return;
      }

      // Escape exits focus mode when not in editor
      if (e.key === "Escape" && focusMode && !isInEditor) {
        e.preventDefault();
        toggleFocusMode();
        return;
      }

      // Trap Tab/Shift+Tab in notes view only - prevent focus navigation
      // TipTap handles indentation internally before event bubbles up
      if (e.key === "Tab") {
        e.preventDefault();
        return;
      }

      // Cmd+P - Open command palette
      if ((e.metaKey || e.ctrlKey) && e.key === "p") {
        e.preventDefault();
        setPaletteOpen(true);
        return;
      }

      // Cmd/Ctrl+Shift+F - Open sidebar search
      if (
        (e.metaKey || e.ctrlKey) &&
        e.shiftKey &&
        e.key.toLowerCase() === "f"
      ) {
        e.preventDefault();
        setSidebarVisible(true);
        window.dispatchEvent(new CustomEvent("open-sidebar-search"));
        return;
      }

      // Cmd+\ - Toggle sidebar
      if ((e.metaKey || e.ctrlKey) && e.key === "\\") {
        e.preventDefault();
        toggleSidebar();
        return;
      }

      // Cmd+N - New note
      if ((e.metaKey || e.ctrlKey) && e.key === "n") {
        e.preventDefault();
        createNote();
        return;
      }

      // Cmd+R - Reload current note (pull external changes)
      if ((e.metaKey || e.ctrlKey) && e.key === "r") {
        e.preventDefault();
        reloadCurrentNote();
        return;
      }

      // Arrow keys for note navigation (when not in editor or input)
      if (!isInEditor && !isInInput && displayItems.length > 0) {
        if (e.key === "ArrowDown" || e.key === "ArrowUp") {
          e.preventDefault();
          const currentIndex = displayItems.findIndex(
            (n) => n.id === selectedNoteId,
          );
          let newIndex: number;

          if (e.key === "ArrowDown") {
            newIndex =
              currentIndex < displayItems.length - 1 ? currentIndex + 1 : 0;
          } else {
            newIndex =
              currentIndex > 0 ? currentIndex - 1 : displayItems.length - 1;
          }

          selectNote(displayItems[newIndex].id);
          return;
        }

        // Enter to focus editor
        if (e.key === "Enter" && selectedNoteId) {
          e.preventDefault();
          const editor = document.querySelector(".ProseMirror") as HTMLElement;
          if (editor) {
            editor.focus();
          }
          return;
        }
      }

      // Escape to blur editor and go back to note list
      if (e.key === "Escape" && isInEditor) {
        e.preventDefault();
        (target as HTMLElement).blur();
        // Focus the note list for keyboard navigation
        window.dispatchEvent(new CustomEvent("focus-note-list"));
        return;
      }
    };

    // Disable right-click context menu except in editor
    const handleContextMenu = (e: MouseEvent) => {
      const target = e.target as HTMLElement;
      // Allow context menu in editor (prose class) and inputs
      const isInEditor =
        target.closest(".prose") || target.closest(".ProseMirror");
      const isInput =
        target.tagName === "INPUT" || target.tagName === "TEXTAREA";
      if (!isInEditor && !isInput) {
        e.preventDefault();
      }
    };

    window.addEventListener("keydown", handleKeyDown);
    window.addEventListener("contextmenu", handleContextMenu);
    return () => {
      window.removeEventListener("keydown", handleKeyDown);
      window.removeEventListener("contextmenu", handleContextMenu);
    };
  }, [
    createNote,
    displayItems,
    reloadCurrentNote,
    selectedNoteId,
    selectNote,
    toggleSettings,
    toggleSidebar,
    toggleFocusMode,
    focusMode,
    view,
  ]);

  const handleClosePalette = useCallback(() => {
    setPaletteOpen(false);
  }, []);

  if (isLoading) {
    return (
      <div className="h-full flex items-center justify-center">
        <div className="text-text-muted/70 text-sm flex items-center gap-1.5 font-medium">
          <SpinnerIcon className="w-4.5 h-4.5 stroke-[1.5] animate-spin" />
          Loading notes...
        </div>
      </div>
    );
  }

  return (
    <>
      <div className="h-full flex animate-content-crossfade">
        {view === "settings" ? (
          <SettingsPage onBack={closeSettings} />
        ) : (
          <>
            {/* Column 1: Pad/folder navigation — floating panel with margin */}
            {!focusMode && sidebarVisible && (
              <div className="relative shrink-0 flex" data-tauri-drag-region>
                {/* Peek hover zone when pad nav is closed */}
                {!padNavOpen && (
                  <div
                    className="absolute inset-y-0 left-0 w-2 z-30"
                    onMouseEnter={onPadNavPeekEnter}
                    onMouseLeave={onPadNavPeekLeave}
                  />
                )}
                <div
                  className={`h-full overflow-hidden ${isDragging ? "" : "transition-[width] duration-300 ease-out"}`}
                  style={{ width: padNavVisible ? `${columnWidths.padNav}px` : 0 }}
                  onMouseLeave={padNavPeeking ? onPadNavPeekLeave : undefined}
                >
                  <div
                    className="h-full flex flex-col p-2 pt-0"
                    style={{ width: `${columnWidths.padNav}px` }}
                  >
                    <PadNav
                      selectedFolder={selectedFolder}
                      onSelectFolder={(folder) => {
                        setSelectedFolder(folder);
                        if (padNavPeeking) dismissPeek();
                      }}
                    />
                  </div>
                </div>
                {padNavVisible && (
                  <ColumnDragHandle onDrag={onPadNavDrag} onDragStart={onDragStart} onDragEnd={onDragEnd} />
                )}
              </div>
            )}
            {/* Column 2: Note list */}
            <div
              className={`overflow-hidden shrink-0 flex ${isDragging ? "" : "transition-all duration-500 ease-out"} ${!sidebarVisible || focusMode ? "opacity-0 -translate-x-4 w-0 pointer-events-none" : "opacity-100 translate-x-0"}`}
              style={sidebarVisible && !focusMode ? { width: `${columnWidths.sidebar}px` } : undefined}
            >
              <div className="flex-1 min-w-0">
                <Sidebar
                  selectedFolder={selectedFolder}
                  onOpenSettings={toggleSettings}
                  onTogglePadNav={togglePadNav}
                  padNavOpen={padNavOpen}
                />
              </div>
            </div>
            {/* Drag handle for sidebar/editor boundary */}
            {sidebarVisible && !focusMode && (
              <ColumnDragHandle onDrag={onSidebarDrag} onDragStart={onDragStart} onDragEnd={onDragEnd} />
            )}
            {/* Column 3: Editor */}
            <Editor
              onToggleSidebar={toggleSidebar}
              sidebarVisible={sidebarVisible && !focusMode}
              focusMode={focusMode}
              onEditorReady={(editor) => {
                editorRef.current = editor;
              }}
            />
          </>
        )}
      </div>

      {/* Shared backdrop for command palette and AI modal */}
      {(paletteOpen || aiModalOpen) && (
        <div
          className="fixed inset-0 bg-black/50 backdrop-blur-sm z-40 animate-fade-in"
          onClick={() => {
            if (paletteOpen) handleClosePalette();
            if (aiModalOpen) setAiModalOpen(false);
          }}
        />
      )}

      <CommandPalette
        open={paletteOpen}
        onClose={handleClosePalette}
        onOpenSettings={toggleSettings}
        onOpenAiModal={(provider) => {
          setAiProvider(provider);
          setAiModalOpen(true);
        }}
        focusMode={focusMode}
        onToggleFocusMode={toggleFocusMode}
        editorRef={editorRef}
      />
      <AiEditModal
        open={aiModalOpen}
        provider={aiProvider}
        onBack={handleBackToPalette}
        onExecute={handleAiEdit}
        isExecuting={aiEditing}
      />

      {/* AI Editing Overlay */}
      {aiEditing && (
        <div className="fixed inset-0 bg-bg/50 backdrop-blur-sm z-50 flex items-center justify-center">
          <div className="flex items-center gap-2">
            {aiProvider === "codex" ? (
              <CodexIcon className="w-4.5 h-4.5 fill-text-muted animate-spin-slow" />
            ) : (
              <ClaudeIcon className="w-4.5 h-4.5 fill-text-muted animate-spin-slow" />
            )}
            <div className="text-sm font-medium text-text">
              {aiProvider === "codex"
                ? "Codex is editing your note..."
                : "Claude is editing your note..."}
            </div>
          </div>
        </div>
      )}
    </>
  );
}

// Shared update check — used by startup and manual "Check for Updates"
async function showUpdateToast(): Promise<"update" | "no-update" | "error"> {
  try {
    const update = await checkForUpdate();
    if (update) {
      toast(<UpdateToast update={update} toastId="update-toast" />, {
        id: "update-toast",
        duration: Infinity,
        closeButton: true,
      });
      return "update";
    }
    return "no-update";
  } catch (err) {
    // Network errors and 404s (no release published yet) are not real failures
    const msg = String(err);
    if (
      msg.includes("404") ||
      msg.includes("network") ||
      msg.includes("Could not fetch")
    ) {
      return "no-update";
    }
    console.error("Update check failed:", err);
    return "error";
  }
}

export { showUpdateToast };

function UpdateToast({
  update,
  toastId,
}: {
  update: Update;
  toastId: string | number;
}) {
  const [installing, setInstalling] = useState(false);

  const handleUpdate = async () => {
    setInstalling(true);
    try {
      await update.downloadAndInstall();
      toast.dismiss(toastId);
      toast.success("Update installed! Restart Scratch to apply.", {
        duration: Infinity,
        closeButton: true,
      });
    } catch (err) {
      console.error("Update failed:", err);
      toast.error("Update failed. Please try again later.");
      setInstalling(false);
    }
  };

  return (
    <div className="flex flex-col gap-1">
      <div className="font-medium text-sm">
        Update Available: v{update.version}
      </div>
      {update.body && (
        <div className="text-xs text-text-muted line-clamp-3">
          {update.body}
        </div>
      )}
      <button
        onClick={handleUpdate}
        disabled={installing}
        className="self-start mt-1 text-xs font-medium px-3 py-1.5 rounded-md bg-text text-bg hover:opacity-90 disabled:opacity-50 transition-opacity"
      >
        {installing ? "Installing..." : "Update Now"}
      </button>
    </div>
  );
}

function PadAwareApp() {
  const { pads, activePadId, isLoading, padVersion } = usePads();

  const [columnWidths, setColumnWidths] = useState(loadColumnWidths);
  const [padNavOpen, setPadNavOpen] = useState(true);
  const [padNavPeeking, setPadNavPeeking] = useState(false);
  const padNavPeekTimer = useRef<number | null>(null);
  const [sidebarVisible, setSidebarVisible] = useState(true);
  const [isDragging, setIsDragging] = useState(false);

  const padNavVisible = padNavOpen || padNavPeeking;

  const togglePadNav = useCallback(() => {
    setPadNavOpen((prev) => !prev);
    setPadNavPeeking(false);
  }, []);

  const handlePadNavPeekEnter = useCallback(() => {
    if (padNavOpen) return;
    padNavPeekTimer.current = window.setTimeout(() => {
      setPadNavPeeking(true);
    }, 200);
  }, [padNavOpen]);

  const handlePadNavPeekLeave = useCallback(() => {
    if (padNavPeekTimer.current) {
      clearTimeout(padNavPeekTimer.current);
      padNavPeekTimer.current = null;
    }
    setPadNavPeeking(false);
  }, []);

  const toggleSidebar = useCallback(() => {
    setSidebarVisible((prev) => !prev);
  }, []);

  const handleSetSidebarVisible = useCallback((visible: boolean) => {
    setSidebarVisible(visible);
  }, []);

  const dismissPeek = useCallback(() => {
    setPadNavPeeking(false);
  }, []);

  const handlePadNavDrag = useCallback((delta: number) => {
    setColumnWidths((prev) => {
      const padNav = Math.max(PAD_NAV_MIN, Math.min(PAD_NAV_MAX, prev.padNav + delta));
      const next = { ...prev, padNav };
      try { localStorage.setItem("scratch-column-widths", JSON.stringify(next)); } catch { /* */ }
      return next;
    });
  }, []);

  const handleSidebarDrag = useCallback((delta: number) => {
    setColumnWidths((prev) => {
      const sidebar = Math.max(SIDEBAR_MIN, Math.min(SIDEBAR_MAX, prev.sidebar + delta));
      const next = { ...prev, sidebar };
      try { localStorage.setItem("scratch-column-widths", JSON.stringify(next)); } catch { /* */ }
      return next;
    });
  }, []);

  if (isLoading) {
    return (
      <div className="h-screen flex items-center justify-center bg-bg-secondary">
        <div className="text-text-muted/70 text-sm flex items-center gap-1.5 font-medium">
          <SpinnerIcon className="w-4.5 h-4.5 stroke-[1.5] animate-spin" />
          Initializing Scratch...
        </div>
      </div>
    );
  }

  if (pads.length === 0 || !activePadId) {
    return <FolderPicker />;
  }

  return (
    <div className="h-screen bg-bg-secondary overflow-hidden">
      <NotesProvider key={`pad-${activePadId}-${padVersion}`}>
        <GitProvider>
          <AppContent
            columnWidths={columnWidths}
            padNavOpen={padNavOpen}
            padNavVisible={padNavVisible}
            padNavPeeking={padNavPeeking}
            sidebarVisible={sidebarVisible}
            isDragging={isDragging}
            togglePadNav={togglePadNav}
            toggleSidebar={toggleSidebar}
            setSidebarVisible={handleSetSidebarVisible}
            dismissPeek={dismissPeek}
            onPadNavPeekEnter={handlePadNavPeekEnter}
            onPadNavPeekLeave={handlePadNavPeekLeave}
            onPadNavDrag={handlePadNavDrag}
            onSidebarDrag={handleSidebarDrag}
            onDragStart={() => setIsDragging(true)}
            onDragEnd={() => setIsDragging(false)}
          />
        </GitProvider>
      </NotesProvider>
    </div>
  );
}

function App() {
  const { isPreview, previewFile } = useMemo(getWindowMode, []);

  // Add platform class for OS-specific styling (e.g., keyboard shortcuts)
  useEffect(() => {
    const isMac = /Mac|iPhone|iPad|iPod/.test(navigator.userAgent);
    document.documentElement.classList.add(
      isMac ? "platform-mac" : "platform-other",
    );
  }, []);

  // Check for app updates on startup (folder mode only)
  useEffect(() => {
    if (isPreview) return;
    const timer = setTimeout(() => showUpdateToast(), 3000);
    return () => clearTimeout(timer);
  }, [isPreview]);

  // Preview mode: lightweight editor without sidebar, search, git
  if (isPreview && previewFile) {
    return (
      <ThemeProvider>
        <Toaster />
        <TooltipProvider>
          <PreviewApp filePath={decodeURIComponent(previewFile)} />
        </TooltipProvider>
      </ThemeProvider>
    );
  }

  // Folder mode: full app with sidebar, search, git, etc.
  return (
    <ThemeProvider>
      <Toaster />
      <TooltipProvider>
        <PadsProvider>
          <PadAwareApp />
        </PadsProvider>
      </TooltipProvider>
    </ThemeProvider>
  );
}

export default App;
