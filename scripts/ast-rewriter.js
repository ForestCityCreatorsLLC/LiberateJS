#!/usr/bin/env node

/**
 * zero-dependency JS/JSX scanner and AST rewriter script
 * Identifies and strips wrapper components like <StandaloneWrapper> and <Base44Wrapper>
 * along with their corresponding imports, and safely formats the output.
 */

const fs = require('fs');
const path = require('path');

// Helper to check if a character is a word character (part of a JS identifier)
function isWordChar(char) {
  return char && /[a-zA-Z0-9_$]/.test(char);
}

/**
 * Rewrites a single import statement to remove specified target components.
 * If no specifiers are left, returns an empty string to remove the import statement entirely.
 */
function rewriteImport(importStr, targets) {
  const hasTarget = targets.some(target => new RegExp(`\\b${target}\\b`).test(importStr));
  if (!hasTarget) return importStr;

  // Split import into specifiers part and module source part
  const match = importStr.match(/^import\s+([\s\S]+?)\s+from\s+([\s\S]+)$/);
  if (!match) {
    return ""; // Unrecognized import containing target names -> delete to be safe
  }

  const specifiersPart = match[1].trim();
  const fromPart = match[2].trim();

  // Handle namespace import: import * as StandaloneWrapper from '...'
  for (const target of targets) {
    if (new RegExp(`\\*\\s+as\\s+${target}\\b`).test(specifiersPart)) {
      return "";
    }
  }

  let defaultImport = "";
  let namedImportsStr = "";

  // Check if there are named imports in curly braces
  const braceMatch = specifiersPart.match(/^(.*?)\{\s*([\s\S]*?)\s*\}/);
  if (braceMatch) {
    defaultImport = braceMatch[1].trim().replace(/,$/, '').trim();
    namedImportsStr = braceMatch[2].trim();
  } else {
    defaultImport = specifiersPart;
  }

  // Remove default import if it matches a target
  if (targets.includes(defaultImport)) {
    defaultImport = "";
  }

  // Filter named imports
  let newNamedList = [];
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

  // If nothing remains, remove the import statement entirely
  if (!defaultImport && newNamedList.length === 0) {
    return "";
  }

  // Rebuild the import statement
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

/**
 * Scans the codebase to extract and rewrite import statements.
 * Uses a state machine to skip comments and strings.
 */
function cleanImports(code, targets) {
  let result = "";
  let lastIndex = 0;

  let inString = null;
  let inComment = null;
  let importStart = null;
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

    // Identify start of comments/strings
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

    // Detect import statements
    if (importStart === null) {
      if (code.slice(i, i+6) === 'import' && !isWordChar(code[i-1]) && !isWordChar(code[i+6])) {
        importStart = i;
        hasFrom = false;
        hasSourceString = false;
        i += 6;
        continue;
      }
    } else {
      // Scanning inside an active import statement
      if (char === ';') {
        const importStr = code.slice(importStart, i + 1);
        const rewritten = rewriteImport(importStr, targets);
        result += code.slice(lastIndex, importStart) + rewritten;
        if (rewritten === "") {
          // Skip trailing newline if it exists
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

/**
 * Finds the ending index of a JSX opening tag (either > or />), skipping strings,
 * comments, and recursively tracking curly braces.
 */
function findEndOfOpeningTag(code, startIndex) {
  let inString = null;
  let inComment = null;
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

    // Track JSX attribute curly braces
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

  throw new Error("Unterminated opening JSX tag starting at index " + startIndex);
}

/**
 * Finds the matching closing tag for a given wrapperName.
 * Tracks nested instances of the same wrapper to ensure depth balancing.
 */
function findMatchingClosingTag(code, startIndex, wrapperName) {
  let inString = null;
  let inComment = null;
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
        // Match closing tag </wrapperName>
        if (code.slice(i + 2, i + 2 + wrapperName.length) === wrapperName && !isWordChar(code[i + 2 + wrapperName.length])) {
          let closingEnd = i + 2 + wrapperName.length;
          while (closingEnd < n && code[closingEnd] !== '>') {
            closingEnd++;
          }
          if (closingEnd < n) closingEnd++; // include '>'
          
          depth--;
          if (depth === 0) {
            return { start: i, end: closingEnd };
          }
          i = closingEnd;
          continue;
        }
      } else {
        // Match nested opening tag <wrapperName>
        if (code.slice(i + 1, i + 1 + wrapperName.length) === wrapperName && !isWordChar(code[i + 1 + wrapperName.length])) {
          const { endIndex, selfClosing } = findEndOfOpeningTag(code, i + 1 + wrapperName.length);
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

  throw new Error(`No matching closing tag found for ${wrapperName} starting at index ${startIndex}`);
}

function getLineEnd(code, index) {
  let i = index;
  while (i < code.length && code[i] !== '\n') {
    i++;
  }
  return i;
}

function isLineWhitespaceOnlyBefore(code, index) {
  let i = index - 1;
  while (i >= 0 && code[i] !== '\n') {
    if (code[i] !== ' ' && code[i] !== '\t' && code[i] !== '\r') {
      return false;
    }
    i--;
  }
  return true;
}

function isLineWhitespaceOnlyAfter(code, index) {
  let i = index;
  while (i < code.length && code[i] !== '\n') {
    if (code[i] !== ' ' && code[i] !== '\t' && code[i] !== '\r') {
      return false;
    }
    i++;
  }
  return true;
}

/**
 * Safely removes tags and associated lines when tags sit on their own line.
 * This preserves clean indentation and removes empty lines left behind.
 */
function deleteRangesAndCleanup(code, ranges) {
  let result = code;

  for (const range of ranges) {
    let start = range.start;
    let end = range.end;

    // Check if the range is the only non-whitespace thing on its lines
    let lineStart = start;
    while (lineStart > 0 && result[lineStart - 1] !== '\n') {
      lineStart--;
    }
    const leadingWhitespace = result.slice(lineStart, start);
    const isLeadingWhitespaceOnly = /^[ \t]*$/.test(leadingWhitespace);

    let lineEnd = end;
    while (lineEnd < result.length && result[lineEnd] !== '\n') {
      lineEnd++;
    }
    const trailingWhitespace = result.slice(end, lineEnd);
    const isTrailingWhitespaceOnly = /^[ \t\r]*$/.test(trailingWhitespace);

    if (isLeadingWhitespaceOnly && isTrailingWhitespaceOnly) {
      // Strip the whole line(s) including trailing newline
      start = lineStart;
      if (lineEnd < result.length && result[lineEnd] === '\n') {
        end = lineEnd + 1;
      } else {
        end = lineEnd;
      }
    }

    result = result.slice(0, start) + result.slice(end);
  }

  return result;
}

function rewriteWrapperInstance(code, instance) {
  if (instance.selfClosing) {
    return deleteRangesAndCleanup(code, [{ start: instance.start, end: instance.end }]);
  }

  const openingStart = instance.start;
  const openingEnd = instance.openingEnd;
  const closingStart = instance.closingStart;
  const closingEnd = instance.end;

  let childrenText = code.slice(openingEnd, closingStart);

  // 1. Calculate indentation of opening tag
  let lineStart = openingStart;
  while (lineStart > 0 && code[lineStart - 1] !== '\n') {
    lineStart--;
  }
  const leadingWhitespace = code.slice(lineStart, openingStart);
  
  const openingLineEnd = getLineEnd(code, openingEnd);
  const isOpeningOnOwnLine = /^[ \t]*$/.test(leadingWhitespace) && /^[ \t\r]*$/.test(code.slice(openingEnd, openingLineEnd));
  const openingIndentation = /^[ \t]*$/.exec(leadingWhitespace)[0].length;

  const isClosingOnOwnLine = isLineWhitespaceOnlyBefore(code, closingStart) && isLineWhitespaceOnlyAfter(code, closingEnd);

  // 2. Adjust childrenText for newlines if wrapped on own lines
  if (isOpeningOnOwnLine) {
    if (childrenText.startsWith('\r\n')) {
      childrenText = childrenText.slice(2);
    } else if (childrenText.startsWith('\n')) {
      childrenText = childrenText.slice(1);
    }
  }
  if (isClosingOnOwnLine) {
    if (childrenText.endsWith('\r\n')) {
      childrenText = childrenText.slice(0, -2);
    } else if (childrenText.endsWith('\n')) {
      childrenText = childrenText.slice(0, -1);
    }
  }

  // 3. Calculate indentation of first child line
  const childrenLines = childrenText.split('\n');
  let firstChildIndentation = null;
  for (const line of childrenLines) {
    if (line.trim() !== '') {
      const match = /^[ \t]*/.exec(line);
      firstChildIndentation = match[0].length;
      break;
    }
  }

  // 4. Dedent children if needed
  if (firstChildIndentation !== null && firstChildIndentation > openingIndentation) {
    const dedentAmount = firstChildIndentation - openingIndentation;
    childrenText = childrenLines.map(line => {
      if (line.trim() === '') return '';
      let strip = 0;
      while (strip < dedentAmount && (line[strip] === ' ' || line[strip] === '\t')) {
        strip++;
      }
      return line.slice(strip);
    }).join('\n');
  }

  // 5. Slice and assemble the rewritten code
  let finalBefore = code.slice(0, openingStart);
  let finalAfter = code.slice(closingEnd);

  if (isOpeningOnOwnLine) {
    finalBefore = code.slice(0, lineStart);
  }

  if (isClosingOnOwnLine) {
    const closingLineEnd = getLineEnd(code, closingEnd);
    if (closingLineEnd < code.length && code[closingLineEnd] === '\n') {
      finalAfter = code.slice(closingLineEnd + 1);
    } else {
      finalAfter = code.slice(closingLineEnd);
    }
  }

  return finalBefore + childrenText + finalAfter;
}

function findFirstWrapperInstance(code, wrapperNames) {
  let inString = null;
  let inComment = null;

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

    // Look for tag start `<` (excluding closing tag `</`)
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

/**
 * Strips specified JSX wrapper tags, keeping their child nodes intact.
 */
function stripJSX(code, wrapperNames) {
  let currentCode = code;
  let replaced = true;
  let limit = 100; // Prevent infinite loops in case of unexpected edge cases

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

/**
 * Helper to singularize table names for Prisma client mapping.
 */
function getModelName(tableName) {
  tableName = tableName.toLowerCase();
  if (tableName.endsWith('ies')) return tableName.slice(0, -3) + 'y';
  if (tableName.endsWith('s') && !tableName.endsWith('ss')) return tableName.slice(0, -1);
  return tableName;
}

/**
 * Translates a legacy Base44DB call to a Prisma client query.
 */
function translateDBCall(method, argsStr) {
  const methodMap = {
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

/**
 * Adds an import statement to the top of the file if not already present.
 * Respects 'use client' directives at the top.
 */
function addImportsIfMissing(code, importLine, checkPath) {
  if (code.includes(checkPath)) return code;
  
  let insertIndex = 0;
  const useClientMatch = code.match(/^['"]use client['"];?\s*/);
  if (useClientMatch) {
    insertIndex = useClientMatch[0].length;
  }
  
  return code.slice(0, insertIndex) + importLine + '\n' + code.slice(insertIndex);
}

/**
 * Scans code to replace legacy Base44DB calls and Auth tags/hooks.
 * Keeps comments and string literals intact.
 */
function rewriteDBAndAuth(code, nextJS) {
  let result = "";
  let lastIndex = 0;
  let inString = null;
  let inComment = null;
  
  let hasDB = false;
  let hasAuth = false;
  
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
    
    // Base44DB call
    if (code.slice(i, i + 9) === 'Base44DB.') {
      const dbStart = i;
      i += 9;
      let methodName = "";
      while (i < n && /[a-zA-Z0-9_$]/.test(code[i])) {
        methodName += code[i];
        i++;
      }
      
      while (i < n && /\s/.test(code[i])) {
        i++;
      }
      
      if (code[i] === '(') {
        const parenStart = i;
        let parenDepth = 1;
        let j = i + 1;
        let argInString = null;
        let argInComment = null;
        
        while (j < n && parenDepth > 0) {
          const c = code[j];
          if (argInComment === 'line') {
            if (c === '\n') argInComment = null;
            j++;
            continue;
          }
          if (argInComment === 'block') {
            if (c === '*' && code[j+1] === '/') {
              argInComment = null;
              j += 2;
              continue;
            }
            j++;
            continue;
          }
          if (argInString) {
            if (c === '\\') {
              j += 2;
              continue;
            }
            if (c === argInString) argInString = null;
            j++;
            continue;
          }
          if (c === '/' && code[j+1] === '/') {
            argInComment = 'line';
            j += 2;
            continue;
          }
          if (c === '/' && code[j+1] === '*') {
            argInComment = 'block';
            j += 2;
            continue;
          }
          if (c === "'" || c === '"' || c === '`') {
            argInString = c;
            j++;
            continue;
          }
          if (c === '(') parenDepth++;
          if (c === ')') parenDepth--;
          j++;
        }
        
        const parenEnd = j;
        const argsStr = code.slice(parenStart + 1, parenEnd - 1).trim();
        
        const dbCallReplacement = translateDBCall(methodName, argsStr);
        hasDB = true;
        
        result += code.slice(lastIndex, dbStart) + dbCallReplacement;
        lastIndex = parenEnd;
        i = parenEnd;
        continue;
      }
    }
    
    // Auth Tags
    if (code.slice(i, i + 12) === '<Base44Auth>') {
      const authReplacement = nextJS ? '<SessionProvider>' : '<AuthProvider>';
      result += code.slice(lastIndex, i) + authReplacement;
      hasAuth = true;
      lastIndex = i + 12;
      i += 12;
      continue;
    }
    if (code.slice(i, i + 12) === '<Base44Auth ') {
      const authReplacement = nextJS ? '<SessionProvider ' : '<AuthProvider ';
      result += code.slice(lastIndex, i) + authReplacement;
      hasAuth = true;
      lastIndex = i + 12;
      i += 12;
      continue;
    }
    if (code.slice(i, i + 13) === '</Base44Auth>') {
      const authReplacement = nextJS ? '</SessionProvider>' : '</AuthProvider>';
      result += code.slice(lastIndex, i) + authReplacement;
      hasAuth = true;
      lastIndex = i + 13;
      i += 13;
      continue;
    }
    
    // Auth Hook
    if (code.slice(i, i + 15) === 'useBase44User()') {
      const hookReplacement = nextJS ? 'useSession()' : 'useAuth()';
      result += code.slice(lastIndex, i) + hookReplacement;
      hasAuth = true;
      lastIndex = i + 15;
      i += 15;
      continue;
    }
    if (code.slice(i, i + 14) === 'useBase44User(') {
      const hookReplacement = nextJS ? 'useSession(' : 'useAuth(';
      result += code.slice(lastIndex, i) + hookReplacement;
      hasAuth = true;
      lastIndex = i + 14;
      i += 14;
      continue;
    }
    
    i++;
  }
  
  result += code.slice(lastIndex);
  
  if (hasDB) {
    result = addImportsIfMissing(result, "import { prisma } from '@/lib/prisma';", "@/lib/prisma");
  }
  if (hasAuth) {
    if (nextJS) {
      result = addImportsIfMissing(result, "import { SessionProvider, useSession } from 'next-auth/react';", "next-auth/react");
    } else {
      result = addImportsIfMissing(result, "import { AuthProvider, useAuth } from '@/context/AuthContext';", "@/context/AuthContext");
    }
  }
  
  return result;
}

/**
 * Autogenerates a basic prisma/schema.prisma file if it doesn't already exist.
 */
function ensurePrismaSchema(projectDir) {
  const prismaDir = path.join(projectDir, 'prisma');
  const schemaPath = path.join(prismaDir, 'schema.prisma');
  
  if (!fs.existsSync(schemaPath)) {
    if (!fs.existsSync(prismaDir)) {
      fs.mkdirSync(prismaDir, { recursive: true });
    }
    const schemaContent = `// This is your Prisma schema file,
// learn more about it in the docs: https://pris.ly/d/prisma-schema

generator client {
  provider = "prisma-client-js"
}

datasource db {
  provider = "postgresql"
  url      = env("DATABASE_URL")
}

model User {
  id        String   @id @default(uuid())
  email     String   @unique
  name      String?
  createdAt DateTime @default(now())
  updatedAt DateTime @updatedAt
}
`;
    fs.writeFileSync(schemaPath, schemaContent, 'utf8');
    console.log(`Generated basic Prisma schema at: ${schemaPath}`);
  }
}

// Global framework variable (populated during CLI startup or tests)
let isNextJS = false;

/**
 * Main parser entry point to clean imports and strip JSX wrappers.
 */
function processContent(code, wrapperNames, nextJS = isNextJS) {
  const allTargets = Array.from(new Set([...wrapperNames, "Base44DB", "Base44Auth", "useBase44User"]));
  let rewritten = cleanImports(code, allTargets);
  rewritten = rewriteDBAndAuth(rewritten, nextJS);
  rewritten = stripJSX(rewritten, wrapperNames);
  return rewritten;
}

/**
 * CLI Entry point & Test runner
 */
function runTests() {
  const tests = [
    {
      name: "Simple Wrapper Strip",
      input: `
import React from 'react';
import { Base44Wrapper } from '@base44/wrapper';

export default function App() {
  return (
    <Base44Wrapper>
      <div className="content">
        <h1>Hello</h1>
      </div>
    </Base44Wrapper>
  );
}
`,
      expected: `
import React from 'react';

export default function App() {
  return (
    <div className="content">
      <h1>Hello</h1>
    </div>
  );
}
`
    },
    {
      name: "Multiple Wrappers and Multiple Imports",
      input: `import React from 'react';
import { StandaloneWrapper, Base44Wrapper, Other } from './wrappers';

function App() {
  return (
    <StandaloneWrapper title="App">
      <Base44Wrapper config={{ api: 'https://api.example.com' }}>
        <p>Content</p>
      </Base44Wrapper>
    </StandaloneWrapper>
  );
}`,
      expected: `import React from 'react';
import { Other } from './wrappers';

function App() {
  return (
    <p>Content</p>
  );
}`
    },
    {
      name: "Root render wrapping",
      input: `
import React from 'react';
import ReactDOM from 'react-dom/client';
import { Base44Wrapper } from '@base44/wrapper';
import App from './App';

ReactDOM.createRoot(document.getElementById('root')).render(
  <Base44Wrapper>
    <App />
  </Base44Wrapper>
);
`,
      expected: `
import React from 'react';
import ReactDOM from 'react-dom/client';
import App from './App';

ReactDOM.createRoot(document.getElementById('root')).render(
  <App />
);
`
    },
    {
      name: "Wrapper with complex attributes",
      input: `
import { Base44Wrapper } from './wrapper';
function App() {
  return (
    <Base44Wrapper
      attr1="hello"
      attr2={{ val: true }}
      attr3={() => {
        return "world";
      }}
    >
      <Child />
    </Base44Wrapper>
  );
}
`,
      expected: `

function App() {
  return (
    <Child />
  );
}
`
    },
    {
      name: "Database Query Translation",
      input: `
import { Base44DB } from '@base44/db';

async function getUsers() {
  const users = await Base44DB.find('users', { active: true });
  const posts = await Base44DB.find('posts', { draft: false });
  const defaultItems = await Base44DB.find({ category: 'default' });
  return { users, posts, defaultItems };
}

async function createUser(data) {
  return await Base44DB.insert('users', data);
}

async function getUser(id) {
  return await Base44DB.findOne('users', { id });
}
`,
      expected: `
import { prisma } from '@/lib/prisma';


async function getUsers() {
  const users = await prisma.user.findMany({ where: { active: true } });
  const posts = await prisma.post.findMany({ where: { draft: false } });
  const defaultItems = await prisma.user.findMany({ where: { category: 'default' } });
  return { users, posts, defaultItems };
}

async function createUser(data) {
  return await prisma.user.create({ data: data });
}

async function getUser(id) {
  return await prisma.user.findFirst({ where: { id } });
}
`
    },
    {
      name: "Auth Provider Mapping (NextAuth)",
      nextJS: true,
      input: `
import { Base44Auth, useBase44User } from '@base44/auth';

export function Dashboard() {
  const user = useBase44User();
  return (
    <Base44Auth>
      <div>Welcome {user.name}</div>
    </Base44Auth>
  );
}
`,
      expected: `
import { SessionProvider, useSession } from 'next-auth/react';


export function Dashboard() {
  const user = useSession();
  return (
    <SessionProvider>
      <div>Welcome {user.name}</div>
    </SessionProvider>
  );
}
`
    },
    {
      name: "Auth Provider Mapping (Custom Context)",
      nextJS: false,
      input: `
import { Base44Auth, useBase44User } from '@base44/auth';

export function Dashboard() {
  const user = useBase44User();
  return (
    <Base44Auth>
      <div>Welcome {user.name}</div>
    </Base44Auth>
  );
}
`,
      expected: `
import { AuthProvider, useAuth } from '@/context/AuthContext';


export function Dashboard() {
  const user = useAuth();
  return (
    <AuthProvider>
      <div>Welcome {user.name}</div>
    </AuthProvider>
  );
}
`
    }
  ];

  let passed = 0;
  console.log("Running self-tests for ast-rewriter.js...");
  for (const t of tests) {
    const nextJSOption = t.nextJS !== undefined ? t.nextJS : isNextJS;
    const output = processContent(t.input, ["StandaloneWrapper", "Base44Wrapper"], nextJSOption).trim();
    const expectedTrimmed = t.expected.trim();
    if (output === expectedTrimmed) {
      console.log(`[PASS] ${t.name}`);
      passed++;
    } else {
      console.error(`[FAIL] ${t.name}`);
      console.error("=== EXPECTED ===");
      console.error(expectedTrimmed);
      console.error("=== ACTUAL ===");
      console.error(output);
      console.error("================");
    }
  }
  console.log(`Self-tests complete: ${passed}/${tests.length} passed.`);
  process.exit(passed === tests.length ? 0 : 1);
}

// Check CLI flags
const args = process.argv.slice(2);
const dryRun = args.includes('--dry-run');
const testMode = args.includes('--test');
const verbose = args.includes('--verbose');

// Parse target wrapper names (configurable via --wrappers flag)
let targets = ["StandaloneWrapper", "Base44Wrapper"];
const wrappersArgIndex = args.findIndex(arg => arg.startsWith('--wrappers='));
if (wrappersArgIndex !== -1) {
  const value = args[wrappersArgIndex].split('=')[1];
  targets = value.split(',').map(s => s.trim()).filter(Boolean);
} else {
  const wrappersIndex = args.indexOf('--wrappers');
  if (wrappersIndex !== -1 && wrappersIndex + 1 < args.length) {
    targets = args[wrappersIndex + 1].split(',').map(s => s.trim()).filter(Boolean);
  }
}

const wrappersIndex = args.indexOf('--wrappers');
const paths = args.filter((arg, idx) => {
  if (arg.startsWith('--')) return false;
  if (targets.includes(arg)) return false;
  if (wrappersIndex !== -1 && idx === wrappersIndex + 1) return false;
  return true;
});

function findProjectRoot(startDir) {
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

// Detect project root and framework
const projectDir = findProjectRoot(paths.length > 0 ? paths[0] : process.cwd());
const hasNextConfig = fs.existsSync(path.join(projectDir, 'next.config.js')) || 
                      fs.existsSync(path.join(projectDir, 'next.config.mjs')) ||
                      fs.existsSync(path.join(projectDir, 'next.config.ts'));
isNextJS = hasNextConfig;

if (!testMode && !dryRun) {
  ensurePrismaSchema(projectDir);
}

if (testMode) {
  runTests();
}

if (paths.length === 0) {
  console.log("AST Rewriter CLI Tool");
  console.log("-------------------");
  console.log("Usage: node ast-rewriter.js <file-or-directory-paths> [--dry-run] [--verbose] [--wrappers=List,Of,Wrappers]");
  console.log("       node ast-rewriter.js --test");
  process.exit(1);
}

const excludeDirs = new Set([".git", "node_modules", "dist", "build", ".next", ".cache"]);

function walkDir(dir, fileList = []) {
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

const filesToProcess = [];
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
  process.exit(0);
}

console.log(`Rewriter targets: ${targets.join(', ')}`);
console.log(`Scanning ${filesToProcess.length} files...`);
if (dryRun) {
  console.log("DRY RUN MODE: No files will be modified.\n");
}

let modifiedCount = 0;

for (const file of filesToProcess) {
  try {
    const originalContent = fs.readFileSync(file, 'utf8');
    const newContent = processContent(originalContent, targets);

    if (originalContent !== newContent) {
      modifiedCount++;
      const relativePath = path.relative(process.cwd(), file) || file;
      console.log(`[MODIFIED] ${relativePath}`);
      if (!dryRun) {
        fs.writeFileSync(file, newContent, 'utf8');
      }
    } else {
      if (verbose) {
        const relativePath = path.relative(process.cwd(), file) || file;
        console.log(`[NO CHANGE] ${relativePath}`);
      }
    }
  } catch (err) {
    console.error(`Error processing file ${file}:`, err.message);
  }
}

console.log(`\nScan complete. Modified ${modifiedCount} out of ${filesToProcess.length} files.`);
