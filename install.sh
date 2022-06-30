#!/bin/bash

GIT_ROOT=$(git rev-parse --show-toplevel)
echo "cd to $GIT_ROOT\n"
cd $GIT_ROOT

for pkg in `exa -D`; do
  echo "Installing $pkg"
  stow $pkg --target $HOME
done
