import * as fs from 'fs';
import * as path from 'path';
import * as vscode from 'vscode';
import { ServerClient } from './serverClient';
import { VariableTreeDataProvider, VariableTreeItem } from './variableTreeDataProvider';

let serverClient: ServerClient;
let variableTreeDataProvider: VariableTreeDataProvider;
let autoStartInProgress: Promise<void> | undefined;

export function activate(context: vscode.ExtensionContext) {
    console.log('STM32 Debug Helper is now active!');

    const serverScriptPath = resolveServerScriptPath(context.extensionPath);
    serverClient = new ServerClient(serverScriptPath);
    variableTreeDataProvider = new VariableTreeDataProvider(serverClient, context.workspaceState);

    const helloWorldCommand = vscode.commands.registerCommand('stm32-debug-helper.helloWorld', () => {
        vscode.window.showInformationMessage('Hello World from STM32 Debug Helper!');
    });

    const startServerCommand = vscode.commands.registerCommand('stm32-debug-helper.startServer', async () => {
        try {
            await ensureServerRunning(true);
        } catch (error) {
            vscode.window.showErrorMessage(`Failed to start server: ${error}`);
        }
    });

    const stopServerCommand = vscode.commands.registerCommand('stm32-debug-helper.stopServer', () => {
        variableTreeDataProvider.stopAutoRefresh();
        serverClient.stop();
        vscode.window.showInformationMessage('STM32 Debug Server stopped');
    });

    const refreshVariablesCommand = vscode.commands.registerCommand('stm32-debug-helper.refreshVariables', async () => {
        variableTreeDataProvider.clearValueCache();
    });

    const addVariableCommand = vscode.commands.registerCommand('stm32-debug-helper.addVariable', async () => {
        if (!serverClient.isRunning()) {
            try {
                await ensureServerRunning(false);
            } catch (error) {
                vscode.window.showErrorMessage(`Server not running: ${error}`);
                return;
            }
        }

        const input = await vscode.window.showInputBox({
            placeHolder: 'Enter variable name (e.g., counter, myStruct.value)',
            prompt: 'Enter the variable name to add'
        });

        if (input && input.trim()) {
            await variableTreeDataProvider.addVariable(input.trim());
        }
    });

    const editVariableCommand = vscode.commands.registerCommand('stm32-debug-helper.editVariable', async (item?: VariableTreeItem) => {
        if (!item) {
            return;
        }
        await variableTreeDataProvider.editVariableValue(item);
    });

    const renameVariableCommand = vscode.commands.registerCommand('stm32-debug-helper.renameVariable', async (item?: VariableTreeItem) => {
        if (!item) {
            return;
        }
        await variableTreeDataProvider.renameVariable(item);
    });

    const deleteVariableCommand = vscode.commands.registerCommand('stm32-debug-helper.deleteVariable', async (item?: VariableTreeItem) => {
        if (!item) {
            return;
        }
        await variableTreeDataProvider.deleteVariable(item);
    });

    const showBottomPanelCommand = vscode.commands.registerCommand('stm32-debug-helper.showBottomPanel', () => {
        void vscode.commands.executeCommand('stm32-debug-variables-panel.focus');
    });

    const panelTreeView = vscode.window.createTreeView('stm32-debug-variables-panel', {
        treeDataProvider: variableTreeDataProvider,
        showCollapseAll: true
    });

    let lastSelectedPath: string | undefined;
    let lastSelectedAt = 0;

    panelTreeView.onDidChangeSelection((event) => {
        if (event.selection.length !== 1) {
            return;
        }

        const item = event.selection[0];
        if (!(item instanceof VariableTreeItem) || item.variableInfo.hasChildren) {
            lastSelectedPath = undefined;
            lastSelectedAt = 0;
            return;
        }

        const now = Date.now();
        const isDoubleClick = lastSelectedPath === item.variableInfo.path && now - lastSelectedAt < 400;
        lastSelectedPath = item.variableInfo.path;
        lastSelectedAt = now;

        if (isDoubleClick) {
            void variableTreeDataProvider.editVariableValue(item);
        }
    });

    const debugStartDisposable = vscode.debug.onDidStartDebugSession((session) => {
        if (session.type !== 'cortex-debug') {
            return;
        }
        void ensureServerRunning(false);
    });

    context.subscriptions.push(
        helloWorldCommand,
        startServerCommand,
        stopServerCommand,
        refreshVariablesCommand,
        addVariableCommand,
        editVariableCommand,
        renameVariableCommand,
        deleteVariableCommand,
        showBottomPanelCommand,
        panelTreeView,
        debugStartDisposable
    );
}

function resolveServerScriptPath(extensionPath: string): string {
    const candidates = [
        path.join(extensionPath, 'server.py'),
        path.join(vscode.workspace.workspaceFolders?.[0]?.uri.fsPath ?? '', 'server.py')
    ].filter(Boolean);

    for (const candidate of candidates) {
        if (candidate && fs.existsSync(candidate)) {
            return candidate;
        }
    }

    return candidates[0] ?? 'server.py';
}

async function ensureServerRunning(showSuccessMessage: boolean): Promise<void> {
    if (serverClient.isRunning()) {
        await variableTreeDataProvider.loadRootVariables();
        if (showSuccessMessage) {
            vscode.window.showInformationMessage('STM32 Debug Server already running');
        }
        return;
    }

    if (autoStartInProgress) {
        await autoStartInProgress;
        return;
    }

    autoStartInProgress = (async () => {
        const config = vscode.workspace.getConfiguration('stm32DebugHelper');
        const host = config.get<string>('openocdHost', '127.0.0.1');
        const port = config.get<number>('openocdPort', 50001);
        const elfPath = await resolveElfPath(config);

        if (!elfPath) {
            throw new Error('No ELF found. Expected build/*.elf or configured stm32DebugHelper.elfPath');
        }

        const currentConfigElfPath = config.get<string>('elfPath', '');
        if (currentConfigElfPath !== elfPath) {
            await config.update('elfPath', elfPath, vscode.ConfigurationTarget.Workspace);
        }

        await serverClient.start(elfPath, host, port);
        await new Promise(resolve => setTimeout(resolve, 500));
        await serverClient.ping();
        await variableTreeDataProvider.loadRootVariables();

        if (showSuccessMessage) {
            vscode.window.showInformationMessage('STM32 Debug Server started successfully');
        }
    })();

    try {
        await autoStartInProgress;
    } finally {
        autoStartInProgress = undefined;
    }
}

async function resolveElfPath(config: vscode.WorkspaceConfiguration): Promise<string | undefined> {
    const configuredElfPath = config.get<string>('elfPath', '').trim();
    if (configuredElfPath && fs.existsSync(configuredElfPath)) {
        return configuredElfPath;
    }

    const workspaceFolder = vscode.workspace.workspaceFolders?.[0]?.uri.fsPath;
    if (!workspaceFolder) {
        return undefined;
    }

    const debugDir = path.join(workspaceFolder, 'build');
    if (fs.existsSync(debugDir)) {
        const elfFiles = fs.readdirSync(debugDir)
            .filter(file => file.toLowerCase().endsWith('.elf'))
            .sort();

        if (elfFiles.length > 0) {
            return path.join(debugDir, elfFiles[0]);
        }
    }

    const workspaceElfFiles = fs.readdirSync(workspaceFolder)
        .filter(file => file.toLowerCase().endsWith('.elf'))
        .sort();

    if (workspaceElfFiles.length > 0) {
        return path.join(workspaceFolder, workspaceElfFiles[0]);
    }

    return undefined;
}

export function deactivate() {
    if (serverClient) {
        serverClient.stop();
    }
}
