
import { invoke } from '@tauri-apps/api/core';

export async function getOsName(): Promise<string> {
  return await invoke<string>('get_os_name_handler');
}