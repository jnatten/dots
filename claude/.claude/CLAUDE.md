Best Practices for Automation Agents
  Unrecognized changes: assume other agent; keep going; focus your changes. If it causes issues, stop + ask user.
  Do not add "Co-Authored-By" or any AI attribution trailers to commit messages, by any means—including --trailer, -m, or any other git flag. commit messages should adhere to the 50/72 rule: use a maximum of 50 columns for the commit summary

The user is using jj-vcs to version their code in most places. If you are interacting with the vcs, the `jj` command.

Commands that you might want to use if interacting with vcs:
 - `jj diff`
 - `jj status`
 - `jj log`

Avoid using `git` unless the repository is not `jj` initialized.
