import * as fs from 'fs';
import * as path from 'path';
import { fileURLToPath } from 'url';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

function isWordChar(char: string | undefined): boolean {
  return !!(char && /[a-zA-Z0-9_$]/.test(char));
}

function rewriteImport(importStr: string, targets: string[]): string {
  const hasTarget = targets.some(target => new RegExp(`\\b${target}\\b`).test(importStr));
  if (!hasTarget) return importStr;

  const match = importStr.match(/^import\s+([\s\S]+?)\s+from\s+([\s\S]+)$/);
  if (!match) {
    return ""; 
  }

  const specifiersPart = match[1].trim();
  const fromPart = match[2].trim();

  for (const target of targets) {
    if (new RegExp(`\\*\\s+as\\s+${target}\\b`).test(specifiersPart)) {
      return "";
    }
  }

  let defaultImport = "";
  let namedImportsStr = "";

  const braceMatch = specifiersPart.match(/^(.*?)\{\s*([\s\S]*?)\s*\}/);
  if (braceMatch) {
    defaultImport = braceMatch[1].trim().replace(/,$/, '').trim();
    namedImportsStr = braceMatch[2].trim();
  } else {
    defaultImport = specifiersPart;
  }

  if (targets.includes(defaultImport)) {
    defaultImport = "";
  }

  let newNamedList: string[] = [];
  if (namedImportsStr) {
    const namedItems = namedImportsStr.split(',').map(s => s.trim()).filter(Boolean);
    for (const item of namedItems) {
      const parts = item.split(/\s+as\s+/);
      const importedName = parts[0].trim();
      const localName = parts[parts.length - 1].trim();
      if (targets.includes(importedName) || targets.includes(localName)) {
        continue;
      }
      newNamedList.push(item);
    }
  }

  if (!defaultImport && newNamedList.length === 0) {
    return "";
  }

  let newSpecifiers = "";
  if (defaultImport) {
    newSpecifiers = defaultImport;
    if (newNamedList.length > 0) {
      newSpecifiers += `, { ${newNamedList.join(', ')} }`;
    }
  } else {
    newSpecifiers = `{ ${newNamedList.join(', ')} }`;
  }

  return `import ${newSpecifiers} from ${fromPart}`;
}

function cleanImports(code: string, targets: string[]): string {
  let result = "";
  let lastIndex = 0;

  let inString: string | null = null;
  let inComment: 'line' | 'block' | null = null;
  let importStart: number | null = null;
  let hasFrom = false;
  let hasSourceString = false;

  let i = 0;
  const n = code.length;
  while (i < n) {
    const char = code[i];

    if (inComment === 'line') {
      if (char === '\n') {
        inComment = null;
        if (importStart !== null && hasSourceString) {
          const importStr = code.slice(importStart, i);
          result += code.slice(lastIndex, importStart) + rewriteImport(importStr, targets);
          lastIndex = i;
          importStart = null;
          hasFrom = false;
          hasSourceString = false;
        }
      }
      i++;
      continue;
    }

    if (inComment === 'block') {
      if (char === '*' && code[i+1] === '/') {
        inComment = null;
        i += 2;
        continue;
      }
      i++;
      continue;
    }

    if (inString) {
      if (char === '\\') {
        i += 2;
        continue;
      }
      if (char === inString) {
        inString = null;
        if (importStart !== null && hasFrom) {
          hasSourceString = true;
        }
      }
      i++;
      continue;
    }

    if (char === '/' && code[i+1] === '/') {
      inComment = 'line';
      i += 2;
      continue;
    }
    if (char === '/' && code[i+1] === '*') {
      inComment = 'block';
      i += 2;
      continue;
    }
    if (char === "'" || char === '"' || char === '`') {
      inString = char;
      i++;
      continue;
    }

    if (importStart === null) {
      if (code.slice(i, i+6) === 'import' && !isWordChar(code[i-1]) && !isWordChar(code[i+6])) {
        importStart = i;
        hasFrom = false;
        hasSourceString = false;
        i += 6;
        continue;
      }
    } else {
      if (char === ';') {
        const importStr = code.slice(importStart, i + 1);
        const rewritten = rewriteImport(importStr, targets);
        result += code.slice(lastIndex, importStart) + rewritten;
        if (rewritten === "") {
          if (code[i + 1] === '\n') {
            i++;
          } else if (code[i + 1] === '\r' && code[i + 2] === '\n') {
            i += 2;
          }
        }
        lastIndex = i + 1;
        importStart = null;
        hasFrom = false;
        hasSourceString = false;
        i++;
        continue;
      }

      if (!hasFrom && code.slice(i, i+4) === 'from' && !isWordChar(code[i-1]) && !isWordChar(code[i+4])) {
        hasFrom = true;
        i += 4;
        continue;
      }

      if (char === '\n' && hasSourceString) {
        const importStr = code.slice(importStart, i);
        const rewritten = rewriteImport(importStr, targets);
        result += code.slice(lastIndex, importStart) + rewritten;
        lastIndex = i;
        importStart = null;
        hasFrom = false;
        hasSourceString = false;
        i++;
        continue;
      }
    }

    i++;
  }

  result += code.slice(lastIndex);
  return result;
}

function findEndOfOpeningTag(code: string, startIndex: number) {
  let inString: string | null = null;
  let inComment: 'line' | 'block' | null = null;
  let braceDepth = 0;
  let i = startIndex;
  const n = code.length;

  while (i < n) {
    const char = code[i];

    if (inComment === 'line') {
      if (char === '\n') inComment = null;
      i++;
      continue;
    }
    if (inComment === 'block') {
      if (char === '*' && code[i+1] === '/') {
        inComment = null;
        i += 2;
        continue;
      }
      i++;
      continue;
    }
    if (inString) {
      if (char === '\\') {
        i += 2;
        continue;
      }
      if (char === inString) inString = null;
      i++;
      continue;
    }

    if (char === '/' && code[i+1] === '/') {
      inComment = 'line';
      i += 2;
      continue;
    }
    if (char === '/' && code[i+1] === '*') {
      inComment = 'block';
      i += 2;
      continue;
    }
    if (char === "'" || char === '"' || char === '`') {
      inString = char;
      i++;
      continue;
    }

    if (char === '{') {
      braceDepth++;
      i++;
      continue;
    }
    if (char === '}') {
      braceDepth--;
      i++;
      continue;
    }

    if (braceDepth === 0) {
      if (char === '/' && code[i+1] === '>') {
        return { endIndex: i + 2, selfClosing: true };
      }
      if (char === '>') {
        return { endIndex: i + 1, selfClosing: false };
      }
    }

    i++;
  }

  return { endIndex: startIndex, selfClosing: false };
}

function findMatchingClosingTag(code: string, startIndex: number, tagName: string) {
  let inString: string | null = null;
  let inComment: 'line' | 'block' | null = null;
  let depth = 1;
  let i = startIndex;
  const n = code.length;

  while (i < n) {
    const char = code[i];

    if (inComment === 'line') {
      if (char === '\n') inComment = null;
      i++;
      continue;
    }
    if (inComment === 'block') {
      if (char === '*' && code[i+1] === '/') {
        inComment = null;
        i += 2;
        continue;
      }
      i++;
      continue;
    }
    if (inString) {
      if (char === '\\') {
        i += 2;
        continue;
      }
      if (char === inString) inString = null;
      i++;
      continue;
    }

    if (char === '/' && code[i+1] === '/') {
      inComment = 'line';
      i += 2;
      continue;
    }
    if (char === '/' && code[i+1] === '*') {
      inComment = 'block';
      i += 2;
      continue;
    }
    if (char === "'" || char === '"' || char === '`') {
      inString = char;
      i++;
      continue;
    }

    if (char === '<') {
      if (code[i+1] === '/') {
        if (code.slice(i + 2, i + 2 + tagName.length) === tagName && !isWordChar(code[i + 2 + tagName.length])) {
          depth--;
          if (depth === 0) {
            const closingTagEnd = code.indexOf('>', i + 2 + tagName.length);
            return { start: i, end: closingTagEnd !== -1 ? closingTagEnd + 1 : i + 3 + tagName.length };
          }
        }
      } else {
        if (code.slice(i + 1, i + 1 + tagName.length) === tagName && !isWordChar(code[i + 1 + tagName.length])) {
          const { endIndex, selfClosing } = findEndOfOpeningTag(code, i + 1 + tagName.length);
          if (!selfClosing) {
            depth++;
          }
          i = endIndex;
          continue;
        }
      }
    }

    i++;
  }

  return { start: startIndex, end: startIndex };
}

interface WrapperInstance {
  start: number;
  end: number;
  openingEnd?: number;
  closingStart?: number;
  selfClosing: boolean;
  wrapperName: string;
}

function rewriteWrapperInstance(code: string, inst: WrapperInstance): string {
  if (inst.selfClosing) {
    return code.slice(0, inst.start) + code.slice(inst.end);
  }
  
  if (inst.openingEnd !== undefined && inst.closingStart !== undefined) {
    const children = code.slice(inst.openingEnd, inst.closingStart);
    return code.slice(0, inst.start) + children + code.slice(inst.end);
  }
  
  return code;
}

function findFirstWrapperInstance(code: string, wrapperNames: string[]): WrapperInstance | null {
  let inString: string | null = null;
  let inComment: 'line' | 'block' | null = null;
  
  let i = 0;
  const n = code.length;
  while (i < n) {
    const char = code[i];

    if (inComment === 'line') {
      if (char === '\n') inComment = null;
      i++;
      continue;
    }
    if (inComment === 'block') {
      if (char === '*' && code[i+1] === '/') {
        inComment = null;
        i += 2;
        continue;
      }
      i++;
      continue;
    }
    if (inString) {
      if (char === '\\') {
        i += 2;
        continue;
      }
      if (char === inString) inString = null;
      i++;
      continue;
    }

    if (char === '/' && code[i+1] === '/') {
      inComment = 'line';
      i += 2;
      continue;
    }
    if (char === '/' && code[i+1] === '*') {
      inComment = 'block';
      i += 2;
      continue;
    }
    if (char === "'" || char === '"' || char === '`') {
      inString = char;
      i++;
      continue;
    }

    if (char === '<' && code[i+1] !== '/') {
      for (const wrapperName of wrapperNames) {
        if (code.slice(i + 1, i + 1 + wrapperName.length) === wrapperName && !isWordChar(code[i + 1 + wrapperName.length])) {
          const startOfTag = i;
          const { endIndex, selfClosing } = findEndOfOpeningTag(code, i + 1 + wrapperName.length);
          
          if (selfClosing) {
            return {
              start: startOfTag,
              end: endIndex,
              selfClosing: true,
              wrapperName
            };
          } else {
            const closingTag = findMatchingClosingTag(code, endIndex, wrapperName);
            return {
              start: startOfTag,
              end: closingTag.end,
              openingEnd: endIndex,
              closingStart: closingTag.start,
              selfClosing: false,
              wrapperName
            };
          }
        }
      }
    }

    i++;
  }

  return null;
}

function stripJSX(code: string, wrapperNames: string[]): string {
  let currentCode = code;
  let replaced = true;
  let limit = 100; 

  while (replaced && limit > 0) {
    replaced = false;
    const instance = findFirstWrapperInstance(currentCode, wrapperNames);
    if (instance) {
      currentCode = rewriteWrapperInstance(currentCode, instance);
      replaced = true;
      limit--;
    }
  }

  return currentCode;
}

function getModelName(tableName: string): string {
  tableName = tableName.toLowerCase();
  if (tableName.endsWith('ies')) return tableName.slice(0, -3) + 'y';
  if (tableName.endsWith('s') && !tableName.endsWith('ss')) return tableName.slice(0, -1);
  return tableName;
}

function translateDBCall(method: string, argsStr: string): string {
  const methodMap: Record<string, string> = {
    'find': 'findMany',
    'insert': 'create',
    'create': 'create',
    'findOne': 'findFirst',
    'update': 'update',
    'delete': 'delete',
    'remove': 'delete'
  };
  
  const prismaMethod = methodMap[method] || method;
  let modelName = 'user';
  let remainingArgs = argsStr;
  
  const strLiteralRegex = /^(['"`])(.*?)\1\s*(?:,\s*([\s\S]*))?$/;
  const match = argsStr.match(strLiteralRegex);
  
  if (match) {
    const rawTableName = match[2];
    modelName = getModelName(rawTableName);
    remainingArgs = (match[3] || '').trim();
  }
  
  let formattedArgs = remainingArgs;
  if (remainingArgs) {
    if (prismaMethod === 'findMany' || prismaMethod === 'findFirst') {
      if (!remainingArgs.includes('where:') && !remainingArgs.includes('select:')) {
        formattedArgs = `{ where: ${remainingArgs} }`;
      }
    } else if (prismaMethod === 'create') {
      if (!remainingArgs.includes('data:')) {
        formattedArgs = `{ data: ${remainingArgs} }`;
      }
    }
  }
  
  return `prisma.${modelName}.${prismaMethod}(${formattedArgs})`;
}

function addImportsIfMissing(code: string, importLine: string, checkPath: string): string {
  if (code.includes(checkPath)) return code;
  
  let insertIndex = 0;
  const useClientMatch = code.match(/^['"]use client['"];?\s*/);
  if (useClientMatch) {
    insertIndex = useClientMatch[0].length;
  }
  
  return code.slice(0, insertIndex) + importLine + '\n' + code.slice(insertIndex);
}

function rewriteDBAndAuth(code: string, recipe: any, nextJS: boolean): string {
  const astRules = (recipe && recipe.ast_rules) || {};
  const dbWrapper = astRules.db_wrapper || "Base44DB";
  const authWrapper = astRules.auth_wrapper || "Base44Auth";
  const authHook = astRules.auth_hook || "useBase44User";

  const dbReplacementImport = astRules.db_replacement_import || "import { prisma } from '@/lib/prisma';";
  const dbReplacementPath = astRules.db_replacement_path || "@/lib/prisma";

  let authReplacementWrapper = "";
  let authReplacementHook = "";
  let authReplacementImport = "";
  let authReplacementPath = "";

  if (nextJS) {
    const nextAuth = astRules.auth_replacement_nextjs || {};
    authReplacementWrapper = nextAuth.wrapper || "SessionProvider";
    authReplacementHook = nextAuth.hook || "useSession";
    authReplacementImport = nextAuth.import_line || "import { SessionProvider, useSession } from 'next-auth/react';";
    authReplacementPath = nextAuth.import_path || "next-auth/react";
  } else {
    const customAuth = astRules.auth_replacement_custom || {};
    authReplacementWrapper = customAuth.wrapper || "AuthProvider";
    authReplacementHook = customAuth.hook || "useAuth";
    authReplacementImport = customAuth.import_line || "import { AuthProvider, useAuth } from '@/context/AuthContext';";
    authReplacementPath = customAuth.import_path || "@/context/AuthContext";
  }

  let result = "";
  let lastIndex = 0;
  let inString: string | null = null;
  let inComment: 'line' | 'block' | null = null;
  let addedDbImport = false;
  let addedAuthImport = false;

  let i = 0;
  const n = code.length;
  while (i < n) {
    const char = code[i];

    if (inComment === 'line') {
      if (char === '\n') inComment = null;
      i++;
      continue;
    }
    if (inComment === 'block') {
      if (char === '*' && code[i+1] === '/') {
        inComment = null;
        i += 2;
        continue;
      }
      i++;
      continue;
    }
    if (inString) {
      if (char === '\\') {
        i += 2;
        continue;
      }
      if (char === inString) inString = null;
      i++;
      continue;
    }

    if (char === '/' && code[i+1] === '/') {
      inComment = 'line';
      i += 2;
      continue;
    }
    if (char === '/' && code[i+1] === '*') {
      inComment = 'block';
      i += 2;
      continue;
    }
    if (char === "'" || char === '"' || char === '`') {
      inString = char;
      i++;
      continue;
    }

    // 1. Rewrite DB Calls
    if (code.slice(i, i + dbWrapper.length) === dbWrapper && !isWordChar(code[i-1]) && !isWordChar(code[i + dbWrapper.length])) {
      const startIdx = i;
      i += dbWrapper.length;
      if (code[i] === '.') {
        i++;
        let method = "";
        while (isWordChar(code[i])) {
          method += code[i];
          i++;
        }
        
        while (code[i] && /\s/.test(code[i])) i++;
        
        if (code[i] === '(') {
          let parenDepth = 1;
          let argStart = i + 1;
          i++;
          
          let argInString: string | null = null;
          let argEscaped = false;
          
          while (i < n && parenDepth > 0) {
            const c = code[i];
            if (argEscaped) {
              argEscaped = false;
              i++;
              continue;
            }
            if (c === '\\') {
              argEscaped = true;
              i++;
              continue;
            }
            if (argInString) {
              if (c === argInString) argInString = null;
              i++;
              continue;
            }
            if (c === "'" || c === '"' || c === '`') {
              argInString = c;
              i++;
              continue;
            }
            if (c === '(') parenDepth++;
            if (c === ')') parenDepth--;
            i++;
          }
          
          const argsStr = code.slice(argStart, i - 1).trim();
          const replacement = translateDBCall(method, argsStr);
          result += code.slice(lastIndex, startIdx) + replacement;
          lastIndex = i;
          addedDbImport = true;
          continue;
        }
      }
    }

    // 2. Rewrite Auth Hook calls
    if (code.slice(i, i + authHook.length) === authHook && !isWordChar(code[i-1]) && !isWordChar(code[i + authHook.length])) {
      result += code.slice(lastIndex, i) + authReplacementHook;
      lastIndex = i + authHook.length;
      i += authHook.length;
      addedAuthImport = true;
      continue;
    }

    // 3. Rewrite Auth Wrapper Tags (Opening and Closing)
    if (char === '<') {
      const isClosing = code[i+1] === '/';
      const tagNameStart = isClosing ? i + 2 : i + 1;
      if (code.slice(tagNameStart, tagNameStart + authWrapper.length) === authWrapper && !isWordChar(code[tagNameStart + authWrapper.length])) {
        const replaceTag = isClosing ? `</${authReplacementWrapper}>` : `<${authReplacementWrapper}>`;
        const tagEndIndex = code.indexOf('>', tagNameStart);
        result += code.slice(lastIndex, i) + replaceTag;
        lastIndex = tagEndIndex !== -1 ? tagEndIndex + 1 : tagNameStart + authWrapper.length + 1;
        i = lastIndex;
        addedAuthImport = true;
        continue;
      }
    }

    i++;
  }

  result += code.slice(lastIndex);

  if (addedDbImport) {
    result = addImportsIfMissing(result, dbReplacementImport, dbReplacementPath);
  }
  if (addedAuthImport) {
    result = addImportsIfMissing(result, authReplacementImport, authReplacementPath);
  }

  return result;
}

function ensurePrismaSchema(projectDir: string) {
  const prismaDir = path.join(projectDir, 'prisma');
  const schemaPath = path.join(prismaDir, 'schema.prisma');
  
  if (!fs.existsSync(prismaDir)) {
    fs.mkdirSync(prismaDir, { recursive: true });
  }
  
  if (!fs.existsSync(schemaPath)) {
    const defaultSchema = `// This is your Prisma schema file,
// autogenerated by LiberateJS.

datasource db {
  provider = "postgresql"
  url      = env("DATABASE_URL")
}

generator client {
  provider = "prisma-client-js"
}

model User {
  id        Int      @id @default(autoincrement())
  email     String   @unique
  name      String?
  createdAt DateTime @default(now())
}
`;
    fs.writeFileSync(schemaPath, defaultSchema, 'utf8');
  }
}

function processContent(content: string, recipe: any, nextJS: boolean): string {
  const astRules = (recipe && recipe.ast_rules) || {};
  const wrapperNames = astRules.wrappers || ["StandaloneWrapper", "Base44Wrapper"];
  const authWrapper = astRules.auth_wrapper || "Base44Auth";
  const authHook = astRules.auth_hook || "useBase44User";
  const dbWrapper = astRules.db_wrapper || "Base44DB";

  let processed = stripJSX(content, wrapperNames);
  processed = cleanImports(processed, [...wrapperNames, authWrapper, authHook, dbWrapper]);
  processed = rewriteDBAndAuth(processed, recipe, nextJS);

  return processed;
}

export function runRewriter(paths: string[], options: {
  dryRun: boolean;
  verbose: boolean;
  recipePath: string | null;
  wrappers?: string[];
}) {
  let recipe: any = null;

  if (options.recipePath) {
    try {
      const recipeContent = fs.readFileSync(path.resolve(options.recipePath), 'utf8');
      recipe = JSON.parse(recipeContent);
    } catch (err: any) {
      console.error(`Failed to load recipe from ${options.recipePath}: ${err.message}`);
      throw new Error(`Failed to load recipe from ${options.recipePath}: ${err.message}`);
    }
  } else {
    // Try base44 default fallback
    const defaultRecipePath = path.join(__dirname, '..', 'recipes', 'base44.json');
    if (fs.existsSync(defaultRecipePath)) {
      try {
        const recipeContent = fs.readFileSync(defaultRecipePath, 'utf8');
        recipe = JSON.parse(recipeContent);
      } catch (err) {}
    }
  }

  let targets = ["StandaloneWrapper", "Base44Wrapper"];
  if (recipe && recipe.ast_rules && recipe.ast_rules.wrappers) {
    targets = recipe.ast_rules.wrappers;
  }
  if (options.wrappers) {
    targets = options.wrappers;
  }

  if (!recipe) {
    recipe = {
      name: "base44",
      ast_rules: {
        wrappers: targets,
        db_wrapper: "Base44DB",
        auth_wrapper: "Base44Auth",
        auth_hook: "useBase44User"
      }
    };
  }

  function findProjectRoot(startDir: string): string {
    let dir = path.resolve(startDir);
    while (dir) {
      if (fs.existsSync(path.join(dir, 'package.json'))) {
        return dir;
      }
      const parent = path.dirname(dir);
      if (parent === dir) break;
      dir = parent;
    }
    return path.resolve(startDir);
  }

  const projectDir = findProjectRoot(paths.length > 0 ? paths[0] : process.cwd());
  const hasNextConfig = fs.existsSync(path.join(projectDir, 'next.config.js')) || 
                        fs.existsSync(path.join(projectDir, 'next.config.mjs')) ||
                        fs.existsSync(path.join(projectDir, 'next.config.ts'));
  const isNextJS = hasNextConfig;

  if (!options.dryRun) {
    ensurePrismaSchema(projectDir);
  }

  const excludeDirs = new Set([".git", "node_modules", "dist", "build", ".next", ".cache"]);
  const filesToProcess: string[] = [];

  function walkDir(dir: string, fileList: string[] = []) {
    const files = fs.readdirSync(dir);
    for (const file of files) {
      if (excludeDirs.has(file)) continue;
      const filePath = path.join(dir, file);
      const stat = fs.statSync(filePath);
      if (stat.isDirectory()) {
        walkDir(filePath, fileList);
      } else if (stat.isFile() && /\.(js|jsx|ts|tsx)$/.test(file)) {
        fileList.push(filePath);
      }
    }
    return fileList;
  }

  for (const p of paths) {
    if (!fs.existsSync(p)) {
      console.error(`Error: Path does not exist: ${p}`);
      continue;
    }
    const stat = fs.statSync(p);
    if (stat.isDirectory()) {
      walkDir(p, filesToProcess);
    } else if (stat.isFile()) {
      filesToProcess.push(p);
    }
  }

  if (filesToProcess.length === 0) {
    console.log("No JS/JSX/TS/TSX files found to process.");
    return;
  }

  console.log(`Rewriter targets: ${targets.join(', ')}`);
  console.log(`Scanning ${filesToProcess.length} files...`);
  if (options.dryRun) {
    console.log("DRY RUN MODE: No files will be modified.\n");
  }

  let modifiedCount = 0;

  for (const file of filesToProcess) {
    try {
      const originalContent = fs.readFileSync(file, 'utf8');
      const newContent = processContent(originalContent, recipe, isNextJS);

      if (originalContent !== newContent) {
        modifiedCount++;
        const relativePath = path.relative(process.cwd(), file) || file;
        console.log(`[MODIFIED] ${relativePath}`);
        if (!options.dryRun) {
          fs.writeFileSync(file, newContent, 'utf8');
        }
      } else {
        if (options.verbose) {
          const relativePath = path.relative(process.cwd(), file) || file;
          console.log(`[NO CHANGE] ${relativePath}`);
        }
      }
    } catch (err: any) {
      console.error(`Error processing file ${file}:`, err.message);
    }
  }

  console.log(`\nScan complete. Modified ${modifiedCount} out of ${filesToProcess.length} files.`);
}
