import argparse
import json
import socket
import struct
import threading
import math
from pathlib import Path
from typing import Any
import re

from elftools.elf.elffile import ELFFile


class VariableNode:
    def __init__(self, name: str, addr: int, v_type: str, size: int, type_name: str):
        self.name = name
        self.addr = addr
        self.type = v_type
        self.size = size
        self.type_name = type_name
        self.children: dict[str, "VariableNode"] = {}

    def to_summary(self, path: str) -> dict[str, Any]:
        return {
            "name": self.name,
            "path": path,
            "address": hex(self.addr),
            "type": self.type,
            "typeName": self.type_name,
            "size": self.size,
            "hasChildren": bool(self.children),
            "children": list(self.children.keys()),
        }


class TclRpcClient:
    def __init__(self, host: str = "127.0.0.1", port: int = 50001):
        self.host = host
        self.port = port
        self.sock: socket.socket | None = None
        self.lock = threading.Lock()
        self._connect()

    def _connect(self) -> None:
        try:
            if self.sock:
                self.sock.close()
            self.sock = socket.socket(socket.AF_INET, socket.SOCK_STREAM)
            self.sock.setsockopt(socket.IPPROTO_TCP, socket.TCP_NODELAY, 1)
            self.sock.settimeout(0.5)
            self.sock.connect((self.host, self.port))
        except Exception:
            self.sock = None

    def _send_rpc(self, cmd: str) -> str:
        with self.lock:
            if not self.sock:
                self._connect()
            if not self.sock:
                return ""
            try:
                self.sock.sendall(cmd.encode("ascii") + b"\x1a")
                res = b""
                while True:
                    chunk = self.sock.recv(4096)
                    if not chunk:
                        break
                    res += chunk
                    if b"\x1a" in chunk:
                        break
                return res.decode("ascii", errors="ignore").strip("\x1a")
            except Exception:
                self._connect()
                return ""

    def batch_read(self, nodes: list[VariableNode]) -> list[Any]:
        if not nodes:
            return []
        sorted_nodes = sorted(nodes, key=lambda node: node.addr)
        results_map: dict[int, Any] = {}
        i = 0
        while i < len(sorted_nodes):
            start_node = sorted_nodes[i]
            count = 1
            while i + count < len(sorted_nodes):
                next_node = sorted_nodes[i + count]
                if next_node.addr != start_node.addr + count * 4:
                    break
                count += 1
                
            raw_res = self._send_rpc(f'capture "mdw {hex(start_node.addr)} {count}"')
            
            # ======== 修复点：全新且健壮的多行数据解析逻辑 ========
            values = []
            for line in raw_res.splitlines():
                # 如果有冒号，说明是 "0x200000e0: " 这种地址头，丢弃冒号和之前的内容
                if ':' in line:
                    line = line.split(':', 1)[1]
                
                # 按空格分割剩下的纯数据部分
                for token in line.split():
                    # 只要是纯十六进制字符，就认为是有效数据
                    if all(c in "0123456789abcdefABCDEF" for c in token):
                        values.append(token)
            # ======================================================

            for j in range(count):
                curr_node = sorted_nodes[i + j]
                if j < len(values):
                    raw_int = int(values[j], 16)
                    # 确保调用你最新修改的 _parse_raw_value 或 _parse_raw_int
                    results_map[curr_node.addr] = self._parse_raw_value(raw_int, curr_node) 
                else:
                    results_map[curr_node.addr] = "N/A"
            i += count
            
        return [results_map.get(node.addr, "N/A") for node in nodes]


    def read_memory_bytes(self, addr: int, size: int) -> str:
        """使用 mdb 读取指定长度的内存并转为字符串"""
        # mdb 指令返回格式通常为: 0x2000002c: 42 61 74 74 65 72 79 00 ...
        raw_res = self._send_rpc(f'capture "mdb {hex(addr)} {size}"')
        
        try:
            # 提取十六进制部分
            # 过滤掉地址前缀（带冒号的部分）
            hex_tokens = []
            for line in raw_res.splitlines():
                parts = line.split(':')
                if len(parts) > 1:
                    # 拿到冒号后面的十六进制字节
                    tokens = parts[1].split()
                    for t in tokens:
                        if len(t) == 2 and all(c in "0123456789abcdefABCDEF" for c in t):
                            hex_tokens.append(t)
            
            # 转为字节流
            byte_data = bytes([int(h, 16) for h in hex_tokens[:size]])
            # 遇到 \x00 截断，并解码
            return byte_data.split(b'\x00')[0].decode('ascii', errors='ignore')
        except Exception:
            return "Decode Error"
    # def _parse_raw_int(self, raw_int: int, node: VariableNode) -> Any:
    #     try:
    #         if node.type == "float":
    #             return round(struct.unpack("<f", struct.pack("<I", raw_int))[0], 4)
    #         if node.size == 1:
    #             return raw_int & 0xFF
    #         if node.size == 2:
    #             return raw_int & 0xFFFF
    #         return raw_int
    #     except Exception:
    #         return "ERR"

    def _parse_raw_value(self, raw_int: int, node: VariableNode) -> Any:
        try:
            if node.size == 1:
                val = raw_int & 0xFF
                # 如果类型是 char，并且在可见 ASCII 码范围内，则同时显示字符
                if "char" in node.type_name.lower() and 32 <= val <= 126:
                    return f"{val} ('{chr(val)}')"
                return val
            # 1. 如果是字符串 (针对 name 这种 char 数组)
            if node.type == "string":
                # 将整数转为字节，例如 0x74746142 -> b'Batt' (小端)
                # 只能处理前 4 个字节，如果需要更长，需要修改 RPC 读取指令
                b = struct.pack("<I", raw_int & 0xFFFFFFFF)
                # 解码并去掉末尾的空字符 \x00
                return b.decode('ascii', errors='ignore').split('\x00')[0]

            # 2. 如果是浮点数
            if node.type == "float":
                return round(struct.unpack("<f", struct.pack("<I", raw_int))[0], 4)

            # 3. 处理不同大小的整数
            if node.size == 1:
                return raw_int & 0xFF
            if node.size == 2:
                return raw_int & 0xFFFF
                
            return raw_int
        except Exception:
            return "ERR"

    def write(self, node: VariableNode, val: str) -> bool:
        cmd_type = "mww" if node.size >= 4 else "mwh" if node.size == 2 else "mwb"
        try:
            raw_value = struct.unpack("<I", struct.pack("<f", float(val)))[0] if node.type == "float" else int(val, 0)
            self._send_rpc(f"{cmd_type} {hex(node.addr)} {hex(raw_value)}")
            return True
        except Exception:
            return False


class ElfExpert:
    def __init__(self, path: str):
        self.root_vars: dict[str, VariableNode] = {}
        self.type_die_map: dict[tuple[int, int], Any] = {}
        with open(path, "rb") as file:
            elffile = ELFFile(file)
            dwarf = elffile.get_dwarf_info()
            for cu in dwarf.iter_CUs():
                for die in cu.iter_DIEs():
                    if die.tag:
                        self.type_die_map[(cu.cu_offset, die.offset)] = die
            symtab = elffile.get_section_by_name(".symtab")
            addr_map = {symbol.name: symbol["st_value"] for symbol in symtab.iter_symbols() if symbol.name}
            for cu in dwarf.iter_CUs():
                for die in cu.iter_DIEs():
                    if die.tag != "DW_TAG_variable":
                        continue
                    name_attr = die.attributes.get("DW_AT_name")
                    type_attr = die.attributes.get("DW_AT_type")
                    if not (name_attr and type_attr):
                        continue
                    name = name_attr.value.decode("utf-8")
                    if name not in addr_map:
                        continue
                    node = self._expand_node(name, addr_map[name], type_attr.value + cu.cu_offset, cu.cu_offset, 0)
                    if node:
                        self.root_vars[name] = node

    def _fill_array_children(self, parent_node: VariableNode, base_addr: int, dims: list[int], type_off: int, cu_off: int, depth: int, elem_size: int):
        """
        递归填充数组子节点。
        dims: 剩余维度的列表，例如 [2, 3] 表示当前是 2x3 的数组
        elem_size: 最小单个元素的字节大小
        """
        import math
        
        count = dims[0] # 当前维度的元素个数
        # 计算当前维度下，每一个元素的跨度（Stride）
        # 例如 int a[2][3]，第一层的 stride 是 3个int的大小，即 12字节
        stride = elem_size * (math.prod(dims[1:]) if len(dims) > 1 else 1)
        
        for i in range(count):
            current_addr = base_addr + i * stride
            index_str = f"[{i}]"
            
            if len(dims) > 1:
                # 还有下一维，创建一个中间容器节点
                child_type_name = f"sub_array_{len(dims)-1}"
                sub_node = VariableNode(index_str, current_addr, "array", 0, child_type_name)
                # 递归处理下一维
                self._fill_array_children(sub_node, current_addr, dims[1:], type_off, cu_off, depth + 1, elem_size)
                parent_node.children[index_str] = sub_node
            else:
                # 最后一维，创建真实的元素节点（如 int 或 struct）
                leaf_node = self._expand_node(index_str, current_addr, type_off, cu_off, depth + 1)
                if leaf_node:
                    parent_node.children[index_str] = leaf_node

    # 递归展开节点
    def _expand_node(self, name: str, addr: int, type_off: int, cu_off: int, depth: int) -> VariableNode | None:
        if depth > 15:
            return None
            
        die = self.type_die_map.get((cu_off, type_off))
        if not die:
            return None

        name_attr = die.attributes.get("DW_AT_name")
        type_name = name_attr.value.decode("utf-8") if name_attr else ""
        
        # 统一获取当前类型的字节大小 (重要：用于步长计算)
        byte_size = die.attributes.get("DW_AT_byte_size")
        current_size = byte_size.value if byte_size else 0

        # --- 1. 处理修饰类型 ---
        if die.tag in ("DW_TAG_volatile_type", "DW_TAG_const_type", "DW_TAG_typedef"):
            next_type = die.attributes.get("DW_AT_type")
            if not next_type: return None
            node = self._expand_node(name, addr, next_type.value + cu_off, cu_off, depth + 1)
            if node and not node.type_name: 
                node.type_name = type_name
            return node

        # --- 2. 处理基础类型 ---
        if die.tag == "DW_TAG_base_type":
            value_type = "float" if "float" in type_name.lower() else "int"
            return VariableNode(name, addr, value_type, current_size, type_name)

        # --- 3. 处理枚举类型 ---
        if die.tag == "DW_TAG_enumeration_type":
            return VariableNode(name, addr, "enum", current_size or 4, type_name or "enum")

        # --- 4. 处理数组类型 ---
        if die.tag == "DW_TAG_array_type":
            element_type_attr = die.attributes.get("DW_AT_type")
            if not element_type_attr: return None
            
            dimensions = []
            for child in die.iter_children():
                if child.tag == "DW_TAG_subrange_type":
                    ubound = child.attributes.get("DW_AT_upper_bound")
                    if ubound:
                        dimensions.append(ubound.value + 1)
            
            if not dimensions: return None
            
            # 获取元素节点以获取其 size
            element_node = self._expand_node(f"{name}[0]", addr, element_type_attr.value + cu_off, cu_off, depth + 1)
            if not element_node: return None

            # 判定：如果是 char 类型的 1 维数组，标记为 string
            is_char = "char" in element_node.type_name.lower()
            is_1d = len(dimensions) == 1
            v_type = "string" if (is_char and is_1d) else "array"

            # total_size 非常重要，决定了我们要从内存读多少字节
            total_size = element_node.size * dimensions[0] 
            array_node = VariableNode(name, addr, v_type, total_size, f"{element_node.type_name}[{']['.join(map(str, dimensions))}]")
            
            # 只有元素数量合理时才填充子节点
            if math.prod(dimensions) <= 256:
                self._fill_array_children(array_node, addr, dimensions, element_type_attr.value + cu_off, cu_off, depth, element_node.size)
                
            return array_node

        # --- 5. 处理结构体 ---
        if die.tag == "DW_TAG_structure_type":
            # 关键修复：current_size 必须从 DWARF 读取，不能固定为 0
            struct_node = VariableNode(name, addr, "struct", current_size, type_name or "struct")
            for child in die.iter_children():
                if child.tag == "DW_TAG_member":
                    m_name = child.attributes.get("DW_AT_name")
                    m_loc = child.attributes.get("DW_AT_data_member_location")
                    m_type = child.attributes.get("DW_AT_type")
                    if m_name and m_loc and m_type:
                        # 转换偏移量
                        offset = m_loc.value[0] if isinstance(m_loc.value, list) else m_loc.value
                        member_name = m_name.value.decode("utf-8")
                        child_node = self._expand_node(member_name, addr + offset, m_type.value + cu_off, cu_off, depth + 1)
                        if child_node:
                            struct_node.children[member_name] = child_node
            return struct_node

        return None

class DebugDataServer:
    def __init__(self, elf_path: str, host: str, port: int):
        self.elf_path = str(Path(elf_path))
        self.rpc = TclRpcClient(host=host, port=port)
        self.expert = ElfExpert(self.elf_path)

    def list_roots(self) -> list[dict[str, Any]]:
        return [self.expert.root_vars[name].to_summary(name) for name in sorted(self.expert.root_vars.keys())]

    def resolve_path(self, path: str) -> VariableNode | None:
        if not path:
            return None

        # 1. 规范化路径：将 "a[0].b" 变为 "a.[0].b"
        # 这样我们可以统一使用 "." 作为分隔符，而不破坏 "[0]" 这种 key
        norm_path = path.replace("[", ".[")
        parts = [p for p in norm_path.split(".") if p]

        if not parts:
            return None

        # 2. 从根变量开始查找
        current_node = self.expert.root_vars.get(parts[0])
        
        # 3. 逐层深入
        for part in parts[1:]:
            if not current_node:
                return None
            # 尝试在当前节点的 children 中查找下一级
            current_node = current_node.children.get(part)
            
        return current_node

    def describe(self, path: str) -> dict[str, Any] | None:
        node = self.resolve_path(path)
        return node.to_summary(path) if node else None

    def list_children(self, path: str) -> list[dict[str, Any]] | None:
        node = self.resolve_path(path)
        if not node:
            return None
        
        # 使用正则表达式提取数字进行排序
        def natural_key(string_):
            return [int(s) if s.isdigit() else s for s in re.split(r'(\d+)', string_)]

        sorted_items = sorted(node.children.items(), key=lambda x: natural_key(x[0]))
        return [child.to_summary(f"{path}{'' if name.startswith('[') else '.'}{name}") for name, child in sorted_items]

    def read_paths(self, paths: list[str]) -> list[dict[str, Any]]:
        results = []
        # 分离普通变量和字符串变量
        normal_nodes = []
        
        for path in paths:
            node = self.resolve_path(path)
            if not node: continue
            
            if node.type == "string":
                # 字符串单独处理，读完整长度
                str_val = self.rpc.read_memory_bytes(node.addr, node.size)
                results.append({"path": path, "value": str_val, "address": hex(node.addr)})
            elif node.type != "struct":
                normal_nodes.append((path, node))
        
        # 普通变量继续使用原来的批量读取优化
        if normal_nodes:
            nodes_only = [n[1] for n in normal_nodes]
            values = self.rpc.batch_read(nodes_only)
            for idx, (path, node) in enumerate(normal_nodes):
                results.append({"path": path, "value": values[idx], "address": hex(node.addr)})
                
        return results
        
    def write_value(self, path: str, value: str) -> bool:
        node = self.resolve_path(path)
        return bool(node and node.type != "struct" and self.rpc.write(node, value))

    def handle(self, request: dict[str, Any]) -> dict[str, Any]:
        command = request.get("command")
        if command == "ping":
            return {"ok": True, "result": {"message": "pong"}}
        if command == "list_roots":
            return {"ok": True, "result": self.list_roots()}
        if command == "describe":
            path = request.get("path", "")
            result = self.describe(path)
            return {"ok": True, "result": result} if result else {"ok": False, "error": f"Variable not found: {path}"}
        if command == "list_children":
            path = request.get("path", "")
            result = self.list_children(path)
            return {"ok": True, "result": result} if result is not None else {"ok": False, "error": f"Variable not found: {path}"}
        if command == "read_paths":
            return {"ok": True, "result": self.read_paths(request.get("paths", []))}
        if command == "write":
            path = request.get("path", "")
            value = str(request.get("value", ""))
            return {"ok": True, "result": {"path": path, "value": value}} if self.write_value(path, value) else {"ok": False, "error": f"Write failed for {path}"}
        if command == "is_server_ready":
            is_ready = self.rpc.sock is not None # 或者执行一个轻量级的 mdw
            return {"ok": True, "result": {"ready": is_ready}}
        return {"ok": False, "error": f"Unknown command: {command}"}


import sys

def serve_stdio(server: DebugDataServer) -> int:
    while True:
        try:
            line = sys.stdin.readline()
            if not line: break # 管道关闭
            line = line.strip()
            if not line: continue
            
            response = server.handle(json.loads(line))
            print(json.dumps(response, ensure_ascii=False), flush=True)
        except Exception as exc:
            # 即使报错也要返回 JSON，防止前端 JSON.parse 崩溃
            print(json.dumps({"ok": False, "error": str(exc)}), flush=True)
    return 0


def parse_args() -> argparse.Namespace:
    parser = argparse.ArgumentParser(description="STM32 debug data backend for VS Code")
    parser.add_argument("--elf", required=True, help="Path to ELF file")
    parser.add_argument("--host", default="127.0.0.1", help="OpenOCD TCL RPC host")
    parser.add_argument("--port", type=int, default=50001, help="OpenOCD TCL RPC port")
    return parser.parse_args()


if __name__ == "__main__":
    args = parse_args()
    server = DebugDataServer(elf_path=args.elf, host=args.host, port=args.port)
    raise SystemExit(serve_stdio(server))
