/**
 * Link/copy official claudevm.bundle (rootfs.img) into a target userData for dual-exec P0.
 *
 * Prefers hardlinks for multi-GB rootfs.img when source and dest are on the same volume.
 *
 * Default source: ~/Library/Application Support/Claude-3p/vm_bundles/claudevm.bundle
 * Default dest:   ~/Library/Application Support/Claude-Deepseek/vm_bundles/claudevm.bundle
 *
 * Env:
 *   CLAUDE_VM_BUNDLE_SOURCE
 *   CLAUDE_VM_BUNDLE_DEST  (full path to claudevm.bundle dir)
 *   CLAUDE_VM_USERDATA     (parent userData; dest becomes <userData>/vm_bundles/claudevm.bundle)
 *   CLAUDE_VM_FORCE_COPY=1 force full copy instead of hardlink
 */
import fs from "node:fs";
import os from "node:os";
import path from "node:path";

const home = os.homedir();
const forceCopy = process.env.CLAUDE_VM_FORCE_COPY === "1";

const source =
  process.env.CLAUDE_VM_BUNDLE_SOURCE
  || path.join(
    home,
    "Library/Application Support/Claude-3p/vm_bundles/claudevm.bundle",
  );
const dest =
  process.env.CLAUDE_VM_BUNDLE_DEST
  || (process.env.CLAUDE_VM_USERDATA
    ? path.join(
        process.env.CLAUDE_VM_USERDATA,
        "vm_bundles",
        "claudevm.bundle",
      )
    : path.join(
        home,
        "Library/Application Support/Claude-Deepseek/vm_bundles/claudevm.bundle",
      ));

function ensureLinkOrCopy(srcFile, destFile) {
  if (fs.existsSync(destFile)) {
    const srcStat = fs.statSync(srcFile);
    const destStat = fs.statSync(destFile);
    if (srcStat.size === destStat.size) {
      console.log(`keep existing ${path.basename(destFile)} (${destStat.size} bytes)`);
      return;
    }
    console.warn(
      `size mismatch ${path.basename(destFile)}: src=${srcStat.size} dest=${destStat.size}; replacing`,
    );
    fs.rmSync(destFile, { force: true });
  }

  if (!forceCopy) {
    try {
      fs.linkSync(srcFile, destFile);
      console.log(`hardlinked ${path.basename(srcFile)} -> ${destFile}`);
      return;
    } catch (error) {
      console.warn(`hardlink failed (${error instanceof Error ? error.message : error}); copying`);
    }
  }
  fs.copyFileSync(srcFile, destFile);
  console.log(`copied ${path.basename(srcFile)} -> ${destFile}`);
}

if (!fs.existsSync(source)) {
  console.error(`Source bundle missing: ${source}`);
  process.exit(1);
}
const rootfs = path.join(source, "rootfs.img");
if (!fs.existsSync(rootfs)) {
  console.error(`Source rootfs.img missing: ${rootfs}`);
  process.exit(1);
}

fs.mkdirSync(dest, { recursive: true });

const entries = fs.readdirSync(source, { withFileTypes: true });
for (const entry of entries) {
  const srcPath = path.join(source, entry.name);
  const destPath = path.join(dest, entry.name);
  if (entry.isDirectory()) {
    if (!fs.existsSync(destPath)) {
      fs.cpSync(srcPath, destPath, { recursive: true, verbatimSymlinks: true });
      console.log(`copied dir ${entry.name}/`);
    } else {
      console.log(`keep existing dir ${entry.name}/`);
    }
    continue;
  }
  if (entry.isSymbolicLink()) {
    if (!fs.existsSync(destPath)) {
      const target = fs.readlinkSync(srcPath);
      fs.symlinkSync(target, destPath);
      console.log(`symlinked ${entry.name} -> ${target}`);
    }
    continue;
  }
  if (entry.isFile()) {
    ensureLinkOrCopy(srcPath, destPath);
  }
}

const destRootfs = path.join(dest, "rootfs.img");
if (!fs.existsSync(destRootfs)) {
  console.error(`Failed to materialize rootfs.img at ${destRootfs}`);
  process.exit(1);
}

const stat = fs.statSync(destRootfs);
console.log(
  JSON.stringify(
    {
      bundleReady: true,
      dest,
      rootfsBytes: stat.size,
      source,
    },
    null,
    2,
  ),
);
console.log("bundle ready:", dest);
