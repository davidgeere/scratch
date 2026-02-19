import { useCallback, useMemo, memo, useEffect, useRef, useState } from "react";
import { invoke } from "@tauri-apps/api/core";
import { Menu, MenuItem, PredefinedMenuItem } from "@tauri-apps/api/menu";
import { useNotes } from "../../context/NotesContext";
import {
  ListItem,
  AlertDialog,
  AlertDialogAction,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
} from "../ui";
import { cleanTitle } from "../../lib/utils";
import * as notesService from "../../services/notes";
import type { Settings } from "../../types/note";

function formatDate(timestamp: number): string {
  const date = new Date(timestamp * 1000);
  const now = new Date();

  const startOfToday = new Date(
    now.getFullYear(),
    now.getMonth(),
    now.getDate()
  );
  const startOfYesterday = new Date(startOfToday.getTime() - 86400000);

  if (date >= startOfToday) {
    return date.toLocaleTimeString([], { hour: "numeric", minute: "2-digit" });
  }

  if (date >= startOfYesterday) {
    return "Yesterday";
  }

  const daysAgo =
    Math.floor((startOfToday.getTime() - date.getTime()) / 86400000) + 1;

  if (daysAgo <= 6) {
    return `${daysAgo} days ago`;
  }

  if (date.getFullYear() === now.getFullYear()) {
    return date.toLocaleDateString([], { month: "short", day: "numeric" });
  }

  return date.toLocaleDateString([], {
    month: "short",
    day: "numeric",
    year: "numeric",
  });
}

interface NoteItemProps {
  id: string;
  title: string;
  preview?: string;
  modified: number;
  isSelected: boolean;
  isPinned: boolean;
  onSelect: (id: string) => void;
  onContextMenu: (e: React.MouseEvent, id: string) => void;
}

const NoteItem = memo(function NoteItem({
  id,
  title,
  preview,
  modified,
  isSelected,
  isPinned,
  onSelect,
  onContextMenu,
}: NoteItemProps) {
  const handleClick = useCallback(() => onSelect(id), [onSelect, id]);
  const handleContextMenu = useCallback(
    (e: React.MouseEvent) => onContextMenu(e, id),
    [onContextMenu, id]
  );

  return (
    <ListItem
      title={cleanTitle(title)}
      subtitle={preview}
      meta={formatDate(modified)}
      isSelected={isSelected}
      isPinned={isPinned}
      onClick={handleClick}
      onContextMenu={handleContextMenu}
    />
  );
});

interface NoteListProps {
  selectedFolder?: string | null;
}

export function NoteList({ selectedFolder }: NoteListProps) {
  const {
    notes,
    selectedNoteId,
    selectNote,
    deleteNote,
    duplicateNote,
    pinNote,
    unpinNote,
    isLoading,
    searchQuery,
    searchResults,
  } = useNotes();

  const [deleteDialogOpen, setDeleteDialogOpen] = useState(false);
  const [noteToDelete, setNoteToDelete] = useState<string | null>(null);
  const [settings, setSettings] = useState<Settings | null>(null);
  const containerRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    notesService
      .getSettings()
      .then(setSettings)
      .catch((error) => {
        console.error("Failed to load settings:", error);
      });
  }, [notes]);

  const pinnedIds = useMemo(
    () => new Set(settings?.pinnedNoteIds || []),
    [settings]
  );

  const handleDeleteConfirm = useCallback(async () => {
    if (noteToDelete) {
      try {
        await deleteNote(noteToDelete);
        setNoteToDelete(null);
        setDeleteDialogOpen(false);
      } catch (error) {
        console.error("Failed to delete note:", error);
      }
    }
  }, [noteToDelete, deleteNote]);

  const handleContextMenu = useCallback(
    async (e: React.MouseEvent, noteId: string) => {
      e.preventDefault();
      const isPinned = pinnedIds.has(noteId);

      const menu = await Menu.new({
        items: [
          await MenuItem.new({
            text: isPinned ? "Unpin" : "Pin",
            action: async () => {
              try {
                await (isPinned ? unpinNote(noteId) : pinNote(noteId));
                const newSettings = await notesService.getSettings();
                setSettings(newSettings);
              } catch (error) {
                console.error("Failed to pin/unpin note:", error);
              }
            },
          }),
          await MenuItem.new({
            text: "Duplicate",
            action: () => duplicateNote(noteId),
          }),
          await MenuItem.new({
            text: "Copy Filepath",
            action: async () => {
              try {
                const folder = await notesService.getNotesFolder();
                if (folder) {
                  const filepath = `${folder}/${noteId}.md`;
                  await invoke("copy_to_clipboard", { text: filepath });
                }
              } catch (error) {
                console.error("Failed to copy filepath:", error);
              }
            },
          }),
          await PredefinedMenuItem.new({ item: "Separator" }),
          await MenuItem.new({
            text: "Delete",
            action: () => {
              setNoteToDelete(noteId);
              setDeleteDialogOpen(true);
            },
          }),
        ],
      });

      await menu.popup();
    },
    [pinnedIds, pinNote, unpinNote, duplicateNote]
  );

  const displayItems = useMemo(() => {
    if (searchQuery.trim()) {
      return searchResults.map((r) => ({
        id: r.id,
        title: r.title,
        preview: r.preview,
        modified: r.modified,
      }));
    }
    if (selectedFolder) {
      return notes.filter((n) => n.id.startsWith(selectedFolder + "/"));
    }
    return notes;
  }, [searchQuery, searchResults, notes, selectedFolder]);

  useEffect(() => {
    const handleFocusNoteList = () => {
      containerRef.current?.focus();
    };

    window.addEventListener("focus-note-list", handleFocusNoteList);
    return () =>
      window.removeEventListener("focus-note-list", handleFocusNoteList);
  }, []);

  if (isLoading && notes.length === 0) {
    return (
      <div className="p-4 text-center text-text-muted select-none">
        Loading...
      </div>
    );
  }

  if (searchQuery.trim() && displayItems.length === 0) {
    return (
      <div className="p-4 text-center text-sm text-text-muted select-none">
        No results found
      </div>
    );
  }

  if (displayItems.length === 0) {
    return (
      <div className="p-4 text-center text-sm text-text-muted select-none">
        No notes yet
      </div>
    );
  }

  return (
    <>
      <div
        ref={containerRef}
        tabIndex={0}
        className="flex flex-col gap-1 p-1.5 outline-none"
      >
        {displayItems.map((item) => (
          <NoteItem
            key={item.id}
            id={item.id}
            title={item.title}
            preview={item.preview}
            modified={item.modified}
            isSelected={selectedNoteId === item.id}
            isPinned={pinnedIds.has(item.id)}
            onSelect={selectNote}
            onContextMenu={handleContextMenu}
          />
        ))}
      </div>

      <AlertDialog open={deleteDialogOpen} onOpenChange={setDeleteDialogOpen}>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>Delete note?</AlertDialogTitle>
            <AlertDialogDescription>
              This will permanently delete the note and all its content. This
              action cannot be undone.
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel>Cancel</AlertDialogCancel>
            <AlertDialogAction onClick={handleDeleteConfirm}>
              Delete
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </>
  );
}
