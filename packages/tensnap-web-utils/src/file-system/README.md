# File System Components

一套用于在浏览器环境中实现文件选择和管理功能的 React 组件库。

## 设计目的

在没有原生文件选择器 API 但有文件系统 API 的环境下（如使用 IndexedDB 模拟的文件系统），提供类似桌面应用的文件选择、浏览和管理功能。

### 应用场景

- **Web 应用**：使用 IndexedDB 存储文件，需要提供友好的文件管理界面
- **离线应用**：PWA 应用中管理本地存储的文件
- **跨平台应用**：需要统一的文件管理体验，而不依赖系统原生文件选择器

## 主要组件

### FileSystemBrowser

文件系统浏览器组件，提供完整的文件浏览、管理功能。

```tsx
import { FileSystemBrowser } from 'tensnap-web-utils/file-system';

<FileSystemBrowser
  fileSystem={myFileSystemAdapter}
  initialPath="/"
  onFileSelect={(file) => console.log('Selected:', file)}
  allowUpload={true}
  multiSelect={false}
/>
```

**Props:**

- `fileSystem`: FileSystemAdapter - 文件系统适配器实例
- `initialPath?`: string - 初始路径，默认为 "/"
- `onFileSelect?`: (file: DirectoryEntry) => void - 文件选择回调
- `onDirectorySelect?`: (directory: DirectoryEntry) => void - 目录选择回调
- `allowUpload?`: boolean - 是否允许上传文件，默认 true
- `multiSelect?`: boolean - 是否支持多选，默认 false
- `className?`: string - 自定义 CSS 类名

### FilePickerProvider

文件选择器上下文提供者，在应用根部提供文件选择功能。

```tsx
import { FilePickerProvider, useFilePicker } from 'tensnap-web-utils/file-system';

function App() {
  return (
    <FilePickerProvider fileSystem={myFileSystemAdapter}>
      <YourApp />
    </FilePickerProvider>
  );
}

function YourComponent() {
  const { pickFiles } = useFilePicker();
  
  const handleClick = async () => {
    const files = await pickFiles({
      title: '选择文件',
      multiSelect: false,
      allowUpload: true
    });
    console.log('Selected files:', files);
  };
  
  return <button onClick={handleClick}>选择文件</button>;
}
```

**FilePickerOptions:**

- `title?`: string - 对话框标题
- `multiSelect?`: boolean - 是否支持多选
- `mode?`: 'open' | 'save' - 打开或保存模式
- `allowUpload?`: boolean - 是否允许上传文件

### InBrowserFilePicker

独立的文件选择器类，可在非 React 环境或需要独立实例时使用。

```tsx
import { InBrowserFilePicker } from 'tensnap-web-utils/file-system';

// 创建一个隐藏的容器元素
const container = document.createElement('div');
container.style.display = 'none';
document.body.appendChild(container);

// 创建文件选择器实例
const picker = new InBrowserFilePicker(container, myFileSystemAdapter);

// 初始化
await picker.initialize();

// 使用
const files = await picker.pickFiles({
  title: '选择文件',
  multiSelect: false
});

// 清理
await picker.cleanup();
```

### ExportDialog

导出对话框组件，支持将文件系统内容导出为 JSON 或 ZIP 格式。

```tsx
import { ExportDialog } from 'tensnap-web-utils/file-system';

const [showExport, setShowExport] = useState(false);

<ExportDialog
  open={showExport}
  onOpenChange={setShowExport}
  fileSystem={myFileSystemAdapter}
  currentPath="/my-folder"
  customOptions={[
    {
      key: 'csv',
      title: 'CSV 格式',
      description: '导出为 CSV 文件',
      format: 'other',
      handler: async () => {
        // 自定义导出逻辑
      }
    }
  ]}
/>
```

## 工具函数

库还提供了一系列实用的工具函数：

```tsx
import {
  formatFileSize,      // 格式化文件大小
  formatDate,          // 格式化日期
  normalizePath,       // 规范化路径
  joinPath,            // 连接路径
  getParentPath,       // 获取父路径
  getBaseName,         // 获取文件/目录名
  parseBreadcrumbs,    // 解析路径为面包屑
  validateName,        // 验证文件/目录名
  readFileContent,     // 从 File 对象读取内容
  calculateChecksum    // 计算校验和
} from 'tensnap-web-utils/file-system';

// 示例
console.log(formatFileSize(1024)); // "1.0 KB"
console.log(normalizePath('/path//to///file')); // "/path/to/file"
console.log(joinPath('/folder', 'subfolder', 'file.txt')); // "/folder/subfolder/file.txt"
```

## 子组件

以下子组件也可以独立使用：

- `Breadcrumbs` - 路径面包屑导航
- `ActionButtons` - 操作按钮组
- `FileItem` - 文件/目录项显示
- `EmptyState` - 空状态显示
- `CreateDialog` - 创建文件/目录对话框

详细的 Props 类型定义请参考各组件的 TypeScript 类型声明。

## 完整示例

```tsx
import React, { useState } from 'react';
import { 
  FilePickerProvider, 
  useFilePicker,
  FileSystemBrowser,
  ExportDialog
} from 'tensnap-web-utils/file-system';
import { IndexedDBAdapter } from 'tensnap-web-utils/adapters/indexeddb';

// 创建文件系统适配器
const fileSystem = new IndexedDBAdapter('my-app-fs');
await fileSystem.initialize();

function App() {
  return (
    <FilePickerProvider fileSystem={fileSystem}>
      <MyApp />
    </FilePickerProvider>
  );
}

function MyApp() {
  const { pickFiles } = useFilePicker();
  const [showBrowser, setShowBrowser] = useState(false);
  const [showExport, setShowExport] = useState(false);
  
  const handlePickFile = async () => {
    const files = await pickFiles({
      title: '选择要打开的文件',
      multiSelect: false
    });
    
    if (files.length > 0) {
      console.log('Selected file:', files[0]);
    }
  };
  
  return (
    <div>
      <button onClick={handlePickFile}>打开文件</button>
      <button onClick={() => setShowBrowser(true)}>浏览文件</button>
      <button onClick={() => setShowExport(true)}>导出</button>
      
      {showBrowser && (
        <dialog open>
          <FileSystemBrowser
            fileSystem={fileSystem}
            onFileSelect={(file) => {
              console.log('Selected:', file);
              setShowBrowser(false);
            }}
          />
          <button onClick={() => setShowBrowser(false)}>关闭</button>
        </dialog>
      )}
      
      <ExportDialog
        open={showExport}
        onOpenChange={setShowExport}
        fileSystem={fileSystem}
      />
    </div>
  );
}
```

## 特性

### ✅ 完整的文件管理功能

- 浏览文件和目录
- 创建新文件和目录
- 删除文件和目录
- 上传文件（拖拽或点击）
- 导出文件系统内容

### ✅ 灵活的集成方式

- React Hook 方式（useFilePicker）
- React 组件方式（FileSystemBrowser）
- 独立类方式（InBrowserFilePicker）

### ✅ 类型安全

- 完整的 TypeScript 类型定义
- 严格的类型检查

### ✅ 可定制化

- 支持自定义样式
- 支持自定义导出格式
- 灵活的回调函数

## 依赖

- React 18+
- @radix-ui/react-dialog
- @radix-ui/react-dropdown-menu
- jszip (用于 ZIP 导出功能)

## 注意事项

1. **文件系统适配器**：组件需要一个实现了 `FileSystemAdapter` 接口的适配器实例
2. **初始化**：使用前需要确保文件系统适配器已经初始化
3. **路径格式**：所有路径都使用 Unix 风格的斜杠 `/`
4. **浏览器兼容性**：需要支持 IndexedDB 的现代浏览器

## 许可证

MIT
