# Tauri Adapters

这个目录包含了 TenSnap 在 Tauri 环境中使用的文件系统适配器和文件选择器。

## 组件

### TauriFileSystemAdapter

原生文件系统访问适配器,通过 Tauri 的 Rust 后端提供完整的文件系统操作。

**功能:**

- 文件读写
- 目录创建和删除
- 文件列表
- 文件元数据获取

**实现文件:** `tauri-adapter.ts`

### TauriFilePicker

原生文件选择器,使用 Tauri 的 dialog API 提供系统原生的文件选择对话框。

**功能:**

- 打开文件对话框(单选/多选)
- 保存文件对话框
- 自动获取选中文件的元数据

**实现文件:** `tauri-file-picker.ts`

## 配置要求

### tauri.conf.json

确保以下配置已启用:

```json
{
  "build": {
    "withGlobalTauri": true
  },
  "tauri": {
    "allowlist": {
      "dialog": {
        "open": true,
        "save": true
      },
      "fs": {
        "all": true,
        "scope": ["**"]
      }
    }
  }
}
```

### Rust 命令

确保在 `src-tauri/src/main.rs` 中注册了以下命令:

- `create_file_handler`
- `read_file_handler`
- `delete_file_handler`
- `list_files_handler`
- `create_directory_handler`
- `read_directory_handler`
- `delete_directory_handler`
- `file_exists_handler`
- `directory_exists_handler`
- `get_file_metadata_handler`

## 使用示例

在 `TauriApp.tsx` 中:

```typescript
import { TauriFileSystemAdapter, TauriFilePicker } from './adapters';
import { registerFileSystemAdapter, registerFileSystemPicker } from 'tensnap-web/store/file-system/provider';

// 注册适配器和选择器
const adapter = await registerFileSystemAdapter({
  name: 'tauri',
  description: 'Native file system access via Tauri',
  supported: typeof window !== 'undefined' && '__TAURI__' in window,
  create: () => new TauriFileSystemAdapter()
});

await registerFileSystemPicker(new TauriFilePicker());
```

## 注意事项

1. **全局 Tauri API**: `TauriFilePicker` 依赖 `window.__TAURI__` 全局对象,需要在配置中启用 `withGlobalTauri`。

2. **权限控制**: 文件系统操作受 Tauri 的 allowlist 控制,确保在 `tauri.conf.json` 中正确配置权限。

3. **跨平台**: 这些适配器在所有 Tauri 支持的平台(Windows, macOS, Linux)上都能工作。

4. **安全性**: Tauri 的文件系统 API 会遵循操作系统的权限模型,提供安全的文件访问。

## 开发

如果需要添加新功能:

1. 在 Rust 端添加新的命令处理函数(`src-tauri/src/commands/file_system.rs`)
2. 在 TypeScript 适配器中调用新命令(`invoke` 函数)
3. 更新类型定义以保持类型安全

## 测试

在 Tauri 应用中测试文件系统功能:

```bash
cd packages/tensnap-tauri
pnpm dev
```

然后在应用中:

- 尝试创建、读取、删除文件
- 测试文件选择对话框
- 验证跨平台兼容性
