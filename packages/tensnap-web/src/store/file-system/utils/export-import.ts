import JSZip from 'jszip';
import { saveAs } from 'file-saver';
import { FileContent, DirectoryMetadata, DirectoryEntry } from '../../../types/file';

export interface ExportData {
  version: string;
  exportDate: Date;
  rootDirectory: DirectoryMetadata;
  contents: ExportEntry[];
}

export interface ExportEntry {
  type: 'file' | 'directory';
  path: string;
  metadata: any;
  content?: string | ArrayBuffer;
}

export class FileSystemExporter {
  private version = '2.0.0';

  async exportAsJSON(
    directory: DirectoryMetadata,
    getAllContents: (path: string) => Promise<DirectoryEntry[]>,
    getFileContent: (path: string) => Promise<FileContent | null>
  ): Promise<Blob> {
    const exportData: ExportData = {
      version: this.version,
      exportDate: new Date(),
      rootDirectory: directory,
      contents: await this.collectAllContents(directory.path, getAllContents, getFileContent)
    };

    const jsonString = JSON.stringify(exportData, null, 2);
    return new Blob([jsonString], { type: 'application/json' });
  }

  async exportAsZip(
    directory: DirectoryMetadata,
    getAllContents: (path: string) => Promise<DirectoryEntry[]>,
    getFileContent: (path: string) => Promise<FileContent | null>
  ): Promise<Blob> {
    const zip = new JSZip();

    // Add metadata file
    const exportData: ExportData = {
      version: this.version,
      exportDate: new Date(),
      rootDirectory: directory,
      contents: []
    };

    zip.file('_metadata.json', JSON.stringify(exportData, null, 2));

    // Add all files and directories
    await this.addContentsToZip(zip, directory.path, getAllContents, getFileContent);

    return await zip.generateAsync({ type: 'blob' });
  }

  private async collectAllContents(
    directoryPath: string,
    getAllContents: (path: string) => Promise<DirectoryEntry[]>,
    getFileContent: (path: string) => Promise<FileContent | null>,
    visited = new Set<string>()
  ): Promise<ExportEntry[]> {
    if (visited.has(directoryPath)) {
      return [];
    }
    visited.add(directoryPath);

    const entries: ExportEntry[] = [];
    const contents = await getAllContents(directoryPath);

    for (const entry of contents) {
      const exportEntry: ExportEntry = {
        type: entry.type,
        path: entry.path,
        metadata: entry
      };

      if (entry.type === 'file') {
        const fileContent = await getFileContent(entry.path);
        if (fileContent) {
          exportEntry.content = fileContent.content;
        }
      } else if (entry.type === 'directory') {
        // Recursively collect subdirectory contents
        const subEntries = await this.collectAllContents(
          entry.path,
          getAllContents,
          getFileContent,
          visited
        );
        entries.push(...subEntries);
      }

      entries.push(exportEntry);
    }

    return entries;
  }

  private async addContentsToZip(
    zip: JSZip,
    directoryPath: string,
    getAllContents: (path: string) => Promise<DirectoryEntry[]>,
    getFileContent: (path: string) => Promise<FileContent | null>,
    visited = new Set<string>()
  ): Promise<void> {
    if (visited.has(directoryPath)) {
      return;
    }
    visited.add(directoryPath);

    const contents = await getAllContents(directoryPath);

    for (const entry of contents) {
      const relativePath = entry.path.startsWith('/')
        ? entry.path.slice(1)
        : entry.path;

      if (entry.type === 'file') {
        const fileContent = await getFileContent(entry.path);
        if (fileContent) {
          if (typeof fileContent.content === 'string') {
            zip.file(relativePath, fileContent.content);
          } else {
            zip.file(relativePath, fileContent.content);
          }
        }
      } else if (entry.type === 'directory') {
        // Create directory and recursively add its contents
        zip.folder(relativePath);
        await this.addContentsToZip(
          zip,
          entry.path,
          getAllContents,
          getFileContent,
          visited
        );
      }
    }
  }

  downloadBlob(blob: Blob, filename: string): void {
    saveAs(blob, filename);
  }
}
