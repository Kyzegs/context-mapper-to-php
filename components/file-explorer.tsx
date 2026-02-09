'use client';

import { useState, useEffect } from 'react';
import { ChevronRight, ChevronDown, File, Folder, FolderOpen } from 'lucide-react';
import { cn } from '@/lib/utils';
import type { GeneratedFile } from '@/lib/php-generator';

interface FileNode {
  name: string;
  path: string;
  type: 'file' | 'folder';
  children?: FileNode[];
  file?: GeneratedFile;
}

interface FileExplorerProps {
  files: GeneratedFile[];
  selectedFile: string | null;
  onFileSelect: (filename: string) => void;
}

function buildFileTree(files: GeneratedFile[]): FileNode {
  const root: FileNode = {
    name: '',
    path: '',
    type: 'folder',
    children: [],
  };

  for (const file of files) {
    // Split path and filter out empty strings (from trailing slashes, etc.)
    const parts = file.path.split('/').filter((part) => part.length > 0);
    let current = root;

    for (let i = 0; i < parts.length; i++) {
      const part = parts[i];
      const isLast = i === parts.length - 1;

      if (isLast) {
        // This is the file
        const fileNode: FileNode = {
          name: part,
          path: file.path,
          type: 'file',
          file,
        };
        if (!current.children) {
          current.children = [];
        }
        current.children.push(fileNode);
      } else {
        // This is a folder - skip if empty name
        if (!part || part.trim() === '') {
          continue;
        }

        if (!current.children) {
          current.children = [];
        }
        let folder = current.children.find((child) => child.name === part && child.type === 'folder');

        if (!folder) {
          folder = {
            name: part,
            path: parts
              .slice(0, i + 1)
              .filter((p) => p && p.trim() !== '')
              .join('/'),
            type: 'folder',
            children: [],
          };
          current.children.push(folder);
        }
        current = folder;
      }
    }
  }

  return root;
}

interface TreeNodeProps {
  node: FileNode;
  level: number;
  selectedFile: string | null;
  onFileSelect: (filename: string) => void;
  expandedFolders: Set<string>;
  onToggleFolder: (path: string) => void;
}

function TreeNode({ node, level, selectedFile, onFileSelect, expandedFolders, onToggleFolder }: TreeNodeProps) {
  const isExpanded = expandedFolders.has(node.path);
  const isSelected = node.type === 'file' && node.file?.filename === selectedFile;
  const hasChildren = node.children && node.children.length > 0;

  if (node.type === 'file' && node.file) {
    const fileIcon = node.file.type === 'enum' ? '📋' : node.file.type === 'valueobject' ? '📦' : '🏗️';

    return (
      <div
        className={cn(
          'flex items-center gap-2 px-2 py-1.5 text-sm cursor-pointer rounded hover:bg-accent',
          isSelected && 'bg-accent font-medium'
        )}
        style={{ paddingLeft: `${level * 1 + 0.5}rem` }}
        onClick={() => onFileSelect(node.file!.filename)}
      >
        <span className="text-xs flex-shrink-0 w-4 h-4 flex items-center justify-center">{fileIcon}</span>
        <File className="h-4 w-4 text-muted-foreground flex-shrink-0" />
        <span className="truncate flex-1 min-w-0">{node.name}</span>
      </div>
    );
  }

  return (
    <>
      <div
        className={cn(
          'flex items-center gap-1 px-2 py-1.5 text-sm cursor-pointer rounded hover:bg-accent',
          isSelected && 'bg-accent'
        )}
        style={{ paddingLeft: `${level * 1 + 0.5}rem` }}
        onClick={() => hasChildren && onToggleFolder(node.path)}
      >
        {hasChildren ? (
          isExpanded ? (
            <ChevronDown className="h-4 w-4 text-muted-foreground" />
          ) : (
            <ChevronRight className="h-4 w-4 text-muted-foreground" />
          )
        ) : (
          <div className="w-4" />
        )}
        {isExpanded ? (
          <FolderOpen className="h-4 w-4 text-muted-foreground" />
        ) : (
          <Folder className="h-4 w-4 text-muted-foreground" />
        )}
        <span className="truncate">{node.name}</span>
      </div>
      {hasChildren && isExpanded && (
        <div>
          {node
            .children!.sort((a, b) => {
              // Folders first, then files
              if (a.type !== b.type) {
                return a.type === 'folder' ? -1 : 1;
              }
              return a.name.localeCompare(b.name);
            })
            .map((child, index) => (
              <TreeNode
                key={`${child.path}-${index}`}
                node={child}
                level={level + 1}
                selectedFile={selectedFile}
                onFileSelect={onFileSelect}
                expandedFolders={expandedFolders}
                onToggleFolder={onToggleFolder}
              />
            ))}
        </div>
      )}
    </>
  );
}

export function FileExplorer({ files, selectedFile, onFileSelect }: FileExplorerProps) {
  const [expandedFolders, setExpandedFolders] = useState<Set<string>>(new Set());

  const toggleFolder = (path: string) => {
    const newExpanded = new Set(expandedFolders);
    if (newExpanded.has(path)) {
      newExpanded.delete(path);
    } else {
      newExpanded.add(path);
    }
    setExpandedFolders(newExpanded);
  };

  // Expand all folders by default
  useEffect(() => {
    if (files.length > 0) {
      const allFolders = new Set<string>();
      for (const file of files) {
        const parts = file.path.split('/').filter((part) => part.length > 0);
        for (let i = 0; i < parts.length - 1; i++) {
          allFolders.add(parts.slice(0, i + 1).join('/'));
        }
      }
      // Use setTimeout to avoid synchronous setState in effect
      setTimeout(() => {
        setExpandedFolders(allFolders);
      }, 0);
    }
  }, [files]);

  const tree = buildFileTree(files);

  // Helper function to filter out empty folders recursively
  function filterEmptyFolders(node: FileNode): FileNode | null {
    if (node.type === 'file') {
      return node;
    }

    if (!node.children || node.children.length === 0) {
      return null; // Empty folder
    }

    const filteredChildren = node.children
      .map((child) => filterEmptyFolders(child))
      .filter((child): child is FileNode => child !== null);

    if (filteredChildren.length === 0) {
      return null; // Folder has no valid children
    }

    return {
      ...node,
      children: filteredChildren,
    };
  }

  if (!tree.children || tree.children.length === 0) {
    return <div className="p-4 text-sm text-muted-foreground">No files to display</div>;
  }

  // Filter out empty folders
  const filteredChildren = tree.children
    .map((child) => filterEmptyFolders(child))
    .filter((child): child is FileNode => child !== null);

  if (filteredChildren.length === 0) {
    return <div className="p-4 text-sm text-muted-foreground">No files to display</div>;
  }

  return (
    <div className="h-full overflow-y-auto">
      {filteredChildren
        .sort((a, b) => {
          if (a.type !== b.type) {
            return a.type === 'folder' ? -1 : 1;
          }
          return a.name.localeCompare(b.name);
        })
        .map((child, index) => (
          <TreeNode
            key={`${child.path}-${index}`}
            node={child}
            level={0}
            selectedFile={selectedFile}
            onFileSelect={onFileSelect}
            expandedFolders={expandedFolders}
            onToggleFolder={toggleFolder}
          />
        ))}
    </div>
  );
}
