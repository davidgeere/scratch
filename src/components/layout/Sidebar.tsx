import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { useNotes } from "../../context/NotesContext";
import { usePads } from "../../context/PadsContext";
import { NoteList } from "../notes/NoteList";
import { Footer } from "./Footer";
import { IconButton, Input } from "../ui";
import {
  PlusIcon,
  XIcon,
  SearchIcon,
  SearchOffIcon,
  PanelLeftIcon,
} from "../icons";
import { mod, shift, isMac } from "../../lib/platform";

interface SidebarProps {
  selectedFolder: string | null;
  onOpenSettings?: () => void;
  onTogglePadNav?: () => void;
  padNavOpen?: boolean;
}

export function Sidebar({ selectedFolder, onOpenSettings, onTogglePadNav, padNavOpen }: SidebarProps) {
  const { createNote, notes, search, searchQuery, clearSearch } = useNotes();
  const { activePad } = usePads();
  const [searchOpen, setSearchOpen] = useState(false);
  const [inputValue, setInputValue] = useState(searchQuery);
  const debounceRef = useRef<number | null>(null);
  const searchInputRef = useRef<HTMLInputElement>(null);

  useEffect(() => {
    setInputValue(searchQuery);
  }, [searchQuery]);

  const handleSearchChange = useCallback(
    (e: React.ChangeEvent<HTMLInputElement>) => {
      const value = e.target.value;
      setInputValue(value);
      if (debounceRef.current) {
        clearTimeout(debounceRef.current);
      }
      debounceRef.current = window.setTimeout(() => {
        search(value);
      }, 220);
    },
    [search]
  );

  const toggleSearch = useCallback(() => {
    setSearchOpen((prev) => !prev);
  }, []);

  const closeSearch = useCallback(() => {
    setSearchOpen(false);
    setInputValue("");
    clearSearch();
  }, [clearSearch]);

  useEffect(() => {
    if (searchOpen) {
      requestAnimationFrame(() => searchInputRef.current?.focus());
    }
  }, [searchOpen]);

  useEffect(() => {
    const handleOpenSidebarSearch = () => {
      setSearchOpen(true);
      requestAnimationFrame(() => searchInputRef.current?.focus());
    };
    window.addEventListener("open-sidebar-search", handleOpenSidebarSearch);
    return () =>
      window.removeEventListener("open-sidebar-search", handleOpenSidebarSearch);
  }, []);

  const handleSearchKeyDown = useCallback(
    (e: React.KeyboardEvent<HTMLInputElement>) => {
      if (e.key === "Escape") {
        e.preventDefault();
        if (inputValue) {
          setInputValue("");
          clearSearch();
        } else {
          closeSearch();
        }
      }
    },
    [inputValue, clearSearch, closeSearch]
  );

  const handleClearSearch = useCallback(() => {
    setInputValue("");
    clearSearch();
  }, [clearSearch]);

  const folderDisplayName = selectedFolder
    ? selectedFolder.split("/").pop() || selectedFolder
    : "All Notes";

  const filteredCount = useMemo(() => {
    if (!selectedFolder) return notes.length;
    return notes.filter((n) => n.id.startsWith(selectedFolder + "/")).length;
  }, [notes, selectedFolder]);

  return (
    <div className="h-full bg-bg-secondary flex flex-col select-none">
      {/* Drag region */}
      <div className="h-11 shrink-0" data-tauri-drag-region />

      {/* Header: breadcrumb + actions */}
      <div className="flex items-center justify-between pl-3 pr-3 pb-2 shrink-0">
        <div className="flex items-center gap-1.5 min-w-0">
          {onTogglePadNav && (
            <IconButton
              onClick={onTogglePadNav}
              title="Toggle Pads"
              className={padNavOpen ? "text-text-muted" : ""}
            >
              <PanelLeftIcon className="w-4.25 h-4.25 stroke-[1.5]" />
            </IconButton>
          )}
          <div className="flex flex-col min-w-0">
            {(!padNavOpen || selectedFolder) && activePad && (
              <span className="text-2xs font-medium uppercase tracking-wider text-text-muted truncate">
                {activePad.name}
              </span>
            )}
            <div className="flex items-center gap-1.5">
              <span className="font-medium text-sm truncate">
                {folderDisplayName}
              </span>
              <div className="text-text-muted font-medium text-2xs min-w-4.75 h-4.75 flex items-center justify-center px-1 bg-bg-muted rounded-sm pt-px shrink-0">
                {filteredCount}
              </div>
            </div>
          </div>
        </div>
        <div className="flex items-center gap-px shrink-0">
          <IconButton
            onClick={toggleSearch}
            title={`Search Notes (${mod}${isMac ? "" : "+"}${shift}${isMac ? "" : "+"}F)`}
          >
            {searchOpen ? (
              <SearchOffIcon className="w-4.25 h-4.25 stroke-[1.5]" />
            ) : (
              <SearchIcon className="w-4.25 h-4.25 stroke-[1.5]" />
            )}
          </IconButton>
          <IconButton
            variant="ghost"
            onClick={createNote}
            title={`New Note (${mod}${isMac ? "" : "+"}N)`}
          >
            <PlusIcon className="w-5.25 h-5.25 stroke-[1.4]" />
          </IconButton>
        </div>
      </div>

      {/* Scrollable area: search + notes */}
      <div className="flex-1 overflow-y-auto">
        {searchOpen && (
          <div className="sticky top-0 z-10 px-2 pt-2 bg-bg-secondary">
            <div className="relative">
              <Input
                ref={searchInputRef}
                type="text"
                value={inputValue}
                onChange={handleSearchChange}
                onKeyDown={handleSearchKeyDown}
                placeholder="Search notes..."
                className="h-9 pr-8 text-sm"
              />
              {inputValue && (
                <button
                  onClick={handleClearSearch}
                  tabIndex={-1}
                  className="absolute right-2 top-1/2 -translate-y-1/2 text-text-muted hover:text-text"
                >
                  <XIcon className="w-4.5 h-4.5 stroke-[1.5]" />
                </button>
              )}
            </div>
          </div>
        )}

        <NoteList selectedFolder={selectedFolder} />
      </div>

      {/* Footer */}
      <Footer onOpenSettings={onOpenSettings} />
    </div>
  );
}
