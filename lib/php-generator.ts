import { PhpFile, Property, PromotedParameter, Printer } from 'js-php-generator';
import type { CMLModel, CMLAggregate, CMLEntity, CMLValueObject, CMLEnum, CMLProperty } from './cml-parser';

export type Framework = 'laravel' | 'doctrine' | 'plain';

export type DirectoryStructure = 'flat' | 'bounded-context' | 'aggregate' | 'aggregate-only' | 'psr-4';

export type ConstructorType = 'none' | 'required' | 'all';

export type PhpVersion = '8.1' | '8.2' | '8.3' | '8.4';

export type TypeFolder = 'Enum' | 'ValueObject' | 'Entity';

export interface RegexPatternMapping {
  pattern: string;
  typeFolder?: TypeFolder;
  subfolder: string;
  nameReplace?: string;
}

export interface GeneratorConfig {
  framework: Framework;
  publicProperties: boolean;
  addGetters: boolean;
  addSetters: boolean;
  namespace?: string;
  constructorType: ConstructorType;
  constructorPropertyPromotion: boolean;
  doctrineCollectionDocstrings?: boolean;
  doctrineAttributes?: boolean;
  arrayDocstrings?: boolean;
  directoryStructure?: DirectoryStructure;
  groupByType?: boolean;
  phpVersion?: PhpVersion;
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

      // Set of type names actually generated in this aggregate (processed names); only these get use statements
      const generatedInAggregate = getGeneratedTypeNamesInAggregate(aggregate, config);

      // Generate enums
      for (const enumDef of aggregate.enums) {
        const originalName = enumDef.name;
        const mappingResult = config.regexPatternMappings
          ? getSubfolderForFile(originalName, 'Enum', config.regexPatternMappings)
          : { subfolder: '' };
        const processedName = applyNameReplace(originalName, mappingResult.nameReplace);
        const enumFile = generateEnum(
          enumDef,
          config,
          boundedContext.name,
          aggregate.name,
          processedName,
          mappingResult.subfolder
        );
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
        const voFile = generateValueObject(
          valueObject,
          config,
          boundedContext.name,
          aggregate.name,
          processedName,
          mappingResult.subfolder,
          generatedInAggregate
        );
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
        const entityFile = generateEntity(
          entity,
          config,
          boundedContext.name,
          aggregate.name,
          processedName,
          mappingResult.subfolder,
          generatedInAggregate
        );
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

function getDirectoryPath(boundedContextName: string, aggregateName: string, structure: DirectoryStructure): string {
  switch (structure) {
    case 'flat':
      return '';

    case 'bounded-context':
      // Use PascalCase for directory names (CML names are already PascalCase)
      return boundedContextName;

    case 'aggregate':
      // Use PascalCase for directory names
      return `${boundedContextName}/${aggregateName}`;

    case 'aggregate-only':
      // Only aggregate name, no bounded context in path
      return aggregateName;

    case 'psr-4':
      // PSR-4 structure: namespace-based directory structure
      // Directory structure matches namespace structure (PascalCase)
      return `${boundedContextName}/${aggregateName}`;

    default:
      return '';
  }
}

/** Names of types (processed names) that are generated in this aggregate; only these get use statements. */
interface AggregateGeneratedTypes {
  entityNames: Set<string>;
  enumNames: Set<string>;
  valueObjectNames: Set<string>;
}

function getGeneratedTypeNamesInAggregate(aggregate: CMLAggregate, config: GeneratorConfig): AggregateGeneratedTypes {
  const mappings = config.regexPatternMappings ?? [];
  const entityNames = new Set<string>();
  const enumNames = new Set<string>();
  const valueObjectNames = new Set<string>();

  for (const e of aggregate.entities) {
    const result = mappings.length ? getSubfolderForFile(e.name, 'Entity', mappings) : { subfolder: '' };
    entityNames.add(applyNameReplace(e.name, result.nameReplace));
  }
  for (const en of aggregate.enums) {
    const result = mappings.length ? getSubfolderForFile(en.name, 'Enum', mappings) : { subfolder: '' };
    enumNames.add(applyNameReplace(en.name, result.nameReplace));
  }
  for (const vo of aggregate.valueObjects) {
    const result = mappings.length ? getSubfolderForFile(vo.name, 'ValueObject', mappings) : { subfolder: '' };
    valueObjectNames.add(applyNameReplace(vo.name, result.nameReplace));
  }

  return { entityNames, enumNames, valueObjectNames };
}

function getSubfolderForFile(
  filename: string,
  fileType: TypeFolder,
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

/**
 * Resolves a referenced type name (entity, enum, or value object) using the same
 * regex pattern mappings used for file names. E.g. ReadMerchant with mapping "^Read"
 * becomes Merchant.
 */
function resolveReferencedTypeName(typeName: string, fileType: TypeFolder, config: GeneratorConfig): string {
  if (!config.regexPatternMappings?.length) {
    return typeName;
  }
  const mappingResult = getSubfolderForFile(typeName, fileType, config.regexPatternMappings);
  return applyNameReplace(typeName, mappingResult.nameReplace);
}

/**
 * Returns the PHP type/class name to use for a property when it references
 * another entity, enum, or value object. Applies regex name replacements so
 * that e.g. relation type ReadMerchant with mapping "^Read" becomes Merchant.
 */
function getResolvedReferencedTypeName(prop: CMLProperty, config: GeneratorConfig): string {
  if (!prop.type) return prop.type || 'mixed';
  const fileType = prop.isRelation ? 'Entity' : prop.isEnum ? 'Enum' : 'ValueObject';
  return resolveReferencedTypeName(prop.type, fileType, config);
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
  nameOverride?: string,
  subfolder?: string
): string {
  const file = new PhpFile();
  file.setStrictTypes();

  const namespace = buildNamespace(config, boundedContextName, aggregateName, 'Enum', subfolder);
  const ns = file.addNamespace(namespace);

  // Add enum to the namespace so it is rendered with the correct namespace
  const enumName = nameOverride || enumDef.name;
  const enumType = ns.addEnum(enumName);
  // Make it a string-backed enum
  enumType.setType('string');

  for (const value of enumDef.values) {
    const cleanValue = value.replace(/[^a-zA-Z0-9_]/g, '_').toUpperCase();
    // Use the original value (cleaned) as the string backing value
    const stringValue = cleanValue;
    enumType.addCase(cleanValue, stringValue);
  }

  // js-php-generator's Printer.printFile() does not output enums that are inside
  // namespaces (it only prints namespace.classes and namespace.functions).
  // So we build the file manually: namespace declaration + enum body.
  const printer = new Printer();
  const namespaceDecl = namespace ? `namespace ${namespace};\n\n` : '';
  const enumBody = printer.printClass(enumType, ns);
  return `<?php\n\n${file.strictTypes ? 'declare(strict_types=1);\n\n' : ''}${namespaceDecl}${enumBody}`;
}

function generateValueObject(
  valueObject: CMLValueObject,
  config: GeneratorConfig,
  boundedContextName?: string,
  aggregateName?: string,
  nameOverride?: string,
  subfolder?: string,
  generatedInAggregate?: AggregateGeneratedTypes
): string {
  const file = new PhpFile();
  file.setStrictTypes();

  const namespace = buildNamespace(config, boundedContextName, aggregateName, 'ValueObject', subfolder);
  if (namespace) {
    file.addNamespace(namespace);
  }
  const ns = namespace ? file.getNamespace(namespace)! : null;
  if (generatedInAggregate) {
    addUseStatementsForReferencedTypes(
      ns,
      namespace ?? '',
      valueObject.properties,
      config,
      boundedContextName,
      aggregateName,
      generatedInAggregate
    );
  }
  const className = nameOverride || valueObject.name;
  const class_ = ns ? ns.addClass(className) : file.addClass(className);
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
  nameOverride?: string,
  subfolder?: string,
  generatedInAggregate?: AggregateGeneratedTypes
): string {
  const file = new PhpFile();
  file.setStrictTypes();

  const namespace = buildNamespace(config, boundedContextName, aggregateName, 'Entity', subfolder);
  if (namespace) {
    file.addNamespace(namespace);
  }
  const ns = namespace ? file.getNamespace(namespace)! : null;
  if (generatedInAggregate) {
    addUseStatementsForReferencedTypes(
      ns,
      namespace ?? '',
      entity.properties,
      config,
      boundedContextName,
      aggregateName,
      generatedInAggregate
    );
  }
  const className = nameOverride || entity.name;
  const class_ = ns ? ns.addClass(className) : file.addClass(className);

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
          const relationType = getResolvedReferencedTypeName(prop, config);
          if (prop.isCollection) {
            phpProp.addAttribute('Doctrine\\ORM\\Mapping\\OneToMany', [
              `targetEntity: ${relationType}::class`,
              `mappedBy: '${getInversePropertyName(entity.name)}'`,
            ]);
            phpProp.setType('Doctrine\\Common\\Collections\\Collection');

            // Add collection docstring if enabled
            addCollectionDocstring(phpProp, prop, 'var', config);
          } else {
            phpProp.addAttribute('Doctrine\\ORM\\Mapping\\ManyToOne', [`targetEntity: ${relationType}::class`]);
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
        const relationType = getResolvedReferencedTypeName(prop, config);
        const relationMethod = class_.addMethod(prop.name);
        relationMethod.setPublic();
        if (prop.isCollection) {
          relationMethod.setReturnType('Illuminate\\Database\\Eloquent\\Relations\\HasMany');
          relationMethod.setBody(`return $this->hasMany(${relationType}::class);`);
        } else {
          relationMethod.setReturnType('Illuminate\\Database\\Eloquent\\Relations\\BelongsTo');
          relationMethod.setBody(`return $this->belongsTo(${relationType}::class);`);
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
  aggregateName?: string,
  typeSegment?: TypeFolder,
  subfolder?: string
): string {
  const directoryStructure = config.directoryStructure || 'flat';
  const parts: string[] = [];

  if (config.namespace !== undefined && config.namespace !== '') {
    parts.push(config.namespace);
  }
  if ((directoryStructure === 'psr-4' || directoryStructure === 'aggregate') && boundedContextName && aggregateName) {
    parts.push(boundedContextName, aggregateName);
  } else if (directoryStructure === 'aggregate-only' && aggregateName) {
    parts.push(aggregateName);
  } else if (directoryStructure === 'bounded-context' && boundedContextName) {
    parts.push(boundedContextName);
  }
  if (config.groupByType && typeSegment) {
    parts.push(typeSegment);
  }
  if (subfolder && subfolder.trim()) {
    parts.push(subfolder.trim().replace(/\//g, '\\'));
  }

  return parts.join('\\');
}

/**
 * Returns the namespace where a referenced type (entity, enum, value object) would be generated,
 * including subfolder when the type matches a regex pattern mapping.
 */
function getNamespaceForReferencedType(
  originalTypeName: string,
  typeFolder: TypeFolder,
  config: GeneratorConfig,
  boundedContextName?: string,
  aggregateName?: string
): string {
  const mappingResult = config.regexPatternMappings
    ? getSubfolderForFile(originalTypeName, typeFolder, config.regexPatternMappings)
    : { subfolder: '' };
  return buildNamespace(config, boundedContextName, aggregateName, typeFolder, mappingResult.subfolder);
}

/** True if the type is a primitive or already fully qualified (contains \), so no use statement needed. */
function isBuiltInOrFullyQualifiedType(type: string): boolean {
  if (!type || type.includes('\\')) return true;
  const lower = type.toLowerCase();
  return [
    'string',
    'int',
    'integer',
    'bool',
    'boolean',
    'float',
    'double',
    'datetime',
    'date',
    'clob',
    'mixed',
    'array',
  ].includes(lower);
}

/**
 * Adds use statements only for types that are actually generated in this aggregate (entities, enums,
 * value objects). Types like UUID that are not defined in the aggregate are not imported.
 */
function addUseStatementsForReferencedTypes(
  ns: { addUse: (name: string, alias?: string, type?: 'class' | 'function' | 'constant') => void } | null,
  currentNamespace: string,
  properties: CMLProperty[],
  config: GeneratorConfig,
  boundedContextName: string | undefined,
  aggregateName: string | undefined,
  generatedInAggregate: AggregateGeneratedTypes
): void {
  if (!ns || !currentNamespace) return;

  const added = new Set<string>();
  for (const prop of properties) {
    if (!prop.type || isBuiltInOrFullyQualifiedType(prop.type)) continue;

    const resolvedName = getResolvedReferencedTypeName(prop, config);

    // Infer kind from which generated set contains this type (CML often uses "- Type name" for
    // enums/value objects too, so prop.isRelation/isEnum alone would misclassify).
    let fileType: TypeFolder | null = null;
    if (generatedInAggregate.entityNames.has(resolvedName)) fileType = 'Entity';
    else if (generatedInAggregate.enumNames.has(resolvedName)) fileType = 'Enum';
    else if (generatedInAggregate.valueObjectNames.has(resolvedName)) fileType = 'ValueObject';

    if (!fileType) continue;

    const targetNamespace = getNamespaceForReferencedType(
      prop.type,
      fileType,
      config,
      boundedContextName,
      aggregateName
    );

    if (targetNamespace === currentNamespace) continue;

    const fullClassName = `${targetNamespace}\\${resolvedName}`;
    if (added.has(fullClassName)) continue;
    added.add(fullClassName);
    ns.addUse(fullClassName, undefined, 'class');
  }
}

type Commentable = { addComment: (comment: string) => void };

function addCollectionDocstring(
  target: Commentable,
  prop: CMLProperty,
  docType: 'var' | 'return' | 'param',
  config: GeneratorConfig
): void {
  if (!prop.isCollection) return;

  const elementType = prop.isRelation || prop.isEnum ? getResolvedReferencedTypeName(prop, config) : prop.type;
  const arrayDoc =
    docType === 'param'
      ? `@param array<int, ${elementType}> $${prop.name}`
      : docType === 'return'
        ? `@return array<int, ${elementType}>`
        : `@var array<int, ${elementType}>`;

  if (config.framework === 'doctrine') {
    if (prop.isRelation && config.doctrineCollectionDocstrings) {
      const doc =
        docType === 'param'
          ? `@param \\Doctrine\\Common\\Collections\\Collection<array-key, ${elementType}> $${prop.name}`
          : docType === 'return'
            ? `@return \\Doctrine\\Common\\Collections\\Collection<array-key, ${elementType}>`
            : `@var \\Doctrine\\Common\\Collections\\Collection<array-key, ${elementType}>`;
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

  // Relations and custom types: apply regex mappings so e.g. ReadMerchant -> Merchant
  return getResolvedReferencedTypeName(prop, config);
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
