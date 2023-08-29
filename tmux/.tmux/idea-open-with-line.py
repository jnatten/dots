#!/usr/bin/env python3

import sys
import os

path = sys.stdin.read()
print(f"PATH IS: {path}")

path =  path.removeprefix("[error] ").strip()

splits = path.split(':')
if len(splits) == 3 and splits[-1].isnumeric() and splits[-2].isnumeric():
    os.system(f'idea --line {splits[1]} --column {splits[2]} {splits[0]}')

if len(splits) == 2 and splits[-1].isnumeric():
    os.system(f'idea --line {splits[1]} {splits[0]}')

if len(splits) == 1:
    os.system(f'idea {splits[0]}')


# os.system(f'code -g {path}')


