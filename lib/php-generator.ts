import { PhpFile, Property, PromotedParameter, Printer } from 'js-php-generator';
import type { CMLModel, CMLEntity, CMLValueObject, CMLEnum, CMLProperty } from './cml-parser';

export type Framework = 'laravel' | 'doctrine' | 'plain';

export interface RegexPatternMapping {
  pattern: string;
  typeFolder?: 'Enum' | 'ValueObject' | 'Entity';
  subfolder: string;
  nameReplace?: string;
}

export interface GeneratorConfig {
  framework: Framework;
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
  regexPatternMappings?: RegexPatternMapping[];
}

export interface GeneratedFile {
  filename: string;
  path: string; // Full path including directory structure
  content: string;
  type: 'enum' | 'valueobject' | 'entity';
}

export function generatePHP(model: CMLModel, config: GeneratorConfig): GeneratedFile[] {
  const files: GeneratedFile[] = [];
  const directoryStructure = config.directoryStructure || 'flat';
  const groupByType = config.groupByType || false;

  for (const boundedContext of model.boundedContexts) {
    for (const aggregate of boundedContext.aggregates) {
      // Determine directory path based on structure option
      const directoryPath = getDirectoryPath(boundedContext.name, aggregate.name, directoryStructure);

      // Generate enums
      for (const enumDef of aggregate.enums) {
        const originalName = enumDef.name;
        const mappingResult = config.regexPatternMappings
          ? getSubfolderForFile(originalName, 'Enum', config.regexPatternMappings)
          : { subfolder: '' };
        const processedName = applyNameReplace(originalName, mappingResult.nameReplace);
        const enumFile = generateEnum(enumDef, config, boundedContext.name, aggregate.name, processedName);
        const filename = `${processedName}.php`;
        const typeFolder = groupByType ? 'Enum/' : '';
        const fullPath = buildFilePath(directoryPath, typeFolder, mappingResult.subfolder, filename);
        files.push({
          filename,
          path: fullPath,
          content: enumFile,
          type: 'enum',
        });
      }

      // Generate value objects first (they might be referenced by entities)
      for (const valueObject of aggregate.valueObjects) {
        const originalName = valueObject.name;
        const mappingResult = config.regexPatternMappings
          ? getSubfolderForFile(originalName, 'ValueObject', config.regexPatternMappings)
          : { subfolder: '' };
        const processedName = applyNameReplace(originalName, mappingResult.nameReplace);
        const voFile = generateValueObject(valueObject, config, boundedContext.name, aggregate.name, processedName);
        const filename = `${processedName}.php`;
        const typeFolder = groupByType ? 'ValueObject/' : '';
        const fullPath = buildFilePath(directoryPath, typeFolder, mappingResult.subfolder, filename);
        files.push({
          filename,
          path: fullPath,
          content: voFile,
          type: 'valueobject',
        });
      }

      // Generate entities
      for (const entity of aggregate.entities) {
        const originalName = entity.name;
        const mappingResult = config.regexPatternMappings
          ? getSubfolderForFile(originalName, 'Entity', config.regexPatternMappings)
          : { subfolder: '' };
        const processedName = applyNameReplace(originalName, mappingResult.nameReplace);
        const entityFile = generateEntity(entity, config, boundedContext.name, aggregate.name, processedName);
        const filename = `${processedName}.php`;
        const typeFolder = groupByType ? 'Entity/' : '';
        const fullPath = buildFilePath(directoryPath, typeFolder, mappingResult.subfolder, filename);
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

function getSubfolderForFile(
  filename: string,
  fileType: 'Enum' | 'ValueObject' | 'Entity',
  mappings: RegexPatternMapping[]
): { subfolder: string; nameReplace?: string } {
  // Find the first matching pattern for this file type
  for (const mapping of mappings) {
    // If typeFolder is specified, it must match the file type
    if (mapping.typeFolder && mapping.typeFolder !== fileType) {
      continue;
    }

    if (!mapping.pattern || !mapping.subfolder) {
      continue;
    }

    try {
      const regex = new RegExp(mapping.pattern);
      if (regex.test(filename)) {
        return {
          subfolder: mapping.subfolder,
          nameReplace: mapping.nameReplace,
        };
      }
    } catch (err) {
      // Invalid regex pattern, skip it
      console.warn(`Invalid regex pattern: ${mapping.pattern}`, err);
    }
  }

  return { subfolder: '' };
}

function applyNameReplace(filename: string, nameReplace?: string): string {
  if (!nameReplace) {
    return filename;
  }

  try {
    const regex = new RegExp(nameReplace);
    return filename.replace(regex, '');
  } catch (err) {
    // Invalid regex pattern, return original filename
    console.warn(`Invalid name replace pattern: ${nameReplace}`, err);
    return filename;
  }
}

function buildFilePath(basePath: string, typeFolder: string, subfolder: string, filename: string): string {
  // Remove trailing slashes from typeFolder and subfolder, and filter out empty parts
  const cleanTypeFolder = typeFolder.replace(/\/+$/, '');
  const cleanSubfolder = subfolder.replace(/\/+$/, '');
  const parts = [basePath, cleanTypeFolder, cleanSubfolder, filename].filter(Boolean);
  return parts.join('/');
}

function toSnakeCase(str: string): string {
  return str
    .replace(/([A-Z])/g, '_$1')
    .toLowerCase()
    .replace(/^_/, '');
}

function generateEnum(
  enumDef: CMLEnum,
  config: GeneratorConfig,
  boundedContextName?: string,
  aggregateName?: string,
  nameOverride?: string
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

  file.addNamespace(namespace);

  // Add enum directly to file (not namespace) for proper rendering
  const enumName = nameOverride || enumDef.name;
  const enumType = file.addEnum(enumName);
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
  aggregateName?: string,
  nameOverride?: string
): string {
  const file = new PhpFile();
  file.setStrictTypes();

  const namespace = buildNamespace(config, boundedContextName, aggregateName);
  file.addNamespace(namespace);

  const className = nameOverride || valueObject.name;
  const class_ = file.addNamespace(namespace).addClass(className);
  class_.setFinal();

  // Apply readonly class for PHP 8.2+ if enabled
  if (config.readonlyValueObjects && config.phpVersion && parseFloat(config.phpVersion) >= 8.2) {
    class_.setReadOnly(true);
  }

  // Determine which properties will be in constructor
  // If readonly is enabled, all properties must be in constructor (they can't be set otherwise)
  const effectiveConstructorType = config.readonlyValueObjects ? 'all' : config.constructorType;
  const propertiesForConstructor =
    effectiveConstructorType !== 'none'
      ? effectiveConstructorType === 'required'
        ? valueObject.properties.filter((prop) => !prop.nullable)
        : valueObject.properties
      : [];

  const promotedProperties = new Set(
    config.constructorPropertyPromotion && effectiveConstructorType !== 'none'
      ? propertiesForConstructor.map((prop) => prop.name)
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
  aggregateName?: string,
  nameOverride?: string
): string {
  const file = new PhpFile();
  file.setStrictTypes();

  const namespace = buildNamespace(config, boundedContextName, aggregateName);
  file.addNamespace(namespace);

  const className = nameOverride || entity.name;
  const class_ = file.addNamespace(namespace).addClass(className);

  // Framework-specific setup
  if (config.framework === 'laravel') {
    class_.setExtends('Illuminate\\Database\\Eloquent\\Model');
    class_.addComment('@property-read int $id');
  } else if (config.framework === 'doctrine' && config.doctrineAttributes !== false) {
    class_.addAttribute('Doctrine\\ORM\\Mapping\\Entity');
    class_.addAttribute('Doctrine\\ORM\\Mapping\\Table', [`name: '${toSnakeCase(entity.name)}'`]);
  }

  // Get properties that should be in constructor (excluding Laravel relations)
  const propertiesForConstructor =
    config.constructorType !== 'none'
      ? entity.properties.filter((prop) => !(prop.isRelation && config.framework === 'laravel'))
      : [];

  // Determine which properties to include in constructor
  const propertiesToInclude =
    config.constructorType === 'required'
      ? propertiesForConstructor.filter((prop) => !prop.nullable)
      : propertiesForConstructor;

  // Track promoted properties to avoid duplicates
  const promotedProperties = new Set(
    config.constructorPropertyPromotion && config.constructorType !== 'none'
      ? propertiesToInclude.map((prop) => prop.name)
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
              `mappedBy: '${getInversePropertyName(entity.name)}'`,
            ]);
            phpProp.setType('Doctrine\\Common\\Collections\\Collection');

            // Add collection docstring if enabled
            addCollectionDocstring(phpProp, prop, 'var', config);
          } else {
            phpProp.addAttribute('Doctrine\\ORM\\Mapping\\ManyToOne', [`targetEntity: ${prop.type}::class`]);
          }
        } else if (prop.isCollection) {
          // Primitive collection (e.g. List<string>) – store as JSON, PHP type is array
          phpProp.addAttribute('Doctrine\\ORM\\Mapping\\Column', [`type: 'json'`, `nullable: ${prop.nullable}`]);
        } else {
          phpProp.addAttribute('Doctrine\\ORM\\Mapping\\Column', [
            `type: '${mapDoctrineType(prop.type)}'`,
            `nullable: ${prop.nullable}`,
          ]);
        }
      } else {
        // Doctrine framework but attributes disabled - relation collections use Collection type
        if (prop.isCollection && prop.isRelation) {
          phpProp.setType('Doctrine\\Common\\Collections\\Collection');
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

    // Add Doctrine collection initialization (relation collections only; primitive collections use array)
    if (config.framework === 'doctrine') {
      const includedNames = new Set(propertiesToInclude.map((p) => p.name));
      for (const prop of entity.properties) {
        if (prop.isCollection && prop.isRelation) {
          constructorBody += `$this->${prop.name} = new \\Doctrine\\Common\\Collections\\ArrayCollection();\n`;
        } else if (prop.isCollection && !prop.isRelation && !includedNames.has(prop.name)) {
          constructorBody += `$this->${prop.name} = [];\n`;
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
    const hasCollections = entity.properties.some((prop) => prop.isCollection);
    if (hasCollections) {
      const constructor = class_.addMethod('__construct');
      constructor.setPublic();
      let constructorBody = '';
      for (const prop of entity.properties) {
        if (prop.isCollection && prop.isRelation) {
          constructorBody += `$this->${prop.name} = new \\Doctrine\\Common\\Collections\\ArrayCollection();\n`;
        } else if (prop.isCollection && !prop.isRelation) {
          constructorBody += `$this->${prop.name} = [];\n`;
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
          relationMethod.setBody(`return $this->hasMany(${prop.type}::class);`);
        } else {
          relationMethod.setReturnType('Illuminate\\Database\\Eloquent\\Relations\\BelongsTo');
          relationMethod.setBody(`return $this->belongsTo(${prop.type}::class);`);
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

function buildNamespace(config: GeneratorConfig, boundedContextName?: string, aggregateName?: string): string {
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

  const arrayDoc =
    docType === 'param'
      ? `@param array<int, ${prop.type}> $${prop.name}`
      : docType === 'return'
        ? `@return array<int, ${prop.type}>`
        : `@var array<int, ${prop.type}>`;

  if (config.framework === 'doctrine') {
    if (prop.isRelation && config.doctrineCollectionDocstrings) {
      const doc =
        docType === 'param'
          ? `@param \\Doctrine\\Common\\Collections\\Collection<array-key, ${prop.type}> $${prop.name}`
          : docType === 'return'
            ? `@return \\Doctrine\\Common\\Collections\\Collection<array-key, ${prop.type}>`
            : `@var \\Doctrine\\Common\\Collections\\Collection<array-key, ${prop.type}>`;
      target.addComment(doc);
    } else if (!prop.isRelation && config.arrayDocstrings) {
      target.addComment(arrayDoc);
    }
  } else if (config.arrayDocstrings && config.framework === 'plain') {
    target.addComment(arrayDoc);
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
  return (
    config.readonlyValueObjects === true &&
    config.phpVersion !== undefined &&
    parseFloat(config.phpVersion) >= 8.1 &&
    parseFloat(config.phpVersion) < 8.2
  );
}

function setVisibility(target: Property | PromotedParameter, isPublic: boolean): void {
  if (isPublic) {
    target.setPublic();
  } else {
    target.setPrivate();
  }
}

function mapTypeToPHP(config: GeneratorConfig, prop: CMLProperty): string {
  if (!prop.type || prop.type.trim() === '') {
    return 'mixed';
  }

  // Collections: check before primitive types so List<string>, Set<int> etc. become array/Collection
  if (prop.isCollection) {
    if (prop.isRelation) {
      if (config.framework === 'doctrine') {
        return 'Doctrine\\Common\\Collections\\Collection';
      }
      if (config.framework === 'laravel') {
        return 'Illuminate\\Database\\Eloquent\\Collection';
      }
    }
    return 'array';
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
