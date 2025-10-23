# TSeggy

## 项目简介
基于 Node.js 开发的 TypeScript-Lua 转换工具，通过 TypeScript 的强类型特性提升蛋仔编辑器脚本开发效率，自动转换为编辑器可直接使用的 Lua 代码，并提供完整的 TS 类型化 API 声明。提供ts基础类型方法支持。
CLI版本，更方便可用。

## 前置依赖
- **Node.js**：本项目使用Node.js环境。

## 快速开始
安装Node.js环境后：
1. 下载CLI：
```bash
npm install -g tseggy
```
2. 初始化项目:
```bash
tseggy init -i
```
3. 启动开发模式:
```bash
tseggy dev
```

你可以修改配置文件配置更多。



## 注意事项
1. 本项目目前仅支持 TypeScript 基本语法（变量、函数、类、接口等），暂不支持高级特性（如装饰器、异步、泛型复杂用法等）
2. 转换后的 Lua 代码需在蛋仔派对PC编辑器中测试，部分 API 调用需符合编辑器运行时规范
3. 类型声明基于现在API 整理，若后续 API 更新，你可以更新最新版本。
4. 更多请阅读使用说明.md

