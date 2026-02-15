#!/usr/bin/env python3
"""
Convert PNG header files to RGB565 bitmap format for Arduino displays.
This script reads PNG data from C header files and converts them to RGB565 format.
"""

import re
import sys
from PIL import Image
import io
import struct

def extract_png_data(header_file):
    """Extract PNG binary data from a C header file."""
    with open(header_file, 'r') as f:
        content = f.read()

    # Find all hex values in the array
    hex_values = re.findall(r'0x[0-9a-fA-F]{2}', content)

    # Convert to bytes
    png_data = bytes([int(h, 16) for h in hex_values])
    return png_data

def rgb888_to_rgb565(r, g, b):
    """Convert RGB888 (8-bit per channel) to RGB565 (16-bit)."""
    # RGB565: RRRRR GGGGGG BBBBB
    r5 = (r >> 3) & 0x1F
    g6 = (g >> 2) & 0x3F
    b5 = (b >> 3) & 0x1F
    return (r5 << 11) | (g6 << 5) | b5

def convert_png_to_rgb565(input_file, output_file, target_width=None, target_height=None):
    """Convert PNG header file to RGB565 bitmap header file."""

    # Extract PNG data from C header
    print(f"Reading {input_file}...")
    png_data = extract_png_data(input_file)

    # Load PNG image
    img = Image.open(io.BytesIO(png_data))
    print(f"Original size: {img.size}")

    # Convert to RGB if not already
    if img.mode != 'RGB':
        img = img.convert('RGB')

    # Resize if target dimensions specified
    if target_width and target_height:
        img = img.resize((target_width, target_height), Image.LANCZOS)
        print(f"Resized to: {img.size}")

    width, height = img.size

    # Convert to RGB565
    print("Converting to RGB565...")
    rgb565_data = []
    for y in range(height):
        for x in range(width):
            r, g, b = img.getpixel((x, y))
            rgb565 = rgb888_to_rgb565(r, g, b)
            # Store as little-endian uint16
            rgb565_data.append(rgb565 & 0xFF)
            rgb565_data.append((rgb565 >> 8) & 0xFF)

    # Generate C header file
    print(f"Writing {output_file}...")
    array_name = output_file.split('/')[-1].replace('.h', '').replace('-', '_')

    with open(output_file, 'w') as f:
        f.write(f"// '{array_name}', {width}x{height}px RGB565\n")
        f.write(f"const unsigned char {array_name}[] PROGMEM = {{\n")

        # Write data in rows of 16 bytes
        for i in range(0, len(rgb565_data), 16):
            row = rgb565_data[i:i+16]
            hex_str = ', '.join([f'0x{b:02x}' for b in row])
            f.write(f"    {hex_str},\n")

        f.write("};\n")

    print(f"Success! Generated {len(rgb565_data)} bytes ({width}x{height}x2)")
    return width, height

if __name__ == '__main__':
    # Define conversions: (input, output, width, height)
    conversions = [
        ('src/spotify_logo.h', 'src/spotify_logo_bitmap.h', 400, 400),
        ('src/play_pause.h', 'src/play_pause_bitmap.h', 80, 80),
        ('src/mute.h', 'src/mute_bitmap.h', 80, 80),
        ('src/next.h', 'src/next_bitmap.h', 80, 80),
        ('src/prev.h', 'src/prev_bitmap.h', 80, 80),
    ]

    print("PNG to RGB565 Converter")
    print("=" * 60)

    for input_file, output_file, width, height in conversions:
        print(f"\n{input_file} -> {output_file}")
        try:
            convert_png_to_rgb565(input_file, output_file, width, height)
        except Exception as e:
            print(f"ERROR: {e}")
            continue

    print("\n" + "=" * 60)
    print("Conversion complete!")
