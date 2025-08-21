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
  private version = '1.0.0';

  async exportAsJSON(
    directory: DirectoryMetadata,
    getAllContents: (path: string) => Promise<DirectoryEntry[]>,
    getFileContent: (id: string) => Promise<FileContent | null>
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
    getFileContent: (id: string) => Promise<FileContent | null>
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
    getFileContent: (id: string) => Promise<FileContent | null>,
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
        path: entry.metadata.path,
        metadata: entry.metadata
      };

      if (entry.type === 'file') {
        const fileContent = await getFileContent(entry.metadata.id);
        if (fileContent) {
          exportEntry.content = fileContent.content;
        }
      } else if (entry.type === 'directory') {
        // Recursively collect subdirectory contents
        const subEntries = await this.collectAllContents(
          entry.metadata.path,
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
    getFileContent: (id: string) => Promise<FileContent | null>,
    visited = new Set<string>()
  ): Promise<void> {
    if (visited.has(directoryPath)) {
      return;
    }
    visited.add(directoryPath);

    const contents = await getAllContents(directoryPath);

    for (const entry of contents) {
      const relativePath = entry.metadata.path.startsWith('/') 
        ? entry.metadata.path.slice(1) 
        : entry.metadata.path;

      if (entry.type === 'file') {
        const fileContent = await getFileContent(entry.metadata.id);
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
          entry.metadata.path,
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

export class FileSystemImporter {
  async importFromJSON(
    data: Blob,
    createFile: (metadata: any, content: ArrayBuffer | string) => Promise<FileContent>,
    createDirectory: (metadata: any) => Promise<DirectoryMetadata>
  ): Promise<DirectoryMetadata> {
    const text = await data.text();
    const importData: ExportData = JSON.parse(text);
    
    // Validate version compatibility
    if (!this.isVersionCompatible(importData.version)) {
      throw new Error(`Unsupported export version: ${importData.version}`);
    }

    // Create directories first, then files
    const directories = importData.contents.filter(entry => entry.type === 'directory');
    const files = importData.contents.filter(entry => entry.type === 'file');

    // Sort directories by depth to create parent directories first
    directories.sort((a, b) => a.path.split('/').length - b.path.split('/').length);

    let rootDirectory: DirectoryMetadata;

    // Create directories
    for (const dirEntry of directories) {
      const directory = await createDirectory({
        name: dirEntry.metadata.name,
        path: dirEntry.path,
        parentPath: this.getParentPath(dirEntry.path),
        description: dirEntry.metadata.description,
        tags: dirEntry.metadata.tags
      });
      
      if (dirEntry.path === importData.rootDirectory.path) {
        rootDirectory = directory;
      }
    }

    // Create files
    for (const fileEntry of files) {
      if (fileEntry.content !== undefined) {
        await createFile({
          name: fileEntry.metadata.name,
          path: fileEntry.path,
          parentPath: this.getParentPath(fileEntry.path),
          size: fileEntry.metadata.size,
          mimeType: fileEntry.metadata.mimeType,
          tags: fileEntry.metadata.tags,
          description: fileEntry.metadata.description
        }, fileEntry.content);
      }
    }

    return rootDirectory!;
  }

  async importFromZip(
    data: Blob,
    createFile: (metadata: any, content: ArrayBuffer | string) => Promise<FileContent>,
    createDirectory: (metadata: any) => Promise<DirectoryMetadata>
  ): Promise<DirectoryMetadata> {
    const zip = await JSZip.loadAsync(data);
    
    // Read metadata if available
    let rootDirectoryName = 'imported';
    const metadataFile = zip.file('_metadata.json');
    if (metadataFile) {
      const metadataText = await metadataFile.async('text');
      const metadata: ExportData = JSON.parse(metadataText);
      rootDirectoryName = metadata.rootDirectory.name;
    }

    // Create root directory
    const rootDirectory = await createDirectory({
      name: rootDirectoryName,
      path: `/${rootDirectoryName}`,
      parentPath: '/'
    });

    // Process all files and directories in the zip
    const entries = Object.keys(zip.files).filter(path => path !== '_metadata.json');
    
    // Create directories first
    const directories = entries
      .filter(path => zip.files[path].dir)
      .sort((a, b) => a.split('/').length - b.split('/').length);
    
    for (const dirPath of directories) {
      const fullPath = `/${rootDirectoryName}/${dirPath}`;
      await createDirectory({
        name: dirPath.split('/').pop() || '',
        path: fullPath,
        parentPath: this.getParentPath(fullPath)
      });
    }

    // Create files
    const files = entries.filter(path => !zip.files[path].dir);
    
    for (const filePath of files) {
      const file = zip.files[filePath];
      const content = await file.async('arraybuffer');
      const fullPath = `/${rootDirectoryName}/${filePath}`;
      
      await createFile({
        name: filePath.split('/').pop() || '',
        path: fullPath,
        parentPath: this.getParentPath(fullPath),
        size: content.byteLength,
        mimeType: this.getMimeType(filePath)
      }, content);
    }

    return rootDirectory;
  }

  private isVersionCompatible(version: string): boolean {
    // Simple version compatibility check
    const [major] = version.split('.');
    return major === '1';
  }

  private getParentPath(path: string): string {
    const normalizedPath = path.replace(/\\/g, '/').replace(/\/+/g, '/');
    if (normalizedPath === '/') return '/';
    
    const lastSlash = normalizedPath.lastIndexOf('/');
    return lastSlash <= 0 ? '/' : normalizedPath.substring(0, lastSlash);
  }

  private getMimeType(filename: string): string {
    const extension = filename.split('.').pop()?.toLowerCase();
    const mimeTypes: Record<string, string> = {
      'txt': 'text/plain',
      'json': 'application/json',
      'html': 'text/html',
      'css': 'text/css',
      'js': 'application/javascript',
      'ts': 'text/typescript',
      'png': 'image/png',
      'jpg': 'image/jpeg',
      'jpeg': 'image/jpeg',
      'gif': 'image/gif',
      'svg': 'image/svg+xml',
      'pdf': 'application/pdf',
      'zip': 'application/zip'
    };
    
    return mimeTypes[extension || ''] || 'application/octet-stream';
  }
}
