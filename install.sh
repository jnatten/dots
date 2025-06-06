#!/bin/bash

GIT_ROOT=$(git rev-parse --show-toplevel)
cd $GIT_ROOT

for pkg in `eza -D`; do
  echo "Do you wish to install this $pkg?"
  select yn in "Yes" "No"; do
      case $yn in
          Yes ) echo "Installing $pkg..."; stow $pkg --target $HOME && echo "$pkg installed..."; break;;
          No ) echo "Skipping $pkg"; break;;
      esac
  done
done
