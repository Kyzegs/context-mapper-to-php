import { readFile, readdir } from 'fs/promises';
import { join } from 'path';
import { parseCML } from '../lib/cml-parser';
import { generatePHP, type GeneratorConfig } from '../lib/php-generator';

interface TestResult {
  file: string;
  success: boolean;
  error?: string;
  configs: {
    config: GeneratorConfig;
    success: boolean;
    error?: string;
  }[];
}

const TEST_CONFIGS: GeneratorConfig[] = [
  {
    framework: 'plain',
    publicProperties: false,
    addGetters: true,
    addSetters: true,
    namespace: 'App\\Models',
    constructorType: 'none',
    constructorPropertyPromotion: false,
  },
  {
    framework: 'plain',
    publicProperties: true,
    addGetters: false,
    addSetters: false,
    namespace: 'App\\Models',
    constructorType: 'all',
    constructorPropertyPromotion: true,
  },
  {
    framework: 'laravel',
    publicProperties: false,
    addGetters: true,
    addSetters: true,
    namespace: 'App\\Models',
    constructorType: 'required',
    constructorPropertyPromotion: false,
  },
  {
    framework: 'doctrine',
    publicProperties: false,
    addGetters: true,
    addSetters: true,
    namespace: 'App\\Models',
    constructorType: 'all',
    constructorPropertyPromotion: false,
    doctrineCollectionDocstrings: true,
    doctrineAttributes: true,
  },
];

async function testFile(filePath: string): Promise<TestResult> {
  const fileName = filePath.split('/').pop() || filePath;
  console.log(`\n📄 Testing: ${fileName}`);

  const result: TestResult = {
    file: fileName,
    success: false,
    configs: [],
  };

  try {
    // Read and parse CML file
    const content = await readFile(filePath, 'utf-8');
    const model = parseCML(content);

    console.log(`   ✓ Parsed successfully`);
    console.log(`   - Bounded Contexts: ${model.boundedContexts.length}`);
    const totalAggregates = model.boundedContexts.reduce((sum, bc) => sum + bc.aggregates.length, 0);
    const totalEntities = model.boundedContexts.reduce(
      (sum, bc) => sum + bc.aggregates.reduce((s, a) => s + a.entities.length, 0),
      0
    );
    const totalValueObjects = model.boundedContexts.reduce(
      (sum, bc) => sum + bc.aggregates.reduce((s, a) => s + a.valueObjects.length, 0),
      0
    );
    const totalEnums = model.boundedContexts.reduce(
      (sum, bc) => sum + bc.aggregates.reduce((s, a) => s + a.enums.length, 0),
      0
    );
    console.log(`   - Aggregates: ${totalAggregates}`);
    console.log(`   - Entities: ${totalEntities}`);
    console.log(`   - Value Objects: ${totalValueObjects}`);
    console.log(`   - Enums: ${totalEnums}`);

    // Test each configuration
    for (const config of TEST_CONFIGS) {
      const configName = `${config.framework} (${config.publicProperties ? 'public' : 'private'}, getters: ${config.addGetters}, setters: ${config.addSetters})`;
      console.log(`   🔧 Testing config: ${configName}`);

      try {
        const files = generatePHP(model, config);

        if (!files || files.length === 0) {
          throw new Error('No PHP files generated');
        }

        // Basic validation: check for common PHP syntax in each file
        for (const file of files) {
          if (!file.content || file.content.trim() === '') {
            throw new Error(`Generated file ${file.filename} is empty`);
          }
          if (!file.content.includes('<?php')) {
            throw new Error(`Generated file ${file.filename} missing PHP opening tag`);
          }

          // Special validation for enum files
          if (file.type === 'enum') {
            // Check that enum has cases (not just an empty enum declaration)
            // PHP enums with cases will have "case" keyword in the content
            if (!file.content.includes('case ')) {
              throw new Error(`Generated enum file ${file.filename} has no enum cases (empty enum)`);
            }
            // Count the number of cases to ensure at least one exists
            const caseMatches = file.content.match(/case\s+\w+/g);
            if (!caseMatches || caseMatches.length === 0) {
              throw new Error(`Generated enum file ${file.filename} has no valid enum cases`);
            }
            // Ensure enum is string-backed (should have "string" type)
            if (!file.content.includes('enum ') || !file.content.includes('string')) {
              throw new Error(`Generated enum file ${file.filename} is not a string-backed enum`);
            }
          }
        }

        const totalChars = files.reduce((sum, f) => sum + f.content.length, 0);
        console.log(`      ✓ Generated ${files.length} file(s) with ${totalChars} total characters`);
        result.configs.push({
          config,
          success: true,
        });
      } catch (error) {
        const errorMessage = error instanceof Error ? error.message : String(error);
        const stackTrace = error instanceof Error ? error.stack : undefined;
        console.log(`      ✗ Error: ${errorMessage}`);
        if (stackTrace && stackTrace.includes('php-generator')) {
          console.log(`      Stack: ${stackTrace.split('\n').slice(0, 3).join('\n      ')}`);
        }
        result.configs.push({
          config,
          success: false,
          error: errorMessage + (stackTrace ? `\n${stackTrace}` : ''),
        });
      }
    }

    // Overall success if at least one config worked
    result.success = result.configs.some((c) => c.success);

    if (result.success) {
      console.log(`   ✅ File test completed`);
    } else {
      console.log(`   ❌ File test failed - all configs failed`);
      result.error = 'All configurations failed';
    }
  } catch (error) {
    const errorMessage = error instanceof Error ? error.message : String(error);
    console.log(`   ✗ Parse error: ${errorMessage}`);
    result.success = false;
    result.error = errorMessage;
  }

  return result;
}

async function runTests() {
  console.log('🧪 Starting PHP Generation Tests\n');
  console.log('='.repeat(60));

  const examplesDir = join(process.cwd(), 'examples');
  const files = await readdir(examplesDir);
  const cmlFiles = files.filter((f) => f.endsWith('.cml'));

  if (cmlFiles.length === 0) {
    console.log('❌ No CML files found in examples directory');
    process.exit(1);
  }

  console.log(`\nFound ${cmlFiles.length} CML file(s) to test\n`);

  const results: TestResult[] = [];

  for (const file of cmlFiles) {
    const filePath = join(examplesDir, file);
    const result = await testFile(filePath);
    results.push(result);
  }

  // Print summary
  console.log('\n' + '='.repeat(60));
  console.log('\n📊 Test Summary\n');

  const successfulFiles = results.filter((r) => r.success).length;
  const failedFiles = results.filter((r) => !r.success).length;
  const totalConfigs = results.reduce((sum, r) => sum + r.configs.length, 0);
  const successfulConfigs = results.reduce((sum, r) => sum + r.configs.filter((c) => c.success).length, 0);

  console.log(`Files tested: ${results.length}`);
  console.log(`✅ Successful: ${successfulFiles}`);
  console.log(`❌ Failed: ${failedFiles}`);
  console.log(`\nConfigurations tested: ${totalConfigs}`);
  console.log(`✅ Successful: ${successfulConfigs}`);
  console.log(`❌ Failed: ${totalConfigs - successfulConfigs}`);

  // Print detailed results
  if (failedFiles > 0) {
    console.log('\n❌ Failed Files:\n');
    for (const result of results) {
      if (!result.success) {
        console.log(`  ${result.file}:`);
        if (result.error) {
          console.log(`    Error: ${result.error}`);
        }
        for (const configResult of result.configs) {
          if (!configResult.success && configResult.error) {
            const configName = `${configResult.config.framework} (${configResult.config.publicProperties ? 'public' : 'private'})`;
            console.log(`    - ${configName}: ${configResult.error}`);
          }
        }
      }
    }
  }

  // Exit with appropriate code
  if (failedFiles > 0) {
    console.log('\n❌ Some tests failed');
    process.exit(1);
  } else {
    console.log('\n✅ All tests passed!');
    process.exit(0);
  }
}

// Run tests
runTests().catch((error) => {
  console.error('Fatal error:', error);
  process.exit(1);
});
