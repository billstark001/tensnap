#!/usr/bin/env node

import { build } from 'esbuild';
import { mkdtempSync, mkdirSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { basename, dirname, relative, resolve } from 'node:path';
import { pathToFileURL, fileURLToPath } from 'node:url';
// zod-to-ts still produces nodes with the pre-v7 JavaScript compiler API.
import ts from 'typescript-legacy-api';
import {
  createAuxiliaryTypeStore,
  createTypeAlias,
  printNode,
  zodToTs,
} from 'zod-to-ts';

const __dirname = fileURLToPath(new URL('.', import.meta.url));
const ROOT = resolve(__dirname, '..');
const WORKSPACE_ROOT = resolve(ROOT, '..', '..');
const SOURCE_ROOT = resolve(ROOT, 'src');

const sourceFiles = [
  'asset.ts',
  'chart.ts',
  'controls.ts',
  'layers.ts',
  'schemas.ts',
  'types.ts',
].map((name) => resolve(SOURCE_ROOT, name));

const outputArg = parseOutputArg(process.argv.slice(2));
const packageMetadata = readJson(resolve(ROOT, 'package.json'));
const generatedAt = new Date().toISOString();
const typeTextOverrides = new Map([
  ['AssetAgentIconSchema', '`asset:${string}`'],
]);

const sourceInfo = collectSourceInfo(sourceFiles);
const runtimeModule = await loadRuntimeModule();
const typeNameBySchemaValue = collectRuntimeSchemaTypeNames(runtimeModule, sourceInfo.typeNameBySchemaName);
const schemaDefinitions = renderSchemaDefinitions(runtimeModule, sourceInfo, typeNameBySchemaValue);

const markdown = renderMarkdown({
  generatedAt,
  packageMetadata,
  schemaDefinitions,
  sourceInfo,
});

if (outputArg) {
  const outputPath = resolve(ROOT, outputArg);
  mkdirSync(dirname(outputPath), { recursive: true });
  writeFileSync(outputPath, markdown, 'utf8');
} else {
  process.stdout.write(markdown);
}

function parseOutputArg(args) {
  const cleanArgs = args.filter((arg) => arg !== '--');
  if (cleanArgs.length === 0) {
    return undefined;
  }
  if (cleanArgs[0] === '--output' || cleanArgs[0] === '-o') {
    return cleanArgs[1];
  }
  return cleanArgs[0];
}

function readJson(path) {
  return JSON.parse(readFileSync(path, 'utf8'));
}

async function loadRuntimeModule() {
  const tempDir = mkdtempSync(resolve(tmpdir(), 'tensnap-protocol-docs-'));
  const outputFile = resolve(tempDir, 'index.mjs');

  try {
    await build({
      absWorkingDir: ROOT,
      bundle: true,
      entryPoints: [resolve(SOURCE_ROOT, 'index.ts')],
      format: 'esm',
      outfile: outputFile,
      platform: 'node',
      target: 'node18',
      write: true,
    });

    return await import(pathToFileURL(outputFile).href);
  } finally {
    rmSync(tempDir, { recursive: true, force: true });
  }
}

function collectSourceInfo(paths) {
  const schemaDocs = new Map();
  const schemaOrder = [];
  const typeNameBySchemaName = new Map();
  const sourceFiles = paths.map((path) => {
    const sourceText = readFileSync(path, 'utf8');
    return ts.createSourceFile(path, sourceText, ts.ScriptTarget.Latest, true, ts.ScriptKind.TS);
  });
  const schemaDeclarations = collectSchemaDeclarations(sourceFiles);

  for (const sourceFile of sourceFiles) {
    collectSchemaDocs(sourceFile, schemaDocs, schemaOrder, schemaDeclarations);
    collectTypeAliases(sourceFile, typeNameBySchemaName);
  }

  return {
    schemaDocs,
    schemaOrder,
    sourcePaths: paths,
    typeNameBySchemaName,
  };
}

function collectSchemaDeclarations(sourceFiles) {
  const declarations = new Map();

  for (const sourceFile of sourceFiles) {
    sourceFile.forEachChild((node) => {
      if (!ts.isVariableStatement(node)) {
        return;
      }

      for (const declaration of node.declarationList.declarations) {
        if (ts.isIdentifier(declaration.name) && declaration.name.text.endsWith('Schema')) {
          declarations.set(declaration.name.text, { declaration, sourceFile });
        }
      }
    });
  }

  return declarations;
}

function collectSchemaDocs(sourceFile, schemaDocs, schemaOrder, schemaDeclarations) {
  sourceFile.forEachChild((node) => {
    if (!ts.isVariableStatement(node) || !hasExportModifier(node)) {
      return;
    }

    const statementDoc = extractJsDoc(node, sourceFile);

    for (const declaration of node.declarationList.declarations) {
      if (!ts.isIdentifier(declaration.name)) {
        continue;
      }

      const schemaName = declaration.name.text;
      if (!schemaName.endsWith('Schema')) {
        continue;
      }

      schemaDocs.set(schemaName, {
        comment: statementDoc,
        fieldDocs: collectFieldDocs(declaration, sourceFile, schemaDeclarations),
        source: basename(sourceFile.fileName),
      });
      schemaOrder.push(schemaName);
    }
  });
}

function collectTypeAliases(sourceFile, typeNameBySchemaName) {
  sourceFile.forEachChild((node) => {
    if (!ts.isTypeAliasDeclaration(node) || !hasExportModifier(node)) {
      return;
    }

    const typeNode = node.type;
    const referencedSchema = findInferredSchemaName(typeNode);
    if (referencedSchema) {
      typeNameBySchemaName.set(referencedSchema, node.name.text);
    }
  });
}

function findInferredSchemaName(node) {
  if (!ts.isTypeReferenceNode(node)) {
    return undefined;
  }

  const typeName = node.typeName.getText();
  if (typeName !== 'z.infer' || node.typeArguments?.length !== 1) {
    return undefined;
  }

  const [argument] = node.typeArguments;
  if (!ts.isTypeQueryNode(argument) || !ts.isIdentifier(argument.exprName)) {
    return undefined;
  }

  return argument.exprName.text;
}

function collectFieldDocs(declaration, sourceFile, schemaDeclarations, seen = new Set()) {
  const fieldDocs = new Map();
  const baseSchemaName = findExtendedBaseSchemaName(declaration.initializer);
  if (baseSchemaName && !seen.has(baseSchemaName)) {
    const base = schemaDeclarations.get(baseSchemaName);
    if (base) {
      seen.add(baseSchemaName);
      for (const [name, comment] of collectFieldDocs(base.declaration, base.sourceFile, schemaDeclarations, seen)) {
        fieldDocs.set(name, comment);
      }
    }
  }

  const objectLiteral = findFirstZodObjectLiteral(declaration.initializer);
  if (!objectLiteral) {
    return fieldDocs;
  }

  for (const property of objectLiteral.properties) {
    if (!ts.isPropertyAssignment(property)) {
      continue;
    }
    const comment = extractJsDoc(property, sourceFile);
    if (comment) {
      fieldDocs.set(property.name.getText(sourceFile).replace(/^['"]|['"]$/g, ''), comment);
    }
  }

  return fieldDocs;
}

function findExtendedBaseSchemaName(node) {
  if (!node) {
    return undefined;
  }
  if (ts.isCallExpression(node) && isZodExtendCall(node)) {
    const expression = node.expression;
    return ts.isIdentifier(expression.expression) ? expression.expression.text : undefined;
  }

  for (const child of node.getChildren()) {
    const name = findExtendedBaseSchemaName(child);
    if (name) {
      return name;
    }
  }

  return undefined;
}

function findFirstZodObjectLiteral(node) {
  if (!node) {
    return undefined;
  }
  if (ts.isCallExpression(node) && (isZodObjectCall(node) || isZodExtendCall(node))) {
    const [argument] = node.arguments;
    if (argument && ts.isObjectLiteralExpression(argument)) {
      return argument;
    }
  }

  for (const child of node.getChildren()) {
    const found = findFirstZodObjectLiteral(child);
    if (found) {
      return found;
    }
  }

  return undefined;
}

function isZodObjectCall(node) {
  const expression = node.expression;
  return (
    ts.isPropertyAccessExpression(expression)
    && expression.name.text === 'object'
    && expression.expression.getText() === 'z'
  );
}

function isZodExtendCall(node) {
  return ts.isPropertyAccessExpression(node.expression) && node.expression.name.text === 'extend';
}

function hasExportModifier(node) {
  return node.modifiers?.some((modifier) => modifier.kind === ts.SyntaxKind.ExportKeyword) ?? false;
}

function extractJsDoc(node, sourceFile) {
  const docs = ts.getJSDocCommentsAndTags(node).filter((doc) => doc.kind === ts.SyntaxKind.JSDoc);
  if (docs.length === 0) {
    return '';
  }

  return cleanJsDoc(docs[docs.length - 1].getText(sourceFile));
}

function cleanJsDoc(raw) {
  return raw
    .replace(/^\/\*\*\s*/, '')
    .replace(/\s*\*\/$/, '')
    .split('\n')
    .map((line) => line.replace(/^\s*\*\s?/, '').trimEnd())
    .join('\n')
    .trim();
}

function collectRuntimeSchemaTypeNames(module, explicitTypeNames) {
  const typeNameBySchemaValue = new Map();

  for (const [exportName, value] of Object.entries(module)) {
    if (!exportName.endsWith('Schema') || !isZodSchema(value)) {
      continue;
    }
    typeNameBySchemaValue.set(value, explicitTypeNames.get(exportName) ?? exportName.slice(0, -'Schema'.length));
  }

  return typeNameBySchemaValue;
}

function isZodSchema(value) {
  return (
    typeof value === 'object'
    && value !== null
    && typeof value.safeParse === 'function'
    && value._zod
  );
}

function renderSchemaDefinitions(module, sourceInfo, typeNameBySchemaValue) {
  const availableSchemaNames = new Set(
    Object.entries(module)
      .filter(([, value]) => isZodSchema(value))
      .map(([name]) => name),
  );

  return sourceInfo.schemaOrder
    .filter((schemaName) => availableSchemaNames.has(schemaName))
    .map((schemaName) => {
      const schema = module[schemaName];
      const typeName = sourceInfo.typeNameBySchemaName.get(schemaName) ?? schemaName.slice(0, -'Schema'.length);
      const info = sourceInfo.schemaDocs.get(schemaName);
      const definition = renderTypeAlias(schemaName, schema, typeName, typeNameBySchemaValue, info?.fieldDocs ?? new Map());

      return {
        comment: info?.comment ?? '',
        definition,
        name: schemaName,
        source: info?.source ?? 'src/index.ts',
        typeName,
      };
    });
}

function renderTypeAlias(schemaName, schema, typeName, typeNameBySchemaValue, fieldDocs) {
  if (typeTextOverrides.has(schemaName)) {
    return `export type ${typeName} = ${typeTextOverrides.get(schemaName)};`;
  }

  const auxiliaryTypeStore = createAuxiliaryTypeStore();
  const overrideFunction = (candidateSchema, typescript) => {
    if (candidateSchema !== schema && typeNameBySchemaValue.has(candidateSchema)) {
      return createTypeNode(typeNameBySchemaValue.get(candidateSchema), typescript);
    }
    if (usesUint8ArrayCustom(schemaName) && candidateSchema?._zod?.def?.type === 'custom') {
      return createTypeNode('Uint8Array', typescript);
    }
    return undefined;
  };

  const { node } = zodToTs(schema, {
    auxiliaryTypeStore,
    overrideFunction,
    // Zod refinements/custom validators are runtime constraints. Their
    // TypeScript surface is represented by the surrounding inferred type.
    unrepresentable: 'any',
  });

  const primary = markTypeAliasExported(printNode(createTypeAlias(node, typeName)));
  const auxiliaries = Array.from(auxiliaryTypeStore.definitions.values())
    .filter((definition) => definition.node)
    .map((definition) => markTypeAliasExported(printNode(definition.node)));

  return injectFieldComments([primary, ...auxiliaries].join('\n\n'), fieldDocs);
}

function createTypeNode(typeText, typescript) {
  const sourceFile = typescript.createSourceFile(
    'type-node.ts',
    `type Generated = ${typeText};`,
    typescript.ScriptTarget.Latest,
    true,
    typescript.ScriptKind.TS,
  );
  const alias = sourceFile.statements.find(typescript.isTypeAliasDeclaration);
  if (!alias) {
    throw new Error(`Invalid generated type override: ${typeText}`);
  }
  return alias.type;
}

function usesUint8ArrayCustom(schemaName) {
  return (
    schemaName === 'AssetDataPayloadSchema'
    || schemaName === 'ScreenshotResponsePayloadSchema'
    || schemaName === 'BackgroundSourceSchema'
    || schemaName === 'BackgroundLayerMetadataSchema'
    || schemaName === 'BackgroundLayerCreatePayloadSchema'
    || schemaName === 'BuiltinLayerCreatePayloadSchema'
    || schemaName === 'CheckpointSchema'
  );
}

function markTypeAliasExported(text) {
  return text.replace(/^type /, 'export type ');
}

function injectFieldComments(definition, fieldDocs) {
  if (fieldDocs.size === 0) {
    return definition;
  }

  const output = [];
  for (const line of definition.split('\n')) {
    const match = line.match(/^(\s*)([A-Za-z_$][\w$]*|["'][^"']+["'])(\??):/);
    if (match) {
      const indent = match[1];
      const fieldName = match[2].replace(/^['"]|['"]$/g, '');
      const comment = fieldDocs.get(fieldName);
      if (comment) {
        output.push(`${indent}/**`);
        for (const commentLine of comment.split('\n')) {
          output.push(`${indent} * ${commentLine}`);
        }
        output.push(`${indent} */`);
      }
    }
    output.push(line);
  }

  return output.join('\n');
}

function renderMarkdown({ generatedAt, packageMetadata, schemaDefinitions, sourceInfo }) {
  const payloadSchemas = schemaDefinitions.filter((entry) => (
    entry.source === 'schemas.ts'
    && (
      entry.name.endsWith('PayloadSchema')
      || entry.name === 'StateSyncRequestSchema'
      || entry.name === 'TickTimingBreakdownSchema'
    )
  ));
  const messageSchemas = schemaDefinitions.filter((entry) => (
    entry.source === 'schemas.ts'
    && (
      entry.name === 'SimulatorToRendererMessageSchema'
      || entry.name === 'RendererToSimulatorMessageSchema'
      || entry.name === 'AnyProtocolMessageSchema'
    )
  ));
  const componentSchemas = schemaDefinitions.filter((entry) => (
    entry.source === 'asset.ts'
    || entry.source === 'chart.ts'
    || entry.source === 'controls.ts'
  ));
  const layerSchemas = schemaDefinitions.filter((entry) => entry.source === 'layers.ts');
  const supportingSchemas = schemaDefinitions.filter((entry) => (
    !payloadSchemas.includes(entry)
    && !messageSchemas.includes(entry)
    && !componentSchemas.includes(entry)
    && !layerSchemas.includes(entry)
  ));

  return [
    '# TenSnap Protocol Type Definitions',
    '',
    'This file is generated from the runtime Zod schemas. Edit `src/*.ts`, not this file.',
    '',
    '## Package Metadata',
    '',
    '| Field | Value |',
    '| --- | --- |',
    `| Package | \`${packageMetadata.name}\` |`,
    `| Version | \`${packageMetadata.version}\` |`,
    `| Description | ${packageMetadata.description ?? ''} |`,
    `| License | \`${packageMetadata.license ?? 'UNLICENSED'}\` |`,
    `| Generated At | \`${generatedAt}\` |`,
    `| Source Files | ${sourceInfo.sourcePaths.map((path) => `\`${relative(WORKSPACE_ROOT, path)}\``).join(', ')} |`,
    '',
    ...renderSection('Payload Schemas', payloadSchemas),
    ...renderSection('Message Envelopes', messageSchemas),
    ...renderSection('Built-in Layer Schemas', layerSchemas),
    ...renderSection('Controls, Charts, And Assets', componentSchemas),
    ...renderSection('Supporting Schemas', supportingSchemas),
  ].join('\n');
}

function renderSection(title, entries) {
  if (entries.length === 0) {
    return [`## ${title}`, '', 'No schemas in this group.', ''];
  }

  return [
    `## ${title}`,
    '',
    ...entries.flatMap((entry) => renderSchemaSection(entry)),
  ];
}

function renderSchemaSection(entry) {
  return [
    `### ${entry.typeName}`,
    '',
    `Schema: \`${entry.name}\` (${entry.source})`,
    '',
    entry.comment || 'No schema comment is defined.',
    '',
    '```ts',
    entry.definition,
    '```',
    '',
  ];
}
