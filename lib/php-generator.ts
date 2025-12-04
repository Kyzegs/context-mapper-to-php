import {
  ClassType,
  PhpFile,
  PhpNamespace,
  Property,
  Method,
  EnumType,
  PromotedParameter,
  Parameter,
  Printer,
} from 'js-php-generator';
import type {
  CMLModel,
  CMLEntity,
  CMLValueObject,
  CMLEnum,
  CMLProperty,
} from './cml-parser';

export interface GeneratorConfig {
  framework: 'laravel' | 'doctrine' | 'plain';
  publicProperties: boolean;
  addGetters: boolean;
  addSetters: boolean;
  namespace?: string;
  constructorType: 'none' | 'required' | 'all';
  constructorPropertyPromotion: boolean;
  doctrineCollectionDocstrings?: boolean;
  doctrineAttributes?: boolean;
  arrayDocstrings?: boolean;
  directoryStructure?: 'flat' | 'bounded-context' | 'aggregate' | 'psr-4';
  groupByType?: boolean;
  phpVersion?: '8.1' | '8.2' | '8.3' | '8.4';
  readonlyValueObjects?: boolean;
}

export interface GeneratedFile {
  filename: string;
  path: string; // Full path including directory structure
  content: string;
  type: 'enum' | 'valueobject' | 'entity';
}

export function generatePHP(
  model: CMLModel,
  config: GeneratorConfig
): GeneratedFile[] {
  const files: GeneratedFile[] = [];
  const directoryStructure = config.directoryStructure || 'flat';
  const groupByType = config.groupByType || false;
  
  for (const boundedContext of model.boundedContexts) {
    for (const aggregate of boundedContext.aggregates) {
      // Determine directory path based on structure option
      const directoryPath = getDirectoryPath(
        boundedContext.name,
        aggregate.name,
        directoryStructure
      );
      
      // Generate enums
      for (const enumDef of aggregate.enums) {
        const enumFile = generateEnum(enumDef, config, boundedContext.name, aggregate.name);
        const filename = `${enumDef.name}.php`;
        const typeFolder = groupByType ? 'Enum/' : '';
        const fullPath = buildFilePath(directoryPath, typeFolder, filename);
        files.push({
          filename,
          path: fullPath,
          content: enumFile,
          type: 'enum',
        });
      }
      
      // Generate value objects first (they might be referenced by entities)
      for (const valueObject of aggregate.valueObjects) {
        const voFile = generateValueObject(valueObject, config, boundedContext.name, aggregate.name);
        const filename = `${valueObject.name}.php`;
        const typeFolder = groupByType ? 'ValueObject/' : '';
        const fullPath = buildFilePath(directoryPath, typeFolder, filename);
        files.push({
          filename,
          path: fullPath,
          content: voFile,
          type: 'valueobject',
        });
      }
      
      // Generate entities
      for (const entity of aggregate.entities) {
        const entityFile = generateEntity(entity, config, boundedContext.name, aggregate.name);
        const filename = `${entity.name}.php`;
        const typeFolder = groupByType ? 'Entity/' : '';
        const fullPath = buildFilePath(directoryPath, typeFolder, filename);
        files.push({
          filename,
          path: fullPath,
          content: entityFile,
          type: 'entity',
        });
      }
    }
  }
  
  return files;
}

function getDirectoryPath(
  boundedContextName: string,
  aggregateName: string,
  structure: 'flat' | 'bounded-context' | 'aggregate' | 'psr-4'
): string {
  switch (structure) {
    case 'flat':
      return '';
    
    case 'bounded-context':
      // Use PascalCase for directory names (CML names are already PascalCase)
      return boundedContextName;
    
    case 'aggregate':
      // Use PascalCase for directory names
      return `${boundedContextName}/${aggregateName}`;
    
    case 'psr-4':
      // PSR-4 structure: namespace-based directory structure
      // Directory structure matches namespace structure (PascalCase)
      return `${boundedContextName}/${aggregateName}`;
    
    default:
      return '';
  }
}

function buildFilePath(basePath: string, typeFolder: string, filename: string): string {
  // Remove trailing slashes from typeFolder and filter out empty parts
  const cleanTypeFolder = typeFolder.replace(/\/+$/, '');
  const parts = [basePath, cleanTypeFolder, filename].filter(Boolean);
  return parts.join('/');
}

function toSnakeCase(str: string): string {
  return str.replace(/([A-Z])/g, '_$1').toLowerCase().replace(/^_/, '');
}

function generateEnum(
  enumDef: CMLEnum,
  config: GeneratorConfig,
  boundedContextName?: string,
  aggregateName?: string
): string {
  const file = new PhpFile();
  file.setStrictTypes();
  
  let namespace = config.namespace || 'App\\Models';
  const directoryStructure = config.directoryStructure || 'flat';
  
  // For PSR-4 and aggregate structures, append bounded context and aggregate to namespace
  if ((directoryStructure === 'psr-4' || directoryStructure === 'aggregate') && boundedContextName && aggregateName) {
    namespace = `${namespace}\\${boundedContextName}\\${aggregateName}`;
  } else if (directoryStructure === 'bounded-context' && boundedContextName) {
    namespace = `${namespace}\\${boundedContextName}`;
  }
  
  const ns = file.addNamespace(namespace);
  
  // Add enum directly to file (not namespace) for proper rendering
  const enumType = file.addEnum(enumDef.name);
  // Set the namespace on the enum so it appears in the correct namespace
  enumType.namespace = namespace;
  // Make it a string-backed enum
  enumType.setType('string');
  
  for (const value of enumDef.values) {
    const cleanValue = value.replace(/[^a-zA-Z0-9_]/g, '_').toUpperCase();
    // Use the original value (cleaned) as the string backing value
    const stringValue = cleanValue;
    enumType.addCase(cleanValue, stringValue);
  }
  
  // Use Printer to ensure proper rendering with namespace
  const printer = new Printer();
  return printer.printFile(file);
}

function generateValueObject(
  valueObject: CMLValueObject,
  config: GeneratorConfig,
  boundedContextName?: string,
  aggregateName?: string
): string {
  const file = new PhpFile();
  file.setStrictTypes();
  
  const namespace = buildNamespace(config, boundedContextName, aggregateName);
  const ns = file.addNamespace(namespace);
  
  const class_ = ns.addClass(valueObject.name);
  class_.setFinal();
  
  // Apply readonly class for PHP 8.2+ if enabled
  if (config.readonlyValueObjects && config.phpVersion && parseFloat(config.phpVersion) >= 8.2) {
    class_.setReadOnly(true);
  }
  
  // Determine which properties will be in constructor
  // If readonly is enabled, all properties must be in constructor (they can't be set otherwise)
  const effectiveConstructorType = config.readonlyValueObjects ? 'all' : config.constructorType;
  const propertiesForConstructor = effectiveConstructorType !== 'none'
    ? (effectiveConstructorType === 'required'
        ? valueObject.properties.filter(prop => !prop.nullable)
        : valueObject.properties)
    : [];
  
  const promotedProperties = new Set(
    config.constructorPropertyPromotion && effectiveConstructorType !== 'none'
      ? propertiesForConstructor.map(prop => prop.name)
      : []
  );
  
  // Add properties (skip promoted properties as they're defined in constructor)
  for (const prop of valueObject.properties) {
    // Skip properties that are promoted in constructor
    if (promotedProperties.has(prop.name)) {
      continue;
    }
    
    const phpProp = class_.addProperty(prop.name);
    setVisibility(phpProp, config.publicProperties === true);
    phpProp.setType(mapTypeToPHP(config, prop));
    if (prop.nullable) {
      phpProp.setNullable(true);
    }
    addCollectionDocstring(phpProp, prop, 'var', config);
    if (shouldApplyReadonlyProperty(config)) {
      phpProp.setReadOnly(true);
    }
  }
  
  // Add constructor based on config
  // If readonly is enabled, constructor is required (all properties must be set in constructor)
  if (effectiveConstructorType !== 'none' && valueObject.properties.length > 0) {
    const constructor = class_.addMethod('__construct');
    constructor.setPublic();
    
    let constructorBody = '';
    for (const prop of propertiesForConstructor) {
      const param = config.constructorPropertyPromotion
        ? constructor.addPromotedParameter(prop.name)
        : constructor.addParameter(prop.name);
      
      setupParameter(param, prop, config);
      
      if (config.constructorPropertyPromotion) {
        const promotedParam = param as PromotedParameter;
        setVisibility(promotedParam, config.publicProperties === true);
        if (shouldApplyReadonlyProperty(config)) {
          promotedParam.setReadOnly(true);
        }
      }
      
      addCollectionDocstring(param, prop, 'var', config);
      
      if (!config.constructorPropertyPromotion) {
        constructorBody += `$this->${prop.name} = $${prop.name};\n`;
      }
    }
    
    if (constructorBody) {
      constructor.setBody(constructorBody);
    }
  }
  
  // Add getters and setters in pairs (getter -> setter for each property)
  for (const prop of valueObject.properties) {
    if (config.addGetters) {
      const getter = class_.addMethod('get' + capitalize(prop.name));
      getter.setPublic();
      getter.setReturnType(mapTypeToPHP(config, prop));
      if (prop.nullable) {
        getter.setReturnNullable(true);
      }
      addCollectionDocstring(getter, prop, 'return', config);
      getter.setBody(`return $this->${prop.name};`);
    }
    
    // Skip setters if value object is readonly (readonly objects shouldn't have setters)
    if (config.addSetters && !config.readonlyValueObjects) {
      const setter = class_.addMethod('set' + capitalize(prop.name));
      setter.setPublic();
      const param = setter.addParameter(prop.name);
      setupParameter(param, prop, config);
      // Add collection docstring if enabled
      addCollectionDocstring(setter, prop, 'param', config);
      setter.setReturnType('self');
      setter.setBody(`$this->${prop.name} = $${prop.name};\n\nreturn $this;`);
    }
  }
  
  // Use Printer to ensure proper formatting with correct spacing between methods
  const printer = new Printer();
  return printer.printFile(file);
}

function generateEntity(
  entity: CMLEntity,
  config: GeneratorConfig,
  boundedContextName?: string,
  aggregateName?: string
): string {
  const file = new PhpFile();
  file.setStrictTypes();
  
  const namespace = buildNamespace(config, boundedContextName, aggregateName);
  const ns = file.addNamespace(namespace);
  
  const class_ = ns.addClass(entity.name);
  
  // Framework-specific setup
  if (config.framework === 'laravel') {
    class_.setExtends('Illuminate\\Database\\Eloquent\\Model');
    class_.addComment('@property-read int $id');
  } else if (config.framework === 'doctrine' && config.doctrineAttributes !== false) {
    class_.addAttribute('Doctrine\\ORM\\Mapping\\Entity');
    class_.addAttribute('Doctrine\\ORM\\Mapping\\Table', [`name: '${toSnakeCase(entity.name)}'`]);
  }
  
  // Get properties that should be in constructor (excluding Laravel relations)
  const propertiesForConstructor = config.constructorType !== 'none'
    ? entity.properties.filter(prop => !(prop.isRelation && config.framework === 'laravel'))
    : [];
  
  // Determine which properties to include in constructor
  const propertiesToInclude = config.constructorType === 'required'
    ? propertiesForConstructor.filter(prop => !prop.nullable)
    : propertiesForConstructor;
  
  // Track promoted properties to avoid duplicates
  const promotedProperties = new Set(
    config.constructorPropertyPromotion && config.constructorType !== 'none'
      ? propertiesToInclude.map(prop => prop.name)
      : []
  );
  
  // Add properties (skip promoted properties as they're defined in constructor)
  for (const prop of entity.properties) {
    // Skip relation properties for Laravel (they're handled as methods)
    if (prop.isRelation && config.framework === 'laravel') {
      continue;
    }
    
    // Skip properties that are promoted in constructor
    if (promotedProperties.has(prop.name)) {
      continue;
    }
    
    const phpProp = class_.addProperty(prop.name);
    setVisibility(phpProp, config.publicProperties === true);
    const phpType = mapTypeToPHP(config, prop);
    phpProp.setType(phpType);
    if (prop.nullable) {
      phpProp.setNullable(true);
    }
    // Add collection docstring if enabled
    addCollectionDocstring(phpProp, prop, 'var', config);
    
    // Framework-specific attributes
    if (config.framework === 'laravel') {
      if (prop.isRelation) {
        // Laravel relations are handled via methods, not properties
        continue;
      }
      if (prop.name === 'id') {
        phpProp.addAttribute('Illuminate\\Database\\Eloquent\\Casts\\Attribute');
      }
    } else if (config.framework === 'doctrine') {
      if (config.doctrineAttributes !== false) {
        if (prop.isRelation) {
          if (prop.isCollection) {
            phpProp.addAttribute('Doctrine\\ORM\\Mapping\\OneToMany', [
              `targetEntity: ${prop.type}::class`,
              `mappedBy: '${getInversePropertyName(entity.name)}'`
            ]);
            phpProp.setType('Doctrine\\Common\\Collections\\Collection');
            
            // Add collection docstring if enabled
            addCollectionDocstring(phpProp, prop, 'var', config);
          } else {
            phpProp.addAttribute('Doctrine\\ORM\\Mapping\\ManyToOne', [
              `targetEntity: ${prop.type}::class`
            ]);
          }
        } else {
          phpProp.addAttribute('Doctrine\\ORM\\Mapping\\Column', [
            `type: '${mapDoctrineType(prop.type)}'`,
            `nullable: ${prop.nullable}`
          ]);
        }
      } else {
        // Doctrine framework but attributes disabled - still use Doctrine types for collections
        if (prop.isCollection) {
          phpProp.setType('Doctrine\\Common\\Collections\\Collection');
          // Add collection docstring if enabled
          addCollectionDocstring(phpProp, prop, 'var', config);
        }
      }
    }
  }
  
  // Add constructor based on config
  if (config.constructorType !== 'none') {
    const constructor = class_.addMethod('__construct');
    constructor.setPublic();
    
    let constructorBody = '';
    
    // Add Doctrine collection initialization
    if (config.framework === 'doctrine') {
      for (const prop of entity.properties) {
        if (prop.isCollection) {
          constructorBody += `$this->${prop.name} = new \\Doctrine\\Common\\Collections\\ArrayCollection();\n`;
        }
      }
    }
    
    // Add constructor parameters
    for (const prop of propertiesToInclude) {
      const param = config.constructorPropertyPromotion
        ? constructor.addPromotedParameter(prop.name)
        : constructor.addParameter(prop.name);
      
      setupParameter(param, prop, config);
      
      if (config.constructorPropertyPromotion) {
        setVisibility(param as PromotedParameter, config.publicProperties === true);
      }
      
      addCollectionDocstring(param, prop, 'var', config);
      
      if (!config.constructorPropertyPromotion) {
        constructorBody += `$this->${prop.name} = $${prop.name};\n`;
      }
    }
    
    if (constructorBody) {
      constructor.setBody(constructorBody);
    }
  } else if (config.framework === 'doctrine') {
    // Even with no constructor, Doctrine needs collection initialization
    const hasCollections = entity.properties.some(prop => prop.isCollection);
    if (hasCollections) {
      const constructor = class_.addMethod('__construct');
      constructor.setPublic();
      let constructorBody = '';
      for (const prop of entity.properties) {
        if (prop.isCollection) {
          constructorBody += `$this->${prop.name} = new \\Doctrine\\Common\\Collections\\ArrayCollection();\n`;
        }
      }
      constructor.setBody(constructorBody);
    }
  }
  
  // Add getters and setters in pairs (getter -> setter for each property)
  for (const prop of entity.properties) {
    if (prop.isRelation && config.framework === 'laravel') {
      // Laravel relations are methods, not getters/setters
      continue;
    }
    
    if (config.addGetters) {
      const getter = class_.addMethod('get' + capitalize(prop.name));
      getter.setPublic();
      getter.setReturnType(mapTypeToPHP(config, prop));
      if (prop.nullable) {
        getter.setReturnNullable(true);
      }
      addCollectionDocstring(getter, prop, 'return', config);
      getter.setBody(`return $this->${prop.name};`);
    }
    
    if (config.addSetters) {
      const setter = class_.addMethod('set' + capitalize(prop.name));
      setter.setPublic();
      const param = setter.addParameter(prop.name);
      setupParameter(param, prop, config);
      // Add collection docstring if enabled
      addCollectionDocstring(setter, prop, 'param', config);
      setter.setReturnType('self');
      setter.setBody(`$this->${prop.name} = $${prop.name};\n\nreturn $this;`);
    }
  }
  
  // Add Laravel relation methods
  if (config.framework === 'laravel') {
    for (const prop of entity.properties) {
      if (prop.isRelation) {
        const relationMethod = class_.addMethod(prop.name);
        relationMethod.setPublic();
        if (prop.isCollection) {
          relationMethod.setReturnType('Illuminate\\Database\\Eloquent\\Relations\\HasMany');
          relationMethod.setBody(
            `return $this->hasMany(${prop.type}::class);`
          );
        } else {
          relationMethod.setReturnType('Illuminate\\Database\\Eloquent\\Relations\\BelongsTo');
          relationMethod.setBody(
            `return $this->belongsTo(${prop.type}::class);`
          );
        }
      }
    }
  }
  
  // Use Printer to ensure proper formatting with correct spacing between methods
  const printer = new Printer();
  printer.wrapLength = 120; // Allow longer lines for better readability
  printer.linesBetweenMethods = 1; // Single line between methods (PSR-12 standard)
  printer.linesBetweenProperties = 0; // No extra lines between properties
  printer.linesBetweenUseTypes = 1; // Single line between use statements
  return printer.printFile(file);
}

function buildNamespace(
  config: GeneratorConfig,
  boundedContextName?: string,
  aggregateName?: string
): string {
  let namespace = config.namespace || 'App\\Models';
  const directoryStructure = config.directoryStructure || 'flat';
  
  if ((directoryStructure === 'psr-4' || directoryStructure === 'aggregate') && boundedContextName && aggregateName) {
    namespace = `${namespace}\\${boundedContextName}\\${aggregateName}`;
  } else if (directoryStructure === 'bounded-context' && boundedContextName) {
    namespace = `${namespace}\\${boundedContextName}`;
  }
  
  return namespace;
}

type Commentable = { addComment: (comment: string) => void };

function addCollectionDocstring(
  target: Commentable,
  prop: CMLProperty,
  docType: 'var' | 'return' | 'param',
  config: GeneratorConfig
): void {
  if (!prop.isCollection) return;
  
  if (config.doctrineCollectionDocstrings && config.framework === 'doctrine') {
    const doc = docType === 'param'
      ? `@param \\Doctrine\\Common\\Collections\\Collection<array-key, ${prop.type}> $${prop.name}`
      : docType === 'return'
      ? `@return \\Doctrine\\Common\\Collections\\Collection<array-key, ${prop.type}>`
      : `@var \\Doctrine\\Common\\Collections\\Collection<array-key, ${prop.type}>`;
    target.addComment(doc);
  } else if (config.arrayDocstrings && config.framework === 'plain') {
    const doc = docType === 'param'
      ? `@param array<int, ${prop.type}> $${prop.name}`
      : docType === 'return'
      ? `@return array<int, ${prop.type}>`
      : `@var array<int, ${prop.type}>`;
    target.addComment(doc);
  }
}

function setupParameter(
  param: { setType: (type: string) => void; setNullable: (nullable: boolean) => void },
  prop: CMLProperty,
  config: GeneratorConfig
): void {
  param.setType(mapTypeToPHP(config, prop));
  if (prop.nullable) {
    param.setNullable(true);
  }
}

function shouldApplyReadonlyProperty(config: GeneratorConfig): boolean {
  return config.readonlyValueObjects === true && 
         config.phpVersion !== undefined &&
         parseFloat(config.phpVersion) >= 8.1 && 
         parseFloat(config.phpVersion) < 8.2;
}

function setVisibility(
  target: Property | PromotedParameter,
  isPublic: boolean
): void {
  if (isPublic) {
    target.setPublic();
  } else {
    target.setPrivate();
  }
}

function mapTypeToPHP(
  config: GeneratorConfig,
  prop: CMLProperty
): string {
  if (!prop.type || prop.type.trim() === '') {
    return 'mixed';
  }
  
  const lowerType = prop.type.toLowerCase();
  
  // Primitive types
  if (lowerType === 'string') return 'string';
  if (lowerType === 'int' || lowerType === 'integer') return 'int';
  if (lowerType === 'bool' || lowerType === 'boolean') return 'bool';
  if (lowerType === 'float' || lowerType === 'double') return 'float';
  if (lowerType === 'datetime') return '\\DateTime';
  if (lowerType === 'date') return '\\DateTime';
  if (lowerType === 'clob') return 'string';
  
  // Collections
  if (prop.isCollection) {
    if (config.framework === 'doctrine') {
      return 'Doctrine\\Common\\Collections\\Collection';
    } else if (config.framework === 'laravel') {
      return 'Illuminate\\Database\\Eloquent\\Collection';
    }
    return 'array';
  }
  
  // Relations and custom types
  return prop.type;
}

function mapDoctrineType(type: string): string {
  const lowerType = type.toLowerCase();
  if (lowerType === 'string') return 'string';
  if (lowerType === 'int' || lowerType === 'integer') return 'integer';
  if (lowerType === 'bool' || lowerType === 'boolean') return 'boolean';
  if (lowerType === 'float' || lowerType === 'double') return 'float';
  if (lowerType === 'datetime') return 'datetime';
  if (lowerType === 'date') return 'date';
  if (lowerType === 'clob') return 'text';
  return 'string';
}

function capitalize(str: string): string {
  return str.charAt(0).toUpperCase() + str.slice(1);
}

function getInversePropertyName(entityName: string): string {
  return toSnakeCase(entityName);
}

