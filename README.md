# STM32 Debug Helper

一个功能强大的 VS Code 扩展，为 STM32 开发者提供类似专业调试器的变量视图界面。

## 🚀 功能特性

### 核心功能
- ✅ 可折叠的变量树视图
- ✅ 显示变量类型、地址、大小和值
- ✅ 自动读取变量值
- ✅ 支持结构体嵌套展开
- ✅ 实时刷新变量功能
- ✅ 与 OpenOCD 实时通信
- ✅ 支持 Windows（macOS、Linux待发布）


### 技术特点
- 🎯 基于 TypeScript 开发的 VS Code 扩展
- 🔄 内置 Python 后端服务器（已打包为可执行文件）
- 📡 与 OpenOCD TCL RPC 接口通信
- 📦 自动识别平台并使用对应可执行文件
- 🔧 提供配置选项，支持自定义 OpenOCD 连接参数

## 📥 安装方法

### 方法 1：从 VS Code Marketplace 安装（推荐）
1. 在 VS Code 中打开扩展面板
2. 搜索 "STM32 Debug Helper"
3. 点击 "安装" 按钮

### 方法 2：从 VSIX 文件安装
1. 下载最新的 `.vsix` 文件
2. 在 VS Code 中：扩展 → ... → 从 VSIX 安装
3. 选择下载的 `.vsix` 文件

## 🛠️ 使用方法

### 1. 准备工作

#### 安装 OpenOCD
```bash
# Windows
download OpenOCD from https://github.com/openocd-org/openocd/releases

# macOS
brew install openocd

# Linux
sudo apt-get install openocd
```

#### 启动 OpenOCD（带 TCL RPC 接口）
```bash
# 以 STM32F4 为例
openocd -f interface/stlink.cfg -f target/stm32f4x.cfg -c "tcl_port 50001"
```

### 2. 启动调试服务器

1. 按 `Ctrl+Shift+P` 打开命令面板
2. 输入 "STM32 Debug: Start Server"
3. 选择 ELF 文件（如果尚未配置）
4. 服务器将自动启动并连接到 OpenOCD

### 3. 查看变量

启动服务器后，在左侧活动栏点击 STM32 Debug 图标，即可看到变量视图：

- 点击变量前的箭头可以展开/折叠结构体
- 变量会显示类型、值和地址信息
- 鼠标悬停在变量上可以看到详细信息

### 4. 刷新变量

点击变量视图标题栏的刷新按钮，可以重新读取所有变量的值。

## ⚙️ 配置选项

在 VS Code 设置中搜索 "STM32 Debug Helper" 可以配置：

| 配置项 | 默认值 | 描述 |
|-------|-------|------|
| `stm32DebugHelper.pythonPath` | `python3` | Python 解释器路径（仅在可执行文件不可用时使用） |
| `stm32DebugHelper.elfPath` | `""` | ELF 文件路径 |
| `stm32DebugHelper.openocdHost` | `127.0.0.1` | OpenOCD TCL RPC 主机地址 |
| `stm32DebugHelper.openocdPort` | `50001` | OpenOCD TCL RPC 端口 |

## 📁 项目结构

```
stm32debughelper/
├── src/                    # TypeScript 源代码
│   ├── extension.ts        # 扩展入口
│   ├── serverClient.ts     # 服务器通信客户端
│   ├── variableTreeDataProvider.ts # 变量树数据提供者
│   └── models/
│       └── variable.ts     # 变量数据模型
├── out/                    # 编译输出目录
│   └── bin/                # 打包的可执行文件
├── bin/                    # 构建输出目录
├── resources/              # 资源文件
│   └── icon.svg            # 扩展图标
├── server.py               # Python 后端服务器
├── build_server.py         # 打包脚本
├── copy-server.js          # 复制脚本
└── package.json            # 扩展配置
```

## 🛠️ 开发指南

### 环境准备

1. 克隆仓库
2. 安装依赖：
   ```bash
   npm install
   pip install pyelftools
   ```

### 构建流程

1. **编译 TypeScript**：
   ```bash
   npm run compile
   ```

2. **打包服务器**：
   ```bash
   # 为当前平台打包
   python3 build_server.py
   
   # 或使用 npm 脚本
   npm run package:server
   ```

3. **复制可执行文件**：
   ```bash
   node copy-server.js
   ```

4. **测试扩展**：
   在 VS Code 中按 `F5` 启动调试

### 多平台支持

要为所有平台构建可执行文件：

1. **Windows**：在 Windows 环境中运行 `build_server.py`
2. **macOS**：在 macOS 环境中运行 `build_server.py`
3. **Linux**：在 Linux 环境中运行 `build_server.py`

## 🔍 技术原理

### 工作流程

1. **扩展启动**：VS Code 加载扩展并注册命令
2. **服务器启动**：用户执行 "Start Server" 命令
3. **可执行文件检测**：自动查找对应平台的可执行文件
4. **通信建立**：扩展与服务器建立 JSON 通信
5. **变量解析**：服务器解析 ELF 文件，提取变量信息
6. **数据读取**：服务器通过 OpenOCD 读取变量值
7. **视图更新**：扩展更新变量树视图

### 通信协议

扩展与服务器之间使用基于 JSON 的通信协议：

```json
// 请求
{"command": "read_paths", "paths": ["var1", "var2"]}

// 响应
{"ok": true, "result": [{"path": "var1", "value": 42, "address": "0x20000000"}]}
```

## ❓ 常见问题

### 1. 服务器启动失败

**解决方法**：
- 确保 OpenOCD 正在运行且启用了 TCL RPC 接口
- 检查 OpenOCD 配置是否正确
- 确认 ELF 文件路径是否正确

### 2. 变量显示为 "N/A"

**解决方法**：
- 确保目标设备已连接并正在运行
- 检查 OpenOCD 连接状态
- 验证变量地址是否有效

### 3. 可执行文件未找到

**解决方法**：
- 确保已为对应平台构建了可执行文件
- 检查 `bin` 目录是否包含正确的可执行文件
- 扩展会自动回退到使用 Python（需要安装 `pyelftools`）

## 📄 许可证

MIT License

## 🤝 贡献

欢迎提交 Issue 和 Pull Request！

## 📞 支持

如果遇到问题，请在 GitHub 仓库中提交 Issue。

---

**版本**: 0.0.1
**作者**: Your Name
**更新日期**: 2026-04-08