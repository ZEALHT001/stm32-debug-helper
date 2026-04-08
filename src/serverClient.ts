import * as vscode from 'vscode';
import { spawn, ChildProcess } from 'child_process';
import * as fs from 'fs';
import * as path from 'path';
import { VariableInfo, ReadResult, ServerResponse } from './models/variable';

export class ServerClient {
    private process: ChildProcess | null = null;
    private buffer = '';
    private activeRequest: { resolve: Function; reject: Function } | null = null;
    private requestQueue: Promise<any> = Promise.resolve();

    constructor(private readonly serverScriptPath: string) {}

    private getServerExecutable(): string | null {
        const platform = process.platform;
        let exeName;

        if (platform === 'win32') {
            exeName = 'server-windows.exe';
        } else if (platform === 'darwin') {
            exeName = 'server-macos';
        } else if (platform === 'linux') {
            exeName = 'server-linux';
        } else {
            return null;
        }
        
        const possiblePaths = [
            path.join(__dirname, '..', 'bin', exeName),
            path.join(__dirname, exeName),
            path.join(__dirname, 'bin', exeName),
        ];

        for (const exePath of possiblePaths) {
            if (fs.existsSync(exePath)) {
                console.log(`Found server executable: ${exePath}`);
                return exePath;
            }
        }

        console.log(`Server executable not found, will use Python`);
        return null;
    }

    async start(elfPath: string, host: string = '127.0.0.1', port: number = 50001): Promise<void> {
        return new Promise((resolve, reject) => {
            if (this.process) {
                resolve();
                return;
            }

            const serverExe = this.getServerExecutable();
            const useExecutable = serverExe !== null;

            let pythonPath = vscode.workspace.getConfiguration('stm32DebugHelper').get<string>('pythonPath', 'python3');
            if (process.platform === 'win32' && pythonPath === 'python3') {
                pythonPath = 'python';
            }

            if (!useExecutable) {
                if (!fs.existsSync(this.serverScriptPath)) {
                    reject(new Error(`server.py not found: ${this.serverScriptPath}`));
                    return;
                }
            }

            const cwd = path.dirname(elfPath);
            const command = useExecutable ? serverExe! : pythonPath;
            const args = useExecutable 
                ? ['--elf', elfPath, '--host', host, '--port', port.toString()]
                : [this.serverScriptPath, '--elf', elfPath, '--host', host, '--port', port.toString()];

            console.log(`Starting server: ${command} ${args.join(' ')}`);
            console.log(`Working directory: ${cwd}`);
            console.log(`Using executable: ${useExecutable}`);

            this.process = spawn(
                command,
                args,
                {
                    cwd,
                    shell: false
                }
            );

            this.process.stdout?.on('data', (data: Buffer) => {
                console.log('Server stdout:', data.toString());
                this.buffer += data.toString();
                this.processBuffer();
            });

            this.process.stderr?.on('data', (data: Buffer) => {
                console.error('Server stderr:', data.toString());
            });

            this.process.on('error', (error) => {
                console.error('Failed to start server:', error);
                reject(error);
            });

            this.process.on('close', (code) => {
                console.log('Server closed with code:', code);
                if (this.activeRequest) {
                    this.activeRequest.reject(new Error(`Server closed with code: ${code}`));
                    this.activeRequest = null;
                }
                this.process = null;
            });

            setTimeout(() => resolve(), 100);
        });
    }

    private processBuffer(): void {
        const lines = this.buffer.split('\n');
        this.buffer = lines.pop() || '';

        for (const line of lines) {
            if (!line.trim()) {
                continue;
            }

            try {
                const response: ServerResponse = JSON.parse(line);
                const pending = this.activeRequest;
                if (pending) {
                    this.activeRequest = null;
                    if (response.ok) {
                        pending.resolve(response.result);
                    } else {
                        pending.reject(new Error(response.error));
                    }
                }
            } catch (error) {
                console.error('Failed to parse response:', line, error);
            }
        }
    }

    private sendRequest(command: string, params: any = {}): Promise<any> {
        const runRequest = () => new Promise((resolve, reject) => {
            if (!this.process || !this.process.stdin) {
                reject(new Error('Server not running'));
                return;
            }

            if (this.activeRequest) {
                reject(new Error('Another request is still in progress'));
                return;
            }

            const request = JSON.stringify({ command, ...params });
            this.activeRequest = { resolve, reject };
            this.process.stdin.write(request + '\n');
        });

        const queuedRequest = this.requestQueue.then(runRequest, runRequest);
        this.requestQueue = queuedRequest.catch(() => undefined);
        return queuedRequest;
    }

    async ping(): Promise<any> {
        return this.sendRequest('ping');
    }

    async listRoots(): Promise<VariableInfo[]> {
        return this.sendRequest('list_roots');
    }

    async describe(path: string): Promise<VariableInfo> {
        return this.sendRequest('describe', { path });
    }

    async listChildren(path: string): Promise<VariableInfo[]> {
        return this.sendRequest('list_children', { path });
    }

    async readPaths(paths: string[]): Promise<ReadResult[]> {
        return this.sendRequest('read_paths', { paths });
    }

    async writeValue(path: string, value: string): Promise<any> {
        return this.sendRequest('write', { path, value });
    }

    stop(): void {
        if (this.process) {
            this.process.kill();
            this.process = null;
        }
        this.activeRequest = null;
        this.requestQueue = Promise.resolve();
    }

    isRunning(): boolean {
        return this.process !== null;
    }
}
