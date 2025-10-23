import fs from 'fs';
import path from 'path';
import chokidar from 'chokidar';
import { TsToLuaConverter, BasicTypeMethods } from './converter';
import ts from 'typescript';

// 1. 基础配置类型（从config.json读取的完整结构）
export interface FullConfig {
  inputDir: string;
  outputDir: string;
  reserved_methods: BasicTypeMethods;
  use_ts_basic_methods: boolean;
}

// 2. 可选参数类型（仅允许传入inputDir/outputDir，用于覆盖配置文件）
export interface PartialConfig {
  inputDir?: string;
  outputDir?: string;
}

// 忽略隐藏文件（如 .gitignore、.DS_Store 等）
const IGNORED_FILES = /(^|[\/\\])\../;

/**
 * 加载配置文件（从项目根目录的 config.json 读取完整配置）
 * @returns 解析后的完整配置对象
 * @throws 加载失败时抛出错误
 */
function loadFullConfig(): FullConfig {
  try {
    const configPath = path.join(process.cwd(), './config.json');
    const rawData = fs.readFileSync(configPath, 'utf-8');
    const config = JSON.parse(rawData) as FullConfig;

    // 校验配置文件必填字段（避免配置缺失导致后续错误）
    const requiredFields: (keyof FullConfig)[] = ['inputDir', 'outputDir', 'reserved_methods', 'use_ts_basic_methods'];
    const missingFields = requiredFields.filter(field => !(field in config));
    if (missingFields.length > 0) {
      throw new Error(`config.json 缺少必填字段: ${missingFields.join(', ')}`);
    }

    return config;
  } catch (error) {
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
function resolvePath(userPath: string, baseDir?: string): string {
  if (path.isAbsolute(userPath)) return userPath;
  const base = baseDir || process.cwd();
  return path.resolve(base, userPath);
}

/**
 * TS 转 Lua 转换器的主函数
 * @param partialConfig 可选参数（仅支持inputDir/outputDir，用于覆盖配置文件中的同名字段）
 * @returns 包含关闭方法的对象（用于手动停止监听、释放资源）
 */
export function startTsToLuaConverter(partialConfig?: PartialConfig) {
  // 1. 加载完整配置 + 合并可选参数（inputDir/outputDir优先用传入值，其余用配置文件）
  const fullConfig = loadFullConfig();
  const mergedConfig: FullConfig = {
    ...fullConfig, // 基础配置：reserved_methods、use_ts_basic_methods 等从文件读取
    inputDir: partialConfig?.inputDir || fullConfig.inputDir, // 覆盖规则：传入优先
    outputDir: partialConfig?.outputDir || fullConfig.outputDir
  };

  // 2. 解析最终的输入/输出路径（确保绝对路径）
  const inDir = resolvePath(mergedConfig.inputDir);
  const outDir = resolvePath(mergedConfig.outputDir);

  // 3. 校验输入目录是否存在（避免监听不存在的目录）
  if (!fs.existsSync(inDir)) {
    throw new Error(`输入目录不存在: ${inDir}（请检查 config.json 或传入的 inputDir 参数）`);
  }

  // 4. 确保输出目录存在
  if (!fs.existsSync(outDir)) {
    fs.mkdirSync(outDir, { recursive: true });
    console.log(`📂 创建输出目录: ${outDir}`);
  }

  // 5. 创建 TS 转 Lua 转换器实例（其余配置仍用文件中的值）
  const converter = new TsToLuaConverter(
    mergedConfig.use_ts_basic_methods ? mergedConfig.reserved_methods : {}
  );

  // 6. 内部工具函数：转换单个 TS 文件
  const convertFile = (filePath: string) => {
    const fileName = path.basename(filePath);
    if (path.extname(fileName) !== '.ts' || IGNORED_FILES.test(fileName)) return;

    const luaFileName = fileName.replace('.ts', '.lua');
    const outputPath = path.join(outDir, luaFileName);

    try {
      const sourceCode = fs.readFileSync(filePath, 'utf-8');
      const sourceFile = ts.createSourceFile(
        fileName,
        sourceCode,
        ts.ScriptTarget.Latest,
        true
      );

      const luaCode = converter.convert(sourceFile);
      fs.writeFileSync(outputPath, luaCode);
      console.log(`➡️  已转换: ${fileName} → ${luaFileName}`);
    } catch (error) {
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
      const files = fs.readdirSync(inDir);
      files.forEach(file => {
        if (path.extname(file) === '.ts' && !IGNORED_FILES.test(file)) {
          convertFile(path.join(inDir, file));
          convertedCount++;
        }
      });
      console.log(`✅ 初始转换完成！共转换 ${convertedCount} 个文件`);
    } catch (error) {
      const errorMsg = error instanceof Error 
        ? error.message 
        : '读取输入目录失败';
      console.error(`❌ 初始转换出错:`, errorMsg);
    }
  };

  // 8. 内部工具函数：确保 tsbasic.lua 存在（use_ts_basic_methods 从配置文件读取）
  const ensureTsBasicLuaExists = () => {
    const workDir = __dirname
    const srcFile = path.join(workDir, 'src', 'tslib', 'tsbasic.lua');
    const destFile = path.join(outDir, 'tsbasic.lua');

    try {
      if (fs.existsSync(destFile)) return; // 目标文件已存在，跳过

      if (!fs.existsSync(srcFile)) {
        throw new Error(`TS 基础支持文件不存在: ${srcFile}`);
      }

      fs.copyFileSync(srcFile, destFile);
      console.log(`📄 复制 TS 基础支持文件: ${srcFile} → ${destFile}`);
    } catch (error) {
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
  const watcher = chokidar.watch(inDir, {
    ignored: IGNORED_FILES,
    persistent: true,
    ignoreInitial: true, // 忽略初始扫描（初始转换已单独处理）
  });

  // 11. 注册文件监听事件
  watcher
    .on('add', (filePath) => {
      console.log(`❕ 检测到新文件: ${path.basename(filePath)}`);
      convertFile(filePath);
    })
    .on('change', (filePath) => {
      console.log(`💻 文件已修改: ${path.basename(filePath)}`);
      convertFile(filePath);
    })
    .on('unlink', (filePath) => {
      const fileName = path.basename(filePath);
      if (path.extname(fileName) !== '.ts') return;

      const luaFileName = fileName.replace('.ts', '.lua');
      const outputPath = path.join(outDir, luaFileName);

      if (fs.existsSync(outputPath)) {
        fs.unlinkSync(outputPath);
        console.log(`❌ 已删除: ${luaFileName}（源 TS 文件已移除）`);
      }
    })
    .on('error', (error:any) => {
      console.error(`❌ 文件监听出错:`, error.message);
    });

  // 12. 注册进程优雅退出事件（停止监听、释放资源）
  const handleExit = async () => {
    console.log('\n⚙️  正在停止转换器...');
    await watcher.close();
    console.log('👋 转换器已停止');
  };

  process.on('SIGINT', handleExit); // Ctrl+C 触发
  process.on('SIGTERM', handleExit); // 进程终止信号触发

  // 13. 打印配置信息（让用户明确当前使用的配置）
  console.log(`\n📋 当前生效配置:`);
  console.log(`- 输入目录: ${inDir}（${partialConfig?.inputDir ? '来自参数' : '来自 config.json'}）`);
  console.log(`- 输出目录: ${outDir}（${partialConfig?.outputDir ? '来自参数' : '来自 config.json'}）`);
  console.log(`- TS 基础方法支持: ${mergedConfig.use_ts_basic_methods ? '启用' : '禁用'}（来自 config.json）`);

  // 14. 执行初始转换
  convertAllFiles();
  console.log(`\n⚙️  转换器已启动！监听目录: ${inDir}`);
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
      console.log('🔌 手动停止转换器：资源已释放');
    },
    /**
     * 获取当前生效的完整配置（方便外部调试）
     * @returns 合并后的完整配置
     */
    getCurrentConfig: (): FullConfig => ({ ...mergedConfig }) // 返回深拷贝，避免外部修改内部配置
  };
}

// 若直接运行当前文件（而非被导入），则启动转换器（无参数，完全读配置文件）
if (require.main === module) {
  try {
    startTsToLuaConverter();
  } catch (error) {
    console.error('\n❌ 启动失败:', (error as Error).message);
    process.exit(1);
  }
}