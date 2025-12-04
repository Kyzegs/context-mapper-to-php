// Types for CML (Context Mapper Language) structures

export interface CMLProperty {
  name: string;
  type: string;
  nullable: boolean;
  isRelation: boolean;
  isCollection: boolean;
  isEnum?: boolean;
}

export interface CMLEnum {
  name: string;
  values: string[];
}

export interface CMLValueObject {
  name: string;
  properties: CMLProperty[];
}

export interface CMLEntity {
  name: string;
  isAggregateRoot: boolean;
  properties: CMLProperty[];
}

export interface CMLAggregate {
  name: string;
  entities: CMLEntity[];
  valueObjects: CMLValueObject[];
  enums: CMLEnum[];
}

export interface CMLBoundedContext {
  name: string;
  aggregates: CMLAggregate[];
}

export interface CMLModel {
  boundedContexts: CMLBoundedContext[];
}

// Parser for CML files
export function parseCML(content: string): CMLModel {
  const lines = content.split('\n').map(line => line.trim()).filter(line => line && !line.startsWith('//'));
  
  const boundedContexts: CMLBoundedContext[] = [];
  let currentBoundedContext: CMLBoundedContext | null = null;
  let currentAggregate: CMLAggregate | null = null;
  let currentEntity: CMLEntity | null = null;
  let currentValueObject: CMLValueObject | null = null;
  let currentEnum: CMLEnum | null = null;
  
  for (let i = 0; i < lines.length; i++) {
    const line = lines[i];
    
    // BoundedContext
    if (line.startsWith('BoundedContext ')) {
      const name = line.match(/BoundedContext\s+(\w+)/)?.[1] || '';
      currentBoundedContext = {
        name,
        aggregates: []
      };
      boundedContexts.push(currentBoundedContext);
      continue;
    }
    
    // Aggregate
    if (line.startsWith('Aggregate ')) {
      const name = line.match(/Aggregate\s+(\w+)/)?.[1] || '';
      currentAggregate = {
        name,
        entities: [],
        valueObjects: [],
        enums: []
      };
      if (currentBoundedContext) {
        currentBoundedContext.aggregates.push(currentAggregate);
      }
      continue;
    }
    
    // Entity
    if (line.startsWith('Entity ')) {
      const name = line.match(/Entity\s+(\w+)/)?.[1] || '';
      currentEntity = {
        name,
        isAggregateRoot: false,
        properties: []
      };
      if (currentAggregate) {
        currentAggregate.entities.push(currentEntity);
      }
      continue;
    }
    
    // ValueObject
    if (line.startsWith('ValueObject ')) {
      const name = line.match(/ValueObject\s+(\w+)/)?.[1] || '';
      currentValueObject = {
        name,
        properties: []
      };
      if (currentAggregate) {
        currentAggregate.valueObjects.push(currentValueObject);
      }
      continue;
    }
    
    // Enum
    if (line.startsWith('enum ')) {
      const name = line.match(/enum\s+(\w+)/)?.[1] || '';
      currentEnum = {
        name,
        values: []
      };
      if (currentAggregate) {
        currentAggregate.enums.push(currentEnum);
      }
      continue;
    }
    
    // Closing braces - check this BEFORE enum value parsing to avoid processing '}' as a value
    if (line === '}' || line.endsWith('}')) {
      if (currentEnum) currentEnum = null;
      if (currentValueObject) currentValueObject = null;
      if (currentEntity) currentEntity = null;
      // Check if aggregate is closing
      if (currentAggregate && !currentEntity && !currentValueObject && !currentEnum) {
        // Look ahead to see if there are more entities/value objects
        const remainingLines = lines.slice(i + 1).join(' ');
        if (!remainingLines.includes('Entity ') && 
            !remainingLines.includes('ValueObject ') && 
            !remainingLines.includes('enum ') &&
            !remainingLines.includes('Aggregate ')) {
          // This aggregate is done
        }
      }
      continue;
    }
    
    // Enum values - must be checked BEFORE property parsing to avoid conflicts
    if (line && currentEnum) {
      // Remove comments
      const cleanLine = line.replace(/\/\/.*$/, '').trim();
      if (cleanLine && cleanLine !== '}' && !cleanLine.startsWith('enum ')) {
        if (cleanLine.includes(',')) {
          // Handle comma-separated values
          const values = cleanLine.split(',').map(v => v.trim().replace(/[;,\/\/].*$/, '').trim()).filter(v => v && v !== '}');
          currentEnum.values.push(...values);
        } else {
          // Single value on its own line
          const value = cleanLine.replace(/[;,\/\/].*$/, '').trim();
          if (value && value !== '}' && !value.includes('enum')) {
            currentEnum.values.push(value);
          }
        }
      }
      continue; // Skip property parsing for enum values
    }
    
    // aggregateRoot
    if (line === 'aggregateRoot' && currentEntity) {
      currentEntity.isAggregateRoot = true;
      continue;
    }
    
    // Property parsing
    if (line && currentEntity) {
      const property = parseProperty(line);
      if (property) {
        currentEntity.properties.push(property);
      }
    }
    
    if (line && currentValueObject) {
      const property = parseProperty(line);
      if (property) {
        currentValueObject.properties.push(property);
      }
    }
  }
  
  return { boundedContexts };
}

function parseProperty(line: string): CMLProperty | null {
  // Remove comments
  line = line.replace(/\/\/.*$/, '').trim();
  if (!line || line === '{' || line === '}' || line === 'aggregateRoot') return null;
  
  const nullable = line.includes('nullable');
  const isRelation = line.startsWith('-');
  const isCollection = line.includes('Set<') || line.includes('List<');
  const hasEnumMarker = line.includes('^');
  
  // Extract collection type if present
  let collectionType = '';
  if (isCollection) {
    const match = line.match(/(?:Set|List)<(\w+)>/);
    if (match) {
      collectionType = match[1];
    }
  }
  
  // Remove nullable, Set<, List<, ^, and other modifiers for parsing
  let cleanLine = line
    .replace(/\s*nullable\s*/g, '')
    .replace(/Set<\w+>/g, collectionType || '')
    .replace(/List<\w+>/g, collectionType || '')
    .replace(/^-/, '')
    .trim();
  
  // Handle ^ symbol - it indicates an enum reference, remove it but keep the type
  cleanLine = cleanLine.replace(/\^/g, '');
  
  // Extract type and name
  const parts = cleanLine.split(/\s+/).filter(p => p);
  if (parts.length < 2) return null;
  
  const type = parts[0];
  const name = parts[1].replace(/[;,]/, '');
  
  // If it's a collection, use the extracted collection type
  const finalType = isCollection && collectionType ? collectionType : type;
  
  return {
    name,
    type: finalType,
    nullable,
    isRelation,
    isCollection,
    isEnum: hasEnumMarker
  };
}

