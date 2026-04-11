import * as vscode from 'vscode';
import { VariableInfo } from './models/variable';
import { ServerClient } from './serverClient';

const WATCHED_VARIABLES_KEY = 'stm32DebugHelper.watchedVariables';

export class VariableTreeItem extends vscode.TreeItem {
    constructor(
        public readonly variableInfo: VariableInfo,
        public readonly collapsibleState: vscode.TreeItemCollapsibleState,
        public readonly isRoot: boolean,
        public readonly value?: any
    ) {
        super(variableInfo.name, collapsibleState);

        this.description = this.buildDescription();
        this.tooltip = this.buildTooltip();
        this.contextValue = this.buildContextValue();

        // 图标优化：结构体/数组使用文件夹/模块图标，普通变量使用变量图标
        if (variableInfo.hasChildren) {
            this.iconPath = new vscode.ThemeIcon('symbol-class');
        } else if (variableInfo.type === 'string') {
            this.iconPath = new vscode.ThemeIcon('symbol-string');
        } else {
            this.iconPath = new vscode.ThemeIcon('symbol-variable');
        }
    }

    private buildDescription(): string {
        const parts: string[] = [];

        // 1. 值的显示逻辑优化
        if (this.variableInfo.hasChildren) {
            // 结构体或数组，显示占位符而不是空白
            parts.push(this.variableInfo.type === 'array' ? '[...]' : '{...}');
        } else if (this.value !== undefined && this.value !== null) {
            // 如果是字符串类型，加上双引号以示区分
            if (this.variableInfo.type === 'string') {
                parts.push(`= "${this.value}"`);
            } else {
                parts.push(`= ${this.value}`);
            }
        } else {
            // 没有获取到值时的占位符
            parts.push('= ?');
        }

        // 2. 追加类型信息
        if (this.variableInfo.typeName) {
            parts.push(this.variableInfo.typeName);
        }
        
        return parts.join(' | ');
    }

    private buildTooltip(): vscode.MarkdownString {
        const md = new vscode.MarkdownString();
        md.appendMarkdown(`**${this.variableInfo.name}**\n\n`);
        md.appendMarkdown(`- **Path:** \`${this.variableInfo.path}\`\n`);
        md.appendMarkdown(`- **Type:** \`${this.variableInfo.typeName || this.variableInfo.type}\`\n`);
        md.appendMarkdown(`- **Address:** \`${this.variableInfo.address}\`\n`);
        md.appendMarkdown(`- **Size:** \`${this.variableInfo.size} bytes\`\n`);
        
        if (this.value !== undefined) {
            md.appendMarkdown(`- **Value:** \`${this.value}\`\n`);
        }
        return md;
    }

    private buildContextValue(): string {
        // 区分是否有子节点，用于控制右键菜单（比如禁止对结构体直接修改值）
        if (this.isRoot) {
            return this.variableInfo.hasChildren ? 'rootVariableWithChildren' : 'rootVariable';
        }
        return this.variableInfo.hasChildren ? 'variableWithChildren' : 'variable';
    }
}

export class WaitingTreeItem extends vscode.TreeItem {
    constructor() {
        super('Waiting for debug session...', vscode.TreeItemCollapsibleState.None);
        this.iconPath = new vscode.ThemeIcon('debug-pause');
        this.contextValue = 'waitingForDebugSession';
    }
}

export class AddVariableTreeItem extends vscode.TreeItem {
    constructor() {
        super('+ Add Variable to Watch', vscode.TreeItemCollapsibleState.None);
        this.iconPath = new vscode.ThemeIcon('add');
        this.contextValue = 'addVariable';
        this.command = {
            command: 'stm32-debug-helper.addVariable',
            title: 'Add Variable'
        };
    }
}

export class VariableTreeDataProvider implements vscode.TreeDataProvider<vscode.TreeItem> {
    private _onDidChangeTreeData: vscode.EventEmitter<vscode.TreeItem | undefined | null | void> = new vscode.EventEmitter<vscode.TreeItem | undefined | null | void>();
    readonly onDidChangeTreeData: vscode.Event<vscode.TreeItem | undefined | null | void> = this._onDidChangeTreeData.event;

    private rootVariables: VariableInfo[] = [];
    private allVariables: Map<string, VariableInfo> = new Map();
    private valueCache: Map<string, any> = new Map();
    
    private refreshTimer: NodeJS.Timeout | null = null;
    private refreshInterval = 500; // 500ms 刷新率，嵌入式设备建议不要低于此值
    private isRefreshing = false;

    constructor(
        private serverClient: ServerClient,
        private workspaceState: vscode.Memento
    ) {}

    refresh(): void {
        this._onDidChangeTreeData.fire();
    }

    clearValueCache(): void {
        this.valueCache.clear();
        this.refresh();
    }

    startAutoRefresh(): void {
        this.stopAutoRefresh();
        this.refreshTimer = setInterval(() => {
            void this.refreshValues();
        }, this.refreshInterval);
    }

    stopAutoRefresh(): void {
        if (this.refreshTimer) {
            clearInterval(this.refreshTimer);
            this.refreshTimer = null;
        }
    }

    /**
     * 核心优化：后台定时刷新变量值
     */
    private async refreshValues(): Promise<void> {
        if (this.isRefreshing || !this.serverClient.isRunning() || this.allVariables.size === 0) {
            return;
        }

        this.isRefreshing = true;

        try {
            // 【关键修复 1】：严格过滤！只读取非结构体/非数组的叶子节点
            // 避免将 `sys_master.main_sensor.accel` 这种结构体路径发给后端导致后端跳过
            const pathsToRead: string[] = [];
            for (const [path, variable] of this.allVariables) {
                if (!variable.hasChildren) {
                    pathsToRead.push(path);
                }
            }

            if (pathsToRead.length > 0) {
                const results = await this.serverClient.readPaths(pathsToRead);
                let hasChanges = false;

                for (const result of results) {
                    const previousValue = this.valueCache.get(result.path);
                    if (previousValue !== result.value) {
                        hasChanges = true;
                    }
                    this.valueCache.set(result.path, result.value);
                }

                // 【优化】：只有当数值真正发生变化时，才触发 UI 重绘，极大降低 CPU 占用
                if (hasChanges) {
                    this.refresh();
                }
            }
        } catch (error) {
            console.warn('Auto-refresh failed:', error);
            // 可以在此处添加状态栏提示，不要使用弹窗打扰用户
        } finally {
            this.isRefreshing = false;
        }
    }

    private registerVariables(variables: VariableInfo[]): void {
        for (const variable of variables) {
            this.allVariables.set(variable.path, variable);
        }
    }

    private rebuildVariableIndex(): void {
        this.allVariables.clear();
        this.registerVariables(this.rootVariables);
    }

    private getWatchedPaths(): string[] {
        return this.rootVariables.map(variable => variable.path);
    }

    private async persistWatchedPaths(): Promise<void> {
        await this.workspaceState.update(WATCHED_VARIABLES_KEY, this.getWatchedPaths());
    }

    private isRootVariablePath(path: string): boolean {
        return this.rootVariables.some(variable => variable.path === path);
    }

    async loadRootVariables(): Promise<void> {
        const watchedPaths = this.workspaceState.get<string[]>(WATCHED_VARIABLES_KEY, []);
        this.rootVariables = [];
        this.allVariables.clear();
        this.valueCache.clear();

        for (const path of watchedPaths) {
            try {
                const variableInfo = await this.serverClient.describe(path);
                if (variableInfo) {
                    this.rootVariables.push(variableInfo);
                    this.registerVariables([variableInfo]);
                }
            } catch {
                console.warn(`Failed to restore watched variable: ${path}`);
            }
        }

        if (this.rootVariables.length > 0) {
            this.startAutoRefresh();
        } else {
            this.stopAutoRefresh();
        }

        this.refresh();
    }

    async addVariable(path: string): Promise<void> {
        const normalizedPath = path.trim();
        if (!normalizedPath) return;

        if (this.isRootVariablePath(normalizedPath)) {
            vscode.window.showInformationMessage(`Variable already being watched: ${normalizedPath}`);
            return;
        }

        try {
            const variableInfo = await this.serverClient.describe(normalizedPath);
            if (variableInfo) {
                this.rootVariables.push(variableInfo);
                this.registerVariables([variableInfo]);
                await this.persistWatchedPaths();
                
                // 添加成功后如果还没有启动刷新，则启动
                if (!this.refreshTimer) {
                    this.startAutoRefresh();
                }
                this.refresh();
            }
        } catch (error) {
            vscode.window.showErrorMessage(`Failed to add variable: ${error}`);
        }
    }

    async editVariableValue(item: VariableTreeItem): Promise<void> {
        // 【安全检查】：禁止编辑结构体或数组容器本身
        if (item.variableInfo.hasChildren) {
            vscode.window.showWarningMessage('Cannot directly edit a structure or array. Please edit its members.');
            return;
        }

        const currentValue = this.valueCache.get(item.variableInfo.path);
        const input = await vscode.window.showInputBox({
            placeHolder: 'e.g., 42, 0x2A, 3.14',
            prompt: `Set new value for ${item.variableInfo.path}`,
            value: currentValue !== undefined ? String(currentValue) : ''
        });

        if (input === undefined || input.trim() === '') return;

        try {
            await this.serverClient.writeValue(item.variableInfo.path, input.trim());
            // 乐观更新 UI
            this.valueCache.set(item.variableInfo.path, input.trim());
            this.refresh();
            
            // 稍微延迟后主动刷新一次确保底层真正写入成功
            setTimeout(() => {
                void this.refreshValues();
            }, 200);
        } catch (error) {
            vscode.window.showErrorMessage(`Write failed for ${item.variableInfo.path}: ${error}`);
        }
    }

    async renameVariable(item: VariableTreeItem): Promise<void> {
        if (!item.isRoot) {
            vscode.window.showInformationMessage('Only root variables can be renamed.');
            return;
        }

        const input = await vscode.window.showInputBox({
            placeHolder: 'Enter new variable name or path',
            prompt: `Edit expression for ${item.variableInfo.path}`,
            value: item.variableInfo.path
        });

        if (input === undefined) return;
        const nextPath = input.trim();
        if (!nextPath || nextPath === item.variableInfo.path) return;

        if (this.isRootVariablePath(nextPath)) {
            vscode.window.showErrorMessage(`Variable already exists: ${nextPath}`);
            return;
        }

        try {
            const variableInfo = await this.serverClient.describe(nextPath);
            if (!variableInfo) {
                vscode.window.showErrorMessage(`Variable not found in ELF: ${nextPath}`);
                return;
            }

            this.rootVariables = this.rootVariables.map(variable =>
                variable.path === item.variableInfo.path ? variableInfo : variable
            );
            
            // 重新构建索引以防内存泄漏
            this.rebuildVariableIndex();
            this.valueCache.delete(item.variableInfo.path);
            await this.persistWatchedPaths();
            this.refresh();
        } catch (error) {
            vscode.window.showErrorMessage(`Rename failed: ${error}`);
        }
    }

    async deleteVariable(item: VariableTreeItem): Promise<void> {
        if (!item.isRoot) {
            vscode.window.showInformationMessage('Please remove the root variable to delete this member.');
            return;
        }

        this.rootVariables = this.rootVariables.filter(variable => variable.path !== item.variableInfo.path);
        
        // 【关键修复 2】：删除根节点时，通过重建来彻底清除它包含的所有子节点缓存
        this.rebuildVariableIndex(); 
        
        // 清理值缓存 (仅清理前缀匹配的)
        for (const key of this.valueCache.keys()) {
            if (key.startsWith(item.variableInfo.path)) {
                this.valueCache.delete(key);
            }
        }

        await this.persistWatchedPaths();

        if (this.rootVariables.length === 0) {
            this.stopAutoRefresh();
        }

        this.refresh();
    }

    getTreeItem(element: vscode.TreeItem): vscode.TreeItem {
        return element;
    }

    async getChildren(element?: vscode.TreeItem): Promise<vscode.TreeItem[]> {
        if (!this.serverClient.isRunning()) {
            return [new WaitingTreeItem()];
        }

        if (!element) {
            if (this.rootVariables.length === 0) {
                return [new AddVariableTreeItem()];
            }
            const rootItems = await this.createTreeItems(this.rootVariables, true);
            return [...rootItems, new AddVariableTreeItem()];
        }

        if (element instanceof VariableTreeItem) {
            // 请求后端获取子节点
            const children = await this.serverClient.listChildren(element.variableInfo.path);
            if (children && children.length > 0) {
                this.registerVariables(children);
                return this.createTreeItems(children, false);
            }
        }

        return [];
    }

    private async createTreeItems(variables: VariableInfo[], isRootLevel: boolean): Promise<VariableTreeItem[]> {
        const items: VariableTreeItem[] = [];
        const pathsToRead: string[] = [];

        // 【关键修复 3】：只在初次展开时，主动去读取叶子节点的值
        for (const variable of variables) {
            if (!variable.hasChildren && !this.valueCache.has(variable.path)) {
                pathsToRead.push(variable.path);
            }
        }

        if (pathsToRead.length > 0) {
            try {
                const results = await this.serverClient.readPaths(pathsToRead);
                for (const result of results) {
                    this.valueCache.set(result.path, result.value);
                }
            } catch (error) {
                console.warn('Failed to pre-fetch values for newly expanded items:', error);
            }
        }

        for (const variable of variables) {
            const collapsibleState = variable.hasChildren
                ? vscode.TreeItemCollapsibleState.Collapsed
                : vscode.TreeItemCollapsibleState.None;

            const value = this.valueCache.get(variable.path);
            items.push(new VariableTreeItem(variable, collapsibleState, isRootLevel, value));
        }

        return items;
    }

    async updateValue(path: string, newValue: any): Promise<void> {
        this.valueCache.set(path, newValue);
        this.refresh();
    }
}