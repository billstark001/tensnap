# 文件系统组件重构说明

## 概述

我们对文件系统相关组件进行了重大重构，主要目标是：

1. **提高代码可维护性** - 将大型组件分解为更小、更专注的组件
2. **增强模块化** - 创建独立、可重用的组件
3. **解耦组件** - 减少组件之间的直接依赖
4. **提供统一API** - 创建类似系统API的文件选择接口

## 主要改进

### 1. 组件分解

原来的 `FileSystemBrowser` 组件已被分解为以下更小的组件：

- **`Breadcrumbs`** - 路径导航组件
- **`ActionButtons`** - 操作按钮组件  
- **`FileItem`** - 单个文件/目录项组件
- **`EmptyState`** - 空状态显示组件
- **`CreateDialog`** - 创建新文件/目录对话框

### 2. 新增组件

- **`FilePickerProvider`** - 文件选择器上下文提供者
- **`ExportDialog`** - 导出选项对话框
- **`useFilePicker`** - 文件选择器Hook

### 3. API 改进

#### 文件选择器 API

新的文件选择器提供了类似系统API的使用方式：

```typescript
// 选择单个文件
const file = await filePicker.pickFile({
  title: '选择文件'
});

// 选择多个文件
const result = await filePicker.pickFiles({
  title: '选择多个文件',
  multiSelect: true
});

// 选择目录
const directory = await filePicker.pickDirectory({
  title: '选择目录'
});
```

## 文件结构

```
src/components/file-system/
├── index.ts                 # 统一导出
├── FilePickerProvider.tsx   # 文件选择器Provider
├── ExportDialog.tsx         # 导出对话框
├── FileSystemBrowser.tsx    # 重构后的主组件
├── Breadcrumbs.tsx          # 面包屑导航
├── ActionButtons.tsx        # 操作按钮
├── FileItem.tsx             # 文件项组件
├── EmptyState.tsx           # 空状态组件
└── CreateDialog.tsx         # 创建对话框
```

## 使用方法

### 1. 在应用根部添加Provider

```tsx
import { FilePickerProvider } from './components/file-system';
import { AdapterProvider } from './store/file-system/provider';

function App() {
  return (
    <AdapterProvider>
      <FilePickerProvider>
        {/* 你的应用内容 */}
      </FilePickerProvider>
    </AdapterProvider>
  );
}
```

### 2. 在组件中使用文件选择器

```tsx
import { useFilePicker } from './components/file-system';

function MyComponent() {
  const filePicker = useFilePicker();

  const handleSelectFile = async () => {
    const file = await filePicker.pickFile();
    if (file) {
      console.log('Selected:', file);
    }
  };

  return <button onClick={handleSelectFile}>选择文件</button>;
}
```

### 3. 使用导出对话框

```tsx
import { ExportDialog } from './components/file-system';

function MyComponent() {
  const [showExport, setShowExport] = useState(false);

  return (
    <>
      <button onClick={() => setShowExport(true)}>导出</button>
      <ExportDialog
        isOpen={showExport}
        onOpenChange={setShowExport}
        customOptions={[
          {
            key: 'custom',
            title: '自定义格式',
            description: '自定义导出格式',
            format: 'other',
            handler: () => console.log('Custom export')
          }
        ]}
      />
    </>
  );
}
```

## 优势

### 1. 更好的可维护性
- 每个组件职责单一，容易理解和修改
- 代码结构清晰，便于团队协作

### 2. 更高的复用性
- 辅助组件可以在其他地方独立使用
- 标准化的接口便于扩展

### 3. 更强的灵活性
- 可以轻松替换或自定义单个组件
- Provider模式支持全局状态管理

### 4. 更好的用户体验
- 统一的文件选择体验
- 可配置的导出选项

## 向后兼容性

重构后的组件保持了与原组件相同的公共接口，确保现有代码无需修改即可继续工作。

## 示例

完整的使用示例可以在 `src/examples/FilePickerUsage.tsx` 中找到。
