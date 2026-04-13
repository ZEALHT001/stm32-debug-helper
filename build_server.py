import os
import platform
import shutil
import sys
from pathlib import Path

import PyInstaller.__main__

def build_server():
    platform_name = platform.system().lower()
    
    if platform_name == 'windows':
        exe_name = 'server-windows.exe'
    elif platform_name == 'darwin':
        exe_name = 'server-macos'
    elif platform_name == 'linux':
        exe_name = 'server-linux'
    else:
        print(f"Unsupported platform: {platform_name}")
        sys.exit(1)
    
    output_dir = Path(__file__).parent / 'bin'
    output_dir.mkdir(exist_ok=True)
    
    print(f"Building server for {platform_name}...")
    
    pyinstaller_args = [
        './resources/server.py',
        '--onefile',
        '--name', exe_name,
        '--distpath', str(output_dir),
        '--hidden-import', 'elftools.elf.elffile',
        '--hidden-import', 'elftools.dwarf.dwarfinfo',
        '--hidden-import', 'elftools.dwarf.die',
        '--noconfirm',
    ]
    
    PyInstaller.__main__.run(pyinstaller_args)
    
    exe_path = output_dir / exe_name
    
    if exe_path.exists():
        print(f"Successfully built: {exe_path}")
        print(f"File size: {exe_path.stat().st_size / (1024 * 1024):.2f} MB")
    else:
        print(f"Failed to build: {exe_path}")
        sys.exit(1)

if __name__ == '__main__':
    build_server()
