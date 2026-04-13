# STM32 Debug Helper by RCIA战队电控组

<div align="center">

![Version](https://img.shields.io/badge/version-1.1.1-blue.svg)
![VSCode](https://img.shields.io/badge/VSCode-1.85.0+-green.svg)
![License](https://img.shields.io/badge/license-MIT-orange.svg)



**一个强大的 VSCode 扩展，用于 STM32 实时调试和变量监控，由RCIA战队电控组开发**

注意：使用VS Code来开发STM32的工具链一键安装配置脚本已经上传到 [Release](https://github.com/ZEALHT001/stm32-debug-helper/releases/tag/v1.0.0) 


[English](#english) | [中文](#中文)

</div>

---

## 中文

### 📖 简介

STM32 Debug Helper 是一个专为 STM32 开发设计的 VSCode 扩展，通过 OpenOCD 的 TCL RPC 接口实现与目标板的实时通信。它能够自动解析 ELF 文件中的调试信息，在 VSCode 中以树形结构展示全局变量，并支持实时读取和修改变量值。

### ✨ 核心功能

#### 🔍 变量监控
- **自动解析 ELF 文件**：自动提取全局变量的符号信息和类型信息
- **树形结构展示**：支持结构体、数组的层级展开，清晰展示复杂数据结构
- **实时刷新**：可配置的自动刷新机制（默认 500ms），实时监控变量变化
- **多类型支持**：支持整数、浮点数、字符串、数组、结构体等多种数据类型

#### ✏️ 变量操作
- **添加监控**：通过命令面板或界面按钮添加需要监控的变量
- **编辑变量**：双击或右键菜单直接修改变量值
- **重命名**：修改变量的显示名称或表达式
- **删除监控**：移除不再需要的监控变量

#### 🎯 智能特性
- **自动启动**：检测到 Cortex-Debug 调试会话时自动启动服务
- **ELF 路径自动检测**：自动查找 `build/*.elf` 文件
- **持久化存储**：监控的变量列表会保存在工作区配置中
- **批量读取优化**：使用 OpenOCD 的批量内存读取指令，提升性能

### 🛠️ 技术架构

```
┌─────────────────┐
│  VSCode 扩展     │  TypeScript
│  (前端 UI)       │
└────────┬────────┘
         │ JSON over stdin/stdout
┌────────▼────────┐
│  Python 服务器   │  Python 3
│  (业务逻辑)      │
└────────┬────────┘
         │ TCL RPC Protocol
┌────────▼────────┐
│    OpenOCD      │  端口: 50001
│  (调试接口)      │
└────────┬────────┘
         │ SWD/JTAG
┌────────▼────────┐
│   STM32 目标板   │
└─────────────────┘
```

### 📦 安装

#### 前置要求
- **VSCode** >= 1.85.0
- **Python** 3.8+ （如果使用 Python 模式）
- **OpenOCD** 已安装并运行
- **Cortex-Debug** 扩展（推荐）

#### 安装方式

**方式一：从 VSIX 文件安装**
1. 下载 `.vsix` 文件
2. 在 VSCode 中按 `Cmd+Shift+P`（Mac）或 `Ctrl+Shift+P`（Windows/Linux）
3. 输入 `Extensions: Install from VSIX...`
4. 选择下载的文件

**方式二：从源码编译**
```bash
# 克隆仓库
git clone https://github.com/ZEALHT001/stm32-debug-helper.git
cd stm32-debug-helper

# 安装依赖
npm install

# 编译
npm run compile

# 打包扩展
npx vsce package
```

### 🚀 快速开始

#### 1. 启动 OpenOCD

确保 OpenOCD 正在运行并启用了 TCL RPC 接口（默认端口 50001）：

```bash
openocd -f interface/stlink.cfg -f target/stm32f4x.cfg
```

#### 2. 启动调试会话

使用 Cortex-Debug 扩展启动调试会话，或在 VSCode 命令面板中执行：

```
STM32 Debug: Start Server
```

#### 3. 添加监控变量

- 点击面板工具栏的 `+` 按钮
- 或执行命令 `STM32 Debug: Add Variable`
- 输入变量名称（例如：`counter`、`myStruct.value`）

#### 4. 查看和修改变量

- **查看**：变量值会自动刷新显示
- **修改**：双击变量项或右键选择 "Edit Variable Value"
- **展开**：点击结构体或数组前的箭头展开子项

### ⚙️ 配置选项

在 VSCode 设置中搜索 `STM32 Debug Helper`，可以配置以下选项：

| 配置项 | 类型 | 默认值 | 说明 |
|--------|------|--------|------|
| `stm32DebugHelper.pythonPath` | string | `python3` | Python 解释器路径 |
| `stm32DebugHelper.elfPath` | string | `""` | ELF 文件路径（留空则自动检测） |
| `stm32DebugHelper.openocdHost` | string | `127.0.0.1` | OpenOCD TCL RPC 主机地址 |
| `stm32DebugHelper.openocdPort` | number | `50001` | OpenOCD TCL RPC 端口 |

### 📋 命令列表

所有命令都可以通过命令面板（`Cmd+Shift+P` / `Ctrl+Shift+P`）访问：

| 命令 | 说明 |
|------|------|
| `STM32 Debug: Start Server` | 启动调试服务器 |
| `STM32 Debug: Stop Server` | 停止调试服务器 |
| `STM32 Debug: Refresh Variables` | 刷新所有变量值 |
| `STM32 Debug: Add Variable` | 添加监控变量 |
| `STM32 Debug: Show Bottom Panel` | 显示底部面板 |

### 🔧 高级功能

#### 可执行文件模式

扩展支持将 Python 服务器打包为独立可执行文件，无需 Python 环境：

```bash
# 打包服务器
npm run package:server
```

生成的可执行文件位于 `bin/` 目录：
- Windows: `bin/server-windows.exe`
- macOS: `bin/server-macos`
- Linux: `bin/server-linux`

#### 数据类型支持

- **基本类型**：`int`, `uint8_t`, `uint16_t`, `uint32_t`, `int8_t`, `int16_t`, `int32_t`
- **浮点类型**：`float`, `double`
- **字符类型**：`char`, `char[]`（自动显示为字符串）
- **复合类型**：结构体、数组、指针

#### 性能优化

- 使用 OpenOCD 的 `mdw` 批量读取指令，一次读取多个连续内存地址
- 自动合并相邻变量的内存读取请求
- 后台定时刷新，不阻塞 UI 线程

### 🐛 故障排查

#### 服务器无法启动
- 检查 Python 是否正确安装：`python3 --version`
- 检查依赖是否安装：`pip install pyelftools`
- 查看 VSCode 输出面板的 "STM32 Debug Helper" 频道

#### 无法连接到 OpenOCD
- 确认 OpenOCD 正在运行：`telnet 127.0.0.1 50001`
- 检查端口配置是否正确
- 查看 OpenOCD 日志输出

#### 变量显示为 "N/A"
- 确认目标板处于暂停状态（调试断点）
- 检查变量地址是否正确
- 确认 ELF 文件与目标板程序匹配

### 📝 开发指南

#### 项目结构

```
stm32-debug-helper/
├── src/                    # TypeScript 源码
│   ├── extension.ts        # 扩展入口
│   ├── serverClient.ts     # 服务器客户端
│   ├── variableTreeDataProvider.ts  # 树形数据提供者
│   └── models/             # 数据模型
├── server.py               # Python 服务器
├── resources/              # 资源文件
│   ├── icon.svg           # 扩展图标
│   └── server.py          # 备用服务器脚本
├── build_server.py         # 打包脚本
└── package.json            # 扩展配置
```

#### 构建和测试

```bash
# 安装依赖
npm install

# 编译 TypeScript
npm run compile

# 打包 Python 服务器
python build_server.py

# 把打包后的 Python 服务器复制到bin目录
node copy-server.js

# 打包扩展
npx vsce package
```

### 🤝 贡献

欢迎提交 Issue 和 Pull Request！

1. Fork 本仓库
2. 创建特性分支：`git checkout -b feature/amazing-feature`
3. 提交更改：`git commit -m 'Add amazing feature'`
4. 推送分支：`git push origin feature/amazing-feature`
5. 提交 Pull Request

### 📄 许可证

本项目采用 MIT 许可证 - 详见 [LICENSE.md](LICENSE.md) 文件

### 🙏 致谢

- [pyelftools](https://github.com/eliben/pyelftools) - ELF 文件解析
- [OpenOCD](http://openocd.org/) - 片上调试工具
- [Cortex-Debug](https://github.com/Marus/cortex-debug) - ARM Cortex 调试扩展

---

## English

### 📖 Introduction

STM32 Debug Helper is a VSCode extension designed for STM32 development by RCIA战队电控组, enabling real-time communication with target boards through OpenOCD's TCL RPC interface. It automatically parses debug information from ELF files and displays global variables in a tree structure within VSCode, supporting real-time reading and modification of variable values.

### ✨ Core Features

#### 🔍 Variable Monitoring
- **Automatic ELF Parsing**: Extracts symbol and type information from global variables
- **Tree Structure Display**: Supports hierarchical expansion of structs and arrays
- **Real-time Refresh**: Configurable auto-refresh mechanism (default 500ms)
- **Multi-type Support**: Supports integers, floats, strings, arrays, structs, and more

#### ✏️ Variable Operations
- **Add Monitoring**: Add variables to watch via command palette or UI buttons
- **Edit Variables**: Modify variable values directly by double-clicking or context menu
- **Rename**: Change variable display names or expressions
- **Delete Monitoring**: Remove unwanted monitored variables

#### 🎯 Smart Features
- **Auto Start**: Automatically starts service when Cortex-Debug session detected
- **ELF Path Auto-detection**: Automatically finds `build/*.elf` files
- **Persistent Storage**: Monitored variable list saved in workspace configuration
- **Batch Read Optimization**: Uses OpenOCD's batch memory read commands for better performance

### 🛠️ Technical Architecture

```
┌─────────────────┐
│  VSCode Extension│  TypeScript
│  (Frontend UI)   │
└────────┬────────┘
         │ JSON over stdin/stdout
┌────────▼────────┐
│  Python Server  │  Python 3
│  (Business Logic)│
└────────┬────────┘
         │ TCL RPC Protocol
┌────────▼────────┐
│    OpenOCD      │  Port: 50001
│  (Debug Interface)│
└────────┬────────┘
         │ SWD/JTAG
┌────────▼────────┐
│   STM32 Target  │
└─────────────────┘
```

### 📦 Installation

#### Prerequisites
- **VSCode** >= 1.85.0
- **Python** 3.8+ (if using Python mode)
- **OpenOCD** installed and running
- **Cortex-Debug** extension (recommended)

#### Installation Methods

**Method 1: Install from VSIX file**
1. Download the `.vsix` file
2. In VSCode, press `Cmd+Shift+P` (Mac) or `Ctrl+Shift+P` (Windows/Linux)
3. Type `Extensions: Install from VSIX...`
4. Select the downloaded file

**Method 2: Build from source**
```bash
# Clone repository
git clone https://github.com/ZEALHT001/stm32-debug-helper.git
cd stm32-debug-helper

# Install dependencies
npm install

# Compile
npm run compile

# Package extension
npx vsce package
```

### 🚀 Quick Start

#### 1. Start OpenOCD

Ensure OpenOCD is running with TCL RPC interface enabled (default port 50001):

```bash
openocd -f interface/stlink.cfg -f target/stm32f4x.cfg
```

#### 2. Start Debug Session

Start a debug session using Cortex-Debug extension, or execute in VSCode command palette:

```
STM32 Debug: Start Server
```

#### 3. Add Variables to Watch

- Click the `+` button in the panel toolbar
- Or execute command `STM32 Debug: Add Variable`
- Enter variable name (e.g., `counter`, `myStruct.value`)

#### 4. View and Modify Variables

- **View**: Variable values refresh automatically
- **Modify**: Double-click variable item or right-click and select "Edit Variable Value"
- **Expand**: Click arrow before struct or array to expand children

### ⚙️ Configuration

Search for `STM32 Debug Helper` in VSCode settings to configure:

| Setting | Type | Default | Description |
|---------|------|---------|-------------|
| `stm32DebugHelper.pythonPath` | string | `python3` | Python interpreter path |
| `stm32DebugHelper.elfPath` | string | `""` | ELF file path (auto-detect if empty) |
| `stm32DebugHelper.openocdHost` | string | `127.0.0.1` | OpenOCD TCL RPC host address |
| `stm32DebugHelper.openocdPort` | number | `50001` | OpenOCD TCL RPC port |

### 📋 Commands

All commands accessible via command palette (`Cmd+Shift+P` / `Ctrl+Shift+P`):

| Command | Description |
|---------|-------------|
| `STM32 Debug: Start Server` | Start debug server |
| `STM32 Debug: Stop Server` | Stop debug server |
| `STM32 Debug: Refresh Variables` | Refresh all variable values |
| `STM32 Debug: Add Variable` | Add variable to watch |
| `STM32 Debug: Show Bottom Panel` | Show bottom panel |

### 🔧 Advanced Features

#### Executable Mode

The extension supports packaging the Python server as a standalone executable, eliminating the need for Python:

```bash
# Package server
npm run package:server
```

Generated executables located in `bin/` directory:
- Windows: `bin/server-windows.exe`
- macOS: `bin/server-macos`
- Linux: `bin/server-linux`

#### Supported Data Types

- **Basic types**: `int`, `uint8_t`, `uint16_t`, `uint32_t`, `int8_t`, `int16_t`, `int32_t`
- **Floating types**: `float`, `double`
- **Character types**: `char`, `char[]` (automatically displayed as string)
- **Composite types**: structs, arrays, pointers

#### Performance Optimization

- Uses OpenOCD's `mdw` batch read command to read multiple consecutive memory addresses at once
- Automatically merges memory read requests for adjacent variables
- Background periodic refresh without blocking UI thread

### 🐛 Troubleshooting

#### Server fails to start
- Check Python installation: `python3 --version`
- Check dependencies: `pip install pyelftools`
- View "STM32 Debug Helper" channel in VSCode output panel

#### Cannot connect to OpenOCD
- Confirm OpenOCD is running: `telnet 127.0.0.1 50001`
- Check port configuration
- View OpenOCD log output

#### Variables show as "N/A"
- Confirm target board is halted (debug breakpoint)
- Check variable address correctness
- Confirm ELF file matches target board program

### 📝 Development Guide

#### Project Structure

```
stm32-debug-helper/
├── src/                    # TypeScript source
│   ├── extension.ts        # Extension entry
│   ├── serverClient.ts     # Server client
│   ├── variableTreeDataProvider.ts  # Tree data provider
│   └── models/             # Data models
├── server.py               # Python server
├── resources/              # Resource files
│   ├── icon.svg           # Extension icon
│   └── server.py          # Backup server script
├── build_server.py         # Build script
└── package.json            # Extension configuration
```

#### Build and Test

```bash
# Install dependencies
npm install

# Compile TypeScript
npm run compile

# Package Python server
python build_server.py

# Copy packaged Python server to bin directory
node copy-server.js

# Package extension
npx vsce package
```

### 🤝 Contributing

Issues and Pull Requests are welcome!

1. Fork this repository
2. Create feature branch: `git checkout -b feature/amazing-feature`
3. Commit changes: `git commit -m 'Add amazing feature'`
4. Push branch: `git push origin feature/amazing-feature`
5. Submit Pull Request

### 📄 License

This project is licensed under the MIT License - see [LICENSE.md](LICENSE.md) file

### 🙏 Acknowledgments

- [pyelftools](https://github.com/eliben/pyelftools) - ELF file parsing
- [OpenOCD](http://openocd.org/) - On-chip debugging tool
- [Cortex-Debug](https://github.com/Marus/cortex-debug) - ARM Cortex debug extension

---

<div align="center">

**Made with ❤️ by ZEALHT001**

</div>
