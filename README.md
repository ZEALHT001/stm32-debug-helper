# STM32 Debug Helper

一个用于STM32调试的VSCode扩展，提供类似调试器的变量视图界面。

## 功能特性

- ✅ 可折叠的变量树视图
- ✅ 显示变量类型、地址、大小和值
- ✅ 自动读取变量值
- ✅ 支持结构体嵌套展开
- ✅ 刷新变量功能
- ✅ 与Python后端服务器通信

## 使用方法

### 1. 启动调试服务器

1. 按 `Cmd+Shift+P` 打开命令面板
2. 输入 "STM32 Debug: Start Server"
3. 选择ELF文件（如果尚未配置）
4. 服务器将自动启动并连接到OpenOCD

### 2. 查看变量

启动服务器后，在左侧活动栏点击STM32 Debug图标，即可看到变量视图。

- 点击变量前的箭头可以展开/折叠结构体
- 变量会显示类型、值和地址信息
- 鼠标悬停在变量上可以看到详细信息

### 3. 刷新变量

点击变量视图标题栏的刷新按钮，可以重新读取所有变量的值。

## 配置选项

在VSCode设置中搜索 "STM32 Debug Helper" 可以配置：

- `stm32DebugHelper.pythonPath`: Python解释器路径（默认：python3）
- `stm32DebugHelper.elfPath`: ELF文件路径
- `stm32DebugHelper.openocdHost`: OpenOCD TCL RPC主机地址（默认：127.0.0.1）
- `stm32DebugHelper.openocdPort`: OpenOCD TCL RPC端口（默认：50001）

## 前置要求

1. **OpenOCD**: 需要运行OpenOCD并启用TCL RPC接口
   ```bash
   openocd -f interface/stlink.cfg -f target/stm32f4x.cfg -c "tcl_port 50001"
   ```

2. **Python环境**: 需要Python 3和以下依赖
   ```bash
   pip install pyelftools
   ```

3. **ELF文件**: 需要编译生成的ELF文件

## 项目结构

```
vscode-stm32debughelper/
├── src/
│   ├── extension.ts              # 扩展入口
│   ├── serverClient.ts           # 服务器通信客户端
│   ├── variableTreeDataProvider.ts # 变量树数据提供者
│   └── models/
│       └── variable.ts           # 变量数据模型
├── resources/
│   └── icon.svg                  # 扩展图标
├── server.py                     # Python后端服务器
└── package.json                  # 扩展配置
```

## 开发和调试

1. 克隆仓库
2. 运行 `npm install` 安装依赖
3. 在VSCode中打开项目
4. 按 `F5` 启动调试

## 已知问题

- 目前只支持读取变量值，暂不支持修改变量值
- 需要确保OpenOCD的TCL RPC端口已开启

## 发布说明

### 0.0.1

初始版本：
- 基本的变量树视图
- 支持折叠展开
- 显示变量详细信息
- 与Python服务器通信
