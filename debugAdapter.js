"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
const elftools_1 = require("elftools");
class STM32DebugAdapter {
    constructor() {
        this.socket = null;
        this.elfFile = null;
        this.variables = new Map();
        this.continueEventLoop = true;
        this.isConnected = false;
    }
    async initialize() {
        return {
            protocolVersion: '1.45.0',
            adapterID: 'stm32-debug',
            type: 'driver',
            threadsOk: true,
            supportsConfigurationDoneRequest: true,
            supportsFunctionBreakpoints: false,
            supportsConditionalBreakpoints: false,
            supportsEvaluateForHovers: true,
            supportsStepBack: false,
            supportsRestartFrame: false,
            supportsGotoTargetsRequest: false,
            supportsStepInTargetsRequest: false,
            supportsCompletionsRequest: false,
            supportsModulesRequest: false,
            supportsLoadedSourcesRequest: false,
            supportsLogPoints: false,
            supportsTerminateThreadsRequest: false,
            supportsSetVariable: false,
            supportsClipboardContext: false,
        };
    }
    async launch(args) {
        try {
            this.elfFile = new elftools_1.ELFFile(args.elf);
            this.parseVariables();
            this.isConnected = true;
        }
        catch (error) {
            throw new Error(`Failed to load ELF file: ${error}`);
        }
    }
    parseVariables() {
        if (!this.elfFile)
            return;
        this.variables.clear();
        const elfinfo = this.elfFile.header;
        for (const section of this.elfFile.iterate_sections()) {
            if (section.name === '.data' || section.name === '.bss') {
                const data = section.data();
                if (data && data.length > 0) {
                    this.parseSectionVariables(section.name, section.header.sh_addr, data);
                }
            }
        }
    }
    parseSectionVariables(sectionName, baseAddr, data) {
        const numWords = Math.floor(data.length / 4);
        for (let i = 0; i < numWords; i++) {
            const offset = i * 4;
            const addr = baseAddr + offset;
            const value = data.readUInt32LE(offset);
            if (value !== 0) {
                const varName = `var_${sectionName}_${i}`;
                this.variables.set(varName, {
                    name: varName,
                    path: varName,
                    address: `0x${addr.toString(16)}`,
                    type: 'int',
                    typeName: 'int',
                    size: 4,
                    hasChildren: false,
                    children: []
                });
            }
        }
    }
    async threads() {
        if (!this.isConnected) {
            return { threads: [] };
        }
        return {
            threads: [{
                    id: STM32DebugAdapter.THREAD_ID,
                    name: 'Main'
                }]
        };
    }
    async stackTrace(args) {
        return {
            stackFrames: [{
                    id: STM32DebugAdapter.STACK_FRAME_ID,
                    name: 'main',
                    source: null,
                    line: 0,
                    column: 0
                }],
            totalFrames: 1
        };
    }
    async scopes(args) {
        return {
            scopes: [{
                    name: 'Variables',
                    variablesReference: 1,
                    expensive: false
                }]
        };
    }
    async variables(args) {
        const vars = [];
        for (const [name, info] of this.variables) {
            vars.push({
                name: info.name,
                type: info.typeName,
                value: info.address,
                variablesReference: 0,
                presentationHint: { kind: 'property' }
            });
        }
        return { variables: vars };
    }
    async evaluate(args) {
        const expr = args.expression;
        for (const [name, info] of this.variables) {
            if (name === expr || info.path === expr) {
                return {
                    result: info.address,
                    type: info.typeName,
                    variablesReference: 0
                };
            }
        }
        return {
            result: `unknown: ${expr}`,
            type: 'unknown',
            variablesReference: 0
        };
    }
    async disconnect() {
        this.isConnected = false;
        if (this.socket) {
            this.socket.end();
            this.socket = null;
        }
    }
}
STM32DebugAdapter.THREAD_ID = 1;
STM32DebugAdapter.STACK_FRAME_ID = 1;
const adapter = new STM32DebugAdapter();
let seq = 0;
async function handleRequest(request) {
    const response = {
        type: 'response',
        seq: ++seq,
        request_seq: request.seq,
        command: request.command,
        success: true
    };
    try {
        const args = request.arguments;
        switch (request.command) {
            case 'initialize':
                const initResult = await adapter.initialize();
                response.body = initResult;
                break;
            case 'launch':
                await adapter.launch(args);
                break;
            case 'threads':
                const threadsResult = await adapter.threads();
                response.body = threadsResult;
                break;
            case 'stackTrace':
                const stackResult = await adapter.stackTrace(args);
                response.body = stackResult;
                break;
            case 'scopes':
                const scopesResult = await adapter.scopes(args);
                response.body = scopesResult;
                break;
            case 'variables':
                const varsResult = await adapter.variables(args);
                response.body = varsResult;
                break;
            case 'evaluate':
                const evalResult = await adapter.evaluate(args);
                response.body = evalResult;
                break;
            case 'disconnect':
                await adapter.disconnect();
                break;
            default:
                response.success = false;
                response.message = `Unknown command: ${request.command}`;
        }
    }
    catch (error) {
        response.success = false;
        response.message = String(error);
    }
    return response;
}
async function main() {
    process.stdin.setEncoding('utf8');
    let buffer = '';
    process.stdin.on('data', async (chunk) => {
        buffer += chunk;
        let newlineIndex;
        while ((newlineIndex = buffer.indexOf('\n')) !== -1) {
            const line = buffer.slice(0, newlineIndex);
            buffer = buffer.slice(newlineIndex + 1);
            if (!line.trim())
                continue;
            try {
                const request = JSON.parse(line);
                const response = await handleRequest(request);
                console.log(JSON.stringify(response));
            }
            catch (error) {
                console.error('Error:', error);
            }
        }
    });
}
main().catch(console.error);
//# sourceMappingURL=debugAdapter.js.map