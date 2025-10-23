"use strict";
var __importDefault = (this && this.__importDefault) || function (mod) {
    return (mod && mod.__esModule) ? mod : { "default": mod };
};
Object.defineProperty(exports, "__esModule", { value: true });
exports.startTsToLuaConverter = startTsToLuaConverter;
const fs_1 = __importDefault(require("fs"));
const path_1 = __importDefault(require("path"));
const chokidar_1 = __importDefault(require("chokidar"));
const converter_1 = require("./converter");
const typescript_1 = __importDefault(require("typescript"));
// 忽略隐藏文件（如 .gitignore、.DS_Store 等）
const IGNORED_FILES = /(^|[\/\\])\../;
/**
 * 加载配置文件（从项目根目录的 config.json 读取完整配置）
 * @returns 解析后的完整配置对象
 * @throws 加载失败时抛出错误
 */
function loadFullConfig() {
    try {
        const configPath = path_1.default.join(process.cwd(), './config.json');
        const rawData = fs_1.default.readFileSync(configPath, 'utf-8');
        const config = JSON.parse(rawData);
        // 校验配置文件必填字段（避免配置缺失导致后续错误）
        const requiredFields = ['inputDir', 'outputDir', 'reserved_methods', 'use_ts_basic_methods'];
        const missingFields = requiredFields.filter(field => !(field in config));
        if (missingFields.length > 0) {
            throw new Error(`config.json 缺少必填字段: ${missingFields.join(', ')}`);
        }
        return config;
    }
    catch (error) {
        const errorMsg = error instanceof Error
            ? `加载 config.json 失败: ${error.message}`
            : '加载 config.json 失败: 未知错误';
        throw new Error(errorMsg);
    }
}
/**
 * 解析路径（绝对路径直接返回，相对路径基于基准目录解析）
 * @param userPath 用户传入的路径
 * @param baseDir 基准目录（默认当前工作目录）
 * @returns 解析后的绝对路径
 */
function resolvePath(userPath, baseDir) {
    if (path_1.default.isAbsolute(userPath))
        return userPath;
    const base = baseDir || process.cwd();
    return path_1.default.resolve(base, userPath);
}
/**
 * TS 转 Lua 转换器的主函数
 * @param partialConfig 可选参数（仅支持inputDir/outputDir，用于覆盖配置文件中的同名字段）
 * @returns 包含关闭方法的对象（用于手动停止监听、释放资源）
 */
function startTsToLuaConverter(partialConfig) {
    // 1. 加载完整配置 + 合并可选参数（inputDir/outputDir优先用传入值，其余用配置文件）
    const fullConfig = loadFullConfig();
    const mergedConfig = {
        ...fullConfig, // 基础配置：reserved_methods、use_ts_basic_methods 等从文件读取
        inputDir: partialConfig?.inputDir || fullConfig.inputDir, // 覆盖规则：传入优先
        outputDir: partialConfig?.outputDir || fullConfig.outputDir
    };
    // 2. 解析最终的输入/输出路径（确保绝对路径）
    const inDir = resolvePath(mergedConfig.inputDir);
    const outDir = resolvePath(mergedConfig.outputDir);
    // 3. 校验输入目录是否存在（避免监听不存在的目录）
    if (!fs_1.default.existsSync(inDir)) {
        throw new Error(`输入目录不存在: ${inDir}（请检查 config.json 或传入的 inputDir 参数）`);
    }
    // 4. 确保输出目录存在
    if (!fs_1.default.existsSync(outDir)) {
        fs_1.default.mkdirSync(outDir, { recursive: true });
        console.log(`📂 创建输出目录: ${outDir}`);
    }
    // 5. 创建 TS 转 Lua 转换器实例（其余配置仍用文件中的值）
    const converter = new converter_1.TsToLuaConverter(mergedConfig.use_ts_basic_methods ? mergedConfig.reserved_methods : {});
    // 6. 内部工具函数：转换单个 TS 文件
    const convertFile = (filePath) => {
        const fileName = path_1.default.basename(filePath);
        if (path_1.default.extname(fileName) !== '.ts' || IGNORED_FILES.test(fileName))
            return;
        const luaFileName = fileName.replace('.ts', '.lua');
        const outputPath = path_1.default.join(outDir, luaFileName);
        try {
            const sourceCode = fs_1.default.readFileSync(filePath, 'utf-8');
            const sourceFile = typescript_1.default.createSourceFile(fileName, sourceCode, typescript_1.default.ScriptTarget.Latest, true);
            const luaCode = converter.convert(sourceFile);
            fs_1.default.writeFileSync(outputPath, luaCode);
            console.log(`➡️  已转换: ${fileName} → ${luaFileName}`);
        }
        catch (error) {
            const errorMsg = error instanceof Error
                ? error.message
                : String(error);
            console.error(`❌ 转换 ${fileName} 失败:`, errorMsg);
        }
    };
    // 7. 内部工具函数：转换所有符合条件的 TS 文件
    const convertAllFiles = () => {
        console.log('⭐️ 开始初始转换所有 TS 文件...');
        let convertedCount = 0;
        try {
            const files = fs_1.default.readdirSync(inDir);
            files.forEach(file => {
                if (path_1.default.extname(file) === '.ts' && !IGNORED_FILES.test(file)) {
                    convertFile(path_1.default.join(inDir, file));
                    convertedCount++;
                }
            });
            console.log(`✅ 初始转换完成！共转换 ${convertedCount} 个文件`);
        }
        catch (error) {
            const errorMsg = error instanceof Error
                ? error.message
                : '读取输入目录失败';
            console.error(`❌ 初始转换出错:`, errorMsg);
        }
    };
    // 8. 内部工具函数：确保 tsbasic.lua 存在（use_ts_basic_methods 从配置文件读取）
    const ensureTsBasicLuaExists = () => {
        const workDir = __dirname;
        const srcFile = path_1.default.join(workDir, 'tslib', 'tsbasic.lua');
        const destFile = path_1.default.join(outDir, 'tsbasic.lua');
        try {
            if (fs_1.default.existsSync(destFile))
                return; // 目标文件已存在，跳过
            if (!fs_1.default.existsSync(srcFile)) {
                throw new Error(`TS 基础支持文件不存在: ${srcFile}`);
            }
            fs_1.default.copyFileSync(srcFile, destFile);
            console.log(`📄 复制 TS 基础支持文件: ${srcFile} → ${destFile}`);
        }
        catch (error) {
            const errorMsg = error instanceof Error
                ? error.message
                : '复制 tsbasic.lua 失败';
            console.error(`❌ TS 基础支持文件处理出错:`, errorMsg);
        }
    };
    // 9. 处理 TS 基础支持文件（use_ts_basic_methods 仍用配置文件的值）
    if (mergedConfig.use_ts_basic_methods) {
        ensureTsBasicLuaExists();
    }
    // 10. 创建文件监听器（监听合并后的输入目录）
    const watcher = chokidar_1.default.watch(inDir, {
        ignored: IGNORED_FILES,
        persistent: true,
        ignoreInitial: true, // 忽略初始扫描（初始转换已单独处理）
    });
    // 11. 注册文件监听事件
    watcher
        .on('add', (filePath) => {
        console.log(`❕ 检测到新文件: ${path_1.default.basename(filePath)}`);
        convertFile(filePath);
    })
        .on('change', (filePath) => {
        console.log(`💻 文件已修改: ${path_1.default.basename(filePath)}`);
        convertFile(filePath);
    })
        .on('unlink', (filePath) => {
        const fileName = path_1.default.basename(filePath);
        if (path_1.default.extname(fileName) !== '.ts')
            return;
        const luaFileName = fileName.replace('.ts', '.lua');
        const outputPath = path_1.default.join(outDir, luaFileName);
        if (fs_1.default.existsSync(outputPath)) {
            fs_1.default.unlinkSync(outputPath);
            console.log(`❌ 已删除: ${luaFileName}（源 TS 文件已移除）`);
        }
    })
        .on('error', (error) => {
        console.error(`❌ 文件监听出错:`, error.message);
    });
    // 12. 注册进程优雅退出事件（停止监听、释放资源）
    const handleExit = async () => {
        console.log('\n⚙️  正在停止...');
        await watcher.close();
        console.log('👋 已停止');
    };
    process.on('SIGINT', handleExit); // Ctrl+C 触发
    process.on('SIGTERM', handleExit); // 进程终止信号触发
    //   // 13. 打印配置信息（让用户明确当前使用的配置）
    //   console.log(`\n📋 当前生效配置:`);
    //   console.log(`- 输入目录: ${inDir}（${partialConfig?.inputDir ? '来自参数' : '来自 config.json'}）`);
    //   console.log(`- 输出目录: ${outDir}（${partialConfig?.outputDir ? '来自参数' : '来自 config.json'}）`);
    //   console.log(`- TS 基础方法支持: ${mergedConfig.use_ts_basic_methods ? '启用' : '禁用'}（来自 config.json）`);
    // 14. 执行初始转换
    convertAllFiles();
    console.log(`\n⚙️  已启动！监听目录: ${inDir}`);
    console.log('➡️  按 Ctrl+C 停止');
    // 15. 返回手动控制接口（关闭监听、移除退出事件）
    return {
        /**
         * 手动停止转换器（释放资源）
         * @returns 关闭完成的 Promise
         */
        close: async () => {
            // 移除进程退出监听（避免重复触发）
            process.off('SIGINT', handleExit);
            process.off('SIGTERM', handleExit);
            // 关闭文件监听
            await watcher.close();
            console.log('🔌 停止：资源已释放');
        },
        /**
         * 获取当前生效的完整配置（方便外部调试）
         * @returns 合并后的完整配置
         */
        getCurrentConfig: () => ({ ...mergedConfig }) // 返回深拷贝，避免外部修改内部配置
    };
}
// 若直接运行当前文件（而非被导入），则启动转换器（无参数，完全读配置文件）
if (require.main === module) {
    try {
        startTsToLuaConverter();
    }
    catch (error) {
        console.error('\n❌ 启动失败:', error.message);
        process.exit(1);
    }
}
