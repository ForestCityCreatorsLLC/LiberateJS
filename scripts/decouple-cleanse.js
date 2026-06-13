#!/usr/bin/env node
/**
 * Ultimate Code Decoupler & Cleanser CLI Tool
 * Pure Node.js version of decouple-cleanse.py.
 * Automates pre-flight checking, package cleansing, HTML title updates, environment variable mapping,
 * and global search-and-replace, without requiring Python.
 */

const fs = require('fs');
const path = require('path');
const { execSync } = require('child_process');

// Color logger helper
function log(msg, level = "INFO") {
  const isWindows = process.platform === "win32";
  const colors = {
    INFO: "\x1b[34m[INFO]\x1b[0m",
    SUCCESS: "\x1b[32m[SUCCESS]\x1b[0m",
    WARNING: "\x1b[33m[WARNING]\x1b[0m",
    ERROR: "\x1b[31m[ERROR]\x1b[0m"
  };
  
  if (isWindows) {
    console.log(`[${level}] ${msg}`);
  } else {
    console.log(`${colors[level] || '[INFO]'} ${msg}`);
  }
}

// Custom command-line argument parser
function parseArgs() {
  const args = process.argv.slice(2);
  const parsed = {
    dir: ".",
    rename: null,
    dryRun: false,
    recipe: null
  };

  for (let i = 0; i < args.length; i++) {
    if (args[i] === "--dir") {
      parsed.dir = args[++i];
    } else if (args[i] === "--rename") {
      parsed.rename = args[++i];
    } else if (args[i] === "--dry-run") {
      parsed.dryRun = true;
    } else if (args[i] === "--recipe") {
      parsed.recipe = args[++i];
    }
  }

  return parsed;
}

// Load recipe config
function loadRecipe(recipePath) {
  if (!recipePath) {
    // Default fallback path relative to this script
    const defaultPath = path.join(__dirname, "..", "recipes", "base44.json");
    if (fs.existsSync(defaultPath)) {
      recipePath = defaultPath;
    } else {
      log("No recipe specified and default base44.json not found.", "ERROR");
      process.exit(1);
    }
  }

  try {
    const data = fs.readFileSync(recipePath, "utf8");
    const recipe = JSON.parse(data);
    log(`Loaded recipe: ${recipe.name || 'unnamed'}`, "SUCCESS");
    return recipe;
  } catch (err) {
    log(`Failed to load recipe from ${recipePath}: ${err.message}`, "ERROR");
    process.exit(1);
  }
}

// Pre-flight check: balanced bracket/brace matcher
function verifyBrackets(code) {
  const stack = [];
  const mapping = { ')': '(', '}': '{', ']': '[' };
  
  let inString = null;
  let escaped = false;
  
  let i = 0;
  const n = code.length;
  while (i < n) {
    const char = code[i];
    
    if (escaped) {
      escaped = false;
      i++;
      continue;
    }
    
    if (char === '\\') {
      escaped = true;
      i++;
      continue;
    }
    
    if (inString) {
      if (char === inString) {
        inString = null;
      }
      i++;
      continue;
    }
    
    if (char === '"' || char === "'" || char === '`') {
      inString = char;
      i++;
      continue;
    }
    
    // Ignore comments
    if (char === '/' && i + 1 < n) {
      if (code[i+1] === '/') {
        const nextNL = code.indexOf('\n', i);
        if (nextNL === -1) break;
        i = nextNL;
        continue;
      } else if (code[i+1] === '*') {
        const nextEnd = code.indexOf('*/', i);
        if (nextEnd === -1) break;
        i = nextEnd + 2;
        continue;
      }
    }
    
    if (Object.values(mapping).includes(char)) {
      stack.push(char);
    } else if (Object.keys(mapping).includes(char)) {
      if (stack.length === 0 || stack[stack.length - 1] !== mapping[char]) {
        return false;
      }
      stack.pop();
    }
    
    i++;
  }
  
  return stack.length === 0;
}

// Detect project web framework
function detectFramework(projectDir) {
  const nextjsIndicators = [
    fs.existsSync(path.join(projectDir, "pages")),
    fs.existsSync(path.join(projectDir, "src", "pages")),
    fs.existsSync(path.join(projectDir, "app")),
    fs.existsSync(path.join(projectDir, "src", "app")),
    fs.existsSync(path.join(projectDir, "next.config.js")),
    fs.existsSync(path.join(projectDir, "next.config.mjs")),
    fs.existsSync(path.join(projectDir, "next.config.ts"))
  ];

  const viteIndicators = [
    fs.existsSync(path.join(projectDir, "vite.config.js")),
    fs.existsSync(path.join(projectDir, "vite.config.ts")),
    fs.existsSync(path.join(projectDir, "vite.config.mjs")),
    fs.existsSync(path.join(projectDir, "vite.config.mts"))
  ];

  let hasNextDep = false;
  let hasViteDep = false;
  const pkgPath = path.join(projectDir, "package.json");
  if (fs.existsSync(pkgPath)) {
    try {
      const data = JSON.parse(fs.readFileSync(pkgPath, "utf8"));
      const deps = { ...data.dependencies, ...data.devDependencies };
      if (deps["next"]) hasNextDep = true;
      if (deps["vite"] || deps["@vitejs/plugin-react"]) hasViteDep = true;
    } catch (err) {}
  }

  const viteReactFiles = [
    fs.existsSync(path.join(projectDir, "src", "main.jsx")),
    fs.existsSync(path.join(projectDir, "src", "main.tsx"))
  ];

  const isNextjs = nextjsIndicators.some(Boolean) || hasNextDep;
  const isVite = viteIndicators.some(Boolean) || hasViteDep || viteReactFiles.some(Boolean);

  if (isNextjs && !isVite) return "nextjs";
  if (isVite && !isNextjs) return "vite";
  if (isNextjs && isVite) {
    if (fs.existsSync(path.join(projectDir, "next.config.js")) || 
        fs.existsSync(path.join(projectDir, "next.config.mjs"))) {
      return "nextjs";
    }
    return "vite";
  }
  return "unknown";
}

// Write default configs
function writeFrameworkConfig(projectDir, framework, dryRun, metadataSummary) {
  if (framework === "nextjs") {
    const configFiles = ["next.config.js", "next.config.mjs", "next.config.ts"];
    const exists = configFiles.some(f => fs.existsSync(path.join(projectDir, f)));
    if (!exists) {
      const dest = path.join(projectDir, "next.config.js");
      const content = `/** @type {import('next').NextConfig} */\nconst nextConfig = {\n  reactStrictMode: true,\n};\n\nmodule.exports = nextConfig;\n`;
      if (dryRun) {
        log(`Would create Next.js config file: ${dest}`, "INFO");
      } else {
        try {
          fs.writeFileSync(dest, content, "utf8");
          log(`Created default Next.js config: ${dest}`, "SUCCESS");
          if (metadataSummary) metadataSummary.modified_files.push("next.config.js");
        } catch (err) {
          log(`Failed to create Next.js config: ${err.message}`, "ERROR");
        }
      }
    } else {
      log("Next.js configuration file already exists.", "INFO");
    }
  } else if (framework === "vite") {
    const configFiles = ["vite.config.js", "vite.config.ts", "vite.config.mjs", "vite.config.mts"];
    const exists = configFiles.some(f => fs.existsSync(path.join(projectDir, f)));
    if (!exists) {
      const dest = path.join(projectDir, "vite.config.js");
      const content = `import { defineConfig } from 'vite';\nimport react from '@vitejs/plugin-react';\n\n// https://vite.dev/config/\nexport default defineConfig({\n  plugins: [react()],\n});\n`;
      if (dryRun) {
        log(`Would create Vite config file: ${dest}`, "INFO");
      } else {
        try {
          fs.writeFileSync(dest, content, "utf8");
          log(`Created default Vite React config: ${dest}`, "SUCCESS");
          if (metadataSummary) metadataSummary.modified_files.push("vite.config.js");
        } catch (err) {
          log(`Failed to create Vite React config: ${err.message}`, "ERROR");
        }
      }
    } else {
      log("Vite configuration file already exists.", "INFO");
    }
  }
}

// Run pre-flight check logic
function runPreflightChecks(projectDir) {
  log("Running Active Pre-Flight Codebase Checks...", "INFO");
  let passed = true;

  // 1. Verify system dependencies
  log("Checking system environment dependencies...", "INFO");
  const tools = ["git", "node", "npm"];
  for (const tool of tools) {
    const cmd = process.platform === "win32" ? `where ${tool}` : `which ${tool}`;
    try {
      execSync(cmd, { stdio: 'ignore' });
      log(`  [OK] System dependency '${tool}' is available on PATH.`, "SUCCESS");
    } catch (err) {
      log(`  [WARNING] System dependency '${tool}' is missing or not in PATH.`, "WARNING");
    }
  }

  // 2. Validate package.json
  const pkgPath = path.join(projectDir, "package.json");
  if (fs.existsSync(pkgPath)) {
    try {
      JSON.parse(fs.readFileSync(pkgPath, "utf8"));
      log("  [OK] package.json syntax is valid JSON.", "SUCCESS");
    } catch (err) {
      log(`  [ERROR] package.json is malformed JSON: ${err.message}`, "ERROR");
      passed = false;
    }
  } else {
    log("  [WARNING] package.json was not found in this directory.", "WARNING");
  }

  // 3. index.html check
  if (!fs.existsSync(path.join(projectDir, "index.html"))) {
    log("  [WARNING] index.html not found in project root.", "WARNING");
  }

  // 4. Bracket integrity check
  log("Scanning JS/JSX codebase files for bracket syntax errors...", "INFO");
  const excludeDirs = new Set([".git", "node_modules", "dist", "build", ".next", ".cache"]);
  
  function walkAndCheck(dir) {
    const list = fs.readdirSync(dir);
    for (const file of list) {
      const fullPath = path.join(dir, file);
      const stat = fs.statSync(fullPath);
      if (stat.isDirectory()) {
        if (!excludeDirs.has(file)) {
          walkAndCheck(fullPath);
        }
      } else if (file.endsWith(".js") || file.endsWith(".jsx") || file.endsWith(".ts") || file.endsWith(".tsx")) {
        try {
          const content = fs.readFileSync(fullPath, "utf8");
          // Heuristic check
          if (!verifyBrackets(content)) {
            log(`  [WARNING] Syntax check heuristic flagged potential unmatched brackets/braces in: ${path.relative(projectDir, fullPath)}`, "WARNING");
          }
        } catch (err) {}
      }
    }
  }
  
  try {
    walkAndCheck(projectDir);
  } catch (err) {
    log(`  [WARNING] Error running codebase diagnostics: ${err.message}`, "WARNING");
  }

  // 5. Framework detection
  const framework = detectFramework(projectDir);
  if (framework === "nextjs") {
    log(`  [OK] Detected Next.js framework.`, "SUCCESS");
  } else if (framework === "vite") {
    log(`  [OK] Detected Vite React framework.`, "SUCCESS");
  } else {
    log("  [WARNING] Could not automatically determine the web framework.", "WARNING");
  }

  if (!passed) {
    log("Pre-flight validation failed. Aborting conversion to protect codebase.", "ERROR");
    process.exit(1);
  }

  log("All Pre-Flight codebase diagnostics passed successfully!", "SUCCESS");
}

// Extract configuration variables to .env.example
function extractEnvVariables(projectDir, metadataSummary, recipe) {
  log("Scanning for configuration keys to map to environment variables...", "INFO");
  const envVars = {};
  const recipeName = recipe.name || "decouple";

  const configPath = path.join(projectDir, recipeName, "config.json");
  if (fs.existsSync(configPath)) {
    try {
      const configData = JSON.parse(fs.readFileSync(configPath, "utf8"));
      for (const [k, v] of Object.entries(configData)) {
        envVars[`VITE_APP_${k.toUpperCase()}`] = String(v);
      }
      log(`Extracted keys from ${recipeName}/config.json`, "SUCCESS");
    } catch (err) {
      log(`Failed to parse config.json: ${err.message}`, "WARNING");
    }
  }

  const paramsPath = path.join(projectDir, "src", "lib", "app-params.js");
  if (fs.existsSync(paramsPath)) {
    try {
      const content = fs.readFileSync(paramsPath, "utf8");
      // Match key: "value" or key: 'value' or key: `value`
      const regex = /(\w+)\s*:\s*(['"`])((?:\\.|(?!\2).)*)\2/g;
      let match;
      while ((match = regex.exec(content)) !== null) {
        envVars[`VITE_APP_${match[1].toUpperCase()}`] = match[3];
      }
      log("Extracted keys from src/lib/app-params.js", "SUCCESS");
    } catch (err) {
      log(`Failed to parse app-params.js: ${err.message}`, "WARNING");
    }
  }

  const keys = Object.keys(envVars);
  if (keys.length > 0) {
    metadataSummary.extracted_env_vars = keys;
    const envExamplePath = path.join(projectDir, ".env.example");
    try {
      let output = `# Environment variables migrated from ${recipeName.toUpperCase()} configurations\n`;
      output += `# Rename this file to .env to use locally\n\n`;
      for (const k of keys.sort()) {
        if (k.includes("SECRET") || k.includes("PASS") || k.includes("TOKEN")) {
          output += `# SECURITY WARNING: Migrate ${k} to a secure backend function.\n`;
        }
        output += `${k}=""\n`;
      }
      fs.writeFileSync(envExamplePath, output, "utf8");
      log(`Generated .env.example at ${envExamplePath}`, "SUCCESS");
    } catch (err) {
      log(`Failed to write .env.example: ${err.message}`, "ERROR");
    }
  } else {
    log("No proprietary configuration variables detected for environment mapping.", "INFO");
  }
}

// Cleanse package.json dependencies and scripts
function cleansePackageJson(projectDir, newName, dryRun, metadataSummary, recipe) {
  const pkgPath = path.join(projectDir, "package.json");
  if (!fs.existsSync(pkgPath)) {
    log("No package.json found. Skipping package.json updates.", "WARNING");
    return;
  }

  try {
    const data = JSON.parse(fs.readFileSync(pkgPath, "utf8"));
    let modified = false;
    const recipeName = recipe.name || "decouple";

    const currentName = data.name || "";
    metadataSummary.original_project_name = currentName;

    if (currentName.toLowerCase().includes(recipeName.toLowerCase())) {
      const nameToUse = newName || currentName.toLowerCase().replace(new RegExp(recipeName, 'gi'), "app").replace(/^-+|-+$/g, "");
      metadataSummary.new_project_name = nameToUse;
      if (dryRun) {
        log(`Would rename project in package.json from '${currentName}' to '${nameToUse}'`, "INFO");
      } else {
        data.name = nameToUse;
        log(`Renamed project in package.json to '${nameToUse}'`, "SUCCESS");
      }
      modified = true;
    } else {
      metadataSummary.new_project_name = currentName;
    }

    const removeDeps = recipe.dependencies_to_remove || [recipeName];
    const depFields = ["dependencies", "devDependencies", "peerDependencies", "optionalDependencies"];
    for (const field of depFields) {
      if (data[field]) {
        for (const dep of Object.keys(data[field])) {
          if (removeDeps.some(rd => dep.toLowerCase().includes(rd.toLowerCase()))) {
            metadataSummary.removed_dependencies.push(dep);
            if (dryRun) {
              log(`Would remove ${field} dependency: ${dep}`, "INFO");
            } else {
              delete data[field][dep];
              log(`Removed ${field} dependency: ${dep}`, "SUCCESS");
            }
            modified = true;
          }
        }
      }
    }

    const removeScripts = recipe.scripts_to_remove || [recipeName];
    if (data.scripts) {
      for (const [name, cmd] of Object.entries(data.scripts)) {
        if (removeScripts.some(rs => name.toLowerCase().includes(rs.toLowerCase()) || cmd.toLowerCase().includes(rs.toLowerCase()))) {
          metadataSummary.removed_scripts.push(name);
          if (dryRun) {
            log(`Would remove script: ${name} -> ${cmd}`, "INFO");
          } else {
            delete data.scripts[name];
            log(`Removed script: ${name}`, "SUCCESS");
          }
          modified = true;
        }
      }
    }

    if (modified && !dryRun) {
      fs.writeFileSync(pkgPath, JSON.stringify(data, null, 2) + "\n", "utf8");
      log("Successfully updated package.json", "SUCCESS");
    }
  } catch (err) {
    log(`Failed to update package.json: ${err.message}`, "ERROR");
  }
}

// Cleanse index.html title and tags
function cleanseHtml(projectDir, dryRun, metadataSummary, recipe) {
  const htmlPath = path.join(projectDir, "index.html");
  if (!fs.existsSync(htmlPath)) {
    log("No index.html found. Skipping HTML cleansing.", "WARNING");
    return;
  }

  try {
    let content = fs.readFileSync(htmlPath, "utf8");
    let modified = false;
    const replaceTerms = recipe.replace_terms || [{ pattern: "base44", replacement: "standalone" }];

    const titleMatch = content.match(/<title>(.*?)<\/title>/i);
    if (titleMatch) {
      const titleText = titleMatch[1];
      let newTitle = titleText;
      let replaced = false;

      for (const term of replaceTerms) {
        const regex = new RegExp(term.pattern, "gi");
        if (regex.test(newTitle)) {
          newTitle = newTitle.replace(regex, term.replacement);
          replaced = true;
        }
      }

      if (replaced) {
        newTitle = newTitle.split(/\s+/).map(w => w.charAt(0).toUpperCase() + w.slice(1).toLowerCase()).join(" ");
        if (!newTitle) newTitle = "Standalone Web App";
        
        if (dryRun) {
          log(`Would change HTML title from '${titleText}' to '${newTitle}'`, "INFO");
        } else {
          content = content.replace(`<title>${titleText}</title>`, `<title>${newTitle}</title>`);
          log(`Updated HTML title to '${newTitle}'`, "SUCCESS");
        }
        modified = true;
      }
    }

    for (const term of replaceTerms) {
      const linkRegex = new RegExp(`<link[^>]*?href=[^>]*?${term.pattern}[^>]*?>`, "gi");
      const linkMatches = content.match(linkRegex);
      if (linkMatches) {
        for (const link of linkMatches) {
          if (dryRun) {
            log(`Would remove favicon/link reference: ${link.trim()}`, "INFO");
          } else {
            content = content.replace(link, "");
            log(`Removed favicon/link reference from index.html`, "SUCCESS");
          }
          modified = true;
        }
      }
    }

    if (modified && !dryRun) {
      fs.writeFileSync(htmlPath, content, "utf8");
      metadataSummary.modified_files.push("index.html");
      log("Successfully updated index.html", "SUCCESS");
    }
  } catch (err) {
    log(`Failed to update index.html: ${err.message}`, "ERROR");
  }
}

// Global case-preserving search-and-replace
function deepSearchAndReplace(projectDir, dryRun, metadataSummary, recipe) {
  const recipeName = recipe.name || "decouple";
  const replaceTerms = recipe.replace_terms || [{ pattern: "base44", replacement: "standalone" }];
  log(`Starting global search-and-replace using recipe: ${recipeName}...`, "INFO");

  const excludeDirs = new Set([".git", "node_modules", "dist", "build", ".next", ".cache", ".idea", ".vscode"]);
  const excludeFiles = new Set(["package-lock.json", "yarn.lock", "pnpm-lock.yaml", "decouple-cleanse.py", "decouple-cleanse.js", "base44-cleanse.py", ".migration-status.json"]);

  // Set up replacement rules
  const rules = replaceTerms.map(term => {
    return {
      regex: new RegExp(term.pattern, "gi"),
      replacement: term.replacement
    };
  });

  // Case-preserving replacement helper
  function casePreservingReplace(match, replacement) {
    if (match === match.toUpperCase()) return replacement.toUpperCase();
    if (match[0] === match[0].toUpperCase()) return replacement.charAt(0).toUpperCase() + replacement.slice(1).toLowerCase();
    return replacement.toLowerCase();
  }

  let count = 0;
  let fileCount = 0;

  function walkAndReplace(dir) {
    const list = fs.readdirSync(dir);
    for (const file of list) {
      if (excludeFiles.has(file)) continue;

      const fullPath = path.join(dir, file);
      const stat = fs.statSync(fullPath);

      if (stat.isDirectory()) {
        if (!excludeDirs.has(file)) {
          walkAndReplace(fullPath);
        }
      } else {
        // Skip binary check
        try {
          const buffer = fs.readFileSync(fullPath);
          let isBinary = false;
          // Check first 1024 bytes for null character
          for (let b = 0; b < Math.min(buffer.length, 1024); b++) {
            if (buffer[b] === 0) {
              isBinary = true;
              break;
            }
          }
          if (isBinary) continue;

          let content = buffer.toString("utf8");
          let hasMatch = false;
          let newContent = content;

          for (const rule of rules) {
            if (rule.regex.test(newContent)) {
              const matches = newContent.match(rule.regex).length;
              count += matches;
              newContent = newContent.replace(rule.regex, (match) => casePreservingReplace(match, rule.replacement));
              hasMatch = true;
            }
          }

          if (hasMatch) {
            fileCount++;
            const relPath = path.relative(projectDir, fullPath);
            if (dryRun) {
              log(`Would clean occurrences in: ${relPath}`, "INFO");
            } else {
              fs.writeFileSync(fullPath, newContent, "utf8");
              metadataSummary.modified_files.push(relPath);
              log(`Replaced occurrences in: ${relPath}`, "SUCCESS");
            }
          }
        } catch (err) {}
      }
    }
  }

  try {
    walkAndReplace(projectDir);
  } catch (err) {
    log(`Error during search-and-replace: ${err.message}`, "ERROR");
  }

  log(`Search and replace completed. Total occurrences found: ${count} across ${fileCount} files.`, "SUCCESS");
}

// Inject structured logger setup in main files
function injectPinoLogging(projectDir, dryRun, metadataSummary) {
  log("Injecting Pino logging setup in entry files...", "INFO");
  const candidates = [
    path.join(projectDir, "src", "main.jsx"),
    path.join(projectDir, "src", "main.tsx"),
    path.join(projectDir, "src", "App.jsx"),
    path.join(projectDir, "src", "App.tsx")
  ];

  const entryFiles = candidates.filter(c => fs.existsSync(c));
  if (entryFiles.length === 0) {
    log("No standard entry files found to inject Pino logging.", "WARNING");
    return;
  }

  const pinoImport = "import pino from 'pino';\n";
  const pinoSetup = 
    "\n// Pino Structured Logger Setup\n" +
    "export const logger = pino({\n" +
    "  level: 'info',\n" +
    "  browser: {\n" +
    "    asObject: true\n" +
    "  }\n" +
    "});\n" +
    "logger.info('Application initialized successfully');\n\n";

  for (const file of entryFiles) {
    const relPath = path.relative(projectDir, file);
    try {
      const content = fs.readFileSync(file, "utf8");
      if (content.includes("import pino")) {
        log(`Pino logging already present in ${relPath}`, "INFO");
        continue;
      }

      if (dryRun) {
        log(`Would inject Pino logging setup into ${relPath}`, "INFO");
        continue;
      }

      const lines = content.split(/\r?\n/);
      let lastImportIdx = -1;
      for (let idx = 0; idx < lines.length; idx++) {
        if (lines[idx].trim().startsWith("import ")) {
          lastImportIdx = idx;
        }
      }

      let newLines;
      if (lastImportIdx !== -1) {
        newLines = [...lines.slice(0, lastImportIdx + 1), pinoImport.trim(), ...lines.slice(lastImportIdx + 1)];
        
        let firstCodeIdx = -1;
        for (let idx = 0; idx < newLines.length; idx++) {
          if (newLines[idx].trim() && !newLines[idx].trim().startsWith("import ")) {
            firstCodeIdx = idx;
            break;
          }
        }
        if (firstCodeIdx !== -1) {
          newLines.splice(firstCodeIdx, 0, pinoSetup.trim());
        } else {
          newLines.push(pinoSetup.trim());
        }
      } else {
        newLines = [pinoImport.trim(), pinoSetup.trim(), ...lines];
      }

      fs.writeFileSync(file, newLines.join("\n") + "\n", "utf8");
      log(`Injected Pino logging setup into ${relPath}`, "SUCCESS");
      if (metadataSummary) metadataSummary.modified_files.push(relPath);
    } catch (err) {
      log(`Failed to inject Pino logging into ${relPath}: ${err.message}`, "ERROR");
    }
  }
}

// Scaffolding testing & structured logs
function scaffoldTestingAndLogging(projectDir, framework, dryRun, metadataSummary) {
  log("Setting up structured logging and testing scaffolding...", "INFO");

  const pkgPath = path.join(projectDir, "package.json");
  if (fs.existsSync(pkgPath)) {
    try {
      const data = JSON.parse(fs.readFileSync(pkgPath, "utf8"));
      let modified = false;

      if (!data.dependencies) data.dependencies = {};
      if (!data.devDependencies) data.devDependencies = {};
      if (!data.scripts) data.scripts = {};

      if (!data.dependencies["pino"]) {
        data.dependencies["pino"] = "^9.2.0";
        log("Added 'pino' dependency to package.json", "SUCCESS");
        modified = true;
      }

      const testingDeps = {
        "vitest": "^1.6.1",
        "@vitejs/plugin-react": "^4.3.0",
        "@testing-library/react": "^15.0.0",
        "@testing-library/jest-dom": "^6.4.0",
        "jsdom": "^24.1.0",
        "@playwright/test": "^1.44.0"
      };

      for (const [dep, ver] of Object.entries(testingDeps)) {
        if (!data.devDependencies[dep]) {
          data.devDependencies[dep] = ver;
          log(`Added devDependency '${dep}' to package.json`, "SUCCESS");
          modified = true;
        }
      }

      const testScripts = {
        "test": "vitest run",
        "test:watch": "vitest",
        "test:e2e": "playwright test"
      };

      for (const [name, cmd] of Object.entries(testScripts)) {
        if (!data.scripts[name] || data.scripts[name].startsWith("echo")) {
          data.scripts[name] = cmd;
          log(`Added script '${name}' -> '${cmd}' to package.json`, "SUCCESS");
          modified = true;
        }
      }

      if (modified && !dryRun) {
        fs.writeFileSync(pkgPath, JSON.stringify(data, null, 2) + "\n", "utf8");
        log("Updated package.json with test and logging dependencies.", "SUCCESS");
      }
    } catch (err) {
      log(`Failed to update package.json for testing: ${err.message}`, "ERROR");
    }
  }

  // Pino logger injection
  injectPinoLogging(projectDir, dryRun, metadataSummary);

  // Playwright configuration file
  const port = framework === "nextjs" ? "3000" : "5173";
  const playwrightConfig = `import { defineConfig, devices } from '@playwright/test';

export default defineConfig({
  testDir: './e2e',
  fullyParallel: true,
  forbidOnly: !!process.env.CI,
  retries: process.env.CI ? 2 : 0,
  workers: process.env.CI ? 1 : undefined,
  reporter: 'html',
  use: {
    baseURL: 'http://localhost:${port}',
    trace: 'on-first-retry',
  },
  projects: [
    {
      name: 'chromium',
      use: { ...devices['Desktop Chrome'] },
    },
    {
      name: 'firefox',
      use: { ...devices['Desktop Firefox'] },
    },
    {
      name: 'webkit',
      use: { ...devices['Desktop Safari'] },
    },
  ],
  webServer: {
    command: 'npm run dev',
    url: 'http://localhost:${port}',
    reuseExistingServer: !process.env.CI,
  },
});
`;

  const playwrightPath = path.join(projectDir, "playwright.config.js");
  if (!fs.existsSync(playwrightPath)) {
    if (dryRun) {
      log(`Would create Playwright config: ${playwrightPath}`, "INFO");
    } else {
      try {
        fs.writeFileSync(playwrightPath, playwrightConfig, "utf8");
        log(`Created Playwright config: ${playwrightPath}`, "SUCCESS");
        if (metadataSummary) metadataSummary.modified_files.push("playwright.config.js");
      } catch (err) {
        log(`Failed to create Playwright config: ${err.message}`, "ERROR");
      }
    }
  }

  // Create E2E test file
  const e2eDir = path.join(projectDir, "e2e");
  const e2eTestPath = path.join(e2eDir, "example.spec.js");
  if (!fs.existsSync(e2eTestPath)) {
    if (dryRun) {
      log(`Would create E2E test folder: ${e2eDir}`, "INFO");
    } else {
      try {
        fs.mkdirSync(e2eDir, { recursive: true });
        const e2eContent = `import { test, expect } from '@playwright/test';\n\ntest('has title', async ({ page }) => {\n  await page.goto('http://localhost:${port}/');\n  await expect(page).toHaveTitle(/./);\n});\n`;
        fs.writeFileSync(e2eTestPath, e2eContent, "utf8");
        log(`Created E2E test file: ${e2eTestPath}`, "SUCCESS");
        if (metadataSummary) metadataSummary.modified_files.push("e2e/example.spec.js");
      } catch (err) {
        log(`Failed to create E2E test file: ${err.message}`, "ERROR");
      }
    }
  }

  // Vitest config file
  const vitestConfig = `import { defineConfig, configDefaults } from 'vitest/config';\nimport react from '@vitejs/plugin-react';\n\nexport default defineConfig({\n  plugins: [react()],\n  test: {\n    environment: 'jsdom',\n    globals: true,\n    exclude: [...configDefaults.exclude, 'e2e/**'],\n  },\n});\n`;
  const vitestPath = path.join(projectDir, "vitest.config.js");
  if (!fs.existsSync(vitestPath)) {
    if (dryRun) {
      log(`Would create Vitest config: ${vitestPath}`, "INFO");
    } else {
      try {
        fs.writeFileSync(vitestPath, vitestConfig, "utf8");
        log(`Created Vitest config: ${vitestPath}`, "SUCCESS");
        if (metadataSummary) metadataSummary.modified_files.push("vitest.config.js");
      } catch (err) {
        log(`Failed to create Vitest config: ${err.message}`, "ERROR");
      }
    }
  }

  // Mock test
  const mockTestPath = path.join(projectDir, "src", "App.test.jsx");
  if (!fs.existsSync(mockTestPath)) {
    if (dryRun) {
      log(`Would create mock unit test: ${mockTestPath}`, "INFO");
    } else {
      try {
        fs.mkdirSync(path.dirname(mockTestPath), { recursive: true });
        const mockTestContent = `import { describe, it, expect } from 'vitest';\nimport { render } from '@testing-library/react';\nimport React from 'react';\nimport App from './App';\n\ndescribe('App Component', () => {\n  it('renders without crashing', () => {\n    const { container } = render(<App />);\n    expect(container).toBeDefined();\n  });\n});\n`;
        fs.writeFileSync(mockTestPath, mockTestContent, "utf8");
        log(`Created mock unit test: ${mockTestPath}`, "SUCCESS");
        if (metadataSummary) metadataSummary.modified_files.push("src/App.test.jsx");
      } catch (err) {
        log(`Failed to create mock test file: ${err.message}`, "ERROR");
      }
    }
  }
}

// Scaffolding styles & vendor optimizations
function scaffoldStylingAndOptimization(projectDir, dryRun, metadataSummary) {
  log("Setting up modern styling (Tailwind CSS) and bundle optimizations...", "INFO");

  const pkgPath = path.join(projectDir, "package.json");
  if (fs.existsSync(pkgPath)) {
    try {
      const data = JSON.parse(fs.readFileSync(pkgPath, "utf8"));
      let modified = false;
      if (!data.devDependencies) data.devDependencies = {};

      const styleDeps = {
        "tailwindcss": "^3.4.0",
        "postcss": "^8.4.30",
        "autoprefixer": "^10.4.15"
      };

      for (const [dep, ver] of Object.entries(styleDeps)) {
        if (!data.devDependencies[dep]) {
          data.devDependencies[dep] = ver;
          log(`Added devDependency '${dep}' for modern styling`, "SUCCESS");
          modified = true;
        }
      }

      if (modified && !dryRun) {
        fs.writeFileSync(pkgPath, JSON.stringify(data, null, 2) + "\n", "utf8");
        log("Updated package.json with styling dependencies.", "SUCCESS");
      }
    } catch (err) {
      log(`Failed to update package.json with styling dependencies: ${err.message}`, "ERROR");
    }
  }

  // Tailwind configuration
  const tailwindConfig = `/** @type {import('tailwindcss').Config} */\nmodule.exports = {\n  content: [\n    "./index.html",\n    "./src/**/*.{js,ts,jsx,tsx}",\n  ],\n  theme: {\n    extend: {},\n  },\n  plugins: [],\n}\n`;
  const tailwindPath = path.join(projectDir, "tailwind.config.js");
  if (!fs.existsSync(tailwindPath)) {
    if (dryRun) {
      log(`Would create Tailwind config: ${tailwindPath}`, "INFO");
    } else {
      try {
        fs.writeFileSync(tailwindPath, tailwindConfig, "utf8");
        log(`Created Tailwind config: ${tailwindPath}`, "SUCCESS");
        if (metadataSummary) metadataSummary.modified_files.push("tailwind.config.js");
      } catch (err) {
        log(`Failed to create Tailwind config: ${err.message}`, "ERROR");
      }
    }
  }

  // PostCSS config
  const postcssConfig = `module.exports = {\n  plugins: {\n    tailwindcss: {},\n    autoprefixer: {},\n  },\n}\n`;
  const postcssPath = path.join(projectDir, "postcss.config.js");
  if (!fs.existsSync(postcssPath)) {
    if (dryRun) {
      log(`Would create PostCSS config: ${postcssPath}`, "INFO");
    } else {
      try {
        fs.writeFileSync(postcssPath, postcssConfig, "utf8");
        log(`Created PostCSS config: ${postcssPath}`, "SUCCESS");
        if (metadataSummary) metadataSummary.modified_files.push("postcss.config.js");
      } catch (err) {
        log(`Failed to create PostCSS config: ${err.message}`, "ERROR");
      }
    }
  }

  // Inject Google Fonts into index.html
  const htmlPath = path.join(projectDir, "index.html");
  if (fs.existsSync(htmlPath)) {
    try {
      let htmlContent = fs.readFileSync(htmlPath, "utf8");
      const fontsMarkup = 
        '    <link rel="preconnect" href="https://fonts.googleapis.com" />\n' +
        '    <link rel="preconnect" href="https://fonts.gstatic.com" crossorigin />\n' +
        '    <link href="https://fonts.googleapis.com/css2?family=Inter:wght@300;400;500;600;700&family=Outfit:wght@300;400;500;600;700&display=swap" rel="stylesheet" />\n';

      if (!htmlContent.includes("fonts.googleapis.com")) {
        if (dryRun) {
          log("Would inject Google Fonts into index.html head", "INFO");
        } else {
          htmlContent = htmlContent.replace("</head>", `${fontsMarkup}  </head>`);
          fs.writeFileSync(htmlPath, htmlContent, "utf8");
          log("Injected Google Fonts (Inter/Outfit) into index.html head section", "SUCCESS");
          if (metadataSummary && !metadataSummary.modified_files.includes("index.html")) {
            metadataSummary.modified_files.push("index.html");
          }
        }
      }
    } catch (err) {
      log(`Failed to inject Google Fonts: ${err.message}`, "ERROR");
    }
  }

  // Inject bundle optimizations into vite.config.js if it exists
  const vitePath = path.join(projectDir, "vite.config.js");
  if (fs.existsSync(vitePath)) {
    try {
      let viteContent = fs.readFileSync(vitePath, "utf8");
      if (!viteContent.includes("manualChunks") && !viteContent.includes("rollupOptions")) {
        if (dryRun) {
          log("Would add rollup manualChunks optimization to vite.config.js", "INFO");
        } else {
          const optContent = `  build: {\n    rollupOptions: {\n      output: {\n        manualChunks: {\n          vendor: ['react', 'react-dom']\n        }\n      }\n    }\n  }`;
          
          const match = viteContent.match(/plugins:\s*\[[^\]]*\]/);
          if (match) {
            const insertPos = match.index + match[0].length;
            const newVite = viteContent.slice(0, insertPos) + ",\n" + optContent + viteContent.slice(insertPos);
            fs.writeFileSync(vitePath, newVite, "utf8");
            log("Added rollup vendor code-splitting chunks optimization to vite.config.js", "SUCCESS");
            if (metadataSummary) metadataSummary.modified_files.push("vite.config.js");
          }
        }
      }
    } catch (err) {
      log(`Failed to inject bundle optimization: ${err.message}`, "ERROR");
    }
  }
}

// Run package installation
function runNpmInstall(projectDir, dryRun) {
  if (dryRun) {
    log("Would run package installation (npm/yarn/pnpm install)", "INFO");
    return;
  }

  let pkgMgr = "npm";
  if (fs.existsSync(path.join(projectDir, "pnpm-lock.yaml"))) {
    pkgMgr = "pnpm";
  } else if (fs.existsSync(path.join(projectDir, "yarn.lock"))) {
    pkgMgr = "yarn";
  }

  log(`Running '${pkgMgr} install' to regenerate dependencies...`, "INFO");
  try {
    execSync(`${pkgMgr} install`, { cwd: projectDir, stdio: "inherit" });
    log("Dependencies successfully reinstalled.", "SUCCESS");
  } catch (err) {
    log(`Package installation failed: ${err.message}`, "ERROR");
  }
}

// Main execution coordinator
function main() {
  const args = parseArgs();
  const targetDir = path.resolve(args.dir);
  const recipe = loadRecipe(args.recipe);
  const recipeName = recipe.name || "decouple";

  log(`Starting ${recipeName} cleanup in: ${targetDir}`);
  if (args.dryRun) {
    log("DRY RUN MODE ENABLED - No changes will be saved", "WARNING");
  }

  // Preflight diagnostics check
  runPreflightChecks(targetDir);

  const metadataSummary = {
    migration_timestamp: new Date().toISOString(),
    original_project_name: "",
    new_project_name: "",
    detected_framework: "",
    deleted_files_and_directories: [],
    modified_files: [],
    removed_dependencies: [],
    removed_scripts: [],
    extracted_env_vars: []
  };

  // Environment variables extraction
  extractEnvVariables(targetDir, metadataSummary, recipe);

  // Deletions phase
  log(`Step 1: Deleting ${recipeName} folders...`, "INFO");
  const deletePaths = recipe.delete_paths || [];
  for (const p of deletePaths) {
    const fullP = path.join(targetDir, p);
    if (fs.existsSync(fullP)) {
      const relP = path.relative(targetDir, fullP);
      if (args.dryRun) {
        log(`Would delete: ${fullP}`, "INFO");
        metadataSummary.deleted_files_and_directories.push(relP);
      } else {
        try {
          const stat = fs.statSync(fullP);
          if (stat.isDirectory()) {
            fs.rmSync(fullP, { recursive: true, force: true });
          } else {
            fs.unlinkSync(fullP);
          }
          log(`Deleted: ${fullP}`, "SUCCESS");
          metadataSummary.deleted_files_and_directories.push(relP);
        } catch (err) {
          log(`Failed to delete ${fullP}: ${err.message}`, "ERROR");
        }
      }
    }
  }

  // package.json cleanup
  log("Step 2: Cleaning package.json...", "INFO");
  cleansePackageJson(targetDir, args.rename, args.dryRun, metadataSummary, recipe);

  // index.html cleanup
  log("Step 3: Cleaning index.html...", "INFO");
  cleanseHtml(targetDir, args.dryRun, metadataSummary, recipe);

  // Case-preserving search-and-replace
  log("Step 4: Running global case-preserving replacement...", "INFO");
  deepSearchAndReplace(targetDir, args.dryRun, metadataSummary, recipe);

  // Framework config auto-generation
  log("Step 4.5: Writing framework configuration file...", "INFO");
  const framework = detectFramework(targetDir);
  metadataSummary.detected_framework = framework;
  writeFrameworkConfig(targetDir, framework, args.dryRun, metadataSummary);

  // Testing & logger setups
  log("Step 4.6: Scaffolding testing and logging capabilities...", "INFO");
  scaffoldTestingAndLogging(targetDir, framework, args.dryRun, metadataSummary);

  // Styles & rollup optimizations
  log("Step 4.7: Scaffolding styling and bundle optimizations...", "INFO");
  scaffoldStylingAndOptimization(targetDir, args.dryRun, metadataSummary);

  // Write status metadata
  if (!args.dryRun) {
    const metaPath = path.join(targetDir, ".migration-status.json");
    try {
      fs.writeFileSync(metaPath, JSON.stringify(metadataSummary, null, 2) + "\n", "utf8");
      log(`Generated migration metadata at ${metaPath}`, "SUCCESS");
    } catch (err) {
      log(`Failed to write migration status: ${err.message}`, "ERROR");
    }
  }

  // Reinstall dependencies
  log("Step 5: Re-installing dependencies...", "INFO");
  runNpmInstall(targetDir, args.dryRun);

  log(`${recipeName.toUpperCase()} Decoupling CLI phase complete. Standalone project is ready for AI re-wiring and enhancement!`, "SUCCESS");
}

if (require.main === module) {
  main();
}
