import { open } from "@tauri-apps/plugin-dialog";
import { usePads } from "../../context/PadsContext";
import { useTheme } from "../../context/ThemeContext";
import { Button } from "../ui";

export function FolderPicker() {
  const { addPad } = usePads();
  const { reloadSettings } = useTheme();

  const handleSelectFolder = async () => {
    try {
      const selected = await open({
        directory: true,
        multiple: false,
        title: "Choose Notes Folder",
      });

      if (selected && typeof selected === "string") {
        const name =
          selected.split("/").filter(Boolean).pop() || "Notes";
        await addPad(name, selected);
        await reloadSettings();
      }
    } catch (err) {
      console.error("Failed to select folder:", err);
    }
  };

  return (
    <div className="h-full flex flex-col bg-bg-secondary">
      <div className="h-10 shrink-0" data-tauri-drag-region />

      <div className="flex-1 flex items-center justify-center">
        <div className="text-center p-8 max-w-lg select-none">
          <img
            src="/folders-dark.png"
            alt="Folders"
            className="w-48 h-auto mx-auto invert dark:invert-0 mb-2 animate-fade-in-up"
            style={{ animationDelay: "0ms" }}
          />

          <h1
            className="text-3xl text-text font-serif mb-2 tracking-[-0.01em] animate-fade-in-up"
            style={{ animationDelay: "100ms" }}
          >
            Welcome to Scratch
          </h1>
          <p
            className="text-text-muted mb-6 animate-fade-in-up"
            style={{ animationDelay: "100ms" }}
          >
            Scratch is an offline-first notes app. Your notes are simply stored
            on your computer as markdown files.
          </p>
          <div
            className="animate-fade-in-up"
            style={{ animationDelay: "200ms" }}
          >
            <Button onClick={handleSelectFolder} size="xl">
              Add your first pad
            </Button>
          </div>

          <p
            className="mt-2 text-xs text-text-muted/60 animate-fade-in-up"
            style={{ animationDelay: "300ms" }}
          >
            Each pad connects to a folder on your computer. You can add more
            later.
          </p>
        </div>
      </div>
    </div>
  );
}
