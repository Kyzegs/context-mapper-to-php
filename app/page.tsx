'use client';

import { useState, useRef, useEffect } from 'react';
import { Button } from '@/components/ui/button';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';
import { Textarea } from '@/components/ui/textarea';
import { Checkbox } from '@/components/ui/checkbox';
import { Label } from '@/components/ui/label';
import { parseCML } from '@/lib/cml-parser';
import { generatePHP, type GeneratorConfig } from '@/lib/php-generator';
import { Download, FileText, Settings, FolderDown, Check, ChevronsUpDown, Copy, CheckCircle } from 'lucide-react';
import { FileExplorer } from '@/components/file-explorer';
import { ThemeToggle } from '@/components/theme-toggle';
import { Command, CommandEmpty, CommandGroup, CommandInput, CommandItem, CommandList } from '@/components/ui/command';
import { Prism as SyntaxHighlighter } from 'react-syntax-highlighter';
import { tomorrow } from 'react-syntax-highlighter/dist/esm/styles/prism';
import { oneLight } from 'react-syntax-highlighter/dist/esm/styles/prism';
import { useTheme } from 'next-themes';
import { Popover, PopoverContent, PopoverTrigger } from '@/components/ui/popover';
import { cn } from '@/lib/utils';
import type { GeneratedFile } from '@/lib/php-generator';
import { toast } from 'sonner';

const EXAMPLE_FILES = [
  'DDD-Sample.cml',
  'insurance-example-for-JDL-generation.cml',
];

const STORAGE_KEY = 'cml-to-php-settings';

interface StoredSettings {
  framework: 'laravel' | 'doctrine' | 'plain';
  publicProperties: boolean;
  addGetters: boolean;
  addSetters: boolean;
  namespace: string;
  constructorType: 'none' | 'required' | 'all';
  constructorPropertyPromotion: boolean;
  doctrineCollectionDocstrings: boolean;
  doctrineAttributes?: boolean;
  directoryStructure?: 'flat' | 'bounded-context' | 'aggregate' | 'psr-4';
  groupByType?: boolean;
  phpVersion?: '8.1' | '8.2' | '8.3' | '8.4';
  readonlyValueObjects?: boolean;
  cmlContent?: string;
  selectedFile?: string;
}

export default function Home() {
  const { theme } = useTheme();
  const [cmlContent, setCmlContent] = useState('');
  const [selectedFile, setSelectedFile] = useState<string>('');
  const [open, setOpen] = useState(false);
  const [framework, setFramework] = useState<'laravel' | 'doctrine' | 'plain'>('plain');
  const [publicProperties, setPublicProperties] = useState(false);
  const [addGetters, setAddGetters] = useState(true);
  const [addSetters, setAddSetters] = useState(true);
  const [namespace, setNamespace] = useState('App\\Models');
  const [constructorType, setConstructorType] = useState<'none' | 'required' | 'all'>('none');
  const [constructorPropertyPromotion, setConstructorPropertyPromotion] = useState(false);
  const [doctrineCollectionDocstrings, setDoctrineCollectionDocstrings] = useState(false);
  const [doctrineAttributes, setDoctrineAttributes] = useState(true);
  const [directoryStructure, setDirectoryStructure] = useState<'flat' | 'bounded-context' | 'aggregate' | 'psr-4'>('flat');
  const [groupByType, setGroupByType] = useState(false);
  const [phpVersion, setPhpVersion] = useState<'8.1' | '8.2' | '8.3' | '8.4'>('8.1');
  const [readonlyValueObjects, setReadonlyValueObjects] = useState(false);
  const [phpFiles, setPhpFiles] = useState<GeneratedFile[]>([]);
  const [selectedPhpFile, setSelectedPhpFile] = useState<string>('');
  const [outputOpen, setOutputOpen] = useState(false);
  const outputRef = useRef<HTMLDivElement>(null);
  const [isInitialized, setIsInitialized] = useState(false);
  const [copiedFile, setCopiedFile] = useState<string | null>(null);

  // Load settings from localStorage on mount
  useEffect(() => {
    if (typeof window === 'undefined') return;
    
    try {
      const stored = localStorage.getItem(STORAGE_KEY);
      if (stored) {
        const settings: StoredSettings = JSON.parse(stored);
        setFramework(settings.framework || 'plain');
        setPublicProperties(settings.publicProperties ?? false);
        setAddGetters(settings.addGetters ?? true);
        setAddSetters(settings.addSetters ?? true);
        setNamespace(settings.namespace || 'App\\Models');
        setConstructorType(settings.constructorType || 'none');
        setConstructorPropertyPromotion(settings.constructorPropertyPromotion ?? false);
        setDoctrineCollectionDocstrings(settings.doctrineCollectionDocstrings ?? false);
        setDoctrineAttributes(settings.doctrineAttributes ?? true);
        setDirectoryStructure(settings.directoryStructure || 'flat');
        setGroupByType(settings.groupByType ?? false);
        setPhpVersion(settings.phpVersion || '8.1');
        setReadonlyValueObjects(settings.readonlyValueObjects ?? false);
        
        // Note: selectedFile and cmlContent are intentionally not persisted
      }
    } catch (err) {
      console.error('Failed to load settings from localStorage:', err);
    } finally {
      setIsInitialized(true);
    }
  }, []);

  // Save settings to localStorage whenever they change
  useEffect(() => {
    if (!isInitialized || typeof window === 'undefined') return;
    
    try {
      const settings: StoredSettings = {
        framework,
        publicProperties,
        addGetters,
        addSetters,
        namespace,
        constructorType,
        constructorPropertyPromotion,
        doctrineCollectionDocstrings,
        doctrineAttributes,
        directoryStructure,
        groupByType,
        phpVersion,
        readonlyValueObjects,
        // Note: cmlContent and selectedFile are intentionally not persisted
      };
      localStorage.setItem(STORAGE_KEY, JSON.stringify(settings));
    } catch (err) {
      console.error('Failed to save settings to localStorage:', err);
    }
  }, [
    framework,
    publicProperties,
    addGetters,
    addSetters,
    namespace,
    constructorType,
    constructorPropertyPromotion,
    doctrineCollectionDocstrings,
    doctrineAttributes,
    directoryStructure,
    phpVersion,
    readonlyValueObjects,
    isInitialized,
    // Note: cmlContent and selectedFile are intentionally not persisted, so they're not in the dependency array
  ]);

  const loadExampleFile = async (filename: string) => {
    try {
      const response = await fetch(`/api/examples/${filename}`);
      if (!response.ok) throw new Error('Failed to load file');
      const content = await response.text();
      setCmlContent(content);
      setSelectedFile(filename);
    } catch (err) {
      toast.error(`Failed to load ${filename}`, {
        description: err instanceof Error ? err.message : 'Unknown error',
      });
    }
  };

  const handleFileUpload = (event: React.ChangeEvent<HTMLInputElement>) => {
    const file = event.target.files?.[0];
    if (!file) return;

    const reader = new FileReader();
    reader.onload = (e) => {
      const content = e.target?.result as string;
      setCmlContent(content);
      setSelectedFile(file.name);
    };
    reader.onerror = () => {
      toast.error('Failed to read file');
    };
    reader.readAsText(file);
  };

  const handleGenerate = () => {
    try {
      if (!cmlContent.trim()) {
        toast.error('Please provide CML content');
        return;
      }

      const model = parseCML(cmlContent);
      const config: GeneratorConfig = {
        framework,
        publicProperties,
        addGetters,
        addSetters,
        namespace: namespace || undefined,
        constructorType,
        constructorPropertyPromotion: constructorType !== 'none' ? constructorPropertyPromotion : false,
        doctrineCollectionDocstrings: framework === 'doctrine' ? doctrineCollectionDocstrings : false,
        doctrineAttributes: framework === 'doctrine' ? doctrineAttributes : undefined,
        directoryStructure,
        groupByType,
        phpVersion,
        readonlyValueObjects,
      };

      const files = generatePHP(model, config);
      setPhpFiles(files);
      // Set the first file as selected
      if (files.length > 0) {
        setSelectedPhpFile(files[0].filename);
      }
      
      // Scroll to output after a brief delay to allow state update
      setTimeout(() => {
        outputRef.current?.scrollIntoView({ behavior: 'smooth', block: 'start' });
      }, 100);
    } catch (err) {
      toast.error('Failed to generate PHP code', {
        description: err instanceof Error ? err.message : 'Unknown error',
      });
      setPhpFiles([]);
    }
  };

  const handleDownloadFile = (file: GeneratedFile) => {
    const blob = new Blob([file.content], { type: 'text/plain' });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = file.filename;
    document.body.appendChild(a);
    a.click();
    document.body.removeChild(a);
    URL.revokeObjectURL(url);
  };

  const handleCopyToClipboard = async (file: GeneratedFile) => {
    try {
      await navigator.clipboard.writeText(file.content);
      setCopiedFile(file.filename);
      // Reset the copied state after 2 seconds
      setTimeout(() => {
        setCopiedFile(null);
      }, 2000);
    } catch (err) {
      // Fallback for browsers that don't support clipboard API
      const textArea = document.createElement('textarea');
      textArea.value = file.content;
      textArea.style.position = 'fixed';
      textArea.style.opacity = '0';
      document.body.appendChild(textArea);
      textArea.select();
      try {
        document.execCommand('copy');
        setCopiedFile(file.filename);
        setTimeout(() => {
          setCopiedFile(null);
        }, 2000);
      } catch (fallbackErr) {
        toast.error('Failed to copy to clipboard');
      }
      document.body.removeChild(textArea);
    }
  };

  const handleDownloadAll = async () => {
    if (phpFiles.length === 0) return;

    // Use JSZip if available, otherwise download files sequentially
    try {
      // Try to use JSZip for better UX
      const JSZip = (await import('jszip')).default;
      const zip = new JSZip();

      for (const file of phpFiles) {
        zip.file(file.path, file.content);
      }

      const zipBlob = await zip.generateAsync({ type: 'blob' });
      const url = URL.createObjectURL(zipBlob);
      const a = document.createElement('a');
      a.href = url;
      a.download = 'generated-php-files.zip';
      document.body.appendChild(a);
      a.click();
      document.body.removeChild(a);
      URL.revokeObjectURL(url);
    } catch {
      // Fallback: download files sequentially
      for (const file of phpFiles) {
        setTimeout(() => handleDownloadFile(file), 100);
      }
    }
  };

  return (
    <div className="min-h-screen bg-background p-4 md:p-8">
      <div className="mx-auto max-w-7xl space-y-6">
        <div className="flex items-start justify-between">
          <div className="space-y-2">
            <h1 className="text-4xl font-bold tracking-tight">Context Mapper to PHP</h1>
            <p className="text-muted-foreground">
              Convert Context Mapper Language (CML) files to PHP classes for Laravel, Doctrine, or plain PHP
            </p>
          </div>
          <ThemeToggle />
        </div>

        <div className="grid gap-6 md:grid-cols-2">
          {/* Input Section */}
          <Card>
            <CardHeader>
              <CardTitle className="flex items-center gap-2">
                <FileText className="h-5 w-5" />
                CML Input
              </CardTitle>
              <CardDescription>Upload a CML file or select an example</CardDescription>
            </CardHeader>
            <CardContent className="space-y-4">
              <div className="space-y-2">
                <Label>Example Files</Label>
                <Popover open={open} onOpenChange={setOpen}>
                  <PopoverTrigger asChild>
                    <Button
                      variant="outline"
                      role="combobox"
                      aria-expanded={open}
                      className="w-full justify-between"
                    >
                      {selectedFile || 'Select an example file...'}
                      <ChevronsUpDown className="ml-2 h-4 w-4 shrink-0 opacity-50" />
                    </Button>
                  </PopoverTrigger>
                  <PopoverContent className="w-[var(--radix-popover-trigger-width)] p-0" align="start">
                    <Command>
                      <CommandInput placeholder="Search files..." />
                      <CommandList>
                        <CommandEmpty>No file found.</CommandEmpty>
                        <CommandGroup>
                          {EXAMPLE_FILES.map((file) => (
                            <CommandItem
                              key={file}
                              value={file}
                              onSelect={() => {
                                setSelectedFile(file);
                                loadExampleFile(file);
                                setOpen(false);
                              }}
                            >
                              <Check
                                className={cn(
                                  'mr-2 h-4 w-4',
                                  selectedFile === file ? 'opacity-100' : 'opacity-0'
                                )}
                              />
                              {file}
                            </CommandItem>
                          ))}
                        </CommandGroup>
                      </CommandList>
                    </Command>
                  </PopoverContent>
                </Popover>
              </div>

              <div className="space-y-2">
                <Label>Or Upload Your Own</Label>
                <input
                  type="file"
                  accept=".cml"
                  onChange={handleFileUpload}
                  className="w-full rounded-md border border-input bg-background px-3 py-2 text-sm file:mr-4 file:rounded-md file:border-0 file:bg-primary file:px-4 file:py-2 file:text-sm file:font-medium file:text-primary-foreground hover:file:bg-primary/90"
                />
              </div>

              <div className="space-y-2">
                <Label>CML Content</Label>
                <Textarea
                  value={cmlContent}
                  onChange={(e) => setCmlContent(e.target.value)}
                  placeholder="Paste your CML content here..."
                  className="min-h-[300px] font-mono text-sm"
                />
              </div>
            </CardContent>
          </Card>

          {/* Configuration Section */}
          <Card>
            <CardHeader>
              <CardTitle className="flex items-center gap-2">
                <Settings className="h-5 w-5" />
                Configuration
              </CardTitle>
              <CardDescription>Configure PHP code generation options</CardDescription>
            </CardHeader>
            <CardContent className="space-y-6">
              {/* General Settings Section */}
              <div className="space-y-4">
                <h3 className="text-sm font-semibold">General Settings</h3>
                <div className="space-y-4">
                  <div className="space-y-2">
                    <Label>Framework</Label>
                    <Select value={framework} onValueChange={(v) => setFramework(v as any)}>
                      <SelectTrigger>
                        <SelectValue />
                      </SelectTrigger>
                      <SelectContent>
                        <SelectItem value="plain">Plain PHP</SelectItem>
                        <SelectItem value="laravel">Laravel</SelectItem>
                        <SelectItem value="doctrine">Doctrine</SelectItem>
                      </SelectContent>
                    </Select>
                  </div>

                  <div className="space-y-2">
                    <Label>Namespace</Label>
                    <input
                      type="text"
                      value={namespace}
                      onChange={(e) => setNamespace(e.target.value)}
                      placeholder="App\\Models"
                      className="w-full rounded-md border border-input bg-background px-3 py-2 text-sm"
                    />
                  </div>

                  <div className="space-y-2">
                    <Label>PHP Version</Label>
                    <Select value={phpVersion} onValueChange={(v) => setPhpVersion(v as any)}>
                      <SelectTrigger>
                        <SelectValue />
                      </SelectTrigger>
                      <SelectContent>
                        <SelectItem value="8.1">PHP 8.1</SelectItem>
                        <SelectItem value="8.2">PHP 8.2</SelectItem>
                        <SelectItem value="8.3">PHP 8.3</SelectItem>
                        <SelectItem value="8.4">PHP 8.4</SelectItem>
                      </SelectContent>
                    </Select>
                  </div>

                  <div className="space-y-2">
                    <Label>Directory Structure</Label>
                    <Select value={directoryStructure} onValueChange={(v) => setDirectoryStructure(v as any)}>
                      <SelectTrigger>
                        <SelectValue />
                      </SelectTrigger>
                      <SelectContent>
                        <SelectItem value="flat">Flat (all files in root)</SelectItem>
                        <SelectItem value="bounded-context">By Bounded Context</SelectItem>
                        <SelectItem value="aggregate">By Bounded Context / Aggregate</SelectItem>
                        <SelectItem value="psr-4">PSR-4 (with namespace structure)</SelectItem>
                      </SelectContent>
                    </Select>
                    <div className="flex items-center space-x-2 pt-1">
                      <Checkbox
                        id="groupByType"
                        checked={groupByType}
                        onCheckedChange={(checked) => setGroupByType(checked === true)}
                      />
                      <Label
                        htmlFor="groupByType"
                        className="text-sm font-normal cursor-pointer"
                      >
                        Group by type (Enum/, ValueObject/, Entity/)
                      </Label>
                    </div>
                    <p className="text-xs text-muted-foreground">
                      {directoryStructure === 'flat' && !groupByType && 'All files in a single directory'}
                      {directoryStructure === 'flat' && groupByType && 'Files grouped by type (Enum/, ValueObject/, Entity/) in root'}
                      {directoryStructure === 'bounded-context' && !groupByType && 'Files organized by bounded context folders'}
                      {directoryStructure === 'bounded-context' && groupByType && 'Files organized by bounded context, then by type'}
                      {directoryStructure === 'aggregate' && !groupByType && 'Files organized by bounded context and aggregate folders'}
                      {directoryStructure === 'aggregate' && groupByType && 'Files organized by bounded context/aggregate, then by type'}
                      {directoryStructure === 'psr-4' && !groupByType && 'PSR-4 structure with namespace-based directories and namespaces'}
                      {directoryStructure === 'psr-4' && groupByType && 'PSR-4 structure with type folders (Enum/, ValueObject/, Entity/)'}
                    </p>
                  </div>

                </div>
              </div>

              {/* Divider */}
              <div className="border-t border-border" />

              {/* Class Structure Section */}
              <div className="space-y-4">
                <h3 className="text-sm font-semibold">Class Structure</h3>
                <div className="space-y-4">
                  <div className="space-y-2">
                    <Label>Constructor</Label>
                    <Select
                      value={constructorType}
                      onValueChange={(v) => {
                        setConstructorType(v as 'none' | 'required' | 'all');
                        // Reset property promotion when constructor is disabled
                        if (v === 'none') {
                          setConstructorPropertyPromotion(false);
                        }
                      }}
                    >
                      <SelectTrigger>
                        <SelectValue />
                      </SelectTrigger>
                      <SelectContent>
                        <SelectItem value="none">No constructor</SelectItem>
                        <SelectItem value="required">Constructor with only required properties (Non-nullable)</SelectItem>
                        <SelectItem value="all">Constructor with all properties</SelectItem>
                      </SelectContent>
                    </Select>
                  </div>

                  {constructorType !== 'none' && (
                    <div className="flex items-center space-x-2">
                      <Checkbox
                        id="property-promotion"
                        checked={constructorPropertyPromotion}
                        onCheckedChange={(checked) => setConstructorPropertyPromotion(checked === true)}
                      />
                      <Label htmlFor="property-promotion" className="cursor-pointer">
                        Constructor property promotion
                      </Label>
                    </div>
                  )}

                  <div className="flex items-center space-x-2">
                    <Checkbox
                      id="public-props"
                      checked={publicProperties}
                      onCheckedChange={(checked) => setPublicProperties(checked === true)}
                    />
                    <Label htmlFor="public-props" className="cursor-pointer">
                      Public properties (default: private)
                    </Label>
                  </div>

                  <div className="flex items-center space-x-2">
                    <Checkbox
                      id="readonly-value-objects"
                      checked={readonlyValueObjects}
                      onCheckedChange={(checked) => setReadonlyValueObjects(checked === true)}
                    />
                    <Label htmlFor="readonly-value-objects" className="cursor-pointer">
                      Make Value Objects readonly
                      {phpVersion && parseFloat(phpVersion) >= 8.2 && (
                        <span className="text-xs text-muted-foreground ml-1">(readonly class)</span>
                      )}
                      {phpVersion && parseFloat(phpVersion) === 8.1 && (
                        <span className="text-xs text-muted-foreground ml-1">(readonly properties)</span>
                      )}
                    </Label>
                  </div>

                  <div className="flex items-center space-x-2">
                    <Checkbox
                      id="getters"
                      checked={addGetters}
                      onCheckedChange={(checked) => setAddGetters(checked === true)}
                    />
                    <Label htmlFor="getters" className="cursor-pointer">
                      Add getters
                    </Label>
                  </div>

                  <div className="flex items-center space-x-2">
                    <Checkbox
                      id="setters"
                      checked={addSetters}
                      onCheckedChange={(checked) => setAddSetters(checked === true)}
                    />
                    <Label htmlFor="setters" className="cursor-pointer">
                      Add setters
                    </Label>
                  </div>
                </div>
              </div>

              {/* Doctrine Settings Section */}
              {framework === 'doctrine' && (
                <>
                  <div className="border-t border-border" />
                  <div className="space-y-4">
                    <h3 className="text-sm font-semibold">Doctrine Settings</h3>
                    <div className="space-y-4">
                      <div className="flex items-center space-x-2">
                        <Checkbox
                          id="doctrine-attributes"
                          checked={doctrineAttributes}
                          onCheckedChange={(checked) => setDoctrineAttributes(checked === true)}
                        />
                        <Label htmlFor="doctrine-attributes" className="cursor-pointer">
                          Add Doctrine attributes (#[Entity], #[Column], etc.)
                        </Label>
                      </div>
                      <div className="flex items-center space-x-2">
                        <Checkbox
                          id="doctrine-docstrings"
                          checked={doctrineCollectionDocstrings}
                          onCheckedChange={(checked) => setDoctrineCollectionDocstrings(checked === true)}
                        />
                        <Label htmlFor="doctrine-docstrings" className="cursor-pointer">
                          Add Collection docstrings (Collection&lt;array-key, Entity&gt;)
                        </Label>
                      </div>
                    </div>
                  </div>
                </>
              )}

              <Button onClick={handleGenerate} className="w-full" size="lg">
                Generate PHP Code
              </Button>
            </CardContent>
          </Card>
        </div>

        {/* Output Section */}
        {phpFiles.length > 0 && (
          <Card ref={outputRef} className="overflow-hidden">
            <CardHeader>
              <div className="flex items-center justify-between">
                <CardTitle>Generated PHP Files ({phpFiles.length})</CardTitle>
                <div className="flex gap-2">
                  <Button onClick={handleDownloadAll} variant="outline" size="sm">
                    <FolderDown className="mr-2 h-4 w-4" />
                    Download All
                  </Button>
                </div>
              </div>
            </CardHeader>
            <CardContent className="p-0">
              <div className="flex h-[600px] border-t">
                {/* File Explorer Sidebar */}
                <div className="w-64 border-r bg-muted/30 flex flex-col">
                  <div className="p-3 border-b">
                    <Label className="text-xs font-semibold text-muted-foreground uppercase">Files</Label>
                  </div>
                  <div className="flex-1 overflow-hidden">
                    <FileExplorer
                      files={phpFiles}
                      selectedFile={selectedPhpFile}
                      onFileSelect={setSelectedPhpFile}
                    />
                  </div>
                </div>

                {/* Code Viewer */}
                <div className="flex-1 flex flex-col overflow-hidden">
                  {selectedPhpFile && (() => {
                    const file = phpFiles.find(f => f.filename === selectedPhpFile);
                    if (!file) return null;
                    
                    return (
                      <>
                        <div className="flex items-center justify-between p-3 border-b bg-muted/30">
                          <div className="flex items-center gap-2">
                            <span className="text-sm">
                              {file.type === 'enum' && '📋'}
                              {file.type === 'valueobject' && '📦'}
                              {file.type === 'entity' && '🏗️'}
                            </span>
                            <nav className="flex items-center gap-1 text-sm" aria-label="Breadcrumb">
                              {(() => {
                                const pathParts = file.path.split('/').filter(p => p && p.trim() !== '');
                                if (pathParts.length <= 1) {
                                  return <span className="font-medium">{file.filename}</span>;
                                }
                                return (
                                  <>
                                    {pathParts.slice(0, -1).map((part, idx) => (
                                      <span key={idx} className="flex items-center gap-1">
                                        <span className="text-muted-foreground hover:text-foreground">{part}</span>
                                        <span className="text-muted-foreground/50">/</span>
                                      </span>
                                    ))}
                                    <span className="font-medium">{pathParts[pathParts.length - 1]}</span>
                                  </>
                                );
                              })()}
                            </nav>
                            <span className="text-xs text-muted-foreground">
                              ({file.content.length} characters)
                            </span>
                          </div>
                          <div className="flex gap-2">
                            <Button
                              onClick={() => handleCopyToClipboard(file)}
                              variant="ghost"
                              size="sm"
                              title="Copy to clipboard"
                            >
                              {copiedFile === file.filename ? (
                                <CheckCircle className="h-4 w-4 text-green-600" />
                              ) : (
                                <Copy className="h-4 w-4" />
                              )}
                            </Button>
                            <Button
                              onClick={() => handleDownloadFile(file)}
                              variant="ghost"
                              size="sm"
                              title="Download file"
                            >
                              <Download className="h-4 w-4" />
                            </Button>
                          </div>
                        </div>
                        <div className="flex-1 overflow-auto">
                          <SyntaxHighlighter
                            language="php"
                            style={theme === 'dark' ? tomorrow : oneLight}
                            customStyle={{
                              margin: 0,
                              borderRadius: 0,
                              fontSize: '0.875rem',
                              lineHeight: '1.5',
                              padding: '1rem',
                              height: '100%',
                            }}
                            showLineNumbers={true}
                            wrapLines={true}
                          >
                            {file.content}
                          </SyntaxHighlighter>
                        </div>
                      </>
                    );
                  })()}
                  {!selectedPhpFile && (
                    <div className="flex-1 flex items-center justify-center text-muted-foreground">
                      Select a file from the explorer to view its content
                    </div>
                  )}
                </div>
              </div>
            </CardContent>
          </Card>
        )}
      </div>
    </div>
  );
}
