import {
  ClassType,
  PhpFile,
  PhpNamespace,
  Property,
  Method,
  EnumType,
  PromotedParameter,
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
}

export interface GeneratedFile {
  filename: string;
  content: string;
  type: 'enum' | 'valueobject' | 'entity';
}

export function generatePHP(
  model: CMLModel,
  config: GeneratorConfig
): GeneratedFile[] {
  const files: GeneratedFile[] = [];
  
  for (const boundedContext of model.boundedContexts) {
    for (const aggregate of boundedContext.aggregates) {
      // Generate enums
      for (const enumDef of aggregate.enums) {
        const enumFile = generateEnum(enumDef, config);
        files.push({
          filename: `${enumDef.name}.php`,
          content: enumFile,
          type: 'enum',
        });
      }
      
      // Generate value objects first (they might be referenced by entities)
      for (const valueObject of aggregate.valueObjects) {
        const voFile = generateValueObject(valueObject, config);
        files.push({
          filename: `${valueObject.name}.php`,
          content: voFile,
          type: 'valueobject',
        });
      }
      
      // Generate entities
      for (const entity of aggregate.entities) {
        const entityFile = generateEntity(entity, aggregate, config);
        files.push({
          filename: `${entity.name}.php`,
          content: entityFile,
          type: 'entity',
        });
      }
    }
  }
  
  return files;
}

function generateEnum(enumDef: CMLEnum, config: GeneratorConfig): string {
  const file = new PhpFile();
  file.setStrictTypes();
  
  const namespace = config.namespace || 'App\\Models';
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
  config: GeneratorConfig
): string {
  const file = new PhpFile();
  file.setStrictTypes();
  
  const namespace = config.namespace || 'App\\Models';
  const ns = file.addNamespace(namespace);
  
  const class_ = ns.addClass(valueObject.name);
  class_.setFinal();
  
  // Determine which properties will be in constructor
  const propertiesForConstructor = config.constructorType !== 'none'
    ? (config.constructorType === 'required'
        ? valueObject.properties.filter(prop => !prop.nullable)
        : valueObject.properties)
    : [];
  
  const promotedProperties = new Set(
    config.constructorPropertyPromotion && config.constructorType !== 'none'
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
    if (config.publicProperties === true) {
      phpProp.setPublic();
    } else {
      phpProp.setPrivate();
    }
    const propType = mapTypeToPHP(prop.type, config);
    phpProp.setType(propType);
    if (prop.nullable) {
      phpProp.setNullable(true);
    }
  }
  
  // Add constructor based on config
  if (config.constructorType !== 'none' && valueObject.properties.length > 0) {
    const constructor = class_.addMethod('__construct');
    constructor.setPublic();
    
    let constructorBody = '';
    for (const prop of propertiesForConstructor) {
      const paramType = mapTypeToPHP(prop.type, config);
      
      if (config.constructorPropertyPromotion) {
        // Use promoted parameter
        const param = constructor.addPromotedParameter(prop.name);
        param.setType(paramType);
        if (prop.nullable) {
          param.setNullable(true);
        }
        // Set visibility on promoted parameter
        if (config.publicProperties === true) {
          param.setPublic();
        } else {
          param.setPrivate();
        }
        // Add collection docstring if enabled and it's a collection
        if (config.doctrineCollectionDocstrings && prop.isCollection && config.framework === 'doctrine') {
          param.addComment(`@var \\Doctrine\\Common\\Collections\\Collection<array-key, ${prop.type}>`);
        }
      } else {
        // Regular parameter
        const param = constructor.addParameter(prop.name);
        param.setType(paramType);
        if (prop.nullable) {
          param.setNullable(true);
        }
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
      const returnType = mapTypeToPHP(prop.type, config);
      getter.setReturnType(returnType);
      if (prop.nullable) {
        getter.setReturnNullable(true);
      }
      // Add collection docstring if enabled
      if (config.doctrineCollectionDocstrings && prop.isCollection && config.framework === 'doctrine') {
        getter.addComment(`@return \\Doctrine\\Common\\Collections\\Collection<array-key, ${prop.type}>`);
      }
      getter.setBody(`return $this->${prop.name};`);
    }
    
    if (config.addSetters) {
      const setter = class_.addMethod('set' + capitalize(prop.name));
      setter.setPublic();
      const paramType = mapTypeToPHP(prop.type, config);
      const param = setter.addParameter(prop.name);
      param.setType(paramType);
      if (prop.nullable) {
        param.setNullable(true);
      }
      // Add collection docstring if enabled
      if (config.doctrineCollectionDocstrings && prop.isCollection && config.framework === 'doctrine') {
        setter.addComment(`@param \\Doctrine\\Common\\Collections\\Collection<array-key, ${prop.type}> $${prop.name}`);
      }
      setter.setReturnType('self');
      setter.setBody(`$this->${prop.name} = $${prop.name};\n\nreturn $this;`);
    }
  }
  
  return file.toString();
}

function generateEntity(
  entity: CMLEntity,
  aggregate: { enums: CMLEnum[]; valueObjects: CMLValueObject[] },
  config: GeneratorConfig
): string {
  const file = new PhpFile();
  file.setStrictTypes();
  
  const namespace = config.namespace || 'App\\Models';
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
    ? entity.properties.filter(prop => {
        if (prop.isRelation && config.framework === 'laravel') {
          return false;
        }
        return true;
      })
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
    if (config.publicProperties === true) {
      phpProp.setPublic();
    } else {
      phpProp.setPrivate();
    }
    const phpType = mapTypeToPHP(prop.type, config, prop, aggregate);
    phpProp.setType(phpType);
    if (prop.nullable) {
      phpProp.setNullable(true);
    }
    
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
            if (config.doctrineCollectionDocstrings) {
              phpProp.addComment(`@var \\Doctrine\\Common\\Collections\\Collection<array-key, ${prop.type}>`);
            }
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
          if (config.doctrineCollectionDocstrings) {
            phpProp.addComment(`@var \\Doctrine\\Common\\Collections\\Collection<array-key, ${prop.type}>`);
          }
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
      const paramType = mapTypeToPHP(prop.type, config, prop, aggregate);
      
      if (config.constructorPropertyPromotion) {
        // Use promoted parameter
        const param = constructor.addPromotedParameter(prop.name);
        param.setType(paramType);
        if (prop.nullable) {
          param.setNullable(true);
        }
        // Set visibility on promoted parameter
        if (config.publicProperties === true) {
          param.setPublic();
        } else {
          param.setPrivate();
        }
        // Add collection docstring if enabled and it's a collection
        if (config.doctrineCollectionDocstrings && prop.isCollection && config.framework === 'doctrine') {
          param.addComment(`@var \\Doctrine\\Common\\Collections\\Collection<array-key, ${prop.type}>`);
        }
      } else {
        // Regular parameter
        const param = constructor.addParameter(prop.name);
        param.setType(paramType);
        if (prop.nullable) {
          param.setNullable(true);
        }
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
      const returnType = mapTypeToPHP(prop.type, config, prop, aggregate);
      getter.setReturnType(returnType);
      if (prop.nullable) {
        getter.setReturnNullable(true);
      }
      // Add collection docstring if enabled
      if (config.doctrineCollectionDocstrings && prop.isCollection && config.framework === 'doctrine') {
        getter.addComment(`@return \\Doctrine\\Common\\Collections\\Collection<array-key, ${prop.type}>`);
      }
      getter.setBody(`return $this->${prop.name};`);
    }
    
    if (config.addSetters) {
      const setter = class_.addMethod('set' + capitalize(prop.name));
      setter.setPublic();
      const paramType = mapTypeToPHP(prop.type, config, prop, aggregate);
      const param = setter.addParameter(prop.name);
      param.setType(paramType);
      if (prop.nullable) {
        param.setNullable(true);
      }
      // Add collection docstring if enabled
      if (config.doctrineCollectionDocstrings && prop.isCollection && config.framework === 'doctrine') {
        setter.addComment(`@param \\Doctrine\\Common\\Collections\\Collection<array-key, ${prop.type}> $${prop.name}`);
      }
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
  
  return file.toString();
}

function mapTypeToPHP(
  type: string,
  config: GeneratorConfig,
  prop?: CMLProperty,
  aggregate?: { enums: CMLEnum[]; valueObjects: CMLValueObject[] }
): string {
  if (!type || type.trim() === '') {
    return 'mixed';
  }
  
  const lowerType = type.toLowerCase();
  
  // Primitive types
  if (lowerType === 'string') return 'string';
  if (lowerType === 'int' || lowerType === 'integer') return 'int';
  if (lowerType === 'bool' || lowerType === 'boolean') return 'bool';
  if (lowerType === 'float' || lowerType === 'double') return 'float';
  if (lowerType === 'datetime') return '\\DateTime';
  if (lowerType === 'date') return '\\DateTime';
  if (lowerType === 'clob') return 'string';
  
  // Collections
  if (prop?.isCollection) {
    if (config.framework === 'doctrine') {
      return 'Doctrine\\Common\\Collections\\Collection';
    } else if (config.framework === 'laravel') {
      return 'Illuminate\\Database\\Eloquent\\Collection';
    }
    return 'array';
  }
  
  // Relations and custom types
  return type;
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

function toSnakeCase(str: string): string {
  return str.replace(/([A-Z])/g, '_$1').toLowerCase().replace(/^_/, '');
}

function getInversePropertyName(entityName: string): string {
  return toSnakeCase(entityName);
}

