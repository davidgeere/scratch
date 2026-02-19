import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { open } from "@tauri-apps/plugin-dialog";
import { Menu, MenuItem, PredefinedMenuItem } from "@tauri-apps/api/menu";
import { useNotes } from "../../context/NotesContext";
import { usePads } from "../../context/PadsContext";
import { useTheme } from "../../context/ThemeContext";
import {
  FolderIcon,
  PlusIcon,
  ChevronRightIcon,
} from "../icons";

interface FolderNode {
  name: string;
  path: string;
  noteCount: number;
  children: FolderNode[];
}

function buildFolderTree(noteIds: string[]): FolderNode[] {
  const folderCounts = new Map<string, number>();
  let rootCount = 0;

  for (const id of noteIds) {
    const lastSlash = id.lastIndexOf("/");
    if (lastSlash === -1) {
      rootCount++;
    } else {
      const folderPath = id.substring(0, lastSlash);
      const parts = folderPath.split("/");
      for (let i = 1; i <= parts.length; i++) {
        const prefix = parts.slice(0, i).join("/");
        folderCounts.set(prefix, (folderCounts.get(prefix) || 0) + (i === parts.length ? 1 : 0));
      }
    }
  }

  const tree = new Map<string, FolderNode>();

  for (const [path] of folderCounts) {
    const parts = path.split("/");
    let parentMap = tree;

    for (let i = 0; i < parts.length; i++) {
      const partPath = parts.slice(0, i + 1).join("/");
      if (!parentMap.has(partPath)) {
        const node: FolderNode = {
          name: parts[i],
          path: partPath,
          noteCount: 0,
          children: [],
        };
        parentMap.set(partPath, node);
      }
    }
  }

  const allNodes = new Map<string, FolderNode>();
  for (const [path] of folderCounts) {
    const parts = path.split("/");
    for (let i = 0; i < parts.length; i++) {
      const partPath = parts.slice(0, i + 1).join("/");
      if (!allNodes.has(partPath)) {
        allNodes.set(partPath, {
          name: parts[i],
          path: partPath,
          noteCount: 0,
          children: [],
        });
      }
    }
  }

  for (const id of noteIds) {
    const lastSlash = id.lastIndexOf("/");
    if (lastSlash !== -1) {
      const folderPath = id.substring(0, lastSlash);
      const node = allNodes.get(folderPath);
      if (node) node.noteCount++;
    }
  }

  for (const [path, node] of allNodes) {
    const lastSlash = path.lastIndexOf("/");
    if (lastSlash !== -1) {
      const parentPath = path.substring(0, lastSlash);
      const parent = allNodes.get(parentPath);
      if (parent) {
        parent.children.push(node);
      }
    }
  }

  const roots: FolderNode[] = [];
  for (const [path, node] of allNodes) {
    if (!path.includes("/")) {
      roots.push(node);
    }
  }

  roots.sort((a, b) => a.name.localeCompare(b.name));
  const sortChildren = (nodes: FolderNode[]) => {
    nodes.sort((a, b) => a.name.localeCompare(b.name));
    nodes.forEach((n) => sortChildren(n.children));
  };
  roots.forEach((r) => sortChildren(r.children));

  return roots;
}

function totalNotes(node: FolderNode): number {
  let count = node.noteCount;
  for (const child of node.children) {
    count += totalNotes(child);
  }
  return count;
}

interface PadNavProps {
  selectedFolder: string | null;
  onSelectFolder: (folder: string | null) => void;
}

export function PadNav({ selectedFolder, onSelectFolder }: PadNavProps) {
  const { notes } = useNotes();
  const { pads, activePadId, switchPad, addPad, removePad, updatePad } = usePads();
  const { reloadSettings } = useTheme();
  const [collapsedFolders, setCollapsedFolders] = useState<Set<string>>(() => {
    try {
      const stored = localStorage.getItem("scratch-collapsed-folders");
      return stored ? new Set(JSON.parse(stored)) : new Set();
    } catch {
      return new Set();
    }
  });
  const [renamingId, setRenamingId] = useState<string | null>(null);
  const [renameValue, setRenameValue] = useState("");
  const renameInputRef = useRef<HTMLInputElement>(null);

  useEffect(() => {
    if (renamingId) {
      requestAnimationFrame(() => renameInputRef.current?.focus());
    }
  }, [renamingId]);

  const folderTree = useMemo(
    () => buildFolderTree(notes.map((n) => n.id)),
    [notes]
  );

  const toggleFolderCollapse = useCallback((folderPath: string) => {
    setCollapsedFolders((prev) => {
      const next = new Set(prev);
      if (next.has(folderPath)) next.delete(folderPath);
      else next.add(folderPath);
      try { localStorage.setItem("scratch-collapsed-folders", JSON.stringify([...next])); } catch { /* */ }
      return next;
    });
  }, []);

  const handleSelectPad = useCallback(
    async (padId: string) => {
      if (padId !== activePadId) {
        await switchPad(padId);
        await reloadSettings();
      }
      onSelectFolder(null);
    },
    [activePadId, switchPad, reloadSettings, onSelectFolder]
  );

  const handleAddPad = useCallback(async () => {
    try {
      const selected = await open({
        directory: true,
        multiple: false,
        title: "Choose Folder for New Pad",
      });
      if (selected && typeof selected === "string") {
        const name = selected.split("/").filter(Boolean).pop() || "Notes";
        await addPad(name, selected);
        await reloadSettings();
      }
    } catch (err) {
      console.error("Failed to add pad:", err);
    }
  }, [addPad, reloadSettings]);

  const handlePadContextMenu = useCallback(
    async (e: React.MouseEvent, padId: string, padName: string) => {
      e.preventDefault();
      e.stopPropagation();
      const menu = await Menu.new({
        items: [
          await MenuItem.new({
            text: "Rename",
            action: () => {
              setRenamingId(padId);
              setRenameValue(padName);
            },
          }),
          await PredefinedMenuItem.new({ item: "Separator" }),
          await MenuItem.new({
            text: "Remove",
            action: async () => {
              await removePad(padId);
            },
          }),
        ],
      });
      await menu.popup();
    },
    [removePad]
  );

  const handleRenameSubmit = useCallback(
    async (padId: string) => {
      const trimmed = renameValue.trim();
      if (trimmed) {
        await updatePad(padId, trimmed);
      }
      setRenamingId(null);
    },
    [renameValue, updatePad]
  );

  const renderFolder = (node: FolderNode, depth: number) => {
    const isCollapsed = collapsedFolders.has(node.path);
    const isSelected = selectedFolder === node.path;
    const hasChildren = node.children.length > 0;
    const total = totalNotes(node);

    return (
      <div key={node.path}>
        <button
          onClick={() => onSelectFolder(isSelected ? null : node.path)}
          className={`flex items-center gap-2 w-full py-1.5 pr-2.5 text-[13px] transition-colors rounded-lg ${
            isSelected
              ? "bg-bg-muted text-text font-medium"
              : "text-text-muted hover:bg-bg-muted/60 hover:text-text"
          }`}
          style={{ paddingLeft: `${18 + depth * 18}px` }}
        >
          {hasChildren ? (
            <button
              onClick={(e) => {
                e.stopPropagation();
                toggleFolderCollapse(node.path);
              }}
              className="shrink-0 p-0"
            >
              <ChevronRightIcon
                className={`w-3.5 h-3.5 stroke-[2] transition-transform duration-150 ${isCollapsed ? "" : "rotate-90"}`}
              />
            </button>
          ) : (
            <span className="w-3.5 shrink-0" />
          )}
          <FolderIcon className="w-4 h-4 stroke-[1.5] shrink-0 opacity-60" />
          <span className="truncate">{node.name}</span>
          {total > 0 && (
            <span className="ml-auto text-xs text-text-muted/50 shrink-0">{total}</span>
          )}
        </button>

        {!isCollapsed && hasChildren && (
          <div>
            {node.children.map((child) => renderFolder(child, depth + 1))}
          </div>
        )}
      </div>
    );
  };

  return (
    <div className="flex-1 min-h-0 bg-bg-tertiary flex flex-col select-none rounded-2xl mt-2 overflow-hidden">
      {/* Top spacing for title bar drag region */}
      <div className="h-9 shrink-0" />

      {/* Pad sections with folder trees */}
      <div className="flex-1 overflow-y-auto px-3 pb-3">
        {pads.map((pad) => {
          const isActive = pad.id === activePadId;

          return (
            <div key={pad.id} className="mb-3">
              {/* Pad header — click to switch, mutually exclusive */}
              <div
                className="flex items-center gap-2 group"
                onContextMenu={(e) => handlePadContextMenu(e, pad.id, pad.name)}
              >
                <button
                  onClick={() => handleSelectPad(pad.id)}
                  className="shrink-0 p-0.5 text-text-muted/50 hover:text-text-muted transition-colors"
                >
                  <ChevronRightIcon
                    className={`w-3.5 h-3.5 stroke-[2.5] transition-transform duration-150 ${isActive ? "rotate-90" : ""}`}
                  />
                </button>

                {renamingId === pad.id ? (
                  <input
                    ref={renameInputRef}
                    value={renameValue}
                    onChange={(e) => setRenameValue(e.target.value)}
                    onBlur={() => handleRenameSubmit(pad.id)}
                    onKeyDown={(e) => {
                      if (e.key === "Enter") handleRenameSubmit(pad.id);
                      if (e.key === "Escape") setRenamingId(null);
                    }}
                    className="flex-1 bg-transparent text-[11px] font-semibold uppercase tracking-wider outline-none border-b border-border min-w-0"
                    onClick={(e) => e.stopPropagation()}
                  />
                ) : (
                  <button
                    onClick={() => handleSelectPad(pad.id)}
                    className={`flex-1 text-left text-[11px] font-semibold uppercase tracking-wider truncate py-2 transition-colors ${
                      isActive ? "text-text" : "text-text-muted/70 hover:text-text"
                    }`}
                  >
                    {pad.name}
                  </button>
                )}

                <button
                  onClick={handleAddPad}
                  className="shrink-0 p-0.5 text-text-muted/30 opacity-0 group-hover:opacity-100 hover:text-text-muted transition-all"
                  title="Add Pad"
                >
                  <PlusIcon className="w-4 h-4 stroke-[1.5]" />
                </button>
              </div>

              {/* Folder tree — only for active pad (mutually exclusive) */}
              {isActive && (
                <div className="mt-1.5">
                  <button
                    onClick={() => onSelectFolder(null)}
                    className={`flex items-center gap-2 w-full py-1.5 pl-5 pr-2.5 text-[13px] transition-colors rounded-lg ${
                      selectedFolder === null
                        ? "bg-bg-muted text-text font-medium"
                        : "text-text-muted hover:bg-bg-muted/60 hover:text-text"
                    }`}
                  >
                    <FolderIcon className="w-4 h-4 stroke-[1.5] shrink-0 opacity-60" />
                    <span className="truncate">All Notes</span>
                    <span className="ml-auto text-xs text-text-muted/50 shrink-0">{notes.length}</span>
                  </button>

                  {folderTree.map((folder) => renderFolder(folder, 1))}
                </div>
              )}
            </div>
          );
        })}

        {/* Add Pad */}
        <button
          onClick={handleAddPad}
          className="flex items-center gap-2 w-full px-2.5 py-2 mt-1 text-[13px] text-text-muted/50 hover:text-text-muted hover:bg-bg-muted/40 transition-colors rounded-lg"
        >
          <PlusIcon className="w-4 h-4 stroke-[1.5]" />
          Add Pad
        </button>
      </div>
    </div>
  );
}
