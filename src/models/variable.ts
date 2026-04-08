export interface VariableInfo {
    name: string;
    path: string;
    address: string;
    type: string;
    typeName: string;
    size: number;
    hasChildren: boolean;
    children?: string[];
    value?: any;
}

export interface ReadResult {
    path: string;
    value: any;
    address: string;
    type: string;
    typeName: string;
    size: number;
}

export interface ServerResponse {
    ok: boolean;
    result?: any;
    error?: string;
}
