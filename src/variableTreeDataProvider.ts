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

        if (variableInfo.hasChildren) {
            this.iconPath = new vscode.ThemeIcon('symbol-field');
        } else {
            this.iconPath = new vscode.ThemeIcon('symbol-variable');
        }
    }

    private buildDescription(): string {
        const parts: string[] = [];

        if (this.value !== undefined && this.value !== null) {
            parts.push(`= ${this.value}`);
        }

        parts.push(this.variableInfo.typeName);
        return parts.join(' | ');
    }

    private buildTooltip(): vscode.MarkdownString {
        const md = new vscode.MarkdownString();
        md.appendMarkdown(`**${this.variableInfo.name}**\n\n`);
        md.appendMarkdown(`- **Path**: ${this.variableInfo.path}\n`);
        md.appendMarkdown(`- **Type**: ${this.variableInfo.typeName}\n`);
        md.appendMarkdown(`- **Address**: ${this.variableInfo.address}\n`);
        md.appendMarkdown(`- **Size**: ${this.variableInfo.size} bytes\n`);
        if (this.value !== undefined) {
            md.appendMarkdown(`- **Value**: ${this.value}\n`);
        }
        return md;
    }

    private buildContextValue(): string {
        if (this.isRoot) {
            return this.variableInfo.hasChildren ? 'rootVariableWithChildren' : 'rootVariable';
        }
        return this.variableInfo.hasChildren ? 'variableWithChildren' : 'variable';
    }
}

export class WaitingTreeItem extends vscode.TreeItem {
    constructor() {
        super('Waiting for cortex-debug session...', vscode.TreeItemCollapsibleState.None);
        this.iconPath = new vscode.ThemeIcon('debug-pause');
        this.contextValue = 'waitingForDebugSession';
    }
}

export class AddVariableTreeItem extends vscode.TreeItem {
    constructor() {
        super('+ Add Variable', vscode.TreeItemCollapsibleState.None);
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
    private refreshInterval = 500;
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

    private async refreshValues(): Promise<void> {
        if (this.isRefreshing || !this.serverClient.isRunning() || this.allVariables.size === 0) {
            return;
        }

        this.isRefreshing = true;

        try {
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

                if (hasChanges) {
                    this.refresh();
                }
            }
        } catch {
            // Silently ignore refresh errors
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
                // Ignore invalid saved variables
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
        if (!normalizedPath) {
            return;
        }

        if (this.isRootVariablePath(normalizedPath)) {
            vscode.window.showInformationMessage(`Variable already added: ${normalizedPath}`);
            return;
        }

        try {
            const variableInfo = await this.serverClient.describe(normalizedPath);
            if (variableInfo) {
                this.rootVariables.push(variableInfo);
                this.registerVariables([variableInfo]);
                await this.persistWatchedPaths();
                this.startAutoRefresh();
                this.refresh();
            }
        } catch (error) {
            vscode.window.showErrorMessage(`Failed to add variable: ${error}`);
        }
    }

    async editVariableValue(item: VariableTreeItem): Promise<void> {
        if (item.variableInfo.hasChildren) {
            return;
        }

        const currentValue = this.valueCache.get(item.variableInfo.path);
        const input = await vscode.window.showInputBox({
            placeHolder: 'Enter new value (supports decimal or hex like 0x10)',
            prompt: `Set value for ${item.variableInfo.path}`,
            value: currentValue !== undefined ? String(currentValue) : ''
        });

        if (input === undefined) {
            return;
        }

        try {
            await this.serverClient.writeValue(item.variableInfo.path, input.trim());
            this.valueCache.set(item.variableInfo.path, input.trim());
            this.refresh();
            setTimeout(() => {
                void this.refreshValues();
            }, 150);
        } catch (error) {
            vscode.window.showErrorMessage(`Failed to update variable: ${error}`);
        }
    }

    async renameVariable(item: VariableTreeItem): Promise<void> {
        if (!item.isRoot) {
            vscode.window.showInformationMessage('Only watched root variables can be renamed to another expression.');
            return;
        }

        const input = await vscode.window.showInputBox({
            placeHolder: 'Enter corrected variable name or expression',
            prompt: `Replace watched variable ${item.variableInfo.path}`,
            value: item.variableInfo.path
        });

        if (input === undefined) {
            return;
        }

        const nextPath = input.trim();
        if (!nextPath || nextPath === item.variableInfo.path) {
            return;
        }

        if (this.isRootVariablePath(nextPath)) {
            vscode.window.showErrorMessage(`Variable already exists: ${nextPath}`);
            return;
        }

        try {
            const variableInfo = await this.serverClient.describe(nextPath);
            if (!variableInfo) {
                vscode.window.showErrorMessage(`Variable not found: ${nextPath}`);
                return;
            }

            this.rootVariables = this.rootVariables.map(variable =>
                variable.path === item.variableInfo.path ? variableInfo : variable
            );
            this.rebuildVariableIndex();
            this.valueCache.delete(item.variableInfo.path);
            await this.persistWatchedPaths();
            this.refresh();
        } catch (error) {
            vscode.window.showErrorMessage(`Failed to rename variable: ${error}`);
        }
    }

    async deleteVariable(item: VariableTreeItem): Promise<void> {
        if (!item.isRoot) {
            vscode.window.showInformationMessage('Only watched root variables can be deleted.');
            return;
        }

        this.rootVariables = this.rootVariables.filter(variable => variable.path !== item.variableInfo.path);
        this.rebuildVariableIndex();
        this.valueCache.delete(item.variableInfo.path);
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
            const children = await this.serverClient.listChildren(element.variableInfo.path);
            if (children) {
                this.registerVariables(children);
            }
            return this.createTreeItems(children || [], false);
        }

        return [];
    }

    private async createTreeItems(variables: VariableInfo[], isRootLevel: boolean): Promise<VariableTreeItem[]> {
        const items: VariableTreeItem[] = [];
        const pathsToRead: string[] = [];

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
                console.error('Failed to read values:', error);
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
