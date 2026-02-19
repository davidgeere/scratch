import { invoke } from "@tauri-apps/api/core";
import type { PadConfig, PadsInfo } from "../types/note";

export async function listPads(): Promise<PadsInfo> {
  return invoke("list_pads");
}

export async function addPad(
  name: string,
  path: string,
  fileExtensions?: string[],
): Promise<PadConfig> {
  return invoke("add_pad", { name, path, fileExtensions });
}

export async function removePad(padId: string): Promise<void> {
  return invoke("remove_pad", { padId });
}

export async function switchPad(padId: string): Promise<void> {
  return invoke("switch_pad", { padId });
}

export async function updatePad(
  padId: string,
  name?: string,
  fileExtensions?: string[],
): Promise<PadConfig> {
  return invoke("update_pad", { padId, name, fileExtensions });
}
