import { promises as fs } from 'fs';
import path from 'path';

const ROOT = process.cwd();
const VAULT_PLUGINS_DIR = 'H:\\Docs\\Obsinote\\.obsidian\\plugins';

async function exists(filePath) {
    try {
        await fs.access(filePath);
        return true;
    } catch {
        return false;
    }
}

async function copyFileIfExists(src, dest) {
    if (!(await exists(src))) {
        return false;
    }

    await fs.copyFile(src, dest);
    return true;
}

async function main() {
    const manifestPath = path.join(ROOT, 'manifest.json');
    const manifestRaw = await fs.readFile(manifestPath, 'utf8');
    const manifest = JSON.parse(manifestRaw);

    if (!manifest?.id) {
        throw new Error('manifest.json 缺少 id 字段，无法定位本地插件目录。');
    }

    const targetPluginDir = path.join(VAULT_PLUGINS_DIR, manifest.id);
    await fs.mkdir(targetPluginDir, { recursive: true });

    const copied = [];
    const requiredFiles = ['main.js', 'manifest.json'];
    const optionalFiles = ['styles.css'];

    for (const name of requiredFiles) {
        const src = path.join(ROOT, name);
        const dest = path.join(targetPluginDir, name);
        const ok = await copyFileIfExists(src, dest);
        if (!ok) {
            throw new Error(`缺少必须文件: ${name}。请先执行 npm run build。`);
        }
        copied.push(name);
    }

    for (const name of optionalFiles) {
        const src = path.join(ROOT, name);
        const dest = path.join(targetPluginDir, name);
        const ok = await copyFileIfExists(src, dest);
        if (ok) {
            copied.push(name);
        }
    }

    const hotReloadMarker = path.join(targetPluginDir, '.hotreload');
    if (!(await exists(hotReloadMarker))) {
        await fs.writeFile(hotReloadMarker, '', 'utf8');
    }

    console.log(`[copy-to-local] 插件ID: ${manifest.id}`);
    console.log(`[copy-to-local] 目标目录: ${targetPluginDir}`);
    console.log(`[copy-to-local] 已复制: ${copied.join(', ')}`);
    console.log('[copy-to-local] .hotreload 已就绪');
}

main().catch((error) => {
    console.error('[copy-to-local] 失败:', error.message);
    process.exit(1);
});
