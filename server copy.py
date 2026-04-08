import argparse
import json
import socket
import struct
import threading
from pathlib import Path
from typing import Any

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
            "children": sorted(self.children.keys()),
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
            tokens = [token for token in raw_res.replace(":", " ").split() if all(c in "0123456789abcdefABCDEFx" for c in token)]
            values = [token for token in tokens if token.lower().startswith("0x") or len(token) == 8]
            if values and values[0].lower().startswith("0x"):
                values = values[1:]
            for j in range(count):
                curr_node = sorted_nodes[i + j]
                if j < len(values):
                    raw_int = int(values[j], 16)
                    results_map[curr_node.addr] = self._parse_raw_int(raw_int, curr_node)
                else:
                    results_map[curr_node.addr] = "N/A"
            i += count
        return [results_map.get(node.addr, "N/A") for node in nodes]

    def _parse_raw_int(self, raw_int: int, node: VariableNode) -> Any:
        try:
            if node.type == "float":
                return round(struct.unpack("<f", struct.pack("<I", raw_int))[0], 4)
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

    def _expand_node(self, name: str, addr: int, type_off: int, cu_off: int, depth: int) -> VariableNode | None:
        if depth > 12:
            return None
        die = self.type_die_map.get((cu_off, type_off))
        if not die:
            return None
        name_attr = die.attributes.get("DW_AT_name")
        type_name = name_attr.value.decode("utf-8") if name_attr else ""
        if die.tag in ("DW_TAG_volatile_type", "DW_TAG_const_type", "DW_TAG_typedef"):
            next_type = die.attributes.get("DW_AT_type")
            if not next_type:
                return None
            node = self._expand_node(name, addr, next_type.value + cu_off, cu_off, depth + 1)
            if node and not node.type_name:
                node.type_name = type_name
            return node
        if die.tag == "DW_TAG_base_type":
            size = die.attributes.get("DW_AT_byte_size").value if "DW_AT_byte_size" in die.attributes else 4
            value_type = "float" if "float" in type_name.lower() else "int"
            return VariableNode(name, addr, value_type, size, type_name)
        if die.tag == "DW_TAG_structure_type":
            struct_node = VariableNode(name, addr, "struct", 0, type_name or "struct")
            for child in die.iter_children():
                if child.tag != "DW_TAG_member":
                    continue
                member_name = child.attributes.get("DW_AT_name")
                member_location = child.attributes.get("DW_AT_data_member_location")
                member_type = child.attributes.get("DW_AT_type")
                if not (member_name and member_location and member_type):
                    continue
                offset = member_location.value[0] if isinstance(member_location.value, list) else member_location.value
                expanded_child = self._expand_node(member_name.value.decode("utf-8"), addr + offset, member_type.value + cu_off, cu_off, depth + 1)
                if expanded_child:
                    struct_node.children[expanded_child.name] = expanded_child
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
        parts = [part for part in path.split(".") if part]
        if not parts:
            return None
        node = self.expert.root_vars.get(parts[0])
        for part in parts[1:]:
            if not node:
                return None
            node = node.children.get(part)
        return node

    def describe(self, path: str) -> dict[str, Any] | None:
        node = self.resolve_path(path)
        return node.to_summary(path) if node else None

    def list_children(self, path: str) -> list[dict[str, Any]] | None:
        node = self.resolve_path(path)
        if not node:
            return None
        return [child.to_summary(f"{path}.{name}") for name, child in sorted(node.children.items())]

    def read_paths(self, paths: list[str]) -> list[dict[str, Any]]:
        nodes: list[VariableNode] = []
        valid_paths: list[str] = []
        for path in paths:
            node = self.resolve_path(path)
            if node and node.type != "struct":
                nodes.append(node)
                valid_paths.append(path)
        values = self.rpc.batch_read(nodes)
        return [{"path": path, "value": values[idx], "address": hex(nodes[idx].addr), "type": nodes[idx].type, "typeName": nodes[idx].type_name, "size": nodes[idx].size} for idx, path in enumerate(valid_paths)]

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
        return {"ok": False, "error": f"Unknown command: {command}"}


def serve_stdio(server: DebugDataServer) -> int:
    while True:
        try:
            line = input()
        except EOFError:
            break
        if not line:
            continue
        try:
            response = server.handle(json.loads(line))
        except Exception as exc:
            response = {"ok": False, "error": str(exc)}
        print(json.dumps(response, ensure_ascii=False), flush=True)
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
