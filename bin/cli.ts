#!/usr/bin/env node
import { Command } from 'commander';
import { startTsToLuaConverter, PartialConfig } from '../src/start';
import { version } from '../package.json';
// 新增：引入文件操作和交互依赖
import fse from 'fs-extra';
import inquirer from 'inquirer';
import path from 'path';

const program = new Command();
program.name('tseggy').description('蛋仔PC编辑器Typescript支持-CLI版本').version(version).usage('<command> [options]');

// ------------------------------
// 新增：init 命令实现
// ------------------------------
async function copyTemplateFile(
  srcPath: string,        // 模板文件源路径
  destPath: string,       // 目标路径（工作目录）
  force: boolean,         // 是否强制覆盖
  includeMd: boolean      // 是否包含 MD 文件
) {
  // 1. 过滤 MD 文件（默认不包含，--i 时包含）
  const isMdFile = path.extname(srcPath).toLowerCase() === '.md';
  if (!includeMd && isMdFile) {
    // console.log(`🔍 跳过 MD 文件：${path.basename(srcPath)}`);
    return;
  }

  // 2. 检查目标文件是否已存在
  const destExists = await fse.pathExists(destPath);
  if (destExists) {
    if (force) {
    //   console.log(`⚠️  强制覆盖已存在文件：${path.basename(srcPath)}`);
      await fse.copy(srcPath, destPath, { overwrite: true });
      return;
    }
    // 3. 交互询问是否覆盖
    const { overwrite } = await inquirer.prompt([
      {
        type: 'confirm',
        name: 'overwrite',
        message: `文件 "${path.basename(srcPath)}" 已存在，是否覆盖？`,
        default: false
      }
    ]);
    if (!overwrite) {
      console.log(`🚫 跳过文件：${path.basename(srcPath)}`);
      return;
    }
  }

  // 4. 复制文件（递归创建目标目录）
  await fse.copy(srcPath, destPath, { overwrite: true });
//   console.log(`✅ 复制成功：${path.basename(srcPath)} → ${destPath}`);
}

async function initTemplate(force: boolean, includeMd: boolean) {
  // 定位 CLI 自身的 templates 目录（需确保 CLI 项目根目录有 templates 文件夹）
  const templateRoot = path.resolve(__dirname, '../templates');
  // 检查 templates 目录是否存在
  if (!await fse.pathExists(templateRoot)) {
    throw new Error(`CLI 模板目录缺失：${templateRoot}\n请确认 CLI 项目中存在 templates 目录`);
  }

//   console.log(`\n📂 开始复制模板到当前工作目录：${process.cwd()}`);
//   console.log(`📌 包含 MD 文件：${includeMd ? '是' : '否'} | 强制覆盖：${force ? '是' : '否'}\n`);

  // 遍历 templates 目录下所有文件/子目录
  const files = await fse.readdir(templateRoot);
  for (const file of files) {
    const srcPath = path.join(templateRoot, file);
    const destPath = path.join(process.cwd(), file);
    const stat = await fse.lstat(srcPath);

    if (stat.isDirectory()) {
      // 处理子目录：递归复制（同样应用 MD 过滤和覆盖规则）
      await fse.ensureDir(destPath); // 确保目标目录存在
      const subFiles = await fse.readdir(srcPath);
      for (const subFile of subFiles) {
        await copyTemplateFile(
          path.join(srcPath, subFile),
          path.join(destPath, subFile),
          force,
          includeMd
        );
      }
    } else {
      // 处理单个文件
      await copyTemplateFile(srcPath, destPath, force, includeMd);
    }
  }

  console.log(`\n操作完成！展开src目录开始编写吧！`);
  if (!includeMd) {
    console.log(`💡 提示：若需包含 README.md 等说明文件，可重新执行 \`tseggy init -i\``);
  }
}

// 注册 init 命令
program
  .command('init')
  .description('初始化项目到当前工作目录（默认不包含 MD 文件）')
  .option('-f, --force', '强制覆盖已存在文件（不询问）', false)
  .option('-i', '包含 MD 说明文件（如 README.md、使用说明.md）', false)
  .action(async (options) => {
    try {
      await initTemplate(options.force, options.i);
    } catch (error) {
      console.error('\n❌ 初始化失败：', (error as Error).message);
      process.exit(1);
    }
  });

// ------------------------------
// 原有 dev 命令（保持不变）
// ------------------------------
program
  .command('dev')
  .description('开发模式：监听 TS 文件变化并自动转 Lua')
  .option('-i, --input <path>', '自定义 TS 输入目录（覆盖 config.json）')
  .option('-o, --output <path>', '自定义 Lua 输出目录（覆盖 config.json）')
  .action(async (options) => {
    try {
      const partialConfig: PartialConfig = {};
      if (options.input) partialConfig.inputDir = options.input;
      if (options.output) partialConfig.outputDir = options.output;
      const converter = startTsToLuaConverter(partialConfig);

      const handleExit = async () => {
        console.log('\n🛑 停止开发模式...');
        await converter.close();
        process.exit(0);
      };
      process.on('SIGINT', handleExit);
      process.on('SIGTERM', handleExit);
    } catch (error) {
      console.error('\n❌ 开发模式启动失败：', (error as Error).message);
      process.exit(1);
    }
  });

// 解析命令
program.parse(process.argv);
if (!process.argv.slice(2).length) program.outputHelp();