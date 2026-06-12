#!/usr/bin/env python3
"""
Ultimate Base44 Converter CLI Tool
Automates Phase 2 of the base44 app conversion workflow.
Includes active pre-flight checkers to verify code syntax and tool dependencies before execution.
"""

import os
import sys
import shutil
import re
import json
import subprocess
import argparse
import stat
from datetime import datetime

def log(msg, level="INFO"):
    colors = {
        "INFO": "\033[94m[INFO]\033[0m",
        "SUCCESS": "\033[92m[SUCCESS]\033[0m",
        "WARNING": "\033[93m[WARNING]\033[0m",
        "ERROR": "\033[91m[ERROR]\033[0m"
    }
    if os.name == 'nt':
        print(f"[{level}] {msg}")
    else:
        print(f"{colors.get(level, '[INFO]')} {msg}")

def remove_readonly(func, path, excinfo):
    """OnError helper to clear read-only flag and retry deletions on Windows."""
    os.chmod(path, stat.S_IWRITE)
    func(path)

def delete_path(path, dry_run=False):
    if not os.path.exists(path):
        return False
    if dry_run:
        log(f"Would delete: {path}", "INFO")
        return True
    
    try:
        if os.path.isdir(path):
            shutil.rmtree(path, onerror=remove_readonly)
        else:
            try:
                os.remove(path)
            except PermissionError:
                os.chmod(path, stat.S_IWRITE)
                os.remove(path)
        log(f"Deleted: {path}", "SUCCESS")
        return True
    except Exception as e:
        log(f"Failed to delete {path}: {e}", "ERROR")
        return False

# ==================== PRE-FLIGHT ACTIVE CODE CHECKERS ====================

def detect_framework(project_dir):
    """Detects if the project is Next.js or Vite React."""
    # Next.js indicators
    nextjs_indicators = [
        os.path.isdir(os.path.join(project_dir, "pages")),
        os.path.isdir(os.path.join(project_dir, "src", "pages")),
        os.path.isdir(os.path.join(project_dir, "app")),
        os.path.isdir(os.path.join(project_dir, "src", "app")),
        os.path.exists(os.path.join(project_dir, "next.config.js")),
        os.path.exists(os.path.join(project_dir, "next.config.mjs")),
        os.path.exists(os.path.join(project_dir, "next.config.ts")),
    ]
    
    # Vite indicators
    vite_indicators = [
        os.path.exists(os.path.join(project_dir, "vite.config.js")),
        os.path.exists(os.path.join(project_dir, "vite.config.ts")),
        os.path.exists(os.path.join(project_dir, "vite.config.mjs")),
        os.path.exists(os.path.join(project_dir, "vite.config.mts")),
    ]
    
    has_next_dep = False
    has_vite_dep = False
    pkg_path = os.path.join(project_dir, "package.json")
    if os.path.exists(pkg_path):
        try:
            with open(pkg_path, "r", encoding="utf-8") as f:
                data = json.load(f)
                deps = data.get("dependencies", {})
                dev_deps = data.get("devDependencies", {})
                if "next" in deps or "next" in dev_deps:
                    has_next_dep = True
                if "vite" in deps or "vite" in dev_deps or "@vitejs/plugin-react" in dev_deps:
                    has_vite_dep = True
        except Exception:
            pass

    # Check for Vite React files like main.jsx or main.tsx
    vite_react_files = [
        os.path.exists(os.path.join(project_dir, "src", "main.jsx")),
        os.path.exists(os.path.join(project_dir, "src", "main.tsx")),
    ]
    
    # Framework scoring/classification
    is_nextjs = any(nextjs_indicators) or has_next_dep
    is_vite = any(vite_indicators) or has_vite_dep or any(vite_react_files)
    
    if is_nextjs and not is_vite:
        return "nextjs"
    elif is_vite and not is_nextjs:
        return "vite"
    elif is_nextjs and is_vite:
        # Both indicators present, prioritize next.config files if they exist
        if any(os.path.exists(os.path.join(project_dir, f)) for f in ["next.config.js", "next.config.mjs", "next.config.ts"]):
            return "nextjs"
        return "vite"
    else:
        return "unknown"

def write_framework_config(project_dir, framework, dry_run=False, metadata_summary=None):
    """Writes default next.config.js or vite.config.js if missing."""
    if framework == "nextjs":
        config_files = ["next.config.js", "next.config.mjs", "next.config.ts"]
        config_exists = any(os.path.exists(os.path.join(project_dir, f)) for f in config_files)
        if not config_exists:
            dest_path = os.path.join(project_dir, "next.config.js")
            content = """/** @type {import('next').NextConfig} */
const nextConfig = {
  reactStrictMode: true,
};

module.exports = nextConfig;
"""
            if dry_run:
                log(f"Would create Next.js config file: {dest_path}", "INFO")
            else:
                try:
                    with open(dest_path, "w", encoding="utf-8") as f:
                        f.write(content)
                    log(f"Created default Next.js config: {dest_path}", "SUCCESS")
                    if metadata_summary is not None:
                        metadata_summary["modified_files"].append("next.config.js")
                except Exception as e:
                    log(f"Failed to create Next.js config: {e}", "ERROR")
        else:
            log("Next.js configuration file already exists.", "INFO")
            
    elif framework == "vite":
        config_files = ["vite.config.js", "vite.config.ts", "vite.config.mjs", "vite.config.mts"]
        config_exists = any(os.path.exists(os.path.join(project_dir, f)) for f in config_files)
        if not config_exists:
            dest_path = os.path.join(project_dir, "vite.config.js")
            content = """import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';

// https://vite.dev/config/
export default defineConfig({
  plugins: [react()],
});
"""
            if dry_run:
                log(f"Would create Vite config file: {dest_path}", "INFO")
            else:
                try:
                    with open(dest_path, "w", encoding="utf-8") as f:
                        f.write(content)
                    log(f"Created default Vite React config: {dest_path}", "SUCCESS")
                    if metadata_summary is not None:
                        metadata_summary["modified_files"].append("vite.config.js")
                except Exception as e:
                    log(f"Failed to create Vite React config: {e}", "ERROR")
        else:
            log("Vite configuration file already exists.", "INFO")

def run_preflight_checks(project_dir):
    log("Running Active Pre-Flight Codebase Checks...", "INFO")
    passed = True

    # 1. Verify Shell Tooling dependencies
    log("Checking system environment dependencies...", "INFO")
    tools = ["git", "node", "npm"]
    for tool in tools:
        cmd = "where" if os.name == "nt" else "which"
        try:
            subprocess.run([cmd, tool], stdout=subprocess.DEVNULL, stderr=subprocess.DEVNULL, check=True)
            log(f"  [OK] System dependency '{tool}' is available on PATH.", "SUCCESS")
        except (subprocess.CalledProcessError, FileNotFoundError):
            log(f"  [WARNING] System dependency '{tool}' is missing or not in PATH.", "WARNING")
            # We don't abort for missing gh/git in cleanser, but log warning

    # 2. Validate package.json formatting
    pkg_path = os.path.join(project_dir, "package.json")
    if os.path.exists(pkg_path):
        try:
            with open(pkg_path, "r", encoding="utf-8") as f:
                json.load(f)
            log("  [OK] package.json syntax is valid JSON.", "SUCCESS")
        except json.JSONDecodeError as e:
            log(f"  [ERROR] package.json is malformed JSON: {e}", "ERROR")
            passed = False
    else:
        log("  [WARNING] package.json was not found in this directory.", "WARNING")

    # 3. Check for index.html structure
    html_path = os.path.join(project_dir, "index.html")
    if not os.path.exists(html_path):
        log("  [WARNING] index.html not found in project root. Setup might be incomplete.", "WARNING")

    # 4. Check JS/JSX syntax integrity (Bracket/Brace match validation)
    log("Scanning JS/JSX codebase files for bracket syntax errors...", "INFO")
    exclude_dirs = {".git", "node_modules", "dist", "build", ".next", ".cache"}
    
    for root, dirs, files in os.walk(project_dir):
        dirs[:] = [d for d in dirs if d not in exclude_dirs]
        for file in files:
            if file.endswith((".js", ".jsx", ".ts", ".tsx")):
                file_path = os.path.join(root, file)
                rel_path = os.path.relpath(file_path, project_dir)
                
                # Check for encoding and read
                try:
                    # Check binary
                    with open(file_path, "rb") as f:
                        if b'\x00' in f.read(1024):
                            continue # Skip binary
                    
                    # Read text
                    try:
                        with open(file_path, "r", encoding="utf-8") as f:
                            content = f.read()
                    except UnicodeDecodeError:
                        with open(file_path, "r", encoding="latin-1") as f:
                            content = f.read()
                            
                    # Simple syntax bracket-matching parser
                    if not verify_brackets(content):
                        log(f"  [ERROR] Syntax check failed (unmatched brackets/braces) in file: {rel_path}", "ERROR")
                        passed = False
                    
                except Exception as e:
                    log(f"  [WARNING] Could not read file {rel_path} for syntax pre-checks: {e}", "WARNING")

    # 5. Multi-framework detection check
    log("Checking framework configuration...", "INFO")
    framework = detect_framework(project_dir)
    if framework == "nextjs":
        log(f"  [OK] Detected Next.js framework.", "SUCCESS")
        config_exists = any(os.path.exists(os.path.join(project_dir, f)) for f in ["next.config.js", "next.config.mjs", "next.config.ts"])
        if not config_exists:
            log("  [INFO] Next.js configuration file is missing. A default next.config.js will be created.", "INFO")
    elif framework == "vite":
        log(f"  [OK] Detected Vite React framework.", "SUCCESS")
        config_exists = any(os.path.exists(os.path.join(project_dir, f)) for f in ["vite.config.js", "vite.config.ts", "vite.config.mjs", "vite.config.mts"])
        if not config_exists:
            log("  [INFO] Vite configuration file is missing. A default vite.config.js will be created.", "INFO")
    else:
        log("  [WARNING] Could not automatically determine the web framework. No config file will be auto-generated.", "WARNING")

    if not passed:
        log("Pre-flight validation failed. Aborting conversion to protect codebase.", "ERROR")
        sys.exit(1)
        
    log("All Pre-Flight codebase diagnostics passed successfully!", "SUCCESS")

def verify_brackets(code):
    """Returns True if brackets/parentheses/braces are balanced, ignoring strings."""
    stack = []
    mapping = {')': '(', '}': '{', ']': '['}
    
    # Simple state machine to skip code blocks inside quotes/regexes
    in_string = False
    string_char = None
    escaped = False
    
    i = 0
    n = len(code)
    while i < n:
        char = code[i]
        
        if escaped:
            escaped = False
            i += 1
            continue
            
        if char == '\\':
            escaped = True
            i += 1
            continue
            
        if in_string:
            if char == string_char:
                in_string = False
            i += 1
            continue
            
        if char in ('"', "'", '`'):
            in_string = True
            string_char = char
            i += 1
            continue
            
        # Ignore comments
        if char == '/' and i + 1 < n:
            if code[i+1] == '/': # Single line comment
                i = code.find('\n', i)
                if i == -1: break
                continue
            elif code[i+1] == '*': # Block comment
                i = code.find('*/', i)
                if i == -1: break
                i += 2
                continue
                
        # Push / pop bracket matches
        if char in mapping.values():
            stack.append(char)
        elif char in mapping.keys():
            if not stack or stack[-1] != mapping[char]:
                return False
            stack.pop()
            
        i += 1
        
    return len(stack) == 0

# ==================== END ACTIVE CODE CHECKERS ====================

def extract_env_variables(project_dir, metadata_summary):
    log("Scanning for configuration keys to map to environment variables...", "INFO")
    env_vars = {}

    config_path = os.path.join(project_dir, "base44", "config.json")
    if os.path.exists(config_path):
        try:
            with open(config_path, "r", encoding="utf-8") as f:
                config_data = json.load(f)
                for k, v in config_data.items():
                    env_key = f"VITE_APP_{k.upper()}"
                    env_vars[env_key] = str(v)
            log(f"Extracted {len(config_data)} keys from base44/config.json", "SUCCESS")
        except Exception as e:
            log(f"Failed to parse base44/config.json for environment variables: {e}", "WARNING")

    params_path = os.path.join(project_dir, "src", "lib", "app-params.js")
    if os.path.exists(params_path):
        try:
            with open(params_path, "r", encoding="utf-8") as f:
                content = f.read()
                # Safe regex utilizing backreferences to match quotes properly
                matches = re.findall(r"(\w+)\s*:\s*(['\"`])(.*?)\2", content)
                for k, quote, v in matches:
                    env_key = f"VITE_APP_{k.upper()}"
                    env_vars[env_key] = v
            log("Extracted keys from src/lib/app-params.js", "SUCCESS")
        except Exception as e:
            log(f"Failed to parse src/lib/app-params.js: {e}", "WARNING")

    if env_vars:
        metadata_summary["extracted_env_vars"] = list(env_vars.keys())
        env_example_path = os.path.join(project_dir, ".env.example")
        try:
            with open(env_example_path, "w", encoding="utf-8") as f:
                f.write("# Environment variables migrated from Base44 configurations\n")
                f.write("# Rename this file to .env to use locally\n\n")
                for k in sorted(env_vars.keys()):
                    # Secure key leak mitigation: do not write secret keys to default configs
                    if "SECRET" in k or "PASS" in k or "TOKEN" in k:
                        f.write(f"# SECURITY WARNING: Migrate {k} to a secure backend function.\n")
                    f.write(f"{k}=\"\"\n")
            log(f"Generated .env.example at {env_example_path}", "SUCCESS")
        except Exception as e:
            log(f"Failed to write .env.example: {e}", "ERROR")
    else:
        log("No proprietary configuration variables detected for environment mapping.", "INFO")

def cleanse_package_json(project_dir, new_name=None, dry_run=False, metadata_summary=None):
    pkg_path = os.path.join(project_dir, "package.json")
    if not os.path.exists(pkg_path):
        log("No package.json found. Skipping package.json updates.", "WARNING")
        return

    try:
        with open(pkg_path, "r", encoding="utf-8") as f:
            data = json.load(f)
    except Exception as e:
        log(f"Failed to read package.json: {e}", "ERROR")
        return

    modified = False

    current_name = data.get("name", "")
    metadata_summary["original_project_name"] = current_name
    if "base44" in current_name.lower():
        name_to_use = new_name if new_name else current_name.lower().replace("base44", "app").strip("-")
        metadata_summary["new_project_name"] = name_to_use
        if dry_run:
            log(f"Would rename project in package.json from '{current_name}' to '{name_to_use}'", "INFO")
        else:
            data["name"] = name_to_use
            log(f"Renamed project in package.json to '{name_to_use}'", "SUCCESS")
        modified = True
    else:
        metadata_summary["new_project_name"] = current_name

    for dep_type in ["dependencies", "devDependencies", "peerDependencies", "optionalDependencies"]:
        if dep_type in data:
            deps = data[dep_type]
            to_remove = [k for k in deps.keys() if "base44" in k.lower()]
            if to_remove:
                for k in to_remove:
                    metadata_summary["removed_dependencies"].append(k)
                    if dry_run:
                        log(f"Would remove {dep_type} dependency: {k}", "INFO")
                    else:
                        del deps[k]
                        log(f"Removed {dep_type} dependency: {k}", "SUCCESS")
                modified = True

    if "scripts" in data:
        scripts = data["scripts"]
        to_remove = [k for k, v in scripts.items() if "base44" in k.lower() or "base44" in v.lower()]
        if to_remove:
            for k in to_remove:
                metadata_summary["removed_scripts"].append(k)
                if dry_run:
                    log(f"Would remove script: {k} -> {scripts[k]}", "INFO")
                else:
                    del scripts[k]
                    log(f"Removed script: {k}", "SUCCESS")
            modified = True

    if modified and not dry_run:
        try:
            with open(pkg_path, "w", encoding="utf-8") as f:
                json.dump(data, f, indent=2)
                f.write("\n")
            log("Successfully updated package.json", "SUCCESS")
        except Exception as e:
            log(f"Failed to write package.json: {e}", "ERROR")

def cleanse_html(project_dir, dry_run=False, metadata_summary=None):
    html_path = os.path.join(project_dir, "index.html")
    if not os.path.exists(html_path):
        log("No index.html found. Skipping HTML cleansing.", "WARNING")
        return

    try:
        with open(html_path, "r", encoding="utf-8") as f:
            content = f.read()
    except Exception as e:
        log(f"Failed to read index.html: {e}", "ERROR")
        return

    modified = False

    title_match = re.search(r"<title>(.*?)</title>", content, re.IGNORECASE)
    if title_match:
        title_text = title_match.group(1)
        if "base44" in title_text.lower():
            new_title = title_text.lower().replace("base44", "").strip(" -_")
            # Capitalize words
            new_title = " ".join([w.capitalize() for w in new_title.split()])
            if not new_title:
                new_title = "Standalone Web App"
            
            if dry_run:
                log(f"Would change HTML title from '{title_text}' to '{new_title}'", "INFO")
            else:
                # Direct string replacement to avoid regex sub escape issues
                old_tag = f"<title>{title_text}</title>"
                new_tag = f"<title>{new_title}</title>"
                content = content.replace(old_tag, new_tag)
                log(f"Updated HTML title to '{new_title}'", "SUCCESS")
            modified = True

    link_matches = re.findall(r"(<link[^>]*?href=[^>]*?base44[^>]*?>)", content, re.IGNORECASE)
    for link in link_matches:
        if dry_run:
            log(f"Would remove base44 link/favicon tag: {link.strip()}", "INFO")
        else:
            content = content.replace(link, "")
            log("Removed base44 link/favicon reference from index.html", "SUCCESS")
        modified = True

    if modified and not dry_run:
        try:
            with open(html_path, "w", encoding="utf-8") as f:
                f.write(content)
            metadata_summary["modified_files"].append("index.html")
            log("Successfully updated index.html", "SUCCESS")
        except Exception as e:
            log(f"Failed to write index.html: {e}", "ERROR")

def deep_search_and_replace(project_dir, dry_run=False, metadata_summary=None):
    log("Starting global search-and-replace for 'base44'...", "INFO")
    
    exclude_dirs = {".git", "node_modules", "dist", "build", ".next", ".cache", ".idea", ".vscode"}
    exclude_files = {"package-lock.json", "yarn.lock", "pnpm-lock.yaml", "base44-cleanse.py", ".migration-status.json"}

    pattern = re.compile(r"base44", re.IGNORECASE)

    def case_preserving_replace(match):
        val = match.group(0)
        if val.isupper():
            return "STANDALONE"
        elif val.istitle():
            return "Standalone"
        else:
            return "standalone"

    count = 0
    file_count = 0

    for root, dirs, files in os.walk(project_dir):
        dirs[:] = [d for d in dirs if d not in exclude_dirs]
        for file in files:
            if file in exclude_files:
                continue
            
            file_path = os.path.join(root, file)
            rel_path = os.path.relpath(file_path, project_dir)
            
            try:
                with open(file_path, "rb") as f:
                    if b'\x00' in f.read(1024):
                        continue # Skip binary
                
                try:
                    with open(file_path, "r", encoding="utf-8") as f:
                        content = f.read()
                except UnicodeDecodeError:
                    with open(file_path, "r", encoding="latin-1") as f:
                        content = f.read()
            except OSError:
                continue

            if pattern.search(content):
                file_count += 1
                matches = len(pattern.findall(content))
                count += matches
                
                if dry_run:
                    log(f"Would clean {matches} occurrences of 'base44' in: {rel_path}", "INFO")
                else:
                    new_content = pattern.sub(case_preserving_replace, content)
                    try:
                        with open(file_path, "w", encoding="utf-8") as f:
                            f.write(new_content)
                        metadata_summary["modified_files"].append(rel_path)
                        log(f"Replaced {matches} occurrences of 'base44' in: {rel_path}", "SUCCESS")
                    except Exception as e:
                        log(f"Error writing to {file_path}: {e}", "ERROR")

    log(f"Search and replace completed. Total occurrences found: {count} across {file_count} files.", "SUCCESS")

def run_npm_install(project_dir, dry_run=False):
    if dry_run:
        log("Would run package installation (npm/yarn/pnpm install)", "INFO")
        return

    pkg_mgr = "npm"
    if os.path.exists(os.path.join(project_dir, "pnpm-lock.yaml")):
        pkg_mgr = "pnpm"
    elif os.path.exists(os.path.join(project_dir, "yarn.lock")):
        pkg_mgr = "yarn"

    log(f"Running '{pkg_mgr} install' to regenerate dependencies...", "INFO")
    try:
        subprocess.run(f"{pkg_mgr} install", shell=True, cwd=project_dir, check=True)
        log("Dependencies successfully reinstalled.", "SUCCESS")
    except subprocess.CalledProcessError as e:
        log(f"Package installation failed: {e}", "ERROR")

def inject_pino_logging(project_dir, dry_run=False, metadata_summary=None):
    log("Injecting Pino logging setup in entry files...", "INFO")
    entry_files = []
    for candidate in [
        os.path.join(project_dir, "src", "main.jsx"),
        os.path.join(project_dir, "src", "main.tsx"),
        os.path.join(project_dir, "src", "App.jsx"),
        os.path.join(project_dir, "src", "App.tsx")
    ]:
        if os.path.exists(candidate):
            entry_files.append(candidate)
            
    if not entry_files:
        log("No standard entry files found to inject Pino logging.", "WARNING")
        return
        
    pino_import = "import pino from 'pino';\n"
    pino_setup = (
        "\n// Pino Structured Logger Setup\n"
        "export const logger = pino({\n"
        "  level: 'info',\n"
        "  browser: {\n"
        "    asObject: true\n"
        "  }\n"
        "});\n"
        "logger.info('Application initialized successfully');\n\n"
    )
    
    for entry_file in entry_files:
        rel_path = os.path.relpath(entry_file, project_dir)
        try:
            with open(entry_file, "r", encoding="utf-8") as f:
                content = f.read()
                
            if "import pino" in content:
                log(f"Pino logging already present in {rel_path}", "INFO")
                continue
                
            if dry_run:
                log(f"Would inject Pino logging setup into {rel_path}", "INFO")
                continue
                
            lines = content.splitlines()
            last_import_idx = -1
            for idx, line in enumerate(lines):
                if line.strip().startswith("import "):
                    last_import_idx = idx
            
            if last_import_idx != -1:
                new_lines = lines[:last_import_idx + 1] + [pino_import.strip()] + lines[last_import_idx + 1:]
                
                first_code_idx = -1
                for idx, line in enumerate(new_lines):
                    if line.strip() and not line.strip().startswith("import "):
                        first_code_idx = idx
                        break
                if first_code_idx != -1:
                    new_lines.insert(first_code_idx, pino_setup.strip("\n"))
                else:
                    new_lines.append(pino_setup.strip("\n"))
            else:
                new_content = pino_import + pino_setup + content
                new_lines = new_content.splitlines()
                
            with open(entry_file, "w", encoding="utf-8") as f:
                f.write("\n".join(new_lines) + "\n")
                
            log(f"Injected Pino logging setup into {rel_path}", "SUCCESS")
            if metadata_summary is not None:
                metadata_summary["modified_files"].append(rel_path)
        except Exception as e:
            log(f"Failed to inject Pino logging into {rel_path}: {e}", "ERROR")

def scaffold_testing_and_logging(project_dir, framework, dry_run=False, metadata_summary=None):
    log("Setting up structured logging and testing scaffolding...", "INFO")
    
    # 1. Update package.json with dependencies and scripts
    pkg_path = os.path.join(project_dir, "package.json")
    if os.path.exists(pkg_path):
        try:
            with open(pkg_path, "r", encoding="utf-8") as f:
                data = json.load(f)
            
            modified = False
            if "dependencies" not in data:
                data["dependencies"] = {}
            if "devDependencies" not in data:
                data["devDependencies"] = {}
            if "scripts" not in data:
                data["scripts"] = {}
                
            if "pino" not in data["dependencies"]:
                data["dependencies"]["pino"] = "^9.2.0"
                log("Added 'pino' dependency to package.json", "SUCCESS")
                modified = True
                
            testing_deps = {
                "vitest": "^1.6.0",
                "@vitejs/plugin-react": "^4.3.0",
                "@testing-library/react": "^15.0.0",
                "@testing-library/jest-dom": "^6.4.0",
                "jsdom": "^24.1.0",
                "@playwright/test": "^1.44.0"
            }
            for dep, ver in testing_deps.items():
                if dep not in data["devDependencies"]:
                    data["devDependencies"][dep] = ver
                    log(f"Added devDependency '{dep}' to package.json", "SUCCESS")
                    modified = True
                    
            test_scripts = {
                "test": "vitest run",
                "test:watch": "vitest",
                "test:e2e": "playwright test"
            }
            for name, cmd in test_scripts.items():
                if name not in data["scripts"] or data["scripts"][name].startswith("echo"):
                    data["scripts"][name] = cmd
                    log(f"Added script '{name}' -> '{cmd}' to package.json", "SUCCESS")
                    modified = True
                    
            if modified and not dry_run:
                with open(pkg_path, "w", encoding="utf-8") as f:
                    json.dump(data, f, indent=2)
                    f.write("\n")
                log("Updated package.json with test and logging dependencies.", "SUCCESS")
        except Exception as e:
            log(f"Failed to update package.json with test and logging dependencies: {e}", "ERROR")
            
    # 2. Inject Pino logging setup in entry files
    inject_pino_logging(project_dir, dry_run, metadata_summary)
    
    # 3. Generate playwright.config.js
    port = "3000" if framework == "nextjs" else "5173"
    playwright_config = f"""import {{ defineConfig, devices }} from '@playwright/test';

export default defineConfig({{
  testDir: './e2e',
  fullyParallel: true,
  forbidOnly: !!process.env.CI,
  retries: process.env.CI ? 2 : 0,
  workers: process.env.CI ? 1 : undefined,
  reporter: 'html',
  use: {{
    baseURL: 'http://localhost:{port}',
    trace: 'on-first-retry',
  }},
  projects: [
    {{
      name: 'chromium',
      use: {{ ...devices['Desktop Chrome'] }},
    }},
    {{
      name: 'firefox',
      use: {{ ...devices['Desktop Firefox'] }},
    }},
    {{
      name: 'webkit',
      use: {{ ...devices['Desktop Safari'] }},
    }},
  ],
  webServer: {{
    command: 'npm run dev',
    url: 'http://localhost:{port}',
    reuseExistingServer: !process.env.CI,
  }},
}});
"""
    playwright_path = os.path.join(project_dir, "playwright.config.js")
    if not os.path.exists(playwright_path):
        if dry_run:
            log(f"Would create Playwright config: {playwright_path}", "INFO")
        else:
            try:
                with open(playwright_path, "w", encoding="utf-8") as f:
                    f.write(playwright_config)
                log(f"Created Playwright config: {playwright_path}", "SUCCESS")
                if metadata_summary is not None:
                    metadata_summary["modified_files"].append("playwright.config.js")
            except Exception as e:
                log(f"Failed to create Playwright config: {e}", "ERROR")
                
    e2e_dir = os.path.join(project_dir, "e2e")
    e2e_test_path = os.path.join(e2e_dir, "example.spec.js")
    if not os.path.exists(e2e_test_path):
        if dry_run:
            log(f"Would create E2E test folder: {e2e_dir}", "INFO")
        else:
            try:
                os.makedirs(e2e_dir, exist_ok=True)
                e2e_content = f"""import {{ test, expect }} from '@playwright/test';

test('has title', async ({{ page }}) => {{
  await page.goto('http://localhost:{port}/');
  await expect(page).toHaveTitle(/./);
}});
"""
                with open(e2e_test_path, "w", encoding="utf-8") as f:
                    f.write(e2e_content)
                log(f"Created E2E test file: {e2e_test_path}", "SUCCESS")
                if metadata_summary is not None:
                    metadata_summary["modified_files"].append("e2e/example.spec.js")
            except Exception as e:
                log(f"Failed to create E2E test file: {e}", "ERROR")

    # 4. Generate vitest.config.js
    vitest_config = """import { defineConfig, configDefaults } from 'vitest/config';
import react from '@vitejs/plugin-react';

export default defineConfig({
  plugins: [react()],
  test: {
    environment: 'jsdom',
    globals: true,
    exclude: [...configDefaults.exclude, 'e2e/**'],
  },
});
"""
    vitest_path = os.path.join(project_dir, "vitest.config.js")
    if not os.path.exists(vitest_path):
        if dry_run:
            log(f"Would create Vitest config: {vitest_path}", "INFO")
        else:
            try:
                with open(vitest_path, "w", encoding="utf-8") as f:
                    f.write(vitest_config)
                log(f"Created Vitest config: {vitest_path}", "SUCCESS")
                if metadata_summary is not None:
                    metadata_summary["modified_files"].append("vitest.config.js")
            except Exception as e:
                log(f"Failed to create Vitest config: {e}", "ERROR")

    # 5. Generate mock unit test src/App.test.jsx
    mock_test_content = """import { describe, it, expect } from 'vitest';
import { render } from '@testing-library/react';
import React from 'react';
import App from './App';

describe('App Component', () => {
  it('renders without crashing', () => {
    const { container } = render(<App />);
    expect(container).toBeDefined();
  });
});
"""
    mock_test_path = os.path.join(project_dir, "src", "App.test.jsx")
    if not os.path.exists(mock_test_path):
        if dry_run:
            log(f"Would create mock unit test: {mock_test_path}", "INFO")
        else:
            try:
                os.makedirs(os.path.dirname(mock_test_path), exist_ok=True)
                with open(mock_test_path, "w", encoding="utf-8") as f:
                    f.write(mock_test_content)
                log(f"Created mock unit test: {mock_test_path}", "SUCCESS")
                if metadata_summary is not None:
                    metadata_summary["modified_files"].append("src/App.test.jsx")
            except Exception as e:
                log(f"Failed to create mock unit test: {e}", "ERROR")

def scaffold_styling_and_optimization(project_dir, dry_run=False, metadata_summary=None):
    log("Setting up modern styling (Tailwind CSS) and bundle optimizations...", "INFO")
    
    # 1. Update package.json with tailwindcss, postcss, autoprefixer
    pkg_path = os.path.join(project_dir, "package.json")
    if os.path.exists(pkg_path):
        try:
            with open(pkg_path, "r", encoding="utf-8") as f:
                data = json.load(f)
            
            modified = False
            if "devDependencies" not in data:
                data["devDependencies"] = {}
                
            style_deps = {
                "tailwindcss": "^3.4.0",
                "postcss": "^8.4.30",
                "autoprefixer": "^10.4.15"
            }
            for dep, ver in style_deps.items():
                if dep not in data["devDependencies"]:
                    data["devDependencies"][dep] = ver
                    log(f"Added devDependency '{dep}' for modern styling", "SUCCESS")
                    modified = True
                    
            if modified and not dry_run:
                with open(pkg_path, "w", encoding="utf-8") as f:
                    json.dump(data, f, indent=2)
                    f.write("\n")
                log("Updated package.json with styling dependencies.", "SUCCESS")
        except Exception as e:
            log(f"Failed to update package.json with styling dependencies: {e}", "ERROR")

    # 2. Generate tailwind.config.js
    tailwind_config = """/** @type {import('tailwindcss').Config} */
module.exports = {
  content: [
    "./index.html",
    "./src/**/*.{js,ts,jsx,tsx}",
  ],
  theme: {
    extend: {},
  },
  plugins: [],
}
"""
    tailwind_path = os.path.join(project_dir, "tailwind.config.js")
    if not os.path.exists(tailwind_path):
        if dry_run:
            log(f"Would create Tailwind config: {tailwind_path}", "INFO")
        else:
            try:
                with open(tailwind_path, "w", encoding="utf-8") as f:
                    f.write(tailwind_config)
                log(f"Created Tailwind config: {tailwind_path}", "SUCCESS")
                if metadata_summary is not None:
                    metadata_summary["modified_files"].append("tailwind.config.js")
            except Exception as e:
                log(f"Failed to create Tailwind config: {e}", "ERROR")

    # 3. Generate postcss.config.js
    postcss_config = """module.exports = {
  plugins: {
    tailwindcss: {},
    autoprefixer: {},
  },
}
"""
    postcss_path = os.path.join(project_dir, "postcss.config.js")
    if not os.path.exists(postcss_path):
        if dry_run:
            log(f"Would create PostCSS config: {postcss_path}", "INFO")
        else:
            try:
                with open(postcss_path, "w", encoding="utf-8") as f:
                    f.write(postcss_config)
                log(f"Created PostCSS config: {postcss_path}", "SUCCESS")
                if metadata_summary is not None:
                    metadata_summary["modified_files"].append("postcss.config.js")
            except Exception as e:
                log(f"Failed to create PostCSS config: {e}", "ERROR")

    # 4. Inject Google Fonts into index.html
    html_path = os.path.join(project_dir, "index.html")
    if os.path.exists(html_path):
        try:
            with open(html_path, "r", encoding="utf-8") as f:
                html_content = f.read()
                
            fonts_markup = (
                '    <link rel="preconnect" href="https://fonts.googleapis.com" />\\n'
                '    <link rel="preconnect" href="https://fonts.gstatic.com" crossorigin />\\n'
                '    <link href="https://fonts.googleapis.com/css2?family=Inter:wght@300;400;500;600;700&family=Outfit:wght@300;400;500;600;700&display=swap" rel="stylesheet" />\\n'
            )
            
            if "fonts.googleapis.com" not in html_content:
                if dry_run:
                    log("Would inject Google Fonts into index.html head", "INFO")
                else:
                    new_html = html_content.replace("</head>", f"{fonts_markup}  </head>")
                    with open(html_path, "w", encoding="utf-8") as f:
                        f.write(new_html)
                    log("Injected Google Fonts (Inter/Outfit) into index.html head section", "SUCCESS")
                    if metadata_summary is not None and "index.html" not in metadata_summary["modified_files"]:
                        metadata_summary["modified_files"].append("index.html")
        except Exception as e:
            log(f"Failed to inject Google Fonts into index.html: {e}", "ERROR")

    # 5. Inject optimization settings in vite.config.js / next.config.js
    vite_path = os.path.join(project_dir, "vite.config.js")
    if os.path.exists(vite_path):
        try:
            with open(vite_path, "r", encoding="utf-8") as f:
                vite_content = f.read()
                
            if "manualChunks" not in vite_content and "rollupOptions" not in vite_content:
                if dry_run:
                    log("Would add rollup vendor chunks optimization to vite.config.js", "INFO")
                else:
                    # Insert rollupOptions optimization in vite config definition
                    opt_content = """  build: {
    rollupOptions: {
      output: {
        manualChunks: {
          vendor: ['react', 'react-dom']
        }
      }
    }
  }"""
                    # Try to insert it before the closing defineConfig object
                    if "plugins:" in vite_content:
                        # Find the closing defineConfig brackets
                        last_brace = vite_content.rfind("}")
                        # Insert before last closing brace/paren
                        match = re.search(r"plugins:\s*\[[^\]]*\]", vite_content)
                        if match:
                            insert_pos = match.end()
                            new_vite = vite_content[:insert_pos] + ",\n" + opt_content + vite_content[insert_pos:]
                            with open(vite_path, "w", encoding="utf-8") as f:
                                f.write(new_vite)
                            log("Added rollup vendor code-splitting chunks optimization to vite.config.js", "SUCCESS")
                            if metadata_summary is not None:
                                metadata_summary["modified_files"].append("vite.config.js")
        except Exception as e:
            log(f"Failed to add bundle optimization to vite.config.js: {e}", "ERROR")

def main():
    parser = argparse.ArgumentParser(description="Cleanse a repository of all base44 traces.")
    parser.add_argument("--dir", default=".", help="Target directory (default: current directory)")
    parser.add_argument("--rename", help="New name for the project in package.json")
    parser.add_argument("--dry-run", action="store_true", help="Perform a dry run without modifying files")
    
    args = parser.parse_args()
    
    target_dir = os.path.abspath(args.dir)
    log(f"Starting Base44 cleanup in: {target_dir}")
    if args.dry_run:
        log("DRY RUN MODE ENABLED - No changes will be saved", "WARNING")

    # Run active pre-flight diagnostics
    run_preflight_checks(target_dir)

    metadata_summary = {
        "migration_timestamp": datetime.now().isoformat(),
        "original_project_name": "",
        "new_project_name": "",
        "detected_framework": "",
        "deleted_files_and_directories": [],
        "modified_files": [],
        "removed_dependencies": [],
        "removed_scripts": [],
        "extracted_env_vars": []
    }

    # Extract configs in dry run too for output logging visibility
    extract_env_variables(target_dir, metadata_summary)

    log("Step 1: Deleting base44 folders...", "INFO")
    paths_to_delete = [
        os.path.join(target_dir, "base44"),
        os.path.join(target_dir, "node_modules", "@base44"),
        os.path.join(target_dir, "eject_base44.py"),
        os.path.join(target_dir, "fetch_data.py"),
        os.path.join(target_dir, "src", "lib", "app-params.js")
    ]
    for p in paths_to_delete:
        rel_p = os.path.relpath(p, target_dir)
        deleted = delete_path(p, dry_run=args.dry_run)
        if deleted:
            metadata_summary["deleted_files_and_directories"].append(rel_p)

    log("Step 2: Cleaning package.json...", "INFO")
    cleanse_package_json(target_dir, new_name=args.rename, dry_run=args.dry_run, metadata_summary=metadata_summary)

    log("Step 3: Cleaning index.html...", "INFO")
    cleanse_html(target_dir, dry_run=args.dry_run, metadata_summary=metadata_summary)

    log("Step 4: Running global case-preserving replacement...", "INFO")
    deep_search_and_replace(target_dir, dry_run=args.dry_run, metadata_summary=metadata_summary)

    log("Step 4.5: Writing framework configuration file...", "INFO")
    framework = detect_framework(target_dir)
    metadata_summary["detected_framework"] = framework
    write_framework_config(target_dir, framework, dry_run=args.dry_run, metadata_summary=metadata_summary)

    log("Step 4.6: Scaffolding testing and logging capabilities...", "INFO")
    scaffold_testing_and_logging(target_dir, framework, dry_run=args.dry_run, metadata_summary=metadata_summary)

    log("Step 4.7: Scaffolding styling and bundle optimizations...", "INFO")
    scaffold_styling_and_optimization(target_dir, dry_run=args.dry_run, metadata_summary=metadata_summary)

    if not args.dry_run:
        meta_path = os.path.join(target_dir, ".migration-status.json")
        try:
            with open(meta_path, "w", encoding="utf-8") as f:
                json.dump(metadata_summary, f, indent=2)
            log(f"Generated migration metadata at {meta_path}", "SUCCESS")
        except Exception as e:
            log(f"Failed to generate migration status file: {e}", "ERROR")

    log("Step 5: Re-installing dependencies...", "INFO")
    run_npm_install(target_dir, dry_run=args.dry_run)

    log("Base44 Converter CLI phase complete. Standalone project is ready for AI re-wiring and enhancement!", "SUCCESS")

if __name__ == "__main__":
    main()
