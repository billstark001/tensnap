use std::fs;
use std::path::{Path, PathBuf};
use tauri::api::dialog;
use serde::{Deserialize, Serialize};

#[derive(Debug, Serialize, Deserialize)]
pub struct FileMetadata {
    pub name: String,
    pub path: String,
    pub parent_path: String,
    pub size: u64,
    pub mime_type: String,
    pub created_at: i64,
    pub modified_at: i64,
    pub tags: Option<Vec<String>>,
    pub description: Option<String>,
}

#[derive(Debug, Serialize, Deserialize)]
pub struct DirectoryMetadata {
    pub name: String,
    pub path: String,
    pub parent_path: String,
    pub created_at: i64,
    pub modified_at: i64,
    pub description: Option<String>,
    pub tags: Option<Vec<String>>,
}

#[derive(Debug, Serialize, Deserialize)]
pub struct DirectoryEntry {
    pub r#type: String, // "file" or "directory"
    pub name: String,
    pub path: String,
}

// File operations
#[tauri::command]
pub async fn create_file_handler(path: String, content: Vec<u8>) -> Result<FileMetadata, String> {
    let file_path = Path::new(&path);
    
    if let Some(parent) = file_path.parent() {
        fs::create_dir_all(parent).map_err(|e| format!("Failed to create parent directories: {}", e))?;
    }
    
    fs::write(&path, content).map_err(|e| format!("Failed to write file: {}", e))?;
    
    get_file_metadata_handler(path).await
}

#[tauri::command]
pub async fn read_file_handler(path: String) -> Result<Vec<u8>, String> {
    fs::read(&path).map_err(|e| format!("Failed to read file: {}", e))
}

#[tauri::command]
pub async fn write_file_handler(path: String, content: Vec<u8>) -> Result<FileMetadata, String> {
    fs::write(&path, content).map_err(|e| format!("Failed to write file: {}", e))?;
    get_file_metadata_handler(path).await
}

#[tauri::command]
pub async fn delete_file_handler(path: String) -> Result<(), String> {
    fs::remove_file(&path).map_err(|e| format!("Failed to delete file: {}", e))
}

#[tauri::command]
pub async fn list_files_handler(directory_path: Option<String>) -> Result<Vec<FileMetadata>, String> {
    let path = directory_path.unwrap_or_else(|| ".".to_string());
    let dir_path = Path::new(&path);
    
    let entries = fs::read_dir(dir_path).map_err(|e| format!("Failed to read directory: {}", e))?;
    
    let mut files = Vec::new();
    for entry in entries {
        let entry = entry.map_err(|e| format!("Failed to read directory entry: {}", e))?;
        let file_type = entry.file_type().map_err(|e| format!("Failed to get file type: {}", e))?;
        
        if file_type.is_file() {
            let path_str = entry.path().to_string_lossy().to_string();
            if let Ok(metadata) = get_file_metadata_handler(path_str).await {
                files.push(metadata);
            }
        }
    }
    
    Ok(files)
}

// Directory operations
#[tauri::command]
pub async fn create_directory_handler(path: String, allow_exist: Option<bool>) -> Result<DirectoryMetadata, String> {
    let allow_exist = allow_exist.unwrap_or(false);
    
    if allow_exist {
        fs::create_dir_all(&path).map_err(|e| format!("Failed to create directory: {}", e))?;
    } else {
        fs::create_dir(&path).map_err(|e| format!("Failed to create directory: {}", e))?;
    }
    
    get_directory_metadata(&path)
}

#[tauri::command]
pub async fn read_directory_handler(path: String) -> Result<Vec<DirectoryEntry>, String> {
    let dir_path = Path::new(&path);
    let entries = fs::read_dir(dir_path).map_err(|e| format!("Failed to read directory: {}", e))?;
    
    let mut result = Vec::new();
    for entry in entries {
        let entry = entry.map_err(|e| format!("Failed to read directory entry: {}", e))?;
        let file_type = entry.file_type().map_err(|e| format!("Failed to get file type: {}", e))?;
        let name = entry.file_name().to_string_lossy().to_string();
        let path = entry.path().to_string_lossy().to_string();
        
        let entry_type = if file_type.is_file() {
            "file"
        } else if file_type.is_dir() {
            "directory"
        } else {
            continue; // Skip symlinks and other special files
        };
        
        result.push(DirectoryEntry {
            r#type: entry_type.to_string(),
            name,
            path,
        });
    }
    
    Ok(result)
}

#[tauri::command]
pub async fn delete_directory_handler(path: String, recursive: Option<bool>) -> Result<(), String> {
    let recursive = recursive.unwrap_or(false);
    
    if recursive {
        fs::remove_dir_all(&path).map_err(|e| format!("Failed to delete directory recursively: {}", e))
    } else {
        fs::remove_dir(&path).map_err(|e| format!("Failed to delete directory: {}", e))
    }
}

// Utility functions
#[tauri::command]
pub async fn file_exists_handler(path: String) -> Result<bool, String> {
    Ok(Path::new(&path).is_file())
}

#[tauri::command]
pub async fn directory_exists_handler(path: String) -> Result<bool, String> {
    Ok(Path::new(&path).is_dir())
}

#[tauri::command]
pub async fn get_file_metadata_handler(path: String) -> Result<FileMetadata, String> {
    let file_path = Path::new(&path);
    let metadata = fs::metadata(&path).map_err(|e| format!("Failed to get file metadata: {}", e))?;
    
    let file_name = file_path.file_name()
        .and_then(|n| n.to_str())
        .unwrap_or("")
        .to_string();
    
    let parent_path = file_path.parent()
        .map(|p| p.to_string_lossy().to_string())
        .unwrap_or_else(|| ".".to_string());
    
    let mime_type = guess_mime_type(&path);
    
    Ok(FileMetadata {
        name: file_name,
        path: path.clone(),
        parent_path,
        size: metadata.len(),
        mime_type,
        created_at: metadata.created()
            .map(|t| t.duration_since(std::time::UNIX_EPOCH).unwrap_or_default().as_secs() as i64)
            .unwrap_or(0),
        modified_at: metadata.modified()
            .map(|t| t.duration_since(std::time::UNIX_EPOCH).unwrap_or_default().as_secs() as i64)
            .unwrap_or(0),
        tags: None,
        description: None,
    })
}

#[tauri::command]
pub async fn copy_file_handler(source_path: String, target_path: String) -> Result<FileMetadata, String> {
    if let Some(parent) = Path::new(&target_path).parent() {
        fs::create_dir_all(parent).map_err(|e| format!("Failed to create parent directories: {}", e))?;
    }
    
    fs::copy(&source_path, &target_path).map_err(|e| format!("Failed to copy file: {}", e))?;
    get_file_metadata_handler(target_path).await
}

#[tauri::command]
pub async fn move_file_handler(old_path: String, new_path: String) -> Result<FileMetadata, String> {
    if let Some(parent) = Path::new(&new_path).parent() {
        fs::create_dir_all(parent).map_err(|e| format!("Failed to create parent directories: {}", e))?;
    }
    
    fs::rename(&old_path, &new_path).map_err(|e| format!("Failed to move file: {}", e))?;
    get_file_metadata_handler(new_path).await
}

// Dialog operations
#[tauri::command]
pub async fn open_file_dialog(multiple: Option<bool>, filters: Option<Vec<(String, Vec<String>)>>) -> Result<Option<Vec<String>>, String> {
    let multiple = multiple.unwrap_or(false);
    
    let dialog_builder = if multiple {
        dialog::FileDialogBuilder::new()
    } else {
        dialog::FileDialogBuilder::new()
    };
    
    let dialog_builder = if let Some(filters) = filters {
        let mut builder = dialog_builder;
        for (name, extensions) in filters {
            builder = builder.add_filter(name, &extensions);
        }
        builder
    } else {
        dialog_builder
    };
    
    if multiple {
        dialog_builder.pick_files(|result| {
            // This will be handled by the frontend
        });
    } else {
        dialog_builder.pick_file(|result| {
            // This will be handled by the frontend
        });
    }
    
    // Note: The actual dialog result handling needs to be implemented differently
    // This is a simplified version - in practice, you'd use async channels or callbacks
    Ok(None)
}

#[tauri::command]
pub async fn save_file_dialog(default_name: Option<String>) -> Result<Option<String>, String> {
    let mut dialog_builder = dialog::FileDialogBuilder::new();
    
    if let Some(name) = default_name {
        dialog_builder = dialog_builder.set_file_name(&name);
    }
    
    dialog_builder.save_file(|result| {
        // This will be handled by the frontend
    });
    
    // Note: The actual dialog result handling needs to be implemented differently
    Ok(None)
}

#[tauri::command]
pub async fn open_directory_dialog() -> Result<Option<String>, String> {
    dialog::FileDialogBuilder::new().pick_folder(|result| {
        // This will be handled by the frontend
    });
    
    // Note: The actual dialog result handling needs to be implemented differently
    Ok(None)
}

// Helper functions
fn get_directory_metadata(path: &str) -> Result<DirectoryMetadata, String> {
    let dir_path = Path::new(path);
    let metadata = fs::metadata(path).map_err(|e| format!("Failed to get directory metadata: {}", e))?;
    
    let dir_name = dir_path.file_name()
        .and_then(|n| n.to_str())
        .unwrap_or("")
        .to_string();
    
    let parent_path = dir_path.parent()
        .map(|p| p.to_string_lossy().to_string())
        .unwrap_or_else(|| ".".to_string());
    
    Ok(DirectoryMetadata {
        name: dir_name,
        path: path.to_string(),
        parent_path,
        created_at: metadata.created()
            .map(|t| t.duration_since(std::time::UNIX_EPOCH).unwrap_or_default().as_secs() as i64)
            .unwrap_or(0),
        modified_at: metadata.modified()
            .map(|t| t.duration_since(std::time::UNIX_EPOCH).unwrap_or_default().as_secs() as i64)
            .unwrap_or(0),
        description: None,
        tags: None,
    })
}

fn guess_mime_type(path: &str) -> String {
    let extension = Path::new(path)
        .extension()
        .and_then(|ext| ext.to_str())
        .unwrap_or("");
    
    match extension.to_lowercase().as_str() {
        "txt" => "text/plain",
        "json" => "application/json",
        "js" => "application/javascript",
        "ts" => "application/typescript",
        "html" => "text/html",
        "css" => "text/css",
        "png" => "image/png",
        "jpg" | "jpeg" => "image/jpeg",
        "gif" => "image/gif",
        "svg" => "image/svg+xml",
        "pdf" => "application/pdf",
        "zip" => "application/zip",
        "npy" => "application/octet-stream",
        _ => "application/octet-stream",
    }.to_string()
}
